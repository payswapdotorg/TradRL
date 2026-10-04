// Tests for the content-addressing primitives (canonical JSON + FNV-1a).
//
// Laws pinned here (digest.ts header): "identical inputs -> identical bytes ->
// identical digests" — pure functions, no ambient state, no randomness, no
// clock. The console's history chain, evidence capsules and notice ids are
// content-addressed through here (R38), so determinism is the whole point:
// the same value must ALWAYS serialize to the same bytes, regardless of key
// insertion order, across every machine, forever.

import { describe, expect, it } from 'vitest';
import { canonicalJson, digestOf, fnv1a32Hex, isJsonValue } from './digest';

describe('digest: FNV-1a 32-bit (the program-wide hash)', () => {
  it('matches the published FNV-1a test vectors', () => {
    // The canonical FNV-1a 32-bit vectors (draft-eastlake-fnv).
    expect(fnv1a32Hex('')).toBe('811c9dc5');
    expect(fnv1a32Hex('a')).toBe('e40c292c');
    expect(fnv1a32Hex('foobar')).toBe('bf9cf968');
  });

  it('is lowercase zero-padded 8-hex always', () => {
    for (const text of ['', 'x', 'tradrl', 'console/console/console']) {
      expect(fnv1a32Hex(text)).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it('different inputs give different digests', () => {
    expect(fnv1a32Hex('goal')).not.toBe(fnv1a32Hex('Goal'));
    expect(fnv1a32Hex('1')).not.toBe(fnv1a32Hex('2'));
  });
});

describe('digest: canonical JSON (byte-stable serialization)', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it('serializes every JSON kind', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(false)).toBe('false');
    expect(canonicalJson('s')).toBe('"s"');
    expect(canonicalJson(17)).toBe('17');
    expect(canonicalJson([1, 'a', null])).toBe('[1,"a",null]');
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
  });

  it('escapes strings exactly as JSON does', () => {
    expect(canonicalJson('a"b\\c\nd')).toBe(JSON.stringify('a"b\\c\nd'));
  });

  it('non-finite numbers degrade to null (never a NaN byte-sequence)', () => {
    expect(canonicalJson(Number.NaN)).toBe('null');
    expect(canonicalJson(Number.POSITIVE_INFINITY)).toBe('null');
    expect(canonicalJson([Number.NaN, 1])).toBe('[null,1]');
  });

  it('identical values with different key insertion orders -> IDENTICAL bytes', () => {
    const first = { goal: { horizon: 3, objective: 'alpha' }, tenant: 't', items: [2, 1] };
    const second = { items: [2, 1], tenant: 't', goal: { objective: 'alpha', horizon: 3 } };
    expect(canonicalJson(second)).toBe(canonicalJson(first));
  });
});

describe('digest: content addressing determinism (R38)', () => {
  const capsule = { kind: 'outcome', refs: ['ref-2', 'ref-1'], body: { realized: '12.50', tolerance: '0.25' } };

  it('identical inputs -> identical digests, every time', () => {
    const first = digestOf(capsule);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(digestOf(capsule)).toBe(first);
    }
  });

  it('key insertion order does not change the digest (byte-stable content addressing)', () => {
    expect(digestOf({ a: 1, b: 2 })).toBe(digestOf({ b: 2, a: 1 }));
    expect(digestOf(capsule)).toBe(
      digestOf({ body: capsule.body, refs: capsule.refs, kind: capsule.kind }),
    );
  });

  it('different content -> different digest', () => {
    expect(digestOf({ a: 1 })).not.toBe(digestOf({ a: 2 }));
    expect(digestOf({ a: 1 })).not.toBe(digestOf({ b: 1 }));
    expect(digestOf('x')).not.toBe(digestOf('y'));
  });

  it('the digest is the FNV-1a of the canonical form (one law everywhere)', () => {
    expect(digestOf(capsule)).toBe(fnv1a32Hex(canonicalJson(capsule)));
  });
});

describe('digest: the JSON-value guard', () => {
  it('accepts JSON values and rejects non-JSON', () => {
    expect(isJsonValue(null)).toBe(true);
    expect(isJsonValue('s')).toBe(true);
    expect(isJsonValue(1.5)).toBe(true);
    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue([1, { a: 'b' }])).toBe(true);
    expect(isJsonValue([1, undefined])).toBe(false);
    expect(isJsonValue({ f: () => 1 })).toBe(false);
    expect(isJsonValue(undefined)).toBe(false);
    expect(isJsonValue(Symbol('x'))).toBe(false);
  });
});
