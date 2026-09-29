// @tradrl/compute — shared contract primitives.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L9 (reproducible lineage), L11
// (search integrity — worker failures are retained records), L12 (tenant
// isolation); spec/LEARNING-LOOP.md (Curriculum steps 1-4 need MANY
// episodes — this package is the protocol spine that scales the T013 loop
// without replacing it).
//
// Laws honored here:
// - Zero runtime dependencies; pure data and pure functions only.
// - No `any`; every exported shape has a hand-rolled total type guard.
// - All contract data is JSON-serializable (no Dates, Maps, Sets; symbol
//   keys are type-level brands only) so schedules, outcomes and run states
//   are portable across processes and byte-stable under canonical
//   serialization — a 1-worker run and an N-worker run over the same job
//   set must produce byte-identical aggregates (the determinism law of
//   Work Order T014).
// - No ambient clock: `Date.now()` never appears — every instant is an
//   explicit parameter (byte-determinism of serialization is a
//   construction law).
// - Cross-lane entities (T011 trajectory/experiments, T013 rl-protocol,
//   T005 environment protocol, T002/T006 domain/agent lanes) are referenced
//   ONLY through opaque branded string ids — never imported (D-003/D-004).
//
// This module STRUCTURALLY MIRRORS the shared primitives of
// packages/rl-protocol, packages/trajectory and packages/experiments
// (program decision D-004): contract packages never import each other, but
// their shared vocabularies (record discipline, opaque-reference
// discipline, deep-freeze discipline, canonical JSON, stable digests) must
// not diverge — src/interop.test.ts is the drift trip wire against the REAL
// packages present on this branch.

// ---------------------------------------------------------------------------
// Compile-time branding
// ---------------------------------------------------------------------------

/**
 * Nominal tag for otherwise-primitive values. The brand exists only at
 * compile time; at runtime this is the underlying primitive. Obtain branded
 * values ONLY through the validating constructors/guards of this package.
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

/** `true` when `v` is a safe integer `>= 1` (worker counts, budgets, bounds). */
export function isPositiveSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
}

/** Strips `readonly` modifiers — used by tests to attempt mutations. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Deep immutability (runtime half of the append-only discipline, L9/L11)
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
 * The runtime check behind "schedules, outcomes and aggregates are
 * append-only, deeply-frozen value objects": a value this package
 * constructed that is not deeply frozen fails this check.
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
 * byte-identically. Mirror of T005/T009/T011/T013's canonicalJson — the
 * canonical form is a program-wide law, not a package choice.
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

/**
 * FNV-1a 32-bit hash of a string, as zero-padded lowercase hex. Mirror of
 * T005/T009/T011/T013 — the digest discipline is program-wide, not a
 * package choice. Episode digests, submission ids and the aggregate digest
 * are all FNV-1a 32-bit values (8 lowercase hex chars).
 */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Runtime guard for an 8-char lowercase-hex digest (the FNV-1a discipline). */
export function isDigest8(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}$/.test(value);
}
