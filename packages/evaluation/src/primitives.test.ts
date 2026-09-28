/**
 * Behavioral tests for @tradrl/evaluation primitives: guard totality,
 * deep-freeze discipline, canonical-JSON byte determinism, and the stable
 * digest's change-detection properties (L9's determinism anchor).
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  deepFreeze,
  isDeeplyFrozen,
  isDigest,
  isFiniteNumber,
  isJsonObject,
  isJsonValue,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
  isUnitInterval,
  MAX_TIMESTAMP_MS,
  MIN_TIMESTAMP_MS,
  requireTimestampMs,
  stableDigest,
  stableDigestJson,
  timestampMs,
  type Mutable,
} from './index';

describe('structural guards (total, never throw)', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(new Date())).toBe(false);
    expect(isRecord(42)).toBe(false);
  });

  it('isNonEmptyString rejects whitespace-only strings', () => {
    expect(isNonEmptyString('a')).toBe(true);
    expect(isNonEmptyString(' a ')).toBe(true);
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonEmptyString(7)).toBe(false);
  });

  it('numeric guards reject NaN and Infinity', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1', null]) {
      expect(isFiniteNumber(bad)).toBe(false);
      expect(isUnitInterval(bad)).toBe(false);
      expect(isNonNegativeInteger(bad)).toBe(false);
      expect(isPositiveInteger(bad)).toBe(false);
    }
    expect(isFiniteNumber(-0.5)).toBe(true);
    expect(isUnitInterval(0)).toBe(true);
    expect(isUnitInterval(1)).toBe(true);
    expect(isUnitInterval(1.0001)).toBe(false);
    expect(isUnitInterval(-0.0001)).toBe(false);
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(0)).toBe(false);
  });

  it('TimestampMs mirror: bounds and integer discipline', () => {
    expect(MIN_TIMESTAMP_MS).toBe(0);
    expect(MAX_TIMESTAMP_MS).toBe(8_639_999_999_999_999);
    expect(isTimestampMs(0)).toBe(true);
    expect(isTimestampMs(MAX_TIMESTAMP_MS)).toBe(true);
    expect(isTimestampMs(MAX_TIMESTAMP_MS + 1)).toBe(false);
    expect(isTimestampMs(-1)).toBe(false);
    expect(isTimestampMs(1.5)).toBe(false);
    expect(isTimestampMs(Number.NaN)).toBe(false);
    expect(timestampMs(-1).ok).toBe(false);
    expect(timestampMs(1.5).ok).toBe(false);
    expect(requireTimestampMs(42)).toBe(42);
    expect(() => requireTimestampMs(-1)).toThrow(RangeError);
  });

  it('JSON model guards recurse', () => {
    expect(isJsonValue({ a: [1, 'x', null, { b: true }] })).toBe(true);
    expect(isJsonValue({ a: [1, Number.NaN] })).toBe(false);
    expect(isJsonValue({ a: new Date() })).toBe(false);
    expect(isJsonObject({ a: 1 })).toBe(true);
    expect(isJsonObject([1])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
  });
});

describe('deep-freeze discipline (L9/L11 runtime half)', () => {
  it('deepFreeze freezes nested objects and arrays; already-frozen branches are skipped', () => {
    const shared = { leaf: true };
    const value = deepFreeze({ a: [shared, { b: shared }], c: { d: [1, 2] } });
    expect(isDeeplyFrozen(value)).toBe(true);
    expect(Object.isFrozen(shared)).toBe(true); // shared substructure frozen once
    expect(() => {
      (value as Mutable<{ a: unknown[] }>).a.push(3);
    }).toThrow();
    expect(() => {
      (value.c as Mutable<{ d: number[] }>).d[0] = 9;
    }).toThrow();
  });

  it('isDeeplyFrozen detects unfrozen interiors', () => {
    expect(isDeeplyFrozen({ a: { b: 1 } })).toBe(false);
    expect(isDeeplyFrozen(deepFreeze({ a: { b: 1 } }))).toBe(true);
    expect(isDeeplyFrozen('scalar')).toBe(true);
    // Cycles terminate.
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(isDeeplyFrozen(deepFreeze(cyclic))).toBe(true);
  });
});

describe('canonicalJson (byte determinism)', () => {
  it('equal records serialize byte-identically regardless of key order', () => {
    const a = { z: 1, a: { y: [2, { q: 's', b: null }], m: true }, k: 'x' };
    const b = { k: 'x', a: { m: true, y: [2, { b: null, q: 's' }] }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"m":true,"y":[2,{"b":null,"q":"s"}]},"k":"x","z":1}');
  });

  it('array order is MEANING (never sorted)', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });

  it('strings escape via JSON.stringify; numbers via String', () => {
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
    expect(canonicalJson(0.5)).toBe('0.5');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
  });
});

describe('stableDigest (change detection, determinism)', () => {
  it('identical inputs digest identically; any mutation changes the digest', () => {
    expect(stableDigest('{"a":1}')).toBe(stableDigest('{"a":1}'));
    const base = stableDigestJson({ a: 1, b: [2, 3] });
    expect(stableDigestJson({ b: [2, 3], a: 1 })).toBe(base); // canonical order
    expect(stableDigestJson({ a: 1, b: [2, 4] })).not.toBe(base); // value mutation
    expect(stableDigestJson({ a: 1, b: [2, 3, 4] })).not.toBe(base); // extension
    expect(stableDigestJson({ a: 1, b: [2, 3], c: 0 })).not.toBe(base); // added key
  });

  it('prefix-extension collisions cannot survive (length folding)', () => {
    const prefix = 'evaluation-digest-collision-probe';
    expect(stableDigest(prefix)).not.toBe(stableDigest(`${prefix}${prefix}`));
  });

  it('digests are well-formed 16-hex-char values (isDigest guard)', () => {
    for (const sample of ['', 'x', '{"k":"v"}', 'ü'.repeat(100)]) {
      const digest = stableDigest(sample);
      expect(digest).toMatch(/^[0-9a-f]{16}$/);
      expect(isDigest(digest)).toBe(true);
    }
    expect(isDigest('XYZ')).toBe(false);
    expect(isDigest('00112233445566778899')).toBe(false);
    expect(isDigest('001122334455667G')).toBe(false);
    expect(isDigest(42)).toBe(false);
  });

  it('surrogate-pair material digests deterministically', () => {
    expect(stableDigest('𝒜')).toBe(stableDigest('𝒜'));
    expect(stableDigest('𝒜')).not.toBe(stableDigest('𝒝'));
  });
});
