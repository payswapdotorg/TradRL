// @tradrl/body-fundamental-researcher — exact decimal-string numerics.
//
// Owning Work Order: T023.
//
// STRUCTURAL MIRROR of @tradrl/market-protocol/src/decimals.ts (law D-004:
// the lexical forms and comparison semantics are the program-wide law;
// "prices, sizes and other market quantities are carried as DECIMAL
// STRINGS"). Fundamental values follow the same discipline: the equities
// and alternative-data adapters emit reported values as DECIMAL STRINGS
// (`"104.5000"`, `"3.3"`), and a research record must not bake a
// binary-floating-point hazard into its evidence chain.
//
// EXTENSION (this lane's own arithmetic): the declared assessment methods
// need exact means, differences and ratios over decimal strings. All
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
 */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  const xZero = isZero(x);
  const yZero = isZero(y);
  if (xZero && yZero) return 0;
  // NOTE (this lane's correction): a zero operand compares by the
  // NON-zero operand's sign — zero is LESS than any positive and
  // GREATER than any negative. The frozen sibling lanes' decimal helpers
  // return the non-zero operand's sign verbatim here (an inverted
  // zero-vs-nonzero ordering); this lane's declared stance decision
  // function REQUIRES the correct ordering — an exactly-zero score must
  // fall between the negative and positive thresholds (neutral), which
  // the inverted branch makes impossible. The correction does not touch
  // canonicalJson/stableDigest (byte parity with the sibling lanes is
  // trip-wired and unaffected).
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
 * same observation set always yields the same bytes.
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
 * The exact difference `a - b`, rendered at the declared scale. Pure
 * bigint subtraction — the same inputs always yield the same bytes (the
 * determinism law).
 */
export function decimalSub(a: string, b: string, scale: number, rounding: RoundingMode): string {
  return renderScaled(
    scaledOf(a, scale, rounding) - scaledOf(b, scale, rounding),
    scale,
  );
}

/**
 * The exact ratio `a / b`, rendered at the declared scale with the
 * declared rounding mode. The division runs on exact integer rationals
 * (BigInt cross-multiplied), never on floats. The denominator must be a
 * non-zero decimal — a zero denominator is a programming error (values
 * are validated non-zero decimals before they ever reach here), so this
 * function throws a TypeError rather than fabricating a value.
 */
export function decimalRatio(a: string, b: string, scale: number, rounding: RoundingMode): string {
  const numerator = parseDecimal(a);
  const denominator = parseDecimal(b);
  if (isZero(denominator)) {
    throw new TypeError(`decimalRatio: the denominator must be a non-zero decimal (received ${JSON.stringify(b)})`);
  }
  if (isZero(numerator)) return renderScaled(0n, scale);
  const sign: 1 | -1 = numerator.sign === denominator.sign ? 1 : -1;
  // |a| / |b| = (aInt * 10^-aFrac) / (bInt * 10^-bFrac); we want it at 10^scale:
  //   value * 10^scale = aInt * 10^(bFrac + scale) / (bInt * 10^aFrac)
  const aInt = BigInt(`${numerator.int}${numerator.frac}`);
  const bInt = BigInt(`${denominator.int}${denominator.frac}`);
  const exponent = denominator.frac.length + scale - numerator.frac.length;
  let top: bigint;
  let bottom: bigint;
  if (exponent >= 0) {
    top = aInt * 10n ** BigInt(exponent);
    bottom = bInt;
  } else {
    top = aInt;
    bottom = bInt * 10n ** BigInt(-exponent);
  }
  const magnitude = divRounded(top, bottom, rounding);
  return renderScaled(sign === 1 ? magnitude : -magnitude, scale);
}
