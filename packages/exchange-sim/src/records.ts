/**
 * @tradrl/exchange-sim — the exchange's output records and the per-order
 * audit trail.
 *
 * L4 (point-in-time truth): every record the simulator EMITS carries an
 * HONEST availability quartet, exactly like a canonical MarketEvent:
 *   - `event_time`     — the engine instant the outcome happened at.
 *   - `source_time`    — ALWAYS `null`: the simulator IS the source and
 *                        has no independent source clock (declared, never
 *                        fabricated).
 *   - `available_time` — event_time + the latency model's deterministic
 *                        delay for that outcome: the earliest a consumer
 *                        may legitimately observe it. THE information-
 *                        boundary input; a fill is NEVER visible before it.
 *   - `ingestion_time` — event_time (the engine "receives" its own output
 *                        at emission).
 *
 * L8 (authority-free): there is no risk, permission, credential or
 * kill-switch concept anywhere in these records. An {@link OrderReject}
 * is a MECHANICAL venue outcome (tick, lot, depth, duplicate id,
 * unsupported kind) — the exchange fills orders per its rules; gating
 * happens outside (T019/T020/T034).
 *
 * L9 (lineage): every record is JSON-serializable, deeply frozen, and
 * deterministic given (config, seed, order stream, book seed).
 */

import { deepFreeze, isNonEmptyString, isNonNegativeSafeInteger, isRecord } from './primitives';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { ExchangeOrderId, FillId, InstrumentId, VenueId } from './ids';
import { isExchangeOrderId, isFillId, isInstrumentId, isVenueId } from './ids';
import type { OrderIntent } from './domain-mirror';
import { isOrderIntent } from './domain-mirror';

// ---------------------------------------------------------------------------
// The availability quartet (carried by every emitted record)
// ---------------------------------------------------------------------------

/**
 * The honest availability quartet every emitted exchange record carries.
 * See the module header for the L4 semantics of each field.
 */
export interface AvailabilityQuartet {
  readonly event_time: TimestampMs;
  readonly source_time: null;
  readonly available_time: TimestampMs;
  readonly ingestion_time: TimestampMs;
}

/** Runtime guard for a structurally valid quartet (source_time must be null; available >= event). */
export function isAvailabilityQuartet(value: unknown): value is AvailabilityQuartet {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.event_time) || !isTimestampMs(value.available_time) || !isTimestampMs(value.ingestion_time)) {
    return false;
  }
  if (value.source_time !== null) return false;
  if (value.available_time < value.event_time) return false;
  return true;
}

/** Assemble the quartet of an outcome emitted at `eventTime` with `delayMs` of latency. */
export function quartetOf(eventTime: TimestampMs, delayMs: number): AvailabilityQuartet {
  return deepFreeze({
    event_time: eventTime,
    source_time: null,
    available_time: (eventTime + delayMs) as TimestampMs,
    ingestion_time: eventTime,
  });
}

// ---------------------------------------------------------------------------
// Order lifecycle taxonomy
// ---------------------------------------------------------------------------

/** The lifecycle status of an order known to the engine. */
export type OrderStatus = 'rejected' | 'open' | 'partially_filled' | 'filled' | 'canceled' | 'expired';

/** Runtime-checkable list of order statuses. */
export const ORDER_STATUSES: readonly OrderStatus[] = [
  'rejected',
  'open',
  'partially_filled',
  'filled',
  'canceled',
  'expired',
] as const;

/** Runtime guard for an order status. */
export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

/** True iff the status is terminal (no further transitions exist). */
export function isTerminalStatus(status: OrderStatus): boolean {
  return status === 'rejected' || status === 'filled' || status === 'canceled' || status === 'expired';
}

/**
 * The typed reason an order was REJECTED at intake (a mechanical venue
 * rule — see the module header's L8 note). These ride the output stream
 * as {@link OrderReject} records, never as silent drops.
 */
