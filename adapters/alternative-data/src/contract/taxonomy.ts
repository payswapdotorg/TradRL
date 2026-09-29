/**
 * @tradrl/adapter-alternative-data — the canonical event-type taxonomy and
 * asset classes.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/taxonomy.ts (itself a
 * mirror of @tradrl/market-protocol; law D-004: never imports; the interop
 * test asserts constant parity against both real packages on this branch).
 *
 * The FULL canonical event-type set is declared (the descriptor's
 * capability validation needs it), while the typed payload map is
 * deliberately narrowed to this adapter's EMITTABLE set (social_signal,
 * macro_release, fundamental): the alternative-data vendor's documented
 * observation series translate into exactly these canonical shapes —
 * sentiment scores and on-chain metrics are alternative-platform signals,
 * economic series are scheduled releases, and satellite observations are
 * reported data; the other canonical types stay unreachable in this
 * package (total guards return typed errors for them — see payloads.ts).
 */

import type { SocialSignalPayload, MacroReleasePayload, FundamentalPayload } from './payloads';

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
 * The event types this adapter can EMIT (the alternative-data vendor's
 * documented observation set): payload validators exist for exactly
 * these; every other canonical type is refused by a typed error rather
 * than silently accepted.
 */
export type EmittableEventType = 'social_signal' | 'macro_release' | 'fundamental';

/** Runtime list of the emittable event types. */
export const EMITTABLE_EVENT_TYPES: readonly EmittableEventType[] = ['social_signal', 'macro_release', 'fundamental'];

/** Runtime guard for an emittable event type. */
export function isEmittableEventType(value: unknown): value is EmittableEventType {
  return typeof value === 'string' && (EMITTABLE_EVENT_TYPES as readonly string[]).includes(value);
}

/** Event type -> typed payload, over the emittable set. */
export interface EmittablePayloadMap {
  /** Sentiment scores and on-chain metrics (aggregated alternative-platform signals). */
  social_signal: SocialSignalPayload;
  /** Economic series observations (scheduled releases with window discipline). */
  macro_release: MacroReleasePayload;
  /** Satellite-derived series observations (reported data with window discipline). */
  fundamental: FundamentalPayload;
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
