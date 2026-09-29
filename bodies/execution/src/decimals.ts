// @tradrl/body-execution — exact decimal-string numerics.
//
// Owning Work Order: T025.
//
// STRUCTURAL MIRROR of @tradrl/market-protocol/src/decimals.ts via the
// body packages and the execution-policy lane (law D-003/D-004: the
// lexical forms and comparison semantics are the program-wide law;
// "prices, sizes and other market quantities are carried as DECIMAL
// STRINGS"). The order-lane quantities — order quantities, fill
// quantities, acknowledged quantities, grid steps, reconciliation gaps —
// follow the same discipline: an order-lifecycle record must not bake a
// binary-floating-point hazard into its evidence chain (L9 byte
// determinism; the exact-decimal accounting law of this Work Order:
// "float mediation is the typed decimal_imprecision").
//
// The CANONICAL GRAMMAR (mirror of the execution-policy / brokers
// execution-lane grammar — stricter than the transport grammar): no
// leading zeros, no "-0", at most one fraction. This is the grammar the
// downstream order-lane adapters' intent guards enforce; the interop
// test proves my prepared-order quantities pass their guards verbatim.
//
// EXTENSION (this lane's own arithmetic): the declared reconciliation
// methods need exact sums, differences and comparisons over decimal
// strings. All arithmetic runs on SCALED BIGINTS (value * 10^scale),
// rendered back to fixed-scale decimal strings with the DECLARED
// rounding mode (half-even or truncate). No float is ever constructed —
// the determinism law (same inputs -> byte-identical outputs) holds
// exactly, not approximately.
//
// Forms:
// - canonical decimal:   /^(0|[1-9]\d*)(\.\d+)?$/   e.g. "0.5", "1", "0.25"
// - canonical positive:  canonical AND > 0
// - unsigned decimal:    /^\d+(\.\d+)?$/            e.g. "0.2500" (input grammar)
// - signed decimal:      /^[+-]?\d+(\.\d+)?$/       e.g. "-0.0021" (input grammar)

import type { ExecutionBodyError } from './errors';
import { invalidField } from './errors';

const CANONICAL_DECIMAL_RE = /^(0|[1-9]\d*)(?:\.\d+)?$/;
const UNSIGNED_DECIMAL_RE = /^\d+(?:\.\d+)?$/;
const SIGNED_DECIMAL_RE = /^[+-]?\d+(?:\.\d+)?$/;

/** A precision-safe base-10 numeric string. */
export type DecimalString = string;

