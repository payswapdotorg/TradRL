// @tradrl/security — the typed operation-result envelope.
//
// STRUCTURAL MIRROR of @tradrl/execution-authority/src/errors.ts (T040) and
// @tradrl/execution-policy/src/errors.ts (T019): the collect-all error list,
// the typed error-code vocabulary owned by THIS lane, and the ok/fail
// constructors. Operation failures are reserved for MALFORMED ENVELOPES and
// enforcement crimes; every domain-level refusal this package models is a
// structured record, never an exception-shaped error (the "refusals are
// records" law).
//
// THE NAMED ERRORS of the T044 charter (the isolation laws the tests
// enforce, each a TYPED error — never a filter, never an exception):
//   - `credential_value_present` — plaintext credential MATERIAL anywhere in
//     a record's JSON tree (spec/SECURITY.md Secrets: "Never commit provider
//     credentials. Inject them through secure runtime boundaries.").
//   - `cross_tenant_access` — a scope attempting to reach another tenant's
//     data/memory/trajectories/artifacts/credentials/usage (L12; a typed
//     error, not a filter).
//   - `untrusted_content_escalation` — untrusted market/news/retrieved text
//     attempting an authority-affecting action (L20: "untrusted text cannot
//     grant tools").
//   - `isolation_violation` — an untrusted workload admitted without an
//     isolation descriptor (spec/SECURITY.md Untrusted workloads).

import { isNonEmptyString, isRecord } from './primitives';

/** The typed error codes of this lane (closed vocabulary). */
export type SecurityErrorCode =
  /** A value failed a structural guard (malformed envelope). */
  | 'invalid_type'
  /** A field is present but malformed (malformed envelope). */
  | 'invalid_field'
  /** A required field is absent (malformed envelope). */
  | 'missing_field'
  /** Credential MATERIAL under a credential-shaped key anywhere in a record's JSON tree (the opacity law). */
  | 'credential_value_present'
  /** A scope attempted to reach another tenant's record (L12 — cross-tenant access is a typed error, not a filter). */
  | 'cross_tenant_access'
  /** Untrusted content attempted an authority-affecting action (L20 — untrusted text cannot grant tools). */
  | 'untrusted_content_escalation'
  /** An untrusted workload was submitted without a valid isolation descriptor. */
  | 'isolation_violation'
  /** A scope is not registered in the tenant isolation registry (mirror of T040's code). */
  | 'tenant_missing'
  /** A tenant/project is already registered (idempotence guard). */
  | 'tenant_already_registered'
  /** A record is unknown to the surface it was requested from. */
  | 'unknown_record'
  /** A deposited secret does not match the envelope's fingerprint. */
  | 'secret_fingerprint_mismatch'
  /** The referenced credential envelope version does not exist. */
  | 'unknown_credential'
  /** The referenced credential version is superseded by a newer version. */
  | 'credential_retired'
  /** The referenced credential is revoked (append-only tombstone version). */
  | 'credential_revoked'
  /** An append-only trail was spliced, edited, reordered or duplicated (T040 audit mirror). */
  | 'audit_rewrite'
  /** A tenant export bundle would include another tenant's records (R42). */
  | 'export_scope_violation';

/** One typed, frozen operation error (collect-all element). */
export interface SecurityError {
  readonly code: SecurityErrorCode;
  readonly message: string;
  /** Optional dotted path into the rejected value. */
  readonly path?: string;
}

/** The lane's operation envelope: success value or the collect-all error list. */
export type SecurityResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly SecurityError[] };

// ---------------------------------------------------------------------------
// Constructors (frozen)
// ---------------------------------------------------------------------------

/** Construct a frozen typed error. */
export function errorOf(code: SecurityErrorCode, message: string, path?: string): SecurityError {
  return Object.freeze({ code, message, ...(path === undefined ? {} : { path }) }) as SecurityError;
}

/** Construct an operation failure with one error. */
export function fail<T = never>(code: SecurityErrorCode, message: string, path?: string): SecurityResult<T> {
  return { ok: false, errors: [errorOf(code, message, path)] };
}

/** Construct an operation failure with several errors (collect-all). */
export function failures<T = never>(errors: readonly SecurityError[]): SecurityResult<T> {
  return { ok: false, errors: Object.freeze([...errors]) };
}

/** Construct an operation success. */
export function ok<T>(value: T): SecurityResult<T> {
  return { ok: true, value };
}

/** Construct a `missing_field` error. */
export function missingField(path: string, message = 'this field is required'): SecurityError {
  return errorOf('missing_field', message, path);
}

/** Construct an `invalid_field` error. */
export function invalidField(path: string, message: string): SecurityError {
  return errorOf('invalid_field', message, path);
}

/** Construct an `invalid_type` error. */
export function invalidType(message: string, path?: string): SecurityError {
  return errorOf('invalid_type', message, path);
}

/** Guard: the error envelope. */
export function isSecurityError(v: unknown): v is SecurityError {
  if (!isRecord(v)) return false;
  const code: unknown = v.code;
  if (!isNonEmptyString(code)) return false;
  return typeof v.message === 'string' && v.message !== '' && (v.path === undefined || isNonEmptyString(v.path));
}
