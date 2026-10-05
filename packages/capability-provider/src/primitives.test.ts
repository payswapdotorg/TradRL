// @tradrl/capability-provider — the primitives' pinned laws.
//
// Deterministic, hermetic: no network, no clock, no randomness; the
// fixtures are fixed literals (src/fixtures.ts).

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  deepFreeze,
  isDeeplyFrozen,
  isArrayOf,
  isDigest,
  isJsonValue,
  isMemberOf,
  isRecord,
  isTimestampMs,
  MAX_TIMESTAMP_MS,
  MIN_TIMESTAMP_MS,
  stableDigest,
  stableDigestJson,
  timestampMs,
} from './index';
import { isTenantId, EXCHANGE_ID_PATTERN } from './index';

describe('structural guards', () => {
  it('isRecord accepts plain objects and rejects everything else', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(new Date(0))).toBe(false);
  });

  it('isMemberOf checks the closed vocabulary', () => {
    const kinds = ['a', 'b'] as const;
    expect(isMemberOf(kinds, 'a')).toBe(true);
    expect(isMemberOf(kinds, 'c')).toBe(false);
    expect(isMemberOf(kinds, undefined)).toBe(false);
  });

  it('isArrayOf composes a member guard over arrays', () => {
    expect(isArrayOf([1, 2], (v): v is number => typeof v === 'number')).toBe(true);
    expect(isArrayOf([1, 'x'], (v): v is number => typeof v === 'number')).toBe(false);
    expect(isArrayOf('not-an-array', (v): v is number => typeof v === 'number')).toBe(false);
  });

  it('isJsonValue rejects undefined/function/symbol carriers', () => {
    expect(isJsonValue({ a: [1, { b: null }] })).toBe(true);
    expect(isJsonValue({ a: undefined })).toBe(false);
    expect(isJsonValue(() => 1)).toBe(false);
    expect(isJsonValue(NaN)).toBe(false);
    expect(isJsonValue(Infinity)).toBe(false);
  });
});

describe('deep-freeze discipline', () => {
  it('deepFreeze freezes nested objects and arrays', () => {
    const frozen = deepFreeze({ a: { b: [1, { c: 2 }] } });
    expect(() => { (frozen as { a: { b: number[] } }).a.b.push(3); }).toThrow();
    expect(isDeeplyFrozen(frozen)).toBe(true);
  });

  it('isDeeplyFrozen detects a deep mutation target', () => {
    const open = { a: { b: [1] } };
    expect(isDeeplyFrozen(deepFreeze(open))).toBe(true);
    expect(isDeeplyFrozen({ a: { b: [1] } })).toBe(false);
  });
});

describe('canonical JSON + digests (L9 — the byte-determinism anchor)', () => {
  it('canonicalJson sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('canonicalJson is key-order independent (the same value, the same bytes)', () => {
    expect(canonicalJson({ a: 1, b: [2, { x: null }] })).toBe(canonicalJson({ b: [2, { x: null }], a: 1 }));
  });

  it('stableDigest is 16 lowercase hex chars; different inputs differ; equal inputs agree', () => {
    expect(stableDigest('{"a":1}')).toMatch(/^[0-9a-f]{16}$/);
    expect(stableDigest('{"a":1}')).toBe(stableDigest('{"a":1}'));
    expect(stableDigest('{"a":1}')).not.toBe(stableDigest('{"a":2}'));
  });

  it('stableDigest UTF-8-DENORMALIZES non-ASCII code units (the program-wide fold, pinned literals)', () => {
    // Pinned vectors of the program-wide fold (evaluation -> skills ->
    // organization -> agent-body registry): a non-ASCII code unit folds
    // over its UTF-8 BYTES, never as a single unit. The interop test
    // pins the same agreement dynamically against the REAL skills lane.
    expect(stableDigest('x')).toBe('e062c2f2e52649e1');
    expect(stableDigest('{"a":1}')).toBe('4d0a5a490ec363be');
    expect(stableDigest('café résumé')).toBe('05851d707f46f9ea');
    expect(stableDigest('流動性レジーム分析')).toBe('08c6f2eaf14f9051');
  });

  it('stableDigest folds the length so prefix extensions cannot collide', () => {
    const a = stableDigest('aaaa');
    const b = stableDigest('aaaaa');
    expect(a).not.toBe(b);
  });

  it('stableDigestJson digests the canonical bytes (key order can never leak)', () => {
    expect(stableDigestJson({ b: 1, a: 2 })).toBe(stableDigestJson({ a: 2, b: 1 }));
  });

  it('isDigest accepts only the 16-hex grammar', () => {
    expect(isDigest(stableDigest('x'))).toBe(true);
    expect(isDigest('ABC1234567890abc')).toBe(false);
    expect(isDigest('')).toBe(false);
    expect(isDigest(16)).toBe(false);
  });
});

describe('TimestampMs mirror (the explicit-instant discipline)', () => {
  it('accepts integers within the representable window', () => {
    expect(isTimestampMs(0)).toBe(true);
    expect(isTimestampMs(MAX_TIMESTAMP_MS)).toBe(true);
    expect(isTimestampMs(MIN_TIMESTAMP_MS)).toBe(true);
    expect(isTimestampMs(-1)).toBe(false);
    expect(isTimestampMs(1.5)).toBe(false);
    expect(isTimestampMs(MAX_TIMESTAMP_MS + 1)).toBe(false);
    expect(isTimestampMs('0')).toBe(false);
  });

  it('timestampMs throws on invalid input', () => {
    expect(() => timestampMs(-1)).toThrow(TypeError);
    expect(timestampMs(42)).toBe(42);
  });
});

describe('ids (the owned exchange spaces)', () => {
  it('EXCHANGE_ID_PATTERN accepts every owned prefix and rejects the rest', () => {
    for (const id of ['pvd:0123456789abcdef', 'cpr:0123456789abcdef', 'qte:0123456789abcdef', 'eng:0123456789abcdef', 'dlv:0123456789abcdef', 'vrf:0123456789abcdef']) {
      expect(EXCHANGE_ID_PATTERN.test(id)).toBe(true);
    }
    for (const id of ['log:0123456789abcdef', 'pvd:0123456789abcde', 'pvd:0123456789abcdeg', 'pvd:']) {
      expect(EXCHANGE_ID_PATTERN.test(id)).toBe(false);
    }
  });

  it('isTenantId accepts any non-empty string (the opaque mirror law)', () => {
    expect(isTenantId('tenant-x')).toBe(true);
    expect(isTenantId('')).toBe(false);
    expect(isTenantId(null)).toBe(false);
  });
});
