/**
 * @tradrl/adapter-binance — cross-package interop trip wires.
 *
 * Acceptance criterion 5 and 10. The adapter's contract shapes are
 * STRUCTURAL MIRRORS of @tradrl/provider-sdk (law D-004: never imports in
 * sources); this test is the trip wire — if any mirror drifts, the
 * TYPE-LEVEL witnesses below fail `pnpm exec tsc -p adapters/binance`,
 * and the RUNTIME parity checks fail the package test run. Cross-package
 * imports happen ONLY in tests, via relative paths (the repo's
 * established pattern).
 *
 * What is proven here:
 *   1. TYPE LEVEL: this adapter's session IS an SDK AdapterSession; its
 *      EmittedEvent union IS an SDK EmittedEvent; TimestampMs and the
 *      provenance blocks are mutually assignable — NO CASTS anywhere.
 *   2. RUNTIME: the taxonomy and asset-class constants are identical.
 *   3. RUNTIME: payload-validator VERDICT PARITY against the real SDK
 *      AND the real market-protocol for a battery of valid and invalid
 *      fixtures across every emittable canonical type.
 *   4. RUNTIME: the REAL SDK's adapterContractCases (the exact contract
 *      suite every adapter MUST pass) drives THIS adapter's session —
 *      lifecycle, error paths, quartet, lineage, entitlement,
 *      determinism, unmangled pass-through — with zero adaptation.
 *   5. RUNTIME: an adapter-emitted stream (scripted session) passes
 *      market-protocol's OWN validateMarketEvent, validateProvenance and
 *      validateSequenceMonotonicity — the emitted records structurally
 *      satisfy the canonical contracts (criterion 10).
 */

import { describe, expect, it } from 'vitest';

import {
  EVENT_TYPES as ADAPTER_EVENT_TYPES,
  ASSET_CLASSES as ADAPTER_ASSET_CLASSES,
  EMITTABLE_EVENT_TYPES,
  isTimestampMs as adapterIsTimestampMs,
  MIN_TIMESTAMP_MS as ADAPTER_MIN,
  MAX_TIMESTAMP_MS as ADAPTER_MAX,
  payloadRegistry as adapterPayloadRegistry,
  validateTradePayload as adapterValidateTrade,
  validateQuotePayload as adapterValidateQuote,
  validateBookSnapshotPayload as adapterValidateBookSnapshot,
  validateBookDeltaPayload as adapterValidateBookDelta,
  createBinanceAdapterSession,
  createBinanceSessionWithoutEntitlement,
  binanceSubscription,
  BINANCE_ENTITLEMENT,
  BINANCE_SOURCE_DESCRIPTOR,
  type TimestampMs as AdapterTimestampMs,
  type EmittedEvent as AdapterEmittedEvent,
  type EmittedEventFor as AdapterEmittedEventFor,
  type IngestionProvenance as AdapterIngestionProvenance,
  type SourceDescriptor as AdapterSourceDescriptor,
  type MappingTable as AdapterMappingTable,
  type EntitlementEnvelope as AdapterEntitlementEnvelope,
  type RateQuotaEnvelope as AdapterRateQuotaEnvelope,
  type AdapterSession as AdapterAdapterSession,
  type TransportPort as AdapterTransportPort,
} from './index';

import {
  adapterContractCases,
  createFakeTransport,
  type AdapterContractSubject,
  type AdapterSession as SdkAdapterSession,
  type EmittedEvent as SdkEmittedEvent,
  type EmittedEventFor as SdkEmittedEventFor,
  type EventId as SdkEventId,
  type IngestionProvenance as SdkIngestionProvenance,
  type LineageId as SdkLineageId,
  type MappingTableId as SdkMappingTableId,
  type ProviderId as SdkProviderId,
  type SourceDescriptor as SdkSourceDescriptor,
  type MappingTable as SdkMappingTable,
  type EntitlementEnvelope as SdkEntitlementEnvelope,
  type RateQuotaEnvelope as SdkRateQuotaEnvelope,
  type TimestampMs as SdkTimestampMs,
  type TransportPort as SdkTransportPort,
  type VenueId as SdkVenueId,
  type TransportScript,
} from '../../../packages/provider-sdk/src/index';

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
  type Provenance,
  type TimestampMs as ProtocolTimestampMs,
  type TradeEvent,
  type BookDeltaEvent,
} from '../../../packages/market-protocol/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm exec tsc -p adapters/binance` on drift).
// No casts: the mirrors must be structurally identical.
// ---------------------------------------------------------------------------

