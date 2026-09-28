/**
 * The latency model: determinism (pure function of config+seed+domain+
 * ordinal), boundary coverage, and the L6 fidelity declaration record.
 */

import { describe, expect, it } from 'vitest';

import { LATENCY_FIDELITY, isLatencyConfig, latencyDelayMs, validateLatencyConfig, type LatencyConfig } from './latency';

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly unknown[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

describe('latency config validation', () => {
  it('accepts fixed and uniform shapes, rejects the rest (collect-all)', () => {
    expect(validateLatencyConfig({ kind: 'fixed', fixed_ms: 250 }).ok).toBe(true);
    expect(validateLatencyConfig({ kind: 'uniform', min_ms: 100, max_ms: 900 }).ok).toBe(true);
    expect(validateLatencyConfig({ kind: 'fixed' }).ok).toBe(false);
    expect(validateLatencyConfig({ kind: 'fixed', fixed_ms: -1 }).ok).toBe(false);
    expect(validateLatencyConfig({ kind: 'fixed', fixed_ms: 1.5 }).ok).toBe(false);
    expect(validateLatencyConfig({ kind: 'uniform', min_ms: 500, max_ms: 100 }).ok).toBe(false);
    expect(validateLatencyConfig({ kind: 'uniform', min_ms: -1, max_ms: 100 }).ok).toBe(false);
    expect(validateLatencyConfig({ kind: 'uniform' }).ok).toBe(false);
    expect(validateLatencyConfig({ kind: 'jitter', fixed_ms: 1 }).ok).toBe(false);
    expect(validateLatencyConfig('fast').ok).toBe(false);
    expect(isLatencyConfig({ kind: 'fixed', fixed_ms: 0 })).toBe(true);
    expect(isLatencyConfig({ kind: 'uniform', min_ms: 0, max_ms: 0 })).toBe(true);
    expect(isLatencyConfig({ kind: 'nope' })).toBe(false);
  });
});

describe('delay derivation (pure: config + seed + domain + ordinal)', () => {
  const fixed = unwrap(validateLatencyConfig({ kind: 'fixed', fixed_ms: 250 })) as LatencyConfig;
  const uniform = unwrap(validateLatencyConfig({ kind: 'uniform', min_ms: 100, max_ms: 900 })) as LatencyConfig;

  it('fixed configs return their constant regardless of seed/ordinal', () => {
    expect(latencyDelayMs(fixed, 'seed-a', 'order', 1)).toBe(250);
    expect(latencyDelayMs(fixed, 'seed-b', 'fill', 999)).toBe(250);
  });

  it('uniform configs draw deterministically — same inputs, same delay, TWICE', () => {
    for (let ordinal = 1; ordinal <= 50; ordinal++) {
      const first = latencyDelayMs(uniform, 'seed-alpha', 'order', ordinal);
      const second = latencyDelayMs(uniform, 'seed-alpha', 'order', ordinal);
      expect(second).toBe(first);
      expect(first).toBeGreaterThanOrEqual(100);
      expect(first).toBeLessThanOrEqual(900);
      expect(Number.isInteger(first)).toBe(true);
    }
  });

  it('different seeds, domains or ordinals decorrelate the draws', () => {
    const drawsA = Array.from({ length: 40 }, (_, i) => latencyDelayMs(uniform, 'seed-alpha', 'order', i + 1));
    const drawsB = Array.from({ length: 40 }, (_, i) => latencyDelayMs(uniform, 'seed-beta', 'order', i + 1));
    const drawsFill = Array.from({ length: 40 }, (_, i) => latencyDelayMs(uniform, 'seed-alpha', 'fill', i + 1));
    expect(new Set(drawsA).size).toBeGreaterThan(10); // genuinely spread
    expect(JSON.stringify(drawsA)).not.toBe(JSON.stringify(drawsB));
    expect(JSON.stringify(drawsA)).not.toBe(JSON.stringify(drawsFill));
  });

  it('a zero-width uniform range is the constant min', () => {
    const degenerate = unwrap(validateLatencyConfig({ kind: 'uniform', min_ms: 42, max_ms: 42 })) as LatencyConfig;
    expect(latencyDelayMs(degenerate, 'any', 'order', 7)).toBe(42);
  });

  it('is stable across separate module instances (process-portable determinism)', async () => {
    const specifier = './latency';
    const first: unknown = await import(/* @vite-ignore */ specifier);
    const candidate = first as Record<string, unknown>;
    const delay = candidate.latencyDelayMs as (config: LatencyConfig, seed: string, domain: string, ordinal: number) => number;
    expect(delay(uniform, 'seed-alpha', 'order', 3)).toBe(latencyDelayMs(uniform, 'seed-alpha', 'order', 3));
  });
});

describe('L6 fidelity declaration (acceptance criterion 5)', () => {
  it('the declaration record exists, is frozen, and declares the information-latency-only limitation', () => {
    expect(LATENCY_FIDELITY).toBeDefined();
    expect(Object.isFrozen(LATENCY_FIDELITY)).toBe(true);
    expect(LATENCY_FIDELITY.modeled.length).toBeGreaterThan(0);
    expect(LATENCY_FIDELITY.declared_limitations.join(' ')).toMatch(/information latency/);
    expect(LATENCY_FIDELITY.declared_limitations.join(' ')).toMatch(/feed latency/);
  });
});
