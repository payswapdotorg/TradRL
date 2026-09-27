import { describe, expect, it } from 'vitest';
import {
  type BodyId,
  type PossessionId,
  agentInstanceId,
  bodyId,
  bodyVersionId,
  compareSemVer,
  deepCloneJson,
  deepFreeze,
  duplicatesOf,
  evidenceRef,
  iso8601,
  isArrayOf,
  isBodyId,
  isBodyVersionId,
  isDeeplyFrozen,
  isEnum,
  isISO8601,
  isPossessionId,
  isRecord,
  isSemVer,
  isString,
  isSubstrateRef,
  makeBodyVersionId,
  makeSubstrateRef,
  parseBodyVersionIdString,
  parseSemVer,
  parseSubstrateRefString,
  possessionId,
  semverToString,
  substrateRef,
  substitutionClass,
  toolRef,
} from './primitives';

describe('identifier factories and guards', () => {
  it('constructs valid identifiers', () => {
    expect(bodyId('regime-researcher')).toBe('regime-researcher');
    expect(possessionId('possession-1')).toBe('possession-1');
    expect(agentInstanceId('agent-1')).toBe('agent-1');
    expect(substitutionClass('frontier-reasoner')).toBe('frontier-reasoner');
  });

  it('rejects invalid identifiers with TypeError', () => {
    for (const bad of ['', ' ', '/slash', '@at', 'ümlaut', 'x'.repeat(257)]) {
      expect(() => bodyId(bad), JSON.stringify(bad)).toThrow(TypeError);
      expect(() => possessionId(bad), JSON.stringify(bad)).toThrow(TypeError);
    }
  });

  it('guards narrow unknown values', () => {
    expect(isBodyId('ok-id')).toBe(true);
    expect(isBodyId('')).toBe(false);
    expect(isBodyId(42)).toBe(false);
    expect(isBodyId(null)).toBe(false);
    expect(isPossessionId('p1')).toBe(true);
    expect(isPossessionId(undefined)).toBe(false);
  });

  it('brands are distinct at type level and interchangeable only via casts', () => {
    const id: BodyId = bodyId('shared-string');
    const pid: PossessionId = possessionId('shared-string');
    // Runtime representation is a plain string; the brand is compile-time only.
    expect(id).toBe(pid);
  });
});

describe('canonical BodyVersionId', () => {
  it('round-trips make/parse', () => {
    const id = makeBodyVersionId('regime-researcher', parseSemVer('1.2.0') as NonNullable<ReturnType<typeof parseSemVer>>);
    expect(id).toBe('regime-researcher@1.2.0');
    expect(bodyVersionId('regime-researcher@1.2.0')).toBe(id);
    const parsed = parseBodyVersionIdString(id);
    expect(parsed?.bodyId).toBe('regime-researcher');
    expect(parsed && semverToString(parsed.version)).toBe('1.2.0');
  });

  it('accepts prerelease and build metadata', () => {
    expect(isBodyVersionId('body@2.0.0-rc.1+build.5')).toBe(true);
    const parsed = parseBodyVersionIdString('body@2.0.0-rc.1+build.5');
    expect(parsed?.version.prerelease).toEqual(['rc', '1']);
    expect(parsed?.version.build).toEqual(['build', '5']);
  });

  it('rejects malformed ids', () => {
    for (const bad of ['no-at', '@1.0.0', 'body@', 'body@1.2', 'bo@dy@1.0.0', 'body@01.2.3']) {
      expect(isBodyVersionId(bad), bad).toBe(false);
      expect(() => bodyVersionId(bad), bad).toThrow(TypeError);
    }
  });
});

