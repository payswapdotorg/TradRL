/**
 * @tradrl/provenance — typed validation errors and results.
 *
 * Contract packages never throw on untrusted input: record validation
 * collects ALL violations and reports them as typed errors (the collect-all
 * discipline of @tradrl/market-protocol), while query-style operations that
 * can fail on a single cause return an explicit {@link ProvenanceResult}
 * (the discipline of @tradrl/time-engine). Throwing is reserved for
 * programming errors internal to a caller.
 *
 * The `provenance_*` codes mirror the semantics of the identically-named
 * codes in @tradrl/market-protocol/src/errors.ts (law D-004: this package
 * extends that discipline for the STORE layer — structural mirrors only,
 * never imports).
 */

/** Machine-readable failure codes for store-level provenance validation. */
export type ProvenanceErrorCode =
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but its value violates the contract. */
  | 'invalid_field'
  /** A historical record lacks the adapter reference that provenance requires. */
  | 'provenance_adapter_required'
  /** A derived record (non-empty lineage) lacks a transform description. */
  | 'provenance_transform_required'
  /** A transform is present without lineage — meaningless derivation. */
  | 'provenance_transform_without_parents'
  /** A record lists itself in its own lineage. */
  | 'provenance_self_reference'
  /** The same parent id appears twice in one record's lineage. */
  | 'provenance_duplicate_parent'
  /** Walking parent edges returns to a node already on the walk stack. */
  | 'chain_cycle'
  /** A chain query named a node id that is not in the chain. */
  | 'chain_unknown_node';

/** A single typed validation failure, located by a dotted field path. */
export interface ProvenanceError {
  readonly code: ProvenanceErrorCode;
  /** Dotted path from the record root, e.g. `custody.commit`. Empty for whole-object errors. */
  readonly path: string;
  readonly message: string;
}

/** Validation outcome: either a validated value or every violation found. */
export type ProvenanceValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ProvenanceError[] };

/** Query-style outcome: either a value or a single typed failure. */
export type ProvenanceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ProvenanceError };

/** Construct a query-style failure. */
export function fail<T = never>(code: ProvenanceErrorCode, message: string): ProvenanceResult<T> {
  return { ok: false, error: { code, path: '', message } };
}

/** Construct a query-style success. */
export function ok<T>(value: T): ProvenanceResult<T> {
  return { ok: true, value };
}