/** The declared rounding modes for scaled arithmetic. */
export const ROUNDING_MODES = ['half-even', 'truncate'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

/**
 * Guard: a CANONICAL decimal string (the execution-lane grammar — no
 * leading zeros, no "-0", at most one fraction). Mirror of T019's /
 * the brokers adapters' `isCanonicalDecimal`.
 */
export function isCanonicalDecimal(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_DECIMAL_RE.test(value);
}

/**
 * Guard: a canonical decimal AND strictly positive (the
 * quantity/price law of the order lane). Mirror of T019's / the
 * brokers adapters' `isCanonicalPositiveDecimal`.
 */
export function isCanonicalPositiveDecimal(value: unknown): value is string {
  return (
    isCanonicalDecimal(value) &&
    !(value === '0' || /^0\.0*$/.test(value))
  );
}

/** Guard: a well-formed unsigned decimal (input grammar). */
export function isUnsignedDecimal(value: unknown): value is string {
  return typeof value === 'string' && UNSIGNED_DECIMAL_RE.test(value);
}

/** Guard: a well-formed signed decimal (input grammar). */
export function isSignedDecimal(value: unknown): value is string {
  return typeof value === 'string' && SIGNED_DECIMAL_RE.test(value);
}

/**
 * THE EXACT-DECIMAL ACCOUNTING LAW: a quantity position carrying a JS
 * number (float mediation) is refused with the typed
 * `decimal_imprecision` — floats are NEVER coerced into decimals here.
 * A string that is not a well-formed decimal is refused with
 * `decimal_invalid`. A canonical-grammar violation (leading zeros,
 * "-0") is `decimal_invalid` too. This is the collect-all helper every
 * quantity field's validation runs through.
 */
export function quantityProblems(path: string, value: unknown): readonly ExecutionBodyError[] {
  if (typeof value === 'number') {
    return [
      {
        code: 'decimal_imprecision',
        path,
        message: `field "${path}" carries the JS number ${JSON.stringify(value)} — float mediation is refused; quantities are exact decimal strings (BigInt fixed-point internally)`,
      },
    ];
  }
  if (typeof value !== 'string') {
    return [invalidField(path, 'must be a canonical decimal string')];
  }
  if (!isUnsignedDecimal(value) && !isSignedDecimal(value)) {
    return [
      {
        code: 'decimal_invalid',
        path,
        message: `field "${path}" carries ${JSON.stringify(value)} — not a well-formed decimal string`,
      },
    ];
  }
  if (!isCanonicalDecimal(value)) {
    return [
      {
        code: 'decimal_invalid',
        path,
        message: `field "${path}" carries ${JSON.stringify(value)} — not the canonical decimal grammar (no leading zeros, at most one fraction)`,
      },
    ];
  }
  return [];
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
  const int = (dot === -1 ? body : body.slice(0, dot)).replace(/^0+/, '') || '0';
  const frac = (dot === -1 ? '' : body.slice(dot + 1)).replace(/0+$/, '');
  return { sign, int, frac };
}

function isZero(parsed: ParsedDecimal): boolean {
  return parsed.int === '0' && parsed.frac === '';
}

function compareMagnitude(x: ParsedDecimal, y: ParsedDecimal): -1 | 0 | 1 {
  if (x.int.length !== y.int.length) return x.int.length < y.int.length ? -1 : 1;
  if (x.int !== y.int) return x.int < y.int ? -1 : 1;
  const width = Math.max(x.frac.length, y.frac.length);
  const fx = x.frac.padEnd(width, '0');
  const fy = y.frac.padEnd(width, '0');
  return fx < fy ? -1 : fx > fy ? 1 : 0;
}

/**
 * EXACT decimal comparison: -1 if a < b, 0 if equal, 1 if a > b.
 * Correct beyond float precision. Inputs must be valid signed decimals.
 *
 * The zero-vs-nonzero branch follows the CORRECTED semantics (the
 * trading-director lane's ratified fix, flagged in its decimals
 * divergence note): a=0, b>0 compares -1; a=0, b<0 compares 1. The
 * sentiment lane's historical `y.sign` inversion is not reproduced —
 * this lane's threshold arithmetic (gap vs grid step, cumulative fills
 * vs acknowledged quantity) depends on the correct semantics.
 */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  const xZero = isZero(x);
  const yZero = isZero(y);
  if (xZero && yZero) return 0;
  if (xZero) return y.sign === 1 ? -1 : 1;
  if (yZero) return x.sign === 1 ? 1 : -1;
  if (x.sign !== y.sign) return x.sign < y.sign ? -1 : 1;
  const magnitude = compareMagnitude(x, y);
  if (magnitude === 0) return 0;
  if (x.sign === 1) return magnitude;
  return magnitude === 1 ? -1 : 1;
}

/** True iff a well-formed decimal is exactly zero. */
export function isZeroDecimal(value: string): boolean {
  return isZero(parseDecimal(value));
}

/** True iff a well-formed unsigned decimal is strictly greater than zero. */
export function isPositiveDecimal(value: unknown): value is string {
  return isUnsignedDecimal(value) && !isZero(parseDecimal(value));
}

/** True iff a well-formed signed decimal is strictly greater than zero. */
export function isSignedPositiveDecimal(value: unknown): value is string {
  return isSignedDecimal(value) && compareDecimal(value, '0') === 1;
}

// ---------------------------------------------------------------------------
// Scaled exact arithmetic (BigInt; deterministic; no float ever)
// ---------------------------------------------------------------------------

