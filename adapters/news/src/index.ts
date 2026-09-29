/**
 * @tradrl/adapter-news — the news market-data adapter.
 *
 * The T038 news adapter over the provider-neutral SDK contracts (T036;
 * spec/ADAPTERS.md: "External systems are substrates. Canonical domain
 * contracts remain provider-neutral"). Public API:
 *
 *   - `NEWS_SOURCE_DESCRIPTOR` — the declared capability card
 *     (provider "news-wire-a", market-data, documented wire channels
 *     publicHeadlines/licensedWire, canonical event type news,
 *     near-realtime latency class).
 *   - Documented raw item SCHEMAS (./schemas.ts) — hand-rolled guards
 *     over the documented public news item shapes (headline,
 *     publication time, ticker tagging, publisher ref); unknown fields
 *     are typed MappingErrors (never silently dropped).
 *   - `NEWS_MAPPING_TABLES` — every consumed raw field -> canonical
 *     field, with the declared source-time policy (publication time ->
 *     available time) per table (L4 honest quartets).
 *   - `NEWS_EMBARGO_POLICY` (+ pure predicates) — the DECLARED embargo
 *     quartet policy: records received before their embargo lift are
 *     held by the guard and delivered at the lift instant, so
 *     available_time is the lift instant, never before the embargo; a
 *     timeline draining with held records is a typed error (never a
 *     silent drop).
 *   - `createNewsAdapterSession` — the SDK lifecycle
 *     (open/subscribe/nextEvent/onEvent/pump/close) over an INJECTED
 *     transport port, with the provider guard pipeline (documented
 *     schema validation, item dedup, embargo hold-and-release) and the
 *     documented subscribe-frame construction helpers.
 *   - `NEWS_PUBLIC_ENTITLEMENT` / `NEWS_WIRE_SERVICE_ENTITLEMENT` /
 *     `NEWS_ENTITLEMENT` — the public + wire-service entitlement tiers
 *     as opaque refs; every emitted record carries the entitlement
 *     ref, and emission without the declaration is a typed
 *     EntitlementError.
 *   - `NEWS_RATE_QUOTA` / `NEWS_RATE_QUOTA_SET` / `enforceNewsRateQuota`
 *     — the documented wire limits as declarative envelopes; enforcement
 *     is this adapter's duty.
 *   - `NEWS_HEALTH_THRESHOLDS` — the declared liveness envelope.
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
 *   - L2 (inverse): every wire name and semantic lives ONLY in this
 *     package's provider layer; the emitted canonical events are
 *     provider-neutral market-protocol shapes (trip-wired).
 *   - L4 quartet honesty (publication -> availability; embargo lift
 *     discipline), L9 lineage, entitlement declaration, rate quota
 *     enforcement — all typed, deterministic, tested.
 *   - spec/ADAPTERS.md Licensing: licensed wire content is never
 *     embedded in fixtures beyond documented public metadata.
 */

// The provider-neutral contract layer (the SDK's exported shapes, mirrored).
export * from './contract';

// The provider-namespace protocol error extension.
export type { NewsProtocolErrorCode } from './protocol';
export {
  NEWS_PROTOCOL_CODES,
  newsProtocolError,
  newsProtocolCodeOf,
  isNewsProtocolError,
} from './protocol';

// The declared source descriptor and identity.
export {
  NEWS_PROVIDER_ID,
  NEWS_VENUE,
  NEWS_ADAPTER,
  NEWS_CHANNELS,
  NEWS_EVENT_TYPES,
  NEWS_SYMBOL_UNIVERSES,
  NEWS_SOURCE_DESCRIPTOR,
} from './descriptor';

// The declared embargo quartet policy.
export type { EmbargoPolicy } from './embargo';
export {
  NEWS_EMBARGO_POLICY,
  validateEmbargoPolicy,
  embargoLiftAt,
  isEmbargoedAt,
} from './embargo';

// The documented raw item schemas (guard + normalization + derivation).
export {
  NEWS_RAW_FIELD_NAMES,
  guardNewsPayload,
  guardPublicHeadlinePayload,
  guardWireItemPayload,
  derivePublicHeadlinePayload,
  deriveWireItemPayload,
  isNormalizedPublicHeadline,
  isNormalizedWireItem,
} from './schemas';
export type { NormalizedPublicHeadline, NormalizedWireItem } from './schemas';

// The declared mapping tables.
export {
  NEWS_CHANNEL_TABLE_IDS,
  NEWS_PUBLIC_HEADLINE_TABLE,
  NEWS_LICENSED_WIRE_TABLE,
  NEWS_MAPPING_TABLES,
} from './mapping-tables';

// The declared entitlement tiers (public + wire service, as opaque refs).
export {
  NEWS_PUBLIC_ENTITLEMENT,
  NEWS_WIRE_SERVICE_ENTITLEMENT,
  NEWS_ENTITLEMENT,
} from './entitlement';

// The declarative rate quotas + enforcement.
export {
  NEWS_RATE_QUOTA,
  NEWS_RATE_QUOTA_SET,
  enforceNewsRateQuota,
} from './rate-quota';

// The declared health thresholds.
export { NEWS_HEALTH_THRESHOLDS } from './health';

// The documented subscription request construction.
export type { NewsChannel } from './requests';
export {
  newsStreamSymbol,
  newsSubscribeRequest,
  newsSubscription,
} from './requests';

// The guard transport (the provider inbound pipeline).
export type { NewsGuardTransport } from './guard-transport';
export { createNewsGuardTransport } from './guard-transport';

// The adapter session.
export type { NewsSessionConfig } from './session';
export {
  createNewsAdapterSession,
  createNewsSessionWithoutEntitlement,
} from './session';

/** Package identity and ownership (Work Order T038). */
export const packageInfo = {
  name: '@tradrl/adapter-news',
  owner: 'T038',
  status: 'implemented',
} as const;
