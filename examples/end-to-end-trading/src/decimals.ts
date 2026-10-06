// @tradrl/example-e2e-trading — exact decimal-string arithmetic.
//
// STRUCTURAL MIRROR of the program-wide decimal law (@tradrl/market-protocol
// grammar; scaled-BigInt arithmetic as in @tradrl/body-trading-director's and
// @tradrl/body-execution's decimals modules). Every numeric record in this
// slice is an exact decimal STRING; a JavaScript number in a money/quantity
// position is a typed error (`decimal_imprecision`) — floats never mediate.
//
// Grammar mirrors:
//   - loose unsigned/signed decimals accept any plain decimal string;
//   - the CANONICAL grammar (no leading zeros, no "-0") is enforced where
//     the execution lane enforces it (order quantities, fill prices).

import { type JsonValue, canonicalJson } from './primitives';

/** A decimal string (the money/quantity representation — never a float). */
export type DecimalString = string;

const UNSIGNED_DECIMAL = /^\d+(?:\.\d+)?$/;
const SIGNED_DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;
const CANONICAL_DECIMAL = /^(0|[1-9]\d*)(?:\.\d+)?$/;

/** The declared rounding modes (mirrored from the director/execution lanes). */
export const ROUNDING_MODES = ['half-even', 'half-up', 'truncate'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

/** Guard: a well-formed unsigned decimal string. */
export function isUnsignedDecimal(value: unknown): value is string {
  return typeof value === 'string' && UNSIGNED_DECIMAL.test(value);
}

/** Guard: a well-formed signed decimal string. */
export function isSignedDecimal(value: unknown): value is string {
  return typeof value === 'string' && SIGNED_DECIMAL.test(value);
}

/** Guard: a CANONICAL decimal string (no leading zeros, no plus, no "-0"). */
export function isCanonicalDecimal(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_DECIMAL.test(value);
}

/** Guard: a canonical decimal that is strictly positive (rejects '0'/'0.00'). */
export function isCanonicalPositiveDecimal(value: unknown): value is string {
  return isCanonicalDecimal(value) && !isZeroDecimal(value);
}

/** Parses a (possibly signed) decimal into a scaled BigInt at `scale`. */
function parseScaled(value: string, scale: number): bigint {
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value.startsWith('+') ? value.slice(1) : value;
  const dot = body.indexOf('.');
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? '' : body.slice(dot + 1);
  const digits = BigInt(intPart + fracPart.padEnd(scale, '0'));
  return negative ? -digits : digits;
}

/** Renders a scaled BigInt back to a decimal string at exactly `scale` digits. */
function renderScaled(scaled: bigint, scale: number): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const text = abs.toString().padStart(scale + 1, '0');
  const intPart = scale === 0 ? text : text.slice(0, text.length - scale);
  const fracPart = scale === 0 ? '' : `.${text.slice(text.length - scale)}`;
  const zero = intPart === '0' && (scale === 0 || /^0*$/.test(fracPart));
  const out = zero ? (scale === 0 ? '0' : `0${fracPart}`) : `${intPart}${fracPart}`;
  return negative && !zero ? `-${out}` : out;
}

/**
 * Rescales a raw scaled BigInt from one scale to another (exact upscaling;
 * declared rounding on downscaling). THE core of every operation: values
 * always compute at the max of (target scale, every input scale), then
 * rescale to the target — never double-scaled.
 */
function rescale(raw: bigint, fromScale: number, toScale: number, rounding: RoundingMode): bigint {
  if (toScale === fromScale) return raw;
  if (toScale > fromScale) return raw * 10n ** BigInt(toScale - fromScale);
  const divisor = 10n ** BigInt(fromScale - toScale);
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const quotient = abs / divisor;
  const remainder = abs % divisor;
  const half = divisor / 2n;
  let rounded = quotient;
  if (rounding === 'half-up') {
    if (remainder >= half) rounded = quotient + 1n;
  } else if (rounding === 'half-even') {
    if (remainder > half || (remainder === half && quotient % 2n === 1n)) rounded = quotient + 1n;
  }
  return negative ? -rounded : rounded;
}

