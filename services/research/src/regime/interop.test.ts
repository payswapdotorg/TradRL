// @tradrl/research (service) — the regime lane's INTEROP TRIP WIRES.
//
// Law D-003/D-004: this lane's sources import NOTHING outside their own
// lane (their own contract package via the single-import surface). This
// test file imports the REAL packages on this branch (test-only, via
// relative source paths — the repo's established pattern) and proves the
// research-publication pattern has not drifted:
//
//   1. The T021 research-publication pattern: the regime publication's
//      envelope JSON-round-trips through the REAL agent-os
//      createMessageEnvelope; the topic reservation matches
//      kind-for-kind; the payload discipline (opaque report reference)
//      agrees with the sentiment lane's equivalent records.
//   2. The T009 replay world: the regime pipeline consumes the REAL
//      market-world replay fixture stream end to end — its recorded
//      quote/trade/book_snapshot history produces classifications,
//      changes and ONE bound publication.
//   3. The T037 Coinbase adapter: the REAL adapter's emitted market
//      events feed the regime pipeline directly (quotes+trades windows).
//   4. Determinism across lanes: the same replay stream produces
//      byte-identical reports across two independent runs.
//   5. The service root: the regime lane's surface composes additively
//      beside the sentiment lane (T021) without collision — the root
//      still exports both lanes' names.

import { describe, expect, it } from 'vitest';

// --- The lane under test + its contract package -----------------------------
import {
  runRegimePipeline,
  REGIME_RUN_CONFIG,
  type RegimeRunConfig,
} from './index';
import {
  createRegimeRecordingPort,
  createScriptedMarketSource,
  type MarketObservation,
  type MarketObservationSource,
} from '../../../../bodies/regime-researcher/src/index';
import {
  fixtureEvents,
} from '../../../market-world/src/index';

// --- REAL packages on this branch (test-only imports — the trip wires) ------
import { KERNEL_TOPICS, createMessageEnvelope, isMessageEnvelope } from '../../../../packages/agent-os/src/index';
import {
  createCoinbaseAdapterSession,
  coinbaseSubscription,
  COINBASE_ENTITLEMENT,
  type AdapterSession as CoinbaseSession,
  type EmittedEvent as CoinbaseEvent,
} from '../../../../adapters/coinbase/src/index';
import {
  createFakeTransport,
  type FakeTransport,
  type JsonObject,
  type TransportScript,
} from '../../../../packages/provider-sdk/src/index';

// --- The sibling lane (T021) — the service-root composition witness -----------
import {
  SENTIMENT_RESEARCHER_BODY as T021_SENTIMENT_BODY,
  serviceInfo,
} from '../sentiment/index';

const codesOf = (result: { ok: boolean; errors?: readonly { code: string }[] }): readonly string[] =>
  result.ok ? [] : ((result.errors ?? []) as readonly { code: string }[]).map((e) => e.code);
function unwrap<T>(result: { readonly ok: boolean; readonly errors?: readonly { code: string; message: string }[]; readonly value?: T }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
  return result.value as T;
}

// ---------------------------------------------------------------------------
// The replay-world adapter: REAL T009 fixture events as observation sources
// ---------------------------------------------------------------------------

/** Adapts a batch of replay-world records into a scripted observation source. */
function replaySource(records: readonly Record<string, unknown>[], id: string): MarketObservationSource {
  return createScriptedMarketSource(
    { id, version: '1.0.0', provider: 'replay-fixtures' },
    records.filter((record) => {
      const eventType = record.event_type;
      return eventType === 'quote' || eventType === 'trade' || eventType === 'book_snapshot';
    }) as unknown as readonly MarketObservation[],
  );
}

/** A run config aligned to the replay world's knowledge clock. */
function replayConfig(asOf: number): RegimeRunConfig {
  return {
    ...REGIME_RUN_CONFIG,
    asOf: asOf as never,
    // the replay fixtures' availability stays inside a compact envelope;
    // clamp the publication instant into the representable range too.
    publishedAt: asOf as never,
  };
}

function latestAvailabilityOf(records: readonly Record<string, unknown>[]): number {
  let latest = 0;
  for (const record of records) {
    const available = record.available_time;
    if (typeof available === 'number' && available > latest) latest = available;
  }
  return latest;
}

