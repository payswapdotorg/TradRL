/**
 * @tradrl/evaluation-integrity — leakage detection tests.
 *
 * Laws under test (leakage.ts):
 * - `leakage_without_embargo`: a holdout evaluation whose data window
 *   overlaps an optimization window, or sits closer than the demanded
 *   embargo;
 * - `synthetic_holdout`: holdout evidence claimed over simulated/generated
 *   origin (the T028/market-protocol vocabulary mirror — exploration
 *   instruments are not unseen historical truth);
 * - `classification_mismatch` / `unknown_trial`;
 * - the embargo authority path (registry resolution; unknown policies
 *   refused) and the declared path;
 * - in-search claims carry no window law (in-search IS the optimization
 *   material);
 * - unverified records support no leakage claim (`chain_mismatch`).
 */

import { describe, expect, it } from 'vitest';

import {
  createSplitRegistry,
  detectLeakage,
  isEvaluationClaim,
  registerSplit,
  validateDatasetAxis,
  validateEvaluationClaim,
  validateSplitDefinition,
} from './index';
import type { SearchRecordMirror } from './index';
import { T0, DAY, buildRecord, thawRecord } from './fixtures';

/** t1/t2 optimize over [T0, T0+1d); t3/t4 optimize over [T0+1d, T0+2d); h1 evaluates [T0+5d, T0+6d). */
const RECORD: SearchRecordMirror = buildRecord([
  { trial: 't1', config: { lr: '0.1' }, window: { start: T0, end: T0 + DAY } },
  { trial: 't2', parents: ['t1'], config: { lr: '0.1' }, window: { start: T0, end: T0 + DAY } },
  { trial: 't3', config: { lr: '0.2' }, window: { start: T0 + DAY, end: T0 + 2 * DAY } },
  { trial: 't4', parents: ['t3'], config: { lr: '0.3' }, window: { start: T0 + DAY, end: T0 + 2 * DAY } },
  { trial: 'h1', classification: 'holdout', config: { lr: '0.3' }, window: { start: T0 + 5 * DAY, end: T0 + 6 * DAY }, datasets: ['dataset-holdout'] },
]);

function holdoutClaim(trial: string, window: { start: number; end: number } | null, origin = 'historical'): Record<string, unknown> {
  return {
    trial,
    classification: 'holdout',
    window,
    origin,
    policy: 'split.holdout-1',
  };
}

function inSearchClaim(trial: string): Record<string, unknown> {
  return {
    trial,
    classification: 'in-search',
    window: { start: T0, end: T0 + DAY },
    origin: 'historical',
    policy: 'split.eval-a',
  };
}

describe('claim validation', () => {
  it('accepts a well-formed claim and rejects malformed ones', () => {
    expect(isEvaluationClaim(holdoutClaim('h1', { start: T0, end: T0 + DAY }))).toBe(true);
    expect(validateEvaluationClaim(holdoutClaim('h1', { start: T0, end: T0 + DAY })).ok).toBe(true);
    expect(validateEvaluationClaim({ ...holdoutClaim('h1', null), origin: 'mythic' }).ok).toBe(false);
    expect(validateEvaluationClaim({ ...holdoutClaim('h1', { start: T0, end: T0 }) }).ok).toBe(false);
    expect(validateEvaluationClaim({ ...holdoutClaim('', null) }).ok).toBe(false);
    expect(validateEvaluationClaim('nope').ok).toBe(false);
  });
});

