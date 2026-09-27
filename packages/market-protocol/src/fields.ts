/**
 * @tradrl/market-protocol — identifiers, asset classes and shared field guards.
 *
 * Identifiers are deliberately PLAIN (unbranded) non-empty strings:
 * provider-neutral contracts interoperate with every adapter, and the
 * cross-lane rule references trading/agent domain entities by opaque string
 * ids only. Semantic aliases document intent without imposing brands.
 */

import type { MarketProtocolError } from './errors';

/** Opaque event identifier (unique within the event store). */
export type EventId = string;
/** Opaque venue identifier (e.g. 'BINANCE', 'XNAS'). */
export type VenueId = string;
/** Opaque instrument identifier, venue-canonical (e.g. 'BTC-USDT', 'AAPL'). */
export type InstrumentId = string;
/** Opaque data provider identifier (e.g. 'binance', 'snp-licensed'). */
export type ProviderId = string;
/** Opaque identifier of a derived artifact or another event (lineage). */
export type LineageId = string;

/** Canonical asset classes. */
export const ASSET_CLASSES = [
  'crypto',
  'equity',
  'index',
  'future',
  'option',
  'forex',
  'commodity',
  'macro',
  'other',
] as const;

export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Runtime guard for a canonical asset class. */
export function isAssetClass(value: unknown): value is AssetClass {
  return typeof value === 'string' && (ASSET_CLASSES as readonly string[]).includes(value);
}

/** True iff the value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True iff the value is a non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** True iff the value is a non-negative safe integer (sequence numbers). */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

// ---------------------------------------------------------------------------
// Field-level error constructors shared by envelope and payload validators.
// ---------------------------------------------------------------------------

/** A required field is absent. */
export function missingField(path: string): MarketProtocolError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid. */
export function invalidField(path: string, message: string): MarketProtocolError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object. */
export function invalidType(message: string): MarketProtocolError {
  return { code: 'invalid_type', path: '', message };
}
