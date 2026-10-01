/**
 * @tradrl/evaluation-integrity — exact decimal-string numerics (Work Order T031).
 *
 * STRUCTURAL MIRROR of the program-wide decimal discipline
 * (@tradrl/market-protocol's lexical forms; @tradrl/body-sentiment-researcher's
 * scaled-bigint arithmetic — law D-004: the lexical forms and comparison
 * semantics are the program-wide law). The selection-effect audit computes
 * MEANS and DIFFERENCES over per-trial statistics; running those in binary
 * floating point would bake a rounding hazard into the exact numbers that
 * quantify overfitting. All arithmetic runs on SCALED BIGINTS
 * (value * 10^scale), rendered back to fixed-scale decimal strings. No
 * float is ever constructed — the determinism law (same inputs ->
 * byte-identical outputs) holds exactly, not approximately.
 *
 * Forms (mirrored exactly):
 * - unsigned decimal: /^\d+(\.\d+)?$/          e.g. "0.5", "1", "0.2500"
 * - signed decimal:   /^[+-]?\d+(\.\d+)?$/     e.g. "-0.0021", "+3.14"
 */

/** A precision-safe base-10 numeric string. */
export type DecimalString = string;

/** The declared rounding modes for scaled arithmetic. */
export const ROUNDING_MODES = ['half-even', 'truncate'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

const UNSIGNED_DECIMAL_RE = /^\d+(?:\.\d+)?$/;
const SIGNED_DECIMAL_RE = /^[+-]?\d+(?:\.\d+)?$/;

/** Guard: a well-formed unsigned decimal. */
export function isUnsignedDecimal(value: unknown): value is string {
  return typeof value === 'string' && UNSIGNED_DECIMAL_RE.test(value);
}

/** Guard: a well-formed signed decimal. */
export function isSignedDecimal(value: unknown): value is string {
  return typeof value === 'string' && SIGNED_DECIMAL_RE.test(value);
}

/** The number of fractional digits of a well-formed decimal string. */
export function decimalScale(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

interface ParsedDecimal {
  readonly sign: 1 | -1;
  readonly int: string;
  readonly frac: string;
}

function parseDecimal(value: string): ParsedDecimal {
  let sign: 1 | -1 = 1;
  let body = value;
  if (body.startsWith('-')) {
    sign = -1;
    body = body.slice(1);
  } else if (body.startsWith('+')) {
    body = body.slice(1);
  }
  const dot = body.indexOf('.');
  const int = (dot === -1 ? body : body.slice(0, dot)) || '0';
  const frac = dot === -1 ? '' : body.slice(dot + 1);
  return { sign, int, frac };
}

function isZero(parsed: ParsedDecimal): boolean {
  return /^0*$/.test(parsed.int) && /^0*$/.test(parsed.frac);
}

function compareMagnitude(x: ParsedDecimal, y: ParsedDecimal): -1 | 0 | 1 {
  const xs = x.int + x.frac;
  const ys = y.int + y.frac;
  const len = Math.max(xs.length, ys.length);
  const a = xs.padEnd(len, '0');
  const b = ys.padEnd(len, '0');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Exact three-way comparison of two decimal strings: -1 / 0 / 1. Total over
 * well-formed decimals (callers validate first).
 */
export function compareDecimals(a: DecimalString, b: DecimalString): -1 | 0 | 1 {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  if (isZero(x) && isZero(y)) return 0;
  if (x.sign !== y.sign) return x.sign === 1 ? 1 : -1;
  const mag = compareMagnitude(x, y);
  if (mag === 0) return 0;
  return x.sign === 1 ? mag : (-mag as -1 | 1);
}

/** Decimal equality (exact value equality, independent of representation scale). */
export function decimalsEqual(a: DecimalString, b: DecimalString): boolean {
  return compareDecimals(a, b) === 0;
}

/** The maximum of two decimals. */
export function maxDecimal(a: DecimalString, b: DecimalString): DecimalString {
  return compareDecimals(a, b) >= 0 ? a : b;
}

// ---------------------------------------------------------------------------
// Scaled bigint arithmetic (the exact lane)
// ---------------------------------------------------------------------------

/**
 * Parse a decimal string to a signed scaled bigint at the GIVEN scale.
 * Precondition: `scale >= decimalScale(value)` (callers widen to the max
 * scale first) — the exactness of every operation above depends on it.
 */
function parseToScaled(value: DecimalString, scale: number): bigint {
  const parsed = parseDecimal(value);
  const valueScale = decimalScale(value);
  const digits = (parsed.int + parsed.frac) || '0';
  const magnitude = BigInt(digits === '' ? '0' : digits) * 10n ** BigInt(Math.max(0, scale - valueScale));
  return parsed.sign === -1 ? -magnitude : magnitude;
}

/** Render a signed scaled bigint at a scale: value / 10^scale, fixed scale. */
function renderScaled(scaled: bigint, scale: number): DecimalString {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  if (scale === 0) return `${negative && abs !== 0n ? '-' : ''}${abs.toString()}`;
  const digits = abs.toString().padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale);
  return `${negative && abs !== 0n ? '-' : ''}${int}.${frac}`;
}

/**
 * Exact addition of decimal strings, rendered at the max of the two scales
 * (addition is exact at the wider scale). Total over well-formed decimals.
 */
export function addDecimals(a: DecimalString, b: DecimalString): DecimalString {
  const scale = Math.max(decimalScale(a), decimalScale(b));
  return renderScaled(parseToScaled(a, scale) + parseToScaled(b, scale), scale);
}

/**
 * Exact subtraction (a - b), rendered at the max of the two scales.
 * Subtraction is exact at the wider scale.
 */
export function subtractDecimals(a: DecimalString, b: DecimalString): DecimalString {
  const scale = Math.max(decimalScale(a), decimalScale(b));
  return renderScaled(parseToScaled(a, scale) - parseToScaled(b, scale), scale);
}

/**
 * EXACT MEAN of a non-empty list of decimal strings at a DECLARED scale,
 * half-even rounded. Every term must carry AT MOST the declared scale
 * (narrower terms widen exactly by zero padding); a term WIDER than the
 * declared scale cannot be represented exactly and throws — the audit path
 * rejects such terms typed (`scale_mismatch`) BEFORE ever reaching here.
 * The sum is exact; the single division rounds half-even; no float is ever
 * constructed. Deterministic: the same terms and scale always produce the
 * same mean string.
 */
export function meanDecimals(values: readonly DecimalString[], scale: number): DecimalString {
  if (values.length === 0) throw new RangeError('meanDecimals: at least one value is required');
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new RangeError(`meanDecimals: scale must be an integer in [0, 18], got ${scale}`);
  }
  let sum = 0n;
  for (const value of values) {
    if (decimalScale(value) > scale) {
      throw new RangeError(`meanDecimals: term "${value}" carries scale ${decimalScale(value)} wider than the declared scale ${scale}`);
    }
    sum += parseToScaled(value, scale);
  }
  const count = BigInt(values.length);
  const negative = sum < 0n;
  const absSum = negative ? -sum : sum;
  const quotient = absSum / count;
  const remainder = absSum % count;
  const twice = 2n * remainder;
  let magnitude: bigint;
  if (twice > count) {
    magnitude = quotient + 1n;
  } else if (twice === count) {
    // Exactly half: half-even rounds to the even neighbor.
    magnitude = quotient % 2n === 0n ? quotient : quotient + 1n;
  } else {
    magnitude = quotient;
  }
  return renderScaled(negative ? -magnitude : magnitude, scale);
}

/**
 * Guard: a decimal string at EXACTLY the declared scale (the audit's
 * statistic conformance law — `scale_mismatch` otherwise).
 */
export function isDecimalAtScale(value: unknown, scale: number): value is DecimalString {
  if (!isSignedDecimal(value)) return false;
  return decimalScale(value) === scale;
}

/** Normalize a decimal string to canonical rendering at its own scale (leading zeros and + sign removed). */
export function normalizeDecimal(value: DecimalString): DecimalString {
  const scale = decimalScale(value);
  return renderScaled(parseToScaled(value, scale), scale);
}
