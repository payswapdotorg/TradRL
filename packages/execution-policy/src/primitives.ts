// @tradrl/execution-policy — shared contract primitives.
//
// Spec anchors: spec/ARCHITECTURE.md (Execution: "Consequential actions
// require hard controls outside prompts: identity, authorization,
// limits, venue permissions, rate limits, kill switch, credentials and
// audit."), spec/ARCHITECTURE-LOCK.md L8 (external execution authority
// — THIS lane is where that authority structurally lives), L5/L6
// (explicit world fidelity — the simulator declares its mode), L9
// (reproducible lineage), L12 (tenant isolation).
//
// Laws honored here (mirroring the merged contract packages —
// trading-strategy, exchange-sim, rl-protocol):
// - Zero runtime dependencies; pure data and pure functions only.
// - No `any`; every exported shape has a hand-rolled total type guard.
// - All contract data is JSON-serializable (no Dates, Maps, Sets; symbol
//   keys are type-level brands only) so policies, decisions, switch
//   logs, audit trails and simulated fills are portable across
//   processes and byte-stable under canonical serialization (L9).
// - No ambient clock: `Date.now()` never appears — every instant is an
//   explicit parameter (byte-determinism of serialization is a
//   construction law).
// - No ambient randomness: the only permitted draws are pure seeded
//   functions of their arguments (the simulator's latency draws derive
//   from the spec's seed — see simulation.ts).
// - Cross-lane entities (T002 trading domain, T007 control plane, T010
//   exchange simulation, T013 RL bridge, T018 strategy lane) are
//   referenced ONLY through opaque branded string ids — never imported
//   (D-003/D-004).
//
// This module STRUCTURALLY MIRRORS the shared primitives of
// packages/trading-strategy and packages/exchange-sim (program decision
// D-004): contract packages never import each other, but their shared
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

/** `true` when `v` is a member of the closed string vocabulary `vocab`. */
export function isMemberOf<T extends string>(vocab: readonly T[], v: unknown): v is T {
  return isNonEmptyString(v) && (vocab as readonly string[]).includes(v);
}

/** `true` when `v` is an array whose every element satisfies `guard`. */
export function isArrayOf<T>(guard: (element: unknown) => element is T, v: unknown): v is readonly T[] {
  return Array.isArray(v) && v.every((element) => guard(element));
}

/** Strips `readonly` modifiers — used by tests to attempt mutations. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Deep immutability (runtime half of the append-only discipline, L9)
// ---------------------------------------------------------------------------

/**
 * Recursively `Object.freeze`s every reachable plain object and array.
 * Already-frozen branches are skipped, so cycles terminate and shared frozen
 * substructures cost nothing. Returns the same reference, now deeply frozen.
 * Mirror of the sibling contract packages' discipline.
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
 * The runtime check behind "policies, decisions, switch logs, audit
 * trails and simulated fills are append-only, deeply-frozen value
 * objects".
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

/** FNV-1a 32-bit hash of a string, as an unsigned 32-bit integer (the chain fold's input). */
export function fnv1a32Int(text: string): number {
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
