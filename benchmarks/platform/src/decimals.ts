// @tradrl/benchmarks-platform — the exact-decimal discipline (Work Order T049).
//
// STRUCTURAL MIRROR of the program-wide decimal-string discipline
// (@tradrl/market-protocol's lexical forms; research/benchmarks's and
// @tradrl/evaluation-integrity's scaled comparisons — law D-004). The
// benchmark lane MEASURES: the decimal axes it records (a subject's
// realized PnL, its cash, its benchmark scores) are exact decimal strings,
// never binary floats, and the attainment criteria compare them exactly.
// This module carries the comparison subset the lane needs (guards, scale,
// exact three-way comparison, normalization); the full scaled-bigint
// arithmetic belongs to the lanes that compose scores (T032).

/** A precision-safe base-10 numeric string. */
export type DecimalString = string;

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
  // INTEGER-DIGIT-COUNT ALIGNMENT FIRST. The program-wide compareMagnitude
  // (evaluation-splits / evaluation-integrity / research-benchmarks) pads the
  // CONCATENATED digit strings (int+frac) to equal length on the right, which
  // is only a valid scale alignment when the integer parts carry the same
  // digit count — across counts it miscompares ("10.00" vs "1.00" -> 0,
  // "15.00" vs "9.00" -> -1 in the REAL merged lanes; their own usage —
  // same-magnitude epoch-ms boundaries — never hits the case, but a
  // MEASUREMENT lane judging arbitrary decimal criteria DOES). This lane
  // deliberately corrects the mirror: strip leading zeros, compare integer
  // digit counts, then the (now correctly aligned) padded digit compare.
  // On equal digit counts the behavior is byte-identical to the owners'; the
  // correction is pinned by this lane's tests and recorded for the Lead as a
  // program-wide latent defect (three merged packages).
  const xi = x.int.replace(/^0+/, '') || '0';
  const yi = y.int.replace(/^0+/, '') || '0';
  if (xi.length !== yi.length) return xi.length < yi.length ? -1 : 1;
  const xs = xi + x.frac;
  const ys = yi + y.frac;
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

/** The canonical representation at the value's own scale (leading '+', trailing zeros kept, no '-0'). */
export function normalizeDecimal(value: DecimalString): DecimalString {
  const scale = decimalScale(value);
  return renderScaled(parseToScaled(value, scale), scale);
}

/** Guard: a signed decimal at EXACTLY the declared scale (the axis-scale law). */
export function isDecimalAtScale(value: unknown, scale: number): value is DecimalString {
  if (!isSignedDecimal(value)) return false;
  return decimalScale(value) === scale;
}
