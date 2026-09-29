/**
 * @tradrl/execution-policy — the structural primitives and the exact
 * decimal arithmetic: determinism, deep-freeze discipline and boundary
 * behaviors (the shared vocabulary every other module stands on).
 */

import { describe, expect, it } from 'vitest';

import {
  add,
  canonicalJson,
  compare,
  deepFreeze,
  fnv1a32Hex,
  isDeeplyFrozen,
  isTimestampMs,
  multiply,
  normalize,
  stableDigest,
  subtract,
} from './index';

describe('primitives — canonical JSON and digests (byte-determinism)', () => {
  it('equal JSON values serialize byte-identically regardless of key order', () => {
    const a = { b: 2, a: 1, c: { z: 'x', y: [1, 2, { q: null, p: true }] } };
    const b = { c: { y: [1, 2, { p: true, q: null }], z: 'x' }, a: 1, b: 2 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('the stable digest is a pure function of the canonical form', () => {
    expect(stableDigest({ a: 1, b: 2 })).toBe(stableDigest({ b: 2, a: 1 }));
    expect(stableDigest({ a: 1 })).not.toBe(stableDigest({ a: 2 }));
  });

  it('the FNV-1a derivation matches the program-wide constants', () => {
    expect(fnv1a32Hex('')).toBe('811c9dc5');
    expect(fnv1a32Hex('a')).toBe('e40c292c');
  });

  it('timestamp bounds are enforced', () => {
    expect(isTimestampMs(0)).toBe(true);
    expect(isTimestampMs(8_639_999_999_999_999)).toBe(true);
    expect(isTimestampMs(-1)).toBe(false);
    expect(isTimestampMs(8_640_000_000_000_000)).toBe(false);
    expect(isTimestampMs(1.5)).toBe(false);
  });
});

describe('primitives — the deep-freeze discipline', () => {
  it('deepFreeze freezes every reachable object and array', () => {
    const value = deepFreeze({ a: { b: [{ c: 1 }] } });
    expect(isDeeplyFrozen(value)).toBe(true);
    expect(() => {
      (value.a as { b: { c: number }[] }).b[0].c = 2;
    }).toThrow();
  });

  it('isDeeplyFrozen detects unfrozen members', () => {
    expect(isDeeplyFrozen({ a: { b: 1 } })).toBe(false);
    expect(isDeeplyFrozen(42)).toBe(true); // primitives are trivially frozen
  });
});

describe('decimals — exact arithmetic (the money paths)', () => {
  it('add / subtract / multiply are exact beyond float precision', () => {
    expect(add('0.1', '0.2')).toBe('0.3');
    expect(multiply('0.1', '0.2')).toBe('0.02');
    expect(multiply('123456789.12345678', '987654321.87654321')).toBe('121932631342783101.4583142722374638');
    expect(subtract('1', '0.999999999999999999')).toBe('0.000000000000000001');
  });

  it('compare is exact (never float-mediated)', () => {
    expect(compare('0.1', '0.2')).toBe(-1);
    expect(compare('0.3', '0.30000000000000004')).toBe(-1);
    expect(compare('100', '100.00')).toBe(0);
    expect(compare('2', '1')).toBe(1);
  });

  it('normalize strips trailing zeros into canonical form', () => {
    expect(normalize('01.200')).toBe('1.2');
    expect(normalize('0.000')).toBe('0');
    expect(normalize('007')).toBe('7');
  });

  it('NEGATIVE — subtract refuses to leave the unsigned domain (typed callers only)', () => {
    expect(() => subtract('1', '2')).toThrow(/unsigned decimal domain/);
  });
});
