// @tradrl/entitlements — the ledger tests: the append-only chain, the
// lifecycle laws, the exhaustion law (exact decimals), the idempotence
// law, the L4 snapshot, and the tamper detection.

import { describe, expect, it } from 'vitest';
import {
  amendEntitlementGrantOn,
  chainHeadOf,
  CONSUMPTION_CAUSES,
  consumeEntitlement,
  createEntitlementLedger,
  currentGrantOf,
  entitlementLedgerDigest,
  entitlementLedgerView,
  entitlementSnapshot,
  ENTITLEMENT_LOG_KINDS,
  GENESIS_CHAIN_HEAD,
  issueEntitlementGrant,
  isConsumptionRecord,
  revokeEntitlementGrant,
  rootIdOf,
  serializeEntitlementLedger,
  verifyEntitlementChain,
} from './index';
import type { EntitlementLedgerState, EntitlementResult, TimestampMs } from './index';

const TENANT = 'tenant-entitlement-fixture';
const PROJECT = 'prj-entitlement-fixture';
const T0 = 1_735_600_000_000;

function freshLedger(): EntitlementResult<EntitlementLedgerState> {
  return createEntitlementLedger(TENANT);
}

function issueSpend(state: EntitlementLedgerState, amount = '100', projectId: string | null = null, effectiveFrom = T0) {
  return issueEntitlementGrant(state, {
    tenantId: TENANT,
    projectId,
    kind: 'spend-allowance',
    terms: { kind: 'spend-allowance', currency: 'usd-cents', amount },
    version: 1,
    supersedes: null,
    sourceRef: 'plan://operator/test',
    issuedAt: T0,
    effectiveFrom,
    effectiveUntil: null,
  });
}

function charge(state: EntitlementLedgerState, grantId: string | null, amount: string, at: number, projectId = PROJECT) {
  return consumeEntitlement(state, {
    grantId,
    projectId,
    currency: 'usd-cents',
    amount,
    cause: 'marketplace-charge',
    refs: ['po:0123456789abcdef'],
    at: at as TimestampMs,
  });
}

