/**
 * @tradrl/exchange-sim — the order-intent contract: STRUCTURAL MIRROR of
 * @tradrl/domain-core's `Order` (T002, the canonical order-intent record).
 *
 * D-003/D-004 MIRROR DISCIPLINE: contract packages never import each other.
 * Everything domain-core declares that the exchange consumes — sides, core
 * kinds, core time-in-force values, the Order record itself, the canonical
 * decimal-string and ISO-timestamp primitives — is re-declared here with
 * identical structure, brands and guards, so a domain-core `Order` IS an
 * {@link OrderIntent} (mutually assignable, zero casts; proven in
 * src/domain-mirror.test.ts against the REAL package, which is present on
 * this branch). Any change in domain-core's order contract MUST be mirrored
 * here and vice versa.
 *
 * SEMANTIC DIFFERENCE (the one, and it is the L6/L8 point of this lane):
 * domain-core's Order is "what the execution plane receives and audits";
 * HERE it is the REQUEST an authority-free venue simulator fills per its
 * own mechanical rules. The exchange never models who issued the intent
 * (no owner field exists on the domain contract — the actor is the
 * environment action envelope's `actor`, T005) and never gates it (risk,
 * permission, kill-switch concepts are T019/T020/T034 territory).
 *
 * L6 DECLARED LIMITATIONS carried by the engine (engine.ts header repeats
 * them; tests assert the declarations exist):
 *   - stop and stop-limit intents are structurally valid but REJECTED by
 *     the engine ('unsupported_order_kind') — trigger-on-print is not
 *     modeled in this Work Order;
 *   - registered extension kinds/TIFs (domain-core's open vocabulary) are
 *     rejected ('unsupported_order_kind' / 'unsupported_time_in_force');
 *   - the engine consumes `expiresAt` by parsing the ISO instant to epoch
 *     milliseconds (`gtt` expiry); `createdAt` is audit-only.
 */

import { deepFreeze, isNonEmptyString, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type ExchangeError, type ExchangeResult } from './errors';
import type { InstrumentId, VenueId } from './ids';
import { isInstrumentId, isVenueId } from './ids';
import { isCanonicalDecimal } from './decimals';
import { compare as compareDecimal } from './decimals';

// ---------------------------------------------------------------------------
// Primitive mirrors (domain-core primitives.ts — the exact same laws)
// ---------------------------------------------------------------------------

/**
 * Exact decimal encoded as a canonical string. Mirror of domain-core's
 * `DecimalString`: optional leading "-", integer part without leading zeros
 * ("0" allowed), optional fractional part with at least one digit, no
 * trailing ".", no "-0".
 */
export type DecimalString = string & { readonly __brand: 'DecimalString' };

/**
 * Instant in time encoded as an RFC 3339 / ISO-8601 string with a MANDATORY
 * explicit UTC offset ("Z" or "+HH:MM"). Mirror of domain-core's `Timestamp`.
 */
export type Timestamp = string & { readonly __brand: 'Timestamp' };

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Guard: RFC 3339 timestamp with explicit offset and a real calendar date/time. Mirror of domain-core. */
export function isTimestamp(v: unknown): v is Timestamp {
  if (typeof v !== 'string' || !TIMESTAMP_PATTERN.test(v)) return false;
  return Number.isFinite(Date.parse(v));
}

/** Guard: canonical decimal string. Mirror of domain-core's `isDecimalString`. */
export function isDecimalString(v: unknown): v is DecimalString {
  return isCanonicalDecimal(v);
}

/** Precondition: a valid DecimalString. True when its value is > 0. Mirror of domain-core's `isPositiveDecimal`. */
export function isPositiveDecimal(a: DecimalString): boolean {
  return compareDecimal(a, '0') > 0;
}

/**
 * Parse a valid ISO timestamp to its exact epoch-millisecond instant.
 * Precondition: `isTimestamp` passed (the engine validates first).
 */
export function isoToEpochMs(value: Timestamp): number {
  return Date.parse(value);
}

// ---------------------------------------------------------------------------
// The order vocabulary (mirror of domain-core order.ts)
// ---------------------------------------------------------------------------

export type OrderSide = 'buy' | 'sell';

