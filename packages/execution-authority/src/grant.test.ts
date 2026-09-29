// @tradrl/execution-authority — the AuthorityGrantRecord tests: the
// guard laws, the collect-all validator, the validity-window semantics
// (BOTH sides plus off-by-one ms — the declared [issuedAt, expiresAt)
// law), the revocation law, content addressing and the opacity trip
// wire over grant records.

import { describe, expect, it } from 'vitest';

import {
  canonicalGrantJson,
  deepFreeze,
  grantContentTree,
  grantStatus,
  isAuthorityGrantRecord,
  isDeeplyFrozen,
  mintAuthorityGrant,
  validateAuthorityGrant,
} from './index';
import { CRED_BROKER, fixtureGrant, SCOPE_LIMIT, T0, TENANT, unwrap } from './test-fixtures';

describe('the authority grant record', () => {
  it('a valid fixture grant passes the guard and the collect-all validator', () => {
    const grant = fixtureGrant();
    expect(isAuthorityGrantRecord(grant)).toBe(true);
    const validated = validateAuthorityGrant(grant);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.value.grantId).toBe(grant.grantId);
      expect(validated.value.scopeRef).toBe(SCOPE_LIMIT);
    }
  });

  it('the minted record is deeply frozen and JSON-serializable', () => {
    const grant = fixtureGrant();
    expect(isDeeplyFrozen(grant)).toBe(true);
    expect(() => JSON.stringify(grant)).not.toThrow();
    expect(JSON.parse(JSON.stringify(grant))).toEqual(grant);
  });

  it('content addressing is deterministic: the same declaration mints the byte-identical grant', () => {
    const a = fixtureGrant();
    const b = fixtureGrant();
    expect(a.grantId).toBe(b.grantId);
    expect(canonicalGrantJson(a)).toBe(canonicalGrantJson(b));
  });

  it('a different declaration mints a different id', () => {
    expect(fixtureGrant().grantId).not.toBe(fixtureGrant({ scopeRef: 'grant:another@1' }).grantId);
  });

  it('a FORGED id (content mismatch) fails validation with invalid_field', () => {
    const grant = fixtureGrant();
    const forged = { ...grant, grantId: 'xag:deadbeef' };
    const validated = validateAuthorityGrant(forged);
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.errors[0]?.code).toBe('invalid_field');
      expect(validated.errors[0]?.path).toBe('grant.grantId');
    }
  });

  it('an empty orderKinds list fails (fail-closed: a grant permitting NOTHING is inexpressible — refuse by shape)', () => {
    // An empty orderKinds list is structurally rejected: the Work Order's
    // "who may do what" requires a WHAT; revocation is the way to kill a
    // grant, not an empty kind list.
    const result = mintAuthorityGrant({
      ...grantContentTreeOf(fixtureGrant()),
      orderKinds: [],
    } as never);
    expect(result.ok).toBe(false);
  });

  it('duplicate order kinds / venues / budgets / bindings fail the guard', () => {
    expect(isAuthorityGrantRecord({ ...fixtureGrant(), orderKinds: ['limit', 'limit'] })).toBe(false);
    expect(isAuthorityGrantRecord({ ...fixtureGrant(), venues: ['BROKER-FIX', 'BROKER-FIX'] })).toBe(false);
    expect(
      isAuthorityGrantRecord({
        ...fixtureGrant(),
        rateBudgets: [
          { venue: 'BROKER-FIX', windowMs: 60_000, maxOrders: 10 },
          { venue: 'BROKER-FIX', windowMs: 30_000, maxOrders: 5 },
        ],
      }),
    ).toBe(false);
    expect(
      isAuthorityGrantRecord({
        ...fixtureGrant(),
        credentials: [
          { venue: 'BROKER-FIX', credentialRef: CRED_BROKER },
          { venue: 'BROKER-FIX', credentialRef: 'cred:other@1' },
        ],
      }),
    ).toBe(false);
  });

  it('an inverted or empty validity window fails the guard (issuedAt >= expiresAt)', () => {
    expect(isAuthorityGrantRecord({ ...fixtureGrant(), validity: { issuedAt: T0, expiresAt: T0 } })).toBe(false);
    expect(isAuthorityGrantRecord({ ...fixtureGrant(), validity: { issuedAt: T0 + 1, expiresAt: T0 } })).toBe(false);
  });

  it('the version chain law: supersedes must name a strictly earlier version', () => {
    const grant = fixtureGrant();
    const bad = {
      ...grant,
      version: 2,
      supersedes: { grantId: grant.grantId, version: 2 },
    };
    const validated = validateAuthorityGrant(bad);
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.errors[0]?.code).toBe('invalid_field');
  });
});

