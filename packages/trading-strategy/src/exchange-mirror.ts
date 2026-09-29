// @tradrl/trading-strategy — the order-intent mirror, account fills and
// corporate actions.
//
// STRUCTURAL MIRROR of @tradrl/exchange-sim's `OrderIntent` (T010 — itself
// the mirror of @tradrl/domain-core's canonical `Order`, T002) —
// re-declared by STRUCTURE, never imported (D-003/D-004): field-for-field
// identical (same names, same brands, same optionality, same
// field-presence matrix, same expiry discipline), so a
// {@link OrderIntentMirror} IS an exchange-sim `OrderIntent` (mutually
// assignable, zero casts; proven by src/interop.test.ts against the REAL
// package on this branch). Any change in the order contract MUST be
// mirrored here and vice versa.
//
// THE ONE SEMANTIC DIFFERENCE, AND IT IS THE L8 POINT OF THIS LANE
// (spec/ARCHITECTURE-LOCK.md L8: "models cannot bypass hard
// risk/authorization gates"; spec/ARCHITECTURE.md Execution: "Consequential
// actions require hard controls outside prompts"): an {@link OrderIntentMirror}
// here is the TRADABLE REQUEST a strategy emits — never authority. The
// strategy lane owns NO venue permission, credential, rate limit, kill
// switch or execution policy; execution (T019), risk (T020) and the
// gateway (T034/T040) own what happens next. A strategy record embedding
// execution authority anywhere is a typed `authority_in_strategy` error
// (see authority.ts — the trip-wire scan).
//
// THE ACCOUNT FILL is the execution report from the STRATEGY ACCOUNT'S
// perspective: which instrument, which side WE traded, at what price, for
// what quantity, paying what fee, at which instant. It is the transition
// input of the pure portfolio transition (portfolio.ts). A real
// exchange-sim `Fill` carries everything an account fill needs — the
// trip wire in src/interop.test.ts maps a REAL fill (with our order as
// the taker) onto an account fill and proves the mapping total.
//
// Spec anchors: spec/ARCHITECTURE.md (core flow "Strategy/Portfolio/Risk
// -> Execution"; "Execution: identity, authorization, limits, venue
// permissions, rate limits, kill switch, credentials and audit" — all
// OUTSIDE this lane), spec/ARCHITECTURE-LOCK.md L8, L16 (strategic and
// order-level control have distinct clocks and authority), L20.

import { isNonEmptyString, isRecord, isTimestampMs, isoFromEpochMs, type TimestampMs } from './primitives';
import { type InstrumentId, type VenueId, isInstrumentId, isVenueId } from './ids';
import { compare as compareDecimal, isCanonicalDecimal, isCanonicalPositiveDecimal } from './decimals';

// ---------------------------------------------------------------------------
// The order vocabulary (mirror of exchange-sim's domain-mirror.ts)
// ---------------------------------------------------------------------------

export type OrderSide = 'buy' | 'sell';

export const ORDER_SIDES: readonly OrderSide[] = ['buy', 'sell'] as const;

export type CoreOrderKind = 'market' | 'limit' | 'stop' | 'stop-limit';

export const CORE_ORDER_KINDS: readonly CoreOrderKind[] = ['market', 'limit', 'stop', 'stop-limit'] as const;

/** Open vocabulary (registration discipline): a non-empty string. */
export type OrderKind = CoreOrderKind | (string & Record<never, never>);

export type CoreTimeInForce = 'day' | 'gtc' | 'ioc' | 'fok' | 'gtt';

export const CORE_TIME_IN_FORCE: readonly CoreTimeInForce[] = ['day', 'gtc', 'ioc', 'fok', 'gtt'] as const;

/** Open vocabulary: a non-empty string. */
export type TimeInForce = CoreTimeInForce | (string & Record<never, never>);

/**
 * Exact decimal encoded as a canonical string. Mirror of domain-core's /
 * exchange-sim's `DecimalString`: no leading zeros, no "-0", no trailing
 * ".", at least one fractional digit when a dot is present.
 */
export type DecimalString = string & { readonly __brand: 'DecimalString' };

/**
 * Instant encoded as RFC 3339 / ISO-8601 with a MANDATORY explicit UTC
 * offset. Mirror of domain-core's / exchange-sim's `Timestamp`.
 */
