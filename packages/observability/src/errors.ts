// @tradrl/observability — the typed operation-result envelope.
//
// STRUCTURAL MIRROR of @tradrl/execution-authority/src/errors.ts (T040)
// — re-declared by STRUCTURE, never imported (D-003/D-004): the
// collect-all error list, the typed error-code vocabulary owned by
// THIS lane, and the ok/fail constructors. Operation failures are
// reserved for MALFORMED ENVELOPES and enforcement crimes; the
// observability data model has no domain-level "refusal" records (a
// rejected record simply never enters a log).

import { isNonEmptyString, isRecord } from './primitives';

/** The typed error codes of this lane (closed vocabulary). */
export type ObservabilityErrorCode =
  /** A value failed a structural guard (malformed envelope). */
  | 'invalid_type'
  /** A field is present but malformed (malformed envelope). */
  | 'invalid_field'
  /** A required field is absent (malformed envelope). */
  | 'missing_field'
  /** Credential MATERIAL under a credential-shaped key anywhere in a record's JSON tree (SECURITY.md's boundary, enforced in code). */
  | 'credential_value_present'
  /** An append-only log or trail was spliced, edited, truncated, reordered or duplicated. */
  | 'audit_rewrite'
  /** A tenant/project scope mismatch (L12 — cross-tenant reuse is inexpressible). */
  | 'tenant_missing';

/** One typed, frozen operation error (collect-all element). */
export interface ObservabilityError {
  readonly code: ObservabilityErrorCode;
  readonly message: string;
  /** Optional dotted path into the rejected value. */
  readonly path?: string;
}

/** The lane's operation envelope: success value or the collect-all error list. */
export type ObservabilityResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ObservabilityError[] };

// ---------------------------------------------------------------------------
// Constructors (frozen)
// ---------------------------------------------------------------------------

/** Construct a frozen typed error. */
export function errorOf(code: ObservabilityErrorCode, message: string, path?: string): ObservabilityError {
  return Object.freeze({ code, message, ...(path === undefined ? {} : { path }) }) as ObservabilityError;
}

/** Construct an operation failure with one error. */
export function fail<T = never>(code: ObservabilityErrorCode, message: string, path?: string): ObservabilityResult<T> {
  return { ok: false, errors: [errorOf(code, message, path)] };
}

/** Construct an operation failure with several errors (collect-all). */
export function failures<T = never>(errors: readonly ObservabilityError[]): ObservabilityResult<T> {
  return { ok: false, errors: Object.freeze([...errors]) };
}

/** Construct an operation success. */
export function ok<T>(value: T): ObservabilityResult<T> {
  return { ok: true, value };
}

/** Construct a `missing_field` error. */
export function missingField(path: string, message = 'this field is required'): ObservabilityError {
  return errorOf('missing_field', message, path);
}

/** Construct an `invalid_field` error. */
export function invalidField(path: string, message: string): ObservabilityError {
  return errorOf('invalid_field', message, path);
}

/** Construct an `invalid_type` error. */
export function invalidType(message: string, path?: string): ObservabilityError {
  return errorOf('invalid_type', message, path);
}

/** Guard: the error envelope. */
export function isObservabilityError(v: unknown): v is ObservabilityError {
  if (!isRecord(v)) return false;
  const code: unknown = v.code;
  if (!isNonEmptyString(code)) return false;
  return typeof v.message === 'string' && v.message !== '' && (v.path === undefined || isNonEmptyString(v.path));
}
