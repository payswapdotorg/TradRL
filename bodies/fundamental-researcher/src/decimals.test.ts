// @tradrl/body-fundamental-researcher — the exact-decimal tests.
//
// Behavioral: lexical guards, exact comparison beyond float precision,
// scaled means/dispersions/absolutes/differences/ratios with the two
// declared rounding modes, and the determinism law (same inputs ->
// byte-identical outputs). Negative paths: malformed decimals, a zero
// ratio denominator.

import { describe, expect, it } from 'vitest';
import {
  compareDecimal,
  decimalAbs,
  decimalDispersion,
  decimalMean,
  decimalRatio,
  decimalSub,
  isPositiveDecimal,
  isSignedDecimal,
  isUnsignedDecimal,
} from './decimals';

describe('lexical guards', () => {
  it('accepts the documented unsigned forms', () => {
    for (const value of ['0', '1', '0.5', '104.5000', '12345.678901']) {
      expect(isUnsignedDecimal(value)).toBe(true);
      expect(isSignedDecimal(value)).toBe(true);
    }
  });

  it('accepts the documented signed forms', () => {
    for (const value of ['-0.0021', '+3.14', '-104.5', '0', '3.3']) {
      expect(isSignedDecimal(value)).toBe(true);
    }
  });

  it('rejects malformed forms (negative paths)', () => {
    for (const value of ['', '.5', '5.', '+', '-', '1e3', '0x10', 'NaN', '1,5', ' 1', '1 ']) {
      expect(isUnsignedDecimal(value)).toBe(false);
    }
    for (const value of ['', '+', '-', '1e3', 'abc', '--1']) {
      expect(isSignedDecimal(value)).toBe(false);
    }
    expect(isUnsignedDecimal(42)).toBe(false);
    expect(isUnsignedDecimal(null)).toBe(false);
  });

  it('positive decimals exclude zero', () => {
    expect(isPositiveDecimal('0')).toBe(false);
    expect(isPositiveDecimal('0.0000')).toBe(false);
    expect(isPositiveDecimal('0.1')).toBe(true);
  });
});

describe('exact comparison', () => {
  it('compares correctly beyond float precision', () => {
    expect(compareDecimal('0.1', '0.1')).toBe(0);
    expect(compareDecimal('0.10', '0.1')).toBe(0);
    expect(compareDecimal('-1', '1')).toBe(-1);
    expect(compareDecimal('1', '-1')).toBe(1);
    expect(compareDecimal('0.30000000000000004', '0.3')).toBe(1);
    expect(compareDecimal('-0.5', '-0.4')).toBe(-1);
    expect(compareDecimal('9007199254740993', '9007199254740992')).toBe(1);
    expect(compareDecimal('0', '-0')).toBe(0);
    expect(compareDecimal('-0', '0.0')).toBe(0);
  });
});

describe('scaled arithmetic', () => {
  it('decimalMean is exact and order-independent', () => {
    expect(decimalMean(['100', '101', '100.5', '100.75'], 4, 'half-even')).toBe('100.5625');
    expect(decimalMean(['100.75', '100.5', '101', '100'], 4, 'half-even')).toBe('100.5625');
    expect(decimalMean(['3.3', '3.25'], 4, 'half-even')).toBe('3.2750');
    expect(decimalMean([], 4, 'half-even')).toBe('0.0000');
    // half-even tie: 0.03895 at scale 4 -> 0.0390 (390 is even)
    expect(decimalMean(['0.0625', '0.0154'], 4, 'half-even')).toBe('0.0390');
    expect(decimalMean(['0.0625', '0.0154'], 4, 'truncate')).toBe('0.0389');
  });

  it('decimalDispersion is the exact range, null below two', () => {
    expect(decimalDispersion(['100', '103'], 4, 'half-even')).toBe('3.0000');
    expect(decimalDispersion(['-1', '1'], 4, 'half-even')).toBe('2.0000');
    expect(decimalDispersion(['5'], 4, 'half-even')).toBeNull();
    expect(decimalDispersion([], 4, 'half-even')).toBeNull();
  });

  it('decimalAbs and decimalSub are exact', () => {
    expect(decimalAbs('-0.0021', 4, 'half-even')).toBe('0.0021');
    expect(decimalAbs('3.4', 4, 'half-even')).toBe('3.4000');
    expect(decimalSub('3.4', '3.25', 4, 'half-even')).toBe('0.1500');
    expect(decimalSub('3.25', '3.4', 4, 'half-even')).toBe('-0.1500');
  });

  it('decimalRatio divides exactly on integer rationals', () => {
    expect(decimalRatio('3', '103', 4, 'half-even')).toBe('0.0291');
    expect(decimalRatio('0.15', '3.2', 4, 'half-even')).toBe('0.0469');
    expect(decimalRatio('-0.05', '3.25', 4, 'half-even')).toBe('-0.0154');
    expect(decimalRatio('8', '100', 4, 'half-even')).toBe('0.0800');
    expect(decimalRatio('0', '5', 4, 'half-even')).toBe('0.0000');
  });

  it('decimalRatio refuses a zero denominator (typed throw, never a fabricated value)', () => {
    expect(() => decimalRatio('1', '0', 4, 'half-even')).toThrow(/non-zero/);
  });

  it('the same inputs always yield the same bytes (determinism)', () => {
    const values = ['100.0000', '101.0000', '100.5000', '100.7500', '103.0000'];
    for (let round = 0; round < 2; round += 1) {
      expect(decimalMean(values, 4, 'half-even')).toBe('101.0500');
      expect(decimalDispersion(values, 4, 'half-even')).toBe('3.0000');
    }
  });
});