/** Parses a signed decimal into a scaled bigint (value * 10^scale). */
function scaledOf(value: string, scale: number, rounding: RoundingMode): bigint {
  const parsed = parseDecimal(value);
  const digits = `${parsed.int}${parsed.frac}`;
  const have = parsed.frac.length;
  let scaled = 0n;
  if (have <= scale) {
    scaled = BigInt(digits) * 10n ** BigInt(scale - have);
  } else {
    const cut = digits.length - (have - scale);
    const head = BigInt(digits.slice(0, cut));
    const tail = digits.slice(cut);
    let extra = 0n;
    if (rounding === 'half-even') {
      // compare remainder*2 with 10^(have-scale); ties to even
      const denom = 10n ** BigInt(have - scale);
      const rem = BigInt(tail);
      const twice = rem * 2n;
      if (twice > denom || (twice === denom && head % 2n === 1n)) extra = 1n;
    } else {
      // truncate: never round up
      extra = 0n;
    }
    scaled = head + extra;
  }
  return parsed.sign === -1 ? -scaled : scaled;
}

/** Renders a scaled bigint as a fixed-scale signed decimal string. */
function renderScaled(scaled: bigint, scale: number): string {
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const text = abs.toString().padStart(scale + 1, '0');
  const cut = text.length - scale;
  const int = text.slice(0, cut);
  const frac = scale === 0 ? '' : `.${text.slice(cut)}`;
  const body = scale === 0 ? int : `${int}${frac}`;
  return neg ? `-${body}` : body;
}

/** Rounds a bigint division to the declared mode (denominator must be > 0). */
function divRounded(numerator: bigint, denominator: bigint, rounding: RoundingMode): bigint {
  const neg = numerator < 0n;
  const n = neg ? -numerator : numerator;
  const q = n / denominator;
  const r = n % denominator;
  let result = q;
  if (rounding === 'half-even') {
    const twice = r * 2n;
    if (twice > denominator || (twice === denominator && q % 2n === 1n)) result = q + 1n;
  }
  return neg ? -result : result;
}

/**
 * The exact signed sum of decimal strings at the declared scale and
 * rounding mode. THE CUMULATIVE-FILL PRIMITIVE: fill quantities are
 * summed exactly for reconciliation (fills sum vs acknowledged
 * quantity — exact equality, never a float sum).
 */
export function decimalSum(
  values: readonly string[],
  scale: number,
  rounding: RoundingMode,
): string {
  let sum = 0n;
  for (const value of values) sum += scaledOf(value, scale, rounding);
  return renderScaled(sum, scale);
}

/**
 * The exact signed difference (a - b) of two decimal strings at the
 * declared scale. THE RECONCILIATION-GAP PRIMITIVE: the gap between the
 * acknowledged quantity and the cumulative fills is computed exactly,
 * so "one smallest-grid-step off" is a precise, byte-stable statement.
 */
export function decimalSubtract(
  a: string,
  b: string,
  scale: number,
  rounding: RoundingMode,
): string {
  const difference = scaledOf(a, scale, rounding) - scaledOf(b, scale, rounding);
  return renderScaled(difference, scale);
}

/**
 * The exact absolute value of a signed decimal string, re-rendered at
 * the declared scale.
 */
export function decimalAbs(value: string, scale: number, rounding: RoundingMode): string {
  const scaled = scaledOf(value, scale, rounding);
  return renderScaled(scaled < 0n ? -scaled : scaled, scale);
}

/**
 * The exact mean of signed decimal strings at the declared scale and
 * rounding mode. Input order is irrelevant (bigint addition is
 * commutative) — the output is a pure function of the multiset.
 */
export function decimalMean(
  values: readonly string[],
  scale: number,
  rounding: RoundingMode,
): string {
  if (values.length === 0) return renderScaled(0n, scale);
  let sum = 0n;
  for (const value of values) sum += scaledOf(value, scale, rounding);
  return renderScaled(divRounded(sum, BigInt(values.length), rounding), scale);
}

/**
 * The exact product of two decimal strings at the declared scale and
 * rounding mode.
 */
export function decimalMultiply(
  a: string,
  b: string,
  scale: number,
  rounding: RoundingMode,
): string {
  const product = scaledOf(a, scale, rounding) * scaledOf(b, scale, rounding);
  return renderScaled(divRounded(product, 10n ** BigInt(scale), rounding), scale);
}
