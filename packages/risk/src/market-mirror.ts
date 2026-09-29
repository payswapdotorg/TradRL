// @tradrl/risk — the market-protocol structural mirrors and the risk
// engine's market state (the pricing facts).
//
// STRUCTURAL MIRROR of @tradrl/market-protocol (T003) — re-declared by
// STRUCTURE, never imported (D-003/D-004): the canonical MarketEvent
// envelope (the availability quartet, provenance, sequence, provider,
// asset class) with the `trade` and `quote` payloads — the same mirror
// discipline @tradrl/trading-strategy's market-mirror.ts applies. A REAL
// market-protocol `MarketEventFor<'trade'>` / `MarketEventFor<'quote'>`
// IS a {@link MarketEventMirror} (mutually assignable, zero casts;
// proven by src/interop.test.ts against the REAL package on this
// branch).
//
// THE NO-NETWORK LAW (the Work Order: "No network, no live data: market
// state arrives as declared inputs (market-protocol event mirrors); no
// venue connections"): the engine NEVER observes a market. Market
// evidence arrives as DECLARED inputs — canonical event mirrors — and
// `deriveMarketState` is the PURE fold that derives the engine's
// pricing facts from them: per (venue, instrument) the reference price
// (the LAST trade print in window order, else the MID of the last
// quote — the same mark discipline the strategy lane's markPriceOf
// applies), the asset class, and the L4 information boundary (every
// event must have been AVAILABLE at or before the market state's asOf —
// a risk measure may never rest on an observation that was not yet
// available).
//
// Spec anchors: spec/ARCHITECTURE.md (Time Machine: "Track event time,
// source time when known, availability time and ingestion time."), spec/
// ARCHITECTURE-LOCK.md L4 (point-in-time truth), L9, spec/DOMAIN-MODEL.md
// (MarketEvent).

import { deepFreeze, isMemberOf, isNonEmptyString, isNonNegativeSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, stableDigest } from './primitives';
import { add as decAdd, divideRoundHalfUp, isPositiveDecimal } from './decimals';
import type { InstrumentId, MarketStateId, VenueId } from './ids';
import { isInstrumentId, isVenueId, mintMarketStateId } from './ids';
import {
  type RiskError,
  type RiskResult,
  fail,
  invalidField,
  ok,
} from './errors';

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

// ---------------------------------------------------------------------------
// The market event mirror (envelope + trade/quote payload)
// ---------------------------------------------------------------------------

/**
 * One canonical market event as this lane consumes it: the FULL envelope
 * (availability quartet, provenance, sequence, provider, asset class)
 * plus a `trade` or `quote` payload — a structural mirror of
 * market-protocol's `MarketEventFor<'trade'>` / `MarketEventFor<'quote'>`
 * (the same union discipline trading-strategy's `MarketEventMirror`
 * applies), so a mirror IS a real market event.
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
  if (v.adapter !== null && v.adapter !== undefined && !isAdapterRefMirror(v.adapter)) return false;
  if (!Array.isArray(v.derived_from)) return false;
  if (!v.derived_from.every((x) => isNonEmptyString(x))) return false;
  if (v.transform !== null && v.transform !== undefined && !isNonEmptyString(v.transform)) return false;
  if (v.derived_from.length > 0 && (v.transform === null || v.transform === undefined)) return false;
  // The origin law: historical events MUST name their adapter (no orphan history).
  if (v.origin === 'historical' && (v.adapter === null || v.adapter === undefined)) return false;
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
// The risk engine's market state (the pricing facts)
// ---------------------------------------------------------------------------

/** How the market state's reference price was derived. */
export type ReferencePriceSource = 'last_trade' | 'mid_quote';

/**
 * The per-(venue, instrument) pricing facts one risk measurement prices
 * against: the instrument's asset class (the limit record selector —
 * mirrors the venue model's `asset_class`), the reference price
 * (canonical positive decimal), and the mark source that derived it.
 */
export interface MarketInstrumentState {
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  /** The instrument's asset class (the market-protocol taxonomy). */
  readonly assetClass: AssetClassMirror;
  /** Reference price for notional computation (canonical positive decimal). */
  readonly referencePrice: string;
  /** How the reference price was derived (last trade print or top-of-book mid). */
  readonly priceSource: ReferencePriceSource;
}

/** Guard: `MarketInstrumentState`. */
export function isMarketInstrumentState(v: unknown): v is MarketInstrumentState {
  if (!isRecord(v)) return false;
  if (!isVenueId(v.venue)) return false;
  if (!isInstrumentId(v.instrument)) return false;
  if (!isAssetClassMirror(v.assetClass)) return false;
  if (typeof v.referencePrice !== 'string' || !isPositiveDecimal(v.referencePrice)) return false;
  if (v.priceSource !== 'last_trade' && v.priceSource !== 'mid_quote') return false;
  return true;
}

/**
 * The risk engine's market state: the per-(venue, instrument) pricing
 * facts at the measurement instant plus the state's as-of anchor and
 * content-addressed identity. Derived PURELY from declared market-event
 * mirrors (see {@link deriveMarketState}) — the engine never observes a
 * live venue (no network, no live data). Every (venue, instrument) an
 * exposure must price MUST be covered — a gap is the typed
 * `market_state_gap` (never a best-effort reference price).
 */
