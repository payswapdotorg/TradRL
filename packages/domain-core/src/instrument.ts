// @tradrl/domain-core — Instrument: tradable instrument contract.
// Provider-neutral: symbol conventions here are canonical; vendor symbology
// translation belongs to adapters (L13/L14).

import {
  AssetClass,
  DecimalString,
  Timestamp,
  hasNoDuplicates,
  isAssetClass,
  isDecimalString,
  isNonEmptyString,
  isPositiveDecimal,
  isRecord,
  isTimestamp,
} from './primitives';
import { InstrumentId, VenueId, isInstrumentId, isVenueId } from './ids';

export interface Instrument {
  readonly id: InstrumentId;
  /** Canonical TradRL symbol (e.g. "BTC-USDT", "AAPL"). Vendor symbols stay in adapters. */
  readonly symbol: string;
  readonly name?: string;
  readonly assetClass: AssetClass;
  /** Venues where the instrument trades. Non-empty, no duplicates. */
  readonly venueIds: readonly VenueId[];
  /** Minimum price increment. Strictly positive when present. */
  readonly tickSize?: DecimalString;
  /** Minimum quantity increment (lot step). Strictly positive when present. */
  readonly lotSize?: DecimalString;
  /** Units per contract (derivatives). Strictly positive when present. */
  readonly contractSize?: DecimalString;
  /** Base asset symbol for pair instruments (fx/crypto). */
  readonly baseAsset?: string;
  /** Quote (counter) asset symbol for pair instruments. */
  readonly quoteAsset?: string;
  /** Expiry for derivative instruments. */
  readonly expiresAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isInstrument(v: unknown): v is Instrument {
  if (!isRecord(v)) return false;
  if (!isInstrumentId(v.id)) return false;
  if (!isNonEmptyString(v.symbol)) return false;
  if (v.name !== undefined && !isNonEmptyString(v.name)) return false;
  if (!isAssetClass(v.assetClass)) return false;
  if (!Array.isArray(v.venueIds) || v.venueIds.length === 0) return false;
  if (!v.venueIds.every((x) => isVenueId(x))) return false;
  if (!hasNoDuplicates(v.venueIds)) return false;
  if (v.tickSize !== undefined && (!isDecimalString(v.tickSize) || !isPositiveDecimal(v.tickSize))) {
    return false;
  }
  if (v.lotSize !== undefined && (!isDecimalString(v.lotSize) || !isPositiveDecimal(v.lotSize))) {
    return false;
  }
  if (
    v.contractSize !== undefined &&
    (!isDecimalString(v.contractSize) || !isPositiveDecimal(v.contractSize))
  ) {
    return false;
  }
  if (v.baseAsset !== undefined && !isNonEmptyString(v.baseAsset)) return false;
  if (v.quoteAsset !== undefined && !isNonEmptyString(v.quoteAsset)) return false;
  if (v.expiresAt !== undefined && !isTimestamp(v.expiresAt)) return false;
  return true;
}
