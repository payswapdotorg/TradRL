/**
 * @tradrl/exchange-sim — the MatchingEngine: a PURE REDUCER over an
 * immutable order book (work order T010, the execution-fidelity core of
 * the Market World).
 *
 * THE LAWS THIS ENGINE OWNS:
 *
 * PRICE-TIME PRIORITY (L6): resting orders queue by price first (bids
 * descending, asks ascending) and by ARRIVAL within a price (the queue's
 * order). Ties at the same price AND the same arrival instant are broken
 * by the ARRIVAL ORDINAL — a strictly increasing counter minted in
 * submission order — so the priority order is TOTAL and deterministic.
 *
 * AUTHORITY-FREEDOM (L8): the engine fills orders per its mechanical
 * rules. There is no participant identity (the domain Order contract
 * carries no owner — the actor lives on the environment action envelope,
 * T005), no balance, no permission, no kill switch. Risk/authorization
 * gating happens entirely outside (T019/T020/T034 lane). DECLARED
 * consequence: the engine cannot detect or prevent self-trades.
 *
 * DETERMINISM (L9): same (config, book seed, order stream, arrival
 * instants) -> byte-identical outcome stream. No Math.random (the only
 * randomness is the latency model's seeded counter-keyed draws), no
 * Date.now (every instant is an explicit argument), no iteration over
 * unordered structures (books, queues and logs are arrays). Two runs
 * deep-equal — proven by dedicated tests.
 *
 * IMMUTABILITY (L3): every transition returns a NEW deeply frozen state;
 * the input state is never mutated (asserted by tests).
 *
 * L6 DECLARED LIMITATIONS (nothing silent — each is typed and tested):
 *   - stop and stop-limit intents (structurally valid per the domain
 *     mirror) are REJECTED with 'unsupported_order_kind': trigger-on-
 *     print is not modeled in this Work Order;
 *   - registered extension kinds/TIFs are rejected likewise;
 *   - 'day' time-in-force is treated as 'gtc' within one episode (no
 *     trading-calendar model);
 *   - matching itself is instantaneous at the arrival instant (latency
 *     is information latency only — see latency.ts);
 *   - the book models VISIBLE liquidity only (book.ts header);
 *   - market orders consume the visible book and CANCEL any remainder
 *     ('market_order_unfilled_remainder') — they never rest, and they
 *     carry no price band beyond the book's own depth;
 *   - no self-trade prevention (no participant identity, L8).
 *
 * THE TRANSITIONS (pure, total, typed errors on misuse):
 *   - `submitOrder(state, intent, at)` — intake: validate the intent
 *     envelope (collect-all), mint the order id and ordinal, apply the
 *     venue's mechanical rules (tick, lot, depth, duplicate id, kind/TIF
 *     support), match any crossing remainder against the book in
 *     price-time priority, rest the remainder per its time-in-force, and
 *     return the new state with the ack/reject, fills and cancels.
 *   - `cancelOrder(state, reference, at)` — remove a live order's
 *     remainder from the book ('cancel_requested').
 *   - `advanceEngine(state, to)` — move the engine clock (monotonic);
 *     expire gtt orders whose expiry instant has been reached.
 *
 * CLOCK LAW: arrival instants are MONOTONIC with the engine clock — a
 * submit/cancel at `at` moves the clock to `at` (never backwards; `at`
 * before the clock fails with `arrival_before_now`), so the engine's
 * instant always covers every outcome it has emitted.
 */

