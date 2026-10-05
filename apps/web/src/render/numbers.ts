// @tradrl/web-console — deterministic numeric display formatting.
//
// THE LAW (W-19, the R5 fix): a limit without a number is not a
// limit. The boundary serves constraint/success-criterion bounds as
// JSON NUMBERS (api/contracts.ts CriterionPredicate.bound/value) —
// the exact-decimal law (core/decimals.ts) governs the DECIMAL
// STRINGS the records carry and those still render verbatim through
// renderDecimal; this module is the display-side companion for the
// numeric fields: pure, deterministic, locale-free grouping (no
// Intl, no Number.toLocaleString — identical inputs produce
// identical bytes on every machine, forever, per core/format.ts's
// charter). No arithmetic ever happens here — only presentation.

/**
 * Format one number with deterministic thousands grouping
 * (e.g. 25000000 -> "25,000,000"; 0.2 -> "0.2"; -1234.5 ->
 * "-1,234.5"). Exponent-notation numbers (|value| >= 1e21) render
 * verbatim — expanding them would be float arithmetic by another
 * name. Non-finite values render as their String form (they never
 * come from a served record; the guard keeps the function total).
 */
export function formatNumberGrouped(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const text = String(value);
  if (text.includes('e') || text.includes('E')) return text;
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const separator = unsigned.indexOf('.');
  const intPart = separator === -1 ? unsigned : unsigned.slice(0, separator);
  const fracPart = separator === -1 ? '' : unsigned.slice(separator);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fracPart}`;
}
