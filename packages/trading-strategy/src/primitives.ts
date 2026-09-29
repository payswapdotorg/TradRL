// @tradrl/trading-strategy — shared contract primitives.
//
// Spec anchors: spec/ARCHITECTURE.md ("Strategy/Portfolio/Risk" — this
// lane's position in the core flow), spec/ARCHITECTURE-LOCK.md L8 (the
// existential law of this lane: a strategy produces INTENTS, never
// authority), L9 (reproducible lineage), L11 (search integrity),
// L12 (tenant isolation), spec/DOMAIN-MODEL.md (Goal, ConstraintSet,
// MarketEvent, Trajectory).
//
// Laws honored here (mirroring the merged contract packages —
// organization, rl-protocol, exchange-sim):
// - Zero runtime dependencies; pure data and pure functions only.
// - No `any`; every exported shape has a hand-rolled total type guard.
// - All contract data is JSON-serializable (no Dates, Maps, Sets; symbol
//   keys are type-level brands only) so specs, states, intents, runs and
//   backtest trails are portable across processes and byte-stable under
//   canonical serialization.
// - No ambient clock: `Date.now()` never appears — every instant is an
//   explicit parameter (byte-determinism of serialization is a
//   construction law). `isoFromEpochMs` converts an EXPLICIT epoch-ms
//   instant to the ISO form the order-intent mirror requires — a pure
//   function of its argument, never a clock read.
// - No ambient randomness: seeded generators only (the organization-lane
//   mulberry32 discipline), and the reference policies of this lane are
//   deterministic functions of their declared inputs.
// - Cross-lane entities (T002 trading domain, T007 control plane, T010
//   exchange simulation, T012 evaluation, T013 RL bridge, T016
//   organization, market-protocol observations) are referenced ONLY
//   through opaque branded string ids — never imported (D-003/D-004).
//
// This module STRUCTURALLY MIRRORS the shared primitives of
// packages/organization and packages/rl-protocol (program decision D-004):
// contract packages never import each other, but their shared
// vocabularies (record discipline, opaque-reference discipline,
// deep-freeze discipline, canonical JSON, stable digests) must not
// diverge. src/interop.test.ts is the drift trip wire.

// ---------------------------------------------------------------------------
// Compile-time branding
// ---------------------------------------------------------------------------

/**
 * Nominal tag for otherwise-primitive values. The brand exists only at
 * compile time; at runtime this is the underlying primitive. Obtain
 * branded values ONLY through the validating guards of this package.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

// ---------------------------------------------------------------------------
// Structural type-check helpers (hand-rolled, `any`-free)
// ---------------------------------------------------------------------------

/** `true` when `v` is a plain object (not an array, not a class instance). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** `true` when `v` is a non-empty string after trimming. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** `true` when `v` is a finite number (never NaN, never ±Infinity). */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** `true` when `v` is a safe integer `>= 0` (counts, ordinals, budgets). */
export function isNonNegativeSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** `true` when `v` is a safe integer `>= 1` (sequences, versions, budgets). */
export function isPositiveSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
}

/** `true` when `v` is a finite number in the closed unit interval [0, 1]. */
export function isUnitInterval(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && v <= 1;
}

/** `true` when `v` is a non-negative integer (`>= 0`, integer). */
export function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** `true` when `v` is a positive integer (`>= 1`). */
export function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

/** `true` when `v` is a member of the closed string vocabulary `vocab`. */
export function isMemberOf<T extends string>(vocab: readonly T[], v: unknown): v is T {
  return isNonEmptyString(v) && (vocab as readonly string[]).includes(v);
}

/** `true` when `v` is an array whose every element satisfies `guard`. */
export function isArrayOf<T>(guard: (element: unknown) => element is T, v: unknown): v is readonly T[] {
  return Array.isArray(v) && v.every((element) => guard(element));
}

/**
 * `true` when `v` is an identifier path: dot-separated non-empty
 * segments of [A-Za-z0-9_-] (the criterion-metric / constraint-subject
 * address space shared with the control and evaluation lanes).
 */
export function isIdentifierPath(v: unknown): v is string {
  if (!isNonEmptyString(v)) return false;
  return /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(v);
}

