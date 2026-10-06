// @tradrl/example-e2e-trading — STRUCTURAL MIRROR of @tradrl/exchange-sim
// (T010): the exchange config, the order book, price-time-priority
// matching, the fee schedule, the latency draws and the Fill record with
// its availability quartet.
//
// D-003/D-004 law: this module imports NOTHING outside the example tree.
// The matching walk, the fee law (notional * bps / 10_000 rounded HALF-UP
// at fee_decimals), the latency law (fixed, or splitmix32-keyed uniform)
// and the quartet law (available_time = event_time + delay) are mirrored
// from the real engine — the interop trip-wire test drives the REAL engine
// over the same seeded book and asserts both produce identical fills.

import { deepFreeze, isNonEmptyString, isRecord, isPositiveInteger } from '../primitives';
import {
  compareDecimal,
  decimalAt,
  decimalDivide,
  decimalMultiply,
  decimalSubtract,
  floorToStep,
  isCanonicalPositiveDecimal,
} from '../decimals';
import { mintOrdinalId } from '../ids';

// ---------------------------------------------------------------------------
// Config (mirror of T010's ExchangeConfig)
// ---------------------------------------------------------------------------

export type ExchangeFidelityMirror = 'reactive_replay' | 'generative';

export interface FeeTierMirror {
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

export type SlippageConfigMirror = { readonly kind: 'book_walk' } | { readonly kind: 'fixed_bps'; readonly bps: string };

export interface MarketImpactPolicyMirror {
  readonly kind: string;
  readonly declaration: string;
  readonly limitation: string;
}

export const NO_MARKET_IMPACT_MIRROR: MarketImpactPolicyMirror = deepFreeze({
  kind: 'none',
  declaration: 'reference slice: no endogenous impact of participant orders on prices (seeded liquidity only)',
  limitation: 'resting liquidity is fixed at seed time; no replenishment, no reaction (L6 declared approximation)',
});

export interface ExchangeConfigMirror {
  readonly venue: string;
  readonly instrument: string;
  readonly asset_class: string;
  readonly tick_size: string;
  readonly lot_size: string;
  readonly max_book_depth: number;
  readonly seed: string;
  readonly fidelity: ExchangeFidelityMirror;
  readonly fees: FeeScheduleMirror;
  readonly latency: LatencyConfigMirror;
  readonly slippage: SlippageConfigMirror;
  readonly impact: MarketImpactPolicyMirror;
}

// ---------------------------------------------------------------------------
// The order book (mirror)
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
  readonly bids: readonly RestingLevelMirror[];
  readonly asks: readonly RestingLevelMirror[];
}

export const emptyBookMirror = (): BookStateMirror => deepFreeze({ bids: [], asks: [] });

/** Seeds the book: bids best-first (descending), asks best-first (ascending). */
export function seedBookMirror(
  seed: BookSnapshotSeedMirror,
  instrument: string,
): BookStateMirror {
  const bids: RestingLevelMirror[] = [...seed.bids]
    .sort((a, b) => compareDecimal(b.price, a.price))
    .map((level, index) => ({
      price: decimalAt(level.price, 8, 'half-even'),
      orders: [{ order_id: `xo-seed-bid-${String(index)}`, remaining: decimalAt(level.size, 8, 'half-even') }],
    }));
  const asks: RestingLevelMirror[] = [...seed.asks]
    .sort((a, b) => compareDecimal(a.price, b.price))
    .map((level, index) => ({
      price: decimalAt(level.price, 8, 'half-even'),
      orders: [{ order_id: `xo-seed-ask-${String(index)}`, remaining: decimalAt(level.size, 8, 'half-even') }],
    }));
  void instrument;
  return deepFreeze({ bids, asks });
}

// ---------------------------------------------------------------------------
// The order intent (mirror of exchange-sim's OrderIntent — the canonical form)
// ---------------------------------------------------------------------------

