/**
 * @tradrl/evaluation-integrity — typed errors and results (Work Order T031).
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors, while construction and audit
 * laws fail with a precise single cause. Both flow through the same
 * {@link IntegrityResult} shape.
 *
 * The error taxonomy below is the machine-checkable form of the integrity
 * laws this service owns:
 * - R21 split construction: `window_exhaustion` (walk-forward over an axis
 *   too short for one window), `degenerate_mask` (holdout masks that blind
 *   everything or nothing), `embargo_overlap` (the axis cannot support the
 *   declared embargo — train/test adjacency would leak).
 * - R20 unseen quarantine: `quarantine_violation` (in-search trials
 *   consuming quarantined material), `quarantine_registered_late` (a
 *   quarantine declared AFTER the optimization it claims to guard).
 * - Leakage detection: `leakage_without_embargo` (an evaluation whose data
 *   window overlaps the trial's optimization window without the declared
 *   embargo), `synthetic_holdout` (holdout evidence claimed over synthetic
 *   origin — T028's exploration instruments are not unseen historical
 *   truth), `unknown_trial` (an evaluation naming a trial the search never
 *   logged).
 * - Selection audit: `hidden_trials` (the platform mirror of T012's law —
 *   statistics that do not cover every logged trial),
 *   `unknown_statistic`, `selection_not_in_search`, `selected_without_holdout`
 *   (a best-of-N report without the holdout number that judges it),
 *   `scale_mismatch` (statistics outside the audit's exact-decimal scale),
 *   `selection_mismatch` (the T012 experiment-lane report names a different
 *   selection than the platform audit judges).
 * - L9 chain law: `chain_mismatch` (the search record the audit reads does
 *   not verify).
 */

/** Machine-readable failure codes for evaluation-integrity operations. */
export type IntegrityErrorCode =
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
  /** A split definition is malformed. */
  | 'invalid_split'
  /** A walk-forward/purged design admits no complete window over the axis. */
  | 'window_exhaustion'
  /** A holdout mask would blind everything or nothing. */
  | 'degenerate_mask'
  /** The declared purge/embargo cannot be satisfied over the axis. */
  | 'embargo_overlap'
  /** The axis's own boundary law fails (segments overlap the embargoed frontier). */
  | 'axis_leakage'
  /** A registry entry is malformed. */
  | 'invalid_registry'
  /** A split policy ref is registered twice — a policy maps to one construction. */
  | 'duplicate_split'
  /** An embargo resolution names a policy the registry does not contain. */
  | 'unknown_split_policy'
  /** An evaluation claim's classification disagrees with the search record's. */
  | 'classification_mismatch'
  /** A cross-tenant or cross-project operation (L12). */
  | 'tenant_mismatch'
  /** An in-search trial consumed quarantined (never-optimized-on) material. */
  | 'quarantine_violation'
  /** A quarantine was registered after the optimization instant it claims to guard. */
  | 'quarantine_registered_late'
  /** An evaluation's data window overlaps the trial's optimization window without the declared embargo. */
  | 'leakage_without_embargo'
  /** Holdout evidence was claimed over synthetic-origin data (L5: exploration instruments are not unseen historical truth). */
  | 'synthetic_holdout'
  /** An evaluation or claim names a trial the search record does not contain. */
  | 'unknown_trial'
  /** A statistic names a trial the search record does not contain. */
  | 'unknown_statistic'
  /** The statistics do not cover every logged trial — trials were hidden (L11, platform mirror of T012's hidden_trials). */
  | 'hidden_trials'
  /** The selection names a trial that is not an in-search candidate of the record. */
  | 'selection_not_in_search'
  /** The selected trial carries no holdout evaluation — a best-of-N report without the holdout number that judges it will not be compiled. */
  | 'selected_without_holdout'
  /** A statistic is not an exact decimal at the audit's declared scale. */
  | 'scale_mismatch'
  /** The T012 experiment-lane integrity report names a different selection than the audit judges. */
  | 'selection_mismatch'
  /** The search record the audit reads does not verify against its own chain (L9/L11). */
  | 'chain_mismatch'
  /** A decimal string is malformed. */
  | 'invalid_decimal';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface IntegrityError {
  readonly code: IntegrityErrorCode;
  /** Dotted path from the validated root, e.g. `windows[2].test`. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type IntegrityResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly IntegrityError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: IntegrityErrorCode, message: string, path = ''): IntegrityResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly IntegrityError[]): IntegrityResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): IntegrityResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): IntegrityError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): IntegrityError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): IntegrityError {
  return { code: 'invalid_type', path: '', message };
}
