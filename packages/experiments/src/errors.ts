/**
 * @tradrl/experiments — typed errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors (the collect-all discipline of
 * `@tradrl/market-protocol`, `@tradrl/environment-protocol` and
 * `@tradrl/trajectory`), while record transitions fail with a precise single
 * cause. Both flow through the same {@link ExpResult} shape: a failure
 * carries a non-empty `errors` array.
 */

/** Machine-readable failure codes for experiment operations. */
export type ExpErrorCode =
  /** The root value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** A timestamp is outside the representable range or not an integer epoch-ms number. */
  | 'invalid_timestamp'
  /** The experiment design is malformed (arms, intervention, lineage refs). */
  | 'invalid_design'
  /** A trial record is malformed or violates its status invariants. */
  | 'invalid_trial'
  /** An experiment record is malformed. */
  | 'invalid_experiment'
  /** A trial id is already present in the log (new trials only — progressions append under strict rules). */
  | 'duplicate_trial_id'
  /** The appended trial does not strictly progress the existing trial's lifecycle (L11: history never rewinds). */
  | 'trial_regression'
  /** Two trials reference the same trajectory (an experience stream is one trial's evidence). */
  | 'duplicate_trajectory'
  /** The appended trial names an arm that is not in the design. */
  | 'unknown_arm'
  /** The experiment is finalized; the trial log is frozen. */
  | 'experiment_finalized'
  /** The experiment is already finalized; finalization is once-only. */
  | 'already_finalized'
  /** Finalization requires at least one appended trial. */
  | 'no_trials'
  /** The finalization input is malformed. */
  | 'invalid_finalization';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface ExpError {
  readonly code: ExpErrorCode;
  /** Dotted path from the validated root, e.g. `design.comparison`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type ExpResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ExpError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: ExpErrorCode, message: string, path = ''): ExpResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly ExpError[]): ExpResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): ExpResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): ExpError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): ExpError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): ExpError {
  return { code: 'invalid_type', path: '', message };
}
