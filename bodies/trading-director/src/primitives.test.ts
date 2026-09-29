// @tradrl/body-trading-director — primitives tests (the mirror of the
// researchers' foundation suites: guards, deep immutability, canonical
// JSON + stable digests, TimestampMs, SemVer, ISO-8601, identifier
// patterns).

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  deepCloneJson,
  deepFreeze,
  duplicatesOf,
  isArrayOf,
  isDeeplyFrozen,
  isDigest,
  isIso8601,
  isJsonValue,
  isMemberOf,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  isSemVer,
  isTimestampMs,
  isValidIdentifierString,
  isValidOpaqueRefString,
  parseSemVer,
  semverToString,
  stableDigest,
  stableDigestJson,
  timestampMs,
  type Mutable,
} from './primitives';

describe('structural guards', () => {
  it('isRecord accepts plain objects only', () => {
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
    expect(isNonNegativeInteger(17)).toBe(true);
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isNonNegativeInteger(Number.NaN)).toBe(false);
    expect(isNonNegativeInteger(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(0)).toBe(false);
  });

  it('isArrayOf checks every element', () => {
    expect(isArrayOf([1, 2, 3], isPositiveInteger)).toBe(true);
    expect(isArrayOf([1, 0], isPositiveInteger)).toBe(false);
    expect(isArrayOf('nope', isPositiveInteger)).toBe(false);
  });

  it('isMemberOf checks the closed vocabulary', () => {
    const kinds = ['consumed', 'conflicted', 'absent'] as const;
    expect(isMemberOf(kinds, 'consumed')).toBe(true);
    expect(isMemberOf(kinds, 'silent')).toBe(false);
    expect(isMemberOf(kinds, 'CONSUMED')).toBe(false);
  });

  it('duplicatesOf reports duplicates in first-appearance order', () => {
    expect(duplicatesOf(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b']);
    expect(duplicatesOf(['a', 'b'])).toEqual([]);
  });
});

describe('deep immutability', () => {
  it('deepFreeze freezes every reachable object and array', () => {
    const record = deepFreeze({ a: 1, nested: { b: [1, { c: 2 }] } });
    expect(isDeeplyFrozen(record)).toBe(true);
    expect(() => {
      const mutable = record as unknown as Mutable<typeof record>;
      mutable.a = 99;
    }).toThrow();
    expect(() => {
      record.nested.b.push(2 as never);
    }).toThrow();
  });

  it('isDeeplyFrozen detects partial freezes', () => {
    const partial = Object.freeze({ a: { b: 1 } });
    expect(isDeeplyFrozen(partial)).toBe(false);
  });

  it('deepCloneJson round-trips JSON-serializable contract data', () => {
    const record = deepFreeze({ x: 1, ys: ['a', null, true] });
    const clone = deepCloneJson(record);
    expect(clone).toEqual(record);
    expect(clone).not.toBe(record);
  });
});

describe('canonical JSON + stable digests', () => {
  it('object keys are recursively sorted (code-unit order)', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: { d: 1, c: 2 }, a: [3, { y: 1, x: 2 }] })).toBe(
      '{"a":[3,{"x":2,"y":1}],"z":{"c":2,"d":1}}',
    );
  });

  it('equal JSON values serialize byte-identically regardless of key order', () => {
    expect(canonicalJson({ a: 1, b: [2, { d: 4, c: 3 }] })).toBe(
      canonicalJson({ b: [2, { c: 3, d: 4 }], a: 1 }),
    );
  });

  it('scalars and containers serialize canonically', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('say "hi"')).toBe('"say \\"hi\\""');
    expect(canonicalJson([1, 'a', null])).toBe('[1,"a",null]');
    expect(canonicalJson([])).toBe('[]');
    expect(canonicalJson({})).toBe('{}');
  });

  it('identical inputs always digest identically (determinism)', () => {
    for (const sample of [{ a: 1 }, [1, 2], 'x', 3, null, true, { deep: { deeper: [1] } }]) {
      expect(stableDigest(canonicalJson(sample as never))).toBe(stableDigest(canonicalJson(sample as never)));
    }
  });

  it('different inputs digest differently (change detection)', () => {
    expect(stableDigest(canonicalJson({ a: 1 }))).not.toBe(stableDigest(canonicalJson({ a: 2 })));
    expect(stableDigest(canonicalJson('prefix'))).not.toBe(stableDigest(canonicalJson('prefix-extension')));
  });

  it('digests are 16 lowercase hex characters', () => {
    expect(stableDigest('{"a":1}')).toMatch(/^[0-9a-f]{16}$/);
    expect(isDigest(stableDigest('{"a":1}'))).toBe(true);
    expect(isDigest('XYZ')).toBe(false);
    expect(isDigest('0123456789abcdef0')).toBe(false);
  });

  it('stableDigestJson equals stableDigest of the canonical form', () => {
    const value = { b: [2, 1], a: 'z' };
    expect(stableDigestJson(value as never)).toBe(stableDigest(canonicalJson(value as never)));
  });

  it('isJsonValue accepts finite JSON and rejects non-JSON', () => {
    expect(isJsonValue({ a: [1, null] })).toBe(true);
    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJsonValue(undefined)).toBe(false);
  });
});

