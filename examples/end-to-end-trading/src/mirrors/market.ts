// @tradrl/example-e2e-trading — MARKET MIRRORS.
//
// Structural mirrors (D-003/D-004) of the market-data and exchange-sim
// lanes: the market-protocol event envelope + trade/quote payloads
// (packages/market-protocol), the availability-quartet discipline
// (packages/market-protocol + packages/exchange-sim), the exchange venue
// physics (packages/exchange-sim config/fees/latency/slippage/impact),
// the book-seed and book-state shapes, the engine order/fill records,
// and THE ENGINE DRIVER PORT (services/market-world reactive lane — the
// injected seam through which the reactive world drives a matching
// engine). tests/end-to-end-trading/interop.test.ts binds the REAL
// @tradrl/exchange-sim engine functions onto `EngineDriverMirror` and
// runs the whole slice with them — the drift trip-wire.

import type { InstrumentId, Seed, VenueId } from '../ids';

// ---------------------------------------------------------------------------
// market-protocol envelope mirrors
// ---------------------------------------------------------------------------

export type EventOriginMirror = 'historical' | 'simulated' | 'generated';

export interface AdapterRefMirror {
  readonly id: string;
  readonly version: string;
}

export interface ProvenanceMirror {
  readonly origin: EventOriginMirror;
  readonly adapter: AdapterRefMirror | null;
  readonly derived_from: readonly string[];
  readonly transform: string | null;
}

export type AssetClassMirror =
  | 'crypto' | 'equity' | 'index' | 'future' | 'option'
  | 'forex' | 'commodity' | 'macro' | 'other';

export interface TradePayloadMirror {
  readonly price: string;
  readonly size: string;
  readonly side: 'buy' | 'sell';
  readonly trade_id?: string;
}

export interface QuotePayloadMirror {
  readonly bid_price: string;
  readonly bid_size: string;
  readonly ask_price: string;
  readonly ask_size: string;
}

export interface NewsPayloadMirror {
  readonly headline: string;
  /** Signed sentiment score in [-1, 1], canonical decimal string. */
  readonly sentiment_score: string;
  readonly source: string;
}

export interface SocialSignalPayloadMirror {
  readonly platform: string;
  /** Signed sentiment score in [-1, 1], canonical decimal string. */
  readonly sentiment_score: string;
  readonly mention_count: number;
}

export interface FundamentalPayloadMirror {
  readonly series: string;
  readonly assessment_kind: 'valuation-level' | 'macro-surprise' | 'health-indicator';
  /** Signed surprise score, canonical decimal string. */
  readonly surprise_score: string;
}

export interface MacroReleasePayloadMirror {
  readonly indicator: string;
  /** Signed surprise vs consensus, canonical decimal string. */
  readonly surprise: string;
}