export interface ExchangeOrderIntentMirror {
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly venueId: string;
  readonly side: 'buy' | 'sell';
  readonly kind: 'market' | 'limit';
  readonly quantity: string;
  readonly price?: string;
  readonly timeInForce: 'day' | 'gtc' | 'ioc' | 'fok' | 'gtt';
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// The Fill record (mirror of T010's Fill — the availability quartet law)
// ---------------------------------------------------------------------------

export interface AvailabilityQuartetMirror {
  readonly event_time: number;
  readonly source_time: null;
  readonly available_time: number;
  readonly ingestion_time: number;
}

export function quartetOfMirror(eventTime: number, delayMs: number): AvailabilityQuartetMirror {
  return deepFreeze({
    event_time: eventTime,
    source_time: null,
    available_time: eventTime + delayMs,
    ingestion_time: eventTime,
  });
}

export interface FillMirror {
  readonly fill_id: string; // 'xf-' + 8-digit ordinal
  readonly trade_id: string;
  readonly venue: string;
  readonly instrument: string;
  readonly quartet: AvailabilityQuartetMirror;
  readonly sequence: number;
  readonly taker_order_id: string;
  readonly maker_order_id: string;
  readonly aggressor_side: 'buy' | 'sell';
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
  readonly status: 'open' | 'partially_filled' | 'filled';
  readonly filled_quantity: string;
}

export interface OrderRejectMirror {
  readonly order_id: string;
  readonly client_order_id: string;
  readonly quartet: AvailabilityQuartetMirror;
  readonly reason: string;
  readonly detail: string;
}

export type EngineAckMirror = OrderAckMirror | OrderRejectMirror;

export interface SubmitOutcomeMirror {
  readonly state: EngineStateMirror;
  readonly ack: EngineAckMirror;
  readonly fills: readonly FillMirror[];
  readonly top_of_book_changed: boolean;
}

export interface EngineStateMirror {
  readonly config: ExchangeConfigMirror;
  readonly now: number;
  readonly next_order_ordinal: number;
  readonly next_fill_ordinal: number;
  readonly book: BookStateMirror;
  readonly fills: readonly FillMirror[];
  readonly last_trade_price: string | null;
}

// ---------------------------------------------------------------------------
// The physics laws (fees, latency, slippage — mirrored)
// ---------------------------------------------------------------------------

function splitmix32Mirror(key: number): number {
  let state = key >>> 0;
  state = (state + 0x9e3779b9) >>> 0;
  let mixed = state;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
  mixed = (mixed ^ (mixed >>> 15)) >>> 0;
  return mixed;
}

function fnv1a32Of(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The deterministic latency draw (mirror of T010's latencyDelayMs). */
export function latencyDelayMsMirror(config: LatencyConfigMirror, seed: string, domain: string, ordinal: number): number {
  if (config.kind === 'fixed') return config.fixed_ms;
  const span = config.max_ms - config.min_ms;
  if (span === 0) return config.min_ms;
  const key = fnv1a32Of(`${seed}:${domain}:${String(ordinal)}`);
  const draw = splitmix32Mirror(key) / 0x1_0000_0000;
  return config.min_ms + Math.floor(draw * (span + 1));
}

/** The fee of one fill side: notional * bps / 10_000 rounded HALF-UP. */
export function feeOfMirror(
  schedule: FeeScheduleMirror,
  role: 'maker' | 'taker',
  price: string,
  quantity: string,
): string {
  const notional = decimalMultiply(price, quantity, 16, 'half-even');
  let tier: FeeTierMirror | undefined;
  for (const candidate of schedule.tiers) {
    if (candidate.up_to_notional === null) {
      tier = candidate;
      break;
    }
    if (compareDecimal(notional, candidate.up_to_notional) <= 0) {
      tier = candidate;
      break;
    }
  }
  const bps = tier === undefined ? '0' : role === 'maker' ? tier.maker_bps : tier.taker_bps;
  const unrounded = decimalMultiply(notional, bps, 16, 'half-even');
  return decimalDivide(unrounded, '10000', schedule.fee_decimals, 'half-up');
}

/** The aggressor's execution price after slippage (book_walk: the print). */
export function aggressorPriceMirror(
  config: SlippageConfigMirror,
  aggressorSide: 'buy' | 'sell',
  bookPrice: string,
): string {
  if (config.kind === 'book_walk') return decimalAt(bookPrice, 8, 'half-even');
  // fixed_bps: buy price*(10000+bps)/10000; sell price*(10000-bps)/10000.
  const bps = Number(config.bps);
  const factor = aggressorSide === 'buy' ? 10_000 + bps : 10_000 - bps;
  return decimalDivide(decimalMultiply(bookPrice, String(factor), 16, 'half-even'), '10000', 8, 'half-even');
}

// ---------------------------------------------------------------------------
// The engine (mirror of T010's createEngine/submitOrder/advanceEngine)
// ---------------------------------------------------------------------------

export type EngineErrorCode =
  | 'invalid_timestamp'
  | 'arrival_before_now'
  | 'invalid_intent'
  | 'wrong_venue'
  | 'wrong_instrument'
  | 'duplicate_client_order_id'
  | 'wrong_tick_size'
  | 'wrong_lot_size'
  | 'beyond_book_depth'
  | 'unsupported_order_kind'
  | 'unsupported_time_in_force';

export interface EngineErrorMirror {
  readonly code: EngineErrorCode;
  readonly message: string;
}

export type EngineResultMirror<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly EngineErrorMirror[] };

/** Creates an engine over a config and an optional book seed. */
export function createEngineMirror(config: ExchangeConfigMirror, init: { readonly book_seed?: BookSnapshotSeedMirror; readonly start_at?: number }): EngineResultMirror<EngineStateMirror> {
  const errors: EngineErrorMirror[] = [];
  if (!isCanonicalPositiveDecimal(config.tick_size)) errors.push({ code: 'invalid_intent', message: 'tick_size must be a canonical positive decimal' });
  if (!isCanonicalPositiveDecimal(config.lot_size)) errors.push({ code: 'invalid_intent', message: 'lot_size must be a canonical positive decimal' });
  if (!isPositiveInteger(config.max_book_depth)) errors.push({ code: 'invalid_intent', message: 'max_book_depth must be a positive integer' });
  if (errors.length > 0) return { ok: false, errors: deepFreeze(errors) };
  const book = init.book_seed === undefined ? emptyBookMirror() : seedBookMirror(init.book_seed, config.instrument);
  return {
    ok: true,
    value: deepFreeze({
      config,
      now: init.start_at ?? 0,
      next_order_ordinal: 1,
      next_fill_ordinal: 1,
      book,
      fills: [],
      last_trade_price: null,
    }),
  };
}

/** The best opposite level for a side (asks for buys, bids for sells). */
function bestOppositeLevelMirror(book: BookStateMirror, side: 'buy' | 'sell'): RestingLevelMirror | null {
  const levels = side === 'buy' ? book.asks : book.bids;
  return levels[0] ?? null;
}

/** Submits one order intent at an engine instant (the reactive act). */
export function submitOrderMirror(state: EngineStateMirror, intent: ExchangeOrderIntentMirror, at: number): EngineResultMirror<SubmitOutcomeMirror> {
  if (at < state.now) {
    return {
      ok: false,
      errors: deepFreeze([
        { code: 'arrival_before_now', message: `order claims arrival at ${String(at)} but the engine clock is at ${String(state.now)}` },
      ]),
    };
  }
  const errors: EngineErrorMirror[] = [];
  if (intent.venueId !== state.config.venue) errors.push({ code: 'wrong_venue', message: 'the intent venue must match the engine venue' });
  if (intent.instrumentId !== state.config.instrument) errors.push({ code: 'wrong_instrument', message: 'the intent instrument must match the engine instrument' });
  if (intent.kind !== 'market' && intent.kind !== 'limit') {
    errors.push({ code: 'unsupported_order_kind', message: 'the engine accepts market and limit orders only' });
  }
  if (intent.kind === 'limit' && (intent.price === undefined || !isCanonicalPositiveDecimal(intent.price))) {
    errors.push({ code: 'invalid_intent', message: 'limit orders require a canonical positive price' });
  }
  if (!isCanonicalPositiveDecimal(intent.quantity)) {
    errors.push({ code: 'invalid_intent', message: 'the quantity must be a canonical positive decimal' });
  } else {
    // Lot-grid check: quantities must be lot-aligned.
    const floored = floorToStep(intent.quantity, state.config.lot_size);
    if (compareDecimal(floored, decimalAt(intent.quantity, 8, 'half-even')) !== 0) {
      errors.push({ code: 'wrong_lot_size', message: 'the quantity must be lot-aligned' });
    }
  }
  if (intent.kind === 'limit' && intent.price !== undefined) {
    const flooredPrice = floorToStep(intent.price, state.config.tick_size);
    if (compareDecimal(flooredPrice, decimalAt(intent.price, 8, 'half-even')) !== 0) {
      errors.push({ code: 'wrong_tick_size', message: 'the price must be tick-aligned' });
    }
  }
  if (errors.length > 0) return { ok: false, errors: deepFreeze(errors) };

  const arrivalOrdinal = state.next_order_ordinal;
  const orderId = mintOrdinalId('xo-', arrivalOrdinal);
  const orderDelay = latencyDelayMsMirror(state.config.latency, state.config.seed, 'order', arrivalOrdinal);

  let book = state.book;
  let fills = state.fills;
  let nextFillOrdinal = state.next_fill_ordinal;
  let lastTradePrice = state.last_trade_price;
  let remaining = decimalAt(intent.quantity, 8, 'half-even');
  const executedFillIds: string[] = [];
  const side = intent.side;
  const limitPrice = intent.kind === 'limit' ? decimalAt(intent.price as string, 8, 'half-even') : null;

  // Walk the opposite book: price-time priority within each level.
  while (compareDecimal(remaining, '0') > 0) {
    const level = bestOppositeLevelMirror(book, side);
    if (level === null) break;
    if (limitPrice !== null) {
      const satisfies = side === 'buy' ? compareDecimal(level.price, limitPrice) <= 0 : compareDecimal(level.price, limitPrice) >= 0;
      if (!satisfies) break;
    }
    let queue = [...level.orders];
    let queueIndex = 0;
    while (queueIndex < queue.length && compareDecimal(remaining, '0') > 0) {
      const resting = queue[queueIndex];
      if (resting === undefined) break;
      const fillQuantity =
        compareDecimal(remaining, resting.remaining) <= 0 ? remaining : resting.remaining;
      const fillOrdinal = nextFillOrdinal;
      const fillId = mintOrdinalId('xf-', fillOrdinal);
      const takerPrice =
        state.config.slippage.kind === 'book_walk'
          ? decimalAt(level.price, 8, 'half-even')
          : decimalAt(level.price, 8, 'half-even');
      const fill: FillMirror = deepFreeze({
        fill_id: fillId,
        trade_id: fillId,
        venue: state.config.venue,
        instrument: state.config.instrument,
        quartet: quartetOfMirror(at, latencyDelayMsMirror(state.config.latency, state.config.seed, 'fill', fillOrdinal)),
        sequence: fillOrdinal,
        taker_order_id: orderId,
        maker_order_id: resting.order_id,
        aggressor_side: side,
        price: decimalAt(level.price, 8, 'half-even'),
        aggressor_price: takerPrice,
        quantity: fillQuantity,
        taker_fee: feeOfMirror(state.config.fees, 'taker', takerPrice, fillQuantity),
        maker_fee: feeOfMirror(state.config.fees, 'maker', level.price, fillQuantity),
        latency_ms: latencyDelayMsMirror(state.config.latency, state.config.seed, 'fill', fillOrdinal),
      });
      fills = [...fills, fill];
      nextFillOrdinal += 1;
      executedFillIds.push(fillId);
      lastTradePrice = fill.price;
      remaining = decimalSubtract(remaining, fillQuantity, 8, 'half-even');
      const restingRemaining = decimalSubtract(resting.remaining, fillQuantity, 8, 'half-even');
      if (compareDecimal(restingRemaining, '0') === 0) {
        queue = queue.filter((candidate) => candidate.order_id !== resting.order_id);
        continue;
      }
      queue = [...queue.slice(0, queueIndex), { order_id: resting.order_id, remaining: restingRemaining }, ...queue.slice(queueIndex + 1)];
      queueIndex += 1;
    }
    const oppositeSide = side === 'buy' ? 'asks' : 'bids';
    const otherLevels = book[oppositeSide].filter((candidate) => candidate.price !== level.price);
    const rebuiltLevels = queue.length === 0 ? otherLevels : [{ price: level.price, orders: queue }, ...otherLevels];
    book = deepFreeze({
      bids: oppositeSide === 'bids' ? rebuiltLevels : book.bids,
      asks: oppositeSide === 'asks' ? rebuiltLevels : book.asks,
    });
  }

  const filledQuantity = decimalSubtract(decimalAt(intent.quantity, 8, 'half-even'), remaining, 8, 'half-even');
  const status: OrderAckMirror['status'] =
    compareDecimal(remaining, '0') === 0 ? 'filled' : compareDecimal(filledQuantity, '0') > 0 ? 'partially_filled' : 'open';

  // Remainder handling: market orders never rest.
  if (status !== 'filled') {
    if (intent.kind === 'market' || intent.timeInForce === 'ioc') {
      const ack: OrderAckMirror = deepFreeze({
        order_id: orderId,
        client_order_id: intent.clientOrderId,
        quartet: quartetOfMirror(at, orderDelay),
        status: compareDecimal(filledQuantity, '0') > 0 ? 'partially_filled' : 'open',
        filled_quantity: filledQuantity,
      });
      return {
        ok: true,
        value: deepFreeze({
          state: deepFreeze({ ...state, now: at, next_order_ordinal: arrivalOrdinal + 1, book, fills, next_fill_ordinal: nextFillOrdinal, last_trade_price: lastTradePrice }),
          ack,
          fills: fills.slice(-executedFillIds.length),
          top_of_book_changed: book !== state.book,
        }),
      };
    }
    // gtc / day / gtt: rest the remainder at its limit price.
    const restSide = side === 'buy' ? 'bids' : 'asks';
    const price = limitPrice as string;
    const otherLevels = book[restSide].filter((candidate) => candidate.price !== price);
    const existing = book[restSide].find((candidate) => candidate.price === price);
    const orders = [...(existing?.orders ?? []), { order_id: orderId, remaining }];
    const rebuilt = [...otherLevels, { price, orders }].sort((a, b) =>
      restSide === 'bids' ? compareDecimal(b.price, a.price) : compareDecimal(a.price, b.price),
    );
    book = deepFreeze({ bids: restSide === 'bids' ? rebuilt : book.bids, asks: restSide === 'asks' ? rebuilt : book.asks });
  }

  const ack: OrderAckMirror = deepFreeze({
    order_id: orderId,
    client_order_id: intent.clientOrderId,
    quartet: quartetOfMirror(at, orderDelay),
    status,
    filled_quantity: filledQuantity,
  });
  return {
    ok: true,
    value: deepFreeze({
      state: deepFreeze({
        ...state,
        now: at,
        next_order_ordinal: arrivalOrdinal + 1,
        book,
        fills,
        next_fill_ordinal: nextFillOrdinal,
        last_trade_price: lastTradePrice,
      }),
      ack,
      fills: fills.slice(-executedFillIds.length),
      top_of_book_changed: book !== state.book,
    }),
  };
}

/** Advances the engine clock (monotone; gtt expiry omitted in the mirror — declared). */
export function advanceEngineMirror(state: EngineStateMirror, to: number): EngineResultMirror<EngineStateMirror> {
  if (to < state.now) {
    return {
      ok: false,
      errors: deepFreeze([{ code: 'arrival_before_now', message: 'the engine clock is monotone' }]),
    };
  }
  return { ok: true, value: deepFreeze({ ...state, now: to }) };
}

/** Guard: an exchange config mirror. */
export function isExchangeConfigMirror(v: unknown): v is ExchangeConfigMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.venue) &&
    isNonEmptyString(v.instrument) &&
    isNonEmptyString(v.asset_class) &&
    isCanonicalPositiveDecimal(v.tick_size) &&
    isCanonicalPositiveDecimal(v.lot_size) &&
    isPositiveInteger(v.max_book_depth) &&
    isNonEmptyString(v.seed) &&
    (v.fidelity === 'reactive_replay' || v.fidelity === 'generative') &&
    isRecord(v.fees) &&
    Array.isArray(v.fees.tiers) &&
    isRecord(v.latency) &&
    isRecord(v.slippage) &&
    isRecord(v.impact)
  );
}
