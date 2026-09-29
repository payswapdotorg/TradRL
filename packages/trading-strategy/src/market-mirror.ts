// @tradrl/trading-strategy — market observation mirrors (the observation
// substrate) and the observation window.
//
// STRUCTURAL MIRRORS of @tradrl/market-protocol's canonical MarketEvent
// envelope (T003 lane) — re-declared by STRUCTURE, never imported
// (D-003/D-004). The full envelope discipline is mirrored: the availability
// quartet (L4 — `available_time >= event_time`, enforced), the provenance
// block (origin trichotomy; historical events MUST name their adapter),
// the sequence, the provider, the asset class. THIS lane consumes the
// `trade` and `quote` payloads only — they are the mark-price substrate
// (last trade print, then top-of-book mid) — but the envelope mirror is
// payload-generic so any canonical event a producer delivers through the
// window remains a valid mirror (the trip wire in src/interop.test.ts
// proves the mirrors satisfy the REAL `validateMarketEvent`).
//
// THE OBSERVATION WINDOW is the strategy's DECLARED observation input
// (the "no network, no market data I/O" law: observations arrive as
// declared inputs; the package computes PURE functions from them):
//   - events are ordered by (event_time, sequence) — a window with an
//     unordered event list fails validation (determinism of mark
//     derivation depends on the order being total and declared);
//   - every event's `available_time` must be <= the window's `asOf`
//     anchor — the point-in-time information boundary (L4): a strategy
//     decision may never rest on an observation that was not yet
//     available at its decision instant;
//   - every event's instrument must be inside the declared universe
//     focus when the window is universe-scoped (extra observations are
//     simply not requested by callers; the strategy only ACTS on its
//     spec's universe — see run.ts).
//
// Spec anchors: spec/DOMAIN-MODEL.md (MarketEvent — "the observation
// substrate"), spec/ARCHITECTURE.md (Time Machine: "Track event time,
// source time when known, availability time and ingestion time. The
// observation/feature firewall must enforce the simulated information
// set."), spec/ARCHITECTURE-LOCK.md L4, L5.

import { deepFreeze, isMemberOf, isNonEmptyString, isNonNegativeSafeInteger, isRecord, isTimestampMs, type TimestampMs } from './primitives';
import { type InstrumentId, type VenueId, isInstrumentId, isVenueId } from './ids';
import { add as decimalAdd, divideRoundHalfUp, isEqual as decimalIsEqual, isPositiveDecimal, isUnsignedDecimal } from './decimals';

// ---------------------------------------------------------------------------
// Provenance mirror (market-protocol provenance.ts — field-for-field)
// ---------------------------------------------------------------------------

/** Where an event came from. The syntheticity discriminator. Mirror. */
export type EventOriginMirror = 'historical' | 'simulated' | 'generated';

export const EVENT_ORIGINS_MIRROR: readonly EventOriginMirror[] = [
  'historical',
  'simulated',
  'generated',
] as const;

/** Reference to the producing adapter (or generator component). Mirror. */
export interface AdapterRefMirror {
  readonly id: string;
  readonly version: string;
}

/** Provenance block carried by every event. Mirror. */
export interface ProvenanceMirror {
  readonly origin: EventOriginMirror;
  /** REQUIRED non-null when origin is `historical` (no orphan history). */
  readonly adapter: AdapterRefMirror | null;
  readonly derived_from: readonly string[];
  /** REQUIRED (non-empty) iff `derived_from` is non-empty. */
  readonly transform: string | null;
}

// ---------------------------------------------------------------------------
// Payload mirrors (market-protocol payloads/trade.ts + payloads/quote.ts)
// ---------------------------------------------------------------------------

/** Trade side. Mirror of market-protocol's `TradeSide`. */
export type TradeSideMirror = 'buy' | 'sell';

