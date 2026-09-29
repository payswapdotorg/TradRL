/**
 * @tradrl/adapter-coinbase — the INVERSE-neutrality trip-wire.
 *
 * Acceptance criterion 4: "a test asserts the CANONICAL emitted events
 * contain no provider-specific field names (Binance/Coinbase vocabulary
 * lives only in descriptor/mapping/session layers)."
 *
 * Law L2/L13 read inversely: the SDK must contain no provider name; THIS
 * adapter is where the Coinbase vocabulary lives — but ONLY in the
 * declaration layers (descriptor, schemas, mapping tables, guard). The
 * emitted CANONICAL events must be provider-neutral market-protocol
 * shapes: no Coinbase raw field name may appear as a field of an emitted
 * event, and the documented raw message forms must not leak into the
 * canonical values.
 *
 * The test walks every emitted event RECURSIVELY, collecting every field
 * name, and asserts the intersection with the adapter's provider-ONLY
 * vocabulary is empty (names shared with the canonical contracts —
 * bids/asks/price/size/side/trade_id — are excluded from the banned set,
 * since the canonical contracts own them too); it also proves the
 * positive direction — the vocabulary DOES live in the declaration
 * layers.
 */

import { describe, expect, it } from 'vitest';

import {
  createCoinbaseAdapterSession,
  coinbaseSubscription,
  COINBASE_ENTITLEMENT,
  COINBASE_RAW_FIELD_NAMES,
  COINBASE_SOURCE_DESCRIPTOR,
  COINBASE_MAPPING_TABLES,
  accountedRawFields,
  type AdapterSession,
  type EmittedEvent,
} from './index';
import { createFakeTransport, type TransportScript } from '../../../packages/provider-sdk/src/index';

const AT0 = 1_716_312_132_123;

/** Emit a stream covering EVERY documented channel, with canonical identity values only. */
function emitAll(): EmittedEvent[] {
  const transportScript: TransportScript = {
    inbound: [
      {
        at: AT0 as TransportScript['inbound'][number]['at'],
        channel: 'match',
        payload: {
          type: 'match',
          trade_id: 7,
          sequence: 6573391,
          maker_order_id: '2b6f88ef-7c21-4b1f-9a1e-1b1f4c6d1e5f',
          taker_order_id: 'f1a2b3c4-d5e6-4789-a012-3456789abcde',
          time: '2024-05-21T17:22:12.123456Z',
          product_id: 'BTC-USD',
          size: '0.01700000',
          price: '43125.10000000',
          side: 'buy',
        },
      },
      {
        at: (AT0 + 10) as TransportScript['inbound'][number]['at'],
        channel: 'ticker',
        payload: {
          type: 'ticker',
          trade_id: 7,
          sequence: 6573392,
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
        },
      },
      {
        at: (AT0 + 20) as TransportScript['inbound'][number]['at'],
        channel: 'level2_batch',
        payload: {
          type: 'snapshot',
          product_id: 'BTC-USD',
          bids: [['43125.20000000', '1.10000000']],
          asks: [['43126.30000000', '0.50000000']],
        },
      },
    ],
    recv_failures: [],
    send_failures: [],
    receive_timeout_ms: null,
  };
  const construction = createFakeTransport(transportScript);
  if (!construction.ok) throw new Error('script must validate');
  const sessionConstruction = createCoinbaseAdapterSession({
    transport: construction.transport,
    entitlement: COINBASE_ENTITLEMENT,
  });
  if (!sessionConstruction.ok) throw new Error('session must construct');
  const session: AdapterSession = sessionConstruction.session;
  session.open();
  for (const channel of ['match', 'ticker', 'level2_batch'] as const) {
    const spec = coinbaseSubscription({ channel, instrument: 'BTC-USD' });
    if (!spec.ok) throw new Error(`subscription must build: ${spec.error.message}`);
    const sent = session.subscribe(spec.value);
    if (!sent.ok) throw new Error(`subscribe must succeed: ${sent.error.message}`);
  }
  const events: EmittedEvent[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok) throw new Error(`unexpected failure: ${next.error.code}`);
    if (next.value === null) break;
    events.push(next.value);
  }
  return events;
}

