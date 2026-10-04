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

/** Validate a non-negative exact decimal budget (capital/risk budgets are zero-or-positive). */
export function isNonNegativeDecimal(value: string): boolean {
  return isExactDecimal(value) && !value.startsWith('-');
}
