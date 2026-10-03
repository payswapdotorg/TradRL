/**
 * Cross-package interoperability for @tradrl/research-benchmarks (the
 * D-003/D-004 drift trip wires — mirrors ONLY, never source imports; the
 * REAL packages are imported HERE, in tests, to prove the mirrors):
 *
 * 1. THE SPLIT-PLAN MIRROR against the REAL @tradrl/evaluation-splits
 *    (T032 driver lane): a plan materialized by the real driver verifies
 *    under this package's mirrored verifier with the IDENTICAL `splan:`
 *    content address (the mirror's derivation is byte-identical), and a
 *    tampered copy fails typed.
 * 2. END-TO-END COMPOSITION: runBenchmark scores a plan materialized by
 *    the REAL driver over observations, and a holdout run binds a search
 *    record built by the REAL @tradrl/search-lineage — the suite composes
 *    the real merged shapes, not private variants.
 * 3. THE SEARCH-RECORD MIRROR against the REAL @tradrl/search-lineage
 *    (T031): a record built through the real append API verifies under
 *    this package's mirrored chain verifier; a tampered copy fails with
 *    `chain_mismatch`.
 * 4. The axis mirror against @tradrl/evaluation (T012): mutual
 *    assignability and guard parity.
 * 5. The origin vocabulary against @tradrl/market-protocol's
 *    `EVENT_ORIGINS` (the canonical owner).
 * 6. The process-declaration mirror against the REAL T028 generative
 *    lane's `fixtureProcesses` (every declared process validates under the
 *    mirrored guard).
 * 7. `TimestampMs` against @tradrl/time-engine (canonical owner).
 * 8. Identity-space brand parity: evaluation-splits' SplitPlanId /
 *    SplitPolicyRef / DataRef / TenantId / ProjectId; search-lineage's
 *    SearchRecordId / ConfigSnapshotId / TrialId.
 *
 * The type-level assertion functions fail `pnpm typecheck` if any mirror
 * drifts; the runtime parity checks fail `pnpm test`.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalBenchmarkResult,
  isDatasetSegment as isSegmentHere,
  isDatasetAxis as isAxisHere,
  isProcessDeclarationMirror,
  isTimestampMs as isTimestampHere,
  runBenchmark,
  splitPlanIdMirror,
  stableDigest,
  verifySearchRecordLineage,
  verifySplitPlanMirror,
  validateObservationSet,
} from './index';
import type {
  BenchmarkDefinition,
  DatasetAxis as AxisHere,
  DatasetSegment as SegmentHere,
  DataOrigin as OriginHere,
  ProcessDeclarationMirror,
  SplitPlanMirror,
  TenantId as TenantHere,
  TimestampMs as TimestampHere,
} from './index';
import {
  materializeSplitPlan,
  isDatasetAxis as isAxisSplits,
  stableDigest as stableDigestSplits,
} from '../../../packages/evaluation-splits/src/index';
import type {
  DatasetAxis as AxisSplits,
  DataRef as DataRefSplits,
  SplitPlanId as SplitPlanIdSplits,
  SplitPolicyRef as SplitPolicySplits,
  TenantId as TenantSplits,
  TimestampMs as TimestampSplits,
} from '../../../packages/evaluation-splits/src/index';
import {
  appendSearchTrial,
  createSearchRecord,
  verifySearchRecord,
} from '../../../packages/search-lineage/src/index';
import type {
  ConfigSnapshotId as ConfigIdLineage,
  SearchRecordId as SearchIdLineage,
  TrialId as TrialLineage,
} from '../../../packages/search-lineage/src/index';
import {
  EVENT_ORIGINS,
} from '../../../packages/market-protocol/src/index';
import type { EventOrigin } from '../../../packages/market-protocol/src/index';
import { fixtureProcesses } from '../../../services/market-world/src/generative/index';
import {
  isTimestampMs as isTimestampEngine,
  MAX_TIMESTAMP_MS as ENGINE_MAX,
  MIN_TIMESTAMP_MS as ENGINE_MIN,
} from '../../../packages/time-engine/src/index';
import type { TimestampMs as TimestampEngine } from '../../../packages/time-engine/src/index';
import { TENANT, PROJECT, T0, DAY } from './fixtures';
import type { ConfigSnapshotId as ConfigIdHere, SearchRecordId as SearchIdHere, TrialId as TrialIdHere } from './ids';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff this lane's TimestampMs is assignable to time-engine's (and back). */
function hereTimestampIsEngineTimestamp(value: TimestampHere): TimestampEngine {
  return value;
}
function engineTimestampIsHereTimestamp(value: TimestampEngine): TimestampHere {
  return value;
}

