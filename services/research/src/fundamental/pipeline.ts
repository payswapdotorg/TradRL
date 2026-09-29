// @tradrl/research (service) — the fundamental research pipeline.
//
// Work Order T023, section 5 (the reference pipeline):
//   "fundamental — inject an equities/alt-data observation port (a
//    scripted fake in tests), run the declared procedures (intake -> L4
//    gate -> assess by declared methods -> digest corporate actions ->
//    compose assessments/reports), publish through an agent-os envelope
//    mirror port"
//
// The pipeline IS the body's declared `research-cycle` procedure, run as
// a pure protocol implementation: the cognitive substrate executes
// bodies at runtime (outside this package); here we prove the procedure
// is a deterministic, law-abiding computation.
//
// Laws held (each with its typed refusal):
//   - L8: the pipeline REFUSES to run a body spec that grants any
//     execution authority (validateFundamentalResearcherBody first).
//   - L4: the L4 gate defers — never consumes — observations whose
//     available_time exceeds the run's as-of instant.
//   - L9: every output is built through the contract factories (evidence
//     completeness and derived ids enforced there); the run state carries
//     a step-digest chain.
//   - L12: tenant/project flow from the run config into every record.
//   - Method honesty: the valuation/macro/health assessments, the
//     corporate-action digestion and the composition all read their
//     parameters from the declared method records — no implicit
//     constants.
//   - Publication discipline: outputs leave ONLY through the injected
//     envelope-mirror port, as a bound (envelope, report) pair.
//   - Determinism: same (observation set, as-of, body version, seed) ->
//     byte-identical outputs. Observation order is canonicalized; source
//     pull order cannot leak into output bytes.

import {
  type AgentInstanceId,
  type FundamentalError,
  type BodyVersionRef,
  type ConfidenceAssessment,
  type CoverageAccounting,
  type CorporateActionDigest,
  type FundamentalDataGap,
  type DeferredObservation,
  type FundamentalAssessment,
  type FundamentalDatumObservation,
  type FundamentalMethodRegistry,
  type FundamentalObservation,
  type FundamentalObservationSource,
  type MacroReleaseObservation,
  type CorporateActionObservation,
  type FundamentalPublication,
  type FundamentalPublicationPort,
  type FundamentalResult,
  type FundamentalResearcherBodySpec,
  type ProjectId,
  type StanceAssessment,
  type TenantId,
  type TimestampMs,
  type TopicName,
  type UnsupportedObservation,
  type ValuationAssessmentParameters,
  type MacroSurpriseAssessmentParameters,
  type HealthAssessmentParameters,
  FUNDAMENTAL_RESEARCHER_BODY,
  buildFundamentalPublication,
  canonicalJson,
  canonicalObservationOrder,
  classifyPulledRecord,
  compareDecimal,
  composeFundamentalSummary,
  createCorporateActionDigest,
  createFundamentalAssessment,
  createFundamentalResearchReport,
  decimalAbs,
  decimalDispersion,
  decimalMean,
  decimalRatio,
  decimalSub,
  deepFreeze,
  findFundamentalMethod,
  gateObservations,
  invalidField,
  isFundamentalObservationSource,
  isNonEmptyString,
  isTimestampMs,
  stableDigestJson,
  validateFundamentalPublication,
  validateFundamentalResearcherBody,
} from './imports';

// ---------------------------------------------------------------------------
// The run configuration (every instant explicit — no ambient clock)
// ---------------------------------------------------------------------------