describe('the ledger lifecycle (issue -> amend -> revoke)', () => {
  it('issues a root grant (version 1 only) and appends exactly one log entry', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value);
    expect(issued.ok).toBe(true);
    if (issued.ok) {
      expect(issued.value.replayed).toBe(false);
      expect(issued.value.state.log).toHaveLength(1);
      expect(issued.value.state.log[0].kind).toBe('grant-issued');
      expect(issued.value.state.log[0].priorHead).toBe(GENESIS_CHAIN_HEAD);
    }
  });

  it('issuing a non-root draft is the typed invalid_transition', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueEntitlementGrant(ledger.value, {
      tenantId: TENANT,
      projectId: null,
      kind: 'spend-allowance',
      terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '1' },
      version: 2,
      supersedes: 'eg:0123456789abcdef',
      sourceRef: 'plan://operator/test',
      issuedAt: T0,
      effectiveFrom: T0,
      effectiveUntil: null,
    });
    expect(issued.ok).toBe(false);
    if (!issued.ok) expect(issued.errors[0].code).toBe('invalid_transition');
  });

  it('amends the CURRENT version only; stale ids are the typed grant_mismatch', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const v1 = issueSpend(ledger.value, '100');
    if (!v1.ok) throw new Error('unreachable');
    const v2 = amendEntitlementGrantOn(v1.value.state, {
      priorGrantId: v1.value.record.grantId,
      projectId: null,
      terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '200' },
      sourceRef: 'plan://operator/test',
      issuedAt: T0 + 1,
      effectiveFrom: T0 + 1,
      effectiveUntil: null,
    });
    expect(v2.ok).toBe(true);
    if (!v2.ok) throw new Error('unreachable');
    expect(v2.value.record.version).toBe(2);
    // Amending the STALE v1 id is the refusal.
    const stale = amendEntitlementGrantOn(v2.value.state, {
      priorGrantId: v1.value.record.grantId,
      projectId: null,
      terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '300' },
      sourceRef: 'plan://operator/test',
      issuedAt: T0 + 2,
      effectiveFrom: T0 + 2,
      effectiveUntil: null,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.errors[0].code).toBe('grant_mismatch');
    // Lookups resolve any version id to the chain's current version.
    expect(currentGrantOf(v2.value.state, v1.value.record.grantId)?.grantId).toBe(v2.value.record.grantId);
    expect(rootIdOf(v2.value.state, v2.value.record.grantId)).toBe(v1.value.record.grantId);
  });

  it('revocation is terminal: one revocation, no later amendment, no later consumption', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    const revoked = revokeEntitlementGrant(issued.value.state, { grantId: issued.value.record.grantId, revokedAt: T0 + 10 });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) throw new Error('unreachable');
    // The same revocation replays idempotently.
    const replay = revokeEntitlementGrant(revoked.value.state, { grantId: issued.value.record.grantId, revokedAt: T0 + 10 });
    expect(replay.ok && replay.value.replayed).toBe(true);
    // A second, different revocation instant is the terminal refusal.
    const again = revokeEntitlementGrant(revoked.value.state, { grantId: issued.value.record.grantId, revokedAt: T0 + 20 });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors[0].code).toBe('invalid_transition');
    // A revoked chain never amends.
    const amend = amendEntitlementGrantOn(revoked.value.state, {
      priorGrantId: issued.value.record.grantId,
      projectId: null,
      terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '300' },
      sourceRef: 'plan://operator/test',
      issuedAt: T0 + 30,
      effectiveFrom: T0 + 30,
      effectiveUntil: null,
    });
    expect(amend.ok).toBe(false);
    if (!amend.ok) expect(amend.errors[0].code).toBe('invalid_transition');
    // A revoked chain never consumes.
    const draw = charge(revoked.value.state, issued.value.record.grantId, '1', T0 + 40);
    expect(draw.ok).toBe(false);
    if (!draw.ok) expect(draw.errors[0].code).toBe('entitlement_revoked');
  });

  it('the log kinds are exactly the four operations', () => {
    expect([...ENTITLEMENT_LOG_KINDS]).toEqual(['grant-issued', 'grant-amended', 'grant-revoked', 'consumed']);
  });
});