/** Strips `readonly` modifiers — used by tests to attempt mutations. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Deep immutability (runtime half of the append-only discipline, L9/L11)
// ---------------------------------------------------------------------------

/**
 * Recursively `Object.freeze`s every reachable plain object and array.
 * Already-frozen branches are skipped, so cycles terminate and shared
 * frozen substructures cost nothing. Returns the same reference, now
 * deeply frozen. Mirror of the organization/rl-protocol discipline.
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
 * The runtime check behind "specs, states, intents, runs and backtest
 * trails are append-only, deeply-frozen value objects".
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
// Canonical JSON + stable digests (byte-determinism law)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization of any JSON value: object keys recursively
 * sorted (code-unit order), arrays in order, strings via `JSON.stringify`,
 * finite numbers via `String`. Equal JSON values always serialize
 * byte-identically. Mirror of the program-wide canonical form.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value); // finite by the JSON model
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  const object = value as JsonObject;
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

/** FNV-1a 32-bit hash of a string, as zero-padded lowercase hex. Mirror of the program-wide digest. */
export function fnv1a32Hex(text: string): string {
  return fnv1a32Int(text).toString(16).padStart(8, '0');
}

/** FNV-1a 32-bit hash of a string, as an unsigned 32-bit integer (the generator key). */
function fnv1a32Int(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Stable digest of a JSON value: the FNV-1a hex of its canonical JSON.
 * Equal values always digest identically (determinism law, L9).
 */
export function stableDigest(value: JsonValue): string {
  return fnv1a32Hex(canonicalJson(value));
}

/** Stable digest of the canonical JSON form of a JSON-shaped record. */
export function stableDigestJson(value: JsonObject): string {
  return stableDigest(value);
}

/** `true` when `v` is a lowercase 8-hex digest (the program's derived-id form). */
export function isDigest(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}$/.test(v);
}

// ---------------------------------------------------------------------------
// Timestamps (mirror of the control plane's canonical scalar time)
// ---------------------------------------------------------------------------

/** The canonical epoch-millisecond instant (control-plane mirror). */
export type TimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };

export const MIN_TIMESTAMP_MS = 0;
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999;

/** Guard: a safe integer epoch-millisecond instant within the representable range. */
export function isTimestampMs(v: unknown): v is TimestampMs {
  return (
    typeof v === 'number' &&
    Number.isSafeInteger(v) &&
    v >= MIN_TIMESTAMP_MS &&
    v <= MAX_TIMESTAMP_MS
  );
}

// ---------------------------------------------------------------------------
// Deterministic ISO formatting (no clock reads — pure conversion)
// ---------------------------------------------------------------------------

/**
 * The RFC 3339 / ISO-8601 UTC form of an EXPLICIT epoch-millisecond
 * instant: `YYYY-MM-DDTHH:MM:SS.mmmZ` (millisecond precision, always "Z").
 * This is the timestamp form the order-intent mirror (exchange-sim /
 * domain-core `Timestamp`) requires, derived PURELY from its argument —
 * the no-ambient-clock law is preserved (no `Date.now()`, no `new Date()`
 * without an argument). Deterministic: same instant, same bytes.
 */
export function isoFromEpochMs(value: TimestampMs): string {
  return new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// Seeded generators (the ONLY randomness this lane may touch)
// ---------------------------------------------------------------------------

/**
 * Create a sequential deterministic generator from a seed string
 * (mulberry32 keyed by the FNV-1a hash of the seed — the organization-lane
 * algorithm). The SAME seed always yields the SAME sequence. A stochastic
 * strategy MUST declare its generators in its spec (the determinism law:
 * "stochastic strategies declare seeded generators in their spec") and
 * every draw is then a pure function of the seed material, so the run is
 * deterministic and replayable (the seed participates in lineage, L9).
 */
export function createSeededRandom(seed: string): () => number {
  let state = fnv1a32Int(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One stateless deterministic draw in [0, 1), keyed by (seed, scope, index). Pure. */
export function seededDraw(seed: string, scope: string, index: number): number {
  return createSeededRandom(`${seed}|${scope}|${index}`)();
}
