/**
 * @tradrl/evaluation — typed errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors (the collect-all discipline of
 * `@tradrl/market-protocol`, `@tradrl/experiments` and `@tradrl/trajectory`),
 * while state transitions and composition laws fail with a precise single
 * cause. Both flow through the same {@link EvalResult} shape: a failure
 * carries a non-empty `errors` array.
 *
 * The error taxonomy below is the machine-checkable form of the evaluation
 * laws:
 * - L7 verdicts fail closed: `invalid-criteria`, `invalid-config`,
 *   `invalid-verdict-input`, `criteria-mismatch` — never silently succeed.
 * - L10 release-grade composition refuses without adversarial coverage:
 *   `missing-adversarial-member`, `policy-coverage-missing` (the pinned
 *   protocol cannot be shopped).
 * - L11 search history is total: `hidden-trials` makes hiding log entries a
 *   typed error, `unknown-statistic` rejects fabricated ones.
 */

/** Machine-readable failure codes for evaluation operations. */
export type EvalErrorCode =
  /** The root value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** A timestamp is outside the representable range or not an integer epoch-ms number. */
  | 'invalid_timestamp'
  /** A metric definition is malformed. */
  | 'invalid_metric'
  /** Two metric definitions share one metric id. */
  | 'duplicate_metric'
  /** A metric result names a metric the registry does not know. */
  | 'unknown_metric'
  /** An evaluation suite is malformed. */
  | 'invalid_suite'
  /** Two suite members share one (kind, splitPolicy) pair. */
  | 'duplicate_member'
  /** A split policy is malformed. */
  | 'invalid_split_policy'
  /** A release-grade suite carries no adversarial suite reference (L10). */
  | 'missing_adversarial_member'
  /** The suite does not cover an evaluation policy ref pinned by the criteria (L10/L11 — evaluation cannot be shopped). */
  | 'policy_coverage_missing'
  /** A dataset axis is malformed (ordering, overlap, empty). */
  | 'invalid_axis'
  /** A walk-forward policy admits no complete window over the axis. */
  | 'window_exhaustion'
  /** A blind-holdout mask would blind everything or nothing. */
  | 'degenerate_mask'
  /** A regime partition selects no segment. */
  | 'empty_regime'
  /** An evaluation config is malformed. */
  | 'invalid_config'
  /** The acceptance criteria failed structural validation (L7 fail-closed). */
  | 'invalid_criteria'
  /** The criteria/config/suite lineage does not agree (wrong criteria id, wrong suite, wrong evaluator version). */
  | 'criteria_mismatch'
  /** A per-split constraint report is malformed. */
  | 'invalid_report'
  /** A report names a split policy the suite does not contain. */
  | 'unknown_split_report'
  /** A trial log entry failed structural validation. */
  | 'invalid_trial'
  /** The trial statistics do not cover the full log — trials were hidden (L11). */
  | 'hidden_trials'
  /** A statistic names a trial the log does not contain. */
  | 'unknown_statistic'
  /** No trial carried a statistic — the best-of-N effect is undefined. */
  | 'no_candidates'
  /** The selection claim names a trial the log does not contain. */
  | 'selection_not_in_log'
  /** The selected trial carries no statistic. */
  | 'selected_without_statistic';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface EvalError {
  readonly code: EvalErrorCode;
  /** Dotted path from the validated root, e.g. `members[2].metricIds`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type EvalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly EvalError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: EvalErrorCode, message: string, path = ''): EvalResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly EvalError[]): EvalResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): EvalResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): EvalError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): EvalError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): EvalError {
  return { code: 'invalid_type', path: '', message };
}
