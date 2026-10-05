// Tests for the content-addressing primitives (canonical JSON + FNV-1a
// + SHA-256).
//
// Laws pinned here (digest.ts header): "identical inputs -> identical bytes ->
// identical digests" — pure functions, no ambient state, no randomness, no
// clock. The console's evidence capsules and notice ids are content-addressed
// through the FNV-1a form; the workspace's history chain is hashed with
// sha256Hex (R9a — a real, derivable, verifiable chain), so its determinism
// is the whole point: the same value must ALWAYS serialize to the same bytes,
// regardless of key insertion order, across every machine, forever.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, digestOf, fnv1a32Hex, isJsonValue, sha256Hex, sha256Of, utf8BytesOf } from './digest';

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

describe('digest: SHA-256 (the chain\'s hash — R9a)', () => {
  it('matches the NIST FIPS 180-4 test vectors (the one-block, mid-block and two-block examples)', () => {
    // FIPS 180-4 example vectors (and the well-known empty-input digest).
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256Hex('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'))
      .toBe('cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
  });

  it('is lowercase zero-padded 64-hex always', () => {
    for (const text of ['', 'x', 'tradrl', 'console/console/console', 'a longer input that crosses the fifty-five byte padding boundary exactly here']) {
      expect(sha256Hex(text)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('agrees byte-for-byte with Node\'s own crypto across the padding boundaries (test-only cross-check)', () => {
    // Lengths around every 64-byte block boundary and the 55/56/57-byte
    // padding edges, plus multi-byte UTF-8 and surrogate pairs.
    const corpus: string[] = [];
    for (let length = 0; length <= 200; length += 1) corpus.push('a'.repeat(length));
    corpus.push('héllo wörld — naïve 中文 العربية', 'emoji 🚀🧪 payload', 'surrogate pair 🌀 alone');
    for (const text of corpus) {
      const reference = createHash('sha256').update(text, 'utf8').digest('hex');
      expect(sha256Hex(text)).toBe(reference);
    }
  });

  it('encodes UTF-8 exactly (surrogate pairs fold to one code point)', () => {
    // 'é' is 2 bytes, '中' is 3, '🚀' (a surrogate pair) is 4.
    expect(Array.from(utf8BytesOf('é'))).toEqual([0xc3, 0xa9]);
    expect(Array.from(utf8BytesOf('中'))).toEqual([0xe4, 0xb8, 0xad]);
    expect(Array.from(utf8BytesOf('🚀'))).toEqual([0xf0, 0x9f, 0x9a, 0x80]);
    expect(utf8BytesOf('中文').length).toBe(6);
  });

  it('is deterministic and avalanche-sensitive', () => {
    const first = sha256Hex('{"kind":"job-updated"}');
    for (let attempt = 0; attempt < 5; attempt += 1) expect(sha256Hex('{"kind":"job-updated"}')).toBe(first);
    expect(sha256Hex('{"kind":"job-updated"}')).not.toBe(sha256Hex('{"kind":"job-updated!"}'));
  });

  it('sha256Of digests the canonical form (key order never matters)', () => {
    expect(sha256Of({ b: 1, a: 2 })).toBe(sha256Of({ a: 2, b: 1 }));
    expect(sha256Of({ a: 1 })).toBe(sha256Hex(canonicalJson({ a: 1 })));
    expect(sha256Of({ a: 1 })).not.toBe(sha256Of({ a: 2 }));
  });
});
