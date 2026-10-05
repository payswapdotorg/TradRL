// @tradrl/capability-provider — the typed error taxonomy.
//
// THE LAW THIS MODULE SERVES: every failure of the capability-provider
// interface is a MACHINE-CHECKABLE typed error — a closed code vocabulary
// located by a dotted field path, never a string-matched message. The
// vocabulary names the lane's laws:
//
//   - the envelope laws (invalid_type / missing_field / invalid_field /
//     invalid_id / invalid_timestamp);
//   - L12 (tenant_missing / tenant_scope_mismatch / cross_tenant_access
//     — a foreign record never crosses the exchange boundary);
//   - L16a (label_as_evidence — a provider claim citing a profession/
//     role label instead of measured evidence);
//   - the evidence law (evidence_missing — a request with no citation
//     is invented, not requested);
//   - the chain law (chain_mismatch — a tampered exchange log never
//     drives anything);
//   - the registry laws (provider_unknown / request_unknown /
//     engagement_unknown / deliverable_unknown);
//   - the negotiation laws (quote_mismatch — a quote must accept the
//     request's verification contract VERBATIM; engagement_exists — one
//     live engagement per request);
//   - the lifecycle laws (invalid_transition / deliverable_missing /
//     deliverable_mismatch / deadline_exceeded — the engagement's
//     deadline instant is a gate, not a suggestion);
//   - the verification laws (verification_required — the goalposts are
//     fixed at request time; verification_contract_breach — outcomes
//     must cover the contract EXACTLY; verification_missing — no import
//     without a verified deliverable; deliverable_not_importable);
//   - the payload law (payload_digest_mismatch — the opaque provider
//     payload is pinned by its digest at the boundary);
//   - L4 (l4_boundary_violation — instants must be ordered: quotes
//     postdate their request, deliverables postdate their engagement,
//     verdicts postdate their deliverable, deadlines postdate requests).
//
// `API_BOUNDARY_ERROR_FAMILY_OF` maps the codes that can surface on the
// T041 API boundary onto the SDK's error-family vocabulary — the shared
// members (cross_tenant_access) keep their REAL SDK family, so a
// provider-interface violation projected through the API is
// programmatically indistinguishable from the boundary's own (the
// interop test pins the agreement against the REAL sdk map).

import type { SdkErrorFamilyMirror } from './mirrors';

// ---------------------------------------------------------------------------
// The closed code vocabulary
// ---------------------------------------------------------------------------

/** The lane's typed error codes — the machine-checkable form of its laws. */
export type ProviderErrorCode =
  // --- generic envelope validation -----------------------------------------
  | 'invalid_type'
  | 'missing_field'
  | 'invalid_field'
  | 'invalid_id'
  | 'invalid_timestamp'
  // --- L12 tenant isolation ---------------------------------------------------
  | 'tenant_missing'
  | 'tenant_scope_mismatch'
  | 'cross_tenant_access'
  // --- L16a labels never establish suitability ---------------------------------
  | 'label_as_evidence'
  // --- the evidence-citation law --------------------------------------------------
  | 'evidence_missing'
  // --- the chain law -----------------------------------------------------------------
  | 'chain_mismatch'
  // --- the registry laws ----------------------------------------------------------------
  | 'provider_unknown'
  | 'request_unknown'
  | 'quote_unknown'
  | 'engagement_unknown'
  | 'deliverable_unknown'
  // --- the negotiation laws ----------------------------------------------------------------
  | 'quote_mismatch'
  | 'engagement_exists'
  // --- the lifecycle laws --------------------------------------------------------------------
  | 'invalid_transition'
  | 'deliverable_missing'
  | 'deliverable_mismatch'
  | 'deadline_exceeded'
  // --- the verification laws --------------------------------------------------------------------
  | 'verification_required'
  | 'verification_contract_breach'
  | 'verification_missing'
  | 'deliverable_not_importable'
  // --- the payload law ----------------------------------------------------------------------------
  | 'payload_digest_mismatch'
  // --- L4 instant ordering --------------------------------------------------------------------------
  | 'l4_boundary_violation';

/** The closed code list (the vocabulary — pinned by tests). */
export const PROVIDER_ERROR_CODES: readonly ProviderErrorCode[] = Object.freeze([
  'invalid_type',
  'missing_field',
  'invalid_field',
  'invalid_id',
  'invalid_timestamp',
  'tenant_missing',
  'tenant_scope_mismatch',
  'cross_tenant_access',
  'label_as_evidence',
  'evidence_missing',
  'chain_mismatch',
  'provider_unknown',
  'request_unknown',
  'quote_unknown',
  'engagement_unknown',
  'deliverable_unknown',
  'quote_mismatch',
  'engagement_exists',
  'invalid_transition',
  'deliverable_missing',
  'deliverable_mismatch',
  'deadline_exceeded',
  'verification_required',
  'verification_contract_breach',
  'verification_missing',
  'deliverable_not_importable',
  'payload_digest_mismatch',
  'l4_boundary_violation',
] as const satisfies readonly ProviderErrorCode[]);

/** Guard: `ProviderErrorCode`. */
export function isProviderErrorCode(v: unknown): v is ProviderErrorCode {
  return typeof v === 'string' && (PROVIDER_ERROR_CODES as readonly string[]).includes(v);
}

/**
 * The API-boundary projection: which SDK error FAMILY each provider code
 * surfaces as when the exchange is driven through the T041 API. Members
 * shared with the REAL SDK vocabulary keep the REAL SDK family (the
 * interop test pins `cross_tenant_access -> tenant` against the REAL
 * map); provider-specific laws surface as validation conflicts.
 */
export const API_BOUNDARY_ERROR_FAMILY_OF: Readonly<Record<'cross_tenant_access' | 'tenant_scope_mismatch' | 'engagement_exists' | 'deadline_exceeded' | 'payload_digest_mismatch' | 'verification_contract_breach', SdkErrorFamilyMirror>> = Object.freeze({
  cross_tenant_access: 'tenant',
  tenant_scope_mismatch: 'tenant',
  engagement_exists: 'conflict',
  deadline_exceeded: 'conflict',
  payload_digest_mismatch: 'conflict',
  verification_contract_breach: 'validation',
});

// ---------------------------------------------------------------------------
// The error + result shapes
// ---------------------------------------------------------------------------

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface ProviderError {
  readonly code: ProviderErrorCode;
  /** Dotted path from the validated root, e.g. `deliverable.claims[1].measuredEvidence`. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type ProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ProviderError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: ProviderErrorCode, message: string, path = ''): ProviderResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly ProviderError[]): ProviderResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors: [...errors] };
}

/** Construct a success. */
export function ok<T>(value: T): ProviderResult<T> {
  return { ok: true, value };
}

/** Helper: a missing required field. */
export function missingField(path: string): ProviderError {
  return { code: 'missing_field', path, message: `"${path}" is required` };
}

/** Helper: a present-but-invalid field. */
export function invalidField(path: string, detail: string): ProviderError {
  return { code: 'invalid_field', path, message: detail };
}

/** Helper: a wrong-shaped root value. */
export function invalidType(path: string, detail: string): ProviderError {
  return { code: 'invalid_type', path, message: detail };
}
