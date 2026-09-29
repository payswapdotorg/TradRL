// @tradrl/body-execution — primitives tests: the guards, deepFreeze,
// canonical JSON + digests, the fnv chain-head fold, TimestampMs,
// SemVer, ISO-8601, identifier/opaque patterns.

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  deepFreeze,
  deepCloneJson,
  duplicatesOf,
  fnv1a32Hex,
  isArrayOf,
  isChainHead,
  isDigest,
  isDeeplyFrozen,
  isIso8601,
  isJsonValue,
  isMemberOf,
  isNonEmptyString,
  isNonNegativeInteger,
  isNonNegativeSafeInteger,
  isPositiveInteger,
  isPositiveSafeInteger,
  isRecord,
  isSemVer,
  isValidIdentifierString,
  isValidOpaqueRefString,
  MAX_TIMESTAMP_MS,
  MIN_TIMESTAMP_MS,
  parseSemVer,
  semverToString,
  stableDigest,
  stableDigestJson,
  timestampMs,
  isTimestampMs,
} from './primitives';

describe('guards', () => {
  it('isRecord accepts plain objects and rejects everything else', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(new Date())).toBe(false);
  });

  it('isNonEmptyString rejects blank strings', () => {
    expect(isNonEmptyString('a')).toBe(true);
    expect(isNonEmptyString(' a ')).toBe(true);
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonEmptyString(42)).toBe(false);
  });

  it('integer guards reject floats, NaN and Infinity', () => {
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isNonNegativeInteger(Number.NaN)).toBe(false);
    expect(isNonNegativeInteger(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(0)).toBe(false);
    expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isNonNegativeSafeInteger(0)).toBe(true);
    expect(isNonNegativeSafeInteger(-0.5)).toBe(false);
  });

  it('isArrayOf checks every element', () => {
    expect(isArrayOf(['a', 'b'], isNonEmptyString)).toBe(true);
    expect(isArrayOf(['a', ''], isNonEmptyString)).toBe(false);
    expect(isArrayOf('not-array', isNonEmptyString)).toBe(false);
  });

  it('isMemberOf checks closed unions', () => {
    const states = ['prepared', 'submitted'] as const;
    expect(isMemberOf(states, 'prepared')).toBe(true);
    expect(isMemberOf(states, 'filled')).toBe(false);
    expect(isMemberOf(states, 'PREPARED')).toBe(false);
  });

  it('duplicatesOf reports duplicates in first-appearance order', () => {
    expect(duplicatesOf(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b']);
    expect(duplicatesOf(['a', 'b'])).toEqual([]);
  });
});

describe('deepFreeze + isDeeplyFrozen', () => {
  it('freezes every reachable object and array', () => {
    const value = deepFreeze({ a: { b: [1, { c: 'x' }] }, d: [{ e: null }] });
    expect(isDeeplyFrozen(value)).toBe(true);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.a.b)).toBe(true);
    expect(Object.isFrozen(value.a.b[1])).toBe(true);
  });

  it('cycles terminate (already-frozen branches are skipped)', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => deepFreeze(a)).not.toThrow();
    expect(isDeeplyFrozen(a)).toBe(true);
  });

  it('isDeeplyFrozen detects a mutable leaf', () => {
    const frozen = deepFreeze({ a: { b: 1 } });
    expect(isDeeplyFrozen(frozen)).toBe(true);
    const mutable = { a: { b: 1 } };
    expect(isDeeplyFrozen(mutable)).toBe(false);
  });

  it('mutation of a frozen record throws in strict mode', () => {
    const value = deepFreeze({ a: 1 });
    expect(() => {
      'use strict';
      (value as { a: number }).a = 2;
    }).toThrow();
  });

  it('deepCloneJson round-trips JSON data', () => {
    const value = { a: [1, 'two', null], b: { c: true } };
    expect(deepCloneJson(value)).toEqual(value);
  });
});

describe('the JSON model', () => {
  it('isJsonValue validates deeply', () => {
    expect(isJsonValue({ a: [1, 'x', null, true] })).toBe(true);
    expect(isJsonValue({ a: Number.NaN })).toBe(false);
    expect(isJsonValue([Number.POSITIVE_INFINITY])).toBe(false);
    expect(isJsonValue(() => 1)).toBe(false);
  });
});

describe('canonical JSON (the L9 byte-determinism anchor)', () => {
  it('object keys are recursively sorted (code-unit order)', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: { y: 1, x: 2 }, a: [3, { b: 1, a: 2 }] })).toBe(
      '{"a":[3,{"a":2,"b":1}],"z":{"x":2,"y":1}}',
    );
  });

  it('arrays keep order; primitives render canonically', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson('q"uote')).toBe(JSON.stringify('q"uote'));
    expect(canonicalJson(42.5)).toBe('42.5');
  });

  it('equal JSON values always serialize byte-identically', () => {
    const a = { alpha: [1, { b: 2, a: 3 }], z: null };
    const b = JSON.parse(JSON.stringify(a)) as typeof a;
    expect(canonicalJson(a as never)).toBe(canonicalJson(b as never));
  });
});

