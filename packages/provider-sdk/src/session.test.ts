/**
 * @tradrl/provider-sdk — the adapter session: lifecycle behavioral battery.
 *
 * Strict state machine with typed errors on every misuse; capability
 * cross-checks; channel routing; the scripted timeout and transport
 * failures propagate typed; health input is exposed; the pass-through
 * subscription request is recorded unmangled.
 */

import { describe, expect, it } from 'vitest';

import {
  createAdapterSession,
  createFakeTransport,
  validateMappingTable,
  validateSourceDescriptor,
  validateEntitlementEnvelope,
  type AdapterSession,
  type MappingTable,
  type SourceDescriptor,
  type EntitlementEnvelope,
  type SubscriptionSpec,
  type TimestampMs,
  type JsonObject,
} from './index';

const at = (value: number): TimestampMs => value as TimestampMs;

function fixtureDescriptor(): SourceDescriptor {
  const result = validateSourceDescriptor({
    provider: 'fixture-source',
    category: 'market-data',
    capabilities: {
      channels: ['raw-trades', 'raw-book'],
      symbol_universes: [
        { universe_id: 'uni-major', asset_class: 'crypto', instruments: ['PAIR-1', 'PAIR-2'] },
      ],
      event_types: ['trade', 'book_snapshot'],
      latency_class: 'realtime',
    },
  });
  if (!result.ok) throw new Error('fixture descriptor must validate');
  return result.value;
}

function fixtureEntitlement(): EntitlementEnvelope {
  return {
    entitlement_id: 'ent-fixture',
    access_class: 'restricted',
    constraints: ['license-tier-2'],
    terms_ref: null,
  };
}

function tradeTable(): MappingTable {
  const result = validateMappingTable({
    table_id: 'tbl-trade',
    event_type: 'trade',
    fields: [
      { raw_field: 'p', canonical_field: 'price', transform: { kind: 'decimal-string' } },
      { raw_field: 'q', canonical_field: 'size', transform: { kind: 'decimal-string' } },
      { raw_field: 's', canonical_field: 'side', transform: { kind: 'enum', map: { B: 'buy', S: 'sell' } } },
    ],
    constants: [],
    tolerated: ['seq'],
    source_time_policy: {
      event_time_basis: 'raw-field',
      event_time_field: 'ts',
      source_time_field: null,
      availability_basis: 'receive-time',
    },
  });
  if (!result.ok) throw new Error('fixture table must validate');
  return result.value;
}

const subscription: SubscriptionSpec = {
  channel: 'raw-trades',
  request: { symbol: 'PAIR-1', depth: 'none' },
  venue: 'VENUE-A',
  instrument: 'PAIR-1',
  asset_class: 'crypto',
  mapping_table_id: 'tbl-trade',
};

function tradeMessage(atMs: number, sequence: number, price: string): { at: TimestampMs; channel: string; payload: JsonObject } {
  return { at: at(atMs), channel: 'raw-trades', payload: { ts: atMs - 30, p: price, q: '0.01', s: 'B', seq: sequence } };
}

function buildSession(script: unknown, options: { entitlement?: EntitlementEnvelope | null } = {}): AdapterSession {
  const transportConstruction = createFakeTransport(script);
  if (!transportConstruction.ok) throw new Error(`fixture script must validate: ${JSON.stringify(transportConstruction.errors)}`);
  const config: Record<string, unknown> = {
    descriptor: fixtureDescriptor(),
    adapter: { id: 'fixture-adapter', version: '1.0.0' },
    transport: transportConstruction.transport,
    mapping_tables: [tradeTable()],
  };
  if (options.entitlement !== null) config.entitlement = options.entitlement ?? fixtureEntitlement();
  const construction = createAdapterSession(config);
  if (!construction.ok) throw new Error(`fixture session must construct: ${JSON.stringify(construction.errors)}`);
  return construction.session;
}

const happyScript = {
  inbound: [tradeMessage(10_000, 1, '100.5'), tradeMessage(10_050, 2, '100.6'), tradeMessage(10_100, 3, '100.7')],
  recv_failures: [],
  send_failures: [],
  receive_timeout_ms: null,
};

