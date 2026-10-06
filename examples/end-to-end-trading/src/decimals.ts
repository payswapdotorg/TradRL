// @tradrl/example-e2e-trading — exact decimal arithmetic.
//
// THE DECIMAL LAW: every money/quantity/price/weight value in the slice is
// a decimal STRING computed exactly over BigInt base-10 fixed-point. A JS
// number in a money field is a typed crime (`decimal_imprecision`). The one
// approximation in the whole slice is `divideRoundHalfUp`, which rounds at
// a caller-declared precision (mirroring the merged packages' convention).
//
// Canonical grammar (the emitted form): /^(0|[1-9]\d*)(\.\d+)?$/ — no
// leading zeros, no "-0". Signed variant carries one leading '-'.

/** Guard: the canonical emitted decimal grammar. */
export function isCanonicalDecimal(v: unknown): v is string {
  return typeof v === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(v);
}

/** Guard: the signed canonical decimal grammar (PnL, equity, tilts). */
export function isSignedCanonicalDecimal(v: unknown): v is string {
  return typeof v === 'string' && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) && v !== '-0';
}

/** Guard: the loose unsigned input grammar (market-data side). */
export function isUnsignedDecimal(v: unknown): v is string {
  return typeof v === 'string' && /^\d+(\.\d+)?$/.test(v);
}

/** Guard: a strictly positive canonical decimal. */
export function isCanonicalPositiveDecimal(v: unknown): v is string {
  return isCanonicalDecimal(v) && !isZeroDecimal(v);
}

function parse(value: string): { readonly negative: boolean; readonly digits: string } {
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  return { negative, digits: body };
}

function unscalePair(a: string, b: string): { readonly ai: bigint; readonly bi: bigint; readonly scale: number } {
  const [aInt = '0', aFrac = ''] = a.split('.');
  const [bInt = '0', bFrac = ''] = b.split('.');
  const scale = Math.max(aFrac.length, bFrac.length);
  const ai = BigInt(aInt + aFrac.padEnd(scale, '0'));
  const bi = BigInt(bInt + bFrac.padEnd(scale, '0'));
  return { ai, bi, scale };
}

function render(negative: boolean, magnitude: bigint, scale: number): string {
  const sign = negative && magnitude !== 0n ? '-' : '';
  const digits = magnitude.toString().padStart(scale + 1, '0');
  if (scale === 0) return `${sign}${digits}`;
  const cut = digits.length - scale;
  const frac = digits.slice(cut).replace(/0+$/, '');
  return frac.length === 0 ? `${sign}${digits.slice(0, cut)}` : `${sign}${digits.slice(0, cut)}.${frac}`;
}

/** Exact addition of two canonical decimals. */
export function add(a: string, b: string): string {
  const { ai, bi, scale } = unscalePair(a, b);
  return render(false, ai + bi, scale);
}

/** Exact subtraction; throws on a negative result (the domain invariant). */
export function subtract(a: string, b: string): string {
  const { ai, bi, scale } = unscalePair(a, b);
  if (ai < bi) throw new Error(`subtract: ${a} - ${b} is negative — the unsigned domain was violated`);
  return render(false, ai - bi, scale);
}

/** Exact subtraction of canonical decimals, SIGNED result. */
export function signedSubtract(a: string, b: string): string {
  const { ai, bi, scale } = unscalePair(a, b);
  if (ai >= bi) return render(false, ai - bi, scale);
  return render(true, bi - ai, scale);
}

/** Exact addition of signed canonical decimals, SIGNED result. */
export function signedAdd(a: string, b: string): string {
  const pa = parse(a);
  const pb = parse(b);
  const { ai, bi, scale } = unscalePair(pa.digits, pb.digits);
  const sa = pa.negative ? -ai : ai;
  const sb = pb.negative ? -bi : bi;
  const sum = sa + sb;
  return render(sum < 0, sum < 0 ? -sum : sum, scale);
}

/** Exact multiplication of two canonical decimals. */
export function multiply(a: string, b: string): string {
  const pa = parse(a);
  const pb = parse(b);
  const [aInt = '0', aFrac = ''] = pa.digits.split('.');
  const [bInt = '0', bFrac = ''] = pb.digits.split('.');
  const scale = aFrac.length + bFrac.length;
  const value = BigInt(aInt + aFrac) * BigInt(bInt + bFrac);
  return render(pa.negative !== pb.negative, value, scale);
}