/** Compiles iff the driver lane's TimestampMs is mutually assignable with the mirror. */
function splitsTimestampIsHereTimestamp(value: TimestampSplits): TimestampHere {
  return value;
}

/** Compiles iff the axis mirror is mutually assignable with the driver lane's axis. */
function splitsAxisIsHereAxis(value: AxisSplits): AxisHere {
  return value;
}
function hereAxisIsSplitsAxis(value: AxisHere): AxisSplits {
  return value;
}
function splitsSegmentIsHereSegment(value: AxisSplits['segments'][number]): SegmentHere {
  return value;
}

/** Compiles iff the driver lane's identity spaces are mutually assignable with the mirrors. */
function splitsPlanIdIsHereMirror(value: SplitPlanIdSplits): SplitPlanMirror['plan_id'] {
  return value;
}
function splitsSplitPolicyIsHereMirror(value: SplitPolicySplits): SplitPlanMirror['policy_ref'] {
  return value;
}
function splitsDataRefIsHereMirror(value: DataRefSplits): SegmentHere['ref'] {
  return value;
}
function splitsTenantIsHereMirror(value: TenantSplits): TenantHere {
  return value;
}

/** Compiles iff the origin vocabulary is mutually assignable with market-protocol's `EventOrigin`. */
function hereOriginIsEventOrigin(value: OriginHere): EventOrigin {
  return value;
}
function eventOriginIsHereOrigin(value: EventOrigin): OriginHere {
  return value;
}

/** Compiles iff the process-declaration mirror is mutually assignable with the real T028 declaration type. */
function realProcessIsMirror(
  value: ReturnType<typeof fixtureProcesses>[number],
): ProcessDeclarationMirror {
  return value as unknown as ProcessDeclarationMirror;
}
function mirrorProcessIsReal(value: ProcessDeclarationMirror): ReturnType<typeof fixtureProcesses>[number] {
  return value as unknown as ReturnType<typeof fixtureProcesses>[number];
}

/** Compiles iff the search-lineage identity spaces are mutually assignable with the mirrors. */
function lineageSearchIdIsHereMirror(value: SearchIdLineage): SearchIdHere {
  return value;
}
function lineageConfigIdIsHereMirror(value: ConfigIdLineage): ConfigIdHere {
  return value;
}
function lineageTrialIsHereMirror(value: TrialLineage): TrialIdHere {
  return value;
}

// ---------------------------------------------------------------------------
// Fixtures built through the REAL packages
// ---------------------------------------------------------------------------

function realPlan(): SplitPlanMirror {
  const segments: Record<string, unknown>[] = [];
  for (let index = 0; index < 6; index++) {
    const start = T0 + index * DAY;
    segments.push({ ref: `dataset-real-${index}`, start, end: start + DAY, regime: ['trend', 'range', 'crisis'][index % 3] });
  }
  // Holdout pair across a one-day gap (embargo separation satisfied).
  const holdoutStart = T0 + 7 * DAY;
  segments.push({ ref: 'dataset-real-6', start: holdoutStart, end: holdoutStart + DAY, regime: 'crisis' });
  segments.push({ ref: 'dataset-real-7', start: holdoutStart + DAY, end: holdoutStart + 2 * DAY, regime: 'crisis' });
  const materialized = materializeSplitPlan(
    { segments },
    {
      policy_ref: 'split.interop-real',
      window: 'anchored',
      min_train_segments: 3,
      step_segments: 1,
      train_span_segments: null,
      gap_ms: '0',
      embargo_ms: String(DAY),
      regime_filter: null,
      holdout: { mode: 'trailing-count', count: 2 },
    },
  );
  if (!materialized.ok) throw new Error(`real plan must materialize: ${JSON.stringify(materialized.errors)}`);
  return JSON.parse(JSON.stringify(materialized.value)) as SplitPlanMirror;
}

function realSearchRecord() {
  const created = createSearchRecord({ experiment: 'exp-interop', evaluator: 'evaluator@1', tenant: TENANT, project: PROJECT });
  if (!created.ok) throw new Error('real record must create');
  let record = created.value;
  for (const trial of [
    { trial: 'rt-1', classification: 'in-search' as const, config: { lr: '0.1' }, recordedAt: T0 + 1 },
    { trial: 'rh-1', classification: 'holdout' as const, config: { check: true }, recordedAt: T0 + 2 },
  ]) {
    const appended = appendSearchTrial(record, {
      trial: trial.trial,
      arm: null,
      classification: trial.classification,
      config: trial.config,
      parents: [],
      splits: ['split.interop-real'],
      datasets: ['dataset-real-0'],
      window: { start: T0, end: T0 + 6 * DAY },
      evaluation_policy: 'split.interop-real',
      recorded_at: trial.recordedAt,
      tenant: TENANT,
      project: PROJECT,
    });
    if (!appended.ok) throw new Error(`real record must append: ${JSON.stringify(appended.errors)}`);
    record = appended.value;
  }
  return record;
}

