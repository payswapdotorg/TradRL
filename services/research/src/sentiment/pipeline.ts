// @tradrl/research (service) — the sentiment/event research pipeline.
//
// Work Order T021, section 5 (the reference pipeline):
//   "inject an observation port (news/alt-data emitter shape mirrors — a
//    scripted fake in tests), run the declared procedures (intake -> L4
//    gate -> aggregate by declared method -> detect events -> compose
//    readings/digests/reports), publish through an agent-os envelope
//    mirror port"
//
// The pipeline IS the body's declared `research-cycle` procedure, run as
// a pure protocol implementation: the cognitive substrate executes
// bodies at runtime (outside this package); here we prove the procedure
// is a deterministic, law-abiding computation.
//
// Laws held (each with its typed refusal):
//   - L8: the pipeline REFUSES to run a body spec that grants any
//     execution authority (validateSentimentResearcherBody first).
//   - L4: the L4 gate defers — never consumes — observations whose
//     available_time exceeds the run's as-of instant.
//   - L9: every output is built through the contract factories (evidence
//     completeness and derived ids enforced there); the run state carries
//     a step-digest chain.
//   - L12: tenant/project flow from the run config into every record.
//   - Method honesty: aggregation, event detection, confidence and
//     composition all read their parameters from the declared method
//     records — no implicit constants.
//   - Publication discipline: outputs leave ONLY through the injected
//     envelope-mirror port, as a bound (envelope, report) pair.
//   - Determinism: same (observation set, as-of, body version, seed) ->
//     byte-identical outputs. Observation order is canonicalized; source
//     pull order cannot leak into output bytes.

import {
  type AgentInstanceId,
  type BodyVersionRef,
  type ConfidenceAssessment,
  type CoverageAccounting,
  type DataGap,
  type DeferredObservation,
  type EventDigest,
  type IntensityAssessment,
  type MethodRegistry,
  type NewsObservation,
  type ObservationCitation,
  type ObservationSource,
  type PolarityAssessment,
  type ProjectId,
  type ResearchError,
  type ResearchObservation,
  type ResearchPublication,
  type ResearchPublicationPort,
  type ResearchResult,
  type SentimentReading,
  type SentimentResearcherBodySpec,
  type SentimentScoreObservation,
  type TenantId,
  type TimestampMs,
  type TopicName,
  type UnsupportedObservation,
  type AggregationParameters,
  type EventDetectionParameters,
  type ConfidenceParameters,
  SENTIMENT_RESEARCHER_BODY,
  buildResearchPublication,
  canonicalJson,
  canonicalObservationOrder,
  classifyPulledRecord,
  compareDecimal,
  composeResearchSummary,
  createEventDigest,
  createResearchReport,
  createSentimentReading,
  decimalDispersion,
  decimalMean,
  deepFreeze,
  findMethod,
  gateObservations,
  invalidField,
  isNonEmptyString,
  isObservationSource,
  isTimestampMs,
  stableDigestJson,
  validateResearchPublication,
  validateSentimentResearcherBody,
} from './imports';

// ---------------------------------------------------------------------------
// The run configuration (every instant explicit — no ambient clock)
// ---------------------------------------------------------------------------

/** The full configuration of one research run (the lineage binding). */
export interface ResearchRunConfig {
  /** The L4 instant the run computes as of. */
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  /** The seed this run carries (lineage material — L9). */
  readonly seed: string;
  /** The publishing instance (an agent-os AgentInstanceId). */
  readonly sender: AgentInstanceId;
  /** The organization topic the report is published to. */
  readonly topic: TopicName;
  /** The kernel operation id causing the publication. */
  readonly opId: string;
  /** The per-sender publication sequence (>= 1). */
  readonly publicationSequence: number;
  /** The explicit publication instant. */
  readonly publishedAt: TimestampMs;
}

/** The injected inputs: observation sources + the publication port. */
export interface ResearchPipelineInputs {
  readonly sources: readonly ObservationSource[];
  readonly publisher: ResearchPublicationPort;
}