/** Compiles iff the adapter's TimestampMs mirror is mutually assignable with the SDK's. */
function adapterTimestampIsSdkTimestamp(value: AdapterTimestampMs): SdkTimestampMs {
  return value;
}

/** Compiles iff the SDK's TimestampMs is assignable to the adapter's mirror. */
function sdkTimestampIsAdapterTimestamp(value: SdkTimestampMs): AdapterTimestampMs {
  return value;
}

/** Compiles iff the SDK's TimestampMs is assignable to the canonical one (chained parity). */
function sdkTimestampIsProtocolTimestamp(value: SdkTimestampMs): ProtocolTimestampMs {
  return value;
}

/** Compiles iff the adapter's provenance block IS an SDK IngestionProvenance. */
function adapterProvenanceIsSdkProvenance(value: AdapterIngestionProvenance): SdkIngestionProvenance {
  return value;
}

/** Compiles iff an SDK IngestionProvenance satisfies the adapter's mirror. */
function sdkProvenanceIsAdapterProvenance(value: SdkIngestionProvenance): AdapterIngestionProvenance {
  return value;
}

/** Compiles iff an adapter provenance block IS a canonical market-protocol Provenance. */
function adapterProvenanceIsProtocolProvenance(value: AdapterIngestionProvenance): Provenance {
  return value;
}

/** Compiles iff the adapter's EmittedEvent union IS an SDK EmittedEvent (no cast). */
function adapterEventIsSdkEvent(value: AdapterEmittedEvent): SdkEmittedEvent {
  return value;
}

/** Compiles iff a narrowly-typed adapter trade event IS an SDK trade event. */
function adapterTradeIsSdkTrade(value: AdapterEmittedEventFor<'trade'>): SdkEmittedEventFor<'trade'> {
  return value;
}

/** Compiles iff a narrowly-typed adapter book delta IS an SDK book delta event. */
function adapterBookDeltaIsSdkBookDelta(value: AdapterEmittedEventFor<'book_delta'>): SdkEmittedEventFor<'book_delta'> {
  return value;
}

/** Compiles iff an adapter trade event IS a canonical market-protocol TradeEvent. */
function adapterTradeIsProtocolTrade(value: AdapterEmittedEventFor<'trade'>): TradeEvent {
  return value;
}

/** Compiles iff an adapter book delta IS a canonical market-protocol BookDeltaEvent. */
function adapterBookDeltaIsProtocolBookDelta(value: AdapterEmittedEventFor<'book_delta'>): BookDeltaEvent {
  return value;
}

/** Compiles iff the adapter's descriptor IS an SDK SourceDescriptor. */
function adapterDescriptorIsSdkDescriptor(value: AdapterSourceDescriptor): SdkSourceDescriptor {
  return value;
}

/** Compiles iff an adapter mapping table IS an SDK MappingTable. */
function adapterTableIsSdkTable(value: AdapterMappingTable): SdkMappingTable {
  return value;
}

/** Compiles iff the adapter's entitlement envelope IS an SDK EntitlementEnvelope. */
function adapterEntitlementIsSdkEntitlement(value: AdapterEntitlementEnvelope): SdkEntitlementEnvelope {
  return value;
}

/** Compiles iff the adapter's quota envelope IS an SDK RateQuotaEnvelope. */
function adapterQuotaIsSdkQuota(value: AdapterRateQuotaEnvelope): SdkRateQuotaEnvelope {
  return value;
}

/** Compiles iff THE ADAPTER'S SESSION IS AN SDK ADAPTER SESSION (the contract-suite bridge). */
function adapterSessionIsSdkSession(value: AdapterAdapterSession): SdkAdapterSession {
  return value;
}

/** Compiles iff the SDK's transport port shape satisfies the adapter's mirror. */
function sdkTransportIsAdapterTransport(value: SdkTransportPort): AdapterTransportPort {
  return value;
}

/** Compiles iff the adapter's opaque ids are the SDK's (opaque strings, shared discipline). */
function adapterOpaqueIdsAreSdkOpaqueIds(
  provider: SdkProviderId,
  venue: SdkVenueId,
  event: SdkEventId,
  lineage: SdkLineageId,
  table: SdkMappingTableId,
): void {
  const witnesses: [AdapterSourceDescriptor['provider'], AdapterEmittedEvent['event_id'], AdapterMappingTable['table_id']] = [
    provider,
    event,
    table,
  ];
  const venueLineage: [SdkVenueId, SdkLineageId] = [venue, lineage];
  void witnesses;
  void venueLineage;
}

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