/** The full configuration of one fundamental research run (the lineage binding). */
export interface FundamentalRunConfig {
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
export interface FundamentalPipelineInputs {
  readonly sources: readonly FundamentalObservationSource[];
  readonly publisher: FundamentalPublicationPort;
}

/** The full outcome of one fundamental research run. */
export interface FundamentalRunOutcome {
  readonly reportId: string;
  readonly publication: FundamentalPublication;
  readonly coverage: CoverageAccounting;
  readonly deferred: readonly DeferredObservation[];
  readonly unsupported: readonly UnsupportedObservation[];
  readonly assessments: readonly FundamentalAssessment[];
  readonly actionDigests: readonly CorporateActionDigest[];
  readonly dataGaps: readonly FundamentalDataGap[];
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/** COLLECT-ALL validation of a run config (typed, never throws). */
export function validateFundamentalRunConfig(config: unknown): readonly FundamentalError[] {
  const errors: FundamentalError[] = [];
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return [invalidField('config', 'must be a fundamental run config object')];
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

/** Derives the fundamental run id: `fundamental-run-<digest of the config>`. */
export function fundamentalRunId(config: FundamentalRunConfig): string {
  return `fundamental-run-${stableDigestJson(config as never)}`;
}

// ---------------------------------------------------------------------------
// The intake stage (pull -> classify -> gate -> account)
// ---------------------------------------------------------------------------

/** The intake snapshot: every offered observation is accounted for. */
export interface FundamentalIntakeSnapshot {
  readonly admitted: readonly FundamentalObservation[];
  readonly deferred: readonly DeferredObservation[];
  readonly unsupported: readonly UnsupportedObservation[];
  readonly coverage: CoverageAccounting;
}

/** Runs intake over the injected sources (pull until drained, classify, gate). */
export function runFundamentalIntake(
  sources: readonly FundamentalObservationSource[],
  asOf: TimestampMs,
): FundamentalResult<FundamentalIntakeSnapshot> {
  const errors: FundamentalError[] = [];
  for (const source of sources) {
    if (!isFundamentalObservationSource(source)) {
      errors.push(invalidField('sources', 'every source must be an injected observation port'));
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const pulled: FundamentalObservation[] = [];
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
// The assessment stage (declared methods; exact decimal arithmetic)
// ---------------------------------------------------------------------------

function citationOf(observation: FundamentalObservation): { observationId: string; availableTime: TimestampMs; provenance: never } {
  return deepFreeze({
    observationId: observation.event_id,
    availableTime: observation.available_time,
    provenance: observation.provenance,
  }) as never;
}

/** The confidence assessment from the declared evidence-count/range-ratio bands. */
function confidenceOf(
  registry: FundamentalMethodRegistry,
  evidenceCount: number,
  dispersion: string | null,
): ConfidenceAssessment {
  const confidence = findFundamentalMethod(registry, 'method/fundamental/confidence');
  if (confidence === null) throw new Error('the confidence method must be declared');
  const parameters = confidence.parameters as { kind: string; high: { minEvidence: number; maxDispersion: string }; moderate: { minEvidence: number; maxDispersion: string } };
  let level: ConfidenceAssessment['level'];
  if (
    evidenceCount >= parameters.high.minEvidence &&
    dispersion !== null &&
    compareDecimal(dispersion, parameters.high.maxDispersion) <= 0
  ) {
    level = 'high';
  } else if (
    evidenceCount >= parameters.moderate.minEvidence &&
    dispersion !== null &&
    compareDecimal(dispersion, parameters.moderate.maxDispersion) <= 0
  ) {
    level = 'moderate';
  } else {
    level = 'low';
  }
  return {
    methodId: confidence.methodId,
    methodVersion: confidence.version,
    level,
    evidenceCount,
    dispersion,
  };
}

/** The stance from the declared decision function. */
function stanceOf(
  methodId: StanceAssessment['methodId'],
  methodVersion: StanceAssessment['methodVersion'],
  score: string,
  thresholds: { readonly positive: string; readonly negative: string },
): StanceAssessment {
  let direction: StanceAssessment['direction'];
  if (compareDecimal(score, thresholds.positive) >= 0) direction = 'positive';
  else if (compareDecimal(score, thresholds.negative) <= 0) direction = 'negative';
  else direction = 'neutral';
  return { methodId, methodVersion, direction, score };
}

/**
 * THE ASSESSMENT STAGE: assesses every declared series by its declared
 * method — reported index levels against their trailing baselines
 * (valuation), economic releases against their consensus forecasts
 * (macro surprise), and declared health series against their window
 * trend. Every threshold, window and field comes from the declared
 * method records; the confidence bands are declared; unassessed series
 * become structured data gaps. Deterministic: series are processed in
 * canonical (instrument, field) order.
 */
export function runFundamentalAssessment(
  observations: readonly FundamentalObservation[],
  registry: FundamentalMethodRegistry,
  config: FundamentalRunConfig,
): FundamentalResult<{
  readonly assessments: readonly FundamentalAssessment[];
  readonly dataGaps: readonly FundamentalDataGap[];
  readonly assessedScopes: ReadonlySet<string>;
}> {
  const valuation = findFundamentalMethod(registry, 'method/fundamental/valuation');
  const macro = findFundamentalMethod(registry, 'method/fundamental/macro-surprise');
  const health = findFundamentalMethod(registry, 'method/fundamental/health');
  if (valuation === null || macro === null || health === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'undeclared_method',
          path: 'assessment',
          message: 'the valuation/macro-surprise/health methods are not declared in the body spec registry — a fundamental assessment without a declared method is a magic number',
        },
      ],
    };
  }
  const valuationParameters = valuation.parameters as ValuationAssessmentParameters;
  const macroParameters = macro.parameters as MacroSurpriseAssessmentParameters;
  const healthParameters = health.parameters as HealthAssessmentParameters;

  // group by (instrument, series) in canonical order
  const groups = new Map<string, FundamentalObservation[]>();
  for (const observation of canonicalObservationOrder(observations)) {
    if (observation.event_type === 'fundamental') {
      const datum = observation as FundamentalDatumObservation;
      const key = `${datum.instrument}|${datum.payload.field}`;
      const bucket = groups.get(key);
      if (bucket === undefined) groups.set(key, [datum]);
      else bucket.push(datum);
    } else if (observation.event_type === 'macro_release') {
      const release = observation as MacroReleaseObservation;
      const key = `${release.instrument}|${release.payload.indicator}`;
      const bucket = groups.get(key);
      if (bucket === undefined) groups.set(key, [release]);
      else bucket.push(release);
    }
  }

  const assessments: FundamentalAssessment[] = [];
  const gaps: FundamentalDataGap[] = [];
  const assessedScopes = new Set<string>();
  const sortedKeys = [...groups.keys()].sort();

  for (const key of sortedKeys) {
    const bucket = groups.get(key) as readonly FundamentalObservation[];
    const [instrument, series] = key.split('|') as [string, string];
    const first = bucket[0] as FundamentalObservation;
    const scale = first.event_type === 'macro_release' ? macroParameters.outputScale : valuationParameters.outputScale;
    const rounding = first.event_type === 'macro_release' ? macroParameters.rounding : valuationParameters.rounding;
    const values = bucket.map((observation) =>
      observation.event_type === 'fundamental'
        ? (observation as FundamentalDatumObservation).payload.value
        : (observation as MacroReleaseObservation).payload.actual,
    );

    let construction: FundamentalResult<FundamentalAssessment> | null = null;

    if (first.event_type === 'fundamental' && series === valuationParameters.seriesField && bucket.length > valuationParameters.trailingPeriods) {
      // VALUATION: the latest reported level over the trailing mean of the
      // prior trailingPeriods levels, minus one.
      const latest = values[values.length - 1] as string;
      const trailing = values.slice(values.length - 1 - valuationParameters.trailingPeriods, values.length - 1);
      const baseline = decimalMean(trailing, scale, rounding);
      const score = decimalSub(decimalRatio(latest, baseline, scale, rounding), '1', scale, rounding);
      construction = createFundamentalAssessment(
        {
          scope: { instrument, series },
          assessmentKind: 'valuation-level',
          stance: stanceOf(valuation.methodId, valuation.version, score, valuationParameters.polarityThresholds),
          confidence: confidenceOf(registry, bucket.length, rangeRatioOf(values, scale, rounding)),
          evidence: deepFreeze(bucket.map(citationOf)),
          asOf: config.asOf,
          bodyVersion: config.bodyVersion,
          tenantId: config.tenantId,
          projectId: config.projectId,
          seed: config.seed,
        },
        registry,
      );
    } else if (first.event_type === 'macro_release') {
      // MACRO SURPRISE: the mean over releases that carry a forecast of
      // (actual - forecast) / forecast; forecast-less releases are skipped
      // (an unassessed series is a data gap, never a fabricated zero).
      const ratios: string[] = [];
      const assessed: FundamentalObservation[] = [];
      for (const observation of bucket) {
        const release = observation as MacroReleaseObservation;
        if (release.payload.forecast === undefined) continue;
        ratios.push(decimalSub(decimalRatio(release.payload.actual, release.payload.forecast, scale, rounding), '1', scale, rounding));
        assessed.push(release);
      }
      if (ratios.length > 0) {
        const score = decimalMean(ratios, scale, rounding);
        construction = createFundamentalAssessment(
          {
            scope: { instrument, series },
            assessmentKind: 'macro-surprise',
            stance: stanceOf(macro.methodId, macro.version, score, macroParameters.polarityThresholds),
            confidence: confidenceOf(registry, assessed.length, rangeRatioOf(assessed.map((o) => (o as MacroReleaseObservation).payload.actual), scale, rounding)),
            evidence: deepFreeze(assessed.map(citationOf)),
            asOf: config.asOf,
            bodyVersion: config.bodyVersion,
            tenantId: config.tenantId,
            projectId: config.projectId,
            seed: config.seed,
          },
          registry,
        );
      }
    } else if (first.event_type === 'fundamental' && (healthParameters.healthFields as readonly string[]).includes(series) && bucket.length >= 2) {
      // HEALTH: the net-change ratio of the series over the observation
      // window (last over first, minus one) — the series' own trend.
      const firstValue = values[0] as string;
      const lastValue = values[values.length - 1] as string;
      const score = decimalSub(decimalRatio(lastValue, firstValue, scale, rounding), '1', scale, rounding);
      construction = createFundamentalAssessment(
        {
          scope: { instrument, series },
          assessmentKind: 'health-indicator',
          stance: stanceOf(health.methodId, health.version, score, healthParameters.polarityThresholds),
          confidence: confidenceOf(registry, bucket.length, rangeRatioOf(values, scale, rounding)),
          evidence: deepFreeze(bucket.map(citationOf)),
          asOf: config.asOf,
          bodyVersion: config.bodyVersion,
          tenantId: config.tenantId,
          projectId: config.projectId,
          seed: config.seed,
        },
        registry,
      );
    }

    if (construction !== null) {
      if (!construction.ok) return construction;
      assessments.push(construction.value);
      assessedScopes.add(key);
    } else {
      gaps.push({ kind: 'unassessed-series', instrument, series });
    }
  }

  // scope-wide gaps
  const fundamentalObserved = observations.some((o) => o.event_type === 'fundamental');
  const macroObserved = observations.some((o) => o.event_type === 'macro_release');
  const actionObserved = observations.some((o) => o.event_type === 'other');
  if (!fundamentalObserved) gaps.push({ kind: 'no-fundamental-observations', instrument: '', series: '' });
  if (!macroObserved) gaps.push({ kind: 'no-macro-observations', instrument: '', series: '' });
  if (!actionObserved) gaps.push({ kind: 'no-corporate-action-observations', instrument: '', series: '' });

  // canonical gap order: (kind, instrument, series)
  gaps.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.instrument !== b.instrument) return a.instrument < b.instrument ? -1 : 1;
    return a.series === b.series ? 0 : a.series < b.series ? -1 : 1;
  });

