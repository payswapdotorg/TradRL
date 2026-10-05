// @tradrl/capability-provider — shared contract primitives.
//
// Owning Work Order: T045 (frozen write surface: packages/capability-provider).
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L4 (point-in-time — no ambient
// clock, every instant is an explicit parameter), L9 (reproducible lineage
// — canonical serialization and stable digests make every derived record
// byte-deterministic), L12 (tenant isolation — every record carries
// TenantId + ProjectId), L16a (labels alone never establish suitability),
// L17/L18 (Arena/expertise optional and localizable), L20 (safety is code,
// never prompts).
//
// Package laws (mirroring @tradrl/skills and @tradrl/autonomous-learning):
// - Zero runtime dependencies; pure data and pure functions only.
// - No `any`; every exported shape has a hand-rolled total type guard.
// - All contract data is JSON-serializable (no Dates, Maps, Sets; brands
//   are compile-time only) so provider records are portable across
//   processes and byte-stable under canonical serialization.
// - No ambient clock anywhere (`Date.now()` never appears) and no ambient
//   randomness (`Math.random` never appears) — every id is CONTENT-ADDRESSED
//   (a digest over canonical bytes), so the whole exchange is replayable.
// - Cross-lane entities (T017 skills/body-forge, T041 api/sdk) are
//   referenced ONLY through opaque branded string ids and STRUCTURAL
//   MIRRORS — never imports (program decisions D-003/D-004). The
//   cross-lane trip wires live in src/interop.test.ts.

// ---------------------------------------------------------------------------
// Compile-time branding
// ---------------------------------------------------------------------------

/**
 * Nominal tag for otherwise-primitive values. The brand exists only at
 * compile time; at runtime this is the underlying primitive. Obtain
 * branded values ONLY through the validating guards of this lane.
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

/** `true` when `v` is a non-empty string. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** `true` when `v` is a finite number (never NaN/Infinity). */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** `true` when `v` is a non-negative integer (0 included). */
export function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** `true` when `v` is a positive integer (0 excluded). */
export function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/** `true` when `v` is a member of the closed string vocabulary `vocab`. */
export function isMemberOf<V extends readonly string[]>(vocab: V, v: unknown): v is V[number] {
  return typeof v === 'string' && (vocab as readonly string[]).includes(v);
}

/** `true` when `v` is an array whose every member satisfies `guard`. */
export function isArrayOf<T>(v: unknown, guard: (member: unknown) => member is T): v is readonly T[] {
  return Array.isArray(v) && v.every((member) => guard(member));
}

// ---------------------------------------------------------------------------
// The JSON value model (portable, byte-stable)
// ---------------------------------------------------------------------------

/** A JSON value (the only payload model this lane accepts). */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** A JSON object. */
export type JsonObject = { readonly [key: string]: JsonValue };

/** `true` when `v` is a total JSON value (no undefined/functions/symbols anywhere). */
export function isJsonValue(v: unknown): v is JsonValue {
  if (v === null) return true;
  if (typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (isRecord(v)) return Object.values(v).every(isJsonValue);
  return false;
}

/** `true` when `v` is a JSON object (a record of JSON values). */
export function isJsonObject(v: unknown): v is JsonObject {
  return isRecord(v) && Object.values(v).every(isJsonValue);
}

// ---------------------------------------------------------------------------
// Deep-freeze discipline + deep clone
// ---------------------------------------------------------------------------

/** Recursively freezes a JSON-compatible value (the returned record is immutable). */
export function deepFreeze<T>(value: T): T {
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    value.forEach((member) => deepFreeze(member));
    Object.freeze(value);
    return value;
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

/** `true` when `value` is deeply frozen (every nested object and array). */
export function isDeeplyFrozen(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value !== 'object') return Object.isFrozen(value) || typeof value !== 'object';
  if (seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  if (Array.isArray(value)) return value.every((member) => isDeeplyFrozen(member, seen));
  return Object.values(value).every((member) => isDeeplyFrozen(member, seen));
}

/** Deep-clones a JSON value through the JSON model (undefined-carrying objects fail `isJsonValue` upstream). */
export function deepCloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Canonical JSON + digests (the program-wide law, L9)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization: object keys recursively sorted, no
 * whitespace — the same value always yields the same bytes, so digests
 * are stable across processes and key-order differences (the
 * byte-determinism anchor of every content-addressed id in this lane).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return 'null';
}

/** The FNV-1a 32-bit hash of a string, as zero-padded lowercase hex. */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/**
 * One 32-bit FNV-1a round over a UTF-16 code unit, UTF-8 DENORMALIZED:
 * each unit is expanded to its UTF-8 bytes and the hash folds EVERY byte
 * (three-byte max — a code unit never exceeds U+FFFF). This is the
 * program-wide round (byte-identical to @tradrl/skills'
 * `fnv1aRound`, @tradrl/evaluation's, @tradrl/organization's and
 * @tradrl/agent-body capability-registry's — the same law everywhere);
 * the interop test pins the parity on shared vectors, non-ASCII included.
 */
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
 * The DUAL-LANE stable digest over canonical text: 16 lowercase hex
 * chars. STRUCTURAL MIRROR of @tradrl/skills' `stableDigest` (which
 * mirrors @tradrl/evaluation) — the same fold, the same bytes; the
 * interop test pins the agreement on shared vectors.
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

/** The stable digest of a JSON value (canonical JSON first — key order can never leak into the digest). */
export function stableDigestJson(value: unknown): string {
  return stableDigest(canonicalJson(value));
}

/** Guard: a 16-hex-char stable digest. */
export function isDigest(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
}

// ---------------------------------------------------------------------------
// TimestampMs mirror (canonical owner: @tradrl/time-engine)
// ---------------------------------------------------------------------------

/** An epoch-millisecond instant — STRUCTURAL MIRROR of @tradrl/time-engine. */
export type TimestampMs = Brand<number, 'TimestampMs'>;

/** The representable instant floor (1970-01-01T00:00:00Z). */
export const MIN_TIMESTAMP_MS = 0 as TimestampMs;

/** The representable instant ceiling (the program-wide mirror constant, ~year 275760). */
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999 as TimestampMs;

/** Guard: `TimestampMs` (integer epoch ms within the representable window). */
export function isTimestampMs(v: unknown): v is TimestampMs {
  return typeof v === 'number' && Number.isInteger(v) && v >= (MIN_TIMESTAMP_MS as number) && v <= (MAX_TIMESTAMP_MS as number);
}

/** Constructs a `TimestampMs`, throwing on invalid input (the explicit-instant discipline). */
export function timestampMs(value: number): TimestampMs {
  if (!isTimestampMs(value)) {
    throw new TypeError(`timestampMs: invalid epoch-millisecond instant ${JSON.stringify(value)}`);
  }
  return value;
}