import { deepFreeze } from './primitives';
import { fail, ok, type ExchangeResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import { mintFillId, mintOrderId, type ExchangeOrderId, type FillId } from './ids';
import { add, compare, isAlignedToGrid, normalize, subtract } from './decimals';
import type { OrderIntent, Timestamp } from './domain-mirror';
import { isCoreTimeInForce, isoToEpochMs, validateOrderIntent } from './domain-mirror';
import type { BookSnapshotSeed, BookState, RestingLevel, RestingOrder } from './book';
import { emptyBook, validateBookSeed } from './book';
import type { ExchangeConfig } from './config';
import { validateExchangeConfig } from './config';
import { feesOfFill } from './fees';
import { latencyDelayMs } from './latency';
import { aggressorPrice } from './slippage';
import type { AvailabilityQuartet, Fill, OrderAck, OrderAuditEvent, OrderCancelRecord, OrderRecord, OrderReject, OrderStatus, RejectReason } from './records';
import { quartetOf } from './records';

// ---------------------------------------------------------------------------
// The engine state
// ---------------------------------------------------------------------------

/**
 * The immutable engine state: the config, the engine clock, the id/ordinal
 * counters, the resting book, the complete order log (every intent ever
 * received, with its audit trail), the fill log and the last trade print.
 * JSON-serializable, deeply frozen, never mutated in place (L3/L9).
 */
export interface EngineState {
  readonly config: ExchangeConfig;
  /** The engine's current instant (monotonic). */
  readonly now: TimestampMs;
  /** The next arrival ordinal (starts at 1; ordinals are strictly increasing). */
  readonly next_order_ordinal: number;
  /** The next fill ordinal (starts at 1). */
  readonly next_fill_ordinal: number;
  readonly book: BookState;
  /** Every order intent ever received (rejected ones included) — the audit log. */
  readonly orders: readonly OrderRecord[];
  /** Every fill ever executed, in execution order. */
  readonly fills: readonly Fill[];
  /** The last trade print price (the book price of the most recent fill), or null before the first fill. */
  readonly last_trade_price: string | null;
}

// ---------------------------------------------------------------------------
// Transition outcomes
// ---------------------------------------------------------------------------

/** The product of one order submission. */
export interface SubmitOutcome {
  readonly state: EngineState;
  /** The intake outcome: an ack (the order entered the workflow) or a reject (a mechanical venue rule failed). */
  readonly ack: OrderAck | OrderReject;
  /** The fills executed at intake, in execution order. */
  readonly fills: readonly Fill[];
  /** Remainder-leaving records produced at intake (IOC/FOK/market remainders). */
  readonly cancels: readonly OrderCancelRecord[];
  /** True iff the top of book changed (for quote emission upstream). */
  readonly top_of_book_changed: boolean;
}

/** The product of one cancel request. */
export interface CancelOutcome {
  readonly state: EngineState;
  readonly cancel: OrderCancelRecord;
}

/** The product of one clock advance. */
export interface AdvanceOutcome {
  readonly state: EngineState;
  /** Orders expired by this advance, in resting priority order. */
  readonly expirations: readonly OrderCancelRecord[];
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** Engine initialization options. */
export interface EngineInit {
  /** The book seed (a market-protocol book_snapshot-shaped value; validated against the venue grid rules). */
  readonly book_seed?: unknown;
  /** The engine's starting instant (validated TimestampMs; default 0 = the Unix epoch). */
  readonly start_at?: unknown;
}

/**
 * Create an engine: validate the config (collect-all), validate the book
 * seed against the venue's grid rules (tick/lot/depth/no-crossing) and
 * seed the resting book from it. Seed levels become anonymous resting
 * liquidity owned by the book itself (maker fills against seed liquidity
 * reference the synthetic order ids `xo-seed-bid-<i>` / `xo-seed-ask-<i>`,
 * which never expire and never cancel).
 */
export function createEngine(config: unknown, init: EngineInit = {}): ExchangeResult<EngineState> {
  const configResult = validateExchangeConfig(config);
  if (!configResult.ok) return configResult;
  const validConfig = configResult.value;

  const startAt: number = init.start_at === undefined ? 0 : (init.start_at as number);
  if (!isTimestampMs(startAt)) {
    return fail('invalid_timestamp', 'start_at must be a valid TimestampMs instant', 'start_at');
  }

  let book: BookState = emptyBook();
  if (init.book_seed !== undefined && init.book_seed !== null) {
    const seedResult = validateBookSeed(init.book_seed, validConfig);
    if (!seedResult.ok) return seedResult;
    book = seedBookFrom(seedResult.value);
  }

  return ok(
    deepFreeze({
      config: validConfig,
      now: startAt as TimestampMs,
      next_order_ordinal: 1,
      next_fill_ordinal: 1,
      book,
      orders: [],
      fills: [],
      last_trade_price: null,
    }),
  );
}

/** Materialize a validated book seed into resting levels with synthetic maker orders. */
function seedBookFrom(seed: BookSnapshotSeed): BookState {
  const bids: RestingLevel[] = seed.bids.map((level, index) => ({
    price: normalize(level.price),
    orders: [{ order_id: `xo-seed-bid-${index}` as ExchangeOrderId, remaining: normalize(level.size) }],
  }));
  const asks: RestingLevel[] = seed.asks.map((level, index) => ({
    price: normalize(level.price),
    orders: [{ order_id: `xo-seed-ask-${index}` as ExchangeOrderId, remaining: normalize(level.size) }],
  }));
  return deepFreeze({ bids, asks });
}

// ---------------------------------------------------------------------------
// The submission transition
// ---------------------------------------------------------------------------

/**
 * Submit one order intent at engine instant `at`.
 *
 * FAILURES (operation errors — the exchange could not even process the
 * request as a well-formed event): malformed intent envelope (collect-
 * all), `at` not a valid timestamp, `at` before the engine clock
 * (arrivals are monotonic with the clock).
 *
 * REJECTS (successful outcomes that ride the output stream): duplicate
 * client order id, wrong tick/lot, beyond book depth, unsupported
 * kind/TIF, gtt already expired on arrival — see {@link RejectReason}.
 *
 * MATCHING: a crossing (or market) order consumes the opposite book in
 * price-time priority — levels best-first, queues in arrival order —
 * producing one {@link Fill} per (taker, maker) pair consumed. The fill
 * price is the maker's level price (the print, and both parties' audit
 * anchor); the aggressor's price comes from the slippage model. Fees are
 * computed per side at fill time (taker on the aggressor's price, maker
 * on the print). Remainders rest per TIF: gtc/day/gtt rest at the limit
 * price; ioc and market cancel theirs; fok cancels the WHOLE order
 * (zero fills) when the full quantity is not available within the limit
 * constraint.
 */
export function submitOrder(state: EngineState, intent: unknown, at: unknown): ExchangeResult<SubmitOutcome> {
  if (!isTimestampMs(at)) {
    return fail('invalid_timestamp', 'submit requires a valid TimestampMs arrival instant');
  }
  if (at < state.now) {
    return fail(
      'arrival_before_now',
      `order claims arrival at ${at} but the engine clock is at ${state.now} — arrivals are monotonic with the clock; advance the clock first`,
    );
  }

  const expected = { venue: state.config.venue, instrument: state.config.instrument };
  const intentResult = validateOrderIntent(intent, expected);
  if (!intentResult.ok) return intentResult;
  const validIntent = intentResult.value;

  // Mint identity in arrival order (the deterministic priority tie-break).
  const arrivalOrdinal = state.next_order_ordinal;
  const orderId = mintOrderId(arrivalOrdinal);
  const receivedEvent: OrderAuditEvent = deepFreeze({ at, kind: 'received' });
  const orderDelay = latencyDelayMs(state.config.latency, state.config.seed, 'order', arrivalOrdinal);

  // --- Mechanical venue rules (rejects — successful typed outcomes) -------
  const reject = intakeRejection(state, validIntent, at);
  if (reject !== null) {
    const record: OrderRecord = deepFreeze({
      order_id: orderId,
      client_order_id: validIntent.clientOrderId,
      intent: validIntent,
      received_at: at,
      arrival_ordinal: arrivalOrdinal,
      status: 'rejected',
      reject_reason: reject.reason,
      cancel_reason: null,
      quantity: normalize(validIntent.quantity),
      filled_quantity: '0',
      remaining_quantity: '0',
      fill_ids: [],
      expires_at_ms: null,
      events: [receivedEvent, deepFreeze({ at, kind: 'rejected' })],
    });
    const ackReject: OrderReject = deepFreeze({
      order_id: orderId,
      client_order_id: validIntent.clientOrderId,
      quartet: quartetOf(at, orderDelay),
      reason: reject.reason,
      detail: reject.detail,
    });
    return ok({
      state: deepFreeze({ ...state, now: at, next_order_ordinal: arrivalOrdinal + 1, orders: [...state.orders, record] }),
      ack: ackReject,
      fills: [],
      cancels: [],
      top_of_book_changed: false,
    });
  }

  // --- Matching ------------------------------------------------------------
  const side = validIntent.side;
  const limitPrice = validIntent.kind === 'limit' ? normalize(validIntent.price as string) : null;
  const expiresAtMs = validIntent.timeInForce === 'gtt' ? isoToEpochMs(validIntent.expiresAt as Timestamp) : null;

  let book = state.book;
  let orders = state.orders;
  let fills = state.fills;
  let nextFillOrdinal = state.next_fill_ordinal;
  let lastTradePrice = state.last_trade_price;
  let remaining = normalize(validIntent.quantity);
  const executedFillIds: FillId[] = [];
  const auditEvents: OrderAuditEvent[] = [receivedEvent];

  // FOK precheck: the whole quantity must be available within the limit
  // constraint, else NOTHING fills and the order dies whole.
  if (validIntent.timeInForce === 'fok') {
    const available = availableQuantity(book, side, limitPrice);
    if (compare(available, remaining) < 0) {
      return finishIntake(
        state, at, arrivalOrdinal, orderId, validIntent, orderDelay, 'fok_unfilled',
        '0', remaining, executedFillIds, book, orders, fills, nextFillOrdinal, lastTradePrice, auditEvents, false,
      );
    }
  }

  // Walk the opposite book while quantity remains and (for limit orders)
  // the best opposite level's price still satisfies the limit.
  while (compare(remaining, '0') > 0) {
    const level = bestOppositeLevel(book, side);
    if (level === null) break;
    if (limitPrice !== null) {
      const satisfies = side === 'buy' ? compare(level.price, limitPrice) <= 0 : compare(level.price, limitPrice) >= 0;
      if (!satisfies) break;
    }

    // Consume this level's queue in arrival order (price-time priority).
    let queue = level.orders;
    let queueIndex = 0;
    while (queueIndex < queue.length && compare(remaining, '0') > 0) {
      const resting = queue[queueIndex];
      if (resting === undefined) break;
      const fillQuantity = minDecimal(remaining, resting.remaining);
      const fillOrdinal = nextFillOrdinal;
      const fillId = mintFillId(fillOrdinal);
      const fill = buildFill(state.config, fillOrdinal, fillId, at, orderId, resting.order_id, side, level.price, fillQuantity);

      fills = [...fills, fill];
      nextFillOrdinal += 1;
      executedFillIds.push(fillId);
      auditEvents.push(deepFreeze({ at, kind: 'fill', fill_id: fillId }));
      lastTradePrice = fill.price;

      remaining = subtract(remaining, fillQuantity);
      const restingRemaining = subtract(resting.remaining, fillQuantity);
      // The resting order's record gains its fill event and status.
      orders = orders.map((record) =>
        record.order_id === resting.order_id ? appendFillToRecord(record, fill, fillQuantity, restingRemaining, at) : record,
      );
      if (restingRemaining === '0') {
        // Fully consumed: remove from the queue; the next order shifts into place.
        queue = queue.filter((candidate) => candidate.order_id !== resting.order_id);
        continue;
      }
      // Partially consumed: update the resting remainder in place.
      queue = [...queue.slice(0, queueIndex), { order_id: resting.order_id, remaining: restingRemaining }, ...queue.slice(queueIndex + 1)];
      queueIndex += 1;
    }

    // Rebuild the opposite side: the consumed level is the side's BEST, so
    // it either stays at the front (with its updated queue) or is dropped.
    const oppositeSide = side === 'buy' ? 'asks' : 'bids';
    const otherLevels = book[oppositeSide].filter((candidate) => candidate.price !== level.price);
    const rebuiltLevels =
      queue.length === 0 ? otherLevels : [{ price: level.price, orders: queue }, ...otherLevels];
    book = deepFreeze({ bids: oppositeSide === 'bids' ? rebuiltLevels : book.bids, asks: oppositeSide === 'asks' ? rebuiltLevels : book.asks });
  }

  const filledQuantity = subtract(normalize(validIntent.quantity), remaining);
  const matchedSomething = book !== state.book;
  const status: OrderStatus = compare(remaining, '0') === 0 ? 'filled' : compare(filledQuantity, '0') > 0 ? 'partially_filled' : 'open';

  // --- Remainder handling per time-in-force --------------------------------
  if (status !== 'filled') {
    if (validIntent.kind === 'market') {
      // Market orders never rest; the remainder dies with a typed reason.
      return finishIntake(
        state, at, arrivalOrdinal, orderId, validIntent, orderDelay, 'market_order_unfilled_remainder',
        filledQuantity, remaining, executedFillIds, book, orders, fills, nextFillOrdinal, lastTradePrice, auditEvents, matchedSomething,
      );
    }
    if (validIntent.timeInForce === 'ioc') {
      return finishIntake(
        state, at, arrivalOrdinal, orderId, validIntent, orderDelay, 'ioc_unfilled',
        filledQuantity, remaining, executedFillIds, book, orders, fills, nextFillOrdinal, lastTradePrice, auditEvents, matchedSomething,
      );
    }
    // gtc / day / gtt: rest the remainder at its limit price (joins a
    // level's queue at its END — arrival order within the price).
    book = restOrder(book, side, limitPrice as string, { order_id: orderId, remaining });
  }

  const ack: OrderAck = deepFreeze({
    order_id: orderId,
    client_order_id: validIntent.clientOrderId,
    quartet: quartetOf(at, orderDelay),
    status,
    filled_quantity: filledQuantity,
  });
  const record: OrderRecord = deepFreeze({
    order_id: orderId,
    client_order_id: validIntent.clientOrderId,
    intent: validIntent,
    received_at: at,
    arrival_ordinal: arrivalOrdinal,
    status,
    reject_reason: null,
    cancel_reason: null,
    quantity: normalize(validIntent.quantity),
    filled_quantity: filledQuantity,
    remaining_quantity: remaining,
    fill_ids: [...executedFillIds],
    expires_at_ms: expiresAtMs,
    events: [...auditEvents, deepFreeze({ at, kind: 'acked' })],
  });

  return ok({
    state: deepFreeze({
      ...state,
      now: at,
      next_order_ordinal: arrivalOrdinal + 1,
      next_fill_ordinal: nextFillOrdinal,
      book,
      orders: [...orders, record],
      fills,
      last_trade_price: lastTradePrice,
    }),
    ack,
    fills: fills.slice(state.fills.length),
    cancels: [],
    top_of_book_changed: matchedSomething || book !== state.book,
  });
}

/** Append a fill's audit effect to a resting order's record. */
function appendFillToRecord(record: OrderRecord, fill: Fill, quantity: string, restingRemaining: string, at: TimestampMs): OrderRecord {
  const filledQuantity = add(record.filled_quantity, quantity);
  const status: OrderStatus = restingRemaining === '0' ? 'filled' : 'partially_filled';
  return deepFreeze({
    ...record,
    status,
    filled_quantity: filledQuantity,
    remaining_quantity: restingRemaining,
    fill_ids: [...record.fill_ids, fill.fill_id],
    events: [...record.events, deepFreeze({ at, kind: 'fill', fill_id: fill.fill_id })],
  });
}

/** Assemble one fill record (the trade print + both fees + the latency-gated quartet). */
function buildFill(
  config: ExchangeConfig,
  fillOrdinal: number,
  fillId: FillId,
  at: TimestampMs,
  takerOrderId: ExchangeOrderId,
  makerOrderId: ExchangeOrderId,
  aggressorSide: 'buy' | 'sell',
  bookPrice: string,
  quantity: string,
): Fill {
  const takerPrice = aggressorPrice(config.slippage, aggressorSide, bookPrice, config.tick_size);
  // Taker fee prices the aggressor's execution price; maker fee the print.
  const takerFees = feesOfFill(config.fees, takerPrice, quantity);
  const makerFees = feesOfFill(config.fees, bookPrice, quantity);
  const delay = latencyDelayMs(config.latency, config.seed, 'fill', fillOrdinal);
  const quartet: AvailabilityQuartet = quartetOf(at, delay);
  return deepFreeze({
    fill_id: fillId,
    trade_id: fillId,
    venue: config.venue,
    instrument: config.instrument,
    quartet,
    sequence: fillOrdinal,
    taker_order_id: takerOrderId,
    maker_order_id: makerOrderId,
    aggressor_side: aggressorSide,
    price: bookPrice,
    aggressor_price: takerPrice,
    quantity,
    taker_fee: takerFees.taker.fee,
    maker_fee: makerFees.maker.fee,
    latency_ms: delay,
  });
}

/**
 * Finish an intake whose order never rests: terminal 'canceled' status
 * with a typed reason (IOC/FOK/market remainders). The ack, the cancel
 * record and the terminal order record are emitted; fills produced
 * before the remainder died ride the outcome as usual.
 */
function finishIntake(
  state: EngineState,
  at: TimestampMs,
  arrivalOrdinal: number,
  orderId: ExchangeOrderId,
  intent: OrderIntent,
  orderDelay: number,
  cancelReason: 'ioc_unfilled' | 'fok_unfilled' | 'market_order_unfilled_remainder',
  filledQuantity: string,
  remainingQuantity: string,
  executedFillIds: readonly FillId[],
  book: BookState,
  orders: readonly OrderRecord[],
  fills: readonly Fill[],
  nextFillOrdinal: number,
  lastTradePrice: string | null,
  auditEvents: readonly OrderAuditEvent[],
  topOfBookChanged: boolean,
): ExchangeResult<SubmitOutcome> {
  const record: OrderRecord = deepFreeze({
    order_id: orderId,
    client_order_id: intent.clientOrderId,
    intent,
    received_at: at,
    arrival_ordinal: arrivalOrdinal,
    status: 'canceled',
    reject_reason: null,
    cancel_reason: cancelReason,
    quantity: normalize(intent.quantity),
    filled_quantity: filledQuantity,
    remaining_quantity: '0',
    fill_ids: [...executedFillIds],
    expires_at_ms: null,
    events: [...auditEvents, deepFreeze({ at, kind: 'canceled' })],
  });
  const ack: OrderAck = deepFreeze({
    order_id: orderId,
    client_order_id: intent.clientOrderId,
    quartet: quartetOf(at, orderDelay),
    status: 'canceled',
    filled_quantity: filledQuantity,
  });
  const cancel: OrderCancelRecord = deepFreeze({
    order_id: orderId,
    client_order_id: intent.clientOrderId,
    quartet: quartetOf(at, orderDelay),
    reason: cancelReason,
    remaining_quantity: remainingQuantity,
  });
  return ok({
    state: deepFreeze({
      ...state,
      now: at,
      next_order_ordinal: arrivalOrdinal + 1,
      next_fill_ordinal: nextFillOrdinal,
      book,
      orders: [...orders, record],
      fills,
      last_trade_price: lastTradePrice,
    }),
    ack,
    fills: fills.slice(state.fills.length),
    cancels: [cancel],
    top_of_book_changed: topOfBookChanged,
  });
}

/** The venue's mechanical intake rules; null when the intent may proceed to matching. */
function intakeRejection(state: EngineState, intent: OrderIntent, at: TimestampMs): { reason: RejectReason; detail: string } | null {
  // Duplicate client order id: idempotency is forever (terminal intents included).
  if (state.orders.some((record) => record.client_order_id === intent.clientOrderId)) {
    return {
      reason: 'duplicate_client_order_id',
      detail: `client order id "${intent.clientOrderId}" was already received (client order ids are unique for the engine's lifetime)`,
    };
  }

  // Kind support: this engine matches market and limit only (declared).
  if (intent.kind !== 'market' && intent.kind !== 'limit') {
    return {
      reason: 'unsupported_order_kind',
      detail: `kind "${intent.kind}" is structurally valid but not implemented by this engine — stop/stop-limit trigger semantics and registered extensions are declared unmodeled (L6)`,
    };
  }

  // TIF support: core values only; market orders cannot be gtt.
  if (!isCoreTimeInForce(intent.timeInForce)) {
    return {
      reason: 'unsupported_time_in_force',
      detail: `time-in-force "${intent.timeInForce}" is a registered extension — not implemented by this engine (L6)`,
    };
  }
  if (intent.kind === 'market' && intent.timeInForce === 'gtt') {
    return {
      reason: 'unsupported_time_in_force',
      detail: 'a market order cannot carry gtt semantics — market orders never rest, so an expiry instant is meaningless',
    };
  }

  // Lot grid.
  if (!isAlignedToGrid(normalize(intent.quantity), state.config.lot_size)) {
    return {
      reason: 'wrong_lot_size',
      detail: `quantity "${intent.quantity}" is not a multiple of the lot size ${state.config.lot_size}`,
    };
  }

  // Tick grid + book-depth cap (limit orders only — they rest at a price).
  if (intent.kind === 'limit') {
    const price = normalize(intent.price as string);
    if (!isAlignedToGrid(price, state.config.tick_size)) {
      return {
        reason: 'wrong_tick_size',
        detail: `price "${intent.price}" is not a multiple of the tick size ${state.config.tick_size}`,
      };
    }
    if (restingWouldExceedDepth(state.book, intent.side, price, state.config.max_book_depth)) {
      return {
        reason: 'beyond_book_depth',
        detail: `a resting ${intent.side} at ${price} would fall beyond the venue's ${state.config.max_book_depth}-level book depth cap`,
      };
    }
  }

  // gtt expiry must be in the future at arrival.
  if (intent.timeInForce === 'gtt') {
    const expiryMs = isoToEpochMs(intent.expiresAt as Timestamp);
    if (expiryMs <= at) {
      return {
        reason: 'gtt_expired_on_arrival',
        detail: `gtt order expires at ${intent.expiresAt} (epoch ms ${expiryMs}) — at or before the arrival instant ${at}`,
      };
    }
  }

  return null;
}

/**
 * Depth-cap check: would a resting order at `price` on `side` fall beyond
 * the depth cap? Orders that CROSS the opposite book never rest, so the
 * cap only bites when the price does not cross the best opposite level;
 * joining an EXISTING level of one's own side is always allowed (the cap
 * counts price levels, not orders). Matching never changes one's own
 * side, so the pre-match check equals the post-match state.
 */
function restingWouldExceedDepth(book: BookState, side: 'buy' | 'sell', price: string, maxDepth: number): boolean {
  const ownSide = side === 'buy' ? 'bids' : 'asks';
  const ownLevels = book[ownSide];
  if (ownLevels.some((level) => compare(level.price, price) === 0)) return false; // joins a level
  const oppositeSide = side === 'buy' ? 'asks' : 'bids';
  const opposite = book[oppositeSide];
  if (opposite.length > 0) {
    const bestOpposite = opposite[0] as RestingLevel;
    const crosses = side === 'buy' ? compare(price, bestOpposite.price) >= 0 : compare(price, bestOpposite.price) <= 0;
    if (crosses) return false; // it will match, never rest.
  }
  return ownLevels.length >= maxDepth;
}

/** The best opposite level for an aggressor of `side` (asks for buys, bids for sells), or null. */
function bestOppositeLevel(book: BookState, side: 'buy' | 'sell'): RestingLevel | null {
  const levels = side === 'buy' ? book.asks : book.bids;
  return levels.length === 0 ? null : (levels[0] as RestingLevel);
}

/** The total available quantity within the limit constraint (FOK precheck). */
function availableQuantity(book: BookState, side: 'buy' | 'sell', limitPrice: string | null): string {
  const levels = side === 'buy' ? book.asks : book.bids;
  let total = '0';
  for (const level of levels) {
    if (limitPrice !== null) {
      const satisfies = side === 'buy' ? compare(level.price, limitPrice) <= 0 : compare(level.price, limitPrice) >= 0;
      if (!satisfies) break;
    }
    for (const order of level.orders) {
      total = add(total, order.remaining);
    }
  }
  return total;
}

/** The smaller of two unsigned decimals (exact). */
function minDecimal(a: string, b: string): string {
  return compare(a, b) <= 0 ? a : b;
}

/** Rest a remainder at its limit price (joining an existing level's queue at its END — arrival order). */
function restOrder(book: BookState, side: 'buy' | 'sell', price: string, resting: RestingOrder): BookState {
  const ownSide = side === 'buy' ? 'bids' : 'asks';
  const levels = book[ownSide];
  const existingIndex = levels.findIndex((level) => compare(level.price, price) === 0);
  if (existingIndex === -1) {
    // New level: keep the side's best-first order (bids desc, asks asc).
    const result: RestingLevel[] = [];
    let inserted = false;
    for (const existing of levels) {
      if (!inserted) {
        const goesBefore = side === 'buy' ? compare(price, existing.price) > 0 : compare(price, existing.price) < 0;
        if (goesBefore) {
          result.push({ price, orders: [resting] });
          inserted = true;
        }
      }
      result.push(existing);
    }
    if (!inserted) result.push({ price, orders: [resting] });
    return deepFreeze({ bids: ownSide === 'bids' ? result : book.bids, asks: ownSide === 'asks' ? result : book.asks });
  }
  const existing = levels[existingIndex] as RestingLevel;
  const rebuiltQueue = [...existing.orders, resting];
  const rebuilt = levels.map((level, index) => (index === existingIndex ? { price: level.price, orders: rebuiltQueue } : level));
  return deepFreeze({ bids: ownSide === 'bids' ? rebuilt : book.bids, asks: ownSide === 'asks' ? rebuilt : book.asks });
}

// ---------------------------------------------------------------------------
// The cancel transition
// ---------------------------------------------------------------------------

/** A cancel reference: the venue order id OR the client order id (exactly one). */
export interface CancelReference {
  readonly order_id?: ExchangeOrderId;
  readonly client_order_id?: string;
}

/** Validate a cancel reference (exactly one of the two identifiers). */
function validateCancelReference(reference: unknown): ExchangeResult<CancelReference> {
  if (typeof reference !== 'object' || reference === null || Array.isArray(reference)) {
    return fail('invalid_order_reference', 'a cancel reference must be an object with order_id or client_order_id');
  }
  const candidate = reference as Record<string, unknown>;
  const hasOrderId = candidate.order_id !== undefined;
  const hasClientId = candidate.client_order_id !== undefined;
  if (hasOrderId === hasClientId) {
    return fail('invalid_order_reference', 'a cancel reference must carry exactly one of order_id or client_order_id');
  }
  if (hasOrderId && typeof candidate.order_id !== 'string') {
    return fail('invalid_order_reference', 'order_id must be a string');
  }
  if (hasClientId && typeof candidate.client_order_id !== 'string') {
    return fail('invalid_order_reference', 'client_order_id must be a string');
  }
  return ok(candidate as CancelReference);
}

/**
 * Cancel a live order's remainder at engine instant `at`. The order must
 * be open or partially filled; terminal orders fail with
 * `order_not_cancelable`; unknown references fail with `unknown_order`.
 * The remainder leaves the book with reason 'cancel_requested'.
 */
export function cancelOrder(state: EngineState, reference: unknown, at: unknown): ExchangeResult<CancelOutcome> {
  if (!isTimestampMs(at)) {
    return fail('invalid_timestamp', 'cancel requires a valid TimestampMs instant');
  }
  if (at < state.now) {
    return fail('arrival_before_now', `cancel claims arrival at ${at} but the engine clock is at ${state.now}`);
  }
  const referenceResult = validateCancelReference(reference);
  if (!referenceResult.ok) return referenceResult;

  const record = state.orders.find((candidate) =>
    referenceResult.value.order_id !== undefined
      ? candidate.order_id === referenceResult.value.order_id
      : candidate.client_order_id === referenceResult.value.client_order_id,
  );
  if (record === undefined) {
    return fail('unknown_order', 'no order matches the given reference in this engine');
  }
  if (record.status !== 'open' && record.status !== 'partially_filled') {
    return fail('order_not_cancelable', `order ${record.order_id} is ${record.status} — only live (open/partially_filled) orders can be canceled`);
  }

  // Remove the remainder from its level queue.
  const side = record.intent.side;
  const price = normalize(record.intent.price as string);
  const ownSide = side === 'buy' ? 'bids' : 'asks';
  const levels = state.book[ownSide];
  const levelIndex = levels.findIndex((level) => compare(level.price, price) === 0);
  let rebuiltLevels: readonly RestingLevel[];
  if (levelIndex === -1) {
    rebuiltLevels = levels; // unreachable for a live order; kept total
  } else {
    const level = levels[levelIndex] as RestingLevel;
    const queue = level.orders.filter((order) => order.order_id !== record.order_id);
    rebuiltLevels =
      queue.length === 0
        ? levels.filter((_, index) => index !== levelIndex)
        : levels.map((candidate, index) => (index === levelIndex ? { price: candidate.price, orders: queue } : candidate));
  }
  const book = deepFreeze({ bids: ownSide === 'bids' ? rebuiltLevels : state.book.bids, asks: ownSide === 'asks' ? rebuiltLevels : state.book.asks });

  const cancel: OrderCancelRecord = deepFreeze({
    order_id: record.order_id,
    client_order_id: record.client_order_id,
    quartet: quartetOf(at, latencyDelayMs(state.config.latency, state.config.seed, 'order', record.arrival_ordinal)),
    reason: 'cancel_requested',
    remaining_quantity: record.remaining_quantity,
  });
  const updated: OrderRecord = deepFreeze({
    ...record,
    status: 'canceled',
    cancel_reason: 'cancel_requested',
    remaining_quantity: '0',
    events: [...record.events, deepFreeze({ at, kind: 'canceled' })],
  });

  return ok({
    state: deepFreeze({
      ...state,
      now: at,
      book,
      orders: state.orders.map((candidate) => (candidate.order_id === record.order_id ? updated : candidate)),
    }),
    cancel,
  });
}

// ---------------------------------------------------------------------------
// The advance transition
// ---------------------------------------------------------------------------

/**
 * Advance the engine clock to `to` (monotonic). Expire every resting gtt
 * order whose expiry instant has been reached (`expired`), in resting
 * priority order (price first, then arrival). Seed liquidity never
 * expires. Returns the new state and the expiration records.
 */
export function advanceEngine(state: EngineState, to: unknown): ExchangeResult<AdvanceOutcome> {
  if (!isTimestampMs(to)) {
    return fail('invalid_timestamp', 'advance requires a valid TimestampMs target');
  }
  if (to < state.now) {
    return fail('clock_regression', `the engine clock may not move backwards: now=${state.now}, target=${to}`);
  }

  // Collect expirable resting orders in book priority order.
  const expirable: { record: OrderRecord; side: 'buy' | 'sell' }[] = [];
  const sides: readonly ['buy' | 'sell', readonly RestingLevel[]][] = [
    ['buy', state.book.bids],
    ['sell', state.book.asks],
  ];
  for (const [side, levels] of sides) {
    for (const level of levels) {
      for (const resting of level.orders) {
        const record = state.orders.find((candidate) => candidate.order_id === resting.order_id);
        if (record === undefined) continue; // seed liquidity: never expires
        if (record.expires_at_ms !== null && record.expires_at_ms <= to) {
          expirable.push({ record, side });
        }
      }
    }
  }

  if (expirable.length === 0) {
    return ok({ state: deepFreeze({ ...state, now: to }), expirations: [] });
  }

  let book = state.book;
  const expirations: OrderCancelRecord[] = [];
  let orders = state.orders;
  for (const { record, side } of expirable) {
    const ownSide = side === 'buy' ? 'bids' : 'asks';
    const price = normalize(record.intent.price as string);
    const levels = book[ownSide];
    const levelIndex = levels.findIndex((level) => compare(level.price, price) === 0);
    if (levelIndex !== -1) {
      const level = levels[levelIndex] as RestingLevel;
      const queue = level.orders.filter((order) => order.order_id !== record.order_id);
      const rebuilt =
        queue.length === 0
          ? levels.filter((_, index) => index !== levelIndex)
          : levels.map((candidate, index) => (index === levelIndex ? { price: candidate.price, orders: queue } : candidate));
      book = deepFreeze({ bids: ownSide === 'bids' ? rebuilt : book.bids, asks: ownSide === 'asks' ? rebuilt : book.asks });
    }
    expirations.push(
      deepFreeze({
        order_id: record.order_id,
        client_order_id: record.client_order_id,
        quartet: quartetOf(to, latencyDelayMs(state.config.latency, state.config.seed, 'order', record.arrival_ordinal)),
        reason: 'expired',
        remaining_quantity: record.remaining_quantity,
      }),
    );
    orders = orders.map((candidate) =>
      candidate.order_id === record.order_id
        ? deepFreeze({
            ...candidate,
            status: 'expired',
            cancel_reason: 'expired',
            remaining_quantity: '0',
            events: [...candidate.events, deepFreeze({ at: to, kind: 'expired' })],
          })
        : candidate,
    );
  }

  return ok({ state: deepFreeze({ ...state, now: to, book, orders }), expirations });
}

// ---------------------------------------------------------------------------
// Read-only view re-exports (for consumers)
// ---------------------------------------------------------------------------

/** The aggregated best bid/ask, or null when a side is empty. */
export { topOfBook } from './book';
/** The aggregated full-book view (bids descending, asks ascending). */
export { bookSnapshotView } from './book';
