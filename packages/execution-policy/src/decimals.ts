// @tradrl/execution-policy — exact decimal arithmetic on decimal strings.
//
// STRUCTURAL MIRROR of @tradrl/exchange-sim/src/decimals.ts (T010) and
// @tradrl/trading-strategy/src/decimals.ts (T018, itself the exchange-sim
// mirror) — the laws are re-declared by STRUCTURE, never imported
// (D-003/D-004); the interop test in src/interop.test.ts proves
// arithmetic parity against the REAL exchange-sim module on this branch.
//
// The execution gate's limit checks are MONEY PATHS: order sizes, order
// notionals, post-trade positions and position notionals are compared
// and differenced EXACTLY (BigInt-mediated base-10 fixed-point). Binary
// floating point cannot represent venue ticks or lot sizes exactly, and
// a hard gate whose arithmetic silently approximates is not a hard
// gate. There is no float mediation anywhere in the arithmetic.
//
// DOMAIN DECISION (mirroring the sibling lanes): every value in this
// package's money paths is NON-NEGATIVE (quantities, prices, notionals,
// caps, fees, excesses). The LIMIT EXCESS (observed - cap) is the one
// signed surface — "by how much" can be negative-or-positive evidence —
// but the limit check only ever REPORTS an excess it has already proven
// positive, so the emitted excess is computed over unsigned magnitudes
// and stays non-negative.
//
// The accepted INPUT grammar is the union of the two canonical lanes
// this package mirrors:
//   - observation payload values follow market-protocol's UNSIGNED
//     decimal grammar `/^\d+(\.\d+)?$/` (loose: "01.2" is accepted there);
//   - order-intent price/quantity follow domain-core's canonical grammar
//     `/^(0|[1-9]\d*)(\.\d+)?$/` (strict: no leading zeros, no "-0").
// Internally every accepted value is NORMALIZED to canonical form, so
// all EMITTED decimal strings are canonical and byte-stable (L9).

import { isNonEmptyString } from './primitives';

// ---------------------------------------------------------------------------
// Scaled representation (BigInt fixed-point; never leaves this module)
// ---------------------------------------------------------------------------

/** An exact non-negative decimal parsed to integer digits at a scale. */
interface Scaled {
  /** The value's digits as an integer scaled by 10^scale (>= 0n). */
  readonly digits: bigint;
  /** Number of fractional decimal digits the digits are scaled by. */
  readonly scale: number;
}

/** Parse an unsigned decimal string into exact scaled form; `null` if malformed. */
function parseScaled(value: string): Scaled | null {
  const dot = value.indexOf('.');
  const intPart = dot === -1 ? value : value.slice(0, dot);
  const fracPart = dot === -1 ? '' : value.slice(dot + 1);
  if (intPart.length === 0 && fracPart.length === 0) return null;
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (dot !== -1 && fracPart.length === 0) return null; // "5." is malformed
  const digits = BigInt(`${intPart || '0'}${fracPart}`);
  return { digits, scale: fracPart.length };
}

/** True when a parsed scaled decimal is exactly zero. */
function isZeroScaled(scaled: Scaled): boolean {
  return scaled.digits === 0n;
}

/** Re-scale a scaled decimal to a target scale (>= its own). */
function upScale(scaled: Scaled, targetScale: number): bigint {
  if (targetScale === scaled.scale) return scaled.digits;
  return scaled.digits * 10n ** BigInt(targetScale - scaled.scale);
}

/** The canonical string form of an exact scaled value (no trailing zeros). */
function formatScaled(digits: bigint, scale: number): string {
  const negative = digits < 0n;
  const absolute = negative ? -digits : digits;
  const text = absolute.toString();
  if (scale === 0) return negative ? `-${text}` : text;
  const padded = text.padStart(scale + 1, '0');
  const intPart = padded.slice(0, padded.length - scale);
  let fracPart = padded.slice(padded.length - scale);
  while (fracPart.length > 0 && fracPart.endsWith('0')) fracPart = fracPart.slice(0, -1);
  const body = fracPart.length === 0 ? intPart : `${intPart}.${fracPart}`;
  return negative ? `-${body}` : body;
}

