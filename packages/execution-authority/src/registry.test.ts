// @tradrl/execution-authority — the EntitlementRegistry tests: the
// Default-Deny law (unknown venue, unknown grant, missing entitlement),
// the scope law (cross-tenant grant reuse), the predicate coverage and
// the registry validation laws.

import { describe, expect, it } from 'vitest';

import {
  deepFreeze,
  grantForScopeRef,
  grantScopeRefusal,
  isEntitlementRegistry,
  isEntitlementRefusal,
  mayRouteToVenue,
  mayUseCredential,
  permitsOrderKind,
  rateBudgetFor,
  validateEntitlementRegistry,
  type AuthorityGrantRecord,
  type EntitlementRegistry,
} from './index';
import { CRED_BROKER, CRED_OMS, fixtureGrant, SCOPE_LIMIT, SCOPE_MARKET, T0, TENANT, VENUE_BROKER, VENUE_OMS } from './test-fixtures';

/** A valid fixture registry, overridable per test. */
function fixtureRegistry(overrides: { grants?: readonly AuthorityGrantRecord[]; venues?: readonly string[] } = {}): EntitlementRegistry {
  return deepFreeze({
    tenant: TENANT as never,
    project: 'project-gateway' as never,
    grants: overrides.grants ?? [fixtureGrant({ scopeRef: SCOPE_LIMIT }), fixtureGrant({ scopeRef: SCOPE_MARKET })],
    venues: (overrides.venues ?? [VENUE_BROKER, VENUE_OMS]) as never,
  }) as EntitlementRegistry;
}

describe('the entitlement registry', () => {
  it('a valid fixture registry passes the guard and the collect-all validator', () => {
    const registry = fixtureRegistry();
    expect(isEntitlementRegistry(registry)).toBe(true);
    const validated = validateEntitlementRegistry(registry);
    expect(validated.ok).toBe(true);
  });

  it('a registry with duplicate scope refs fails validation', () => {
    const registry = fixtureRegistry({ grants: [fixtureGrant({ scopeRef: SCOPE_LIMIT }), fixtureGrant({ scopeRef: SCOPE_LIMIT, orderKinds: ['stop'] })] });
    const validated = validateEntitlementRegistry(registry);
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.errors[0]?.code).toBe('invalid_field');
  });

  it('a cross-tenant grant cannot be REGISTERED (L12 — the scope law)', () => {
    const registry = fixtureRegistry({ grants: [fixtureGrant({ tenant: 'tenant-other' })] });
    const validated = validateEntitlementRegistry(registry);
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.errors[0]?.code).toBe('tenant_missing');
  });

  it('an EMPTY venue allowlist routes nothing (fail-closed by shape)', () => {
    const registry = fixtureRegistry({ venues: [] });
    expect(isEntitlementRegistry(registry)).toBe(true);
    expect(registry.venues.length).toBe(0);
  });
});

describe('the Default-Deny law (nothing routes by default)', () => {
  it('UNKNOWN VENUE: a venue absent from the registry allowlist is the typed unknown_venue refusal', () => {
    const registry = fixtureRegistry();
    const grant = registry.grants[0] as AuthorityGrantRecord;
    const refusal = mayRouteToVenue(registry, grant, 'UNKNOWN-VEN' as never);
    expect(refusal !== null && refusal.kind === 'unknown_venue').toBe(true);
    if (refusal !== null && refusal.kind === 'unknown_venue') {
      expect(refusal.venue).toBe('UNKNOWN-VEN');
      expect(refusal.tenant).toBe(TENANT);
    }
    // Unknown venue ALSO when the venue is on the registry but not the grant:
    const missing = mayRouteToVenue(fixtureRegistry({ venues: [VENUE_BROKER, VENUE_OMS, 'VENUE-THIRD'] }), fixtureGrant({ venues: [VENUE_BROKER] }), 'VENUE-THIRD' as never);
    expect(missing !== null && missing.kind === 'missing_entitlement' && missing.subject === 'venue').toBe(true);
  });

  it('UNKNOWN GRANT: an unresolved scope ref yields null from grantForScopeRef (the caller converts it to the typed refusal)', () => {
    const registry = fixtureRegistry();
    expect(grantForScopeRef(registry, 'grant:nobody-declared-this@1' as never)).toBeNull();
  });

  it('MISSING ENTITLEMENT (credential): a credential ref not bound at the venue is the typed refusal', () => {
    const grant = fixtureGrant();
    const refusal = mayUseCredential(grant, VENUE_BROKER as never, 'cred:not-bound@1' as never);
    expect(refusal !== null && refusal.kind === 'missing_entitlement' && refusal.subject === 'credential').toBe(true);
    // A ref bound at ANOTHER venue is equally refused (the binding is declared data).
    const crossVenue = mayUseCredential(grant, VENUE_OMS as never, CRED_BROKER as never);
    expect(crossVenue !== null && crossVenue.kind === 'missing_entitlement' && crossVenue.subject === 'credential').toBe(true);
  });

  it('MISSING ENTITLEMENT (order kind): a kind the grant does not permit is the typed refusal', () => {
    const grant = fixtureGrant({ orderKinds: ['limit'] });
    const refusal = permitsOrderKind(grant, 'stop');
    expect(refusal !== null && refusal.kind === 'missing_entitlement' && refusal.subject === 'order_kind').toBe(true);
  });

  it('MISSING RATE BUDGET: a venue with no declared budget yields null (no permission to submit at any rate)', () => {
    const grant = fixtureGrant({ rateBudgets: [{ venue: VENUE_BROKER, windowMs: 60_000, maxOrders: 10 }] });
    expect(rateBudgetFor(grant, VENUE_OMS as never)).toBeNull();
    expect(rateBudgetFor(grant, VENUE_BROKER as never)?.maxOrders).toBe(10);
  });

  it('the happy predicates return null (the entitlement holds)', () => {
    const registry = fixtureRegistry();
    const grant = registry.grants[0] as AuthorityGrantRecord;
    expect(mayRouteToVenue(registry, grant, VENUE_BROKER as never)).toBeNull();
    expect(mayUseCredential(grant, VENUE_BROKER as never, CRED_BROKER as never)).toBeNull();
    expect(mayUseCredential(grant, VENUE_OMS as never, CRED_OMS as never)).toBeNull();
    expect(permitsOrderKind(grant, 'limit')).toBeNull();
  });
});