describe('the exhaustion law (exact decimals, L20)', () => {
  it('draws down exactly, to the last cent', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    let state = issued.value.state;
    for (const [amount, at] of [['33.335', T0 + 1], ['33.335', T0 + 2], ['33.33', T0 + 3]] as const) {
      const draw = charge(state, issued.value.record.grantId, amount, at);
      expect(draw.ok).toBe(true);
      if (draw.ok) state = draw.value.state;
    }
    // 100 spent exactly; one more cent is refused.
    const over = charge(state, issued.value.record.grantId, '0.01', T0 + 4);
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.errors[0].code).toBe('entitlement_exhausted');
      expect(over.errors[0].message).toContain('0.01');
    }
  });

  it('the float trap is exact here: 0.1 x 3 draws "0.3", not 0.30000000000000004', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '0.3');
    if (!issued.ok) throw new Error('unreachable');
    let state = issued.value.state;
    for (const at of [T0 + 1, T0 + 2, T0 + 3]) {
      const draw = charge(state, issued.value.record.grantId, '0.1', at);
      expect(draw.ok).toBe(true);
      if (draw.ok) state = draw.value.state;
    }
    const over = charge(state, issued.value.record.grantId, '0.00000000000000001', T0 + 4);
    expect(over.ok).toBe(false);
  });

  it('the currency law: a charge in the wrong currency is the typed refusal', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    const wrong = consumeEntitlement(issued.value.state, {
      grantId: issued.value.record.grantId,
      projectId: PROJECT,
      currency: 'eur-cents',
      amount: '1',
      cause: 'marketplace-charge',
      refs: [],
      at: T0 + 1,
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.errors[0].code).toBe('grant_mismatch');
  });

  it('the window law: a charge before effectiveFrom is refused (entitlement_inactive)', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100', null, T0 + 100);
    if (!issued.ok) throw new Error('unreachable');
    const early = charge(issued.value.state, issued.value.record.grantId, '1', T0 + 50);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.errors[0].code).toBe('entitlement_inactive');
  });

  it('an expired allowance refuses charges (entitlement_expired)', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueEntitlementGrant(ledger.value, {
      tenantId: TENANT,
      projectId: null,
      kind: 'spend-allowance',
      terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '100' },
      version: 1,
      supersedes: null,
      sourceRef: 'plan://operator/test',
      issuedAt: T0,
      effectiveFrom: T0,
      effectiveUntil: T0 + 1000,
    });
    if (!issued.ok) throw new Error('unreachable');
    const late = charge(issued.value.state, issued.value.record.grantId, '1', T0 + 2000);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.errors[0].code).toBe('entitlement_expired');
  });

  it('project coverage: a project-scoped allowance covers only its project', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100', PROJECT);
    if (!issued.ok) throw new Error('unreachable');
    const foreignProject = charge(issued.value.state, issued.value.record.grantId, '1', T0 + 1, 'prj-other');
    expect(foreignProject.ok).toBe(false);
    if (!foreignProject.ok) expect(foreignProject.errors[0].code).toBe('grant_mismatch');
    const ownProject = charge(issued.value.state, issued.value.record.grantId, '1', T0 + 1, PROJECT);
    expect(ownProject.ok).toBe(true);
  });

  it('auto-selection draws the first covering chain in canonical order (deterministic)', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const first = issueSpend(ledger.value, '100');
    if (!first.ok) throw new Error('unreachable');
    const second = issueSpend(first.value.state, '50', null, T0); // same issuedAt -> grantId tiebreak
    if (!second.ok) throw new Error('unreachable');
    const draw = charge(second.value.state, null, '10', T0 + 1);
    expect(draw.ok).toBe(true);
    if (draw.ok) {
      // The drawn grant is one of the two, deterministically: re-run the
      // identical op sequence and the same grant is drawn.
      const replayRun = charge(second.value.state, null, '10', T0 + 1);
      expect(replayRun.ok && replayRun.value.record.grantId).toBe(draw.value.record.grantId);
    }
  });

  it('auto-selection with no covering allowance is the typed exhaustion refusal', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const draw = charge(ledger.value, null, '1', T0 + 1);
    expect(draw.ok).toBe(false);
    if (!draw.ok) expect(draw.errors[0].code).toBe('entitlement_exhausted');
  });

  it('non-spend kinds are never drawn (api quotas enforce usage; licenses grant rights)', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const quota = issueEntitlementGrant(ledger.value, {
      tenantId: TENANT,
      projectId: null,
      kind: 'api-quota',
      terms: { kind: 'api-quota', routeFamilies: ['jobs:write'], maxRequests: 5, windowMs: 1000 },
      version: 1,
      supersedes: null,
      sourceRef: 'plan://operator/test',
      issuedAt: T0,
      effectiveFrom: T0,
      effectiveUntil: null,
    });
    if (!quota.ok) throw new Error('unreachable');
    const draw = charge(quota.value.state, quota.value.record.grantId, '1', T0 + 1);
    expect(draw.ok).toBe(false);
    if (!draw.ok) expect(draw.errors[0].code).toBe('grant_mismatch');
  });

  it('the amendment exhaustion law: an allowance never reduces below accumulated consumption', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    const spent = charge(issued.value.state, issued.value.record.grantId, '80', T0 + 1);
    if (!spent.ok) throw new Error('unreachable');
    const reduced = amendEntitlementGrantOn(spent.value.state, {
      priorGrantId: issued.value.record.grantId,
      projectId: null,
      terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '79.99' },
      sourceRef: 'plan://operator/test',
      issuedAt: T0 + 2,
      effectiveFrom: T0 + 2,
      effectiveUntil: null,
    });
    expect(reduced.ok).toBe(false);
    if (!reduced.ok) expect(reduced.errors[0].code).toBe('entitlement_exhausted');
    const raised = amendEntitlementGrantOn(spent.value.state, {
      priorGrantId: issued.value.record.grantId,
      projectId: null,
      terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '80' },
      sourceRef: 'plan://operator/test',
      issuedAt: T0 + 2,
      effectiveFrom: T0 + 2,
      effectiveUntil: null,
    });
    expect(raised.ok).toBe(true);
  });

  it('consumption records satisfy their guard; the cause vocabulary is closed at ["marketplace-charge"]', () => {
    expect([...CONSUMPTION_CAUSES]).toEqual(['marketplace-charge']);
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    const draw = charge(issued.value.state, issued.value.record.grantId, '1', T0 + 1);
    expect(draw.ok).toBe(true);
    if (draw.ok) expect(isConsumptionRecord(draw.value.record)).toBe(true);
  });

  it('a zero or negative draw is the typed invalid_decimal', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    for (const amount of ['0', '-1', '0.0', '1e2', '01']) {
      const draw = charge(issued.value.state, issued.value.record.grantId, amount, T0 + 1);
      expect(draw.ok).toBe(false);
      if (!draw.ok) expect(draw.errors[0].code).toBe('invalid_decimal');
    }
  });
});

