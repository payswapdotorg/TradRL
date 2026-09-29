/**
 * @tradrl/adapter-binance — the adapter session tests.
 *
 * Behavioral: the full lifecycle over every documented channel; every
 * typed error path the work order names (use-after-close, double-close,
 * subscribe-before-open, unknown channel, unmapped field, unknown message
 * type, malformed payload, update-id regression and gap, snapshot
 * lastUpdateId regression, entitlement refusal); the two-sided diff
 * split through the session; the unmangled request pass-through; the
 * sequence discipline; and byte-determinism (the same script -> the same
 * stream, twice).
 *
 * All tests run over the REAL SDK's scripted fake transport (test-only
 * relative import — the repo's established pattern; the package sources
 * import nothing).
 */

import { describe, expect, it } from 'vitest';

import {
  createBinanceAdapterSession,
  createBinanceSessionWithoutEntitlement,
  createAdapterSession,
  binanceSubscription,
  createBinanceGuardTransport,
  BINANCE_ENTITLEMENT,
  BINANCE_SOURCE_DESCRIPTOR,
  BINANCE_ADAPTER,
  BINANCE_MAPPING_TABLES,
  isProtocolError,
  type AdapterSession,
  type EmittedEvent,
  type SdkResult,
} from './index';
import { binanceProtocolCodeOf } from './index';

import {
  createFakeTransport,
  type FakeTransport,
  type JsonObject,
  type TransportScript,
  type TimestampMs,
} from '../../../packages/provider-sdk/src/index';

const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = 1_717_423_200_000;

const validTrade = (t: number, id: number) => ({
  e: 'trade',
  E: AT0 + t,
  s: 'BTCUSDT',
  t: id,
  p: '43125.10000000',
  q: '0.01700000',
  T: AT0 + t,
  m: false,
});

const validDepthDiff = (U: number, u: number) => ({
  e: 'depthUpdate',
  E: AT0 + 100,
  s: 'BTCUSDT',
  U,
  u,
  b: [
    ['43125.20000000', '1.10000000'],
    ['43124.10000000', '0.00000000'],
  ],
  a: [['43126.30000000', '0.50000000']],
});

const validPartialDepth = (lastUpdateId: number) => ({
  lastUpdateId,
  bids: [['43125.20000000', '1.10000000']],
  asks: [['43126.30000000', '0.50000000']],
});

const validBookTicker = (u: number) => ({
  u,
  s: 'BTCUSDT',
  b: '43125.10000000',
  B: '31.21000000',
  a: '43125.36520000',
  A: '40.66000000',
});

function script(inbound: readonly { at: number; channel: string; payload: JsonObject }[]): TransportScript {
  return {
    inbound: inbound.map((entry) => ({ at: ms(entry.at), channel: entry.channel, payload: entry.payload })),
    recv_failures: [],
    send_failures: [],
    receive_timeout_ms: null,
  };
}

function transportFor(transportScript: TransportScript): FakeTransport {
  const construction = createFakeTransport(transportScript);
  if (!construction.ok) throw new Error(`script must validate: ${JSON.stringify(construction.errors)}`);
  return construction.transport;
}

function sessionOver(transportScript: TransportScript, withEntitlement = true): AdapterSession {
  const construction = withEntitlement
    ? createBinanceAdapterSession({ transport: transportFor(transportScript), entitlement: BINANCE_ENTITLEMENT })
    : createBinanceSessionWithoutEntitlement(transportFor(transportScript));
  if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
  return construction.session;
}

function subscribe(session: AdapterSession, channel: 'depth' | 'depthDiff' | 'bookTicker' | 'trade', requestId: number): void {
  const spec = binanceSubscription({ channel, instrument: 'BTC-USDT', request_id: requestId });
  if (!spec.ok) throw new Error(`subscription must build: ${spec.error.message}`);
  const sent = session.subscribe(spec.value);
  if (!sent.ok) throw new Error(`subscribe must succeed: ${sent.error.message}`);
}

function drain(session: AdapterSession): { events: EmittedEvent[]; terminal: SdkResult<EmittedEvent | null> } {
  const events: EmittedEvent[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok || next.value === null) {
      return { events, terminal: next };
    }
    events.push(next.value);
  }
}