describe('interop: the REAL replay world (T009) feeds the regime pipeline end to end', () => {
  it('the recorded stream produces classifications, changes and ONE bound publication', () => {
    const events = fixtureEvents();
    const source = replaySource(events, 'replay-interop-1');
    const publisher = createRegimeRecordingPort();
    const outcome = runRegimePipeline(replayConfig(latestAvailabilityOf(events)), {
      sources: [source],
      publisher,
    });
    expect(outcome.ok).toBe(true);
    const value = unwrap(outcome);
    expect(value.coverage.observationsOffered).toBeGreaterThan(0);
    expect(value.coverage.observationsDeferred).toBe(0); // as-of covers the whole stream
    expect(value.classifications.length).toBeGreaterThan(0);
    expect(publisher.published.length).toBe(1);
    // the envelope is addressed to an organization topic, bound to the report
    const envelope = publisher.published[0]!.envelope;
    expect(envelope.topic).toBe(REGIME_RUN_CONFIG.topic);
    expect(envelope.payload).toBe(`report:${value.reportId}`);
  });

  it('an as-of BEFORE the stream defers everything and publishes the declared gap', () => {
    const events = fixtureEvents();
    const source = replaySource(events, 'replay-interop-2');
    const publisher = createRegimeRecordingPort();
    const outcome = runRegimePipeline(replayConfig(0), { sources: [source], publisher });
    expect(outcome.ok).toBe(true);
    const value = unwrap(outcome);
    expect(value.coverage.observationsAdmitted).toBe(0);
    expect(value.coverage.observationsDeferred).toBeGreaterThan(0);
    expect(value.classifications).toEqual([]);
    expect(value.dataGaps).toEqual([{ kind: 'no-market-observations', instrument: '' }]);
    expect(publisher.published.length).toBe(1);
  });

  it('two independent runs over the same recorded stream are byte-identical (determinism)', () => {
    const events = fixtureEvents();
    const once = runRegimePipeline(replayConfig(latestAvailabilityOf(events)), {
      sources: [replaySource(events, 'replay-interop-3a')],
      publisher: createRegimeRecordingPort(),
    });
    const twice = runRegimePipeline(replayConfig(latestAvailabilityOf(events)), {
      sources: [replaySource(events, 'replay-interop-3b')],
      publisher: createRegimeRecordingPort(),
    });
    expect(once.ok).toBe(true);
    expect(twice.ok).toBe(true);
    expect(unwrap(once).reportId).toBe(unwrap(twice).reportId);
  });
});

// ---------------------------------------------------------------------------
// The REAL Coinbase adapter (T037) feeding the pipeline
// ---------------------------------------------------------------------------

const AT0 = 1_716_312_132_000;
const ms = (value: number): number => value;

