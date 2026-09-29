// @tradrl/body-regime-researcher — the exact decimal numerics tests.

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

describe('decimal lexical forms (the market-protocol mirror)', () => {
  it('accepts and rejects the canonical forms exactly', () => {
    expect(isUnsignedDecimal('0.5')).toBe(true);
    expect(isUnsignedDecimal('1')).toBe(true);
    expect(isUnsignedDecimal('0.2500')).toBe(true);
    expect(isUnsignedDecimal('-1')).toBe(false);
    expect(isUnsignedDecimal('+1')).toBe(false);
    expect(isUnsignedDecimal('1.')).toBe(false);
    expect(isUnsignedDecimal('.5')).toBe(false);
    expect(isUnsignedDecimal('')).toBe(false);
    expect(isSignedDecimal('-0.0021')).toBe(true);
    expect(isSignedDecimal('+3.14')).toBe(true);
    expect(isSignedDecimal('-.5')).toBe(false);
    expect(isPositiveDecimal('0')).toBe(false);
    expect(isPositiveDecimal('0.0001')).toBe(true);
    expect(isPositiveDecimal('43125.10')).toBe(true);
  });

  it('compares correctly where floats fail', () => {
    expect(compareDecimal('0.1', '0.3')).toBe(-1);
    expect(compareDecimal('100.60', '100.6')).toBe(0);
    expect(compareDecimal('-0.0021', '0')).toBe(-1);
    expect(compareDecimal('1.00000000000000000001', '1')).toBe(1);
    expect(compareDecimal('-5', '-4')).toBe(-1);
    expect(compareDecimal('-5', '-10')).toBe(1);
  });
});

describe('scaled exact arithmetic (BigInt — no float ever)', () => {
  it('computes the golden mean exactly (scale 4, half-even)', () => {
    expect(decimalMean(['0.5000', '0.4000', '0.5000'], 4, 'half-even')).toBe('0.4667');
    expect(decimalMean(['0.0060', '0.0417'], 4, 'half-even')).toBe('0.0238');
  });

  it('rounds half-even exactly (banker\'s rounding at the tie)', () => {
    // 0.02385 at scale 4 is an exact tie -> rounds to the even digit
    expect(decimalMean(['0.02385'], 4, 'half-even')).toBe('0.0238');
    // 0.02375 -> also a tie -> 0.0238 (even), not 0.0238+1
    expect(decimalMean(['0.02375'], 4, 'half-even')).toBe('0.0238');
    expect(decimalMean(['0.02375'], 4, 'truncate')).toBe('0.0237');
  });

  it('subtracts exactly and keeps the sign', () => {
    expect(decimalSub('104.8000', '100.6000', 4, 'half-even')).toBe('4.2000');
    expect(decimalSub('100.1000', '100.5000', 4, 'half-even')).toBe('-0.4000');
    expect(decimalSub('100', '100', 4, 'half-even')).toBe('0.0000');
  });

  it('divides exactly at the declared scale with the declared rounding', () => {
    expect(decimalRatio('0.6000', '100.0000', 4, 'half-even')).toBe('0.0060');
    expect(decimalRatio('4.2000', '100.6000', 4, 'half-even')).toBe('0.0417');
    expect(decimalRatio('1.4000', '100.6000', 4, 'half-even')).toBe('0.0139');
    expect(decimalRatio('-4.2000', '100.6000', 4, 'half-even')).toBe('-0.0417');
    expect(decimalRatio('4.2000', '-100.6000', 4, 'half-even')).toBe('-0.0417');
    expect(decimalRatio('0', '100.6000', 4, 'half-even')).toBe('0.0000');
    expect(decimalRatio('1', '3', 4, 'truncate')).toBe('0.3333');
  });

  it('a zero denominator is a programming error, never a fabricated value', () => {
    expect(() => decimalRatio('1', '0', 4, 'half-even')).toThrow(TypeError);
    expect(() => decimalRatio('1', '0.0000', 4, 'half-even')).toThrow(TypeError);
  });

  it('dispersion is max - min exactly; null below two observations', () => {
    expect(decimalDispersion(['100.0000', '100.5000', '100.1000', '100.6000'], 4, 'half-even')).toBe('0.6000');
    expect(decimalDispersion(['5'], 4, 'half-even')).toBeNull();
    expect(decimalDispersion([], 4, 'half-even')).toBeNull();
  });

  it('abs renders at the declared scale', () => {
    expect(decimalAbs('-0.0417', 4, 'half-even')).toBe('0.0417');
    expect(decimalAbs('0.0417', 4, 'half-even')).toBe('0.0417');
    expect(decimalAbs('-0', 4, 'half-even')).toBe('0.0000');
  });

  it('is order-independent (commutative bigint addition)', () => {
    const values = ['0.5000', '0.4000', '0.5000', '0.0100'];
    expect(decimalMean(values, 4, 'half-even')).toBe(
      decimalMean(values.slice().reverse(), 4, 'half-even'),
    );
  });
});
