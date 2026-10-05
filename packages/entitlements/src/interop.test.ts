// Cross-lane interoperability trip wires for the entitlements lane
// (Work Order T047): the REAL lanes this lane consumes ONLY through
// its STRUCTURAL MIRRORS are loaded STATICALLY here (the tests are the
// trip wires — the src lane itself imports none of them):
//
//   - services/api (T041 — the boundary that RECORDS usage): the REAL
//     `UsageLedger` emits REAL usage records through the REAL
//     `record()` write path; those records satisfy this lane's mirror
//     field-for-field (type-level witness + runtime guard), the REAL
//     route-family vocabulary matches this lane's mirror
//     member-for-member, and the R41 HANDOFF works end-to-end: REAL
//     recorded facts + this lane's api-quota grants drive the
//     allowance decision — the boundary records, this lane enforces.
//   - packages/firm-memory (T034's contract kernel): the REAL exact
//     decimal helpers (signed add/subtract/negate/abs/compare,
//     unsigned add + the canonical grammar guards) agree with this
//     lane's local kernel on a corpus of signed pairs — the parity
//     trip wire that licenses the zero-import design (one program-wide
//     money law).
//   - packages/skills (T017): the REAL `stableDigest` agrees with this
//     lane's mirror fold on shared vectors (ASCII + non-ASCII) — the
//     program-wide digest law.
//   - packages/sdk (T041): the REAL `SDK_ERROR_FAMILIES` matches this
//     lane's mirror member-for-member, and the shared member
//     (`cross_tenant_access -> tenant`) keeps its REAL family in this
//     lane's boundary projection.

import { describe, expect, it } from 'vitest';

// --- The REAL lanes (test-only; this lane's src imports NONE of them) --------
import * as api from '../../../services/api/src/index';
import * as firmMemory from '../../firm-memory/src/index';
import * as skills from '../../skills/src/index';
import * as sdk from '../../sdk/src/index';

// --- This lane -----------------------------------------------------------------
import {
  API_BOUNDARY_ERROR_FAMILY_OF,
  activeQuotaGrants,
  createEntitlementLedger,
  entitlementSnapshot,
  isUsageRecordMirror,
  issueEntitlementGrant,
  PRIVATE_ROUTE_FAMILIES_MIRROR,
  PUBLIC_ROUTE_FAMILIES_MIRROR,
  SDK_ERROR_FAMILIES_MIRROR,
  signedAbs,
  signedAdd,
  signedCompare,
  signedNegate,
  signedSubtract,
  stableDigest,
  unsignedAdd,
  usageQuotaDecision,
} from './index';
import type { UsageRecordMirror } from './index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the REAL T041 UsageRecord IS this lane's mirror. */
function realUsageSatisfiesMirror(record: api.UsageRecord): UsageRecordMirror {
  return record;
}

void realUsageSatisfiesMirror;

// ---------------------------------------------------------------------------
// The T041 trip wires (the R41 handoff, end to end)
// ---------------------------------------------------------------------------

describe('the REAL T041 usage metering (the fact surface this lane enforces)', () => {
  it('the REAL route-family vocabulary matches this lane\'s mirror member-for-member', () => {
    expect([...api.PUBLIC_ROUTE_FAMILIES]).toEqual([...PUBLIC_ROUTE_FAMILIES_MIRROR]);
    expect([...api.PRIVATE_ROUTE_FAMILIES]).toEqual([...PRIVATE_ROUTE_FAMILIES_MIRROR]);
  });

  it('the REAL UsageLedger\'s emitted records satisfy this lane\'s mirror', () => {
    const ledger = new api.UsageLedger();
    const first = ledger.record({
      tenant: 'tenant-interop-entitlements' as api.TenantId,
      credentialId: 'dev:interop',
      route: 'jobs:write',
      method: 'POST',
      path: '/v1/jobs/research',
      status: 200,
      at: 1_735_600_000_000 as api.TimestampMs,
    });
    const second = ledger.record({
      tenant: 'tenant-interop-entitlements' as api.TenantId,
      credentialId: 'dev:interop',
      route: 'jobs:write',
      method: 'POST',
      path: '/v1/jobs/research',
      status: 429,
      at: 1_735_600_000_100 as api.TimestampMs,
    });
    expect(api.isUsageRecord(first)).toBe(true);
    expect(isUsageRecordMirror(first)).toBe(true); // the REAL record IS the mirror record
    expect(isUsageRecordMirror(second)).toBe(true);
    // REAL usage facts are immutable and per-tenant (the fact surface's own law).
    expect(api.usageTenantConsistent(ledger.usageOf('tenant-interop-entitlements' as api.TenantId), 'tenant-interop-entitlements' as api.TenantId)).toBe(true);
  });

  it('the R41 HANDOFF: REAL recorded facts + this lane\'s grants -> the allowance decision', () => {
    const T0 = 1_735_600_000_000;
    const tenant = 'tenant-interop-entitlements';
    // The boundary records three REAL usage facts on jobs:write.
    const ledger = new api.UsageLedger();
    for (const at of [T0, T0 + 100, T0 + 200]) {
      ledger.record({ tenant: tenant as api.TenantId, credentialId: 'dev:interop', route: 'jobs:write', method: 'POST', path: '/v1/jobs/research', status: 200, at: at as api.TimestampMs });
    }
    // This lane issues an api-quota grant: 3 jobs:write requests per second.
    const entitlements = createEntitlementsLedgerWithQuota(tenant, T0);
    const snapshot = entitlementSnapshot(entitlements, T0 + 300);
    if (!snapshot.ok) throw new Error('unreachable');
    const grants = activeQuotaGrants(snapshot.value);
    const facts = ledger.usageOf(tenant as api.TenantId) as readonly UsageRecordMirror[];
    // The fourth request within the window is DENIED (the boundary
    // recorded; this lane enforced).
    const denied = usageQuotaDecision(facts, grants, { tenant, route: 'jobs:write', at: T0 + 300 });
    expect(denied.allowed).toBe(false);
    expect(denied.code).toBe('usage_denied');
    expect(denied.counted).toBe(3);
    // After the window rolls, the allowance frees again.
    const allowed = usageQuotaDecision(facts, grants, { tenant, route: 'jobs:write', at: T0 + 1500 });
    expect(allowed.allowed).toBe(true);
  });

  it('the REAL SDK error-family vocabulary matches this lane\'s mirror; the shared member keeps its family', () => {
    expect([...sdk.SDK_ERROR_FAMILIES]).toEqual([...SDK_ERROR_FAMILIES_MIRROR]);
    expect(API_BOUNDARY_ERROR_FAMILY_OF.cross_tenant_access).toBe(sdk.SDK_ERROR_FAMILY_OF.cross_tenant_access);
  });
});