/** A single executed trade print. Mirror of market-protocol's `TradePayload`. */
export interface TradePayloadMirror {
  /** Execution price per unit, unsigned decimal string. */
  readonly price: string;
  /** Executed quantity, unsigned decimal string. */
  readonly size: string;
  /** Aggressor side of the trade. */
  readonly side: TradeSideMirror;
  /** Venue trade identifier, when the venue provides one. */
  readonly trade_id?: string;
}

/** Top-of-book bid/ask quotation. Mirror of market-protocol's `QuotePayload`. */
export interface QuotePayloadMirror {
  readonly bid_price: string;
  readonly bid_size: string;
  readonly ask_price: string;
  readonly ask_size: string;
}

/** Asset class. Mirror of market-protocol's closed vocabulary. */
export type AssetClassMirror =
  | 'crypto'
  | 'equity'
  | 'index'
  | 'future'
  | 'option'
  | 'forex'
  | 'commodity'
  | 'macro'
  | 'other';

export const ASSET_CLASSES_MIRROR: readonly AssetClassMirror[] = [
  'crypto',
  'equity',
  'index',
  'future',
  'option',
  'forex',
  'commodity',
  'macro',
  'other',
] as const;

/** The canonical event types this lane's window consumes. */
export type StrategyEventTypeMirror = 'trade' | 'quote';

export const STRATEGY_EVENT_TYPES_MIRROR: readonly StrategyEventTypeMirror[] = ['trade', 'quote'] as const;

// ---------------------------------------------------------------------------
// The market event mirror (envelope + trade/quote payload)
// ---------------------------------------------------------------------------

/**
 * One canonical market event as this lane consumes it: the FULL envelope
 * (availability quartet, provenance, sequence, provider, asset class)
 * plus a `trade` or `quote` payload — a structural mirror of
 * market-protocol's `MarketEventFor<'trade'>` / `MarketEventFor<'quote'>`,
 * so a mirror IS a real market event (mutually assignable, zero casts;
 * proven by src/interop.test.ts).
 */
export type MarketEventMirror =
  | {
      readonly event_id: string;
      readonly venue: VenueId;
      readonly instrument: InstrumentId;
      readonly asset_class: AssetClassMirror;
      readonly event_type: 'trade';
      readonly event_time: TimestampMs;
      readonly source_time: TimestampMs | null;
      readonly available_time: TimestampMs;
      readonly ingestion_time: TimestampMs;
      readonly sequence: number;
      readonly provider: string;
      readonly provenance: ProvenanceMirror;
      readonly payload: TradePayloadMirror;
    }
  | {
      readonly event_id: string;
      readonly venue: VenueId;
      readonly instrument: InstrumentId;
      readonly asset_class: AssetClassMirror;
      readonly event_type: 'quote';
      readonly event_time: TimestampMs;
      readonly source_time: TimestampMs | null;
      readonly available_time: TimestampMs;
      readonly ingestion_time: TimestampMs;
      readonly sequence: number;
      readonly provider: string;
      readonly provenance: ProvenanceMirror;
      readonly payload: QuotePayloadMirror;
    };

// ---------------------------------------------------------------------------
// Guards (total, hand-rolled, never throw)
// ---------------------------------------------------------------------------

export function isEventOriginMirror(v: unknown): v is EventOriginMirror {
  return isMemberOf(EVENT_ORIGINS_MIRROR, v);
}

export function isAssetClassMirror(v: unknown): v is AssetClassMirror {
  return isMemberOf(ASSET_CLASSES_MIRROR, v);
}

export function isAdapterRefMirror(v: unknown): v is AdapterRefMirror {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.id) && isNonEmptyString(v.version);
}

