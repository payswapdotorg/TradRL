// Tests for render/numbers.ts — the deterministic numeric display
// formatting (the R5 fix's display half, W-19).
//
// Laws pinned here:
//   - DETERMINISTIC, locale-free grouping: no Intl, no toLocaleString —
//     identical inputs produce identical bytes on every machine;
//   - the grouping is display-only: no arithmetic, no re-parsing, no
//     rounding — the exact digits the record carried come back out;
//   - the exact-DECIMAL-string law is untouched: decimal strings from
//     the boundary still render verbatim via core/decimals.ts's
//     renderDecimal; this formatter only serves the NUMERIC predicate
//     bounds (CriterionPredicate.bound/value are numbers at the wire).

import { describe, expect, it } from 'vitest';
import { formatNumberGrouped } from './numbers';

describe('numbers: formatNumberGrouped (deterministic, locale-free)', () => {
  it('groups integer thousands exactly (no rounding, no arithmetic)', () => {
    expect(formatNumberGrouped(25_000_000)).toBe('25,000,000');
    expect(formatNumberGrouped(300_000_000)).toBe('300,000,000');
    expect(formatNumberGrouped(1_250_000)).toBe('1,250,000');
  });

  it('small numbers render without grouping', () => {
    expect(formatNumberGrouped(0)).toBe('0');
    expect(formatNumberGrouped(999)).toBe('999');
    expect(formatNumberGrouped(1000)).toBe('1,000');
  });

  it('decimal fractions keep their exact digits (a 0.2 drawdown limit stays 0.2)', () => {
    expect(formatNumberGrouped(0.2)).toBe('0.2');
    expect(formatNumberGrouped(0.25)).toBe('0.25');
    expect(formatNumberGrouped(1234.5)).toBe('1,234.5');
    expect(formatNumberGrouped(12_345_678.901)).toBe('12,345,678.901');
  });

  it('negative numbers group their integer part and keep the sign', () => {
    expect(formatNumberGrouped(-1234)).toBe('-1,234');
    expect(formatNumberGrouped(-12_345_678.5)).toBe('-12,345,678.5');
  });

  it('exponent-notation magnitudes render verbatim (expanding them would be float arithmetic)', () => {
    expect(formatNumberGrouped(1e21)).toBe('1e+21');
    expect(formatNumberGrouped(-1e-7)).toBe('-1e-7');
  });

  it('is deterministic: the same input produces the same bytes, forever', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(formatNumberGrouped(987_654_321)).toBe('987,654,321');
    }
  });
});