describe('canonical SubstrateRef', () => {
  it('round-trips make/parse', () => {
    const ref = makeSubstrateRef('acme-models', 'reasoner-2', '2026.03');
    expect(ref).toBe('acme-models/reasoner-2@2026.03');
    expect(substrateRef('acme-models/reasoner-2@2026.03')).toBe(ref);
    const parsed = parseSubstrateRefString(ref);
    expect(parsed).toEqual({ provider: 'acme-models', modelId: 'reasoner-2', modelVersion: '2026.03' });
  });

  it('rejects components containing "/", "@" or whitespace', () => {
    expect(() => makeSubstrateRef('a b', 'm', 'v')).toThrow(TypeError);
    expect(() => makeSubstrateRef('a/b', 'm', 'v')).toThrow(TypeError);
    expect(() => makeSubstrateRef('a', 'm@x', 'v')).toThrow(TypeError);
    expect(() => makeSubstrateRef('a', 'm', 'v/w')).toThrow(TypeError);
    expect(isSubstrateRef('missing-at-sign/model')).toBe(false);
    expect(isSubstrateRef('provideronly@1.0')).toBe(false);
  });
});

describe('ISO8601', () => {
  it('accepts timezone-qualified timestamps', () => {
    expect(iso8601('2026-09-27T06:00:00Z')).toBe('2026-09-27T06:00:00Z');
    expect(iso8601('2026-09-27T06:00:00.123Z')).toBe('2026-09-27T06:00:00.123Z');
    expect(iso8601('2026-09-27T08:00:00+02:00')).toBe('2026-09-27T08:00:00+02:00');
  });

  it('rejects malformed and impossible timestamps', () => {
    for (const bad of [
      '2026-09-27', // date only
      '2026-09-27 06:00:00Z', // space separator
      '2026-09-27T06:00:00', // no timezone
      '2026-13-01T00:00:00Z', // impossible month
      'not-a-date',
      '',
    ]) {
      expect(() => iso8601(bad), bad).toThrow(TypeError);
      expect(isISO8601(bad), bad).toBe(false);
    }
  });
});