const ms = (value: number): SdkTimestampMs => value as SdkTimestampMs;
const AT0 = 1_717_423_200_000;

const binanceTrade = (t: number, id: number) => ({
  e: 'trade',
  E: AT0 + t,
  s: 'BTCUSDT',
  t: id,
  p: '43125.10000000',
  q: '0.01700000',
  T: AT0 + t,
  m: false,
});

const validScript: TransportScript = {
  inbound: [
    { at: ms(AT0), channel: 'trade', payload: binanceTrade(0, 100234) },
    { at: ms(AT0 + 40), channel: 'trade', payload: { ...binanceTrade(40, 100235), m: true } },
  ],
  recv_failures: [],
  send_failures: [],
  receive_timeout_ms: null,
};

const unmappedFieldScript: TransportScript = {
  inbound: [
    { at: ms(AT0), channel: 'trade', payload: { ...binanceTrade(0, 100234), vendor_extra: 'surprise' } },
  ],
  recv_failures: [],
  send_failures: [],
  receive_timeout_ms: null,
};

const subscription = binanceSubscription({ channel: 'trade', instrument: 'BTC-USDT', request_id: 1 });
if (!subscription.ok) throw new Error(`the subject subscription must build: ${subscription.error.message}`);

/** The adapter contract subject: NO CASTS — the session factory returns SDK-typed sessions. */
const subject: AdapterContractSubject = {
  descriptor: BINANCE_SOURCE_DESCRIPTOR,
  subscription: subscription.value,
  validScript,
  unmappedFieldScript,
  createSession: (transport: SdkTransportPort): SdkAdapterSession => {
    const construction = createBinanceAdapterSession({ transport, entitlement: BINANCE_ENTITLEMENT });
    if (!construction.ok) {
      throw new Error(`the subject session must construct: ${JSON.stringify(construction.errors)}`);
    }
    return construction.session;
  },
  createSessionWithoutEntitlement: (transport: SdkTransportPort): SdkAdapterSession => {
    const construction = createBinanceSessionWithoutEntitlement(transport);
    if (!construction.ok) {
      throw new Error(`the refusal-path session must construct: ${JSON.stringify(construction.errors)}`);
    }
    return construction.session;
  },
};

// ---------------------------------------------------------------------------
// Constant parity (the mirrors cannot drift).
// ---------------------------------------------------------------------------

describe('constant parity with the real SDK and market-protocol', () => {
  it('the taxonomy and asset-class constants are identical', () => {
    expect([...ADAPTER_EVENT_TYPES]).toEqual([...PROTOCOL_EVENT_TYPES]);
    expect([...ADAPTER_ASSET_CLASSES]).toEqual([...PROTOCOL_ASSET_CLASSES]);
  });

  it('the emittable set is a subset of the canonical taxonomy', () => {
    for (const type of EMITTABLE_EVENT_TYPES) {
      expect(PROTOCOL_EVENT_TYPES).toContain(type);
    }
  });

  it('the timestamp mirrors are identical in range and guard verdicts', () => {
    expect(ADAPTER_MIN).toBe(PROTOCOL_MIN);
    expect(ADAPTER_MAX).toBe(PROTOCOL_MAX);
    for (const value of [0, 1, 8_639_999_999_999_999, -1, 8_640_000_000_000_000, 0.5, Number.NaN, '1000']) {
      expect(adapterIsTimestampMs(value)).toBe(protocolIsTimestampMs(value));
    }
  });
});

// ---------------------------------------------------------------------------
// Payload validator verdict parity (the mirror discipline's runtime core).
// ---------------------------------------------------------------------------

