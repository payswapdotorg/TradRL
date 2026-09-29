/**
 * @tradrl/adapter-oms-ems — the canonical event-type taxonomy and asset classes.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/taxonomy.ts (itself a
 * mirror of @tradrl/market-protocol; law D-004: never imports; the interop
 * test asserts constant parity against both real packages on this branch).
 *
 * The FULL canonical event-type set is declared (the descriptor's
 * capability validation needs it), while the typed payload map is
 * deliberately narrowed to this adapter's EMITTABLE set (`other`): the
 * OMS/EMS gateway's order-state records enter the pipeline through the
 * typed `other` escape hatch — the canonical taxonomy has no order-state
 * member, and inventing one here would violate provider neutrality in the
 * OTHER direction (the escape hatch exists exactly for typed sub-kinds;
 * this adapter names its kind "order_state"); every other canonical
 * type stays unreachable in this package (total guards return typed
 * errors for them — see payloads.ts).
 */

import type { OtherPayload } from './payloads';

/** The full canonical event-type set. Mirror of the market-protocol taxonomy. */
export type EventType =
  | 'trade'
  | 'quote'
  | 'book_snapshot'
  | 'book_delta'
  | 'ohlcv'
  | 'news'
  | 'macro_release'
  | 'social_signal'
  | 'fundamental'
  | 'option_chain_mark'
  | 'other';

/** Runtime list of canonical event types, for guards and diagnostics. */
export const EVENT_TYPES: readonly EventType[] = [
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

/** Runtime guard for a canonical event type. */
export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * The event types this adapter can EMIT (the OMS/EMS gateway's order-state
 * stream): payload validators exist for exactly these; every other
 * canonical type is refused by a typed error rather than silently accepted.
 */
export type EmittableEventType = 'other';

/** Runtime list of the emittable event types. */
export const EMITTABLE_EVENT_TYPES: readonly EmittableEventType[] = ['other'];

/** Runtime guard for an emittable event type. */
export function isEmittableEventType(value: unknown): value is EmittableEventType {
  return typeof value === 'string' && (EMITTABLE_EVENT_TYPES as readonly string[]).includes(value);
}

/** Event type -> typed payload, over the emittable set. */
export interface EmittablePayloadMap {
  /** Escape hatch — the OMS/EMS gateway's order-state records name their kind. */
  other: OtherPayload;
}

/** The typed payload for a given emittable event type. */
export type PayloadOf<E extends EmittableEventType> = EmittablePayloadMap[E];

/** Canonical asset classes. Mirror of the market-protocol set. */
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

/** The canonical asset-class set. */
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Runtime guard for a canonical asset class. */
export function isAssetClass(value: unknown): value is AssetClass {
  return typeof value === 'string' && (ASSET_CLASSES as readonly string[]).includes(value);
}
