// @tradrl/research (service) — the market-regime research pipeline.
//
// Work Order T022, section 5 (the reference pipeline):
//   "inject an observation port (market-protocol event shape mirrors —
//    a scripted fake in tests: quotes/trades windows), run the declared
//    procedures (intake -> L4 gate -> window statistics by declared
//    method -> classify regime -> detect changes -> compose
//    classifications/changes/reports), publish through an agent-os
//    envelope mirror port"
//
// The pipeline IS the body's declared `regime-research-cycle` procedure,
// run as a pure protocol implementation: the cognitive substrate
// executes bodies at runtime (outside this package); here we prove the
// procedure is a deterministic, law-abiding computation.
//
// Laws held (each with its typed refusal):
//   - L8: the pipeline REFUSES to run a body spec that grants any
//     execution authority (validateRegimeResearcherBody first).
//   - L4: the L4 gate defers — never consumes — observations whose
//     available_time exceeds the run's as-of instant.
//   - L9: every output is built through the contract factories (evidence
//     completeness and derived ids enforced there); the run state carries
//     a step-digest chain.
//   - L12: tenant/project flow from the run config into every record.
//   - Method honesty: window statistics, classification, change
//     detection, confidence and composition all read their parameters
//     from the declared method records — no implicit constants.
//   - Publication discipline: outputs leave ONLY through the injected
//     envelope-mirror port, as a bound (envelope, report) pair.
//   - Determinism: same (observation set, as-of, body version, seed) ->
//     byte-identical outputs. Observation order is canonicalized; source
//     pull order cannot leak into output bytes.

import {
  type AgentInstanceId,
  type BodyVersionRef,
  type ConfidenceLevel,
  type DeferredMarketObservation,
  type IntakeCoverage,
  type MarketObservation,
  type MarketObservationSource,
  type ProjectId,
  type RegimeChange,
  type RegimeClassification,
  type RegimeClassificationParameters,
  type RegimeConfidenceParameters,
  type RegimeDataGap,
  type RegimeError,
  type RegimeMethodRegistry,
  type RegimePublication,
  type RegimePublicationPort,
  type RegimeResult,
  type RegimeResearcherBodySpec,
  type RegimeScope,
  type TenantId,
  type TimestampMs,
  type TopicName,
  type UnsupportedMarketObservation,
  REGIME_RESEARCHER_BODY,
  buildRegimePublication,
  canonicalJson,
  canonicalMarketObservationOrder,
  classifyPulledMarketRecord,
  classifyRegimeWindow,
  composeRegimeSummary,
  computeRegimeWindowDispersion,
  computeRegimeWindowStats,
  createRegimeChange,
  createRegimeClassification,
  createRegimeResearchReport,
  compareDecimal,
  deepFreeze,
  extractObservationPrice,
  findRegimeMethod,
  gateMarketObservations,
  isMarketObservationSource,
  isTimestampMs,
  isNonEmptyString,
  stableDigestJson,
  invalidField,
  validateRegimePublication,
  validateRegimeResearcherBody,
} from './imports';

// ---------------------------------------------------------------------------
// The run configuration (every instant explicit — no ambient clock)
// ---------------------------------------------------------------------------

