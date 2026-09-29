// @tradrl/body-sentiment-researcher — exact decimal arithmetic tests.

import { describe, expect, it } from 'vitest';

import {
  compareDecimal,
  decimalAbs,
  decimalDispersion,
  decimalMean,
  isSignedDecimal,
  isUnsignedDecimal,
  ROUNDING_MODES,
} from './decimals';

describe('the mirrored lexical forms', () => {
  it('accepts and rejects the canonical forms exactly', () => {
    expect(isUnsignedDecimal('0.5')).toBe(true);
    expect(isUnsignedDecimal('1')).toBe(true);
    expect(isUnsignedDecimal('-0.5')).toBe(false);
    expect(isSignedDecimal('-0.0021')).toBe(true);
    expect(isSignedDecimal('+3.14')).toBe(true);
    expect(isSignedDecimal('maybe')).toBe(false);
    expect(ROUNDING_MODES).toEqual(['half-even', 'truncate']);
  });
});

describe('exact comparison (beyond float precision)', () => {
  it('compares correctly where floats fail', () => {
    expect(compareDecimal('0.0000001', '0.00000001')).toBe(1);
    expect(compareDecimal('-0.0021', '-0.0020')).toBe(-1);
    expect(compareDecimal('0.10', '0.1')).toBe(0);
    expect(compareDecimal('-0.5', '0.5')).toBe(-1);
    expect(compareDecimal('0', '-0')).toBe(0);
  });
});

describe('scaled exact arithmetic (deterministic — no float ever)', () => {
  it('computes the golden mean exactly (scale 4, half-even)', () => {
    expect(decimalMean(['0.3100', '0.2900', '0.3300', '0.2700', '0.3000'], 4, 'half-even')).toBe('0.3000');
    expect(decimalMean(['-0.21', '0.35'], 4, 'half-even')).toBe('0.0700');
    expect(decimalMean(['0'], 4, 'half-even')).toBe('0.0000');
  });

  it('rounds half-even exactly (banker\'s rounding at the tie)', () => {
    // 0.00005 at scale 4 is the exact tie -> rounds to even 0.0000
    expect(decimalMean(['0.0001'], 4, 'half-even')).toBe('0.0001');
    // mean of [0.00005] at scale 4 -> 0.0001? mean of a single value is the value rounded
    expect(decimalMean(['0.00005'], 4, 'half-even')).toBe('0.0000');
    // truncate mode keeps 0
    expect(decimalMean(['0.00005'], 4, 'truncate')).toBe('0.0000');
    expect(decimalMean(['-0.00005'], 4, 'half-even')).toBe('0.0000');
  });

  it('dispersion is max - min exactly; null below two observations', () => {
    expect(decimalDispersion(['0.33', '0.27'], 4, 'half-even')).toBe('0.0600');
    expect(decimalDispersion(['-0.21', '0.50'], 4, 'half-even')).toBe('0.7100');
    expect(decimalDispersion(['0.5'], 4, 'half-even')).toBeNull();
    expect(decimalDispersion([], 4, 'half-even')).toBeNull();
  });

  it('abs renders at the declared scale', () => {
    expect(decimalAbs('-0.3100', 4, 'half-even')).toBe('0.3100');
    expect(decimalAbs('0.2', 4, 'half-even')).toBe('0.2000');
  });

  it('is order-independent (commutative bigint addition)', () => {
    const values = ['0.31', '0.29', '0.33', '0.27', '0.30'];
    expect(decimalMean(values, 4, 'half-even')).toBe(decimalMean(values.slice().reverse(), 4, 'half-even'));
  });
});
