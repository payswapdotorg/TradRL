/**
 * @tradrl/shadow_trading — the zero-dependency structural primitives
 * (the lane-local foundation every shadow module shares).
 *
 * Mirrors the sibling lanes' `primitives.ts` discipline (reactive
 * world, execution-policy): no runtime dependencies, hand-rolled total
 * guards, the deep-freeze discipline, canonical JSON (sorted keys,
 * minimal separators — the program-wide byte-identity grammar) and the
 * FNV-1a 32-bit digest. The EXACT-DECIMAL arithmetic itself is
 * consumed from the contract package (@tradrl/execution-policy's
 * decimals module — a permitted relative source import); this module
 * adds only the structural vocabulary.
 */

// ---------------------------------------------------------------------------
// JSON value model
// ---------------------------------------------------------------------------

/** A JSON value (the serialization grammar every record obeys). */
export type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

/** A JSON object. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** Guard: a plain object record (NOT an array, NOT null). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Guard: a non-empty string. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Guard: a finite number. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Guard: a non-negative safe integer. */
export function isNonNegativeSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** Guard: a positive safe integer. */
export function isPositiveSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
}

/** Guard: a member of a closed vocabulary. */
export function isMemberOf<T extends string>(vocabulary: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (vocabulary as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Timestamps (the time-engine brand, mirrored)
// ---------------------------------------------------------------------------

/**
 * Epoch milliseconds — the canonical program-wide `TradRL.TimestampMs`
 * brand (time-engine's tag, mirrored by every lane: the brand strings
 * match, so the mirrors are mutually assignable).
 */
export type TimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };

/** Cast a plain number to a timestamp (fixture/internal literal sites only). */
export function asTimestampMs(ms: number): TimestampMs {
  return ms as TimestampMs;
}

export const MIN_TIMESTAMP_MS = 0;
export const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

/** Guard: an epoch-ms timestamp. */
export function isTimestampMs(v: unknown): v is TimestampMs {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= MIN_TIMESTAMP_MS && v <= MAX_TIMESTAMP_MS;
}

// ---------------------------------------------------------------------------
// The deep-freeze discipline
// ---------------------------------------------------------------------------

/** Recursively freeze a value (the contract-package discipline: records are immutable evidence). */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** `true` iff a value is deeply frozen (the guard half of the discipline). */
export function isDeeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!isDeeplyFrozen((value as Record<string, unknown>)[key])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Canonical JSON + digests (byte-identity grammar)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON: keys sorted lexicographically, no whitespace, JSON
 * escaping — identical values always serialize to identical bytes (the
 * program-wide determinism grammar; mirrors every sibling lane's
 * `canonicalJson`).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** FNV-1a 32-bit of a string, as zero-padded lowercase hex (the program-wide derivation). */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Guard: an 8-hex-digit digest (the fnv1a32Hex form). */
export function isDigest(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}$/.test(v);
}
