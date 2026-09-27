// @tradrl/domain-core — Order: the canonical order-intent contract.
//
// An Order is an INTENT record: side, kind, time-in-force, quantity, prices,
// instrument + venue reference and a client order id for idempotency.
// NO execution semantics live here — lifecycle status, fills, partials and
// acks are owned by the exchange simulation (T010) and execution lanes
// (T019/T040). This record is what those lanes receive and audit.
//
// Laws honored here (spec/ARCHITECTURE-LOCK.md):
// - L13/L14 provider neutrality: venue-specific order flags stay in adapters;
//   this is the canonical shape every adapter must produce.
// - L16 strategic/execution separation: the Order is the order-level unit the
//   execution plane enforces against; strategy control never bypasses it.

import {
  DecimalString,
  OpenString,
  Timestamp,
  isNonEmptyString,
  isPositiveDecimal,
  isDecimalString,
  isRecord,
  isTimestamp,
} from './primitives';
import { InstrumentId, VenueId, isInstrumentId, isVenueId } from './ids';

export type OrderSide = 'buy' | 'sell';

export const ORDER_SIDES: readonly OrderSide[] = ['buy', 'sell'] as const;

/**
 * Core order kinds. `OrderKind` is open: adapters may register additional
 * kinds (e.g. "iceberg") with this contract's versioning process; guards
 * treat non-core kinds as unvalidated extensions and apply NO price matrix.
 */
export type CoreOrderKind = 'market' | 'limit' | 'stop' | 'stop-limit';

export const CORE_ORDER_KINDS: readonly CoreOrderKind[] = [
  'market',
  'limit',
  'stop',
  'stop-limit',
] as const;

export type OrderKind = CoreOrderKind | OpenString;

export type CoreTimeInForce = 'day' | 'gtc' | 'ioc' | 'fok' | 'gtt';

export const CORE_TIME_IN_FORCE: readonly CoreTimeInForce[] = [
  'day',
  'gtc',
  'ioc',
  'fok',
  'gtt',
] as const;

export type TimeInForce = CoreTimeInForce | OpenString;

export interface Order {
  /** Caller-assigned idempotency key. Unique within the issuing project scope. */
  readonly clientOrderId: string;
  readonly instrumentId: InstrumentId;
  readonly venueId: VenueId;
  readonly side: OrderSide;
  readonly kind: OrderKind;
  /** Order quantity in instrument units. Strictly positive. */
  readonly quantity: DecimalString;
  /** Limit price. Strictly positive. Required for "limit" and "stop-limit". */
  readonly price?: DecimalString;
  /** Trigger price. Strictly positive. Required for "stop" and "stop-limit". */
  readonly stopPrice?: DecimalString;
  readonly timeInForce: TimeInForce;
  /** Expiry instant. Required for "gtt"; rejected for other core time-in-force values. */
  readonly expiresAt?: Timestamp;
  readonly createdAt: Timestamp;
  /** Free-form annotation for humans/audit; never interpreted. */
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isOrderSide(v: unknown): v is OrderSide {
  return isNonEmptyString(v) && (ORDER_SIDES as readonly string[]).includes(v);
}

export function isCoreOrderKind(v: unknown): v is CoreOrderKind {
  return isNonEmptyString(v) && (CORE_ORDER_KINDS as readonly string[]).includes(v);
}

/** Open vocabulary: any non-empty string (registration discipline documented in contracts/domain/order.md). */
export function isOrderKind(v: unknown): v is OrderKind {
  return isNonEmptyString(v);
}

export function isCoreTimeInForce(v: unknown): v is CoreTimeInForce {
  return isNonEmptyString(v) && (CORE_TIME_IN_FORCE as readonly string[]).includes(v);
}

/** Open vocabulary: any non-empty string. */
export function isTimeInForce(v: unknown): v is TimeInForce {
  return isNonEmptyString(v);
}

/**
 * Field-presence matrix for core order kinds:
 *   market     -> no price, no stopPrice
 *   limit      -> price required, no stopPrice
 *   stop       -> stopPrice required, no price
 *   stop-limit -> price and stopPrice required
 * Non-core (registered extension) kinds: price/stopPrice optional, matrix N/A.
 */
function validateCoreKindPriceMatrix(order: Record<string, unknown>): boolean {
  const hasPrice = order.price !== undefined;
  const hasStop = order.stopPrice !== undefined;
  switch (order.kind) {
    case 'market':
      return !hasPrice && !hasStop;
    case 'limit':
      return hasPrice && !hasStop;
    case 'stop':
      return hasStop && !hasPrice;
    case 'stop-limit':
      return hasPrice && hasStop;
    default:
      return true;
  }
}

function validateCoreTimeInForceExpiry(order: Record<string, unknown>): boolean {
  const hasExpiry = order.expiresAt !== undefined;
  switch (order.timeInForce) {
    case 'gtt':
      return hasExpiry;
    case 'day':
    case 'gtc':
    case 'ioc':
    case 'fok':
      return !hasExpiry;
    default:
      return true; // registered extension kinds may use expiry freely
  }
}

export function isOrder(v: unknown): v is Order {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.clientOrderId)) return false;
  if (!isInstrumentId(v.instrumentId)) return false;
  if (!isVenueId(v.venueId)) return false;
  if (!isOrderSide(v.side)) return false;
  if (!isOrderKind(v.kind)) return false;
  if (!isDecimalString(v.quantity) || !isPositiveDecimal(v.quantity)) return false;
  if (v.price !== undefined && (!isDecimalString(v.price) || !isPositiveDecimal(v.price))) return false;
  if (v.stopPrice !== undefined && (!isDecimalString(v.stopPrice) || !isPositiveDecimal(v.stopPrice))) {
    return false;
  }
  if (!isTimeInForce(v.timeInForce)) return false;
  if (v.expiresAt !== undefined && !isTimestamp(v.expiresAt)) return false;
  if (!isTimestamp(v.createdAt)) return false;
  if (v.notes !== undefined && !isNonEmptyString(v.notes)) return false;
  if (isCoreOrderKind(v.kind) && !validateCoreKindPriceMatrix(v)) return false;
  if (isCoreTimeInForce(v.timeInForce) && !validateCoreTimeInForceExpiry(v)) return false;
  return true;
}