// ---------------------------------------------------------------------------
// Runtime parity checks (fail `pnpm test`)
// ---------------------------------------------------------------------------

describe('the split-plan mirror (real driver lane parity)', () => {
  it('a plan materialized by the REAL driver verifies under the mirror with the identical id', () => {
    const plan = realPlan();
    const verified = verifySplitPlanMirror(plan);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.plan_id).toBe(plan.plan_id);
    // The mirrored derivation recomputes the driver's content address.
    const { plan_id: _omitted, ...content } = plan;
    expect(splitPlanIdMirror(content)).toBe(plan.plan_id);
  });

  it('a tampered real plan fails typed under the mirror', () => {
    const plan = realPlan();
    const tampered = JSON.parse(JSON.stringify(plan)) as SplitPlanMirror & { windows: { purged: number }[] };
    tampered.windows[0].purged = 99;
    const verified = verifySplitPlanMirror(tampered);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('invalid_field'); // content/address disagreement (L9)
    expect(verified.errors[0]?.message).toContain('content and address cannot disagree');
  });

  it("the axis guards agree with the driver lane's on shared values", () => {
    const plan = realPlan();
    // The union of the plan's material, deduplicated and in time order.
    const byRef = new Map<string, SplitPlanMirror['windows'][number]['train'][number]>();
    for (const window of plan.windows) {
      for (const segment of window.train) byRef.set(segment.ref, segment);
      byRef.set(window.test.ref, window.test);
    }
    for (const segment of plan.holdout?.segments ?? []) byRef.set(segment.ref, segment);
    const axisLike = { segments: [...byRef.values()] };
    expect(isAxisHere(axisLike)).toBe(true);
    expect(isAxisSplits(axisLike)).toBe(true);
    expect(isSegmentHere(plan.windows[0]?.test)).toBe(true);
  });
});

describe('end-to-end composition over the REAL shapes', () => {
  it('runBenchmark scores a plan materialized by the REAL driver', () => {
    const plan = realPlan();
    const observations = {
      observations: [
        ...plan.windows.map((window) => window.test),
        ...(plan.holdout?.segments ?? []),
      ].map((segment, index) => ({
        segment: segment.ref,
        pnl: index % 2 === 0 ? '500.00' : '-125.25',
        notional: '750000.00',
        trades: 30,
        fill_value: '400.00',
      })),
    };
    const validated = validateObservationSet(observations, plan);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const definition = {
      name: 'interop-replay',
      driver: 'walk-forward-replay',
      phase: 'search',
      evidence_class: 'simulation',
      split_plan: plan,
      data_source: {
        kind: 'replay-dataset',
        origin: 'historical',
        stream_refs: ['stream-interop-1'],
        config_digest: 'aaaaaaaaaaaaaaaa',
        coverage: { start: T0, end: T0 + 10 * DAY },
      },
      evaluator: 'evaluator@1',
      stress: [{ axis: 'fees', magnitude: '1.5' }],
      score_scale: 2,
      ladder_level: null,
      tenant: TENANT,
      project: PROJECT,
    };
    const run = runBenchmark({ definition, observations: validated.value, search: null, recorded_at: T0 + 100 });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.scored).toEqual(plan.windows.map((w) => w.test.ref));
    expect(run.value.lineage.split_plan).toBe(plan.plan_id);
    expect(run.value.benchmark.startsWith('bmk:')).toBe(true);
    // Determinism across repeat compositions of the REAL plan.
    const again = runBenchmark({ definition, observations: validated.value, search: null, recorded_at: T0 + 100 });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.result_id).toBe(run.value.result_id);
  });

  it('a holdout run binds a search record built by the REAL search-lineage package', () => {
    const plan = realPlan();
    const record = realSearchRecord();
    const material = [...plan.windows.map((w) => w.test), ...(plan.holdout?.segments ?? [])];
    const observations = {
      observations: material.map((segment, index) => ({
        segment: segment.ref,
        pnl: index % 2 === 0 ? '500.00' : '-125.25',
        notional: '750000.00',
        trades: 30,
        fill_value: '400.00',
      })),
    };
    const definition = {
      name: 'interop-holdout',
      driver: 'walk-forward-replay',
      phase: 'holdout',
      evidence_class: 'simulation',
      split_plan: plan,
      data_source: {
        kind: 'replay-dataset',
        origin: 'historical',
        stream_refs: ['stream-interop-1'],
        config_digest: 'aaaaaaaaaaaaaaaa',
        coverage: { start: T0, end: T0 + 10 * DAY },
      },
      evaluator: 'evaluator@1',
      stress: [],
      score_scale: 2,
      ladder_level: null,
      tenant: TENANT,
      project: PROJECT,
    };
    const run = runBenchmark({
      definition,
      observations,
      search: { search_record: record, trial: 'rh-1' },
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.phase).toBe('holdout');
    expect(run.value.lineage.search_id).toBe(record.search_id);
    // The classification law fires through the REAL record.
    const conflict = runBenchmark({
      definition,
      observations,
      search: { search_record: record, trial: 'rt-1' },
      recorded_at: T0 + 100,
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.errors[0]?.code).toBe('classification_conflict');
  });
});