function createEntitlementsLedgerWithQuota(tenant: string, t0: number) {
  const created = createEntitlementLedger(tenant);
  if (!created.ok) throw new Error('unreachable');
  const issued = issueEntitlementGrant(created.value, {
    tenantId: tenant,
    projectId: null,
    kind: 'api-quota',
    terms: { kind: 'api-quota', routeFamilies: ['jobs:write'], maxRequests: 3, windowMs: 1000 },
    version: 1,
    supersedes: null,
    sourceRef: 'plan://operator/interop',
    issuedAt: t0,
    effectiveFrom: t0,
    effectiveUntil: null,
  });
  if (!issued.ok) throw new Error(`unreachable: ${issued.errors.map((e) => e.message).join('; ')}`);
  return issued.value.state;
}

// ---------------------------------------------------------------------------
// The decimal-kernel parity trip wire (one program-wide money law)
// ---------------------------------------------------------------------------

describe('the REAL firm-memory decimal kernel agrees with this lane\'s local kernel', () => {
  const CORPUS: readonly [string, string][] = [
    ['0', '0'],
    ['0.1', '0.2'],
    ['12500.50', '0.255'],
    ['-1.25', '2.5'],
    ['1', '0.999999999999999999999'],
    ['-999999999999999999999', '999999999999999999999.5'],
    ['33.335', '33.335'],
  ];

  it('signedAdd parity on the corpus', () => {
    for (const [a, b] of CORPUS) {
      expect(signedAdd(a, b)).toBe(firmMemory.signedAdd(a, b));
    }
  });

  it('signedSubtract / signedNegate / signedAbs parity on the corpus', () => {
    for (const [a, b] of CORPUS) {
      expect(signedSubtract(a, b)).toBe(firmMemory.signedSubtract(a, b));
      expect(signedNegate(a)).toBe(firmMemory.signedNegate(a));
      expect(signedAbs(a)).toBe(firmMemory.signedAbs(a));
    }
  });

  it('signedCompare + unsignedAdd parity on the corpus', () => {
    for (const [a, b] of CORPUS) {
      expect(signedCompare(a, b)).toBe(firmMemory.signedCompare(a, b));
      expect(unsignedAdd(a.replace('-', ''), b.replace('-', ''))).toBe(firmMemory.unsignedAdd(a.replace('-', ''), b.replace('-', '')));
    }
  });
});

// ---------------------------------------------------------------------------
// The digest parity trip wire (the program-wide fold)
// ---------------------------------------------------------------------------

describe('the REAL skills stableDigest agrees with this lane\'s mirror fold', () => {
  const VECTORS = [
    '',
    'entitlements',
    '{"amount":"1250.75","currency":"usd-cents"}',
    'liquidity-régime-分析', // non-ASCII: the UTF-8 denormalized round
    '𝔘𝔫𝔦𝔠𝔬𝔡𝔢 astral plane', // astral code points (surrogate pairs)
  ];

  it('byte-parity on shared vectors', () => {
    for (const vector of VECTORS) {
      expect(stableDigest(vector)).toBe(skills.stableDigest(vector));
    }
  });

  it('the digest is never the input length in disguise (non-triviality)', () => {
    expect(stableDigest('a')).not.toBe(stableDigest('b'));
  });
});
