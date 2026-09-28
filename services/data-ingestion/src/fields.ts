/**
 * @tradrl/data-ingestion — identifiers, shared field guards and the
 * ingestion-plane error taxonomy.
 *
 * STRUCTURAL MIRRORS of @tradrl/market-protocol's `fields.ts` discipline
 * and of `@tradrl/event-store`'s store-level error codes (law D-003/D-004:
 * this service never imports the contract packages or the sibling
 * service; it re-declares structurally identical shapes, and the
 * trip-wire tests in `packages/provenance/src/interop.test.ts` fail if
 * they drift).
 *
 * Identifiers are deliberately PLAIN (unbranded) non-empty strings so
 * canonical events remain mutually structurally assignable across the
 * whole data plane.
 */

/** Machine-readable failure codes for ingestion-plane validation. */
export type IngestionErrorCode =
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
  /** A per-stream sequence duplicate/regression found by the batch pre-check. */
  | 'sequence_violation';

/** A single typed validation failure, located by a dotted field path. */
export interface ValidationFailure {
  readonly code: IngestionErrorCode;
  /** Dotted path from the event root, e.g. `payload.kind`. Empty for whole-object errors. */
  readonly path: string;
  readonly message: string;
}

/** Opaque identifiers (plain non-empty strings — the mirror discipline). */
export type EventId = string;
export type VenueId = string;
export type InstrumentId = string;
export type ProviderId = string;
export type LineageId = string;
export type BatchId = string;
export type AdapterId = string;
export type AdapterVersion = string;

/** True iff the value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True iff the value is a non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** True iff the value is a non-negative safe integer (sequence numbers). */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** True iff the value is an array of non-empty strings (lineage lists). */
export function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((element) => isNonEmptyString(element));
}

/** A required field is absent. */
export function missingField(path: string): ValidationFailure {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid. */
export function invalidField(path: string, message: string): ValidationFailure {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object. */
export function invalidType(message: string): ValidationFailure {
  return { code: 'invalid_type', path: '', message };
}

/** A sequence pre-check failure (kind carried in the message). */
export function sequenceViolation(kind: 'duplicate_sequence' | 'regressed_sequence', key: string, message: string): ValidationFailure {
  return { code: 'sequence_violation', path: 'sequence', message: `${kind} on stream "${key}": ${message}` };
}
