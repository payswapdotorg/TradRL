// @tradrl/domain-core — shared provider-neutral primitive contracts.
// Timestamps (ISO-8601 with explicit offset), decimal strings, asset classes,
// data categories and hand-rolled guard helpers used across all domain modules.
//
// Laws honored here (spec/ARCHITECTURE-LOCK.md):
// - L4 point-in-time truth: every timestamp carries an explicit UTC offset.
// - L13 provider neutrality: no vendor-specific value formats.
// - L20 safety outside prompts: guards are strict, fail-closed and total.

/** Nominal branding helper — compile-time only, erased at runtime. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * Escape hatch for closed-vocabulary string unions that must remain open to
 * future registered values without contract-version churn (e.g. OrderKind).
 * Literals keep autocomplete; arbitrary strings remain assignable.
 */
export type OpenString = string & Record<never, never>;

/**
 * Instant in time encoded as an RFC 3339 / ISO-8601 string with a MANDATORY
 * explicit UTC offset ("Z" or "+HH:MM"). Calendar date and wall-clock time
 * without an offset are invalid. Deeper time semantics (event/source/
 * available/ingestion time) are owned by the time-engine lane (T004).
 */
export type Timestamp = Brand<string, 'Timestamp'>;

/**
 * Exact decimal encoded as a canonical string, e.g. "1234.5678", "-3.5", "0".
 * Canonical form: optional leading "-", integer part without leading zeros
 * ("0" allowed), optional fractional part with at least one digit, no
 * trailing ".", no "-0". Chosen over IEEE-754 numbers so contract data is
 * precision-safe, JSON-portable and provider-neutral.
 */
export type DecimalString = Brand<string, 'DecimalString'>;

/** Asset classes tradable on venues. Closed vocabulary; extension = contract version bump. */
export type AssetClass =
  | 'crypto'
  | 'equity'
  | 'index'
  | 'future'
  | 'option'
  | 'fx'
  | 'commodity'
  | 'bond';

export const ASSET_CLASSES: readonly AssetClass[] = [
  'crypto',
  'equity',
  'index',
  'future',
  'option',
  'fx',
  'commodity',
  'bond',
] as const;

/** Categories of data a project may consume (spec/ADAPTERS.md). */
export type DataCategory =
  | 'market-data'
  | 'macro'
  | 'news'
  | 'social'
  | 'alternative'
  | 'corporate-actions'
  | 'reference-data';

export const DATA_CATEGORIES: readonly DataCategory[] = [
  'market-data',
  'macro',
  'news',
  'social',
  'alternative',
  'corporate-actions',
  'reference-data',
] as const;

// ---------------------------------------------------------------------------
// Guard helpers (hand-rolled; no external validation libraries, no `any`)
// ---------------------------------------------------------------------------

/** Structural guard: a plain, non-array, non-null object. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Guard: a string with at least one character (whitespace-only is rejected). */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Guard: a finite JS number (NaN, +/-Infinity rejected). */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Guard: a finite number in the closed interval [0, 1]. */
export function isUnitInterval(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && v <= 1;
}

const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Guard: RFC 3339 timestamp with explicit offset and a real calendar date/time. */
export function isTimestamp(v: unknown): v is Timestamp {
  if (typeof v !== 'string' || !TIMESTAMP_PATTERN.test(v)) return false;
  return Number.isFinite(Date.parse(v));
}

const DECIMAL_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;
const NEGATIVE_DECIMAL_PATTERN = /^-(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Guard: canonical decimal string. Rejects ".5", "5.", "01.2", "-0", "1e5",
 * "NaN", leading/trailing whitespace and any non-string.
 */
export function isDecimalString(v: unknown): v is DecimalString {
  if (typeof v !== 'string') return false;
  if (v === '-0') return false; // negative zero is not canonical
  return DECIMAL_PATTERN.test(v) || NEGATIVE_DECIMAL_PATTERN.test(v);
}

/** Precondition: `a` is a valid DecimalString. True when its value is > 0. */
export function isPositiveDecimal(a: DecimalString): boolean {
  return compareDecimal(a, ZERO) > 0;
}

/** Precondition: `a` is a valid DecimalString. True when its value is >= 0. */
export function isNonNegativeDecimal(a: DecimalString): boolean {
  return compareDecimal(a, ZERO) >= 0;
}

const ZERO = '0' as DecimalString;

/** Guard: value is one of the closed AssetClass vocabulary. */
export function isAssetClass(v: unknown): v is AssetClass {
  return isNonEmptyString(v) && (ASSET_CLASSES as readonly string[]).includes(v);
}

/** Guard: value is one of the closed DataCategory vocabulary. */
export function isDataCategory(v: unknown): v is DataCategory {
  return isNonEmptyString(v) && (DATA_CATEGORIES as readonly string[]).includes(v);
}

const IDENTIFIER_PATH_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/;

/**
 * Guard: dot-separated identifier path (e.g. "portfolio.grossExposure",
 * "pnl.realized"). Used for constraint subjects, context map keys and outcome
 * metric keys. Segments start with a letter; digits/underscores allowed after.
 */
export function isIdentifierPath(v: unknown): v is string {
  return typeof v === 'string' && IDENTIFIER_PATH_PATTERN.test(v);
}

/** True when the array has no duplicate entries (string identity). */
export function hasNoDuplicates(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function compareIntegerPart(a: string, b: string): -1 | 0 | 1 {
  const as = a.replace(/^0+(?=\d)/, '');
  const bs = b.replace(/^0+(?=\d)/, '');
  if (as.length !== bs.length) return as.length < bs.length ? -1 : 1;
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function compareMagnitude(a: string, b: string): -1 | 0 | 1 {
  const [ai, af = ''] = a.split('.');
  const [bi, bf = ''] = b.split('.');
  const intCmp = compareIntegerPart(ai, bi);
  if (intCmp !== 0) return intCmp;
  const width = Math.max(af.length, bf.length);
  const afP = af.padEnd(width, '0');
  const bfP = bf.padEnd(width, '0');
  return afP < bfP ? -1 : afP > bfP ? 1 : 0;
}

/**
 * Exact decimal comparison on canonical decimal strings (no float rounding).
 * Precondition: both arguments are valid DecimalStrings.
 */
export function compareDecimal(a: DecimalString, b: DecimalString): -1 | 0 | 1 {
  const negA = a.startsWith('-');
  const negB = b.startsWith('-');
  if (negA !== negB) return negA ? -1 : 1;
  const magnitude = compareMagnitude(negA ? a.slice(1) : a, negB ? b.slice(1) : b);
  if (magnitude === 0) return 0;
  return negA ? (magnitude > 0 ? -1 : 1) : magnitude;
}

/**
 * Chronological comparison of two valid timestamps (numeric instant order,
 * independent of the textual offset representation).
 * Precondition: both arguments are valid Timestamps.
 */
export function compareTimestamps(a: Timestamp, b: Timestamp): -1 | 0 | 1 {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}
