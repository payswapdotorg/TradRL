/**
 * @tradrl/provider-sdk — cross-package interop trip wires.
 *
 * The SDK's canonical shapes are STRUCTURAL MIRRORS of
 * @tradrl/market-protocol (law D-004: structural mirrors, never imports —
 * the frozen workspace lockfile forbids package dependencies). This test
 * is the trip wire: if any mirror drifts, the type-level assertions below
 * fail `pnpm typecheck`, and the runtime parity checks fail `pnpm test`.
 * Cross-package imports happen ONLY in tests, via relative paths (the
 * repo's established pattern).
 *
 * What is proven here:
 *   1. TYPE LEVEL: an EmittedEvent IS a canonical MarketEvent (the SDK's
 *      extras — entitlement/mapping — ride as tolerated unknown fields);
 *      TimestampMs and the provenance blocks are mutually assignable.
 *   2. RUNTIME: the taxonomy and asset-class constants are identical.
 *   3. RUNTIME: payload-validator VERDICT PARITY — for a battery of valid
 *      and invalid fixtures, the SDK mirrors and the real market-protocol
 *      validators agree on ok/not-ok for every canonical event type.
 *   4. RUNTIME: an SDK-emitted stream (scripted session) passes
 *      market-protocol's OWN validateMarketEvent, validateProvenance and
 *      validateSequenceMonotonicity — the emitted records structurally
 *      satisfy the canonical contracts (and, through the identical
 *      ingestion-provenance mirror, the T008 data plane on the lead tree).
 */

import { describe, expect, it } from 'vitest';

import {
  EVENT_TYPES as SDK_EVENT_TYPES,
  ASSET_CLASSES as SDK_ASSET_CLASSES,
  isTimestampMs as sdkIsTimestampMs,
  MIN_TIMESTAMP_MS as SDK_MIN,
  MAX_TIMESTAMP_MS as SDK_MAX,
  payloadRegistry as sdkPayloadRegistry,
  createAdapterSession,
  createFakeTransport,
  validateMappingTable,
  validateSourceDescriptor,
  type EmittedEvent,
  type TimestampMs as SdkTimestampMs,
  type IngestionProvenance,
  type EmittedEventFor,
} from './index';
import {
  EVENT_TYPES as PROTOCOL_EVENT_TYPES,
  ASSET_CLASSES as PROTOCOL_ASSET_CLASSES,
  MIN_TIMESTAMP_MS as PROTOCOL_MIN,
  MAX_TIMESTAMP_MS as PROTOCOL_MAX,
  isTimestampMs as protocolIsTimestampMs,
  validateMarketEvent,
  validateProvenance,
  validateSequenceMonotonicity,
  type MarketEvent,
  type TimestampMs as ProtocolTimestampMs,
  type Provenance,
  type TradeEvent,
  type BookSnapshotEvent,
} from '../../market-protocol/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if any mirror drifts).
// ---------------------------------------------------------------------------

/** Compiles iff the SDK's TimestampMs mirror is assignable to the canonical. */
function sdkTimestampIsProtocolTimestamp(value: SdkTimestampMs): ProtocolTimestampMs {
  return value;
}

/** Compiles iff the canonical TimestampMs is assignable to the SDK's mirror. */
function protocolTimestampIsSdkTimestamp(value: ProtocolTimestampMs): SdkTimestampMs {
  return value;
}

/** Compiles iff the SDK's ingestion provenance block IS a canonical Provenance. */
function ingestionProvenanceIsProtocolProvenance(value: IngestionProvenance): Provenance {
  return value;
}

/** Compiles iff a canonical Provenance satisfies the SDK's ingestion mirror. */
function protocolProvenanceIsIngestionProvenance(value: Provenance): IngestionProvenance {
  return value;
}

/** Compiles iff an emitted event IS a canonical MarketEvent (extras tolerated). */
function emittedEventIsMarketEvent(value: EmittedEvent): MarketEvent {
  return value;
}

/** Compiles iff a narrowly-typed emitted trade event is a canonical TradeEvent. */
function emittedTradeIsProtocolTrade(value: EmittedEventFor<'trade'>): TradeEvent {
  return value;
}

/** Compiles iff a narrowly-typed emitted book snapshot is a canonical BookSnapshotEvent. */
function emittedBookIsProtocolBook(value: EmittedEventFor<'book_snapshot'>): BookSnapshotEvent {
  return value;
}

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

const at = (value: number): SdkTimestampMs => value as SdkTimestampMs;

function fixtureDescriptor() {
  const result = validateSourceDescriptor({
    provider: 'fixture-source',
    category: 'market-data',
    capabilities: {
      channels: ['raw-trades', 'raw-book'],
      symbol_universes: [{ universe_id: 'uni-major', asset_class: 'crypto', instruments: ['PAIR-1'] }],
      event_types: ['trade', 'book_snapshot'],
      latency_class: 'realtime',
    },
  });
  if (!result.ok) throw new Error('fixture must validate');
  return result.value;
}