function requireScaled(value: string): Scaled {
  const scaled = parseScaled(value);
  if (scaled === null) throw new Error(`decimal: invalid operand "${value}"`);
  return scaled;
}

// ---------------------------------------------------------------------------
// Guards (the two mirrored grammars)
// ---------------------------------------------------------------------------

/** Market-protocol mirror: unsigned decimal grammar `/^\d+(\.\d+)?$/`. */
export function isUnsignedDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value);
}

/** Domain-core mirror: canonical decimal grammar (no leading zeros, no "-0"). */
export function isCanonicalDecimal(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^(0|[1-9]\d*)(\.\d+)?$/.test(value);
}

/** Canonical grammar AND strictly positive (mirror of domain-core's positive quantity law). */
export function isCanonicalPositiveDecimal(value: unknown): value is string {
  return isCanonicalDecimal(value) && !isZero(value);
}

/** Unsigned grammar AND strictly positive (mirror of market-protocol's isPositiveDecimal). */
export function isPositiveDecimal(value: unknown): value is string {
  return isUnsignedDecimal(value) && !isZero(value);
}

// ---------------------------------------------------------------------------
// Comparison (exact)
// ---------------------------------------------------------------------------

/** Precondition: both arguments are valid unsigned decimals. True iff equal. */
export function isEqual(a: string, b: string): boolean {
  return compare(a, b) === 0;
}

/**
 * EXACT comparison of two unsigned decimals: -1 if a < b, 0 if equal, 1
 * if a > b. Correct beyond float precision. Precondition: both are valid
 * unsigned decimal strings (validate first).
 */
export function compare(a: string, b: string): -1 | 0 | 1 {
  const x = parseScaled(a);
  const y = parseScaled(b);
  if (x === null || y === null) throw new Error(`compare: invalid decimal operand (${a}, ${b})`);
  const scale = Math.max(x.scale, y.scale);
  const xd = upScale(x, scale);
  const yd = upScale(y, scale);
  return xd < yd ? -1 : xd > yd ? 1 : 0;
}

/** Precondition: valid unsigned decimals. True iff the value is exactly zero. */
export function isZero(value: string): boolean {
  const scaled = parseScaled(value);
  if (scaled === null) throw new Error(`isZero: invalid decimal operand (${value})`);
  return isZeroScaled(scaled);
}

// ---------------------------------------------------------------------------
// Arithmetic (exact, non-negative inputs only — the unsigned domain law)
// ---------------------------------------------------------------------------

/** Precondition: valid unsigned decimals. Exact sum, canonical form. */
export function add(a: string, b: string): string {
  const x = requireScaled(a);
  const y = requireScaled(b);
  const scale = Math.max(x.scale, y.scale);
  return formatScaled(upScale(x, scale) + upScale(y, scale), scale);
}

/**
 * Precondition: valid unsigned decimals with `a >= b`. Exact difference,
 * canonical form. Throws on negative results (the unsigned domain law —
 * callers that must not go negative wrap this into typed errors).
 */
export function subtract(a: string, b: string): string {
  const x = requireScaled(a);
  const y = requireScaled(b);
  const scale = Math.max(x.scale, y.scale);
  const difference = upScale(x, scale) - upScale(y, scale);
  if (difference < 0n) throw new Error(`subtract: negative result (${a} - ${b}) — outside the unsigned decimal domain`);
  return formatScaled(difference, scale);
}

/** Precondition: valid unsigned decimals. Exact product, canonical form. */
export function multiply(a: string, b: string): string {
  const x = requireScaled(a);
  const y = requireScaled(b);
  return formatScaled(x.digits * y.digits, x.scale + y.scale);
}

/** Precondition: valid unsigned decimal. The canonical normalized form (input grammar may be loose). */
export function normalize(value: string): string {
  const scaled = requireScaled(value);
  return formatScaled(scaled.digits, scaled.scale);
}

