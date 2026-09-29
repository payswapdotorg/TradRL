/**
 * @tradrl/adapter-alternative-data — decimal string numerics.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/decimals.ts (law D-004:
 * structural mirrors, never imports — the frozen workspace lockfile
 * forbids package dependencies). Canonical market quantities are DECIMAL STRINGS, not JSON numbers:
 * binary floating point cannot represent market ticks exactly, and the
 * alternative-data values this adapter consumes (levels, weights, scores,
 * series observations) are preserved end to end as decimal strings. All
 * comparisons are exact (lexical), never float-mediated.
 */

const UNSIGNED_DECIMAL_RE = /^\d+(?:\.\d+)?$/;
const SIGNED_DECIMAL_RE = /^[+-]?\d+(?:\.\d+)?$/;

/** A precision-safe base-10 numeric string. */
export type DecimalString = string;

/** True iff the string is a well-formed unsigned decimal. */
export function isUnsignedDecimal(value: unknown): value is string {
  return typeof value === 'string' && UNSIGNED_DECIMAL_RE.test(value);
}

/** True iff the string is a well-formed signed decimal. */
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
 * Correct beyond float precision. Inputs must be valid signed decimals
 * (validate first).
 */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  const xZero = isZero(x);
  const yZero = isZero(y);
  if (xZero && yZero) return 0;
  if (xZero) return y.sign;
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
