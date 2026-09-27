// @tradrl/domain-core — Position: point-in-time position snapshot (data only).
//
// A Position is a recorded state snapshot: signed quantity, average entry
// price and the realized/unrealized PnL split AS DATA. This lane performs NO
// PnL computation — producers (strategy/evaluation lanes) record the values.

import {
  DecimalString,
  Timestamp,
  isDecimalString,
  isNonNegativeDecimal,
  isRecord,
  isTimestamp,
} from './primitives';
import { InstrumentId, VenueId, isInstrumentId, isVenueId } from './ids';

export interface Position {
  readonly instrumentId: InstrumentId;
  /** Venue when the position is venue-scoped; absent = aggregated across venues. */
  readonly venueId?: VenueId;
  /** Signed quantity: positive = long, negative = short, "0" = flat. */
  readonly quantity: DecimalString;
  /** Volume-weighted average entry price of the current quantity. Non-negative. */
  readonly averageEntryPrice: DecimalString;
  /** Realized PnL closed out so far. Absent = not yet available. */
  readonly realizedPnl?: DecimalString;
  /** Unrealized (mark-to-market) PnL at asOf. Absent = not yet available. */
  readonly unrealizedPnl?: DecimalString;
  readonly openedAt?: Timestamp;
  /** Point-in-time snapshot instant. Required (L4). */
  readonly asOf: Timestamp;
}

export function isPosition(v: unknown): v is Position {
  if (!isRecord(v)) return false;
  if (!isInstrumentId(v.instrumentId)) return false;
  if (v.venueId !== undefined && !isVenueId(v.venueId)) return false;
  if (!isDecimalString(v.quantity)) return false;
  if (!isDecimalString(v.averageEntryPrice) || !isNonNegativeDecimal(v.averageEntryPrice)) {
    return false;
  }
  if (v.realizedPnl !== undefined && !isDecimalString(v.realizedPnl)) return false;
  if (v.unrealizedPnl !== undefined && !isDecimalString(v.unrealizedPnl)) return false;
  if (v.openedAt !== undefined && !isTimestamp(v.openedAt)) return false;
  if (!isTimestamp(v.asOf)) return false;
  return true;
}