// ---------------------------------------------------------------------------
// Rounding (the ONE explicit approximation — half-up at a declared precision)
// ---------------------------------------------------------------------------

/**
 * Round an unsigned decimal HALF-UP to `decimals` fractional digits.
 * Exact except for the rounding step itself; every division site names
 * its precision explicitly (mirror of exchange-sim's law — the fee
 * computation's rounding site).
 */
export function roundHalfUp(value: string, decimals: number): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0) {
    throw new Error(`roundHalfUp: decimals must be a non-negative safe integer, got ${String(decimals)}`);
  }
  const scaled = requireScaled(value);
  if (scaled.scale <= decimals) return formatScaled(scaled.digits, scaled.scale);
  const shift = BigInt(scaled.scale - decimals);
  const divisor = 10n ** shift;
  const quotient = scaled.digits / divisor;
  const remainder = scaled.digits % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return formatScaled(rounded, decimals);
}

/** Divide `numerator` by `denominator` (unsigned decimals) and round HALF-UP to `decimals` fractional digits. */
export function divideRoundHalfUp(numerator: string, denominator: string, decimals: number): string {
  if (isZero(denominator)) throw new Error('divideRoundHalfUp: zero denominator');
  const n = requireScaled(numerator);
  const d = requireScaled(denominator);
  const commonScale = Math.max(n.scale, d.scale);
  const target = 10n ** BigInt(decimals);
  const ratioNumerator = upScale(n, commonScale) * target;
  const ratioDenominator = upScale(d, commonScale);
  const quotient = ratioNumerator / ratioDenominator;
  const remainder = ratioNumerator % ratioDenominator;
  const rounded = remainder * 2n >= ratioDenominator ? quotient + 1n : quotient;
  return formatScaled(rounded, decimals);
}

// ---------------------------------------------------------------------------
// Grid alignment (lot/tick disciplines — the venue's mechanical rules)
// ---------------------------------------------------------------------------

/**
 * True iff `value` is an exact multiple of `grid` (the lot size or tick
 * size). Precondition: `grid` is a positive decimal.
 */
export function isAlignedToGrid(value: string, grid: string): boolean {
  const v = requireScaled(value);
  const g = requireScaled(grid);
  if (isZeroScaled(g)) throw new Error('isAlignedToGrid: zero grid');
  const scale = Math.max(v.scale, g.scale);
  const remainder = upScale(v, scale) % upScale(g, scale);
  return remainder === 0n;
}

/** Floor `value` to the grid: the largest grid multiple <= value. Precondition: `grid` positive. */
export function floorToGrid(value: string, grid: string): string {
  const v = requireScaled(value);
  const g = requireScaled(grid);
  if (isZeroScaled(g)) throw new Error('floorToGrid: zero grid');
  const scale = Math.max(v.scale, g.scale);
  const floored = (upScale(v, scale) / upScale(g, scale)) * upScale(g, scale);
  return formatScaled(floored, scale);
}

/** Ceil `value` to the grid: the smallest grid multiple >= value. Precondition: `grid` positive. */
export function ceilToGrid(value: string, grid: string): string {
  const v = requireScaled(value);
  const g = requireScaled(grid);
  if (isZeroScaled(g)) throw new Error('ceilToGrid: zero grid');
  const scale = Math.max(v.scale, g.scale);
  const vd = upScale(v, scale);
  const gd = upScale(g, scale);
  const remainder = vd % gd;
  const ceiled = remainder === 0n ? vd : vd - remainder + gd;
  return formatScaled(ceiled, scale);
}

/**
 * `true` when the value is a NON-NEGATIVE decimal in EITHER mirrored
 * grammar (the loosest input this package accepts into its money paths);
 * a value that is not a string, or a string outside both grammars (e.g.
 * "-1", "1e5", "" or a float-formatted "0.1" that arrived as a NUMBER)
 * is rejected by the guards, never coerced.
 */
export function isNonNegativeDecimalInput(value: unknown): value is string {
  return isNonEmptyString(value) && (isUnsignedDecimal(value) || isCanonicalDecimal(value));
}