export interface RiskMarketState {
  /** Content-addressed identity: `rms:` + digest of the canonical content. */
  readonly stateId: MarketStateId;
  /** The measurement instant (every deriving event's available_time <= asOf — L4). */
  readonly asOf: TimestampMs;
  readonly instruments: readonly MarketInstrumentState[];
}

/** Guard: `RiskMarketState` (structural; unique (venue, instrument) pairs). */
export function isRiskMarketState(v: unknown): v is RiskMarketState {
  if (!isRecord(v)) return false;
  if (typeof v.stateId !== 'string' || !v.stateId.startsWith('rms:')) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (!Array.isArray(v.instruments) || !v.instruments.every((x) => isMarketInstrumentState(x))) return false;
  const seen = new Set<string>();
  for (const state of v.instruments) {
    const record = state as MarketInstrumentState;
    const key = `${record.venue}|${record.instrument}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** The canonical JSON tree of a market state's CONTENT (everything except the content-addressed `stateId`). */
export function marketStateContentTree(state: Omit<RiskMarketState, 'stateId'>): JsonValue {
  return {
    asOf: state.asOf,
    instruments: state.instruments.map((entry) => ({
      venue: entry.venue,
      instrument: entry.instrument,
      assetClass: entry.assetClass,
      referencePrice: entry.referencePrice,
      priceSource: entry.priceSource,
    })),
  };
}

/**
 * Derive the risk market state from DECLARED market-event mirrors: per
 * (venue, instrument) the LAST trade print in event order, else the MID
 * of the last quote ((bid + ask) / 2, exact decimal sum then division at
 * `precision`), plus the L4 information boundary (every event's
 * `available_time <= asOf`) and the ordering discipline (events ordered
 * by (event_time, sequence) — a derived state never depends on input
 * array order). Pure and deterministic: the same events always yield the
 * byte-identical state (content-addressed `rms:` id).
 *
 * Fails with:
 *   - `invalid_field` — an event fails the mirror guard;
 *   - `market_state_gap` semantics live at the CONSUMER (an exposure
 *     needing an uncovered instrument fails there — an empty derived
 *     state is legal here: nothing was observed).
 */
export function deriveMarketState(events: readonly unknown[], asOf: TimestampMs, precision: number): RiskResult<RiskMarketState> {
  if (!isTimestampMs(asOf)) return fail('invalid_timestamp', 'deriveMarketState requires an epoch-ms measurement instant');
  if (typeof precision !== 'number' || !Number.isSafeInteger(precision) || precision < 0) {
    return fail('invalid_field', 'deriveMarketState requires a non-negative safe integer quote-mid precision', 'precision');
  }
  const validated: MarketEventMirror[] = [];
  for (let index = 0; index < events.length; index++) {
    const candidate = events[index];
    if (!isMarketEventMirror(candidate)) {
      return { ok: false, errors: [invalidField(`events[${index}]`, 'must be a structurally valid market-event mirror (trade or quote)')] };
    }
    validated.push(candidate);
  }
  // The total order: (event_time, sequence) — deterministic regardless of input order.
  const ordered = [...validated].sort((a, b) => (a.event_time === b.event_time ? a.sequence - b.sequence : a.event_time - b.event_time));
  // L4: every deriving event must have been AVAILABLE at or before asOf.
  for (const event of ordered) {
    if (event.available_time > asOf) {
      return fail(
        'invalid_state',
        `event ${event.event_id} was not yet available at ${asOf} (available ${event.available_time}) — a risk measure may never rest on future information (L4)`,
        `events`,
      );
    }
  }
  const byKey = new Map<string, MarketInstrumentState>();
  for (const event of ordered) {
    const key = `${event.venue}|${event.instrument}`;
    if (event.event_type === 'trade') {
      byKey.set(key, deepFreeze({
        venue: event.venue,
        instrument: event.instrument,
        assetClass: event.asset_class,
        referencePrice: event.payload.price,
        priceSource: 'last_trade',
      }));
    } else {
      // The mid quote: (bid + ask) / 2 at the declared precision — the one divided mark.
      const mid = decAdd(event.payload.bid_price, event.payload.ask_price);
      byKey.set(key, deepFreeze({
        venue: event.venue,
        instrument: event.instrument,
        assetClass: event.asset_class,
        referencePrice: divideRoundHalfUp(mid, '2', precision),
        priceSource: 'mid_quote',
      }));
    }
  }
  const instruments = [...byKey.values()].sort((a, b) => (a.venue === b.venue ? (a.instrument < b.instrument ? -1 : 1) : a.venue < b.venue ? -1 : 1));
  const payload: Omit<RiskMarketState, 'stateId'> = { asOf, instruments };
  return ok(deepFreeze({ ...payload, stateId: mintMarketStateId(stableDigest(marketStateContentTree(payload))) }));
}

/** The L9 anchor: the canonical JSON of a validated market state. */
export function canonicalMarketStateJson(state: RiskMarketState): string {
  return canonicalJson(marketStateContentTree(state));
}
