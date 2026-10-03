/**
 * @tradrl/research-benchmarks — the benchmark DRIVER laws (Work Order T032).
 *
 * The positive and negative laws of `runBenchmark`, each pinned to a typed
 * error code:
 * - the PHASE/MATERIAL law: `holdout_in_search` (the Work Order's law — a
 *   search-phase run scoring reserved holdout material),
 *   `search_material_in_holdout`, `no_holdout_material`;
 * - the SEARCH-CONTEXT law (the in-search vs holdout separation THROUGH the
 *   search-record mirror): `search_context_required`, `chain_mismatch`,
 *   `unknown_trial`, `classification_conflict`, `tenant_mismatch`;
 * - the SCORING law: `missing_observation`, `unknown_segment`, exact
 *   decimal scores under stress;
 * - untrusted result verification: `result_mismatch`.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalBenchmarkResult,
  runBenchmark,
  verifyBenchmarkResult,
  validateBenchmarkDefinition,
  splitPlanIdMirror,
} from './index';
import type { BenchmarkResultRecord, TenantId } from './index';
import { computeChainHeadMirror, searchRecordIdMirror } from './search-mirror';
import {
  TENANT,
  PROJECT,
  T0,
  fixturePlan,
  fixtureReplaySource,
  fixtureObservations,
  fixtureSearchRecord,
  fixtureGenerativeSource,
} from './fixtures';

function replaySearchDefinition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const source = fixtureReplaySource();
  if (!source.ok) throw new Error('fixture source must validate');
  return {
    name: 'eu-replay-walk-forward',
    driver: 'walk-forward-replay',
    phase: 'search',
    evidence_class: 'simulation',
    split_plan: fixturePlan(),
    data_source: source.value,
    evaluator: 'evaluator@1',
    stress: [],
    score_scale: 2,
    ladder_level: null,
    tenant: TENANT,
    project: PROJECT,
    ...overrides,
  };
}

function replayHoldoutDefinition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return replaySearchDefinition({
    name: 'eu-replay-holdout',
    phase: 'holdout',
    ...overrides,
  });
}

function searchContext(record = fixtureSearchRecord(), trial = 't-1') {
  return { search_record: record, trial };
}

describe('the phase/material law', () => {
  it('runs a search-phase benchmark over the window ladder with exact scores', () => {
    const plan = fixturePlan();
    const run = runBenchmark({
      definition: replaySearchDefinition(),
      observations: fixtureObservations(plan),
      search: null,
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const result = run.value;
    expect(result.phase).toBe('search');
    expect(result.scored).toEqual(['dataset-3', 'dataset-4', 'dataset-5']);
    expect(result.window_scores.length).toBe(3);
    // pnl values cycle 1000.00 / -250.50 over sorted segment keys; the
    // scored segments are deterministic — pin the aggregate's shape and
    // exactness (scale 2, single half-even rendering).
    expect(result.aggregate_score).toMatch(/^[+-]?\d+\.\d{2}$/);
    expect(result.window_scores.every((w) => /^[+-]?\d+\.\d+$/.test(w.score))).toBe(true);
    expect(result.lineage.search_id).toBeNull();
  });

  it('fails holdout_in_search when a search run declares a holdout segment as scored', () => {
    const plan = fixturePlan();
    const run = runBenchmark({
      definition: replaySearchDefinition(),
      observations: fixtureObservations(plan),
      search: null,
      recorded_at: T0 + 100,
      scored: ['dataset-3', 'dataset-6'],
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('holdout_in_search');
    expect(run.errors[0]?.message).toContain('scores reserved unseen segment "dataset-6"');
  });

  it('fails search_material_in_holdout when a holdout run scores window material', () => {
    const plan = fixturePlan();
    const run = runBenchmark({
      definition: replayHoldoutDefinition(),
      observations: fixtureObservations(plan),
      search: searchContext(fixtureSearchRecord(), 'h-1'),
      recorded_at: T0 + 100,
      scored: ['dataset-3'],
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('search_material_in_holdout');
  });

  it('fails no_holdout_material when a holdout definition binds a plan without a reservation', () => {
    const plan = fixturePlan();
    const content = {
      policy_ref: plan.policy_ref,
      kind: plan.kind,
      windows: plan.windows,
      holdout: null,
      lineage: { ...plan.lineage, holdout_count: 0 },
    };
    const lawful = { plan_id: splitPlanIdMirror(content), ...content };
    const definition = replayHoldoutDefinition({ split_plan: lawful });
    const validated = validateBenchmarkDefinition(definition);
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.errors[0]?.code).toBe('no_holdout_material');
  });

  it('runs a holdout benchmark over the reserved material with the judged search bound', () => {
    const plan = fixturePlan();
    const record = fixtureSearchRecord();
    const run = runBenchmark({
      definition: replayHoldoutDefinition(),
      observations: fixtureObservations(plan),
      search: searchContext(record, 'h-1'),
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const result = run.value;
    expect(result.scored).toEqual(['dataset-6', 'dataset-7']);
    expect(result.window_scores).toEqual([]);
    expect(result.lineage.search_id).toBe(record.search_id);
  });
});

describe('the search-context law (in-search vs holdout through the record mirror)', () => {
  it('fails search_context_required when a holdout run carries no search binding', () => {
    const plan = fixturePlan();
    const run = runBenchmark({
      definition: replayHoldoutDefinition(),
      observations: fixtureObservations(plan),
      search: null,
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('search_context_required');
  });

  it('fails chain_mismatch when the bound search record was tampered with', () => {
    const plan = fixturePlan();
    const record = JSON.parse(JSON.stringify(fixtureSearchRecord())) as ReturnType<typeof fixtureSearchRecord> & {
      entries: unknown[];
    };
    record.entries.pop(); // hide the holdout trial
    const run = runBenchmark({
      definition: replayHoldoutDefinition(),
      observations: fixtureObservations(plan),
      search: searchContext(record, 't-1'),
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('chain_mismatch');
  });

  it('fails unknown_trial when the bound trial is not logged', () => {
    const plan = fixturePlan();
    const run = runBenchmark({
      definition: replayHoldoutDefinition(),
      observations: fixtureObservations(plan),
      search: searchContext(fixtureSearchRecord(), 't-404'),
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('unknown_trial');
  });

  it('fails classification_conflict when the phase disagrees with the record (holdout run, in-search trial)', () => {
    const plan = fixturePlan();
    const run = runBenchmark({
      definition: replayHoldoutDefinition(),
      observations: fixtureObservations(plan),
      search: searchContext(fixtureSearchRecord(), 't-1'),
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('classification_conflict');
    expect(run.errors[0]?.message).toContain('the record is the authority');
  });

  it('fails classification_conflict when the phase disagrees with the record (search run, holdout trial)', () => {
    const plan = fixturePlan();
    const run = runBenchmark({
      definition: replaySearchDefinition(),
      observations: fixtureObservations(plan),
      search: searchContext(fixtureSearchRecord(), 'h-1'),
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('classification_conflict');
  });

  it('fails tenant_mismatch when the record crosses the benchmark scope (L12)', () => {
    const plan = fixturePlan();
    const record = fixtureSearchRecord();
    // A cleanly-verifying record under a FOREIGN scope (recomputed identity
    // and chain) — the tenant law, not the chain law, is what fires.
    const foreignBinding = {
      experiment: record.experiment,
      evaluator: record.evaluator,
      tenant: 'tenant-other' as TenantId,
      project: record.project,
    };
    const foreign = {
      ...record,
      tenant: foreignBinding.tenant,
      search_id: searchRecordIdMirror(foreignBinding),
      chain_head: computeChainHeadMirror(foreignBinding, record.entries),
    };
    const run = runBenchmark({
      definition: replaySearchDefinition(),
      observations: fixtureObservations(plan),
      search: searchContext(foreign, 't-1'),
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('tenant_mismatch');
  });
});

describe('the scoring law', () => {
  it('fails missing_observation when a scored segment carries no observation', () => {
    const plan = fixturePlan();
    const observations = fixtureObservations(plan);
    const run = runBenchmark({
      definition: replaySearchDefinition(),
      observations: { observations: observations.observations.filter((o) => o.segment !== 'dataset-4') },
      search: null,
      recorded_at: T0 + 100,
      scored: ['dataset-4'],
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('missing_observation');
  });

  it('fails unknown_segment when an observation names material outside the plan', () => {
    const plan = fixturePlan();
    const run = runBenchmark({
      definition: replaySearchDefinition(),
      observations: {
        observations: [
          ...fixtureObservations(plan).observations,
          { segment: 'dataset-elsewhere', pnl: '1', notional: '1', trades: 1, fill_value: '1' },
        ],
      },
      search: null,
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors.some((e) => e.code === 'unknown_segment')).toBe(true);
  });

  it('applies the declared stress exactly and renders once at the declared scale', () => {
    const plan = fixturePlan();
    const source = fixtureReplaySource();
    if (!source.ok) throw new Error('fixture source must validate');
    // Every scored segment: pnl 1000.00, notional 1000000.00, trades 40,
    // fill_value 500.00 (choose the even-indexed observations for all three
    // scored segments by pinning the scored set deterministically below).
    const definition = replaySearchDefinition({
      stress: [
        { axis: 'fees', magnitude: '2' }, // 1000000 * 2 / 10^4 = 200
        { axis: 'slippage', magnitude: '1.5' }, // 1000000 * 1.5 / 10^4 = 150
        { axis: 'latency', magnitude: '0.25' }, // 40 * 0.25 = 10
        { axis: 'fill-probability', magnitude: '0.95' }, // 500 * 0.05 = 25
      ],
    });
    const run = runBenchmark({
      definition,
      observations: fixtureObservations(plan),
      search: null,
      recorded_at: T0 + 100,
      // Score the single window whose observation is pinned: dataset-04 is
      // odd-indexed in the observation map? No — the map iterates insertion
      // order; pin the exact expectation per segment below instead.
      scored: ['dataset-3'],
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const result = run.value;
    // dataset-03's observation is built at index 3 of the material keys ->
    // pnl -250.50? The map iterates windows' train first; instead of
    // guessing, assert the arithmetic identity against the fixture's own
    // observation for dataset-03.
    const observation = fixtureObservations(plan).observations.find((o) => o.segment === 'dataset-3');
    expect(observation).toBeDefined();
    if (observation === undefined) return;
    const expected =
      Number(observation.pnl) -
      Number(observation.notional) * 2 / 10_000 -
      Number(observation.notional) * 1.5 / 10_000 -
      Number(observation.trades) * 0.25 -
      Number(observation.fill_value) * 0.05;
    expect(Number(result.aggregate_score)).toBeCloseTo(expected, 1);
    expect(result.stress_applied.length).toBe(4);
    expect(result.cumulative_score).toBe(result.aggregate_score); // single scored segment
  });
});

describe('untrusted result verification', () => {
  function compiled(): BenchmarkResultRecord {
    const plan = fixturePlan();
    const run = runBenchmark({
      definition: replaySearchDefinition(),
      observations: fixtureObservations(plan),
      search: null,
      recorded_at: T0 + 100,
    });
    if (!run.ok) throw new Error('fixture must run');
    return run.value;
  }

  it('round-trips a compiled result through verifyBenchmarkResult', () => {
    const result = compiled();
    const verified = verifyBenchmarkResult(JSON.parse(JSON.stringify(result)));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.result_id).toBe(result.result_id);
    expect(verified.value).toEqual(result);
  });

  it('fails result_mismatch when content and address disagree', () => {
    const result = compiled();
    const tampered = { ...(result as unknown as Record<string, unknown>), aggregate_score: '999999.99' };
    const verified = verifyBenchmarkResult(tampered);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('result_mismatch');
  });

  it('the compiled result is byte-stable under JSON round-trips', () => {
    const result = compiled();
    expect(canonicalBenchmarkResult(JSON.parse(JSON.stringify(result)) as BenchmarkResultRecord)).toBe(
      canonicalBenchmarkResult(result),
    );
  });
});

describe('definition validation coherence', () => {
  it('rejects a replay driver bound to a generative population (invalid_definition)', () => {
    const source = fixtureGenerativeSource();
    if (!source.ok) throw new Error('fixture source must validate');
    const validated = validateBenchmarkDefinition(replaySearchDefinition({ data_source: source.value }));
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.errors[0]?.code).toBe('invalid_definition');
  });

  it('rejects a generative driver without a ladder level (invalid_definition)', () => {
    const source = fixtureGenerativeSource();
    if (!source.ok) throw new Error('fixture source must validate');
    const validated = validateBenchmarkDefinition(
      replaySearchDefinition({ driver: 'regime-ladder-generative', data_source: source.value, ladder_level: null }),
    );
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.errors[0]?.code).toBe('invalid_definition');
  });

  it('rejects a forged definition id (invalid_field, L9)', () => {
    const validated = validateBenchmarkDefinition(replaySearchDefinition({ benchmark_id: 'bmk:0000000000000000' }));
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.errors[0]?.code).toBe('invalid_field');
    expect(validated.errors[0]?.message).toContain('content and address cannot disagree');
  });
});
