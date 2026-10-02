/**
 * @tradrl/security — the environment-spec mirror tests (T005).
 *
 * Pins the mirror's own laws (a REAL T005 spec proving parity lives in
 * interop.test.ts and tests/security/interop.test.ts): the guard laws
 * (clock coherence, fidelity coherence, scope uniqueness, policy
 * coherence); the canonical form's order-independence; the deterministic
 * episode-id derivation (same spec, same id; any change, different id).
 */
import { describe, expect, it } from 'vitest';

import {
  canonicalSpecJson,
  deriveEpisodeId,
  isClockConfig,
  isEnvironmentProfile,
  isEnvironmentSpec,
  type EnvironmentSpec,
  type TimestampMs,
} from './index';

const T0 = 1_717_459_200_000 as TimestampMs;

function specFixture(overrides: { seed?: string; fidelity?: 'exact_replay' | 'reactive_replay' | 'generative'; worldId?: string } = {}): EnvironmentSpec {
  return {
    profile: {
      environment_id: 'env-research-1' as EnvironmentSpec['profile']['environment_id'],
      fidelity: overrides.fidelity ?? 'exact_replay',
      clock: { now: T0, asOf: (T0 + 86_400_000) as TimestampMs, playbackSpeed: 1, paused: false, fidelity: overrides.fidelity ?? 'exact_replay', informationPolicy: 'point-in-time' },
      seed: (overrides.seed ?? 'seed-42') as EnvironmentSpec['profile']['seed'],
      venue_scope: ['binance', 'kraken'] as unknown as EnvironmentSpec['profile']['venue_scope'],
      instrument_scope: ['BTC-USDT'] as unknown as EnvironmentSpec['profile']['instrument_scope'],
      latency_policy: null,
      fee_policy: null,
    },
    world: { world_id: (overrides.worldId ?? 'world-replay-btc') as EnvironmentSpec['world']['world_id'], kind: 'replay' },
    information_policy: 'point-in-time',
  };
}

describe("the mirror guards (T005 laws)", () => {
  it('accepts the fixture and validates the clock coherence (now <= asOf)', () => {
    expect(isEnvironmentSpec(specFixture())).toBe(true);
    expect(isClockConfig({ now: T0, asOf: T0, playbackSpeed: 1, paused: false, fidelity: 'generative', informationPolicy: 'point-in-time' })).toBe(true);
    expect(isClockConfig({ now: T0 + 1, asOf: T0, playbackSpeed: 1, paused: false, fidelity: 'generative', informationPolicy: 'point-in-time' })).toBe(false);
    expect(isClockConfig({ now: T0, asOf: T0, playbackSpeed: 0, paused: false, fidelity: 'generative', informationPolicy: 'point-in-time' })).toBe(false);
    expect(isClockConfig({ now: T0, asOf: T0, playbackSpeed: 1, paused: false, fidelity: 'generative', informationPolicy: 'other' })).toBe(false);
  });

  it('fidelity coherence: profile.fidelity IS clock.fidelity', () => {
    const mismatched = specFixture();
    (mismatched.profile as unknown as { fidelity: string }).fidelity = 'generative';
    expect(isEnvironmentProfile(mismatched.profile)).toBe(false);
    expect(isEnvironmentSpec(mismatched)).toBe(false);
  });

  it("policy coherence: spec.information_policy IS clock.informationPolicy", () => {
    const mismatched = { ...specFixture(), information_policy: 'full-information' } as unknown as EnvironmentSpec;
    expect(isEnvironmentSpec(mismatched)).toBe(false);
  });

  it('scope uniqueness: duplicate venues/instruments are refused', () => {
    const dup = specFixture();
    (dup.profile as unknown as { venue_scope: string[] }).venue_scope = ['binance', 'binance'];
    expect(isEnvironmentProfile(dup.profile)).toBe(false);
    const dupInstrument = specFixture();
    (dupInstrument.profile as unknown as { instrument_scope: string[] }).instrument_scope = ['BTC-USDT', 'BTC-USDT'];
    expect(isEnvironmentProfile(dupInstrument.profile)).toBe(false);
  });
});

describe('the canonical form and the deterministic episode id', () => {
  it('equal specs serialize byte-identically regardless of construction field order', () => {
    const a = specFixture();
    const b: EnvironmentSpec = {
      information_policy: 'point-in-time',
      world: { kind: 'replay', world_id: 'world-replay-btc' as EnvironmentSpec['world']['world_id'] },
      profile: {
        fee_policy: null,
        latency_policy: null,
        instrument_scope: ['BTC-USDT'] as unknown as EnvironmentSpec['profile']['instrument_scope'],
        venue_scope: ['binance', 'kraken'] as unknown as EnvironmentSpec['profile']['venue_scope'],
        seed: 'seed-42' as EnvironmentSpec['profile']['seed'],
        clock: { informationPolicy: 'point-in-time', fidelity: 'exact_replay', paused: false, playbackSpeed: 1, asOf: (T0 + 86_400_000) as TimestampMs, now: T0 },
        fidelity: 'exact_replay',
        environment_id: 'env-research-1' as EnvironmentSpec['profile']['environment_id'],
      },
    };
    expect(canonicalSpecJson(a)).toBe(canonicalSpecJson(b));
  });

  it('the same spec always yields the same episode id; any change yields a different one', () => {
    const base = specFixture();
    expect(deriveEpisodeId(base)).toBe(deriveEpisodeId(specFixture()));
    expect(deriveEpisodeId(base)).toMatch(/^ep-[0-9a-f]{8}$/);
    for (const changed of [specFixture({ seed: 'seed-43' }), specFixture({ fidelity: 'generative' }), specFixture({ worldId: 'world-other' })]) {
      expect(deriveEpisodeId(changed)).not.toBe(deriveEpisodeId(base));
    }
  });
});