describe('the happy path across every documented channel', () => {
  it('open -> subscribe* -> drain -> close over a mixed scripted timeline', () => {
    const transportScript = script([
      { at: AT0, channel: 'trade', payload: validTrade(0, 100234) },
      { at: AT0 + 10, channel: 'bookTicker', payload: validBookTicker(400900217) },
      { at: AT0 + 20, channel: 'depthDiff', payload: validDepthDiff(157, 160) },
      { at: AT0 + 30, channel: 'depth', payload: validPartialDepth(160) },
      { at: AT0 + 40, channel: 'trade', payload: validTrade(40, 100235) },
    ]);
    const session = sessionOver(transportScript);
    expect(session.open().ok).toBe(true);
    subscribe(session, 'trade', 1);
    subscribe(session, 'bookTicker', 2);
    subscribe(session, 'depthDiff', 3);
    subscribe(session, 'depth', 4);
    expect(session.state()).toBe('subscribed');

    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    if (terminal.ok) expect(terminal.value).toBeNull();
    // trade, quote, TWO book_deltas (the split), book_snapshot, trade.
    expect(events.length).toBe(6);
    const types = events.map((event) => (event as unknown as { event_type: string }).event_type);
    expect(types).toEqual(['trade', 'quote', 'book_delta', 'book_delta', 'book_snapshot', 'trade']);
    expect(session.lastMessageAt()).toBe(AT0 + 40);
    expect(session.close().ok).toBe(true);
    expect(session.state()).toBe('closed');
  });

  it('the split emits update-then-remove book_deltas with update-id continuity', () => {
    const transportScript = script([{ at: AT0, channel: 'depthDiff', payload: validDepthDiff(157, 160) }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'depthDiff', 1);
    const { events } = drain(session);
    expect(events.length).toBe(2);
    const [update, remove] = events as unknown as [{ payload: Record<string, unknown> }, { payload: Record<string, unknown> }];
    expect(update.payload.action).toBe('update');
    expect(update.payload.last_update_id).toBe('160');
    expect(remove.payload.action).toBe('remove');
    expect(remove.payload.last_update_id).toBe('160');
    expect((update as unknown as { sequence: number }).sequence).toBe(1);
    expect((remove as unknown as { sequence: number }).sequence).toBe(2);
  });

  it('an empty documented diff emits nothing (heartbeat-style updates are silent, by declaration)', () => {
    const emptyDiff = { ...validDepthDiff(157, 160), b: [], a: [] };
    const transportScript = script([
      { at: AT0, channel: 'depthDiff', payload: emptyDiff },
      { at: AT0 + 10, channel: 'trade', payload: validTrade(10, 100234) },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'depthDiff', 1);
    subscribe(session, 'trade', 2);
    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    expect(events.length).toBe(1); // only the trade
    expect((events[0] as unknown as { event_type: string }).event_type).toBe('trade');
  });

  it('every emitted event carries the quartet, provenance, entitlement ref and mapping ref', () => {
    const transportScript = script([{ at: AT0, channel: 'trade', payload: validTrade(0, 100234) }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'trade', 1);
    const { events } = drain(session);
    expect(events.length).toBe(1);
    const event = events[0] as unknown as Record<string, unknown>;
    expect(typeof event.event_time).toBe('number');
    expect(typeof event.available_time).toBe('number');
    expect(typeof event.ingestion_time).toBe('number');
    expect((event.available_time as number) >= (event.event_time as number)).toBe(true);
    const provenance = event.provenance as Record<string, unknown>;
    expect(provenance.origin).toBe('historical');
    expect((provenance.adapter as Record<string, unknown>).id).toBe('adapter-binance');
    const entitlement = event.entitlement as Record<string, unknown>;
    expect(entitlement.entitlement_id).toBe('ent-binance-spot-public');
    expect((event.mapping as Record<string, unknown>).table_id).toBe('binance-trade');
    expect(event.provider).toBe('binance');
    expect(event.venue).toBe('BINANCE');
    expect(event.instrument).toBe('BTC-USDT');
  });

  it('onEvent/pump deliver every event and abort on the first typed failure', () => {
    const transportScript = script([
      { at: AT0, channel: 'trade', payload: validTrade(0, 100234) },
      { at: AT0 + 10, channel: 'trade', payload: validTrade(10, 100235) },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'trade', 1);
    const seen: unknown[] = [];
    session.onEvent((event) => seen.push(event));
    const pumped = session.pump();
    expect(pumped.ok).toBe(true);
    if (pumped.ok) expect(pumped.value).toBe(2);
    expect(seen.length).toBe(2);

    // A failing script aborts the pump with the typed failure.
    const failingScript = script([
      { at: AT0, channel: 'trade', payload: validTrade(0, 100234) },
      { at: AT0 + 10, channel: 'trade', payload: { ...validTrade(10, 100235), vendor_extra: 1 } },
    ]);
    const failingSession = sessionOver(failingScript);
    failingSession.open();
    subscribe(failingSession, 'trade', 1);
    const aborted = failingSession.pump();
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) expect(aborted.error.code).toBe('unmapped_raw_field');
  });
});

describe('the request pass-through (the neutrality contract)', () => {
  it('the documented SUBSCRIBE frame crosses the transport unmangled', () => {
    const transportScript = script([{ at: AT0, channel: 'trade', payload: validTrade(0, 100234) }]);
    const transport = transportFor(transportScript);
    const construction = createBinanceAdapterSession({ transport, entitlement: BINANCE_ENTITLEMENT });
    if (!construction.ok) throw new Error('must construct');
    const session = construction.session;
    session.open();
    subscribe(session, 'trade', 42);
    const sent = transport.sent();
    expect(sent.length).toBe(1);
    expect(sent[0].channel).toBe('trade');
    expect({ ...sent[0].payload }).toEqual({
      method: 'SUBSCRIBE',
      params: ['btcusdt@trade'],
      id: 42,
    });
  });

  it('the guard transport passes send failures through typed', () => {
    const transportScript: TransportScript = {
      inbound: [],
      recv_failures: [],
      send_failures: [{ on_send_index: 0, message: 'connection refused' }],
      receive_timeout_ms: null,
    };
    const session = sessionOver(transportScript);
    session.open();
    const spec = binanceSubscription({ channel: 'trade', instrument: 'BTC-USDT', request_id: 1 });
    if (!spec.ok) throw new Error('must build');
    const result = session.subscribe(spec.value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('transport');
      expect(result.error.code).toBe('transport_send_failed');
    }
  });
});

describe('lifecycle typed errors', () => {
  it('subscribe before open is a typed invalid_transition', () => {
    const session = sessionOver(script([]));
    const spec = binanceSubscription({ channel: 'trade', instrument: 'BTC-USDT', request_id: 1 });
    if (!spec.ok) throw new Error('must build');
    const result = session.subscribe(spec.value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isProtocolError(result.error)).toBe(true);
      expect(result.error.code).toBe('invalid_transition');
    }
  });

  it('double close is a typed double_close', () => {
    const session = sessionOver(script([]));
    expect(session.open().ok).toBe(true);
    expect(session.close().ok).toBe(true);
    const result = session.close();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isProtocolError(result.error)).toBe(true);
      expect(result.error.code).toBe('double_close');
    }
  });

  it('use-after-close is a typed use_after_close (nextEvent AND subscribe)', () => {
    const session = sessionOver(script([]));
    session.open();
    session.close();
    const next = session.nextEvent();
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.error.code).toBe('use_after_close');
    const spec = binanceSubscription({ channel: 'trade', instrument: 'BTC-USDT', request_id: 1 });
    if (!spec.ok) throw new Error('must build');
    const subscribed = session.subscribe(spec.value);
    expect(subscribed.ok).toBe(false);
    if (!subscribed.ok) expect(subscribed.error.code).toBe('use_after_close');
  });

  it('duplicate subscription on one channel is typed', () => {
    const session = sessionOver(script([]));
    session.open();
    subscribe(session, 'trade', 1);
    const spec = binanceSubscription({ channel: 'trade', instrument: 'BTC-USDT', request_id: 2 });
    if (!spec.ok) throw new Error('must build');
    const result = session.subscribe(spec.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('duplicate_subscription');
  });

  it('a subscription outside the declared envelope is typed (undeclared channel / instrument)', () => {
    const session = sessionOver(script([]));
    session.open();
    const badChannel = session.subscribe({
      channel: 'kline',
      request: { method: 'SUBSCRIBE', params: ['btcusdt@kline_1m'], id: 1 },
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      mapping_table_id: 'binance-trade',
    });
    expect(badChannel.ok).toBe(false);
    if (!badChannel.ok) expect(badChannel.error.code).toBe('invalid_configuration');

    const badInstrument = session.subscribe({
      channel: 'trade',
      request: { method: 'SUBSCRIBE', params: ['dogeusdt@trade'], id: 2 },
      venue: 'BINANCE',
      instrument: 'DOGE-USDT',
      asset_class: 'crypto',
      mapping_table_id: 'binance-trade',
    });
    expect(badInstrument.ok).toBe(false);
    if (!badInstrument.ok) expect(badInstrument.error.code).toBe('invalid_configuration');
  });

  it('a message on an unsubscribed channel is a typed unknown_channel', () => {
    const transportScript = script([{ at: AT0, channel: 'bookTicker', payload: validBookTicker(1) }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'trade', 1); // bookTicker is NOT subscribed
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) expect(terminal.error.code).toBe('unknown_channel');
  });
});

