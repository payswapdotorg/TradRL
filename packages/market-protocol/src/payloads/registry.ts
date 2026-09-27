/**
 * @tradrl/market-protocol — the payload registry, keyed by event type.
 *
 * One validator per taxonomy entry. The registry's type is a mapped type
 * over `EventPayloadMap`, so the compiler enforces exhaustiveness: a new
 * event type without a registered validator fails typecheck. This is the
 * seam the adapter SDK (T036) and ingestion (T008) validate payloads through
 * — no `unknown` ever crosses the API surface.
 */

import type { MarketProtocolError } from '../errors';
import type { EventPayloadMap, EventType, PayloadOf } from '../event-types';
import { validateTradePayload, isTradePayload, type TradePayload } from './trade';
import { validateQuotePayload, isQuotePayload, type QuotePayload } from './quote';
import {
  validateBookSnapshotPayload,
  isBookSnapshotPayload,
  validateBookDeltaPayload,
  isBookDeltaPayload,
  type BookSnapshotPayload,
  type BookDeltaPayload,
} from './book';
import { validateOhlcvPayload, isOhlcvPayload, type OhlcvPayload } from './ohlcv';
import { validateNewsPayload, isNewsPayload, type NewsPayload } from './news';
import {
  validateMacroReleasePayload,
  isMacroReleasePayload,
  type MacroReleasePayload,
} from './macro-release';
import { validateSocialSignalPayload, isSocialSignalPayload, type SocialSignalPayload } from './social-signal';
import { validateFundamentalPayload, isFundamentalPayload, type FundamentalPayload } from './fundamental';
import {
  validateOptionChainMarkPayload,
  isOptionChainMarkPayload,
  type OptionChainMarkPayload,
} from './option-chain-mark';
import { validateOtherPayload, isOtherPayload, type OtherPayload } from './other';

/** What a registered payload validator provides. */
export interface PayloadValidator<P> {
  /** Collect every violation (paths relative to the payload root). */
  validate(value: unknown): readonly MarketProtocolError[];
  /** Throwing-free narrowing guard. */
  is(value: unknown): value is P;
}

/** The registry: every event type maps to its typed payload validator. */
export const payloadRegistry: {
  readonly [E in EventType]: PayloadValidator<PayloadOf<E>>;
} = {
  trade: { validate: validateTradePayload, is: isTradePayload },
  quote: { validate: validateQuotePayload, is: isQuotePayload },
  book_snapshot: { validate: validateBookSnapshotPayload, is: isBookSnapshotPayload },
  book_delta: { validate: validateBookDeltaPayload, is: isBookDeltaPayload },
  ohlcv: { validate: validateOhlcvPayload, is: isOhlcvPayload },
  news: { validate: validateNewsPayload, is: isNewsPayload },
  macro_release: { validate: validateMacroReleasePayload, is: isMacroReleasePayload },
  social_signal: { validate: validateSocialSignalPayload, is: isSocialSignalPayload },
  fundamental: { validate: validateFundamentalPayload, is: isFundamentalPayload },
  option_chain_mark: { validate: validateOptionChainMarkPayload, is: isOptionChainMarkPayload },
  other: { validate: validateOtherPayload, is: isOtherPayload },
};

/** Type-level witness that the registry covers the taxonomy (never instantiated). */
export type RegistryCoversTaxonomy = {
  readonly [E in EventType]: PayloadValidator<EventPayloadMap[E]>;
};

/** Re-export payload types for the public API. */
export type {
  TradePayload,
  QuotePayload,
  BookSnapshotPayload,
  BookDeltaPayload,
  OhlcvPayload,
  NewsPayload,
  MacroReleasePayload,
  SocialSignalPayload,
  FundamentalPayload,
  OptionChainMarkPayload,
  OtherPayload,
};

/** Re-export payload validators and guards for the public API. */
export {
  validateTradePayload,
  isTradePayload,
  validateQuotePayload,
  isQuotePayload,
  validateBookSnapshotPayload,
  isBookSnapshotPayload,
  validateBookDeltaPayload,
  isBookDeltaPayload,
  validateOhlcvPayload,
  isOhlcvPayload,
  validateNewsPayload,
  isNewsPayload,
  validateMacroReleasePayload,
  isMacroReleasePayload,
  validateSocialSignalPayload,
  isSocialSignalPayload,
  validateFundamentalPayload,
  isFundamentalPayload,
  validateOptionChainMarkPayload,
  isOptionChainMarkPayload,
  validateOtherPayload,
  isOtherPayload,
};

/** Re-export payload auxiliary types for the public API. */
export type { BookLevel, BookDeltaAction } from './book';
export type { OptionGreeks, OptionRight } from './option-chain-mark';
export type { TradeSide } from './trade';
