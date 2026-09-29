/**
 * @tradrl/adapter-oms-ems — cross-package interop trip wires.
 *
 * Acceptance criteria 5 and 10 (plus the L8 evidence and THE
 * CROSS-ADAPTER FLOW). The adapter's contract shapes are STRUCTURAL
 * MIRRORS of @tradrl/provider-sdk (law D-004: never imports in sources);
 * this test is the trip wire — if any mirror drifts, the TYPE-LEVEL
 * witnesses below fail `pnpm typecheck`, and the RUNTIME parity checks
 * fail the package test run. Cross-package imports happen ONLY in
 * tests, via relative paths (the repo's established pattern).
 *
 * What is proven here:
 *   1. TYPE LEVEL: this adapter's session IS an SDK AdapterSession; its
 *      EmittedEvent union IS an SDK EmittedEvent; TimestampMs and the
 *      provenance blocks are mutually assignable — NO CASTS anywhere.
 *   2. RUNTIME: the taxonomy and asset-class constants are identical.
 *   3. RUNTIME: payload-validator VERDICT PARITY against the real SDK
 *      AND the real market-protocol for a battery of valid and invalid
 *      `other` fixtures.
 *   4. RUNTIME: the REAL SDK's adapterContractCases (the exact contract
 *      suite every adapter MUST pass) drives THIS adapter's session —
 *      lifecycle, error paths, quartet, lineage, entitlement,
 *      determinism, unmangled pass-through — with zero adaptation.
 *   5. RUNTIME: an adapter-emitted stream (scripted session) passes
 *      market-protocol's OWN validateMarketEvent, validateProvenance and
 *      validateSequenceMonotonicity — the emitted records structurally
 *      satisfy the canonical contracts (criterion 10).
 *   6. L8 EVIDENCE: the REAL T019 gate (runExecutionGate, over the real
 *      execution-policy fixtures) produces a REAL ApproveDecision, and
 *      THIS adapter's routing path ACCEPTS it (the positive path) and
 *      REFUSES its RefusalDecision twin (the negative path).
 *   7. THE CROSS-ADAPTER FLOW: the sibling BROKER adapter's emitted
 *      execution-report events (canonical `other` payloads) flow into
 *      THIS adapter's reconciliation engine alongside this adapter's own
 *      emitted order-state events — the whole T039 execution lane,
 *      end-to-end, in CANONICAL shapes only (no provider vocabulary
 *      crosses the package boundary).
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
  validateOtherPayload as adapterValidateOther,
  createOmsEmsAdapterSession,
  createOmsEmsSessionWithoutEntitlement,
  omsEmsOrderStateSubscription,
  buildOmsEmsRoutingInstruction,
  reconcileOrderState,
  OMS_EMS_ENTITLEMENT,
  OMS_EMS_SOURCE_DESCRIPTOR,
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
  type OtherEvent,
} from '../../../packages/market-protocol/src/index';

import {
  runExecutionGate,
  validateExecutionPolicy,
  isApproveDecision as t019IsApproveDecision,
  isRefusalDecision as t019IsRefusalDecision,
  type ExecutionPolicy,
} from '../../../packages/execution-policy/src/index';
import {
  fixtureIntent as t019FixtureIntent,
  fixturePortfolio,
  fixtureVenueState,
  fixtureKillSwitch,
  fixturePolicyInput,
  unwrap as t019Unwrap,
} from '../../../packages/execution-policy/src/test-fixtures';

import {
  createBrokerAdapterSession,
  brokerExecutionReportSubscription,
  BROKER_ENTITLEMENT,
} from '../../brokers/src/index';
import { fixtureReportData, fixtureFilledStateData, fixtureIntent, fixtureStandingSwitch } from './test-fixtures';

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

/** Compiles iff a narrowly-typed adapter other event IS an SDK other event. */
function adapterOtherIsSdkOther(value: AdapterEmittedEventFor<'other'>): SdkEmittedEventFor<'other'> {
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
const T0 = 1_717_459_200_000;

const stateMessage = (sequence: number, status: string, filled: string, leaves: string) => ({
  recordType: 'ORDER_STATE',
  orderId: 'TEST-ORDER-1',
  clOrdId: 't019-fx-1',
  sequence,
  status,
  venue: 'BROKER-FIX',
  orderQty: '0.5',
  filledQty: filled,
  leavesQty: leaves,
  avgPx: '0',
  updatedAt: '2024-06-04T00:00:00.000Z',
});

const validScript: TransportScript = {
  inbound: [
    { at: ms(T0), channel: 'orderState', payload: stateMessage(1, 'NEW', '0', '0.5') as never },
    { at: ms(T0 + 500), channel: 'orderState', payload: stateMessage(2, 'NEW', '0', '0.5') as never },
  ],
  recv_failures: [],
  send_failures: [],
  receive_timeout_ms: null,
};

const unmappedFieldScript: TransportScript = {
  inbound: [
    { at: ms(T0), channel: 'orderState', payload: { ...stateMessage(1, 'NEW', '0', '0.5'), vendor_extra: 'surprise' } as never },
  ],
  recv_failures: [],
  send_failures: [],
  receive_timeout_ms: null,
};

const subscription = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
if (!subscription.ok) throw new Error(`the subject subscription must build: ${subscription.error.message}`);

/** The adapter contract subject: NO CASTS — the session factory returns SDK-typed sessions. */
const subject: AdapterContractSubject = {
  descriptor: OMS_EMS_SOURCE_DESCRIPTOR,
  subscription: subscription.value,
  validScript,
  unmappedFieldScript,
  createSession: (transport: SdkTransportPort): SdkAdapterSession => {
    const construction = createOmsEmsAdapterSession({ transport, entitlement: OMS_EMS_ENTITLEMENT });
    if (!construction.ok) {
      throw new Error(`the subject session must construct: ${JSON.stringify(construction.errors)}`);
    }
    return construction.session;
  },
  createSessionWithoutEntitlement: (transport: SdkTransportPort): SdkAdapterSession => {
    const construction = createOmsEmsSessionWithoutEntitlement(transport);
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
  const battery: readonly unknown[] = [
    { kind: 'order_state', data: { order_id: 'O1' } },
    { kind: 'order_state', data: {} },
    { kind: '', data: {} },
    { kind: 'order_state' },
    { data: {} },
    { kind: 'order_state', data: [] },
    { kind: 'order_state', data: 'x' },
    { kind: 42, data: {} },
    {},
    [],
    'nope',
    { kind: 'execution_report', data: { order_id: 'O1' } },
  ];

  it('every fixture verdict matches the real SDK validator and the real market-protocol validator', () => {
    expect(battery.length).toBeGreaterThanOrEqual(10);
    for (const value of battery) {
      const adapterErrors = adapterValidateOther(value);
      const sdkErrors = adapterPayloadRegistry['other'].validate(value);
      const protocolResult = validateMarketEvent({
        event_id: 'evt-x',
        venue: 'V',
        instrument: 'I',
        asset_class: 'crypto',
        event_type: 'other',
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

  it('every case passes against the OMS/EMS adapter session', () => {
    for (const contractCase of cases) {
      expect(() => contractCase.run()).not.toThrow();
    }
  });

  it('the lifecycle case emits real canonical other events (not vacuous)', () => {
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
    expect(events[0].event_type).toBe('other');
    const [first, second] = events;
    if (first.event_type !== 'other' || second.event_type !== 'other') throw new Error('must be other events');
    expect(first.payload.kind).toBe('order_state');
    expect((first.payload.data as Record<string, unknown>).order_id).toBe('TEST-ORDER-1');
    expect((second.payload.data as Record<string, unknown>).order_id).toBe('TEST-ORDER-1');
  });
});

// ---------------------------------------------------------------------------
// The emitted stream satisfies the canonical contracts (criterion 10).
// ---------------------------------------------------------------------------

describe('the emitted stream passes market-protocol validators (the interop core)', () => {
  function emitStream(): SdkEmittedEvent[] {
    const transportScript: TransportScript = {
      inbound: [
        { at: ms(T0), channel: 'orderState', payload: stateMessage(1, 'NEW', '0', '0.5') as never },
        { at: ms(T0 + 500), channel: 'orderState', payload: stateMessage(2, 'PARTIALLY_FILLED', '0.2', '0.3') as never },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const transport = createFakeTransport(transportScript);
    if (!transport.ok) throw new Error('script must validate');
    const construction = createOmsEmsAdapterSession({ transport: transport.transport, entitlement: OMS_EMS_ENTITLEMENT });
    if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
    const session = construction.session;
    session.open();
    const spec = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
    if (!spec.ok) throw new Error('subscription must build');
    const sent = session.subscribe(spec.value);
    if (!sent.ok) throw new Error(`subscribe must succeed: ${sent.error.message}`);
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
    const events = emitStream();
    expect(events.length).toBe(2);
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
      expect((event as unknown as Record<string, unknown>).entitlement).toBeDefined();
      expect((event as unknown as Record<string, unknown>).mapping).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// THE L8 EVIDENCE — the REAL T019 gate's decisions through this adapter's
// routing path (the approved-decision mirror is true interop).
// ---------------------------------------------------------------------------

describe('the REAL T019 gate drives this adapter\'s L8 routing path', () => {
  /** The validated fixture policy (the real gate's validated input). */
  function validatedPolicy(): ExecutionPolicy {
    return t019Unwrap(validateExecutionPolicy(fixturePolicyInput()));
  }

  it('the real gate\'s APPROVE decision is accepted by the routing path (the positive path)', () => {
    const decision = runExecutionGate({
      intent: t019FixtureIntent(),
      policy: validatedPolicy(),
      portfolio: fixturePortfolio(),
      venueState: fixtureVenueState(),
      killSwitch: fixtureKillSwitch(),
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) throw new Error('the gate must decide');
    expect(t019IsApproveDecision(decision.value)).toBe(true);

    const result = buildOmsEmsRoutingInstruction({
      decision: decision.value,
      intent: fixtureIntent(),
      route: { venue: 'BROKER-FIX' },
      kill_switch: fixtureStandingSwitch(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payload.action).toBe('ROUTE_ORDER');
      expect(result.value.payload.quantity).toBe('0.5');
    }
  });

  it('the real gate\'s REFUSAL decision is refused by the routing path (the negative path)', () => {
    const oversized = t019FixtureIntent({ order: { ...t019FixtureIntent().order, quantity: '5' } });
    const decision = runExecutionGate({
      intent: oversized,
      policy: validatedPolicy(),
      portfolio: fixturePortfolio(),
      venueState: fixtureVenueState(),
      killSwitch: fixtureKillSwitch(),
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) throw new Error('the gate must decide');
    expect(t019IsRefusalDecision(decision.value)).toBe(true);

    const result = buildOmsEmsRoutingInstruction({
      decision: decision.value,
      intent: fixtureIntent(),
      route: { venue: 'BROKER-FIX' },
      kill_switch: fixtureStandingSwitch(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('decision_not_approved');
      expect(result.error.message).toContain('REFUSAL');
    }
  });
});

// ---------------------------------------------------------------------------
// THE CROSS-ADAPTER FLOW — the broker lane's emissions reconcile against
// this lane's emissions, entirely in canonical shapes (the T039 lane).
// ---------------------------------------------------------------------------

describe('the cross-adapter flow: brokers emit -> oms-ems reconciles (canonical shapes only)', () => {
  /** Run the REAL broker adapter over the documented report stream and collect its emitted events. */
  function emitBrokerReports(): SdkEmittedEvent[] {
    const reports: TransportScript = {
      inbound: [
        {
          at: ms(T0),
          channel: 'executionReport',
          payload: {
            MsgType: '8',
            OrderID: 'TEST-ORDER-1',
            ClOrdID: 't039-fx-1',
            ExecID: 'TEST-EXEC-1',
            ExecType: '0',
            OrdStatus: '0',
            Side: '1',
            Symbol: 'BTC-USDT',
            OrderQty: '0.5',
            LastQty: '0',
            LastPx: '0',
            CumQty: '0',
            LeavesQty: '0.5',
            AvgPx: '0',
            TransactTime: '20240604-00:00:00.000',
          } as never,
        },
        {
          at: ms(T0 + 500),
          channel: 'executionReport',
          payload: {
            MsgType: '8',
            OrderID: 'TEST-ORDER-1',
            ClOrdID: 't039-fx-1',
            ExecID: 'TEST-EXEC-2',
            ExecType: '1',
            OrdStatus: '1',
            Side: '1',
            Symbol: 'BTC-USDT',
            OrderQty: '0.5',
            LastQty: '0.2',
            LastPx: '50000.00',
            CumQty: '0.2',
            LeavesQty: '0.3',
            AvgPx: '50000.00',
            TransactTime: '20240604-00:00:00.500',
          } as never,
        },
        {
          at: ms(T0 + 1_000),
          channel: 'executionReport',
          payload: {
            MsgType: '8',
            OrderID: 'TEST-ORDER-1',
            ClOrdID: 't039-fx-1',
            ExecID: 'TEST-EXEC-3',
            ExecType: '2',
            OrdStatus: '2',
            Side: '1',
            Symbol: 'BTC-USDT',
            OrderQty: '0.5',
            LastQty: '0.3',
            LastPx: '50100.00',
            CumQty: '0.5',
            LeavesQty: '0',
            AvgPx: '50060.00',
            TransactTime: '20240604-00:00:01.000',
          } as never,
        },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const transport = createFakeTransport(reports);
    if (!transport.ok) throw new Error('script must validate');
    const construction = createBrokerAdapterSession({ transport: transport.transport, entitlement: BROKER_ENTITLEMENT });
    if (!construction.ok) throw new Error(`the broker session must construct: ${JSON.stringify(construction.errors)}`);
    const session = construction.session;
    session.open();
    const spec = brokerExecutionReportSubscription({ instrument: 'BTC-USDT' });
    if (!spec.ok) throw new Error('broker subscription must build');
    const sent = session.subscribe(spec.value);
    if (!sent.ok) throw new Error(`broker subscribe must succeed: ${sent.error.message}`);
    const events: SdkEmittedEvent[] = [];
    for (;;) {
      const next = session.nextEvent();
      if (!next.ok) throw new Error(`broker drain must succeed: ${next.error.code}`);
      if (next.value === null) break;
      events.push(next.value);
    }
    return events;
  }

  it('the broker lane\'s emitted report DATA reconciles with the OMS\'s FILLED state (all five laws)', () => {
    const brokerEvents = emitBrokerReports();
    expect(brokerEvents.length).toBe(3);
    // The emitted payloads are canonical `other` events whose data IS the
    // canonical execution-report record — fed to the reconciliation engine
    // verbatim (no provider vocabulary crosses the boundary).
    const reportData = brokerEvents.map((event) => {
      if (event.event_type !== 'other') throw new Error('must be other events');
      return event.payload.data;
    });
    const result = reconcileOrderState({ order_state: fixtureFilledStateData(), reports: reportData });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filled_qty).toBe('0.5');
      expect(result.value.avg_px).toBe('50060.00');
      expect(result.value.status).toBe('filled');
      expect(result.value.report_count).toBe(3);
    }
  });

  it('a tampered OMS state is REFUSED against the broker lane\'s own emissions (the trip wire)', () => {
    const brokerEvents = emitBrokerReports();
    const reportData = brokerEvents.map((event) => {
      if (event.event_type !== 'other') throw new Error('must be other events');
      return event.payload.data;
    });
    const tampered = { ...fixtureFilledStateData(), filled_qty: '0.4' };
    const result = reconcileOrderState({ order_state: tampered, reports: reportData });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('reconcile_state_mismatch');
      expect(result.error.message).toContain('filled_qty');
    }
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

  it('the reconciliation is deterministic over the canonical fixtures (deep-equal, twice)', () => {
    const first = reconcileOrderState({ order_state: fixtureFilledStateData(), reports: fixtureReportData() });
    const second = reconcileOrderState({ order_state: fixtureFilledStateData(), reports: fixtureReportData() });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
