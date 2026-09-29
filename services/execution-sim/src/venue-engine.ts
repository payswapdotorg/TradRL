/**
 * @tradrl/execution_sim (service) — the scripted venue: the exchange-sim
 * engine MIRROR the reference simulator drives.
 *
 * THE LAW (the Work Order's scope: "A reference simulator implementing
 * the spec: approved intents drive a scripted venue (exchange-sim
 * engine mirrors: matching with fees/latency/slippage/impact
 * configs)"): this module re-declares the engine's SEMANTICS by
 * structure over the contract package's venue-model mirrors —
 * price-time-priority book walking, per-fill fee quotes, deterministic
 * latency draws, the slippage model's aggressor price — never
 * importing the real engine (no cross-lane imports; the contract
 * package's interop trip wires prove the mirrors against it).
 *
 * THE LAWS THIS ENGINE MIRRORS:
 *
 * PRICE-TIME PRIORITY (exchange-sim engine.ts): a crossing order
 * consumes the opposite book best-first (bids descending, asks
 * ascending), one fill per consumed level, at the level's price (the
 * trade print).
 *
 * MECHANICAL VENUE RULES (authority-free — L8): duplicate client
 * order ids are rejected forever; limit prices sit on the tick grid;
 * quantities sit on the lot grid; stop/stop-limit kinds are rejected
 * ('unsupported_order_kind' — the mirrored declared limitation).
 *
 * L6 DECLARED LIMITATIONS (this mirror's own honesty — nothing
 * silent):
 *   - the mirror is TAKER-SIDE ONLY: unfilled remainders are CANCELED
 *     ('unfilled_remainder'), never rested — resting, queueing and
 *     gtt expiry belong to the REAL engine (T010); a consumer needing
 *     them drives it directly;
 *   - the book models VISIBLE liquidity only (the mirrored book-seed
 *     discipline);
 *   - the slippage and fee models mirror exchange-sim exactly (the
 *     aggressor-price quantization and the half-up fee rounding); the
 *     latency is information latency (fill observability), not
 *     matching latency.
 *
 * DETERMINISM (L9): same (venue model, book seed, order stream,
 * instants) -> byte-identical fill stream. Order/fill ids are
 * ordinal-minted (`xso-`/`xsf-`); every latency draw is the pure
 * counter-keyed derivation (the contract's latencyDelayMsMirror).
 * Immutable value-object state; no ambient clock; no randomness.
 */

import {
  add as decAdd,
  compare as decCompare,
  divideRoundHalfUp,
  floorToGrid,
  ceilToGrid,
  isAlignedToGrid,
  isTimestampMs,
  isZero,
  latencyDelayMsMirror,
  multiply as decMultiply,
  normalize as decNormalize,
  subtract as decSubtract,
  type ExecutionPolicyResult,
  type FeeScheduleMirror,
  type FeeTierMirror,
  type SlippageConfigMirror,
  type TimestampMs,
  type VenueModelRef,
  type BookLevelMirror,
  fail,
  ok,
  deepFreeze,
} from '../../../packages/execution-policy/src/index';

// ---------------------------------------------------------------------------
// The engine records (the venue lineage carriers)
// ---------------------------------------------------------------------------

/** The typed reason the scripted venue rejects an order at intake (mechanical rules only — L8). */
export type VenueRejectReason =
  | 'duplicate_client_order_id'
  | 'wrong_tick_size'
  | 'wrong_lot_size'
  | 'unsupported_order_kind'
  | 'unfilled_remainder';

export const VENUE_REJECT_REASONS: readonly VenueRejectReason[] = [
  'duplicate_client_order_id',
  'wrong_tick_size',
  'wrong_lot_size',
  'unsupported_order_kind',
  'unfilled_remainder',
] as const;

/** Guard: a venue reject reason. */
export function isVenueRejectReason(value: unknown): value is VenueRejectReason {
  return typeof value === 'string' && (VENUE_REJECT_REASONS as readonly string[]).includes(value);
}

/** One scripted venue order record: the intake outcome + its fills (the engine record refs of the venue lineage). */
export interface VenueOrderRecord {
  /** Ordinal-minted engine order ref (`xso-` + zero-padded ordinal — the exchange-sim minting law, mirrored). */
  readonly engineOrderRef: string;
  readonly clientOrderId: string;
  readonly receivedAt: TimestampMs;
  readonly outcome: 'filled' | 'partially_filled' | 'rejected';
  /** The reject reason iff outcome is 'rejected'. */
  readonly rejectReason: VenueRejectReason | null;
  /** The fill refs in execution order. */
  readonly fillRefs: readonly string[];
  /** The filled quantity (canonical decimal). */
  readonly filledQuantity: string;
  /** The original quantity (canonical decimal). */
  readonly quantity: string;
}

