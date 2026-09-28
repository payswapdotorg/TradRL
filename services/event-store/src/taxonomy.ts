/**
 * @tradrl/event-store — the canonical taxonomy mirror.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's `event-types.ts` and the
 * `ASSET_CLASSES` list from its `fields.ts` (law D-004: never imports). The
 * event store validates that committed events carry a canonical
 * `event_type` and `asset_class`; the enum VALUES and the per-type payload
 * SEMANTICS remain owned by market-protocol (the store enforces the
 * envelope floor — quartet, ids, taxonomy membership, sequence,
 * provenance — and treats payloads as opaque records except for the
 * `other:kind` scoping rule the sequence discipline requires).
 *
 * `packages/provenance/src/interop.test.ts` asserts list parity with
 * market-protocol: if the taxonomy grows, this mirror (and the store's
 * validation) must grow with it — the trip wire fails otherwise.
 */

/** The canonical event-type discriminant set. Mirror of market-protocol's EVENT_TYPES. */
export const EVENT_TYPES: readonly string[] = [
  'trade',
  'quote',
  'book_snapshot',
  'book_delta',
  'ohlcv',
  'news',
  'macro_release',
  'social_signal',
  'fundamental',
  'option_chain_mark',
  'other',
];

/** The canonical event type (opaque union member — mirror of market-protocol's EventType). */
export type EventType = (typeof EVENT_TYPES)[number];

/** Runtime guard for a canonical event type. */
export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && EVENT_TYPES.includes(value);
}

/** Canonical asset classes. Mirror of market-protocol's ASSET_CLASSES. */
export const ASSET_CLASSES: readonly string[] = [
  'crypto',
  'equity',
  'index',
  'future',
  'option',
  'forex',
  'commodity',
  'macro',
  'other',
];

/** The canonical asset class. Mirror of market-protocol's AssetClass. */
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Runtime guard for a canonical asset class. */
export function isAssetClass(value: unknown): value is AssetClass {
  return typeof value === 'string' && ASSET_CLASSES.includes(value);
}
