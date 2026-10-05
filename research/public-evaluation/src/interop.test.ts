/**
 * T049 — the interop trip-wires (benchmarks/README.md's core claim): the
 * REAL merged lanes imported HERE, in tests, to prove every structural
 * mirror the machinery carries (D-003/D-004: `src/` imports nothing
 * outside its own package — the REAL packages are imported by THIS file
 * only; drift between a mirror and its owner fails this suite loudly).
 *
 * The proven lanes:
 * 1. THE REAL T048 REFERENCE SLICE (examples/end-to-end-trading): the
 *    REAL `runReferenceSlice()` report verifies under the SliceReport
 *    mirror, every measurable of the closed vocabulary extracts with the
 *    agreeing kind, and the PLATFORM SELF-BENCHMARK measures the REAL
 *    report end-to-end (the decimal axes at the REAL report's own exact
 *    scales — 0 and 3; the digest axes pin the REAL report's own
 *    8-hex anchors).
 * 2. THE REAL T032 SPLIT DRIVER (packages/evaluation-splits): a REAL
 *    `materializeSplitPlan` plan verifies through the mirrored verifier
 *    with the IDENTICAL `splan:` id (byte parity of the content
 *    addressing), and the mirrored leakage law fires on a REAL-plan
 *    tamper.
 * 3. THE REAL T031 SEARCH RECORD (packages/search-lineage): a REAL
 *    record grown through `createSearchRecord` + `appendSearchTrial`
 *    verifies through the mirrored chain law byte-for-byte, and the
 *    mirrored chain catches a REAL-record tamper.
 * 4. THE COMPOSITION LAW (T031+T032+T048 through T049): a HOLDOUT
 *    measurement binding the REAL split plan + the REAL search record +
 *    the REAL T048 report — reserved unseen material, a verified search,
 *    coherent evidence — compiles, verifies, publishes and RE-VERIFIES
 *    to the same bytes (the publication layer's determinism law over
 *    REAL inputs).
 * 5. THE REAL T045 EXCHANGE (packages/capability-provider): the REAL
 *    exchange folds THIS lane's discharge outcomes — a benchmark
 *    requirement naming the platform suite discharges from the REAL
 *    measurement, the REAL `verifyDeliverable` folds the verdict, and
 *    the unattained leg rejects (retained).
 * 6. THE REAL T035 IMPROVEMENT LOOP (services/autonomous-learning): the
 *    adoption-gate vocabulary agrees (the three refusal reasons), and
 *    the REAL gate and THIS lane's measured-evidence gate render the
 *    same verdicts over the same REAL search record.
 * 7. THE REAL T028 GENERATIVE LANE (services/market-world/generative):
 *    the process-kind vocabulary agrees exactly.
 * 8. THE REAL T017 SKILLS LANE (packages/skills): the structured-metric
 *    vocabulary agrees exactly (L16a).
 * 9. THE REAL T012 EVALUATION LANE (packages/evaluation): the dataset
 *    axis mirror — mutual guard parity over the REAL-validated axis.
 * 10. THE REAL T032 RESEARCH LANE (research/benchmarks): the material
 *     source derivations (`rsrc:` / `gsrc:` / `lsrc:`) agree
 *     byte-for-byte, and the REAL-validated sources pass the mirror
 *     guards.
 * 11. THE DECIMALS DIVERGENCE RECORD: the three REAL owners' shared
 *     `compareMagnitude` miscompares across integer digit counts (the
 *     latent defect the machinery's corrected mirror documents — see
 *     benchmarks/platform/src/decimals.ts). This pin records the defect
 *     EXACTLY: when the Lead fixes the owners, this leg flips RED and
 *     the mirror's divergence record updates with it.
 */

import { beforeAll, describe, expect, it } from 'vitest';

// --- the REAL merged lanes (test-only imports — the D-003/D-004 pattern) ----
import { runReferenceSlice } from '../../../examples/end-to-end-trading/src/index';
import type { SliceReport } from '../../../examples/end-to-end-trading/src/index';
import {
  compareDecimals as splitsCompareDecimals,
  materializeSplitPlan,
  splitPlanId as realSplitPlanId,
} from '../../../packages/evaluation-splits/src/index';
import {
  appendSearchTrial,
  createSearchRecord,
  verifySearchRecord as verifyRealSearchRecord,
} from '../../../packages/search-lineage/src/index';
import type { ExperimentId as RealExperimentId } from '../../../packages/search-lineage/src/index';
import * as capabilityProvider from '../../../packages/capability-provider/src/index';
import {
  FIXTURE_EVIDENCE_REF,
  FIXTURE_GAP_ID,
  FIXTURE_PROJECT,
  FIXTURE_TENANT,
  T0 as CP_T0,
  validDeclarationDraft,
  validDeliverableDraft,
  validQuoteDraft,
} from '../../../packages/capability-provider/src/fixtures';
import type { CapabilityRequestDraft, VerificationOutcome as RealVerificationOutcome } from '../../../packages/capability-provider/src/index';
import {
  evaluateAdoptionGate as realEvaluateAdoptionGate,
  isCommissionRefusalReason as realIsCommissionRefusalReason,
} from '../../../services/autonomous-learning/src/index';
import { PROCESS_KINDS as realProcessKinds } from '../../../services/market-world/src/generative/index';
import { MEASUREMENT_METRICS as realMeasurementMetrics } from '../../../packages/skills/src/index';
import {
  isDatasetAxis as realIsDatasetAxis,
  validateDatasetAxis as realValidateDatasetAxis,
} from '../../../packages/evaluation/src/index';
import * as researchBenchmarks from '../../../research/benchmarks/src/index';
import { compareDecimals as integrityCompareDecimals } from '../../../research/evaluation-integrity/src/index';