function fixtureTables() {
  const trade = validateMappingTable({
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
      source_time_field: 'vendor_ts',
      availability_basis: 'receive-time',
    },
  });
  const book = validateMappingTable({
    table_id: 'tbl-book',
    event_type: 'book_snapshot',
    fields: [
      { raw_field: 'bids', canonical_field: 'bids', transform: { kind: 'levels', price_field: 'px', size_field: 'sz' } },
      { raw_field: 'asks', canonical_field: 'asks', transform: { kind: 'levels', price_field: 'px', size_field: 'sz' } },
    ],
    constants: [{ canonical_field: 'depth', value: 10 }],
    tolerated: [],
    source_time_policy: {
      event_time_basis: 'receive-time',
      event_time_field: null,
      source_time_field: null,
      availability_basis: 'receive-time',
    },
  });
  if (!trade.ok || !book.ok) throw new Error('fixtures must validate');
  return [trade.value, book.value];
}

/** Run a scripted mixed session and return the emitted events. */
function emitStream(): EmittedEvent[] {
  const transportConstruction = createFakeTransport({
    inbound: [
      { at: at(10_000), channel: 'raw-trades', payload: { ts: 9_960, vendor_ts: 9_950, p: '100.5', q: '0.017', s: 'B', seq: 1 } },
      { at: at(10_020), channel: 'raw-book', payload: { bids: [{ px: '100.25', sz: '1.25' }], asks: [{ px: '100.75', sz: '0.5' }] } },
      { at: at(10_040), channel: 'raw-trades', payload: { ts: 10_000, vendor_ts: 9_990, p: '100.6', q: '0.009', s: 'S', seq: 2 } },
    ],
    recv_failures: [],
    send_failures: [],
    receive_timeout_ms: null,
  });
  if (!transportConstruction.ok) throw new Error('script must validate');
  const construction = createAdapterSession({
    descriptor: fixtureDescriptor(),
    adapter: { id: 'fixture-adapter', version: '1.0.0' },
    transport: transportConstruction.transport,
    mapping_tables: fixtureTables(),
    entitlement: {
      entitlement_id: 'ent-fixture',
      access_class: 'restricted',
      constraints: ['license-tier-2'],
      terms_ref: null,
    },
  });
  if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
  const session = construction.session;
  session.open();
  session.subscribe({
    channel: 'raw-trades',
    request: { symbol: 'PAIR-1' },
    venue: 'VENUE-A',
    instrument: 'PAIR-1',
    asset_class: 'crypto',
    mapping_table_id: 'tbl-trade',
  });
  session.subscribe({
    channel: 'raw-book',
    request: { symbol: 'PAIR-1' },
    venue: 'VENUE-A',
    instrument: 'PAIR-1',
    asset_class: 'crypto',
    mapping_table_id: 'tbl-book',
  });
  const events: EmittedEvent[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok) throw new Error(`unexpected failure: ${next.error.code}`);
    if (next.value === null) break;
    events.push(next.value);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Constant parity.
// ---------------------------------------------------------------------------

describe('constant parity with market-protocol', () => {
  it('the taxonomy and asset-class constants are identical', () => {
    expect([...SDK_EVENT_TYPES]).toEqual([...PROTOCOL_EVENT_TYPES]);
    expect([...SDK_ASSET_CLASSES]).toEqual([...PROTOCOL_ASSET_CLASSES]);
  });

  it('the timestamp mirrors are identical in range and guard verdicts', () => {
    expect(SDK_MIN).toBe(PROTOCOL_MIN);
    expect(SDK_MAX).toBe(PROTOCOL_MAX);
    for (const value of [0, 1, 8_639_999_999_999_999, -1, 8_640_000_000_000_000, 0.5, Number.NaN, '1000']) {
      expect(sdkIsTimestampMs(value)).toBe(protocolIsTimestampMs(value));
    }
  });
});

// ---------------------------------------------------------------------------
// Payload validator verdict parity (the mirror discipline's runtime core).
// ---------------------------------------------------------------------------

describe('payload validator verdict parity', () => {
  const battery: { eventType: string; value: unknown }[] = [
    { eventType: 'trade', value: { price: '1', size: '1', side: 'buy' } },
    { eventType: 'trade', value: { price: '0', size: '1', side: 'buy' } },
    { eventType: 'trade', value: { price: '1', size: '1', side: 'BUY' } },
    { eventType: 'trade', value: { price: 1, size: '1', side: 'buy' } },
    { eventType: 'trade', value: {} },
    { eventType: 'quote', value: { bid_price: '1', bid_size: '1', ask_price: '2', ask_size: '2' } },
    { eventType: 'quote', value: { bid_price: '1', bid_size: '1', ask_price: '0', ask_size: '2' } },
    { eventType: 'book_snapshot', value: { bids: [{ price: '1', size: '1' }], asks: [] } },
    { eventType: 'book_snapshot', value: { bids: [{ price: '1', size: '0' }], asks: [] } },
    { eventType: 'book_snapshot', value: { bids: [], asks: [], depth: -3 } },
    { eventType: 'book_delta', value: { action: 'clear', levels: [] } },
    { eventType: 'book_delta', value: { action: 'clear', levels: [{ price: '1', size: '1' }] } },
    { eventType: 'book_delta', value: { action: 'remove', levels: [{ price: '1', size: '0' }] } },
    { eventType: 'book_delta', value: { action: 'add', levels: [] } },
    { eventType: 'ohlcv', value: { interval: '1m', open: '1', high: '2', low: '0.5', close: '1.5', volume: '0' } },
    { eventType: 'ohlcv', value: { interval: '1m', open: '2', high: '1', low: '0.5', close: '1.5', volume: '0' } },
    { eventType: 'ohlcv', value: { interval: '1q', open: '1', high: '2', low: '0.5', close: '1.5', volume: '0' } },
    { eventType: 'ohlcv', value: { interval: '1m', open: '1', high: '2', low: '0.5', close: '1.5', volume: '1', closed: true, trade_count: 9 } },
    { eventType: 'news', value: { headline: 'h', symbols: ['A'] } },
    { eventType: 'news', value: { headline: 'h', symbols: 'A' } },
    { eventType: 'news', value: { headline: '', symbols: [] } },
    { eventType: 'macro_release', value: { indicator: 'I', region: 'R', period: 'P', actual: 'N/A' } },
    { eventType: 'macro_release', value: { indicator: 'I', region: 'R', period: 'P' } },
    { eventType: 'social_signal', value: { platform: 'p', metric: 'm', value: '-0.21' } },
    { eventType: 'social_signal', value: { platform: 'p', metric: 'm', value: 'high' } },
    { eventType: 'fundamental', value: { field: 'F', period: 'P', value: '6.7B' } },
    { eventType: 'fundamental', value: { field: 'F', period: 'P', value: '' } },
    { eventType: 'option_chain_mark', value: { underlying: 'U', expiry: 1, strike: '1', right: 'put', mark_price: '1' } },
    { eventType: 'option_chain_mark', value: { underlying: 'U', expiry: -1, strike: '1', right: 'put', mark_price: '1' } },
    { eventType: 'other', value: { kind: 'k', data: { a: 1 } } },
    { eventType: 'other', value: { kind: 'k', data: [1] } },
    { eventType: 'other', value: { data: {} } },
  ];

  it('every fixture verdict matches the real market-protocol validator', () => {
    expect(battery.length).toBeGreaterThanOrEqual(30);
    for (const { eventType, value } of battery) {
      const sdkErrors = sdkPayloadRegistry[eventType as keyof typeof sdkPayloadRegistry].validate(value);
      const protocolResult = validateMarketEvent({
        event_id: 'evt-x',
        venue: 'V',
        instrument: 'I',
        asset_class: 'crypto',
        event_type: eventType,
        event_time: 1,
        source_time: null,
        available_time: 1,
        ingestion_time: 1,
        sequence: 0,
        provider: 'p',
        provenance: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null },
        payload: value,
      });
      // The envelope is valid by construction, so payload validity decides.
      const envelopeErrors = protocolResult.ok ? [] : protocolResult.errors;
      const protocolPayloadFailures = envelopeErrors.filter((error) => error.path === 'payload' || error.path.startsWith('payload.'));
      const sdkSaysInvalid = sdkErrors.length > 0;
      const protocolSaysInvalid = protocolPayloadFailures.length > 0;
      expect(sdkSaysInvalid).toBe(protocolSaysInvalid);
    }
  });
});

