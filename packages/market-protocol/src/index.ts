/**
 * @tradrl/market-protocol — the canonical provider-neutral market event.
 *
 * Public API:
 *   - `MarketEvent` — the discriminated-union envelope every external market
 *     observation must take (spec/DOMAIN-MODEL.md). Discriminant:
 *     `event_type`; payloads are typed per taxonomy entry.
 *   - Availability quartet — `event_time` / `source_time` / `available_time`
 *     / `ingestion_time` with explicit semantics (see envelope.ts and
 *     contracts/market/01-market-event-envelope.md).
 *   - `validateMarketEvent` / `isMarketEvent` — hand-rolled guards, typed
 *     errors, collect-all validation. No `unknown` leaks at the surface.
 *   - `payloadRegistry` — payload validators keyed by event type.
 *   - `validateSequenceMonotonicity` + `SequenceTracker` — per-stream
 *     sequence discipline.
 *   - Provenance: `Provenance`, origins (`historical | simulated |
 *     generated`), `isSyntheticEvent`, lineage rules.
 *
 * Zero runtime dependencies; types, schemas and pure functions only.
 * `TimestampMs` is a structural mirror of `@tradrl/time-engine` (canonical
 * owner) — see src/timestamp.ts for the mirror discipline.
 */

// Errors and results
export type { MarketProtocolErrorCode, MarketProtocolError, ValidationResult } from './errors';

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './timestamp';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs } from './timestamp';

// Identifiers, asset classes, shared field guards
export type { EventId, VenueId, InstrumentId, ProviderId, LineageId, AssetClass } from './fields';
export { ASSET_CLASSES, isAssetClass } from './fields';

// Decimal string numerics
export type { DecimalString } from './decimals';
export { isUnsignedDecimal, isSignedDecimal, isPositiveDecimal, isSignedPositiveDecimal, compareDecimal } from './decimals';

// JSON value model (for the `other` escape hatch)
export type { JsonValue, JsonObject } from './json';
export { isJsonValue, isJsonObject } from './json';

// Taxonomy
export type { EventPayloadMap, EventType, PayloadOf } from './event-types';
export { EVENT_TYPES, isEventType } from './event-types';

// Payloads and registry
export type {
  TradePayload,
  QuotePayload,
  BookSnapshotPayload,
  BookDeltaPayload,
  BookLevel,
  BookDeltaAction,
  OhlcvPayload,
  NewsPayload,
  MacroReleasePayload,
  SocialSignalPayload,
  FundamentalPayload,
  OptionChainMarkPayload,
  OptionGreeks,
  OptionRight,
  OtherPayload,
  TradeSide,
} from './payloads/registry';
export { payloadRegistry } from './payloads/registry';
export type { PayloadValidator } from './payloads/registry';
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
} from './payloads/registry';

// Provenance
export type { EventOrigin, AdapterRef, Provenance } from './provenance';
export { EVENT_ORIGINS, isEventOrigin, validateProvenance, isProvenance, isSyntheticEvent, eventOrigin } from './provenance';

// Envelope
export type {
  MarketEvent,
  MarketEventFor,
  TradeEvent,
  QuoteEvent,
  BookSnapshotEvent,
  BookDeltaEvent,
  OhlcvEvent,
  NewsEvent,
  MacroReleaseEvent,
  SocialSignalEvent,
  FundamentalEvent,
  OptionChainMarkEvent,
  OtherEvent,
} from './envelope';
export { validateMarketEvent, isMarketEvent, validateMarketEvents } from './envelope';

// Sequence discipline
export type { SequenceStream, SequenceKey, SequenceViolation, SequenceValidation, SequenceTracker } from './sequence';
export { sequenceStream, sequenceKey, validateSequenceMonotonicity, createSequenceTracker } from './sequence';

/** Package identity and ownership (Work Order T004). */
export const packageInfo = {
  name: '@tradrl/market-protocol',
  owner: 'T004',
  status: 'implemented',
} as const;
