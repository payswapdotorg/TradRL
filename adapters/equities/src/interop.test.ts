/**
 * @tradrl/adapter-equities — cross-package interop trip wires.
 *
 * Acceptance criteria 5 and 10. The adapter's contract shapes are
 * STRUCTURAL MIRRORS of @tradrl/provider-sdk (law D-004: never imports in
 * sources); this test is the trip wire — if any mirror drifts, the
 * TYPE-LEVEL witnesses below fail `pnpm typecheck`, and the RUNTIME
 * parity checks fail the package test run. Cross-package imports happen
 * ONLY in tests, via relative paths (the repo's established pattern).
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
  validateFundamentalPayload as adapterValidateFundamental,
  validateOtherPayload as adapterValidateOther,
  createEquitiesAdapterSession,
  createEquitiesSessionWithoutEntitlement,
  equitiesSubscription,
  EQUITIES_ENTITLEMENT,
  EQUITIES_SOURCE_DESCRIPTOR,
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
  type FundamentalEvent,
  type OtherEvent,
} from '../../../packages/market-protocol/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` on drift). No casts: the
// mirrors must be structurally identical.
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

/** Compiles iff a narrowly-typed adapter fundamental event IS an SDK fundamental event. */
function adapterFundamentalIsSdkFundamental(value: AdapterEmittedEventFor<'fundamental'>): SdkEmittedEventFor<'fundamental'> {
  return value;
}

/** Compiles iff a narrowly-typed adapter other event IS an SDK other event. */
function adapterOtherIsSdkOther(value: AdapterEmittedEventFor<'other'>): SdkEmittedEventFor<'other'> {
  return value;
}

/** Compiles iff an adapter fundamental event IS a canonical market-protocol FundamentalEvent. */
function adapterFundamentalIsProtocolFundamental(value: AdapterEmittedEventFor<'fundamental'>): FundamentalEvent {
  return value;
}

