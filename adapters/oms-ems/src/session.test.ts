/**
 * @tradrl/adapter-oms-ems — the adapter session tests.
 *
 * Behavioral: the normalized lifecycle over a scripted fake transport
 * (open -> subscribe -> drain -> close); the documented ExecutionReport
 * sequencing laws through the guard pipeline (CumQty regression,
 * duplicate ExecID); the L8-gated routeOrder call path (lifecycle state
 * checks + the routing refusals + the unmangled pass-through of the
 * built message); entitlement refusal; determinism (byte-identical
 * streams, twice).
 */

import { describe, expect, it } from 'vitest';

import {
  createOmsEmsAdapterSession,
  createOmsEmsSessionWithoutEntitlement,
  omsEmsOrderStateSubscription,
  OMS_EMS_ENTITLEMENT,
  omsEmsProtocolCodeOf,
  type OmsEmsAdapterSession,
  type OmsEmsSessionConstruction,
} from './index';
import {
  fixtureApproveDecision,
  fixtureRefusalDecision,
  fixtureIntent,
  fixtureStandingSwitch,
  fixtureThrownSwitch,
  fixtureOrderState,
  fixturePartiallyFilledState,
  fixtureFilledState,
} from './test-fixtures';
import {
  createFakeTransport,
  type TransportScript,
  type TransportPort,
  type FakeTransport,
  type TimestampMs,
} from '../../../packages/provider-sdk/src/index';

const ms = (value: number): TimestampMs => value as TimestampMs;
const T0 = 1_717_459_200_000;

/** Build a session construction with the declared entitlement over the given transport. */
function sessionOver(transport: TransportPort): OmsEmsSessionConstruction {
  return createOmsEmsAdapterSession({ transport, entitlement: OMS_EMS_ENTITLEMENT });
}

/** The happy-path report stream: new -> partial fill -> fill. */
const reportScript: TransportScript = {
  inbound: [
    { at: ms(T0), channel: 'orderState', payload: fixtureOrderState() as never },
    { at: ms(T0 + 500), channel: 'orderState', payload: fixturePartiallyFilledState() as never },
    { at: ms(T0 + 1_000), channel: 'orderState', payload: fixtureFilledState() as never },
  ],
  recv_failures: [],
  send_failures: [],
  receive_timeout_ms: null,
};

function transportFor(script: TransportScript): FakeTransport {
  const construction = createFakeTransport(script);
  if (!construction.ok) throw new Error('script must validate');
  return construction.transport;
}

/** A drain result: the emitted events and the terminal outcome (drained, or a typed failure). */
type DrainResult = { events: unknown[]; terminal: { ok: true } | { ok: false; error: { kind: string; code: string; message: string } } };

function drain(session: OmsEmsAdapterSession): DrainResult {
  const events: unknown[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok || next.value === null) return { events, terminal: next };
    events.push(next.value);
  }
}

