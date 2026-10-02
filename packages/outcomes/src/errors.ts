/**
 * @tradrl/outcomes — the typed error taxonomy (the lane's failure
 * vocabulary — enumerated data, never free text, never exceptions for
 * record-level outcomes).
 *
 * The division of labor mirrors the contract packages (and T030's
 * shadow lane): REFUSALS, OUTCOMES and POST-MORTEMS ARE RECORDS — the
 * typed errors below exist only for malformed ENVELOPES and
 * operational crimes (tamper, rewrite, cross-tenant, future-dated
 * learning).
 *
 * The closed-vocabulary laws this taxonomy enforces:
 *   - `unknown_outcome_class` — the outcome-class vocabulary is closed;
 *     an unknown class string is never silently coerced (the Work
 *     Order's own words: "outcome-class vocabulary (closed, typed-error
 *     on unknown)").
 *   - `unknown_attribution_class` — the four attribution classes
 *     (decision, market_move, model_error, data_lag) are the whole
 *     vocabulary; a fifth is a typed crime.
 *   - `unknown_evidence_kind` — every evidence reference names its
 *     owning lane through a closed kind vocabulary.
 *   - `outcome_log_rewrite` / `postmortem_log_rewrite` — the two
 *     append-only logs' crimes (T030's `shadow_log_rewrite`, mirrored
 *     law-for-law: splice, reorder, truncation, re-decision, foreign
 *     chain head).
 *   - `chain_mismatch` — a chain-verified artifact fails its fold
 *     (tamper) — including the T030 outcome stream mirror's own chain
 *     re-derivation (never learn from a tampered stream).
 *   - `tenant_mismatch` (L12) — a learning record whose declared scope
 *     disagrees with its shadow lineage's scope is inexpressible.
 *   - `decimal_imprecision` — a JS number on a money/confidence path
 *     (float mediation is inexpressible).
 *   - `confidence_incoherent` — an attribution confidence outside the
 *     canonical unit interval.
 *   - `l4_boundary_violation` — point-in-time defense in depth: a
 *     learning record cannot predate its evidence (an outcome record
 *     stamped before the shadow outcome it learns from; a post-mortem
 *     stamped before its outcome; an ingestion instant before the
 *     stream's evidence).
 *   - `clock_not_monotonic` — injected instants that go backwards.
 */

import { isNonEmptyString, isRecord } from './primitives';

/** The typed error code (a closed vocabulary). */
export type OutcomesErrorCode =
  /** The input is not the expected shape. */
  | 'invalid_type'
  /** A field of an otherwise-shaped input is invalid. */
  | 'invalid_field'
  /** The operation's state preconditions failed (including a class that disagrees with its own numbers). */
  | 'invalid_state'
  /** The serialized bytes are not valid JSON. */
  | 'invalid_json'
  /** A cross-scope record/link is inexpressible (L12). */
  | 'tenant_mismatch'
  /** The append-only outcome-learning log was rewritten/reordered (the typed crime). */
  | 'outcome_log_rewrite'
  /** The append-only post-mortem log was rewritten/re-ordered/non-monotonic (the typed crime). */
  | 'postmortem_log_rewrite'
  /** A chain-verified artifact fails verification (tamper — including the mirrored T030 stream). */
  | 'chain_mismatch'
  /** The outcome-class vocabulary is closed; the string is unknown. */
  | 'unknown_outcome_class'
  /** The attribution-class vocabulary is closed (four members); the string is unknown. */
  | 'unknown_attribution_class'
  /** The evidence-kind vocabulary is closed; the string is unknown. */
  | 'unknown_evidence_kind'
  /** A JS number on a money/confidence path (float mediation is inexpressible). */
  | 'decimal_imprecision'
  /** An attribution confidence outside the canonical unit interval. */
  | 'confidence_incoherent'
  /** A lineage block is incomplete or dangles (a link without its referent). */
  | 'lineage_gap'
  /** A learning record predates its evidence (point-in-time defense in depth). */
  | 'l4_boundary_violation'
  /** An injected instant precedes the clock it must respect (monotonic time). */
  | 'clock_not_monotonic';

/** One typed error: the code, the path, the human-readable message. */
export interface OutcomesError {
  readonly code: OutcomesErrorCode;
  readonly path: string;
  readonly message: string;
}

/** The lane's result shape (mirroring the contract packages' Result). */
export type OutcomesResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly OutcomesError[] };

/** Construct a failure with one typed error. */
export function fail<T = never>(code: OutcomesErrorCode, message: string, path = ''): OutcomesResult<T> {
  return { ok: false, errors: [{ code, path, message }] };
}

/** Construct a failure from pre-built errors. */
export function failures<T = never>(errors: readonly OutcomesError[]): OutcomesResult<T> {
  return { ok: false, errors: [...errors] };
}

/** Construct a success. */
export function ok<T>(value: T): OutcomesResult<T> {
  return { ok: true, value };
}

/** Build an `invalid_field` error. */
export function invalidField(path: string, message: string): OutcomesError {
  return { code: 'invalid_field', path, message };
}

/** Build an `invalid_type` error. */
export function invalidType(message: string): OutcomesError {
  return { code: 'invalid_type', path: '', message };
}

/** Guard: a typed outcomes error. */
export function isOutcomesError(v: unknown): v is OutcomesError {
  const CODES: readonly string[] = [
    'invalid_type', 'invalid_field', 'invalid_state', 'invalid_json', 'tenant_mismatch',
    'outcome_log_rewrite', 'postmortem_log_rewrite', 'chain_mismatch',
    'unknown_outcome_class', 'unknown_attribution_class', 'unknown_evidence_kind',
    'decimal_imprecision', 'confidence_incoherent', 'lineage_gap',
    'l4_boundary_violation', 'clock_not_monotonic',
  ];
  if (!isRecord(v)) return false;
  if (typeof v.code !== 'string' || !CODES.includes(v.code)) return false;
  if (typeof v.path !== 'string') return false;
  return isNonEmptyString(v.message);
}
