/**
 * @tradrl/research-benchmarks — the MANIFEST binding laws (Work Order T032;
 * L9/L15: every entry binds its split plan, data/regime source, evaluator
 * and result records).
 *
 * Laws under test:
 * - the honest manifest compiles content-addressed (`bmfm:<digest>`) and
 *   round-trips through `verifyBenchmarkManifest`;
 * - `result_binding_mismatch` — a result bound under the wrong benchmark;
 * - `manifest_binding_mismatch` — a result whose lineage names a different
 *   split plan or data source than the entry binds;
 * - `scale_mismatch` — a result whose score is not at its benchmark's
 *   declared score scale;
 * - `tenant_mismatch` — a definition or result crossing the manifest scope;
 * - the manifest id law (content and address cannot disagree, L9).
 */

import { describe, expect, it } from 'vitest';

import { benchmarkResultId, compileBenchmarkManifest, runBenchmark, verifyBenchmarkManifest } from './index';
import type { BenchmarkResultRecord, TimestampMs } from './index';
import { requireTimestampMs } from './index';
import { TENANT, PROJECT, T0, fixturePlan, fixtureReplaySource, fixtureObservations } from './fixtures';

function definition(): Record<string, unknown> {
  const source = fixtureReplaySource();
  if (!source.ok) throw new Error('fixture source must validate');
  return {
    name: 'manifest-fixture',
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

function compiled(): BenchmarkResultRecord {
  const run = runBenchmark({
    definition: definition(),
    observations: fixtureObservations(fixturePlan()),
    search: null,
    recorded_at: T0 + 100,
  });
  if (!run.ok) throw new Error('fixture must run');
  return run.value;
}

function manifestInput(overrides: Record<string, unknown> = {}) {
  return {
    tenant: TENANT,
    project: PROJECT,
    evidence_class: 'simulation',
    created_at: T0 + 200,
    benchmarks: [{ definition: definition(), results: [compiled()] }],
    ...overrides,
  };
}

describe('the honest manifest', () => {
  it('compiles content-addressed and binds everything it judged', () => {
    const manifest = compileBenchmarkManifest(manifestInput());
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    const entry = manifest.value.entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(entry.benchmark.startsWith('bmk:')).toBe(true);
    expect(entry.split_plan.plan_id.startsWith('splan:')).toBe(true);
    expect(entry.split_plan.plan_digest).toMatch(/^[0-9a-f]{16}$/);
    expect(entry.data_source.kind).toBe('replay-dataset');
    expect(entry.data_source.origin).toBe('historical');
    expect(entry.evaluator).toBe('evaluator@1');
    expect(entry.results[0]?.result_id).toBe(compiled().result_id);
    expect(manifest.value.manifest_id.startsWith('bmfm:')).toBe(true);
  });

  it('round-trips through verifyBenchmarkManifest', () => {
    const manifest = compileBenchmarkManifest(manifestInput());
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    const verified = verifyBenchmarkManifest(JSON.parse(JSON.stringify(manifest.value)));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.manifest_id).toBe(manifest.value.manifest_id);
  });
});

describe('the binding laws', () => {
  it('fails result_binding_mismatch when a result is bound under the wrong benchmark', () => {
    // A second, different definition (different name -> different id).
    const otherDefinition = definition();
    (otherDefinition as Record<string, unknown>).name = 'manifest-fixture-2';
    const manifest = compileBenchmarkManifest({
      ...manifestInput(),
      benchmarks: [{ definition: otherDefinition, results: [compiled()] }],
    });
    expect(manifest.ok).toBe(false);
    if (manifest.ok) return;
    expect(manifest.errors[0]?.code).toBe('result_binding_mismatch');
  });

  it('fails manifest_binding_mismatch when a result lineage names a different split plan', () => {
    const result = compiled();
    const forgedContent = {
      ...(result as unknown as Record<string, unknown>),
      lineage: {
        ...(result.lineage as unknown as Record<string, unknown>),
        split_plan: 'splan:0000000000000000',
      },
    };
    delete (forgedContent as { result_id?: string }).result_id;
    const forged = { result_id: benchmarkResultId(forgedContent as Parameters<typeof benchmarkResultId>[0]), ...forgedContent };
    const manifest = compileBenchmarkManifest({
      ...manifestInput(),
      benchmarks: [{ definition: definition(), results: [forged] }],
    });
    expect(manifest.ok).toBe(false);
    if (manifest.ok) return;
    expect(manifest.errors[0]?.code).toBe('manifest_binding_mismatch');
    expect(manifest.errors[0]?.message).toContain('designs they did not run under');
  });

  it('fails scale_mismatch when a result score is not at the declared scale', () => {
    const result = compiled();
    const forgedContent = {
      ...(result as unknown as Record<string, unknown>),
      aggregate_score: '12.345678', // scale 6, not the declared 2
    };
    delete (forgedContent as { result_id?: string }).result_id;
    const forged = { result_id: benchmarkResultId(forgedContent as Parameters<typeof benchmarkResultId>[0]), ...forgedContent };
    const manifest = compileBenchmarkManifest({
      ...manifestInput(),
      benchmarks: [{ definition: definition(), results: [forged] }],
    });
    expect(manifest.ok).toBe(false);
    if (manifest.ok) return;
    expect(manifest.errors[0]?.code).toBe('scale_mismatch');
  });

  it('fails tenant_mismatch when a definition crosses the manifest scope', () => {
    const foreignDefinition = definition();
    (foreignDefinition as Record<string, unknown>).tenant = 'tenant-other';
    const manifest = compileBenchmarkManifest({
      ...manifestInput(),
      benchmarks: [{ definition: foreignDefinition, results: [compiled()] }],
    });
    expect(manifest.ok).toBe(false);
    if (manifest.ok) return;
    expect(manifest.errors.some((e) => e.code === 'invalid_field' && e.message.includes('(L12)'))).toBe(true);
  });

  it('rejects a forged manifest id (content and address cannot disagree)', () => {
    const manifest = compileBenchmarkManifest(manifestInput({ manifest_id: 'bmfm:0000000000000000' }));
    expect(manifest.ok).toBe(false);
    if (manifest.ok) return;
    expect(manifest.errors[0]?.message).toContain('content and address cannot disagree');
  });

  it('verifyBenchmarkManifest rejects a mutated manifest', () => {
    const manifest = compileBenchmarkManifest(manifestInput());
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    const tampered = JSON.parse(JSON.stringify(manifest.value)) as typeof manifest.value & { created_at: TimestampMs };
    tampered.created_at = requireTimestampMs(T0 + 999);
    const verified = verifyBenchmarkManifest(tampered);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.message).toContain('content and address cannot disagree');
  });
});
