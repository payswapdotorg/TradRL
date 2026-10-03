/**
 * @tradrl/evaluation-splits — typed errors and results (Work Order T032).
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors, while construction laws fail
 * with a precise single cause. Both flow through the same
 * {@link SplitDriverResult} shape.
 *
 * The error taxonomy below is the machine-checkable form of the split
 * DRIVER's laws (the Work Order's own charter):
 * - `window_exhaustion` — a walk-forward ladder over material too short for
 *   one complete window (the family law shared with T012/T031).
 * - `embargo_violation` — the Work Order's embargo law: a purge gap that
 *   starves a window's train set to empty, or a holdout reservation that
 *   cannot sit embargo-separated from the search material.
 * - `holdout_leakage` — the Work Order's holdout law: a reserved (unseen)
 *   segment appearing inside any search window's train or test material.
 * - `degenerate_reservation` — a holdout reservation that would reserve
 *   everything or nothing.
 * - `empty_regime_partition` — a regime filter that selects no segment.
 * - `plan_mismatch` — a plan whose recorded content address disagrees with
 *   its content (L9: content and address cannot disagree).
 * - `chain_mismatch` — the plan ledger's recomputed chain head disagrees
 *   with the recorded head (L11: appended history cannot be mutated,
 *   reordered or hidden).
 */

/** Machine-readable failure codes for evaluation-splits operations. */
export type SplitDriverErrorCode =
  /** The root value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** An instant is outside the representable range or not an integer epoch-ms number. */
  | 'invalid_timestamp'
  /** A dataset axis is malformed (ordering, overlap, empty). */
  | 'invalid_axis'
  /** A split driver policy is malformed or incoherent. */
  | 'invalid_policy'
  /** A decimal string is malformed. */
  | 'invalid_decimal'
  /** A walk-forward ladder admits no complete window over the material. */
  | 'window_exhaustion'
  /** The declared purge gap/embargo cannot be satisfied: a starved train set or an unseparated holdout. */
  | 'embargo_violation'
  /** A reserved (unseen) holdout segment appears inside search window material. */
  | 'holdout_leakage'
  /** A holdout reservation would reserve everything or nothing. */
  | 'degenerate_reservation'
  /** A regime filter selects no segment. */
  | 'empty_regime_partition'
  /** A ledger entry or binding is malformed. */
  | 'invalid_ledger'
  /** A plan id is already appended — the ledger is append-only. */
  | 'duplicate_plan'
  /** A plan's recorded content address disagrees with its content (L9). */
  | 'plan_mismatch'
  /** The ledger's recomputed chain head disagrees with the recorded head (L11). */
  | 'chain_mismatch'
  /** A cross-tenant or cross-project operation (L12). */
  | 'tenant_mismatch';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface SplitDriverError {
  readonly code: SplitDriverErrorCode;
  /** Dotted path from the validated root, e.g. `windows[2].test`. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type SplitDriverResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly SplitDriverError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: SplitDriverErrorCode, message: string, path = ''): SplitDriverResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly SplitDriverError[]): SplitDriverResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): SplitDriverResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): SplitDriverError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): SplitDriverError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): SplitDriverError {
  return { code: 'invalid_type', path: '', message };
}