describe('TimestampMs', () => {
  it('accepts integer epoch milliseconds in range', () => {
    expect(isTimestampMs(0)).toBe(true);
    expect(isTimestampMs(1_717_423_200_000)).toBe(true);
    expect(isTimestampMs(8_639_999_999_999_999)).toBe(true);
  });

  it('rejects floats, negatives, overflow and non-numbers', () => {
    expect(isTimestampMs(0.5)).toBe(false);
    expect(isTimestampMs(-1)).toBe(false);
    expect(isTimestampMs(8_640_000_000_000_000)).toBe(false);
    expect(isTimestampMs('0')).toBe(false);
  });

  it('timestampMs constructs or throws', () => {
    expect(timestampMs(5)).toBe(5);
    expect(() => timestampMs(-1)).toThrow(TypeError);
  });
});

describe('ISO 8601', () => {
  it('accepts well-formed instants with explicit offsets', () => {
    expect(isIso8601('2026-06-01T00:00:00Z')).toBe(true);
    expect(isIso8601('2026-06-01T00:00:00.123Z')).toBe(true);
    expect(isIso8601('2026-06-01T00:00:00+02:00')).toBe(true);
  });

  it('rejects date-only and malformed forms', () => {
    expect(isIso8601('2026-06-01')).toBe(false);
    expect(isIso8601('not a date')).toBe(false);
    expect(isIso8601('2026-13-01T00:00:00Z')).toBe(false);
  });
});

describe('identifier + opaque reference patterns', () => {
  it('compact identifiers: letter/digit/dot/underscore/colon/dash', () => {
    expect(isValidIdentifierString('dd-0123456789abcdef')).toBe(true);
    expect(isValidIdentifierString('method/director/synthesis')).toBe(false); // slashes are NOT compact ids
    expect(isValidIdentifierString('')).toBe(false);
    expect(isValidIdentifierString('-leading-dash')).toBe(false);
  });

  it('opaque refs: bounded, no control characters', () => {
    expect(isValidOpaqueRefString('method/director/synthesis')).toBe(true);
    expect(isValidOpaqueRefString('a'.repeat(1024))).toBe(true);
    expect(isValidOpaqueRefString('a'.repeat(1025))).toBe(false);
    expect(isValidOpaqueRefString(' leading space')).toBe(false);
    expect(isValidOpaqueRefString('line\nbreak')).toBe(false);
  });
});

describe('SemVer', () => {
  it('parses strict semver', () => {
    const version = parseSemVer('1.2.3-beta.1+build.5');
    expect(version).not.toBeNull();
    expect(version?.major).toBe(1);
    expect(version?.minor).toBe(2);
    expect(version?.patch).toBe(3);
    expect(version?.prerelease).toEqual(['beta', '1']);
    expect(version?.build).toEqual(['build', '5']);
    expect(semverToString(version as never)).toBe('1.2.3-beta.1+build.5');
  });

  it('rejects malformed versions', () => {
    expect(parseSemVer('1.2')).toBeNull();
    expect(parseSemVer('01.2.3')).toBeNull();
  });

  it('isSemVer guards the parsed record', () => {
    expect(isSemVer(parseSemVer('1.0.0'))).toBe(true);
    expect(isSemVer({ major: 1, minor: 0, patch: 0 })).toBe(false);
    expect(isSemVer('1.0.0')).toBe(false);
  });
});