describe('provider protocol typed errors (the documented stream laws)', () => {
  it('a depth-diff update-id regression is typed (u does not advance)', () => {
    // The second message is SHAPE-valid (U <= u) but its final id does not
    // advance past the previous message's — a documented regression.
    const transportScript = script([
      { at: AT0, channel: 'depthDiff', payload: validDepthDiff(157, 160) },
      { at: AT0 + 100, channel: 'depthDiff', payload: validDepthDiff(158, 160) },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'depthDiff', 1);
    const { events, terminal } = drain(session);
    expect(events.length).toBe(2); // the first diff split fine
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(binanceProtocolCodeOf(terminal.error)).toBe('update_id_regression');
      expect(terminal.error.message).toContain('160');
    }
  });

  it('a depth-diff update-id gap is typed (U is not the successor of the previous u)', () => {
    const transportScript = script([
      { at: AT0, channel: 'depthDiff', payload: validDepthDiff(157, 160) },
      { at: AT0 + 100, channel: 'depthDiff', payload: validDepthDiff(200, 205) }, // gap
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'depthDiff', 1);
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(binanceProtocolCodeOf(terminal.error)).toBe('update_id_gap');
      expect(terminal.error.message).toContain('200');
    }
  });

  it('a partial-depth lastUpdateId regression is typed', () => {
    const transportScript = script([
      { at: AT0, channel: 'depth', payload: validPartialDepth(160) },
      { at: AT0 + 100, channel: 'depth', payload: validPartialDepth(159) }, // regressed
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'depth', 1);
    const { events, terminal } = drain(session);
    expect(events.length).toBe(1);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(binanceProtocolCodeOf(terminal.error)).toBe('update_id_regression_snapshot');
    }
  });

  it('equal partial-depth lastUpdateId is NOT a regression (a quiet book is legitimate)', () => {
    const transportScript = script([
      { at: AT0, channel: 'depth', payload: validPartialDepth(160) },
      { at: AT0 + 100, channel: 'depth', payload: validPartialDepth(160) },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'depth', 1);
    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    expect(events.length).toBe(2);
  });

  it('an unknown message type is a typed protocol error (criterion 6)', () => {
    const transportScript = script([{ at: AT0, channel: 'trade', payload: { ...validTrade(0, 1), e: 'aggTrade' } }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'trade', 1);
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(binanceProtocolCodeOf(terminal.error)).toBe('unknown_message_type');
      expect(terminal.error.message).toContain('aggTrade');
    }
  });

  it('a malformed documented payload is a typed protocol error', () => {
    const transportScript = script([{ at: AT0, channel: 'trade', payload: { ...validTrade(0, 1), p: 'free' } }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'trade', 1);
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(binanceProtocolCodeOf(terminal.error)).toBe('malformed_payload');
      expect(terminal.error.message).toContain('"p"');
    }
  });

  it('an unmapped raw field through the session is a typed MappingError (the contract case)', () => {
    const transportScript = script([
      { at: AT0, channel: 'trade', payload: { ...validTrade(0, 1), vendor_extra: 'surprise' } },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'trade', 1);
    const { events, terminal } = drain(session);
    expect(events.length).toBe(0);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(terminal.error.kind).toBe('mapping');
      expect(terminal.error.code).toBe('unmapped_raw_field');
    }
  });

  it('a documented-but-unknown field on a depth payload is a typed MappingError', () => {
    const transportScript = script([{ at: AT0, channel: 'depth', payload: { ...validPartialDepth(160), pu: 156 } }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'depth', 1);
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(terminal.error.kind).toBe('mapping');
      expect(terminal.error.code).toBe('unmapped_raw_field');
      expect(terminal.error.message).toContain('pu');
    }
  });
});

describe('entitlement (the licensing law)', () => {
  it('emission without the declared entitlement is a typed EntitlementError and emits nothing', () => {
    const transportScript = script([{ at: AT0, channel: 'trade', payload: validTrade(0, 100234) }]);
    const session = sessionOver(transportScript, false);
    session.open();
    subscribe(session, 'trade', 1);
    const { events, terminal } = drain(session);
    expect(events.length).toBe(0);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(terminal.error.kind).toBe('entitlement');
      expect(terminal.error.code).toBe('entitlement_undeclared');
    }
  });

  it('a bad entitlement in the config is rejected at construction (collect-all)', () => {
    const construction = createBinanceAdapterSession({ transport: transportFor(script([])), entitlement: { nope: 1 } });
    expect(construction.ok).toBe(false);
    if (!construction.ok) expect(construction.errors.length).toBeGreaterThan(0);
  });
});

