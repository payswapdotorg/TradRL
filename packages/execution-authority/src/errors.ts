// @tradrl/execution-authority — the typed operation-result envelope.
//
// STRUCTURAL MIRROR of @tradrl/execution-policy/src/errors.ts (T019) and
// @tradrl/risk/src/errors.ts (T020): the collect-all error list, the
// typed error-code vocabulary owned by THIS lane, and the ok/fail
// constructors. Operation failures are reserved for MALFORMED
// ENVELOPES and enforcement crimes; every domain-level refusal this
// package models is a structured record (EntitlementRefusal), never an
// exception-shaped error (the T019 "refusals are records" law).

import { isNonEmptyString, isRecord } from './primitives';

/** The typed error codes of this lane (closed vocabulary). */
export type ExecutionAuthorityErrorCode =
  /** A value failed a structural guard (malformed envelope). */
  | 'invalid_type'
  /** A field is present but malformed (malformed envelope). */
  | 'invalid_field'
  /** A required field is absent (malformed envelope). */
  | 'missing_field'
  /** Credential MATERIAL under a credential-shaped key anywhere in a record's JSON tree (SECURITY.md's boundary, enforced in code). */
  | 'credential_value_present'
  /** An order request was built without a valid APPROVED decision (L8 — the translation contract's existential law). */
  | 'decision_not_approved'
  /** A standing kill switch was thrown at request-build time (fail-closed, mirrors the T039 routing law). */
  | 'kill_switch_thrown'
  /** An append-only trail was spliced, edited, reordered or duplicated. */
  | 'audit_rewrite'
  /** A tenant/project scope mismatch (L12 — cross-tenant reuse is inexpressible). */
  | 'tenant_missing'
  /** A required decision/order coherence law failed (the request is not about what it claims). */
  | 'request_incoherent';

/** One typed, frozen operation error (collect-all element). */
export interface ExecutionAuthorityError {
  readonly code: ExecutionAuthorityErrorCode;
  readonly message: string;
  /** Optional dotted path into the rejected value. */
  readonly path?: string;
}

/** The lane's operation envelope: success value or the collect-all error list. */
export type ExecutionAuthorityResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ExecutionAuthorityError[] };

// ---------------------------------------------------------------------------
// Constructors (frozen)
// ---------------------------------------------------------------------------

/** Construct a frozen typed error. */
export function errorOf(code: ExecutionAuthorityErrorCode, message: string, path?: string): ExecutionAuthorityError {
  return Object.freeze({ code, message, ...(path === undefined ? {} : { path }) }) as ExecutionAuthorityError;
}

/** Construct an operation failure with one error. */
export function fail<T = never>(code: ExecutionAuthorityErrorCode, message: string, path?: string): ExecutionAuthorityResult<T> {
  return { ok: false, errors: [errorOf(code, message, path)] };
}

/** Construct an operation failure with several errors (collect-all). */
export function failures<T = never>(errors: readonly ExecutionAuthorityError[]): ExecutionAuthorityResult<T> {
  return { ok: false, errors: Object.freeze([...errors]) };
}

/** Construct an operation success. */
export function ok<T>(value: T): ExecutionAuthorityResult<T> {
  return { ok: true, value };
}

/** Construct a `missing_field` error. */
export function missingField(path: string, message = 'this field is required'): ExecutionAuthorityError {
  return errorOf('missing_field', message, path);
}

/** Construct an `invalid_field` error. */
export function invalidField(path: string, message: string): ExecutionAuthorityError {
  return errorOf('invalid_field', message, path);
}

/** Construct an `invalid_type` error. */
export function invalidType(message: string, path?: string): ExecutionAuthorityError {
  return errorOf('invalid_type', message, path);
}

/** Guard: the error envelope. */
export function isExecutionAuthorityError(v: unknown): v is ExecutionAuthorityError {
  if (!isRecord(v)) return false;
  const code: unknown = v.code;
  if (!isNonEmptyString(code)) return false;
  return typeof v.message === 'string' && v.message !== '' && (v.path === undefined || isNonEmptyString(v.path));
}