/** Lexicographic-safe comparison: -1 | 0 | 1. */
export function compare(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);
  if (pa.negative !== pb.negative) return pa.negative ? -1 : 1;
  const { ai, bi } = unscalePair(pa.digits, pb.digits);
  const result = ai < bi ? -1 : ai > bi ? 1 : 0;
  return pa.negative ? (-result as -1 | 0 | 1) : result;
}

/** Equality of two decimal values (grammar-insensitive). */
export function isEqual(a: string, b: string): boolean {
  return compare(a, b) === 0;
}

/** Zero test. */
export function isZeroDecimal(a: string): boolean {
  return /^0(\.0+)?$/.test(a);
}

/** True when `a > b`. */
export function isGreaterThan(a: string, b: string): boolean {
  return compare(a, b) === 1;
}

/** True when `a < b`. */
export function isLessThan(a: string, b: string): boolean {
  return compare(a, b) === -1;
}

/** True when `a >= b`. */
export function isAtLeast(a: string, b: string): boolean {
  return compare(a, b) >= 0;
}

/** Normalizes any unsigned decimal input into canonical form. */
export function normalize(value: string): string {
  if (!isUnsignedDecimal(value)) throw new Error(`normalize: ${JSON.stringify(value)} is not an unsigned decimal`);
  const [int = '0', frac = ''] = value.split('.');
  const trimmedInt = int.replace(/^0+(?=\d)/, '');
  const trimmedFrac = frac.replace(/0+$/, '');
  return trimmedFrac.length === 0 ? trimmedInt : `${trimmedInt}.${trimmedFrac}`;
}

/** Absolute value of a signed canonical decimal. */
export function absoluteValue(a: string): string {
  return a.startsWith('-') ? a.slice(1) : a;
}

/**
 * The ONE approximation: half-up division at a caller-declared precision.
 * Mirrors the program-wide `divideRoundHalfUp(numerator, denominator, decimals)`.
 */
export function divideRoundHalfUp(numerator: string, denominator: string, decimals: number): string {
  if (isZeroDecimal(denominator)) throw new Error('divideRoundHalfUp: zero denominator');
  const pn = parse(numerator);
  const pd = parse(denominator);
  const [nInt = '0', nFrac = ''] = pn.digits.split('.');
  const [dInt = '0', dFrac = ''] = pd.digits.split('.');
  const negative = pn.negative !== pd.negative;
  const shift = decimals + dFrac.length - nFrac.length;
  const scaledNumerator = BigInt(nInt + nFrac) * (shift >= 0 ? 10n ** BigInt(shift) : 1n);
  const scaledDenominator = BigInt(dInt + dFrac) * (shift < 0 ? 10n ** BigInt(-shift) : 1n);
  const quotient = (scaledNumerator * 2n + scaledDenominator) / (scaledDenominator * 2n);
  return render(negative, quotient, decimals);
}

/** Half-up rounding of a canonical decimal to `decimals` fractional digits. */
export function roundHalfUp(value: string, decimals: number): string {
  const p = parse(value);
  const [int = '0', frac = ''] = p.digits.split('.');
  if (frac.length <= decimals) return value;
  const kept = frac.slice(0, decimals);
  const rest = BigInt(frac.slice(decimals));
  let magnitude = BigInt(int + kept);
  if (rest >= 5n) magnitude += 1n;
  return render(p.negative, magnitude, decimals);
}

/** True when `value` is an exact multiple of the positive decimal `grid`. */
export function isAlignedToGrid(value: string, grid: string): boolean {
  const quotient = divideRoundHalfUp(value, grid, 18);
  const product = multiply(quotient, grid);
  return isEqual(product, value);
}

/** Largest grid-aligned value <= `value` (lot-size flooring). */
export function floorToGrid(value: string, grid: string): string {
  const [int = '0', frac = ''] = value.split('.');
  const [gInt = '0', gFrac = ''] = grid.split('.');
  const scale = Math.max(frac.length, gFrac.length, 0);
  const v = BigInt(int + frac.padEnd(scale, '0'));
  const g = BigInt(gInt + gFrac.padEnd(scale, '0'));
  if (g === 0n) throw new Error('floorToGrid: zero grid');
  const floored = (v / g) * g;
  return render(false, floored, scale);
}

/** Sum of a list of canonical decimals ('0' when empty). */
export function sum(values: readonly string[]): string {
  return values.reduce((acc, value) => add(acc, value), '0');
}
