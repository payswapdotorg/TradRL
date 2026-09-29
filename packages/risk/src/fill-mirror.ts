// @tradrl/risk — the exchange-lane structural mirrors: the FILL (the
// exposure inputs' execution evidence).
//
// STRUCTURAL MIRROR of @tradrl/exchange-sim (T010, records.ts) —
// re-declared by STRUCTURE, never imported (D-003/D-004): the `Fill`
// (one execution report / trade) with its honest availability quartet —
// field-for-field identical (same names, same brands, same optionality),
// so a REAL exchange-sim `Fill` IS a {@link FillMirror} (mutually
// assignable, zero casts; proven by src/interop.test.ts against the REAL
// package on this branch). Any change in the exchange-sim contracts MUST
// be mirrored here and vice versa.
//
// WHY THIS MIRROR EXISTS (the Work Order's scope: "drive
// ExposureComputation over scripted portfolio + market states + fill
// sequences (exchange-sim fill mirrors)"): fills are the EXPOSURE
// INPUTS — the executed quantity/side/price/fee facts that move a
// portfolio from one measured state to the next. The risk engine never
// matches orders (T010 owns venue physics) and never gates them (T019
// owns the gate); it MEASURES the consequence of the fills that
// occurred.
//
// THE ACCOUNT-SIDE INTERPRETATION (declared, mirroring T019's simulator
// limitation): the scripted venue this lane consumes is TAKER-SIDE ONLY
// ("taker-side only — the declared L6 limitation", execution-sim's
// simulator), so the account's own fills arrive with the account as the
// AGGRESSOR: a fill's `aggressor_side` IS the account's side. The maker-
// side refinement lands with the venue-lane work that produces resting
// fills.
//
// L4 (point-in-time truth): the quartet's `available_time` is carried
// unchanged — the exposure lineage records it, and a downstream replay
// may enforce the information boundary (a fill is never observable
// before its available_time).
//
// L8 (authority-free): there is no risk, permission, credential or
// kill-switch concept anywhere in a fill — the exchange fills orders
// per its rules; gating happens outside (T019/T020).
//
// Spec anchors: spec/ARCHITECTURE.md (Market World; Execution), spec/
// ARCHITECTURE-LOCK.md L4, L6, L8, L9.

import { isNonEmptyString, isNonNegativeSafeInteger, isRecord, isTimestampMs, type TimestampMs } from './primitives';
import { isUnsignedDecimal } from './decimals';
import type { ExchangeOrderId, FillId, InstrumentId, VenueId } from './ids';
import { isInstrumentId, isVenueId } from './ids';

// ---------------------------------------------------------------------------
// The availability quartet (carried by every emitted exchange record)
// ---------------------------------------------------------------------------

/**
 * The honest availability quartet every emitted exchange record carries
 * (mirror of exchange-sim's `AvailabilityQuartet`): `event_time` — when
 * it happened; `source_time` — ALWAYS null (the simulator IS the
 * source); `available_time` — event_time + the latency model's delay,
 * THE information-boundary input; `ingestion_time` — event_time.
 */
export interface AvailabilityQuartetMirror {
  readonly event_time: TimestampMs;
  readonly source_time: null;
  readonly available_time: TimestampMs;
  readonly ingestion_time: TimestampMs;
}

/** Guard: a structurally valid quartet (source_time must be null; available >= event). Mirror. */
export function isAvailabilityQuartetMirror(value: unknown): value is AvailabilityQuartetMirror {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.event_time) || !isTimestampMs(value.available_time) || !isTimestampMs(value.ingestion_time)) {
    return false;
  }
  if (value.source_time !== null) return false;
  if (value.available_time < value.event_time) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The fill (one execution report / trade)
// ---------------------------------------------------------------------------

/**
 * One fill: the execution report of one match. Mirror of exchange-sim's
 * `Fill`: the trade print price, the aggressor's post-slippage price,
 * the executed quantity, the per-side fees, the injected latency, the
 * engine's global fill ordinal and the per-order identities. See the
 * module header for the account-side interpretation of
 * `aggressor_side`.
 */
export interface FillMirror {
  readonly fill_id: FillId;
  /** The trade id (identical to fill_id — the market-protocol trade payload's `trade_id`). */
  readonly trade_id: string;
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  /** The availability quartet (see module header). */
  readonly quartet: AvailabilityQuartetMirror;
  /** The engine's global fill ordinal (strictly increasing in emission order). */
  readonly sequence: number;
  /** The arriving (aggressor) order. */
  readonly taker_order_id: ExchangeOrderId;
  /** The resting order that was consumed. */
  readonly maker_order_id: ExchangeOrderId;
  /** The aggressor's side ('buy' | 'sell') — the ACCOUNT's side under this lane's declared interpretation. */
  readonly aggressor_side: 'buy' | 'sell';
  /** The trade print price (the maker's level price). */
  readonly price: string;
  /** The aggressor's execution price after slippage. */
  readonly aggressor_price: string;
  /** The executed quantity (unsigned decimal, strictly positive). */
  readonly quantity: string;
  /** The taker's fee amount (non-negative decimal, rounded per the fee schedule). */
  readonly taker_fee: string;
  /** The maker's fee amount (non-negative decimal, rounded per the fee schedule). */
  readonly maker_fee: string;
  /** The latency delay (whole ms) injected between event_time and available_time — explicit, never hidden. */
  readonly latency_ms: number;
}

/** Guard: a structurally valid fill (mirror of exchange-sim's `isFill` law for law). */
export function isFillMirror(value: unknown): value is FillMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.fill_id)) return false;
  if (!isNonEmptyString(value.trade_id)) return false;
  if (!isVenueId(value.venue) || !isInstrumentId(value.instrument)) return false;
  if (!isAvailabilityQuartetMirror(value.quartet)) return false;
  if (!isNonNegativeSafeInteger(value.sequence) || value.sequence < 1) return false;
  if (!isNonEmptyString(value.taker_order_id) || !isNonEmptyString(value.maker_order_id)) return false;
  if (value.aggressor_side !== 'buy' && value.aggressor_side !== 'sell') return false;
  if (!isNonEmptyString(value.price) || !isUnsignedDecimal(value.price)) return false;
  if (!isNonEmptyString(value.aggressor_price) || !isUnsignedDecimal(value.aggressor_price)) return false;
  if (!isNonEmptyString(value.quantity) || !isUnsignedDecimal(value.quantity)) return false;
  if (!isNonEmptyString(value.taker_fee) || !isUnsignedDecimal(value.taker_fee)) return false;
  if (!isNonEmptyString(value.maker_fee) || !isUnsignedDecimal(value.maker_fee)) return false;
  if (!isNonNegativeSafeInteger(value.latency_ms)) return false;
  return true;
}

/** Guard: an array of structurally valid fills (the exposure input's shape). */
export function isFillMirrorArray(value: unknown): value is readonly FillMirror[] {
  return Array.isArray(value) && value.every((fill) => isFillMirror(fill));
}
