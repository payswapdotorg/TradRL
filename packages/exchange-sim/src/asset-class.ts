/**
 * @tradrl/exchange-sim — the asset-class taxonomy mirror.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's `ASSET_CLASSES` (the
 * envelope taxonomy; domain-core carries the same vocabulary). The
 * exchange config declares its instrument's asset class so the service's
 * event outputs satisfy the canonical MarketEvent envelope without casts
 * (proven in the service tests against the REAL market-protocol package,
 * which is present on this branch). Any change in market-protocol's
 * taxonomy MUST be mirrored here and vice versa.
 */

/** Canonical asset classes. Mirror of market-protocol's ASSET_CLASSES. */
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

/** Canonical asset class type. Mirror of market-protocol's AssetClass. */
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Runtime guard for a canonical asset class (mirror of market-protocol's isAssetClass). */
export function isAssetClassOfMarket(value: unknown): value is AssetClass {
  return typeof value === 'string' && (ASSET_CLASSES as readonly string[]).includes(value);
}
