/**
 * @tradrl/research-benchmarks — determinism tests (the Engineering Protocol
 * law: "identical inputs -> identical bytes").
 *
 * Laws under test:
 * - the SAME (definition, observations, search context, injected instant)
 *   always compiles the byte-identical result record with the identical
 *   content-addressed result id;
 * - a changed observation, definition field, scored subset or injected
 *   instant changes the bytes AND the id;
 * - the result log's chain head is a pure function of the binding and the
 *   appended results;
 * - the manifest's content address is a pure function of its bound content;
 * - no ambient clock: every instant in these records came from literals.
 */

import { describe, expect, it } from 'vitest';

import {
  appendBenchmarkResult,
  benchmarkId,
  canonicalBenchmarkResult,
  compileBenchmarkManifest,
  createResultLog,
  runBenchmark,
} from './index';
import type { BenchmarkResultRecord, EvaluatorVersionRef } from './index';
import { TENANT, PROJECT, T0, DAY, fixturePlan, fixtureReplaySource, fixtureObservations, fixtureSearchRecord } from './fixtures';

function definition(): Record<string, unknown> {
  const source = fixtureReplaySource();
  if (!source.ok) throw new Error('fixture source must validate');
  return {
    name: 'det-fixture',
    driver: 'walk-forward-replay',
    phase: 'search',
    evidence_class: 'simulation',
    split_plan: fixturePlan(),
    data_source: source.value,
    evaluator: 'evaluator@1',
    stress: [{ axis: 'fees', magnitude: '2' }],
    score_scale: 2,
    ladder_level: null,
    tenant: TENANT,
    project: PROJECT,
  };
}

function run(): BenchmarkResultRecord {
  const result = runBenchmark({
    definition: definition(),
    observations: fixtureObservations(fixturePlan()),
    search: null,
    recorded_at: T0 + 100,
  });
  if (!result.ok) throw new Error('fixture must run');
  return result.value;
}

describe('result byte determinism', () => {
  it('the same inputs compile identical canonical bytes and id (repeatedly)', () => {
    const first = run();
    const firstBytes = canonicalBenchmarkResult(first);
    for (let round = 0; round < 5; round++) {
      const again = run();
      expect(canonicalBenchmarkResult(again)).toBe(firstBytes);
      expect(again.result_id).toBe(first.result_id);
      expect(again).toEqual(first);
    }
  });

  it('a changed observation changes the bytes and the id', () => {
    const base = run();
    const observations = fixtureObservations(fixturePlan());
    const mutated = {
      observations: observations.observations.map((o) =>
        o.segment === 'dataset-3' ? { ...o, pnl: '42.00' } : o,
      ),
    };
    const other = runBenchmark({
      definition: definition(),
      observations: mutated,
      search: null,
      recorded_at: T0 + 100,
    });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(canonicalBenchmarkResult(other.value)).not.toBe(canonicalBenchmarkResult(base));
    expect(other.value.result_id).not.toBe(base.result_id);
  });

  it('a changed injected instant changes the bytes and the id (L4)', () => {
    const base = run();
    const other = runBenchmark({
      definition: definition(),
      observations: fixtureObservations(fixturePlan()),
      search: null,
      recorded_at: T0 + 101,
    });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.value.result_id).not.toBe(base.result_id);
  });

  it('a changed definition field changes the benchmark id and the result bytes', () => {
    const base = run();
    const other = runBenchmark({
      definition: { ...definition(), stress: [] },
      observations: fixtureObservations(fixturePlan()),
      search: null,
      recorded_at: T0 + 100,
    });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.value.benchmark).not.toBe(base.benchmark);
    expect(canonicalBenchmarkResult(other.value)).not.toBe(canonicalBenchmarkResult(base));
  });

  it('the benchmark definition id is a pure function of the content', () => {
    const source = fixtureReplaySource();
    if (!source.ok) throw new Error('fixture source must validate');
    const content = {
      name: 'det-fixture',
      driver: 'walk-forward-replay' as const,
      phase: 'search' as const,
      evidence_class: 'simulation' as const,
      split_plan: fixturePlan(),
      data_source: source.value,
      evaluator: 'evaluator@1' as EvaluatorVersionRef,
      stress: [{ axis: 'fees' as const, magnitude: '2' }],
      score_scale: 2,
      ladder_level: null,
      tenant: TENANT,
      project: PROJECT,
    };
    expect(benchmarkId(content)).toBe(benchmarkId(JSON.parse(JSON.stringify(content))));
  });
});

describe('holdout-run determinism', () => {
  it('the same holdout inputs compile identical bytes', () => {
    const compile = () => {
      const result = runBenchmark({
        definition: { ...definition(), phase: 'holdout', name: 'det-holdout' },
        observations: fixtureObservations(fixturePlan()),
        search: { search_record: fixtureSearchRecord(), trial: 'h-1' },
        recorded_at: T0 + 300,
      });
      if (!result.ok) throw new Error('fixture must run');
      return result.value;
    };
    const first = compile();
    for (let round = 0; round < 3; round++) {
      expect(canonicalBenchmarkResult(compile())).toBe(canonicalBenchmarkResult(first));
    }
  });
});

describe('log and manifest determinism', () => {
  it('the same appends produce the identical log bytes and chain head', () => {
    const build = () => {
      let log = createResultLog({ tenant: TENANT, project: PROJECT });
      if (!log.ok) throw new Error('fixture must create');
      let instant = T0;
      for (const name of ['det-a', 'det-b']) {
        const compiled = runBenchmark({
          definition: { ...definition(), name },
          observations: fixtureObservations(fixturePlan()),
          search: null,
          recorded_at: instant,
        });
        if (!compiled.ok) throw new Error('fixture must run');
        const appended = appendBenchmarkResult(log.value, { result: compiled.value });
        if (!appended.ok) throw new Error('fixture must append');
        log = { ok: true as const, value: appended.value };
        instant += DAY;
      }
      return log.value;
    };
    const first = build();
    for (let round = 0; round < 2; round++) {
      expect(JSON.stringify(build())).toBe(JSON.stringify(first));
    }
  });

  it('the manifest content address is a pure function of the bound content', () => {
    const compile = () =>
      compileBenchmarkManifest({
        tenant: TENANT,
        project: PROJECT,
        evidence_class: 'simulation',
        created_at: T0 + 400,
        benchmarks: [
          {
            definition: definition(),
            results: [run()],
          },
        ],
      });
    const first = compile();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = compile();
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.manifest_id).toBe(first.value.manifest_id);
    expect(JSON.stringify(again.value)).toBe(JSON.stringify(first.value));
  });
});