/** The market event envelope — the availability quartet carried verbatim. */
export type MarketEventMirror =
  | {
      readonly event_id: string;
      readonly venue: VenueId;
      readonly instrument: InstrumentId;
      readonly asset_class: AssetClassMirror;
      readonly event_type: 'trade';
      readonly event_time: number;
      readonly source_time: number | null;
      readonly available_time: number;
      readonly ingestion_time: number;
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
      readonly event_time: number;
      readonly source_time: number | null;
      readonly available_time: number;
      readonly ingestion_time: number;
      readonly sequence: number;
      readonly provider: string;
      readonly provenance: ProvenanceMirror;
      readonly payload: QuotePayloadMirror;
    }
  | {
      readonly event_id: string;
      readonly venue: VenueId;
      readonly instrument: InstrumentId;
      readonly asset_class: AssetClassMirror;
      readonly event_type: 'news';
      readonly event_time: number;
      readonly source_time: number | null;
      readonly available_time: number;
      readonly ingestion_time: number;
      readonly sequence: number;
      readonly provider: string;
      readonly provenance: ProvenanceMirror;
      readonly payload: NewsPayloadMirror;
    }
  | {
      readonly event_id: string;
      readonly venue: VenueId;
      readonly instrument: InstrumentId;
      readonly asset_class: AssetClassMirror;
      readonly event_type: 'social_signal';
      readonly event_time: number;
      readonly source_time: number | null;
      readonly available_time: number;
      readonly ingestion_time: number;
      readonly sequence: number;
      readonly provider: string;
      readonly provenance: ProvenanceMirror;
      readonly payload: SocialSignalPayloadMirror;
    }
  | {
      readonly event_id: string;
      readonly venue: VenueId;
      readonly instrument: InstrumentId;
      readonly asset_class: AssetClassMirror;
      readonly event_type: 'fundamental';
      readonly event_time: number;
      readonly source_time: number | null;
      readonly available_time: number;
      readonly ingestion_time: number;
      readonly sequence: number;
      readonly provider: string;
      readonly provenance: ProvenanceMirror;
      readonly payload: FundamentalPayloadMirror;
    }
  | {
      readonly event_id: string;
      readonly venue: VenueId;
      readonly instrument: InstrumentId;
      readonly asset_class: AssetClassMirror;
      readonly event_type: 'macro_release';
      readonly event_time: number;
      readonly source_time: number | null;
      readonly available_time: number;
      readonly ingestion_time: number;
      readonly sequence: number;
      readonly provider: string;
      readonly provenance: ProvenanceMirror;
      readonly payload: MacroReleasePayloadMirror;
    };

/** The market event types the reference slice consumes. */
export const SLICE_EVENT_TYPES = [
  'trade', 'quote', 'news', 'social_signal', 'fundamental', 'macro_release',
] as const;