describe('determinism (criterion 3: byte-identical, twice)', () => {
  const mixedScript = script([
    { at: AT0, channel: 'trade', payload: validTrade(0, 100234) },
    { at: AT0 + 10, channel: 'bookTicker', payload: validBookTicker(400900217) },
    { at: AT0 + 20, channel: 'depthDiff', payload: validDepthDiff(157, 160) },
    { at: AT0 + 30, channel: 'depthDiff', payload: validDepthDiff(161, 170) },
    { at: AT0 + 40, channel: 'depth', payload: validPartialDepth(170) },
    { at: AT0 + 50, channel: 'trade', payload: { ...validTrade(50, 100235), m: true } },
  ]);

  it('the same scripted timeline emits a byte-identical canonical stream (deep-equal + JSON-identical)', () => {
    const first = runMixed();
    const second = runMixed();
    expect(first.length).toBe(second.length);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toEqual(second);

    function runMixed(): unknown[] {
      const session = sessionOver(mixedScript);
      session.open();
      subscribe(session, 'trade', 1);
      subscribe(session, 'bookTicker', 2);
      subscribe(session, 'depthDiff', 3);
      subscribe(session, 'depth', 4);
      const { events, terminal } = drain(session);
      if (!terminal.ok || terminal.value !== null) throw new Error('must drain cleanly');
      return events;
    }
  });

  it('sequence trackers are pure functions of the consumed timeline (guard introspection)', () => {
    // A dedicated book-only script (every channel subscribed), so the pump
    // drains to completion and the trackers observe the full timeline.
    const bookScript = script([
      { at: AT0, channel: 'depthDiff', payload: validDepthDiff(157, 160) },
      { at: AT0 + 100, channel: 'depthDiff', payload: validDepthDiff(161, 170) },
      { at: AT0 + 200, channel: 'depth', payload: validPartialDepth(170) },
    ]);
    // Introspection needs the guard handle, so mirror the session factory's
    // exact construction (guard over the raw port, engine over the guard).
    const guard = createBinanceGuardTransport(transportFor(bookScript));
    const sessionConstruction = createAdapterSession({
      descriptor: BINANCE_SOURCE_DESCRIPTOR,
      adapter: BINANCE_ADAPTER,
      transport: guard,
      mapping_tables: BINANCE_MAPPING_TABLES,
      entitlement: BINANCE_ENTITLEMENT,
    });
    if (!sessionConstruction.ok) throw new Error('must construct');
    const session = sessionConstruction.session;
    session.open();
    subscribe(session, 'depthDiff', 1);
    subscribe(session, 'depth', 2);
    const pumped = session.pump();
    expect(pumped.ok).toBe(true);
    if (pumped.ok) expect(pumped.value).toBe(5); // two diffs x (update+remove) + one snapshot
    const trackers = guard.sequenceTrackers();
    expect(trackers['depthDiff|BTCUSDT']).toBe(170);
    expect(trackers['depth']).toBe(170);
  });
});
