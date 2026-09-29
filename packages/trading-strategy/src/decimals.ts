// @tradrl/trading-strategy — exact decimal arithmetic on decimal strings.
//
// STRUCTURAL MIRROR of @tradrl/exchange-sim/src/decimals.ts (T010) — the
// laws are re-declared by STRUCTURE, never imported (D-003/D-004); the
// interop test in src/interop.test.ts proves arithmetic parity against
// the REAL exchange-sim module on this branch.
//
// Prices, quantities, notionals, cost bases, cash and weights are carried
// as DECIMAL STRINGS and computed EXACTLY (BigInt-mediated base-10
// fixed-point): binary floating point cannot represent venue ticks, lot
// sizes or cost bases exactly, and the "exact decimal arithmetic
// mirroring exchange-sim's decimals law" requirement forbids silent
// numeric approximation in the portfolio money paths. There is no float
// mediation anywhere in the arithmetic — the `decimal_imprecision` typed
// error exists precisely so a caller that tries to smuggle a float into a
// decimal path is rejected, never coerced.
//
// DOMAIN DECISION (mirroring exchange-sim's documented law): every value
// in this package's money paths is NON-NEGATIVE (quantities, prices,
// notionals, cost bases, cash, fees, weights). The strategy domain of
// THIS Work Order is long-only: shorts require the risk engine (T020) and
// execution policy (T019) lanes that do not exist on this base, so a
// computation that would go negative is a typed error, not a sign flip
// (see `negative_result` in errors.ts).
//
// The accepted INPUT grammar is the union of the two canonical lanes this
// package mirrors (same as exchange-sim):
//   - observation payload values follow market-protocol's UNSIGNED
//     decimal grammar `/^\d+(\.\d+)?$/` (loose: "01.2" is accepted there);
//   - order-intent price/quantity follow domain-core's canonical grammar
//     `/^(0|[1-9]\d*)(\.\d+)?$/` (strict: no leading zeros, no "-0").
// Internally every accepted value is NORMALIZED to canonical form, so all
// EMITTED decimal strings are canonical and byte-stable (L9).
//
// DECLARED APPROXIMATION (the ONE, mirroring exchange-sim's fee-rounding
// discipline): division rounds HALF-UP at a caller-DECLARED decimal
// precision (`roundHalfUp` / `divideRoundHalfUp`). Weights and per-unit
// cost bases are the only divided quantities; every division site names
// the precision explicitly (the strategy spec declares it — see spec.ts)
// so the rounding is data, not a hidden constant.

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
 * callers that must not go negative use the typed transition API instead,
 * which converts this into a `negative_result` typed error).
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
 * Example: roundHalfUp("0.000000015", 8) === "0.00000002". Exact except
 * for the rounding step itself; every division site in this package
 * declares its precision explicitly (mirror of exchange-sim's law).
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
  // Bring both to a common scale, then form the ratio scaled by 10^decimals
  // and round half-up: value ≈ (n*10^decimals)/d, one exact division.
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
// Grid alignment (lot/tick disciplines — the order-emission discipline)
// ---------------------------------------------------------------------------

/**
 * True iff `value` (unsigned decimal, loose grammar tolerated — normalized
 * internally) is an exact multiple of `grid` (the lot size or tick size).
 * Precondition: `grid` is a positive decimal.
 */
export function isAlignedToGrid(value: string, grid: string): boolean {
  const v = requireScaled(value);
  const g = requireScaled(grid);
  if (isZeroScaled(g)) throw new Error('isAlignedToGrid: zero grid');
  const scale = Math.max(v.scale, g.scale);
  const remainder = upScale(v, scale) % upScale(g, scale);
  return remainder === 0n;
}

/**
 * Floor `value` to the grid: the largest grid multiple <= value.
 * Precondition: `grid` positive; `value` non-negative decimal.
 */
export function floorToGrid(value: string, grid: string): string {
  const v = requireScaled(value);
  const g = requireScaled(grid);
  if (isZeroScaled(g)) throw new Error('floorToGrid: zero grid');
  const scale = Math.max(v.scale, g.scale);
  const floored = (upScale(v, scale) / upScale(g, scale)) * upScale(g, scale);
  return formatScaled(floored, scale);
}

/**
 * Ceil `value` to the grid: the smallest grid multiple >= value.
 * Precondition: `grid` positive; `value` non-negative decimal.
 */
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
 * is rejected by the guards, never coerced (the `decimal_imprecision`
 * law: no float mediation anywhere).
 */
export function isDecimalStringInput(value: unknown): value is string {
  return isNonEmptyString(value) && (isUnsignedDecimal(value) || isCanonicalDecimal(value));
}
