/**
 * @tradrl/adapter-arena — identifiers and shared field guards.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/fields.ts (law D-004:
 * structural mirrors, never imports — the frozen workspace lockfile
 * forbids package dependencies). Hand-rolled, `any`-free guards shared
 * by the declaration validators.
 */

/** An opaque provider identifier (the adapter host or its upstream never interprets it). */
export type ProviderId = string;

/** An opaque channel identifier in the source's own vocabulary. */
export type ChannelId = string;

/** An opaque mapping-table identifier. */
export type MappingTableId = string;

/** An opaque entitlement identifier. */
export type EntitlementId = string;

import type { SdkFieldError } from './errors';

/** `true` when `value` is a plain object (not an array, not a class instance). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** `true` when `value` is a non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** `true` when `value` is a non-negative safe integer. */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** `true` when `value` is a positive safe integer. */
export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** `true` when `value` is a finite number (never NaN/Infinity). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** `true` when `value` is a non-empty array of unique non-empty strings. */
export function isUniqueNonEmptyStringArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) return false;
    if (seen.has(entry)) return false;
    seen.add(entry);
  }
  return true;
}

/** Helper: a missing required field. */
export function missingField(path: string): SdkFieldError {
  return { code: 'missing_field', path, message: `"${path}" is required` };
}

/** Helper: a present-but-invalid field. */
export function invalidField(path: string, detail: string): SdkFieldError {
  return { code: 'invalid_field', path, message: detail };
}

/** Helper: a wrong-shaped root value. */
export function invalidType(path: string, detail: string): SdkFieldError {
  return { code: 'invalid_type', path, message: detail };
}
