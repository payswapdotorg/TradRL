/**
 * @tradrl/trading-strategy — typed errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects
 * ALL violations and reports them as typed errors (the collect-all
 * discipline of the sibling contract packages), while state transitions
 * fail with a precise single cause. Both flow through the same
 * {@link StrategyResult} shape: a failure carries a non-empty `errors`
 * array. The one deliberate exception mirrors exchange-sim's decimals
 * module: the decimal ARITHMETIC preconditions throw on impossible
 * operands — every call site in this package wraps them into typed
 * errors instead.
 *
 * The taxonomy below names the Work Order's required codes explicitly:
 * `constraint_refused` (constraint primacy — a refusal is a RECORD on the
 * run, never an exception, but validators also use this code when a
 * refusal record itself is malformed), `authority_in_strategy` (the L8
 * trip wire), `lineage_gap` (L9), `universe_violation`,
 * `decimal_imprecision` (float mediation in a money path),
 * `tenant_missing` (L12).
 */

/** Machine-readable failure codes for trading-strategy operations. */
export type StrategyErrorCode =
  // --- generic envelope validation ------------------------------------------
  /** The root value is not an object/array where one is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** A branded id is not a non-empty string. */
  | 'invalid_id'
  /** A value is not a valid epoch-millisecond timestamp. */
  | 'invalid_timestamp'
  /** A value is not a JSON-safe opaque payload. */
  | 'invalid_payload'
  /** Serialized text is not parseable JSON. */
  | 'invalid_json'
  /** A decimal string is malformed or outside the mirrored grammars. */
  | 'invalid_decimal'
  /** A float was offered where an exact decimal string is required (no float mediation). */
  | 'decimal_imprecision'
  // --- the L8 trip wire (the existential law of this lane) --------------------
  /** A strategy record embeds execution authority (venue permission, credential ref, authority verb). */
  | 'authority_in_strategy'
  // --- constraint primacy ------------------------------------------------------
  /** A candidate intent was computed under an unsatisfied blocking constraint (the refusal record's code). */
  | 'constraint_refused'
  /** A refusal record is malformed. */
  | 'invalid_refusal'
  // --- lineage (L9) -------------------------------------------------------------
  /** A lineage field is absent or malformed. */
  | 'lineage_gap'
  /** A lineage binding is incoherent with its record. */
  | 'invalid_lineage'
  // --- tenant isolation (L12) -----------------------------------------------------
  /** A record carries no tenant/project scope. */
  | 'tenant_missing'
  // --- universe discipline ---------------------------------------------------------
  /** The spec universe or a position/intent references an instrument outside the declared universe. */
  | 'universe_violation'
  // --- observation discipline -------------------------------------------------------
  /** The observation window lacks a mark for a universe instrument (fail-closed, no best-effort pricing). */
  | 'observation_gap'
  // --- strategy spec / run ------------------------------------------------------------
  /** A strategy spec is malformed. */
  | 'invalid_spec'
  /** A compiled strategy run is malformed. */
  | 'invalid_run'
  /** A strategy intent record is malformed. */
  | 'invalid_intent'
  /** A portfolio state or transition is malformed. */
  | 'invalid_state'
  /** A transition would leave the unsigned decimal domain (negative cash, would-open-short). */
  | 'negative_result'
  // --- backtest trail (L11) ---------------------------------------------------------------
  /** Appending a duplicate candidate id or rewriting a recorded disposition (the append-only law). */
  | 'backtest_rewrite'
  /** A backtest record or candidate is malformed. */
  | 'invalid_backtest'
  /** The transition chain does not match the recorded transitions (tamper detection). */
  | 'chain_mismatch'
  /** Serialized text is not the canonical serialization of the record. */
  | 'invalid_serialization';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface StrategyError {
  readonly code: StrategyErrorCode;
  /** Dotted path from the validated root, e.g. `spec.universe[0].instrumentId`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type StrategyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly StrategyError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: StrategyErrorCode, message: string, path = ''): StrategyResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly StrategyError[]): StrategyResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): StrategyResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): StrategyError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): StrategyError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): StrategyError {
  return { code: 'invalid_type', path: '', message };
}