// --- this Work Order's own lanes (the machinery + the publication layer) ----
import {
  COMMISSION_REFUSAL_REASONS,
  DAY,
  MEASUREMENT_METRICS_MIRROR,
  PROCESS_KINDS_MIRROR,
  SLICE_MEASURABLES,
  T0,
  TENANT,
  PROJECT,
  at,
  compareDecimals as mirrorCompareDecimals,
  computeChainHeadMirror,
  decimalScale,
  dischargeBenchmarkRequirements,
  evaluateAdoptionGate,
  extractSliceMeasurable,
  fixtureSubject,
  generativeSourceId,
  isDatasetAxis,
  isLiveSessionSource,
  isReplayDataSource,
  isRegimePopulationSource,
  isSliceReportMirror,
  liveSourceId,
  replaySourceId,
  runSuiteMeasurement,
  searchRecordIdMirror,
  slicePipelineViolations,
  splitPlanIdMirror,
  subjectForEvidence,
  suiteId,
  verifyMeasurementRecord,
  verifySearchRecordLineage,
  verifySplitPlanMirror,
} from '../../../benchmarks/platform/src/index';
import type {
  EvaluatorVersionRef,
  JsonObject,
  MaterialSource,
  MeasurementRecord,
  ReplayDataSource,
  SearchRecordMirror,
  SliceReportMirror,
  SplitPlanMirror,
  SuiteAxis,
  SuiteDefinition,
} from '../../../benchmarks/platform/src/index';
import { compilePublishedRecord, reverifyPublishedRecord } from './index';
import type { PublicationPolicy } from './index';

// ---------------------------------------------------------------------------
// The REAL T048 report (run once; deterministic — the same bytes every run)
// ---------------------------------------------------------------------------

let realReport: SliceReport;

beforeAll(async () => {
  realReport = await runReferenceSlice();
});

// ---------------------------------------------------------------------------
// The interop axis + the REAL plan (T032's driver materializes it)
// ---------------------------------------------------------------------------

/** Nine consecutive daily segments (the same day-count as the machinery fixture axis). */
function interopAxisJson(): Record<string, unknown> {
  const segments: Record<string, unknown>[] = [];
  for (let index = 0; index < 9; index++) {
    const start = T0 + index * DAY;
    segments.push({ ref: `dataset-interop-${index}`, start, end: start + DAY, regime: ['trend', 'range', 'crisis'][index % 3] });
  }
  return { segments };
}

/** The interop driver policy: an anchored ladder over the first seven segments + a trailing two-segment holdout. */
const INTEROP_POLICY = {
  policy_ref: 'split-policy://interop-t049-v1',
  window: 'anchored',
  min_train_segments: 3,
  step_segments: 1,
  train_span_segments: null,
  gap_ms: '0',
  embargo_ms: '0',
  regime_filter: null,
  holdout: { mode: 'trailing-count', count: 2 },
} as const;

function realPlan(): SplitPlanMirror {
  const materialized = materializeSplitPlan(interopAxisJson(), INTEROP_POLICY);
  expect(materialized.ok).toBe(true);
  if (!materialized.ok) throw new Error(materialized.errors.map((error) => error.message).join('; '));
  return materialized.value as unknown as SplitPlanMirror;
}

// ---------------------------------------------------------------------------
// The REAL search record (T031's own API grows it)
// ---------------------------------------------------------------------------

const INTEROP_EXPERIMENT = 'experiment-interop-t049' as RealExperimentId;

function realSearchRecord(): SearchRecordMirror {
  const opened = createSearchRecord({ experiment: INTEROP_EXPERIMENT, evaluator: 'evaluator://benchmark-platform/v1', tenant: TENANT, project: PROJECT });
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error(opened.errors.map((error) => error.message).join('; '));
  const withInSearch = appendSearchTrial(opened.value, {
    trial: 'trial-interop-search-0001',
    arm: 'arm-interop-a',
    classification: 'in-search',
    config: { candidate: 'interop', seed: 7 },
    parents: [],
    splits: ['split-policy://interop-t049-v1'],
    datasets: ['dataset-interop-0', 'dataset-interop-1', 'dataset-interop-2'],
    window: { start: at(T0), end: at(T0 + 3 * DAY) },
    evaluation_policy: 'split-policy://interop-t049-v1',
    recorded_at: at(T0 + 10_000),
    tenant: TENANT,
    project: PROJECT,
  });
  expect(withInSearch.ok).toBe(true);
  if (!withInSearch.ok) throw new Error(withInSearch.errors.map((error) => error.message).join('; '));
  const withHoldout = appendSearchTrial(withInSearch.value, {
    trial: 'trial-interop-holdout-0001',
    arm: null,
    classification: 'holdout',
    config: { policy: 'trailing-holdout', embargo: '0' },
    parents: [],
    splits: ['split-policy://interop-holdout-eval-v1'],
    datasets: ['dataset-interop-7', 'dataset-interop-8'],
    window: { start: at(T0 + 7 * DAY), end: at(T0 + 9 * DAY) },
    evaluation_policy: 'split-policy://interop-holdout-eval-v1',
    recorded_at: at(T0 + 20_000),
    tenant: TENANT,
    project: PROJECT,
  });
  expect(withHoldout.ok).toBe(true);
  if (!withHoldout.ok) throw new Error(withHoldout.errors.map((error) => error.message).join('; '));
  return withHoldout.value as unknown as SearchRecordMirror;
}

