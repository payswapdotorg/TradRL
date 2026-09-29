/**
 * @tradrl/execution_gateway — the cross-package interop trip wires:
 * the REAL T039 adapters driven through the gateway.
 *
 * THE INTEROP LAW (the Work Order: "adapters are ports + mirrors with
 * interop trip-wires (drive the REAL brokers + oms-ems contract
 * suites through the gateway)"): the gateway's `OrderRoutingPort` is
 * the STRUCTURAL MIRROR of the T039 sessions' `routeOrder` call paths
 * — the type-level witnesses below prove a REAL
 * `BrokerAdapterSession` and a REAL `OmsEmsAdapterSession` ARE
 * `OrderRoutingPort`s with ZERO CASTS, and the runtime drives prove
 * the full pipeline's approvals pass the REAL adapters' own L8 checks
 * (the NewOrderSingle / ROUTE_ORDER messages arrive on the REAL
 * FakeTransport, byte-exact), while every refusal leaves the REAL
 * transports EMPTY.
 *
 * THE NO-BYPASS NEGATIVES (invariant 6 / L8 — "there is NO code path
 * from a model-side record to an outbound order that bypasses the
 * gate + authority + entitlement + kill-switch checks"):
 *   - DIRECT routing calls on the REAL sessions with a REFUSAL
 *     decision -> the REAL adapter's typed `decision_not_approved`;
 *   - direct routing with a FORGED decision id (content-addressing
 *     violation — the id does not match the content) -> the gateway's
 *     translation contract refuses it before the adapter is ever
 *     called, and the REAL transport received NOTHING;
 *   - direct routing under a THROWN switch -> the REAL adapter's
 *     typed `kill_switch_thrown`;
 *   - the replayed approval THROUGH the gateway -> the typed
 *     `duplicate_decision` (the first stands; the transport carries
 *     exactly ONE message).
 *
 * Cross-package imports happen ONLY in tests, via relative paths (the
 * repo's established pattern).
 */

import { describe, expect, it } from 'vitest';

import {
  createBrokerAdapterSession,
  BROKER_ADAPTER,
  BROKER_ENTITLEMENT,
  BROKER_ORDER_CHANNEL,
  BROKER_VENUE,
} from '../../../adapters/brokers/src/index';
import {
  createOmsEmsAdapterSession,
  OMS_EMS_ADAPTER,
  OMS_EMS_ENTITLEMENT,
  OMS_EMS_ORDER_CHANNEL,
  OMS_EMS_VENUE,
} from '../../../adapters/oms-ems/src/index';
import {
  createFakeTransport,
  emptyScript,
  type FakeTransport,
  type TransportPort,
} from '../../../packages/provider-sdk/src/index';
import { runExecutionGate } from '../../../packages/execution-policy/src/index';

import { approveDecisionIdMatchesContent, gatewayOrderRequest } from '../../../packages/execution-authority/src/index';
import {
  compliantIntent,
  referenceExposure,
  referenceKillSwitch,
  referencePolicy,
  referencePortfolio,
  referenceRegistry,
  referenceRiskPolicy,
  referenceRoutingTable,
  referenceVenueState,
  SUBSTRATE,
  T0,
  thrownReferenceKillSwitch,
  VENUE_BROKER,
} from './fixtures';
import { createExecutionGateway, scriptedInstants, type ExecutionGatewaySession, type OrderRoutingPort } from './index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` on drift). No casts: the
// port must be the structural mirror of BOTH T039 session shapes.
// ---------------------------------------------------------------------------

import type { BrokerAdapterSession } from '../../../adapters/brokers/src/index';
import type { OmsEmsAdapterSession } from '../../../adapters/oms-ems/src/index';

/** Compiles iff the REAL broker session IS an OrderRoutingPort (zero casts). */
function brokerSessionIsRoutingPort(session: BrokerAdapterSession): OrderRoutingPort {
  return session;
}

/** Compiles iff the REAL OMS/EMS session IS an OrderRoutingPort (zero casts). */
function omsSessionIsRoutingPort(session: OmsEmsAdapterSession): OrderRoutingPort {
  return session;
}

void brokerSessionIsRoutingPort;
void omsSessionIsRoutingPort;

// ---------------------------------------------------------------------------
// The REAL-session harness
// ---------------------------------------------------------------------------

