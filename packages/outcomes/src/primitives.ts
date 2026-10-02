/**
 * @tradrl/outcomes — the zero-dependency structural primitives (the
 * lane-local foundation every outcomes module shares).
 *
 * Mirrors the sibling lanes' `primitives.ts` discipline (trajectory,
 * experiments, evaluation, shadow-trading): no runtime dependencies,
 * hand-rolled total guards, the deep-freeze discipline, canonical JSON
 * (sorted keys, minimal separators — the program-wide byte-identity
 * grammar) and the FNV-1a 32-bit digest.
 *
 * THE EXACT-DECIMAL LAW (local): every numeric record in this lane is
 * a canonical decimal STRING. The signed add/subtract/compare helpers
 * below are the LOCAL BigInt fixed-point mirror of the program-wide
 * grammar (@tradrl/execution-policy's decimals kernel — the same
 * `(0|[1-9]\d*)(\.\d+)?` canonical form, exact integers all the way
 * down, no float mediation). This package never imports that kernel
 * (D-003/D-004: zero workspace imports); services/outcome-learning's
 * interop test is the drift trip wire — it asserts byte-parity between
 * these helpers and the REAL kernel over a corpus of canonical pairs.
 *
 * A JS number on a money/confidence path is the typed
 * `decimal_imprecision` (enforced by the record guards in
 * outcome-record.ts / postmortem.ts, never here).
 */

// ---------------------------------------------------------------------------
// JSON value model
// ---------------------------------------------------------------------------

/** A JSON value (the serialization grammar every record obeys). */
export type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

/** A JSON object. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** Guard: a plain object record (NOT an array, NOT null). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Guard: a non-empty string. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Guard: a finite number. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Guard: a non-negative safe integer. */
export function isNonNegativeSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** Guard: a positive safe integer. */
export function isPositiveSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
}

/** Guard: a member of a closed vocabulary. */
export function isMemberOf<T extends string>(vocabulary: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (vocabulary as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Timestamps (the time-engine brand, mirrored)
// ---------------------------------------------------------------------------

/**
 * Epoch milliseconds — the canonical program-wide `TradRL.TimestampMs`
 * brand (time-engine's tag, mirrored by every lane: the brand strings
 * match, so the mirrors are mutually assignable).
 */
export type TimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };

/** Cast a plain number to a timestamp (fixture/internal literal sites only). */
export function asTimestampMs(ms: number): TimestampMs {
  return ms as TimestampMs;
}

export const MIN_TIMESTAMP_MS = 0;
export const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

/** Guard: an epoch-ms timestamp. */
export function isTimestampMs(v: unknown): v is TimestampMs {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= MIN_TIMESTAMP_MS && v <= MAX_TIMESTAMP_MS;
}

// ---------------------------------------------------------------------------
// The deep-freeze discipline
// ---------------------------------------------------------------------------

/** Recursively freeze a value (the contract-package discipline: records are immutable evidence). */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** `true` iff a value is deeply frozen (the guard half of the discipline). */
export function isDeeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!isDeeplyFrozen((value as Record<string, unknown>)[key])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Canonical JSON + digests (byte-identity grammar)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON: keys sorted lexicographically, no whitespace, JSON
 * escaping — identical values always serialize to identical bytes (the
 * program-wide determinism grammar; mirrors every sibling lane's
 * `canonicalJson`).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** FNV-1a 32-bit of a string, as zero-padded lowercase hex (the program-wide derivation). */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Guard: an 8-hex-digit digest (the fnv1a32Hex form). */
export function isDigest(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}$/.test(v);
}

// ---------------------------------------------------------------------------
// The canonical decimal grammar (exact decimals — the string money law)
// ---------------------------------------------------------------------------

/** The canonical unsigned decimal grammar: `0`, `12`, `3.5` — never `-0`, never leading zeros, never trailing `.`, never a bare `.`. */
export const UNSIGNED_DECIMAL_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;

/** The canonical signed decimal grammar: an optional leading `-` over the unsigned form (never `-0`). */
export const SIGNED_DECIMAL_PATTERN = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** Guard: a canonical UNSIGNED decimal string. */
export function isCanonicalUnsignedDecimal(v: unknown): v is string {
  return typeof v === 'string' && UNSIGNED_DECIMAL_PATTERN.test(v);
}

/** Guard: a canonical SIGNED decimal string (`-0` is not canonical; zero is `0`). */
export function isCanonicalSignedDecimal(v: unknown): v is string {
  return typeof v === 'string' && SIGNED_DECIMAL_PATTERN.test(v);
}

/**
 * Guard: a canonical unit-interval decimal — a confidence. The value
 * must be a canonical unsigned decimal in [0, 1]: `0`, `0.x…`, `1` or
 * `1.0…` (all-zero fraction). A confidence outside the unit interval
 * is the typed `confidence_incoherent` at the record guards.
 */
export function isUnitIntervalDecimal(v: unknown): v is string {
  if (!isCanonicalUnsignedDecimal(v)) return false;
  const [intPart, fracPart = ''] = (v as string).split('.');
  if (intPart === '0') return true;
  if (intPart === '1') return /^0*$/.test(fracPart);
  return false;
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
    throw new TypeError(`the outcomes exact-decimal helpers require canonical decimal strings (got ${JSON.stringify(a)}, ${JSON.stringify(b)}) — run the record guards first`);
  }
  return [left, right];
}

/**
 * Exact SIGNED addition over the canonical decimal grammar (BigInt
 * fixed-point; the local mirror of the program-wide kernel's signed
 * extension). Inputs MUST be canonical (the guards enforce that);
 * non-canonical input throws (a programming error, not a domain error).
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
  const parsed = parseCanonicalSigned(a);
  if (parsed === null) {
    throw new TypeError(`signedNegate requires a canonical decimal string (got ${JSON.stringify(a)})`);
  }
  return formatSigned(!parsed.negative, parsed.units, parsed.scale);
}

/** The exact absolute value (`|a|`). */
export function signedAbs(a: string): string {
  const parsed = parseCanonicalSigned(a);
  if (parsed === null) {
    throw new TypeError(`signedAbs requires a canonical decimal string (got ${JSON.stringify(a)})`);
  }
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

/** Exact UNSIGNED addition over the canonical unsigned grammar (quantities, fees, notionals). */
export function unsignedAdd(a: string, b: string): string {
  const [left, right] = requireParsed(a, b);
  const scale = Math.max(left.scale, right.scale);
  return formatSigned(false, rescaled(left, scale) + rescaled(right, scale), scale);
}

/** `true` iff the canonical (signed or unsigned) decimal is exactly zero. */
export function isZeroDecimal(a: string): boolean {
  const parsed = parseCanonicalSigned(a);
  return parsed !== null && parsed.units === 0n;
}
