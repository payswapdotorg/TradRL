// @tradrl/body-cross-market-researcher — shared contract primitives.
//
// Owning Work Order: T023 (frozen write surface:
// bodies/cross-market-researcher, services/research/src/cross-market,
// services/research/src/index.ts — additive re-export lines only).
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L4 (point-in-time truth — the
// availability quartet and the as-of gate), L9 (reproducible lineage —
// canonical serialization and stable digests make every research output
// byte-deterministic), L12 (tenant isolation — every record carries
// TenantId + ProjectId); spec/ARCHITECTURE.md "Agent Body" (a Body is
// persistent capability composition; Body Versions are immutable) and the
// data/research plane (provider adapters, canonical events, point-in-time
// knowledge).
//
// Package laws (mirroring @tradrl/skills and @tradrl/agent-os):
// - Zero runtime dependencies; pure data and pure functions only.
// - No `any`; every exported shape has a hand-rolled total type guard.
// - All contract data is JSON-serializable (no Dates, Maps, Sets; brands
//   are compile-time only) so research records are portable across
//   processes and byte-stable under canonical serialization.
// - No ambient clock anywhere (`Date.now()` never appears) — every instant
//   is an explicit parameter, so research is replayable and byte-
//   deterministic (the determinism law).
// - Cross-lane entities (agent-body, provenance, evaluation, skills,
//   agent-os, adapters) are referenced ONLY through opaque branded string
//   ids — STRUCTURAL MIRRORS, never imports (program decisions
//   D-003/D-004). The cross-package trip wires live in src/interop.test.ts.
//
// Brand discipline: this package uses STRING-KEYED phantom brands
// (`__brand: B`), the same discipline as @tradrl/skills, @tradrl/domain-core
// and the agent-body capability registry — string-keyed brands from
// different packages with the same tag are mutually assignable at compile
// time, which is exactly what the structural-mirror interop trip wires
// prove at runtime.

// ---------------------------------------------------------------------------
// Brand + mutability helper
// ---------------------------------------------------------------------------

/** Branded primitive: `T` carrying a phantom kind tag `B` at compile time. */
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

/** Guard: an integer >= 0 (counts). */
export function isNonNegativeInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0;
}

/** Guard: an integer >= 1. */
export function isPositiveInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 1;
}

/** Guard: an array whose every element satisfies `guard`. */
export function isArrayOf<T>(
  v: unknown,
  guard: (item: unknown) => item is T,
): v is readonly T[] {
  if (!Array.isArray(v)) return false;
  return v.every((item) => guard(item));
}

/** Guard: a closed string-union member. */
export function isMemberOf<const V extends readonly string[]>(
  values: V,
  v: unknown,
): v is V[number] {
  return typeof v === 'string' && (values as readonly string[]).includes(v);
}

/** The duplicate members of a string array, in first-appearance order. */
export function duplicatesOf(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

// ---------------------------------------------------------------------------
// Deep immutability (runtime half of the L3 discipline)
// ---------------------------------------------------------------------------

/**
 * Recursively `Object.freeze`s every reachable plain object and array.
 * Already-frozen branches are skipped, so cycles terminate. Returns the
 * same reference, now deeply frozen.
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
 * Every public record this package mints must pass this check: a research
 * record that can be mutated after publication is not a contract record.
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
        stack.push((current as Record<string, unknown>)[key]);
      }
    }
  }
  return true;
}

/** Deep-clones JSON-serializable contract data (round-trips through JSON). */
export function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// JSON value model
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
// Canonical JSON + stable digest (program-wide law — mirror of skills)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization of any JSON value: object keys recursively
 * sorted (code-unit order), arrays in order, strings via `JSON.stringify`,
 * finite numbers via `String`. Equal JSON values always serialize
 * byte-identically — the determinism anchor for every derived identity in
 * this package (L9). Byte-identical to @tradrl/skills's `canonicalJson`,
 * @tradrl/evaluation's `canonicalJson` and @tradrl/agent-body's
 * `registryCanonicalJson` (the program-wide law); the cross-package trip
 * wire lives in interop.test.ts.
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

/** Fixed 32-bit FNV-1a offset basis and prime (hand-rolled digest, L9). */
const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/** One 32-bit FNV-1a round over a UTF-16 code unit (UTF-8 denormalized). */
function fnv1aRound(hash: number, unit: number): number {
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
 * 32-bit FNV-1a lanes (even/odd code units, both folding the length),
 * rendered as 16 lowercase hex characters. Pure, deterministic,
 * hand-rolled — identical inputs ALWAYS digest identically. Byte-identical
 * to @tradrl/skills's `stableDigest`, @tradrl/evaluation's `stableDigest`
 * and @tradrl/agent-body's `registryStableDigest`; NOT cryptographic — it
 * is the change-detection digest L9 lineage binding needs.
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
 * `stableDigestJson(v) === stableDigest(canonicalJson(v))`.
 */
export function stableDigestJson(value: JsonValue): string {
  return stableDigest(canonicalJson(value));
}

/** Guard: a well-formed 16-character lowercase hex digest. */
export function isDigest(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
}

/** FNV-1a 32-bit hash of a string, as an unsigned 32-bit integer. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// TimestampMs — structural mirror of @tradrl/time-engine via
// @tradrl/skills / @tradrl/provenance / @tradrl/agent-os
// (DO NOT DIVERGE — program-wide tag 'TradRL.TimestampMs')
// ---------------------------------------------------------------------------

/**
 * A validated epoch-millisecond timestamp (brand is compile-time only).
 * Canonical definition: `@tradrl/time-engine`; re-declared identically by
 * the provenance lane, the evaluation lane, the agent-os lane and every
 * adapter. This package NEVER reads a wall clock; every instant it records
 * is an explicit input (the determinism law).
 */
export type TimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };

/** Lower bound of the representable range (the Unix epoch). Mirror. */
export const MIN_TIMESTAMP_MS = 0;

/** Upper bound of the representable range (last ECMAScript Date instant). Mirror. */
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999;

/** Runtime guard — mirrors `isTimestampMs` from the canonical owners. */
export function isTimestampMs(value: unknown): value is TimestampMs {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_TIMESTAMP_MS &&
    value <= MAX_TIMESTAMP_MS
  );
}

