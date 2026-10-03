/**
 * @tradrl/research-benchmarks — exact decimal-string numerics (Work Order
 * T032).
 *
 * STRUCTURAL MIRROR of the program-wide decimal discipline
 * (@tradrl/market-protocol's lexical forms; @tradrl/evaluation-integrity's
 * and @tradrl/evaluation-splits's scaled-bigint arithmetic — law D-004).
 * The benchmark suite's SCORES, stress magnitudes and their compositions
 * are exact decimals: running benchmark arithmetic in binary floating
 * point would bake rounding hazards into the exact numbers that quantify
 * performance under stress. All arithmetic runs on SCALED BIGINTS
 * (value * 10^scale), rendered back to decimal strings; the single
 * rendering to the benchmark's declared score scale rounds ONCE,
 * half-even. No float is ever constructed.
 *
 * This lane's exact extensions over the shared mirror (documented, tested):
 * - `mulDecimals` — exact multiplication (scales add).
 * - `divByPowerOfTen` — exact division by 10^n (the decimal point moves;
 *   always exact).
 * - `meanAtScale` — the exact mean of terms of ARBITRARY scale rendered at
 *   a declared scale with a single half-even rounding at the end (the
 *   stress-adjusted pnl terms can be wider than the declared score scale;
 *   the benchmark law is one rounding, at the record boundary).
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

/** Exact three-way comparison of two decimal strings: -1 / 0 / 1. */
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

// ---------------------------------------------------------------------------
// Scaled bigint arithmetic (the exact lane)
// ---------------------------------------------------------------------------

/** Parse a decimal string to a signed scaled bigint at the GIVEN scale (scale >= decimalScale(value)). */
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

/** Exact addition, rendered at the max of the two scales. */
export function addDecimals(a: DecimalString, b: DecimalString): DecimalString {
  const scale = Math.max(decimalScale(a), decimalScale(b));
  return renderScaled(parseToScaled(a, scale) + parseToScaled(b, scale), scale);
}

/** Exact subtraction (a - b), rendered at the max of the two scales. */
export function subtractDecimals(a: DecimalString, b: DecimalString): DecimalString {
  const scale = Math.max(decimalScale(a), decimalScale(b));
  return renderScaled(parseToScaled(a, scale) - parseToScaled(b, scale), scale);
}

/** Exact multiplication (scales add): a * b, rendered at scale(a) + scale(b). */
export function mulDecimals(a: DecimalString, b: DecimalString): DecimalString {
  const aScale = decimalScale(a);
  const bScale = decimalScale(b);
  // The RAW scaled values multiply; rendering at the summed scale divides
  // by 10^(aScale + bScale) — exactly a * b.
  const scaled = parseToScaled(a, aScale) * parseToScaled(b, bScale);
  return renderScaled(scaled, aScale + bScale);
}

/** Exact division by 10^n (the decimal point moves; always exact). */
export function divByPowerOfTen(value: DecimalString, n: number): DecimalString {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`divByPowerOfTen: n must be a non-negative integer, got ${n}`);
  const scale = decimalScale(value);
  return renderScaled(parseToScaled(value, scale), scale + n);
}

/**
 * The EXACT MEAN of a non-empty list of decimal strings of ARBITRARY scale,
 * rendered at a declared target scale with a SINGLE half-even rounding at
 * the end. Wider-than-target terms are kept exact throughout (widened to
 * the common widest scale), the sum is exact, and the single division
 * rounds half-even at the target scale. Deterministic; no float is ever
 * constructed.
 */
export function meanAtScale(values: readonly DecimalString[], targetScale: number): DecimalString {
  if (values.length === 0) throw new RangeError('meanAtScale: at least one value is required');
  if (!Number.isInteger(targetScale) || targetScale < 0 || targetScale > 18) {
    throw new RangeError(`meanAtScale: targetScale must be an integer in [0, 18], got ${targetScale}`);
  }
  const widest = values.reduce((max, value) => Math.max(max, decimalScale(value)), 0);
  let sum = 0n;
  for (const value of values) {
    sum += parseToScaled(value, widest);
  }
  const count = BigInt(values.length);
  // mean at target scale = (sum / 10^widest / count) * 10^targetScale
  //                      = (sum * 10^targetScale) / (count * 10^widest)
  const numerator = sum * 10n ** BigInt(targetScale);
  const denominator = count * 10n ** BigInt(widest);
  const negative = numerator < 0n;
  const absNumerator = negative ? -numerator : numerator;
  const quotient = absNumerator / denominator;
  const remainder = absNumerator % denominator;
  const twice = 2n * remainder;
  let magnitude: bigint;
  if (twice > denominator) {
    magnitude = quotient + 1n;
  } else if (twice === denominator) {
    magnitude = quotient % 2n === 0n ? quotient : quotient + 1n;
  } else {
    magnitude = quotient;
  }
  return renderScaled(negative ? -magnitude : magnitude, targetScale);
}

/** Guard: a decimal string at EXACTLY the declared scale. */
export function isDecimalAtScale(value: unknown, scale: number): value is DecimalString {
  if (!isSignedDecimal(value)) return false;
  return decimalScale(value) === scale;
}

/** Normalize a decimal string to canonical rendering at its own scale (leading zeros and + sign removed). */
export function normalizeDecimal(value: DecimalString): DecimalString {
  const scale = decimalScale(value);
  return renderScaled(parseToScaled(value, scale), scale);
}

/** Render a decimal string AT a declared scale with a declared rounding mode (single rounding). */
export function roundDecimalToScale(value: DecimalString, scale: number, mode: RoundingMode): DecimalString {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new RangeError(`roundDecimalToScale: scale must be an integer in [0, 18], got ${scale}`);
  }
  const valueScale = decimalScale(value);
  if (valueScale <= scale) {
    return renderScaled(parseToScaled(value, scale), scale);
  }
  const scaled = parseToScaled(value, valueScale);
  const drop = BigInt(valueScale - scale);
  const divisor = 10n ** drop;
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const quotient = abs / divisor;
  const remainder = abs % divisor;
  const twice = 2n * remainder;
  let magnitude: bigint;
  if (mode === 'truncate') {
    magnitude = quotient;
  } else if (twice > divisor) {
    magnitude = quotient + 1n;
  } else if (twice === divisor) {
    magnitude = quotient % 2n === 0n ? quotient : quotient + 1n;
  } else {
    magnitude = quotient;
  }
  return renderScaled(negative ? -magnitude : magnitude, scale);
}
