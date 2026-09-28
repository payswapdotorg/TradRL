/**
 * @tradrl/market-world — the ReplayTransition protocol tests.
 *
 * Covers every world-level ingestion law (acceptance criteria 5 and 10), the
 * inclusive L4 boundary with the Time-Machine query law (criterion 4), and
 * the monotonic anchored clock (criterion 6).
 */

import { describe, expect, it } from 'vitest';

import { initReplayWorld, isDeeplyFrozen } from './index';
import { advanceWorld, finishWorld, ingestWorld, observeWorld } from './transition';

const T0 = 1_700_000_000_000;
const AS_OF = T0 + 10_000;

function configFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    world_id: 'world-replay-fixture',
    fidelity: 'exact_replay',
    information_policy: 'point-in-time',
    seed: 'seed-alpha',
    as_of: AS_OF,
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

function freshWorld() {
  const world = initReplayWorld(configFixture());
  if (!world.ok) throw new Error(`fixture world failed: ${JSON.stringify(world.errors)}`);
  return world.value;
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; errors: readonly { code: string; message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

describe('ingestWorld — the happy path', () => {
  it('applies a valid batch, updates trackers and snapshot refs, and stays deeply frozen', () => {
    const world = freshWorld();
    const trade = eventFixture({ event_id: 't1' });
    const snapshot = eventFixture({
      event_id: 'snap-1',
      event_type: 'book_snapshot',
      sequence: 1,
      payload: { bids: [{ price: '43100', size: '1' }], asks: [{ price: '43150', size: '2' }] },
    });
    const result = ingestWorld(world, [trade, snapshot]);
    expect(result.ok).toBe(true);
    const state = unwrap(result);
    expect(state.history.map((event) => event.event_id)).toEqual(['t1', 'snap-1']);
    expect(state.sequences.map((tracker) => [tracker.stream, tracker.last_sequence])).toEqual([
      ['book_snapshot', 1],
      ['trade', 1],
    ]);
    expect(state.snapshot_refs).toEqual(['snap-1']); // the recorded book IS the snapshot (L6)
    expect(isDeeplyFrozen(state)).toBe(true);
    expect(world.history.length).toBe(0); // the input state is untouched (purity)
  });

  it('is transactional per batch: a failing batch leaves the state unchanged', () => {
    const world = freshWorld();
    const good = eventFixture({ event_id: 't1' });
    const bad = eventFixture({ event_id: 't2', available_time: 'soon' });
    const result = ingestWorld(world, [good, bad]);
    expect(result.ok).toBe(false);
    expect(world.history.length).toBe(0);
  });
});

describe('ingestWorld — quartet, sequence and duplicate laws (criterion 5)', () => {
  it('rejects available_time < event_time (quartet ordering)', () => {
    const result = ingestWorld(freshWorld(), [eventFixture({ event_time: T0 + 100, available_time: T0 + 40 })]);
    expect(result.ok).toBe(false);
    const errors = result.ok ? [] : result.errors;
    expect(errors.some((error) => error.message.includes('precedes event_time'))).toBe(true);
  });

  it('rejects a per-stream sequence regression', () => {
    const world = unwrap(ingestWorld(freshWorld(), [eventFixture({ event_id: 't1', sequence: 7 })]));
    const result = ingestWorld(world, [eventFixture({ event_id: 't2', sequence: 6 })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('sequence_regression');
  });

  it('rejects a per-stream duplicate sequence (equal high-water)', () => {
    const world = unwrap(ingestWorld(freshWorld(), [eventFixture({ event_id: 't1', sequence: 7 })]));
    const result = ingestWorld(world, [eventFixture({ event_id: 't2', sequence: 7 })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('duplicate_sequence');
  });

  it('accepts an equal sequence in a DIFFERENT stream (independent sequences)', () => {
    const world = unwrap(ingestWorld(freshWorld(), [eventFixture({ event_id: 't1', event_type: 'trade', sequence: 7 })]));
    const quote = eventFixture({
      event_id: 'q1',
      event_type: 'quote',
      sequence: 7,
      payload: { bid_price: '1', bid_size: '1', ask_price: '2', ask_size: '1' },
    });
    expect(ingestWorld(world, [quote]).ok).toBe(true);
  });

  it('rejects a duplicate event id (against the whole applied history, across batches)', () => {
    const world = unwrap(ingestWorld(freshWorld(), [eventFixture({ event_id: 't1' })]));
    const result = ingestWorld(world, [eventFixture({ event_id: 't1', sequence: 2 })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('duplicate_event');
  });

  it('rejects a malformed envelope with the batch-positioned collect-all diagnostics', () => {
    const result = ingestWorld(freshWorld(), [{ event_id: 'x' }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path.startsWith('batch[0]')).toBe(true);
  });
});

describe('ingestWorld — stream selection and the as_of anchor', () => {
  it('rejects an event from a stream outside the selection', () => {
    const result = ingestWorld(freshWorld(), [eventFixture({ venue: 'XNAS', instrument: 'AAPL' })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('stream_not_selected');
  });

  it('rejects an event whose available_time exceeds the world as_of anchor (event_beyond_as_of)', () => {
    const result = ingestWorld(freshWorld(), [eventFixture({ available_time: AS_OF + 1, event_time: AS_OF, ingestion_time: AS_OF + 2 })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('event_beyond_as_of');
  });

  it('accepts an event available exactly AT the anchor (inclusive)', () => {
    expect(ingestWorld(freshWorld(), [eventFixture({ event_time: AS_OF, available_time: AS_OF })]).ok).toBe(true);
  });
});

describe('ingestWorld — anti-poisoning: recorded history only (criterion 10)', () => {
  it('rejects simulated-origin events with synthetic_event_rejected', () => {
    const simulated = eventFixture({
      provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
    });
    const result = ingestWorld(freshWorld(), [simulated]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('synthetic_event_rejected');
  });

  it('rejects generated-origin events with synthetic_event_rejected', () => {
    const generated = eventFixture({
      provenance: { origin: 'generated', adapter: { id: 'gen', version: '1' }, derived_from: [], transform: null },
    });
    const result = ingestWorld(freshWorld(), [generated]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('synthetic_event_rejected');
  });

  it('accepts historical-origin events that DECLARE their recorded provenance explicitly (the fixture discipline)', () => {
    const declared = eventFixture({
      provenance: { origin: 'historical', adapter: { id: 'replay-fixture-adapter', version: '1.0.0' }, derived_from: [], transform: null },
    });
    expect(ingestWorld(freshWorld(), [declared]).ok).toBe(true);
  });
});

describe('observeWorld — the inclusive L4 boundary (criterion 4)', () => {
  function loadedHistory() {
    const world = freshWorld();
    return unwrap(
      ingestWorld(world, [
        eventFixture({ event_id: 'past', event_time: T0, available_time: T0 + 100, sequence: 1 }),
        eventFixture({ event_id: 'at-now', event_time: T0 + 200, available_time: T0 + 200, sequence: 2 }),
        eventFixture({ event_id: 'after-now', event_time: T0 + 201, available_time: T0 + 201, sequence: 3 }),
        // A DERIVED historical event (aggregate over the trades) — derived
        // observations obey the SAME law (L4).
        eventFixture({
          event_id: 'derived-at-now',
          event_type: 'other',
          sequence: 1,
          event_time: T0 + 200,
          available_time: T0 + 200,
          payload: { kind: 'vwap_1m', data: { value: '43125.10' } },
          provenance: { origin: 'historical', adapter: { id: 'replay-fixture-adapter', version: '1.0.0' }, derived_from: ['past', 'at-now'], transform: 'fixture-vwap-1m' },
        }),
        eventFixture({
          event_id: 'derived-after-now',
          event_type: 'other',
          sequence: 2,
          event_time: T0 + 201,
          available_time: T0 + 201,
          payload: { kind: 'vwap_1m', data: { value: '43126.00' } },
          provenance: { origin: 'historical', adapter: { id: 'replay-fixture-adapter', version: '1.0.0' }, derived_from: ['after-now'], transform: 'fixture-vwap-1m' },
        }),
      ]),
    );
  }

  it('delivers an event with available_time == now (INCLUSIVE) and withholds == now + 1', () => {
    const state = loadedHistory();
    const advanced = unwrap(advanceWorld(state, T0 + 200));
    const visible = unwrap(observeWorld(advanced, T0 + 200));
    expect(visible.map((event) => event.event_id)).toEqual(['past', 'at-now', 'derived-at-now']);
  });

  it('reveals the withheld events exactly one millisecond later', () => {
    const state = loadedHistory();
    const advanced = unwrap(advanceWorld(state, T0 + 201));
    const visible = unwrap(observeWorld(advanced, T0 + 201));
    expect(visible.map((event) => event.event_id)).toEqual(['past', 'at-now', 'after-now', 'derived-at-now', 'derived-after-now']);
  });

  it('withholds at now - 1 what now delivers (never one millisecond early)', () => {
    const state = loadedHistory();
    const advanced = unwrap(advanceWorld(state, T0 + 200));
    const before = unwrap(observeWorld(advanced, T0 + 199));
    expect(before.map((event) => event.event_id)).toEqual(['past']);
  });

  it('a DERIVED observation obeys the same law as a primitive one (identical treatment)', () => {
    const state = loadedHistory();
    const advanced = unwrap(advanceWorld(state, T0 + 200));
    const visible = unwrap(observeWorld(advanced, T0 + 200));
    const derivedAtNow = visible.find((event) => event.event_id === 'derived-at-now');
    expect(derivedAtNow?.provenance.derived_from).toEqual(['past', 'at-now']); // genuinely derived
    const withheld = unwrap(observeWorld(advanced, T0 + 200)).map((event) => event.event_id);
    expect(withheld).not.toContain('derived-after-now');
  });

  it('supports Time-Machine queries (at < now) and rejects at > now', () => {
    const state = loadedHistory();
    const advanced = unwrap(advanceWorld(state, T0 + 201));
    const historical = unwrap(observeWorld(advanced, T0 + 200));
    expect(historical.map((event) => event.event_id)).toEqual(['past', 'at-now', 'derived-at-now']);

    const beyond = observeWorld(advanced, T0 + 202);
    expect(beyond.ok).toBe(false);
    if (beyond.ok) return;
    expect(beyond.errors[0]?.code).toBe('observation_beyond_now');
  });

  it('rejects an invalid instant and preserves arrival order', () => {
    const state = loadedHistory();
    expect(observeWorld(state, Number.NaN).ok).toBe(false);
    const advanced = unwrap(advanceWorld(state, T0 + 201));
    const visible = unwrap(observeWorld(advanced, T0 + 201));
    expect(visible.map((event) => event.event_id)).toEqual(state.history.map((event) => event.event_id));
  });
});

describe('advanceWorld — monotonic, anchored (criterion 6)', () => {
  it('rejects advancing to an earlier instant (clock_regression)', () => {
    const world = freshWorld(); // standing at as_of
    const result = advanceWorld(world, AS_OF - 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('clock_regression');
  });

  it('rejects advancing past asOf (beyond_as_of)', () => {
    const world = freshWorld();
    const result = advanceWorld(world, AS_OF + 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('beyond_as_of');
  });

  it('accepts a no-op advance and the final step to asOf; rejects an invalid target', () => {
    const world = freshWorld();
    expect(advanceWorld(world, AS_OF).ok).toBe(true);
    expect(advanceWorld(world, 1.5).ok).toBe(false);
  });
});

describe('finishWorld', () => {
  it('freezes the world: further ingest/advance fail; observation queries remain legal (audit-side)', () => {
    const world = freshWorld();
    const loaded = unwrap(ingestWorld(world, [eventFixture({ event_id: 't1' })]));
    const finished = unwrap(finishWorld(loaded, { code: 'completed', detail: 'stream exhausted' }));
    expect(finished.status).toBe('finished');
    expect(finished.termination?.code).toBe('completed');

    expect(ingestWorld(finished, [eventFixture({ event_id: 't2', sequence: 2 })]).ok).toBe(false);
    expect(advanceWorld(finished, AS_OF).ok).toBe(false);
    const visible = observeWorld(finished, AS_OF);
    expect(visible.ok).toBe(true);
  });
});