export type Timestamp = string & { readonly __brand: 'Timestamp' };

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Guard: RFC 3339 timestamp with explicit offset and a real calendar date/time. Mirror. */
export function isTimestamp(v: unknown): v is Timestamp {
  if (typeof v !== 'string' || !TIMESTAMP_PATTERN.test(v)) return false;
  return Number.isFinite(Date.parse(v));
}

/** Guard: canonical decimal string. Mirror. */
export function isDecimalString(v: unknown): v is DecimalString {
  return isCanonicalDecimal(v);
}

/** Precondition: a valid DecimalString. True when its value is > 0. Mirror of exchange-sim's `isPositiveDecimal`. */
export function isPositiveDecimalString(a: DecimalString): boolean {
  return compareDecimal(a, '0') > 0;
}

/** The canonical ISO form of an explicit epoch-ms instant (pure — no clock read). */
export function isoTimestampOf(value: TimestampMs): Timestamp {
  return isoFromEpochMs(value) as Timestamp;
}

// ---------------------------------------------------------------------------
// The order intent (field-for-field mirror of exchange-sim's OrderIntent)
// ---------------------------------------------------------------------------

/**
 * The tradable request — structurally identical to exchange-sim's
 * `OrderIntent` (same field names, same brands, same optionality, same
 * field-presence matrix for core kinds, same expiry discipline for core
 * time-in-force values). See the module header for the mirror discipline
 * and the L8 semantic difference.
 */
