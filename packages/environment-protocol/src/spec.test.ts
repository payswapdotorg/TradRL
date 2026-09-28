/**
 * EnvironmentProfile and EnvironmentSpec: validation (positive and negative),
 * the coherence rules (fidelity, information policy), deep immutability,
 * the canonical JSON form and deterministic episode ids (L9).
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  canonicalSpecJson,
  createClockConfig,
  deriveEpisodeId,
  isEnvironmentProfile,
  isEnvironmentSpec,
  isWorldRef,
  validateEnvironmentProfile,
  validateEnvironmentSpec,
  type EnvironmentSpec,
} from './index';
import { requireTimestampMs } from './index';

function validProfileInput(): Record<string, unknown> {
  return {
    environment_id: 'env-stub-1',
    fidelity: 'reactive_replay',
    clock: {
      now: requireTimestampMs(1_000),
      asOf: requireTimestampMs(60_000),
      playbackSpeed: 1,
      paused: false,
      fidelity: 'reactive_replay',
      informationPolicy: 'point-in-time',
    },
    seed: 'seed-alpha-1',
    venue_scope: ['BINANCE'],
    instrument_scope: ['BTC-USDT', 'ETH-USDT'],
    latency_policy: 'lat-conservative',
    fee_policy: 'fee-maker-taker',
  };
}

function validSpecInput(): Record<string, unknown> {
  return {
    profile: validProfileInput(),
    world: { world_id: 'world-stub', kind: 'stub' },
    information_policy: 'point-in-time',
  };
}

describe('clock config construction (createClockConfig)', () => {
  it('applies the time-engine defaults: now = asOf, speed 1, unpaused', () => {
    const result = createClockConfig({ asOf: requireTimestampMs(10_000), fidelity: 'exact_replay' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.now).toBe(10_000);
      expect(result.value.playbackSpeed).toBe(1);
      expect(result.value.paused).toBe(false);
    }
  });

  it('rejects now > asOf and non-positive speed with typed errors', () => {
    expect(createClockConfig({ asOf: requireTimestampMs(1), now: requireTimestampMs(2), fidelity: 'generative' }).ok).toBe(false);
    expect(createClockConfig({ asOf: requireTimestampMs(1), playbackSpeed: 0, fidelity: 'generative' }).ok).toBe(false);
    expect(createClockConfig({ asOf: requireTimestampMs(1), playbackSpeed: Number.NaN, fidelity: 'generative' }).ok).toBe(false);
    expect(createClockConfig({ asOf: requireTimestampMs(1), fidelity: 'fantasy' as never }).ok).toBe(false);
  });
});

describe('environment profile validation', () => {
  it('accepts the reference profile and freezes it deeply', () => {
    const result = validateEnvironmentProfile(validProfileInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const profile = result.value;
      expect(isEnvironmentProfile(profile)).toBe(true);
      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.clock)).toBe(true);
      expect(Object.isFrozen(profile.venue_scope)).toBe(true);
    }
  });

  it('accepts empty scope (news/macro-only worlds are legal) and null policy refs', () => {
    const input = validProfileInput();
    (input as Record<string, unknown>).venue_scope = [];
    (input as Record<string, unknown>).instrument_scope = [];
    (input as Record<string, unknown>).latency_policy = null;
    (input as Record<string, unknown>).fee_policy = null;
    expect(validateEnvironmentProfile(input).ok).toBe(true);
  });

  it('rejects the fidelity mismatch between profile and clock', () => {
    const input = validProfileInput();
    (input as Record<string, unknown>).fidelity = 'exact_replay';
    const result = validateEnvironmentProfile(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe('fidelity_mismatch');
    }
    expect(isEnvironmentProfile(input)).toBe(false);
  });

  it('rejects duplicate scope ids', () => {
    const input = validProfileInput();
    (input as Record<string, unknown>).instrument_scope = ['BTC-USDT', 'BTC-USDT'];
    const result = validateEnvironmentProfile(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].path).toBe('profile.instrument_scope');
    }
    expect(isEnvironmentProfile(input)).toBe(false);
  });

  it('rejects an empty seed, unknown fidelity, malformed clock', () => {
    const emptySeed = validProfileInput();
    (emptySeed as Record<string, unknown>).seed = '  ';
    expect(validateEnvironmentProfile(emptySeed).ok).toBe(false);

    const badFidelity = validProfileInput();
    (badFidelity as Record<string, unknown>).fidelity = 'replay';
    (badFidelity as Record<string, unknown>).clock = {
      ...(badFidelity.clock as Record<string, unknown>),
      fidelity: 'replay',
    };
    expect(validateEnvironmentProfile(badFidelity).ok).toBe(false);

    const badClock = validProfileInput();
    (badClock as Record<string, unknown>).clock = { now: 5, asOf: 1 };
    const result = validateEnvironmentProfile(badClock);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // now > asOf is reported before per-field presence checks (invariant first).
      expect(result.errors[0].code).toBe('beyond_as_of');
    }
  });

  it('collects multiple violations at once', () => {
    const result = validateEnvironmentProfile({ environment_id: '', seed: '', venue_scope: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('environment spec validation', () => {
  it('accepts the reference spec and freezes it deeply', () => {
    const result = validateEnvironmentSpec(validSpecInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isEnvironmentSpec(result.value)).toBe(true);
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.world)).toBe(true);
      expect(Object.isFrozen(result.value.profile)).toBe(true);
    }
  });

  it('rejects the information-policy mismatch with the clock policy', () => {
    const input = validSpecInput();
    const profile = input.profile as Record<string, unknown>;
    const clock = profile.clock as Record<string, unknown>;
    clock.informationPolicy = 'lookahead'; // not a legal policy at all
    const result = validateEnvironmentSpec(input);
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed world reference with a precise path', () => {
    const input = validSpecInput();
    (input as Record<string, unknown>).world = { world_id: 'w', kind: '' };
    const result = validateEnvironmentSpec(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].path).toBe('spec.world.kind');
    }
    expect(isWorldRef({ world_id: 'w', kind: '' })).toBe(false);
    expect(isWorldRef({ world_id: 'w', kind: 'replay' })).toBe(true);
  });

  it('propagates profile violations with dotted paths and rejects non-objects', () => {
    const input = validSpecInput();
    const profile = input.profile as Record<string, unknown>;
    profile.seed = '';
    const result = validateEnvironmentSpec(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].path).toBe('spec.profile.seed');
    }
    expect(validateEnvironmentSpec('nope').ok).toBe(false);
    expect(validateEnvironmentSpec({}).ok).toBe(false);
    expect(isEnvironmentSpec(null)).toBe(false);
  });
});

describe('canonical form and deterministic episode ids (L9)', () => {
  function specFromInput(): EnvironmentSpec {
    const result = validateEnvironmentSpec(validSpecInput());
    if (!result.ok) throw new Error('fixture must be valid');
    return result.value;
  }

  it('canonicalJson sorts object keys recursively and is order-insensitive', () => {
    const a = canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: true } });
    const b = canonicalJson({ a: { c: true, d: [3, { y: 2, z: 1 }] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":true,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it('canonicalSpecJson is byte-identical for specs built with different field order', () => {
    const first = specFromInput();
    // Same values, constructed in a different key order.
    const reordered = {
      information_policy: 'point-in-time',
      world: { kind: 'stub', world_id: 'world-stub' },
      profile: {
        fee_policy: 'fee-maker-taker',
        latency_policy: 'lat-conservative',
        instrument_scope: ['BTC-USDT', 'ETH-USDT'],
        venue_scope: ['BINANCE'],
        seed: 'seed-alpha-1',
        clock: {
          informationPolicy: 'point-in-time',
          fidelity: 'reactive_replay',
          paused: false,
          playbackSpeed: 1,
          asOf: requireTimestampMs(60_000),
          now: requireTimestampMs(1_000),
        },
        fidelity: 'reactive_replay',
        environment_id: 'env-stub-1',
      },
    };
    const second = validateEnvironmentSpec(reordered);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('fixture must be valid');
    expect(canonicalSpecJson(first)).toBe(canonicalSpecJson(second.value));
  });

  it('deriveEpisodeId is stable for the same spec and sensitive to the seed', () => {
    const spec = specFromInput();
    expect(deriveEpisodeId(spec)).toBe(deriveEpisodeId(spec));

    const reseeded = validSpecInput();
    const profile = reseeded.profile as Record<string, unknown>;
    profile.seed = 'seed-beta-2';
    const reseededSpec = validateEnvironmentSpec(reseeded);
    if (!reseededSpec.ok) throw new Error('fixture must be valid');
    expect(deriveEpisodeId(spec)).not.toBe(deriveEpisodeId(reseededSpec.value));

    // And to any other clock/field change.
    const retime = validSpecInput();
    const reprofile = retime.profile as Record<string, unknown>;
    const clock = reprofile.clock as Record<string, unknown>;
    clock.now = requireTimestampMs(2_000);
    const retimedSpec = validateEnvironmentSpec(retime);
    if (!retimedSpec.ok) throw new Error('fixture must be valid');
    expect(deriveEpisodeId(spec)).not.toBe(deriveEpisodeId(retimedSpec.value));
  });

  it('equal specs constructed independently derive the SAME episode id (the determinism anchor)', () => {
    const first = specFromInput();
    const second = validateEnvironmentSpec(validSpecInput());
    if (!second.ok) throw new Error('fixture must be valid');
    expect(deriveEpisodeId(first)).toBe(deriveEpisodeId(second.value));
  });
});
