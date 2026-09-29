// @tradrl/risk — exact decimal arithmetic on decimal strings.
//
// STRUCTURAL MIRROR of @tradrl/exchange-sim/src/decimals.ts (T010) and
// @tradrl/execution-policy/src/decimals.ts (T019, itself the exchange-sim
// mirror) — the laws are re-declared by STRUCTURE, never imported
// (D-003/D-004); the interop test in src/interop.test.ts proves
// arithmetic parity against the REAL execution-policy module on this
// branch.
//
// The risk engine's measures are MONEY PATHS: exposures, notionals,
// concentration ratios, drawdown magnitudes, leverage ratios, caps and
// excesses are compared and differenced EXACTLY (BigInt-mediated base-10
// fixed-point). Binary floating point cannot represent venue ticks, lot
// sizes or ratio bounds exactly, and a risk engine whose arithmetic
// silently approximates is not measuring the firm's risk ("exact decimal
// arithmetic — exchange-sim's decimals discipline, no float drift" — the
// Work Order's law; the typed `decimal_imprecision` error in errors.ts is
// the trip wire for any float that tries to enter a money path).
//
// DOMAIN DECISION (mirroring the sibling lanes): every value in this
// package's money paths is NON-NEGATIVE (quantities, reference prices,
// notionals, caps, ratios, drawdown magnitudes). The LIMIT EXCESS
// (observed - cap) is computed over unsigned magnitudes and stays
// non-negative — the evaluator only ever REPORTS an excess it has
// already proven positive.
//
// The accepted INPUT grammar is the union of the two canonical lanes
// this package mirrors:
//   - observation payload values follow market-protocol's UNSIGNED
//     decimal grammar `/^\d+(\.\d+)?$/` (loose: "01.2" is accepted there);
//   - order-intent price/quantity follow domain-core's canonical grammar
//     `/^(0|[1-9]\d*)(\.\d+)?$/` (strict: no leading zeros, no "-0").
// Internally every accepted value is NORMALIZED to canonical form, so
// all EMITTED decimal strings are canonical and byte-stable (L9).

import { isFiniteNumber, isNonEmptyString } from './primitives';

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
 * computation's rounding site). The risk engine's RATIO display values
 * (concentration, leverage) round here; the limit COMPARISONS themselves
 * cross-multiply exactly and never round (see limits.ts).
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
// The constraint-bound bridge (control-domain's numeric predicates -> exact decimals)
// ---------------------------------------------------------------------------

/**
 * THE DECLARED BRIDGE from control-domain's numeric predicate bounds to
 * this lane's exact decimal strings (the compile site — see compile.ts).
 *
 * Control-domain's `CriterionPredicate` carries bounds as JS NUMBERS
 * (`{ kind: 'limit.max', bound: number }`); this lane's caps are exact
 * decimal strings. The bridge converts a finite number to the canonical
 * decimal string of ITS SHORTEST ROUND-TRIP DECIMAL FORM — i.e. the
 * decimal literal the constraint author wrote (`0.1` compiles to "0.1",
 * never to the 55-digit binary expansion of the float 0.1). Exponent
 * notation (`1e-7`, `1.5e21`) is expanded exactly by shifting the
 * mantissa's digits — pure string arithmetic over the literal, no float
 * mediation. Deterministic: the same bound always compiles to the same
 * decimal.
 *
 * Returns `null` when the value is not a finite number or its decimal
 * form cannot be represented exactly (callers convert that into the
 * typed compile error — an inexact bound never enters a money path).
 */