describe('the normalized lifecycle over a scripted transport', () => {
  it('open -> subscribe -> drain -> close succeeds and emits canonical other events', () => {
    const transport = transportFor(reportScript);
    const construction = sessionOver(transport);
    expect(construction.ok).toBe(true);
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    expect(session.state()).toBe('idle');
    expect(session.open().ok).toBe(true);
    expect(session.state()).toBe('open');

    const subscription = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
    expect(subscription.ok).toBe(true);
    if (!subscription.ok) throw new Error('subscription must build');
    expect(session.subscribe(subscription.value).ok).toBe(true);
    expect(session.state()).toBe('subscribed');

    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    expect(events.length).toBe(3);
    const first = events[0] as { event_type: string; payload: { kind: string; data: { exec_type: string } } };
    expect(first.event_type).toBe('other');
    expect(first.payload.kind).toBe('order_state');
    expect((first.payload.data as Record<string, unknown>).status).toBe('new');
    expect(session.close().ok).toBe(true);
    expect(session.state()).toBe('closed');
  });

  it('double close, use-after-close and subscribe-before-open are typed ProtocolErrors', () => {
    const construction = sessionOver(transportFor(reportScript));
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    const subscription = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
    if (!subscription.ok) throw new Error('subscription must build');

    const beforeOpen = session.subscribe(subscription.value);
    expect(beforeOpen.ok).toBe(false);
    if (!beforeOpen.ok) expect(beforeOpen.error.code).toBe('invalid_transition');

    expect(session.open().ok).toBe(true);
    expect(session.close().ok).toBe(true);
    const doubleClose = session.close();
    expect(doubleClose.ok).toBe(false);
    if (!doubleClose.ok) expect(doubleClose.error.code).toBe('double_close');
    const afterClose = session.nextEvent();
    expect(afterClose.ok).toBe(false);
    if (!afterClose.ok) expect(afterClose.error.code).toBe('use_after_close');
  });

  it('an unsubscribed channel arrival is a typed unknown_channel error', () => {
    const script: TransportScript = {
      inbound: [{ at: ms(T0), channel: 'someOtherChannel', payload: { a: 1 } }],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const construction = sessionOver(transportFor(script));
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    const subscription = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
    if (!subscription.ok) throw new Error('subscription must build');
    session.subscribe(subscription.value);
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) expect(terminal.error.code).toBe('unknown_channel');
  });

  it('the raw subscription request passes through the transport UNMANGLED', () => {
    const transport = transportFor(reportScript);
    const construction = sessionOver(transport);
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    const subscription = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
    if (!subscription.ok) throw new Error('subscription must build');
    session.subscribe(subscription.value);
    const sent = transport.sent();
    expect(sent.length).toBe(1);
    expect(JSON.stringify(sent[0].payload)).toBe(JSON.stringify(subscription.value.request));
    expect(sent[0].channel).toBe('orderState');
  });

  it('a subscription for an undeclared instrument is a typed configuration error', () => {
    const construction = sessionOver(transportFor(reportScript));
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    const bad = omsEmsOrderStateSubscription({ instrument: 'DOGE-USDT' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('invalid_configuration');
  });
});

describe('the documented sequencing laws through the guard pipeline', () => {
  it('a per-order sequence regression is a typed state_sequence_regression error', () => {
    const script: TransportScript = {
      inbound: [
        { at: ms(T0), channel: 'orderState', payload: fixturePartiallyFilledState() as never },
        { at: ms(T0 + 100), channel: 'orderState', payload: fixtureOrderState() as never }, // sequence 1 after 2
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const construction = sessionOver(transportFor(script));
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    const subscription = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
    if (!subscription.ok) throw new Error('subscription must build');
    session.subscribe(subscription.value);
    const { events, terminal } = drain(session);
    expect(events.length).toBe(1); // the first record emitted
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(omsEmsProtocolCodeOf(terminal.error)).toBe('state_sequence_regression');
      expect(terminal.error.message).toContain('TEST-ORDER-1');
    }
  });

  it('a REPEATED per-order sequence is refused (strictly increasing)', () => {
    const script: TransportScript = {
      inbound: [
        { at: ms(T0), channel: 'orderState', payload: fixtureOrderState() as never },
        { at: ms(T0 + 100), channel: 'orderState', payload: fixtureOrderState() as never },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const construction = sessionOver(transportFor(script));
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    const subscription = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
    if (!subscription.ok) throw new Error('subscription must build');
    session.subscribe(subscription.value);
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) expect(omsEmsProtocolCodeOf(terminal.error)).toBe('state_sequence_regression');
  });

  it('distinct orders sequence INDEPENDENTLY (the tracking is per-order)', () => {
    const other = { ...fixtureOrderState(), orderId: 'TEST-ORDER-2', sequence: 1 };
    const script: TransportScript = {
      inbound: [
        { at: ms(T0), channel: 'orderState', payload: fixturePartiallyFilledState() as never },
        { at: ms(T0 + 100), channel: 'orderState', payload: other as never },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const construction = sessionOver(transportFor(script));
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    const subscription = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
    if (!subscription.ok) throw new Error('subscription must build');
    session.subscribe(subscription.value);
    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    expect(events.length).toBe(2);
  });

  it('an unmapped raw field surfaces as a typed MappingError (guard + emitter defense in depth)', () => {
    const script: TransportScript = {
      inbound: [
        { at: ms(T0), channel: 'orderState', payload: { ...fixtureOrderState(), vendor_extra: 'x' } as never },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const construction = sessionOver(transportFor(script));
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    const subscription = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
    if (!subscription.ok) throw new Error('subscription must build');
    session.subscribe(subscription.value);
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(terminal.error.kind).toBe('mapping');
      expect(terminal.error.code).toBe('unmapped_raw_field');
    }
  });
});

describe('the L8-gated routeOrder call path', () => {
  it('routes a valid APPROVED decision through the transport, UNMANGLED', () => {
    const transport = transportFor(reportScript);
    const construction = sessionOver(transport);
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    const result = session.routeOrder({
      decision: fixtureApproveDecision(),
      intent: fixtureIntent(),
      route: { venue: 'BROKER-FIX' },
      kill_switch: fixtureStandingSwitch(),
    });
    expect(result.ok).toBe(true);
    const sent = transport.sent();
    expect(sent.length).toBe(1);
    expect(sent[0].channel).toBe('routingInstruction');
    expect((sent[0].payload as Record<string, unknown>).action).toBe('ROUTE_ORDER');
    expect((sent[0].payload as Record<string, unknown>).quantity).toBe('0.5');
  });

  it('routeOrder before open is a typed invalid_transition error', () => {
    const construction = sessionOver(transportFor(reportScript));
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    const result = session.routeOrder({
      decision: fixtureApproveDecision(),
      intent: fixtureIntent(),
      route: { venue: 'BROKER-FIX' },
      kill_switch: fixtureStandingSwitch(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_transition');
  });

  it('routeOrder after close is a typed use_after_close error', () => {
    const construction = sessionOver(transportFor(reportScript));
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    session.close();
    const result = session.routeOrder({
      decision: fixtureApproveDecision(),
      intent: fixtureIntent(),
      route: { venue: 'BROKER-FIX' },
      kill_switch: fixtureStandingSwitch(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('use_after_close');
  });

  it('a refusal decision never produces an outbound message (the L8 negative path)', () => {
    const transport = transportFor(reportScript);
    const construction = sessionOver(transport);
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    const result = session.routeOrder({
      decision: fixtureRefusalDecision(),
      intent: fixtureIntent(),
      route: { venue: 'BROKER-FIX' },
      kill_switch: fixtureStandingSwitch(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(omsEmsProtocolCodeOf(result.error)).toBe('decision_not_approved');
    expect(transport.sent().length).toBe(0);
  });

  it('a thrown kill switch never produces an outbound message', () => {
    const transport = transportFor(reportScript);
    const construction = sessionOver(transport);
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    const result = session.routeOrder({
      decision: fixtureApproveDecision(),
      intent: fixtureIntent(),
      route: { venue: 'BROKER-FIX' },
      kill_switch: fixtureThrownSwitch(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(omsEmsProtocolCodeOf(result.error)).toBe('kill_switch_thrown');
    expect(transport.sent().length).toBe(0);
  });
});

describe('entitlement (the licensing law)', () => {
  it('emission without the declared entitlement is a typed EntitlementError, and NOTHING is emitted', () => {
    const construction = createOmsEmsSessionWithoutEntitlement(transportFor(reportScript));
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    const subscription = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
    if (!subscription.ok) throw new Error('subscription must build');
    session.subscribe(subscription.value);
    const { events, terminal } = drain(session);
    expect(events.length).toBe(0);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(terminal.error.kind).toBe('entitlement');
      expect(terminal.error.code).toBe('entitlement_undeclared');
    }
  });

  it('every emitted record carries the entitlement ref and the mapping provenance', () => {
    const construction = sessionOver(transportFor(reportScript));
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    const subscription = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
    if (!subscription.ok) throw new Error('subscription must build');
    session.subscribe(subscription.value);
    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    for (const event of events as { entitlement: { entitlement_id: string }; mapping: { table_id: string } }[]) {
      expect(event.entitlement.entitlement_id).toBe('ent-oms-ems-order-state-restricted');
      expect(event.mapping.table_id).toBe('oms-ems-order-state');
    }
  });
});

describe('determinism (criterion 3 — byte-identical, twice)', () => {
  it('the same scripted transport emits a byte-identical canonical stream', () => {
    const first = runStream();
    const second = runStream();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toEqual(second);
    expect(first.length).toBe(3);
  });

  function runStream(): unknown[] {
    const construction = sessionOver(transportFor(reportScript));
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    const subscription = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
    if (!subscription.ok) throw new Error('subscription must build');
    session.subscribe(subscription.value);
    const { events, terminal } = drain(session);
    if (!terminal.ok) throw new Error('drain must succeed');
    return events;
  }
});