describe('the idempotence law (content-addressed)', () => {
  it('an identical charge replays without a new log entry', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    const first = charge(issued.value.state, issued.value.record.grantId, '10', T0 + 1);
    expect(first.ok && first.value.replayed).toBe(false);
    if (!first.ok) throw new Error('unreachable');
    const second = charge(first.value.state, issued.value.record.grantId, '10', T0 + 1);
    expect(second.ok && second.value.replayed).toBe(true);
    if (second.ok) {
      expect(second.value.state.log).toHaveLength(first.value.state.log.length);
      expect(second.value.record.consumptionId).toBe(first.value.record.consumptionId);
    }
  });

  it('a different instant or amount is a DIFFERENT consumption (both append)', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    const a = charge(issued.value.state, issued.value.record.grantId, '10', T0 + 1);
    if (!a.ok) throw new Error('unreachable');
    const b = charge(a.value.state, issued.value.record.grantId, '10', T0 + 2);
    expect(b.ok && b.value.replayed).toBe(false);
  });
});

describe('the monotone-instant law (the exhaustion law\'s enabling law)', () => {
  // RED-FIRST PROOF (recorded 2026-10-05, before the fix): a charge
  // appended with an instant BEFORE the log's last entry was validated
  // against only the consumption at or before ITS OWN instant, so two
  // 25-draws (appended at T0+110 then backdated to T0+100) summed to 50
  // against a 40 allowance, and entitlementSnapshot then THREW a
  // TypeError out of its pure `remaining` arithmetic
  // (unsignedSubtract: 40 < 50 — "a draw-down never goes negative").
  // The monotone gate refuses the backdated APPEND; replays never append.

  it('a backdated charge that would cross the all-time line is the typed l4_boundary_violation', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    // Amend DOWN to 40 at T0+50 (window covers both charge instants).
    const amended = amendEntitlementGrantOn(issued.value.state, {
      priorGrantId: issued.value.record.grantId,
      projectId: null,
      terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '40' },
      sourceRef: 'plan://operator/test',
      issuedAt: T0 + 50,
      effectiveFrom: T0 + 50,
      effectiveUntil: T0 + 10_000,
    });
    if (!amended.ok) throw new Error('unreachable');
    // Appended first (accepted): 25 at T0+110.
    const late = charge(amended.value.state, amended.value.record.grantId, '25', T0 + 110);
    if (!late.ok) throw new Error('unreachable');
    // The backdated second charge (instant before the log's last entry)
    // would have been accepted against consumed@T0+100 = 0 — the all-time
    // sum would then be 50 > 40 and the snapshot would throw.
    const early = charge(late.value.state, amended.value.record.grantId, '25', T0 + 100);
    expect(early.ok).toBe(false);
    if (!early.ok) {
      expect(early.errors[0].code).toBe('l4_boundary_violation');
      expect(early.errors[0].message).toContain('predates the ledger\'s last recorded instant');
    }
    // The state is unchanged (no append happened).
    expect(late.value.state.consumptions.size).toBe(1);
    // The snapshot stays a total pure read: remaining is exact, never negative.
    const snap = entitlementSnapshot(late.value.state, T0 + 500);
    if (!snap.ok) throw new Error('unreachable');
    expect(snap.value.entries[0].consumed).toBe('25');
    expect(snap.value.entries[0].remaining).toBe('15');
    expect(verifyEntitlementChain(late.value.state).ok).toBe(true);
  });

  it('the same law refuses a backdated ISSUE append; a revocation replay stays safe', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    const revoked = revokeEntitlementGrant(issued.value.state, { grantId: issued.value.record.grantId, revokedAt: T0 + 10 });
    if (!revoked.ok) throw new Error('unreachable');
    // A new root grant backdated below the revocation's instant is refused
    // on the append path (its issuedAt T0+5 predates the log's last T0+10).
    const backdatedIssue = issueSpend(revoked.value.state, '5', null, T0 + 5);
    expect(backdatedIssue.ok).toBe(false);
    if (!backdatedIssue.ok) expect(backdatedIssue.errors[0].code).toBe('l4_boundary_violation');
    // A revocation replay at its ORIGINAL instant never appends — safe.
    const second = revokeEntitlementGrant(revoked.value.state, { grantId: issued.value.record.grantId, revokedAt: T0 + 10 });
    expect(second.ok && second.value.replayed).toBe(true);
  });

  it('an idempotent replay of an OLD charge after later appends stays safe', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    const first = charge(issued.value.state, issued.value.record.grantId, '10', T0 + 1);
    if (!first.ok) throw new Error('unreachable');
    const second = charge(first.value.state, issued.value.record.grantId, '10', T0 + 5);
    if (!second.ok) throw new Error('unreachable');
    // Re-submitting the FIRST charge (its instant T0+1 predates the log's
    // last entry T0+5) is a REPLAY, not an append — idempotence holds.
    const replay = charge(second.value.state, issued.value.record.grantId, '10', T0 + 1);
    expect(replay.ok && replay.value.replayed).toBe(true);
    if (replay.ok) {
      expect(replay.value.state.log).toHaveLength(second.value.state.log.length);
      expect(replay.value.record.consumptionId).toBe(first.value.record.consumptionId);
    }
  });

  it('verifyEntitlementChain: a hand-crafted non-monotone log is the typed chain_mismatch', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    const drawn = charge(issued.value.state, issued.value.record.grantId, '10', T0 + 1);
    if (!drawn.ok) throw new Error('unreachable');
    // Rebuild the log in REVERSED order with seq/priorHead/head fully
    // recomputed (so every per-entry check still passes) — the only leg
    // that can catch the rewrite is the monotone-instant leg.
    const entries = drawn.value.state.log;
    const reversed = [...entries].reverse();
    const log = reversed.map((entry, index) => {
      const priorHead = index === 0 ? GENESIS_CHAIN_HEAD : headOfEntry(reversed[index - 1].head);
      const content = { seq: index, kind: entry.kind, recordId: entry.recordId, recordDigest: entry.recordDigest, at: entry.at, priorHead };
      return Object.freeze({ ...content, head: chainHeadOf(content) }) as (typeof entries)[number];
    });
    function headOfEntry(head: string): string { return head; }
    const crafted = { ...drawn.value.state, log };
    const verified = verifyEntitlementChain(crafted);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0].code).toBe('chain_mismatch');
  });

  it('verifyEntitlementChain: a state crafted past the exhaustion line is the typed chain_mismatch', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100', null, T0);
    if (!issued.ok) throw new Error('unreachable');
    const drawn = charge(issued.value.state, issued.value.record.grantId, '60', T0 + 1);
    if (!drawn.ok) throw new Error('unreachable');
    // Craft: keep the log and records intact, but swap the current version
    // for a LOWER amount than the all-time consumption — only the
    // exhaustion-invariant leg can catch it.
    const lowered = {
      ...drawn.value.state,
      current: new Map(drawn.value.state.current).set(issued.value.record.grantId, {
        ...issued.value.record,
        version: 2,
        supersedes: issued.value.record.grantId,
        terms: { kind: 'spend-allowance' as const, currency: 'usd-cents', amount: '50' },
      }),
    };
    const verified = verifyEntitlementChain(lowered);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0].code).toBe('chain_mismatch');
  });
});

