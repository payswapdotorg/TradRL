// @tradrl/body-trading-director — decimals tests (exact decimal-string
// numerics: the lexical forms, comparison, means, dispersions, sums and
// products — the synthesis arithmetic's determinism anchors).

import { describe, expect, it } from 'vitest';
import {
  compareDecimal,
  decimalAbs,
  decimalDispersion,
  decimalMean,
  decimalMultiply,
  decimalSum,
  isPositiveDecimal,
  isSignedDecimal,
  isSignedPositiveDecimal,
  isUnsignedDecimal,
} from './decimals';

describe('lexical forms', () => {
  it('unsigned decimals', () => {
    expect(isUnsignedDecimal('0')).toBe(true);
    expect(isUnsignedDecimal('0.5')).toBe(true);
    expect(isUnsignedDecimal('0.2500')).toBe(true);
    expect(isUnsignedDecimal('1')).toBe(true);
    expect(isUnsignedDecimal('')).toBe(false);
    expect(isUnsignedDecimal('-0.5')).toBe(false);
    expect(isUnsignedDecimal('+1')).toBe(false);
    expect(isUnsignedDecimal('1.')).toBe(false);
    expect(isUnsignedDecimal('.5')).toBe(false);
    expect(isUnsignedDecimal(0.5)).toBe(false);
  });

  it('signed decimals', () => {
    expect(isSignedDecimal('-0.0021')).toBe(true);
    expect(isSignedDecimal('+3.14')).toBe(true);
    expect(isSignedDecimal('3.14')).toBe(true);
    expect(isSignedDecimal('1e5')).toBe(false);
    expect(isSignedDecimal('--1')).toBe(false);
  });

  it('positive-decimal checks', () => {
    expect(isPositiveDecimal('0.01')).toBe(true);
    expect(isPositiveDecimal('0.0000')).toBe(false);
    expect(isSignedPositiveDecimal('-0.01')).toBe(false);
    expect(isSignedPositiveDecimal('0.01')).toBe(true);
  });
});

describe('exact comparison', () => {
  it('compares magnitudes and signs beyond float precision', () => {
    expect(compareDecimal('0.0000001', '0.00000001')).toBe(1);
    expect(compareDecimal('-0.0021', '-0.0020')).toBe(-1);
    expect(compareDecimal('0.10', '0.1')).toBe(0);
    expect(compareDecimal('-0.5', '0.5')).toBe(-1);
    expect(compareDecimal('0', '-0')).toBe(0);
  });

  it("THE ZERO BRANCH (this lane's fix, flagged for ratification): zero vs nonzero", () => {
    expect(compareDecimal('0', '0.02')).toBe(-1);
    expect(compareDecimal('0.0000', '0.02')).toBe(-1);
    expect(compareDecimal('0', '-0.02')).toBe(1);
    expect(compareDecimal('0.02', '0')).toBe(1);
    expect(compareDecimal('-0.02', '0')).toBe(-1);
  });
});

describe('scaled exact arithmetic', () => {
  it('decimalMean: exact means at the declared scale', () => {
    expect(decimalMean(['-0.21', '0.35'], 4, 'half-even')).toBe('0.0700');
    expect(decimalMean(['0'], 4, 'half-even')).toBe('0.0000');
    expect(decimalMean([], 4, 'half-even')).toBe('0.0000');
    expect(decimalMean(['0.0060', '0.0417'], 4, 'half-even')).toBe('0.0238');
    expect(decimalMean(['0.0242', '0.0390', '0.0800'], 4, 'half-even')).toBe('0.0477');
    expect(decimalMean(['-0.0242', '-0.0390', '-0.0800'], 4, 'half-even')).toBe('-0.0477');
    expect(decimalMean(['-0.0300', '-0.0600', '1.0000', '0.0000', '-0.0300'], 4, 'half-even')).toBe('0.1760');
  });

  it('decimalMean: half-even ties to even', () => {
    expect(decimalMean(['0.00005'], 4, 'half-even')).toBe('0.0000');
    expect(decimalMean(['0.00015'], 4, 'half-even')).toBe('0.0002');
  });

  it('decimalMean: truncate never rounds up', () => {
    expect(decimalMean(['0.00019'], 4, 'truncate')).toBe('0.0001');
    expect(decimalMean(['-0.00019'], 4, 'truncate')).toBe('-0.0001');
  });

  it('decimalDispersion: max - min; null for fewer than two values', () => {
    expect(decimalDispersion(['0.31', '0.29', '0.33', '0.27', '0.30'], 4, 'half-even')).toBe('0.0600');
    expect(decimalDispersion(['5'], 4, 'half-even')).toBeNull();
    expect(decimalDispersion([], 4, 'half-even')).toBeNull();
  });

  it('decimalAbs: exact absolute value at the declared scale', () => {
    expect(decimalAbs('-0.0200', 4, 'half-even')).toBe('0.0200');
    expect(decimalAbs('0.0200', 4, 'half-even')).toBe('0.0200');
  });

  it('decimalSum: exact signed sums (the net-tilt primitive)', () => {
    expect(decimalSum(['1', '1', '1'], 4, 'half-even')).toBe('3.0000');
    expect(decimalSum(['1', '1', '-1'], 4, 'half-even')).toBe('1.0000');
    expect(decimalSum([], 4, 'half-even')).toBe('0.0000');
    expect(decimalSum(['-1'], 4, 'half-even')).toBe('-1.0000');
  });

  it('decimalMultiply: exact products (the tilt-rendering primitive)', () => {
    expect(decimalMultiply('3.0000', '0.01', 4, 'half-even')).toBe('0.0300');
    expect(decimalMultiply('2.0000', '0.01', 4, 'half-even')).toBe('0.0200');
    expect(decimalMultiply('1.0000', '0.01', 4, 'half-even')).toBe('0.0100');
    expect(decimalMultiply('-2.0000', '0.01', 4, 'half-even')).toBe('-0.0200');
    expect(decimalMultiply('0.0000', '0.01', 4, 'half-even')).toBe('0.0000');
  });
});
