/**
 * @tradrl/adapter-brokers — shared field guards and opaque identifiers.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/fields.ts (law D-004:
 * structural mirrors, never imports). Identifiers are PLAIN non-empty
 * strings: the canonical contracts are deliberately opaque here — the
 * broker vocabulary (raw field names such as "ClOrdID" or "ExecID") crosses
 * this boundary only inside the provider layer's
 * declarations (schemas, mapping tables, descriptors), never in these
 * neutral guards (L2/L13).
 *
 * Zero runtime dependencies; hand-rolled total guards only.
 */

import type { SdkFieldError } from './errors';

/** Opaque data provider identifier (declared by the source descriptor). */
export type ProviderId = string;
/** Opaque venue identifier carried on canonical events. */
export type VenueId = string;
/** Opaque instrument identifier (venue-canonical). */
export type InstrumentId = string;
/** Opaque canonical event identifier. */
export type EventId = string;
/** Opaque parent id in a lineage chain. */
export type LineageId = string;
/** Opaque adapter identifier (this concrete adapter, declared by T039). */
export type AdapterId = string;
/** Opaque adapter version string. */
export type AdapterVersion = string;
/** Opaque entitlement declaration identifier. */
export type EntitlementId = string;
/** Opaque mapping table identifier. */
export type MappingTableId = string;
/** Opaque raw channel name (the transport's own channel vocabulary). */
export type ChannelId = string;
/** Opaque symbol universe identifier. */
export type UniverseId = string;

/** True iff the value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True iff the value is a non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** True iff the value is a non-negative safe integer (sequences, counts). */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** True iff the value is a strictly positive safe integer (limits, windows). */
export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** True iff the value is a finite number (JSON numeric values). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A required field is absent. */
export function missingField(path: string): SdkFieldError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but violates the contract. */
export function invalidField(path: string, message: string): SdkFieldError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object where an object is required. */
export function invalidType(message: string): SdkFieldError {
  return { code: 'invalid_type', path: '', message };
}

/** Guard helper: an array's string elements are non-empty and unique. */
export function isUniqueNonEmptyStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const element of value) {
    if (!isNonEmptyString(element)) return false;
    if (seen.has(element)) return false;
    seen.add(element);
  }
  return true;
}
