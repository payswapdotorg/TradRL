/**
 * @tradrl/event-store — identifiers, shared field guards and errors.
 *
 * STRUCTURAL MIRRORS of @tradrl/market-protocol's `fields.ts` and
 * `errors.ts` disciplines (law D-003/D-004: this service never imports the
 * contract packages; it re-declares structurally identical types and
 * guards, and the trip-wire tests in
 * `packages/provenance/src/interop.test.ts` fail if they drift).
 *
 * Identifiers are deliberately PLAIN (unbranded) non-empty strings so
 * stored events remain mutually structurally assignable with
 * market-protocol's `MarketEvent` — the store accepts canonical events
 * as-is (verified by a compile-time trip wire).
 */

/** Machine-readable failure codes for store-level validation. */
export type StoreErrorCode =
  /** The value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but its value violates the contract. */
  | 'invalid_field'
  /** `event_type` is not part of the canonical taxonomy. */
  | 'unknown_event_type'
  /** `asset_class` is not canonical. */
  | 'unknown_asset_class'
  /** `available_time` precedes `event_time` (the one enforced quartet order — mirror of T004's D-003 ratification). */
  | 'timestamp_order'
  /** A historical event lacks the adapter reference. */
  | 'provenance_adapter_required'
  /** A derived event lacks a transform description. */
  | 'provenance_transform_required'
  /** A transform is present without lineage. */
  | 'provenance_transform_without_parents'
  /** An event lists itself in its own lineage. */
  | 'provenance_self_reference'
  /** The same parent id appears twice in one lineage list. */
  | 'provenance_duplicate_parent'
  /** The `other` escape hatch lacks its required payload.kind. */
  | 'other_kind_required'
  /** A derived event is available before one of its parents. */
  | 'derived_before_inputs';

/** A single typed validation failure, located by a dotted field path. */
export interface StoreError {
  readonly code: StoreErrorCode;
  /** Dotted path from the event root, e.g. `payload.kind`. Empty for whole-object errors. */
  readonly path: string;
  readonly message: string;
}

/** Opaque event identifier (unique within the store). */
export type EventId = string;
/** Opaque venue identifier (e.g. 'BINANCE', 'SYNTH'). */
export type VenueId = string;
/** Opaque instrument identifier, venue-canonical (e.g. 'BTC-USDT'). */
export type InstrumentId = string;
/** Opaque data provider identifier (e.g. 'binance', 'synthetic'). */
export type ProviderId = string;
/** Opaque lineage/parent identifier. */
export type LineageId = string;
/** Opaque commit identifier. */
export type CommitId = string;
/** Opaque ingestion batch identifier. */
export type BatchId = string;
/** Opaque correction identifier. */
export type CorrectionId = string;

/** True iff the value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True iff the value is a non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** True iff the value is a non-negative safe integer (sequence numbers, commit ordinals). */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** A required field is absent. */
export function missingField(path: string): StoreError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid. */
export function invalidField(path: string, message: string): StoreError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object. */
export function invalidType(message: string): StoreError {
  return { code: 'invalid_type', path: '', message };
}
