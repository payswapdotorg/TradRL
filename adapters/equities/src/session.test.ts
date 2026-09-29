/**
 * @tradrl/adapter-equities — the adapter session tests.
 *
 * Behavioral: the full lifecycle over every documented channel; every
 * typed error path the work order names (use-after-close, double-close,
 * subscribe-before-open, unknown channel, unmapped field, unknown record
 * type, malformed payload, record sequence regression, trading-calendar
 * violations, duplicate corporate action, entitlement refusal); the
 * derived escape-hatch events through the session; the unmangled
 * request pass-through; the sequence discipline; and byte-determinism
 * (the same script -> the same stream, twice).
 *
 * All tests run over the REAL SDK's scripted fake transport (test-only
 * relative import — the repo's established pattern; the package sources
 * import nothing).
 */

import { describe, expect, it } from 'vitest';

import {
  createEquitiesAdapterSession,
  createEquitiesSessionWithoutEntitlement,
  createAdapterSession,
  equitiesSubscription,
  createEquitiesGuardTransport,
  EQUITIES_ENTITLEMENT,
  EQUITIES_SOURCE_DESCRIPTOR,
  EQUITIES_ADAPTER,
  EQUITIES_MAPPING_TABLES,
  isProtocolError,
  equitiesProtocolCodeOf,
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
const AT0 = 1_717_423_200_000; // 2024-06-03T14:00:00Z — Monday, inside the declared US regular session.

const validIndexLevel = (sequence: number, dissemination = AT0): JsonObject =>
  ({
    recordType: 'INDEX_LEVEL',
    indexId: 'TEST-LARGECAP',
    tradeDate: '2024-06-03',
    disseminationTimeMs: dissemination,
    indexLevel: '104.5000',
    indexDivisor: '1234.5678',
    sequenceNumber: sequence,
  }) as JsonObject;

const validWeight = (sequence: number, symbol = 'TEST-AAA'): JsonObject =>
  ({
    recordType: 'CONSTITUENT_WEIGHT',
    indexId: 'TEST-LARGECAP',
    tradeDate: '2024-06-03',
    disseminationTimeMs: AT0 + 10,
    constituentSymbol: symbol,
    constituentWeight: '0.06940',
    shareClassCode: 'COMMON',
    sequenceNumber: sequence,
  }) as JsonObject;

const validAction = (actionId: string): JsonObject =>
  ({
    recordType: 'CORPORATE_ACTION',
    actionId,
    corporateSymbol: 'TEST-AAA',
    actionTypeCode: 'SPLIT',
    effectiveDate: '2024-06-10',
    announcementTimeMs: AT0 + 20,
    actionRatio: '4:1',
    currencyCode: 'USD',
  }) as JsonObject;

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
    ? createEquitiesAdapterSession({ transport: transportFor(transportScript), entitlement: EQUITIES_ENTITLEMENT })
    : createEquitiesSessionWithoutEntitlement(transportFor(transportScript));
  if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
  return construction.session;
}

