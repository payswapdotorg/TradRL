/**
 * @tradrl/provenance — identifiers and shared field guards.
 *
 * IDENTIFIER DISCIPLINE (mirrors @tradrl/market-protocol/src/fields.ts, the
 * lane this package structurally extends — law D-004): identifiers are
 * deliberately PLAIN (unbranded) non-empty strings, so store-level records
 * remain mutually structurally assignable with market-protocol records and
 * every adapter can interoperate. `TimestampMs` is the one branded type (the
 * brand is the cross-package compatibility key — see timestamp.ts); id
 * semantics are carried by these alias names only.
 *
 * All guards are hand-rolled total type guards: no `any`, no schema library.
 */

import type { ProvenanceError } from './errors';

/** Opaque identifier of a stored market event (unique within an event store). */
export type EventId = string;
/** Opaque identifier of a store commit. */
export type CommitId = string;
/** Opaque identifier of an ingestion batch. */
export type BatchId = string;
/** Opaque identifier of a correction record. */
export type CorrectionId = string;
/** Opaque identifier of an adapter (producer of external observations). */
export type AdapterId = string;
/** Opaque version string of an adapter. */
export type AdapterVersion = string;
/** Opaque identifier of a parent event/artifact (lineage). */
export type LineageId = string;
/** Stable identifier of a transform that produced a derivation. */
export type TransformId = string;
/** Free-form reason a correction was issued. */
export type CorrectionReason = string;

/** True iff the value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True iff the value is a non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** True iff the value is a non-negative safe integer (commit sequences). */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** True iff the value is an array of non-empty strings (lineage lists). */
export function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((element) => isNonEmptyString(element));
}

// ---------------------------------------------------------------------------
// Field-level error constructors shared by the record validators.
// ---------------------------------------------------------------------------

/** A required field is absent. */
export function missingField(path: string): ProvenanceError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid. */
export function invalidField(path: string, message: string): ProvenanceError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}
