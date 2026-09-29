/**
 * @tradrl/adapter-news — the adapter session tests.
 *
 * Behavioral: the full lifecycle over both documented channels; every
 * typed error path the work order names (use-after-close, double-close,
 * subscribe-before-open, unknown channel, unmapped field, unknown record
 * type, malformed payload, duplicate item, entitlement refusal); THE
 * EMBARGO QUARTET POLICY through the session (hold-and-release at the
 * lift instant — available_time == the embargo lift, never before; a
 * timeline draining with held records is a typed embargo_not_lifted
 * error, never a silent drop); the unmangled request pass-through; the
 * item dedup discipline; and byte-determinism (the same script -> the
 * same stream, twice).
 *
 * All tests run over the REAL SDK's scripted fake transport (test-only
 * relative import — the repo's established pattern; the package sources
 * import nothing).
 */

import { describe, expect, it } from 'vitest';

import {
  createNewsAdapterSession,
  createNewsSessionWithoutEntitlement,
  createAdapterSession,
  newsSubscription,
  createNewsGuardTransport,
  NEWS_WIRE_SERVICE_ENTITLEMENT,
  NEWS_PUBLIC_ENTITLEMENT,
  NEWS_SOURCE_DESCRIPTOR,
  NEWS_ADAPTER,
  NEWS_MAPPING_TABLES,
  isProtocolError,
  newsProtocolCodeOf,
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
const AT0 = 1_717_423_200_000;

const wireItem = (itemId: string, embargoTimeMs?: number): JsonObject =>
  ({
    recordType: 'NEWS_ITEM',
    itemId,
    publisherCode: 'PUB-A',
    publishedTimeMs: AT0,
    headline: `Synthetic test headline ${itemId}`,
    body: 'Synthetic wire body.',
    tickers: ['TEST-AAA'],
    tags: ['TEST-TAG'],
    url: `https://example.invalid/item/${itemId}`,
    ...(embargoTimeMs === undefined ? {} : { embargoTimeMs }),
  }) as JsonObject;

const publicHeadline = (itemId: string): JsonObject =>
  ({
    recordType: 'NEWS_ITEM',
    itemId,
    publisherCode: 'PUB-B',
    publishedTimeMs: AT0 + 5,
    headline: `Synthetic public headline ${itemId}`,
    tickers: ['TEST-BBB'],
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

function sessionOver(transportScript: TransportScript, entitlement: unknown = NEWS_WIRE_SERVICE_ENTITLEMENT): AdapterSession {
  const construction =
    entitlement === null
      ? createNewsSessionWithoutEntitlement(transportFor(transportScript))
      : createNewsAdapterSession({ transport: transportFor(transportScript), entitlement: entitlement as typeof NEWS_WIRE_SERVICE_ENTITLEMENT });
  if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
  return construction.session;
}

function subscribe(
  session: AdapterSession,
  channel: 'publicHeadlines' | 'licensedWire',
  instrument = 'TEST-AAA',
): void {
  const spec = newsSubscription({ channel, instrument });
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

describe('the happy path across both documented channels', () => {
  it('open -> subscribe* -> drain -> close over a mixed scripted timeline', () => {
    const transportScript = script([
      { at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1') },
      { at: AT0 + 10, channel: 'publicHeadlines', payload: publicHeadline('PUB-1') },
      { at: AT0 + 20, channel: 'licensedWire', payload: wireItem('WIRE-2') },
    ]);
    const session = sessionOver(transportScript);
    expect(session.open().ok).toBe(true);
    subscribe(session, 'licensedWire', 'TEST-AAA');
    subscribe(session, 'publicHeadlines', 'TEST-BBB');
    expect(session.state()).toBe('subscribed');

    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    if (terminal.ok) expect(terminal.value).toBeNull();
    expect(events.length).toBe(3);
    expect(events.every((event) => event.event_type === 'news')).toBe(true);
    expect(session.lastMessageAt()).toBe(AT0 + 20);
    expect(session.close().ok).toBe(true);
    expect(session.state()).toBe('closed');
  });

  it('the events carry the canonical news payloads (symbols, enum-translated source, body)', () => {
    const transportScript = script([
      { at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1') },
      { at: AT0 + 10, channel: 'publicHeadlines', payload: publicHeadline('PUB-1') },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    subscribe(session, 'publicHeadlines', 'TEST-BBB');
    const { events } = drain(session);
    const [wire, headline] = events;
    if (wire.event_type !== 'news' || headline.event_type !== 'news') throw new Error('must be news events');
    expect(wire.payload.headline).toBe('Synthetic test headline WIRE-1');
    expect([...wire.payload.symbols]).toEqual(['TEST-AAA']);
    expect(wire.payload.source).toBe('publisher-a');
    expect(wire.payload.body).toBe('Synthetic wire body.');
    expect(headline.payload.source).toBe('publisher-b');
    expect([...headline.payload.symbols]).toEqual(['TEST-BBB']);
    // The two channels are separate canonical streams (each starts its own sequence).
    expect(wire.sequence).toBe(1);
    expect(headline.sequence).toBe(1);
  });

  it('every emitted event carries the quartet, provenance, entitlement ref and mapping ref', () => {
    const transportScript = script([{ at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1') }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    const { events } = drain(session);
    expect(events.length).toBe(1);
    const event = events[0] as unknown as Record<string, unknown>;
    expect(typeof event.event_time).toBe('number');
    expect(typeof event.available_time).toBe('number');
    expect((event.available_time as number) >= (event.event_time as number)).toBe(true);
    const provenance = event.provenance as Record<string, unknown>;
    expect(provenance.origin).toBe('historical');
    expect((provenance.adapter as Record<string, unknown>).id).toBe('adapter-news');
    const entitlement = event.entitlement as Record<string, unknown>;
    expect(entitlement.entitlement_id).toBe('ent-news-licensed-wire');
    expect((event.mapping as Record<string, unknown>).table_id).toBe('news-licensed-wire-item');
    expect(event.provider).toBe('news-wire-a');
    expect(event.venue).toBe('NEWS-WIRE-A');
    expect(event.instrument).toBe('TEST-AAA');
  });

  it('the PUBLIC entitlement tier drives the session equally (declared envelope swap)', () => {
    const transportScript = script([{ at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1') }]);
    const session = sessionOver(transportScript, NEWS_PUBLIC_ENTITLEMENT);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    const { events } = drain(session);
    expect(events.length).toBe(1);
    const entitlement = (events[0] as unknown as Record<string, unknown>).entitlement as Record<string, unknown>;
    expect(entitlement.entitlement_id).toBe('ent-news-public-headlines');
  });

  it('onEvent/pump deliver every event and abort on the first typed failure', () => {
    const transportScript = script([
      { at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1') },
      { at: AT0 + 10, channel: 'licensedWire', payload: wireItem('WIRE-2') },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    const seen: unknown[] = [];
    session.onEvent((event) => seen.push(event));
    const pumped = session.pump();
    expect(pumped.ok).toBe(true);
    if (pumped.ok) expect(pumped.value).toBe(2);
    expect(seen.length).toBe(2);

    const failingScript = script([
      { at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1') },
      { at: AT0 + 10, channel: 'licensedWire', payload: { ...wireItem('WIRE-2'), vendor_extra: 1 } as JsonObject },
    ]);
    const failingSession = sessionOver(failingScript);
    failingSession.open();
    subscribe(failingSession, 'licensedWire', 'TEST-AAA');
    const aborted = failingSession.pump();
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) expect(aborted.error.code).toBe('unmapped_raw_field');
  });
});

describe('THE EMBARGO QUARTET POLICY (criterion 9 — hold, release at the lift instant)', () => {
  it('a record received before its embargo lift is held and released at the lift instant (available_time == the lift)', () => {
    const transportScript = script([
      { at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1', AT0 + 5_000) }, // embargoed: lift at AT0+5000
      { at: AT0 + 6_000, channel: 'licensedWire', payload: wireItem('WIRE-2') },      // unembargoed, advances the timeline
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    expect(events.length).toBe(2);
    const [embargoed, later] = events;
    // The held record is delivered FIRST (its availability precedes the later item).
    expect((embargoed.payload as { headline?: string }).headline).toContain('WIRE-1');
    expect(embargoed.event_time).toBe(AT0);        // the publication instant
    expect(embargoed.available_time).toBe(AT0 + 5_000); // the embargo LIFT — never the earlier receipt
    expect(embargoed.ingestion_time).toBe(AT0 + 5_000); // the re-stamped emitter-facing receive instant
    expect(embargoed.available_time).toBeGreaterThanOrEqual(embargoed.event_time);
    expect(later.event_time).toBe(AT0);
    expect(later.available_time).toBe(AT0 + 6_000);
    // The delivery stream's receive instants stay non-decreasing.
    expect(embargoed.ingestion_time).toBeLessThanOrEqual(later.ingestion_time);
  });

  it('a record whose embargo already lifted at receipt is delivered immediately (available = receive)', () => {
    const transportScript = script([
      { at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1', AT0 - 60_000) }, // past-dated embargo
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    expect(events.length).toBe(1);
    expect(events[0].available_time).toBe(AT0);
  });

  it('a timeline that drains while a record remains embargoed is a typed embargo_not_lifted (never a silent drop)', () => {
    const transportScript = script([
      { at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1', AT0 + 60_000) }, // never lifts in the timeline
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(0);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(newsProtocolCodeOf(terminal.error)).toBe('embargo_not_lifted');
      expect(terminal.error.message).toContain('1 embargoed');
    }
  });

  it('the public channel has no embargo semantics (by documented shape — the field is unmapped there)', () => {
    const transportScript = script([{ at: AT0, channel: 'publicHeadlines', payload: publicHeadline('PUB-1') }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'publicHeadlines', 'TEST-BBB');
    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    expect(events.length).toBe(1);
    // The public fixture publishes at AT0+5 and is received at AT0: the
    // clamp law keeps available_time >= event_time.
    expect(events[0].available_time).toBe(AT0 + 5);
  });

  it('guard introspection: the held queue is visible while records wait for their lift (drain refuses)', () => {
    const guard = createNewsGuardTransport(transportFor(script([
      { at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1', AT0 + 5_000) },
    ])));
    const received = guard.recv();
    // The held record is NOT delivered; the drained timeline surfaces the
    // typed embargo failure instead (never a silent drop).
    expect(received.ok).toBe(false);
    if (!received.ok) {
      expect(newsProtocolCodeOf(received.error)).toBe('embargo_not_lifted');
    }
    // The item id was consumed at receipt (the dedup set) while the record is held.
    expect(guard.seenItemIds()).toEqual(['WIRE-1']);
    expect(guard.heldItems()).toEqual([AT0 + 5_000]);
  });
});

describe('the request pass-through (the neutrality contract)', () => {
  it('the documented SUBSCRIBE frame crosses the transport unmangled', () => {
    const transportScript = script([{ at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1') }]);
    const transport = transportFor(transportScript);
    const construction = createNewsAdapterSession({ transport, entitlement: NEWS_WIRE_SERVICE_ENTITLEMENT });
    if (!construction.ok) throw new Error('must construct');
    const session = construction.session;
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    const sent = transport.sent();
    expect(sent.length).toBe(1);
    expect(sent[0].channel).toBe('licensedWire');
    expect({ ...sent[0].payload }).toEqual({
      action: 'SUBSCRIBE',
      stream: 'licensedWire',
      symbol: 'TEST-AAA',
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
    const spec = newsSubscription({ channel: 'licensedWire', instrument: 'TEST-AAA' });
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
    const spec = newsSubscription({ channel: 'licensedWire', instrument: 'TEST-AAA' });
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
    const spec = newsSubscription({ channel: 'licensedWire', instrument: 'TEST-AAA' });
    if (!spec.ok) throw new Error('must build');
    const subscribed = session.subscribe(spec.value);
    expect(subscribed.ok).toBe(false);
    if (!subscribed.ok) expect(subscribed.error.code).toBe('use_after_close');
  });

  it('duplicate subscription on one channel is typed', () => {
    const session = sessionOver(script([]));
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    const spec = newsSubscription({ channel: 'licensedWire', instrument: 'TEST-AAA' });
    if (!spec.ok) throw new Error('must build');
    const result = session.subscribe(spec.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('duplicate_subscription');
  });

  it('a subscription outside the declared envelope is typed (undeclared channel / instrument)', () => {
    const session = sessionOver(script([]));
    session.open();
    const badChannel = session.subscribe({
      channel: 'correctionsWire',
      request: { action: 'SUBSCRIBE', stream: 'correctionsWire', symbol: 'TEST-AAA' },
      venue: 'NEWS-WIRE-A',
      instrument: 'TEST-AAA',
      asset_class: 'equity',
      mapping_table_id: 'news-licensed-wire-item',
    });
    expect(badChannel.ok).toBe(false);
    if (!badChannel.ok) expect(badChannel.error.code).toBe('invalid_configuration');

    const badInstrument = session.subscribe({
      channel: 'licensedWire',
      request: { action: 'SUBSCRIBE', stream: 'licensedWire', symbol: 'MSFT' },
      venue: 'NEWS-WIRE-A',
      instrument: 'MSFT',
      asset_class: 'equity',
      mapping_table_id: 'news-licensed-wire-item',
    });
    expect(badInstrument.ok).toBe(false);
    if (!badInstrument.ok) expect(badInstrument.error.code).toBe('invalid_configuration');
  });

  it('a message on an unsubscribed channel is a typed unknown_channel', () => {
    const transportScript = script([{ at: AT0 + 10, channel: 'publicHeadlines', payload: publicHeadline('PUB-1') }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA'); // publicHeadlines is NOT subscribed
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) expect(terminal.error.code).toBe('unknown_channel');
  });
});

describe('provider protocol typed errors (the documented wire laws)', () => {
  it('a repeated wire item id is a typed duplicate_item', () => {
    const transportScript = script([
      { at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1') },
      { at: AT0 + 10, channel: 'licensedWire', payload: wireItem('WIRE-1') },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(1);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(newsProtocolCodeOf(terminal.error)).toBe('duplicate_item');
      expect(terminal.error.message).toContain('WIRE-1');
    }
  });

  it('an unknown record type is a typed protocol error (criterion 6)', () => {
    const transportScript = script([
      { at: AT0, channel: 'licensedWire', payload: { ...wireItem('WIRE-1'), recordType: 'ADVISORY' } as JsonObject },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(newsProtocolCodeOf(terminal.error)).toBe('unknown_message_type');
      expect(terminal.error.message).toContain('ADVISORY');
    }
  });

  it('a malformed documented payload is a typed protocol error', () => {
    const transportScript = script([
      { at: AT0, channel: 'licensedWire', payload: { ...wireItem('WIRE-1'), publishedTimeMs: 0 } as JsonObject },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(newsProtocolCodeOf(terminal.error)).toBe('malformed_payload');
      expect(terminal.error.message).toContain('"publishedTimeMs"');
    }
  });

  it('a licensed-only field on the public channel through the session is a typed MappingError', () => {
    const transportScript = script([
      { at: AT0, channel: 'publicHeadlines', payload: { ...publicHeadline('PUB-1'), body: 'licensed content' } as JsonObject },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'publicHeadlines', 'TEST-BBB');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(0);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(terminal.error.kind).toBe('mapping');
      expect(terminal.error.code).toBe('unmapped_raw_field');
      expect(terminal.error.message).toContain('body');
    }
  });

  it('an unmapped raw field through the session is a typed MappingError (the contract case)', () => {
    const transportScript = script([
      { at: AT0, channel: 'licensedWire', payload: { ...wireItem('WIRE-1'), vendor_extra: 'surprise' } as JsonObject },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
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
    const transportScript = script([{ at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1') }]);
    const session = sessionOver(transportScript, null);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(0);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(terminal.error.kind).toBe('entitlement');
      expect(terminal.error.code).toBe('entitlement_undeclared');
    }
  });

  it('a bad entitlement in the config is rejected at construction (collect-all)', () => {
    const construction = createNewsAdapterSession({ transport: transportFor(script([])), entitlement: { nope: 1 } });
    expect(construction.ok).toBe(false);
    if (!construction.ok) expect(construction.errors.length).toBeGreaterThan(0);
  });
});

describe('determinism (criterion 3: byte-identical, twice)', () => {
  const mixedScript = script([
    { at: AT0, channel: 'licensedWire', payload: wireItem('WIRE-1') },
    { at: AT0 + 10, channel: 'licensedWire', payload: wireItem('WIRE-2', AT0 + 15) }, // embargoed; lifts at AT0+15, inside the timeline
    { at: AT0 + 20, channel: 'publicHeadlines', payload: publicHeadline('PUB-1') },
    { at: AT0 + 30, channel: 'licensedWire', payload: wireItem('WIRE-3') },
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
      subscribe(session, 'licensedWire', 'TEST-AAA');
      subscribe(session, 'publicHeadlines', 'TEST-BBB');
      const { events, terminal } = drain(session);
      if (!terminal.ok || terminal.value !== null) throw new Error('must drain cleanly');
      return events;
    }
  });

  it('the embargo release path is deterministic (the held record releases before the item that advanced the timeline)', () => {
    const session = sessionOver(mixedScript);
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    subscribe(session, 'publicHeadlines', 'TEST-BBB');
    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    expect(events.length).toBe(4);
    const headlines = events.map((event) =>
      event.event_type === 'news' ? event.payload.headline : '',
    );
    // WIRE-2 (held until AT0+15) is delivered BEFORE PUB-1 (received AT0+20).
    expect(headlines[0]).toContain('WIRE-1');
    expect(headlines[1]).toContain('WIRE-2');
    expect(headlines[2]).toContain('PUB-1');
    expect(headlines[3]).toContain('WIRE-3');
    const embargoed = events[1];
    expect(embargoed.available_time).toBe(AT0 + 15);
    expect(events[2].ingestion_time).toBe(AT0 + 20);
  });

  it('guard introspection: the item dedup set is a pure function of the consumed timeline', () => {
    const guard = createNewsGuardTransport(transportFor(mixedScript));
    const sessionConstruction = createAdapterSession({
      descriptor: NEWS_SOURCE_DESCRIPTOR,
      adapter: NEWS_ADAPTER,
      transport: guard,
      mapping_tables: NEWS_MAPPING_TABLES,
      entitlement: NEWS_WIRE_SERVICE_ENTITLEMENT,
    });
    if (!sessionConstruction.ok) throw new Error('must construct');
    const session = sessionConstruction.session;
    session.open();
    subscribe(session, 'licensedWire', 'TEST-AAA');
    subscribe(session, 'publicHeadlines', 'TEST-BBB');
    const pumped = session.pump();
    expect(pumped.ok).toBe(true);
    if (pumped.ok) expect(pumped.value).toBe(4);
    expect([...guard.seenItemIds()].sort()).toEqual(['PUB-1', 'WIRE-1', 'WIRE-2', 'WIRE-3']);
    expect(guard.heldItems()).toEqual([]); // everything released within the timeline
  });
});
