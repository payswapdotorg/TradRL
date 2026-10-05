// @tradrl/entitlements — the entitlement grant record tests: the
// closed kind vocabulary, the per-kind terms laws, the L4 window law,
// the versioning law, and the collect-all validator.

import { describe, expect, it } from 'vitest';
import {
  amendEntitlementGrant,
  createEntitlementGrant,
  ENTITLEMENT_KINDS,
  isApiQuotaTerms,
  isArtifactLicenseTerms,
  isEntitlementGrant,
  isEntitlementTerms,
  isSpendAllowanceTerms,
  validateEntitlementGrant,
} from './index';
import type { EntitlementGrant } from './index';

const TENANT = 'tenant-entitlement-fixture';
const PROJECT = 'prj-entitlement-fixture';
const T0 = 1_735_600_000_000;

/** A valid spend-allowance grant draft (version 1, root). */
function spendDraft(): Record<string, unknown> {
  return {
    tenantId: TENANT,
    projectId: null,
    kind: 'spend-allowance',
    terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '12500.50' },
    version: 1,
    supersedes: null,
    sourceRef: 'plan://operator/pro-2026-q1',
    issuedAt: T0,
    effectiveFrom: T0,
    effectiveUntil: T0 + 90 * 86_400_000,
  };
}

/** A valid tenant-wide api-quota grant draft. */
function quotaDraft(): Record<string, unknown> {
  return {
    tenantId: TENANT,
    projectId: null,
    kind: 'api-quota',
    terms: { kind: 'api-quota', routeFamilies: ['jobs:write', 'projects:read'], maxRequests: 1000, windowMs: 3_600_000 },
    version: 1,
    supersedes: null,
    sourceRef: 'plan://operator/free-tier',
    issuedAt: T0,
    effectiveFrom: T0,
    effectiveUntil: null,
  };
}

/** A valid project-scoped artifact-license grant draft. */
function licenseDraft(): Record<string, unknown> {
  return {
    tenantId: TENANT,
    projectId: PROJECT,
    kind: 'artifact-license',
    terms: { kind: 'artifact-license', artifactRef: 'mka:0123456789abcdef', usageScope: 'project' },
    version: 1,
    supersedes: null,
    sourceRef: 'purchase://marketplace/po-123',
    issuedAt: T0,
    effectiveFrom: T0,
    effectiveUntil: null,
  };
}

describe('the closed kind vocabulary + the terms guards', () => {
  it('is pinned member-for-member', () => {
    expect([...ENTITLEMENT_KINDS]).toEqual(['spend-allowance', 'api-quota', 'artifact-license']);
  });

  it('spend-allowance terms: identifier currency + canonical decimal amount', () => {
    expect(isSpendAllowanceTerms({ kind: 'spend-allowance', currency: 'usd-cents', amount: '10' })).toBe(true);
    expect(isSpendAllowanceTerms({ kind: 'spend-allowance', currency: 'usd cents', amount: '10' })).toBe(false);
    expect(isSpendAllowanceTerms({ kind: 'spend-allowance', currency: 'usd-cents', amount: 10 })).toBe(false);
    expect(isSpendAllowanceTerms({ kind: 'spend-allowance', currency: 'usd-cents', amount: '10,0' })).toBe(false);
  });

  it('api-quota terms: non-empty unique mirrored route families, integer quota, positive window', () => {
    expect(isApiQuotaTerms({ kind: 'api-quota', routeFamilies: ['jobs:write'], maxRequests: 5, windowMs: 1000 })).toBe(true);
    expect(isApiQuotaTerms({ kind: 'api-quota', routeFamilies: [], maxRequests: 5, windowMs: 1000 })).toBe(false);
    expect(isApiQuotaTerms({ kind: 'api-quota', routeFamilies: ['jobs:write', 'jobs:write'], maxRequests: 5, windowMs: 1000 })).toBe(false);
    expect(isApiQuotaTerms({ kind: 'api-quota', routeFamilies: ['not:a:route'], maxRequests: 5, windowMs: 1000 })).toBe(false);
    expect(isApiQuotaTerms({ kind: 'api-quota', routeFamilies: ['jobs:write'], maxRequests: 5.5, windowMs: 1000 })).toBe(false);
    expect(isApiQuotaTerms({ kind: 'api-quota', routeFamilies: ['jobs:write'], maxRequests: 5, windowMs: 0 })).toBe(false);
  });

  it('artifact-license terms: opaque artifact ref + the usage-scope bijection', () => {
    expect(isArtifactLicenseTerms({ kind: 'artifact-license', artifactRef: 'mka:0123456789abcdef', usageScope: 'tenant' })).toBe(true);
    expect(isArtifactLicenseTerms({ kind: 'artifact-license', artifactRef: '', usageScope: 'tenant' })).toBe(false);
    expect(isArtifactLicenseTerms({ kind: 'artifact-license', artifactRef: 'mka:0123456789abcdef', usageScope: 'org' })).toBe(false);
  });

  it('the terms union guard closes over exactly the three members', () => {
    expect(isEntitlementTerms({ kind: 'spend-allowance', currency: 'c', amount: '1' })).toBe(true);
    expect(isEntitlementTerms({ kind: 'revenue-share', basisPoints: 100 })).toBe(false);
  });
});

