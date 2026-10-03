/**
 * @tradrl/firm-memory — the primitives' laws: canonical JSON byte
 * identity, the FNV digest form, the exact-decimal grammar + signed
 * arithmetic + the unit-interval comparison, the deep-freeze
 * discipline, the timestamp bounds.
 */

import { describe, expect, it } from 'vitest';
import {
  asTimestampMs,
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isCanonicalSignedDecimal,
  isCanonicalUnsignedDecimal,
  isDeeplyFrozen,
  isDigest,
  isTimestampMs,
  isUnitIntervalDecimal,
  signedAbs,
  signedAdd,
  signedCompare,
  signedNegate,
  signedSubtract,
  unitIntervalCompare,
  unsignedAdd,
  isZeroDecimal,
} from './primitives';

describe('canonicalJson (the byte-identity grammar)', () => {
  it('sorts keys and strips whitespace — identical values serialize to identical bytes', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: { y: [3, { x: null }], w: true } })).toBe('{"w":true,"z":{"w":true,"y":[3,{"x":null}]}}'.replace('{"w":true,"z"', '{"z"'));
  });

  it('drops undefined-valued keys deterministically', () => {
    expect(canonicalJson({ a: undefined, b: 0 })).toBe('{"b":0}');
  });

  it('escapes strings exactly like JSON.stringify', () => {
    expect(canonicalJson({ s: 'a"b\\c\n' })).toBe(JSON.stringify({ s: 'a"b\\c\n' }));
  });
});

describe('fnv1a32Hex (the digest form)', () => {
  it('produces the zero-padded 8-hex digest (known vectors)', () => {
    expect(fnv1a32Hex('')).toBe('811c9dc5');
    expect(fnv1a32Hex('a')).toBe('e40c292c');
    expect(fnv1a32Hex('hello')).toBe('4f9f2cab');
  });

  it('isDigest accepts only the 8-hex lowercase form', () => {
    expect(isDigest(fnv1a32Hex('x'))).toBe(true);
    expect(isDigest('E40C292C')).toBe(false);
    expect(isDigest('e40c292')).toBe(false);
    expect(isDigest('e40c292cc')).toBe(false);
    expect(isDigest('')).toBe(false);
  });
});

describe('the exact-decimal grammar', () => {
  it('accepts canonical unsigned/signed forms and rejects the non-canonical ones', () => {
    expect(isCanonicalUnsignedDecimal('0')).toBe(true);
    expect(isCanonicalUnsignedDecimal('12')).toBe(true);
    expect(isCanonicalUnsignedDecimal('3.5')).toBe(true);
    expect(isCanonicalUnsignedDecimal('-1')).toBe(false);
    expect(isCanonicalUnsignedDecimal('01')).toBe(false);
    expect(isCanonicalUnsignedDecimal('3.')).toBe(false);
    expect(isCanonicalUnsignedDecimal('.5')).toBe(false);
    expect(isCanonicalSignedDecimal('-3.5')).toBe(true);
    // The signed grammar admits '-0' (T033's regex, mirrored byte-for-byte);
    // the ARITHMETIC normalizes it to '0' (formatSigned never emits '-0').
    expect(isCanonicalSignedDecimal('-0')).toBe(true);
    expect(signedAbs('-0')).toBe('0');
    expect(signedAdd('-0', '-0')).toBe('0');
    expect(isCanonicalSignedDecimal('0')).toBe(true);
  });

  it('unit-interval decimals: 0, 0.x, 1, 1.00 pass; 1.5, 2, -0.1 fail', () => {
    expect(isUnitIntervalDecimal('0')).toBe(true);
    expect(isUnitIntervalDecimal('0.4')).toBe(true);
    expect(isUnitIntervalDecimal('1')).toBe(true);
    expect(isUnitIntervalDecimal('1.00')).toBe(true);
    expect(isUnitIntervalDecimal('1.5')).toBe(false);
    expect(isUnitIntervalDecimal('2')).toBe(false);
    expect(isUnitIntervalDecimal('-0.1')).toBe(false);
  });
});

describe('the signed arithmetic (the local fixed-point kernel)', () => {
  it('adds/subtracts/compares exactly across scales', () => {
    expect(signedAdd('1.5', '2.25')).toBe('3.75');
    expect(signedAdd('-1.5', '2.25')).toBe('0.75');
    expect(signedAdd('-1.5', '-2.25')).toBe('-3.75');
    expect(signedAdd('0.1', '0.2')).toBe('0.3');
    expect(signedSubtract('-5', '-7.5')).toBe('2.5');
    expect(signedSubtract('1', '2')).toBe('-1');
    expect(signedAdd('999999999.99999999', '0.00000001')).toBe('1000000000');
    expect(signedCompare('0.10', '0.1')).toBe(0);
    expect(signedCompare('-2.5', '2.4')).toBe(-1);
    expect(signedCompare('0.3', '0.29999999')).toBe(1);
  });

  it('negation, absolute value, unsigned add, zero test — exact', () => {
    expect(signedNegate('-0.75')).toBe('0.75');
    expect(signedNegate('0')).toBe('0');
    expect(signedAbs('-38.32833333')).toBe('38.32833333');
    expect(unsignedAdd('0.75', '0.2')).toBe('0.95');
    expect(isZeroDecimal('-0.1')).toBe(false);
    expect(isZeroDecimal('0')).toBe(true);
    expect(isZeroDecimal('0.000')).toBe(true);
  });

  it('unitIntervalCompare orders confidences across scales exactly', () => {
    expect(unitIntervalCompare('0.4', '0.40')).toBe(0);
    expect(unitIntervalCompare('0.4', '0.39')).toBe(1);
    expect(unitIntervalCompare('0.05', '0.4')).toBe(-1);
    expect(unitIntervalCompare('1', '0.99999999')).toBe(1);
    expect(unitIntervalCompare('0', '0.00000001')).toBe(-1);
  });
});

describe('the deep-freeze discipline', () => {
  it('freezes deeply; isDeeplyFrozen verifies', () => {
    const frozen = deepFreeze({ a: { b: [{ c: 1 }] } });
    expect(isDeeplyFrozen(frozen)).toBe(true);
    expect(() => (frozen as { a: { b: { c: number }[] } }).a.b[0]!.c = 2).toThrow();
    const mutable = { a: { b: 1 } };
    expect(isDeeplyFrozen(mutable)).toBe(false);
  });
});

describe('timestamps (the time-engine brand, mirrored)', () => {
  it('bounds are [0, 8.64e15]; numbers outside reject', () => {
    expect(isTimestampMs(asTimestampMs(0))).toBe(true);
    expect(isTimestampMs(asTimestampMs(8_640_000_000_000_000))).toBe(true);
    expect(isTimestampMs(-1)).toBe(false);
    expect(isTimestampMs(8_640_000_000_000_001)).toBe(false);
    expect(isTimestampMs(1.5)).toBe(false);
  });
});
