// @tradrl/example-e2e-trading — the zero-dependency foundation.
//
// Owning Work Order: T048 (the reference end-to-end slice).
//
// STRUCTURAL MIRROR (D-003/D-004 law): this package imports NOTHING outside
// its own tree. The primitives below are field- and byte-for-byte mirrors of
// the program-wide laws owned elsewhere:
//   - canonicalJson / stableDigest / stableDigestJson / isDigest mirror
//     @tradrl/skills' primitives (byte-identical; the cross-package trip
//     wire lives in tests/end-to-end-trading/interop.test.ts).
//   - fnv1a32Int / fnv1a32Hex / isChainHead mirror @tradrl/body-execution's
//     and @tradrl/execution-policy's chain-head fold.
//   - TimestampMs mirrors @tradrl/time-engine's canonical brand.
// The mirrors make drift loud: the interop tests import the REAL packages
// and assert byte-identical digests on shared samples.

// ---------------------------------------------------------------------------
// JSON value model (mirror of skills' model)
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

/** Runtime guard for a plain record (NOT array/null). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-clones JSON-serializable contract data (round-trips through JSON). */
export function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Canonical JSON + stable digest (the program-wide L9 law, mirrored)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization of any JSON value: object keys recursively
 * sorted (code-unit order), arrays in order, strings via `JSON.stringify`,
 * finite numbers via `String`. Equal JSON values always serialize
 * byte-identically — the determinism anchor for every derived identity in
 * this slice. MIRRORED byte-identically from @tradrl/skills.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  const object = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

/** Fixed 32-bit FNV-1a offset basis and prime. */
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
 * rendered as 16 lowercase hex characters. MIRRORED byte-identically from
 * @tradrl/skills. NOT cryptographic — it is the change-detection digest L9
 * lineage binding needs.
 */
export function stableDigest(canonical: string): string {
  let even = FNV_OFFSET_32;
  let odd = FNV_OFFSET_32 ^ 0x2f6e2e1;
  const units = Array.from(canonical);
  for (let index = 0; index < units.length; index++) {
    const unit = units[index].codePointAt(0) as number;
    if (index % 2 === 0) even = fnv1aRound(even, unit);
    else odd = fnv1aRound(odd, unit);
  }
  even = Math.imul(even ^ units.length, FNV_PRIME_32) >>> 0;
  odd = Math.imul(odd ^ (units.length * 31), FNV_PRIME_32) >>> 0;
  const hex = (value: number): string => value.toString(16).padStart(8, '0');
  return `${hex(even)}${hex(odd)}`;
}

/** Stable digest of any JSON value through the canonical form. */
export function stableDigestJson(value: JsonValue): string {
  return stableDigest(canonicalJson(value));
}

/** Guard: a well-formed 16-character lowercase hex digest. */
export function isDigest(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
}

/**
 * FNV-1a 32-bit hash of a string (the raw integer). MIRRORED from
 * @tradrl/body-execution's primitives (the chain-head engine).
 */
export function fnv1a32Int(text: string): number {
  let hash = FNV_OFFSET_32;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  return hash >>> 0;
}

/**
 * FNV-1a 32-bit hash of a string, rendered as 8 lowercase hex characters.
 * THE CHAIN-HEAD FOLD: `fnv(prevHead + canonical(content))` — the exact
 * formula the execution lane's append-only logs use. MIRRORED byte-identically.
 */
export function fnv1a32Hex(text: string): string {
  return fnv1a32Int(text).toString(16).padStart(8, '0');
}

/** Guard: a well-formed 8-character lowercase hex chain head. */
export function isChainHead(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}$/.test(v);
}

// ---------------------------------------------------------------------------
// TimestampMs — structural mirror of @tradrl/time-engine
// (DO NOT DIVERGE — program-wide tag 'TradRL.TimestampMs')
// ---------------------------------------------------------------------------

/**
 * A validated epoch-millisecond timestamp (brand is compile-time only).
 * This slice NEVER reads a wall clock: every instant is an explicit
 * scenario input (the determinism law). Strategic instants sit in `asOf`
// fields; ORDER-LEVEL instants sit in the dedicated `orderClock` field
 * (L16 — never the same position, never the same value).
 */
export type TimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };

/** Lower bound of the representable range: the Unix epoch. */
export const MIN_TIMESTAMP_MS = 0;

/** Upper bound of the representable range: the last ECMAScript `Date` instant. */
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999;

/** Guard: a safe integer epoch-millisecond timestamp within the legal range. */
export function isTimestampMs(value: unknown): value is TimestampMs {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_TIMESTAMP_MS &&
    value <= MAX_TIMESTAMP_MS
  );
}

/** Validating constructor for trusted literals (throws on violation). */
export function requireTimestampMs(value: number): TimestampMs {
  if (!isTimestampMs(value)) {
    throw new TypeError(`requireTimestampMs: ${String(value)} is outside [0, ${MAX_TIMESTAMP_MS}]`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Small shared guards (the hand-rolled no-`any` discipline)
// ---------------------------------------------------------------------------

/** Guard: a non-empty string. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Guard: a non-negative safe integer. */
export function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** Guard: a positive safe integer. */
export function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
}

/** Guard: a boolean. */
export function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

/** Guard: an array whose every member satisfies the member guard. */
export function isArrayOf<T>(
  v: unknown,
  guard: (member: unknown) => member is T,
): v is readonly T[] {
  return Array.isArray(v) && v.every((member) => guard(member));
}

/** Guard: a member of a closed vocabulary (const-asserted tuple). */
export function isMemberOf<V extends readonly unknown[]>(vocabulary: V, v: unknown): v is V[number] {
  return (vocabulary as readonly unknown[]).includes(v);
}

/** Guard: a plain string equal to a given literal. */
export function isLiteralString<T extends string>(value: unknown, literal: T): value is T {
  return value === literal;
}

/** Guard: an identifier-shaped string (`[A-Za-z0-9][A-Za-z0-9._:-]{0,255}`). */
export function isValidIdentifierString(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(v);
}

/** Guard: an ISO-8601 calendar string with a mandatory offset. */
export function isIso8601(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v)
  );
}

/** Guard: an RFC-3339 timestamp string with an explicit offset (order lane). */
export function isRfc3339(v: unknown): v is string {
  return isIso8601(v);
}

/** Guard: a strict semantic version string `X.Y.Z`. */
export function isSemVerString(v: unknown): v is string {
  return typeof v === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v);
}

/** Guard: a body-version ref in the canonical `bodyId@semver` pattern. */
export function isBodyVersionRefPattern(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const at = v.lastIndexOf('@');
  if (at <= 0 || at === v.length - 1) return false;
  const bodyId = v.slice(0, at);
  const version = v.slice(at + 1);
  return isNonEmptyString(bodyId) && isSemVerString(version);
}

/** Guard: an opaque reference string (non-empty, no whitespace). */
export function isOpaqueRefString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && !/\s/.test(v);
}

// ---------------------------------------------------------------------------
// deepFreeze (the L3 immutability discipline, mirrored)
// ---------------------------------------------------------------------------

/** Recursively freezes every object/array in a JSON-shaped tree. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || Array.isArray(value))) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** Throws a structured TypeError with a path prefix (record law). */
export function invalidAt(path: string, message: string): TypeError {
  return new TypeError(`${path}: ${message}`);
}
