/**
 * @tradrl/market-protocol — the canonical event-type taxonomy.
 *
 * `EventPayloadMap` is the single source of truth binding each event type to
 * its typed payload. `EventType` is its key set, and `MarketEvent` is the
 * discriminated union derived from it — adding a taxonomy entry without a
 * payload, validator or registry entry is a COMPILE ERROR, not a runtime
 * surprise.
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

/** Event type -> typed payload. The taxonomy. */
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
