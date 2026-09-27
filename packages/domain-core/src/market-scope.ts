// @tradrl/domain-core — market and data scope selectors.
// Shared by Goal (allowed markets/data) and Project (materialized universe).
// The universe must be EXPLICIT: a market scope with no venues, instruments
// or asset classes is invalid (never "everything by default").

import {
  AssetClass,
  DataCategory,
  isAssetClass,
  isDataCategory,
  isNonEmptyString,
  isRecord,
} from './primitives';
import { InstrumentId, VenueId, isInstrumentId, isVenueId } from './ids';

/** Explicit universe of venues/instruments/asset classes. At least one selector must be non-empty. */
export interface MarketScope {
  readonly venues: readonly VenueId[];
  readonly instruments: readonly InstrumentId[];
  readonly assetClasses: readonly AssetClass[];
}

/** Categories and feeds of external data in scope. Empty categories = no external data requested. */
export interface DataScope {
  readonly categories: readonly DataCategory[];
  /** Opaque feed identifiers; format owned by the data-ingestion lane (T008). */
  readonly feeds?: readonly string[];
}

export function isMarketScope(v: unknown): v is MarketScope {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.venues) || !v.venues.every((x) => isVenueId(x))) return false;
  if (!Array.isArray(v.instruments) || !v.instruments.every((x) => isInstrumentId(x))) return false;
  if (!Array.isArray(v.assetClasses) || !v.assetClasses.every((x) => isAssetClass(x))) return false;
  return v.venues.length > 0 || v.instruments.length > 0 || v.assetClasses.length > 0;
}

export function isDataScope(v: unknown): v is DataScope {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.categories) || !v.categories.every((x) => isDataCategory(x))) return false;
  if (v.feeds !== undefined) {
    if (!Array.isArray(v.feeds)) return false;
    if (!v.feeds.every((x) => isNonEmptyString(x))) return false;
  }
  return true;
}
