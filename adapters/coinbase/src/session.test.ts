/**
 * @tradrl/adapter-coinbase — the adapter session tests.
 *
 * Behavioral: the full lifecycle over every documented channel; every
 * typed error path the work order names (use-after-close, double-close,
 * subscribe-before-open, unknown channel, unmapped field, unknown message
 * type, malformed payload, documented sequence regression, entitlement
 * refusal); the unmangled request pass-through; the sequence discipline;
 * and byte-determinism (the same script -> the same stream, twice).
 *
 * All tests run over the REAL SDK's scripted fake transport (test-only
 * relative import — the repo's established pattern; the package sources
 * import nothing).
 */

import { describe, expect, it } from 'vitest';

import {
  createCoinbaseAdapterSession,
  createCoinbaseSessionWithoutEntitlement,
  coinbaseSubscription,
  createCoinbaseGuardTransport,
  createAdapterSession,
  COINBASE_ENTITLEMENT,
  COINBASE_SOURCE_DESCRIPTOR,
  COINBASE_ADAPTER,
  COINBASE_MAPPING_TABLES,
  isProtocolError,
  coinbaseProtocolCodeOf,
  type AdapterSession,
  type EmittedEvent,
  type SdkResult,
} from './index';

import {
  createFakeTransport,
  type FakeTransport,
  type JsonObject,
  type TransportScript,
  type TimestampMs,
} from '../../../packages/provider-sdk/src/index';

const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = 1_716_312_132_123; // 2024-05-21T17:22:12.123Z

const coinbaseMatch = (sequence: number, tradeId: number, side: 'buy' | 'sell') => ({
  type: 'match',
  trade_id: tradeId,
  sequence,
  maker_order_id: '2b6f88ef-7c21-4b1f-9a1e-1b1f4c6d1e5f',
  taker_order_id: 'f1a2b3c4-d5e6-4789-a012-3456789abcde',
  time: '2024-05-21T17:22:12.123456Z',
  product_id: 'BTC-USD',
  size: '0.01700000',
  price: '43125.10000000',
  side,
});

const coinbaseTicker = (sequence: number) => ({
  type: 'ticker',
  trade_id: 7,
  sequence,
  time: '2024-05-21T17:22:12.123456Z',
  product_id: 'BTC-USD',
  price: '43125.10000000',
  last_size: '0.01700000',
  best_bid: '43125.09000000',
  best_bid_size: '0.50000000',
  best_ask: '43125.11000000',
  best_ask_size: '0.73000000',
  open_24h: '-26.59000000',
  volume_24h: '12345.67000000',
  low_24h: '42500.00000000',
  high_24h: '43200.00000000',
  volume_30d: '450000.00000000',
});