export type RejectReason =
  /** The client order id was already used — idempotency is forever. */
  | 'duplicate_client_order_id'
  /** The limit price is not a multiple of the venue tick size. */
  | 'wrong_tick_size'
  /** The quantity is not a multiple of the venue lot size. */
  | 'wrong_lot_size'
  /** The resting price would fall beyond the venue's book-depth cap. */
  | 'beyond_book_depth'
  /** The kind is structurally valid but not implemented by this engine (stop/stop-limit/registered extensions — declared L6). */
  | 'unsupported_order_kind'
  /** The time-in-force is structurally valid but not implemented (registered extensions; market+gtt). */
  | 'unsupported_time_in_force'
  /** A gtt intent arrived at or after its own expiry instant. */
  | 'gtt_expired_on_arrival';

/** Runtime-checkable list of reject reasons. */
export const REJECT_REASONS: readonly RejectReason[] = [
  'duplicate_client_order_id',
  'wrong_tick_size',
  'wrong_lot_size',
  'beyond_book_depth',
  'unsupported_order_kind',
  'unsupported_time_in_force',
  'gtt_expired_on_arrival',
] as const;

/** Runtime guard for a reject reason. */
export function isRejectReason(value: unknown): value is RejectReason {
  return typeof value === 'string' && (REJECT_REASONS as readonly string[]).includes(value);
}

/**
 * The typed reason an order's REMAINder left the book without being
 * filled (or without a fill at all).
 */
export type CancelReason =
  /** An explicit cancel request matched a live order. */
  | 'cancel_requested'
  /** IOC remainder: fill what the book offers immediately, cancel the rest. */
  | 'ioc_unfilled'
  /** FOK: the full quantity was not available within the limit constraint; nothing filled. */
  | 'fok_unfilled'
  /** A market order's remainder after consuming the whole book. */
  | 'market_order_unfilled_remainder'
  /** A gtt order reached its expiry instant. */
  | 'expired';

/** Runtime-checkable list of cancel reasons. */
export const CANCEL_REASONS: readonly CancelReason[] = [
  'cancel_requested',
  'ioc_unfilled',
  'fok_unfilled',
  'market_order_unfilled_remainder',
  'expired',
] as const;

