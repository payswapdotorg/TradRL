/**
 * @tradrl/evaluation-splits — exact decimal arithmetic tests (Work Order
 * T032: "gap + embargo widths as exact decimals").
 *
 * Laws under test:
 * - the mirrored scaled-bigint lane is EXACT: additions, subtractions,
 *   comparisons and means never construct a float;
 * - half-even rounding at a declared scale is deterministic;
 * - the forms accept the documented lexical shapes and reject the rest.
 */

import { describe, expect, it } from 'vitest';

import {
  addDecimals,
  compareDecimals,
  decimalsEqual,
  decimalScale,
  isDecimalAtScale,
  isSignedDecimal,
  isUnsignedDecimal,
  maxDecimal,
  meanDecimals,
  normalizeDecimal,
  roundDecimalToScale,
  subtractDecimals,
} from './index';

describe('lexical forms', () => {
  it('accepts the documented unsigned forms', () => {
    for (const value of ['0', '1', '0.5', '259200000', '259200000.125', '0.2500']) {
      expect(isUnsignedDecimal(value)).toBe(true);
    }
  });

  it('rejects malformed unsigned forms', () => {
    for (const value of ['', '-1', '+1', '.5', '1.', '1e3', 'abc', '0x10']) {
      expect(isUnsignedDecimal(value)).toBe(false);
    }
  });

  it('accepts the documented signed forms', () => {
    for (const value of ['-0.0021', '+3.14', '0', '12.5']) {
      expect(isSignedDecimal(value)).toBe(true);
    }
  });
});

describe('comparison and equality', () => {
  it('compares exactly, independent of representation scale', () => {
    expect(compareDecimals('1', '0.999999999999999999')).toBe(1);
    expect(compareDecimals('0.5', '0.5000')).toBe(0);
    expect(compareDecimals('-1', '1')).toBe(-1);
    expect(compareDecimals('-1', '-1.000')).toBe(0);
    expect(decimalsEqual('2.50', '2.5')).toBe(true);
    expect(maxDecimal('0.125', '0.25')).toBe('0.25');
  });

  it('reports the fractional scale', () => {
    expect(decimalScale('1')).toBe(0);
    expect(decimalScale('1.5')).toBe(1);
    expect(decimalScale('0.2500')).toBe(4);
  });
});

describe('exact arithmetic', () => {
  it('adds and subtracts exactly at the wider scale', () => {
    expect(addDecimals('1.25', '2.5')).toBe('3.75');
    expect(addDecimals('0.1', '0.2')).toBe('0.3'); // the float trap, dodged
    expect(addDecimals('1', '0.000000000000000001')).toBe('1.000000000000000001');
    expect(subtractDecimals('1', '0.999999999999999999')).toBe('0.000000000000000001');
    expect(subtractDecimals('0.3', '0.1')).toBe('0.2'); // the float trap, dodged
    expect(subtractDecimals('5', '7.5')).toBe('-2.5');
  });

  it('means exactly with half-even rounding at the declared scale', () => {
    expect(meanDecimals(['1', '2'], 0)).toBe('2'); // 1.5 -> 2 (half-even: 2 is even)
    expect(meanDecimals(['2', '2'], 0)).toBe('2');
    expect(meanDecimals(['1', '1', '1'], 2)).toBe('1.00');
    expect(meanDecimals(['0.1', '0.2', '0.3'], 4)).toBe('0.2000');
    expect(meanDecimals(['-1', '1'], 0)).toBe('0');
    expect(meanDecimals(['-1', '-2'], 0)).toBe('-2'); // -1.5 -> -2 (half-even)
  });

  it('throws on terms wider than the declared scale (callers reject typed first)', () => {
    expect(() => meanDecimals(['0.123'], 2)).toThrow(RangeError);
    expect(() => meanDecimals([], 2)).toThrow(RangeError);
  });

  it('rounds to a declared scale exactly once, half-even or truncated', () => {
    expect(roundDecimalToScale('1.005', 2, 'half-even')).toBe('1.00'); // 0.5 tie -> even neighbor 0
    expect(roundDecimalToScale('1.015', 2, 'half-even')).toBe('1.02'); // tie -> even neighbor 2
    expect(roundDecimalToScale('1.019', 2, 'half-even')).toBe('1.02');
    expect(roundDecimalToScale('1.014', 2, 'half-even')).toBe('1.01');
    expect(roundDecimalToScale('1.019', 2, 'truncate')).toBe('1.01');
    expect(roundDecimalToScale('-1.015', 2, 'half-even')).toBe('-1.02'); // tie on magnitude 1.015 -> 1.02 (even)
    expect(roundDecimalToScale('1.5', 0, 'half-even')).toBe('2');
    expect(roundDecimalToScale('2.5', 0, 'half-even')).toBe('2');
    expect(roundDecimalToScale('1.2', 4, 'half-even')).toBe('1.2000'); // widening is exact
  });
});

describe('rendering helpers', () => {
  it('normalizes away leading zeros and unary plus', () => {
    expect(normalizeDecimal('+001.2300')).toBe('1.2300');
    expect(normalizeDecimal('0')).toBe('0');
  });

  it('checks exact-scale conformance', () => {
    expect(isDecimalAtScale('1.25', 2)).toBe(true);
    expect(isDecimalAtScale('1.250', 2)).toBe(false);
    expect(isDecimalAtScale('1', 0)).toBe(true);
    expect(isDecimalAtScale('1.2', 0)).toBe(false);
  });
});