describe('the leakage law (window overlap without embargo)', () => {
  it('a separated holdout window passes (declared embargo satisfied)', () => {
    // h1's window [T0+5d, T0+6d) is >= 3 days from every optimization window.
    const result = detectLeakage(RECORD, holdoutClaim('h1', { start: T0 + 5 * DAY, end: T0 + 6 * DAY }), { source: 'declared', embargoMs: 3 * DAY });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must pass');
    expect(result.value.embargoMs).toBe(3 * DAY);
    expect(result.value.checkedAgainst).toBe(4);
  });

  it('an OVERLAPPING holdout window fails leakage_without_embargo', () => {
    const result = detectLeakage(RECORD, holdoutClaim('h1', { start: T0, end: T0 + DAY }), { source: 'declared', embargoMs: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('leakage_without_embargo');
    expect(result.errors[0]?.message).toContain('OVERLAPS');
    expect(result.errors[0]?.message).toContain('t1');
  });

  it('a gap narrower than the embargo fails leakage_without_embargo', () => {
    // [T0+2d, T0+2.5d) is adjacent to t3/t4's window end (T0+2d): not
    // overlapping — but the embargo demands 3 days.
    const result = detectLeakage(RECORD, holdoutClaim('h1', { start: T0 + 2 * DAY, end: T0 + 2 * DAY + DAY / 2 }), { source: 'declared', embargoMs: 3 * DAY });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('leakage_without_embargo');
    expect(result.errors[0]?.message).toContain('only');
  });

  it('an exactly-embargo-distant window passes (gap == embargo)', () => {
    // t3/t4 end at T0+2d; a window starting at T0+5d with a 3-day embargo: gap == embargo -> passes.
    const result = detectLeakage(RECORD, holdoutClaim('h1', { start: T0 + 5 * DAY, end: T0 + 6 * DAY }), { source: 'declared', embargoMs: 3 * DAY });
    expect(result.ok).toBe(true);
  });

  it('the record-entry window is the authority when the claim carries none', () => {
    const result = detectLeakage(RECORD, holdoutClaim('h1', null), { source: 'declared', embargoMs: 3 * DAY });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must pass');
    expect(result.value.checkedAgainst).toBe(4);
    expect(result.value.minGap).toBe(3 * DAY); // distance from t3/t4's end (T0+2d) to T0+5d
  });
});

describe('the synthetic-holdout law (T028 mirror)', () => {
  it('simulated and generated origins fail synthetic_holdout', () => {
    for (const origin of ['simulated', 'generated']) {
      const result = detectLeakage(RECORD, holdoutClaim('h1', { start: T0 + 5 * DAY, end: T0 + 6 * DAY }, origin), { source: 'declared', embargoMs: 0 });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('must fail');
      expect(result.errors[0]?.code).toBe('synthetic_holdout');
      expect(result.errors[0]?.message).toContain('exploration instruments');
    }
  });

  it('historical origin passes the origin law', () => {
    const result = detectLeakage(RECORD, holdoutClaim('h1', { start: T0 + 5 * DAY, end: T0 + 6 * DAY }, 'historical'), { source: 'declared', embargoMs: 0 });
    expect(result.ok).toBe(true);
  });
});

describe('classification and existence laws', () => {
  it('classification_mismatch: the record is the authority', () => {
    // Claim asserts in-search for a holdout-classified trial.
    const result = detectLeakage(RECORD, inSearchClaim('h1'), { source: 'declared', embargoMs: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('classification_mismatch');
  });

  it('unknown_trial: a claim naming an unlogged trial is rejected', () => {
    const result = detectLeakage(RECORD, holdoutClaim('ghost', null), { source: 'declared', embargoMs: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('unknown_trial');
  });

  it('in-search claims carry no window law (in-search IS the optimization material)', () => {
    // t1's claim window overlaps t1's own optimization window: correct.
    const result = detectLeakage(RECORD, inSearchClaim('t1'), { source: 'declared', embargoMs: 1000 * DAY });
    expect(result.ok).toBe(true);
  });
});

describe('the embargo authority path', () => {
  function registry() {
    const axis = validateDatasetAxis({
      segments: [
        { ref: 'seg-1', start: T0, end: T0 + DAY, regime: 'calm' },
        { ref: 'seg-2', start: T0 + DAY, end: T0 + 2 * DAY, regime: 'calm' },
        { ref: 'seg-h', start: T0 + 5 * DAY, end: T0 + 6 * DAY, regime: 'crisis' },
      ],
    });
    if (!axis.ok) throw new Error('fixture axis must validate');
    const created = createSplitRegistry({ tenant: 'tenant-1', project: 'project-1' });
    if (!created.ok) throw new Error('fixture registry must create');
    const definition = validateSplitDefinition({
      kind: 'purged-embargoed',
      policy_ref: 'split.holdout-1',
      axis: axis.value,
      min_train_segments: 1,
      step_segments: 1,
      embargo_ms: 3 * DAY,
      holdout_count: 1,
    });
    if (!definition.ok) throw new Error(`fixture definition must validate: ${JSON.stringify(definition.errors)}`);
    const registered = registerSplit(created.value, { definition: definition.value, registered_at: T0 });
    if (!registered.ok) throw new Error('fixture must register');
    return registered.value;
  }

  it('resolves the embargo from the registered split definition', () => {
    const result = detectLeakage(RECORD, holdoutClaim('h1', { start: T0 + 5 * DAY, end: T0 + 6 * DAY }), { source: 'registry', registry: registry() });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must pass');
    expect(result.value.embargoMs).toBe(3 * DAY);
  });

  it('an unregistered policy is refused (the authority does not invent separations)', () => {
    const claim = { ...holdoutClaim('h1', { start: T0 + 5 * DAY, end: T0 + 6 * DAY }), policy: 'split.unregistered' };
    const result = detectLeakage(RECORD, claim, { source: 'registry', registry: registry() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('unknown_split_policy');
  });

  it('the registry-resolved embargo still rejects a too-close window', () => {
    const result = detectLeakage(RECORD, holdoutClaim('h1', { start: T0 + 2 * DAY, end: T0 + 2 * DAY + DAY / 2 }), { source: 'registry', registry: registry() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('leakage_without_embargo');
  });
});

describe('unverified records support no leakage claim', () => {
  it('a tampered record fails chain_mismatch first', () => {
    const tampered = thawRecord(RECORD);
    tampered.entries[0]!.datasets = ['dataset-asia'];
    const result = detectLeakage(tampered, holdoutClaim('h1', null), { source: 'declared', embargoMs: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('chain_mismatch');
  });
});

describe('embargo source validation', () => {
  it('a malformed embargo source is rejected', () => {
    const result = detectLeakage(RECORD, holdoutClaim('h1', null), { source: 'nope' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_field');
    const negative = detectLeakage(RECORD, holdoutClaim('h1', null), { source: 'declared', embargoMs: -1 });
    expect(negative.ok).toBe(false);
  });
});
