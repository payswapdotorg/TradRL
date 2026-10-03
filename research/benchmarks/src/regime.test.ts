/**
 * @tradrl/research-benchmarks — the REGIME LADDER laws (Work Order T032;
 * spec/LEARNING-LOOP.md curriculum: "Simple synthetic regimes" ->
 * "Unseen multi-regime tests").
 *
 * Every level's structural law is data, not decoration — each breach is
 * the typed error `ladder_violation`:
 * - synthetic-single-regime: one regime, nothing unseen, scored material
 *   inside the generated regime;
 * - synthetic-multi-regime: two or more regimes, nothing unseen, scored
 *   material inside the generated regimes;
 * - unseen-multi-regime: a multi-regime population with a disjoint unseen
 *   set; a SEARCH run never scores unseen-regime material; a HOLDOUT run
 *   covers >= 2 distinct regimes including >= 1 unseen one.
 */

import { describe, expect, it } from 'vitest';

import { runBenchmark, validateBenchmarkDefinition } from './index';
import {
  TENANT,
  PROJECT,
  T0,
  DAY,
  at,
  dataRef,
  fixturePlan,
  fixtureObservations,
  fixtureGenerativeSource,
  fixtureSearchRecord,
} from './fixtures';
import type { DatasetSegment, SplitPlanMirror, SplitPolicyRef } from './index';
import { splitPlanIdMirror } from './index';

/**
 * A plan whose axis labels every segment 'synthetic' — the regime labels
 * are what the ladder law reads, so the fixture family controls them.
 */
function labeledPlan(regimesBySegment: readonly string[]): SplitPlanMirror {
  const segments: DatasetSegment[] = regimesBySegment.map((regime, index) => {
    const start = at(T0 + index * DAY);
    return { ref: dataRef(`ds-${index}`), start, end: at(start + DAY), regime };
  });
  // Reserve the last two segments as the (regime-set) holdout; the rest windows.
  const holdout = segments.slice(segments.length - 2);
  const search = segments.slice(0, segments.length - 2);
  const windows = [1, 2, 3].map((testIndex, ordinal) => ({
    index: ordinal,
    train: search.slice(0, testIndex),
    test: search[testIndex] as DatasetSegment,
    purged: 0,
  }));
  const policyRef = 'split.ladder-fixture' as SplitPolicyRef;
  const content = {
    policy_ref: policyRef,
    kind: 'walk-forward-plan' as const,
    windows,
    holdout: { mode: 'regime-set' as const, segments: holdout, embargo_ms: '0', separation_ms: null },
    lineage: {
      axis_digest: '0'.repeat(16),
      policy_ref: policyRef,
      policy_digest: '1'.repeat(16),
      segment_count: segments.length,
      window_count: windows.length,
      holdout_count: holdout.length,
    },
  };
  return { plan_id: splitPlanIdMirror(content), ...content } as unknown as SplitPlanMirror;
}

function generativeDefinition(level: string, plan: SplitPlanMirror, phase: 'search' | 'holdout', sourceOverrides: Record<string, unknown> = {}) {
  const source = fixtureGenerativeSource(sourceOverrides);
  if (!source.ok) throw new Error('fixture source must validate');
  return {
    name: `ladder-${level}`,
    driver: 'regime-ladder-generative',
    phase,
    evidence_class: 'simulation',
    split_plan: plan,
    data_source: source.value,
    evaluator: 'evaluator@1',
    stress: [],
    score_scale: 2,
    ladder_level: level,
    tenant: TENANT,
    project: PROJECT,
  };
}

