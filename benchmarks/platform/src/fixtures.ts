/**
 * @tradrl/benchmarks-platform — test and documentation fixtures (Work
 * Order T049). Trusted-literal builders for this lane's own tests: a
 * hand-built, PIPELINE-COHERENT reference-slice report (the honest
 * synthetic evidence for unit laws — the interop tests use the REAL
 * `runReferenceSlice()` report instead), capability suites over the
 * closed measurable vocabulary, material sources (replay, generative
 * population, live session), split plans and search records (through the
 * MIRRORED derivations — proving a hand-authored record lawfully
 * verifies), and the assembled run inputs. Every fixture is a pure
 * function of its literals: run it twice, get byte-identical evidence.
 */

import { deepFreeze, requireTimestampMs, stableDigestJson } from './primitives';
import type { JsonObject, TimestampMs } from './primitives';
import { suiteId } from './suite';
import type { SuiteDefinition, SuiteAxis, SubjectBinding } from './suite';
import { replaySourceId, generativeSourceId, liveSourceId } from './material';
import type { ReplayDataSource, RegimePopulationSource, LiveSessionSource, ProcessDeclarationMirror } from './material';
import { computeChainHeadMirror, configSnapshotIdMirror, searchRecordIdMirror } from './search-mirror';
import type { SearchRecordMirror, SearchTrialEntryMirror } from './search-mirror';
import { splitPlanIdMirror } from './split-mirror';
import type { SplitPlanMirror } from './split-mirror';
import type { DatasetSegment } from './axis';
import type { TenantId, ProjectId, DataRef, ExperimentId, EvaluatorVersionRef, SplitPolicyRef, TrialId, ArmId, ConfigSnapshotId } from './ids';

export const T0 = 1_730_000_000_000;
export const DAY = 86_400_000;
export const TENANT = 'tenant-bmk-platform' as TenantId;
export const PROJECT = 'project-bmk-platform' as ProjectId;

/** Deterministic 16-hex config digests for the fixture sources (the T032 owner's digest law). */
export const FIXTURE_REPLAY_CONFIG_DIGEST = '5f3a1c0d9e2b47a8';
export const FIXTURE_GENERATIVE_CONFIG_DIGEST = '7c4e2f8a1d6b09e3';
export const FIXTURE_LIVE_CONFIG_DIGEST = '2b8d4a6f0c3e5719';
export const FIXTURE_HOLDOUT_CONFIG_DIGEST = '9a1f5d3c8e7b2406';

/** Trusted-literal constructors (the sibling test pattern). */
export const dataRef = (id: string): DataRef => id as DataRef;
export const at = (ms: number): TimestampMs => requireTimestampMs(ms);

// ---------------------------------------------------------------------------
// The reference-slice evidence fixture (hand-built, pipeline-coherent)
// ---------------------------------------------------------------------------

/**
 * A hand-built, structurally valid, PIPELINE-COHERENT reference-slice
 * report: the honest synthetic evidence for the unit laws (counts at a
 * coherent market day, an exact-decimal book, the L15 lineage block, the
 * L16 clock pair, the 8-hex report anchor). The interop tests replace
 * this with the REAL T048 report; the two must agree on every measured
 * axis KIND, never on values (the fixture is documentation, the REAL
 * report is the platform's own self-benchmark input).
 */