/** Runtime guard for a cancel reason. */
export function isCancelReason(value: unknown): value is CancelReason {
  return typeof value === 'string' && (CANCEL_REASONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The fill (one execution report / trade)
// ---------------------------------------------------------------------------

/**
 * One fill: the execution report of one match. The trade print is
 * `price` (the resting maker's level price — also the engine's
 * `last_trade_price`); `aggressor_price` is what the taker actually
 * pays/receives after the slippage model (equal to `price` under
 * book_walk). Fees are per side (taker on the aggressor, maker on the
 * resting order), computed by the fee model at fill time.
 */
export interface Fill {
  readonly fill_id: FillId;
  /** The trade id (identical to fill_id — the market-protocol trade payload's `trade_id`). */
  readonly trade_id: string;
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  /** The availability quartet (see module header). */
  readonly quartet: AvailabilityQuartet;
  /** The engine's global fill ordinal (strictly increasing in emission order). */
  readonly sequence: number;
  /** The arriving (aggressor) order. */
  readonly taker_order_id: ExchangeOrderId;
  /** The resting order that was consumed. */
  readonly maker_order_id: ExchangeOrderId;
  /** The aggressor's side ('buy' | 'sell') — the market-protocol trade taxonomy. */
  readonly aggressor_side: 'buy' | 'sell';
  /** The trade print price (the maker's level price; the price both parties' fills are audited against). */
  readonly price: string;
  /** The aggressor's execution price after slippage (equals `price` under book_walk). */
  readonly aggressor_price: string;
  /** The executed quantity (canonical decimal, strictly positive). */
  readonly quantity: string;
  /** The taker's fee amount (non-negative decimal, rounded per the fee schedule). */
  readonly taker_fee: string;
  /** The maker's fee amount (non-negative decimal, rounded per the fee schedule). */
  readonly maker_fee: string;
  /** The latency delay (whole ms) injected between event_time and available_time — explicit, never hidden. */
  readonly latency_ms: number;
}

/** Runtime guard for a structurally valid fill. */
export function isFill(value: unknown): value is Fill {
  if (!isRecord(value)) return false;
  if (!isFillId(value.fill_id)) return false;
  if (!isNonEmptyString(value.trade_id)) return false;
  if (!isVenueId(value.venue) || !isInstrumentId(value.instrument)) return false;
  if (!isAvailabilityQuartet(value.quartet)) return false;
  if (!isNonNegativeSafeInteger(value.sequence)) return false;
  if (!isExchangeOrderId(value.taker_order_id) || !isExchangeOrderId(value.maker_order_id)) return false;
  if (value.aggressor_side !== 'buy' && value.aggressor_side !== 'sell') return false;
  if (!isNonEmptyString(value.price) || !isNonEmptyString(value.aggressor_price) || !isNonEmptyString(value.quantity)) {
    return false;
  }
  if (!isNonEmptyString(value.taker_fee) || !isNonEmptyString(value.maker_fee)) return false;
  if (!isNonNegativeSafeInteger(value.latency_ms)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Acks and rejects (order-intake outcomes)
// ---------------------------------------------------------------------------

/** The venue's acknowledgment of an order that entered its workflow (possibly already fully executed). */
export interface OrderAck {
  readonly order_id: ExchangeOrderId;
  readonly client_order_id: string;
  readonly quartet: AvailabilityQuartet;
  /** The order's status immediately after intake processing. */
  readonly status: OrderStatus;
  /** The quantity filled at intake (0 if none). */
  readonly filled_quantity: string;
}

/** The venue's rejection of an order intent (a mechanical rule — see the module header's L8 note). */
export interface OrderReject {
  readonly order_id: ExchangeOrderId;
  readonly client_order_id: string;
  readonly quartet: AvailabilityQuartet;
  readonly reason: RejectReason;
  /** Human-readable detail carrying the offending values (deterministic). */
  readonly detail: string;
}

/** Runtime guard for a structurally valid order ack. */
export function isOrderAck(value: unknown): value is OrderAck {
  if (!isRecord(value)) return false;
  if (!isExchangeOrderId(value.order_id)) return false;
  if (!isNonEmptyString(value.client_order_id)) return false;
  if (!isAvailabilityQuartet(value.quartet)) return false;
  if (!isOrderStatus(value.status)) return false;
  if (!isNonEmptyString(value.filled_quantity)) return false;
  return true;
}

/** Runtime guard for a structurally valid order reject. */
export function isOrderReject(value: unknown): value is OrderReject {
  if (!isRecord(value)) return false;
  if (!isExchangeOrderId(value.order_id)) return false;
  if (!isNonEmptyString(value.client_order_id)) return false;
  if (!isAvailabilityQuartet(value.quartet)) return false;
  if (!isRejectReason(value.reason)) return false;
  if (!isNonEmptyString(value.detail)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Cancel / expiration records
// ---------------------------------------------------------------------------

/** The record of an order's remainder leaving the book without a fill (cancel or expiry). */
export interface OrderCancelRecord {
  readonly order_id: ExchangeOrderId;
  readonly client_order_id: string;
  readonly quartet: AvailabilityQuartet;
  readonly reason: CancelReason;
  /** The quantity that left the book unfilled. */
  readonly remaining_quantity: string;
}

/** Runtime guard for a structurally valid cancel record. */
export function isOrderCancelRecord(value: unknown): value is OrderCancelRecord {
  if (!isRecord(value)) return false;
  if (!isExchangeOrderId(value.order_id)) return false;
  if (!isNonEmptyString(value.client_order_id)) return false;
  if (!isAvailabilityQuartet(value.quartet)) return false;
  if (!isCancelReason(value.reason)) return false;
  if (!isNonEmptyString(value.remaining_quantity)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The per-order audit trail
// ---------------------------------------------------------------------------

/** One event in an order's audit trail. */
export interface OrderAuditEvent {
  /** The engine instant the event occurred at. */
  readonly at: TimestampMs;
  /** What happened (mirrors the lifecycle vocabulary). */
  readonly kind: 'received' | 'acked' | 'rejected' | 'fill' | 'canceled' | 'expired';
  /** The fill this event refers to (fill events only). */
  readonly fill_id?: FillId;
}

/** Runtime guard for an audit event. */
export function isOrderAuditEvent(value: unknown): value is OrderAuditEvent {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.at)) return false;
  if (value.kind !== 'received' && value.kind !== 'acked' && value.kind !== 'rejected' && value.kind !== 'fill' && value.kind !== 'canceled' && value.kind !== 'expired') {
    return false;
  }
  if (value.fill_id !== undefined && !isFillId(value.fill_id)) return false;
  return true;
}

/**
 * The per-order record: the FULL audit trail of one order intent — the
 * validated intent, its venue-assigned id, arrival data, lifecycle
 * status, accumulated fills and the ordered event log. Immutable; every
 * transition appends (L3).
 */
export interface OrderRecord {
  readonly order_id: ExchangeOrderId;
  readonly client_order_id: string;
  readonly intent: OrderIntent;
  /** The engine instant the intent arrived at. */
  readonly received_at: TimestampMs;
  /** The arrival ordinal — the deterministic tie-break of price-time priority. */
  readonly arrival_ordinal: number;
  readonly status: OrderStatus;
  /** The reject reason iff status is 'rejected'. */
  readonly reject_reason: RejectReason | null;
  /** The cancel/expiry reason iff the remainder left the book unfilled. */
  readonly cancel_reason: CancelReason | null;
  /** Original quantity (canonical decimal). */
  readonly quantity: string;
  /** Accumulated filled quantity (canonical decimal; '0' while unfilled). */
  readonly filled_quantity: string;
  /** Live unfilled quantity (canonical decimal; '0' once terminal). */
  readonly remaining_quantity: string;
  /** The ids of this order's fills, in execution order. */
  readonly fill_ids: readonly FillId[];
  /** The gtt expiry instant in epoch ms (null unless gtt). */
  readonly expires_at_ms: number | null;
  /** The ordered audit trail. */
  readonly events: readonly OrderAuditEvent[];
}

/** Runtime guard for a structurally valid order record. */
export function isOrderRecord(value: unknown): value is OrderRecord {
  if (!isRecord(value)) return false;
  if (!isExchangeOrderId(value.order_id)) return false;
  if (!isNonEmptyString(value.client_order_id)) return false;
  if (!isOrderIntent(value.intent)) return false;
  if (!isTimestampMs(value.received_at)) return false;
  if (!isNonNegativeSafeInteger(value.arrival_ordinal) || value.arrival_ordinal < 1) return false;
  if (!isOrderStatus(value.status)) return false;
  if (value.status === 'rejected' && !isRejectReason(value.reject_reason)) return false;
  if (value.status !== 'rejected' && value.reject_reason !== null) return false;
  if (!isNonEmptyString(value.quantity) || !isNonEmptyString(value.filled_quantity) || !isNonEmptyString(value.remaining_quantity)) {
    return false;
  }
  if (!Array.isArray(value.fill_ids) || !value.fill_ids.every((id) => isFillId(id))) return false;
  if (value.expires_at_ms !== null && !isTimestampMs(value.expires_at_ms)) return false;
  if (!Array.isArray(value.events) || !value.events.every((event) => isOrderAuditEvent(event))) return false;
  return true;
}

/** The `total`-quantity invariant label (helper for consumers). */
export function describeOrder(record: OrderRecord): string {
  const filled = `${record.filled_quantity}/${record.quantity}`;
  return `${record.order_id} ${record.status} (${filled})`;
}
