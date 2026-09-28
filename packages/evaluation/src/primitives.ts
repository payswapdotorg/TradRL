// @tradrl/evaluation — shared contract primitives for the evaluation lane.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L7 (constraint-aware evaluation —
// the numeric vocabulary below is counts and unit-interval ratios ONLY, never
// performance figures), L9 (reproducible lineage — canonical serialization
// and stable digests make every derived record byte-deterministic), L11
// (search integrity), L4 (point-in-time truth — timestamps carry the
// time-engine discipline), L20 (fail-closed guards).
//
// Package laws (mirroring @tradrl/domain-core, @tradrl/time-engine,
// @tradrl/market-protocol, @tradrl/trajectory and @tradrl/control-domain):
// - Zero runtime dependencies; pure data and pure functions only.
// - No `any`; every exported shape has a hand-rolled total type guard.
// - All contract data is JSON-serializable (no Dates, Maps, Sets; brands are
//   compile-time only) so evaluation records are portable across processes
//   (T013 RL, T015 curriculum, T016 organization compiler, T031 audits) and
//   byte-stable under canonical serialization.
// - Cross-lane entities are referenced ONLY through opaque branded string
//   ids — never imported (D-003/D-004).
//
// This module contains TWO deliberate structural mirrors (decision
// D-003/D-004 pattern, see packages/market-protocol/src/timestamp.ts):
// - `TimestampMs` mirrors @tradrl/time-engine (canonical) — same brand string
//   'TradRL.TimestampMs', same bounds, same guard. Used for split-axis
//   boundaries and evaluation-run instants.
// - `canonicalJson` mirrors @tradrl/trajectory's canonical serializer (and
//   T005's canonicalJson before it): recursively sorted object keys, arrays
//   in order. The canonical form is a PROGRAM-WIDE law, not a package choice
//   — equal records must serialize byte-identically everywhere.
// The cross-package trip wires live in src/interop.test.ts.

// ---------------------------------------------------------------------------
// Compile-time branding
// ---------------------------------------------------------------------------

/**
 * Nominal tag for otherwise-primitive values. The brand exists only at
 * compile time; at runtime this is the underlying primitive. Obtain branded
 * values ONLY through the validating constructors/guards of this package.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Strips `readonly` modifiers — used by tests to attempt mutations. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Structural type-check helpers (hand-rolled, `any`-free)
// ---------------------------------------------------------------------------

/** Guard: a plain object (not an array, not a class instance). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Guard: a string with at least one non-whitespace character. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Guard: a finite JS number (NaN, +/-Infinity rejected). */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Guard: a finite number in the closed interval [0, 1] (ratios, shares). */
export function isUnitInterval(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && v <= 1;
}

/** Guard: an integer >= 0 (counts). */
export function isNonNegativeInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0;
}

/** Guard: an integer >= 1 (versions are 1-based; 0 marks "absent"). */
export function isPositiveInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 1;
}

// ---------------------------------------------------------------------------
// Deep immutability (runtime half of L9/L11 discipline)
// ---------------------------------------------------------------------------

/**
 * Recursively `Object.freeze`s every reachable plain object and array.
 * Already-frozen branches are skipped, so cycles terminate and shared frozen
 * substructures cost nothing. Returns the same reference, now deeply frozen.
 */
export function deepFreeze<T>(value: T): T {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object' || Object.isFrozen(current)) continue;
    Object.freeze(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        if (item !== null && typeof item === 'object') stack.push(item);
      }
    } else {
      for (const key of Object.keys(current)) {
        const child: unknown = (current as Record<string, unknown>)[key];
        if (child !== null && typeof child === 'object') stack.push(child);
      }
    }
  }
  return value;
}

/**
 * `true` when every reachable plain object and array is `Object.isFrozen`.
 * Compiled evaluation records must pass this check: a record that can be
 * mutated after publication is not a contract record.
 */
export function isDeeplyFrozen(value: unknown): boolean {
  const visited = new Set<unknown>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (!Object.isFrozen(current)) return false;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else {
      for (const key of Object.keys(current)) {
        const child: unknown = (current as Record<string, unknown>)[key];
        if (child !== null && typeof child === 'object') stack.push(child);
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// JSON value model (opaque payloads)
// ---------------------------------------------------------------------------

/** Recursive JSON value model. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

/** A JSON object (record of JSON values). */
export type JsonObject = { readonly [key: string]: JsonValue };

/** Runtime guard for a JSON value (deep). */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((element) => isJsonValue(element));
  if (typeof value === 'object') {
    return Object.values(value).every((element) => isJsonValue(element));
  }
  return false;
}

/** Runtime guard for a JSON object. */
export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((element) => isJsonValue(element));
}

// ---------------------------------------------------------------------------
// TimestampMs — structural mirror of @tradrl/time-engine (DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/**
 * A validated epoch-millisecond timestamp (brand is compile-time only).
 * Canonical definition: `@tradrl/time-engine`
 * (packages/time-engine/src/timestamp.ts). The frozen workspace lockfile
 * forbids a package dependency between contract packages, so this package
 * re-declares the IDENTICAL structural type (the same discipline as
 * `@tradrl/market-protocol` and `@tradrl/trajectory`). Construct through
 * time-engine's `timestampMs` / `requireTimestampMs`, or validate untrusted
 * values with {@link isTimestampMs}.
 */
export type TimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };

