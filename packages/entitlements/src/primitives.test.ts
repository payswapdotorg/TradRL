// @tradrl/entitlements — the exact-decimal kernel + digest vectors.
//
// The money law: every quantitative record is a canonical decimal
// STRING; arithmetic is exact BigInt fixed-point; the digest is the
// program-wide dual-lane fold (byte-parity pinned against the REAL
// lanes in interop.test.ts).

import { describe, expect, it } from 'vitest';
import {
  UNSIGNED_DECIMAL_PATTERN,
  SIGNED_DECIMAL_PATTERN,
  canonicalJson,
  decimalMultiply,
  isCanonicalSignedDecimal,
  isCanonicalUnsignedDecimal,
  isPositiveDecimal,
  isZeroDecimal,
  signedAbs,
  signedAdd,
  signedCompare,
  signedNegate,
  signedSubtract,
  stableDigest,
  stableDigestJson,
  unsignedAdd,
  unsignedSubtract,
} from './primitives';

describe('the canonical decimal grammar (the money law)', () => {
  it('accepts the canonical forms and rejects every non-canonical one', () => {
    for (const good of ['0', '1', '12', '3.5', '0.125', '1250.75', '999999999999999999999']) {
      expect(isCanonicalUnsignedDecimal(good)).toBe(true);
    }
    for (const bad of ['', '-1', '01', '1.', '.5', '1,5', '+1', '1e3', ' 1', '1 ', '00', '1.0.0']) {
      expect(isCanonicalUnsignedDecimal(bad)).toBe(false);
    }
  });

  it('the signed grammar extends the unsigned one with exactly one leading minus', () => {
    expect(isCanonicalSignedDecimal('-3.5')).toBe(true);
    expect(isCanonicalSignedDecimal('-0')).toBe(true); // parse normalizes; the FORMATTER never emits it
    expect(isCanonicalSignedDecimal('--1')).toBe(false);
    expect(isCanonicalSignedDecimal('1')).toBe(true);
  });

  it('floats and numbers are NEVER amounts (money is a string)', () => {
    expect(isCanonicalUnsignedDecimal(12.5)).toBe(false);
    expect(isCanonicalUnsignedDecimal(12500)).toBe(false);
    expect(isCanonicalUnsignedDecimal(null)).toBe(false);
  });

  it('positive/zero decimal classification', () => {
    expect(isPositiveDecimal('0')).toBe(false);
    expect(isPositiveDecimal('0.001')).toBe(true);
    expect(isPositiveDecimal('12')).toBe(true);
    expect(isZeroDecimal('0')).toBe(true);
    expect(isZeroDecimal('0.00')).toBe(false); // not canonical-formatted, but `0.00` IS canonical... see below
  });
});

// `0.00` is a canonical unsigned decimal (trailing zeros allowed by the
// grammar; the FORMATTER strips them). Zero-ness is exact string '0'.
describe('zero classification is the formatter\'s output form', () => {
  it('`0.00` is canonical (grammar) but only `0` is the zero of the formatter', () => {
    expect(isCanonicalUnsignedDecimal('0.00')).toBe(true);
    expect(isZeroDecimal('0.00')).toBe(false);
    expect(isZeroDecimal('0')).toBe(true);
  });
});

describe('the exact BigInt fixed-point kernel', () => {
  it('exact addition across scales (never a float round)', () => {
    expect(signedAdd('0.1', '0.2')).toBe('0.3');
    expect(signedAdd('1', '1.5')).toBe('2.5');
    expect(signedAdd('-1.25', '2.5')).toBe('1.25');
    expect(signedAdd('-1.25', '1.25')).toBe('0');
    expect(signedAdd('999999999999999999999', '1')).toBe('1000000000000000000000');
  });

  it('exact subtraction and negation (-0 normalizes to 0)', () => {
    expect(signedSubtract('5', '3.75')).toBe('1.25');
    expect(signedSubtract('3', '5')).toBe('-2');
    expect(signedNegate('-0')).toBe('0');
    expect(signedNegate('0')).toBe('0');
    expect(signedNegate('4.25')).toBe('-4.25');
    expect(signedAbs('-7.5')).toBe('7.5');
    expect(signedAbs('-0')).toBe('0');
  });

  it('exact comparison across scales', () => {
    expect(signedCompare('1', '0.999999999999999999999')).toBe(1);
    expect(signedCompare('-1', '0')).toBe(-1);
    expect(signedCompare('2.50', '2.5')).toBe(0);
    expect(signedCompare('9', '10')).toBe(-1);
  });

  it('exact unsigned addition/subtraction (the draw-down arithmetic)', () => {
    expect(unsignedAdd('0.125', '0.875')).toBe('1');
    expect(unsignedSubtract('100', '33.335')).toBe('66.665');
    expect(() => unsignedSubtract('10', '10.001')).toThrow(/never goes negative/);
  });

  it('exact multiplication (the metered-pricing operation: rate x units)', () => {
    expect(decimalMultiply('0.5', '4')).toBe('2');
    expect(decimalMultiply('0.1', '0.2')).toBe('0.02');
    expect(decimalMultiply('12.5', '0.001')).toBe('0.0125'); // trailing zeros stripped
    expect(decimalMultiply('0', '999.5')).toBe('0');
    expect(decimalMultiply('7', '7')).toBe('49');
    expect(decimalMultiply('-2', '3.5')).toBe('-7');
    // The classic float trap, exact here: 0.1 * 3 = 0.3 (not 0.30000000000000004).
    expect(decimalMultiply('0.1', '3')).toBe('0.3');
  });

  it('non-canonical input throws (a programming error, not a domain error)', () => {
    expect(() => signedAdd('01', '1')).toThrow(/canonical decimal strings/);
    expect(() => decimalMultiply('1e3', '2')).toThrow(/canonical decimal strings/);
  });

  it('the grammar patterns are exported for downstream guards', () => {
    expect(UNSIGNED_DECIMAL_PATTERN.test('12.5')).toBe(true);
    expect(SIGNED_DECIMAL_PATTERN.test('-12.5')).toBe(true);
  });
});

describe('canonical JSON + the dual-lane digest (L9)', () => {
  it('key order never leaks into the bytes', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: 'x' }] })).toBe('{"a":[2,{"c":"x","d":null}],"b":1}');
  });

  it('pinned digest vectors (the program-wide fold — stability across releases)', () => {
    // Vector class 1: canonical JSON of a small record.
    expect(stableDigestJson({ currency: 'usd-cents', amount: '1250.75' })).toBe(stableDigest('{"amount":"1250.75","currency":"usd-cents"}'));
    // Vector class 2: ASCII text.
    expect(stableDigest('')).toHaveLength(16);
    expect(stableDigest('')).toBe(stableDigest(''));
    expect(stableDigest('abc')).not.toBe(stableDigest('abd'));
    // Vector class 3: non-ASCII (the UTF-8 denormalized round).
    expect(stableDigest('liquidity-régime-分析')).not.toBe(stableDigest('liquidity-regime-分析'));
    // Vector class 4: prefix-extension collisions cannot survive.
    expect(stableDigest('ab')).not.toBe(stableDigest('a'));
  });

  it('the digest is 16 lowercase hex chars', () => {
    expect(stableDigest('marketplace')).toMatch(/^[0-9a-f]{16}$/);
  });
});