export function canonicalDecimalOfFiniteNumber(value: unknown): string | null {
  if (!isFiniteNumber(value)) return null;
  const text = value.toString();
  if (text === '') return null;
  // Fast path: the plain canonical form already.
  if (/^(0|[1-9]\d*)(\.\d+)?$/.test(text)) return text;
  // Exponent forms: [mantissa]e[+-][exponent] — expand exactly.
  const match = /^(\d+)(?:\.(\d+))?e([+-])(\d+)$/.exec(text);
  if (match === null) return null;
  const [, intDigits, fracDigitsRaw, exponentSign, exponentDigits] = match;
  const fracDigits = fracDigitsRaw ?? '';
  const combined = `${intDigits}${fracDigits}`;
  const exponent = Number.parseInt(exponentDigits, 10);
  if (!Number.isSafeInteger(exponent)) return null;
  const shift = exponentSign === '-' ? -exponent : exponent;
  const point = intDigits.length + shift;
  if (point <= 0) {
    // 0.<zeros><digits>
    const padded = `0.${'0'.repeat(-point)}${combined}`;
    return normalize(padded);
  }
  if (point >= combined.length) {
    // <digits><zeros>
    return normalize(`${combined}${'0'.repeat(point - combined.length)}`);
  }
  return normalize(`${combined.slice(0, point)}.${combined.slice(point)}`);
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

// ---------------------------------------------------------------------------
// The signed extension (THIS lane's addition — the cash-after-fills path)
// ---------------------------------------------------------------------------
//
// The sibling lanes' money paths are unsigned (T019's documented domain).
// The risk engine's EXPOSURE computation has one surface where the
// unsigned domain is honestly insufficient: POST-FILL CASH on a leveraged
// book can be negative (buys beyond cash are margin), and EQUITY (cash +
// gross notional) inherits that sign. This section extends the mirror
// with the minimal SIGNED grammar (an optional single leading "-") and
// exact signed add/subtract/compare — the same BigInt fixed-point
// discipline, never float. The shared unsigned surface above stays
// byte-compatible with the mirrored lanes (the interop test proves it).

/** `true` for a canonical decimal with an optional single leading "-" (this lane's signed grammar). */
export function isSignedCanonicalDecimal(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  const body = value.startsWith('-') ? value.slice(1) : value;
  return /^(0|[1-9]\d*)(\.\d+)?$/.test(body);
}

/** A signed decimal parsed to (sign, magnitude). */
interface Signed {
  readonly negative: boolean;
  readonly magnitude: Scaled;
}

/** Parse a signed canonical decimal; `null` if malformed. */
function parseSigned(value: string): Signed | null {
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const magnitude = parseScaled(body);
  if (magnitude === null) return null;
  if (magnitude.digits === 0n) return { negative: false, magnitude }; // no "-0"
  return { negative, magnitude };
}

function requireSigned(value: string): Signed {
  const signed = parseSigned(value);
  if (signed === null) throw new Error(`decimal: invalid signed operand "${value}"`);
  return signed;
}

/** Exact signed sum, canonical form (no "-0"). */
export function signedAdd(a: string, b: string): string {
  const x = requireSigned(a);
  const y = requireSigned(b);
  const scale = Math.max(x.magnitude.scale, y.magnitude.scale);
  const xd = upScale(x.magnitude, scale) * (x.negative ? -1n : 1n);
  const yd = upScale(y.magnitude, scale) * (y.negative ? -1n : 1n);
  return formatScaled(xd + yd, scale);
}

/** Exact signed difference, canonical form (no "-0"). */
export function signedSubtract(a: string, b: string): string {
  const negatedB = b.startsWith('-') ? b.slice(1) : `-${b}`;
  return signedAdd(a, negatedB);
}

/** EXACT signed comparison: -1 if a < b, 0 if equal, 1 if a > b. */
export function signedCompare(a: string, b: string): -1 | 0 | 1 {
  const x = requireSigned(a);
  const y = requireSigned(b);
  const scale = Math.max(x.magnitude.scale, y.magnitude.scale);
  const xd = upScale(x.magnitude, scale) * (x.negative ? -1n : 1n);
  const yd = upScale(y.magnitude, scale) * (y.negative ? -1n : 1n);
  return xd < yd ? -1 : xd > yd ? 1 : 0;
}
