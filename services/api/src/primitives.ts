// @tradrl/api-service — shared structural primitives.
//
// STRUCTURAL MIRROR of @tradrl/execution-authority/src/primitives.ts
// (T040) and @tradrl/firm-memory/src/primitives.ts (T034) — both of
// which mirror T019's originals — re-declared by STRUCTURE, never
// imported (D-003/D-004 law; the Work Order: "mirrors only, never
// imports"). This service owns NO contract package among the frozen
// siblings, so it is fully SELF-CONTAINED: every cross-lane shape it
// composes is a structural mirror in this tree, and the interop test
// (src/interop.test.ts — test-only imports) is the drift trip wire
// against the REAL packages.
//
// Package laws (the program's service discipline, T034/T040
// precedent):
// - Zero runtime dependencies; types, guards and pure functions only.
// - No `any`; every exported shape ships a hand-rolled total type
//   guard that never throws.
// - No ambient clock (`Date.now()` never appears) and no ambient
//   randomness — every instant arrives through the injected
//   InstantSource; byte-determinism of metering records, idempotency
//   dedupe keys and audit content (identical inputs -> identical
//   bytes) is a construction law, pinned by tests.
// - All contract data is JSON-serializable and deeply frozen.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L9 (byte-determinism),
// L12 (tenant isolation), L20 (safety outside prompts);
// spec/SECURITY.md (untrusted input — every payload crossing this
// boundary is untrusted).

// ---------------------------------------------------------------------------
// Compile-time branding
// ---------------------------------------------------------------------------

/**
 * Nominal tag for otherwise-primitive values. The brand exists only at
 * compile time; at runtime this is the underlying primitive. Obtain
 * branded values ONLY through the validating guards of this package.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Strips `readonly` modifiers — used by tests to attempt illegal mutations. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Structural type-check helpers (hand-rolled, `any`-free, never throw)
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

/** `true` when `v` is a safe integer `>= 1` (sequences, versions, limits). */
export function isPositiveSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
}

/** `true` when `v` is a finite number in the closed unit interval [0, 1]. */
export function isUnitInterval(v: unknown): v is number {
  return isFiniteNumber(v) && (v as number) >= 0 && (v as number) <= 1;
}

/** Guard: a closed string vocabulary. */
export function isOneOf<const V extends readonly string[]>(
  values: V,
): (v: unknown) => v is V[number] {
  const allowed = new Set<string>(values);
  return (v: unknown): v is V[number] => typeof v === 'string' && allowed.has(v);
}

/** `true` when `v` is a member of the closed string vocabulary `vocab`. */
export function isMemberOf<T extends string>(vocab: readonly T[], v: unknown): v is T {
  return isNonEmptyString(v) && (vocab as readonly string[]).includes(v);
}

/** `true` when `v` is an array whose every element satisfies `guard`. */
export function isArrayOf<T>(guard: (element: unknown) => element is T, v: unknown): v is readonly T[] {
  return Array.isArray(v) && v.every((element) => guard(element));
}

/** Guard: a dot-separated identifier path (segments start with a letter — the program-wide metric/subject address space). */
const IDENTIFIER_PATH_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/;

export function isIdentifierPath(v: unknown): v is string {
  return typeof v === 'string' && IDENTIFIER_PATH_PATTERN.test(v);
}

// ---------------------------------------------------------------------------
// Deep immutability (runtime half of the append-only discipline, L9)
// ---------------------------------------------------------------------------

/**
 * Recursively `Object.freeze`s every reachable plain object and array.
 * Already-frozen branches are skipped, so cycles terminate and shared
 * frozen substructures cost nothing. Returns the same reference, now
 * deeply frozen.
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

/** `true` when every reachable plain object and array is `Object.isFrozen`. */
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

/** Deep-clones JSON-serializable contract data (round-trips through JSON). */
export function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
// Canonical JSON + stable digests (byte-determinism law, L9)
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

