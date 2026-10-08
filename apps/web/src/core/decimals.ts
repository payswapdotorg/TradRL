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
