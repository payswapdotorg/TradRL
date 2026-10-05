// @tradrl/entitlements — shared contract primitives.
//
// Owning Work Order: T047 (frozen write surface: packages/entitlements).
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L4 (point-in-time — no ambient
// clock, every instant is an explicit parameter), L9 (reproducible
// lineage — canonical serialization and stable digests make every
// derived record byte-deterministic), L12 (tenant isolation — every
// record carries its tenant scope), L20 (safety is code, never prompts).
//
// Package laws (mirroring @tradrl/skills, @tradrl/firm-memory and
// @tradrl/capability-provider — the program-wide discipline):
// - Zero runtime dependencies; pure data and pure functions only.
// - No `any`; every exported shape has a hand-rolled total type guard.
// - All contract data is JSON-serializable (no Dates, Maps, Sets; brands
//   are compile-time only) so entitlement records are portable across
//   processes and byte-stable under canonical serialization.
// - EXACT DECIMALS for every monetary/quantitative record: amounts are
//   canonical decimal STRINGS over the program-wide grammar (never
//   floats, never number-valued money) and every arithmetic operation
//   is exact BigInt fixed-point.
// - No ambient clock anywhere (`Date.now()` never appears) and no
//   ambient randomness (`Math.random` never appears) — every id is
//   CONTENT-ADDRESSED (a digest over canonical bytes), so the whole
//   ledger is replayable.
// - Cross-lane entities (T041 api/sdk, T017 skills) are referenced ONLY
//   through opaque branded string ids and STRUCTURAL MIRRORS — never
//   imports (program decisions D-003/D-004). The cross-lane trip wires
//   live in src/interop.test.ts.

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
  if (value === null || typeof value !== 'object') return true;
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
 * `fnv1aRound`, @tradrl/evaluation's, @tradrl/organization's,
 * @tradrl/agent-body capability-registry's and @tradrl/capability-
 * provider's — the same law everywhere); the interop test pins the
 * parity on shared vectors, non-ASCII included.
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
 * mirrors @tradrl/evaluation and @tradrl/capability-provider) — the
 * same fold, the same bytes; the interop test pins the agreement on
 * shared vectors.
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

// ---------------------------------------------------------------------------
// The canonical decimal grammar (exact decimals — the string money law)
// ---------------------------------------------------------------------------

/**
 * The canonical unsigned decimal grammar: `0`, `12`, `3.5` — never `-0`,
 * never leading zeros, never trailing `.`, never a bare `.`. STRUCTURAL
 * MIRROR of @tradrl/firm-memory's grammar (which mirrors
 * @tradrl/execution-policy's decimals kernel) — the same law everywhere
 * money moves in this program.
 */
export const UNSIGNED_DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * The canonical signed decimal grammar: an optional leading `-` over the
 * unsigned form (the arithmetic normalizes `-0` to `0`).
 */
export const SIGNED_DECIMAL_PATTERN = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;

/** Guard: a canonical UNSIGNED decimal string. */
export function isCanonicalUnsignedDecimal(v: unknown): v is string {
  return typeof v === 'string' && UNSIGNED_DECIMAL_PATTERN.test(v);
}

/** Guard: a canonical SIGNED decimal string (the format layer never emits `-0`; parse normalizes it to `0`). */
export function isCanonicalSignedDecimal(v: unknown): v is string {
  return typeof v === 'string' && SIGNED_DECIMAL_PATTERN.test(v);
}

/** `true` when `v` is a canonical unsigned decimal strictly greater than `0` (a positive amount). */
export function isPositiveDecimal(v: unknown): v is string {
  return isCanonicalUnsignedDecimal(v) && signedCompare(v as string, '0') > 0;
}

/** `true` when `v` is a canonical unsigned decimal equal to `0`. */
export function isZeroDecimal(v: unknown): v is string {
  return isCanonicalUnsignedDecimal(v) && (v as string) === '0';
}

// ---------------------------------------------------------------------------
// The exact signed arithmetic (the local BigInt fixed-point kernel)
// ---------------------------------------------------------------------------

/** One parsed canonical decimal: the sign and the absolute value scaled by `10^scale`. */
interface ParsedDecimal {
  readonly negative: boolean;
  readonly units: bigint;
  readonly scale: number;
}

/** Parse a CANONICAL signed decimal (returns null on a non-canonical input — the guards ran first). */
function parseCanonicalSigned(v: string): ParsedDecimal | null {
  const match = SIGNED_DECIMAL_PATTERN.exec(v);
  if (match === null) return null;
  const negative = match[1] === '-';
  const intPart = match[2];
  const fracPart = match[3] ?? '';
  const units = BigInt(intPart + fracPart);
  if (units === 0n) return { negative: false, units: 0n, scale: fracPart.length };
  return { negative, units, scale: fracPart.length };
}

/** Rescale a parsed decimal's absolute units to a common scale. */
function rescaled(p: ParsedDecimal, scale: number): bigint {
  const diff = scale - p.scale;
  return diff === 0 ? p.units : p.units * 10n ** BigInt(diff);
}