export function fixtureSliceReport(): JsonObject {
  const report = {
    marketData: {
      binanceEvents: 4,
      newsEvents: 2,
      embargoAvailableAt: T0 + 25_000,
      binanceEventTypes: ['book_snapshot', 'trade', 'trade', 'trade'],
      framesSent: 5,
    },
    director: {
      decisionId: 'dd-fixture-0001',
      directiveKind: 'allocation-adjustment',
      lanesConsumed: 4,
    },
    strategy: {
      runId: 'strat-fixture-0001',
      intents: 2,
      refusals: 0,
      instruments: ['BTC-USDT', 'ETH-USDT'],
      step2RunId: 'strat-fixture-0002',
      step2Intents: 1,
      step2Sides: ['sell'],
    },
    gateway: {
      routed: 1,
      refused: 5,
      refusalStages: ['risk_limit', 'duplicate_order', 'mode_gate', 'kill_switch', 'expired_grant'],
      portCalls: 1,
      auditRecords: 3,
      auditCoherent: true,
    },
    executionBody: {
      btcBuyState: 'filled',
      ethState: 'partially_filled',
      btcSellState: 'expired',
      gatewayRequests: 3,
      reconciliationStatus: 'reconciled',
    },
    shadow: {
      sessionId: 'shadow-fixture-0001',
      dispositions: ['filled', 'expired', 'refused'],
      worldFillCount: 1,
    },
    outcomes: {
      outcomes: 3,
      fills: 1,
      refusals: 1,
      dispositions: ['filled', 'expired', 'refused'],
      book: {
        positions: [{ instrument: 'BTC-USDT', quantity: '0.20', costBasis: '10020.00' }],
        cash: '989980.00',
        realizedPnl: '0.00',
      },
      outcomeDigest: '00112233',
    },
    lineage: {
      goalId: 'goal-fixture-0001',
      directorGoalId: 'goal-fixture-0001',
      directorDecisionId: 'dd-fixture-0001',
      paperOutcomeIntents: [
        { outcomeId: 'out-fixture-0001', intentRef: 'intent-fixture-0001', goalId: 'goal-fixture-0001' },
        { outcomeId: 'out-fixture-0002', intentRef: 'intent-fixture-0002', goalId: 'goal-fixture-0001' },
        { outcomeId: 'out-fixture-0003', intentRef: 'intent-fixture-0003', goalId: 'goal-fixture-0001' },
      ],
      liveAuditIntents: [
        { auditId: 'aud-fixture-0001', intentRef: 'intent-fixture-0001', goalId: 'goal-fixture-0001' },
        { auditId: 'aud-fixture-0002', intentRef: 'intent-fixture-0002', goalId: 'goal-fixture-0001' },
        { auditId: 'aud-fixture-0003', intentRef: 'intent-fixture-0003', goalId: 'goal-fixture-0001' },
      ],
      orderDecisions: [
        { lifecycleId: 'lifecycle-fixture-0001', decisionRef: 'gw-fixture-0001', directorDecisionRef: 'dd-fixture-0001', intentRef: 'intent-fixture-0001', orderClock: T0 + 321_000, decisionAsOf: T0 + 320_000 },
        { lifecycleId: 'lifecycle-fixture-0002', decisionRef: 'gw-fixture-0002', directorDecisionRef: null, intentRef: 'intent-fixture-0002', orderClock: T0 + 322_000, decisionAsOf: T0 + 320_000 },
      ],
    },
    reportDigest: '0a1b2c3d',
  };
  return deepFreeze(report) as JsonObject;
}

/** The subject binding for the fixture report (the artifact digest pins the canonical content). */
export function fixtureSubject(kind: 'reference-slice' | 'capability-candidate' = 'reference-slice'): SubjectBinding {
  return deepFreeze({
    kind,
    artifacts: [{ ref: 'slice://fixture-report-0001', digest: stableDigestJson(fixtureSliceReport()) }],
    body: 'body://platform-reference',
    substrate: 'substrate://platform-v1',
    environment: 'env://fixture-market-day',
    runtime: 'runtime://node22-vitest',
    config: 'config://fixture-scope',
  });
}

/** Re-bind a subject's artifact digest to an arbitrary evidence object (tests swap evidence). */
export function subjectForEvidence(evidence: JsonObject, kind: 'reference-slice' | 'capability-candidate' = 'reference-slice'): SubjectBinding {
  return deepFreeze({
    kind,
    artifacts: [{ ref: 'slice://evidence-under-test', digest: stableDigestJson(evidence) }],
    body: 'body://platform-reference',
    substrate: 'substrate://platform-v1',
    environment: 'env://fixture-market-day',
    runtime: 'runtime://node22-vitest',
    config: 'config://fixture-scope',
  });
}

// ---------------------------------------------------------------------------
// The suite fixtures
// ---------------------------------------------------------------------------