/** Lower bound of the representable range (the Unix epoch). Mirror of time-engine. */
export const MIN_TIMESTAMP_MS = 0;

/** Upper bound of the representable range (last ECMAScript Date instant). Mirror of time-engine. */
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999;

/** Runtime guard — mirrors `isTimestampMs` from @tradrl/time-engine. */
export function isTimestampMs(value: unknown): value is TimestampMs {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_TIMESTAMP_MS &&
    value <= MAX_TIMESTAMP_MS
  );
}

/**
 * Validating constructor for untrusted numeric input (typed error, never
 * throws). Mirrors the semantics of time-engine's `timestampMs`.
 */
export function timestampMs(value: number): { ok: true; value: TimestampMs } | { ok: false; message: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, message: 'timestamp must be a finite number of epoch milliseconds' };
  }
  if (!Number.isInteger(value)) {
    return { ok: false, message: `timestamp must be an integer number of epoch milliseconds, got ${value}` };
  }
  if (value < MIN_TIMESTAMP_MS || value > MAX_TIMESTAMP_MS) {
    return {
      ok: false,
      message: `timestamp ${value} is outside the representable range [${MIN_TIMESTAMP_MS}, ${MAX_TIMESTAMP_MS}] epoch ms`,
    };
  }
  return { ok: true, value: value as TimestampMs };
}

/**
 * Throwing constructor for trusted literals (tests, fixtures, configuration).
 * NOT for untrusted input — use {@link isTimestampMs} there.
 */
export function requireTimestampMs(value: number): TimestampMs {
  const result = timestampMs(value);
  if (result.ok) return result.value;
  throw new RangeError(`requireTimestampMs: ${result.message}`);
}

// ---------------------------------------------------------------------------
// Canonical JSON (program-wide law — mirror of @tradrl/trajectory)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization of any JSON value: object keys recursively
 * sorted (code-unit order), arrays in order, strings via `JSON.stringify`,
 * finite numbers via `String`. Equal JSON values always serialize
 * byte-identically — the determinism anchor for verdict hashes and derived
 * record ids (L9). Mirror of T005/T011's `canonicalJson`.
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

// ---------------------------------------------------------------------------
// Stable digest (hand-rolled, zero-dep, deterministic)
// ---------------------------------------------------------------------------

/** Fixed 32-bit FNV-1a offset basis and prime (hand-rolled digest, L9). */
const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/** One 32-bit FNV-1a round over a UTF-16 code unit. */
function fnv1aRound(hash: number, unit: number): number {
  // Denormalize a UTF-16 code unit into its UTF-8 byte sequence, mixing every
  // byte (surrogate pairs therefore digest deterministically).
  const bytes: number[] = [];
  if (unit < 0x80) {
    bytes.push(unit);
  } else if (unit < 0x800) {
    bytes.push(0xc0 | (unit >> 6), 0x80 | (unit & 0x3f));
  } else {
    bytes.push(0xe0 | (unit >> 12), 0x80 | ((unit >> 6) & 0x3f), 0x80 | (unit & 0x3f));
  }
  let h = hash;
  for (const byte of bytes) {
    h ^= byte;
    h = Math.imul(h, FNV_PRIME_32) >>> 0;
  }
  return h;
}

/**
 * Stable 64-bit-lane digest of a canonical JSON string: two independent
 * 32-bit FNV-1a lanes (one seeded over the even code units, one over the
 * odd code units, both folding the length), rendered as 16 lowercase hex
 * characters. Pure, deterministic, hand-rolled — identical inputs ALWAYS
 * digest identically; ANY single-bit change to the canonical bytes changes
 * the digest with overwhelming probability. Used for verdict hashes, input
 * digests, lineage-hash recomputation (verification) and derived record ids.
 * NOT a cryptographic primitive — it is a change-detection digest, exactly
 * what L9 lineage binding and L11 drift detection need.
 */
export function stableDigest(canonical: string): string {
  let even = FNV_OFFSET_32;
  let odd = FNV_OFFSET_32 ^ 0x2f6e2e1; // second lane seed (arbitrary, fixed forever)
  const units = Array.from(canonical);
  for (let index = 0; index < units.length; index++) {
    const unit = units[index].codePointAt(0) as number;
    if (index % 2 === 0) even = fnv1aRound(even, unit);
    else odd = fnv1aRound(odd, unit);
  }
  // Fold the length into both lanes so prefix-extension collisions cannot survive.
  even = Math.imul(even ^ units.length, FNV_PRIME_32) >>> 0;
  odd = Math.imul(odd ^ (units.length * 31), FNV_PRIME_32) >>> 0;
  const hex = (value: number): string => value.toString(16).padStart(8, '0');
  return `${hex(even)}${hex(odd)}`;
}

/**
 * Stable digest of any JSON value through the canonical form:
 * `stableDigestJson(v) === stableDigest(canonicalJson(v))`. The convenience
 * every derived id and lineage hash in this package routes through.
 */
export function stableDigestJson(value: JsonValue): string {
  return stableDigest(canonicalJson(value));
}

/** Guard: a well-formed 16-character lowercase hex digest produced by {@link stableDigest}. */
export function isDigest(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
}
