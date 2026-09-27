/**
 * @tradrl/market-protocol — typed validation errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors, so ingestion (T008) and the
 * adapter SDK (T036) can give precise diagnostics.
 */

/** Machine-readable failure codes for market-event validation. */
export type MarketProtocolErrorCode =
  /** The value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but its value violates the contract (empty string, bad pattern, non-safe-integer, ...). */
  | 'invalid_field'
  /** `event_type` is not part of the canonical taxonomy. */
  | 'unknown_event_type'
  /** `available_time` precedes `event_time` — information may not be observable before it happened. */
  | 'timestamp_order'
  /** A historical event lacks the adapter reference that provenance requires. */
  | 'provenance_adapter_required'
  /** A derived event (non-empty lineage) lacks a transform description. */
  | 'provenance_transform_required'
  /** A transform is present without lineage — meaningless derivation. */
  | 'provenance_transform_without_parents'
  /** An event lists itself in its own lineage. */
  | 'provenance_self_reference'
  /** The same parent id appears twice in a lineage chain. */
  | 'provenance_duplicate_parent';

/** A single typed validation failure, located by a dotted field path. */
export interface MarketProtocolError {
  readonly code: MarketProtocolErrorCode;
  /** Dotted path from the event root, e.g. `payload.price`. Empty for whole-object errors. */
  readonly path: string;
  readonly message: string;
}

/** Validation outcome: either a validated value or every violation found. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly MarketProtocolError[] };
