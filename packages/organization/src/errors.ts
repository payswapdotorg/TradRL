/**
 * @tradrl/organization — typed errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors (the collect-all discipline
 * of @tradrl/evaluation), while search-integrity and lineage laws fail
 * with a precise single cause. Both flow through the same
 * {@link OrgResult} shape: a failure carries a non-empty `errors` array.
 *
 * The error taxonomy below is the machine-checkable form of the
 * organization laws:
 * - L16a: `label_as_evidence` — a profession/role label cited as
 *   suitability evidence ("Never equate model and profession").
 * - L8/L20 safety: `authority_in_blueprint` — a blueprint embedding
 *   execution authority or granting risk/authorization.
 * - Seven-axis completeness (spec/ARCHITECTURE.md, Organization compiler):
 *   `axis_missing`.
 * - L11: `candidate_rewrite` — rewriting or hiding a candidate in the
 *   append-only search log is a typed error, never a cleaner log.
 * - L9: `lineage_gap` / `registry_digest_mismatch` — every candidate
 *   carries its full lineage block, and the registry snapshot digest must
 *   bind.
 * - Determinism law: `unseeded_search` — there is no ambient randomness;
 *   a search without a seed cannot run.
 * - L12: `tenant_mismatch` — goal, constraint set and compile scope must
 *   share one tenant.
 */

/** Machine-readable failure codes for organization operations. */
export type OrgErrorCode =
  /** The root value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent (when it is not a named axis — see `axis_missing`). */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** L16a: a profession/role label was cited as suitability evidence. */
  | 'label_as_evidence'
  /** Safety (L8/L20): a blueprint embeds execution authority or grants risk/authorization. */
  | 'authority_in_blueprint'
  /** One of the seven blueprint axes is absent (spec/ARCHITECTURE.md Organization compiler). */
  | 'axis_missing'
  /** L11: rewriting or hiding a candidate in the append-only search log. */
  | 'candidate_rewrite'
  /** L9: a candidate's lineage block is incomplete or its parent is unresolvable. */
  | 'lineage_gap'
  /** L9: a registry snapshot digest does not bind its record set / lineage. */
  | 'registry_digest_mismatch'
  /** Determinism law: the search was invoked without a seed. */
  | 'unseeded_search'
  /** L12: goal, constraint set and compile scope do not share one tenant. */
  | 'tenant_mismatch'
  /** Two candidates in one log share an id or a sequence number. */
  | 'duplicate_candidate'
  /** The log's selection claim does not name exactly the one proposed candidate. */
  | 'selection_mismatch'
  /** The registry snapshot contains no subject to assign (empty search space). */
  | 'unknown_capability_record';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface OrgError {
  readonly code: OrgErrorCode;
  /** Dotted path from the validated root, e.g. `candidates[2].lineage.seed`. Empty for search-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type OrgResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly OrgError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: OrgErrorCode, message: string, path = ''): OrgResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly OrgError[]): OrgResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): OrgResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): OrgError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): OrgError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): OrgError {
  return { code: 'invalid_type', path: '', message };
}
