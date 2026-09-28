/**
 * @tradrl/provider-sdk — the payload registry, keyed by event type.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's payload registry (law
 * D-004: never imports; the interop test asserts verdict parity against the
 * real market-protocol validators). One validator per taxonomy entry; the
 * registry's type is a mapped type over `EventPayloadMap`, so exhaustiveness
 * is a COMPILE ERROR, not a runtime surprise.
 *
 * The registry additionally carries {@link payloadFieldSpec} — the
 * required/optional field inventory of every canonical payload — which
 * powers mapping-table validation: a declared mapping table must cover every
 * required canonical field and may only target fields that exist. This is
 * how "unmapped field = typed error" is made total in BOTH directions
 * (raw -> canonical and canonical -> raw).
 */

import type { EventPayloadMap, EventType, PayloadOf } from '../taxonomy';
import { invalidField, isRecord } from '../fields';
import type { SdkFieldError } from '../errors';
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
  validate(value: unknown): readonly SdkFieldError[];
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

/** The field inventory of one canonical payload. */
export interface PayloadFieldSpec {
  /** Fields every valid payload of this type carries. */
  readonly required: readonly string[];
  /** Fields a payload may additionally carry. */
  readonly optional: readonly string[];
}

/**
 * Required/optional field inventory per event type — the mapping table's
 * canonical target vocabulary. Mirrors the payload interfaces above; a
 * mismatch is caught by the registry parity tests (a validator that demands
 * a field not listed here, or vice versa, fails the suite).
 */
export const payloadFieldSpec: { readonly [E in EventType]: PayloadFieldSpec } = {
  trade: { required: ['price', 'size', 'side'], optional: ['trade_id'] },
  quote: { required: ['bid_price', 'bid_size', 'ask_price', 'ask_size'], optional: [] },
  book_snapshot: { required: ['bids', 'asks'], optional: ['depth', 'last_update_id'] },
  book_delta: { required: ['action', 'levels'], optional: ['last_update_id'] },
  ohlcv: { required: ['interval', 'open', 'high', 'low', 'close', 'volume'], optional: ['closed', 'trade_count'] },
  news: { required: ['headline', 'symbols'], optional: ['body', 'source', 'url', 'tags'] },
  macro_release: { required: ['indicator', 'region', 'period', 'actual'], optional: ['forecast', 'prior', 'unit'] },
  social_signal: { required: ['platform', 'metric', 'value'], optional: ['author', 'url'] },
  fundamental: { required: ['field', 'period', 'value'], optional: ['unit', 'source'] },
  option_chain_mark: {
    required: ['underlying', 'expiry', 'strike', 'right', 'mark_price'],
    optional: ['implied_vol', 'greeks'],
  },
  other: { required: ['kind', 'data'], optional: [] },
};

/** Canonical fields (required + optional) targetable by a mapping table. */
export function canonicalFieldsOf(eventType: EventType): readonly string[] {
  const spec = payloadFieldSpec[eventType];
  return [...spec.required, ...spec.optional];
}

/** Validate a value as the typed payload of one canonical event type. */
export function validatePayloadFor(eventType: EventType, value: unknown): readonly SdkFieldError[] {
  if (!isRecord(value)) {
    return [invalidField('', `${eventType} payload must be an object`)];
  }
  return payloadRegistry[eventType].validate(value);
}

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