/** The full outcome of one research run. */
export interface ResearchRunOutcome {
  readonly reportId: string;
  readonly publication: ResearchPublication;
  readonly coverage: CoverageAccounting;
  readonly deferred: readonly DeferredObservation[];
  readonly unsupported: readonly UnsupportedObservation[];
  readonly readings: readonly SentimentReading[];
  readonly digests: readonly EventDigest[];
  readonly dataGaps: readonly DataGap[];
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/** COLLECT-ALL validation of a run config (typed, never throws). */
export function validateResearchRunConfig(config: unknown): readonly ResearchError[] {
  const errors: ResearchError[] = [];
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return [invalidField('config', 'must be a research run config object')];
  }
  const c = config as Record<string, unknown>;
  if (!isTimestampMs(c.asOf)) errors.push(invalidField('asOf', 'must be a valid epoch-millisecond instant'));
  if (typeof c.bodyVersion !== 'string' || !c.bodyVersion.includes('@')) {
    errors.push(invalidField('bodyVersion', 'must be a canonical body-version reference'));
  }
  if (!isNonEmptyString(c.tenantId)) errors.push(invalidField('tenantId', 'must be a non-empty tenant id (L12)'));
  if (!isNonEmptyString(c.projectId)) errors.push(invalidField('projectId', 'must be a non-empty project id (L12)'));
  if (!isNonEmptyString(c.seed)) errors.push(invalidField('seed', 'must be a non-empty seed string'));
  if (!isNonEmptyString(c.sender)) errors.push(invalidField('sender', 'must be a non-empty agent instance id'));
  if (!isNonEmptyString(c.topic)) errors.push(invalidField('topic', 'must be a non-empty organization topic'));
  if (!isNonEmptyString(c.opId)) errors.push(invalidField('opId', 'must be a non-empty kernel operation id'));
  if (typeof c.publicationSequence !== 'number' || !Number.isInteger(c.publicationSequence) || (c.publicationSequence as number) < 1) {
    errors.push(invalidField('publicationSequence', 'must be an integer >= 1'));
  }
  if (!isTimestampMs(c.publishedAt)) errors.push(invalidField('publishedAt', 'must be a valid epoch-millisecond instant'));
  return errors;
}

/** Derives the run id: `research-run-<fnv1a32-digest of the config>`. */
export function researchRunId(config: ResearchRunConfig): string {
  return `research-run-${stableDigestJson(config as never)}`;
}

// ---------------------------------------------------------------------------
// The intake stage (pull -> classify -> account)
// ---------------------------------------------------------------------------

/** The intake snapshot: every offered observation is accounted for. */
export interface IntakeSnapshot {
  readonly admitted: readonly ResearchObservation[];
  readonly deferred: readonly DeferredObservation[];
  readonly unsupported: readonly UnsupportedObservation[];
  readonly coverage: CoverageAccounting;
}

/** Merges an intake snapshot with previously-admitted observations. */
function mergeSnapshots(previous: IntakeSnapshot, next: IntakeSnapshot): ResearchResult<IntakeSnapshot> {
  // Evidence uniqueness across resumes: duplicate event ids are a typed
  // error (the duplicate_observation_ref law — one observation, one id).
  const seen = new Set(previous.admitted.map((o) => o.event_id));
  for (const observation of next.admitted) {
    if (seen.has(observation.event_id)) {
      return {
        ok: false,
        errors: [
          {
            code: 'duplicate_observation_ref',
            path: 'intake',
            message: `observation ${JSON.stringify(observation.event_id)} was already admitted by this run — evidence ids are unique`,
          },
        ],
      };
    }
    seen.add(observation.event_id);
  }
  return {
    ok: true,
    value: deepFreeze({
      admitted: deepFreeze([...previous.admitted, ...next.admitted]),
      deferred: deepFreeze([...previous.deferred, ...next.deferred]),
      unsupported: deepFreeze([...previous.unsupported, ...next.unsupported]),
      coverage: deepFreeze({
        observationsOffered: previous.coverage.observationsOffered + next.coverage.observationsOffered,
        observationsAdmitted: previous.coverage.observationsAdmitted + next.coverage.observationsAdmitted,
        observationsDeferred: previous.coverage.observationsDeferred + next.coverage.observationsDeferred,
        observationsUnsupported: previous.coverage.observationsUnsupported + next.coverage.observationsUnsupported,
        observationsInvalid: previous.coverage.observationsInvalid + next.coverage.observationsInvalid,
      }),
    }),
  };
}