describe('session lifecycle (the happy path)', () => {
  it('open -> subscribe -> drain -> close', () => {
    const session = buildSession(happyScript);
    expect(session.state()).toBe('idle');
    expect(session.open().ok).toBe(true);
    expect(session.state()).toBe('open');
    expect(session.subscribe(subscription).ok).toBe(true);
    expect(session.state()).toBe('subscribed');

    const events = [];
    for (;;) {
      const next = session.nextEvent();
      expect(next.ok).toBe(true);
      if (!next.ok || next.value === null) break;
      events.push(next.value);
    }
    expect(events).toHaveLength(3);
    expect(session.lastMessageAt()).toBe(10_100);
    expect(session.close().ok).toBe(true);
    expect(session.state()).toBe('closed');
  });

  it('drained transport yields null (a clean end of stream)', () => {
    const session = buildSession({ ...happyScript, inbound: [] });
    session.open();
    session.subscribe(subscription);
    const next = session.nextEvent();
    expect(next.ok && next.value === null).toBe(true);
  });
});

describe('session lifecycle (typed error paths)', () => {
  it('double open is invalid_transition', () => {
    const session = buildSession(happyScript);
    session.open();
    const result = session.open();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(result.error.code).toBe('invalid_transition');
    }
  });

  it('double close is double_close', () => {
    const session = buildSession(happyScript);
    session.open();
    session.close();
    const result = session.close();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(result.error.code).toBe('double_close');
    }
  });

  it('use-after-close is use_after_close for every operation', () => {
    const session = buildSession(happyScript);
    session.open();
    session.subscribe(subscription);
    session.close();
    for (const operation of [() => session.nextEvent(), () => session.subscribe(subscription), () => session.open()]) {
      const result = operation();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('use_after_close');
    }
  });

  it('subscribe before open is invalid_transition', () => {
    const session = buildSession(happyScript);
    const result = session.subscribe(subscription);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_transition');
  });

  it('nextEvent before subscribing is invalid_transition', () => {
    const session = buildSession(happyScript);
    session.open();
    const result = session.nextEvent();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_transition');
  });

  it('close from idle is safe cleanup (no spurious error)', () => {
    const session = buildSession(happyScript);
    expect(session.close().ok).toBe(true);
    expect(session.state()).toBe('closed');
  });
});

