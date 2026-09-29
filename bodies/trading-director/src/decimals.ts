// @tradrl/body-trading-director — exact decimal-string numerics.
//
// Owning Work Order: T024.
//
// STRUCTURAL MIRROR of @tradrl/market-protocol/src/decimals.ts via the
// research bodies (law D-004: the lexical forms and comparison semantics
// are the program-wide law; "prices, sizes and other market quantities
// are carried as DECIMAL STRINGS"). The director's portfolio-level
// quantities — lane weights, tilt units, thresholds, target-allocation
// deltas — follow the same discipline: a decision record must not bake a
// binary-floating-point hazard into the lineage chain (L9 byte
// determinism).
//
// EXTENSION (this lane's own arithmetic): the declared synthesis methods
// need exact weighted sums and products over decimal strings. All
// arithmetic runs on SCALED BIGINTS (value * 10^scale), rendered back to
// fixed-scale decimal strings with the DECLARED rounding mode (half-even
// or truncate). No float is ever constructed — the determinism law (same
// inputs -> byte-identical outputs) holds exactly, not approximately.
//
// Forms (mirrored exactly):
// - unsigned decimal: /^\d+(\.\d+)?$/          e.g. "0.5", "1", "0.2500"
// - signed decimal:   /^[+-]?\d+(\.\d+)?$/     e.g. "-0.0021", "+3.14"

const UNSIGNED_DECIMAL_RE = /^\d+(?:\.\d+)?$/;
const SIGNED_DECIMAL_RE = /^[+-]?\d+(?:\.\d+)?$/;

/** A precision-safe base-10 numeric string. */
export type DecimalString = string;

/** The declared rounding modes for scaled arithmetic. */
export const ROUNDING_MODES = ['half-even', 'truncate'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

/** Guard: a well-formed unsigned decimal. */
export function isUnsignedDecimal(value: unknown): value is string {
  return typeof value === 'string' && UNSIGNED_DECIMAL_RE.test(value);
}

/** Guard: a well-formed signed decimal. */
export function isSignedDecimal(value: unknown): value is string {
  return typeof value === 'string' && SIGNED_DECIMAL_RE.test(value);
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
 * DIVERGENCE NOTE (flagged for Tech Lead ratification): the research
 * bodies' compareDecimal returns `y.sign` when `a` is zero — inverted
 * for zero-vs-nonzero (a=0, b>0 must compare -1; their suites never
 * exercise that branch). This lane's threshold arithmetic (|delta| vs
 * adjustmentThreshold, net tilt vs zero) DEPENDS on the correct
 * semantics, so this mirror fixes the zero branch. The byte-parity
 * mirror law (D-003/D-004) governs the SERIALIZATION primitives
 * (canonicalJson/stableDigest — proven byte-identical in
 * interop.test.ts); this arithmetic fix does not affect any derived id
 * or serialized byte.
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
 * The exact mean of signed decimal strings at the declared scale and
 * rounding mode. Input order is irrelevant (bigint addition is
 * commutative) — the output is a pure function of the multiset, so the
 * same input set always yields the same bytes.
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
 * The exact dispersion (max - min) of signed decimal strings at the
 * declared scale. `null` when fewer than two values are present (a
 * dispersion of a single observation is not a quantity — it is an
 * absence, and absence is `null`, never a fabricated zero).
 */
export function decimalDispersion(
  values: readonly string[],
  scale: number,
  rounding: RoundingMode,
): string | null {
  if (values.length < 2) return null;
  let min = scaledOf(values[0] as string, scale, rounding);
  let max = min;
  for (const value of values.slice(1)) {
    const scaled = scaledOf(value, scale, rounding);
    if (scaled < min) min = scaled;
    if (scaled > max) max = scaled;
  }
  return renderScaled(max - min, scale);
}

/**
 * The exact absolute value of a signed decimal string, re-rendered at the
 * declared scale.
 */
export function decimalAbs(value: string, scale: number, rounding: RoundingMode): string {
  const scaled = scaledOf(value, scale, rounding);
  return renderScaled(scaled < 0n ? -scaled : scaled, scale);
}

/**
 * The exact signed sum of decimal strings at the declared scale and
 * rounding mode. The net-tilt aggregation primitive of the declared
 * synthesis methods: lane weights scaled by direction signs, summed
 * exactly.
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
 * The exact product of two decimal strings at the declared scale and
 * rounding mode. The tilt-rendering primitive: net tilt (weight units)
 * times the declared tilt unit (weight units per unit of tilt).
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