/** Recursively collect every field name of a JSON-shaped value. */
function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const element of value) collectKeys(element, keys);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
}

describe('the inverse-neutrality trip-wire (criterion 4)', () => {
  const events = emitAll();

  it('every documented channel emits (the walk is not vacuous)', () => {
    expect(events.length).toBe(3);
    const types = events.map((event) => event.event_type).sort();
    expect(types).toEqual(['book_snapshot', 'quote', 'trade']);
  });

  it('NO provider-specific field name appears anywhere in the emitted canonical events (L2)', () => {
    const keys = new Set<string>();
    for (const event of events) collectKeys(event, keys);
    expect(keys.size).toBeGreaterThan(20); // the walk must actually cover the records
    // Names the canonical contracts share (the envelope's sequence; the
    // book_snapshot/trade payload fields) are excluded; every OTHER
    // documented Coinbase field name is provider-only and banned.
    const canonicalShared = ['bids', 'asks', 'price', 'size', 'side', 'trade_id', 'sequence'];
    const banned = (COINBASE_RAW_FIELD_NAMES as readonly string[]).filter((name) => !canonicalShared.includes(name));
    expect(banned.length).toBeGreaterThan(10); // the banned list is substantial
    const violations = [...keys].filter((key) => banned.includes(key));
    expect(violations).toEqual([]);
  });

  it('the emitted field names are the canonical contract vocabulary only', () => {
    const keys = new Set<string>();
    for (const event of events) collectKeys(event, keys);
    const canonicalFields = [
      'event_id', 'venue', 'instrument', 'asset_class', 'event_type',
      'event_time', 'source_time', 'available_time', 'ingestion_time',
      'sequence', 'provider', 'provenance', 'entitlement', 'mapping', 'payload',
      'origin', 'adapter', 'id', 'version', 'derived_from', 'transform',
      'entitlement_id', 'constraints', 'table_id', 'source_time_policy',
      'event_time_basis', 'event_time_field', 'source_time_field', 'availability_basis',
      'price', 'size', 'side', 'trade_id', 'bid_price', 'bid_size', 'ask_price', 'ask_size',
      'bids', 'asks',
    ];
    for (const key of keys) {
      expect(canonicalFields).toContain(key);
    }
  });

  it('the documented raw message forms do not leak into the canonical values', () => {
    const serialized = JSON.stringify(events);
    // The documented message types must not appear as values anywhere.
    expect(serialized).not.toContain('"snapshot"');
    expect(serialized).not.toContain('"ticker"');
    expect(serialized).not.toContain('"match"');
    // The canonical instrument id is the documented product id (same string,
    // by declaration — the canonical form IS the venue-canonical form).
    expect(serialized).toContain('"instrument":"BTC-USD"');
    // The aggressor side appears only in canonical form.
    expect(serialized).toContain('"side":"buy"');
    expect(serialized).not.toContain('"maker_order_id"');
    expect(serialized).not.toContain('"best_bid"');
  });

  it('the provider vocabulary DOES live in the declaration layers (the L2 inverse: HERE)', () => {
    expect(COINBASE_SOURCE_DESCRIPTOR.provider).toBe('coinbase');
    expect(COINBASE_SOURCE_DESCRIPTOR.capabilities.channels).toContain('level2_batch');
    const matchTable = COINBASE_MAPPING_TABLES.find((table) => table.table_id === 'coinbase-match');
    if (matchTable === undefined) throw new Error('the match table must exist');
    const matchAccounted = accountedRawFields(matchTable);
    expect(matchAccounted).toContain('price');
    expect(matchAccounted).toContain('side');
    expect(matchAccounted).toContain('time');
    expect(matchAccounted).toContain('maker_order_id'); // tolerated (auditable drop)
    expect(COINBASE_RAW_FIELD_NAMES).toContain('product_id');
    expect(COINBASE_RAW_FIELD_NAMES.length).toBeGreaterThan(10);
  });
});