describe('validateEntitlementGrant (collect-all)', () => {
  it('mints a deeply frozen, content-addressed record from a valid draft', () => {
    const result = validateEntitlementGrant(spendDraft());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const grant = result.value;
      expect(grant.grantId).toMatch(/^eg:[0-9a-f]{16}$/);
      expect(Object.isFrozen(grant)).toBe(true);
      expect(Object.isFrozen(grant.terms)).toBe(true);
      expect(isEntitlementGrant(grant)).toBe(true);
      // Determinism: the same draft mints the same id.
      const again = validateEntitlementGrant(spendDraft());
      expect(again.ok && again.value.grantId).toBe(grant.grantId);
    }
  });

  it('the mint never aliases nor freezes the caller\'s draft (purity)', () => {
    const draft = spendDraft();
    const mutableTerms = draft.terms as Record<string, unknown>;
    const result = validateEntitlementGrant(draft);
    expect(result.ok).toBe(true);
    expect(Object.isFrozen(draft)).toBe(false);
    expect(Object.isFrozen(mutableTerms)).toBe(false);
  });

  it('collects EVERY violation (not just the first)', () => {
    const broken = { ...spendDraft(), tenantId: '', kind: 'spend-allowance', terms: { kind: 'spend-allowance', currency: 'x y', amount: '01' }, version: 0, effectiveUntil: T0 };
    const result = validateEntitlementGrant(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((error) => error.code);
      expect(codes).toContain('invalid_field'); // the empty tenant
      expect(codes).toContain('invalid_decimal');
      expect(codes).toContain('l4_boundary_violation');
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
    }
    // An ABSENT tenant is the typed tenant_missing (L12).
    const noTenant = validateEntitlementGrant({ ...spendDraft(), tenantId: undefined });
    if (!noTenant.ok) {
      expect(noTenant.errors.some((error) => error.code === 'tenant_missing')).toBe(true);
    }
  });

  it('a NUMBER amount is the typed invalid_decimal — money is never coerced', () => {
    const result = validateEntitlementGrant({ ...spendDraft(), terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: 12500 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'invalid_decimal')).toBe(true);
    }
  });

  it('the scope law: api-quota grants are mandatorily tenant-wide', () => {
    const result = validateEntitlementGrant({ ...quotaDraft(), projectId: PROJECT });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path === 'grant.projectId')).toBe(true);
    }
  });

  it('the scope law: license usage-scope/project bijection', () => {
    const projectScopedWithoutProject = validateEntitlementGrant({ ...licenseDraft(), projectId: null });
    expect(projectScopedWithoutProject.ok).toBe(false);
    const tenantScopedWithProject = validateEntitlementGrant({
      ...licenseDraft(),
      terms: { kind: 'artifact-license', artifactRef: 'mka:0123456789abcdef', usageScope: 'tenant' },
    });
    expect(tenantScopedWithProject.ok).toBe(false);
  });

  it('the window law (L4): effectiveFrom >= issuedAt; effectiveUntil strictly later', () => {
    expect(validateEntitlementGrant({ ...spendDraft(), effectiveFrom: T0 - 1 }).ok).toBe(false);
    expect(validateEntitlementGrant({ ...spendDraft(), effectiveUntil: T0 }).ok).toBe(false);
    expect(validateEntitlementGrant({ ...spendDraft(), effectiveUntil: T0 + 1 }).ok).toBe(true);
  });

  it('the versioning law: version 1 roots, later versions supersede', () => {
    expect(validateEntitlementGrant({ ...spendDraft(), version: 1, supersedes: 'eg:0123456789abcdef' }).ok).toBe(false);
    expect(validateEntitlementGrant({ ...spendDraft(), version: 2, supersedes: null }).ok).toBe(false);
  });
});

