/**
 * @tradrl/search-lineage — the SEARCH RECORD law tests.
 *
 * Laws under test (record.ts):
 * - createSearchRecord derives identity from the binding; smuggling entries
 *   is rejected (the only growth API is append);
 * - append laws, each a typed error: `tenant_mismatch`, `duplicate_trial`,
 *   `unknown_parent`, `holdout_parent`, `non_monotonic_instant`;
 * - the snapshot store dedupes by address and every entry's config is
 *   retained;
 * - CHAIN VERIFICATION: the recomputed head binds the binding and every
 *   entry in order — mutation, removal (hiding), reordering and identity
 *   forgery all fail `chain_mismatch`;
 * - the DAG projection (depths, edges);
 * - records are deeply frozen; append returns a NEW record.
 */

import { describe, expect, it } from 'vitest';

import {
  appendSearchTrial,
  canonicalSearchRecord,
  chainFold,
  chainGenesis,
  computeChainHead,
  createSearchRecord,
  isDeeplyFrozen,
  requireTimestampMs,
  searchDag,
  searchRecordId,
  verifySearchRecord,
} from './index';
import type { SearchBinding, SearchRecord } from './index';
import type { ExperimentId, EvaluatorVersionRef, ProjectId, TenantId } from './index';

const T0 = 1_700_000_000_000;

const BINDING: SearchBinding = {
  experiment: 'exp-1' as ExperimentId,
  evaluator: 'evaluator@1' as EvaluatorVersionRef,
  tenant: 'tenant-1' as TenantId,
  project: 'project-1' as ProjectId,
};

/**
 * The attacker's view of a serialized record: everything mutable, nothing
 * branded. Tamper tests parse-and-cast into this shape so the MUTATIONS
 * typecheck while the APIs under attack still receive `unknown`.
 */
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

function thaw(record: SearchRecord): LooseRecord {
  return JSON.parse(JSON.stringify(record)) as LooseRecord;
}

function openRecord(): SearchRecord {
  const created = createSearchRecord(BINDING);
  if (!created.ok) throw new Error(`fixture must create: ${JSON.stringify(created.errors)}`);
  return created.value;
}

interface TrialFixture {
  trial: string;
  classification?: 'in-search' | 'holdout';
  parents?: readonly string[];
  config?: Record<string, unknown>;
  recordedAt?: number;
  splits?: readonly string[];
  datasets?: readonly string[];
}

function trialInput(f: TrialFixture): Record<string, unknown> {
  return {
    trial: f.trial,
    arm: null,
    classification: f.classification ?? 'in-search',
    config: f.config ?? { point: f.trial },
    parents: f.parents ?? [],
    splits: f.splits ?? ['split.train-1'],
    datasets: f.datasets ?? ['dataset-europe'],
    window: { start: T0, end: T0 + 86_400_000 },
    evaluation_policy: f.classification === 'holdout' ? 'split.holdout-1' : 'split.eval-a',
    recorded_at: f.recordedAt ?? T0 + 100,
    tenant: BINDING.tenant,
    project: BINDING.project,
  };
}

function appendAll(record: SearchRecord, fixtures: readonly TrialFixture[]): SearchRecord {
  let current = record;
  let instant = T0 + 100;
  for (const f of fixtures) {
    const appended = appendSearchTrial(current, trialInput({ recordedAt: instant, ...f }));
    if (!appended.ok) throw new Error(`fixture must append ${f.trial}: ${JSON.stringify(appended.errors)}`);
    current = appended.value;
    instant += 1;
  }
  return current;
}

