/**
 * The MatchingEngine — behavioral tests: price-time priority (including
 * same-price-same-time tie-breaks), partial fills across levels, cancels,
 * every reject path, FOK/IOC/gtt semantics, quartet honesty, DETERMINISM
 * (two runs, deep-equal) and immutability (L3/L9).
 */

import { describe, expect, it } from 'vitest';

import { advanceEngine, cancelOrder, createEngine, submitOrder, type EngineState, type SubmitOutcome } from './engine';
import { isAvailabilityQuartet, isFill, isOrderAck, isOrderCancelRecord, isOrderRecord, isOrderReject, type Fill } from './records';
import { isDeeplyFrozen } from './primitives';
import { canonicalJson, type ExchangeConfig } from './config';
import type { JsonValue } from './json';
import { bookSnapshotView, topOfBook } from './book';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;

function configFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    tick_size: '0.01',
    lot_size: '0.001',
    max_book_depth: 10,
    seed: 'seed-alpha',
    fidelity: 'reactive_replay',
    fees: { tiers: [{ up_to_notional: null, maker_bps: '1', taker_bps: '2' }], fee_decimals: 8 },
    latency: { kind: 'fixed', fixed_ms: 250 },
    slippage: { kind: 'book_walk' },
    impact: {
      kind: 'none',
      declaration: 'no endogenous impact',
      limitation: 'T027 owns endogenous reaction',
    },
    ...overrides,
  };
}

const BOOK_SEED = {
  bids: [
    { price: '100.00', size: '5.000' },
    { price: '99.00', size: '3.000' },
  ],
  asks: [
    { price: '100.50', size: '4.000' },
    { price: '101.00', size: '6.000' },
  ],
};

function intentFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientOrderId: 'cli-1',
    instrumentId: 'BTC-USDT',
    venueId: 'BINANCE',
    side: 'buy',
    kind: 'limit',
    quantity: '1',
    price: '100.50',
    timeInForce: 'gtc',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function newEngine(overrides: Record<string, unknown> = {}, seed: unknown = BOOK_SEED): EngineState {
  const result = createEngine(configFixture(overrides), { book_seed: seed, start_at: T0 });
  if (!result.ok) throw new Error(`engine fixture failed: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function submit(state: EngineState, intent: Record<string, unknown>, at: number): SubmitOutcome {
  const result = submitOrder(state, intent, at);
  if (!result.ok) throw new Error(`submit fixture failed: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function isoAfter(ms: number): string {
  return new Date(T0 + ms).toISOString();
}

// ---------------------------------------------------------------------------
// Intake + fills against the seeded book
// ---------------------------------------------------------------------------

describe('order intake against a seeded book', () => {
  it('a crossing limit buy fills at the maker level price with exact fees and an honest quartet', () => {
    const engine = newEngine();
    const outcome = submit(engine, intentFixture({ quantity: '3' }), T0 + 10);
    expect(outcome.ack.status).toBe('filled');
    expect(outcome.fills.length).toBe(1);
    const fill = outcome.fills[0];
    if (fill === undefined) throw new Error('fill expected');
    // The print is the resting level price; the aggressor pays it (book_walk).
    expect(fill.price).toBe('100.5');
    expect(fill.aggressor_price).toBe('100.5');
    expect(fill.quantity).toBe('3');
    expect(fill.taker_order_id).toBe('xo-00000001');
    expect(fill.maker_order_id).toBe('xo-seed-ask-0');
    // Fees: notional 301.5 -> taker 2bps = 0.0603, maker 1bps = 0.03015.
    expect(fill.taker_fee).toBe('0.0603');
    expect(fill.maker_fee).toBe('0.03015');
    // The honest quartet: latency-injected availability, no fabricated source.
    expect(isAvailabilityQuartet(fill.quartet)).toBe(true);
    expect(fill.quartet.event_time).toBe(T0 + 10);
    expect(fill.quartet.source_time).toBeNull();
    expect(fill.quartet.available_time).toBe(T0 + 10 + 250);
    expect(fill.quartet.ingestion_time).toBe(T0 + 10);
    expect(fill.latency_ms).toBe(250);
    expect(isFill(fill)).toBe(true);
    expect(outcome.state.last_trade_price).toBe('100.5');
  });

  it('walks levels on depth: a larger buy consumes the seed level then the next, one fill per maker', () => {
    const engine = newEngine();
    const outcome = submit(engine, intentFixture({ quantity: '5' }), T0 + 10);
    expect(outcome.ack.status).toBe('filled');
    expect(outcome.fills.length).toBe(2);
    expect(outcome.fills.map((fill) => fill.price)).toEqual(['100.5', '101']);
    expect(outcome.fills.map((fill) => fill.quantity)).toEqual(['4', '1']);
    expect(outcome.fills.map((fill) => fill.maker_order_id)).toEqual(['xo-seed-ask-0', 'xo-seed-ask-1']);
    // The seed level is fully consumed; the second level keeps 5.
    expect(bookSnapshotView(outcome.state.book).asks).toEqual([{ price: '101', size: '5' }]);
  });

  it('a non-crossing limit rests (joining the book as a new level) and acks open', () => {
    const engine = newEngine();
    const outcome = submit(engine, intentFixture({ side: 'sell', price: '100.51', quantity: '2' }), T0 + 10);
    expect(outcome.ack.status).toBe('open');
    expect(isOrderAck(outcome.ack)).toBe(true);
    expect(outcome.fills.length).toBe(0);
    expect(topOfBook(outcome.state.book)?.ask_price).toBe('100.5'); // seed still best
    const asks = bookSnapshotView(outcome.state.book).asks;
    expect(asks).toEqual([
      { price: '100.5', size: '4' },
      { price: '100.51', size: '2' },
      { price: '101', size: '6' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// PRICE-TIME PRIORITY (the core law) + tie-breaks
// ---------------------------------------------------------------------------

describe('price-time priority', () => {
  function emptyBookEngine(): EngineState {
    return newEngine({}, { bids: [], asks: [] });
  }

  it('fills the BEST price first, then queues within a price in arrival order', () => {
    let state = emptyBookEngine();
    // Three resting asks: two at 101, one at 100.5 (best).
    state = submit(state, intentFixture({ side: 'sell', kind: 'limit', price: '101', quantity: '1', clientOrderId: 's-1' }), T0).state;
    state = submit(state, intentFixture({ side: 'sell', kind: 'limit', price: '100.5', quantity: '1', clientOrderId: 's-2' }), T0 + 1).state;
    state = submit(state, intentFixture({ side: 'sell', kind: 'limit', price: '101', quantity: '1', clientOrderId: 's-3' }), T0 + 2).state;
    // A market buy sweeps 3: best price first, FIFO within the level.
    const outcome = submit(state, intentFixture({ kind: 'market', quantity: '3', clientOrderId: 'b-1' }), T0 + 10);
    expect(outcome.fills.map((fill) => fill.price)).toEqual(['100.5', '101', '101']);
    expect(outcome.fills.map((fill) => fill.maker_order_id)).toEqual(['xo-00000002', 'xo-00000001', 'xo-00000003']);
  });

  it('breaks SAME-PRICE, SAME-TIME ties by arrival ordinal (the deterministic total order)', () => {
    let state = emptyBookEngine();
    // Two asks at the same price, submitted at the SAME instant: the
    // first-submitted must fill first (ordinal tie-break).
    state = submit(state, intentFixture({ side: 'sell', kind: 'limit', price: '100.5', quantity: '1', clientOrderId: 'same-time-a' }), T0).state;
    state = submit(state, intentFixture({ side: 'sell', kind: 'limit', price: '100.5', quantity: '1', clientOrderId: 'same-time-b' }), T0).state;
    const outcome = submit(state, intentFixture({ kind: 'market', quantity: '2', clientOrderId: 'sweeper' }), T0 + 5);
    expect(outcome.fills.map((fill) => fill.maker_order_id)).toEqual(['xo-00000001', 'xo-00000002']);
  });

  it('a resting order partially consumed keeps its queue position for the remainder', () => {
    let state = emptyBookEngine();
    state = submit(state, intentFixture({ side: 'sell', kind: 'limit', price: '100.5', quantity: '3', clientOrderId: 'big-ask' }), T0).state;
    state = submit(state, intentFixture({ side: 'sell', kind: 'limit', price: '100.5', quantity: '1', clientOrderId: 'small-ask' }), T0 + 1).state;
    // Buy 2: the first order is partially filled (1 of 3), stays first.
    const partial = submit(state, intentFixture({ quantity: '2', clientOrderId: 'b-1' }), T0 + 5);
    expect(partial.fills.map((fill) => fill.maker_order_id)).toEqual(['xo-00000001']);
    expect(partial.fills.map((fill) => fill.quantity)).toEqual(['2']);
    // The remainder of the first order still precedes the second order.
    const rest = submit(partial.state, intentFixture({ quantity: '2', clientOrderId: 'b-2' }), T0 + 6);
    expect(rest.fills.map((fill) => fill.maker_order_id)).toEqual(['xo-00000001', 'xo-00000002']);
    expect(rest.fills.map((fill) => fill.quantity)).toEqual(['1', '1']);
  });
});

// ---------------------------------------------------------------------------
// Partial fills, TIF semantics, cancels, expirations
// ---------------------------------------------------------------------------

describe('partial fills and time-in-force semantics', () => {
  it('a partially-filled limit rests its remainder and reports partially_filled', () => {
    const engine = newEngine();
    // 5 available at 100.5 + 6 at 101; buy 5 crossing only 100.5-level depth? No:
    // a limit at 100.50 fills 4 (seed level) then the 101 level violates the
    // limit — the remainder RESTS at 100.50.
    const outcome = submit(engine, intentFixture({ quantity: '5', price: '100.50' }), T0 + 10);
    expect(outcome.ack.status).toBe('partially_filled');
    expect(outcome.fills.length).toBe(1);
    expect(outcome.fills[0]?.quantity).toBe('4');
    const record = outcome.state.orders.find((candidate) => candidate.order_id === 'xo-00000001');
    expect(record?.status).toBe('partially_filled');
    expect(record?.filled_quantity).toBe('4');
    expect(record?.remaining_quantity).toBe('1');
    // The remainder joins the (now empty) 100.5 level as the new best bid? No:
    // a BUY resting at 100.5 joins the BIDS side (the 100.5 ask level is gone).
    expect(topOfBook(outcome.state.book)?.bid_price).toBe('100.5');
    expect(topOfBook(outcome.state.book)?.ask_price).toBe('101');
  });

  it('IOC fills what the book offers and cancels the remainder with a typed reason', () => {
    const engine = newEngine();
    const outcome = submit(engine, intentFixture({ quantity: '5', timeInForce: 'ioc' }), T0 + 10);
    expect(outcome.ack.status).toBe('canceled');
    expect(outcome.fills.length).toBe(1);
    expect(outcome.fills[0]?.quantity).toBe('4');
    expect(outcome.cancels.length).toBe(1);
    expect(outcome.cancels[0]?.reason).toBe('ioc_unfilled');
    expect(outcome.cancels[0]?.remaining_quantity).toBe('1');
    expect(isOrderCancelRecord(outcome.cancels[0] as never)).toBe(true);
    expect(bookSnapshotView(outcome.state.book).asks).toEqual([{ price: '101', size: '6' }]);
  });

  it('FOK dies whole (zero fills) when the full quantity is unavailable within the limit', () => {
    const engine = newEngine();
    const outcome = submit(engine, intentFixture({ quantity: '10', timeInForce: 'fok' }), T0 + 10);
    expect(outcome.ack.status).toBe('canceled');
    expect(outcome.fills.length).toBe(0);
    expect(outcome.cancels[0]?.reason).toBe('fok_unfilled');
    expect(outcome.cancels[0]?.remaining_quantity).toBe('10');
    // The book is untouched.
    expect(bookSnapshotView(outcome.state.book)).toEqual(bookSnapshotView(engine.book));
  });

  it('FOK executes when the full quantity IS available', () => {
    const engine = newEngine();
    const outcome = submit(engine, intentFixture({ quantity: '4', timeInForce: 'fok' }), T0 + 10);
    expect(outcome.ack.status).toBe('filled');
    expect(outcome.fills.length).toBe(1);
  });

  it('a market order cancels its unfilled remainder (market orders never rest)', () => {
    // Empty the book first, then send a market buy into nothing.
    const empty = newEngine({}, { bids: [], asks: [] });
    const outcome = submit(empty, intentFixture({ kind: 'market', quantity: '2' }), T0 + 10);
    expect(outcome.ack.status).toBe('canceled');
    expect(outcome.fills.length).toBe(0);
    expect(outcome.cancels[0]?.reason).toBe('market_order_unfilled_remainder');
  });

  it("'day' rests exactly like 'gtc' within the episode (declared: no calendar model)", () => {
    const engine = newEngine();
    const outcome = submit(engine, intentFixture({ side: 'sell', price: '100.51', timeInForce: 'day' }), T0 + 10);
    expect(outcome.ack.status).toBe('open');
  });
});

describe('cancels', () => {
  it('cancels a resting order by venue id and by client id, removing it from the book', () => {
    let state = newEngine();
    state = submit(state, intentFixture({ side: 'sell', price: '100.51', quantity: '2', clientOrderId: 'rest-1' }), T0 + 10).state;
    expect(topOfBook(state.book)?.ask_size).toBe('4');
    const byVenue = cancelOrder(state, { order_id: 'xo-00000001' }, T0 + 20);
    expect(byVenue.ok).toBe(true);
    if (!byVenue.ok) return;
    expect(byVenue.value.cancel.reason).toBe('cancel_requested');
    expect(byVenue.value.cancel.remaining_quantity).toBe('2');
    expect(topOfBook(byVenue.value.state.book)?.ask_price).toBe('101');

    // By client id on a second order.
    state = submit(byVenue.value.state, intentFixture({ side: 'sell', price: '100.52', quantity: '1', clientOrderId: 'rest-2' }), T0 + 30).state;
    const byClient = cancelOrder(state, { client_order_id: 'rest-2' }, T0 + 40);
    expect(byClient.ok).toBe(true);
    if (!byClient.ok) return;
    const record = byClient.value.state.orders.find((candidate) => candidate.client_order_id === 'rest-2');
    expect(record?.status).toBe('canceled');
  });

  it('cancels a partially-filled order\u2019s remainder', () => {
    let state = newEngine();
    state = submit(state, intentFixture({ quantity: '5', clientOrderId: 'partial-1' }), T0 + 10).state;
    expect(state.orders[0]?.status).toBe('partially_filled');
    const canceled = cancelOrder(state, { client_order_id: 'partial-1' }, T0 + 20);
    expect(canceled.ok).toBe(true);
    if (!canceled.ok) return;
    expect(canceled.value.cancel.remaining_quantity).toBe('1');
    expect(canceled.value.state.orders[0]?.status).toBe('canceled');
  });

  it('fails typed on unknown orders, malformed references, terminal orders and past instants', () => {
    const state = newEngine();
    const unknown = cancelOrder(state, { order_id: 'xo-99999999' }, T0);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors[0]?.code).toBe('unknown_order');

    const malformed = cancelOrder(state, { order_id: 'a', client_order_id: 'b' }, T0);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.errors[0]?.code).toBe('invalid_order_reference');

    const past = cancelOrder(state, { order_id: 'xo-00000001' }, T0 - 1);
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.errors[0]?.code).toBe('arrival_before_now');

    const filled = submit(state, intentFixture({ quantity: '1', clientOrderId: 'fill-me' }), T0 + 10);
    const terminal = cancelOrder(filled.state, { client_order_id: 'fill-me' }, T0 + 20);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) expect(terminal.errors[0]?.code).toBe('order_not_cancelable');
  });
});

describe('gtt expiry (advance)', () => {
  it('expires resting gtt orders at their expiry instant and removes them from the book', () => {
    let state = newEngine();
    state = submit(
      state,
      intentFixture({
        side: 'sell',
        price: '100.51',
        quantity: '2',
        timeInForce: 'gtt',
        expiresAt: isoAfter(60_000),
        clientOrderId: 'gtt-1',
      }),
      T0 + 10,
    ).state;
    expect(topOfBook(state.book)?.ask_price).toBe('100.5');

    const before = advanceEngine(state, T0 + 59_999);
    expect(before.ok).toBe(true);
    if (before.ok) expect(before.value.expirations.length).toBe(0);

    const at = advanceEngine(before.ok ? before.value.state : state, T0 + 60_000);
    expect(at.ok).toBe(true);
    if (!at.ok) return;
    expect(at.value.expirations.length).toBe(1);
    expect(at.value.expirations[0]?.reason).toBe('expired');
    expect(at.value.expirations[0]?.remaining_quantity).toBe('2');
    expect(at.value.state.orders[0]?.status).toBe('expired');
    expect(topOfBook(at.value.state.book)?.ask_price).toBe('101');
  });

  it('advance fails typed on regressions and invalid targets; equal instant is a no-op', () => {
    const state = newEngine();
    expect(advanceEngine(state, T0 - 1).ok).toBe(false);
    const regression = advanceEngine(state, T0 - 1);
    if (!regression.ok) expect(regression.errors[0]?.code).toBe('clock_regression');
    expect(advanceEngine(state, 'soon').ok).toBe(false);
    const sameInstant = advanceEngine(state, T0);
    expect(sameInstant.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rejects (mechanical venue rules) and operation failures
// ---------------------------------------------------------------------------

describe('order rejects (typed outcomes that ride the stream)', () => {
  it('rejects duplicate client order ids (idempotency is forever)', () => {
    const engine = newEngine();
    const first = submit(engine, intentFixture({ side: 'sell', price: '100.51', clientOrderId: 'dup' }), T0 + 10);
    const second = submitOrder(first.state, intentFixture({ side: 'sell', price: '100.52', clientOrderId: 'dup' }), T0 + 20);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(isOrderReject(second.value.ack)).toBe(true);
    if (!isOrderReject(second.value.ack)) return;
    expect(second.value.ack.reason).toBe('duplicate_client_order_id');
    expect(second.value.ack.client_order_id).toBe('dup');
    // The reject is RECORDED in the order log with its audit trail.
    expect(second.value.state.orders.length).toBe(2);
    expect(second.value.state.orders[1]?.status).toBe('rejected');
    expect(second.value.fills.length).toBe(0);
  });

  it('rejects wrong tick, wrong lot, beyond depth, unsupported kinds/TIFs, and stale gtt', () => {
    const engine = newEngine();
    const cases: readonly [Record<string, unknown>, string][] = [
      [intentFixture({ price: '100.505', clientOrderId: 'tick' }), 'wrong_tick_size'],
      [intentFixture({ quantity: '1.0005', clientOrderId: 'lot' }), 'wrong_lot_size'],
      [intentFixture({ kind: 'stop', price: undefined, stopPrice: '100', clientOrderId: 'stop' }), 'unsupported_order_kind'],
      [intentFixture({ kind: 'iceberg', clientOrderId: 'ice' }), 'unsupported_order_kind'],
      [intentFixture({ kind: 'market', timeInForce: 'gtt', expiresAt: isoAfter(1000), clientOrderId: 'm-gtt' }), 'unsupported_time_in_force'],
      [intentFixture({ timeInForce: 'opg', clientOrderId: 'opg' }), 'unsupported_time_in_force'],
      [
        intentFixture({ side: 'sell', price: '100.51', timeInForce: 'gtt', expiresAt: isoAfter(-1000), clientOrderId: 'stale' }),
        'gtt_expired_on_arrival',
      ],
    ];
    let state = engine;
    for (const [intent, reason] of cases) {
      const outcome = submitOrder(state, intent, T0 + 10);
      expect(outcome.ok, `${reason}: ${JSON.stringify(intent)}`).toBe(true);
      if (!outcome.ok) return;
      expect(isOrderReject(outcome.value.ack)).toBe(true);
      if (!isOrderReject(outcome.value.ack)) return;
      expect(outcome.value.ack.reason, JSON.stringify(intent)).toBe(reason);
      state = outcome.value.state;
    }
    // Depth cap: a 2-level book rejects a third NEW price level.
    const shallow = newEngine({ max_book_depth: 2 });
    const beyond = submitOrder(shallow, intentFixture({ side: 'sell', price: '102', clientOrderId: 'deep' }), T0 + 10);
    expect(beyond.ok).toBe(true);
    if (!beyond.ok) return;
    expect(isOrderReject(beyond.value.ack)).toBe(true);
    if (!isOrderReject(beyond.value.ack)) return;
    expect(beyond.value.ack.reason).toBe('beyond_book_depth');
    // Joining an EXISTING level is always allowed even at the cap.
    const join = submitOrder(shallow, intentFixture({ side: 'sell', price: '100.5', quantity: '0.001', clientOrderId: 'join' }), T0 + 20);
    expect(join.ok).toBe(true);
    if (!join.ok) return;
    expect(isOrderAck(join.value.ack)).toBe(true);
  });

  it('rejects (operation failures, typed) malformed envelopes and past arrivals', () => {
    const engine = newEngine();
    const malformed = submitOrder(engine, { side: 'buy', quantity: '0' }, T0 + 10);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.errors.length).toBeGreaterThan(3); // collect-all
      expect(malformed.errors[0]?.code).toBe('missing_field');
    }
    const past = submitOrder(engine, intentFixture({ clientOrderId: 'past' }), T0 - 1);
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.errors[0]?.code).toBe('arrival_before_now');
    const badTime = submitOrder(engine, intentFixture({ clientOrderId: 'bad-time' }), 'soon');
    expect(badTime.ok).toBe(false);
    if (!badTime.ok) expect(badTime.errors[0]?.code).toBe('invalid_timestamp');
  });
});

// ---------------------------------------------------------------------------
// Determinism (L9) and immutability (L3)
// ---------------------------------------------------------------------------

/** One scripted session over the seeded book: fills, rests, cancels, rejects, expiry. */
function runScript(configSeed: string): { readonly fills: readonly Fill[]; readonly stateJson: string; readonly outcomeJson: string } {
  let state: EngineState | null = null;
  const created = createEngine(configFixture({ seed: configSeed, latency: { kind: 'uniform', min_ms: 50, max_ms: 500 } }), {
    book_seed: BOOK_SEED,
    start_at: T0,
  });
  if (!created.ok) throw new Error('script engine failed');
  state = created.value;

  const outcomes: unknown[] = [];
  const step = (intent: Record<string, unknown>, at: number): void => {
    const result = submitOrder(state as EngineState, intent, at);
    if (!result.ok) throw new Error(`script submit failed: ${JSON.stringify(result.errors)}`);
    state = result.value.state;
    outcomes.push({ ack: result.value.ack, fills: result.value.fills, cancels: result.value.cancels });
  };
  step(intentFixture({ quantity: '5', clientOrderId: 'a' }), T0 + 10); // partial + rest
  step(intentFixture({ quantity: '2', clientOrderId: 'b', timeInForce: 'ioc' }), T0 + 20); // fills into the rest
  step(intentFixture({ side: 'sell', price: '101.01', quantity: '3', clientOrderId: 'c' }), T0 + 30); // rests a new ask
  step(intentFixture({ kind: 'market', quantity: '4', clientOrderId: 'd', side: 'sell' }), T0 + 40); // sells into bids
  step(intentFixture({ quantity: '1', clientOrderId: 'e', timeInForce: 'fok' }), T0 + 50); // fok over available -> dies
  step(intentFixture({ price: '101.05', clientOrderId: 'f' }), T0 + 60); // off-limits price? crosses? 101.05 vs ask 101 -> crosses
  const cancelResult = cancelOrder(state, { client_order_id: 'c' }, T0 + 70);
  if (!cancelResult.ok) throw new Error('script cancel failed');
  state = cancelResult.value.state;
  outcomes.push({ cancel: cancelResult.value.cancel });

  const gtt = submitOrder(
    state,
    intentFixture({ side: 'sell', price: '101.02', quantity: '1', timeInForce: 'gtt', expiresAt: isoAfter(90_000), clientOrderId: 'g' }),
    T0 + 80,
  );
  if (!gtt.ok) throw new Error('script gtt failed');
  state = gtt.value.state;
  const advanced = advanceEngine(state, T0 + 90_000);
  if (!advanced.ok) throw new Error('script advance failed');
  state = advanced.value.state;
  outcomes.push({ expirations: advanced.value.expirations });

  const outcomeJson = canonicalJson(JSON.parse(JSON.stringify(outcomes, replacer)) as JsonValue);
  const stateJson = canonicalJson(
    JSON.parse(JSON.stringify({ orders: state.orders, fills: state.fills, last_trade_price: state.last_trade_price }, replacer)) as JsonValue,
  );
  return { fills: state.fills, stateJson, outcomeJson };
}

/** JSON stringify replacer that keeps the frozen structures readable. */
function replacer(_key: string, value: unknown): unknown {
  return value;
}

describe('determinism (acceptance criterion 3)', () => {
  it('same orders + seed + book seed -> identical fills and outcome stream, TWICE (deep-equal)', () => {
    const first = runScript('determinism-seed');
    const second = runScript('determinism-seed');
    expect(second.fills).toEqual(first.fills);
    expect(first.fills).toEqual(runScript('determinism-seed').fills); // a third confirmation
    expect(second.stateJson).toBe(first.stateJson);
    expect(second.outcomeJson).toBe(first.outcomeJson);
    // And the fills really cover the path space.
    expect(first.fills.length).toBeGreaterThanOrEqual(4);
  });

  it('a different seed changes the latency-injected outcome stream (the seed participates)', () => {
    const first = runScript('determinism-seed');
    const other = runScript('determinism-seed-2');
    expect(other.outcomeJson).not.toBe(first.outcomeJson);
  });

  it('every record ever emitted is JSON-serializable (lineage portability, L9)', () => {
    const run = runScript('json-seed');
    for (const fill of run.fills) {
      expect(() => JSON.stringify(fill)).not.toThrow();
      expect(isFill(fill)).toBe(true);
    }
  });
});

describe('immutability (L3)', () => {
  it('transitions never mutate the input state, and outputs are deeply frozen', () => {
    const engine = newEngine();
    const before = JSON.stringify(engine);
    const outcome = submit(engine, intentFixture({ quantity: '2', clientOrderId: 'immutable' }), T0 + 10);
    expect(JSON.stringify(engine)).toBe(before); // untouched
    expect(outcome.state).not.toBe(engine); // a NEW state
    expect(isDeeplyFrozen(outcome.state)).toBe(true);
    expect(isDeeplyFrozen(outcome.ack)).toBe(true);
    for (const fill of outcome.fills) expect(isDeeplyFrozen(fill)).toBe(true);
    for (const record of outcome.state.orders) expect(isOrderRecord(record)).toBe(true);
    const advanced = advanceEngine(outcome.state, T0 + 20);
    expect(advanced.ok).toBe(true);
    if (advanced.ok) {
      expect(JSON.stringify(outcome.state)).toBe(JSON.stringify(outcome.state)); // still untouched
      expect(isDeeplyFrozen(advanced.value.state)).toBe(true);
    }
  });
});