export function isProvenanceMirror(v: unknown): v is ProvenanceMirror {
  if (!isRecord(v)) return false;
  if (!isEventOriginMirror(v.origin)) return false;
  if (v.adapter !== null && !isAdapterRefMirror(v.adapter)) return false;
  if (!Array.isArray(v.derived_from)) return false;
  if (!v.derived_from.every((x) => isNonEmptyString(x))) return false;
  if (v.transform !== null && !isNonEmptyString(v.transform)) return false;
  if (v.derived_from.length > 0 && (v.transform === null || v.transform === undefined)) return false;
  // The origin law: historical events MUST name their adapter (no orphan history).
  if (v.origin === 'historical' && v.adapter === null) return false;
  return true;
}

export function isTradePayloadMirror(v: unknown): v is TradePayloadMirror {
  if (!isRecord(v)) return false;
  if (!isPositiveDecimal(v.price) || !isPositiveDecimal(v.size)) return false; // mirror of market-protocol's positive-decimal payload law
  if (v.side !== 'buy' && v.side !== 'sell') return false;
  if (v.trade_id !== undefined && !isNonEmptyString(v.trade_id)) return false;
  return true;
}

export function isQuotePayloadMirror(v: unknown): v is QuotePayloadMirror {
  if (!isRecord(v)) return false;
  return (
    isPositiveDecimal(v.bid_price) &&
    isPositiveDecimal(v.bid_size) &&
    isPositiveDecimal(v.ask_price) &&
    isPositiveDecimal(v.ask_size) // mirror of market-protocol's positive-decimal payload law
  );
}

function isMarketEventEnvelope(v: Record<string, unknown>): boolean {
  if (!isNonEmptyString(v.event_id)) return false;
  if (!isVenueId(v.venue)) return false;
  if (!isInstrumentId(v.instrument)) return false;
  if (!isAssetClassMirror(v.asset_class)) return false;
  if (!isTimestampMs(v.event_time)) return false;
  if (v.source_time !== null && !isTimestampMs(v.source_time)) return false;
  if (!isTimestampMs(v.available_time)) return false;
  if (!isTimestampMs(v.ingestion_time)) return false;
  if (v.available_time < v.event_time) return false; // L4: availability cannot precede the event
  if (!isNonNegativeSafeInteger(v.sequence)) return false;
  if (!isNonEmptyString(v.provider)) return false;
  if (!isProvenanceMirror(v.provenance)) return false;
  return true;
}

/** Guard: a structurally valid `MarketEventMirror` (trade or quote). */
export function isMarketEventMirror(v: unknown): v is MarketEventMirror {
  if (!isRecord(v)) return false;
  if (!isMarketEventEnvelope(v)) return false;
  if (v.event_type === 'trade') return isTradePayloadMirror(v.payload);
  if (v.event_type === 'quote') return isQuotePayloadMirror(v.payload);
  return false;
}

// ---------------------------------------------------------------------------
// The observation window
// ---------------------------------------------------------------------------

/**
 * The declared observation input of one strategy decision: a totally
 * ordered event list plus the L4 information anchor. Events are ordered
 * by (event_time, sequence); every event must have been AVAILABLE at or
 * before `asOf` (the firewall discipline — a decision may never rest on
 * information it could not yet have).
 */
export interface ObservationWindow {
  /** Opaque identity of the window (part of intent lineage, L9). */
  readonly window_id: string;
  /** Events ordered by (event_time, sequence); at least one per universe instrument when used as a mark source. */
  readonly events: readonly MarketEventMirror[];
  /** The decision instant's information anchor (L4): every event's `available_time <= asOf`. */
  readonly asOf: TimestampMs;
  /** Window bounds, epoch ms; `starts_at <=` every event_time `< ends_at`. */
  readonly starts_at: TimestampMs;
  readonly ends_at: TimestampMs;
}

