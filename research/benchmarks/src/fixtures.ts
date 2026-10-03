/**
 * @tradrl/research-benchmarks — test and documentation fixtures (Work Order
 * T032). Trusted-literal builders for the suite's own tests: a hand-built
 * split plan (content-addressed through the MIRROR derivation — proving a
 * hand-authored plan lawfully verifies), replay/generative data sources,
 * observation sets, search records (mirrored chain law), and benchmark
 * definitions. The interop tests build the same kinds of records through
 * the REAL sibling packages instead — the two paths must agree.
 */

import { deepFreeze, requireTimestampMs, stableDigestJson } from './primitives';
import type { JsonObject, TimestampMs } from './primitives';
import { splitPlanIdMirror } from './split-mirror';
import type { SplitPlanMirror, SplitWindowPlanMirror } from './split-mirror';
import { computeChainHeadMirror, configSnapshotIdMirror, searchRecordIdMirror } from './search-mirror';
import type { SearchRecordMirror, SearchTrialEntryMirror } from './search-mirror';
import { validateReplayDataSource } from './replay-mirror';
import { validateRegimePopulationSource } from './generative-mirror';
import { validateObservationSet } from './observations';
import type { ObservationSet } from './observations';
import type { ConfigSnapshotId, DataRef, ExperimentId, ProjectId, SplitPolicyRef, TenantId, TrialId } from './ids';
import type { DatasetSegment } from './axis';

export const T0 = 1_700_000_000_000;
export const DAY = 86_400_000;
export const TENANT = 'tenant-bmk' as TenantId;
export const PROJECT = 'project-bmk' as ProjectId;

/** Trusted-literal constructors (the sibling test pattern). */
export const dataRef = (id: string): DataRef => id as DataRef;
export const at = (ms: number): TimestampMs => requireTimestampMs(ms);

/** The fixture axis: six consecutive daily segments, then a one-day gap, then the holdout pair. */
export function fixtureSegmentsWithGap(): DatasetSegment[] {
  const segments: DatasetSegment[] = [];
  const regimes = ['trend', 'range', 'crisis'];
  for (let index = 0; index < 6; index++) {
    const start = at(T0 + index * DAY);
    segments.push({ ref: dataRef(`dataset-${index}`), start, end: at(start + DAY), regime: regimes[index % 3] as string });
  }
  const holdoutStart = at(T0 + 7 * DAY); // one day after dataset-05 ends (T0 + 6d)
  segments.push({ ref: dataRef('dataset-6'), start: holdoutStart, end: at(holdoutStart + DAY), regime: 'trend' });
  segments.push({ ref: dataRef('dataset-7'), start: at(holdoutStart + DAY), end: at(holdoutStart + 2 * DAY), regime: 'range' });
  return segments;
}

/**
 * A hand-built split plan over the fixture axis: an anchored ladder
 * (min_train 3, step 1, no gap) over the search material, with the last two
 * segments (across a one-day axis gap) reserved as the trailing holdout
 * under a one-day embargo — the embargo separation law is satisfied by
 * construction.
 */
export function fixturePlan(): SplitPlanMirror {
  const segments = fixtureSegmentsWithGap();
  const search = segments.slice(0, 6);
  const holdout = segments.slice(6);
  const windows: SplitWindowPlanMirror[] = [];
  for (let testIndex = 3; testIndex < search.length; testIndex += 1) {
    const test = search[testIndex];
    if (test === undefined) continue;
    windows.push({ index: windows.length, train: search.slice(0, testIndex), test, purged: 0 });
  }
  const policyRef = 'split.bmk-fixture' as SplitPolicyRef;
  const policyJson = {
    policy_ref: policyRef,
    window: 'anchored',
    min_train_segments: 3,
    step_segments: 1,
    train_span_segments: null,
    gap_ms: '0',
    embargo_ms: String(DAY),
    regime_filter: null,
    holdout: { mode: 'trailing-count', count: 2 },
  };
  const content = {
    policy_ref: policyRef,
    kind: 'walk-forward-plan' as const,
    windows,
    holdout: {
      mode: 'trailing-count' as const,
      segments: holdout,
      embargo_ms: String(DAY),
      separation_ms: String(DAY),
    },
    lineage: {
      axis_digest: stableDigestJson({ segments } as unknown as Parameters<typeof stableDigestJson>[0]),
      policy_ref: policyRef,
      policy_digest: stableDigestJson(policyJson as unknown as Parameters<typeof stableDigestJson>[0]),
      segment_count: segments.length,
      window_count: windows.length,
      holdout_count: holdout.length,
    },
  };
  return deepFreeze({ plan_id: splitPlanIdMirror(content), ...content } as SplitPlanMirror);
}

// ---------------------------------------------------------------------------
// Data sources
// ---------------------------------------------------------------------------

/** A validated replay data source fixture (T009 mirror). */
export function fixtureReplaySource() {
  return validateReplayDataSource({
    kind: 'replay-dataset',
    origin: 'historical',
    stream_refs: ['stream-eu-1', 'stream-eu-2'],
    config_digest: 'aaaaaaaaaaaaaaaa',
    coverage: { start: T0, end: T0 + 10 * DAY },
  });
}