/** The platform self-benchmark suite over the fixture/REAL report (structural invariants, no digest pin). */
export function fixturePlatformSuite(name = 'reference-slice-platform-v1'): Omit<SuiteDefinition, 'suite_id'> {
  const axes: readonly SuiteAxis[] = [
    { axis: 'crypto-events', measurable: 'marketData.binanceEvents', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'news-events', measurable: 'marketData.newsEvents', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'frames', measurable: 'marketData.framesSent', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'lanes-consumed', measurable: 'director.lanesConsumed', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'intents', measurable: 'strategy.intents', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'step2-intents', measurable: 'strategy.step2Intents', kind: 'count', scale: null, attainment: { min: 0 } },
    { axis: 'routed', measurable: 'gateway.routed', kind: 'count', scale: null, attainment: { min: 0 } },
    { axis: 'refusals', measurable: 'gateway.refused', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'audit-records', measurable: 'gateway.auditRecords', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'world-fills', measurable: 'shadow.worldFillCount', kind: 'count', scale: null, attainment: { min: 0 } },
    { axis: 'outcome-records', measurable: 'outcomes.outcomes', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'realized-pnl', measurable: 'outcomes.realizedPnl', kind: 'decimal', scale: 2, attainment: {} },
    { axis: 'cash', measurable: 'outcomes.cash', kind: 'decimal', scale: 2, attainment: {} },
    { axis: 'report-digest', measurable: 'report.digest', kind: 'digest', scale: null, attainment: {} },
    { axis: 'outcome-digest', measurable: 'outcomes.outcomeDigest', kind: 'digest', scale: null, attainment: {} },
    { axis: 'audit-coherent', measurable: 'gateway.auditCoherent', kind: 'flag', scale: null, attainment: { equals: true } },
    { axis: 'refusals-cost-zero', measurable: 'gateway.refusalsCostZero', kind: 'flag', scale: null, attainment: { equals: true } },
    { axis: 'paper-goals-bound', measurable: 'lineage.paperOutcomeGoalsBound', kind: 'flag', scale: null, attainment: { equals: true } },
    { axis: 'live-goals-bound', measurable: 'lineage.liveAuditGoalsBound', kind: 'flag', scale: null, attainment: { equals: true } },
    { axis: 'clocks-separated', measurable: 'lineage.orderClocksSeparated', kind: 'flag', scale: null, attainment: { equals: true } },
  ];
  return deepFreeze({
    name,
    subject_kind: 'reference-slice',
    evidence_class: 'simulation',
    evaluator: 'evaluator://benchmark-platform/v1' as EvaluatorVersionRef,
    axes,
    tenant: TENANT,
    project: PROJECT,
  });
}

/** The full platform suite with its derived content address. */
export function fixturePlatformSuiteRecord(name = 'reference-slice-platform-v1'): SuiteDefinition {
  const content = fixturePlatformSuite(name);
  return deepFreeze({ suite_id: suiteId(content), ...content } satisfies SuiteDefinition);
}

/** A candidate-measuring suite (the capability-candidate subject kind; the digest axis pinned by tests). */
export function fixtureCandidateSuite(name = 'capability-candidate-slice-v1'): Omit<SuiteDefinition, 'suite_id'> {
  const axes: readonly SuiteAxis[] = [
    { axis: 'routed', measurable: 'gateway.routed', kind: 'count', scale: null, attainment: { min: 1 } },
    { axis: 'realized-pnl', measurable: 'outcomes.realizedPnl', kind: 'decimal', scale: 2, attainment: { min: '-1000000.00' } },
    { axis: 'report-digest', measurable: 'report.digest', kind: 'digest', scale: null, attainment: {} },
  ];
  return deepFreeze({
    name,
    subject_kind: 'capability-candidate',
    evidence_class: 'simulation',
    evaluator: 'evaluator://benchmark-platform/v1' as EvaluatorVersionRef,
    axes,
    tenant: TENANT,
    project: PROJECT,
  });
}

// ---------------------------------------------------------------------------
// The material source fixtures
// ---------------------------------------------------------------------------

/** A replay data source over the fixture axis (T009 historical streams). */
export function fixtureReplaySource(): ReplayDataSource {
  const content = {
    kind: 'replay-dataset' as const,
    origin: 'historical' as const,
    stream_refs: ['stream://fixture-batch-0001', 'stream://fixture-batch-0002'],
    config_digest: FIXTURE_REPLAY_CONFIG_DIGEST,
    coverage: { start: at(T0), end: at(T0 + 6 * DAY) },
  };
  return deepFreeze({ source_id: replaySourceId(content), ...content });
}