/** Guard: `VenueOrderRecord`. */
export function isVenueOrderRecord(value: unknown): value is VenueOrderRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.engineOrderRef !== 'string' || !record.engineOrderRef.startsWith('xso-')) return false;
  if (typeof record.clientOrderId !== 'string' || record.clientOrderId === '') return false;
  if (!isTimestampMs(record.receivedAt)) return false;
  if (record.outcome !== 'filled' && record.outcome !== 'partially_filled' && record.outcome !== 'rejected') return false;
  if (record.outcome === 'rejected' && !isVenueRejectReason(record.rejectReason)) return false;
  if (record.outcome !== 'rejected' && record.rejectReason !== null) return false;
  if (!Array.isArray(record.fillRefs) || !record.fillRefs.every((ref) => typeof ref === 'string' && ref.startsWith('xsf-'))) return false;
  if (typeof record.filledQuantity !== 'string' || record.filledQuantity === '') return false;
  if (typeof record.quantity !== 'string' || record.quantity === '') return false;
  return true;
}

// ---------------------------------------------------------------------------
// The engine state
// ---------------------------------------------------------------------------

/** One side of the visible book: levels best-first (bids descending, asks ascending). */
export type BookSide = readonly { readonly price: string; readonly size: string }[];

/** The immutable scripted-venue state for ONE (venue, instrument) model. */
export interface VenueEngineState {
  readonly model: VenueModelRef;
  /** The visible bid side (best-first, descending). */
  readonly bids: BookSide;
  /** The visible ask side (best-first, ascending). */
  readonly asks: BookSide;
  /** The next order ordinal (starts at 1; strictly increasing). */
  readonly nextOrderOrdinal: number;
  /** The next fill ordinal (starts at 1). */
  readonly nextFillOrdinal: number;
  /** Every order ever received (the venue's own record log — refused intents never appear here). */
  readonly orders: readonly VenueOrderRecord[];
  /** Every client order id ever received (idempotency is forever). */
  readonly clientOrderIds: readonly string[];
}