describe('payload validator verdict parity (adapter mirror vs real SDK vs real market-protocol)', () => {
  const battery: { eventType: string; value: unknown }[] = [
    { eventType: 'trade', value: { price: '1', size: '1', side: 'buy' } },
    { eventType: 'trade', value: { price: '0', size: '1', side: 'buy' } },
    { eventType: 'trade', value: { price: '1', size: '1', side: 'BUY' } },
    { eventType: 'trade', value: { price: 1, size: '1', side: 'buy' } },
    { eventType: 'trade', value: { price: '1', size: '1', side: 'buy', trade_id: '9' } },
    { eventType: 'trade', value: { price: '1', size: '1', side: 'buy', trade_id: '' } },
    { eventType: 'trade', value: {} },
    { eventType: 'quote', value: { bid_price: '1', bid_size: '1', ask_price: '2', ask_size: '2' } },
    { eventType: 'quote', value: { bid_price: '1', bid_size: '1', ask_price: '0', ask_size: '2' } },
    { eventType: 'quote', value: { bid_price: '1', bid_size: '1', ask_price: '2' } },
    { eventType: 'book_snapshot', value: { bids: [{ price: '1', size: '1' }], asks: [] } },
    { eventType: 'book_snapshot', value: { bids: [{ price: '1', size: '0' }], asks: [] } },
    { eventType: 'book_snapshot', value: { bids: [], asks: [], depth: -3 } },
    { eventType: 'book_snapshot', value: { bids: [], asks: [], last_update_id: '160' } },
    { eventType: 'book_snapshot', value: { bids: [], asks: [], last_update_id: '' } },
    { eventType: 'book_delta', value: { action: 'clear', levels: [] } },
    { eventType: 'book_delta', value: { action: 'clear', levels: [{ price: '1', size: '1' }] } },
    { eventType: 'book_delta', value: { action: 'remove', levels: [{ price: '1', size: '0' }] } },
    { eventType: 'book_delta', value: { action: 'add', levels: [] } },
    { eventType: 'book_delta', value: { action: 'update', levels: [{ price: '1', size: '0' }] } },
    { eventType: 'book_delta', value: { action: 'grow', levels: [] } },
    { eventType: 'book_delta', value: { action: 'update', levels: [{ price: '1', size: '1' }], last_update_id: '160' } },
  ];

  it('every fixture verdict matches the real SDK validator and the real market-protocol validator', () => {
    expect(battery.length).toBeGreaterThanOrEqual(20);
    const adapters: Record<string, (value: unknown) => readonly { message: string }[]> = {
      trade: adapterValidateTrade,
      quote: adapterValidateQuote,
      book_snapshot: adapterValidateBookSnapshot,
      book_delta: adapterValidateBookDelta,
    };
    for (const { eventType, value } of battery) {
      const adapterErrors = adapters[eventType](value);
      const sdkErrors = adapterPayloadRegistry[eventType as keyof typeof adapterPayloadRegistry].validate(value);
      const protocolResult = validateMarketEvent({
        event_id: 'evt-x',
        venue: 'V',
        instrument: 'I',
        asset_class: 'crypto',
        event_type: eventType,
        event_time: ms(1),
        source_time: null,
        available_time: ms(1),
        ingestion_time: ms(1),
        sequence: 0,
        provider: 'p',
        provenance: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null },
        payload: value,
      });
      const envelopeErrors = protocolResult.ok ? [] : protocolResult.errors;
      const protocolPayloadFailures = envelopeErrors.filter((error) => error.path === 'payload' || error.path.startsWith('payload.'));
      expect(adapterErrors.length > 0).toBe(sdkErrors.length > 0);
      expect(adapterErrors.length > 0).toBe(protocolPayloadFailures.length > 0);
    }
  });
});

// ---------------------------------------------------------------------------
// THE REAL SDK CONTRACT SUITE (criterion 5) — zero adaptation, no casts.
// ---------------------------------------------------------------------------

describe('the REAL SDK adapter contract suite drives this adapter (criterion 5)', () => {
  const cases = adapterContractCases(subject);

  it('exposes the full contract suite (11 cases, the SDK owns the names)', () => {
    expect(cases.length).toBe(11);
  });

  it('every case passes against the Binance adapter session', () => {
    for (const contractCase of cases) {
      expect(() => contractCase.run()).not.toThrow();
    }
  });

  it('the lifecycle case emits real canonical trade events (not vacuous)', () => {
    const transport = createFakeTransport(validScript);
    if (!transport.ok) throw new Error('script must validate');
    const session = subject.createSession(transport.transport);
    session.open();
    const subscribed = session.subscribe(subject.subscription);
    if (!subscribed.ok) throw new Error('subscribe must succeed');
    const events: SdkEmittedEvent[] = [];
    for (;;) {
      const next = session.nextEvent();
      if (!next.ok) throw new Error('drain must succeed');
      if (next.value === null) break;
      events.push(next.value);
    }
    expect(events.length).toBe(2);
    expect(events[0].event_type).toBe('trade');
    const [first, second] = events;
    if (first.event_type !== 'trade' || second.event_type !== 'trade') throw new Error('must be trade events');
    expect(first.payload.side).toBe('buy');
    expect(second.payload.side).toBe('sell');
  });
});

// ---------------------------------------------------------------------------
// The emitted stream satisfies the canonical contracts (criterion 10).
// ---------------------------------------------------------------------------