/** A generative regime population (the T028 exploration instrument; NEVER holdout material). */
export function fixtureGenerativeSource(): RegimePopulationSource {
  const processes: readonly ProcessDeclarationMirror[] = [
    {
      process_id: 'proc-fixture-walk',
      version: '1.0.0',
      kind: 'reference_price_walk',
      seed: 'fixture-seed/walk',
      step_ms: 5_000,
      params: { start_price: '100.00', step_ticks: 3, embargo_ms: 400 },
    },
    {
      process_id: 'proc-fixture-maker',
      version: '1.0.0',
      kind: 'market_maker',
      seed: 'fixture-seed/maker',
      step_ms: 10_000,
      params: { half_spread_ticks: 2, quantity: '0.5' },
    },
  ];
  const content = {
    kind: 'generative-population' as const,
    origin: 'generated' as const,
    regimes: ['trend', 'range'],
    unseen_regimes: ['crisis'],
    processes,
    seed: 'fixture-seed',
    config_digest: FIXTURE_GENERATIVE_CONFIG_DIGEST,
  };
  return deepFreeze({ source_id: generativeSourceId(content), ...content });
}

/** A live-session source (the live evidence class; captured consequential execution). */
export function fixtureLiveSource(): LiveSessionSource {
  const content = {
    kind: 'live-session' as const,
    origin: 'historical' as const,
    venue: 'venue-fixture',
    session_refs: ['session://fixture-live-0001'],
    config_digest: FIXTURE_LIVE_CONFIG_DIGEST,
    captured: { start: at(T0), end: at(T0 + DAY) },
  };
  return deepFreeze({ source_id: liveSourceId(content), ...content });
}

// ---------------------------------------------------------------------------
// The split-plan fixture (through the MIRRORED content addressing)
// ---------------------------------------------------------------------------

/** The fixture axis: six consecutive daily segments, a one-day gap, then the holdout pair. */
export function fixtureSegmentsWithGap(): DatasetSegment[] {
  const segments: DatasetSegment[] = [];
  const regimes = ['trend', 'range', 'crisis'];
  for (let index = 0; index < 6; index++) {
    const start = at(T0 + index * DAY);
    segments.push({ ref: dataRef(`dataset-${index}`), start, end: at(start + DAY), regime: regimes[index % 3] as string });
  }
  const holdoutStart = at(T0 + 7 * DAY); // one day after dataset-05 ends
  segments.push({ ref: dataRef('dataset-6'), start: holdoutStart, end: at(holdoutStart + DAY), regime: 'trend' });
  segments.push({ ref: dataRef('dataset-7'), start: at(holdoutStart + DAY), end: at(holdoutStart + 2 * DAY), regime: 'range' });
  return segments;
}

/** A hand-built split plan over the fixture axis (an anchored ladder + the trailing holdout reservation). */
export function fixtureSplitPlan(): SplitPlanMirror {
  const segments = fixtureSegmentsWithGap();
  const search = segments.slice(0, 6);
  const holdout = segments.slice(6);
  const windows = [0, 1, 2].map((index) => ({
    index,
    train: search.slice(0, 3 + index),
    test: search[3 + index] as DatasetSegment,
    purged: 0,
  }));
  const policyRef = 'split-policy://fixture-walk-forward-v1' as SplitPolicyRef;
  const content = {
    policy_ref: policyRef,
    kind: 'walk-forward-plan' as const,
    windows,
    holdout: { mode: 'trailing-count' as const, segments: holdout, embargo_ms: '86400000', separation_ms: null },
    lineage: {
      axis_digest: 'a1b2c3d4e5f60718',
      policy_ref: policyRef,
      policy_digest: 'b1b2c3d4e5f60719',
      segment_count: segments.length,
      window_count: windows.length,
      holdout_count: holdout.length,
    },
  };
  return deepFreeze({ plan_id: splitPlanIdMirror(content), ...content } satisfies SplitPlanMirror);
}

/** A replay source whose coverage is the RESERVED holdout material (for holdout-phase tests). */
export function fixtureHoldoutReplaySource(): ReplayDataSource {
  const segments = fixtureSegmentsWithGap();
  const holdout = segments[6] as DatasetSegment;
  const next = segments[7] as DatasetSegment;
  const content = {
    kind: 'replay-dataset' as const,
    origin: 'historical' as const,
    stream_refs: ['stream://fixture-holdout-0001'],
    config_digest: FIXTURE_HOLDOUT_CONFIG_DIGEST,
    coverage: { start: holdout.start, end: next.end },
  };
  return deepFreeze({ source_id: replaySourceId(content), ...content });
}

// ---------------------------------------------------------------------------
// The search-record fixture (through the MIRRORED chain law)
// ---------------------------------------------------------------------------