/** A validated generative regime population source fixture (T028 mirror). */
export function fixtureGenerativeSource(overrides: Record<string, unknown> = {}) {
  return validateRegimePopulationSource({
    kind: 'generative-population',
    origin: 'generated',
    regimes: ['trend', 'range'],
    unseen_regimes: ['crisis'],
    processes: [
      {
        process_id: 'proc-anchor-walk',
        version: '1.0.0',
        kind: 'reference_price_walk',
        seed: 'seed-1/walk',
        step_ms: 5_000,
        params: { start_price: '100.00', step_ticks: 3, embargo_ms: 400 },
      },
      {
        process_id: 'proc-maker-mmm',
        version: '1.0.0',
        kind: 'market_maker',
        seed: 'seed-1/maker',
        step_ms: 10_000,
        params: { half_spread_ticks: 2, extra_spread_ticks: 1, quantity: '0.5' },
      },
    ],
    seed: 'seed-1',
    config_digest: 'bbbbbbbbbbbbbbbb',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

/** Observations for every material segment of a plan (deterministic values). */
export function fixtureObservations(plan: SplitPlanMirror): ObservationSet {
  const segments = new Map<string, DatasetSegment>();
  for (const window of plan.windows) {
    for (const segment of window.train) segments.set(segment.ref, segment);
    segments.set(window.test.ref, window.test);
  }
  for (const segment of plan.holdout?.segments ?? []) segments.set(segment.ref, segment);
  const observations = [...segments.keys()].map((ref, index) => ({
    segment: ref,
    pnl: index % 2 === 0 ? '1000.00' : '-250.50',
    notional: '1000000.00',
    trades: 40,
    fill_value: '500.00',
  }));
  const validated = validateObservationSet({ observations }, plan);
  if (!validated.ok) throw new Error(`fixture observations must validate: ${JSON.stringify(validated.errors)}`);
  return validated.value;
}

// ---------------------------------------------------------------------------
// Search records (the mirrored chain law)
// ---------------------------------------------------------------------------

/** Build a mirrored search record: two in-search trials + one holdout trial. */
export function fixtureSearchRecord(): SearchRecordMirror {
  const binding = {
    experiment: 'exp-bmk' as ExperimentId,
    evaluator: 'evaluator@1',
    tenant: TENANT,
    project: PROJECT,
  };
  const configA: JsonObject = { lr: '0.1', depth: 2 };
  const configB: JsonObject = { lr: '0.2', depth: 3 };
  const configH: JsonObject = { check: true };
  const evaluationPolicy = 'split.bmk-fixture' as SplitPolicyRef;
  const entries: SearchTrialEntryMirror[] = [
    {
      trial: 't-1' as TrialId,
      arm: null,
      classification: 'in-search',
      config: configSnapshotIdMirror(configA) as ConfigSnapshotId,
      parents: [],
      splits: [evaluationPolicy],
      datasets: [dataRef('dataset-0')],
      window: { start: at(T0), end: at(T0 + 6 * DAY) },
      evaluation_policy: evaluationPolicy,
      recorded_at: at(T0 + 1),
      tenant: TENANT,
      project: PROJECT,
    },
    {
      trial: 't-2' as TrialId,
      arm: null,
      classification: 'in-search',
      config: configSnapshotIdMirror(configB) as ConfigSnapshotId,
      parents: ['t-1' as TrialId],
      splits: [evaluationPolicy],
      datasets: [dataRef('dataset-0')],
      window: { start: at(T0), end: at(T0 + 6 * DAY) },
      evaluation_policy: evaluationPolicy,
      recorded_at: at(T0 + 2),
      tenant: TENANT,
      project: PROJECT,
    },
    {
      trial: 'h-1' as TrialId,
      arm: null,
      classification: 'holdout',
      config: configSnapshotIdMirror(configH) as ConfigSnapshotId,
      parents: [],
      splits: [evaluationPolicy],
      datasets: [dataRef('dataset-6')],
      window: { start: at(T0 + 7 * DAY), end: at(T0 + 9 * DAY) },
      evaluation_policy: evaluationPolicy,
      recorded_at: at(T0 + 3),
      tenant: TENANT,
      project: PROJECT,
    },
  ];
  const snapshots: readonly { snapshot_id: string; config: JsonObject }[] = [
    { snapshot_id: configSnapshotIdMirror(configA), config: configA },
    { snapshot_id: configSnapshotIdMirror(configB), config: configB },
    { snapshot_id: configSnapshotIdMirror(configH), config: configH },
  ];
  return deepFreeze({
    search_id: searchRecordIdMirror(binding),
    experiment: binding.experiment,
    evaluator: binding.evaluator,
    tenant: binding.tenant,
    project: binding.project,
    entries,
    snapshots,
    chain_head: computeChainHeadMirror(binding, entries),
  } as unknown as SearchRecordMirror);
}
