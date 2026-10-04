// Tests for the exact-decimal discipline.
//
// Laws pinned here (decimals.ts header):
//   - the wire grammar: optional sign, no leading zeros, no exponent, no grouping;
//   - the console renders numeric records VERBATIM — exact bytes in, exact bytes out,
//     never through a float, never re-formatted (floats lose digits; the console must not);
//   - budgets are zero-or-positive exact decimals.

import { describe, expect, it } from 'vitest';
import { isDecimalString, isExactDecimal, isNonNegativeDecimal, renderDecimal } from './decimals';

describe('decimals: the exact-decimal grammar', () => {
  it('accepts the wire grammar', () => {
    for (const ok of ['0', '1', '42', '0.5', '123.456', '-3', '-0.25', '9007199254740993', '0.000000001']) {
      expect(isExactDecimal(ok), ok).toBe(true);
    }
  });

  it('rejects everything else', () => {
    for (const bad of [
      '', '+1', '01', '1.', '.5', '-.5', '1e5', '1E5', '1_000', '1,000', ' 1', '1 ', 'abc', 'NaN', 'Infinity',
      '0x10', '1.2.3', '--1', '1..',
    ]) {
      expect(isExactDecimal(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('isDecimalString narrows unknown values', () => {
    expect(isDecimalString('12.5')).toBe(true);
    expect(isDecimalString(12.5)).toBe(false);
    expect(isDecimalString(null)).toBe(false);
    expect(isDecimalString('1e5')).toBe(false);
  });
});

describe('decimals: verbatim rendering (never a float, never re-formatted)', () => {
  it('returns the exact bytes it was given', () => {
    for (const value of ['0', '-17.25', '123456789.001']) {
      expect(renderDecimal(value)).toBe(value);
    }
  });

  it('round-trips digits a float would lose — proof the console never coerces', () => {
    const exact = '0.123456789012345678901234567890123456789';
    expect(renderDecimal(exact)).toBe(exact);
    expect(renderDecimal(exact)).not.toBe(renderDecimal(String(Number(exact))));
  });

  it('a non-decimal string is refused loudly (never silently coerced)', () => {
    expect(() => renderDecimal('1e5')).toThrow(/not an exact decimal/);
    expect(() => renderDecimal('12,5')).toThrow(/not an exact decimal/);
    expect(() => renderDecimal('')).toThrow(/not an exact decimal/);
  });
});

describe('decimals: budgets are zero-or-positive', () => {
  it('accepts zero and positive exact decimals', () => {
    expect(isNonNegativeDecimal('0')).toBe(true);
    expect(isNonNegativeDecimal('0.0001')).toBe(true);
    expect(isNonNegativeDecimal('1000000.50')).toBe(true);
  });

  it('rejects negatives and non-decimals', () => {
    expect(isNonNegativeDecimal('-1')).toBe(false);
    expect(isNonNegativeDecimal('-0.5')).toBe(false);
    expect(isNonNegativeDecimal('abc')).toBe(false);
    expect(isNonNegativeDecimal('1e3')).toBe(false);
  });
});
