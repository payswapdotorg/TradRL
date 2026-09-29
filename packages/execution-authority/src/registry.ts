// @tradrl/execution-authority — the EntitlementRegistry and the
// entitlement predicates: MAY this tenant route to venue V? use
// credential ref C?
//
// THE DEFAULT-DENY LAW (the Work Order: "EntitlementRegistry +
// entitlement predicates: may this tenant route to venue V? use
// credential ref C? Default-Deny: unknown venue, unknown grant,
// missing entitlement -> typed EntitlementRefusal — nothing routes by
// default."). Every predicate below fails CLOSED: an absent fact is a
// refusal, never a pass. There is no wildcard, no catch-all venue, no
// implicit entitlement anywhere in this module.
//
// THE SCOPE LAW (L12): the registry is tenant/project-scoped; a grant
// registered in another tenant's registry is unreachable (the guard
// requires scope match, and `grantScopeRefusal` re-checks the grant's
// own scope against the caller's — cross-tenant grant reuse is the
// typed `cross_tenant` refusal).
//
// THE OPACITY LAW: the guard and the validator run the credential-value
// trip wire over the WHOLE registry (defense in depth — the grants run
// it individually too).
//
// Refusals are RECORDS (the T019 law): `EntitlementRefusal` is a closed
// discriminated union of structured facts; the predicates return
// `EntitlementRefusal | null` and never throw.

import { deepFreeze, isNonEmptyString, isRecord } from './primitives';
import { credentialValueViolations } from './credentials';
import type { AuthorityGrantRecord, GrantRateBudget, GrantStatusRefusal } from './grant';
import { grantStatus, isAuthorityGrantRecord, validateAuthorityGrant } from './grant';
import type { AuthorityScopeRef, CredentialRef, ProjectId, TenantId, VenueId } from './ids';
import { isAuthorityScopeRef, isCredentialRef, isProjectId, isTenantId, isVenueId } from './ids';
import type { ExecutionAuthorityResult } from './errors';
import { fail, invalidField, invalidType, ok } from './errors';

// ---------------------------------------------------------------------------
// The typed refusal (enumerated data, never free text)
// ---------------------------------------------------------------------------

/**
 * The entitlement refusal — a closed discriminated union. Every
 * Default-Deny path names its subject and the structured facts of the
 * denial:
 *   - `unknown_grant` — the resolved 'grant:' scope ref has no record
 *     in this registry (the policy declared a grant that does not
 *     exist here — nothing routes);
 *   - `unknown_venue` — the venue is not on the registry's allowlist
 *     (the tenant has no relationship with this venue at all);
 *   - `missing_entitlement` — the grant exists but does not carry this
 *     venue / credential binding / rate budget / order kind;
 *   - `grant_not_yet_valid` / `grant_expired` / `grant_revoked` — the
 *     window/revocation laws (see grant.ts grantStatus);
 *   - `cross_tenant` — the grant's scope is not the caller's (L12).
 */
export type EntitlementRefusal =
  | { readonly kind: 'unknown_grant'; readonly scopeRef: string }
  | { readonly kind: 'unknown_venue'; readonly venue: string; readonly tenant: string }
  | {
      readonly kind: 'missing_entitlement';
      readonly subject: 'venue' | 'credential' | 'rate' | 'order_kind';
      readonly grantId: string;
      readonly venue?: string;
      readonly credentialRef?: string;
      readonly orderKind?: string;
    }
  | GrantStatusRefusal
  | { readonly kind: 'cross_tenant'; readonly grantId: string; readonly expectedTenant: string; actualTenant: string; readonly expectedProject: string; readonly actualProject: string };

