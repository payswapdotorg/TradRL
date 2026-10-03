/**
 * @tradrl/research-benchmarks — the RESULT LOG laws (Work Order T032, L11).
 *
 * Laws under test:
 * - the log is append-only: entries grow ONLY through appendBenchmarkResult
 *   and the original log is never mutated;
 * - `duplicate_result` — one result id, one entry (no rewrites);
 * - `tenant_mismatch` — results never cross the log's scope (L12);
 * - `result_mismatch` — untrusted appended records whose content and
 *   address disagree (L9);
 * - `chain_mismatch` — a substituted result, a REORDERED log and a HIDDEN
 *   (truncated) result all break the recomputed head;
 * - ordered appends (L4).
 */

import { describe, expect, it } from 'vitest';

import {
  appendBenchmarkResult,
  canonicalResultLog,
  createResultLog,
  runBenchmark,
  verifyResultLog,
} from './index';
import type { BenchmarkResultLog, BenchmarkResultRecord, Mutable } from './index';
import { TENANT, PROJECT, T0, DAY, fixturePlan, fixtureReplaySource, fixtureObservations } from './fixtures';

function definition(): Record<string, unknown> {
  const source = fixtureReplaySource();
  if (!source.ok) throw new Error('fixture source must validate');
  return {
    name: 'log-fixture',
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
  };
}

function result(instant: number, name = 'log-fixture'): BenchmarkResultRecord {
  const run = runBenchmark({
    definition: { ...definition(), name },
    observations: fixtureObservations(fixturePlan()),
    search: null,
    recorded_at: instant,
  });
  if (!run.ok) throw new Error('fixture must run');
  return run.value;
}

function build(): BenchmarkResultLog {
  let log = createResultLog({ tenant: TENANT, project: PROJECT });
  if (!log.ok) throw new Error('fixture must create');
  const first = appendBenchmarkResult(log.value, { result: result(T0) });
  if (!first.ok) throw new Error('fixture must append');
  const second = appendBenchmarkResult(first.value, { result: result(T0 + DAY, 'log-fixture-2') });
  if (!second.ok) throw new Error('fixture must append');
  return second.value;
}

describe('append-only construction', () => {
  it('appends grow the log without mutating the original', () => {
    const open = createResultLog({ tenant: TENANT, project: PROJECT });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    const appended = appendBenchmarkResult(open.value, { result: result(T0) });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(open.value.entries.length).toBe(0);
    expect(appended.value.entries.length).toBe(1);
    expect(appended.value.chain_head).not.toBe(open.value.chain_head);
  });

  it('fails duplicate_result when the same result is appended twice', () => {
    const log = build();
    const again = appendBenchmarkResult(log, { result: log.entries[0] as BenchmarkResultRecord });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.errors[0]?.code).toBe('duplicate_result');
    expect(again.errors[0]?.message).toContain('append-only');
  });

  it('fails tenant_mismatch when a result crosses the log scope (L12)', () => {
    const open = createResultLog({ tenant: 'tenant-other', project: PROJECT });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    const appended = appendBenchmarkResult(open.value, { result: result(T0) });
    expect(appended.ok).toBe(false);
    if (appended.ok) return;
    expect(appended.errors[0]?.code).toBe('tenant_mismatch');
  });

  it('fails result_mismatch when an untrusted result lies about its address', () => {
    const open = createResultLog({ tenant: TENANT, project: PROJECT });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    const honest = result(T0);
    const liar = { ...honest, result_id: 'bres:0000000000000000' };
    const appended = appendBenchmarkResult(open.value, { result: liar });
    expect(appended.ok).toBe(false);
    if (appended.ok) return;
    expect(appended.errors[0]?.code).toBe('result_mismatch');
  });
});

describe('chain verification (fail-closed)', () => {
  it('verifies the honest log', () => {
    const log = build();
    const verified = verifyResultLog(JSON.parse(JSON.stringify(log)));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.chain_head).toBe(log.chain_head);
  });

  it('fails chain_mismatch when a stored result is substituted by a different valid result', () => {
    const log = build();
    const substituted = JSON.parse(JSON.stringify(log)) as Mutable<BenchmarkResultLog>;
    const entries = substituted.entries.slice();
    const originalInstant = entries[0]?.recorded_at;
    entries[0] = { ...result(T0, 'log-fixture-3'), recorded_at: originalInstant };
    substituted.entries = entries;
    const verified = verifyResultLog(substituted);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('chain_mismatch');
  });

  it('fails chain_mismatch when the results are swapped between entries (order law)', () => {
    // Two results at the SAME instant (swap-able without touching any
    // result's own content), so each swapped entry stays self-consistent
    // and the CHAIN order law is what breaks.
    let log = createResultLog({ tenant: TENANT, project: PROJECT });
    if (!log.ok) throw new Error('fixture must create');
    const firstAppend = appendBenchmarkResult(log.value, { result: result(T0, 'log-fixture') });
    if (!firstAppend.ok) throw new Error('fixture must append');
    const secondAppend = appendBenchmarkResult(firstAppend.value, { result: result(T0, 'log-fixture-2') });
    if (!secondAppend.ok) throw new Error('fixture must append');
    const swapped = JSON.parse(JSON.stringify(secondAppend.value)) as Mutable<BenchmarkResultLog>;
    const first = swapped.entries[0];
    const second = swapped.entries[1];
    if (first === undefined || second === undefined) throw new Error('fixture needs two entries');
    swapped.entries = [second, first];
    const verified = verifyResultLog(swapped);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('chain_mismatch');
  });

  it('fails chain_mismatch when a result is hidden (truncated)', () => {
    const log = build();
    const truncated = JSON.parse(JSON.stringify(log)) as Mutable<BenchmarkResultLog>;
    truncated.entries = truncated.entries.slice(0, 1);
    const verified = verifyResultLog(truncated);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('chain_mismatch');
    expect(verified.errors[0]?.message).toContain('truncated');
  });

  it("the log's canonical bytes are stable under JSON round-trips", () => {
    const log = build();
    expect(canonicalResultLog(JSON.parse(JSON.stringify(log)) as BenchmarkResultLog)).toBe(canonicalResultLog(log));
  });
});