describe('subscription validation (declared capability envelope)', () => {
  it('rejects channels the descriptor does not declare', () => {
    const session = buildSession(happyScript);
    session.open();
    const result = session.subscribe({ ...subscription, channel: 'raw-unknown' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(result.error.message).toContain('raw-unknown');
    }
  });

  it('rejects instruments outside the declared universes', () => {
    const session = buildSession(happyScript);
    session.open();
    const result = session.subscribe({ ...subscription, instrument: 'PAIR-999' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('PAIR-999');
  });

  it('rejects unknown mapping tables', () => {
    const session = buildSession(happyScript);
    session.open();
    const result = session.subscribe({ ...subscription, mapping_table_id: 'tbl-nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('mapping_table_not_found');
  });

  it('rejects duplicate channel subscriptions', () => {
    const session = buildSession(happyScript);
    session.open();
    session.subscribe(subscription);
    const result = session.subscribe(subscription);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('duplicate_subscription');
  });

  it('rejects structurally invalid specs', () => {
    const session = buildSession(happyScript);
    session.open();
    const result = session.subscribe({ ...subscription, channel: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });

  it('a transport send failure propagates typed', () => {
    const script = { ...happyScript, send_failures: [{ on_send_index: 0, message: 'connection refused' }] };
    const session = buildSession(script);
    session.open();
    const result = session.subscribe(subscription);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('transport');
      expect(result.error.code).toBe('transport_send_failed');
    }
  });
});

describe('message routing and emission failures', () => {
  it('a message on an unsubscribed channel is a typed ProtocolError', () => {
    const script = {
      inbound: [{ at: at(10_000), channel: 'raw-book', payload: {} }],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const session = buildSession(script);
    session.open();
    session.subscribe(subscription);
    const result = session.nextEvent();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_channel');
  });

  it('transient scripted recv failures propagate typed and retry delivers', () => {
    const script = {
      inbound: [tradeMessage(10_000, 1, '100.5')],
      recv_failures: [{ before_index: 0, message: 'transient hiccup' }],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const session = buildSession(script);
    session.open();
    session.subscribe(subscription);
    const failed = session.nextEvent();
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.kind).toBe('transport');
      expect(failed.error.code).toBe('transport_recv_failed');
    }
    const retried = session.nextEvent();
    expect(retried.ok && retried.value !== null).toBe(true);
  });

  it('the scripted gap exceeding the receive budget is a typed TimeoutError', () => {
    const script = {
      inbound: [tradeMessage(10_000, 1, '100.5'), tradeMessage(60_000, 2, '100.6')],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: 5_000,
    };
    const session = buildSession(script);
    session.open();
    session.subscribe(subscription);
    expect(session.nextEvent().ok).toBe(true); // first message: no prior gap
    const timedOut = session.nextEvent();
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) {
      expect(timedOut.error.kind).toBe('timeout');
      expect(timedOut.error.code).toBe('receive_timeout');
    }
    // the message stays queued — the next wait delivers it (it "arrived" by then)
    const delivered = session.nextEvent();
    expect(delivered.ok && delivered.value !== null).toBe(true);
  });

  it('emission without entitlement surfaces the typed EntitlementError through the session', () => {
    const session = buildSession(happyScript, { entitlement: null });
    session.open();
    session.subscribe(subscription);
    const result = session.nextEvent();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('entitlement');
      expect(result.error.code).toBe('entitlement_undeclared');
    }
  });

  it('an unmapped raw field surfaces the typed MappingError through the session', () => {
    const script = {
      inbound: [
        { at: at(10_000), channel: 'raw-trades', payload: { ts: 9_970, p: '1', q: '1', s: 'B', seq: 1, vendor_extra: 'x' } },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const session = buildSession(script);
    session.open();
    session.subscribe(subscription);
    const result = session.nextEvent();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('unmapped_raw_field');
    }
  });
});

describe('pump and onEvent', () => {
  it('drains the whole script through the handler and counts deliveries', () => {
    const session = buildSession(happyScript);
    session.open();
    session.subscribe(subscription);
    const seen: string[] = [];
    session.onEvent((event) => {
      if (event.event_type === 'trade') seen.push(event.payload.price);
    });
    const pumped = session.pump();
    expect(pumped.ok && pumped.value === 3).toBe(true);
    expect(seen).toEqual(['100.5', '100.6', '100.7']);
  });

  it('aborts on the first typed failure (deterministic failure surfacing)', () => {
    const script = {
      inbound: [tradeMessage(10_000, 1, '100.5'), { at: at(10_050), channel: 'raw-trades', payload: { ts: 10_020, p: '1', q: '1', s: 'B', seq: 2, unknown: 1 } }],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const session = buildSession(script);
    session.open();
    session.subscribe(subscription);
    const seen: number[] = [];
    session.onEvent(() => seen.push(1));
    const pumped = session.pump();
    expect(pumped.ok).toBe(false);
    if (!pumped.ok) expect(pumped.error.code).toBe('unmapped_raw_field');
    expect(seen).toHaveLength(1); // only the successful first event reached the handler
  });
});

describe('construction validation', () => {
  it('rejects a config without a transport port', () => {
    const construction = createAdapterSession({ descriptor: fixtureDescriptor(), adapter: { id: 'a', version: '1' }, mapping_tables: [tradeTable()] });
    expect(construction.ok).toBe(false);
    if (!construction.ok) expect(construction.errors[0].path).toBe('transport');
  });

  it('rejects a transport-shaped object without the port methods', () => {
    const construction = createAdapterSession({
      descriptor: fixtureDescriptor(),
      adapter: { id: 'a', version: '1' },
      mapping_tables: [tradeTable()],
      transport: { send: true },
    });
    expect(construction.ok).toBe(false);
  });
});