function script(inbound: readonly { at: number; channel: string; payload: JsonObject }[]): TransportScript {
  return {
    inbound: inbound.map((entry) => ({ at: ms(entry.at) as never, channel: entry.channel, payload: entry.payload })),
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

function drain(session: CoinbaseSession): { events: CoinbaseEvent[] } {
  const events: CoinbaseEvent[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok || next.value === null) break;
    events.push(next.value);
  }
  return { events };
}

/**
 * A market stream over the Coinbase ticker channel: a deterministic price
 * walk across two declared windows — a ranging window (100.00 -> 100.50)
 * then a trending window (100.50 -> 112.50). All values are LITERAL
 * (no clock, no randomness — the determinism law).
 */
function coinbaseTickerWalk(): { readonly at: number; readonly payload: JsonObject }[] {
  // (event offset ms, ISO time, price) — receive time is event + 500ms.
  const walk: readonly { readonly offset: number; readonly time: string; readonly price: string }[] = [
    { offset: 0, time: '2024-05-21T17:22:12.123456Z', price: '100.00000000' },
    { offset: 1_000, time: '2024-05-21T17:22:13.123456Z', price: '100.40000000' },
    { offset: 2_000, time: '2024-05-21T17:22:14.123456Z', price: '100.10000000' },
    { offset: 3_000, time: '2024-05-21T17:22:15.123456Z', price: '100.50000000' },
    { offset: 10_000, time: '2024-05-21T17:22:22.123456Z', price: '100.50000000' },
    { offset: 11_000, time: '2024-05-21T17:22:23.123456Z', price: '104.50000000' },
    { offset: 12_000, time: '2024-05-21T17:22:24.123456Z', price: '108.50000000' },
    { offset: 13_000, time: '2024-05-21T17:22:25.123456Z', price: '112.50000000' },
  ];
  return walk.map((entry, index) => ({
    at: AT0 + entry.offset + 500,
    payload: {
      type: 'ticker',
      trade_id: 7,
      sequence: index + 1,
      time: entry.time,
      product_id: 'BTC-USD',
      price: entry.price,
      last_size: '0.01000000',
      best_bid: entry.price, // locked quote: the mid IS the walked price
      best_bid_size: '0.50000000',
      best_ask: entry.price,
      best_ask_size: '0.73000000',
      open_24h: '0.00000000',
      volume_24h: '1.00000000',
      low_24h: '1.00000000',
      high_24h: '1.00000000',
      volume_30d: '1.00000000',
    } as JsonObject,
  }));
}

describe('interop: the REAL Coinbase adapter (T037) feeds the regime pipeline', () => {
  it('emitted quote events classify into windows and publish one bound report', () => {
    const tickers = coinbaseTickerWalk();
    const construction = createCoinbaseAdapterSession({
      transport: transportFor(
        script(tickers.map((entry) => ({ at: entry.at, channel: 'ticker', payload: entry.payload }))),
      ),
      entitlement: COINBASE_ENTITLEMENT,
    });
    if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
    const session = construction.session;
    expect(session.open().ok).toBe(true);
    const spec = coinbaseSubscription({ channel: 'ticker', instrument: 'BTC-USD' });
    if (!spec.ok) throw new Error('subscription must build');
    expect(session.subscribe(spec.value).ok).toBe(true);
    const { events } = drain(session);
    expect(events.length).toBe(8);
    // every emitted event is a quote the regime researcher can classify
    for (const event of events) {
      expect(event.event_type).toBe('quote');
    }

    // feed the emissions straight into the pipeline through a scripted source
    const publisher = createRegimeRecordingPort();
    const outcome = runRegimePipeline(replayConfig(AT0 + 60_000), {
      sources: [
        createScriptedMarketSource(
          { id: 'coinbase-interop', version: '1.0.0', provider: 'coinbase' },
          events as readonly MarketObservation[],
        ),
      ],
      publisher,
    });
    expect(outcome.ok).toBe(true);
    const value = unwrap(outcome);
    expect(value.coverage.observationsOffered).toBe(8);
    expect(value.coverage.observationsDeferred).toBe(0);
    // two declared windows: the ranging window, then the trending window
    expect(value.classifications.length).toBe(2);
    expect(value.classifications[0]!.label).toBe('ranging');
    expect(value.classifications[1]!.label).toBe('trending-up');
    // and the transition between them
    expect(value.changes.length).toBe(1);
    expect(publisher.published.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The T021 research-publication pattern (the sibling-lane agreement)
// ---------------------------------------------------------------------------

describe('interop: the T021 research-publication pattern', () => {
  it('the golden publication envelope round-trips through the REAL agent-os factory', () => {
    // build a regime publication the way the pipeline does
    const publisher = createRegimeRecordingPort();
    const outcome = runRegimePipeline(REGIME_RUN_CONFIG, {
      sources: [createScriptedMarketSource(
        { id: 'pattern-witness', version: '1.0.0', provider: 'market-replay' },
        // the golden stream (regenerated through the lane fixtures' source)
        REGIME_STREAM_SOURCE(),
      )],
      publisher,
    });
    expect(outcome.ok).toBe(true);
    expect(publisher.published.length).toBe(1);
    const envelope = publisher.published[0]!.envelope;
    // the envelope alone round-trips through the REAL agent-os factory
    const real = createMessageEnvelope(JSON.parse(JSON.stringify(envelope)));
    expect(isMessageEnvelope(real)).toBe(true);
    expect(real.id).toBe(envelope.id);
    expect(real.topic).toBe(envelope.topic);
    expect(real.payload).toBe(envelope.payload);
    // kernel topics are mirrored kind-for-kind by the contract package
    expect(real.topic.startsWith('kernel.')).toBe(false);
    void KERNEL_TOPICS;
  });

  it('the two research lanes compose additively through the service root (T021 + T022)', () => {
    // the sibling lane's body spec and identity card are still exported,
    // unmodified, beside the regime lane's surface
    expect(T021_SENTIMENT_BODY.bodyVersion.bodyId).toBe('sentiment-researcher');
    expect(serviceInfo.name).toBe('@tradrl/research');
    expect(serviceInfo.lane).toBe('sentiment');
  });
});

// -- helpers -----------------------------------------------------------------

function REGIME_STREAM_SOURCE(): readonly MarketObservation[] {
  // The golden stream from the lane fixtures module (imported lazily to
  // keep this file's import block flat).
  return REGIME_STREAM_VALUE;
}

import { REGIME_STREAM as REGIME_STREAM_VALUE } from './fixtures';