// ---------------------------------------------------------------------------
// The emitted stream satisfies the canonical contracts.
// ---------------------------------------------------------------------------

describe('the emitted stream passes market-protocol validators (the interop core)', () => {
  it('every emitted event passes the real validateMarketEvent', () => {
    const events = emitStream();
    expect(events).toHaveLength(3);
    for (const event of events) {
      const result = validateMarketEvent(event);
      expect(result.ok).toBe(true);
    }
  });

  it('every emitted provenance block passes the real validateProvenance', () => {
    const events = emitStream();
    for (const event of events) {
      const errors = validateProvenance(event.provenance, event.event_id);
      expect(errors).toEqual([]);
    }
  });

  it('the emitted stream satisfies the canonical sequence discipline (strictly increasing per stream)', () => {
    const events = emitStream();
    const validation = validateSequenceMonotonicity(events as unknown as readonly MarketEvent[]);
    expect(validation.violations).toEqual([]);
  });

  it('the emitted records carry the quartet and tolerate the SDK extras (floor semantics)', () => {
    const events = emitStream();
    for (const event of events) {
      expect(event.event_time).toBeGreaterThan(0);
      expect(event.available_time).toBeGreaterThanOrEqual(event.event_time);
      // extras ride as tolerated unknown fields — the canonical floor ignores them
      expect((event as unknown as Record<string, unknown>).entitlement).toBeDefined();
      expect((event as unknown as Record<string, unknown>).mapping).toBeDefined();
    }
  });
});
