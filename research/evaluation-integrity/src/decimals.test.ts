/**
 * @tradrl/evaluation-integrity — exact decimal arithmetic tests.
 *
 * Laws under test (decimals.ts):
 * - lexical forms (unsigned/signed, mirrors of the program-wide discipline);
 * - exact comparison across representation scales ("0.5" == "0.5000");
 * - exact addition/subtraction at the wider scale;
 * - the exact mean: scaled-bigint, single half-even division, no float ever;
 * - scale conformance guard (`isDecimalAtScale`);
 * - determinism: same inputs -> same strings, always.
 */

import { describe, expect, it } from 'vitest';

import {
  addDecimals,
  compareDecimals,
  decimalScale,
  decimalsEqual,
  isDecimalAtScale,
  isSignedDecimal,
  isUnsignedDecimal,
  maxDecimal,
  meanDecimals,
  normalizeDecimal,
  subtractDecimals,
} from './index';

describe('lexical forms', () => {
  it('accepts well-formed decimals', () => {
    for (const good of ['0', '1', '0.5', '0.2500', '123.456', '-0.0021', '+3.14', '999999']) {
      expect(isSignedDecimal(good)).toBe(true);
    }
    for (const unsigned of ['0', '1', '0.5', '999999']) {
      expect(isUnsignedDecimal(unsigned)).toBe(true);
    }
  });

  it('rejects malformed decimals', () => {
    for (const bad of ['', '.5', '5.', '1,5', '1e5', 'abc', '--1', '0x1', 'Infinity', 'NaN', null, 0.5]) {
      expect(isSignedDecimal(bad)).toBe(false);
      expect(isUnsignedDecimal(bad)).toBe(false);
    }
    expect(isUnsignedDecimal('-1')).toBe(false);
    expect(isSignedDecimal('-1')).toBe(true);
  });

  it('reports the fractional scale', () => {
    expect(decimalScale('1')).toBe(0);
    expect(decimalScale('0.5')).toBe(1);
    expect(decimalScale('0.2500')).toBe(4);
  });
});

describe('exact comparison', () => {
  it('value equality is independent of representation scale', () => {
    expect(decimalsEqual('0.5', '0.5000')).toBe(true);
    expect(decimalsEqual('1', '1.000')).toBe(true);
    expect(decimalsEqual('0', '0.0')).toBe(true);
    expect(decimalsEqual('-0', '0')).toBe(true);
    expect(compareDecimals('0.5', '0.5000')).toBe(0);
  });

  it('ordering is exact', () => {
    expect(compareDecimals('0.1', '0.2')).toBe(-1);
    expect(compareDecimals('0.2', '0.1')).toBe(1);
    expect(compareDecimals('-0.2', '-0.1')).toBe(-1);
    expect(compareDecimals('-1', '0.0000001')).toBe(-1);
    expect(compareDecimals('2', '1.999999999')).toBe(1);
    expect(maxDecimal('0.1', '0.2')).toBe('0.2');
  });

  it('float-hazard cases compare exactly (where floats would lie)', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754; here the comparison is exact.
    expect(decimalsEqual(addDecimals('0.1', '0.2'), '0.3')).toBe(true);
    expect(compareDecimals(subtractDecimals('0.3', '0.1'), '0.2')).toBe(0);
  });
});

describe('exact addition and subtraction', () => {
  it('adds at the wider scale', () => {
    expect(addDecimals('1.5', '2.25')).toBe('3.75');
    expect(addDecimals('0.1', '0.2')).toBe('0.3');
    expect(addDecimals('-1.5', '1.5')).toBe('0.0');
    expect(addDecimals('1', '1')).toBe('2');
    expect(addDecimals('0.00001', '0.00002')).toBe('0.00003');
  });

  it('subtracts at the wider scale', () => {
    expect(subtractDecimals('0.3', '0.1')).toBe('0.2');
    expect(subtractDecimals('1', '0.999999999999999999')).toBe('0.000000000000000001');
    expect(subtractDecimals('0.5', '1.0')).toBe('-0.5');
    expect(subtractDecimals('-0.5', '-0.5')).toBe('0.0');
  });
});

