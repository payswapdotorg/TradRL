/**
 * @tradrl/provider-sdk — the canonical event-type taxonomy and asset classes.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's event-type taxonomy and
 * asset-class set (law D-004: never imports; the interop test asserts
 * constant parity and payload-validator verdict parity against the real
 * market-protocol). The SDK emits INTO exactly these canonical shapes —
 * adapters translate vendor shapes into them; vendor specifics never leak
 * past this boundary (L13).
 */

import type { TradePayload } from './payloads/trade';
import type { QuotePayload } from './payloads/quote';
import type { BookSnapshotPayload, BookDeltaPayload } from './payloads/book';
import type { OhlcvPayload } from './payloads/ohlcv';
import type { NewsPayload } from './payloads/news';
import type { MacroReleasePayload } from './payloads/macro-release';
import type { SocialSignalPayload } from './payloads/social-signal';
import type { FundamentalPayload } from './payloads/fundamental';
import type { OptionChainMarkPayload } from './payloads/option-chain-mark';
import type { OtherPayload } from './payloads/other';

/** Event type -> typed payload. Mirror of the canonical taxonomy. */
export interface EventPayloadMap {
  /** Executed trade print. */
  trade: TradePayload;
  /** Top-of-book quotation. */
  quote: QuotePayload;
  /** Full order-book state (replaces prior state). */
  book_snapshot: BookSnapshotPayload;
  /** Incremental order-book change. */
  book_delta: BookDeltaPayload;
  /** Candlestick/bar over a fixed interval. */
  ohlcv: OhlcvPayload;
  /** News item. */
  news: NewsPayload;
  /** Scheduled macroeconomic release. */
  macro_release: MacroReleasePayload;
  /** Social/alternative platform signal. */
  social_signal: SocialSignalPayload;
  /** Reported fundamental datum. */
  fundamental: FundamentalPayload;
  /** Derivative/option chain mark. */
  option_chain_mark: OptionChainMarkPayload;
  /** Escape hatch — REQUIRES a free-form `kind` in its payload. */
  other: OtherPayload;
}

/** The canonical event-type discriminant set. */
export type EventType = keyof EventPayloadMap;

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

/** The typed payload for a given event type. */
export type PayloadOf<E extends EventType> = EventPayloadMap[E];

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