/** One REAL T039 session over a REAL SDK FakeTransport, opened for routing. */
function realBrokerSession(): { readonly session: BrokerAdapterSession; readonly transport: FakeTransport } {
  const transportConstruction = createFakeTransport(emptyScript());
  if (!transportConstruction.ok) throw new Error('the broker transport must construct');
  const construction = createBrokerAdapterSession({ transport: transportConstruction.transport, entitlement: BROKER_ENTITLEMENT });
  if (!construction.ok) throw new Error(`the broker session must construct: ${JSON.stringify(construction.errors)}`);
  const opened = construction.session.open();
  if (!opened.ok) throw new Error(`the broker session must open: ${opened.error.message}`);
  return { session: construction.session, transport: transportConstruction.transport };
}

/** One REAL T039 OMS/EMS session over a REAL SDK FakeTransport, opened for routing. */
function realOmsSession(): { readonly session: OmsEmsAdapterSession; readonly transport: FakeTransport } {
  const transportConstruction = createFakeTransport(emptyScript());
  if (!transportConstruction.ok) throw new Error('the OMS transport must construct');
  const construction = createOmsEmsAdapterSession({ transport: transportConstruction.transport, entitlement: OMS_EMS_ENTITLEMENT });
  if (!construction.ok) throw new Error(`the OMS session must construct: ${JSON.stringify(construction.errors)}`);
  const opened = construction.session.open();
  if (!opened.ok) throw new Error(`the OMS session must open: ${opened.error.message}`);
  return { session: construction.session, transport: transportConstruction.transport };
}

/** The reference gateway over the REAL T039 sessions (the full-stack interop harness). */
function gatewayOverRealAdapters(overrides: { readonly killSwitch?: ReturnType<typeof referenceKillSwitch> } = {}): {
  readonly gateway: ExecutionGatewaySession;
  readonly broker: ReturnType<typeof realBrokerSession>;
  readonly oms: ReturnType<typeof realOmsSession>;
} {
  const broker = realBrokerSession();
  const oms = realOmsSession();
  const construction = createExecutionGateway({
    policy: referencePolicy(),
    gate: { portfolio: referencePortfolio(), venueState: referenceVenueState() },
    risk: { policy: referenceRiskPolicy(), exposure: referenceExposure() },
    authority: referenceRegistry(),
    routing: referenceRoutingTable(),
    adapters: [
      { adapterRef: `adapter:${BROKER_ADAPTER.id}@${BROKER_ADAPTER.version}` as never, port: broker.session },
      { adapterRef: `adapter:${OMS_EMS_ADAPTER.id}@${OMS_EMS_ADAPTER.version}` as never, port: oms.session },
    ],
    killSwitch: overrides.killSwitch ?? referenceKillSwitch(),
    instants: scriptedInstants([T0, T0 + 1_000, T0 + 2_000, T0 + 3_000, T0 + 4_000]),
    substrate: SUBSTRATE,
  });
  if (!construction.ok) throw new Error(`the interop gateway must construct: ${JSON.stringify(construction.errors)}`);
  return { gateway: construction.gateway, broker, oms };
}

// ---------------------------------------------------------------------------
// The positive interop drives (the REAL adapters through the gateway)
// ---------------------------------------------------------------------------

