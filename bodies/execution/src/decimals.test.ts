// @tradrl/body-execution — decimals tests: the execution-lane canonical
// grammar, THE EXACT-DECIMAL ACCOUNTING LAW (float mediation is the
// typed decimal_imprecision), comparisons, sums, differences.

import { describe, expect, it } from 'vitest';
import {
  compareDecimal,
  decimalAbs,
  decimalMultiply,
  decimalSubtract,
  decimalSum,
  isCanonicalDecimal,
  isCanonicalPositiveDecimal,
  isSignedDecimal,
  isUnsignedDecimal,
  isZeroDecimal,
  quantityProblems,
} from './decimals';

describe('the canonical grammar (the execution-lane mirror)', () => {
  it('canonical decimals: no leading zeros, at most one fraction', () => {
    expect(isCanonicalDecimal('0')).toBe(true);
    expect(isCanonicalDecimal('0.5')).toBe(true);
    expect(isCanonicalDecimal('0.2500')).toBe(true);
    expect(isCanonicalDecimal('1')).toBe(true);
    expect(isCanonicalDecimal('01')).toBe(false);
    expect(isCanonicalDecimal('1.')).toBe(false);
    expect(isCanonicalDecimal('.5')).toBe(false);
    expect(isCanonicalDecimal('-0.5')).toBe(false);
    expect(isCanonicalDecimal('1.2.3')).toBe(false);
    expect(isCanonicalDecimal(0.5)).toBe(false);
  });

  it('canonical positive: strictly positive', () => {
    expect(isCanonicalPositiveDecimal('0.75')).toBe(true);
    expect(isCanonicalPositiveDecimal('0')).toBe(false);
    expect(isCanonicalPositiveDecimal('0.000')).toBe(false);
    expect(isCanonicalPositiveDecimal('00.5')).toBe(false);
  });

  it('the looser input grammars still validate', () => {
    expect(isUnsignedDecimal('00.5')).toBe(true);
    expect(isSignedDecimal('-0.0021')).toBe(true);
    expect(isSignedDecimal('+3.14')).toBe(true);
    expect(isSignedDecimal('3')).toBe(true);
    expect(isSignedDecimal('-')).toBe(false);
  });
});

describe('THE EXACT-DECIMAL ACCOUNTING LAW (float mediation refused)', () => {
  it('a JS number in a quantity position is the typed decimal_imprecision — NEVER coerced', () => {
    const errors = quantityProblems('quantity', 0.1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('decimal_imprecision');
    expect(errors[0]?.message).toContain('float mediation is refused');
  });

  it('a malformed decimal string is decimal_invalid', () => {
    expect(quantityProblems('quantity', 'abc')[0]?.code).toBe('decimal_invalid');
    expect(quantityProblems('quantity', '1.2.3')[0]?.code).toBe('decimal_invalid');
    expect(quantityProblems('quantity', '')).toHaveLength(1);
  });

  it('a non-canonical-but-well-formed decimal is decimal_invalid (the grammar law)', () => {
    expect(quantityProblems('quantity', '00.75')[0]?.code).toBe('decimal_invalid');
    expect(quantityProblems('quantity', '0.75')).toEqual([]);
    expect(quantityProblems('quantity', '075')).toHaveLength(1);
  });

  it('a non-string, non-number is invalid_field', () => {
    const errors = quantityProblems('quantity', null);
    expect(errors[0]?.code).toBe('invalid_field');
    expect(quantityProblems('quantity', { quantity: '0.75' })).toHaveLength(1);
  });
});

describe('exact comparisons', () => {
  it('compareDecimal is correct beyond float precision (including the zero branch)', () => {
    expect(compareDecimal('0.1', '0.1')).toBe(0);
    expect(compareDecimal('0.75', '0.74')).toBe(1);
    expect(compareDecimal('0.74', '0.75')).toBe(-1);
    expect(compareDecimal('-0.5', '0.5')).toBe(-1);
    expect(compareDecimal('-2', '-1')).toBe(-1);
    expect(compareDecimal('0.10', '0.1')).toBe(0);
    // THE ZERO BRANCH (the corrected semantics — the director lane's ratified fix):
    expect(compareDecimal('0', '0.0001')).toBe(-1);
    expect(compareDecimal('0', '-0.0001')).toBe(1);
    expect(compareDecimal('0.0001', '0')).toBe(1);
    expect(compareDecimal('-0.0001', '0')).toBe(-1);
  });

  it('isZeroDecimal detects exact zero', () => {
    expect(isZeroDecimal('0')).toBe(true);
    expect(isZeroDecimal('0.000')).toBe(true);
    expect(isZeroDecimal('0.0001')).toBe(false);
  });

  it('precision far beyond float: 0.1234567890123456789 vs 0.1234567890123456788', () => {
    expect(compareDecimal('0.1234567890123456789', '0.1234567890123456788')).toBe(1);
  });
});

describe('exact arithmetic (BigInt fixed-point — no float ever)', () => {
  it('decimalSum accumulates exactly (the cumulative-fill primitive)', () => {
    expect(decimalSum(['0.5', '0.25'], 8, 'half-even')).toBe('0.75000000');
    expect(decimalSum(['0.5', '0.24'], 8, 'half-even')).toBe('0.74000000');
    expect(decimalSum(['0.1', '0.2'], 8, 'half-even')).toBe('0.30000000'); // the float trap, exactly escaped
    expect(decimalSum([], 8, 'half-even')).toBe('0.00000000');
    expect(decimalSum(['-0.25', '0.5'], 8, 'half-even')).toBe('0.25000000');
    expect(decimalSum(['0.5', '0.25'], 2, 'half-even')).toBe('0.75');
  });

  it('decimalSubtract computes the exact difference (the reconciliation-gap primitive)', () => {
    expect(decimalSubtract('0.75', '0.75', 8, 'half-even')).toBe('0.00000000');
    expect(decimalSubtract('0.75', '0.74', 8, 'half-even')).toBe('0.01000000');
    expect(decimalSubtract('0.74', '0.75', 8, 'half-even')).toBe('-0.01000000');
    expect(decimalSubtract('0.1', '0.2', 8, 'half-even')).toBe('-0.10000000');
    expect(decimalSubtract('0.75', '0.75', 2, 'half-even')).toBe('0.00');
  });

  it('decimalAbs renders the absolute value at the declared scale', () => {
    expect(decimalAbs('-0.01', 8, 'half-even')).toBe('0.01000000');
    expect(decimalAbs('0.01', 8, 'half-even')).toBe('0.01000000');
  });

  it('decimalMultiply is exact at the declared scale', () => {
    expect(decimalMultiply('0.5', '0.5', 8, 'half-even')).toBe('0.25000000');
    expect(decimalMultiply('2', '3', 2, 'half-even')).toBe('6.00');
  });

  it('determinism: the same inputs always produce the same bytes', () => {
    const first = decimalSum(['0.5', '0.25', '0.125'], 8, 'half-even');
    const second = decimalSum(['0.5', '0.25', '0.125'], 8, 'half-even');
    expect(first).toBe(second);
    expect(first).toBe('0.87500000');
  });
});
