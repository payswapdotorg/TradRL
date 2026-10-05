// @tradrl/entitlements — the typed error taxonomy.
//
// THE LAW THIS MODULE SERVES: every failure of the entitlements lane is
// a MACHINE-CHECKABLE typed error — a closed code vocabulary located by
// a dotted field path, never a string-matched message. The vocabulary
// names the lane's laws:
//
//   - the envelope laws (invalid_type / missing_field / invalid_field /
//     invalid_id / invalid_timestamp / invalid_decimal — the money law:
//     a non-canonical amount is a typed violation, never a coerced one);
//   - L12 (tenant_missing / cross_tenant_access — a foreign record
//     never crosses the ledger boundary);
//   - the grant registry laws (entitlement_unknown / grant_mismatch —
//     an amendment must supersede the registry's current version;
//     kind_change_forbidden — a grant's kind is its identity);
//   - the allowance laws (entitlement_exhausted — the draw-down never
//     goes negative; entitlement_expired / entitlement_inactive /
//     entitlement_revoked — the L4 window and revocation are gates, not
//     suggestions);
//   - the lifecycle law (invalid_transition — a revoked grant never
//     amends, a terminal consumption never re-mints);
//   - the chain law (chain_mismatch — a tampered ledger never drives
//     anything: every entry's head recomputes, every link is intact,
//     every record digest matches);
//   - the R41 usage law (usage_denied — the enforcement verdict when a
//     candidate request exceeds every covering api-quota grant).
//
// `API_BOUNDARY_ERROR_FAMILY_OF` maps the codes that can surface on the
// T041 API boundary onto the SDK's error-family vocabulary — the shared
// members keep their REAL SDK family (the interop test pins
// `cross_tenant_access -> tenant` against the REAL sdk map), so an
// entitlement violation projected through the API is programmatically
// indistinguishable from the boundary's own.

import type { SdkErrorFamilyMirror } from './usage';

// ---------------------------------------------------------------------------
// The closed code vocabulary
// ---------------------------------------------------------------------------

/** The lane's typed error codes — the machine-checkable form of its laws. */
export type EntitlementErrorCode =
  // --- generic envelope validation -----------------------------------------
  | 'invalid_type'
  | 'missing_field'
  | 'invalid_field'
  | 'invalid_id'
  | 'invalid_timestamp'
  // --- the money law (exact canonical decimals) ------------------------------
  | 'invalid_decimal'
  // --- L12 tenant isolation ---------------------------------------------------
  | 'tenant_missing'
  | 'cross_tenant_access'
  // --- the grant registry laws --------------------------------------------------
  | 'entitlement_unknown'
  | 'grant_mismatch'
  | 'kind_change_forbidden'
  // --- the allowance laws ---------------------------------------------------------
  | 'entitlement_exhausted'
  | 'entitlement_expired'
  | 'entitlement_inactive'
  | 'entitlement_revoked'
  // --- the lifecycle law -------------------------------------------------------------
  | 'invalid_transition'
  // --- the chain law ---------------------------------------------------------------------
  | 'chain_mismatch'
  // --- the R41 usage law ---------------------------------------------------------------------
  | 'usage_denied'
  // --- L4 instant ordering ----------------------------------------------------------------------
  | 'l4_boundary_violation';

/** The closed code list (the vocabulary — pinned by tests). */
export const ENTITLEMENT_ERROR_CODES: readonly EntitlementErrorCode[] = Object.freeze([
  'invalid_type',
  'missing_field',
  'invalid_field',
  'invalid_id',
  'invalid_timestamp',
  'invalid_decimal',
  'tenant_missing',
  'cross_tenant_access',
  'entitlement_unknown',
  'grant_mismatch',
  'kind_change_forbidden',
  'entitlement_exhausted',
  'entitlement_expired',
  'entitlement_inactive',
  'entitlement_revoked',
  'invalid_transition',
  'chain_mismatch',
  'usage_denied',
  'l4_boundary_violation',
] as const satisfies readonly EntitlementErrorCode[]);

/** Guard: `EntitlementErrorCode`. */
export function isEntitlementErrorCode(v: unknown): v is EntitlementErrorCode {
  return typeof v === 'string' && (ENTITLEMENT_ERROR_CODES as readonly string[]).includes(v);
}

/**
 * The API-boundary projection: which SDK error FAMILY each entitlement
 * code surfaces as when the lane is driven through the T041 API.
 * Members shared with the REAL SDK vocabulary keep the REAL SDK family
 * (the interop test pins `cross_tenant_access -> tenant` against the
 * REAL map); allowance gates surface as permission (L20: enforcement
 * is code, and its boundary shape is typed).
 */
export const API_BOUNDARY_ERROR_FAMILY_OF: Readonly<
  Record<'cross_tenant_access' | 'entitlement_exhausted' | 'entitlement_expired' | 'entitlement_revoked' | 'usage_denied', SdkErrorFamilyMirror>
> = Object.freeze({
  cross_tenant_access: 'tenant',
  entitlement_exhausted: 'permission',
  entitlement_expired: 'permission',
  entitlement_revoked: 'permission',
  usage_denied: 'permission',
});

// ---------------------------------------------------------------------------
// The error + result shapes
// ---------------------------------------------------------------------------

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface EntitlementError {
  readonly code: EntitlementErrorCode;
  /** Dotted path from the validated root, e.g. `grant.terms.amount`. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type EntitlementResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly EntitlementError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: EntitlementErrorCode, message: string, path = ''): EntitlementResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly EntitlementError[]): EntitlementResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors: [...errors] };
}

/** Construct a success. */
export function ok<T>(value: T): EntitlementResult<T> {
  return { ok: true, value };
}

/** Helper: a missing required field. */
export function missingField(path: string): EntitlementError {
  return { code: 'missing_field', path, message: `"${path}" is required` };
}

/** Helper: a present-but-invalid field. */
export function invalidField(path: string, detail: string): EntitlementError {
  return { code: 'invalid_field', path, message: detail };
}

/** Helper: a wrong-shaped root value. */
export function invalidType(path: string, detail: string): EntitlementError {
  return { code: 'invalid_type', path, message: detail };
}
