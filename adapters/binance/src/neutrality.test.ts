/**
 * @tradrl/adapter-binance — the INVERSE-neutrality trip-wire.
 *
 * Acceptance criterion 4: "a test asserts the CANONICAL emitted events
 * contain no provider-specific field names (Binance/Coinbase vocabulary
 * lives only in descriptor/mapping/session layers)."
 *
 * Law L2/L13 read inversely: the SDK must contain no provider name; THIS
 * adapter is where the Binance vocabulary lives — but ONLY in the
 * declaration layers (descriptor, schemas, mapping tables, guard). The
 * emitted CANONICAL events must be provider-neutral market-protocol
 * shapes: no Binance raw field name may appear as a field of an emitted
 * event, and the documented raw payload forms must not leak into the
 * canonical values.
 *
 * The test walks every emitted event RECURSIVELY, collecting every field
 * name, and asserts the intersection with the adapter's exported
 * provider vocabulary ({@link BINANCE_RAW_FIELD_NAMES}) is empty; it also
 * proves the positive direction — the vocabulary DOES live in the
 * declaration layers (the mapping tables declare documented raw fields,
 * the descriptor carries the provider id and channel names).
 */

import { describe, expect, it } from 'vitest';

import {
  createBinanceAdapterSession,
  binanceSubscription,
  BINANCE_ENTITLEMENT,
  BINANCE_RAW_FIELD_NAMES,
  BINANCE_SOURCE_DESCRIPTOR,
  BINANCE_MAPPING_TABLES,
  accountedRawFields,
  type AdapterSession,
  type EmittedEvent,
} from './index';
import { createFakeTransport, type TransportScript, type TimestampMs } from '../../../packages/provider-sdk/src/index';

const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = 1_717_423_200_000;

/** Emit a stream covering EVERY documented channel, with canonical identity values only. */
function emitAll(): EmittedEvent[] {
  const transportScript: TransportScript = {
    inbound: [
      {
        at: ms(AT0),
        channel: 'trade',
        payload: {
          e: 'trade',
          E: AT0,
          s: 'BTCUSDT',
          t: 100234,
          p: '43125.10000000',
          q: '0.01700000',
          T: AT0,
          m: false,
        },
      },
      {
        at: ms(AT0 + 10),
        channel: 'bookTicker',
        payload: { u: 400900217, s: 'BTCUSDT', b: '43125.10000000', B: '31.21000000', a: '43125.36520000', A: '40.66000000' },
      },
      {
        at: ms(AT0 + 20),
        channel: 'depthDiff',
        payload: {
          e: 'depthUpdate',
          E: AT0 + 20,
          s: 'BTCUSDT',
          U: 157,
          u: 160,
          b: [
            ['43125.20000000', '1.10000000'],
            ['43124.10000000', '0.00000000'],
          ],
          a: [['43126.30000000', '0.50000000']],
        },
      },
      {
        at: ms(AT0 + 30),
        channel: 'depth',
        payload: {
          lastUpdateId: 160,
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
  const sessionConstruction = createBinanceAdapterSession({
    transport: construction.transport,
    entitlement: BINANCE_ENTITLEMENT,
  });
  if (!sessionConstruction.ok) throw new Error('session must construct');
  const session: AdapterSession = sessionConstruction.session;
  session.open();
  for (const [channel, id] of [
    ['trade', 1],
    ['bookTicker', 2],
    ['depthDiff', 3],
    ['depth', 4],
  ] as const) {
    const spec = binanceSubscription({ channel, instrument: 'BTC-USDT', request_id: id });
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
    expect(events.length).toBe(5); // trade, quote, update-delta, remove-delta, book_snapshot
    const types = events.map((event) => event.event_type).sort();
    expect(types).toEqual(['book_delta', 'book_delta', 'book_snapshot', 'quote', 'trade']);
  });

  it('NO provider-specific field name appears anywhere in the emitted canonical events (L2)', () => {
    const keys = new Set<string>();
    for (const event of events) collectKeys(event, keys);
    expect(keys.size).toBeGreaterThan(20); // the walk must actually cover the records
    // "bids"/"asks" are shared by the canonical book_snapshot contract itself;
    // every OTHER documented Binance field name is provider-only and banned.
    const canonicalOverlap = ['bids', 'asks'];
    const banned = (BINANCE_RAW_FIELD_NAMES as readonly string[]).filter((name) => !canonicalOverlap.includes(name));
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
      'bids', 'asks', 'action', 'levels', 'last_update_id',
    ];
    for (const key of keys) {
      expect(canonicalFields).toContain(key);
    }
  });

  it('the documented raw payload FORMS do not leak into the canonical values', () => {
    // The raw symbol form ("BTCUSDT", concatenated, no separator) must never
    // appear; the canonical instrument id ("BTC-USDT") does.
    const serialized = JSON.stringify(events);
    expect(serialized).toContain('"instrument":"BTC-USDT"');
    expect(serialized).not.toContain('BTCUSDT');
    // The raw event-type discriminators must not appear as values.
    expect(serialized).not.toContain('depthUpdate');
    // The aggressor side appears only in canonical form.
    expect(serialized).toContain('"side":"buy"');
    expect(serialized).not.toContain('"m"');
  });

  it('the provider vocabulary DOES live in the declaration layers (the L2 inverse: HERE)', () => {
    // The descriptor carries the provider id and the channel vocabulary.
    expect(BINANCE_SOURCE_DESCRIPTOR.provider).toBe('binance');
    expect(BINANCE_SOURCE_DESCRIPTOR.capabilities.channels).toContain('depthDiff');
    // The mapping tables declare the documented raw field names.
    const tradeTable = BINANCE_MAPPING_TABLES.find((table) => table.table_id === 'binance-trade');
    if (tradeTable === undefined) throw new Error('the trade table must exist');
    const tradeAccounted = accountedRawFields(tradeTable);
    expect(tradeAccounted).toContain('p');
    expect(tradeAccounted).toContain('m');
    expect(tradeAccounted).toContain('T');
    // The schema layer exports the documented vocabulary.
    expect(BINANCE_RAW_FIELD_NAMES).toContain('lastUpdateId');
    expect(BINANCE_RAW_FIELD_NAMES.length).toBeGreaterThan(10);
  });
});
