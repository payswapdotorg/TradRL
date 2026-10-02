/**
 * @tradrl/outcome-learning — the RETENTION + QUERY suites: the
 * windowed visibility laws (the age side + the L4 future side), the
 * L12 tenant isolation (foreign records never leak through ANY filter
 * combination), the latest-per-outcome post-mortem projection, and
 * the hook compilation surface T035 consumes.
 */

import { describe, expect, it } from 'vitest';
import { createOutcomeLearningState, ingestShadowOutcomes, type OutcomeLearningState } from './state';
import { generatePostMortemDrafts } from './postmortem';
import { DEFAULT_POST_MORTEM_DRAFT_POLICY } from './policy';
import { queryOutcomeRecords, queryPostMortems, queryLearningHooks } from './query';
import { retentionWindow, withinRetentionWindow } from './retention';
import { asTimestampMs } from './imports';
import { scenarioBatch, scenarioDraftAt, scenarioMarkFacts, T0 } from './fixtures';

/** Ingest + draft over the scenario (unwraps). */
function fullScenario(): OutcomeLearningState {
  const ingested = ingestShadowOutcomes(createOutcomeLearningState(), scenarioBatch());
  if (!ingested.ok) throw new Error(ingested.errors.map((error) => error.message).join('; '));
  const drafted = generatePostMortemDrafts(ingested.value, DEFAULT_POST_MORTEM_DRAFT_POLICY, { markFacts: scenarioMarkFacts(), at: scenarioDraftAt() });
  if (!drafted.ok) throw new Error(drafted.errors.map((error) => error.message).join('; '));
  return drafted.value.state;
}

/** The wide-open retention policy (everything in-window). */
const ALL_TIME = { outcomeWindowMs: Number.MAX_SAFE_INTEGER, postMortemWindowMs: Number.MAX_SAFE_INTEGER };

describe('the retention windows (injected instants)', () => {
  it('derives the two-sided window [now - windowMs, now]', () => {
    const now = asTimestampMs(T0 + 200_000);
    const window = retentionWindow({ outcomeWindowMs: 30_000, postMortemWindowMs: 10_000 }, 'outcomes', now);
    expect(window.from).toBe(T0 + 170_000);
    expect(window.to).toBe(T0 + 200_000);
  });

  it('hides records stamped after the query instant (the L4 future side) and beyond the window (the age side)', () => {
    const at = asTimestampMs(T0 + 175_000);
    const window = retentionWindow({ outcomeWindowMs: 10_000, postMortemWindowMs: 10_000 }, 'outcomes', at);
    expect(withinRetentionWindow(asTimestampMs(T0 + 180_000), window)).toBe(false); // the future
    expect(withinRetentionWindow(asTimestampMs(T0 + 160_000), window)).toBe(false); // aged out
    expect(withinRetentionWindow(asTimestampMs(T0 + 170_000), window)).toBe(true); // in-window
  });
});