export const ORDER_SIDES: readonly OrderSide[] = ['buy', 'sell'] as const;

/**
 * Core order kinds. `OrderKind` is open (domain-core's registration
 * discipline): the ENGINE accepts `market` and `limit` only; `stop` /
 * `stop-limit` and registered extensions are REJECTED with a typed reason
 * (declared limitation, L6 — see module header).
 */
export type CoreOrderKind = 'market' | 'limit' | 'stop' | 'stop-limit';

export const CORE_ORDER_KINDS: readonly CoreOrderKind[] = ['market', 'limit', 'stop', 'stop-limit'] as const;

export type OrderKind = CoreOrderKind | (string & Record<never, never>);

export type CoreTimeInForce = 'day' | 'gtc' | 'ioc' | 'fok' | 'gtt';

export const CORE_TIME_IN_FORCE: readonly CoreTimeInForce[] = ['day', 'gtc', 'ioc', 'fok', 'gtt'] as const;

export type TimeInForce = CoreTimeInForce | (string & Record<never, never>);

/**
 * The order intent — structurally identical to domain-core's `Order`
 * (same field names, same brands, same optionality). See module header for
 * the mirror discipline and the semantic difference.
 */
export interface OrderIntent {
  /** Caller-assigned idempotency key. Unique within the issuing project scope; the engine enforces uniqueness forever. */
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
  /** Expiry instant. Required for "gtt"; rejected for other core time-in-force values. Honored by the engine for resting orders. */
  readonly expiresAt?: Timestamp;
  readonly createdAt: Timestamp;
  /** Free-form annotation for humans/audit; never interpreted. */
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// Guards (mirror of domain-core order.ts, law for law)
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
 * Field-presence matrix for core order kinds (mirror of domain-core):
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

/** Runtime guard for a structurally valid order intent (mirror of domain-core's `isOrder`). */
export function isOrderIntent(v: unknown): v is OrderIntent {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.clientOrderId)) return false;
  if (!isInstrumentId(v.instrumentId)) return false;
  if (!isVenueId(v.venueId)) return false;
  if (!isOrderSide(v.side)) return false;
  if (!isOrderKind(v.kind)) return false;
  if (!isDecimalString(v.quantity) || !isPositiveDecimal(v.quantity as DecimalString)) return false;
  if (v.price !== undefined && (!isDecimalString(v.price) || !isPositiveDecimal(v.price as DecimalString))) return false;
  if (v.stopPrice !== undefined && (!isDecimalString(v.stopPrice) || !isPositiveDecimal(v.stopPrice as DecimalString))) {
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

/**
 * Collect-all validation of an untrusted order intent — mirrors
 * domain-core's `isOrder` laws field-for-field and additionally binds the
 * intent to the engine's configured venue/instrument (a simulator fills
 * only its own book: mismatches fail with typed errors before any state
 * transition). On success the value is returned narrowed, deeply frozen.
 */
export function validateOrderIntent(
  value: unknown,
  expected: { readonly venue: VenueId; readonly instrument: InstrumentId },
  path = 'intent',
): ExchangeResult<OrderIntent> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExchangeError[] = [];

  if (value.clientOrderId === undefined) {
    errors.push(missingField(`${path}.clientOrderId`));
  } else if (!isNonEmptyString(value.clientOrderId)) {
    errors.push(invalidField(`${path}.clientOrderId`, 'must be a non-empty string'));
  }

  if (value.instrumentId === undefined) {
    errors.push(missingField(`${path}.instrumentId`));
  } else if (!isInstrumentId(value.instrumentId)) {
    errors.push(invalidField(`${path}.instrumentId`, 'must be a non-empty string'));
  }

  if (value.venueId === undefined) {
    errors.push(missingField(`${path}.venueId`));
  } else if (!isVenueId(value.venueId)) {
    errors.push(invalidField(`${path}.venueId`, 'must be a non-empty string'));
  }

  if (value.side === undefined) {
    errors.push(missingField(`${path}.side`));
  } else if (!isOrderSide(value.side)) {
    errors.push(invalidField(`${path}.side`, `must be one of ${ORDER_SIDES.join(' | ')}`));
  }

  if (value.kind === undefined) {
    errors.push(missingField(`${path}.kind`));
  } else if (!isOrderKind(value.kind)) {
    errors.push(invalidField(`${path}.kind`, 'must be a non-empty string'));
  }

  if (value.quantity === undefined) {
    errors.push(missingField(`${path}.quantity`));
  } else if (!isDecimalString(value.quantity) || !isPositiveDecimal(value.quantity as DecimalString)) {
    errors.push(invalidField(`${path}.quantity`, 'must be a canonical decimal string greater than zero'));
  }

  if (value.price !== undefined && (!isDecimalString(value.price) || !isPositiveDecimal(value.price as DecimalString))) {
    errors.push(invalidField(`${path}.price`, 'when present must be a canonical decimal string greater than zero'));
  }

  if (value.stopPrice !== undefined && (!isDecimalString(value.stopPrice) || !isPositiveDecimal(value.stopPrice as DecimalString))) {
    errors.push(invalidField(`${path}.stopPrice`, 'when present must be a canonical decimal string greater than zero'));
  }

  if (value.timeInForce === undefined) {
    errors.push(missingField(`${path}.timeInForce`));
  } else if (!isTimeInForce(value.timeInForce)) {
    errors.push(invalidField(`${path}.timeInForce`, 'must be a non-empty string'));
  }

  if (value.expiresAt !== undefined && !isTimestamp(value.expiresAt)) {
    errors.push(invalidField(`${path}.expiresAt`, 'when present must be an RFC 3339 timestamp with explicit UTC offset'));
  }

  if (value.createdAt === undefined) {
    errors.push(missingField(`${path}.createdAt`));
  } else if (!isTimestamp(value.createdAt)) {
    errors.push(invalidField(`${path}.createdAt`, 'must be an RFC 3339 timestamp with explicit UTC offset'));
  }

  if (value.notes !== undefined && !isNonEmptyString(value.notes)) {
    errors.push(invalidField(`${path}.notes`, 'when present must be a non-empty string'));
  }

  // The domain-core field-presence matrices.
  if (errors.length === 0 && isCoreOrderKind(value.kind) && !validateCoreKindPriceMatrix(value)) {
    errors.push(
      invalidField(
        `${path}.kind`,
        `core kind "${String(value.kind)}" violates the price/stopPrice presence matrix (market: none; limit: price; stop: stopPrice; stop-limit: both)`,
      ),
    );
  }
  if (errors.length === 0 && isCoreTimeInForce(value.timeInForce) && !validateCoreTimeInForceExpiry(value)) {
    errors.push(
      invalidField(
        `${path}.timeInForce`,
        `core time-in-force "${String(value.timeInForce)}" violates the expiry presence matrix (gtt requires expiresAt; day/gtc/ioc/fok forbid it)`,
      ),
    );
  }

  // Engine binding: the simulator fills only its own (venue, instrument) book.
  if (errors.length === 0 && isVenueId(value.venueId) && value.venueId !== expected.venue) {
    errors.push(
      invalidField(`${path}.venueId`, `intent names venue "${value.venueId}" but this exchange simulates "${expected.venue}"`),
    );
  }
  if (errors.length === 0 && isInstrumentId(value.instrumentId) && value.instrumentId !== expected.instrument) {
    errors.push(
      invalidField(
        `${path}.instrumentId`,
        `intent names instrument "${value.instrumentId}" but this exchange simulates "${expected.instrument}"`,
      ),
    );
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      clientOrderId: value.clientOrderId as string,
      instrumentId: value.instrumentId as InstrumentId,
      venueId: value.venueId as VenueId,
      side: value.side as OrderSide,
      kind: value.kind as OrderKind,
      quantity: value.quantity as DecimalString,
      ...(value.price !== undefined ? { price: value.price as DecimalString } : {}),
      ...(value.stopPrice !== undefined ? { stopPrice: value.stopPrice as DecimalString } : {}),
      timeInForce: value.timeInForce as TimeInForce,
      ...(value.expiresAt !== undefined ? { expiresAt: value.expiresAt as Timestamp } : {}),
      createdAt: value.createdAt as Timestamp,
      ...(value.notes !== undefined ? { notes: value.notes as string } : {}),
    }),
  );
}
