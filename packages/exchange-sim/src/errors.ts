/**
 * @tradrl/exchange-sim — typed errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors (the collect-all discipline of
 * `@tradrl/market-protocol`, `@tradrl/environment-protocol` and
 * `@tradrl/market-world`), while state transitions fail with a precise
 * single cause. Both flow through the same {@link ExchangeResult} shape: a
 * failure carries a non-empty `errors` array.
 *
 * Error-shape note (deliberate, documented): `ExchangeError` is
 * FIELD-SHAPE-identical to the sibling contract packages' errors
 * (`code`/`path`/`message`), but the code union is exchange-specific — the
 * execution-fidelity domain has failure modes (tick/lot violations, crossed
 * book seeds, unsupported order kinds) that the episode and replay
 * protocols rightly do not name. Consumers switch on `result.ok`
 * identically.
 *
 * DISTINCTION (L8): an operation FAILURE (this module) means the exchange
 * could not even process the request as a well-formed event (malformed
 * envelope, unknown order, clock regression). An order REJECT
 * (records.ts `OrderReject`) is a SUCCESSFUL exchange outcome — the venue
 * accepted the request, evaluated it against its rules, and rejected THE
 * ORDER with a typed reason that rides the output stream. The exchange
 * simulator is AUTHORITY-FREE: it never evaluates risk, permission or
 * kill-switch concepts (those live in the T019/T020/T034 lane) — its
 * rejects are purely mechanical venue rules (tick, lot, depth, duplicate
 * id, unsupported kind/TIF).
 */

/** Machine-readable failure codes for exchange-sim operations. */
export type ExchangeErrorCode =
  // --- generic envelope validation -----------------------------------------
  /** The root value is not an object where one is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract (empty string, bad decimal, non-safe-integer, ...). */
  | 'invalid_field'
  /** A value is not a valid epoch-millisecond timestamp. */
  | 'invalid_timestamp'
  // --- configuration ----------------------------------------------------------
  /** The exchange config is malformed (collect-all detail in `errors`). */
  | 'invalid_config'
  /** The book seed is malformed, crossed, or violates venue grid rules. */
  | 'invalid_book_seed'
  /**
   * The requested fidelity mode is not implementable by an exchange
   * simulator ('exact_replay' orders are recorded as intents, never
   * matched — L5, see the market-world lane).
   */
  | 'unsupported_fidelity'
  /** Two fidelity declarations disagree (spec vs config). */
  | 'fidelity_mismatch'
  /** The market-impact policy names a kind this engine does not implement (T027 territory). */
  | 'unsupported_impact_policy'
  // --- order intake -----------------------------------------------------------
  /** An order intent envelope is malformed (collect-all detail in `errors`). */
  | 'invalid_intent'
  /** The order reference for a cancel is malformed. */
  | 'invalid_order_reference'
  // --- engine state laws -------------------------------------------------------
  /** A submit/cancel claims arrival before the engine's current instant (arrival is monotonic with the clock). */
  | 'arrival_before_now'
  /** The engine clock was moved backwards (time within a run is monotonic). */
  | 'clock_regression'
  /** The referenced order id is not known to the engine. */
  | 'unknown_order'
  /** The referenced order is terminal and can no longer be canceled. */
  | 'order_not_cancelable'
  /** The engine state passed to a transition is malformed (collect-all detail). */
  | 'invalid_state';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface ExchangeError {
  readonly code: ExchangeErrorCode;
  /** Dotted path from the validated root, e.g. `config.fees.tiers[1].maker_bps`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type ExchangeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ExchangeError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: ExchangeErrorCode, message: string, path = ''): ExchangeResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly ExchangeError[]): ExchangeResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): ExchangeResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): ExchangeError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): ExchangeError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): ExchangeError {
  return { code: 'invalid_type', path: '', message };
}
