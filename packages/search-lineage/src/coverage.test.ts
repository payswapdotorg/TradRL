/**
 * @tradrl/search-lineage — the platform hidden-trials law tests.
 *
 * Laws under test (coverage.ts):
 * - a claimed view that MISSES logged trials fails `hidden_trials` (the
 *   platform mirror of T012's hidden_trials law);
 * - a claimed view that names unlogged trials fails `unknown_trial`;
 * - a repeated claim fails (a view is a set);
 * - an UNVERIFIED record supports no projection (`chain_mismatch`
 *   propagates);
 * - the inventory is computed FROM the record, never from the claim.
 */

import { describe, expect, it } from 'vitest';

import { appendSearchTrial, createSearchRecord, inSearchTrials, searchInventory, verifySearchRecord } from './index';
import type { SearchRecord } from './index';

const T0 = 1_700_000_000_000;
const BINDING = { experiment: 'exp-1', evaluator: 'evaluator@1', tenant: 'tenant-1', project: 'project-1' } as const;

function record(): SearchRecord {
  let current = createSearchRecord(BINDING);
  if (!current.ok) throw new Error('fixture must create');
  const trials: readonly { trial: string; classification?: 'in-search' | 'holdout'; parents?: readonly string[]; config?: Record<string, unknown> }[] = [
    { trial: 't1', config: { lr: '0.1' } },
    { trial: 't2', parents: ['t1'], config: { lr: '0.1' } },
    { trial: 't3', config: { lr: '0.2' } },
    { trial: 't4', parents: ['t3'], config: { lr: '0.3' } },
    { trial: 'h1', classification: 'holdout', config: { check: true } },
  ];
  let instant = T0;
  for (const t of trials) {
    const input = {
      trial: t.trial,
      arm: null,
      classification: t.classification ?? 'in-search',
      config: t.config ?? {},
      parents: t.parents ?? [],
      splits: t.classification === 'holdout' ? ['split.holdout-1'] : ['split.train-1', 'split.train-2'],
      datasets: ['dataset-europe'],
      window: { start: T0, end: T0 + 86_400_000 },
      evaluation_policy: t.classification === 'holdout' ? 'split.holdout-1' : 'split.eval-a',
      recorded_at: instant,
      tenant: BINDING.tenant,
      project: BINDING.project,
    };
    instant += 1;
    const appended = appendSearchTrial(current.value, input);
    if (!appended.ok) throw new Error(`fixture must append ${t.trial}: ${JSON.stringify(appended.errors)}`);
    current = { ok: true, value: appended.value } as typeof current;
  }
  return current.value;
}

describe('the hidden-trials law (platform mirror of T012)', () => {
  it('a total claim returns the inventory computed from the record', () => {
    const result = searchInventory(record(), ['t1', 't2', 't3', 't4', 'h1']);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must cover');
    expect(result.value.trials).toEqual(['t1', 't2', 't3', 't4', 'h1']);
    expect(result.value.inSearch).toBe(4);
    expect(result.value.holdout).toBe(1);
    expect(result.value.distinctConfigs).toBe(4); // lr .1 shared by t1/t2, .2, .3, check
    expect(result.value.distinctSplits).toBe(3); // train-1, train-2, holdout-1
    expect(result.value.maxDepth).toBe(1);
    expect(result.value.entries).toBe(5);
  });

  it('hidden_trials: dropping the worst attempts fails the claim', () => {
    // The classic concealment: report only the trials that looked good.
    const droppedWorst = searchInventory(record(), ['t1', 't2', 't4', 'h1']);
    expect(droppedWorst.ok).toBe(false);
    if (droppedWorst.ok) throw new Error('must fail');
    expect(droppedWorst.errors[0]?.code).toBe('hidden_trials');
    expect(droppedWorst.errors[0]?.message).toContain('t3');
    expect(droppedWorst.errors[0]?.message).toContain('L11');
  });

  it('hidden_trials fires for a single missing trial', () => {
    const missingHoldout = searchInventory(record(), ['t1', 't2', 't3', 't4']);
    expect(missingHoldout.ok).toBe(false);
    if (missingHoldout.ok) throw new Error('must fail');
    expect(missingHoldout.errors[0]?.code).toBe('hidden_trials');
    expect(missingHoldout.errors[0]?.message).toContain('h1');
  });

  it('unknown_trial: fabricated search history is rejected', () => {
    const fabricated = searchInventory(record(), ['t1', 't2', 't3', 't4', 'h1', 'ghost']);
    expect(fabricated.ok).toBe(false);
    if (fabricated.ok) throw new Error('must fail');
    expect(fabricated.errors[0]?.code).toBe('unknown_trial');
    expect(fabricated.errors[0]?.message).toContain('ghost');
  });

  it('a repeated claim is rejected (a view is a set)', () => {
    const repeated = searchInventory(record(), ['t1', 't1', 't2', 't3', 't4', 'h1']);
    expect(repeated.ok).toBe(false);
    if (repeated.ok) throw new Error('must fail');
    expect(repeated.errors[0]?.code).toBe('invalid_field');
  });

  it('an empty claim over a non-empty record is hidden_trials', () => {
    const empty = searchInventory(record(), []);
    expect(empty.ok).toBe(false);
    if (empty.ok) throw new Error('must fail');
    expect(empty.errors[0]?.code).toBe('hidden_trials');
  });
});

/** The attacker's mutable view of a serialized record (tamper tests). */
interface LooseRecord {
  search_id: string;
  experiment: string;
  evaluator: string;
  tenant: string;
  project: string;
  entries: Record<string, unknown>[];
  snapshots: Record<string, unknown>[];
  chain_head: string;
}

function thaw(value: SearchRecord): LooseRecord {
  return JSON.parse(JSON.stringify(value)) as LooseRecord;
}

describe('unverified records support no projection', () => {
  it('a tampered record fails before any inventory exists', () => {
    // A structurally-valid byte-level tamper: only the chain catches it.
    const tampered = thaw(record());
    tampered.entries[0]!.datasets = ['dataset-asia'];
    const result = searchInventory(tampered, ['t1', 't2', 't3', 't4', 'h1']);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('a truncated (hidden-entry) record fails chain_mismatch', () => {
    const truncated = thaw(record());
    truncated.entries = truncated.entries.slice(0, 4);
    const result = searchInventory(truncated, ['t1', 't2', 't3', 't4']);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('chain_mismatch');
  });
});

describe('inSearchTrials', () => {
  it('projects the best-of-N candidate identity list from a verified record', () => {
    const result = inSearchTrials(record());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must project');
    expect(result.value).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('refuses an unverified record', () => {
    const tampered = thaw(record());
    tampered.entries[2]!.parents = ['ghost'];
    const result = inSearchTrials(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('unknown_parent');
  });
});

describe('consistency with verifySearchRecord', () => {
  it('the inventory agrees with a direct verification', () => {
    const value = record();
    const verified = verifySearchRecord(value);
    expect(verified.ok).toBe(true);
    const inventory = searchInventory(value, value.entries.map((e) => e.trial));
    expect(inventory.ok).toBe(true);
    if (!inventory.ok || !verified.ok) throw new Error('must succeed');
    expect(inventory.value.entries).toBe(verified.value.entries.length);
  });
});