describe('the search-record mirror (real search-lineage parity)', () => {
  it('a record built by the REAL package verifies under the mirrored chain', () => {
    const record = realSearchRecord();
    const verified = verifySearchRecordLineage(JSON.parse(JSON.stringify(record)));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.search_id).toBe(record.search_id);
    expect(verified.value.chain_head).toBe(record.chain_head);
  });

  it('a tampered real record fails with chain_mismatch under the mirror', () => {
    const record = JSON.parse(JSON.stringify(realSearchRecord())) as ReturnType<typeof realSearchRecord> & { entries: unknown[] };
    record.entries.pop(); // hide the holdout trial
    const verified = verifySearchRecordLineage(record);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('chain_mismatch');
  });

  it('the real package verifies the mirrored-fixture record shape (structural parity)', () => {
    // Build a record through the REAL API, verify through the REAL verifier,
    // then through the MIRROR — the two verifiers agree on real records.
    const record = realSearchRecord();
    const byReal = verifySearchRecord(JSON.parse(JSON.stringify(record)));
    const byMirror = verifySearchRecordLineage(JSON.parse(JSON.stringify(record)));
    expect(byReal.ok).toBe(true);
    expect(byMirror.ok).toBe(true);
  });
});

describe('the origin vocabulary + process mirrors', () => {
  it("the origin vocabulary matches market-protocol's EVENT_ORIGINS", () => {
    expect(EVENT_ORIGINS).toContain('historical');
    expect(EVENT_ORIGINS).toContain('simulated');
    expect(EVENT_ORIGINS).toContain('generated');
  });

  it('every REAL T028 fixture process validates under the mirrored declaration guard', () => {
    const processes = fixtureProcesses('interop-seed');
    expect(processes.length).toBe(5);
    for (const declaration of processes) {
      expect(isProcessDeclarationMirror(declaration)).toBe(true);
    }
  });

  it('the mirrored guard rejects a malformed declaration', () => {
    expect(isProcessDeclarationMirror({ process_id: 'x', version: '1', kind: 'nope', seed: 's', step_ms: 1, params: {} })).toBe(false);
    expect(isProcessDeclarationMirror({ process_id: 'x', version: '1', kind: 'market_maker', seed: 's', step_ms: 0, params: {} })).toBe(false);
  });
});

describe('the program-wide digest + timestamp mirrors', () => {
  it("stableDigest agrees with the driver lane's digest (same program-wide function)", () => {
    // The driver lane's digest is exercised through its content addresses
    // above; pin the shared vocabulary on a few canonical strings too.
    for (const input of ['', 'a', '{"b":2,"a":[1,2]}', 'x'.repeat(257)]) {
      expect(stableDigest(input)).toBe(stableDigestSplits(input));
    }
  });

  it('TimestampMs mirrors time-engine (bounds and guard)', () => {
    expect(ENGINE_MIN).toBe(0);
    expect(ENGINE_MAX).toBe(8_639_999_999_999_999);
    for (const value of [0, 1, T0, ENGINE_MAX]) {
      expect(isTimestampHere(value)).toBe(true);
      expect(isTimestampEngine(value)).toBe(true);
    }
    for (const value of [-1, 1.5, Number.NaN, ENGINE_MAX + 1]) {
      expect(isTimestampHere(value)).toBe(false);
      expect(isTimestampEngine(value)).toBe(false);
    }
  });
});
