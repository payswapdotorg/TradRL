/**
 * @tradrl/verification — typed errors and results.
 *
 * The verification package never throws on untrusted input and never SCORES
 * anything: verification verdicts are boolean + reasons (machine-checkable
 * codes), so the error taxonomy carries only structural/transition causes,
 * while every check failure flows into the report as a typed reason code
 * (see evidence.ts). Mirrors the collect-all discipline of the sibling
 * contract packages.
 */

/** Machine-readable failure codes for verification operations. */
export type VerificationErrorCode =
  /** The root value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** A timestamp is outside the representable range or not an integer epoch-ms number. */
  | 'invalid_timestamp'
  /** A verification case is malformed. */
  | 'invalid_case'
  /** Two cases share one case id. */
  | 'duplicate_case'
  /** A release-gate input record is malformed. */
  | 'invalid_gate_input'
  /** The release gate refuses: no adversarial suite member (L10). */
  | 'missing_adversarial_member'
  /** The verdict/suite lineage of the gate inputs does not agree. */
  | 'suite_mismatch';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface VerificationError {
  readonly code: VerificationErrorCode;
  /** Dotted path from the validated root, e.g. `cases[3].quartets[0]`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type VerificationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly VerificationError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: VerificationErrorCode, message: string, path = ''): VerificationResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly VerificationError[]): VerificationResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): VerificationResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): VerificationError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): VerificationError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): VerificationError {
  return { code: 'invalid_type', path: '', message };
}