// ---------------------------------------------------------------------------
// The material sources over the interop axis windows
// ---------------------------------------------------------------------------

/** The in-search material: the axis's search window (never the reserved tail). */
function interopSearchSource(): ReplayDataSource {
  const content = {
    kind: 'replay-dataset' as const,
    origin: 'historical' as const,
    stream_refs: ['stream://interop-search-0001'],
    config_digest: '5f3a1c0d9e2b47a8',
    coverage: { start: at(T0), end: at(T0 + 6 * DAY) },
  };
  return { source_id: replaySourceId(content), ...content };
}

/** The holdout material: exactly the plan's reserved unseen tail. */
function interopHoldoutSource(): ReplayDataSource {
  const content = {
    kind: 'replay-dataset' as const,
    origin: 'historical' as const,
    stream_refs: ['stream://interop-holdout-0001'],
    config_digest: '9a1f5d3c8e7b2406',
    coverage: { start: at(T0 + 7 * DAY), end: at(T0 + 9 * DAY) },
  };
  return { source_id: replaySourceId(content), ...content };
}

// ---------------------------------------------------------------------------
// The platform self-benchmark suite over the REAL report
// ---------------------------------------------------------------------------

/** The REAL report's own decimal scales (T048's slice.test pins cash '54905.491', realizedPnl '0'). */
function realBookScales(): { readonly pnl: number; readonly cash: number } {
  return {
    pnl: decimalScale(realReport.outcomes.book.realizedPnl), // 0
    cash: decimalScale(realReport.outcomes.book.cash), // 3
  };
}

/** The platform self-benchmark suite over the REAL report: the fixture's 20 axes with the decimal scales the REAL book carries. */
function realReportSuite(strict = false): SuiteDefinition {
  const scales = realBookScales();
  const axes: readonly SuiteAxis[] = [
    { axis: 'crypto-events', measurable: 'marketData.binanceEvents', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'news-events', measurable: 'marketData.newsEvents', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'frames', measurable: 'marketData.framesSent', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'lanes-consumed', measurable: 'director.lanesConsumed', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'intents', measurable: 'strategy.intents', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'step2-intents', measurable: 'strategy.step2Intents', kind: 'count', scale: null, attainment: { min: 0 } },
    { axis: 'routed', measurable: 'gateway.routed', kind: 'count', scale: null, attainment: strict ? { min: 99 } : { min: 0 } },
    { axis: 'refusals', measurable: 'gateway.refused', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'audit-records', measurable: 'gateway.auditRecords', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'world-fills', measurable: 'shadow.worldFillCount', kind: 'count', scale: null, attainment: { min: 0 } },
    { axis: 'outcome-records', measurable: 'outcomes.outcomes', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'realized-pnl', measurable: 'outcomes.realizedPnl', kind: 'decimal', scale: scales.pnl, attainment: {} },
    { axis: 'cash', measurable: 'outcomes.cash', kind: 'decimal', scale: scales.cash, attainment: {} },
    { axis: 'report-digest', measurable: 'report.digest', kind: 'digest', scale: null, attainment: {} },
    { axis: 'outcome-digest', measurable: 'outcomes.outcomeDigest', kind: 'digest', scale: null, attainment: {} },
    { axis: 'audit-coherent', measurable: 'gateway.auditCoherent', kind: 'flag', scale: null, attainment: { equals: true } },
    { axis: 'refusals-cost-zero', measurable: 'gateway.refusalsCostZero', kind: 'flag', scale: null, attainment: { equals: true } },
    { axis: 'paper-goals-bound', measurable: 'lineage.paperOutcomeGoalsBound', kind: 'flag', scale: null, attainment: { equals: true } },
    { axis: 'live-goals-bound', measurable: 'lineage.liveAuditGoalsBound', kind: 'flag', scale: null, attainment: { equals: true } },
    { axis: 'clocks-separated', measurable: 'lineage.orderClocksSeparated', kind: 'flag', scale: null, attainment: { equals: true } },
  ];
  const content = {
    name: 'reference-slice-platform-v1',
    subject_kind: 'reference-slice' as const,
    evidence_class: 'simulation' as const,
    evaluator: 'evaluator://benchmark-platform/v1' as EvaluatorVersionRef,
    axes,
    tenant: TENANT,
    project: PROJECT,
  };
  return { suite_id: suiteId(content), ...content };
}

