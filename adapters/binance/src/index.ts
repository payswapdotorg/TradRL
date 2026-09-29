/**
 * @tradrl/adapter-binance — the Binance spot market-data adapter.
 *
 * The FIRST concrete adapter over the provider-neutral SDK contracts
 * (T036; spec/ADAPTERS.md: "External systems are substrates. Canonical
 * domain contracts remain provider-neutral"). Public API:
 *
 *   - `BINANCE_SOURCE_DESCRIPTOR` — the declared capability card
 *     (provider "binance", market-data, documented spot stream channels,
 *     canonical event types trade/quote/book_snapshot/book_delta,
 *     realtime latency class).
 *   - Documented raw payload SCHEMAS (./schemas.ts) — hand-rolled guards
 *     over the publicly documented Binance spot stream fields; unknown
 *     fields are typed MappingErrors (never silently dropped).
 *   - `BINANCE_MAPPING_TABLES` — every consumed raw field -> canonical
 *     field, with the declared source-time policy per table (L4: honest
 *     quartets — the partial-depth and bookTicker streams carry no
 *     documented time field, so their quartets are receive-time based;
 *     the trade stream's T/E feed event_time/source_time).
 *   - `createBinanceAdapterSession` — the SDK lifecycle
 *     (open/subscribe/nextEvent/onEvent/pump/close) over an INJECTED
 *     transport port, with the provider guard pipeline (documented schema
 *     validation, update-id sequencing, two-sided diff splitting) and the
 *     documented subscribe-message construction helpers.
 *   - `BINANCE_ENTITLEMENT` — the public market-data declaration; every
 *     emitted record carries the entitlement ref, and emission without
 *     the declaration is a typed EntitlementError.
 *   - `BINANCE_RATE_QUOTA` / `BINANCE_RATE_QUOTA_SET` /
 *     `enforceBinanceRateQuota` — the documented spot limits as
 *     declarative envelopes; enforcement is this adapter's duty.
 *   - `BINANCE_HEALTH_THRESHOLDS` — the declared liveness envelope.
 *   - The full contract mirror (./contract) — the SDK's exported shapes,
 *     re-declared and implemented here (law D-004: structural mirrors,
 *     never imports), drift-checked against the real
 *     @tradrl/provider-sdk and @tradrl/market-protocol in the interop
 *     test (which also drives the REAL SDK's adapter contract suite
 *     against this adapter's session).
 *
 * LAWS HELD (violations = rejection):
 *   - ZERO runtime dependencies; no `any`; total hand-rolled guards.
 *   - NO NETWORK: the transport is an injected port; all tests run over
 *     scripted fakes. No secrets, no API keys, no account-specific data.
 *   - NO IMPORTS of @tradrl/provider-sdk or any other package in the
 *     sources (cross-package imports happen ONLY in tests, via relative
 *     paths — the repo's established pattern).
 *   - deepFreeze everything public; no ambient clock; byte-determinism.
 *   - L2 (inverse): every Binance name and semantic lives ONLY in this
 *     package's provider layer; the emitted canonical events are
 *     provider-neutral market-protocol shapes (trip-wired).
 *   - L4 quartet honesty, L9 lineage, entitlement declaration, rate
 *     quota enforcement — all typed, deterministic, tested.
 */

// The provider-neutral contract layer (the SDK's exported shapes, mirrored).
export * from './contract';

// The provider-namespace protocol error extension.
export type { BinanceProtocolErrorCode } from './protocol';
export {
  BINANCE_PROTOCOL_CODES,
  binanceProtocolError,
  binanceProtocolCodeOf,
  isBinanceProtocolError,
} from './protocol';

// The declared source descriptor and identity.
export {
  BINANCE_PROVIDER_ID,
  BINANCE_VENUE,
  BINANCE_ADAPTER,
  BINANCE_CHANNELS,
  BINANCE_EVENT_TYPES,
  BINANCE_SYMBOL_UNIVERSES,
  BINANCE_SOURCE_DESCRIPTOR,
} from './descriptor';

// The documented raw payload schemas (guard + normalization + split).
export {
  BINANCE_RAW_FIELD_NAMES,
  guardBinancePayload,
  guardDepthPayload,
  guardDepthDiffPayload,
  guardBookTickerPayload,
  guardTradePayload,
  splitDepthDiff,
  isZeroSize,
  isNormalizedDepthDiff,
} from './schemas';
export type { NormalizedLevel, NormalizedDepthDiff, NormalizedTrade } from './schemas';

// The declared mapping tables.
export {
  BINANCE_CHANNEL_TABLE_IDS,
  BINANCE_DEPTH_SNAPSHOT_TABLE,
  BINANCE_DEPTH_DIFF_TABLE,
  BINANCE_BOOK_TICKER_TABLE,
  BINANCE_TRADE_TABLE,
  BINANCE_MAPPING_TABLES,
} from './mapping-tables';

// The declared entitlement.
export { BINANCE_ENTITLEMENT } from './entitlement';

// The declarative rate quotas + enforcement.
export {
  BINANCE_RATE_QUOTA,
  BINANCE_RATE_QUOTA_SET,
  enforceBinanceRateQuota,
} from './rate-quota';

// The declared health thresholds.
export { BINANCE_HEALTH_THRESHOLDS } from './health';

// The documented subscription request construction.
export type { BinanceChannel } from './requests';
export {
  binanceRawSymbol,
  binanceStreamName,
  binanceSubscribeRequest,
  binanceSubscription,
} from './requests';

// The guard transport (the provider inbound pipeline).
export type { BinanceGuardTransport } from './guard-transport';
export { createBinanceGuardTransport } from './guard-transport';

// The adapter session.
export type { BinanceSessionConfig } from './session';
export {
  createBinanceAdapterSession,
  createBinanceSessionWithoutEntitlement,
} from './session';

/** Package identity and ownership (Work Order T037). */
export const packageInfo = {
  name: '@tradrl/adapter-binance',
  owner: 'T037',
  status: 'implemented',
} as const;
