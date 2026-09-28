/**
 * @tradrl/trajectory — typed errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors (the collect-all discipline of
 * `@tradrl/market-protocol`, `@tradrl/environment-protocol` and
 * `@tradrl/experiments`), while record transitions fail with a precise single
 * cause. Both flow through the same {@link TrajResult} shape: a failure
 * carries a non-empty `errors` array.
 */

/** Machine-readable failure codes for trajectory-domain operations. */
export type TrajErrorCode =
  /** The root value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** A branded id is not a non-empty string. */
  | 'invalid_id'
  /** A value is not a valid epoch-millisecond timestamp. */
  | 'invalid_timestamp'
  /** A clock sample violates the `now <= asOf` invariant. */
  | 'invalid_clock_sample'
  /** A trajectory step is structurally invalid (observations/action/result). */
  | 'invalid_step'
  /** A trajectory metadata block is structurally invalid. */
  | 'invalid_metadata'
  /** A lineage reference list is empty or contains duplicates. */
  | 'invalid_lineage'
  /** The trajectory record is structurally invalid or law-violating. */
  | 'invalid_trajectory'
  /** A step ordinal violates the strictly-sequential-from-1 law. */
  | 'step_out_of_order'
  /** A step id duplicates an id already present in the trajectory. */
  | 'duplicate_step'
  /** A causality id duplicates an id already present in the trajectory. */
  | 'duplicate_causality'
  /** An observation id duplicates an id already present in the trajectory. */
  | 'duplicate_observation'
  /** An action id duplicates an id already present in the trajectory. */
  | 'duplicate_action'
  /** A reward id duplicates an id already present in the trajectory. */
  | 'duplicate_reward'
  /** A step clock regresses below the previous step's now (episode time is monotonic). */
  | 'clock_regression'
  /** Serialized text is not parseable JSON. */
  | 'invalid_json'
  /** Serialized text is not the canonical serialization of the record. */
  | 'invalid_serialization'
  /** A value is not a JSON-safe opaque payload. */
  | 'invalid_payload';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface TrajError {
  readonly code: TrajErrorCode;
  /** Dotted path from the validated root, e.g. `steps[0].clock`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type TrajResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly TrajError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: TrajErrorCode, message: string, path = ''): TrajResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly TrajError[]): TrajResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): TrajResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): TrajError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): TrajError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): TrajError {
  return { code: 'invalid_type', path: '', message };
}