  return {
    ok: true,
    value: deepFreeze({
      assessments: deepFreeze(assessments.sort((a, b) =>
        a.scope.instrument === b.scope.instrument
          ? a.scope.series < b.scope.series ? -1 : 1
          : a.scope.instrument < b.scope.instrument ? -1 : 1,
      )),
      dataGaps: deepFreeze(gaps),
      assessedScopes,
    }),
  };
}

/** The scale-free range ratio (max - min)/max of the assessed values; null below two. */
function rangeRatioOf(values: readonly string[], scale: number, rounding: 'half-even' | 'truncate'): string | null {
  if (values.length < 2) return null;
  let min = values[0] as string;
  let max = min;
  for (const value of values.slice(1)) {
    if (compareDecimal(value, min) < 0) min = value;
    if (compareDecimal(value, max) > 0) max = value;
  }
  const range = decimalSub(max, min, scale, rounding);
  if (compareDecimal(range, '0') === 0) return '0';
  return decimalRatio(range, max, scale, rounding);
}

// ---------------------------------------------------------------------------
// The corporate-action digestion stage (declared window; knowledge-time
// clustering; the declared implication table)
// ---------------------------------------------------------------------------

/**
 * Clusters corporate-action observations into digests. Clustering is by
 * (epoch-aligned window index of available_time, instrument, action
//  kind) — pure and deterministic; the implication stance comes from the
//  method's declared action table.
 */
