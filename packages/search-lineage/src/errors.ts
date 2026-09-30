/**
 * @tradrl/search-lineage — typed errors and results (Work Order T031).
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors (the collect-all discipline of
 * @tradrl/experiments and @tradrl/evaluation), while append laws and chain
 * verification fail with a precise single cause. Both flow through the same
 * {@link SearchResult} shape: a failure carries a non-empty `errors` array.
 *
 * The error taxonomy below is the machine-checkable form of the search
 * integrity laws this package owns:
 * - L11 append-only history: `duplicate_trial` (a trial is one entry — no
 *   rewrites), `unknown_parent`/`self_parent` (the DAG edges are backward,
 *   known and acyclic), `holdout_parent` (holdout evidence may never become
 *   optimization input), `non_monotonic_instant` (the log is ordered).
 * - L9 chain-verified lineage: `chain_mismatch` (any tamper with an entry,
 *   an ordering or the recorded head), `snapshot_mismatch` (a config
 *   snapshot whose stored content does not address to its id).
 * - L11 platform hidden-trials law: `hidden_trials` (a claimed view of the
 *   search misses logged trials), `unknown_trial` (a claimed view names
 *   trials the record never contained).
 * - L12 tenant isolation: `tenant_mismatch` (a cross-tenant append or view).
 */

/** Machine-readable failure codes for search-lineage operations. */
export type SearchErrorCode =
  /** The root value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** An instant is outside the representable range or not an integer epoch-ms number. */
  | 'invalid_timestamp'
  /** The binding block (experiment/evaluator/tenant/project) is malformed. */
  | 'invalid_binding'
  /** A config snapshot's stored content does not address to its snapshot id. */
  | 'snapshot_mismatch'
  /** A trial entry fails the structural law of search trials. */
  | 'invalid_trial'
  /** A trial id is appended a second time — search trials are single entries. */
  | 'duplicate_trial'
  /** A parent link names a trial that is not (yet) in the record. */
  | 'unknown_parent'
  /** A trial names itself as a parent. */
  | 'self_parent'
  /** A holdout-classified trial is used as an optimization parent (holdout evidence may never become training material). */
  | 'holdout_parent'
  /** The appended instant precedes the previous entry's instant — the log is ordered. */
  | 'non_monotonic_instant'
  /** A cross-tenant or cross-project append or projection (L12). */
  | 'tenant_mismatch'
  /** The chain of a record does not verify — history was tampered with (L9/L11). */
  | 'chain_mismatch'
  /** A claimed view of the search misses trials the record contains (platform hidden-trials law, L11). */
  | 'hidden_trials'
  /** A claimed view names a trial the record does not contain. */
  | 'unknown_trial'
  /** A duplicate snapshot was declared under different content. */
  | 'duplicate_snapshot';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface SearchError {
  readonly code: SearchErrorCode;
  /** Dotted path from the validated root, e.g. `entries[2].parents`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type SearchResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly SearchError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: SearchErrorCode, message: string, path = ''): SearchResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly SearchError[]): SearchResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): SearchResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): SearchError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): SearchError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): SearchError {
  return { code: 'invalid_type', path: '', message };
}
