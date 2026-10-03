/**
 * @tradrl/firm-memory — the typed error taxonomy (the lane's failure
 * vocabulary — enumerated data, never free text, never exceptions for
 * record-level outcomes).
 *
 * The division of labor mirrors the contract packages (outcomes,
 * search-lineage): PROMOTED KNOWLEDGE AND CONTRADICTIONS ARE RECORDS —
 * the typed errors below exist only for malformed ENVELOPES and
 * operational crimes (tamper, rewrite, cross-tenant, future-dated
 * learning, polarity flips without dominating evidence).
 *
 * The closed-vocabulary laws this taxonomy enforces:
 *   - `unknown_knowledge_kind` — the knowledge-kind vocabulary is
 *     closed (four members: decision_pattern, market_behavior,
 *     model_calibration, data_latency); a fifth is a typed crime.
 *   - `unknown_polarity` — each kind admits exactly two opposing
 *     polarity values; a foreign polarity string is a typed crime.
 *   - `unknown_lag_band` — the data-latency band vocabulary is closed
 *     (four derived members).
 *   - `firm_log_rewrite` / `contradiction_log_rewrite` — the two
 *     append-only chains' crimes (T030's `shadow_log_rewrite` /
 *     T033's `outcome_log_rewrite`, mirrored law-for-law: splice,
 *     reorder, truncation, re-decision, foreign chain head,
 *     non-monotonic supersession).
 *   - `chain_mismatch` — a chain-verified artifact fails its fold
 *     (tamper): a tampered brain never serves.
 *   - `tenant_mismatch` (L12) — a record whose declared scope
 *     disagrees with its evidence's scope is inexpressible; a batch
 *     that mixes scopes is inexpressible.
 *   - `cross_tenant_access` (R25/L12) — a read or write that would
 *     cross a tenant boundary (the query/ingestion surface's own
 *     crime — the error names both scopes, never a silent miss).
 *   - `contradiction_detected` — a polarity flip attempted WITHOUT
 *     dominating evidence: the contradiction register is the only
 *     path by which contested knowledge evolves (never a silent
 *     overwrite, never an unearned flip).
 *   - `duplicate_evidence` — the idempotence guard: a post-mortem
 *     already consumed by the brain is re-ingested (detect
 *     re-ingestion via the receipts' batch digests, never by silent
 *     double-counting).
 *   - `decimal_imprecision` / `confidence_incoherent` — the
 *     exact-decimal and unit-interval laws.
 *   - `l4_boundary_violation` — point-in-time defense in depth: a
 *     knowledge record cannot predate its evidence; a query cannot
 *     ask for knowledge that did not exist at its instant.
 *   - `clock_not_monotonic` — injected instants that go backwards.
 */

import { isNonEmptyString, isRecord } from './primitives';

/** The typed error code (a closed vocabulary). */
export type FirmMemoryErrorCode =
  /** The input is not the expected shape. */
  | 'invalid_type'
  /** A field of an otherwise-shaped input is invalid. */
  | 'invalid_field'
  /** The operation's state preconditions failed (including kind/polarity incoherence). */
  | 'invalid_state'
  /** The serialized bytes are not valid JSON. */
  | 'invalid_json'
  /** A cross-scope record/batch is inexpressible (L12). */
  | 'tenant_mismatch'
  /** A read or write that would cross a tenant boundary (R25/L12 — the error names both scopes). */
  | 'cross_tenant_access'
  /** The append-only knowledge chain was rewritten/reordered/re-decided (the typed crime). */
  | 'firm_log_rewrite'
  /** The append-only contradiction register was rewritten/reordered (the typed crime). */
  | 'contradiction_log_rewrite'
  /** A chain-verified artifact fails verification (tamper) — a tampered brain never serves. */
  | 'chain_mismatch'
  /** The knowledge-kind vocabulary is closed; the string is unknown. */
  | 'unknown_knowledge_kind'
  /** The polarity vocabulary (per kind) is closed; the string is unknown. */
  | 'unknown_polarity'
  /** The lag-band vocabulary is closed; the string is unknown. */
  | 'unknown_lag_band'
  /** A JS number on a money/confidence path (float mediation is inexpressible). */
  | 'decimal_imprecision'
  /** A confidence outside the canonical unit interval. */
  | 'confidence_incoherent'
  /** A lineage/provenance block is incomplete or dangles (a link without its referent). */
  | 'lineage_gap'
  /** A learning record predates its evidence, or a query asks for knowledge that did not exist at its instant. */
  | 'l4_boundary_violation'
  /** An injected instant precedes the clock it must respect (monotonic time). */
  | 'clock_not_monotonic'
  /** The idempotence guard: evidence already consumed by the brain. */
  | 'duplicate_evidence'
  /** A polarity flip attempted without dominating evidence (the contradiction register is the only path). */
  | 'contradiction_detected';

/** One typed error: the code, the path, the human-readable message. */
export interface FirmMemoryError {
  readonly code: FirmMemoryErrorCode;
  readonly path: string;
  readonly message: string;
}

/** The lane's result shape (mirroring the contract packages' Result). */
export type FirmMemoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly FirmMemoryError[] };

/** Construct a failure with one typed error. */
export function fail<T = never>(code: FirmMemoryErrorCode, message: string, path = ''): FirmMemoryResult<T> {
  return { ok: false, errors: [{ code, path, message }] };
}

/** Construct a failure from pre-built errors. */
export function failures<T = never>(errors: readonly FirmMemoryError[]): FirmMemoryResult<T> {
  return { ok: false, errors: [...errors] };
}

/** Construct a success. */
export function ok<T>(value: T): FirmMemoryResult<T> {
  return { ok: true, value };
}

/** Guard: a typed firm-memory error. */
export function isFirmMemoryError(v: unknown): v is FirmMemoryError {
  const CODES: readonly string[] = [
    'invalid_type', 'invalid_field', 'invalid_state', 'invalid_json', 'tenant_mismatch', 'cross_tenant_access',
    'firm_log_rewrite', 'contradiction_log_rewrite', 'chain_mismatch',
    'unknown_knowledge_kind', 'unknown_polarity', 'unknown_lag_band',
    'decimal_imprecision', 'confidence_incoherent', 'lineage_gap',
    'l4_boundary_violation', 'clock_not_monotonic', 'duplicate_evidence', 'contradiction_detected',
  ];
  if (!isRecord(v)) return false;
  if (typeof v.code !== 'string' || !CODES.includes(v.code)) return false;
  if (typeof v.path !== 'string') return false;
  return isNonEmptyString(v.message);
}