/** Guard: `ObservationWindow` (structural; the ordering and L4 laws included). */
export function isObservationWindow(v: unknown): v is ObservationWindow {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.window_id)) return false;
  if (!Array.isArray(v.events)) return false;
  if (!v.events.every((e) => isMarketEventMirror(e))) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (!isTimestampMs(v.starts_at) || !isTimestampMs(v.ends_at)) return false;
  if (v.ends_at <= v.starts_at) return false;
  // Duplicate event ids would make the window's identity ambiguous.
  const seen = new Set<string>();
  for (const event of v.events as readonly MarketEventMirror[]) {
    if (seen.has(event.event_id)) return false;
    seen.add(event.event_id);
  }
  // Total order: (event_time, sequence) strictly increasing.
  for (let index = 1; index < v.events.length; index += 1) {
    const prev = v.events[index - 1] as MarketEventMirror;
    const curr = v.events[index] as MarketEventMirror;
    if (curr.event_time < prev.event_time) return false;
    if (curr.event_time === prev.event_time && curr.sequence <= prev.sequence) return false;
  }
  for (const event of v.events as readonly MarketEventMirror[]) {
    // L4: the decision's information boundary.
    if (event.available_time > v.asOf) return false;
    // Window bounds cover the event (event_time inside [starts_at, ends_at)).
    if (event.event_time < v.starts_at || event.event_time >= v.ends_at) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Mark derivation (deterministic, from the declared window only)
// ---------------------------------------------------------------------------

/** The mark discipline of this lane: last trade print, else top-of-book mid. */
export type MarkSource = 'last_trade' | 'mid_quote';

/**
 * Derive the mark price of one instrument from a window: the LAST trade
 * print in window order, else the MID of the last quote ((bid+ask)/2,
 * exact decimal sum then division at `precision`). Pure and
 * deterministic — the same window always yields the same mark. Returns
 * `null` when the window carries neither a trade nor a quote for the
 * instrument (callers convert that into the typed `observation_gap`).
 */
export function markPriceOf(
  window: ObservationWindow,
  instrument: InstrumentId,
  precision: number,
): { readonly price: string; readonly source: MarkSource } | null {
  let lastTrade: TradePayloadMirror | null = null;
  let lastQuote: QuotePayloadMirror | null = null;
  for (const event of window.events) {
    if (event.instrument !== instrument) continue;
    if (event.event_type === 'trade') lastTrade = event.payload;
    else lastQuote = event.payload;
  }
  if (lastTrade !== null) {
    return { price: lastTrade.price, source: 'last_trade' };
  }
  if (lastQuote !== null) {
    // (bid + ask) / 2 at the declared precision — the one divided mark.
    const mid = decimalAdd(lastQuote.bid_price, lastQuote.ask_price);
    return { price: divideRoundHalfUp(mid, '2', precision), source: 'mid_quote' };
  }
  return null;
}

/**
 * Derive the full mark map over a set of instruments. Returns `null` for
 * each instrument the window cannot price (the caller decides whether
 * that is a typed `observation_gap`). Pure; deterministic.
 */
export function markPricesOf(
  window: ObservationWindow,
  instruments: readonly InstrumentId[],
  precision: number,
): ReadonlyMap<InstrumentId, { readonly price: string; readonly source: MarkSource } | null> {
  const marks = new Map<InstrumentId, { readonly price: string; readonly source: MarkSource } | null>();
  for (const instrument of instruments) {
    marks.set(instrument, markPriceOf(window, instrument, precision));
  }
  return deepFreeze(marks);
}

/** `true` when the window carries at least one event for the instrument. */
export function windowObservesInstrument(window: ObservationWindow, instrument: InstrumentId): boolean {
  return window.events.some((event) => event.instrument === instrument);
}

/** Count events by type — a deterministic observation-fact helper for the constraint gate. */
export function countEventsByType(window: ObservationWindow, eventType: StrategyEventTypeMirror): number {
  return window.events.filter((event) => event.event_type === eventType).length;
}

/** `true` iff both sides of a quote are exactly equal (a locked book — a recorded observation fact, not an error). */
export function isLockedQuote(payload: QuotePayloadMirror): boolean {
  return decimalIsEqual(payload.bid_price, payload.ask_price);
}
