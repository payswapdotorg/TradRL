/**
 * @tradrl/evaluation-integrity — the search-lineage MIRROR verification
 * tests (the mirrored chain verifier).
 *
 * Laws under test (search-mirror.ts):
 * - the mirrored structural law of trial entries (including the holdout
 *   law: no parents, one split == the evaluation policy);
 * - the mirrored chain law: the recomputed head binds the binding and every
 *   entry in order — mutation, HIDING, reordering and identity forgery all
 *   fail `chain_mismatch`;
 * - the mirrored log laws on untrusted input (unknown parents, holdout
 *   parents, duplicate ids, rewinding instants, unstored snapshots);
 * - the mirrored snapshot content-addressing (content and address cannot
 *   disagree).
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalSearchRecordMirror,
  chainGenesisMirror,
  computeChainHeadMirror,
  configSnapshotIdMirror,
  isSearchTrialEntryMirror,
  isTimestampMs,
  stableDigestJson,
  verifySearchLineage,
} from './index';
import type { SearchRecordMirror } from './index';
import { BINDING, T0, DAY, buildRecord } from './fixtures';
import type { TrialFixture } from './fixtures';

const FIXTURES: readonly TrialFixture[] = [
  { trial: 't1', config: { lr: '0.1' }, window: { start: T0, end: T0 + DAY } },
  { trial: 't2', parents: ['t1'], config: { lr: '0.1' }, window: { start: T0, end: T0 + DAY } },
  { trial: 't3', config: { lr: '0.2' }, window: { start: T0, end: T0 + DAY } },
  { trial: 't4', parents: ['t3'], config: { lr: '0.3' }, window: { start: T0, end: T0 + DAY } },
  { trial: 'h1', classification: 'holdout', config: { lr: '0.3' }, window: { start: T0 + 5 * DAY, end: T0 + 6 * DAY }, datasets: ['dataset-holdout'] },
];

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

function thaw(record: SearchRecordMirror): LooseRecord {
  return JSON.parse(JSON.stringify(record)) as LooseRecord;
}

describe('the mirrored structural law', () => {
  it('accepts a well-formed record and deeply freezes the result', () => {
    const result = verifySearchLineage(buildRecord(FIXTURES));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must verify');
    expect(result.value.entries).toHaveLength(5);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(isTimestampMs(result.value.entries[0]?.recorded_at)).toBe(true);
  });

  it('the holdout structural law is mirrored (no parents, one split)', () => {
    const record = buildRecord(FIXTURES);
    const holdout = record.entries[4];
    expect(holdout?.classification).toBe('holdout');
    expect(isSearchTrialEntryMirror(holdout)).toBe(true);
    const withParents = { ...holdout, parents: ['t1'] } as unknown;
    expect(isSearchTrialEntryMirror(withParents)).toBe(false);
    const wrongSplit = { ...holdout, splits: ['split.train-1'] } as unknown;
    expect(isSearchTrialEntryMirror(wrongSplit)).toBe(false);
  });
});

describe('the mirrored CHAIN law', () => {
  it('a structurally-valid byte tamper fails chain_mismatch', () => {
    const tampered = thaw(buildRecord(FIXTURES));
    tampered.entries[0]!.datasets = ['dataset-asia'];
    const result = verifySearchLineage(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('HIDING an entry fails chain_mismatch', () => {
    const truncated = thaw(buildRecord(FIXTURES));
    truncated.entries = truncated.entries.filter((e) => e.trial !== 'h1');
    const result = verifySearchLineage(truncated);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('a forged identity fails chain_mismatch', () => {
    const forged = thaw(buildRecord(FIXTURES));
    forged.experiment = 'exp-forged';
    const result = verifySearchLineage(forged);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('chain_mismatch');
    expect(result.errors[0]?.path).toBe('search_id');
  });

  it('the mirrored log laws fire on untrusted input even with a repaired head', () => {
    const base = thaw(buildRecord([
      { trial: 'h0', classification: 'holdout', window: { start: T0 + 5 * DAY, end: T0 + 6 * DAY }, datasets: ['dataset-holdout'] },
      { trial: 't1', window: { start: T0, end: T0 + DAY } },
      { trial: 't2', parents: ['t1'], window: { start: T0, end: T0 + DAY } },
    ]));
    const attacks: readonly { mutate: (r: LooseRecord) => void; code: string }[] = [
      { mutate: (r) => { r.entries[1]!.parents = ['ghost']; }, code: 'invalid_field' },
      { mutate: (r) => { r.entries[2]!.parents = ['h0']; }, code: 'invalid_field' },
      { mutate: (r) => { r.entries[2]!.recorded_at = (r.entries[0]!.recorded_at as number) - 1; }, code: 'invalid_field' },
      { mutate: (r) => { r.entries[0]!.parents = ['t1']; }, code: 'invalid_field' },
    ];
    for (const attack of attacks) {
      const value = thaw(buildRecord([
        { trial: 'h0', classification: 'holdout', window: { start: T0 + 5 * DAY, end: T0 + 6 * DAY }, datasets: ['dataset-holdout'] },
        { trial: 't1', window: { start: T0, end: T0 + DAY } },
        { trial: 't2', parents: ['t1'], window: { start: T0, end: T0 + DAY } },
      ]));
      attack.mutate(value);
      value.chain_head = computeChainHeadMirror(BINDING, value.entries as never);
      const result = verifySearchLineage(value);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error(`must fail for ${attack.code}`);
      expect(result.errors.map((e) => e.code)).toContain('invalid_field');
    }
    void base;
  });

  it('a snapshot whose content does not address to its id fails', () => {
    const liar = thaw(buildRecord(FIXTURES));
    liar.snapshots[0]!.config = { tampered: true };
    const result = verifySearchLineage(liar);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_field');
    expect(result.errors[0]?.message).toContain('content and address cannot disagree');
  });

  it('an entry referencing an unstored snapshot fails', () => {
    const orphan = thaw(buildRecord(FIXTURES));
    orphan.entries[0]!.config = 'snap:ffffffffffffffff';
    const result = verifySearchLineage(orphan);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors.map((e) => e.code)).toContain('invalid_field');
  });
});

describe('mirror determinism', () => {
  it('the same fixtures build byte-identical canonical records', () => {
    expect(canonicalSearchRecordMirror(buildRecord(FIXTURES))).toBe(canonicalSearchRecordMirror(buildRecord(FIXTURES)));
  });

  it('the genesis, fold and snapshot addressing are pure', () => {
    expect(chainGenesisMirror(BINDING)).toBe(chainGenesisMirror(BINDING));
    expect(configSnapshotIdMirror({ a: 1 })).toBe(configSnapshotIdMirror({ a: 1 }));
    expect(configSnapshotIdMirror({ a: 1 })).not.toBe(configSnapshotIdMirror({ a: 2 }));
    expect(stableDigestJson({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});
