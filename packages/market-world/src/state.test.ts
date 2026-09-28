/**
 * @tradrl/market-world — ReplayWorldState tests: the L5 mode gate, state
 * guards, sequence-tracker derivation, and the serialize/deserialize resume
 * contract.
 */

import { describe, expect, it } from 'vitest';

import {
  deserializeReplayWorldState,
  initReplayWorld,
  isDeeplyFrozen,
  isReplayWorldState,
  replayBaseStateFrom,
  sequenceTrackersOf,
  serializeReplayWorldState,
  validateWorldConfig,
  type TimestampMs,
} from './index';
import { ingestWorld } from './transition';

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

function eventFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: 'evt-1',
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: T0,
    source_time: T0,
    available_time: T0 + 40,
    ingestion_time: T0 + 100,
    sequence: 1,
    provider: 'binance',
    provenance: { origin: 'historical', adapter: { id: 'binance-adapter', version: '1.4.0' }, derived_from: [], transform: null },
    payload: { price: '43125.10', size: '0.017', side: 'buy' },
    ...overrides,
  };
}

describe('initReplayWorld — the L5 mode gate', () => {
  it('initializes an exact_replay world standing at its anchor', () => {
    const result = initReplayWorld(configFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = result.value;
    expect(state.world_id).toBe('world-replay-fixture');
    expect(state.spec).toBeNull();
    expect(state.clock.now).toBe(T0 + 10_000);
    expect(state.clock.asOf).toBe(T0 + 10_000);
    expect(state.clock.fidelity).toBe('exact_replay');
    expect(state.history).toEqual([]);
    expect(state.status).toBe('running');
    expect(isDeeplyFrozen(state)).toBe(true);
  });

  it('rejects reactive_replay and generative configs with unsupported_fidelity (L5: this WO is exact replay only)', () => {
    for (const fidelity of ['reactive_replay', 'generative']) {
      const result = initReplayWorld(configFixture({ fidelity }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe('unsupported_fidelity');
      expect(result.errors[0]?.message).toContain('L5');
    }
  });

  it('rejects a malformed config with the collect-all config errors', () => {
    const result = initReplayWorld({ world_id: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.code === 'missing_field' || error.code === 'invalid_field')).toBe(true);
  });
});

describe('isReplayWorldState (total guard)', () => {
  it('accepts initialized and ingested states; rejects tampered ones', () => {
    const state = initReplayWorld(configFixture());
    if (!state.ok) throw new Error('fixture');
    expect(isReplayWorldState(state.value)).toBe(true);

    const ingested = ingestWorld(state.value, [eventFixture()]);
    if (!ingested.ok) throw new Error('fixture');
    expect(isReplayWorldState(ingested.value)).toBe(true);

    // Tampering: clock/config fidelity coherence broken.
    expect(isReplayWorldState({ ...state.value, clock: { ...state.value.clock, fidelity: 'generative' } })).toBe(false);
    // Tampering: intents on an unbound (loading) state.
    const config = validateWorldConfig(configFixture());
    if (!config.ok) throw new Error('fixture');
    expect(isReplayWorldState({ ...state.value, intents: [{ action: {}, receipt: {} }] })).toBe(false);
    // Foreign values.
    expect(isReplayWorldState(null)).toBe(false);
    expect(isReplayWorldState(42)).toBe(false);
  });
});

describe('sequence trackers (mirror of market-protocol discipline)', () => {
  it('folds the history into canonically-sorted per-stream trackers', () => {
    const state = initReplayWorld(configFixture());
    if (!state.ok) throw new Error('fixture');
    const quote = (id: string, seq: number, t: number) =>
      eventFixture({ event_id: id, event_type: 'quote', sequence: seq, event_time: t, available_time: t + 10, payload: { bid_price: '1', bid_size: '1', ask_price: '2', ask_size: '1' } });
    const trade = (id: string, seq: number, t: number) =>
      eventFixture({ event_id: id, event_type: 'trade', sequence: seq, event_time: t, available_time: t + 10 });
    const ingested = ingestWorld(state.value, [trade('t1', 1, T0), quote('q1', 1, T0), trade('t2', 2, T0 + 1), quote('q2', 5, T0 + 1)]);
    if (!ingested.ok) throw new Error('fixture');
    const trackers = ingested.value.sequences;
    expect(trackers.map((tracker) => [tracker.stream, tracker.last_sequence, tracker.event_count])).toEqual([
      ['trade', 2, 2],
      ['quote', 5, 2],
    ]);
    // The forensic rebuild agrees with the incrementally-maintained trackers.
    expect(sequenceTrackersOf(ingested.value.history)).toEqual(trackers);
  });
});

describe('serialize / deserialize (the resume contract)', () => {
  it('round-trips an ingested state exactly (deep equality, deep freeze)', () => {
    const state = initReplayWorld(configFixture());
    if (!state.ok) throw new Error('fixture');
    const ingested = ingestWorld(state.value, [
      eventFixture(),
      eventFixture({ event_id: 'evt-2', event_type: 'quote', sequence: 1, payload: { bid_price: '43100', bid_size: '1', ask_price: '43150', ask_size: '2' } }),
    ]);
    if (!ingested.ok) throw new Error('fixture');
    const serialized = serializeReplayWorldState(ingested.value);
    if (!serialized.ok) throw new Error('fixture');
    const restored = deserializeReplayWorldState(JSON.parse(JSON.stringify(serialized.value)));
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value).toEqual(ingested.value);
    expect(isDeeplyFrozen(restored.value)).toBe(true);
  });

  it('rejects tampered serializations with typed errors (never silently)', () => {
    const state = initReplayWorld(configFixture());
    if (!state.ok) throw new Error('fixture');
    const serialized = serializeReplayWorldState(state.value);
    if (!serialized.ok) throw new Error('fixture');
    const asRecord = serialized.value as Record<string, unknown>;
    const tampered = { ...asRecord, clock: { ...(asRecord.clock as Record<string, unknown>), now: 'not-a-timestamp' } };
    const result = deserializeReplayWorldState(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.path === 'state.clock')).toBe(true);

    const historyTampered = { ...asRecord, history: [{ event_id: 'x' }] };
    expect(deserializeReplayWorldState(historyTampered).ok).toBe(false);
    expect(deserializeReplayWorldState('nonsense').ok).toBe(false);
  });
});

describe('replayBaseStateFrom (the pristine loading state)', () => {
  it('strips episode-level evolution while carrying the recorded history', () => {
    const state = initReplayWorld(configFixture());
    if (!state.ok) throw new Error('fixture');
    const ingested = ingestWorld(state.value, [eventFixture()]);
    if (!ingested.ok) throw new Error('fixture');
    // Simulate episode-bound evolution:
    const evolved = { ...ingested.value, clock: { ...ingested.value.clock, now: T0 as TimestampMs }, status: 'finished' as const, termination: { code: 'completed' as const, detail: 'done' } };
    const base = replayBaseStateFrom(evolved);
    expect(base.spec).toBeNull();
    expect(base.intents).toEqual([]);
    expect(base.status).toBe('running');
    expect(base.termination).toBeNull();
    expect(base.clock.now).toBe(T0 + 10_000); // standing at the anchor again
    expect(base.history).toBe(ingested.value.history); // structural sharing of the immutable history
    expect(isReplayWorldState(base)).toBe(true);
  });
});