describe('the validity-window law ([issuedAt, expiresAt) — inclusive at issue, EXCLUSIVE at expiry)', () => {
  it('now === issuedAt is VALID (the window opens inclusively)', () => {
    const issuedAt = T0 - 60_000;
    const grant = fixtureGrant({ issuedAt, expiresAt: T0 + 3_600_000 });
    expect(grantStatus(grant, issuedAt as never)).toBeNull();
  });

  it('now === issuedAt - 1 is NOT-YET-VALID (the off-by-one on the opening side)', () => {
    const issuedAt = T0 - 60_000;
    const grant = fixtureGrant({ issuedAt, expiresAt: T0 + 3_600_000 });
    const refusal = grantStatus(grant, (issuedAt - 1) as never);
    expect(refusal !== null && refusal.kind === 'grant_not_yet_valid').toBe(true);
  });

  it('now === expiresAt - 1 is VALID (the last live instant)', () => {
    const expiresAt = T0 + 3_600_000;
    const grant = fixtureGrant({ issuedAt: T0 - 60_000, expiresAt });
    expect(grantStatus(grant, (expiresAt - 1) as never)).toBeNull();
  });

  it('now === expiresAt is EXPIRED (the boundary instant belongs to the dead side — DECLARED SEMANTICS)', () => {
    const expiresAt = T0 + 3_600_000;
    const grant = fixtureGrant({ issuedAt: T0 - 60_000, expiresAt });
    const refusal = grantStatus(grant, expiresAt as never);
    expect(refusal !== null && refusal.kind === 'grant_expired').toBe(true);
  });

  it('now === expiresAt + 1 is EXPIRED (the off-by-one on the closing side)', () => {
    const expiresAt = T0 + 3_600_000;
    const grant = fixtureGrant({ issuedAt: T0 - 60_000, expiresAt });
    const refusal = grantStatus(grant, (expiresAt + 1) as never);
    expect(refusal !== null && refusal.kind === 'grant_expired').toBe(true);
  });
});

describe('the revocation law', () => {
  it('a grant carrying ANY revocation record is revoked — the refusal names the evidence', () => {
    const grant = fixtureGrant({
      revocations: [{ revokedAt: T0 + 1_000, reason: 'desk policy: principal reassigned', revokedBy: 'principal:risk-desk' }],
    });
    const refusal = grantStatus(grant, (T0 + 2_000) as never);
    expect(refusal !== null && refusal.kind === 'grant_revoked').toBe(true);
    if (refusal !== null && refusal.kind === 'grant_revoked') {
      expect(refusal.revokedAt).toBe(T0 + 1_000);
      expect(refusal.reason).toBe('desk policy: principal reassigned');
    }
  });

  it('revocation DOMINATES the window: a revoked grant inside its window is still revoked', () => {
    const grant = fixtureGrant({
      revocations: [{ revokedAt: T0 + 1_000, reason: 'revoked early', revokedBy: 'principal:risk-desk' }],
    });
    // Well inside the window, but revoked.
    expect(grantStatus(grant, (T0 + 2_000) as never)?.kind).toBe('grant_revoked');
  });

  it('a revocation record with an empty reason fails the guard', () => {
    const grant = fixtureGrant();
    expect(
      isAuthorityGrantRecord({
        ...grant,
        revocations: [{ revokedAt: T0, reason: '', revokedBy: 'x' }],
      }),
    ).toBe(false);
  });
});

describe('the credential-opacity trip wire over grant records (SECURITY.md\'s boundary in code)', () => {
  it('a credential VALUE anywhere in the grant fails the guard AND the validator with credential_value_present', () => {
    const contaminated = {
      ...fixtureGrant(),
      credentials: [{ venue: 'BROKER-FIX', credentialRef: CRED_BROKER }],
      notes: { apiKey: 'AKIAIOSFODNN7EXAMPLE' },
    };
    expect(isAuthorityGrantRecord(contaminated)).toBe(false);
    const validated = validateAuthorityGrant(contaminated);
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.errors[0]?.code).toBe('credential_value_present');
  });

  it('the trip wire is case/separator-insensitive (apiKey / api_key / API-KEY are caught identically)', () => {
    for (const key of ['apiKey', 'api_key', 'API-KEY']) {
      const contaminated = { ...deepFreeze({ ...fixtureGrant() }), [key]: 'secret-value' };
      expect(isAuthorityGrantRecord(contaminated)).toBe(false);
      const validated = validateAuthorityGrant(contaminated);
      expect(validated.ok).toBe(false);
      if (!validated.ok) expect(validated.errors[0]?.code).toBe('credential_value_present');
    }
  });

  it('the minting path refuses a contaminated declaration BEFORE any record exists', () => {
    const result = mintAuthorityGrant({
      ...grantContentTreeOf(fixtureGrant()),
      passphrase: 'hunter2',
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('credential_value_present');
  });

  it('a nested credential VALUE deep in the tree is caught (the scan is total)', () => {
    const contaminated = {
      ...fixtureGrant(),
      principal: { specId: 'spec-gateway-director', version: 1 },
      audit: { deep: { deeper: [{ secret: 'value' }] } },
    };
    expect(isAuthorityGrantRecord(contaminated)).toBe(false);
  });
});

describe('the scope law (L12)', () => {
  it('the grant carries its tenant/project scope for the registry\'s cross-tenant check', () => {
    const grant = fixtureGrant({ tenant: 'tenant-other', project: 'project-other' });
    expect(grant.tenant).toBe('tenant-other');
    // The registry-level cross-tenant refusal is exercised in registry.test.ts.
    expect(TENANT).not.toBe(grant.tenant);
  });
});

/** Local helper: the content tree of a grant (minting input shape). */
function grantContentTreeOf(grant: ReturnType<typeof fixtureGrant>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(grantContentTree(grant))) as Record<string, unknown>;
}

// Keep the unwrap import honest (fixtures are valid by construction).
void unwrap;