/** The composition measurements over the REAL plan + record + report. */
function realInSearchMeasurement(): MeasurementRecord {
  const result = runSuiteMeasurement({
    suite: realReportSuite(),
    subject: subjectForEvidence(realReport as unknown as JsonObject),
    evidence: realReport as unknown as SliceReportMirror,
    material: interopSearchSource() as MaterialSource,
    phase: 'in-search',
    search: { record: realSearchRecord(), trial: 'trial-interop-search-0001' },
    plan: realPlan(),
    measured_at: at(T0 + 30_000),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  return result.value;
}

function realHoldoutMeasurement(): MeasurementRecord {
  const result = runSuiteMeasurement({
    suite: realReportSuite(),
    subject: subjectForEvidence(realReport as unknown as JsonObject),
    evidence: realReport as unknown as SliceReportMirror,
    material: interopHoldoutSource() as MaterialSource,
    phase: 'holdout',
    search: { record: realSearchRecord(), trial: 'trial-interop-holdout-0001' },
    plan: realPlan(),
    measured_at: at(T0 + 40_000),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  return result.value;
}

/** The minimal interop publication policy (the headline public axes). */
function interopPolicy(): PublicationPolicy {
  return { publicAxes: ['crypto-events', 'routed', 'refusals', 'audit-coherent'] };
}

// ---------------------------------------------------------------------------
// 1. The REAL T048 reference slice
// ---------------------------------------------------------------------------

describe('T049 interop — the REAL T048 reference slice (examples/end-to-end-trading)', () => {
  it('the REAL runReferenceSlice() report verifies under the SliceReport mirror field-for-field', () => {
    expect(isSliceReportMirror(realReport)).toBe(true);
    expect(slicePipelineViolations(realReport as unknown as SliceReportMirror)).toHaveLength(0);
  });

  it('every measurable of the closed vocabulary extracts from the REAL report with the agreeing kind', () => {
    for (const measurable of SLICE_MEASURABLES) {
      const extracted = extractSliceMeasurable(realReport as unknown as SliceReportMirror, measurable.path);
      expect(extracted, `measurable ${measurable.path} must extract from the REAL report`).toBeDefined();
      if (extracted !== undefined) {
        expect(extracted.kind, `measurable ${measurable.path}`).toBe(measurable.kind);
      }
    }
  });

  it('THE PLATFORM SELF-BENCHMARK: the machinery measures the REAL report end-to-end (the REAL book scales, the REAL 8-hex anchors)', () => {
    const measurement = realInSearchMeasurement();
    expect(measurement.attained).toBe(true); // the REAL reference slice clears the platform's own suite
    expect(measurement.subject.artifacts[0]?.digest).toBe(subjectForEvidence(realReport as unknown as JsonObject).artifacts[0]?.digest);
    const reportDigestAxis = measurement.axes.find((axis) => axis.axis === 'report-digest');
    expect(reportDigestAxis?.value).toBe(realReport.reportDigest); // T048's own single-lane anchor, verbatim
    const outcomeDigestAxis = measurement.axes.find((axis) => axis.axis === 'outcome-digest');
    expect(outcomeDigestAxis?.value).toBe(realReport.outcomes.outcomeDigest);
    // The decimal axes carry the REAL book values verbatim, at the REAL report's own exact scales (0 and 3).
    const scales = realBookScales();
    expect(scales.pnl).toBe(0);
    expect(scales.cash).toBe(3);
    const pnlAxis = measurement.axes.find((axis) => axis.axis === 'realized-pnl');
    expect(pnlAxis?.kind).toBe('decimal');
    expect(pnlAxis?.value).toBe(realReport.outcomes.book.realizedPnl);
    const cashAxis = measurement.axes.find((axis) => axis.axis === 'cash');
    expect(cashAxis?.value).toBe(realReport.outcomes.book.cash);
    expect(verifyMeasurementRecord(measurement).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. The REAL T032 split driver
// ---------------------------------------------------------------------------

describe('T049 interop — the REAL T032 split driver (packages/evaluation-splits)', () => {
  it('a REAL materialized plan verifies through the mirrored verifier with the IDENTICAL splan: id', () => {
    const plan = realPlan();
    const verified = verifySplitPlanMirror(plan);
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error(verified.errors.map((error) => error.message).join('; '));
    expect(verified.value.plan_id).toBe(plan.plan_id);
    // Byte parity of the content addressing: the mirror derives the owner's id over the owner's own plan.
    const { plan_id: drop, ...content } = plan;
    void drop;
    expect(splitPlanIdMirror(content as Omit<SplitPlanMirror, 'plan_id'>)).toBe(plan.plan_id);
    expect(realSplitPlanId(content as never)).toBe(plan.plan_id);
    // The reserved tail is exactly the interop axis's last two segments.
    expect(plan.holdout?.segments.map((segment) => segment.ref)).toEqual(['dataset-interop-7', 'dataset-interop-8']);
  });

  it('the mirrored leakage law fires on a REAL-plan tamper (holdout ref into a window test)', () => {
    const plan = structuredClone(realPlan()) as unknown as Record<string, unknown>;
    const windows = plan.windows as Record<string, unknown>[];
    const holdout = plan.holdout as { segments: { ref: string }[] };
    const test = windows[0]!.test as Record<string, unknown>;
    test.ref = holdout.segments[0]!.ref;
    const verified = verifySplitPlanMirror(plan);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0]?.code).toBe('holdout_in_search');
  });
});

// ---------------------------------------------------------------------------
// 3. The REAL T031 search record
// ---------------------------------------------------------------------------

describe('T049 interop — the REAL T031 search record (packages/search-lineage)', () => {
  it('a REAL grown record verifies through the mirrored chain law byte-for-byte', () => {
    const record = realSearchRecord();
    const verified = verifySearchRecordLineage(record);
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error(verified.errors.map((error) => error.message).join('; '));
    expect(verified.value.chain_head).toBe(record.chain_head);
    // The mirrored identity + chain derivations agree with the owner's own over the REAL record.
    const binding = { experiment: record.experiment, evaluator: record.evaluator, tenant: record.tenant, project: record.project };
    expect(searchRecordIdMirror(binding)).toBe(record.search_id);
    expect(computeChainHeadMirror(binding, record.entries)).toBe(record.chain_head);
    // The owner's own verifier agrees on the same record.
    const ownerVerified = verifyRealSearchRecord(record);
    expect(ownerVerified.ok).toBe(true);
  });

  it('the mirrored chain catches a REAL-record tamper (a rewritten trial)', () => {
    const tampered = structuredClone(realSearchRecord()) as unknown as Record<string, unknown>;
    const entries = tampered.entries as { trial: string }[];
    entries[0] = { ...entries[0]!, trial: 'trial-interop-rewritten-0001' };
    const verified = verifySearchRecordLineage(tampered);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0]?.code).toBe('chain_mismatch');
  });
});

// ---------------------------------------------------------------------------
// 4. The composition law (T031 + T032 + T048 through T049 + the publication layer)
// ---------------------------------------------------------------------------

describe('T049 interop — the composition law (REAL plan + REAL record + REAL report)', () => {
  it('a HOLDOUT measurement binding the REAL plan, the REAL record and the REAL report compiles and verifies', () => {
    const measurement = realHoldoutMeasurement();
    expect(measurement.phase).toBe('holdout');
    expect(measurement.plan?.plan_id).toBe(realPlan().plan_id);
    expect(measurement.search?.record_id).toBe(realSearchRecord().search_id);
    expect(measurement.search?.trial).toBe('trial-interop-holdout-0001');
    expect(measurement.attained).toBe(true);
    expect(verifyMeasurementRecord(measurement).ok).toBe(true);
  });

  it('the composed measurement publishes and RE-VERIFIES to the same bytes over the retained REAL sources', () => {
    const compiled = compilePublishedRecord({ measurement: realHoldoutMeasurement(), policy: interopPolicy(), publishedAt: at(T0 + 60_000) });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.errors.map((error) => error.message).join('; '));
    const record = compiled.value;
    expect(record.record_id).toMatch(/^pev:[0-9a-f]{16}$/);
    expect(record.verification.plan_id).toBe(realPlan().plan_id);
    expect(record.verification.search_record_id).toBe(realSearchRecord().search_id);
    const outcome = reverifyPublishedRecord(record, {
      suite: realReportSuite(),
      evidence: realReport as unknown as SliceReportMirror,
      material: interopHoldoutSource() as MaterialSource,
      plan: realPlan(),
      search: realSearchRecord(),
      policy: interopPolicy(),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.errors.map((error) => error.message).join('; '));
    expect(outcome.value.remeasurement.measurement_id).toBe(record.verification.expected_measurement_id);
    expect(outcome.value.remeasurement.measurement_id).toBe(realHoldoutMeasurement().measurement_id);
  });
});

// ---------------------------------------------------------------------------
// 5. The REAL T045 exchange
// ---------------------------------------------------------------------------

/** The interop request draft: the verification contract names the platform suite's stable NAME. */
function interopRequestDraft(): CapabilityRequestDraft {
  return {
    requestedCapability: 'liquidity-regime-analysis',
    summary: 'Reference-slice platform self-benchmark evidence (the T049 interop lane)',
    deliverableKind: 'capability-artifact',
    gapRefs: [FIXTURE_GAP_ID],
    evidenceRefs: [FIXTURE_EVIDENCE_REF],
    verification: [
      { kind: 'benchmark', requirementRef: 'bench-check', benchmarkId: 'reference-slice-platform-v1' },
      { kind: 'measurement', requirementRef: 'latency-check', metric: 'p95-latency-ms', max: 900 },
      { kind: 'local-evaluation', requirementRef: 'local-eval', evaluationRef: 'eval://suite-platform-interop-1' },
    ],
    deadline: CP_T0 + 86_400_000,
    consideration: { currency: 'usd-cents', amount: 12_500 },
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    requestedAt: CP_T0 + 1_000,
  };
}

describe('T049 interop — the REAL T045 exchange folds this lane\'s discharge outcomes', () => {
  it('declare -> request -> quote -> engage -> deliver -> DISCHARGE -> the REAL verifyDeliverable verdict: verified', () => {
    // The platform's machinery supplies the BENCHMARK outcome (the seam's whole charter);
    // the measurement + local-eval outcomes belong to their own machinery (composed by the caller).
    const discharge = dischargeBenchmarkRequirements({
      contract: interopRequestDraft().verification,
      measurements: [realHoldoutMeasurement()],
    });
    expect(discharge.ok).toBe(true);
    if (!discharge.ok) throw new Error(discharge.errors.map((error) => error.message).join('; '));
    expect(discharge.value).toHaveLength(1); // ONLY the benchmark member is this lane's to discharge
    expect(discharge.value[0]?.requirementRef).toBe('bench-check');
    expect(discharge.value[0]?.passed).toBe(true);
    expect(discharge.value[0]?.detail).toContain(realHoldoutMeasurement().measurement_id);

    const exchange = capabilityProvider.createProviderExchange(FIXTURE_TENANT);
    expect(exchange.ok).toBe(true);
    if (!exchange.ok) throw new Error('exchange creation failed');
    let state = exchange.value;
    const declared = capabilityProvider.registerProviderDeclaration(state, validDeclarationDraft());
    expect(declared.ok).toBe(true);
    if (!declared.ok) throw new Error(declared.errors.map((error) => error.message).join('; '));
    state = declared.value.state;
    const requested = capabilityProvider.issueCapabilityRequest(state, interopRequestDraft());
    expect(requested.ok).toBe(true);
    if (!requested.ok) throw new Error(requested.errors.map((error) => error.message).join('; '));
    state = requested.value.state;
    const quoted = capabilityProvider.submitProviderQuote(state, validQuoteDraft(requested.value.record));
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) throw new Error(quoted.errors.map((error) => error.message).join('; '));
    state = quoted.value.state;
    const opened = capabilityProvider.openEngagement(state, {
      requestId: requested.value.record.requestId,
      quoteId: quoted.value.record.quoteId,
      openedAt: CP_T0 + 2_500,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(opened.errors.map((error) => error.message).join('; '));
    state = opened.value.state;
    const delivered = capabilityProvider.submitDeliverable(state, validDeliverableDraft(opened.value.record));
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) throw new Error(delivered.errors.map((error) => error.message).join('; '));
    state = delivered.value.state;

    const outcomes: readonly RealVerificationOutcome[] = [
      ...discharge.value as readonly RealVerificationOutcome[],
      { requirementRef: 'latency-check', passed: true, detail: 'p95 latency measured at 812ms (bound 900ms) — the platform\'s measurement machinery' },
      { requirementRef: 'local-eval', passed: true, detail: 'local evaluation suite eval://suite-platform-interop-1 attained' },
    ];
    const verified = capabilityProvider.verifyDeliverable(state, {
      engagementId: opened.value.record.engagementId,
      deliverableId: delivered.value.record.deliverableId,
      outcomes,
      verifiedAt: CP_T0 + 4_000,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error(verified.errors.map((error) => error.message).join('; '));
    state = verified.value.state;
    expect(verified.value.record.report.verdict).toBe('verified');
    expect(verified.value.record.engagement.status).toBe('verified');
    // The whole conversation is chain-verified on the REAL exchange.
    const chain = capabilityProvider.verifyExchangeChain(state);
    expect(chain.ok).toBe(true);
  });

  it('the unattained leg: the honest discharge outcome fails and the REAL verdict is REJECTED (retained)', () => {
    // A strict variant of the SAME platform suite (an impossible criterion) over the SAME REAL report.
    const strict = runSuiteMeasurement({
      suite: realReportSuite(true),
      subject: subjectForEvidence(realReport as unknown as JsonObject),
      evidence: realReport as unknown as SliceReportMirror,
      material: interopSearchSource() as MaterialSource,
      phase: 'in-search',
      search: { record: realSearchRecord(), trial: 'trial-interop-search-0001' },
      plan: realPlan(),
      measured_at: at(T0 + 30_000),
    });
    expect(strict.ok).toBe(true);
    if (!strict.ok) throw new Error(strict.errors.map((error) => error.message).join('; '));
    expect(strict.value.attained).toBe(false);

    const discharge = dischargeBenchmarkRequirements({
      contract: interopRequestDraft().verification,
      measurements: [strict.value],
    });
    expect(discharge.ok).toBe(true);
    if (!discharge.ok) throw new Error(discharge.errors.map((error) => error.message).join('; '));
    expect(discharge.value[0]?.passed).toBe(false);
    expect(discharge.value[0]?.detail).toContain('none attained');

    const exchange = capabilityProvider.createProviderExchange(FIXTURE_TENANT);
    expect(exchange.ok).toBe(true);
    if (!exchange.ok) throw new Error('exchange creation failed');
    let state = exchange.value;
    const declared = capabilityProvider.registerProviderDeclaration(state, validDeclarationDraft());
    expect(declared.ok).toBe(true);
    if (!declared.ok) throw new Error(declared.errors.map((error) => error.message).join('; '));
    state = declared.value.state;
    const requested = capabilityProvider.issueCapabilityRequest(state, interopRequestDraft());
    expect(requested.ok).toBe(true);
    if (!requested.ok) throw new Error(requested.errors.map((error) => error.message).join('; '));
    state = requested.value.state;
    const quoted = capabilityProvider.submitProviderQuote(state, validQuoteDraft(requested.value.record));
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) throw new Error(quoted.errors.map((error) => error.message).join('; '));
    state = quoted.value.state;
    const opened = capabilityProvider.openEngagement(state, {
      requestId: requested.value.record.requestId,
      quoteId: quoted.value.record.quoteId,
      openedAt: CP_T0 + 2_500,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(opened.errors.map((error) => error.message).join('; '));
    state = opened.value.state;
    const delivered = capabilityProvider.submitDeliverable(state, validDeliverableDraft(opened.value.record));
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) throw new Error(delivered.errors.map((error) => error.message).join('; '));
    state = delivered.value.state;

    const outcomes: readonly RealVerificationOutcome[] = [
      ...discharge.value as readonly RealVerificationOutcome[],
      { requirementRef: 'latency-check', passed: true, detail: 'p95 latency measured at 812ms (bound 900ms)' },
      { requirementRef: 'local-eval', passed: true, detail: 'local evaluation suite eval://suite-platform-interop-1 attained' },
    ];
    const rejected = capabilityProvider.verifyDeliverable(state, {
      engagementId: opened.value.record.engagementId,
      deliverableId: delivered.value.record.deliverableId,
      outcomes,
      verifiedAt: CP_T0 + 4_000,
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) throw new Error(rejected.errors.map((error) => error.message).join('; '));
    expect(rejected.value.record.report.verdict).toBe('rejected');
    expect(rejected.value.record.engagement.status).toBe('rejected');
  });
});

// ---------------------------------------------------------------------------
// 6. The REAL T035 improvement loop
// ---------------------------------------------------------------------------

describe('T049 interop — the REAL T035 adoption-gate vocabulary (services/autonomous-learning)', () => {
  it('the refusal vocabulary agrees exactly (the three reasons the machinery mirrors)', () => {
    expect([...COMMISSION_REFUSAL_REASONS]).toEqual(['selected_without_holdout', 'evidence_missing', 'evidence_insufficient']);
    for (const reason of COMMISSION_REFUSAL_REASONS) {
      expect(realIsCommissionRefusalReason(reason), `the REAL T035 guard must accept ${reason}`).toBe(true);
    }
    expect(realIsCommissionRefusalReason('hidden_trials')).toBe(false); // a fail-closed error code, never a refusal reason
  });

  it('the REAL gate and this lane\'s measured-evidence gate render the SAME verdicts over the same REAL search record', () => {
    const record = realSearchRecord();
    // Holdout attained evidence releases under both gates.
    const realGate = realEvaluateAdoptionGate(record as never, [
      { verdict: 'verdict://interop-0001', attained: true, trial: 'trial-interop-holdout-0001', criteria: 'criteria://interop-0001', evidenceRef: 'evi://interop-0001' },
    ], true);
    expect(realGate.ok).toBe(true);
    if (!realGate.ok) throw new Error(realGate.errors.map((error) => error.message).join('; '));
    expect(realGate.value.decision).toBe('commissioned');
    expect(realGate.value.refusal).toBeNull();

    const mine = evaluateAdoptionGate({
      policy: { requiresHoldout: true },
      search: record,
      evidence: [{ measurement: realHoldoutMeasurement(), trial: 'trial-interop-holdout-0001' }],
    });
    expect(mine.ok).toBe(true);
    if (!mine.ok) throw new Error(mine.errors.map((error) => error.message).join('; '));
    expect(mine.value.decision).toBe('commissioned');
    expect(mine.value.refusal).toBeNull();
    expect(mine.value.grounding[0]?.classification).toBe('holdout');

    // In-search-only attained evidence withholds under BOTH gates with the same refusal.
    const realGateInSearch = realEvaluateAdoptionGate(record as never, [
      { verdict: 'verdict://interop-0002', attained: true, trial: 'trial-interop-search-0001', criteria: 'criteria://interop-0001', evidenceRef: 'evi://interop-0002' },
    ], true);
    expect(realGateInSearch.ok).toBe(true);
    if (!realGateInSearch.ok) throw new Error(realGateInSearch.errors.map((error) => error.message).join('; '));
    expect(realGateInSearch.value.decision).toBe('withheld');
    expect(realGateInSearch.value.refusal).toBe('selected_without_holdout');

    const mineInSearch = evaluateAdoptionGate({
      policy: { requiresHoldout: true },
      search: record,
      evidence: [{ measurement: realInSearchMeasurement(), trial: 'trial-interop-search-0001' }],
    });
    expect(mineInSearch.ok).toBe(true);
    if (!mineInSearch.ok) throw new Error(mineInSearch.errors.map((error) => error.message).join('; '));
    expect(mineInSearch.value.decision).toBe('withheld');
    expect(mineInSearch.value.refusal).toBe('selected_without_holdout');
  });
});

// ---------------------------------------------------------------------------
// 7-10. The vocabulary/derivation agreements
// ---------------------------------------------------------------------------

describe('T049 interop — the closed-vocabulary agreements (T028 / T017 / T012 / T032-research)', () => {
  it('the T028 process-kind vocabulary agrees exactly (services/market-world/generative)', () => {
    expect([...PROCESS_KINDS_MIRROR]).toEqual([...realProcessKinds]);
  });

  it('the T017 structured-metric vocabulary agrees exactly (packages/skills — L16a)', () => {
    expect([...MEASUREMENT_METRICS_MIRROR]).toEqual([...realMeasurementMetrics]);
  });

  it('the T012 dataset-axis mirror: mutual guard parity over the REAL-validated axis', () => {
    const real = realValidateDatasetAxis(interopAxisJson());
    expect(real.ok).toBe(true);
    if (!real.ok) throw new Error(real.errors.map((error) => error.message).join('; '));
    expect(isDatasetAxis(real.value)).toBe(true); // the machinery's guard accepts the REAL lane's axis
    expect(realIsDatasetAxis(real.value)).toBe(true);
    const broken = { segments: [{ ref: 'dataset-broken', start: T0 + DAY, end: T0, regime: 'trend' }] };
    expect(isDatasetAxis(broken)).toBe(false);
    expect(realIsDatasetAxis(broken)).toBe(false);
    expect(realValidateDatasetAxis(broken).ok).toBe(false);
  });

  it('the T032 research lane\'s material-source derivations agree byte-for-byte (rsrc: / gsrc: / lsrc:)', () => {
    // The replay source: identical content, identical address, and the REAL-validated source passes the mirror guard.
    const replayContent = {
      kind: 'replay-dataset' as const,
      origin: 'historical' as const,
      stream_refs: ['stream://interop-search-0001'],
      config_digest: '5f3a1c0d9e2b47a8',
      coverage: { start: at(T0), end: at(T0 + 6 * DAY) },
    };
    expect(researchBenchmarks.replaySourceId(replayContent)).toBe(replaySourceId(replayContent));
    const realReplay = researchBenchmarks.validateReplayDataSource({ ...replayContent, source_id: researchBenchmarks.replaySourceId(replayContent) });
    expect(realReplay.ok).toBe(true);
    if (realReplay.ok) expect(isReplayDataSource(realReplay.value)).toBe(true);

    // The generative population: identical content, identical address (the T028 process vocabulary).
    const generativeContent = {
      kind: 'generative-population' as const,
      origin: 'generated' as const,
      regimes: ['trend', 'range'],
      unseen_regimes: ['crisis'],
      processes: [
        { process_id: 'proc-interop-walk', version: '1.0.0', kind: 'reference_price_walk', seed: 'seed/interop-walk', step_ms: 5_000, params: { start_price: '100.00', step_ticks: 3 } },
      ],
      seed: 'seed-interop',
      config_digest: '7c4e2f8a1d6b09e3',
    };
    expect(researchBenchmarks.generativeSourceId(generativeContent as never)).toBe(generativeSourceId(generativeContent as never));
    const realGenerative = researchBenchmarks.validateRegimePopulationSource({
      ...generativeContent,
      source_id: researchBenchmarks.generativeSourceId(generativeContent as never),
    } as never);
    expect(realGenerative.ok).toBe(true);
    if (realGenerative.ok) expect(isRegimePopulationSource(realGenerative.value)).toBe(true);

    // The live session: identical content, identical address.
    const liveContent = {
      kind: 'live-session' as const,
      origin: 'historical' as const,
      venue: 'venue-interop',
      session_refs: ['session://interop-live-0001'],
      config_digest: '2b8d4a6f0c3e5719',
      captured: { start: at(T0), end: at(T0 + DAY) },
    };
    expect(researchBenchmarks.liveSourceId(liveContent)).toBe(liveSourceId(liveContent));
    const realLive = researchBenchmarks.validateLiveSessionSource({ ...liveContent, source_id: researchBenchmarks.liveSourceId(liveContent) });
    expect(realLive.ok).toBe(true);
    if (realLive.ok) expect(isLiveSessionSource(realLive.value)).toBe(true);

    // The evidence classes agree (never conflated).
    expect([...researchBenchmarks.EVIDENCE_CLASSES]).toEqual(['simulation', 'live']);
  });
});

// ---------------------------------------------------------------------------
// 11. The decimals divergence record
// ---------------------------------------------------------------------------

describe('T049 interop — THE DECIMALS DIVERGENCE RECORD (benchmarks/platform/src/decimals.ts)', () => {
  it('the three REAL owners miscompare across integer digit counts; the corrected mirror does not (the recorded latent defect)', () => {
    // The REAL owners' compareMagnitude pads int+frac without aligning integer
    // digit counts, so 10.00 compares EQUAL to 1.00 and 15.00 compares BELOW
    // 9.00. Their own usage (same-digit-count epoch-ms boundaries) never hits
    // the case, but a measurement lane judging arbitrary decimal criteria
    // DOES — the machinery's mirror corrects the law (pinned in
    // mirrors.test.ts). These pins record the defect EXACTLY: when the Lead
    // fixes the three owners, this leg flips RED and the mirror's divergence
    // record updates with it.
    expect(splitsCompareDecimals('10.00', '1.00')).toBe(0); // the defect: the true order is 1
    expect(splitsCompareDecimals('15.00', '9.00')).toBe(-1); // the defect: the true order is 1
    expect(integrityCompareDecimals('10.00', '1.00')).toBe(0);
    expect(researchBenchmarks.compareDecimals('10.00', '1.00')).toBe(0);
    // The corrected mirror (identical to the owners on equal digit counts — mirrors.test.ts).
    expect(mirrorCompareDecimals('10.00', '1.00')).toBe(1);
    expect(mirrorCompareDecimals('15.00', '9.00')).toBe(1);
    expect(mirrorCompareDecimals('86400000', '86400000')).toBe(splitsCompareDecimals('86400000', '86400000'));
  });
});