/** Format a sign and scaled absolute units back into the canonical signed grammar (trailing zeros stripped; `-0` impossible). */
function formatSigned(negative: boolean, units: bigint, scale: number): string {
  if (units === 0n) return '0';
  let digits = units.toString();
  let fraction = '';
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
    digits = digits.slice(0, digits.length - scale);
  }
  return `${negative ? '-' : ''}${digits}${fraction === '' ? '' : `.${fraction}`}`;
}

/** The domain invariant of the exported helpers: both inputs canonical, or the throw is a programming error. */
function requireParsed(a: string, b: string): [ParsedDecimal, ParsedDecimal] {
  const left = parseCanonicalSigned(a);
  const right = parseCanonicalSigned(b);
  if (left === null || right === null) {
    throw new TypeError(`the entitlements exact-decimal helpers require canonical decimal strings (got ${JSON.stringify(a)}, ${JSON.stringify(b)}) — run the record guards first`);
  }
  return [left, right];
}

/** Parse one canonical decimal for a single-argument helper (throws on non-canonical input). */
function requireOne(v: string, operation: string): ParsedDecimal {
  const parsed = parseCanonicalSigned(v);
  if (parsed === null) {
    throw new TypeError(`${operation} requires a canonical decimal string (got ${JSON.stringify(v)})`);
  }
  return parsed;
}

/**
 * Exact SIGNED addition over the canonical decimal grammar (BigInt
 * fixed-point; the local mirror of the program-wide kernel's signed
 * extension — byte-identical to @tradrl/firm-memory's `signedAdd`; the
 * interop test pins the parity). Inputs MUST be canonical (the guards
 * enforce that); non-canonical input throws (a programming error, not
 * a domain error).
 */
export function signedAdd(a: string, b: string): string {
  const [left, right] = requireParsed(a, b);
  const scale = Math.max(left.scale, right.scale);
  const leftUnits = rescaled(left, scale);
  const rightUnits = rescaled(right, scale);
  const sum = (left.negative ? -leftUnits : leftUnits) + (right.negative ? -rightUnits : rightUnits);
  return formatSigned(sum < 0n, sum < 0n ? -sum : sum, scale);
}

/** Exact SIGNED subtraction (`a - b`) over the canonical decimal grammar. */
export function signedSubtract(a: string, b: string): string {
  return signedAdd(a, signedNegate(b));
}

/** Exact negation (`-a`); `-0` normalizes to `0`. */
export function signedNegate(a: string): string {
  const parsed = requireOne(a, 'signedNegate');
  return formatSigned(!parsed.negative, parsed.units, parsed.scale);
}

/** The exact absolute value (`|a|`). */
export function signedAbs(a: string): string {
  const parsed = requireOne(a, 'signedAbs');
  return formatSigned(false, parsed.units, parsed.scale);
}

/** Exact SIGNED comparison: -1 (`a < b`), 0, 1 (`a > b`). */
export function signedCompare(a: string, b: string): -1 | 0 | 1 {
  const [left, right] = requireParsed(a, b);
  const scale = Math.max(left.scale, right.scale);
  const leftSigned = left.negative ? -rescaled(left, scale) : rescaled(left, scale);
  const rightSigned = right.negative ? -rescaled(right, scale) : rescaled(right, scale);
  return leftSigned < rightSigned ? -1 : leftSigned > rightSigned ? 1 : 0;
}

/** Exact UNSIGNED addition over the canonical unsigned grammar (quantities, allowances). */
export function unsignedAdd(a: string, b: string): string {
  const [left, right] = requireParsed(a, b);
  const scale = Math.max(left.scale, right.scale);
  return formatSigned(false, rescaled(left, scale) + rescaled(right, scale), scale);
}

/** Exact UNSIGNED subtraction (`a - b`, `a >= b` required): the draw-down arithmetic. */
export function unsignedSubtract(a: string, b: string): string {
  const [left, right] = requireParsed(a, b);
  const scale = Math.max(left.scale, right.scale);
  const leftUnits = rescaled(left, scale);
  const rightUnits = rescaled(right, scale);
  if (leftUnits < rightUnits) {
    throw new TypeError(`unsignedSubtract: ${JSON.stringify(a)} < ${JSON.stringify(b)} — a draw-down never goes negative (run the exhaustion guard first)`);
  }
  return formatSigned(false, leftUnits - rightUnits, scale);
}

/**
 * Exact decimal MULTIPLICATION (`a * b`): the units multiply, the
 * scales add, the product formats back into the canonical grammar with
 * trailing zeros stripped. This is the metered-pricing operation
 * (`rate x units`), exact for every input scale (no rounding exists in
 * this lane — an unrepresentable result is impossible by construction).
 */
export function decimalMultiply(a: string, b: string): string {
  const [left, right] = requireParsed(a, b);
  const units = left.units * right.units;
  const negative = left.negative !== right.negative;
  return formatSigned(negative, units, left.scale + right.scale);
}
