/**
 * Exact decimal arithmetic — behavioral tests: boundaries, exactness,
 * canonicalization, grid alignment, and the one declared rounding.
 */

import { describe, expect, it } from 'vitest';

import {
  add,
  ceilToGrid,
  compare,
  divideRoundHalfUp,
  floorToGrid,
  isAlignedToGrid,
  isCanonicalDecimal,
  isCanonicalPositiveDecimal,
  isEqual,
  isUnsignedDecimal,
  isZero,
  multiply,
  normalize,
  roundHalfUp,
  subtract,
} from './decimals';

describe('decimal guards (the two mirrored grammars)', () => {
  it('accepts the market-protocol unsigned grammar (loose: leading zeros tolerated)', () => {
    expect(isUnsignedDecimal('0')).toBe(true);
    expect(isUnsignedDecimal('01.2')).toBe(true);
    expect(isUnsignedDecimal('43125.10')).toBe(true);
    expect(isUnsignedDecimal('.5')).toBe(false);
    expect(isUnsignedDecimal('5.')).toBe(false);
    expect(isUnsignedDecimal('-1')).toBe(false);
    expect(isUnsignedDecimal('1e5')).toBe(false);
    expect(isUnsignedDecimal(1.5)).toBe(false);
  });

  it('accepts the domain-core canonical grammar (strict: no leading zeros)', () => {
    expect(isCanonicalDecimal('0')).toBe(true);
    expect(isCanonicalDecimal('1234.5678')).toBe(true);
    expect(isCanonicalDecimal('01.2')).toBe(false);
    expect(isCanonicalDecimal('-3.5')).toBe(false);
    expect(isCanonicalPositiveDecimal('0.5')).toBe(true);
    expect(isCanonicalPositiveDecimal('0')).toBe(false);
    expect(isCanonicalPositiveDecimal('0.00')).toBe(false);
    expect(isCanonicalPositiveDecimal('1')).toBe(true);
  });
});

describe('exact comparison', () => {
  it('compares correctly beyond float precision', () => {
    expect(compare('0.0000001', '0.00000001')).toBe(1);
    expect(compare('0.00000001', '0.0000001')).toBe(-1);
    expect(compare('9007199254740993', '9007199254740992')).toBe(1);
    expect(compare('1.5', '1.50')).toBe(0);
    expect(compare('0', '0.0')).toBe(0);
    expect(compare('10', '9.999999999999999999999')).toBe(1);
  });

  it('isEqual and isZero agree with compare', () => {
    expect(isEqual('1.5', '1.50')).toBe(true);
    expect(isEqual('2', '1')).toBe(false);
    expect(isZero('0')).toBe(true);
    expect(isZero('0.000')).toBe(true);
    expect(isZero('0.1')).toBe(false);
  });
});

describe('exact arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(add('0.1', '0.2')).toBe('0.3');
    expect(add('1', '1')).toBe('2');
    expect(add('0.0000001', '0.00000001')).toBe('0.00000011');
    expect(subtract('1', '0.999999999999999999999')).toBe('0.000000000000000000001');
    expect(subtract('5', '5')).toBe('0');
  });

  it('subtraction throws on negative results (the unsigned domain law)', () => {
    expect(() => subtract('1', '2')).toThrow(/unsigned decimal domain/);
  });

  it('multiplies exactly', () => {
    expect(multiply('43125.10', '0.017')).toBe('733.1267');
    expect(multiply('0.1', '0.1')).toBe('0.01');
    // The exact product: ~1.219e17 (the classic full-precision value).
    expect(multiply('123456789.123456789', '987654321.987654321')).toBe('121932631356500531.347203169112635269');
  });

  it('normalizes loose grammar to canonical form', () => {
    expect(normalize('01.20')).toBe('1.2');
    expect(normalize('0.500')).toBe('0.5');
    expect(normalize('000')).toBe('0');
    expect(normalize('7')).toBe('7');
  });
});

describe('rounding (the ONE declared approximation)', () => {
  it('rounds half-up at the boundary', () => {
    expect(roundHalfUp('0.000000015', 8)).toBe('0.00000002');
    expect(roundHalfUp('0.000000014', 8)).toBe('0.00000001');
    expect(roundHalfUp('2.5', 0)).toBe('3');
    expect(roundHalfUp('3.5', 0)).toBe('4');
    expect(roundHalfUp('2.4', 0)).toBe('2');
    expect(roundHalfUp('1.005', 2)).toBe('1.01');
  });

  it('leaves already-precise values untouched (no trailing-zero inflation)', () => {
    expect(roundHalfUp('1.2', 8)).toBe('1.2');
    expect(roundHalfUp('7', 2)).toBe('7');
  });

  it('divides and rounds half-up exactly', () => {
    expect(divideRoundHalfUp('1', '3', 6)).toBe('0.333333');
    expect(divideRoundHalfUp('2', '3', 6)).toBe('0.666667');
    expect(divideRoundHalfUp('10', '4', 2)).toBe('2.5');
    expect(divideRoundHalfUp('1', '10000', 8)).toBe('0.0001');
    expect(() => divideRoundHalfUp('1', '0', 2)).toThrow(/zero denominator/);
  });
});

describe('grid alignment (tick and lot)', () => {
  it('detects multiples exactly', () => {
    expect(isAlignedToGrid('100.00', '0.01')).toBe(true);
    expect(isAlignedToGrid('100.005', '0.01')).toBe(false);
    expect(isAlignedToGrid('0.3', '0.1')).toBe(true);
    expect(isAlignedToGrid('0.35', '0.1')).toBe(false);
    expect(isAlignedToGrid('0.003', '0.001')).toBe(true);
    expect(isAlignedToGrid('0.0007', '0.001')).toBe(false);
    // Loose grammar handled via normalization internally.
    expect(isAlignedToGrid('100.00', '0.010')).toBe(true);
  });

  it('floors and ceils onto the grid', () => {
    expect(floorToGrid('100.057', '0.01')).toBe('100.05');
    expect(ceilToGrid('100.051', '0.01')).toBe('100.06');
    expect(floorToGrid('100', '0.01')).toBe('100');
    expect(ceilToGrid('100', '0.01')).toBe('100');
    expect(floorToGrid('0.007', '0.01')).toBe('0');
    expect(ceilToGrid('0.007', '0.01')).toBe('0.01');
  });
});