describe('synthetic-single-regime (curriculum step 1)', () => {
  it('accepts a single-regime population and scored material inside the regime', () => {
    const plan = labeledPlan(['trend', 'trend', 'trend', 'trend', 'trend', 'trend']);
    const definition = generativeDefinition('synthetic-single-regime', plan, 'search', { regimes: ['trend'], unseen_regimes: [] });
    const run = runBenchmark({
      definition,
      observations: fixtureObservations(plan),
      search: null,
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(true);
  });

  it('rejects a two-regime population at the single-regime level', () => {
    const plan = labeledPlan(['trend', 'trend', 'trend', 'range', 'range', 'range']);
    const definition = generativeDefinition('synthetic-single-regime', plan, 'search');
    const run = runBenchmark({ definition, observations: fixtureObservations(plan), search: null, recorded_at: T0 + 100 });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('ladder_violation');
    expect(run.errors[0]?.message).toContain('single-regime');
  });
});

describe('synthetic-multi-regime (the bridge level)', () => {
  it('accepts a two-regime population with nothing unseen', () => {
    const plan = labeledPlan(['trend', 'trend', 'range', 'range', 'trend', 'range']);
    const definition = generativeDefinition('synthetic-multi-regime', plan, 'search', { unseen_regimes: [] });
    const run = runBenchmark({ definition, observations: fixtureObservations(plan), search: null, recorded_at: T0 + 100 });
    expect(run.ok).toBe(true);
  });

  it('rejects declared unseen regimes at the multi-regime level', () => {
    const plan = labeledPlan(['trend', 'trend', 'range', 'range', 'trend', 'range']);
    const definition = generativeDefinition('synthetic-multi-regime', plan, 'search', { unseen_regimes: ['crisis'] });
    const run = runBenchmark({ definition, observations: fixtureObservations(plan), search: null, recorded_at: T0 + 100 });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('ladder_violation');
  });
});

describe('unseen-multi-regime (curriculum step 6: unseen multi-regime tests)', () => {
  // Plan: search segments [trend, trend, range, range] with tests at 1,2,3;
  // holdout pair [crisis, flash] — both UNSEEN regimes.
  const unseenPlan = (): SplitPlanMirror =>
    labeledPlan(['trend', 'trend', 'range', 'range', 'crisis', 'flash']);

  it('accepts a holdout run covering two unseen regimes (the unseen multi-regime test)', () => {
    const plan = unseenPlan();
    const definition = generativeDefinition('unseen-multi-regime', plan, 'holdout', { unseen_regimes: ['crisis', 'flash'] });
    const run = runBenchmark({
      definition,
      observations: fixtureObservations(plan),
      search: { search_record: fixtureSearchRecord(), trial: 'h-1' },
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(true);
  });

  it('rejects a holdout run covering only one regime', () => {
    const plan = unseenPlan();
    const definition = generativeDefinition('unseen-multi-regime', plan, 'holdout', { unseen_regimes: ['crisis', 'flash'] });
    const run = runBenchmark({
      definition,
      observations: fixtureObservations(plan),
      search: { search_record: fixtureSearchRecord(), trial: 'h-1' },
      recorded_at: T0 + 100,
      scored: ['ds-4'],
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('ladder_violation');
    expect(run.errors[0]?.message).toContain('multi-regime combinations');
  });

  it('rejects a holdout run covering no unseen regime', () => {
    // Holdout pair both SEEN regimes.
    const plan = labeledPlan(['trend', 'trend', 'range', 'range', 'trend', 'range']);
    const definition = generativeDefinition('unseen-multi-regime', plan, 'holdout');
    const run = runBenchmark({
      definition,
      observations: fixtureObservations(plan),
      search: { search_record: fixtureSearchRecord(), trial: 'h-1' },
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('ladder_violation');
    expect(run.errors[0]?.message).toContain('no UNSEEN regime');
  });

  it('rejects a search run that scores unseen-regime material (never optimize on the unseen)', () => {
    // An unseen-regime segment INSIDE the window material (not reserved): a
    // search run that scores it breaches the ladder law (the phase law is
    // silent — the segment is legitimate window material).
    const plan = labeledPlan(['trend', 'trend', 'crisis', 'range', 'trend', 'range']);
    const definition = generativeDefinition('unseen-multi-regime', plan, 'search', { unseen_regimes: ['crisis'] });
    const run = runBenchmark({
      definition,
      observations: fixtureObservations(plan),
      search: null,
      recorded_at: T0 + 100,
      scored: ['ds-2'],
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('ladder_violation');
    expect(run.errors[0]?.message).toContain('never optimizes on the unseen regimes');
  });

  it('accepts scored regimes across the full population vocabulary (seen + unseen)', () => {
    const plan = labeledPlan(['trend', 'trend', 'range', 'range', 'crisis', 'flash']);
    const definition = generativeDefinition('unseen-multi-regime', plan, 'holdout', { unseen_regimes: ['crisis', 'flash'] });
    const validated = validateBenchmarkDefinition(definition);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const run = runBenchmark({
      definition,
      observations: fixtureObservations(plan),
      search: { search_record: fixtureSearchRecord(), trial: 'h-1' },
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(true);
  });

  it('rejects scored material the population does not generate', () => {
    // The holdout pair sits OUTSIDE the population vocabulary entirely.
    const plan = labeledPlan(['trend', 'trend', 'range', 'range', 'sideways', 'sideways']);
    const definition = generativeDefinition('unseen-multi-regime', plan, 'holdout');
    const run = runBenchmark({
      definition,
      observations: fixtureObservations(plan),
      search: { search_record: fixtureSearchRecord(), trial: 'h-1' },
      recorded_at: T0 + 100,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.errors[0]?.code).toBe('ladder_violation');
    expect(run.errors[0]?.message).toContain('does not generate');
  });
});

describe('the population disjointness law', () => {
  it('rejects a source whose unseen regimes intersect its search regimes', () => {
    const source = fixtureGenerativeSource({ regimes: ['trend', 'range'], unseen_regimes: ['range'] });
    expect(source.ok).toBe(false);
    if (source.ok) return;
    expect(source.errors[0]?.code).toBe('invalid_field');
    expect(source.errors[0]?.message).toContain('not unseen');
  });
});

// The fixture plan (trailing-count holdout) participates in the ladder law
// only through regime labels; keep a compile-time reference so the fixture
// family stays linked to the driver fixtures.
expect(fixturePlan().plan_id.startsWith('splan:')).toBe(true);
