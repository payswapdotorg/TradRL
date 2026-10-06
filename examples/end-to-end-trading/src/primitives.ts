// @tradrl/example-e2e-trading — shared structural primitives.
//
// THE MIRROR LAW (D-003/D-004): this package imports NO sibling workspace
// package. Everything it consumes from the merged surfaces is re-declared
// here as a STRUCTURAL MIRROR — field-for-field with the real exported
// types — and tests/end-to-end-trading/interop.test.ts is the drift
// trip-wire that fails loudly when a real package and its mirror diverge.
//
// This module mirrors the program-wide determinism vocabulary: the canonical
// JSON serializer, the two digest widths in use across the program (the
// 8-hex single-lane FNV-1a used by chain heads/config hashes, and the
// 16-hex two-lane FNV-1a used by the bodies-lane record identities), the
// branded timestamp, the JSON model, deep-freeze and the seeded random
// generator. The algorithms are byte-identical to the real packages' — the
// interop test pins this by digesting shared fixtures through both.

/** Nominal branding for mirror types (zero runtime cost). */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Epoch milliseconds (the program-wide instant type — injected, never read from a clock). */
export type TimestampMs = Brand<number, 'TradRL.TimestampMs'>;

/** The JSON value model (mirrors every package's `JsonValue`). */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

/** The JSON object model (mirrors every package's `JsonObject`). */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** Structural guard: a plain JSON record. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Structural guard: a non-empty string. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Structural guard: a finite number. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Structural guard: an integer >= 1. */
export function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

/** Structural guard: an integer >= 0. */
export function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** Structural guard: a number in the closed unit interval [0, 1]. */
export function isUnitInterval(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

/** Structural guard: an array whose every member satisfies `guard`. */
export function isArrayOf<T>(v: unknown, guard: (item: unknown) => item is T): v is readonly T[] {
  return Array.isArray(v) && v.every((item) => guard(item));
}

/** Structural guard: a value is a member of a closed vocabulary. */
export function isMemberOf<T extends string>(
  vocabulary: readonly T[],
  v: unknown,
): v is T {
  return typeof v === 'string' && (vocabulary as readonly string[]).includes(v);
}

/** Timestamp bounds (mirror of the program-wide safe-integer epoch range). */
export const MIN_TIMESTAMP_MS = 0;
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999;

/** Structural guard: an injectable epoch-milliseconds instant. */
export function isTimestampMs(v: unknown): v is TimestampMs {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= MIN_TIMESTAMP_MS &&
    v <= MAX_TIMESTAMP_MS
  );
}

/** ISO-8601 rendering of an injected instant (display only — never parsed back). */
export function isoFromEpochMs(value: TimestampMs): string {
  return new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// Canonical JSON — byte-identical to the program-wide serializer
// ---------------------------------------------------------------------------

/**
 * Canonical JSON: object keys sorted lexicographically, strings via
 * `JSON.stringify`, finite numbers via `String(n)`, no insignificant
 * whitespace. The single serialization form for every digest, chain head
 * and determinism check in the program.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value); // finite by the JSON model
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  }
  const object = value as JsonObject;
  const keys = Object.keys(object).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

// ---------------------------------------------------------------------------
// Digests — the two program-wide widths
// ---------------------------------------------------------------------------

const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

function fnv1aRound(hash: number, unit: number): number {
  hash ^= unit;
  hash = Math.imul(hash, FNV_PRIME_32);
  return hash >>> 0;
}

/** FNV-1a 32-bit of a string, as zero-padded lowercase hex (the 8-hex width). */
export function fnv1a32Hex(text: string): string {
  let hash = FNV_OFFSET_32;
  for (let index = 0; index < text.length; index++) {
    hash = fnv1aRound(hash, text.charCodeAt(index));
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The two-lane 16-hex digest used by the bodies lane for record identities
 * (e.g. `dd-`, `esc-`, `rr-`, `sr-`). Byte-identical to the bodies'
 * `stableDigest`: even/odd code-point lanes, both folded with the length.
 */
export function stableDigest16(canonical: string): string {
  let even = FNV_OFFSET_32;
  let odd = FNV_OFFSET_32 ^ 0x2f6e2e1; // second lane seed (arbitrary, fixed forever)
  const units = Array.from(canonical);
  for (let index = 0; index < units.length; index++) {
    const unit = units[index]!.codePointAt(0) as number;
    if (index % 2 === 0) even = fnv1aRound(even, unit);
    else odd = fnv1aRound(odd, unit);
  }
  // Fold the length into both lanes so prefix-extension collisions cannot survive.
  even = Math.imul(even ^ units.length, FNV_PRIME_32) >>> 0;
  odd = Math.imul(odd ^ units.length * 31, FNV_PRIME_32) >>> 0;
  const hex = (value: number): string => value.toString(16).padStart(8, '0');
  return `${hex(even)}${hex(odd)}`;
}

/** 16-hex digest of the canonical JSON of a value (the bodies' `stableDigestJson`). */
export function stableDigest16Json(value: JsonValue): string {
  return stableDigest16(canonicalJson(value));
}

/** 8-hex digest of the canonical JSON of a value (the core packages' `stableDigest`). */
export function stableDigest8Json(value: JsonValue): string {
  return fnv1a32Hex(canonicalJson(value));
}

/** Guard: an 8-hex digest. */
export function isDigest8(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}$/.test(v);
}

/** Guard: a 16-hex digest. */
export function isDigest16(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
}

// ---------------------------------------------------------------------------
// Freeze discipline
// ---------------------------------------------------------------------------

/** Iterative whole-tree `Object.freeze` (mirror of the program-wide `deepFreeze`). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Seeded randomness — no ambient Math.random anywhere in the slice
// ---------------------------------------------------------------------------

/**
 * Deterministic PRNG keyed by a seed string (mulberry32 keyed by the
 * 8-hex digest of the seed — the program-wide `createSeededRandom`).
 * The ONLY randomness source in the slice.
 */
export function createSeededRandom(seed: string): () => number {
  let state = parseInt(fnv1a32Hex(seed), 16) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