export type SliceEventType = (typeof SLICE_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Exchange venue physics mirrors (packages/exchange-sim config)
// ---------------------------------------------------------------------------

export interface FeeTierMirror {
  /** Inclusive notional bound; null = the catch-all LAST tier. */
  readonly up_to_notional: string | null;
  readonly maker_bps: string;
  readonly taker_bps: string;
}

export interface FeeScheduleMirror {
  readonly tiers: readonly FeeTierMirror[];
  readonly fee_decimals: number;
}

export type LatencyConfigMirror =
  | { readonly kind: 'fixed'; readonly fixed_ms: number }
  | { readonly kind: 'uniform'; readonly min_ms: number; readonly max_ms: number };

export type SlippageConfigMirror =
  | { readonly kind: 'book_walk' }
  | { readonly kind: 'fixed_bps'; readonly bps: string };

/** L6 honesty: the impact policy DECLARES what it does not model. */
export interface MarketImpactPolicyMirror {
  readonly kind: string;
  readonly declaration: string;
  readonly limitation: string;
}

export const NO_MARKET_IMPACT_MIRROR: MarketImpactPolicyMirror = {
  kind: 'none',
  declaration: 'no exogenous impact model — fills are book-mediated only',
  limitation: 'order book depth at arrival is the sole liquidity source; no cross-venue impact, no queued-order depletion beyond the book, no permanent impact decay',
};

/** The exchange physics bundle (mirror of exchange-sim `ExchangeConfig` minus identity fields). */
export interface ExchangePhysicsMirror {
  readonly tick_size: string;
  readonly lot_size: string;
  readonly max_book_depth: number;
  readonly seed: Seed;
  readonly fidelity: 'reactive_replay' | 'generative';
  readonly fees: FeeScheduleMirror;
  readonly latency: LatencyConfigMirror;
  readonly slippage: SlippageConfigMirror;
  readonly impact: MarketImpactPolicyMirror;
}

// ---------------------------------------------------------------------------
// Book mirrors (exchange-sim book.ts)
// ---------------------------------------------------------------------------

export interface BookLevelMirror {
  readonly price: string;
  readonly size: string;
}

export interface BookSnapshotSeedMirror {
  readonly bids: readonly BookLevelMirror[];
  readonly asks: readonly BookLevelMirror[];
}

export interface RestingOrderMirror {
  readonly order_id: string;
  readonly remaining: string;
}

export interface RestingLevelMirror {
  readonly price: string;
  readonly orders: readonly RestingOrderMirror[];
}

export interface BookStateMirror {
  readonly bids: readonly RestingLevelMirror[]; // descending price
  readonly asks: readonly RestingLevelMirror[]; // ascending price
}

export interface TopOfBookMirror {
  readonly bid_price: string;
  readonly bid_size: string;
  readonly ask_price: string;
  readonly ask_size: string;
}

// ---------------------------------------------------------------------------
// Engine order/fill records (exchange-sim records.ts)
// ---------------------------------------------------------------------------

export type OrderSideMirror = 'buy' | 'sell';

export type CoreOrderKindMirror = 'market' | 'limit' | 'stop' | 'stop-limit';

export type CoreTimeInForceMirror = 'day' | 'gtc' | 'ioc' | 'fok' | 'gtt';

/** The routed order form (mirror of exchange-sim `OrderIntent`). */
export interface OrderIntentRecordMirror {
  readonly clientOrderId: string;
  readonly instrumentId: InstrumentId;
  readonly venueId: VenueId;
  readonly side: OrderSideMirror;
  readonly kind: string;
  readonly quantity: string;
  readonly price?: string;
  readonly stopPrice?: string;
  readonly timeInForce: string;
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly notes?: string;
}

export interface AvailabilityQuartetMirror {
  readonly event_time: number;
  readonly source_time: null;
  readonly available_time: number;
  readonly ingestion_time: number;
}

export type OrderStatusMirror =
  | 'rejected' | 'open' | 'partially_filled' | 'filled' | 'canceled' | 'expired';

export type RejectReasonMirror =
  | 'duplicate_client_order_id' | 'wrong_tick_size' | 'wrong_lot_size' | 'beyond_book_depth'
  | 'unsupported_order_kind' | 'unsupported_time_in_force' | 'gtt_expired_on_arrival';

export type CancelReasonMirror =
  | 'cancel_requested' | 'ioc_unfilled' | 'fok_unfilled'
  | 'market_order_unfilled_remainder' | 'expired';

export interface FillMirror {
  readonly fill_id: string;
  readonly trade_id: string;
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  readonly quartet: AvailabilityQuartetMirror;
  readonly sequence: number;
  readonly taker_order_id: string;
  readonly maker_order_id: string;
  readonly aggressor_side: OrderSideMirror;
  readonly price: string;
  readonly aggressor_price: string;
  readonly quantity: string;
  readonly taker_fee: string;
  readonly maker_fee: string;
  readonly latency_ms: number;
}

export interface OrderAckMirror {
  readonly order_id: string;
  readonly client_order_id: string;
  readonly quartet: AvailabilityQuartetMirror;
  readonly status: OrderStatusMirror;
  readonly filled_quantity: string;
}

export interface OrderRejectMirror {
  readonly order_id: string;
  readonly client_order_id: string;
  readonly quartet: AvailabilityQuartetMirror;
  readonly reason: RejectReasonMirror;
  readonly detail: string;
}

export interface OrderCancelRecordMirror {
  readonly order_id: string;
  readonly client_order_id: string;
  readonly quartet: AvailabilityQuartetMirror;
  readonly reason: CancelReasonMirror;
  readonly remaining_quantity: string;
}

/** The engine's full state (mirror of exchange-sim `EngineState`). */
export interface EngineStateMirror {
  readonly config: {
    readonly venue: VenueId;
    readonly instrument: InstrumentId;
    readonly asset_class: string;
  } & ExchangePhysicsMirror;
  readonly now: number;
  readonly next_order_ordinal: number;
  readonly next_fill_ordinal: number;
  readonly book: BookStateMirror;
  readonly orders: readonly {
    readonly order_id: string;
    readonly client_order_id: string;
    readonly status: OrderStatusMirror;
    readonly quantity: string;
    readonly filled_quantity: string;
    readonly fill_ids: readonly string[];
  }[];
  readonly fills: readonly FillMirror[];
  readonly last_trade_price: string | null;
}

export interface SubmitOutcomeMirror {
  readonly state: EngineStateMirror;
  readonly ack: OrderAckMirror | OrderRejectMirror;
  readonly fills: readonly FillMirror[];
  readonly cancels: readonly OrderCancelRecordMirror[];
  readonly top_of_book_changed: boolean;
}

export interface CancelOutcomeMirror {
  readonly state: EngineStateMirror;
  readonly cancel: OrderCancelRecordMirror;
}

export interface AdvanceOutcomeMirror {
  readonly state: EngineStateMirror;
  readonly expirations: readonly OrderCancelRecordMirror[];
}

export interface EngineInitMirror {
  readonly book_seed?: unknown;
  readonly start_at?: unknown;
}

export type EngineOpResultMirror<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly path: string; readonly message: string }[] };

