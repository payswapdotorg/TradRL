// Tests for the launch draft store — FW-40-B (the boot-seam draft
// persistence, S2's draft-lost-on-reload finding).
//
// Laws pinned here (launch-draft-store.ts header):
//   - a wizard draft with COMMITTED investment (any committed edit,
//     any chosen step) persists as ONE versioned JSON record under the
//     scope it was authored in, and restores only into THAT scope —
//     a draft authored on another desk NEVER restores elsewhere;
//   - the grammar is STRICT + fail-closed: a wrong version, a
//     malformed field, or untrusted garbage degrades the WHOLE record
//     to absent (never a half-applied draft);
//   - the storage seam is best-effort (a refusing storage degrades to
//     session-only, never a throw);
//   - the CLEAR writes the canonical empty string (a seam with no
//     removeItem stays honest — the posture legacy-key precedent).

import { describe, expect, it } from 'vitest';
import {
  clearStoredLaunchDraft,
  LAUNCH_DRAFT_STORAGE_KEY,
  parseStoredLaunchDraft,
  persistLaunchDraft,
  readStoredLaunchDraft,
  readStoredLaunchDraftRecord,
  type LaunchDraftStorage,
} from './launch-draft-store';
import type { LaunchDraft } from './launch';
import type { WorkspaceScope } from './tenant';

const T0 = 1_700_000_000_000;
const SCOPE: WorkspaceScope = { tenantId: 'tenant-a', projectId: 'prj-a' };

/** An in-memory storage seam (localStorage in production). */
class MapStorage implements LaunchDraftStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/** A draft fixture with investment in every field (the J3 wizard's committed shape). */
function draft(overrides: Partial<LaunchDraft> = {}): LaunchDraft {
  return {
    name: 'Momentum scout',
    objective: 'Find and keep an edge in momentum.',
    horizon: { startsAt: T0, endsAt: T0 + 86_400_000, label: 'Q1' },
    successCriteria: [{ id: 'sc-1', metric: 'pnl.net', predicate: { kind: 'limit.min', bound: 0 }, description: 'net profit is non-negative' }],
    evaluation: { blindRef: 'eval:blind-1', walkForwardRef: 'eval:wf-1', regimeRef: 'eval:regime-1', adversarialRequired: true },
    constraints: [{ id: 'c-1', domain: 'outcome', subject: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, severity: 'blocking' }],
    capitalBudget: '10000.00',
    riskBudget: '250.00',
    markets: ['binance:BTC-USDT'],
    venues: ['binance'],
    dataSources: ['candles:1m'],
    executionMode: 'simulation',
    preferences: [{ key: 'rebalance', value: 'daily' }],
    ...overrides,
  };
}

/** The serialized record of a draft under a scope (the hand-seeded browser state). */
function recordOf(scope: WorkspaceScope, theDraft: LaunchDraft, step = 'budget', savedAt = T0 + 500): string {
  return JSON.stringify({ version: 1, tenantId: scope.tenantId, projectId: scope.projectId, savedAt, step, draft: theDraft });
}

