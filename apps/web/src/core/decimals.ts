// @tradrl/web-console — the exact-decimal discipline.
//
// THE LAW (Work Order T042): "Exact decimals for all numeric
// records." The console renders money, quantities and tolerances as
// the exact decimal STRINGS the boundary serves (the T033 outcome
// shapes carry them as strings precisely for this reason) — it never
// re-parses them into floats, never does float arithmetic on them,
// and never formats them through Number.toFixed. The launch form's
// budgets are validated as exact decimal strings BEFORE any API
// call; anything else is the typed InvalidLaunchDraftError.
//
// Spec anchors: L9 (byte-determinism of numeric records), R1
// (structured constraints), the outcome/evidence mirrors (string
// decimals end to end).

/** The exact-decimal grammar: optional sign, integer part, optional fraction; no exponent, no grouping. */
const DECIMAL_PATTERN = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** `true` when a string is an exact decimal literal (the wire grammar the boundary's records use). */
export function isExactDecimal(value: string): boolean {
  return DECIMAL_PATTERN.test(value);
}

/** `true` when a value is a string carrying an exact decimal. */
export function isDecimalString(v: unknown): v is string {
  return typeof v === 'string' && isExactDecimal(v);
}

/** Render a decimal record VERBATIM (never through a float, never re-formatted — exact bytes in, exact bytes out). */
export function renderDecimal(value: string): string {
  if (!isExactDecimal(value)) {
    throw new Error(`renderDecimal: ${JSON.stringify(value)} is not an exact decimal string — the console renders numeric records verbatim, never coerced`);
  }
  return value;
}

/**
 * FW-34-B (Round C register §3.7 — the execution blotter's aggregate
 * totals, L4): THE EXACT DECIMAL SUM. Totals must be sums of the served
 * decimal strings, never float arithmetic (floats lie about money); the
 * exact path scales every operand to the widest fraction length and adds
 * the scaled integers (BigInt — exact integer math, not a float), then
 * un-scales. An operand outside the exact grammar throws the typed
 * error (the discipline's own law — never a silently coerced operand);
 * an EMPTY input sums to '0'.
 */
export function sumExactDecimals(values: readonly string[]): string {
  if (values.length === 0) return '0';
  let widest = 0;
  for (const value of values) {
    if (!isExactDecimal(value)) {
      throw new Error(`sumExactDecimals: ${JSON.stringify(value)} is not an exact decimal string — totals sum the served records, never coerced operands`);
    }
    const dot = value.indexOf('.');
    widest = Math.max(widest, dot === -1 ? 0 : value.length - dot - 1);
  }
  // Scale each operand to the widest fraction (pad the fraction with
  // zeros) and add the scaled integers — exact by construction.
  let sum = 0n;
  for (const value of values) {
    const negative = value.startsWith('-');
    const magnitude = negative ? value.slice(1) : value;
    const dot = magnitude.indexOf('.');
    const padded = dot === -1 ? magnitude + '0'.repeat(widest) : magnitude.slice(0, dot) + magnitude.slice(dot + 1).padEnd(widest, '0');
    sum += (negative ? -1n : 1n) * BigInt(padded);
  }
  const negative = sum < 0n;
  const digits = (negative ? -sum : sum).toString().padStart(widest + 1, '0');
  const whole = widest === 0 ? digits : digits.slice(0, digits.length - widest);
  const fraction = widest === 0 ? '' : `.${digits.slice(digits.length - widest)}`;
  const combined = `${whole}${fraction}`;
  return negative ? `-${combined}` : combined;
}

/** Validate a non-negative exact decimal budget (capital/risk budgets are zero-or-positive). */
export function isNonNegativeDecimal(value: string): boolean {
  return isExactDecimal(value) && !value.startsWith('-');
}

/**
 * FW-46 (the S2 market surface): THE EXACT-DECIMAL COMPARE — two canonical
 * decimal strings compared BY VALUE (scale-lifted BigInt integers, the
 * sumExactDecimals law): -1 when a < b, 0 when equal, 1 when a > b. The
 * price-alert firing law rides this (a recorded price crosses a declared
 * level BY VALUE, never a float, never lexicographically). A malformed
 * operand is the typed error (the discipline's own law).
 */
export function compareExactDecimals(a: string, b: string): -1 | 0 | 1 {
  if (!isExactDecimal(a) || !isExactDecimal(b)) {
    throw new Error(`compareExactDecimals: ${JSON.stringify(isExactDecimal(a) ? b : a)} is not an exact decimal string — comparisons run on the served records, never coerced operands`);
  }
  const parse = (value: string): { readonly digits: bigint; readonly scale: number; readonly negative: boolean } => {
    const negative = value.startsWith('-');
    const magnitude = negative ? value.slice(1) : value;
    const dot = magnitude.indexOf('.');
    const whole = dot === -1 ? magnitude : magnitude.slice(0, dot);
    const fraction = dot === -1 ? '' : magnitude.slice(dot + 1);
    return { digits: BigInt(`${whole}${fraction}`), scale: fraction.length, negative };
  };
  const left = parse(a);
  const right = parse(b);
  const scale = Math.max(left.scale, right.scale);
  const lift = (value: { readonly digits: bigint; readonly scale: number; readonly negative: boolean }): bigint => {
    const byTen = 10n ** BigInt(scale - value.scale);
    return (value.negative ? -value.digits : value.digits) * byTen;
  };
  const leftLifted = lift(left);
  const rightLifted = lift(right);
  if (leftLifted < rightLifted) return -1;
  if (leftLifted > rightLifted) return 1;
  return 0;
}

/**
 * FW-40-A (Round H register H-3 — L2's find): THE SIZING DIVISION,
 * mirroring the boundary's own law VERBATIM (deploy/vercel/runtime/
 * project-evidence.ts's divideDecimalsFloor — the FW-36-A sizing
 * discipline): the largest canonical decimal with AT MOST 6 fraction
 * digits that is <= a / b, for a >= 0 and b > 0 — never a float, never a
 * non-terminating decimal. null when either input is outside the exact
 * grammar, when either is negative, or when b is zero (the caller folds
 * to the honest unknown, never a fabricated fraction).
 *
 * The concentration standing row (core/standing.ts) rides this: the
 * largest single position's notional share of the fill-derived book,
 * floored at the boundary's own six-digit resolution — the console's
 * standing fraction and the boundary's own gate arithmetic agree by
 * construction (L20), and the console never claims finer resolution
 * than the boundary serves.
 */
export function divideDecimalsFloor(a: string, b: string): string | null {
  if (!isExactDecimal(a) || !isExactDecimal(b)) return null;
  if (a.startsWith('-') || b.startsWith('-')) return null;
  const parse = (value: string): { readonly digits: bigint; readonly scale: number } => {
    const dot = value.indexOf('.');
    const whole = dot === -1 ? value : value.slice(0, dot);
    const fraction = dot === -1 ? '' : value.slice(dot + 1);
    return { digits: BigInt(`${whole}${fraction}`), scale: fraction.length };
  };
  const left = parse(a);
  const right = parse(b);
  if (right.digits === 0n) return null; // no denominator — the caller's honest-unknown arm
  const scale = Math.max(left.scale, right.scale);
  const leftLifted = left.digits * 10n ** BigInt(scale - left.scale);
  const rightLifted = right.digits * 10n ** BigInt(scale - right.scale);
  const quotient = (leftLifted * 1_000_000n) / rightLifted; // BigInt division floors — exact by construction
  // Format at scale 6, then strip trailing fraction zeros (the boundary's
  // own canonical form — '0.666640' renders as '0.66664').
  let digits = quotient;
  let outScale = 6;
  while (outScale > 0 && digits % 10n === 0n) {
    digits /= 10n;
    outScale -= 1;
  }
  const plain = digits.toString();
  const body = outScale === 0 ? plain : `${plain.padStart(outScale + 1, '0').slice(0, -outScale)}.${plain.padStart(outScale + 1, '0').slice(-outScale)}`;
  return body;
}