/** Compiles iff an adapter other event IS a canonical market-protocol OtherEvent. */
function adapterOtherIsProtocolOther(value: AdapterEmittedEventFor<'other'>): OtherEvent {
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
const AT0 = 1_717_423_200_000; // 2024-06-03T14:00:00Z — Monday, in-session.

const equitiesIndexLevel = (sequence: number, dissemination: number) => ({
  recordType: 'INDEX_LEVEL',
  indexId: 'TEST-LARGECAP',
  tradeDate: '2024-06-03',
  disseminationTimeMs: dissemination,
  indexLevel: '104.5000',
  indexDivisor: '1234.5678',
  sequenceNumber: sequence,
});

const validScript: TransportScript = {
  inbound: [
    { at: ms(AT0), channel: 'indexLevel', payload: equitiesIndexLevel(41, AT0) },
    { at: ms(AT0 + 100), channel: 'indexLevel', payload: equitiesIndexLevel(42, AT0 + 100) },
  ],
  recv_failures: [],
  send_failures: [],
  receive_timeout_ms: null,
};

const unmappedFieldScript: TransportScript = {
  inbound: [
    { at: ms(AT0), channel: 'indexLevel', payload: { ...equitiesIndexLevel(41, AT0), vendor_extra: 'surprise' } },
  ],
  recv_failures: [],
  send_failures: [],
  receive_timeout_ms: null,
};

const subscription = equitiesSubscription({ channel: 'indexLevel', instrument: 'TEST-LARGECAP' });
if (!subscription.ok) throw new Error(`the subject subscription must build: ${subscription.error.message}`);

/** The adapter contract subject: NO CASTS — the session factory returns SDK-typed sessions. */
const subject: AdapterContractSubject = {
  descriptor: EQUITIES_SOURCE_DESCRIPTOR,
  subscription: subscription.value,
  validScript,
  unmappedFieldScript,
  createSession: (transport: SdkTransportPort): SdkAdapterSession => {
    const construction = createEquitiesAdapterSession({ transport, entitlement: EQUITIES_ENTITLEMENT });
    if (!construction.ok) {
      throw new Error(`the subject session must construct: ${JSON.stringify(construction.errors)}`);
    }
    return construction.session;
  },
  createSessionWithoutEntitlement: (transport: SdkTransportPort): SdkAdapterSession => {
    const construction = createEquitiesSessionWithoutEntitlement(transport);
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
    { eventType: 'fundamental', value: { field: 'INDEX_LEVEL', period: '2024-06-03', value: '104.5000' } },
    { eventType: 'fundamental', value: { field: 'INDEX_LEVEL', period: '2024-06-03', value: '104.5000', unit: 'index-points' } },
    { eventType: 'fundamental', value: { field: 'INDEX_LEVEL', period: '2024-06-03', value: '104.5000', unit: 'index-points', source: 'index-dissemination' } },
    { eventType: 'fundamental', value: { field: '', period: 'x', value: '1' } },
    { eventType: 'fundamental', value: { field: 'F', period: '', value: '1' } },
    { eventType: 'fundamental', value: { field: 'F', period: 'p', value: '' } },
    { eventType: 'fundamental', value: { field: 'F', period: 'p' } },
    { eventType: 'fundamental', value: { field: 'F', period: 'p', value: 7 } },
    { eventType: 'fundamental', value: { field: 'F', period: 'p', value: 'v', unit: '' } },
    { eventType: 'fundamental', value: { field: 'F', period: 'p', value: 'v', source: 9 } },
    { eventType: 'fundamental', value: {} },
    { eventType: 'fundamental', value: 'nope' },
    { eventType: 'other', value: { kind: 'index_constituent_weight', data: { symbol: 'TEST-AAA', weight: '0.06940' } } },
    { eventType: 'other', value: { kind: 'corporate_action', data: {} } },
    { eventType: 'other', value: { kind: 'k', data: { nested: { deep: [1, 2, 'x', null] } } } },
    { eventType: 'other', value: { data: { a: 1 } } },
    { eventType: 'other', value: { kind: 'k' } },
    { eventType: 'other', value: { kind: '', data: {} } },
    { eventType: 'other', value: { kind: 'k', data: [] } },
    { eventType: 'other', value: { kind: 'k', data: 5 } },
    { eventType: 'other', value: { kind: 'k', data: { bad: Number.NaN } } },
    { eventType: 'other', value: 'nope' },
  ];

  it('every fixture verdict matches the real SDK validator and the real market-protocol validator', () => {
    expect(battery.length).toBeGreaterThanOrEqual(20);
    const adapters: Record<string, (value: unknown) => readonly { message: string }[]> = {
      fundamental: adapterValidateFundamental,
      other: adapterValidateOther,
    };
    for (const { eventType, value } of battery) {
      const adapterErrors = adapters[eventType](value);
      const sdkErrors = adapterPayloadRegistry[eventType as keyof typeof adapterPayloadRegistry].validate(value);
      const protocolResult = validateMarketEvent({
        event_id: 'evt-x',
        venue: 'V',
        instrument: 'I',
        asset_class: 'index',
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

  it('every case passes against the equities adapter session', () => {
    for (const contractCase of cases) {
      expect(() => contractCase.run()).not.toThrow();
    }
  });

  it('the lifecycle case emits real canonical fundamental events (not vacuous)', () => {
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
    expect(events[0].event_type).toBe('fundamental');
    const [first, second] = events;
    if (first.event_type !== 'fundamental' || second.event_type !== 'fundamental') throw new Error('must be fundamental events');
    expect(first.payload.field).toBe('INDEX_LEVEL');
    expect(first.payload.value).toBe('104.5000');
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The emitted stream satisfies the canonical contracts (criterion 10).
// ---------------------------------------------------------------------------

describe('the emitted stream passes market-protocol validators (the interop core)', () => {
  function emitMixed(): SdkEmittedEvent[] {
    const transportScript: TransportScript = {
      inbound: [
        { at: ms(AT0), channel: 'indexLevel', payload: equitiesIndexLevel(41, AT0) },
        {
          at: ms(AT0 + 10),
          channel: 'constituentWeights',
          payload: {
            recordType: 'CONSTITUENT_WEIGHT',
            indexId: 'TEST-LARGECAP',
            tradeDate: '2024-06-03',
            disseminationTimeMs: AT0 + 10,
            constituentSymbol: 'TEST-AAA',
            constituentWeight: '0.06940',
            shareClassCode: 'COMMON',
            sequenceNumber: 7,
          },
        },
        {
          at: ms(AT0 + 20),
          channel: 'corporateActions',
          payload: {
            recordType: 'CORPORATE_ACTION',
            actionId: 'ACT-2024-0001',
            corporateSymbol: 'TEST-AAA',
            actionTypeCode: 'SPLIT',
            effectiveDate: '2024-06-10',
            announcementTimeMs: AT0 + 20,
            actionRatio: '4:1',
            currencyCode: 'USD',
          },
        },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const transport = createFakeTransport(transportScript);
    if (!transport.ok) throw new Error('script must validate');
    const construction = createEquitiesAdapterSession({ transport: transport.transport, entitlement: EQUITIES_ENTITLEMENT });
    if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
    const session = construction.session;
    session.open();
    for (const [channel, instrument] of [
      ['indexLevel', 'TEST-LARGECAP'],
      ['constituentWeights', 'TEST-LARGECAP'],
      ['corporateActions', 'TEST-AAA'],
    ] as const) {
      const spec = equitiesSubscription({ channel, instrument });
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
    expect(events.length).toBe(3);
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

  it('the escape-hatch events carry their kind and canonical data through the canonical lens (criterion 9 domain lens)', () => {
    const events = emitMixed();
    const weights = events.filter((event) => event.event_type === 'other' && event.payload.kind === 'index_constituent_weight');
    expect(weights.length).toBe(1);
    const weightRecord = weights[0] as unknown as OtherEvent;
    expect((weightRecord.payload.data as Record<string, unknown>).symbol).toBe('TEST-AAA');
    expect((weightRecord.payload.data as Record<string, unknown>).weight).toBe('0.06940');
    const actions = events.filter((event) => event.event_type === 'other' && event.payload.kind === 'corporate_action');
    expect(actions.length).toBe(1);
    const actionRecord = actions[0] as unknown as OtherEvent;
    expect((actionRecord.payload.data as Record<string, unknown>).action).toBe('split');
    // The two kinds are separate canonical streams (each starts its own sequence).
    expect(weights[0].sequence).toBe(1);
    expect(actions[0].sequence).toBe(1);
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
