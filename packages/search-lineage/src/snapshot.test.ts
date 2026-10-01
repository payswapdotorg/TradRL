/**
 * @tradrl/search-lineage — content-addressed config snapshot tests.
 *
 * Laws under test (snapshot.ts):
 * - identical configs address to the SAME snapshot id (dedupe);
 * - ANY content change addresses differently (content addressing);
 * - a snapshot whose stored content does not address to its id fails
 *   `snapshot_mismatch`;
 * - minting derives the id (callers cannot supply one);
 * - records are deeply frozen; canonical bytes are deterministic.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  configSnapshotId,
  isConfigSnapshot,
  mintConfigSnapshot,
  requireTimestampMs,
  snapshotCanonicalBytes,
  stableDigest,
  validateConfigSnapshot,
  validateSnapshotStore,
} from './index';

const CONFIG_A = { lr: '0.01', depth: 3, enable: true, tags: ['a', 'b'] } as const;
const CONFIG_A_REORDERED = { tags: ['a', 'b'], enable: true, depth: 3, lr: '0.01' } as const;
const CONFIG_B = { lr: '0.02', depth: 3, enable: true, tags: ['a', 'b'] } as const;

describe('content addressing', () => {
  it('identical configs address to the same snapshot id', () => {
    expect(configSnapshotId(CONFIG_A)).toBe(configSnapshotId({ ...CONFIG_A }));
  });

  it('key order does not matter (canonical JSON under the address)', () => {
    expect(configSnapshotId(CONFIG_A_REORDERED)).toBe(configSnapshotId(CONFIG_A));
  });

  it('any content change addresses differently', () => {
    expect(configSnapshotId(CONFIG_B)).not.toBe(configSnapshotId(CONFIG_A));
    expect(configSnapshotId({ ...CONFIG_A, depth: 4 })).not.toBe(configSnapshotId(CONFIG_A));
    expect(configSnapshotId({ ...CONFIG_A, tags: ['a'] })).not.toBe(configSnapshotId(CONFIG_A));
    expect(configSnapshotId({ ...CONFIG_A, extra: null })).not.toBe(configSnapshotId(CONFIG_A));
  });

  it('the id carries the snap: prefix and a 16-hex digest', () => {
    const id = configSnapshotId(CONFIG_A);
    expect(id.startsWith('snap:')).toBe(true);
    expect(id.slice(5)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('minting and validation', () => {
  it('minting derives the id and produces a guard-valid snapshot', () => {
    const minted = mintConfigSnapshot(CONFIG_A);
    expect(minted.ok).toBe(true);
    if (!minted.ok) throw new Error('must mint');
    expect(minted.value.snapshot_id).toBe(configSnapshotId(CONFIG_A));
    expect(isConfigSnapshot(minted.value)).toBe(true);
    expect(Object.isFrozen(minted.value)).toBe(true);
  });

  it('minting rejects non-object configs', () => {
    expect(mintConfigSnapshot('nope').ok).toBe(false);
    expect(mintConfigSnapshot([1, 2]).ok).toBe(false);
    expect(mintConfigSnapshot({ bad: Number.NaN }).ok).toBe(false);
    expect(mintConfigSnapshot({ bad: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it('a snapshot whose content does not address to its id fails snapshot_mismatch', () => {
    const minted = mintConfigSnapshot(CONFIG_A);
    if (!minted.ok) throw new Error('must mint');
    const liar = { snapshot_id: configSnapshotId(CONFIG_B), config: CONFIG_A };
    const result = validateConfigSnapshot(liar);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('snapshot_mismatch');
    expect(isConfigSnapshot(liar)).toBe(false);
  });

  it('validation collects structural violations', () => {
    const result = validateConfigSnapshot({ config: 42 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors.map((e) => e.code)).toContain('missing_field');
    expect(result.errors.map((e) => e.code)).toContain('invalid_field');
  });

  it('validateSnapshotStore rejects duplicates and invalid entries', () => {
    const a = mintConfigSnapshot(CONFIG_A);
    const b = mintConfigSnapshot(CONFIG_B);
    if (!a.ok || !b.ok) throw new Error('must mint');
    const dup = validateSnapshotStore([a.value, a.value]);
    expect(dup.ok).toBe(false);
    if (dup.ok) throw new Error('must fail');
    expect(dup.errors[0]?.code).toBe('duplicate_snapshot');
    expect(validateSnapshotStore([a.value, b.value]).ok).toBe(true);
  });
});

describe('determinism of the addressing', () => {
  it('the digest is pure: equal canonical strings digest equally, differently otherwise', () => {
    expect(stableDigest(canonicalJson(CONFIG_A))).toBe(stableDigest(canonicalJson(CONFIG_A_REORDERED)));
    expect(stableDigest(canonicalJson(CONFIG_A))).not.toBe(stableDigest(canonicalJson(CONFIG_B)));
  });

  it('snapshot canonical bytes are deterministic', () => {
    const x = mintConfigSnapshot(CONFIG_A);
    const y = mintConfigSnapshot(CONFIG_A_REORDERED);
    if (!x.ok || !y.ok) throw new Error('must mint');
    expect(snapshotCanonicalBytes(x.value)).toBe(snapshotCanonicalBytes(y.value));
  });

  it('nested structures address deterministically (deep key sorting)', () => {
    const nested1 = { a: { z: 1, y: [2, { w: null }] } } as const;
    const nested2 = { a: { y: [2, { w: null }], z: 1 } } as const;
    expect(configSnapshotId(nested1)).toBe(configSnapshotId(nested2));
  });

  it('timestamps do not participate in snapshot identity (config-only addressing)', () => {
    // Same config minted "at different times" (the concept does not exist here):
    // addressing is a pure function of content, with no ambient clock.
    const before = configSnapshotId(CONFIG_A);
    const instant = requireTimestampMs(1_700_000_000_000);
    const after = configSnapshotId(CONFIG_A);
    expect(before).toBe(after);
    expect(instant).toBe(1_700_000_000_000);
  });
});