describe('the REAL T039 sessions driven through the gateway (the interop core)', () => {
  it('the full pipeline\'s approval routes through the REAL broker session: the FakeTransport carries EXACTLY the documented NewOrderSingle message', () => {
    const { gateway, broker, oms } = gatewayOverRealAdapters();
    const outcome = gateway.submitDecision(compliantIntent(101));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.errors));
    expect(outcome.value.kind).toBe('routed');

    // The REAL broker session translated + sent: exactly one message on the
    // documented order-entry channel, with the documented FIX payload shape.
    const sent = broker.transport.sent();
    expect(sent.length).toBe(1);
    expect(sent[0]?.channel).toBe(BROKER_ORDER_CHANNEL);
    const payload = sent[0]?.payload as Record<string, unknown>;
    expect(payload.MsgType).toBe('D');
    expect(payload.ClOrdID).toBe('t040-compliant-101');
    expect(payload.Symbol).toBe('BTC-USDT');
    expect(payload.Side).toBe('1'); // buy -> "1" (the documented code domain)
    expect(payload.OrdType).toBe('2'); // limit -> "2"
    expect(payload.OrderQty).toBe('0.5');
    expect(payload.Price).toBe('50100.00');
    expect(payload.TimeInForce).toBe('1'); // gtc -> "1"
    // The OMS lane received NOTHING.
    expect(oms.transport.sent().length).toBe(0);
  });

  it('the full pipeline\'s approval routes through the REAL OMS/EMS session: the documented ROUTE_ORDER instruction', () => {
    const { gateway, broker, oms } = gatewayOverRealAdapters();
    // The OMS-lane intent: the same compliant buy on OMS-EMS.
    const outcome = gateway.submitDecision({
      ...compliantIntent(102),
      order: { ...compliantIntent(102).order, venueId: OMS_EMS_VENUE, clientOrderId: 't040-oms-102' },
      intentId: 'si:t040gw0102',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.errors));
    expect(outcome.value.kind).toBe('routed');

    const sent = oms.transport.sent();
    expect(sent.length).toBe(1);
    expect(sent[0]?.channel).toBe(OMS_EMS_ORDER_CHANNEL);
    const payload = sent[0]?.payload as Record<string, unknown>;
    expect(payload.action).toBe('ROUTE_ORDER');
    expect(payload.venue).toBe(OMS_EMS_VENUE);
    expect(payload.clientOrderId).toBe('t040-oms-102');
    expect(payload.side).toBe('buy');
    expect(payload.orderType).toBe('limit');
    expect(payload.quantity).toBe('0.5');
    expect(payload.limitPrice).toBe('50100.00');
    // The broker lane received NOTHING.
    expect(broker.transport.sent().length).toBe(0);
  });

  it('a gateway refusal leaves BOTH real transports EMPTY (the no-bypass evidence at the transport level)', () => {
    const { gateway, broker, oms } = gatewayOverRealAdapters();
    // A contaminated intent: refused at stage 1, far from any adapter.
    const contaminated = { ...compliantIntent(103), apiKey: 'synthetic-secret' };
    const outcome = gateway.submitDecision(contaminated);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.errors));
    expect(outcome.value.kind).toBe('refused');
    expect(broker.transport.sent().length).toBe(0);
    expect(oms.transport.sent().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// THE NO-BYPASS NEGATIVES (invariant 6 / L8)
// ---------------------------------------------------------------------------

describe('the no-bypass negatives over the REAL adapters (invariant 6 / L8)', () => {
  /** The REAL gate's APPROVE decision over the reference facts (the only authority there is). */
  function realApprovedDecision(): { readonly decisionId: string; readonly intent: ReturnType<typeof compliantIntent> } {
    const theIntent = compliantIntent(110);
    const decision = runExecutionGate({
      intent: theIntent,
      policy: referencePolicy(),
      portfolio: referencePortfolio(),
      venueState: referenceVenueState(),
      killSwitch: referenceKillSwitch(),
    });
    if (!decision.ok || decision.value.kind !== 'approve') throw new Error('the real gate must approve the compliant intent');
    return { decisionId: decision.value.decisionId, intent: theIntent };
  }

  it('a DIRECT routing call with a REFUSAL decision is the REAL adapter\'s typed decision_not_approved (nothing sent)', () => {
    const { session, transport } = realBrokerSession();
    const refusalDecision = runExecutionGate({
      intent: { ...compliantIntent(111), strategy: { specId: 'spec-intruder', version: 1 } },
      policy: referencePolicy(),
      portfolio: referencePortfolio(),
      venueState: referenceVenueState(),
      killSwitch: referenceKillSwitch(),
    });
    if (!refusalDecision.ok || refusalDecision.value.kind !== 'refuse') throw new Error('the real gate must refuse');
    const result = session.routeOrder({
      decision: refusalDecision.value,
      intent: compliantIntent(111).order,
      kill_switch: { state: 'standing' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('decision_not_approved');
    expect(transport.sent().length).toBe(0);
  });

  it('a DIRECT routing call with a FORGED decision id is refused BEFORE the adapter is called (the content-addressing law) — and the adapter would refuse the shape-invalid twin identically', () => {
    const approved = realApprovedDecision();
    // The gateway's translation contract: the forged id never becomes an
    // order request (the authority package's builder refuses it).
    const forgedDecision = { ...approvedDecisionRecordOf(approved), decisionId: 'xd:forged000' };
    const built = gatewayOrderRequest({
      decision: forgedDecision,
      order: approved.intent.order,
      route: { venue: VENUE_BROKER, adapterRef: 'adapter:adapter-brokers@0.0.0', channelRef: 'chan:newOrderSingle' },
      grantRef: 'grant:gateway-execute-limit@1',
      credentialRef: 'cred:gw-broker-main@1',
      kill_switch: { state: 'standing' },
      asOf: T0,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.errors[0]?.code).toBe('decision_not_approved');
    // The derivation verifier agrees: the forged id does not match the content.
    expect(approveDecisionIdMatchesContent(forgedDecision as never)).toBe(false);
    // And the shape-invalid twin (not even an 'xd:' id) is refused by the
    // REAL adapter directly.
    const { session, transport } = realBrokerSession();
    const shapeInvalid = session.routeOrder({
      decision: { kind: 'approve', decisionId: 'not-an-xd-id' },
      intent: approved.intent.order,
      kill_switch: { state: 'standing' },
    });
    expect(shapeInvalid.ok).toBe(false);
    if (!shapeInvalid.ok) expect(shapeInvalid.error.code).toBe('decision_not_approved');
    expect(transport.sent().length).toBe(0);
  });

  it('a DIRECT routing call under a THROWN switch is the REAL adapter\'s typed kill_switch_thrown (nothing sent)', () => {
    const { session, transport } = realBrokerSession();
    const approved = realApprovedDecision();
    const result = session.routeOrder({
      decision: approvedDecisionRecordOf(approved),
      intent: approved.intent.order,
      kill_switch: { state: 'thrown' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('kill_switch_thrown');
    expect(transport.sent().length).toBe(0);
  });

  it('a REPLAYED approval THROUGH the gateway is the typed duplicate_decision: the transport carries EXACTLY ONE message (the first stands)', () => {
    const { gateway, broker } = gatewayOverRealAdapters();
    const theIntent = compliantIntent(112);
    const first = gateway.submitDecision(theIntent);
    const second = gateway.submitDecision(theIntent);
    expect(first.ok && first.value.kind === 'routed').toBe(true);
    expect(second.ok && second.value.kind === 'refused').toBe(true);
    if (second.ok && second.value.kind === 'refused') {
      expect(second.value.refusal.stage).toBe('duplicate_decision');
    }
    expect(broker.transport.sent().length).toBe(1);
  });

  it('a gateway over a THROWN switch refuses every submission: BOTH real transports stay EMPTY', () => {
    const { gateway, broker, oms } = gatewayOverRealAdapters({ killSwitch: thrownReferenceKillSwitch() });
    for (const anIntent of [compliantIntent(113), compliantIntent(114)]) {
      const outcome = gateway.submitDecision(anIntent);
      expect(outcome.ok && outcome.value.kind === 'refused').toBe(true);
    }
    expect(broker.transport.sent().length).toBe(0);
    expect(oms.transport.sent().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The descriptor-identity trip wires (the routing refs over the REAL T039 descriptors)
// ---------------------------------------------------------------------------

describe('the routing refs bind the REAL T039 descriptor identities', () => {
  it('the reference routing table\'s refs decompose onto the REAL descriptor constants', () => {
    const table = referenceRoutingTable();
    for (const entry of table.entries) {
      const [namespace, identity] = (entry.adapterRef as string).split(':');
      void namespace;
      const [id, version] = (identity as string).split('@');
      if (id === BROKER_ADAPTER.id) {
        expect(version).toBe(BROKER_ADAPTER.version);
        expect(entry.channelRef).toBe(`chan:${BROKER_ORDER_CHANNEL}`);
        expect(BROKER_VENUE).toBe(VENUE_BROKER);
      } else if (id === OMS_EMS_ADAPTER.id) {
        expect(version).toBe(OMS_EMS_ADAPTER.version);
        expect(entry.channelRef).toBe(`chan:${OMS_EMS_ORDER_CHANNEL}`);
      } else {
        throw new Error(`the reference table routes an unknown adapter: ${entry.adapterRef}`);
      }
    }
  });

  it('the gateway accepted the REAL sessions as its injected ports (the construction law)', () => {
    // gatewayOverRealAdapters constructed with the REAL sessions as ports —
    // reaching here already proves the bindings; the positive drives above
    // prove the translation passes the adapters' own L8 checks.
    const { gateway } = gatewayOverRealAdapters();
    expect(gateway.submissions().length).toBe(0);
  });
});

// --- Local helpers ------------------------------------------------------------

/** The full approve-decision record (re-derived through the REAL gate) of an approved harness result. */
function approvedDecisionRecordOf(approved: { readonly decisionId: string; readonly intent: ReturnType<typeof compliantIntent> }): Record<string, unknown> {
  const decision = runExecutionGate({
    intent: approved.intent,
    policy: referencePolicy(),
    portfolio: referencePortfolio(),
    venueState: referenceVenueState(),
    killSwitch: referenceKillSwitch(),
  });
  if (!decision.ok || decision.value.kind !== 'approve') throw new Error('the real gate must approve');
  return decision.value as unknown as Record<string, unknown>;
}

// The TransportPort import is used by the harness type signatures.
void (null as unknown as TransportPort | null);