describe('stable digests (L9)', () => {
  it('identical inputs digest identically; different inputs differ', () => {
    expect(stableDigest('{"a":1}')).toBe(stableDigest('{"a":1}'));
    expect(stableDigest('{"a":1}')).not.toBe(stableDigest('{"a":2}'));
    expect(stableDigest('{"a":1}')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('prefix-extension collisions cannot survive (length folding)', () => {
    expect(stableDigest('ab')).not.toBe(stableDigest('ab'.padEnd(3, 'a')));
    expect(stableDigest('x')).not.toBe(stableDigest('x\u0000'));
  });

  it('stableDigestJson composes canonicalJson + stableDigest', () => {
    expect(stableDigestJson({ b: 1, a: 2 })).toBe(stableDigest('{"a":2,"b":1}'));
  });

  it('isDigest validates the 16-hex shape', () => {
    expect(isDigest('0123456789abcdef')).toBe(true);
    expect(isDigest('0123456789abcde')).toBe(false);
    expect(isDigest('0123456789ABCDEF')).toBe(false);
    expect(isDigest(42)).toBe(false);
  });
});

describe('the chain-head fold (the T019 discipline, mirrored)', () => {
  it('fnv1a32Hex renders 8 lowercase hex characters', () => {
    expect(fnv1a32Hex('')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a32Hex('ol-genesis')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a32Hex('abc')).not.toBe(fnv1a32Hex('abd'));
  });

  it('isChainHead validates the 8-hex shape', () => {
    expect(isChainHead('0123abcd')).toBe(true);
    expect(isChainHead('0123abc')).toBe(false);
    expect(isChainHead('0123ABCD')).toBe(false);
  });

  it('the fold is deterministic: fnv(prev + canonical(content))', () => {
    const first = fnv1a32Hex(`${'ol-genesis'}${canonicalJson({ sequence: 1 })}`);
    const second = fnv1a32Hex(`${first}${canonicalJson({ sequence: 2 })}`);
    expect(first).not.toBe(second);
    expect(fnv1a32Hex(`${'ol-genesis'}${canonicalJson({ sequence: 1 })}`)).toBe(first);
  });
});

describe('TimestampMs', () => {
  it('accepts integers in range; rejects everything else', () => {
    expect(isTimestampMs(0)).toBe(true);
    expect(isTimestampMs(MAX_TIMESTAMP_MS)).toBe(true);
    expect(isTimestampMs(-1)).toBe(false);
    expect(isTimestampMs(MAX_TIMESTAMP_MS + 1)).toBe(false);
    expect(isTimestampMs(1.5)).toBe(false);
    expect(isTimestampMs('0')).toBe(false);
    expect(MIN_TIMESTAMP_MS).toBe(0);
  });

  it('timestampMs constructs or throws', () => {
    expect(timestampMs(5)).toBe(5);
    expect(() => timestampMs(-1)).toThrow(TypeError);
  });
});

describe('ISO 8601 + SemVer + identifier patterns', () => {
  it('isIso8601 accepts explicit-offset instants only', () => {
    expect(isIso8601('2026-06-01T00:00:00Z')).toBe(true);
    expect(isIso8601('2026-06-01T00:00:00.123+02:00')).toBe(true);
    expect(isIso8601('2026-06-01T00:00:00')).toBe(false);
    expect(isIso8601('not-a-date')).toBe(false);
    expect(isIso8601(42)).toBe(false);
  });

  it('parseSemVer + semverToString round-trip; guards validate', () => {
    const parsed = parseSemVer('1.2.3-alpha.1+build.5');
    expect(parsed).not.toBeNull();
    if (parsed !== null) {
      expect(semverToString(parsed)).toBe('1.2.3-alpha.1+build.5');
      expect(isSemVer(parsed)).toBe(true);
    }
    expect(parseSemVer('01.2.3')).toBeNull();
    expect(parseSemVer('1.2')).toBeNull();
    expect(isSemVer({ major: 1, minor: 0, patch: 0, prerelease: [], build: [] })).toBe(true);
    expect(isSemVer({ major: -1, minor: 0, patch: 0, prerelease: [], build: [] })).toBe(false);
  });

  it('identifier + opaque ref patterns', () => {
    expect(isValidIdentifierString('ol-abc123')).toBe(true);
    expect(isValidIdentifierString('a')).toBe(true);
    expect(isValidIdentifierString('-bad')).toBe(false);
    expect(isValidIdentifierString('has space')).toBe(false);
    expect(isValidIdentifierString('x'.repeat(256))).toBe(true);
    expect(isValidIdentifierString('x'.repeat(257))).toBe(false);
    expect(isValidOpaqueRefString('anything opaque')).toBe(true);
    expect(isValidOpaqueRefString(' leading space')).toBe(false);
    expect(isValidOpaqueRefString('x'.repeat(1025))).toBe(false);
    expect(isValidOpaqueRefString('with\u0000control')).toBe(false);
  });
});
