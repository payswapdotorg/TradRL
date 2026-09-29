/**
 * @tradrl/market-world (reactive service) — structural primitives (work
 * order T027): the zero-dependency foundation of the reactive lane.
 *
 * MIRROR DISCIPLINE (D-003/D-004, the law this Work Order operates under):
 * this module re-declares the SHARED PRIMITIVES every sibling lane owns in
 * its own contract package (`deepFreeze`, the record/string/number guards,
 * the JSON value model, canonical serialization, the FNV-1a derivation) —
 * field-for-field, behavior-for-behavior — because the frozen write surface
 * (`services/market-world/src/reactive/**` only) forbids imports across
 * lanes. The interop trip-wire tests (src/interop.test.ts) prove the
 * mirrors against the REAL packages present on this branch
 * (@tradrl/exchange-sim, @tradrl/environment-protocol,
 * @tradrl/market-world, @tradrl/rl-protocol).
 *
 * DETERMINISM (L9): every function here is pure — no ambient clock, no
 * Math.random, no process data. The only randomness the reactive lane ever
 * sees is the SEEDED xorshift32 of the fixture generators.
 */

// ---------------------------------------------------------------------------
// Branding (compile-time-only tags — the sibling lanes' Brand)
// ---------------------------------------------------------------------------

/** A compile-time-only brand tag (runtime value is untouched). */
export type Brand<Base, Tag> = Base & { readonly __brand: Tag };

// ---------------------------------------------------------------------------
// Runtime type guards (hand-rolled, total — no `any` anywhere)
// ---------------------------------------------------------------------------

/** Narrow `unknown` to a plain non-null non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** A finite number (NaN and ±Infinity excluded). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A non-negative safe integer. */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** A positive safe integer. */
export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

// ---------------------------------------------------------------------------
// The JSON value model (opaque payloads — the sibling lanes' JsonValue)
// ---------------------------------------------------------------------------

/** The JSON value model: the only payload currency this lane accepts. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** The object branch of the JSON value model. */
export type JsonObject = { readonly [key: string]: JsonValue };

/** Total runtime guard for the JSON value model (finite numbers only). */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((element) => isJsonValue(element));
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const element: unknown = (value as Record<string, unknown>)[key];
      if (!isJsonValue(element)) return false;
    }
    return true;
  }
  return false;
}

/** Narrow to the object branch of the JSON value model. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// deepFreeze (the L3 immutability discipline)
// ---------------------------------------------------------------------------

/**
 * Recursively freeze a value (arrays and plain objects). Returns the SAME
 * reference, deeply frozen — the discipline every public record of this
 * lane follows (immutability tests assert `isDeeplyFrozen`).
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const element: unknown = (value as Record<string, unknown>)[key];
    if (typeof element === 'object' && element !== null && !Object.isFrozen(element)) {
      deepFreeze(element);
    }
  }
  return value;
}

/** Is the value deeply frozen (every reachable object frozen)? */
export function isDeeplyFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const element: unknown = (value as Record<string, unknown>)[key];
    if (!isDeeplyFrozen(element)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Canonical serialization + the deterministic digest (L9)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization: object keys recursively sorted (code-unit
 * order), arrays in order, strings via `JSON.stringify`, finite numbers via
 * `String`. Equal JSON values always serialize byte-identically — the
 * property every lineage digest of this lane relies on. MIRRORS the sibling
 * lanes' `canonicalJson` exactly (interop-tested).
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value); // finite by the JSON model
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  const object = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

/**
 * FNV-1a 32-bit hash of a string, as zero-padded lowercase hex — the
 * canonical TradRL derivation, mirrored (same seed, same prime, same
 * output width as every sibling lane; interop-tested for parity).
 */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// The seeded PRNG (fixture determinism — no ambient randomness, ever)
// ---------------------------------------------------------------------------

/**
 * A seeded xorshift32 PRNG in [0, 1) — the T009 fixture discipline: every
 * fixture choice derives from the seed, so the same options always
 * generate byte-identical fixtures, run twice, forever (L9).
 */
export function createSeededRandom(seed: string): () => number {
  let state = Number.parseInt(fnv1a32Hex(seed), 16) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}