export interface OrderIntentMirror {
  /** Caller-assigned idempotency key. Unique within the issuing project scope. */
  readonly clientOrderId: string;
  readonly instrumentId: InstrumentId;
  readonly venueId: VenueId;
  readonly side: OrderSide;
  readonly kind: OrderKind;
  /** Order quantity in instrument units. Strictly positive canonical decimal. */
  readonly quantity: DecimalString;
  /** Limit price. Strictly positive. Required for "limit" and "stop-limit". */
  readonly price?: DecimalString;
  /** Trigger price. Strictly positive. Required for "stop" and "stop-limit". */
  readonly stopPrice?: DecimalString;
  readonly timeInForce: TimeInForce;
  /** Expiry instant. Required for "gtt"; rejected for other core TIF values. */
  readonly expiresAt?: Timestamp;
  readonly createdAt: Timestamp;
  /** Free-form annotation for humans/audit; never interpreted. */
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// Guards (mirror of exchange-sim's domain-mirror.ts, law for law)
// ---------------------------------------------------------------------------

export function isOrderSide(v: unknown): v is OrderSide {
  return isNonEmptyString(v) && (ORDER_SIDES as readonly string[]).includes(v);
}

export function isCoreOrderKind(v: unknown): v is CoreOrderKind {
  return isNonEmptyString(v) && (CORE_ORDER_KINDS as readonly string[]).includes(v);
}

/** Open vocabulary: a non-empty string (registration discipline). */
export function isOrderKind(v: unknown): v is OrderKind {
  return isNonEmptyString(v);
}

export function isCoreTimeInForce(v: unknown): v is CoreTimeInForce {
  return isNonEmptyString(v) && (CORE_TIME_IN_FORCE as readonly string[]).includes(v);
}

/** Open vocabulary: a non-empty string. */
export function isTimeInForce(v: unknown): v is TimeInForce {
  return isNonEmptyString(v);
}

/**
 * Field-presence matrix for core order kinds (mirror of exchange-sim /
 * domain-core):
 *   market     -> no price, no stopPrice
 *   limit      -> price required, no stopPrice
 *   stop       -> stopPrice required, no price
 *   stop-limit -> price and stopPrice required
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

/** Runtime guard for a structurally valid order intent (mirror of exchange-sim's `isOrderIntent`). */
export function isOrderIntentMirror(v: unknown): v is OrderIntentMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.clientOrderId)) return false;
  if (!isInstrumentId(v.instrumentId)) return false;
  if (!isVenueId(v.venueId)) return false;
  if (!isOrderSide(v.side)) return false;
  if (!isOrderKind(v.kind)) return false;
  if (!isDecimalString(v.quantity) || !isPositiveDecimalString(v.quantity as DecimalString)) return false;
  if (v.price !== undefined && (!isDecimalString(v.price) || !isPositiveDecimalString(v.price as DecimalString))) {
    return false;
  }
  if (v.stopPrice !== undefined && (!isDecimalString(v.stopPrice) || !isPositiveDecimalString(v.stopPrice as DecimalString))) {
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

// ---------------------------------------------------------------------------
// The account fill (the transition input — see module header)
// ---------------------------------------------------------------------------

/** The account's side of a fill. */
export type AccountSide = 'buy' | 'sell';

export const ACCOUNT_SIDES: readonly AccountSide[] = ['buy', 'sell'] as const;

/**
 * One execution report from the strategy account's perspective: the pure
 * transition input. `price` is the account's execution price (for a
 * taker buy under a slippage model, the aggressor price; for a maker
 * fill, the resting level), `fee` the fee the account paid. All decimal
 * strings are canonical; `event_time` is the report's engine instant.
 */
export interface AccountFill {
  /** Execution report identity (the venue's fill id). */
  readonly fill_id: string;
  readonly instrument: InstrumentId;
  readonly venue: VenueId;
  /** The ACCOUNT's side: 'buy' = position/cost basis increases, 'sell' = decreases. */
  readonly side: AccountSide;
  /** Execution price per unit, canonical positive decimal. */
  readonly price: string;
  /** Executed quantity, canonical positive decimal. */
  readonly quantity: string;
  /** Fee paid by the account, canonical non-negative decimal. */
  readonly fee: string;
  /** The report's instant (epoch ms). */
  readonly event_time: TimestampMs;
}

/** Guard: `AccountFill`. */
export function isAccountFill(v: unknown): v is AccountFill {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.fill_id)) return false;
  if (!isInstrumentId(v.instrument)) return false;
  if (!isVenueId(v.venue)) return false;
  if (v.side !== 'buy' && v.side !== 'sell') return false;
  if (!isCanonicalPositiveDecimal(v.price)) return false;
  if (!isCanonicalPositiveDecimal(v.quantity)) return false;
  if (!isCanonicalDecimal(v.fee) || v.fee === '') return false;
  if (!isTimestampMs(v.event_time)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Corporate actions (the other transition input)
// ---------------------------------------------------------------------------

/** The closed corporate-action vocabulary of this Work Order. */
export type CorporateActionKind = 'cash_dividend' | 'split';

export const CORPORATE_ACTION_KINDS: readonly CorporateActionKind[] = ['cash_dividend', 'split'] as const;

/**
 * One corporate-action record. Deterministic exact-decimal effects:
 *   - `cash_dividend`: cash += quantity * cashPerUnit (exact product);
 *   - `split`: quantity *= splitRatio (exact product — the ratio is a
 *     decimal MULTIPLIER, e.g. "2" for a 2:1 split, "0.5" for 1:2).
 * `ex_time` is the instant the action takes effect on the position.
 */
export interface CorporateAction {
  readonly action_id: string;
  readonly instrument: InstrumentId;
  readonly kind: CorporateActionKind;
  /** Cash per held unit. REQUIRED for `cash_dividend`; absent otherwise. */
  readonly cashPerUnit?: string;
  /** Split multiplier (decimal). REQUIRED for `split`; absent otherwise. */
  readonly splitRatio?: string;
  /** The effective instant (epoch ms). */
  readonly ex_time: TimestampMs;
}

/** Guard: `CorporateAction` (field-presence matrix per kind included). */
export function isCorporateAction(v: unknown): v is CorporateAction {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.action_id)) return false;
  if (!isInstrumentId(v.instrument)) return false;
  if (v.kind !== 'cash_dividend' && v.kind !== 'split') return false;
  if (v.cashPerUnit !== undefined && !isCanonicalPositiveDecimal(v.cashPerUnit)) return false;
  if (v.splitRatio !== undefined && !isCanonicalPositiveDecimal(v.splitRatio)) return false;
  if (v.kind === 'cash_dividend' && v.cashPerUnit === undefined) return false;
  if (v.kind === 'split' && v.splitRatio === undefined) return false;
  if (v.kind === 'cash_dividend' && v.splitRatio !== undefined) return false;
  if (v.kind === 'split' && v.cashPerUnit !== undefined) return false;
  if (!isTimestampMs(v.ex_time)) return false;
  return true;
}