/** The full configuration of one regime research run (the lineage binding). */
export interface RegimeRunConfig {
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
export interface RegimePipelineInputs {
  readonly sources: readonly MarketObservationSource[];
  readonly publisher: RegimePublicationPort;
}

/** The full outcome of one regime research run. */
export interface RegimeRunOutcome {
  readonly reportId: string;
  readonly publication: RegimePublication;
  readonly coverage: IntakeCoverage;
  readonly deferred: readonly DeferredMarketObservation[];
  readonly unsupported: readonly UnsupportedMarketObservation[];
  readonly classifications: readonly RegimeClassification[];
  readonly changes: readonly RegimeChange[];
  readonly dataGaps: readonly RegimeDataGap[];
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/** COLLECT-ALL validation of a run config (typed, never throws). */
export function validateRegimeRunConfig(config: unknown): readonly RegimeError[] {
  const errors: RegimeError[] = [];
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return [invalidField('config', 'must be a regime run config object')];
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

/** Derives the run id: `regime-run-<stableDigestJson of the config>`. */
export function regimeRunId(config: RegimeRunConfig): string {
  return `regime-run-${stableDigestJson(config as never)}`;
}

// ---------------------------------------------------------------------------
// The intake stage (pull -> classify -> account)
// ---------------------------------------------------------------------------

/** The intake snapshot: every offered observation is accounted for. */
export interface RegimeIntakeSnapshot {
  readonly admitted: readonly MarketObservation[];
  readonly deferred: readonly DeferredMarketObservation[];
  readonly unsupported: readonly UnsupportedMarketObservation[];
  readonly coverage: IntakeCoverage;
}

/** Runs intake over the injected sources (pull until drained, classify). */
export function runRegimeIntake(
  sources: readonly MarketObservationSource[],
  asOf: TimestampMs,
): RegimeResult<RegimeIntakeSnapshot> {
  const errors: RegimeError[] = [];
  for (const source of sources) {
    if (!isMarketObservationSource(source)) {
      errors.push(invalidField('sources', 'every source must be an injected observation port'));
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const pulled: MarketObservation[] = [];
  const unsupported: UnsupportedMarketObservation[] = [];
  let invalid = 0;
  for (const source of sources) {
    for (;;) {
      const record: unknown = source.next();
      if (record === null) break;
      const classified = classifyPulledMarketRecord(record);
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
  const gated = gateMarketObservations(pulled, asOf);
  return {
    ok: true,
    value: deepFreeze({
      admitted: canonicalMarketObservationOrder(gated.admitted),
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
// The classification stage (declared window statistics; closed taxonomy)
// ---------------------------------------------------------------------------

function citationOf(observation: MarketObservation): { readonly observationId: string; readonly availableTime: TimestampMs; readonly provenance: MarketObservation['provenance'] } {
  return deepFreeze({
    observationId: observation.event_id,
    availableTime: observation.available_time,
    provenance: observation.provenance,
  });
}

/** The classification stage's outputs. */
export interface RegimeClassificationStage {
  readonly classifications: readonly RegimeClassification[];
  /** Every instrument seen in the admitted set (classified or not). */
  readonly instrumentsSeen: readonly string[];
  /** The instruments that received at least one classification. */
  readonly instrumentsClassified: readonly string[];
}

/**
 * Classifies admitted observations into windows and regimes. Windows are
 * EPOCH-ALIGNED on the declared `windowBasis: 'available-time'` (pure and
 * deterministic anchoring); grouping is by (instrument, venue, window
 * index); prices are extracted by the declared basis; statistics,
 * decision, and confidence all come from the declared method parameters —
 * no implicit constants anywhere. Windows below the declared minimum
 * observation count produce NO classification (a data gap upstream, never
 * a fabricated label).
 */
export function runRegimeClassification(
  observations: readonly MarketObservation[],
  registry: RegimeMethodRegistry,
  config: RegimeRunConfig,
): RegimeResult<RegimeClassificationStage> {
  const classification = findRegimeMethod(registry, 'method/regime/classification');
  const confidenceMethod = findRegimeMethod(registry, 'method/regime/confidence');
  if (classification === null || confidenceMethod === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'undeclared_method',
          path: 'classification',
          message: 'the classification/confidence methods are not declared in the body spec registry — a regime label without a declared method is a magic label',
        },
      ],
    };
  }
  const parameters = classification.parameters as RegimeClassificationParameters;
  const confidenceParameters = confidenceMethod.parameters as RegimeConfidenceParameters;

  // THE ORDER LAW: canonicalize BEFORE grouping — the stage itself is
  // order-independent. A caller's presentation order can never leak into
  // evidence citation order (and therefore never into output bytes or
  // derived ids), whatever discipline the caller kept.
  const windows = new Map<string, MarketObservation[]>();
  const instrumentsSeen = new Set<string>();
  for (const observation of canonicalMarketObservationOrder(observations)) {
    instrumentsSeen.add(observation.instrument);
    const windowIndex = Math.floor((observation.available_time as number) / parameters.windowMs);
    const key = `${observation.instrument}|${observation.venue}|${windowIndex}`;
    const bucket = windows.get(key);
    if (bucket === undefined) windows.set(key, [observation]);
    else bucket.push(observation);
  }

  const classifications: RegimeClassification[] = [];
  const instrumentsClassified = new Set<string>();
  for (const [key, bucket] of windows) {
    const [instrument, venue] = key.split('|') as [string, string];
    // the price series under the declared extraction basis
    const prices = bucket
      .map((observation) => extractObservationPrice(observation, parameters.outputScale, parameters.rounding))
      .filter((price): price is string => price !== null);
    if (prices.length < parameters.minObservations) continue; // a gap, never a fabricated label

    const stats = computeRegimeWindowStats(prices, parameters);
    if (!stats.ok) return stats;
    const label = classifyRegimeWindow(stats.value, parameters);
    const dispersion = computeRegimeWindowDispersion(prices, parameters);

    // confidence — from the DECLARED evidence-count/dispersion bands
    const count = prices.length;
    let level: ConfidenceLevel;
    if (
      count >= confidenceParameters.high.minEvidence &&
      dispersion !== null &&
      compareDecimal(dispersion, confidenceParameters.high.maxDispersion) <= 0
    ) {
      level = 'high';
    } else if (
      count >= confidenceParameters.moderate.minEvidence &&
      dispersion !== null &&
      compareDecimal(dispersion, confidenceParameters.moderate.maxDispersion) <= 0
    ) {
      level = 'moderate';
    } else {
      level = 'low';
    }

    let from = bucket[0]!.available_time as number;
    let to = bucket[0]!.available_time as number;
    for (const observation of bucket) {
      const available = observation.available_time as number;
      if (available < from) from = available;
      if (available > to) to = available;
    }

    const construction = createRegimeClassification(
      {
        scope: { instrument, venue },
        label,
        netMoveRatio: stats.value.netMoveRatio,
        meanAbsChangeRatio: stats.value.meanAbsChangeRatio,
        window: { from: from as TimestampMs, to: to as TimestampMs },
        observationCount: bucket.length,
        evidence: deepFreeze(bucket.map(citationOf)),
        confidence: {
          methodId: confidenceMethod.methodId,
          methodVersion: confidenceMethod.version,
          level,
          evidenceCount: count,
          dispersion,
        },
        asOf: config.asOf,
        methodId: classification.methodId,
        methodVersion: classification.version,
        bodyVersion: config.bodyVersion,
        tenantId: config.tenantId,
        projectId: config.projectId,
        seed: config.seed,
      },
      registry,
    );
    if (!construction.ok) return construction;
    classifications.push(construction.value);
    instrumentsClassified.add(instrument);
  }

  // deterministic classification order: by (instrument, venue, window.from)
  classifications.sort((a, b) => {
    if (a.scope.instrument !== b.scope.instrument) return a.scope.instrument < b.scope.instrument ? -1 : 1;
    if (a.scope.venue !== b.scope.venue) return a.scope.venue < b.scope.venue ? -1 : 1;
    return (a.window.from as number) - (b.window.from as number);
  });
  return {
    ok: true,
    value: deepFreeze({
      classifications: deepFreeze(classifications),
      instrumentsSeen: deepFreeze([...instrumentsSeen].sort()),
      instrumentsClassified: deepFreeze([...instrumentsClassified].sort()),
    }),
  };
}

// ---------------------------------------------------------------------------
// The change-detection stage (declared consecutive-window transitions)
// ---------------------------------------------------------------------------

/** The change-detection stage's outputs. */
export interface RegimeChangeDetectionStage {
  readonly changes: readonly RegimeChange[];
}

/**
 * Detects structured regime transitions: consecutive windows of the same
 * (instrument, venue) scope whose labels differ (the declared basis).
 * The change's evidence is both windows' citations; the detection
 * instant is the instant the transition became knowable (the to-window's
 * close). Pure and deterministic.
 */
export function runRegimeChangeDetection(
  classifications: readonly RegimeClassification[],
  registry: RegimeMethodRegistry,
  config: RegimeRunConfig,
): RegimeResult<RegimeChangeDetectionStage> {
  const detection = findRegimeMethod(registry, 'method/regime/change-detection');
  if (detection === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'undeclared_method',
          path: 'changeDetection',
          message: 'the change-detection method is not declared in the body spec registry',
        },
      ],
    };
  }

  // group the classifications by scope, in window order
  const scopes = new Map<string, RegimeClassification[]>();
  for (const classification of classifications) {
    const key = `${classification.scope.instrument}|${classification.scope.venue}`;
    const bucket = scopes.get(key);
    if (bucket === undefined) scopes.set(key, [classification]);
    else bucket.push(classification);
  }
  for (const bucket of scopes.values()) {
    bucket.sort((a, b) => (a.window.from as number) - (b.window.from as number));
  }

  const changes: RegimeChange[] = [];
  for (const [, bucket] of scopes) {
    for (let index = 1; index < bucket.length; index++) {
      const from = bucket[index - 1] as RegimeClassification;
      const to = bucket[index] as RegimeClassification;
      if (from.label === to.label) continue; // not a transition
      const construction = createRegimeChange(
        {
          scope: from.scope,
          fromLabel: from.label,
          toLabel: to.label,
          fromWindow: from.window,
          toWindow: to.window,
          detectionInstant: to.window.to,
          evidence: deepFreeze([...from.evidence, ...to.evidence]),
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
      changes.push(construction.value);
    }
  }

  // deterministic change order: by (scope, fromWindow.from)
  changes.sort((a, b) => {
    if (a.scope.instrument !== b.scope.instrument) return a.scope.instrument < b.scope.instrument ? -1 : 1;
    if (a.scope.venue !== b.scope.venue) return a.scope.venue < b.scope.venue ? -1 : 1;
    return (a.fromWindow.from as number) - (b.fromWindow.from as number);
  });
  return { ok: true, value: deepFreeze({ changes: deepFreeze(changes) }) };
}

// ---------------------------------------------------------------------------
// The data-gap computation (enumerated kinds only)
// ---------------------------------------------------------------------------

/** Computes the declared data gaps from the stage outputs (enumerated). */
export function computeRegimeDataGaps(input: {
  readonly instrumentsSeen: readonly string[];
  readonly instrumentsClassified: readonly string[];
  readonly observationsAdmitted: number;
}): readonly RegimeDataGap[] {
  const gaps: RegimeDataGap[] = [];
  if (input.observationsAdmitted === 0) {
    gaps.push({ kind: 'no-market-observations', instrument: '' });
  }
  for (const instrument of input.instrumentsSeen) {
    if (!input.instrumentsClassified.includes(instrument)) {
      gaps.push({ kind: 'instrument-without-classification', instrument });
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
// The pipeline (one run of the declared regime-research-cycle procedure)
// ---------------------------------------------------------------------------

/**
 * Runs the full declared pipeline over the injected inputs and returns
 * the run outcome (the published report's id, the publication, the L4
 * accounting, the outputs). Pure and deterministic given (sources'
 * stream, config, body spec).
 */
export function runRegimePipeline(
  config: RegimeRunConfig,
  inputs: RegimePipelineInputs,
  bodySpec: RegimeResearcherBodySpec = REGIME_RESEARCHER_BODY,
): RegimeResult<RegimeRunOutcome> {
  // THE L8 GATE: the pipeline refuses to run a body spec that grants any
  // execution authority — the read-only declaration is existential.
  const bodyErrors = validateRegimeResearcherBody(bodySpec);
  if (bodyErrors.length > 0) {
    return { ok: false, errors: bodyErrors.map((e) => ({ ...e, path: `bodySpec.${e.path}` })) };
  }
  const configErrors = validateRegimeRunConfig(config);
  if (configErrors.length > 0) return { ok: false, errors: configErrors };
  const registry: RegimeMethodRegistry = bodySpec.research.methodRegistry;

  // stage 1: intake + the L4 gate
  const intake = runRegimeIntake(inputs.sources, config.asOf);
  if (!intake.ok) return intake;

  // stage 2: classify (over the admitted, canonically ordered set)
  const classification = runRegimeClassification(intake.value.admitted, registry, config);
  if (!classification.ok) return classification;

  // stage 3: detect changes (over the classifications)
  const detection = runRegimeChangeDetection(classification.value.classifications, registry, config);
  if (!detection.ok) return detection;

  // stage 4: compose (summary re-derivation happens inside the factory)
  const dataGaps = computeRegimeDataGaps({
    instrumentsSeen: classification.value.instrumentsSeen,
    instrumentsClassified: classification.value.instrumentsClassified,
    observationsAdmitted: intake.value.coverage.observationsAdmitted,
  });
  const composition = findRegimeMethod(registry, 'method/regime/report-composition');
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
  // the dominant-regime derivation needs the classification taxonomy —
  // resolve it from the registry's canonical classification method.
  const classificationMethod = findRegimeMethod(registry, 'method/regime/classification');
  const taxonomy: readonly string[] =
    classificationMethod !== null && classificationMethod.kind === 'regime-classification'
      ? (classificationMethod.parameters as RegimeClassificationParameters).regimes
      : [];
  const compositionParameters = composition.parameters as { readonly outputScale: number; readonly rounding: 'half-even' | 'truncate' };
  const summary = composeRegimeSummary({
    classifications: classification.value.classifications,
    changes: detection.value.changes,
    coverage: intake.value.coverage,
    dataGaps,
    taxonomy,
    outputScale: compositionParameters.outputScale,
    rounding: compositionParameters.rounding,
  });
  const report = createRegimeResearchReport(
    {
      asOf: config.asOf,
      bodyVersion: config.bodyVersion,
      methodId: composition.methodId,
      methodVersion: composition.version,
      tenantId: config.tenantId,
      projectId: config.projectId,
      seed: config.seed,
      classifications: classification.value.classifications,
      changes: detection.value.changes,
      summary,
    },
    registry,
  );
  if (!report.ok) return report;

  // stage 5: publish — ONLY through the injected envelope-mirror port
  const publication = buildRegimePublication({
    opId: config.opId,
    topic: config.topic,
    tenantId: config.tenantId,
    sender: config.sender,
    report: report.value,
    sequence: config.publicationSequence,
    publishedAt: config.publishedAt,
  });
  if (!publication.ok) return publication;
  const publicationErrors = validateRegimePublication(publication.value, registry);
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
      classifications: classification.value.classifications,
      changes: detection.value.changes,
      dataGaps,
    }),
  };
}

/** Canonical serialization of a run config (byte-deterministic, L9). */
export function serializeRegimeRunConfig(config: RegimeRunConfig): string {
  return canonicalJson(config as never);
}
