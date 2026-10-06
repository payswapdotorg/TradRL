// @tradrl/example-e2e-trading — THE REFERENCE MATCHING ENGINE.
//
// A compact, deterministic limit-order-book engine that satisfies the
// reactive lane's `EngineDriverMirror` port (the T027 injected seam).
// Semantics mirror @tradrl/exchange-sim's v1 contract: price-time
// priority with arrival-ordinal tie-breaks, tick/lot grid enforcement,
// fee schedule by notional tiers, INFORMATION latency only (matching
// is instantaneous; `available_time = event_time + delay`), slippage via
// book walk (aggressor price = the maker level's price) or fixed bps,
// and L6 honesty: the impact policy declares its limitation; unsupported
// order kinds are typed rejects, never silent fallbacks.
//
// tests/end-to-end-trading/interop.test.ts ALSO binds the REAL
// @tradrl/exchange-sim functions onto the same port and runs the whole
// slice with them — the engine seam is the drift trip-wire.

import {
  add, compare, divideRoundHalfUp, isAlignedToGrid, isCanonicalPositiveDecimal,
  isUnsignedDecimal, multiply, roundHalfUp, subtract,
} from './decimals';
import { createSeededRandom, deepFreeze, isRecord } from './primitives';
import type {
  AdvanceOutcomeMirror, BookStateMirror, CancelOutcomeMirror, EngineDriverMirror,
  EngineInitMirror, EngineOpResultMirror, EngineStateMirror, ExchangePhysicsMirror,
  FillMirror, OrderIntentRecordMirror, RestingLevelMirror, SubmitOutcomeMirror,
  TopOfBookMirror,
} from './mirrors/market';

type OpResult<T> = EngineOpResultMirror<T>;

function opError<T>(code: string, message: string, path = ''): OpResult<T> {
  return { ok: false, errors: [{ code, path, message }] };
}

// ---------------------------------------------------------------------------
// Mutable working book (matched in place, frozen on commit)
// ---------------------------------------------------------------------------

interface WorkingOrder {
  readonly order_id: string;
  remaining: string;
}

interface WorkingLevel {
  readonly price: string;
  orders: WorkingOrder[];
}

interface WorkingBook {
  bids: WorkingLevel[];
  asks: WorkingLevel[];
}

function workingBookOf(book: BookStateMirror): WorkingBook {
  return {
    bids: book.bids.map((level) => ({ price: level.price, orders: level.orders.map((order) => ({ order_id: order.order_id, remaining: order.remaining })) })),
    asks: book.asks.map((level) => ({ price: level.price, orders: level.orders.map((order) => ({ order_id: order.order_id, remaining: order.remaining })) })),
  };
}

function frozenBookOf(book: WorkingBook): BookStateMirror {
  return {
    bids: book.bids.filter((level) => level.orders.some((order) => order.remaining !== '0')).map((level) => ({ price: level.price, orders: level.orders.filter((order) => order.remaining !== '0').map((order) => ({ order_id: order.order_id, remaining: order.remaining })) })),
    asks: book.asks.filter((level) => level.orders.some((order) => order.remaining !== '0')).map((level) => ({ price: level.price, orders: level.orders.filter((order) => order.remaining !== '0').map((order) => ({ order_id: order.order_id, remaining: order.remaining })) })),
  };
}

function restOrder(book: WorkingBook, orderId: string, side: 'buy' | 'sell', price: string, quantity: string): void {
  const order: WorkingOrder = { order_id: orderId, remaining: quantity };
  const levels = side === 'buy' ? book.bids : book.asks;
  const existing = levels.find((level) => compare(level.price, price) === 0);
  if (existing) {
    existing.orders.push(order);
  } else {
    levels.push({ price, orders: [order] });
    levels.sort((a, b) => (side === 'buy' ? compare(b.price, a.price) : compare(a.price, b.price)));
  }
}

export function topOfBook(book: BookStateMirror): TopOfBookMirror | null {
  const bestBid = book.bids[0];
  const bestAsk = book.asks[0];
  if (!bestBid || !bestAsk) return null;
  return {
    bid_price: bestBid.price,
    bid_size: bestBid.orders.reduce((acc, order) => add(acc, order.remaining), '0'),
    ask_price: bestAsk.price,
    ask_size: bestAsk.orders.reduce((acc, order) => add(acc, order.remaining), '0'),
  };
}

// ---------------------------------------------------------------------------
// Physics helpers
// ---------------------------------------------------------------------------

