/**
 * @tradrl/research-benchmarks — the EVIDENCE CLASS laws (Work Order T032;
 * spec/EVALUATION-PROTOCOL.md: "Simulation evidence and live evidence are
 * never conflated").
 *
 * Laws under test (each typed, at the definition and manifest levels):
 * - `live_claim_on_simulation` — live evidence claimed over GENERATED
 *   origin (a synthetic world is never live execution evidence, L5/L6);
 * - `evidence_conflated` — live class over a replay source; simulation
 *   class over a live session; manifest class vs bound definition class;
 *   manifest class vs bound result class.
 */

import { describe, expect, it } from 'vitest';

import { validateBenchmarkDefinition, validateLiveSessionSource, compileBenchmarkManifest, runBenchmark, benchmarkResultId } from './index';
import {
  TENANT,
  PROJECT,
  T0,
  fixturePlan,
  fixtureReplaySource,
  fixtureGenerativeSource,
  fixtureObservations,
} from './fixtures';

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const source = fixtureReplaySource();
  if (!source.ok) throw new Error('fixture source must validate');
  return {
    name: 'evidence-fixture',
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

function liveSession() {
  return validateLiveSessionSource({
    kind: 'live-session',
    origin: 'historical',
    venue: 'venue-eu',
    session_refs: ['session-1'],
    config_digest: 'cccccccccccccccc',
    captured: { start: T0, end: T0 + 86_400_000 },
  });
}

describe('the definition-level evidence law', () => {
  it('accepts a simulation definition over a replay dataset', () => {
    expect(validateBenchmarkDefinition(definition()).ok).toBe(true);
  });

  it('fails live_claim_on_simulation for a live definition over a generative population', () => {
    const source = fixtureGenerativeSource();
    if (!source.ok) throw new Error('fixture source must validate');
    const validated = validateBenchmarkDefinition(
      definition({ evidence_class: 'live', driver: 'regime-ladder-generative', data_source: source.value, ladder_level: 'synthetic-single-regime' }),
    );
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.errors[0]?.code).toBe('live_claim_on_simulation');
    expect(validated.errors[0]?.message).toContain('exploration instruments');
  });

  it('fails evidence_conflated for a live definition over a replay dataset', () => {
    const validated = validateBenchmarkDefinition(definition({ evidence_class: 'live' }));
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.errors[0]?.code).toBe('evidence_conflated');
  });

  it('fails evidence_conflated for a simulation definition over a live session', () => {
    const source = liveSession();
    if (!source.ok) throw new Error('fixture source must validate');
    const validated = validateBenchmarkDefinition(definition({ data_source: source.value }));
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.errors[0]?.code).toBe('evidence_conflated');
    expect(validated.errors[0]?.message).toContain('never simulation');
  });

  it('accepts a live definition over a live session (the layer-8 evidence class)', () => {
    const source = liveSession();
    if (!source.ok) throw new Error('fixture source must validate');
    const validated = validateBenchmarkDefinition(definition({ evidence_class: 'live', data_source: source.value }));
    expect(validated.ok).toBe(true);
  });
});

describe('the manifest-level evidence law', () => {
  function compiledResult(def: Record<string, unknown>) {
    const plan = fixturePlan();
    const run = runBenchmark({
      definition: def,
      observations: fixtureObservations(plan),
      search: null,
      recorded_at: T0 + 100,
    });
    if (!run.ok) throw new Error(`fixture must run: ${JSON.stringify(run.errors)}`);
    return run.value;
  }

  it('compiles a simulation manifest binding simulation results', () => {
    const def = definition();
    const result = compiledResult(def);
    const manifest = compileBenchmarkManifest({
      tenant: TENANT,
      project: PROJECT,
      evidence_class: 'simulation',
      created_at: T0 + 200,
      benchmarks: [{ definition: def, results: [result] }],
    });
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    expect(manifest.value.manifest_id.startsWith('bmfm:')).toBe(true);
    expect(manifest.value.entries[0]?.results[0]?.result_id).toBe(result.result_id);
  });

  it('fails evidence_conflated when a simulation manifest binds a live-class result', () => {
    const def = definition();
    const result = compiledResult(def);
    // Forge the result's evidence class with a recomputed content address so
    // the RECORD law passes and the MANIFEST class law is what fails.
    const forgedContent = { ...(result as unknown as Record<string, unknown>), evidence_class: 'live' };
    delete (forgedContent as { result_id?: string }).result_id;
    const forged = { result_id: benchmarkResultId(forgedContent as Parameters<typeof benchmarkResultId>[0]), ...forgedContent };
    const manifest = compileBenchmarkManifest({
      tenant: TENANT,
      project: PROJECT,
      evidence_class: 'simulation',
      created_at: T0 + 200,
      benchmarks: [{ definition: def, results: [forged] }],
    });
    expect(manifest.ok).toBe(false);
    if (manifest.ok) return;
    expect(manifest.errors[0]?.code).toBe('evidence_conflated');
  });

  it('fails live_claim_on_simulation when a live manifest binds simulation-class results', () => {
    const liveSource = liveSession();
    if (!liveSource.ok) throw new Error('fixture source must validate');
    // A live definition over a live session (legal at the definition level);
    // its compiled result is live-class. Forge the RESULT's class to
    // 'simulation' with a recomputed content address so the record law
    // passes and the manifest's class law is what fails.
    const liveDef = definition({ evidence_class: 'live', data_source: liveSource.value });
    const liveResult = compiledResult(liveDef);
    const forgedContent = { ...(liveResult as unknown as Record<string, unknown>), evidence_class: 'simulation' };
    delete (forgedContent as { result_id?: string }).result_id;
    const forged = { result_id: benchmarkResultId(forgedContent as Parameters<typeof benchmarkResultId>[0]), ...forgedContent };
    const manifest = compileBenchmarkManifest({
      tenant: TENANT,
      project: PROJECT,
      evidence_class: 'live',
      created_at: T0 + 200,
      benchmarks: [{ definition: liveDef, results: [forged] }],
    });
    expect(manifest.ok).toBe(false);
    if (manifest.ok) return;
    expect(manifest.errors[0]?.code).toBe('live_claim_on_simulation');
  });

  it('fails the definition class law when a live manifest binds a generative definition', () => {
    const source = fixtureGenerativeSource();
    if (!source.ok) throw new Error('fixture source must validate');
    const generativeDef = definition({
      driver: 'regime-ladder-generative',
      data_source: source.value,
      ladder_level: 'synthetic-single-regime',
    });
    const manifest = compileBenchmarkManifest({
      tenant: TENANT,
      project: PROJECT,
      evidence_class: 'live',
      created_at: T0 + 200,
      benchmarks: [{ definition: generativeDef, results: [] }],
    });
    expect(manifest.ok).toBe(false);
    if (manifest.ok) return;
    expect(manifest.errors[0]?.code).toBe('live_claim_on_simulation');
  });
});
