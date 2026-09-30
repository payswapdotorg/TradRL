/**
 * @tradrl/search-lineage — the search trial entry structural-law tests.
 *
 * Laws under test (trial.ts):
 * - the closed classification vocabulary ('in-search' | 'holdout');
 * - the holdout structural law: no parents, splits == [evaluation_policy]
 *   (holdout evidence is a leaf check, never optimization input);
 * - the window law: half-open, end > start;
 * - collect-all validation reports every violation with a dotted path;
 * - parents/splits/datasets are sets (no repeats), no self-parent;
 * - validated entries are deeply frozen.
 */

import { describe, expect, it } from 'vitest';

import { isDeeplyFrozen, isSearchClassification, isSearchTrialEntry, isSearchWindow, requireTimestampMs, validateSearchTrialEntry, SEARCH_CLASSIFICATIONS } from './index';

const BASE = {
  trial: 'trial-alpha',
  arm: 'arm-treatment',
  classification: 'in-search',
  config: 'snap:0123456789abcdef',
  parents: [],
  splits: ['split.train-1'],
  datasets: ['dataset-europe'],
  window: { start: 1_700_000_000_000, end: 1_700_086_400_000 },
  evaluation_policy: 'split.eval-a',
  recorded_at: 1_700_100_000_000,
  tenant: 'tenant-1',
  project: 'project-1',
} as const;

function entry(overrides: Record<string, unknown> = {}): unknown {
  return { ...BASE, ...overrides };
}

describe('classification vocabulary', () => {
  it('is exactly in-search and holdout', () => {
    expect(SEARCH_CLASSIFICATIONS).toEqual(['in-search', 'holdout']);
    expect(isSearchClassification('in-search')).toBe(true);
    expect(isSearchClassification('holdout')).toBe(true);
    expect(isSearchClassification('validation')).toBe(false);
    expect(isSearchClassification(null)).toBe(false);
  });
});

describe('the holdout structural law', () => {
  it('a holdout trial with parents is inexpressible', () => {
    const candidate = entry({ classification: 'holdout', parents: ['trial-alpha'] });
    expect(isSearchTrialEntry(candidate)).toBe(false);
    const result = validateSearchTrialEntry(candidate);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors.map((e) => e.code)).toContain('invalid_field');
    expect(result.errors.map((e) => e.path)).toContain('trial.parents');
  });

  it('a holdout trial consumes exactly its evaluation policy', () => {
    const good = entry({ classification: 'holdout', parents: [], splits: ['split.holdout-1'], evaluation_policy: 'split.holdout-1', arm: null, datasets: [] });
    expect(isSearchTrialEntry(good)).toBe(true);
    expect(validateSearchTrialEntry(good).ok).toBe(true);

    const extraSplit = entry({ classification: 'holdout', parents: [], splits: ['split.holdout-1', 'split.train-1'], evaluation_policy: 'split.holdout-1' });
    expect(isSearchTrialEntry(extraSplit)).toBe(false);

    const wrongSplit = entry({ classification: 'holdout', parents: [], splits: ['split.train-1'], evaluation_policy: 'split.holdout-1' });
    expect(isSearchTrialEntry(wrongSplit)).toBe(false);
  });
});

describe('the window law', () => {
  it('accepts a half-open non-empty window', () => {
    expect(isSearchWindow({ start: 10, end: 20 })).toBe(true);
  });

  it('rejects empty, inverted and malformed windows', () => {
    expect(isSearchWindow({ start: 10, end: 10 })).toBe(false);
    expect(isSearchWindow({ start: 20, end: 10 })).toBe(false);
    expect(isSearchWindow({ start: 10 })).toBe(false);
    expect(isSearchWindow(null)).toBe(false);
    expect(isSearchWindow({ start: -1, end: 10 })).toBe(false);
    expect(isSearchWindow({ start: 1.5, end: 10 })).toBe(false);
  });

  it('null windows are legal (non-windowed optimization material)', () => {
    const candidate = entry({ window: null });
    expect(validateSearchTrialEntry(candidate).ok).toBe(true);
  });
});

describe('collect-all validation', () => {
  it('reports every missing field with dotted paths', () => {
    const result = validateSearchTrialEntry({});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    const paths = result.errors.map((e) => e.path);
    for (const field of ['trial', 'arm', 'classification', 'config', 'parents', 'splits', 'datasets', 'window', 'evaluation_policy', 'recorded_at', 'tenant', 'project']) {
      expect(paths).toContain(`trial.${field}`);
    }
  });

  it('rejects repeated parents, splits and datasets (sets)', () => {
    const result = validateSearchTrialEntry(entry({ parents: ['p1', 'p1'] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors.some((e) => e.message.includes('simple edges'))).toBe(true);

    expect(validateSearchTrialEntry(entry({ splits: ['s1', 's1'] })).ok).toBe(false);
    expect(validateSearchTrialEntry(entry({ datasets: ['d1', 'd1'] })).ok).toBe(false);
  });

  it('rejects a self-parent (the DAG is acyclic by construction)', () => {
    const result = validateSearchTrialEntry(entry({ parents: ['trial-alpha'] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors.map((e) => e.path)).toContain('trial.parents');
  });

  it('rejects empty splits (a trial consumes at least one split)', () => {
    expect(validateSearchTrialEntry(entry({ splits: [] })).ok).toBe(false);
  });

  it('rejects a non-snapshot config id', () => {
    expect(validateSearchTrialEntry(entry({ config: 'not-a-snapshot' })).ok).toBe(false);
  });

  it('rejects a bad recorded_at instant (L4 discipline)', () => {
    expect(validateSearchTrialEntry(entry({ recorded_at: -5 })).ok).toBe(false);
    expect(validateSearchTrialEntry(entry({ recorded_at: 1.5 })).ok).toBe(false);
    expect(validateSearchTrialEntry(entry({ recorded_at: Number.NaN })).ok).toBe(false);
  });
});

describe('immutability', () => {
  it('validated entries are deeply frozen', () => {
    const result = validateSearchTrialEntry(entry());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must validate');
    expect(isDeeplyFrozen(result.value)).toBe(true);
    expect(() => {
      (result.value as unknown as { trial: string }).trial = 'mutated';
    }).toThrow();
  });
});
