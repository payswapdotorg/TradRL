/**
 * @tradrl/shadow_trading — the typed error taxonomy (the lane's failure
 * vocabulary — enumerated data, never free text, never exceptions for
 * record-level outcomes).
 *
 * The division of labor mirrors the contract packages:
 *   - REFUSALS ARE RECORDS (never exceptions): a gate/risk refusal is a
 *     {@link ../outcomes/ ShadowRefusal} record; the typed errors below
 *     exist only for malformed ENVELOPES and operational crimes
 *     (tamper, rewrite, cross-tenant).
 *   - Codes cross-referenced with the consumers' own taxonomies:
 *     `physics_lineage_missing` (T027's law), `chain_mismatch` (the
 *     resume tamper anchor), `tenant_mismatch` (L12), `shadow_log_rewrite`
 *     (the append-only outcome log), `fidelity_claim_dishonest` (L5/R23),
 *     `decimal_imprecision` (the exact-decimal trip wire),
 *     `l4_boundary_violation` (the point-in-time defense in depth).
 */

import { isNonEmptyString, isRecord } from './primitives';

/** The typed error code (a closed vocabulary). */
export type ShadowErrorCode =
  /** The input is not the expected shape. */
  | 'invalid_type'
  /** A field of an otherwise-shaped input is invalid. */
  | 'invalid_field'
  /** The operation's state preconditions failed. */
  | 'invalid_state'
  /** The serialized bytes are not valid JSON. */
  | 'invalid_json'
  /** A cross-tenant decision/record is inexpressible (L12). */
  | 'tenant_mismatch'
  /** The append-only outcome log was rewritten/reordered (the typed crime). */
  | 'shadow_log_rewrite'
  /** A chain-verified artifact fails verification (tamper). */
  | 'chain_mismatch'
  /** The kill-switch log fails its own chain verification (lifted from the T019 contract). */
  | 'killswitch_rewrite'
  /** A mode/fidelity claim is dishonest (L5/R23 — 'shadow' is the only honest mode here). */
  | 'fidelity_claim_dishonest'
  /** A JS number on a money path (float mediation is inexpressible). */
  | 'decimal_imprecision'
  /** A shadow fill lacks its full physics lineage (T027's law). */
  | 'physics_lineage_missing'
  /** A lineage block is incomplete (session/run/episode binding). */
  | 'lineage_gap'
  /** An observation/record leaked past the inclusive L4 boundary. */
  | 'l4_boundary_violation'
  /** The venue state does not cover the intent's (venue, instrument) pair. */
  | 'venue_state_gap'
  /** The world port failed an operation (the injected service's typed failure, lifted). */
  | 'world_error'
  /** The time-machine port failed an operation (the injected service's typed failure, lifted). */
  | 'machine_error'
  /** A decision instant precedes the session clock (monotonic time). */
  | 'clock_not_monotonic'
  /** The decision source is not an async iterator. */
  | 'invalid_source';

/** One typed error: the code, the path, the human-readable message. */
export interface ShadowError {
  readonly code: ShadowErrorCode;
  readonly path: string;
  readonly message: string;
}

/** The lane's result shape (mirroring the contract packages' Result). */
export type ShadowResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ShadowError[] };

/** Construct a failure with one typed error. */
export function fail<T = never>(code: ShadowErrorCode, message: string, path = ''): ShadowResult<T> {
  return { ok: false, errors: [{ code, path, message }] };
}

/** Construct a failure from pre-built errors. */
export function failures<T = never>(errors: readonly ShadowError[]): ShadowResult<T> {
  return { ok: false, errors: [...errors] };
}

/** Construct a success. */
export function ok<T>(value: T): ShadowResult<T> {
  return { ok: true, value };
}

/** Build an `invalid_field` error (the collect-all vocabulary's workhorse). */
export function invalidField(path: string, message: string): ShadowError {
  return { code: 'invalid_field', path, message };
}

/** Build an `invalid_type` error. */
export function invalidType(message: string): ShadowError {
  return { code: 'invalid_type', path: '', message };
}

/** Guard: a typed shadow error. */
export function isShadowError(v: unknown): v is ShadowError {
  const CODES: readonly string[] = [
    'invalid_type', 'invalid_field', 'invalid_state', 'invalid_json', 'tenant_mismatch',
    'shadow_log_rewrite', 'chain_mismatch', 'killswitch_rewrite', 'fidelity_claim_dishonest', 'decimal_imprecision',
    'physics_lineage_missing', 'lineage_gap', 'l4_boundary_violation', 'venue_state_gap',
    'world_error', 'machine_error', 'clock_not_monotonic', 'invalid_source',
  ];
  if (!isRecord(v)) return false;
  if (typeof v.code !== 'string' || !CODES.includes(v.code)) return false;
  if (typeof v.path !== 'string') return false;
  return isNonEmptyString(v.message);
}