describe('the authority-stage predicate (scope + window + revocation under one call)', () => {
  it('CROSS-TENANT grant reuse is the typed cross_tenant refusal (L12)', () => {
    const grant = fixtureGrant(); // tenant-gateway
    const refusal = grantScopeRefusal(grant, 'tenant-intruder' as never, 'project-intruder' as never, T0 as never);
    expect(refusal !== null && refusal.kind === 'cross_tenant').toBe(true);
    if (refusal !== null && refusal.kind === 'cross_tenant') {
      expect(refusal.expectedTenant).toBe(TENANT);
      expect(refusal.actualTenant).toBe('tenant-intruder');
    }
  });

  it('an expired grant is the typed grant_expired refusal (the [issuedAt, expiresAt) law)', () => {
    const expiresAt = T0 + 3_600_000;
    const grant = fixtureGrant({ expiresAt });
    // now === expiresAt -> EXPIRED (the boundary belongs to the dead side).
    expect(grantScopeRefusal(grant, TENANT as never, 'project-gateway' as never, expiresAt as never)?.kind).toBe('grant_expired');
    // now === expiresAt - 1 -> valid.
    expect(grantScopeRefusal(grant, TENANT as never, 'project-gateway' as never, (expiresAt - 1) as never)).toBeNull();
  });

  it('a not-yet-valid grant is the typed grant_not_yet_valid refusal', () => {
    const issuedAt = T0 - 60_000;
    const grant = fixtureGrant({ issuedAt });
    expect(grantScopeRefusal(grant, TENANT as never, 'project-gateway' as never, (issuedAt - 1) as never)?.kind).toBe('grant_not_yet_valid');
    expect(grantScopeRefusal(grant, TENANT as never, 'project-gateway' as never, issuedAt as never)).toBeNull();
  });

  it('a revoked grant is the typed grant_revoked refusal', () => {
    const grant = fixtureGrant({ revocations: [{ revokedAt: T0 + 100, reason: 'desk closed', revokedBy: 'principal:risk-desk' }] });
    expect(grantScopeRefusal(grant, TENANT as never, 'project-gateway' as never, (T0 + 200) as never)?.kind).toBe('grant_revoked');
  });
});

describe('the typed refusal record', () => {
  it('every refusal variant passes its own guard', () => {
    const registry = fixtureRegistry();
    const grant = registry.grants[0] as AuthorityGrantRecord;
    const unknown = mayRouteToVenue(registry, grant, 'UNKNOWN-VEN' as never);
    expect(unknown !== null && isEntitlementRefusal(unknown)).toBe(true);
    const cross = grantScopeRefusal(grant, 'tenant-x' as never, 'project-x' as never, T0 as never);
    expect(cross !== null && isEntitlementRefusal(cross)).toBe(true);
    expect(isEntitlementRefusal({ kind: 'nonsense' })).toBe(false);
    expect(isEntitlementRefusal('not-a-record')).toBe(false);
  });
});

describe('the opacity trip wire over registries (defense in depth)', () => {
  it('a registry embedding credential material fails the guard', () => {
    const contaminated = { ...fixtureRegistry(), secret: 'value' };
    expect(isEntitlementRegistry(contaminated)).toBe(false);
    const validated = validateEntitlementRegistry(contaminated);
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.errors[0]?.code).toBe('credential_value_present');
  });
});
