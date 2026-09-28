/**
 * @tradrl/market-world — world config validation + deterministic config
 * hashing tests.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalConfigJson,
  configHash,
  isReplayWorldConfig,
  isWorldMode,
  streamSelectionKey,
  validateWorldConfig,
  worldModeOf,
} from './index';

const T0 = 1_700_000_000_000;

function configFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    world_id: 'world-replay-fixture',
    fidelity: 'exact_replay',
    information_policy: 'point-in-time',
    seed: 'seed-alpha',
    as_of: T0 + 10_000,
    streams: [{ venue: 'BINANCE', instrument: 'BTC-USDT' }],
    ...overrides,
  };
}

describe('validateWorldConfig', () => {
  it('accepts a valid config and freezes it', () => {
    const result = validateWorldConfig(configFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.playback_speed).toBe(1); // default
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(isReplayWorldConfig(configFixture())).toBe(true);
  });

  it('admits ALL THREE L5 fidelity modes at the shape level (the implementation gate is initReplayWorld)', () => {
    expect(validateWorldConfig(configFixture({ fidelity: 'exact_replay' })).ok).toBe(true);
    expect(validateWorldConfig(configFixture({ fidelity: 'reactive_replay' })).ok).toBe(true);
    expect(validateWorldConfig(configFixture({ fidelity: 'generative' })).ok).toBe(true);
    expect(validateWorldConfig(configFixture({ fidelity: 'replay' })).ok).toBe(false); // no aliasing
  });

  it('requires a non-empty stream selection (an empty universe replays nothing)', () => {
    const result = validateWorldConfig(configFixture({ streams: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.path === 'config.streams')).toBe(true);
  });

  it('rejects duplicate stream selections and malformed pairs', () => {
    const duplicate = [{ venue: 'BINANCE', instrument: 'BTC-USDT' }, { venue: 'BINANCE', instrument: 'BTC-USDT' }];
    expect(validateWorldConfig(configFixture({ streams: duplicate })).ok).toBe(false);
    expect(validateWorldConfig(configFixture({ streams: [{ venue: '', instrument: 'BTC-USDT' }] })).ok).toBe(false);
    expect(validateWorldConfig(configFixture({ streams: [{ venue: 'BINANCE' }] })).ok).toBe(false);
  });

  it('rejects a non-timestamp as_of, a bad policy, a bad seed and a non-positive playback speed (collect-all)', () => {
    const result = validateWorldConfig(
      configFixture({ as_of: 'tomorrow', information_policy: 'realtime', seed: '', playback_speed: 0 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.errors.map((error) => error.path);
    expect(paths).toContain('config.as_of');
    expect(paths).toContain('config.information_policy');
    expect(paths).toContain('config.seed');
    expect(paths).toContain('config.playback_speed');
  });
});

describe('deterministic config hashing (L9)', () => {
  it('identical configs (any field order at construction) hash identically', () => {
    const a = validateWorldConfig(configFixture());
    const b = validateWorldConfig({
      streams: [{ venue: 'BINANCE', instrument: 'BTC-USDT' }],
      seed: 'seed-alpha',
      as_of: T0 + 10_000,
      information_policy: 'point-in-time',
      fidelity: 'exact_replay',
      world_id: 'world-replay-fixture',
    });
    if (!a.ok || !b.ok) throw new Error('fixture');
    expect(canonicalConfigJson(a.value)).toBe(canonicalConfigJson(b.value));
    expect(configHash(a.value)).toBe(configHash(b.value));
  });

  it('any determining change changes the hash (seed, as_of, streams, fidelity)', () => {
    const base = validateWorldConfig(configFixture());
    const seedChange = validateWorldConfig(configFixture({ seed: 'seed-beta' }));
    const asOfChange = validateWorldConfig(configFixture({ as_of: T0 + 20_000 }));
    const streamChange = validateWorldConfig(configFixture({ streams: [{ venue: 'XNAS', instrument: 'AAPL' }] }));
    const fidelityChange = validateWorldConfig(configFixture({ fidelity: 'generative' }));
    if (!base.ok || !seedChange.ok || !asOfChange.ok || !streamChange.ok || !fidelityChange.ok) throw new Error('fixture');
    const baseHash = configHash(base.value);
    expect(configHash(seedChange.value)).not.toBe(baseHash);
    expect(configHash(asOfChange.value)).not.toBe(baseHash);
    expect(configHash(streamChange.value)).not.toBe(baseHash);
    expect(configHash(fidelityChange.value)).not.toBe(baseHash);
  });
});

describe('world mode + stream keys', () => {
  it('worldModeOf extracts the first-class mode declaration', () => {
    const config = validateWorldConfig(configFixture());
    if (!config.ok) throw new Error('fixture');
    const mode = worldModeOf(config.value);
    expect(mode.fidelity).toBe('exact_replay');
    expect(mode.informationPolicy).toBe('point-in-time');
    expect(isWorldMode(mode)).toBe(true);
  });

  it('streamSelectionKey renders venue|instrument', () => {
    const config = validateWorldConfig(configFixture());
    if (!config.ok) throw new Error('fixture');
    expect(streamSelectionKey(config.value.streams[0])).toBe('BINANCE|BTC-USDT');
  });
});