function subscribe(
  session: AdapterSession,
  channel: 'indexLevel' | 'constituentWeights' | 'corporateActions',
  instrument: string = channel === 'corporateActions' ? 'TEST-AAA' : 'TEST-LARGECAP',
): void {
  const spec = equitiesSubscription({ channel, instrument });
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
      { at: AT0, channel: 'indexLevel', payload: validIndexLevel(41) },
      { at: AT0 + 10, channel: 'constituentWeights', payload: validWeight(7) },
      { at: AT0 + 20, channel: 'corporateActions', payload: validAction('ACT-2024-0001') },
      { at: AT0 + 30, channel: 'indexLevel', payload: validIndexLevel(42, AT0 + 30) },
    ]);
    const session = sessionOver(transportScript);
    expect(session.open().ok).toBe(true);
    subscribe(session, 'indexLevel');
    subscribe(session, 'constituentWeights');
    subscribe(session, 'corporateActions');
    expect(session.state()).toBe('subscribed');

    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    if (terminal.ok) expect(terminal.value).toBeNull();
    expect(events.length).toBe(4);
    const types = events.map((event) => event.event_type);
    expect(types).toEqual(['fundamental', 'other', 'other', 'fundamental']);
    expect(session.lastMessageAt()).toBe(AT0 + 30);
    expect(session.close().ok).toBe(true);
    expect(session.state()).toBe('closed');
  });

  it('the index-level events carry the declared fundamental payload', () => {
    const transportScript = script([{ at: AT0, channel: 'indexLevel', payload: validIndexLevel(41) }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'indexLevel');
    const { events } = drain(session);
    expect(events.length).toBe(1);
    const event = events[0];
    if (event.event_type !== 'fundamental') throw new Error('must be a fundamental event');
    expect(event.payload.field).toBe('INDEX_LEVEL');
    expect(event.payload.period).toBe('2024-06-03');
    expect(event.payload.value).toBe('104.5000');
    expect(event.payload.unit).toBe('index-points');
    expect(event.payload.source).toBe('index-dissemination');
  });

  it('the constituent-weight and corporate-action events carry the declared escape-hatch payloads', () => {
    const transportScript = script([
      { at: AT0 + 10, channel: 'constituentWeights', payload: validWeight(7) },
      { at: AT0 + 20, channel: 'corporateActions', payload: validAction('ACT-2024-0002') },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'constituentWeights');
    subscribe(session, 'corporateActions');
    const { events } = drain(session);
    expect(events.length).toBe(2);
    const [weight, action] = events;
    if (weight.event_type !== 'other' || action.event_type !== 'other') throw new Error('must be other events');
    expect(weight.payload.kind).toBe('index_constituent_weight');
    expect((weight.payload.data as Record<string, unknown>).symbol).toBe('TEST-AAA');
    expect(action.payload.kind).toBe('corporate_action');
    const data = action.payload.data as Record<string, unknown>;
    expect(data.action).toBe('split');
    expect(data.effective_date).toBe('2024-06-10');
    // The two other-kinds are distinct canonical streams (separate sequences).
    expect(weight.sequence).toBe(1);
    expect(action.sequence).toBe(1);
  });

  it('every emitted event carries the quartet, provenance, licensed entitlement ref and mapping ref', () => {
    const transportScript = script([{ at: AT0, channel: 'indexLevel', payload: validIndexLevel(41) }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'indexLevel');
    const { events } = drain(session);
    expect(events.length).toBe(1);
    const event = events[0] as unknown as Record<string, unknown>;
    expect(typeof event.event_time).toBe('number');
    expect(typeof event.available_time).toBe('number');
    expect(typeof event.ingestion_time).toBe('number');
    expect((event.available_time as number) >= (event.event_time as number)).toBe(true);
    const provenance = event.provenance as Record<string, unknown>;
    expect(provenance.origin).toBe('historical');
    expect((provenance.adapter as Record<string, unknown>).id).toBe('adapter-equities');
    const entitlement = event.entitlement as Record<string, unknown>;
    expect(entitlement.entitlement_id).toBe('ent-equities-index-licensed');
    expect(event.mapping).toBeDefined();
    expect((event.mapping as Record<string, unknown>).table_id).toBe('equities-index-level');
    expect(event.provider).toBe('licensed-index-a');
    expect(event.venue).toBe('LICENSED-INDEX-A');
    expect(event.instrument).toBe('TEST-LARGECAP');
  });

  it('onEvent/pump deliver every event and abort on the first typed failure', () => {
    const transportScript = script([
      { at: AT0, channel: 'indexLevel', payload: validIndexLevel(41) },
      { at: AT0 + 30, channel: 'indexLevel', payload: validIndexLevel(42, AT0 + 30) },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'indexLevel');
    const seen: unknown[] = [];
    session.onEvent((event) => seen.push(event));
    const pumped = session.pump();
    expect(pumped.ok).toBe(true);
    if (pumped.ok) expect(pumped.value).toBe(2);
    expect(seen.length).toBe(2);

    // A failing script aborts the pump with the typed failure.
    const failingScript = script([
      { at: AT0, channel: 'indexLevel', payload: validIndexLevel(41) },
      { at: AT0 + 30, channel: 'indexLevel', payload: { ...validIndexLevel(42, AT0 + 30), vendor_extra: 1 } as JsonObject },
    ]);
    const failingSession = sessionOver(failingScript);
    failingSession.open();
    subscribe(failingSession, 'indexLevel');
    const aborted = failingSession.pump();
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) expect(aborted.error.code).toBe('unmapped_raw_field');
  });
});

describe('the request pass-through (the neutrality contract)', () => {
  it('the documented SUBSCRIBE frame crosses the transport unmangled', () => {
    const transportScript = script([{ at: AT0, channel: 'indexLevel', payload: validIndexLevel(41) }]);
    const transport = transportFor(transportScript);
    const construction = createEquitiesAdapterSession({ transport, entitlement: EQUITIES_ENTITLEMENT });
    if (!construction.ok) throw new Error('must construct');
    const session = construction.session;
    session.open();
    subscribe(session, 'indexLevel');
    const sent = transport.sent();
    expect(sent.length).toBe(1);
    expect(sent[0].channel).toBe('indexLevel');
    expect({ ...sent[0].payload }).toEqual({
      action: 'SUBSCRIBE',
      feed: 'indexLevel',
      subject: 'TEST-LARGECAP',
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
    const spec = equitiesSubscription({ channel: 'indexLevel', instrument: 'TEST-LARGECAP' });
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
    const spec = equitiesSubscription({ channel: 'indexLevel', instrument: 'TEST-LARGECAP' });
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
    if (!result.ok) {
      expect(isProtocolError(result.error)).toBe(true);
      expect(result.error.code).toBe('double_close');
    }
  });

  it('use-after-close is a typed use_after_close (nextEvent AND subscribe)', () => {
    const session = sessionOver(script([]));
    session.open();
    session.close();
    const next = session.nextEvent();
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.error.code).toBe('use_after_close');
    const spec = equitiesSubscription({ channel: 'indexLevel', instrument: 'TEST-LARGECAP' });
    if (!spec.ok) throw new Error('must build');
    const subscribed = session.subscribe(spec.value);
    expect(subscribed.ok).toBe(false);
    if (!subscribed.ok) expect(subscribed.error.code).toBe('use_after_close');
  });

  it('duplicate subscription on one channel is typed', () => {
    const session = sessionOver(script([]));
    session.open();
    subscribe(session, 'indexLevel');
    const spec = equitiesSubscription({ channel: 'indexLevel', instrument: 'TEST-LARGECAP' });
    if (!spec.ok) throw new Error('must build');
    const result = session.subscribe(spec.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('duplicate_subscription');
  });

  it('a subscription outside the declared envelope is typed (undeclared channel / instrument / asset class)', () => {
    const session = sessionOver(script([]));
    session.open();
    const badChannel = session.subscribe({
      channel: 'closingLevels',
      request: { action: 'SUBSCRIBE', feed: 'closingLevels', subject: 'TEST-LARGECAP' },
      venue: 'LICENSED-INDEX-A',
      instrument: 'TEST-LARGECAP',
      asset_class: 'index',
      mapping_table_id: 'equities-index-level',
    });
    expect(badChannel.ok).toBe(false);
    if (!badChannel.ok) expect(badChannel.error.code).toBe('invalid_configuration');

    const badInstrument = session.subscribe({
      channel: 'indexLevel',
      request: { action: 'SUBSCRIBE', feed: 'indexLevel', subject: 'SPX' },
      venue: 'LICENSED-INDEX-A',
      instrument: 'SPX',
      asset_class: 'index',
      mapping_table_id: 'equities-index-level',
    });
    expect(badInstrument.ok).toBe(false);
    if (!badInstrument.ok) expect(badInstrument.error.code).toBe('invalid_configuration');

    // The channel->asset-class law lives in the documented request
    // builder (the session's envelope check is instrument-in-universe-of-
    // spec-class): a corporate-action subscription on an INDEX instrument
    // is outside the channel's declared asset class.
    const badAssetClass = equitiesSubscription({ channel: 'corporateActions', instrument: 'TEST-LARGECAP' });
    expect(badAssetClass.ok).toBe(false);
    if (!badAssetClass.ok) expect(badAssetClass.error.code).toBe('invalid_configuration');
  });

  it('a message on an unsubscribed channel is a typed unknown_channel', () => {
    const transportScript = script([{ at: AT0 + 10, channel: 'constituentWeights', payload: validWeight(7) }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'indexLevel'); // constituentWeights is NOT subscribed
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) expect(terminal.error.code).toBe('unknown_channel');
  });
});

describe('provider protocol typed errors (the documented feed laws)', () => {
  it('a record sequence regression is typed (sequenceNumber does not advance per index)', () => {
    const transportScript = script([
      { at: AT0, channel: 'indexLevel', payload: validIndexLevel(41) },
      { at: AT0 + 100, channel: 'indexLevel', payload: validIndexLevel(41, AT0 + 100) }, // repeated sequence
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'indexLevel');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(1); // the first record emitted fine
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(equitiesProtocolCodeOf(terminal.error)).toBe('sequence_regression');
      expect(terminal.error.message).toContain('41');
    }
  });

  it('a weekend trade date is a typed session_calendar_violation', () => {
    const saturdayLevel = { ...validIndexLevel(41), tradeDate: '2024-06-08' } as JsonObject;
    const transportScript = script([{ at: AT0, channel: 'indexLevel', payload: saturdayLevel }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'indexLevel');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(0);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(equitiesProtocolCodeOf(terminal.error)).toBe('session_calendar_violation');
      expect(terminal.error.message).toContain('2024-06-08');
    }
  });

  it('an out-of-session dissemination instant is a typed session_calendar_violation', () => {
    // 2024-06-03T11:00:00Z — Monday, but pre-open (the US regular session opens 13:30 UTC).
    const preOpen = { ...validIndexLevel(41), disseminationTimeMs: AT0 - 3 * 3_600_000 } as JsonObject;
    const transportScript = script([{ at: AT0, channel: 'indexLevel', payload: preOpen }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'indexLevel');
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(equitiesProtocolCodeOf(terminal.error)).toBe('session_calendar_violation');
      expect(terminal.error.message).toContain('session window');
    }
  });

  it('a dissemination instant on a different day than the trade date is typed (intraday on D happens on D)', () => {
    // Disseminated Tuesday 2024-06-04T14:00Z for trade date Monday 2024-06-03.
    const offDay = { ...validIndexLevel(41), disseminationTimeMs: AT0 + 86_400_000 } as JsonObject;
    const transportScript = script([{ at: AT0 + 86_400_000, channel: 'indexLevel', payload: offDay }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'indexLevel');
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(equitiesProtocolCodeOf(terminal.error)).toBe('session_calendar_violation');
      expect(terminal.error.message).toContain('trade date');
    }
  });

  it('constituent weights honor the trade-date calendar law but not the intraday window law', () => {
    // A weekend reconstitution record is typed...
    const weekendWeights = { ...validWeight(7), tradeDate: '2024-06-08' } as JsonObject;
    const weekendScript = script([{ at: AT0, channel: 'constituentWeights', payload: weekendWeights }]);
    const weekendSession = sessionOver(weekendScript);
    weekendSession.open();
    subscribe(weekendSession, 'constituentWeights');
    const weekend = drain(weekendSession);
    expect(weekend.terminal.ok).toBe(false);
    if (!weekend.terminal.ok) {
      expect(equitiesProtocolCodeOf(weekend.terminal.error)).toBe('session_calendar_violation');
    }
    // ...while a same-day pre-open dissemination of weights is fine (not an intraday channel).
    const preOpenWeights = { ...validWeight(7), disseminationTimeMs: AT0 - 3 * 3_600_000 } as JsonObject;
    const preOpenScript = script([{ at: AT0, channel: 'constituentWeights', payload: preOpenWeights }]);
    const preOpenSession = sessionOver(preOpenScript);
    preOpenSession.open();
    subscribe(preOpenSession, 'constituentWeights');
    const preOpen = drain(preOpenSession);
    expect(preOpen.terminal.ok).toBe(true);
    expect(preOpen.events.length).toBe(1);
  });

  it('a duplicate corporate action id is a typed duplicate_action', () => {
    const transportScript = script([
      { at: AT0 + 20, channel: 'corporateActions', payload: validAction('ACT-2024-0009') },
      { at: AT0 + 30, channel: 'corporateActions', payload: validAction('ACT-2024-0009') },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'corporateActions');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(1);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(equitiesProtocolCodeOf(terminal.error)).toBe('duplicate_action');
      expect(terminal.error.message).toContain('ACT-2024-0009');
    }
  });

  it('an unknown record type is a typed protocol error (criterion 6)', () => {
    const transportScript = script([
      { at: AT0, channel: 'indexLevel', payload: { ...validIndexLevel(41), recordType: 'CLOSING_LEVEL' } as JsonObject },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'indexLevel');
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(equitiesProtocolCodeOf(terminal.error)).toBe('unknown_message_type');
      expect(terminal.error.message).toContain('CLOSING_LEVEL');
    }
  });

  it('a malformed documented payload is a typed protocol error', () => {
    const transportScript = script([
      { at: AT0, channel: 'indexLevel', payload: { ...validIndexLevel(41), indexLevel: 'free' } as JsonObject },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'indexLevel');
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(equitiesProtocolCodeOf(terminal.error)).toBe('malformed_payload');
      expect(terminal.error.message).toContain('"indexLevel"');
    }
  });

  it('an unmapped raw field through the session is a typed MappingError (the contract case)', () => {
    const transportScript = script([
      { at: AT0, channel: 'indexLevel', payload: { ...validIndexLevel(41), vendor_extra: 'surprise' } as JsonObject },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'indexLevel');
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
    const transportScript = script([{ at: AT0, channel: 'indexLevel', payload: validIndexLevel(41) }]);
    const session = sessionOver(transportScript, false);
    session.open();
    subscribe(session, 'indexLevel');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(0);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(terminal.error.kind).toBe('entitlement');
      expect(terminal.error.code).toBe('entitlement_undeclared');
    }
  });

  it('a bad entitlement in the config is rejected at construction (collect-all)', () => {
    const construction = createEquitiesAdapterSession({ transport: transportFor(script([])), entitlement: { nope: 1 } });
    expect(construction.ok).toBe(false);
    if (!construction.ok) expect(construction.errors.length).toBeGreaterThan(0);
  });
});

describe('determinism (criterion 3: byte-identical, twice)', () => {
  const mixedScript = script([
    { at: AT0, channel: 'indexLevel', payload: validIndexLevel(41) },
    { at: AT0 + 10, channel: 'constituentWeights', payload: validWeight(7) },
    { at: AT0 + 20, channel: 'corporateActions', payload: validAction('ACT-2024-0001') },
    { at: AT0 + 30, channel: 'indexLevel', payload: validIndexLevel(42, AT0 + 30) },
    { at: AT0 + 40, channel: 'constituentWeights', payload: validWeight(8, 'TEST-BBB') },
  ]);

  it('the same scripted timeline emits a byte-identical canonical stream (deep-equal + JSON-identical)', () => {
    const first = runMixed();
    const second = runMixed();
    expect(first.length).toBe(second.length);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toEqual(second);

    function runMixed(): unknown[] {
      const session = sessionOver(mixedScript);
      session.open();
      subscribe(session, 'indexLevel');
      subscribe(session, 'constituentWeights');
      subscribe(session, 'corporateActions');
      const { events, terminal } = drain(session);
      if (!terminal.ok || terminal.value !== null) throw new Error('must drain cleanly');
      return events;
    }
  });

  it('sequence trackers and the dedup set are pure functions of the consumed timeline (guard introspection)', () => {
    const guard = createEquitiesGuardTransport(transportFor(mixedScript));
    const sessionConstruction = createAdapterSession({
      descriptor: EQUITIES_SOURCE_DESCRIPTOR,
      adapter: EQUITIES_ADAPTER,
      transport: guard,
      mapping_tables: EQUITIES_MAPPING_TABLES,
      entitlement: EQUITIES_ENTITLEMENT,
    });
    if (!sessionConstruction.ok) throw new Error('must construct');
    const session = sessionConstruction.session;
    session.open();
    subscribe(session, 'indexLevel');
    subscribe(session, 'constituentWeights');
    subscribe(session, 'corporateActions');
    const pumped = session.pump();
    expect(pumped.ok).toBe(true);
    if (pumped.ok) expect(pumped.value).toBe(5);
    const trackers = guard.sequenceTrackers();
    expect(trackers['indexLevel|TEST-LARGECAP']).toBe(42);
    expect(trackers['constituentWeights|TEST-LARGECAP']).toBe(8);
    expect(guard.seenActionIds()).toEqual(['ACT-2024-0001']);
  });
});
