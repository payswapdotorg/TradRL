/**
 * @tradrl/sdk — the idempotency-key helper tests: the deterministic
 * derivation (identical parts -> identical keys; key-order
 * differences derive the SAME key — canonical JSON, L9), the
 * injected-entropy derivation (no ambient randomness), the
 * wire-header law, and the retry-safe scope (ONE key per logical
 * operation).
 */

import { describe, expect, it } from 'vitest';

import { IdempotencyScope, deriveIdempotencyKey, idempotencyKeyFromEntropy, isValidIdempotencyKey } from './idempotency';

describe('deriveIdempotencyKey (the deterministic derivation)', () => {
  it('identical parts derive identical keys', () => {
    expect(deriveIdempotencyKey(['jobs.research', { projectId: 'p', spec: { q: 'x' } }]))
      .toBe(deriveIdempotencyKey(['jobs.research', { projectId: 'p', spec: { q: 'x' } }]));
  });

  it('key-order differences in equal-shaped parts derive the SAME key (canonical JSON)', () => {
    expect(deriveIdempotencyKey({ a: 1, b: 2 })).toBe(deriveIdempotencyKey({ b: 2, a: 1 }));
  });

  it('different parts derive different keys', () => {
    expect(deriveIdempotencyKey(['op', 1])).not.toBe(deriveIdempotencyKey(['op', 2]));
  });

  it('the key carries the idem: grammar', () => {
    expect(deriveIdempotencyKey('x')).toMatch(/^idem:[0-9a-f]{8}$/);
  });
});

describe('idempotencyKeyFromEntropy (the injected-entropy derivation)', () => {
  it('derives from host entropy without ambient randomness', () => {
    expect(idempotencyKeyFromEntropy('550e8400-e29b-41d4-a716-446655440000')).toMatch(/^idem:[0-9a-f]{8}$/);
    expect(idempotencyKeyFromEntropy('550e8400-e29b-41d4-a716-446655440000')).toBe(idempotencyKeyFromEntropy('550e8400-e29b-41d4-a716-446655440000'));
    expect(idempotencyKeyFromEntropy('a')).not.toBe(idempotencyKeyFromEntropy('b'));
  });

  it('refuses empty entropy (fail-closed)', () => {
    expect(() => idempotencyKeyFromEntropy('')).toThrow();
  });
});

describe('the wire-header law', () => {
  it('opaque non-empty strings up to 256 chars are valid keys', () => {
    expect(isValidIdempotencyKey('anything')).toBe(true);
    expect(isValidIdempotencyKey('idem:0123abcd')).toBe(true);
    expect(isValidIdempotencyKey('x'.repeat(256))).toBe(true);
    expect(isValidIdempotencyKey('')).toBe(false);
    expect(isValidIdempotencyKey('x'.repeat(257))).toBe(false);
    expect(isValidIdempotencyKey(42)).toBe(false);
  });
});

describe('IdempotencyScope (the retry-safe holder)', () => {
  it('derives once and reuses across retries', () => {
    const scope = new IdempotencyScope();
    const first = scope.reuse(['execution.requests', 'si:1']);
    const second = scope.reuse(['execution.requests', 'si:1']);
    const third = scope.reuse(['execution.requests', 'si:1']);
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(scope.derived).toBe(true);
  });

  it('different scopes derive independently (different logical operations)', () => {
    const a = new IdempotencyScope().reuse('op-a');
    const b = new IdempotencyScope().reuse('op-b');
    expect(a).not.toBe(b);
  });
});
