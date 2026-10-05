/**
 * T048 — STATION 1: MARKET DATA IN (through the adapter contracts).
 *
 * The REAL T037 Binance spot adapter and the REAL T038 news-wire
 * adapter, each a REAL session over the slice's scripted transport
 * (the injected port — the adapters' no-network law). The raw vendor
 * timelines are hand-scripted literals; everything between `recv()`
 * and the canonical events is the REAL adapter code: the documented
 * payload schemas, the mapping tables, the L4-honest availability
 * quartets (the news item's EMBARGO lift included — available_time is
 * the lift instant, never the earlier receipt), the entitlement
 * declarations, the provenance blocks.
 *
 * The station's product:
 *   - `binanceEvents` — the canonical crypto events (the seeded BTC
 *     book snapshot + the BTC and ETH trade prints). These ARE the
 *     reactive world's recorded stream (the canonical envelopes are
 *     law-for-law the world's RecordedEvent shape) AND the strategy
 *     window's market events (the T0+330_000 BTC rally print included —
 *     the step-2 drift trigger's observation, held back by the L4
 *     boundary from the step-1 window).
 *   - `newsEvents` — the canonical news events (one embargoed licensed
 *     wire item + one public headline). These are the sentiment
 *     research lane's observation surface (the research bodies
 *     T021–T023 are outside this slice — see the director station).
 *   - `sentFrames` — the recorded SUBSCRIBE frames (the neutrality
 *     contract: requests pass through the transport unmangled).
 */

import {
  BINANCE_ENTITLEMENT,
  createBinanceAdapterSession,
  binanceSubscription,
  type AdapterSession,
  type EmittedEvent,
} from '../../../adapters/binance/src/index';
import {
  NEWS_ENTITLEMENT,
  createNewsAdapterSession,
  newsSubscription,
  type EmittedEvent as NewsEmittedEvent,
} from '../../../adapters/news/src/index';

import { BTC, ETH, T0, unwrap } from './scope';
import { scriptedTransport, type RecordedOutbound, type ScriptedInbound } from './scripted-transport';
import type { TimestampMs } from '../../../adapters/binance/src/contract/timestamp';

// ---------------------------------------------------------------------------
// The raw vendor timelines (hand-scripted literals — the only "market" there is)
// ---------------------------------------------------------------------------

/** The Binance spot timeline: the seeded BTC book + the BTC/ETH trade prints. */
function binanceTimeline(): readonly { readonly at: number; readonly channel: string; readonly payload: Record<string, unknown> }[] {
  return [
    // T0 — the partial-depth snapshot the reactive world's engine seeds from.
    {
      at: T0,
      channel: 'depth',
      payload: {
        lastUpdateId: 42,
        bids: [
          ['49950.00000000', '0.80000000'],
          ['49900.00000000', '1.20000000'],
        ],
        asks: [
          ['50000.00000000', '1.20000000'],
          ['50050.00000000', '0.30000000'],
          ['50100.00000000', '2.00000000'],
        ],
      },
    },
    // T0+20_000 — the BTC trade print that anchors the strategy's limit price.
    {
      at: T0 + 20_000,
      channel: 'trade',
      payload: { e: 'trade', E: T0 + 20_000, s: 'BTCUSDT', t: 1001, p: '50100.00000000', q: '0.25000000', T: T0 + 20_000, m: false },
    },
    // T0+330_000 — the step-2 window's print: the mark rallies (the drift-band
    // trigger fires on the held BTC position — the slice's second decision).
    {
      at: T0 + 330_000,
      channel: 'trade',
      payload: { e: 'trade', E: T0 + 330_000, s: 'BTCUSDT', t: 1003, p: '62000.00000000', q: '0.10000000', T: T0 + 330_000, m: false },
    },
  ];
}

/** The ETH timeline: the second universe instrument's trade print. */
function ethTimeline(): readonly { readonly at: number; readonly channel: string; readonly payload: Record<string, unknown> }[] {
  return [
    // T0+20_500 — the ETH trade print (the mark the strategy's ETH limit anchors at).
    {
      at: T0 + 20_500,
      channel: 'trade',
      payload: { e: 'trade', E: T0 + 20_500, s: 'ETHUSDT', t: 1002, p: '3000.00000000', q: '1.50000000', T: T0 + 20_500, m: true },
    },
  ];
}

