/**
 * @tradrl/adapter-alternative-data — the adapter session tests.
 *
 * Behavioral: the full lifecycle over every documented channel; every
 * typed error path the work order names (use-after-close, double-close,
 * subscribe-before-open, unknown channel, unmapped field, unknown record
 * type, malformed payload, mid-window release, overlapping observation
 * windows, entitlement refusal); the window->release quartet through the
 * session (available_time == the declared release instant, never
 * mid-window); the unmangled request pass-through; the per-series window
 * sequencing discipline; and byte-determinism (the same script -> the
 * same stream, twice).
 *
 * All tests run over the REAL SDK's scripted fake transport (test-only
 * relative import — the repo's established pattern; the package sources
 * import nothing).
 */

import { describe, expect, it } from 'vitest';

import {
  createAltDataAdapterSession,
  createAltDataSessionWithoutEntitlement,
  createAdapterSession,
  altDataSubscription,
  createAltDataGuardTransport,
  ALTDATA_VENDOR_ENTITLEMENT,
  ALTDATA_PUBLIC_ENTITLEMENT,
  ALTDATA_SOURCE_DESCRIPTOR,
  ALTDATA_ADAPTER,
  ALTDATA_MAPPING_TABLES,
  isProtocolError,
  altDataProtocolCodeOf,
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

/** Observation windows: consecutive records of one series must TILE (abut, never overlap). */
const W1 = { windowStartMs: AT0 - 3_600_000, windowEndMs: AT0 - 1_800_000, releaseTimeMs: AT0 };
const W2 = { windowStartMs: AT0 - 1_800_000, windowEndMs: AT0, releaseTimeMs: AT0 + 1_000 };

const sentimentObservation = (window: typeof W1, sequence: string): JsonObject =>
  ({
    recordType: 'SENTIMENT_OBSERVATION',
    seriesId: sequence,
    ...window,
    sentimentScore: '-0.21',
  }) as JsonObject;

const onChainMetric = (window: typeof W1): JsonObject =>
  ({
    recordType: 'ON_CHAIN_METRIC',
    chainId: 'CHAIN-A',
    metricCode: 'ACTIVE_ADDRESSES',
    metricValue: '1520',
    ...window,
  }) as JsonObject;

const economicObservation = (window: typeof W1): JsonObject =>
  ({
    recordType: 'ECONOMIC_SERIES_OBSERVATION',
    seriesId: 'TEST-ECON-GDP',
    regionCode: 'US',
    period: '2024-Q2',
    actualValue: '215.2',
    forecastValue: '214.8',
    priorValue: '214.0',
    unitCode: 'K persons',
    ...window,
  }) as JsonObject;

const satelliteObservation = (window: typeof W1): JsonObject =>
  ({
    recordType: 'SATELLITE_OBSERVATION',
    seriesId: 'TEST-SAT-OIL',
    observationType: 'OIL_STORAGE_ESTIMATE',
    observationPeriod: '2024-06-02',
    observationValue: '512.3',
    unitCode: 'MMbbl',
    ...window,
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

function sessionOver(transportScript: TransportScript, entitlement: unknown = ALTDATA_VENDOR_ENTITLEMENT): AdapterSession {
  const construction =
    entitlement === null
      ? createAltDataSessionWithoutEntitlement(transportFor(transportScript))
      : createAltDataAdapterSession({ transport: transportFor(transportScript), entitlement: entitlement as typeof ALTDATA_VENDOR_ENTITLEMENT });
  if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
  return construction.session;
}

function subscribe(
  session: AdapterSession,
  channel: 'sentiment' | 'onChain' | 'economicSeries' | 'satelliteSeries',
  instrument: string,
): void {
  const spec = altDataSubscription({ channel, instrument });
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
      { at: AT0, channel: 'sentiment', payload: sentimentObservation(W1, 'TEST-SENTIMENT-A') },
      { at: AT0 + 10, channel: 'onChain', payload: onChainMetric(W1) },
      { at: AT0 + 20, channel: 'economicSeries', payload: economicObservation(W1) },
      { at: AT0 + 30, channel: 'satelliteSeries', payload: satelliteObservation(W1) },
    ]);
    const session = sessionOver(transportScript);
    expect(session.open().ok).toBe(true);
    subscribe(session, 'sentiment', 'TEST-AAA');
    subscribe(session, 'onChain', 'TEST-CHAIN-A');
    subscribe(session, 'economicSeries', 'TEST-ECON-GDP');
    subscribe(session, 'satelliteSeries', 'TEST-SAT-OIL');
    expect(session.state()).toBe('subscribed');

    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    if (terminal.ok) expect(terminal.value).toBeNull();
    expect(events.length).toBe(4);
    expect(events.map((event) => event.event_type)).toEqual([
      'social_signal', 'social_signal', 'macro_release', 'fundamental',
    ]);
    expect(session.lastMessageAt()).toBe(AT0 + 30);
    expect(session.close().ok).toBe(true);
    expect(session.state()).toBe('closed');
  });

  it('the window->release quartet through the session: available_time == the release instant, late polls included', () => {
    const transportScript = script([
      { at: AT0, channel: 'sentiment', payload: sentimentObservation(W1, 'TEST-SENTIMENT-A') },
      { at: AT0 + 7_200_000, channel: 'sentiment', payload: sentimentObservation(W2, 'TEST-SENTIMENT-A') }, // polled 2h late
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'sentiment', 'TEST-AAA');
    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    expect(events.length).toBe(2);
    const [onTime, late] = events;
    expect(onTime.event_time).toBe(AT0);
    expect(onTime.available_time).toBe(AT0); // the release instant
    expect(late.event_time).toBe(AT0 + 1_000); // the SECOND release instant (the declared basis)
    expect(late.available_time).toBe(AT0 + 1_000); // NOT the late poll — the declared law (L4)
    expect(late.ingestion_time).toBe(AT0 + 7_200_000); // when the host actually ingested it
  });

  it('the per-series window sequencing accepts tiling windows (abutting series records)', () => {
    const transportScript = script([
      { at: AT0, channel: 'sentiment', payload: sentimentObservation(W1, 'TEST-SENTIMENT-A') },
      { at: AT0 + 10, channel: 'sentiment', payload: sentimentObservation(W2, 'TEST-SENTIMENT-A') },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'sentiment', 'TEST-AAA');
    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    expect(events.length).toBe(2);
    expect(events[0].sequence).toBe(1);
    expect(events[1].sequence).toBe(2);
  });

  it('every emitted event carries the quartet, provenance, entitlement ref and mapping ref', () => {
    const transportScript = script([{ at: AT0, channel: 'sentiment', payload: sentimentObservation(W1, 'TEST-SENTIMENT-A') }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'sentiment', 'TEST-AAA');
    const { events } = drain(session);
    expect(events.length).toBe(1);
    const event = events[0] as unknown as Record<string, unknown>;
    expect(typeof event.event_time).toBe('number');
    expect(typeof event.available_time).toBe('number');
    expect((event.available_time as number) >= (event.event_time as number)).toBe(true);
    const provenance = event.provenance as Record<string, unknown>;
    expect(provenance.origin).toBe('historical');
    expect((provenance.adapter as Record<string, unknown>).id).toBe('adapter-alternative-data');
    const entitlement = event.entitlement as Record<string, unknown>;
    expect(entitlement.entitlement_id).toBe('ent-altdata-vendor-licensed');
    expect((event.mapping as Record<string, unknown>).table_id).toBe('altdata-sentiment-observation');
    expect(event.provider).toBe('alt-vendor-a');
    expect(event.venue).toBe('ALT-VENDOR-A');
    expect(event.instrument).toBe('TEST-AAA');
  });

  it('the PUBLIC entitlement tier drives the session equally (declared envelope swap)', () => {
    const transportScript = script([{ at: AT0, channel: 'sentiment', payload: sentimentObservation(W1, 'TEST-SENTIMENT-A') }]);
    const session = sessionOver(transportScript, ALTDATA_PUBLIC_ENTITLEMENT);
    session.open();
    subscribe(session, 'sentiment', 'TEST-AAA');
    const { events } = drain(session);
    expect(events.length).toBe(1);
    const entitlement = (events[0] as unknown as Record<string, unknown>).entitlement as Record<string, unknown>;
    expect(entitlement.entitlement_id).toBe('ent-altdata-open-series');
  });

  it('onEvent/pump deliver every event and abort on the first typed failure', () => {
    const transportScript = script([
      { at: AT0, channel: 'sentiment', payload: sentimentObservation(W1, 'TEST-SENTIMENT-A') },
      { at: AT0 + 10, channel: 'sentiment', payload: sentimentObservation(W2, 'TEST-SENTIMENT-A') },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'sentiment', 'TEST-AAA');
    const seen: unknown[] = [];
    session.onEvent((event) => seen.push(event));
    const pumped = session.pump();
    expect(pumped.ok).toBe(true);
    if (pumped.ok) expect(pumped.value).toBe(2);
    expect(seen.length).toBe(2);

    const failingScript = script([
      { at: AT0, channel: 'sentiment', payload: sentimentObservation(W1, 'TEST-SENTIMENT-A') },
      { at: AT0 + 10, channel: 'sentiment', payload: { ...sentimentObservation(W2, 'TEST-SENTIMENT-A'), vendor_extra: 1 } as JsonObject },
    ]);
    const failingSession = sessionOver(failingScript);
    failingSession.open();
    subscribe(failingSession, 'sentiment', 'TEST-AAA');
    const aborted = failingSession.pump();
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) expect(aborted.error.code).toBe('unmapped_raw_field');
  });
});

describe('the request pass-through (the neutrality contract)', () => {
  it('the documented SUBSCRIBE frame crosses the transport unmangled', () => {
    const transportScript = script([{ at: AT0, channel: 'sentiment', payload: sentimentObservation(W1, 'TEST-SENTIMENT-A') }]);
    const transport = transportFor(transportScript);
    const construction = createAltDataAdapterSession({ transport, entitlement: ALTDATA_VENDOR_ENTITLEMENT });
    if (!construction.ok) throw new Error('must construct');
    const session = construction.session;
    session.open();
    subscribe(session, 'satelliteSeries', 'TEST-SAT-OIL');
    const sent = transport.sent();
    expect(sent.length).toBe(1);
    expect(sent[0].channel).toBe('satelliteSeries');
    expect({ ...sent[0].payload }).toEqual({
      action: 'SUBSCRIBE',
      series: 'satelliteSeries',
      subject: 'TEST-SAT-OIL',
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
    const spec = altDataSubscription({ channel: 'sentiment', instrument: 'TEST-AAA' });
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
    const spec = altDataSubscription({ channel: 'sentiment', instrument: 'TEST-AAA' });
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
    const spec = altDataSubscription({ channel: 'sentiment', instrument: 'TEST-AAA' });
    if (!spec.ok) throw new Error('must build');
    const subscribed = session.subscribe(spec.value);
    expect(subscribed.ok).toBe(false);
    if (!subscribed.ok) expect(subscribed.error.code).toBe('use_after_close');
  });

  it('duplicate subscription on one channel is typed', () => {
    const session = sessionOver(script([]));
    session.open();
    subscribe(session, 'sentiment', 'TEST-AAA');
    const spec = altDataSubscription({ channel: 'sentiment', instrument: 'TEST-AAA' });
    if (!spec.ok) throw new Error('must build');
    const result = session.subscribe(spec.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('duplicate_subscription');
  });

  it('a subscription outside the declared envelope is typed (undeclared channel / instrument / asset class)', () => {
    const session = sessionOver(script([]));
    session.open();
    const badChannel = session.subscribe({
      channel: 'webTraffic',
      request: { action: 'SUBSCRIBE', series: 'webTraffic', subject: 'TEST-AAA' },
      venue: 'ALT-VENDOR-A',
      instrument: 'TEST-AAA',
      asset_class: 'equity',
      mapping_table_id: 'altdata-sentiment-observation',
    });
    expect(badChannel.ok).toBe(false);
    if (!badChannel.ok) expect(badChannel.error.code).toBe('invalid_configuration');

    const badInstrument = session.subscribe({
      channel: 'sentiment',
      request: { action: 'SUBSCRIBE', series: 'sentiment', subject: 'GME' },
      venue: 'ALT-VENDOR-A',
      instrument: 'GME',
      asset_class: 'equity',
      mapping_table_id: 'altdata-sentiment-observation',
    });
    expect(badInstrument.ok).toBe(false);
    if (!badInstrument.ok) expect(badInstrument.error.code).toBe('invalid_configuration');

    // The channel->asset-class law lives in the documented request builder.
    const badAssetClass = altDataSubscription({ channel: 'onChain', instrument: 'TEST-AAA' });
    expect(badAssetClass.ok).toBe(false);
    if (!badAssetClass.ok) expect(badAssetClass.error.code).toBe('invalid_configuration');
  });

  it('a message on an unsubscribed channel is a typed unknown_channel', () => {
    const transportScript = script([{ at: AT0 + 10, channel: 'onChain', payload: onChainMetric(W1) }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'sentiment', 'TEST-AAA'); // onChain is NOT subscribed
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) expect(terminal.error.code).toBe('unknown_channel');
  });
});

describe('provider protocol typed errors (the documented observation laws)', () => {
  it('a mid-window release through the session is a typed release_before_window_close (never mid-window)', () => {
    const midWindow = { ...W1, releaseTimeMs: W1.windowEndMs - 1 };
    const transportScript = script([{ at: AT0, channel: 'sentiment', payload: sentimentObservation(midWindow, 'TEST-SENTIMENT-A') }]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'sentiment', 'TEST-AAA');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(0);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(altDataProtocolCodeOf(terminal.error)).toBe('release_before_window_close');
      expect(terminal.error.message).toContain('never mid-window');
    }
  });

  it('an overlapping observation window is a typed observation_window_overlap (windows tile, never overlap)', () => {
    const overlapping = { windowStartMs: W1.windowEndMs - 60_000, windowEndMs: AT0, releaseTimeMs: AT0 + 1_000 };
    const transportScript = script([
      { at: AT0, channel: 'sentiment', payload: sentimentObservation(W1, 'TEST-SENTIMENT-A') },
      { at: AT0 + 10, channel: 'sentiment', payload: sentimentObservation(overlapping, 'TEST-SENTIMENT-A') },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'sentiment', 'TEST-AAA');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(1); // the first record emitted fine
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(altDataProtocolCodeOf(terminal.error)).toBe('observation_window_overlap');
      expect(terminal.error.message).toContain('TEST-SENTIMENT-A');
    }
  });

  it('the overlap law is per series (a different series on the same channel does not collide)', () => {
    const transportScript = script([
      { at: AT0, channel: 'sentiment', payload: sentimentObservation(W1, 'TEST-SENTIMENT-A') },
      { at: AT0 + 10, channel: 'sentiment', payload: sentimentObservation(W1, 'TEST-SENTIMENT-B') }, // a different series
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'sentiment', 'TEST-AAA');
    const { events, terminal } = drain(session);
    expect(terminal.ok).toBe(true);
    expect(events.length).toBe(2);
  });

  it('an unknown record type is a typed protocol error (criterion 6)', () => {
    const transportScript = script([
      { at: AT0, channel: 'onChain', payload: { ...onChainMetric(W1), recordType: 'ON_CHAIN_BLOCK' } as JsonObject },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'onChain', 'TEST-CHAIN-A');
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(altDataProtocolCodeOf(terminal.error)).toBe('unknown_message_type');
      expect(terminal.error.message).toContain('ON_CHAIN_BLOCK');
    }
  });

  it('a malformed documented payload is a typed protocol error', () => {
    const transportScript = script([
      { at: AT0, channel: 'onChain', payload: { ...onChainMetric(W1), metricValue: 'lots' } as JsonObject },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'onChain', 'TEST-CHAIN-A');
    const { terminal } = drain(session);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(altDataProtocolCodeOf(terminal.error)).toBe('malformed_payload');
      expect(terminal.error.message).toContain('"metricValue"');
    }
  });

  it('an unmapped raw field through the session is a typed MappingError (the contract case)', () => {
    const transportScript = script([
      { at: AT0, channel: 'sentiment', payload: { ...sentimentObservation(W1, 'TEST-SENTIMENT-A'), vendor_extra: 'surprise' } as JsonObject },
    ]);
    const session = sessionOver(transportScript);
    session.open();
    subscribe(session, 'sentiment', 'TEST-AAA');
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
    const transportScript = script([{ at: AT0, channel: 'sentiment', payload: sentimentObservation(W1, 'TEST-SENTIMENT-A') }]);
    const session = sessionOver(transportScript, null);
    session.open();
    subscribe(session, 'sentiment', 'TEST-AAA');
    const { events, terminal } = drain(session);
    expect(events.length).toBe(0);
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) {
      expect(terminal.error.kind).toBe('entitlement');
      expect(terminal.error.code).toBe('entitlement_undeclared');
    }
  });

  it('a bad entitlement in the config is rejected at construction (collect-all)', () => {
    const construction = createAltDataAdapterSession({ transport: transportFor(script([])), entitlement: { nope: 1 } });
    expect(construction.ok).toBe(false);
    if (!construction.ok) expect(construction.errors.length).toBeGreaterThan(0);
  });
});

describe('determinism (criterion 3: byte-identical, twice)', () => {
  const mixedScript = script([
    { at: AT0, channel: 'sentiment', payload: sentimentObservation(W1, 'TEST-SENTIMENT-A') },
    { at: AT0 + 10, channel: 'onChain', payload: onChainMetric(W1) },
    { at: AT0 + 20, channel: 'economicSeries', payload: economicObservation(W1) },
    { at: AT0 + 30, channel: 'satelliteSeries', payload: satelliteObservation(W1) },
    { at: AT0 + 40, channel: 'sentiment', payload: sentimentObservation(W2, 'TEST-SENTIMENT-A') },
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
      subscribe(session, 'sentiment', 'TEST-AAA');
      subscribe(session, 'onChain', 'TEST-CHAIN-A');
      subscribe(session, 'economicSeries', 'TEST-ECON-GDP');
      subscribe(session, 'satelliteSeries', 'TEST-SAT-OIL');
      const { events, terminal } = drain(session);
      if (!terminal.ok || terminal.value !== null) throw new Error('must drain cleanly');
      return events;
    }
  });

  it('the window trackers are pure functions of the consumed timeline (guard introspection)', () => {
    const guard = createAltDataGuardTransport(transportFor(mixedScript));
    const sessionConstruction = createAdapterSession({
      descriptor: ALTDATA_SOURCE_DESCRIPTOR,
      adapter: ALTDATA_ADAPTER,
      transport: guard,
      mapping_tables: ALTDATA_MAPPING_TABLES,
      entitlement: ALTDATA_VENDOR_ENTITLEMENT,
    });
    if (!sessionConstruction.ok) throw new Error('must construct');
    const session = sessionConstruction.session;
    session.open();
    subscribe(session, 'sentiment', 'TEST-AAA');
    subscribe(session, 'onChain', 'TEST-CHAIN-A');
    subscribe(session, 'economicSeries', 'TEST-ECON-GDP');
    subscribe(session, 'satelliteSeries', 'TEST-SAT-OIL');
    const pumped = session.pump();
    expect(pumped.ok).toBe(true);
    if (pumped.ok) expect(pumped.value).toBe(5);
    const trackers = guard.windowTrackers();
    expect(trackers['sentiment|TEST-SENTIMENT-A']).toBe(W2.windowEndMs);
    expect(trackers['onChain|CHAIN-A']).toBe(W1.windowEndMs);
    expect(trackers['economicSeries|TEST-ECON-GDP']).toBe(W1.windowEndMs);
    expect(trackers['satelliteSeries|TEST-SAT-OIL']).toBe(W1.windowEndMs);
  });
});
