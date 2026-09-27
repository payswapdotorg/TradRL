// @tradrl/domain-core — Venue: trading venue identity and capabilities.

import {
  AssetClass,
  hasNoDuplicates,
  isAssetClass,
  isNonEmptyString,
  isRecord,
} from './primitives';
import { VenueId, isVenueId } from './ids';
import { OrderKind, TimeInForce, isOrderKind, isTimeInForce } from './order';

/** Order-entry capabilities a venue advertises. Neutral: venue-specific flags stay in adapters. */
export interface VenueCapabilities {
  /** Core or registered-extension order kinds accepted. Non-empty. */
  readonly orderKinds: readonly OrderKind[];
  /** Time-in-force values honored. Non-empty. */
  readonly timeInForce: readonly TimeInForce[];
  readonly supportsShort?: boolean;
  readonly supportsMargin?: boolean;
}

export interface Venue {
  readonly id: VenueId;
  readonly name: string;
  readonly description?: string;
  /** Asset classes tradable on this venue. Non-empty, no duplicates. */
  readonly assetClasses: readonly AssetClass[];
  readonly capabilities: VenueCapabilities;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isVenueCapabilities(v: unknown): v is VenueCapabilities {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.orderKinds) || v.orderKinds.length === 0) return false;
  if (!v.orderKinds.every((x) => isOrderKind(x))) return false;
  if (!hasNoDuplicates(v.orderKinds)) return false;
  if (!Array.isArray(v.timeInForce) || v.timeInForce.length === 0) return false;
  if (!v.timeInForce.every((x) => isTimeInForce(x))) return false;
  if (!hasNoDuplicates(v.timeInForce)) return false;
  if (v.supportsShort !== undefined && typeof v.supportsShort !== 'boolean') return false;
  if (v.supportsMargin !== undefined && typeof v.supportsMargin !== 'boolean') return false;
  return true;
}

export function isVenue(v: unknown): v is Venue {
  if (!isRecord(v)) return false;
  if (!isVenueId(v.id)) return false;
  if (!isNonEmptyString(v.name)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  if (!Array.isArray(v.assetClasses) || v.assetClasses.length === 0) return false;
  if (!v.assetClasses.every((x) => isAssetClass(x))) return false;
  if (!hasNoDuplicates(v.assetClasses)) return false;
  if (!isVenueCapabilities(v.capabilities)) return false;
  return true;
}