describe('the amendment law (L3 — amendments mint, never mutate)', () => {
  it('mints version + 1 chained to the prior, keeping tenant + kind', () => {
    const root = createEntitlementGrant(spendDraft());
    const amended = amendEntitlementGrant(root, {
      projectId: null,
      terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '25000' },
      sourceRef: 'plan://operator/pro-2026-q2',
      issuedAt: T0 + 1000,
      effectiveFrom: T0 + 1000,
      effectiveUntil: null,
    });
    expect(amended.ok).toBe(true);
    if (amended.ok) {
      expect(amended.value.version).toBe(2);
      expect(amended.value.supersedes).toBe(root.grantId);
      expect(amended.value.tenantId).toBe(root.tenantId);
      expect(amended.value.kind).toBe(root.kind);
      expect(amended.value.grantId).not.toBe(root.grantId);
    }
    // The prior record is untouched.
    expect(root.version).toBe(1);
  });

  it('a kind change is the typed refusal (the kind is the allowance\'s identity)', () => {
    const root = createEntitlementGrant(spendDraft());
    const amended = amendEntitlementGrant(root, {
      projectId: null,
      terms: { kind: 'api-quota', routeFamilies: ['jobs:write'], maxRequests: 5, windowMs: 1000 },
      sourceRef: 'plan://operator/x',
      issuedAt: T0 + 1000,
      effectiveFrom: T0 + 1000,
      effectiveUntil: null,
    });
    expect(amended.ok).toBe(false);
    if (!amended.ok) {
      expect(amended.errors[0].code).toBe('kind_change_forbidden');
    }
  });

  it('an amendment instant before the prior issuance is the L4 refusal', () => {
    const root = createEntitlementGrant(spendDraft());
    const amended = amendEntitlementGrant(root, {
      projectId: null,
      terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '1' },
      sourceRef: 'plan://operator/x',
      issuedAt: T0 - 1,
      effectiveFrom: T0,
      effectiveUntil: null,
    });
    expect(amended.ok).toBe(false);
    if (!amended.ok) {
      expect(amended.errors[0].code).toBe('l4_boundary_violation');
    }
  });
});

describe('createEntitlementGrant (the throwing constructor)', () => {
  it('throws a TypeError listing every violation', () => {
    expect(() => createEntitlementGrant({ nope: true })).toThrow(TypeError);
  });

  it('round-trips valid drafts', () => {
    for (const draft of [spendDraft(), quotaDraft(), licenseDraft()]) {
      const grant: EntitlementGrant = createEntitlementGrant(draft);
      expect(isEntitlementGrant(grant)).toBe(true);
    }
  });
});
