/**
 * @tradrl/adapter-alternative-data — the alternative-data market-data adapter.
 *
 * The T038 alternative-data adapter over the provider-neutral SDK
 * contracts (T036; spec/ADAPTERS.md: "External systems are substrates.
 * Canonical domain contracts remain provider-neutral"). Public API:
 *
 *   - `ALTDATA_SOURCE_DESCRIPTOR` — the declared capability card
 *     (provider "alt-vendor-a", market-data, documented observation
 *     channels sentiment/onChain/economicSeries/satelliteSeries,
 *     canonical event types social_signal/macro_release/fundamental,
 *     batch latency class — alternative data is released on schedules).
 *   - Documented raw observation SCHEMAS (./schemas.ts) — hand-rolled
 *     guards over the documented public alt-data shapes (sentiment
 *     scores, on-chain metrics, economic and satellite series);
 *     unknown fields are typed MappingErrors (never silently dropped).
 *   - `ALTDATA_MAPPING_TABLES` — every consumed raw field -> canonical
 *     field, with the DECLARED window->release availability policy: an
 *     observation covering window W becomes available at its declared
 *     release instant, never mid-window (L4 honest quartets — a late
 *     poll does not move the availability instant).
 *   - `ALTDATA_WINDOW_RELEASE_LAW` (+ pure predicates) — the declared
 *     observation availability law: mid-window releases and overlapping
 *     series windows are typed errors, never emitted dishonest
 *     quartets.
 *   - `createAltDataAdapterSession` — the SDK lifecycle
 *     (open/subscribe/nextEvent/onEvent/pump/close) over an INJECTED
 *     transport port, with the provider guard pipeline (documented
 *     schema validation, the stateless window laws, the per-series
 *     window-overlap sequencing) and the documented subscribe-frame
 *     construction helpers.
 *   - `ALTDATA_PUBLIC_ENTITLEMENT` / `ALTDATA_VENDOR_ENTITLEMENT` /
 *     `ALTDATA_ENTITLEMENT` — the public + vendor-licensed entitlement
 *     tiers as opaque refs; every emitted record carries the
 *     entitlement ref, and emission without the declaration is a typed
 *     EntitlementError.
 *   - `ALTDATA_RATE_QUOTA` / `ALTDATA_RATE_QUOTA_SET` /
 *     `enforceAltDataRateQuota` — the documented vendor limits as
 *     declarative envelopes; enforcement is this adapter's duty.
 *   - `ALTDATA_HEALTH_THRESHOLDS` — the declared liveness envelope.
 *   - The full contract mirror (./contract) — the SDK's exported
 *     shapes, re-declared and implemented here (law D-004: structural
 *     mirrors, never imports), drift-checked against the real
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
 *   - L2 (inverse): every vendor name and semantic lives ONLY in this
 *     package's provider layer; the emitted canonical events are
 *     provider-neutral market-protocol shapes (trip-wired).
 *   - L4 quartet honesty (the window->release law), L9 lineage,
 *     entitlement declaration, rate quota enforcement — all typed,
 *     deterministic, tested.
 *   - spec/ADAPTERS.md Licensing: vendor-licensed series content is
 *     never embedded in fixtures (synthetic observations only).
 */

// The provider-neutral contract layer (the SDK's exported shapes, mirrored).
export * from './contract';

// The provider-namespace protocol error extension.
export type { AltDataProtocolErrorCode } from './protocol';
export {
  ALTDATA_PROTOCOL_CODES,
  altDataProtocolError,
  altDataProtocolCodeOf,
  isAltDataProtocolError,
} from './protocol';

// The declared source descriptor and identity.
export {
  ALTDATA_PROVIDER_ID,
  ALTDATA_VENUE,
  ALTDATA_ADAPTER,
  ALTDATA_CHANNELS,
  ALTDATA_EVENT_TYPES,
  ALTDATA_SYMBOL_UNIVERSES,
  ALTDATA_SOURCE_DESCRIPTOR,
} from './descriptor';

// The declared window->release law (the observation availability policy).
export type { WindowReleaseLaw } from './window-release';
export {
  ALTDATA_WINDOW_RELEASE_LAW,
  validateWindowReleaseLaw,
  isMidWindowRelease,
  windowsOverlap,
} from './window-release';

// The documented raw observation schemas (guard + normalization + derivation).
export {
  ALTDATA_RAW_FIELD_NAMES,
  guardAltDataPayload,
  guardSentimentObservationPayload,
  guardOnChainMetricPayload,
  guardEconomicObservationPayload,
  guardSatelliteObservationPayload,
  deriveSentimentPayload,
  deriveOnChainPayload,
  deriveEconomicPayload,
  deriveSatellitePayload,
  isNormalizedSentimentObservation,
  isNormalizedOnChainMetric,
  isNormalizedEconomicObservation,
  isNormalizedSatelliteObservation,
} from './schemas';
export type {
  ObservationWindow,
  NormalizedSentimentObservation,
  NormalizedOnChainMetric,
  NormalizedEconomicObservation,
  NormalizedSatelliteObservation,
} from './schemas';

// The declared mapping tables.
export {
  ALTDATA_CHANNEL_TABLE_IDS,
  ALTDATA_SENTIMENT_TABLE,
  ALTDATA_ON_CHAIN_TABLE,
  ALTDATA_ECONOMIC_SERIES_TABLE,
  ALTDATA_SATELLITE_TABLE,
  ALTDATA_MAPPING_TABLES,
} from './mapping-tables';

// The declared entitlement tiers (public + vendor-licensed, as opaque refs).
export {
  ALTDATA_PUBLIC_ENTITLEMENT,
  ALTDATA_VENDOR_ENTITLEMENT,
  ALTDATA_ENTITLEMENT,
} from './entitlement';

// The declarative rate quotas + enforcement.
export {
  ALTDATA_RATE_QUOTA,
  ALTDATA_RATE_QUOTA_SET,
  enforceAltDataRateQuota,
} from './rate-quota';

// The declared health thresholds.
export { ALTDATA_HEALTH_THRESHOLDS } from './health';

// The documented subscription request construction.
export type { AltDataChannel } from './requests';
export {
  ALTDATA_CHANNEL_ASSET_CLASSES,
  altDataSeriesSubject,
  altDataSubscribeRequest,
  altDataSubscription,
} from './requests';

// The guard transport (the provider inbound pipeline).
export type { AltDataGuardTransport } from './guard-transport';
export { createAltDataGuardTransport } from './guard-transport';

// The adapter session.
export type { AltDataSessionConfig } from './session';
export {
  createAltDataAdapterSession,
  createAltDataSessionWithoutEntitlement,
} from './session';

/** Package identity and ownership (Work Order T038). */
export const packageInfo = {
  name: '@tradrl/adapter-alternative-data',
  owner: 'T038',
  status: 'implemented',
} as const;