describe('the chain law (tamper-evident history)', () => {
  it('the whole ledger verifies green after a full lifecycle', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    const amended = amendEntitlementGrantOn(issued.value.state, {
      priorGrantId: issued.value.record.grantId,
      projectId: null,
      terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '200' },
      sourceRef: 'plan://operator/test',
      issuedAt: T0 + 1,
      effectiveFrom: T0 + 1,
      effectiveUntil: null,
    });
    if (!amended.ok) throw new Error('unreachable');
    const drawn = charge(amended.value.state, amended.value.record.grantId, '50', T0 + 2);
    if (!drawn.ok) throw new Error('unreachable');
    const revoked = revokeEntitlementGrant(drawn.value.state, { grantId: amended.value.record.grantId, revokedAt: T0 + 3 });
    if (!revoked.ok) throw new Error('unreachable');
    expect(verifyEntitlementChain(revoked.value.state).ok).toBe(true);
    expect(revoked.value.state.log).toHaveLength(4);
    // The chain heads link: each entry's priorHead is the prior entry's head.
    const log = revoked.value.state.log;
    expect(log[1].priorHead).toBe(log[0].head);
    expect(log[2].priorHead).toBe(log[1].head);
    expect(log[3].priorHead).toBe(log[2].head);
  });

  it('a rewritten record is the typed chain_mismatch (the digest leg)', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    const tampered = {
      ...issued.value.state,
      grants: new Map(issued.value.state.grants).set(issued.value.record.grantId, {
        ...issued.value.record,
        terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '999999' },
      }),
    };
    const verified = verifyEntitlementChain(tampered);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0].code).toBe('chain_mismatch');
  });

  it('a spliced-out log entry is the typed chain_mismatch (the seq/priorHead legs)', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100');
    if (!issued.ok) throw new Error('unreachable');
    const drawn = charge(issued.value.state, issued.value.record.grantId, '10', T0 + 1);
    if (!drawn.ok) throw new Error('unreachable');
    const spliced = { ...drawn.value.state, log: [drawn.value.state.log[1]] };
    const verified = verifyEntitlementChain(spliced);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0].code).toBe('chain_mismatch');
  });

  it('chainHeadOf derives the entry-head grammar (elog: + 16-hex)', () => {
    expect(chainHeadOf({ seq: 0, kind: 'grant-issued', recordId: 'eg:0123456789abcdef', at: T0, priorHead: GENESIS_CHAIN_HEAD })).toMatch(/^elog:[0-9a-f]{16}$/);
  });
});