describe('the emitted stream passes market-protocol validators (the interop core)', () => {
  function emitMixed(): SdkEmittedEvent[] {
    const transportScript: TransportScript = {
      inbound: [
        { at: ms(AT0), channel: 'trade', payload: binanceTrade(0, 100234) },
        {
          at: ms(AT0 + 10),
          channel: 'bookTicker',
          payload: { u: 1, s: 'BTCUSDT', b: '43125.10', B: '31.21', a: '43125.36', A: '40.66' },
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
              ['43125.20', '1.1'],
              ['43124.10', '0'],
            ],
            a: [['43126.30', '0.5']],
          },
        },
        {
          at: ms(AT0 + 30),
          channel: 'depth',
          payload: { lastUpdateId: 160, bids: [['43125.20', '1.1']], asks: [['43126.30', '0.5']] },
        },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const transport = createFakeTransport(transportScript);
    if (!transport.ok) throw new Error('script must validate');
    const construction = createBinanceAdapterSession({ transport: transport.transport, entitlement: BINANCE_ENTITLEMENT });
    if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
    const session = construction.session;
    session.open();
    for (const [channel, id] of [
      ['trade', 1],
      ['bookTicker', 2],
      ['depthDiff', 3],
      ['depth', 4],
    ] as const) {
      const spec = binanceSubscription({ channel, instrument: 'BTC-USDT', request_id: id });
      if (!spec.ok) throw new Error('subscription must build');
      const sent = session.subscribe(spec.value);
      if (!sent.ok) throw new Error(`subscribe must succeed: ${sent.error.message}`);
    }
    const events: SdkEmittedEvent[] = [];
    for (;;) {
      const next = session.nextEvent();
      if (!next.ok) throw new Error(`unexpected failure: ${next.error.code}`);
      if (next.value === null) break;
      events.push(next.value);
    }
    return events;
  }

  it('every emitted event passes the real validateMarketEvent', () => {
    const events = emitMixed();
    expect(events.length).toBe(5);
    for (const event of events) {
      const result = validateMarketEvent(event);
      expect(result.ok).toBe(true);
    }
  });

  it('every emitted provenance block passes the real validateProvenance', () => {
    const events = emitMixed();
    for (const event of events) {
      const errors = validateProvenance(event.provenance, event.event_id);
      expect(errors).toEqual([]);
    }
  });

  it('the emitted stream satisfies the canonical sequence discipline (strictly increasing per stream)', () => {
    const events = emitMixed();
    const validation = validateSequenceMonotonicity(events as unknown as readonly MarketEvent[]);
    expect(validation.violations).toEqual([]);
  });

  it('the emitted records carry the quartet and tolerate the SDK extras (floor semantics)', () => {
    const events = emitMixed();
    for (const event of events) {
      expect(event.event_time).toBeGreaterThan(0);
      expect(event.available_time).toBeGreaterThanOrEqual(event.event_time);
      expect((event as unknown as Record<string, unknown>).entitlement).toBeDefined();
      expect((event as unknown as Record<string, unknown>).mapping).toBeDefined();
    }
  });

  it('the book_delta split events carry update-id continuity (criterion 9, through the canonical lens)', () => {
    const events = emitMixed();
    // The canonical floor tolerates the SDK extras, so the filtered stream is
    // structurally the canonical BookDeltaEvent stream (cast only in the test).
    const deltas = events.filter((event) => event.event_type === 'book_delta') as unknown as BookDeltaEvent[];
    expect(deltas.length).toBe(2);
    expect(deltas[0].payload.action).toBe('update');
    expect(deltas[1].payload.action).toBe('remove');
    expect(deltas[0].payload.last_update_id).toBe('160');
    expect(deltas[1].payload.last_update_id).toBe('160');
    expect(deltas[0].sequence).toBeLessThan(deltas[1].sequence);
  });
});

// ---------------------------------------------------------------------------
// Determinism through the REAL SDK harness (criterion 3, cross-checked).
// ---------------------------------------------------------------------------

describe('determinism (deep-equal, twice — through the real SDK contract case too)', () => {
  it('the SDK determinism contract case passes (byte-identical JSON)', () => {
    const determinismCase = adapterContractCases(subject).find((contractCase) =>
      contractCase.name.includes('byte-identical'),
    );
    expect(determinismCase).toBeDefined();
    if (determinismCase !== undefined) {
      expect(() => determinismCase.run()).not.toThrow();
    }
  });
});