describe('the exact mean', () => {
  it('computes the mean with a single half-even division', () => {
    expect(meanDecimals(['0.1', '0.2'], 4)).toBe('0.1500');
    expect(meanDecimals(['1', '2', '3', '4'], 2)).toBe('2.50');
    expect(meanDecimals(['-0.5', '0.5'], 4)).toBe('0.0000');
    expect(meanDecimals(['0.00001', '0.00002'], 5)).toBe('0.00002');
  });

  it('rounds half-even at the declared scale', () => {
    // Terms must carry at most the declared scale; rounding happens in the
    // single division. 0.5 at scale 0: half-even rounds to 0 (even).
    expect(meanDecimals(['0', '1'], 0)).toBe('0');
    // 1.5 at scale 0: half-even rounds to 2.
    expect(meanDecimals(['1', '2'], 0)).toBe('2');
    // 2.5 at scale 0: half-even rounds to 2.
    expect(meanDecimals(['2', '3'], 0)).toBe('2');
    // 0.25 at scale 1: half-even rounds to 0.2.
    expect(meanDecimals(['0.2', '0.3'], 1)).toBe('0.2');
    // 0.35 at scale 1: half-even rounds to 0.4.
    expect(meanDecimals(['0.3', '0.4'], 1)).toBe('0.4');
    // Thirds: 1/3 at scale 6 rounds to 0.333333; 2/3 rounds to 0.666667.
    expect(meanDecimals(['0', '1', '1'], 6)).toBe('0.666667');
  });

  it('never constructs a float (exact where IEEE-754 would drift)', () => {
    const many = Array.from({ length: 10 }, () => '0.1');
    expect(meanDecimals(many, 4)).toBe('0.1000');
    // The classic float lie: sum(0.1 x10) !== 1.0 in IEEE-754. Here it is.
    expect(addDecimals(addDecimals('0.1', '0.1'), addDecimals('0.1', '0.1'))).toBe('0.4');
  });

  it('rejects empty values and out-of-range scales', () => {
    expect(() => meanDecimals([], 4)).toThrow();
    expect(() => meanDecimals(['1'], -1)).toThrow();
    expect(() => meanDecimals(['1'], 1.5)).toThrow();
    expect(() => meanDecimals(['1'], 19)).toThrow();
    expect(() => meanDecimals(['1.12345'], 2)).toThrow(); // wider than the declared scale
  });

  it('widens narrower terms exactly by zero padding', () => {
    expect(meanDecimals(['1', '1.5000'], 4)).toBe('1.2500');
  });
});

describe('scale conformance', () => {
  it('isDecimalAtScale demands the exact scale', () => {
    expect(isDecimalAtScale('0.5', 1)).toBe(true);
    expect(isDecimalAtScale('0.50', 1)).toBe(false);
    expect(isDecimalAtScale('1', 0)).toBe(true);
    expect(isDecimalAtScale('-1.250', 3)).toBe(true);
    expect(isDecimalAtScale('nope', 1)).toBe(false);
    expect(isDecimalAtScale(0.5, 1)).toBe(false);
  });
});

describe('determinism', () => {
  it('the same inputs always produce the same strings', () => {
    for (let i = 0; i < 5; i++) {
      expect(meanDecimals(['0.123456', '0.654321', '0.111111'], 6)).toBe('0.296296');
      expect(subtractDecimals('0.654321', '0.123456')).toBe('0.530865');
    }
  });

  it('normalization strips leading zeros and plus signs without changing value', () => {
    expect(normalizeDecimal('+007.500')).toBe('7.500');
    expect(normalizeDecimal('7.500')).toBe('7.500');
    expect(decimalsEqual(normalizeDecimal('+007.500'), '7.5')).toBe(true);
  });
});