const coinbaseSnapshot = () => ({
  type: 'snapshot',
  product_id: 'BTC-USD',
  bids: [['43125.20000000', '1.10000000']],
  asks: [['43126.30000000', '0.50000000']],
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
    ? createCoinbaseAdapterSession({ transport: transportFor(transportScript), entitlement: COINBASE_ENTITLEMENT })
    : createCoinbaseSessionWithoutEntitlement(transportFor(transportScript));
  if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
  return construction.session;
}

function subscribe(session: AdapterSession, channel: 'level2_batch' | 'ticker' | 'match'): void {
  const spec = coinbaseSubscription({ channel, instrument: 'BTC-USD' });
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
      { at: AT0, channel: 'match', payload: coinbaseMatch(6573391, 7, 'buy') },
      { at: AT0 + 10, channel: 'ticker', payload: coinbaseTicker(6573392) },
      { at: AT0 + 20, channel: 'level2_batch', payload: coinbaseSnapshot() },
      { at: AT0 + 30, channel: 'match', payload: coinbaseMatch(6573393, 8, 'sell') },
    ]);
    const session = sessionOver(transportScript);
    expect(session.open().ok).toBe(true);
    subscribe(session, 'match');
    subscribe(session, 'ticker');
    subscribe(session, 'level2_batch');
    expect(session.state()).toBe('subscribed');

    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    if (terminal.ok) expect(terminal.value).toBeNull();
    expect(events.length).toBe(4);
    const types = events.map((event) => (event as unknown as { event_type: string }).event_type);
    expect(types).toEqual(['trade', 'quote', 'book_snapshot', 'trade']);
    expect(session.lastMessageAt()).toBe(AT0 + 30);
    expect(session.close().ok).toBe(true);
    expect(session.state()).toBe('closed');
  });

  it('every emitted event carries the quartet, provenance, entitlement ref and mapping ref', () => {
    const transportScript = script([{ at: AT0, channel: 'match', payload: coinbaseMatch(6573391, 7, 'buy') }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'match');
    const { events } = drain(session);
    expect(events.length).toBe(1);
    const event = events[0] as unknown as Record<string, unknown>;
    expect(event.event_time).toBe(AT0); // the documented ISO time, converted
    expect((event.available_time as number) >= (event.event_time as number)).toBe(true);
    const provenance = event.provenance as Record<string, unknown>;
    expect(provenance.origin).toBe('historical');
    expect((provenance.adapter as Record<string, unknown>).id).toBe('adapter-coinbase');
    const entitlement = event.entitlement as Record<string, unknown>;
    expect(entitlement.entitlement_id).toBe('ent-coinbase-spot-public');
    expect((event.mapping as Record<string, unknown>).table_id).toBe('coinbase-match');
    expect(event.provider).toBe('coinbase');
    expect(event.venue).toBe('COINBASE');
    expect(event.instrument).toBe('BTC-USD');
  });

  it('onEvent/pump deliver every event and abort on the first typed failure', () => {
    const transportScript = script([
      { at: AT0, channel: 'match', payload: coinbaseMatch(6573391, 7, 'buy') },
      { at: AT0 + 10, channel: 'match', payload: coinbaseMatch(6573392, 8, 'sell') },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'match');
    const seen: unknown[] = [];
    session.onEvent((event) => seen.push(event));
    const pumped = session.pump();
    expect(pumped.ok).toBe(true);
    if (pumped.ok) expect(pumped.value).toBe(2);
    expect(seen.length).toBe(2);

    const failingScript = script([
      { at: AT0, channel: 'match', payload: coinbaseMatch(6573391, 7, 'buy') },
      { at: AT0 + 10, channel: 'match', payload: { ...coinbaseMatch(6573392, 8, 'sell'), vendor_extra: 1 } },
    ]);
    const failingSession = sessionOver(failingScript);
    failingSession.open();
    subscribe(failingSession, 'match');
    const aborted = failingSession.pump();
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) expect(aborted.error.code).toBe('unmapped_raw_field');
  });
});