/**
 * THE ENGINE DRIVER PORT — mirror of the reactive lane's injected seam
 * (services/market-world/src/reactive/exchange-mirror.ts `EngineDriver`).
 * The reference engine in src/engine.ts satisfies it; the interop test
 * binds the REAL @tradrl/exchange-sim functions onto it (zero casts).
 */
export interface EngineDriverMirror {
  createEngine(config: unknown, init: EngineInitMirror): EngineOpResultMirror<EngineStateMirror>;
  submitOrder(
    state: EngineStateMirror,
    intent: unknown,
    at: unknown,
  ): EngineOpResultMirror<SubmitOutcomeMirror>;
  cancelOrder(
    state: EngineStateMirror,
    reference: unknown,
    at: unknown,
  ): EngineOpResultMirror<CancelOutcomeMirror>;
  advanceEngine(state: EngineStateMirror, to: unknown): EngineOpResultMirror<AdvanceOutcomeMirror>;
}

// ---------------------------------------------------------------------------
// Reactive-world records (services/market-world/src/reactive)
// ---------------------------------------------------------------------------

export type ReactiveDispositionMirror = 'engine_matched';

export interface ReceiptEngineOutcomeMirror {
  readonly kind: 'ack' | 'reject' | 'cancel';
  readonly order_id: string;
  readonly status: string;
  readonly reject_reason: string | null;
  readonly fill_ids: readonly string[];
}

export interface PhysicsLineageMirror {
  readonly engine_config_hash: string;
  readonly fee_policy: string;
  readonly latency_policy: string;
  readonly slippage_policy: string;
  readonly impact_policy: string;
  readonly run_ref: string;
  readonly tenant: string;
  readonly project: string;
}

export interface ActionReceiptMirror {
  readonly receipt_id: string;
  readonly episode_id: string;
  readonly action_id: string;
  readonly actor: string;
  readonly client_sequence: number;
  readonly recorded_at: number;
  readonly disposition: ReactiveDispositionMirror;
  readonly engine: ReceiptEngineOutcomeMirror;
  readonly physics: PhysicsLineageMirror;
}

export interface ReactiveFillRecordMirror {
  readonly fill: FillMirror;
  readonly fill_id: string;
  readonly episode_id: string;
  readonly run_ref: string;
  readonly taker_participant: string;
  readonly taker_order_id: string;
  readonly maker_order_id: string;
  readonly physics: PhysicsLineageMirror;
}

export interface ReactiveObservationMirror {
  readonly observation_id: string;
  readonly available_time: number;
  readonly venue: string | null;
  readonly instrument: string | null;
  readonly payload: unknown;
  readonly provenance: {
    readonly origin: 'historical' | 'simulated';
    readonly source: string | null;
    readonly derived_from: readonly string[];
  };
  readonly run_ref: string;
  readonly tenant: string;
  readonly project: string;
}

/** An action envelope on the world fabric (mirror of the T005 action shape). */
export interface WorldActionMirror {
  readonly action_id: string;
  readonly actor: string;
  readonly submitted_at: number;
  readonly client_sequence: number;
  readonly payload:
    | { readonly type: 'submit_order'; readonly intent: OrderIntentRecordMirror }
    | { readonly type: 'cancel_order'; readonly order_id: string };
}
