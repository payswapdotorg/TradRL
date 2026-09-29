/**
 * @tradrl/skills — primitives tests.
 *
 * Behavioral: guard totality, deep-freeze discipline, canonical JSON +
 * stable digest byte-determinism (the program-wide law, mirrored from the
 * evaluation lane), timestamp bounds, canonical body-version refs, seeded
 * draws.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  createSeededRandom,
  deepFreeze,
  isArrayOf,
  isBodyVersionRef,
  isDeeplyFrozen,
  isDigest,
  isMemberOf,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  MAX_TIMESTAMP_MS,
  MIN_TIMESTAMP_MS,
  stableDigest,
  stableDigestJson,
} from './primitives';
describe('structural guards', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(new Date())).toBe(false);
  });

  it('isNonEmptyString rejects blank strings', () => {
    expect(isNonEmptyString('a')).toBe(true);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString(3)).toBe(false);
  });

  it('isArrayOf is total over its guard', () => {
    expect(isArrayOf(['a', 'b'], isNonEmptyString)).toBe(true);
    expect(isArrayOf(['a', ''], isNonEmptyString)).toBe(false);
    expect(isArrayOf('not-an-array', isNonEmptyString)).toBe(false);
  });

  it('isMemberOf closes the vocabulary', () => {
    expect(isMemberOf(['yes', 'no'] as const, 'yes')).toBe(true);
    expect(isMemberOf(['yes', 'no'] as const, 'maybe')).toBe(false);
    expect(isMemberOf(['yes', 'no'] as const, 1)).toBe(false);
  });
});

describe('deep immutability (L3/L11 runtime half)', () => {
  it('deepFreeze freezes nested objects and arrays', () => {
    const value = deepFreeze({ a: [1, { b: 'x' }], c: { d: { e: 2 } } });
    expect(isDeeplyFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.c.d)).toBe(true);
  });

  it('deepFreeze is idempotent and cycle-safe', () => {
    const shared: Record<string, unknown> = { x: 1 };
    const value = deepFreeze({ a: shared, b: shared });
    expect(isDeeplyFrozen(value)).toBe(true);
    expect(deepFreeze(value)).toBe(value);
  });

  it('frozen records reject mutation (strict mode)', () => {
    const value = deepFreeze({ inner: { x: 1 } });
    expect(() => {
      (value.inner as { x: number }).x = 2;
    }).toThrow();
  });
});

describe('canonical JSON + stable digest (the program-wide law, L9)', () => {
  it('object keys are recursively sorted (code-unit order)', () => {
    expect(canonicalJson({ b: 1, a: { z: 2, c: 3 } })).toBe('{"a":{"c":3,"z":2},"b":1}');
  });

  it('equal JSON values serialize byte-identically regardless of key order', () => {
    const a = { x: [1, { y: 's', a: true }], n: null };
    const b = { n: null, x: [1, { a: true, y: 's' }] };
    expect(canonicalJson(a as never)).toBe(canonicalJson(b as never));
  });

  it('stableDigest is deterministic and 16 lowercase hex', () => {
    const d1 = stableDigest(canonicalJson({ a: 1, b: [2, 3] } as never));
    const d2 = stableDigest(canonicalJson({ b: [2, 3], a: 1 } as never));
    expect(d1).toBe(d2);
    expect(isDigest(d1)).toBe(true);
    expect(d1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('stableDigestJson equals stableDigest(canonicalJson(v))', () => {
    const v = { k: ['x', 1.5, false, null] };
    expect(stableDigestJson(v as never)).toBe(stableDigest(canonicalJson(v as never)));
  });

  it('distinct inputs digest distinctly (prefix extension cannot survive)', () => {
    // The length fold: 'a' vs 'aa' vs 'aaa' must not collide.
    const digests = new Set(['a', 'aa', 'aaa', 'aab', 'ab'].map((s) => stableDigest(JSON.stringify(s))));
    expect(digests.size).toBe(5);
  });
});

describe('TimestampMs mirror (canonical owner: @tradrl/time-engine)', () => {
  it('accepts integers within the representable range', () => {
    expect(isTimestampMs(0)).toBe(true);
    expect(isTimestampMs(1_700_000_000_000)).toBe(true);
    expect(isTimestampMs(MIN_TIMESTAMP_MS)).toBe(true);
    expect(isTimestampMs(MAX_TIMESTAMP_MS)).toBe(true);
  });

  it('rejects non-integers, NaN, Infinity and out-of-range values', () => {
    expect(isTimestampMs(0.5)).toBe(false);
    expect(isTimestampMs(Number.NaN)).toBe(false);
    expect(isTimestampMs(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isTimestampMs(-1)).toBe(false);
    expect(isTimestampMs(MAX_TIMESTAMP_MS + 1)).toBe(false);
    expect(isTimestampMs('0')).toBe(false);
  });
});

describe('canonical BodyVersionRef (agent-body runtime parity)', () => {
  it('accepts canonical `${bodyId}@${semver}` refs', () => {
    expect(isBodyVersionRef('regime-researcher@1.2.0')).toBe(true);
    expect(isBodyVersionRef('body.v2@0.0.1-rc.1+build.5')).toBe(true);
  });

  it('rejects non-canonical refs', () => {
    expect(isBodyVersionRef('regime-researcher')).toBe(false);
    expect(isBodyVersionRef('@1.2.0')).toBe(false);
    expect(isBodyVersionRef('body@1.2')).toBe(false);
    expect(isBodyVersionRef('')).toBe(false);
    expect(isBodyVersionRef(1)).toBe(false);
  });
});

describe('seeded draws (the determinism law)', () => {
  it('the same seed yields the same sequence', () => {
    const a = createSeededRandom('seed-1');
    const b = createSeededRandom('seed-1');
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('different seeds diverge', () => {
    const a = createSeededRandom('seed-1');
    const b = createSeededRandom('seed-2');
    expect(a()).not.toBe(b());
  });

  it('draws live in [0, 1)', () => {
    const draw = createSeededRandom('seed-3');
    for (let i = 0; i < 100; i += 1) {
      const value = draw();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