describe('the request pass-through (the neutrality contract)', () => {
  it('the documented subscribe frame crosses the transport unmangled', () => {
    const transportScript = script([{ at: AT0, channel: 'match', payload: coinbaseMatch(6573391, 7, 'buy') }]);
    const transport = transportFor(transportScript);
    const construction = createCoinbaseAdapterSession({ transport, entitlement: COINBASE_ENTITLEMENT });
    if (!construction.ok) throw new Error('must construct');
    const session = construction.session;
    session.open();
    subscribe(session, 'match');
    const sent = transport.sent();
    expect(sent.length).toBe(1);
    expect(sent[0].channel).toBe('match');
    expect({ ...sent[0].payload }).toEqual({
      type: 'subscribe',
      product_ids: ['BTC-USD'],
      channels: ['match'],
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
    const spec = coinbaseSubscription({ channel: 'match', instrument: 'BTC-USD' });
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
    const spec = coinbaseSubscription({ channel: 'match', instrument: 'BTC-USD' });
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
    if (!result.ok) expect(result.error.code).toBe('double_close');
  });

  it('use-after-close is a typed use_after_close (nextEvent AND subscribe)', () => {
    const session = sessionOver(script([]));
    session.open();
    session.close();
    const next = session.nextEvent();
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.error.code).toBe('use_after_close');
    const spec = coinbaseSubscription({ channel: 'match', instrument: 'BTC-USD' });
    if (!spec.ok) throw new Error('must build');
    const subscribed = session.subscribe(spec.value);
    expect(subscribed.ok).toBe(false);
    if (!subscribed.ok) expect(subscribed.error.code).toBe('use_after_close');
  });

  it('duplicate subscription on one channel is typed', () => {
    const session = sessionOver(script([]));
    session.open();
    subscribe(session, 'match');
    const spec = coinbaseSubscription({ channel: 'match', instrument: 'BTC-USD' });
    if (!spec.ok) throw new Error('must build');
    const result = session.subscribe(spec.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('duplicate_subscription');
  });

  it('a subscription outside the declared envelope is typed (undeclared channel / instrument)', () => {
    const session = sessionOver(script([]));
    session.open();
    const badChannel = session.subscribe({
      channel: 'full',
      request: { type: 'subscribe', product_ids: ['BTC-USD'], channels: ['full'] },
      venue: 'COINBASE',
      instrument: 'BTC-USD',
      asset_class: 'crypto',
      mapping_table_id: 'coinbase-match',
    });
    expect(badChannel.ok).toBe(false);
    if (!badChannel.ok) expect(badChannel.error.code).toBe('invalid_configuration');

    const badInstrument = session.subscribe({
      channel: 'match',
      request: { type: 'subscribe', product_ids: ['DOGE-USD'], channels: ['match'] },
      venue: 'COINBASE',
      instrument: 'DOGE-USD',
      asset_class: 'crypto',
      mapping_table_id: 'coinbase-match',
    });
    expect(badInstrument.ok).toBe(false);
    if (!badInstrument.ok) expect(badInstrument.error.code).toBe('invalid_configuration');
  });

  it('a message on an unsubscribed channel is a typed unknown_channel', () => {
    const transportScript = script([{ at: AT0, channel: 'ticker', payload: coinbaseTicker(1) }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'match'); // ticker is NOT subscribed
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) expect(terminal.error.code).toBe('unknown_channel');
  });
});

describe('provider protocol typed errors (the documented channel laws)', () => {
  it('a match sequence regression is typed (the documented sequence does not advance)', () => {
    const transportScript = script([
      { at: AT0, channel: 'match', payload: coinbaseMatch(6573391, 7, 'buy') },
      { at: AT0 + 100, channel: 'match', payload: coinbaseMatch(6573391, 8, 'sell') }, // same sequence
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'match');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(1);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(coinbaseProtocolCodeOf(terminal.error)).toBe('sequence_regression');
      expect(terminal.error.message).toContain('6573391');
    }
  });

  it('a ticker sequence regression is typed too (per-channel sequence streams)', () => {
    const transportScript = script([
      { at: AT0, channel: 'ticker', payload: coinbaseTicker(100) },
      { at: AT0 + 100, channel: 'ticker', payload: coinbaseTicker(99) },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'ticker');
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(coinbaseProtocolCodeOf(terminal.error)).toBe('sequence_regression');
    }
  });

  it('sequence trackers are per product (different products never collide)', () => {
    const otherProduct = { ...coinbaseMatch(6573391, 7, 'buy'), product_id: 'ETH-USD' };
    const transportScript = script([
      { at: AT0, channel: 'match', payload: coinbaseMatch(6573391, 7, 'buy') },
      { at: AT0 + 100, channel: 'match', payload: otherProduct },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    const spec = coinbaseSubscription({ channel: 'match', instrument: 'BTC-USD' });
    if (!spec.ok) throw new Error('must build');
    session.subscribe({
      ...spec.value,
      instrument: 'ETH-USD',
      request: { type: 'subscribe', product_ids: ['ETH-USD'], channels: ['match'] },
    });
    const { terminal } = drain(session);
    // The ETH-USD message arrives on the 'match' channel, whose binding is
    // ETH-USD — it emits (the tracker keys differ by product).
    expect(terminal.ok).toBe(true);
  });

  it('an unknown message type is a typed protocol error (criterion 6)', () => {
    const transportScript = script([
      { at: AT0, channel: 'level2_batch', payload: { ...coinbaseSnapshot(), type: 'l2update' } },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'level2_batch');
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(coinbaseProtocolCodeOf(terminal.error)).toBe('unknown_message_type');
      expect(terminal.error.message).toContain('l2update');
    }
  });

  it('a malformed documented payload is a typed protocol error', () => {
    const transportScript = script([
      { at: AT0, channel: 'match', payload: { ...coinbaseMatch(6573391, 7, 'buy'), price: 'free' } },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'match');
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(coinbaseProtocolCodeOf(terminal.error)).toBe('malformed_payload');
      expect(terminal.error.message).toContain('"price"');
    }
  });

  it('an unmapped raw field through the session is a typed MappingError (the contract case)', () => {
    const transportScript = script([
      { at: AT0, channel: 'match', payload: { ...coinbaseMatch(6573391, 7, 'buy'), vendor_extra: 'surprise' } },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'match');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(0);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(terminal.error.kind).toBe('mapping');
      expect(terminal.error.code).toBe('unmapped_raw_field');
    }
  });
});

describe('entitlement (the licensing law)', () => {
  it('emission without the declared entitlement is a typed EntitlementError and emits nothing', () => {
    const transportScript = script([{ at: AT0, channel: 'match', payload: coinbaseMatch(6573391, 7, 'buy') }]);
    const session = sessionOver(transportScript, false);
    session.open();
    subscribe(session, 'match');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(0);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(terminal.error.kind).toBe('entitlement');
      expect(terminal.error.code).toBe('entitlement_undeclared');
    }
  });

  it('a bad entitlement in the config is rejected at construction (collect-all)', () => {
    const construction = createCoinbaseAdapterSession({ transport: transportFor(script([])), entitlement: { nope: 1 } });
    expect(construction.ok).toBe(false);
    if (!construction.ok) expect(construction.errors.length).toBeGreaterThan(0);
  });
});

describe('determinism (criterion 3: byte-identical, twice)', () => {
  const mixedScript = script([
    { at: AT0, channel: 'match', payload: coinbaseMatch(6573391, 7, 'buy') },
    { at: AT0 + 10, channel: 'ticker', payload: coinbaseTicker(6573392) },
    { at: AT0 + 20, channel: 'level2_batch', payload: coinbaseSnapshot() },
    { at: AT0 + 30, channel: 'match', payload: coinbaseMatch(6573393, 8, 'sell') },
  ]);

  it('the same scripted timeline emits a byte-identical canonical stream (deep-equal + JSON-identical)', () => {
    const first = runMixed();
    const second = runMixed();
    expect(first.length).toBe(second.length);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toEqual(second);

    function runMixed(): EmittedEvent[] {
      const session = sessionOver(mixedScript);
      session.open();
      subscribe(session, 'match');
      subscribe(session, 'ticker');
      subscribe(session, 'level2_batch');
      const { events, terminal } = drain(session);
      if (!terminal.ok || terminal.value !== null) throw new Error('must drain cleanly');
      return events;
    }
  });

  it('sequence trackers are pure functions of the consumed timeline (guard introspection)', () => {
    const guard = createCoinbaseGuardTransport(transportFor(mixedScript));
    // Mirror the session factory's exact construction (guard over the raw
    // port, engine over the guard) so the guard handle is introspectable.
    const sessionConstruction = createAdapterSession({
      descriptor: COINBASE_SOURCE_DESCRIPTOR,
      adapter: COINBASE_ADAPTER,
      transport: guard,
      mapping_tables: COINBASE_MAPPING_TABLES,
      entitlement: COINBASE_ENTITLEMENT,
    });
    if (!sessionConstruction.ok) throw new Error('must construct');
    const session = sessionConstruction.session;
    session.open();
    subscribe(session, 'match');
    const pumped = session.pump(); // aborts at the first un-subscribed channel (ticker)
    expect(pumped.ok).toBe(false);
    const trackers = guard.sequenceTrackers();
    expect(trackers['match|BTC-USD']).toBe(6573391); // the first match consumed
    expect(trackers['ticker|BTC-USD']).toBe(6573392); // guarded before routing failed
  });
});
