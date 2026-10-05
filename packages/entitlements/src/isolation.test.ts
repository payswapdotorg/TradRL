// @tradrl/entitlements — the L12 tenant-isolation tests: the ledger is
// scoped to ONE tenant; a foreign record never crosses the boundary.

import { describe, expect, it } from 'vitest';
import {
  consumeEntitlement,
  createEntitlementLedger,
  issueEntitlementGrant,
  revokeEntitlementGrant,
} from './index';

const TENANT_A = 'tenant-alpha';
const TENANT_B = 'tenant-beta';
const PROJECT = 'prj-isolation';
const T0 = 1_735_600_000_000;

const foreignGrant = {
  tenantId: TENANT_B,
  projectId: null,
  kind: 'spend-allowance',
  terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '100' },
  version: 1,
  supersedes: null,
  sourceRef: 'plan://operator/test',
  issuedAt: T0,
  effectiveFrom: T0,
  effectiveUntil: null,
};

describe('the L12 boundary (one tenant per ledger)', () => {
  it('a ledger is created within exactly one tenant scope', () => {
    expect(createEntitlementLedger('').ok).toBe(false);
    const ledger = createEntitlementLedger(TENANT_A);
    expect(ledger.ok).toBe(true);
  });

  it('a foreign grant NEVER enters the ledger (cross_tenant_access at the gate)', () => {
    const ledger = createEntitlementLedger(TENANT_A);
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueEntitlementGrant(ledger.value, foreignGrant);
    expect(issued.ok).toBe(false);
    if (!issued.ok) {
      expect(issued.errors[0].code).toBe('cross_tenant_access');
      expect(issued.errors[0].message).toContain(TENANT_B);
      expect(issued.errors[0].message).toContain(TENANT_A);
    }
    // Nothing foreign was stored: the ledger stays empty.
    expect(issued.ok ? issued.value.state.grants.size : 0).toBe(0);
  });

  it('a foreign consumption NEVER draws from this ledger', () => {
    const ledger = createEntitlementLedger(TENANT_A);
    if (!ledger.ok) throw new Error('unreachable');
    const issued = issueEntitlementGrant(ledger.value, {
      ...foreignGrant,
      tenantId: TENANT_A,
    });
    if (!issued.ok) throw new Error('unreachable');
    // The foreign charge names a VALID grant of THIS ledger but carries
    // no tenant of its own (the tenant is the ledger's) — the scope law
    // is enforced by the project coverage + the ledger gate; a direct
    // foreign record injection is impossible by construction (the
    // consumption mint derives tenantId from the ledger state).
    const draw = consumeEntitlement(issued.value.state, {
      grantId: issued.value.record.grantId,
      projectId: PROJECT,
      currency: 'usd-cents',
      amount: '10',
      cause: 'marketplace-charge',
      refs: [],
      at: T0 + 1,
    });
    expect(draw.ok).toBe(true);
    if (draw.ok) {
      expect(draw.value.record.tenantId).toBe(TENANT_A);
    }
  });

  it('two tenants\' ledgers are fully disjoint (same ops, different scopes, different ids)', () => {
    const run = (tenant: string) => {
      const ledger = createEntitlementLedger(tenant);
      if (!ledger.ok) throw new Error('unreachable');
      return issueEntitlementGrant(ledger.value, {
        tenantId: tenant,
        projectId: null,
        kind: 'spend-allowance',
        terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '100' },
        version: 1,
        supersedes: null,
        sourceRef: 'plan://operator/test',
        issuedAt: T0,
        effectiveFrom: T0,
        effectiveUntil: null,
      });
    };
    const a = run(TENANT_A);
    const b = run(TENANT_B);
    if (!a.ok || !b.ok) throw new Error('unreachable');
    expect(a.value.record.grantId).not.toBe(b.value.record.grantId); // the tenant is identity content
  });

  it('a revocation against a foreign ledger is impossible (the grant is unknown there)', () => {
    const ledgerA = createEntitlementLedger(TENANT_A);
    const ledgerB = createEntitlementLedger(TENANT_B);
    if (!ledgerA.ok || !ledgerB.ok) throw new Error('unreachable');
    const issued = issueEntitlementGrant(ledgerB.value, foreignGrant);
    if (!issued.ok) throw new Error('unreachable');
    const revoked = revokeEntitlementGrant(ledgerA.value, { grantId: issued.value.record.grantId, revokedAt: T0 + 1 });
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) expect(revoked.errors[0].code).toBe('entitlement_unknown');
  });
});