/** Guard: `VenueEngineState` (structural). */
export function isVenueEngineState(value: unknown): value is VenueEngineState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (typeof state.model !== 'object' || state.model === null) return false;
  for (const side of ['bids', 'asks'] as const) {
    const levels = state[side];
    if (!Array.isArray(levels)) return false;
    for (const level of levels) {
      if (typeof level !== 'object' || level === null) return false;
      const entry = level as Record<string, unknown>;
      if (typeof entry.price !== 'string' || typeof entry.size !== 'string') return false;
    }
  }
  if (typeof state.nextOrderOrdinal !== 'number' || !Number.isSafeInteger(state.nextOrderOrdinal) || state.nextOrderOrdinal < 1) return false;
  if (typeof state.nextFillOrdinal !== 'number' || !Number.isSafeInteger(state.nextFillOrdinal) || state.nextFillOrdinal < 1) return false;
  if (!Array.isArray(state.orders) || !state.orders.every((order) => isVenueOrderRecord(order))) return false;
  if (!Array.isArray(state.clientOrderIds) || !state.clientOrderIds.every((id) => typeof id === 'string')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Create a scripted venue: sort the seed book (bids descending, asks
 * ascending — levels validated against the venue grid rules: tick,
 * lot, depth, no crossing) over the venue model. Mirrors the real
 * engine's `createEngine` laws.
 */
export function createVenueEngine(
  model: VenueModelRef,
  bookSeed: { readonly bids: readonly BookLevelMirror[]; readonly asks: readonly BookLevelMirror[] },
): ExecutionPolicyResult<VenueEngineState> {
  const config = model.config;
  const errors: string[] = [];
  const validateLevels = (levels: readonly BookLevelMirror[]): { price: string; size: string }[] => {
    const validated: { price: string; size: string }[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < levels.length; index++) {
      const level = levels[index];
      if (level === undefined) continue;
      const price = decNormalize(level.price);
      const size = decNormalize(level.size);
      if (decCompare(price, '0') <= 0 || decCompare(size, '0') <= 0) {
        errors.push(`level ${index}: price and size must be strictly positive`);
        continue;
      }
      if (seen.has(price)) {
        errors.push(`level ${index}: duplicate level price "${price}" — aggregate levels before seeding`);
        continue;
      }
      seen.add(price);
      if (!isAlignedToGrid(price, config.tick_size)) {
        errors.push(`level ${index}: price "${price}" is not a multiple of the tick size ${config.tick_size}`);
      }
      if (!isAlignedToGrid(size, config.lot_size)) {
        errors.push(`level ${index}: size "${size}" is not a multiple of the lot size ${config.lot_size}`);
      }
      validated.push({ price, size });
    }
    return validated;
  };

  const bids = validateLevels(bookSeed.bids).sort((a, b) => decCompare(b.price, a.price));
  const asks = validateLevels(bookSeed.asks).sort((a, b) => decCompare(a.price, b.price));
  if (errors.length > 0) return fail('invalid_field', `the book seed violates the venue grid rules: ${errors.join('; ')}`, 'bookSeed');
  if (bids.length > config.max_book_depth || asks.length > config.max_book_depth) {
    return fail('invalid_field', `the book seed exceeds the venue's depth cap (${config.max_book_depth} levels per side)`, 'bookSeed');
  }
  if (bids.length > 0 && asks.length > 0 && decCompare(bids[0]?.price ?? '0', asks[0]?.price ?? '0') >= 0) {
    return fail('invalid_field', 'the seed book is crossed (best bid >= best ask) — a resting book may not cross itself', 'bookSeed');
  }
  return ok(
    deepFreeze({
      model,
      bids,
      asks,
      nextOrderOrdinal: 1,
      nextFillOrdinal: 1,
      orders: [],
      clientOrderIds: [],
    }),
  );
}

// ---------------------------------------------------------------------------
// The submission transition
// ---------------------------------------------------------------------------

/** One scripted venue fill (the engine-side record; the simulator wraps it into a SimulatedFill). */
export interface VenueFill {
  /** Ordinal-minted engine fill ref (`xsf-` + zero-padded ordinal). */
  readonly engineFillRef: string;
  /** The trade print price (the maker level's price). */
  readonly price: string;
  /** The aggressor's execution price after the slippage model. */
  readonly aggressorPrice: string;
  /** The executed quantity (canonical decimal). */
  readonly quantity: string;
  /** The account's (aggressor's) fee, rounded per the fee schedule. */
  readonly fee: string;
  /** The injected information latency (whole ms). */
  readonly latencyMs: number;
}

/** The product of one scripted submission. */
export interface VenueSubmitOutcome {
  readonly state: VenueEngineState;
  /** The intake outcome record (filled / partially_filled / rejected). */
  readonly order: VenueOrderRecord;
  /** The fills executed at intake, in execution order (empty iff rejected). */
  readonly fills: readonly VenueFill[];
}

/**
 * Submit one APPROVED intent's order to the scripted venue at instant
 * `at`. The order arrives as plain data (the engine is authority-free —
 * L8: the gate already approved it; the venue only applies its
 * mechanical rules). Market orders consume the book and cancel any
 * remainder; limit orders fill what crosses and cancel the remainder
 * (the declared taker-side-only limitation — see the module header).
 */
export function submitToVenue(
  state: VenueEngineState,
  order: {
    readonly clientOrderId: string;
    readonly side: 'buy' | 'sell';
    readonly kind: string;
    readonly quantity: string;
    readonly price?: string;
  },
  at: TimestampMs,
): ExecutionPolicyResult<VenueSubmitOutcome> {
  if (!isTimestampMs(at)) {
    return fail('invalid_timestamp', 'submitToVenue requires an epoch-ms arrival instant');
  }
  const config = state.model.config;

  // --- Mechanical venue rules (rejects — the mirrored discipline) ---------
  if (state.clientOrderIds.includes(order.clientOrderId)) {
    return ok(rejectedOutcome(state, order, at, 'duplicate_client_order_id'));
  }
  if (order.kind !== 'market' && order.kind !== 'limit') {
    return ok(rejectedOutcome(state, order, at, 'unsupported_order_kind'));
  }
  if (order.kind === 'limit') {
    if (order.price === undefined || !isAlignedToGrid(decNormalize(order.price), config.tick_size)) {
      return ok(rejectedOutcome(state, order, at, 'wrong_tick_size'));
    }
  }
  if (!isAlignedToGrid(decNormalize(order.quantity), config.lot_size)) {
    return ok(rejectedOutcome(state, order, at, 'wrong_lot_size'));
  }

  // --- The book walk (price-time priority over the visible book) ----------
  const limitPrice = order.kind === 'limit' && order.price !== undefined ? decNormalize(order.price) : null;
  let remaining = decNormalize(order.quantity);
  const fills: VenueFill[] = [];
  let bids = [...state.bids];
  let asks = [...state.asks];
  let nextFillOrdinal = state.nextFillOrdinal;

  while (decCompare(remaining, '0') > 0) {
    const bookSide = order.side === 'buy' ? asks : bids;
    const best = bookSide[0];
    if (best === undefined) break;
    if (limitPrice !== null) {
      const satisfies = order.side === 'buy' ? decCompare(best.price, limitPrice) <= 0 : decCompare(best.price, limitPrice) >= 0;
      if (!satisfies) break;
    }
    const fillQuantity = decCompare(remaining, best.size) <= 0 ? remaining : best.size;
    const fillOrdinal = nextFillOrdinal;
    const engineFillRef = `xsf-${String(fillOrdinal).padStart(8, '0')}`;
    const aggressorPrice = aggressorPriceMirror(config.slippage, order.side, best.price, config.tick_size);
    fills.push(
      deepFreeze({
        engineFillRef,
        price: best.price,
        aggressorPrice,
        quantity: fillQuantity,
        // The account is the TAKER in this simulator (taker-side only —
        // the declared L6 limitation): the fee prices the aggressor's
        // execution price (the exchange-sim taker-side discipline).
        fee: feeOfMirror(config.fees, aggressorPrice, fillQuantity),
        latencyMs: latencyDelayMsMirror(config.latency, config.seed, 'fill', fillOrdinal),
      }),
    );
    nextFillOrdinal += 1;
    remaining = decSubtract(remaining, fillQuantity);
    const consumed = decSubtract(best.size, fillQuantity);
    const updatedSide = isZero(consumed) ? bookSide.slice(1) : [{ price: best.price, size: consumed }, ...bookSide.slice(1)];
    if (order.side === 'buy') asks = updatedSide;
    else bids = updatedSide;
  }

  const filledQuantity = decSubtract(decNormalize(order.quantity), remaining);
  const outcome: VenueOrderRecord['outcome'] =
    isZero(remaining) ? 'filled' : isZero(filledQuantity) ? 'rejected' : 'partially_filled';
  const rejectReason = outcome === 'rejected' ? 'unfilled_remainder' : null;
  const orderRecord: VenueOrderRecord = deepFreeze({
    engineOrderRef: `xso-${String(state.nextOrderOrdinal).padStart(8, '0')}`,
    clientOrderId: order.clientOrderId,
    receivedAt: at,
    outcome,
    rejectReason,
    fillRefs: fills.map((fill) => fill.engineFillRef),
    filledQuantity,
    quantity: decNormalize(order.quantity),
  });
  return ok(
    deepFreeze({
      state: deepFreeze({
        ...state,
        bids,
        asks,
        nextOrderOrdinal: state.nextOrderOrdinal + 1,
        nextFillOrdinal,
        orders: [...state.orders, orderRecord],
        clientOrderIds: [...state.clientOrderIds, order.clientOrderId],
      }),
      order: orderRecord,
      fills,
    }),
  );
}

/** Build a rejected intake outcome (the state still records the order). */
function rejectedOutcome(
  state: VenueEngineState,
  order: { readonly clientOrderId: string; readonly quantity: string },
  at: TimestampMs,
  reason: VenueRejectReason,
): VenueSubmitOutcome {
  const orderRecord: VenueOrderRecord = deepFreeze({
    engineOrderRef: `xso-${String(state.nextOrderOrdinal).padStart(8, '0')}`,
    clientOrderId: order.clientOrderId,
    receivedAt: at,
    outcome: 'rejected',
    rejectReason: reason,
    fillRefs: [],
    filledQuantity: '0',
    quantity: decNormalize(order.quantity),
  });
  return deepFreeze({
    state: deepFreeze({
      ...state,
      nextOrderOrdinal: state.nextOrderOrdinal + 1,
      orders: [...state.orders, orderRecord],
      clientOrderIds: [...state.clientOrderIds, order.clientOrderId],
    }),
    order: orderRecord,
    fills: [],
  });
}

// ---------------------------------------------------------------------------
// The fee computation (mirror of exchange-sim's feeOf)
// ---------------------------------------------------------------------------

/** Select the fee tier a fill notional resolves to (total by the catch-all discipline). */
function selectFeeTierMirror(schedule: FeeScheduleMirror, notional: string): FeeTierMirror {
  for (const tier of schedule.tiers) {
    if (tier.up_to_notional === null) return tier;
    if (decCompare(notional, tier.up_to_notional) <= 0) return tier;
  }
  throw new Error('selectFeeTierMirror: schedule has no catch-all tier (impossible by validation)');
}

/**
 * The taker fee of one fill side — the mirror of exchange-sim's
 * `feeOf`: notional = price x quantity (exact), tier by notional, fee
 * = notional x bps / 10_000 rounded HALF-UP to the schedule's
 * `fee_decimals` (the one declared approximation).
 */
export function feeOfMirror(schedule: FeeScheduleMirror, price: string, quantity: string): string {
  const notional = decMultiply(price, quantity);
  const tier = selectFeeTierMirror(schedule, notional);
  const unrounded = decMultiply(notional, tier.taker_bps);
  return divideRoundHalfUp(unrounded, '10000', schedule.fee_decimals);
}

// ---------------------------------------------------------------------------
// The slippage application (mirror of exchange-sim's aggressorPrice)
// ---------------------------------------------------------------------------

/**
 * The aggressor's execution price for a match at `bookPrice` — the
 * mirror of exchange-sim's `aggressorPrice`: `book_walk` leaves the
 * print unchanged; `fixed_bps` degrades the price by the bps rate and
 * re-quantizes onto the tick grid adversarially (buy: ceil, sell:
 * floor) with a one-tick floor, in exact integer arithmetic.
 */
export function aggressorPriceMirror(config: SlippageConfigMirror, aggressorSide: 'buy' | 'sell', bookPrice: string, tickSize: string): string {
  if (config.kind === 'book_walk') return decNormalize(bookPrice);

  // value = price * (10_000 +/- bps) / 10_000, exact rational arithmetic
  // over BigInt fixed-point (the exchange-sim derivation, mirrored).
  const parseExact = (value: string): { digits: bigint; scale: number } => {
    const dot = value.indexOf('.');
    const intPart = dot === -1 ? value : value.slice(0, dot);
    const fracPart = dot === -1 ? '' : value.slice(dot + 1);
    return { digits: BigInt(`${intPart || '0'}${fracPart}`), scale: fracPart.length };
  };
  const formatExact = (digits: bigint, scale: number): string => {
    const text = digits.toString();
    if (scale === 0) return text;
    const padded = text.padStart(scale + 1, '0');
    const intPart = padded.slice(0, padded.length - scale);
    let fracPart = padded.slice(padded.length - scale);
    while (fracPart.length > 0 && fracPart.endsWith('0')) fracPart = fracPart.slice(0, -1);
    return fracPart.length === 0 ? intPart : `${intPart}.${fracPart}`;
  };

  const price = parseExact(bookPrice);
  const bps = parseExact(config.bps);
  const basis = 10_000n * 10n ** BigInt(bps.scale);
  const factorNumerator = aggressorSide === 'buy' ? basis + bps.digits : basis - bps.digits;
  if (factorNumerator <= 0n) return decNormalize(tickSize); // the one-tick floor
  const valueNumerator = price.digits * factorNumerator;
  const valueScale = price.scale + bps.scale + 4;
  const grid = parseExact(tickSize);
  const gridDenominator = grid.digits * 10n ** BigInt(valueScale);
  const valueAtGridScale = valueNumerator * 10n ** BigInt(grid.scale);
  const quotient = valueAtGridScale / gridDenominator;
  const remainder = valueAtGridScale % gridDenominator;
  let units = quotient;
  if (aggressorSide === 'buy' && remainder !== 0n) units = quotient + 1n; // ceil: pay at least
  const result = formatExact(units * grid.digits, grid.scale);
  if (isZero(result)) return decNormalize(tickSize);
  return result;
}

/** The reference book value at a grid point (import-free helper for tests). */
export function gridFloor(value: string, grid: string): string {
  return floorToGrid(value, grid);
}

/** The reference book value at a grid point, ceiled (import-free helper for tests). */
export function gridCeil(value: string, grid: string): string {
  return ceilToGrid(value, grid);
}

/** Sum helper used by the simulator's bookkeeping (import-free convenience). */
export function sumDecimals(values: readonly string[]): string {
  return values.reduce((total, value) => decAdd(total, value), '0');
}
