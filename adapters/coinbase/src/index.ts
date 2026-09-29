/**
 * @tradrl/adapter-coinbase — the Coinbase Exchange spot market-data adapter.
 *
 * The SECOND concrete adapter over the provider-neutral SDK contracts
 * (T036; spec/ADAPTERS.md: "External systems are substrates. Canonical
 * domain contracts remain provider-neutral"). Public API:
 *
 *   - `COINBASE_SOURCE_DESCRIPTOR` — the declared capability card
 *     (provider "coinbase", market-data, the documented channels
 *     level2_batch / ticker / match, canonical event types
 *     trade/quote/book_snapshot, realtime latency class).
 *   - Documented raw payload SCHEMAS (./schemas.ts) — hand-rolled guards
 *     over the publicly documented Coinbase Exchange channel fields;
 *     unknown fields are typed MappingErrors (never silently dropped).
 *   - The deterministic ISO-8601 conversion (./iso.ts) — Coinbase's
 *     documented timestamp form, hand-rolled (no Date.parse:
 *     implementation-defined for microsecond fractions), with a
 *     documented truncation-to-milliseconds policy.
 *   - `COINBASE_MAPPING_TABLES` — every consumed raw field -> canonical
 *     field, with the declared source-time policy per table (L4: honest
 *     quartets — the snapshot channel carries no documented time field,
 *     so its quartet is receive-time based; the ticker/match `time`
 *     fields feed event_time).
 *   - `createCoinbaseAdapterSession` — the SDK lifecycle
 *     (open/subscribe/nextEvent/onEvent/pump/close) over an INJECTED
 *     transport port, with the provider guard pipeline (documented schema
 *     validation, ISO conversion, level normalization, documented
 *     message-sequence tracking) and the documented subscribe-message
 *     construction helpers.
 *   - `COINBASE_ENTITLEMENT` — the public market-data declaration; every
 *     emitted record carries the entitlement ref, and emission without
 *     the declaration is a typed EntitlementError.
 *   - `COINBASE_RATE_QUOTA` / `COINBASE_RATE_QUOTA_SET` /
 *     `enforceCoinbaseRateQuota` — the documented limits as declarative
 *     envelopes; enforcement is this adapter's duty.
 *   - `COINBASE_HEALTH_THRESHOLDS` — the declared liveness envelope.
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
 *   - L2 (inverse): every Coinbase name and semantic lives ONLY in this
 *     package's provider layer; the emitted canonical events are
 *     provider-neutral market-protocol shapes (trip-wired).
 *   - L4 quartet honesty, L9 lineage, entitlement declaration, rate
 *     quota enforcement — all typed, deterministic, tested.
 */

// The provider-neutral contract layer (the SDK's exported shapes, mirrored).
export * from './contract';

// The deterministic ISO-8601 conversion (Coinbase's documented time form).
export { isoToTimestampMs } from './iso';

// The provider-namespace protocol error extension.
export type { CoinbaseProtocolErrorCode } from './protocol';
export {
  COINBASE_PROTOCOL_CODES,
  coinbaseProtocolError,
  coinbaseProtocolCodeOf,
  isCoinbaseProtocolError,
} from './protocol';

// The declared source descriptor and identity.
export {
  COINBASE_PROVIDER_ID,
  COINBASE_VENUE,
  COINBASE_ADAPTER,
  COINBASE_DECLARED_CHANNELS,
  COINBASE_EVENT_TYPES,
  COINBASE_SYMBOL_UNIVERSES,
  COINBASE_SOURCE_DESCRIPTOR,
} from './descriptor';

// The documented raw payload schemas (guard + normalization).
export {
  COINBASE_CHANNELS,
  COINBASE_RAW_FIELD_NAMES,
  guardCoinbasePayload,
  guardLevel2BatchPayload,
  guardTickerPayload,
  guardMatchPayload,
  isNormalizedTicker,
  isNormalizedMatch,
} from './schemas';
export type {
  NormalizedLevel,
  NormalizedLevel2Snapshot,
  NormalizedTicker,
  NormalizedMatch,
} from './schemas';

// The declared mapping tables.
export {
  COINBASE_CHANNEL_TABLE_IDS,
  COINBASE_LEVEL2_SNAPSHOT_TABLE,
  COINBASE_TICKER_TABLE,
  COINBASE_MATCH_TABLE,
  COINBASE_MAPPING_TABLES,
} from './mapping-tables';

// The declared entitlement.
export { COINBASE_ENTITLEMENT } from './entitlement';

// The declarative rate quotas + enforcement.
export {
  COINBASE_RATE_QUOTA,
  COINBASE_RATE_QUOTA_SET,
  enforceCoinbaseRateQuota,
} from './rate-quota';

// The declared health thresholds.
export { COINBASE_HEALTH_THRESHOLDS } from './health';

// The documented subscription request construction.
export type { CoinbaseChannel } from './requests';
export {
  coinbaseProductId,
  coinbaseSubscribeRequest,
  coinbaseSubscription,
} from './requests';

// The guard transport (the provider inbound pipeline).
export type { CoinbaseGuardTransport } from './guard-transport';
export { createCoinbaseGuardTransport } from './guard-transport';

// The adapter session.
export type { CoinbaseSessionConfig } from './session';
export {
  createCoinbaseAdapterSession,
  createCoinbaseSessionWithoutEntitlement,
} from './session';

/** Package identity and ownership (Work Order T037). */
export const packageInfo = {
  name: '@tradrl/adapter-coinbase',
  owner: 'T037',
  status: 'implemented',
} as const;