/** Constructs a `TimestampMs`, throwing on invalid input. */
export function timestampMs(value: number): TimestampMs {
  if (!isTimestampMs(value)) {
    throw new TypeError(`timestampMs: invalid epoch-millisecond instant ${JSON.stringify(value)}`);
  }
  return value as TimestampMs;
}

// ---------------------------------------------------------------------------
// ISO 8601 — structural mirror of @tradrl/agent-body's timestamp discipline
// ---------------------------------------------------------------------------

const ISO8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** An ISO-8601 instant string (compile-time brand; runtime = pattern + parse). */
export type ISO8601 = Brand<string, 'ISO8601'>;

/** Guard: a well-formed ISO-8601 instant with an explicit offset. */
export function isIso8601(v: unknown): v is ISO8601 {
  return typeof v === 'string' && ISO8601_PATTERN.test(v) && !Number.isNaN(Date.parse(v));
}

// ---------------------------------------------------------------------------
// Identifier + opaque reference patterns (mirror of agent-body/skills)
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const OPAQUE_REF_PATTERN = /^[^\s](.{0,1022}[^\s])?$/u;

/** Guard: a compact identifier (ids minted by this package and mirrored lanes). */
export function isValidIdentifierString(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v);
}

/** Guard: an opaque cross-lane reference (1..1024 chars, no control chars). */
export function isValidOpaqueRefString(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length <= 1024 &&
    OPAQUE_REF_PATTERN.test(v) &&
    !/[\u0000-\u001f]/.test(v)
  );
}

// ---------------------------------------------------------------------------
// SemVer — structural mirror of @tradrl/agent-body (the body-version space)
// ---------------------------------------------------------------------------

/** A parsed semantic version (semver.org). Compile-time brand on the record. */
export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
  readonly build: readonly string[];
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** Parses a strict semver string, or `null` when malformed. */
export function parseSemVer(input: string): SemVer | null {
  const match = SEMVER_PATTERN.exec(input);
  if (match === null) return null;
  const prerelease = match[4] === undefined ? [] : match[4].split('.');
  const build = match[5] === undefined ? [] : match[5].split('.');
  return deepFreeze({
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
    build,
  });
}

/** Renders a parsed semver back to its canonical string form. */
export function semverToString(version: SemVer): string {
  let text = `${version.major}.${version.minor}.${version.patch}`;
  if (version.prerelease.length > 0) text += `-${version.prerelease.join('.')}`;
  if (version.build.length > 0) text += `+${version.build.join('.')}`;
  return text;
}

/** Guard: a parsed semver record. */
export function isSemVer(v: unknown): v is SemVer {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.major) &&
    isNonNegativeInteger(v.minor) &&
    isNonNegativeInteger(v.patch) &&
    isArrayOf(v.prerelease, isNonEmptyString) &&
    isArrayOf(v.build, isNonEmptyString)
  );
}