/** A two-trial search record: one in-search trial, one holdout trial (the T031 mirrored chain). */
export function fixtureSearchRecord(): SearchRecordMirror {
  const searchConfig: JsonObject = { candidate: 'fixture-candidate', seed: 42 };
  const holdoutConfig: JsonObject = { policy: 'trailing-holdout', embargo: '86400000' };
  const snapshots = [
    { snapshot_id: configSnapshotIdMirror(searchConfig) as ConfigSnapshotId, config: searchConfig },
    { snapshot_id: configSnapshotIdMirror(holdoutConfig) as ConfigSnapshotId, config: holdoutConfig },
  ];
  const inSearch: SearchTrialEntryMirror = {
    trial: 'trial-fixture-search-0001' as TrialId,
    arm: 'arm-fixture-a' as ArmId,
    classification: 'in-search',
    config: snapshots[0]!.snapshot_id,
    parents: [],
    splits: ['split-policy://fixture-walk-forward-v1' as SplitPolicyRef],
    datasets: [dataRef('dataset-0'), dataRef('dataset-1')],
    window: { start: at(T0), end: at(T0 + 3 * DAY) },
    evaluation_policy: 'split-policy://fixture-walk-forward-v1' as SplitPolicyRef,
    recorded_at: at(T0 + 10_000),
    tenant: TENANT,
    project: PROJECT,
  };
  const holdout: SearchTrialEntryMirror = {
    trial: 'trial-fixture-holdout-0001' as TrialId,
    arm: null,
    classification: 'holdout',
    config: snapshots[1]!.snapshot_id,
    parents: [],
    splits: ['split-policy://fixture-holdout-eval-v1' as SplitPolicyRef],
    datasets: [dataRef('dataset-6'), dataRef('dataset-7')],
    window: { start: at(T0 + 7 * DAY), end: at(T0 + 9 * DAY) },
    evaluation_policy: 'split-policy://fixture-holdout-eval-v1' as SplitPolicyRef,
    recorded_at: at(T0 + 20_000),
    tenant: TENANT,
    project: PROJECT,
  };
  const binding = {
    experiment: 'experiment-fixture-0001' as ExperimentId,
    evaluator: 'evaluator://benchmark-platform/v1' as EvaluatorVersionRef,
    tenant: TENANT,
    project: PROJECT,
  };
  const entries = [inSearch, holdout];
  return deepFreeze({
    search_id: searchRecordIdMirror(binding),
    ...binding,
    entries,
    snapshots,
    chain_head: computeChainHeadMirror(binding, entries),
  } satisfies SearchRecordMirror);
}

// ---------------------------------------------------------------------------
// The assembled run inputs
// ---------------------------------------------------------------------------

/** A valid in-search measurement run input over the fixtures. */
export function fixtureRunInput(): {
  readonly suite: SuiteDefinition;
  readonly subject: SubjectBinding;
  readonly evidence: JsonObject;
  readonly material: ReplayDataSource;
  readonly phase: 'in-search';
  readonly search: { readonly record: SearchRecordMirror; readonly trial: string } | null;
  readonly plan: SplitPlanMirror | null;
  readonly measured_at: TimestampMs;
} {
  return {
    suite: fixturePlatformSuiteRecord(),
    subject: fixtureSubject(),
    evidence: fixtureSliceReport(),
    material: fixtureReplaySource(),
    phase: 'in-search',
    search: null,
    plan: fixtureSplitPlan(),
    measured_at: at(T0 + 30_000),
  };
}

/** A valid holdout measurement run input over the fixtures (reserved material + the bound search). */
export function fixtureHoldoutRunInput(): {
  readonly suite: SuiteDefinition;
  readonly subject: SubjectBinding;
  readonly evidence: JsonObject;
  readonly material: ReplayDataSource;
  readonly phase: 'holdout';
  readonly search: { readonly record: SearchRecordMirror; readonly trial: string };
  readonly plan: SplitPlanMirror;
  readonly measured_at: TimestampMs;
} {
  return {
    suite: fixturePlatformSuiteRecord(),
    subject: fixtureSubject(),
    evidence: fixtureSliceReport(),
    material: fixtureHoldoutReplaySource(),
    phase: 'holdout',
    search: { record: fixtureSearchRecord(), trial: 'trial-fixture-holdout-0001' },
    plan: fixtureSplitPlan(),
    measured_at: at(T0 + 40_000),
  };
}