/** The news-wire timeline: one EMBARGOED licensed item + one public headline. */
function newsTimeline(): readonly { readonly at: number; readonly channel: string; readonly payload: Record<string, unknown> }[] {
  return [
    // Received at T0+20_000, published at T0+20_000, embargoed until T0+25_000 —
    // the guard holds it and the canonical available_time is the LIFT instant.
    {
      at: T0 + 20_000,
      channel: 'licensedWire',
      payload: {
        recordType: 'NEWS_ITEM',
        itemId: 'nw-e2e-0001',
        publisherCode: 'PUB-A',
        publishedTimeMs: T0 + 20_000,
        headline: 'TEST-AAA operator raises full-year guidance above consensus',
        body: 'The operator of the TEST-AAA benchmark raised its full-year guidance, citing durable demand.',
        tickers: ['TEST-AAA'],
        tags: ['guidance'],
        url: 'https://wire.example/items/nw-e2e-0001',
        embargoTimeMs: T0 + 25_000,
      },
    },
    // T0+26_000 — an unembargoed public headline (also advances the timeline
    // past the embargo lift so the held item is released at the lift).
    {
      at: T0 + 26_000,
      channel: 'publicHeadlines',
      payload: {
        recordType: 'NEWS_ITEM',
        itemId: 'nw-e2e-0002',
        publisherCode: 'PUB-B',
        publishedTimeMs: T0 + 26_000,
        headline: 'TEST-AAA index rebalance completes on schedule',
        tickers: ['TEST-AAA'],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// The station
// ---------------------------------------------------------------------------

/** Station 1's product: the canonical events + the recorded frames. */
export interface MarketDataStation {
  /** The canonical crypto events, in emission order (the BTC book snapshot, the BTC allocation print, the BTC rally print, the ETH print). */
  readonly binanceEvents: readonly EmittedEvent[];
  /** The canonical news events, in emission order (the embargoed wire item first). */
  readonly newsEvents: readonly NewsEmittedEvent[];
  /** The SUBSCRIBE frames the sessions sent through the transports, in order. */
  readonly sentFrames: readonly RecordedOutbound[];
}

/**
 * Drive the REAL adapter sessions over the scripted timelines:
 * construct -> open -> subscribe (the documented request builders) ->
 * pump (the guard pipeline + the canonical emission) -> close.
 */
export function collectMarketData(): MarketDataStation {
  // --- The Binance spot sessions (T037) — one session per instrument ----------
  // (the channel-kind uniqueness law: one 'trade' subscription per session,
  // so the BTC book+prints and the ETH print ride two sessions, the way a
  // production host fans one websocket per stream symbol.)
  const btc = collectBinance(BTC, [
    unwrap(binanceSubscription({ channel: 'depth', instrument: BTC, request_id: 1 }), 'the BTC depth subscription must build'),
    unwrap(binanceSubscription({ channel: 'trade', instrument: BTC, request_id: 2 }), 'the BTC trade subscription must build'),
  ], binanceTimeline() as unknown as readonly ScriptedInbound[]);
  const eth = collectBinance(ETH, [
    unwrap(binanceSubscription({ channel: 'trade', instrument: ETH, request_id: 1 }), 'the ETH trade subscription must build'),
  ], ethTimeline() as unknown as readonly ScriptedInbound[]);
  const binanceEvents = [...btc.events, ...eth.events];

  // --- The news-wire session (T038) ------------------------------------------
  const news = scriptedTransport(newsTimeline() as unknown as readonly ScriptedInbound[]);
  const newsConstruction = createNewsAdapterSession({
    transport: news.port,
    entitlement: NEWS_ENTITLEMENT,
    origin: 'historical',
  });
  if (!newsConstruction.ok) {
    throw new Error(`the news session must construct: ${newsConstruction.errors.map((error) => error.message).join('; ')}`);
  }
  driveSession(newsConstruction.session, [
    unwrap(newsSubscription({ channel: 'licensedWire', instrument: 'TEST-AAA' }), 'the licensed-wire subscription must build'),
    unwrap(newsSubscription({ channel: 'publicHeadlines', instrument: 'TEST-AAA' }), 'the public-headlines subscription must build'),
  ]);
  const newsEvents = drain(newsConstruction.session);
  newsConstruction.session.close();

  return {
    binanceEvents,
    newsEvents,
    sentFrames: [...btc.sent, ...eth.sent, ...news.sent()],
  };
}

/** One Binance session over one instrument's timeline: open -> subscribe -> drain -> close. */
function collectBinance(
  instrument: string,
  subscriptions: readonly { readonly channel: string; readonly request: Record<string, unknown>; readonly venue: string; readonly instrument: string; readonly asset_class: string; readonly mapping_table_id: string }[],
  timeline: readonly ScriptedInbound[],
): { readonly events: readonly EmittedEvent[]; readonly sent: readonly RecordedOutbound[] } {
  void instrument; // (the subscriptions carry the instrument binding)
  const transport = scriptedTransport(timeline);
  const construction = createBinanceAdapterSession({
    transport: transport.port,
    entitlement: BINANCE_ENTITLEMENT,
    origin: 'historical',
  });
  if (!construction.ok) {
    throw new Error(`the Binance session must construct: ${construction.errors.map((error) => error.message).join('; ')}`);
  }
  driveSession(construction.session, subscriptions);
  const events = drain(construction.session);
  construction.session.close();
  return { events, sent: transport.sent() };
}

/**
 * The minimal structural session surface both adapter sessions satisfy
 * (each adapter mirrors the SDK contract — the guards differ in their
 * payload unions; the lifecycle is identical).
 */
interface SessionLike<S, E> {
  open(): { readonly ok: boolean; readonly error?: { readonly message: string } };
  subscribe(spec: S): { readonly ok: boolean; readonly error?: { readonly message: string } };
  nextEvent(): { readonly ok: boolean; readonly value?: E | null; readonly error?: { readonly message: string } };
  close(): { readonly ok: boolean; readonly error?: { readonly message: string } };
}

/** Open a session and bind the subscriptions (the lifecycle discipline: open -> subscribe* -> nextEvent*). */
function driveSession<S, E>(session: SessionLike<S, E>, subscriptions: readonly S[]): void {
  const opened = session.open();
  if (!opened.ok) throw new Error(`the adapter session must open: ${opened.error?.message ?? 'unknown'}`);
  for (const spec of subscriptions) {
    const bound = session.subscribe(spec);
    if (!bound.ok) throw new Error(`the subscription must bind: ${bound.error?.message ?? 'unknown'}`);
  }
}

/** Pull every emitted event from a subscribed session (the drain loop). */
function drain<S, E>(session: SessionLike<S, E>): readonly E[] {
  const events: E[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok) throw new Error(`nextEvent must not fail: ${next.error?.message ?? 'unknown'}`);
    if (next.value === null || next.value === undefined) break;
    events.push(next.value);
  }
  return events;
}