describe('the point-in-time snapshot (L4)', () => {
  it('answers what was allowed at T from retained history alone', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const v1 = issueSpend(ledger.value, '100');
    if (!v1.ok) throw new Error('unreachable');
    const v2 = amendEntitlementGrantOn(v1.value.state, {
      priorGrantId: v1.value.record.grantId,
      projectId: null,
      terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '200' },
      sourceRef: 'plan://operator/test',
      issuedAt: T0 + 100,
      effectiveFrom: T0 + 100,
      effectiveUntil: null,
    });
    if (!v2.ok) throw new Error('unreachable');
    const drawn = charge(v2.value.state, v2.value.record.grantId, '75', T0 + 200);
    if (!drawn.ok) throw new Error('unreachable');
    const revoked = revokeEntitlementGrant(drawn.value.state, { grantId: v2.value.record.grantId, revokedAt: T0 + 300 });
    if (!revoked.ok) throw new Error('unreachable');
    const state = revoked.value.state;

    // BEFORE the amendment: v1 with the full allowance.
    const before = entitlementSnapshot(state, T0 + 50);
    expect(before.ok).toBe(true);
    if (before.ok) {
      expect(before.value.entries).toHaveLength(1);
      expect(before.value.entries[0].grant.version).toBe(1);
      expect(before.value.entries[0].status).toBe('active');
      expect(before.value.entries[0].remaining).toBe('100');
    }
    // BETWEEN amendment and charge: v2 with the full 200.
    const middle = entitlementSnapshot(state, T0 + 150);
    expect(middle.ok).toBe(true);
    if (middle.ok) {
      expect(middle.value.entries[0].grant.version).toBe(2);
      expect(middle.value.entries[0].remaining).toBe('200');
      expect(middle.value.entries[0].consumed).toBe('0');
    }
    // AFTER the charge but BEFORE revocation: v2 with 125 left.
    const charged = entitlementSnapshot(state, T0 + 250);
    expect(charged.ok).toBe(true);
    if (charged.ok) {
      expect(charged.value.entries[0].consumed).toBe('75');
      expect(charged.value.entries[0].remaining).toBe('125');
      expect(charged.value.entries[0].status).toBe('active');
    }
    // AFTER revocation: revoked, with the consumption history intact.
    const after = entitlementSnapshot(state, T0 + 400);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.entries[0].status).toBe('revoked');
      expect(after.value.entries[0].revokedAt).toBe(T0 + 300);
      expect(after.value.entries[0].consumed).toBe('75');
    }
  });

  it('chains that did not exist at T are absent', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value, '100', null, T0 + 50);
    if (!issued.ok) throw new Error('unreachable');
    const early = entitlementSnapshot(issued.value.state, T0 - 1);
    expect(early.ok).toBe(true);
    if (early.ok) expect(early.value.entries).toHaveLength(0);
  });

  it('an invalid snapshot instant is the typed refusal', () => {
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const snap = entitlementSnapshot(ledger.value, 1.5);
    expect(snap.ok).toBe(false);
    if (!snap.ok) expect(snap.errors[0].code).toBe('invalid_timestamp');
  });
});

describe('serialization (byte-deterministic)', () => {
  it('the view + canonical bytes + digest are stable for the same op sequence', () => {
    const run = (): string => {
      const ledger = freshLedger();
      if (!ledger.ok) throw new Error('unreachable');
      const issued = issueSpend(ledger.value, '100');
      if (!issued.ok) throw new Error('unreachable');
      const drawn = charge(issued.value.state, issued.value.record.grantId, '33.5', T0 + 1);
      if (!drawn.ok) throw new Error('unreachable');
      return serializeEntitlementLedger(drawn.value.state);
    };
    expect(run()).toBe(run());
    const ledger = freshLedger();
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueSpend(ledger.value);
    if (!issued.ok) throw new Error('unreachable');
    expect(entitlementLedgerView(issued.value.state).grants).toHaveLength(1);
    expect(entitlementLedgerDigest(issued.value.state)).toMatch(/^[0-9a-f]{16}$/);
  });
});