function feeFor(physics: ExchangePhysicsMirror, notional: string, role: 'maker' | 'taker'): string {
  let bps: string | null = null;
  for (const tier of physics.fees.tiers) {
    if (tier.up_to_notional === null || compare(notional, tier.up_to_notional) <= 0) {
      bps = role === 'taker' ? tier.taker_bps : tier.maker_bps;
      break;
    }
  }
  if (bps === null) {
    const last = physics.fees.tiers[physics.fees.tiers.length - 1]!;
    bps = role === 'taker' ? last.taker_bps : last.maker_bps;
  }
  return roundHalfUp(divideRoundHalfUp(multiply(notional, bps), '10000', physics.fees.fee_decimals + 4), physics.fees.fee_decimals);
}

function latencyFor(physics: ExchangePhysicsMirror, domain: 'order' | 'fill', ordinal: number): number {
  if (physics.latency.kind === 'fixed') return physics.latency.fixed_ms;
  const draw = createSeededRandom(`${physics.seed}:${domain}:${ordinal}`)();
  return Math.round(physics.latency.min_ms + draw * (physics.latency.max_ms - physics.latency.min_ms));
}

function slippageAdjust(physics: ExchangePhysicsMirror, levelPrice: string, side: 'buy' | 'sell'): string {
  if (physics.slippage.kind === 'book_walk') return levelPrice; // the walk IS the slippage
  const bps = physics.slippage.bps;
  if (side === 'buy') return multiply(levelPrice, divideRoundHalfUp(add('10000', bps), '10000', 12));
  return multiply(levelPrice, divideRoundHalfUp(subtract('10000', bps), '10000', 12));
}

// ---------------------------------------------------------------------------
// The engine (EngineDriverMirror implementation)
// ---------------------------------------------------------------------------