export function runCorporateActionDigestion(
  observations: readonly FundamentalObservation[],
  registry: FundamentalMethodRegistry,
  config: FundamentalRunConfig,
): FundamentalResult<readonly CorporateActionDigest[]> {
  const digestion = findFundamentalMethod(registry, 'method/fundamental/corporate-action');
  if (digestion === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'undeclared_method',
          path: 'corporateActionDigestion',
          message: 'the corporate-action method is not declared in the body spec registry',
        },
      ],
    } as never;
  }
  const parameters = digestion.parameters as {
    readonly windowMs: number;
    readonly minObservations: number;
    readonly implications: readonly { readonly action: string; readonly implication: string }[];
  };

  const clusters = new Map<string, CorporateActionObservation[]>();
  for (const observation of observations) {
    if (observation.event_type !== 'other') continue;
    const action = observation as CorporateActionObservation;
    const windowIndex = Math.floor((action.available_time as number) / parameters.windowMs);
    const key = `${windowIndex}|${action.instrument}|${action.payload.data.action}`;
    const bucket = clusters.get(key);
    if (bucket === undefined) clusters.set(key, [action]);
    else bucket.push(action);
  }

  const digests: CorporateActionDigest[] = [];
  for (const [, cluster] of clusters) {
    if (cluster.length < parameters.minObservations) continue;
    const ordered = canonicalObservationOrder(cluster);
    const first = ordered[0] as CorporateActionObservation;
    const action = first.payload.data.action;
    const entry = parameters.implications.find((candidate) => candidate.action === action);
    if (entry === undefined) continue; // an action outside the declared table is not digested
    const instruments = new Set<string>();
    const venues = new Set<string>();
    let from = ordered[0]!.available_time as number;
    let to = ordered[0]!.available_time as number;
    for (const observation of ordered) {
      instruments.add(observation.instrument);
      venues.add(observation.venue);
      const available = observation.available_time as number;
      if (available < from) from = available;
      if (available > to) to = available;
    }
    const construction = createCorporateActionDigest(
      {
        action: action as never,
        instruments: [...instruments].sort(),
        venues: [...venues].sort(),
        window: { from: from as TimestampMs, to: to as TimestampMs },
        observationCount: ordered.length,
        implication: entry.implication as never,
        evidence: deepFreeze(ordered.map(citationOf)),
        asOf: config.asOf,
        methodId: digestion.methodId,
        methodVersion: digestion.version,
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
  return { ok: true, value: deepFreeze(digests) };
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
export function runFundamentalPipeline(
  config: FundamentalRunConfig,
  inputs: FundamentalPipelineInputs,
  bodySpec: FundamentalResearcherBodySpec = FUNDAMENTAL_RESEARCHER_BODY,
): FundamentalResult<FundamentalRunOutcome> {
  // THE L8 GATE: the pipeline refuses to run a body spec that grants any
  // execution authority — the read-only declaration is existential.
  const bodyErrors = validateFundamentalResearcherBody(bodySpec);
  if (bodyErrors.length > 0) {
    return { ok: false, errors: bodyErrors.map((e) => ({ ...e, path: `bodySpec.${e.path}` })) };
  }
  const configErrors = validateFundamentalRunConfig(config);
  if (configErrors.length > 0) return { ok: false, errors: configErrors };
  const registry: FundamentalMethodRegistry = bodySpec.research.methodRegistry;

  // stage 1: intake + the L4 gate
  const intake = runFundamentalIntake(inputs.sources, config.asOf);
  if (!intake.ok) return intake;

  // stages 2-3: assess + digest (over the admitted, canonically ordered set)
  const assessment = runFundamentalAssessment(intake.value.admitted, registry, config);
  if (!assessment.ok) return assessment;
  const digestion = runCorporateActionDigestion(intake.value.admitted, registry, config);
  if (!digestion.ok) return digestion;

  // stage 4: compose (summary re-derivation happens inside the factory)
  const dataGaps = assessment.value.dataGaps;
  const summary = composeFundamentalSummary({
    assessments: assessment.value.assessments,
    actionDigests: digestion.value,
    coverage: intake.value.coverage,
    dataGaps,
  });
  const composition = findFundamentalMethod(registry, 'method/fundamental/report-composition');
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
    } as never;
  }
  const report = createFundamentalResearchReport(
    {
      asOf: config.asOf,
      bodyVersion: config.bodyVersion,
      methodId: composition.methodId,
      methodVersion: composition.version,
      tenantId: config.tenantId,
      projectId: config.projectId,
      seed: config.seed,
      assessments: assessment.value.assessments,
      actionDigests: digestion.value,
      summary,
    },
    registry,
  );
  if (!report.ok) return report;

  // stage 5: publish — ONLY through the injected envelope-mirror port
  const publication = buildFundamentalPublication({
    opId: config.opId,
    topic: config.topic,
    tenantId: config.tenantId,
    sender: config.sender,
    report: report.value,
    sequence: config.publicationSequence,
    publishedAt: config.publishedAt,
  });
  if (!publication.ok) return publication;
  const publicationErrors = validateFundamentalPublication(publication.value, registry);
  if (publicationErrors.length > 0) return { ok: false, errors: publicationErrors };
  const receipt = inputs.publisher.publish(publication.value);
  if (!receipt.ok) return receipt as never;

  return {
    ok: true,
    value: deepFreeze({
      reportId: report.value.reportId,
      publication: publication.value,
      coverage: intake.value.coverage,
      deferred: intake.value.deferred,
      unsupported: intake.value.unsupported,
      assessments: assessment.value.assessments,
      actionDigests: digestion.value,
      dataGaps,
    }),
  };
}

/** Canonical serialization of a run config (byte-deterministic, L9). */
export function serializeFundamentalRunConfig(config: FundamentalRunConfig): string {
  return canonicalJson(config as never);
}