describe('record creation', () => {
  it('derives the identity from the binding block', () => {
    const record = openRecord();
    expect(record.search_id).toBe(searchRecordId(BINDING));
    expect(record.search_id.startsWith('srch:')).toBe(true);
    expect(record.entries).toHaveLength(0);
    expect(record.chain_head).toBe(chainGenesis(BINDING));
  });

  it('rejects smuggled entries and snapshots', () => {
    const smuggled = createSearchRecord({ ...BINDING, entries: [{}] } as unknown);
    expect(smuggled.ok).toBe(false);
    if (smuggled.ok) throw new Error('must fail');
    expect(smuggled.errors.map((e) => e.path)).toContain('entries');
    const smuggledSnaps = createSearchRecord({ ...BINDING, snapshots: [{}] } as unknown);
    expect(smuggledSnaps.ok).toBe(false);
  });

  it('collects binding violations', () => {
    const result = createSearchRecord({ tenant: 't' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    for (const path of ['experiment', 'evaluator', 'project']) {
      expect(result.errors.map((e) => e.path)).toContain(path);
    }
  });
});

describe('append laws (each a typed error)', () => {
  it('tenant_mismatch: a cross-tenant append is rejected (L12)', () => {
    const record = openRecord();
    const result = appendSearchTrial(record, trialInput({ trial: 't1' }));
    expect(result.ok).toBe(true);
    const wrongTenant = appendSearchTrial(record, { ...trialInput({ trial: 't2' }), tenant: 'tenant-2' });
    expect(wrongTenant.ok).toBe(false);
    if (wrongTenant.ok) throw new Error('must fail');
    expect(wrongTenant.errors[0]?.code).toBe('tenant_mismatch');
  });

  it('project mismatch is also tenant_mismatch-scoped (L15)', () => {
    const record = openRecord();
    const wrongProject = appendSearchTrial(record, { ...trialInput({ trial: 't1' }), project: 'project-2' });
    expect(wrongProject.ok).toBe(false);
    if (wrongProject.ok) throw new Error('must fail');
    expect(wrongProject.errors[0]?.code).toBe('tenant_mismatch');
    expect(wrongProject.errors[0]?.path).toBe('project');
  });

  it('duplicate_trial: one id, one entry (L11 — no rewrites)', () => {
    const record = appendAll(openRecord(), [{ trial: 't1' }]);
    const again = appendSearchTrial(record, trialInput({ trial: 't1' }));
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error('must fail');
    expect(again.errors[0]?.code).toBe('duplicate_trial');
  });

  it('unknown_parent: DAG edges point at logged trials', () => {
    const record = openRecord();
    const result = appendSearchTrial(record, trialInput({ trial: 't1', parents: ['ghost'] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('unknown_parent');
  });

  it('holdout_parent: holdout evidence may never become optimization input', () => {
    let record = appendAll(openRecord(), [{ trial: 'h1', classification: 'holdout', splits: ['split.holdout-1'] }]);
    const result = appendSearchTrial(record, trialInput({ trial: 't1', parents: ['h1'] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('holdout_parent');
    expect(result.errors[0]?.message).toContain('holdout');
  });

  it('non_monotonic_instant: the log is ordered by injected instants (L4)', () => {
    const record = appendAll(openRecord(), [{ trial: 't1', recordedAt: T0 + 200 }]);
    const backwards = appendSearchTrial(record, trialInput({ trial: 't2', recordedAt: T0 + 100 }));
    expect(backwards.ok).toBe(false);
    if (backwards.ok) throw new Error('must fail');
    expect(backwards.errors[0]?.code).toBe('non_monotonic_instant');
    // Equal instants are legal (a stable ordering exists — append order).
    const equal = appendSearchTrial(record, trialInput({ trial: 't2', recordedAt: T0 + 200 }));
    expect(equal.ok).toBe(true);
  });

  it('invalid trial input is collected, not thrown', () => {
    const record = openRecord();
    const result = appendSearchTrial(record, { tenant: BINDING.tenant, project: BINDING.project });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors.length).toBeGreaterThan(0);
    const badConfig = appendSearchTrial(record, { ...trialInput({ trial: 't1' }), config: 42 });
    expect(badConfig.ok).toBe(false);
    if (badConfig.ok) throw new Error('must fail');
    expect(badConfig.errors[0]?.path).toBe('config');
  });

  it('append returns a NEW record; the original is untouched', () => {
    const record = appendAll(openRecord(), [{ trial: 't1' }]);
    const grown = appendSearchTrial(record, trialInput({ trial: 't2', recordedAt: record.entries[0]?.recorded_at ?? T0 }));
    expect(grown.ok).toBe(true);
    if (!grown.ok) throw new Error('must append');
    expect(record.entries).toHaveLength(1);
    expect(grown.value.entries).toHaveLength(2);
    expect(grown.value.chain_head).not.toBe(record.chain_head);
  });
});

describe('the snapshot store', () => {
  it('dedupes identical configs by address', () => {
    const shared = { lr: '0.01' };
    const record = appendAll(openRecord(), [
      { trial: 't1', config: shared },
      { trial: 't2', config: { lr: '0.01' } },
      { trial: 't3', config: { lr: '0.02' } },
    ]);
    expect(record.snapshots).toHaveLength(2);
    const ids = record.snapshots.map((s) => s.snapshot_id);
    expect(new Set(ids).size).toBe(2);
    expect(record.entries.map((e) => e.config)).toEqual([ids[0], ids[0], ids[1]]);
  });
});

describe('CHAIN VERIFICATION (the hiding law)', () => {
  // t2 and t3 share an instant (equal instants are legal — append order
  // breaks the tie), which lets the reorder test below isolate the chain law.
  const RECORD = appendAll(openRecord(), [
    { trial: 't1', recordedAt: T0 + 100 },
    { trial: 't2', parents: ['t1'], recordedAt: T0 + 101 },
    { trial: 't3', parents: ['t1'], recordedAt: T0 + 101 },
    { trial: 't4', parents: ['t2', 't3'], recordedAt: T0 + 102 },
    { trial: 'h1', classification: 'holdout', splits: ['split.holdout-1'], recordedAt: T0 + 103 },
  ]);

  it('a well-formed record verifies and is deeply frozen', () => {
    const result = verifySearchRecord(RECORD);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must verify');
    expect(result.value.entries).toHaveLength(5);
    expect(isDeeplyFrozen(result.value)).toBe(true);
  });

  it('mutating any entry field fails chain_mismatch (structurally-valid edit)', () => {
    // A byte-level tamper that keeps every structural/log law intact:
    // only the CHAIN can catch it.
    const tampered = thaw(RECORD);
    tampered.entries[0]!.datasets = ['dataset-asia'];
    const result = verifySearchRecord(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('HIDING an entry fails chain_mismatch (removal breaks the head)', () => {
    const truncated = thaw(RECORD);
    // Drop the holdout leaf — the classic concealment (report the search
    // without its honest check). No log law references h1, so only the
    // chain can catch the removal.
    truncated.entries = truncated.entries.filter((e) => e.trial !== 'h1');
    const result = verifySearchRecord(truncated);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('chain_mismatch');
    expect(result.errors[0]?.message).toContain('truncated');
  });

  it('hiding a REFERENCED entry fails the DAG law (unknown_parent) even with a repaired head', () => {
    const truncated = thaw(RECORD);
    truncated.entries = truncated.entries.filter((e) => e.trial !== 't3'); // t4 references t3
    truncated.chain_head = computeChainHead(BINDING, truncated.entries as never);
    const result = verifySearchRecord(truncated);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors.map((e) => e.code)).toContain('unknown_parent');
  });

  it('reordering the log fails chain_mismatch (structurally-legal reorder)', () => {
    // t2 and t3 share an instant and both depend only on t1, so swapping
    // them violates no log law — only the chain catches the reorder.
    const swapped = thaw(RECORD);
    const t2 = swapped.entries[1]!;
    swapped.entries[1] = swapped.entries[2]!;
    swapped.entries[2] = t2;
    const result = verifySearchRecord(swapped);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('a forged identity fails chain_mismatch (identity and binding cannot disagree)', () => {
    const forged = thaw(RECORD);
    forged.experiment = 'exp-forged';
    const result = verifySearchRecord(forged);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('chain_mismatch');
    expect(result.errors[0]?.path).toBe('search_id');
  });

  it('a stale (replayed) head fails chain_mismatch', () => {
    const grown = appendSearchTrial(RECORD, trialInput({ trial: 't5', recordedAt: T0 + 500 }));
    if (!grown.ok) throw new Error('must append');
    const replayed = thaw(grown.value);
    replayed.chain_head = RECORD.chain_head; // the head from before the append
    expect(verifySearchRecord(replayed).ok).toBe(false);
  });

  it('verifySearchRecord also enforces the log-level laws on untrusted input', () => {
    // Each attack mutates a structurally-intact log into a log-law violation;
    // the law must fire even before any head comparison happens.
    const base = appendAll(openRecord(), [
      { trial: 'h0', classification: 'holdout', splits: ['split.holdout-1'] },
      { trial: 't1' },
      { trial: 't2', parents: ['t1'] },
      { trial: 't3', parents: ['t1'] },
    ]);
    const attacks: readonly { mutate: (r: LooseRecord) => void; code: string }[] = [
      { mutate: (r) => { r.entries[1]!.parents = ['ghost']; }, code: 'unknown_parent' },
      { mutate: (r) => { r.entries[2]!.parents = ['h0']; }, code: 'holdout_parent' },
      {
        mutate: (r) => {
          // A still-valid instant that rewinds below the previous entry's.
          r.entries[3]!.recorded_at = (r.entries[1]!.recorded_at as number) - 1;
        },
        code: 'non_monotonic_instant',
      },
      { mutate: (r) => { r.entries[0]!.parents = ['t1']; }, code: 'invalid_field' },
      { mutate: (r) => { r.entries[1]!.trial = r.entries[2]!.trial as string; }, code: 'duplicate_trial' },
    ];
    for (const attack of attacks) {
      const value = thaw(base);
      attack.mutate(value);
      // The attacker ALSO repairs the chain head over the tampered log, so
      // only the LOG LAW itself can reject the attack.
      value.chain_head = computeChainHead(BINDING, value.entries as never);
      const result = verifySearchRecord(value);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error(`must fail for ${attack.code}`);
      expect(result.errors.map((e) => e.code)).toContain(attack.code);
    }
  });

  it('an entry referencing an unstored snapshot fails snapshot_mismatch', () => {
    const orphan = JSON.parse(JSON.stringify(RECORD)) as SearchRecord;
    (orphan.entries[0] as { config: string }).config = 'snap:ffffffffffffffff';
    const result = verifySearchRecord(orphan);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors.map((e) => e.code)).toContain('snapshot_mismatch');
  });
});

describe('the chain fold', () => {
  it('is pure and order-sensitive', () => {
    const e1 = appendAll(openRecord(), [{ trial: 't1' }]).entries[0];
    const e2 = appendAll(openRecord(), [{ trial: 't2' }]).entries[0];
    if (!e1 || !e2) throw new Error('fixtures must exist');
    const h = chainGenesis(BINDING);
    expect(chainFold(h, e1)).toBe(chainFold(h, e1));
    expect(chainFold(h, e1)).not.toBe(chainFold(h, e2));
    const ab = chainFold(chainFold(h, e1), e2);
    const ba = chainFold(chainFold(h, e2), e1);
    expect(ab).not.toBe(ba);
  });

  it('computeChainHead over the same entries is stable', () => {
    const entries = RECORD_FIXTURE().entries;
    const binding = BINDING;
    expect(computeChainHead(binding, entries)).toBe(computeChainHead(binding, [...entries]));
  });
});

function RECORD_FIXTURE(): SearchRecord {
  return appendAll(openRecord(), [
    { trial: 't1' },
    { trial: 't2', parents: ['t1'] },
  ]);
}

describe('the DAG projection', () => {
  it('computes depths, edges and maxDepth', () => {
    const record = appendAll(openRecord(), [
      { trial: 't1' },
      { trial: 't2', parents: ['t1'] },
      { trial: 't3', parents: ['t1'] },
      { trial: 't4', parents: ['t2', 't3'] },
      { trial: 'h1', classification: 'holdout', splits: ['split.holdout-1'] },
    ]);
    const dag = searchDag(record);
    expect(dag.nodes.map((n) => [n.trial, n.depth])).toEqual([
      ['t1', 0],
      ['t2', 1],
      ['t3', 1],
      ['t4', 2],
      ['h1', 0],
    ]);
    expect(dag.edges).toEqual([
      { from: 't1', to: 't2' },
      { from: 't1', to: 't3' },
      { from: 't2', to: 't4' },
      { from: 't3', to: 't4' },
    ]);
    expect(dag.maxDepth).toBe(2);
    expect(dag.nodes[4]?.classification).toBe('holdout');
  });

  it('the projection is deeply frozen and deterministic', () => {
    const record = RECORD_FIXTURE();
    expect(searchDag(record)).toEqual(searchDag(record));
    expect(isDeeplyFrozen(searchDag(record))).toBe(true);
  });
});

describe('canonical record bytes', () => {
  it('equal records serialize byte-identically', () => {
    const a = RECORD_FIXTURE();
    const b = RECORD_FIXTURE();
    expect(canonicalSearchRecord(a)).toBe(canonicalSearchRecord(b));
    expect(canonicalSearchRecord(a)).not.toBe(canonicalSearchRecord(appendAll(openRecord(), [{ trial: 't1' }])));
  });
});

describe('injected instants only', () => {
  it('identical append sequences at identical instants produce identical records', () => {
    const a = appendAll(openRecord(), [
      { trial: 't1', recordedAt: requireTimestampMs(T0 + 1) },
      { trial: 't2', parents: ['t1'], recordedAt: requireTimestampMs(T0 + 2) },
    ]);
    const b = appendAll(openRecord(), [
      { trial: 't1', recordedAt: requireTimestampMs(T0 + 1) },
      { trial: 't2', parents: ['t1'], recordedAt: requireTimestampMs(T0 + 2) },
    ]);
    expect(a.chain_head).toBe(b.chain_head);
    expect(a.search_id).toBe(b.search_id);
  });
});