/** Exact comparison: -1 | 0 | 1 (scale-free). */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  const left = parseScaled(a, scale);
  const right = parseScaled(b, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The number of fractional digits of a decimal string. */
function scaleOf(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

/** Guard: the decimal is exactly zero. */
export function isZeroDecimal(value: string): boolean {
  return parseScaled(value, scaleOf(value)) === 0n;
}

/** Guard: an unsigned decimal strictly greater than zero. */
export function isPositiveDecimal(value: unknown): value is string {
  return isUnsignedDecimal(value) && !isZeroDecimal(value);
}

/** Guard: a signed decimal strictly greater than zero. */
export function isSignedPositiveDecimal(value: unknown): value is string {
  return isSignedDecimal(value) && compareDecimal(value, '0') > 0;
}

/** Absolute value at the declared scale. */
export function decimalAbs(value: string, scale: number, rounding: RoundingMode): string {
  const parsed = parseSignedForMath(value);
  const from = scaleOf(parsed);
  const scaled = parseScaled(parsed, from);
  const rescaled = rescale(scaled < 0n ? -scaled : scaled, from, scale, rounding);
  return renderScaled(rescaled, scale);
}

/** Renders any decimal at exactly `scale` fractional digits. */
export function decimalAt(value: string, scale: number, rounding: RoundingMode): string {
  const parsed = parseSignedForMath(value);
  const from = scaleOf(parsed);
  const rescaled = rescale(parseScaled(parsed, from), from, scale, rounding);
  return renderScaled(rescaled, scale);
}

/** Exact sum of a list at the declared scale. */
export function decimalSum(
  values: readonly string[],
  scale: number,
  rounding: RoundingMode,
): string {
  if (values.length === 0) return renderScaled(0n, scale);
  const work = Math.max(scale, ...values.map((v) => scaleOf(parseSignedForMath(v))));
  const total = values.reduce<bigint>(
    (acc, v) => acc + parseScaled(parseSignedForMath(v), work),
    0n,
  );
  return renderScaled(rescale(total, work, scale, rounding), scale);
}

/** Exact subtraction (a - b) at the declared scale. */
export function decimalSubtract(
  a: string,
  b: string,
  scale: number,
  rounding: RoundingMode,
): string {
  const left = parseSignedForMath(a);
  const right = parseSignedForMath(b);
  const work = Math.max(scale, scaleOf(left), scaleOf(right));
  const total = parseScaled(left, work) - parseScaled(right, work);
  return renderScaled(rescale(total, work, scale, rounding), scale);
}

/** Exact product at the declared scale. */
export function decimalMultiply(
  a: string,
  b: string,
  scale: number,
  rounding: RoundingMode,
): string {
  const left = parseSignedForMath(a);
  const right = parseSignedForMath(b);
  // A = a's integer digits (a = A/10^sa); B likewise. A*B is the product at
  // scale (sa+sb) — NEVER parse both at a common scale (that doubles it).
  const sa = scaleOf(left);
  const sb = scaleOf(right);
  const product = parseScaled(left, sa) * parseScaled(right, sb);
  return renderScaled(rescale(product, sa + sb, scale, rounding), scale);
}

/** Exact division a / b at the declared scale (b must be non-zero). */
export function decimalDivide(
  a: string,
  b: string,
  scale: number,
  rounding: RoundingMode,
): string {
  const left = parseSignedForMath(a);
  const right = parseSignedForMath(b);
  const wa = scaleOf(left);
  const wb = scaleOf(right);
  const A = parseScaled(left, wa);
  const B = parseScaled(right, wb);
  if (B === 0n) {
    throw new TypeError('decimalDivide: division by zero');
  }
  // value at scale s = (A * 10^(s + wb)) / (B * 10^wa), rounded at the last digit.
  const numerator = A * 10n ** BigInt(scale + wb);
  const denominator = B * 10n ** BigInt(wa);
  const negative = numerator < 0n !== denominator < 0n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;
  const quotient = absNum / absDen;
  const remainder = absNum % absDen;
  const half = absDen / 2n;
  let rounded = quotient;
  if (rounding === 'half-up') {
    if (remainder * 2n >= absDen) rounded = quotient + 1n;
  } else if (rounding === 'half-even') {
    if (remainder * 2n > absDen || (remainder * 2n === absDen && quotient % 2n === 1n)) rounded = quotient + 1n;
  }
  return renderScaled(negative ? -rounded : rounded, scale);
}

/** Exact mean of a list at the declared scale (empty list is a typed error). */
export function decimalMean(
  values: readonly string[],
  scale: number,
  rounding: RoundingMode,
): string {
  if (values.length === 0) {
    throw new TypeError('decimalMean: empty list');
  }
  const total = decimalSum(values, scale + 4, rounding);
  return decimalDivide(total, String(values.length), scale, rounding);
}

/** Normalized signed value: strips a leading '+' so canonical forms agree. */
function parseSignedForMath(value: string): string {
  return value.startsWith('+') ? value.slice(1) : value;
}

/**
 * Floors a decimal DOWN to the nearest multiple of `step` (the lot/tick
 * grid discipline of the exchange lane). Negative values floor toward zero
 * (lot flooring is only ever applied to unsigned quantities here).
 */
export function floorToStep(value: string, step: string): string {
  const scale = Math.max(scaleOf(parseSignedForMath(value)), scaleOf(parseSignedForMath(step)));
  const scaledValue = parseScaled(parseSignedForMath(value), scale);
  const scaledStep = parseScaled(parseSignedForMath(step), scale);
  if (scaledStep <= 0n) {
    throw new TypeError('floorToStep: step must be positive');
  }
  const floored = scaledValue >= 0n ? (scaledValue / scaledStep) * scaledStep : scaledValue;
  return renderScaled(floored, scale);
}

/**
 * Splits a signed decimal into sign and magnitude for tilt math
 * (the director synthesis lane's sign discipline).
 */
export function signAndMagnitude(value: string): { sign: 1 | -1 | 0; magnitude: string } {
  const cmp = compareDecimal(value, '0');
  if (cmp === 0) return { sign: 0, magnitude: decimalAt(value, 1, 'half-even') };
  const negative = cmp < 0;
  const body = negative ? (value.startsWith('-') ? value.slice(1) : value) : value;
  return {
    sign: negative ? -1 : 1,
    magnitude: body.startsWith('+') ? body.slice(1) : body,
  };
}

/** Renders a signed decimal from sign and magnitude parts. */
export function signedOf(sign: 1 | -1 | 0, magnitude: string): string {
  if (sign === 0 || isZeroDecimal(magnitude)) return decimalAt(magnitude, 1, 'half-even');
  return sign === -1 ? `-${magnitude}` : magnitude;
}

/** Canonical JSON helper re-export for record builders in this module's image. */
export function decimalDigest(value: unknown): string {
  return canonicalJson(value as JsonValue);
}
