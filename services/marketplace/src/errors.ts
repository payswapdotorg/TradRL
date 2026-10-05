// @tradrl/marketplace-service — the typed error taxonomy.
//
// THE LAW THIS MODULE SERVES: every failure of the marketplace is a
// MACHINE-CHECKABLE typed error — a closed code vocabulary located by
// a dotted field path, never a string-matched message. The vocabulary
// names the lane's laws:
//
//   - the envelope laws (invalid_type / missing_field / invalid_field /
//     invalid_id / invalid_timestamp / invalid_decimal);
//   - L12 (tenant_missing / cross_tenant_access — a foreign record
//     never crosses the marketplace boundary);
//   - L16a (label_as_evidence — a listing describes a CAPABILITY
//     CONTRACT with measured evidence, never a profession label);
//   - the consideration laws (consideration_invalid — the opaque JSON
//     slot T045 carries is THIS lane's contract, and it validates or
//     refuses; consideration_incomparable — the quote answers in the
//     same commercial language as the offer; consideration_exceeds_
//     budget — the quote's counter never exceeds the platform's
//     offered budget; currency_mismatch; usage_missing — a metered
//     settlement without usage settles nothing);
//   - the listing laws (listing_unknown / listing_mismatch — the
//     quote's provider/offer must be the listing's slot, and its price
//     never exceeds the listing's published pricing;
//     listing_retired — a retired slot never trades);
//   - the purchase laws (purchase_unknown / purchase_exists — one
//     live purchase per request; purchase_mismatch — the bound
//     engagement is the purchase's own);
//   - the entitlement gates (the settlement's charge draws the
//     tenant's spend allowance: the entitlements lane's typed
//     refusals surface here under their own codes — enforcement is
//     code, L20);
//   - the lifecycle laws (invalid_transition — the closed purchase
//     table; verification_missing — settling requires the terminal
//     engagement + its verification report);
//   - the chain law (chain_mismatch — a tampered marketplace log
//     never drives anything);
//   - L4 (l4_boundary_violation — instants must be ordered).
//
// `API_BOUNDARY_ERROR_FAMILY_OF` maps the codes that can surface on
// the T041 API boundary onto the SDK's error-family vocabulary (the
// shared member keeps its REAL SDK family — pinned in interop).

import type { SdkErrorFamilyMirror } from './imports';

// ---------------------------------------------------------------------------
// The closed code vocabulary
// ---------------------------------------------------------------------------

/** The lane's typed error codes — the machine-checkable form of its laws. */
export type MarketplaceErrorCode =
  // --- generic envelope validation -----------------------------------------
  | 'invalid_type'
  | 'missing_field'
  | 'invalid_field'
  | 'invalid_id'
  | 'invalid_timestamp'
  | 'invalid_decimal'
  // --- L12 tenant isolation ---------------------------------------------------
  | 'tenant_missing'
  | 'cross_tenant_access'
  // --- L16a labels never establish suitability ---------------------------------
  | 'label_as_evidence'
  // --- the consideration laws (T047's core ownership) -----------------------------
  | 'consideration_invalid'
  | 'consideration_incomparable'
  | 'consideration_exceeds_budget'
  | 'currency_mismatch'
  | 'usage_missing'
  // --- the listing laws ----------------------------------------------------------------
  | 'listing_unknown'
  | 'listing_mismatch'
  | 'listing_retired'
  // --- the purchase laws --------------------------------------------------------------------
  | 'purchase_unknown'
  | 'purchase_exists'
  | 'purchase_mismatch'
  // --- the entitlement gates (the settlement's charge; codes shared with @tradrl/entitlements) ---
  | 'entitlement_unknown'
  | 'grant_mismatch'
  | 'entitlement_exhausted'
  | 'entitlement_expired'
  | 'entitlement_inactive'
  | 'entitlement_revoked'
  // --- the lifecycle laws ------------------------------------------------------------------------
  | 'invalid_transition'
  | 'verification_missing'
  // --- the chain law --------------------------------------------------------------------------------
  | 'chain_mismatch'
  // --- L4 instant ordering ----------------------------------------------------------------------------
  | 'l4_boundary_violation';

/** The closed code list (the vocabulary — pinned by tests). */
export const MARKETPLACE_ERROR_CODES: readonly MarketplaceErrorCode[] = Object.freeze([
  'invalid_type',
  'missing_field',
  'invalid_field',
  'invalid_id',
  'invalid_timestamp',
  'invalid_decimal',
  'tenant_missing',
  'cross_tenant_access',
  'label_as_evidence',
  'consideration_invalid',
  'consideration_incomparable',
  'consideration_exceeds_budget',
  'currency_mismatch',
  'usage_missing',
  'listing_unknown',
  'listing_mismatch',
  'listing_retired',
  'purchase_unknown',
  'purchase_exists',
  'purchase_mismatch',
  'entitlement_unknown',
  'grant_mismatch',
  'entitlement_exhausted',
  'entitlement_expired',
  'entitlement_inactive',
  'entitlement_revoked',
  'invalid_transition',
  'verification_missing',
  'chain_mismatch',
  'l4_boundary_violation',
] as const satisfies readonly MarketplaceErrorCode[]);

/** Guard: `MarketplaceErrorCode`. */
export function isMarketplaceErrorCode(v: unknown): v is MarketplaceErrorCode {
  return typeof v === 'string' && (MARKETPLACE_ERROR_CODES as readonly string[]).includes(v);
}

/**
 * The API-boundary projection: which SDK error FAMILY each marketplace
 * code surfaces as when the lane is driven through the T041 API. The
 * shared member keeps the REAL SDK family (the interop test pins
 * `cross_tenant_access -> tenant` against the REAL map); the
 * commercial gates surface as validation/conflict/permission.
 */
export const API_BOUNDARY_ERROR_FAMILY_OF: Readonly<
  Record<'cross_tenant_access' | 'consideration_exceeds_budget' | 'currency_mismatch' | 'listing_retired' | 'entitlement_exhausted' | 'purchase_exists', SdkErrorFamilyMirror>
> = Object.freeze({
  cross_tenant_access: 'tenant',
  consideration_exceeds_budget: 'validation',
  currency_mismatch: 'validation',
  listing_retired: 'conflict',
  entitlement_exhausted: 'permission',
  purchase_exists: 'conflict',
});

// ---------------------------------------------------------------------------
// The error + result shapes
// ---------------------------------------------------------------------------

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface MarketplaceError {
  readonly code: MarketplaceErrorCode;
  /** Dotted path from the validated root, e.g. `purchase.agreedConsideration`. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type MarketplaceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly MarketplaceError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: MarketplaceErrorCode, message: string, path = ''): MarketplaceResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly MarketplaceError[]): MarketplaceResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors: [...errors] };
}

/** Construct a success. */
export function ok<T>(value: T): MarketplaceResult<T> {
  return { ok: true, value };
}

/** Helper: a missing required field. */
export function missingField(path: string): MarketplaceError {
  return { code: 'missing_field', path, message: `"${path}" is required` };
}

/** Helper: a present-but-invalid field. */
export function invalidField(path: string, detail: string): MarketplaceError {
  return { code: 'invalid_field', path, message: detail };
}

/** Helper: a wrong-shaped root value. */
export function invalidType(path: string, detail: string): MarketplaceError {
  return { code: 'invalid_type', path, message: detail };
}