describe('FW-40-B: the launch draft record (parse + persist round-trip)', () => {
  it('the round-trip is exact: persist -> read (same scope) -> the same draft + step + saved-at', () => {
    const storage = new MapStorage();
    persistLaunchDraft(storage, SCOPE, draft(), 'markets', T0 + 750);
    const record = readStoredLaunchDraft(storage, SCOPE);
    if (record === null) throw new Error('the persisted record did not read back');
    expect(record.draft).toEqual(draft());
    expect(record.step).toBe('markets');
    expect(record.savedAt).toBe(T0 + 750);
    expect(record.tenantId).toBe('tenant-a');
    expect(record.projectId).toBe('prj-a');
    expect(record.version).toBe(1);
  });

  it('STRICT: anything malformed degrades the WHOLE record to absent — never a half-applied draft', () => {
    expect(parseStoredLaunchDraft(null)).toBeNull();
    expect(parseStoredLaunchDraft('')).toBeNull(); // the canonical cleared value reads as absent
    expect(parseStoredLaunchDraft('not json')).toBeNull();
    expect(parseStoredLaunchDraft('{"version":1,"draft":')).toBeNull(); // truncated JSON
    expect(parseStoredLaunchDraft('42')).toBeNull(); // a scalar is not a record
    expect(parseStoredLaunchDraft('[]')).toBeNull();
    expect(parseStoredLaunchDraft(recordOf(SCOPE, draft(), 'goal').replace('"version":1', '"version":2'))).toBeNull(); // a future version never misreads
    expect(parseStoredLaunchDraft(recordOf(SCOPE, draft(), 'nonsense'))).toBeNull(); // the step must be one of the wizard's own closed set
    expect(parseStoredLaunchDraft(recordOf({ tenantId: '', projectId: 'prj-a' }, draft()))).toBeNull(); // the scope must be named
    expect(parseStoredLaunchDraft(recordOf(SCOPE, draft(), 'goal', T0 + 0.5))).toBeNull(); // the saved-at must be an integer epoch ms
    // the draft's own grammar, field by field (a corrupted field never half-applies)
    expect(parseStoredLaunchDraft(recordOf(SCOPE, draft({ name: 7 as never })))).toBeNull();
    expect(parseStoredLaunchDraft(recordOf(SCOPE, draft({ horizon: { startsAt: 'soon', endsAt: T0 } as never })))).toBeNull();
    expect(parseStoredLaunchDraft(recordOf(SCOPE, draft({ successCriteria: [{ id: 'sc-1', metric: 7 as never, predicate: { kind: 'limit.min', bound: 0 } as never }] })))).toBeNull();
    expect(parseStoredLaunchDraft(recordOf(SCOPE, draft({ evaluation: { blindRef: 'b', walkForwardRef: 'w', regimeRef: 'r', adversarialRequired: 'yes' as never } })))).toBeNull();
    expect(parseStoredLaunchDraft(recordOf(SCOPE, draft({ constraints: [{ id: 'c-1', domain: 'outcome', subject: 'risk.maxDrawdown', predicate: 'max 0.2' as never, severity: 'blocking' }] })))).toBeNull();
    expect(parseStoredLaunchDraft(recordOf(SCOPE, draft({ capitalBudget: 10000 as never })))).toBeNull();
    expect(parseStoredLaunchDraft(recordOf(SCOPE, draft({ markets: ['binance:BTC-USDT', 7 as never] })))).toBeNull();
    expect(parseStoredLaunchDraft(recordOf(SCOPE, draft({ executionMode: 'paper' as never })))).toBeNull();
    expect(parseStoredLaunchDraft(recordOf(SCOPE, draft({ preferences: [{ key: 'rebalance', value: 7 as never }] })))).toBeNull();
  });

  it('a blank-but-structured draft still parses (the wizard\'s own validation remains the semantic teacher — the store never fabricates content)', () => {
    const blank = draft({ name: '', objective: '', successCriteria: [], constraints: [], markets: [], venues: [], dataSources: [], preferences: [] });
    const parsed = parseStoredLaunchDraft(recordOf(SCOPE, blank, 'markets'));
    expect(parsed?.draft).toEqual(blank);
  });
});

describe('FW-40-B: the restore gate (never restore into a different project\'s scope)', () => {
  it('a record authored on ANOTHER desk never restores (the desk that asks is the desk that gets its own draft back, exactly and only)', () => {
    const storage = new MapStorage();
    persistLaunchDraft(storage, { tenantId: 'tenant-a', projectId: 'prj-quiet' }, draft(), 'budget', T0 + 500);
    expect(readStoredLaunchDraft(storage, SCOPE)).toBeNull(); // this desk's read
    expect(readStoredLaunchDraft(storage, { tenantId: 'tenant-b', projectId: 'prj-quiet' })).toBeNull(); // a foreign TENANT never restores either
    expect(readStoredLaunchDraft(storage, { tenantId: 'tenant-a', projectId: 'prj-quiet' })).not.toBeNull(); // the authoring desk's own read
  });

  it('the ungated boot-capture read returns the record regardless of scope (the console gates at the SETTLED scope, not at the capture)', () => {
    const storage = new MapStorage();
    persistLaunchDraft(storage, { tenantId: 'tenant-a', projectId: 'prj-quiet' }, draft(), 'budget', T0 + 500);
    const record = readStoredLaunchDraftRecord(storage);
    if (record === null) throw new Error('the boot-capture read lost the record');
    expect(record.projectId).toBe('prj-quiet');
  });
});

describe('FW-40-B: the clear (a successful launch / an explicit reset)', () => {
  it('the clear writes the canonical empty string and every later read is absent', () => {
    const storage = new MapStorage();
    persistLaunchDraft(storage, SCOPE, draft(), 'review', T0 + 900);
    expect(storage.map.get(LAUNCH_DRAFT_STORAGE_KEY)).not.toBe('');
    clearStoredLaunchDraft(storage);
    expect(storage.map.get(LAUNCH_DRAFT_STORAGE_KEY)).toBe(''); // the no-removeItem seam's own cleared form
    expect(readStoredLaunchDraft(storage, SCOPE)).toBeNull();
    expect(readStoredLaunchDraftRecord(storage)).toBeNull();
  });
});

describe('FW-40-B: the storage seam is best-effort (never a throw)', () => {
  it('a storage that refuses reads degrades to absent; a storage that refuses writes degrades to session-only', () => {
    const refusing: LaunchDraftStorage = {
      getItem: () => {
        throw new Error('private mode');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(readStoredLaunchDraft(refusing, SCOPE)).toBeNull();
    expect(() => persistLaunchDraft(refusing, SCOPE, draft(), 'goal', T0)).not.toThrow();
    expect(() => clearStoredLaunchDraft(refusing)).not.toThrow();
  });
});