/** The reference engine — satisfies `EngineDriverMirror` structurally. */
export const referenceEngine: EngineDriverMirror = {
  createEngine(config: unknown, init: EngineInitMirror): OpResult<EngineStateMirror> {
    if (!isRecord(config)) return opError('invalid_type', 'engine config must be an object', 'config');
    const c = config as unknown as { venue: string; instrument: string; asset_class: string } & ExchangePhysicsMirror;
    if (!isUnsignedDecimal(c.tick_size) || !isUnsignedDecimal(c.lot_size)) {
      return opError('invalid_field', 'tick_size/lot_size must be decimal strings', 'config');
    }
    if (c.fidelity !== 'reactive_replay' && c.fidelity !== 'generative') {
      return opError('invalid_field', `unsupported fidelity "${String(c.fidelity)}"`, 'config.fidelity');
    }
    const book: WorkingBook = { bids: [], asks: [] };
    const bookSeed = init?.book_seed;
    if (isRecord(bookSeed) && Array.isArray((bookSeed as { bids: unknown }).bids)) {
      const seed = bookSeed as { bids: readonly { price: string; size: string }[]; asks: readonly { price: string; size: string }[] };
      for (const level of [...seed.bids, ...seed.asks]) {
        if (!isUnsignedDecimal(level.price) || !isUnsignedDecimal(level.size)) {
          return opError('invalid_field', 'book seed levels must be unsigned decimals', 'init.book_seed');
        }
      }
      seed.bids.forEach((level, index) => restOrder(book, `xo-seed-bid-${index}`, 'buy', level.price, level.size));
      seed.asks.forEach((level, index) => restOrder(book, `xo-seed-ask-${index}`, 'sell', level.price, level.size));
      const top = topOfBook(frozenBookOf(book));
      if (top && compare(top.bid_price, top.ask_price) >= 0) {
        return opError('invalid_field', 'book seed crosses (best bid >= best ask)', 'init.book_seed');
      }
    }
    return {
      ok: true,
      value: deepFreeze({
        config: { ...c },
        now: typeof init?.start_at === 'number' ? init.start_at : 0,
        next_order_ordinal: 1,
        next_fill_ordinal: 1,
        book: frozenBookOf(book),
        orders: [],
        fills: [],
        last_trade_price: null,
      }) as EngineStateMirror,
    };
  },

  submitOrder(state: EngineStateMirror, intent: unknown, at: unknown): OpResult<SubmitOutcomeMirror> {
    if (typeof at !== 'number' || !Number.isFinite(at)) return opError('invalid_type', 'arrival instant must be a number', 'at');
    if (at < state.now) return opError('arrival_before_now', `arrival ${at} precedes engine now ${state.now}`, 'at');
    if (!isRecord(intent)) return opError('invalid_type', 'order intent must be an object', 'intent');
    const order = intent as unknown as OrderIntentRecordMirror;
    const physics = state.config;
    if (!isCanonicalPositiveDecimal(order.quantity)) return opError('invalid_field', 'quantity must be a canonical positive decimal', 'intent.quantity');
    if (!isAlignedToGrid(order.quantity, physics.lot_size)) return opError('wrong_lot_size', `${order.quantity} is not a lot multiple of ${physics.lot_size}`, 'intent.quantity');
    if (order.kind !== 'market' && order.kind !== 'limit') {
      return opError('unsupported_order_kind', `kind "${order.kind}" is not supported by the reference engine (market | limit)`, 'intent.kind');
    }
    if (order.kind === 'limit' && (!order.price || !isAlignedToGrid(order.price, physics.tick_size))) {
      return opError('wrong_tick_size', 'limit price must be a tick-aligned decimal', 'intent.price');
    }
    if (order.timeInForce !== 'gtc' && order.timeInForce !== 'day' && order.timeInForce !== 'ioc') {
      return opError('unsupported_time_in_force', `timeInForce "${order.timeInForce}" is not supported (gtc | day | ioc)`, 'intent.timeInForce');
    }
    if (state.orders.some((existing) => existing.client_order_id === order.clientOrderId)) {
      return opError('duplicate_client_order_id', order.clientOrderId, 'intent.clientOrderId');
    }

    const orderOrdinal = state.next_order_ordinal;
    const orderId = `xo-${orderOrdinal.toString().padStart(8, '0')}`;
    const orderLatency = latencyFor(physics, 'order', orderOrdinal);
    const working = workingBookOf(state.book);
    const oppositeLevels = order.side === 'buy' ? working.asks : working.bids;
    let remaining = order.quantity;
    const fills: FillMirror[] = [];
    let lastLevelPrice: string | null = null;

    // Price-time priority walk over the opposite side.
    while (remaining !== '0' && oppositeLevels.length > 0) {
      const level = oppositeLevels[0]!;
      if (order.kind === 'limit') {
        const crosses = order.side === 'buy' ? compare(order.price!, level.price) >= 0 : compare(order.price!, level.price) <= 0;
        if (!crosses) break;
      }
      for (const maker of level.orders) {
        if (remaining === '0') break;
        const fillQty = compare(maker.remaining, remaining) <= 0 ? maker.remaining : remaining;
        if (fillQty === '0') continue;
        const fillOrdinal = state.next_fill_ordinal + fills.length;
        const fillLatency = latencyFor(physics, 'fill', fillOrdinal);
        const aggressorPrice = slippageAdjust(physics, level.price, order.side);
        fills.push({
          fill_id: `xf-${fillOrdinal.toString().padStart(8, '0')}`,
          trade_id: `xf-${fillOrdinal.toString().padStart(8, '0')}`,
          venue: physics.venue,
          instrument: physics.instrument,
          quartet: { event_time: at, source_time: null, available_time: at + fillLatency, ingestion_time: at + fillLatency },
          sequence: fillOrdinal,
          taker_order_id: orderId,
          maker_order_id: maker.order_id,
          aggressor_side: order.side,
          price: level.price,
          aggressor_price: aggressorPrice,
          quantity: fillQty,
          taker_fee: feeFor(physics, multiply(fillQty, aggressorPrice), 'taker'),
          maker_fee: feeFor(physics, multiply(fillQty, level.price), 'maker'),
          latency_ms: fillLatency,
        });
        maker.remaining = subtract(maker.remaining, fillQty);
        remaining = subtract(remaining, fillQty);
        lastLevelPrice = level.price;
      }
      oppositeLevels.shift(); // level fully processed (makers consumed or zeroed)
    }

    // IOC / market remainder: cancel what could not fill.
    let canceledRemainder = false;
    if (remaining !== '0' && (order.kind === 'market' || order.timeInForce === 'ioc')) {
      canceledRemainder = true;
      remaining = '0';
    }

    // Rest the remainder (resting limit orders).
    if (remaining !== '0' && order.kind === 'limit') {
      restOrder(working, orderId, order.side, order.price!, remaining);
    }

    const filledQuantity = subtract(order.quantity, remaining);
    let status: 'open' | 'partially_filled' | 'filled' | 'canceled';
    if (remaining === '0' && !canceledRemainder) status = 'filled';
    else if (canceledRemainder) status = filledQuantity === '0' ? 'canceled' : 'filled';
    else if (filledQuantity !== '0') status = 'partially_filled';
    else status = 'open';

    const ack =
      status === 'canceled'
        ? {
            order_id: orderId,
            client_order_id: order.clientOrderId,
            quartet: { event_time: at, source_time: null, available_time: at + orderLatency, ingestion_time: at + orderLatency },
            status: 'rejected' as const,
            filled_quantity: filledQuantity,
            reason: (order.kind === 'market' ? 'market_order_unfilled_remainder' : 'ioc_unfilled') as 'market_order_unfilled_remainder' | 'ioc_unfilled',
            detail: 'remainder could not fill',
          }
        : {
            order_id: orderId,
            client_order_id: order.clientOrderId,
            quartet: { event_time: at, source_time: null, available_time: at + orderLatency, ingestion_time: at + orderLatency },
            status,
            filled_quantity: filledQuantity,
          };

    const nextState: EngineStateMirror = deepFreeze({
      config: state.config,
      now: at,
      next_order_ordinal: orderOrdinal + 1,
      next_fill_ordinal: state.next_fill_ordinal + fills.length,
      book: frozenBookOf(working),
      orders: [
        ...state.orders,
        {
          order_id: orderId,
          client_order_id: order.clientOrderId,
          status,
          quantity: order.quantity,
          filled_quantity: filledQuantity,
          fill_ids: fills.map((fill) => fill.fill_id),
        },
      ],
      fills: [...state.fills, ...fills],
      last_trade_price: lastLevelPrice ?? state.last_trade_price,
    });

    return {
      ok: true,
      value: {
        state: nextState,
        ack: ack as SubmitOutcomeMirror['ack'],
        fills,
        cancels: canceledRemainder
          ? [{
              order_id: orderId,
              client_order_id: order.clientOrderId,
              quartet: { event_time: at, source_time: null, available_time: at + orderLatency, ingestion_time: at + orderLatency },
              reason: (order.kind === 'market' ? 'market_order_unfilled_remainder' : 'ioc_unfilled') as 'market_order_unfilled_remainder' | 'ioc_unfilled',
              remaining_quantity: '0',
            }]
          : [],
        top_of_book_changed: fills.length > 0 || remaining !== '0',
      },
    };
  },

  cancelOrder(state: EngineStateMirror, reference: unknown, at: unknown): OpResult<CancelOutcomeMirror> {
    if (typeof at !== 'number') return opError('invalid_type', 'arrival instant must be a number', 'at');
    if (typeof reference !== 'string') return opError('invalid_type', 'cancel reference must be a string', 'reference');
    const target = state.orders.find((record) => record.order_id === reference || record.client_order_id === reference);
    if (!target) return opError('invalid_field', `unknown order "${reference}"`, 'reference');
    if (target.status !== 'open' && target.status !== 'partially_filled') {
      return opError('invalid_field', `order ${reference} is ${target.status} and cannot be canceled`, 'reference');
    }
    const working = workingBookOf(state.book);
    for (const level of [...working.bids, ...working.asks]) {
      level.orders = level.orders.filter((order) => order.order_id !== target.order_id);
    }
    const nextState: EngineStateMirror = deepFreeze({
      ...state,
      now: at,
      book: frozenBookOf(working),
      orders: state.orders.map((record) =>
        record.order_id === target.order_id ? { ...record, status: 'canceled' as const } : record,
      ),
    });
    return {
      ok: true,
      value: {
        state: nextState,
        cancel: {
          order_id: target.order_id,
          client_order_id: target.client_order_id,
          quartet: { event_time: at, source_time: null, available_time: at, ingestion_time: at },
          reason: 'cancel_requested',
          remaining_quantity: subtract(target.quantity, target.filled_quantity),
        },
      },
    };
  },

  advanceEngine(state: EngineStateMirror, to: unknown): OpResult<AdvanceOutcomeMirror> {
    if (typeof to !== 'number') return opError('invalid_type', 'advance target must be a number', 'to');
    if (to < state.now) return opError('clock_regression', `advance target ${to} precedes now ${state.now}`, 'to');
    // The reference engine has no expiring orders (gtc/day/limit only).
    return { ok: true, value: { state: deepFreeze({ ...state, now: to }), expirations: [] } };
  },
};

export type { RestingLevelMirror };