/** Runs intake over the injected sources (pull until drained, classify). */
export function runIntake(
  sources: readonly ObservationSource[],
  asOf: TimestampMs,
): ResearchResult<IntakeSnapshot> {
  const errors: ResearchError[] = [];
  for (const source of sources) {
    if (!isObservationSource(source)) {
      errors.push(invalidField('sources', 'every source must be an injected observation port'));
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const pulled: ResearchObservation[] = [];
  const unsupported: UnsupportedObservation[] = [];
  let invalid = 0;
  for (const source of sources) {
    for (;;) {
      const record: unknown = source.next();
      if (record === null) break;
      const classified = classifyPulledRecord(record);
      if (!classified.ok) {
        invalid += 1;
        continue;
      }
      if (classified.value.kind === 'admitted') {
        pulled.push(classified.value.observation);
      } else {
        unsupported.push(classified.value.note);
        if (classified.value.note.reason === 'invalid_observation') invalid += 1;
      }
    }
  }

  // THE L4 GATE: defer — never consume — future observations.
  const gated = gateObservations(pulled, asOf);
  return {
    ok: true,
    value: deepFreeze({
      admitted: canonicalObservationOrder(gated.admitted),
      deferred: gated.deferred,
      unsupported: deepFreeze(unsupported),
      coverage: deepFreeze({
        observationsOffered: pulled.length + unsupported.length,
        observationsAdmitted: gated.admitted.length,
        observationsDeferred: gated.deferred.length,
        observationsUnsupported: unsupported.length,
        observationsInvalid: invalid,
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// The aggregation stage (declared method; exact decimal arithmetic)
// ---------------------------------------------------------------------------

function citationOf(observation: ResearchObservation): ObservationCitation {
  return deepFreeze({
    observationId: observation.event_id,
    availableTime: observation.available_time,
    provenance: observation.provenance,
  });
}

/**
 * Aggregates sentiment-score observations into readings, grouped by
 * (instrument, venue). Polarity, intensity and confidence all come from
 * the declared aggregation/confidence method parameters — no implicit
 * constants anywhere.
 */
export function runAggregation(
  observations: readonly ResearchObservation[],
  registry: MethodRegistry,
  config: ResearchRunConfig,
): ResearchResult<{ readonly readings: readonly SentimentReading[]; readonly sentimentInstruments: readonly string[] }> {
  const aggregation = findMethod(registry, 'method/sentiment/aggregation');
  const confidence = findMethod(registry, 'method/sentiment/confidence');
  if (aggregation === null || confidence === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'undeclared_method',
          path: 'aggregation',
          message: 'the aggregation/confidence methods are not declared in the body spec registry — a sentiment value without a declared method is a magic number',
        },
      ],
    };
  }
  const aggregationParameters = aggregation.parameters as AggregationParameters;
  const confidenceParameters = confidence.parameters as ConfidenceParameters;

  // THE ORDER LAW: canonicalize BEFORE grouping — the stage itself is
  // order-independent. A caller's presentation order can never leak into
  // evidence citation order (and therefore never into reading bytes or
  // derived reading ids), whatever discipline the caller kept.
  const groups = new Map<string, SentimentScoreObservation[]>();
  for (const observation of canonicalObservationOrder(observations)) {
    if (observation.event_type !== 'social_signal') continue;
    const sentiment = observation as SentimentScoreObservation;
    const key = `${sentiment.instrument}|${sentiment.venue}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [sentiment]);
    else bucket.push(sentiment);
  }

  const readings: SentimentReading[] = [];
  for (const [key, bucket] of groups) {
    const [instrument, venue] = key.split('|') as [string, string];
    const scores = bucket.map((observation) => observation.payload.value);
    const mean = decimalMean(scores, aggregationParameters.outputScale, aggregationParameters.rounding);
    const dispersion = decimalDispersion(scores, aggregationParameters.outputScale, aggregationParameters.rounding);

    // polarity direction — from the DECLARED thresholds
    const versusPositive = compareDecimal(mean, aggregationParameters.polarityThresholds.positive);
    const versusNegative = compareDecimal(mean, aggregationParameters.polarityThresholds.negative);
    let direction: PolarityAssessment['direction'];
    if (versusPositive >= 0) direction = 'positive';
    else if (versusNegative <= 0) direction = 'negative';
    else if (
      dispersion !== null &&
      compareDecimal(dispersion, aggregationParameters.mixedDispersion) > 0
    ) {
      direction = 'mixed'; // near-zero mean but strongly disagreeing evidence
    } else {
      direction = 'neutral';
    }

    // intensity — from the DECLARED thresholds (|mean|)
    const magnitude = direction === 'negative' ? mean.replace('-', '') : mean;
    let level: IntensityAssessment['level'];
    if (compareDecimal(magnitude, aggregationParameters.intensityThresholds.high) >= 0) level = 'high';
    else if (compareDecimal(magnitude, aggregationParameters.intensityThresholds.moderate) >= 0) level = 'moderate';
    else level = 'low';

    // confidence — from the DECLARED evidence-count/dispersion bands
    const count = bucket.length;
    let confidenceLevel: ConfidenceAssessment['level'];
    if (
      count >= confidenceParameters.high.minEvidence &&
      dispersion !== null &&
      compareDecimal(dispersion, confidenceParameters.high.maxDispersion) <= 0
    ) {
      confidenceLevel = 'high';
    } else if (
      count >= confidenceParameters.moderate.minEvidence &&
      dispersion !== null &&
      compareDecimal(dispersion, confidenceParameters.moderate.maxDispersion) <= 0
    ) {
      confidenceLevel = 'moderate';
    } else {
      confidenceLevel = 'low';
    }

    const construction = createSentimentReading(
      {
        scope: { instrument, venue },
        polarity: {
          methodId: aggregation.methodId,
          methodVersion: aggregation.version,
          direction,
          score: mean,
        },
        intensity: {
          methodId: aggregation.methodId,
          methodVersion: aggregation.version,
          level,
          score: magnitude,
        },
        confidence: {
          methodId: confidence.methodId,
          methodVersion: confidence.version,
          level: confidenceLevel,
          evidenceCount: count,
          dispersion,
        },
        evidence: deepFreeze(bucket.map(citationOf)),
        asOf: config.asOf,
        bodyVersion: config.bodyVersion,
        tenantId: config.tenantId,
        projectId: config.projectId,
        seed: config.seed,
      },
      registry,
    );
    if (!construction.ok) return construction;
    readings.push(construction.value);
  }

  // deterministic reading order: by scope (instrument, venue)
  readings.sort((a, b) =>
    a.scope.instrument === b.scope.instrument
      ? a.scope.venue < b.scope.venue
        ? -1
        : 1
      : a.scope.instrument < b.scope.instrument
        ? -1
        : 1,
  );
  return {
    ok: true,
    value: deepFreeze({
      readings: deepFreeze(readings),
      sentimentInstruments: deepFreeze([...new Set([...groups.keys()].map((key) => (key.split('|') as [string, string])[0]))].sort()),
    }),
  };
}

// ---------------------------------------------------------------------------
// The event-detection stage (declared window; knowledge-time clustering)
// ---------------------------------------------------------------------------

/**
 * Clusters news observations into event digests. Clustering is by
 * (epoch-aligned window index of available_time, instrument) — pure and
 * deterministic; the cluster kind comes from the declared tag-to-kind
 * keyword table (first match in canonical observation order);
 * instruments affected are the union of stream instruments and payload
 * symbols, sorted and unique.
 */
export function runEventDetection(
  observations: readonly ResearchObservation[],
  registry: MethodRegistry,
  config: ResearchRunConfig,
): ResearchResult<{ readonly digests: readonly EventDigest[]; readonly newsInstruments: readonly string[] }> {
  const detection = findMethod(registry, 'method/sentiment/event-detection');
  if (detection === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'undeclared_method',
          path: 'eventDetection',
          message: 'the event-detection method is not declared in the body spec registry',
        },
      ],
    };
  }
  const parameters = detection.parameters as EventDetectionParameters;

  const clusters = new Map<string, NewsObservation[]>();
  const newsInstruments = new Set<string>();
  for (const observation of observations) {
    if (observation.event_type !== 'news') continue;
    const news = observation as NewsObservation;
    newsInstruments.add(news.instrument);
    // epoch-aligned knowledge-time windows (deterministic anchoring)
    const windowIndex = Math.floor((news.available_time as number) / parameters.windowMs);
    const key = `${windowIndex}|${news.instrument}`;
    const bucket = clusters.get(key);
    if (bucket === undefined) clusters.set(key, [news]);
    else bucket.push(news);
  }

  const digests: EventDigest[] = [];
  for (const [, cluster] of clusters) {
    if (cluster.length < parameters.minObservations) continue;
    const ordered = canonicalObservationOrder(cluster);

    // the declared tag-to-kind table: first keyword match in canonical order
    let kind: EventDigest['kind'] = 'coverage-burst';
    for (const observation of ordered) {
      const tags = (observation.payload as NewsObservation['payload']).tags ?? [];
      let matched = false;
      for (const tag of tags) {
        const entry = parameters.kindKeywords.find((candidate) => candidate.keyword === tag);
        if (entry !== undefined) {
          kind = entry.kind as EventDigest['kind'];
          matched = true;
          break;
        }
      }
      if (matched) break;
    }

    const instruments = new Set<string>();
    const venues = new Set<string>();
    let from = ordered[0]!.available_time as number;
    let to = ordered[0]!.available_time as number;
    for (const observation of ordered) {
      instruments.add(observation.instrument);
      for (const symbol of (observation.payload as NewsObservation['payload']).symbols) {
        instruments.add(symbol);
      }
      venues.add(observation.venue);
      const available = observation.available_time as number;
      if (available < from) from = available;
      if (available > to) to = available;
    }

    const construction = createEventDigest(
      {
        kind,
        instruments: [...instruments].sort(),
        venues: [...venues].sort(),
        window: { from: from as TimestampMs, to: to as TimestampMs },
        observationCount: ordered.length,
        evidence: deepFreeze(ordered.map(citationOf)),
        asOf: config.asOf,
        methodId: detection.methodId,
        methodVersion: detection.version,
        bodyVersion: config.bodyVersion,
        tenantId: config.tenantId,
        projectId: config.projectId,
        seed: config.seed,
      },
      registry,
    );
    if (!construction.ok) return construction;
    digests.push(construction.value);
  }

  digests.sort((a, b) => (a.digestId < b.digestId ? -1 : 1));
  return {
    ok: true,
    value: deepFreeze({
      digests: deepFreeze(digests),
      newsInstruments: deepFreeze([...newsInstruments].sort()),
    }),
  };
}

// ---------------------------------------------------------------------------
// The composition + publication stages
// ---------------------------------------------------------------------------

/** Computes the declared data gaps from the stage outputs (enumerated). */
export function computeDataGaps(input: {
  readonly readings: readonly SentimentReading[];
  readonly digests: readonly EventDigest[];
  readonly sentimentInstruments: readonly string[];
  readonly newsInstruments: readonly string[];
}): readonly DataGap[] {
  const gaps: DataGap[] = [];
  if (input.sentimentInstruments.length === 0) {
    gaps.push({ kind: 'no-sentiment-observations', instrument: '' });
  }
  if (input.newsInstruments.length === 0) {
    gaps.push({ kind: 'no-news-observations', instrument: '' });
  }
  for (const instrument of input.newsInstruments) {
    if (!input.sentimentInstruments.includes(instrument)) {
      gaps.push({ kind: 'instrument-without-sentiment', instrument });
    }
  }
  // The canonical gap order: (kind, instrument) lexicographic — fully
  // determined. Never bucket-push order; never Array#sort stability.
  return deepFreeze(
    gaps.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      return a.instrument === b.instrument ? 0 : a.instrument < b.instrument ? -1 : 1;
    }),
  );
}

// ---------------------------------------------------------------------------
// The pipeline (one run of the declared research-cycle procedure)
// ---------------------------------------------------------------------------

/**
 * Runs the full declared pipeline over the injected inputs and returns
 * the run outcome (the published report's id, the publication, the L4
 * accounting, the outputs). Pure and deterministic given (sources'
 * stream, config, body spec).
 */
export function runResearchPipeline(
  config: ResearchRunConfig,
  inputs: ResearchPipelineInputs,
  bodySpec: SentimentResearcherBodySpec = SENTIMENT_RESEARCHER_BODY,
): ResearchResult<ResearchRunOutcome> {
  // THE L8 GATE: the pipeline refuses to run a body spec that grants any
  // execution authority — the read-only declaration is existential.
  const bodyErrors = validateSentimentResearcherBody(bodySpec);
  if (bodyErrors.length > 0) {
    return { ok: false, errors: bodyErrors.map((e) => ({ ...e, path: `bodySpec.${e.path}` })) };
  }
  const configErrors = validateResearchRunConfig(config);
  if (configErrors.length > 0) return { ok: false, errors: configErrors };
  const registry: MethodRegistry = bodySpec.research.methodRegistry;

  // stage 1: intake + the L4 gate
  const intake = runIntake(inputs.sources, config.asOf);
  if (!intake.ok) return intake;

  // stage 2-3: aggregate + detect (over the admitted, canonically ordered set)
  const aggregation = runAggregation(intake.value.admitted, registry, config);
  if (!aggregation.ok) return aggregation;
  const detection = runEventDetection(intake.value.admitted, registry, config);
  if (!detection.ok) return detection;

  // stage 4: compose (summary re-derivation happens inside the factory)
  const dataGaps = computeDataGaps({
    readings: aggregation.value.readings,
    digests: detection.value.digests,
    sentimentInstruments: aggregation.value.sentimentInstruments,
    newsInstruments: detection.value.newsInstruments,
  });
  const summary = composeResearchSummary({
    readings: aggregation.value.readings,
    digests: detection.value.digests,
    coverage: intake.value.coverage,
    dataGaps,
  });
  const composition = findMethod(registry, 'method/sentiment/report-composition');
  if (composition === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'undeclared_method',
          path: 'composition',
          message: 'the report-composition method is not declared in the body spec registry',
        },
      ],
    };
  }
  const report = createResearchReport(
    {
      asOf: config.asOf,
      bodyVersion: config.bodyVersion,
      methodId: composition.methodId,
      methodVersion: composition.version,
      tenantId: config.tenantId,
      projectId: config.projectId,
      seed: config.seed,
      readings: aggregation.value.readings,
      digests: detection.value.digests,
      summary,
    },
    registry,
  );
  if (!report.ok) return report;

  // stage 5: publish — ONLY through the injected envelope-mirror port
  const publication = buildResearchPublication({
    opId: config.opId,
    topic: config.topic,
    tenantId: config.tenantId,
    sender: config.sender,
    report: report.value,
    sequence: config.publicationSequence,
    publishedAt: config.publishedAt,
  });
  if (!publication.ok) return publication;
  const publicationErrors = validateResearchPublication(publication.value, registry);
  if (publicationErrors.length > 0) return { ok: false, errors: publicationErrors };
  const receipt = inputs.publisher.publish(publication.value);
  if (!receipt.ok) return receipt;

  return {
    ok: true,
    value: deepFreeze({
      reportId: report.value.reportId,
      publication: publication.value,
      coverage: intake.value.coverage,
      deferred: intake.value.deferred,
      unsupported: intake.value.unsupported,
      readings: aggregation.value.readings,
      digests: detection.value.digests,
      dataGaps,
    }),
  };
}

/** Canonical serialization of a run config (byte-deterministic, L9). */
export function serializeResearchRunConfig(config: ResearchRunConfig): string {
  return canonicalJson(config as never);
}
