// Tests for the exact-decimal discipline.
//
// Laws pinned here (decimals.ts header):
//   - the wire grammar: optional sign, no leading zeros, no exponent, no grouping;
//   - the console renders numeric records VERBATIM — exact bytes in, exact bytes out,
//     never through a float, never re-formatted (floats lose digits; the console must not);
//   - budgets are zero-or-positive exact decimals.

import { describe, expect, it } from 'vitest';
import { isDecimalString, isExactDecimal, isNonNegativeDecimal, renderDecimal, sumExactDecimals } from './decimals';

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

// ---------------------------------------------------------------------------
// FW-34-B (Round C register §3.7 — the execution blotter's aggregate
// totals): THE EXACT DECIMAL SUM. Totals are sums of the served decimal
// strings — BigInt-scaled integer math, never float arithmetic — and an
// operand outside the exact grammar throws the typed error (never a
// silently coerced operand).
// ---------------------------------------------------------------------------

describe('FW-34-B: the exact decimal sum (sumExactDecimals)', () => {
  it('sums exact decimals EXACTLY (the float traps are the point: 0.1 + 0.2 === 0.3 here)', () => {
    expect(sumExactDecimals(['0.1', '0.2'])).toBe('0.3'); // the classic float lie, exact here
    expect(sumExactDecimals(['1000000.50', '250.25', '0.25'])).toBe('1000251.00');
    expect(sumExactDecimals(['1', '2', '3'])).toBe('6');
    expect(sumExactDecimals(['12.345', '0.000001'])).toBe('12.345001'); // mixed fraction widths pad exactly
    expect(sumExactDecimals(['-10.50', '20.25'])).toBe('9.75'); // negatives ride the integer path
    expect(sumExactDecimals(['-10.50', '10.50'])).toBe('0.00'); // sign-cancelling keeps the widest fraction
  });

  it('the empty fold is exactly "0" (the honest empty total)', () => {
    expect(sumExactDecimals([])).toBe('0');
  });

  it('a non-exact operand throws the named error — never a coerced operand, never a silently wrong total', () => {
    expect(() => sumExactDecimals(['1.5', 'abc'])).toThrow(/is not an exact decimal string/);
    expect(() => sumExactDecimals(['1e3'])).toThrow(/is not an exact decimal string/);
    expect(() => sumExactDecimals([''])).toThrow(/is not an exact decimal string/);
  });

  it('scale honesty at the blotter magnitudes (fees at sub-cent precision, notionals at millions)', () => {
    expect(sumExactDecimals(['12345678.90', '0.01'])).toBe('12345678.91');
    expect(sumExactDecimals(['999999999.99', '0.01'])).toBe('1000000000.00'); // the carry widens the whole part
    expect(sumExactDecimals(['0.001', '0.009'])).toBe('0.010'); // the widest fraction is preserved verbatim
  });
});