/** FNV-1a 32-bit hash of a string, as an unsigned 32-bit integer. */
export function fnv1a32Int(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable digest of a JSON value: the FNV-1a hex of its canonical JSON. */
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

/** Compare two instants (null-safe total order). */
export function compareTimestampMs(a: TimestampMs, b: TimestampMs): number {
  return (a as number) === (b as number) ? 0 : (a as number) < (b as number) ? -1 : 1;
}

// ---------------------------------------------------------------------------
// The canonical decimal grammar (exact decimals — the string money law)
// ---------------------------------------------------------------------------

/** The canonical unsigned decimal grammar: `0`, `12`, `3.5` — never `-0`, never leading zeros, never trailing `.`, never a bare `.`. */
export const UNSIGNED_DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.\d+)?$/;

/** The canonical signed decimal grammar: an optional leading `-` over the unsigned form. */
export const SIGNED_DECIMAL_PATTERN = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;

/** Guard: a canonical UNSIGNED decimal string. */
export function isCanonicalUnsignedDecimal(v: unknown): v is string {
  return typeof v === 'string' && UNSIGNED_DECIMAL_PATTERN.test(v);
}

/** Guard: a canonical SIGNED decimal string. */
export function isCanonicalSignedDecimal(v: unknown): v is string {
  return typeof v === 'string' && SIGNED_DECIMAL_PATTERN.test(v);
}

/** Guard: a canonical POSITIVE decimal string (strictly positive — quantities, prices). */
export function isCanonicalPositiveDecimal(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    UNSIGNED_DECIMAL_PATTERN.test(v) &&
    !(v === '0' || /^0\.0*$/.test(v))
  );
}

/** Guard: a canonical unit-interval decimal (`0`, `0.x…`, `1` or `1.0…`). */
export function isUnitIntervalDecimal(v: unknown): v is string {
  if (!isCanonicalUnsignedDecimal(v)) return false;
  const [intPart, fracPart = ''] = (v as string).split('.');
  if (intPart === '0') return true;
  if (intPart === '1') return /^0*$/.test(fracPart);
  return false;
}

/** Guard: an RFC 3339 timestamp with explicit offset and a real calendar date/time (the execution lane's string-instant grammar, mirrored). */
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isRfc3339Timestamp(v: unknown): v is string {
  if (typeof v !== 'string' || !RFC3339_PATTERN.test(v)) return false;
  return Number.isFinite(Date.parse(v));
}

// ---------------------------------------------------------------------------
// The credential-opacity trip wire (T019/T040/T043/T044 mirror — SECURITY.md's boundary)
// ---------------------------------------------------------------------------

/**
 * The closed list of credential-material key shapes (normalized
 * lowercase, no separators). STRUCTURAL MIRROR of T019/T040's list
 * (as T043 re-mirrors it) — the SAME closed vocabulary, law-for-law;
 * the interop test proves a REAL scan and THIS scan flag identical
 * trees.
 */
export const CREDENTIAL_VALUE_KEYS: readonly string[] = [
  'secret',
  'apikey',
  'privatekey',
  'password',
  'passphrase',
  'token',
  'mnemonic',
  'seedphrase',
  'credential',
] as const;

/** `true` when a record key is a credential-material key shape (case/separator-insensitive). */
export function isCredentialValueKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
  return (CREDENTIAL_VALUE_KEYS as readonly string[]).includes(normalized);
}

/**
 * Scan a record's JSON tree for embedded credential material: the
 * dotted paths of every credential-shaped key found, in deterministic
 * (depth-first, key-sorted) order. Pure; never throws; an empty result
 * means the tree is value-free. A contaminated payload is rejected
 * before anything else matters — the boundary never forwards, stores
 * or audits credential material (a 'cred:'-prefixed REF is fine; a
 * VALUE is not).
 */
export function credentialValueViolations(value: unknown, path = ''): readonly string[] {
  const found: string[] = [];
  if (value === null || typeof value !== 'object') return Object.freeze(found);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const violation of credentialValueViolations(item, `${path}[${index}]`)) found.push(violation);
    });
    return Object.freeze(found);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record).sort()) {
    if (isCredentialValueKey(key)) {
      found.push(path === '' ? key : `${path}.${key}`);
    }
    for (const violation of credentialValueViolations(record[key], path === '' ? key : `${path}.${key}`)) {
      found.push(violation);
    }
  }
  return Object.freeze(found);
}