describe('SemVer', () => {
  it('parses strict semver strings', () => {
    expect(parseSemVer('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [], build: [] });
    expect(parseSemVer('0.0.0')).not.toBeNull();
    expect(parseSemVer('2.0.0-rc.1+build.5')).toMatchObject({ major: 2, prerelease: ['rc', '1'] });
  });

  it('rejects malformed semver strings', () => {
    for (const bad of ['1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.3-', '1.2.3+', 'v1.2.3', '1.2.3-01', 'abc', '']) {
      expect(parseSemVer(bad), bad).toBeNull();
    }
  });

  it('round-trips through semverToString', () => {
    for (const s of ['1.2.3', '0.0.1', '2.0.0-rc.1+build.5', '10.20.30-alpha.beta']) {
      const parsed = parseSemVer(s);
      expect(parsed && semverToString(parsed)).toBe(s);
    }
  });

  it('follows the semver.org precedence chain', () => {
    // https://semver.org/#spec-item-11 canonical ordering example
    const chain = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    for (let i = 0; i < chain.length - 1; i += 1) {
      const a = parseSemVer(chain[i] as string);
      const b = parseSemVer(chain[i + 1] as string);
      expect(a && b && compareSemVer(a, b), `${chain[i]} < ${chain[i + 1]}`).toBe(-1);
    }
  });

  it('orders core versions and ignores build metadata', () => {
    expect(compareSemVer(parseSemVer('1.0.0')!, parseSemVer('1.0.1')!)).toBe(-1);
    expect(compareSemVer(parseSemVer('1.9.9')!, parseSemVer('1.10.0')!)).toBe(-1);
    expect(compareSemVer(parseSemVer('1.10.0')!, parseSemVer('2.0.0')!)).toBe(-1);
    expect(compareSemVer(parseSemVer('1.0.0+a')!, parseSemVer('1.0.0+b')!)).toBe(0);
    expect(compareSemVer(parseSemVer('1.0.0')!, parseSemVer('1.0.0-rc.1')!)).toBe(1);
  });

  it('guards structural SemVer', () => {
    expect(isSemVer(parseSemVer('1.2.3'))).toBe(true);
    expect(isSemVer({ major: 1, minor: 2, patch: 3, prerelease: [], build: [] })).toBe(true);
    expect(isSemVer({ major: -1, minor: 2, patch: 3 })).toBe(false);
    expect(isSemVer({ major: 1.5, minor: 2, patch: 3 })).toBe(false);
    expect(isSemVer({ major: 1, minor: 2, patch: 3, prerelease: ['01'] })).toBe(false);
    expect(isSemVer(null)).toBe(false);
    expect(isSemVer('1.2.3')).toBe(false);
  });
});

describe('structural helpers', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(new Date())).toBe(false);
    expect(isRecord('str')).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  it('isArrayOf checks every element', () => {
    expect(isArrayOf(['a', 'b'], isString)).toBe(true);
    expect(isArrayOf(['a', 1], isString)).toBe(false);
    expect(isArrayOf([], isString)).toBe(true);
    expect(isArrayOf('not-array', isString)).toBe(false);
  });

  it('isEnum builds closed-union guards', () => {
    const isAb = isEnum(['a', 'b'] as const);
    expect(isAb('a')).toBe(true);
    expect(isAb('c')).toBe(false);
    expect(isAb(1)).toBe(false);
  });

  it('duplicatesOf finds duplicate entries in order', () => {
    expect(duplicatesOf(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b']);
    expect(duplicatesOf(['a', 'b'])).toEqual([]);
  });
});

describe('deep immutability', () => {
  it('deepFreeze freezes nested objects and arrays', () => {
    const value = { a: 1, list: [{ b: 2 }], inner: { c: { d: 3 } } };
    deepFreeze(value);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.list)).toBe(true);
    expect(Object.isFrozen(value.list[0])).toBe(true);
    expect(Object.isFrozen(value.inner.c)).toBe(true);
    expect(isDeeplyFrozen(value)).toBe(true);
  });

  it('frozen structures throw on mutation (strict mode)', () => {
    const value = deepFreeze({ list: [{ b: 2 }] });
    expect(() => {
      (value as { a?: number }).a = 1;
    }).toThrow(TypeError);
    expect(() => {
      (value.list[0] as { b: number }).b = 99;
    }).toThrow(TypeError);
  });

  it('isDeeplyFrozen detects unfrozen leaves', () => {
    expect(isDeeplyFrozen({ a: { b: { c: 1 } } })).toBe(false);
    expect(isDeeplyFrozen(deepFreeze({ a: [{ b: 1 }] }))).toBe(true);
    expect(isDeeplyFrozen(42)).toBe(true);
    expect(isDeeplyFrozen('str')).toBe(true);
    expect(isDeeplyFrozen(null)).toBe(true);
  });

  it('handles cyclic structures without hanging', () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = { a };
    a.b = b;
    deepFreeze(a);
    expect(isDeeplyFrozen(a)).toBe(true);
    const unfrozen: Record<string, unknown> = { x: 1 };
    const c: Record<string, unknown> = { self: unfrozen };
    unfrozen.c = c;
    expect(isDeeplyFrozen(c)).toBe(false);
  });

  it('deepCloneJson produces an unfrozen, equal copy', () => {
    const original = deepFreeze({ a: 1, list: [1, 2, { b: 2 }] });
    const clone = deepCloneJson(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    expect(Object.isFrozen(clone)).toBe(false);
    expect(() => {
      (clone as { a: number }).a = 5;
    }).not.toThrow();
  });
});

describe('opaque cross-lane references', () => {
  it('constructs and guards opaque refs', () => {
    expect(evidenceRef('evidence/run-1')).toBe('evidence/run-1');
    expect(toolRef('tools/query')).toBe('tools/query');
    expect(() => evidenceRef(' ')).toThrow(TypeError);
    expect(() => evidenceRef('')).toThrow(TypeError);
    expect(() => evidenceRef('x'.repeat(1025))).toThrow(TypeError);
  });
});