/** Guard: `EntitlementRefusal` (total over the closed union). */
export function isEntitlementRefusal(v: unknown): v is EntitlementRefusal {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'unknown_grant':
      return isNonEmptyString(v.scopeRef);
    case 'unknown_venue':
      return isNonEmptyString(v.venue) && isNonEmptyString(v.tenant);
    case 'missing_entitlement':
      return (
        (v.subject === 'venue' || v.subject === 'credential' || v.subject === 'rate' || v.subject === 'order_kind') &&
        isNonEmptyString(v.grantId)
      );
    case 'grant_not_yet_valid':
    case 'grant_expired':
      return isNonEmptyString(v.grantId) && typeof v.now === 'number' && Number.isSafeInteger(v.now);
    case 'grant_revoked':
      return isNonEmptyString(v.grantId) && typeof v.revokedAt === 'number' && Number.isSafeInteger(v.revokedAt) && isNonEmptyString(v.reason);
    case 'cross_tenant':
      return (
        isNonEmptyString(v.grantId) &&
        isNonEmptyString(v.expectedTenant) &&
        isNonEmptyString(v.actualTenant) &&
        isNonEmptyString(v.expectedProject) &&
        isNonEmptyString(v.actualProject)
      );
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * The tenant-scoped entitlement registry: the registered authority
 * grants (the referents of the 'grant:' scope refs) and the tenant's
 * venue allowlist (the venues this tenant may route to AT ALL). Both
 * lists are REQUIRED facts — an empty grants list means nobody may do
 * anything under this registry (fail-closed), and a venue absent from
 * the allowlist is the typed `unknown_venue` refusal (Default-Deny).
 */
export interface EntitlementRegistry {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The registered grants (unique scope refs; each guard-valid). */
  readonly grants: readonly AuthorityGrantRecord[];
  /** The tenant's venue allowlist (unique). An empty list routes nothing. */
  readonly venues: readonly VenueId[];
}

/** Guard: `EntitlementRegistry` (structural). */
export function isEntitlementRegistry(v: unknown): v is EntitlementRegistry {
  if (!isRecord(v)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!Array.isArray(v.grants) || !v.grants.every((x) => isAuthorityGrantRecord(x))) return false;
  if (new Set(v.grants.map((x) => x.scopeRef)).size !== v.grants.length) return false;
  if (!Array.isArray(v.venues) || !v.venues.every((x) => isVenueId(x))) return false;
  if (new Set(v.venues).size !== v.venues.length) return false;
  // The opacity trip wire (defense in depth — the grants scan individually too).
  if (credentialValueViolations(v).length > 0) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted entitlement registry: the
 * structural guard, the opacity trip wire, the scope law (every
 * registered grant must carry the registry's own tenant/project —
 * cross-tenant registration is inexpressible, L12) and grant validity
 * (every grant passes `validateAuthorityGrant`). On success the
 * registry is returned narrowed, deeply frozen.
 */
export function validateEntitlementRegistry(value: unknown, path = 'registry'): ExecutionAuthorityResult<EntitlementRegistry> {
  if (!isRecord(value)) {
    return fail('invalid_type', `${path} must be an object`);
  }
  const violations = credentialValueViolations(value);
  if (violations.length > 0) {
    return fail(
      'credential_value_present',
      `${path} embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — this lane carries opaque 'cred:'-prefixed refs only, never values`,
    );
  }
  if (!isTenantId(value.tenant)) return fail('invalid_field', `${path}.tenant must be a non-empty tenant scope (L12)`, `${path}.tenant`);
  if (!isProjectId(value.project)) return fail('invalid_field', `${path}.project must be a non-empty project scope (L12/L15)`, `${path}.project`);
  if (!Array.isArray(value.grants)) return fail('invalid_field', `${path}.grants must be a list of authority grant records`, `${path}.grants`);
  if (!Array.isArray(value.venues)) return fail('invalid_field', `${path}.venues must be a list of venue refs`, `${path}.venues`);
  if (new Set(value.venues.map((x) => String(x))).size !== value.venues.length) {
    return fail('invalid_field', `${path}.venues must be unique`, `${path}.venues`);
  }
  const scopeRefs = new Set<string>();
  for (let index = 0; index < value.grants.length; index++) {
    const grant: unknown = value.grants[index];
    const grantPath = `${path}.grants[${index}]`;
    const validated = validateGrantForRegistry(grant, grantPath);
    if (!validated.ok) return validated;
    const record = validated.value;
    // The scope law (L12): every registered grant carries the registry's own scope.
    if (record.tenant !== value.tenant || record.project !== value.project) {
      return fail(
        'tenant_missing',
        `${grantPath} carries scope (${record.tenant}/${record.project}) but the registry's scope is (${value.tenant}/${value.project}) — cross-tenant registration is inexpressible (L12)`,
        grantPath,
      );
    }
    if (scopeRefs.has(record.scopeRef)) {
      return fail('invalid_field', `${grantPath} repeats scope ref ${record.scopeRef} — one record per scope ref`, grantPath);
    }
    scopeRefs.add(record.scopeRef);
  }
  return ok(deepFreeze({ tenant: value.tenant, project: value.project, grants: value.grants, venues: value.venues } as unknown as EntitlementRegistry));
}

/** The registry's grant validation (guard + full collect-all validation). */
function validateGrantForRegistry(grant: unknown, path: string): ExecutionAuthorityResult<AuthorityGrantRecord> {
  return validateAuthorityGrant(grant, path);
}

export { validateAuthorityGrant } from './grant';

// ---------------------------------------------------------------------------
// The entitlement predicates (Default-Deny: every absent fact is a refusal)
// ---------------------------------------------------------------------------

/**
 * Resolve a policy-declared scope ref against the registry: the grant
 * record with that scope ref, or null when UNKNOWN (Default-Deny — the
 * caller converts the null into the typed `unknown_grant` refusal).
 */
export function grantForScopeRef(registry: EntitlementRegistry, scopeRef: AuthorityScopeRef): AuthorityGrantRecord | null {
  return registry.grants.find((grant) => grant.scopeRef === scopeRef) ?? null;
}

/**
 * THE AUTHORITY STAGE predicate — the grant's scope + status under one
 * call: cross-tenant reuse, the validity window ([issuedAt, expiresAt)
 * — `now === expiresAt` is EXPIRED) and the revocation log. Returns
 * the typed refusal or null (the grant is valid, unrevoked and inside
 * its window for THIS caller at THIS instant).
 */
export function grantScopeRefusal(
  grant: AuthorityGrantRecord,
  tenant: TenantId,
  project: ProjectId,
  now: number,
): EntitlementRefusal | null {
  if (grant.tenant !== tenant || grant.project !== project) {
    return {
      kind: 'cross_tenant',
      grantId: grant.grantId,
      expectedTenant: grant.tenant,
      actualTenant: tenant,
      expectedProject: grant.project,
      actualProject: project,
    };
  }
  const status = grantStatus(grant, now as never);
  return status === null ? null : status;
}

/**
 * MAY this tenant route to venue V? Default-Deny at TWO levels: the
 * venue must be on the registry's allowlist (`unknown_venue` — the
 * tenant has no relationship with the venue) AND the grant must carry
 * it (`missing_entitlement` subject venue — the grant does not
 * extend there).
 */
export function mayRouteToVenue(registry: EntitlementRegistry, grant: AuthorityGrantRecord, venue: VenueId): EntitlementRefusal | null {
  if (!registry.venues.includes(venue)) {
    return { kind: 'unknown_venue', venue, tenant: registry.tenant };
  }
  if (!grant.venues.includes(venue)) {
    return { kind: 'missing_entitlement', subject: 'venue', grantId: grant.grantId, venue };
  }
  return null;
}

/**
 * MAY this grant use credential ref C at venue V? The (venue,
 * credential ref) pair must be bound by the grant — a ref bound at
 * another venue, or a venue with no binding, is the typed
 * `missing_entitlement` subject credential refusal (Default-Deny; the
 * binding is declared data, never inferred).
 */
export function mayUseCredential(grant: AuthorityGrantRecord, venue: VenueId, credentialRef: CredentialRef): EntitlementRefusal | null {
  const bound = grant.credentials.find((binding) => binding.venue === venue && binding.credentialRef === credentialRef);
  if (bound === undefined) {
    return { kind: 'missing_entitlement', subject: 'credential', grantId: grant.grantId, venue, credentialRef };
  }
  return null;
}

/**
 * The grant's rate budget for one venue, or null when the grant
 * declares NONE (Default-Deny at the gateway: no budget = no
 * permission to submit at any rate — the fail-closed law T019's
 * rate-limits check established, refined here per-grant).
 */
export function rateBudgetFor(grant: AuthorityGrantRecord, venue: VenueId): GrantRateBudget | null {
  return grant.rateBudgets.find((budget) => budget.venue === venue) ?? null;
}

/**
 * Does the grant permit this ORDER KIND? Defense in depth against
 * policy/registry drift: the policy's authorization dimension already
 * checked the kind against its DECLARED grants; this re-checks the
 * RESOLVED grant record's own list (`missing_entitlement` subject
 * order_kind — the registry and the policy disagreeing fail closed).
 */
export function permitsOrderKind(grant: AuthorityGrantRecord, orderKind: string): EntitlementRefusal | null {
  if (grant.orderKinds.includes(orderKind)) return null;
  return { kind: 'missing_entitlement', subject: 'order_kind', grantId: grant.grantId, orderKind };
}

/** Re-export the grant-status law (the registry's public surface). */
export { grantStatus } from './grant';
export type { GrantStatusRefusal } from './grant';