describe('the query surface (T034 Firm Brain reads)', () => {
  it('returns the tenant/project-scoped outcomes by ordinal (the by-tenant/project/decision read)', () => {
    const state = fullScenario();
    const results = queryOutcomeRecords(state, { tenant: 'tenant-learning-beta', project: 'project-learning-beta' }, { at: asTimestampMs(T0 + 200_000), retention: ALL_TIME });
    if (!results.ok) throw new Error(results.errors.map((error) => error.message).join('; '));
    expect(results.value.length).toBe(6);
    expect(results.value.map((record) => record.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
    // The by-decision read.
    const byDecision = queryOutcomeRecords(state, { tenant: 'tenant-learning-beta', project: 'project-learning-beta', decisionRef: 'xd:learn-4' }, { at: asTimestampMs(T0 + 200_000), retention: ALL_TIME });
    if (!byDecision.ok) throw new Error(byDecision.errors.map((error) => error.message).join('; '));
    expect(byDecision.value.length).toBe(1);
    expect(byDecision.value[0]?.outcomeClass).toBe('execution_shortfall');
  });

  it('filters by the closed outcome-class vocabulary (unknown class = typed error)', () => {
    const state = fullScenario();
    const filtered = queryOutcomeRecords(state, { tenant: 'tenant-learning-beta', project: 'project-learning-beta', outcomeClass: 'adverse_gap' }, { at: asTimestampMs(T0 + 200_000), retention: ALL_TIME });
    if (!filtered.ok) throw new Error(filtered.errors.map((error) => error.message).join('; '));
    expect(filtered.value.length).toBe(1);
    const foreign = queryOutcomeRecords(state, { tenant: 'tenant-learning-beta', project: 'project-learning-beta', outcomeClass: 'wonderful_trade' }, { at: asTimestampMs(T0 + 200_000), retention: ALL_TIME });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors[0].code).toBe('unknown_outcome_class');
  });

  it('NEVER returns foreign-scope records (L12 — no filter combination leaks)', () => {
    const state = fullScenario();
    for (const query of [
      { tenant: 'tenant-foreign', project: 'project-learning-beta' },
      { tenant: 'tenant-learning-beta', project: 'project-foreign' },
      { tenant: 'tenant-foreign', project: 'project-foreign' },
    ]) {
      const results = queryOutcomeRecords(state, query, { at: asTimestampMs(T0 + 200_000), retention: ALL_TIME });
      if (!results.ok) throw new Error(results.errors.map((error) => error.message).join('; '));
      expect(results.value.length).toBe(0);
      const postMortems = queryPostMortems(state, { tenant: query.tenant, project: query.project }, { at: asTimestampMs(T0 + 200_000), retention: ALL_TIME });
      if (!postMortems.ok) throw new Error(postMortems.errors.map((error) => error.message).join('; '));
      expect(postMortems.value.length).toBe(0);
    }
  });

  it('hides future-stamped records (L4 — the query instant bounds visibility)', () => {
    const state = fullScenario();
    // The records were learned at T0+170_000 (the ingestion instant); a query
    // BEFORE that instant sees nothing.
    const early = queryOutcomeRecords(state, { tenant: 'tenant-learning-beta', project: 'project-learning-beta' }, { at: asTimestampMs(T0 + 160_000), retention: ALL_TIME });
    if (!early.ok) throw new Error(early.errors.map((error) => error.message).join('; '));
    expect(early.value.length).toBe(0);
    // A query AFTER sees all six.
    const late = queryOutcomeRecords(state, { tenant: 'tenant-learning-beta', project: 'project-learning-beta' }, { at: asTimestampMs(T0 + 200_000), retention: ALL_TIME });
    if (!late.ok) throw new Error(late.errors.map((error) => error.message).join('; '));
    expect(late.value.length).toBe(6);
  });

  it('ages records out of the retention window without deleting them (the raw log keeps everything)', () => {
    const state = fullScenario();
    // A 5-minute window at T0+200_000: the records (learned at T0+170_000) are 30s old — in-window.
    const tight = queryOutcomeRecords(state, { tenant: 'tenant-learning-beta', project: 'project-learning-beta' }, { at: asTimestampMs(T0 + 200_000), retention: { outcomeWindowMs: 20_000, postMortemWindowMs: 20_000 } });
    if (!tight.ok) throw new Error(tight.errors.map((error) => error.message).join('; '));
    expect(tight.value.length).toBe(0); // aged out of the 20s window
    expect(state.outcomeLog.records.length).toBe(6); // history is NEVER deleted
  });

  it('projects the LATEST post-mortem per outcome (supersession), or the raw history on demand', () => {
    const state = fullScenario();
    const latest = queryPostMortems(state, { tenant: 'tenant-learning-beta', project: 'project-learning-beta' }, { at: asTimestampMs(T0 + 200_000), retention: ALL_TIME });
    if (!latest.ok) throw new Error(latest.errors.map((error) => error.message).join('; '));
    expect(latest.value.length).toBe(3); // three drafted outcomes
    const raw = queryPostMortems(state, { tenant: 'tenant-learning-beta', project: 'project-learning-beta' }, { at: asTimestampMs(T0 + 200_000), retention: ALL_TIME, latestPerOutcome: false });
    if (!raw.ok) throw new Error(raw.errors.map((error) => error.message).join('; '));
    expect(raw.value.length).toBe(3); // no supersession happened yet — same count
    // The attribution filter.
    const withDataLag = queryPostMortems(state, { tenant: 'tenant-learning-beta', project: 'project-learning-beta', attributionClass: 'data_lag' }, { at: asTimestampMs(T0 + 200_000), retention: ALL_TIME });
    if (!withDataLag.ok) throw new Error(withDataLag.errors.map((error) => error.message).join('; '));
    expect(withDataLag.value.length).toBe(1); // only the partial's draft carries the lag
  });
});

describe('the learning-hook surface (T035 consumes)', () => {
  it('compiles one hook per windowed outcome, grounded in the latest post-mortem', () => {
    const state = fullScenario();
    const hooks = queryLearningHooks(state, { tenant: 'tenant-learning-beta', project: 'project-learning-beta' }, { at: asTimestampMs(T0 + 200_000), retention: ALL_TIME });
    if (!hooks.ok) throw new Error(hooks.errors.map((error) => error.message).join('; '));
    expect(hooks.value.length).toBe(6);
    // The adverse gap's hook: dominant model_error -> model_recalibration focus.
    const adverse = hooks.value[0];
    expect(adverse?.outcomeClass).toBe('adverse_gap');
    expect(adverse?.dominantAttribution).toEqual({ class: 'model_error', confidence: '0.6' });
    expect(adverse?.suggestedFocus).toBe('model_recalibration');
    expect(adverse?.realizedGap).toBe('-7');
    // The as-expected hook: no post-mortem (not warranted) -> no attribution, focus none.
    const asExpected = hooks.value[1];
    expect(asExpected?.dominantAttribution).toBeNull();
    expect(asExpected?.suggestedFocus).toBe('none');
    // The shortfall's hook: dominant market_move (the shared BTC marks), but the
    // focus mapping is class-driven — execution_shortfall -> execution_quality.
    const shortfall = hooks.value[3];
    expect(shortfall?.dominantAttribution).toEqual({ class: 'market_move', confidence: '0.5' });
    expect(shortfall?.suggestedFocus).toBe('execution_quality');
    // The expiry's hook: execution_quality.
    const expiry = hooks.value[4];
    expect(expiry?.suggestedFocus).toBe('execution_quality');
  });

  it('carries the tenant/project scope on every hook (L12)', () => {
    const state = fullScenario();
    const hooks = queryLearningHooks(state, { tenant: 'tenant-learning-beta', project: 'project-learning-beta' }, { at: asTimestampMs(T0 + 200_000), retention: ALL_TIME });
    if (!hooks.ok) throw new Error(hooks.errors.map((error) => error.message).join('; '));
    for (const hook of hooks.value) {
      expect(hook.tenant).toBe('tenant-learning-beta');
      expect(hook.project).toBe('project-learning-beta');
    }
  });
});
