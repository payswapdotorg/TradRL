/**
 * @tradrl/adapter-equities — the licensed equities/index market-data adapter.
 *
 * The T038 equities/index adapter over the provider-neutral SDK contracts
 * (T036; spec/ADAPTERS.md: "External systems are substrates. Canonical
 * domain contracts remain provider-neutral"). Public API:
 *
 *   - `EQUITIES_SOURCE_DESCRIPTOR` — the declared capability card
 *     (provider "licensed-index-a", market-data, documented feed channels
 *     indexLevel/constituentWeights/corporateActions, canonical event
 *     types fundamental/other, near-realtime latency class).
 *   - Documented raw record SCHEMAS (./schemas.ts) — hand-rolled guards
 *     over the documented public record shapes of the licensed index
 *     feed; unknown fields are typed MappingErrors (never silently
 *     dropped). Licensed content is never embedded: every fixture value
 *     is synthetic (the licensing boundary modeled at full strictness).
 *   - `EQUITIES_MAPPING_TABLES` — every consumed raw field -> canonical
 *     field, with the declared source-time policy per table (L4: honest
 *     quartets — event_time is the index dissemination instant or the
 *     announcement instant; availability at the receive session, clamped
 *     to >= event_time).
 *   - `EQUITIES_SESSION_CALENDAR` (+ pure assessment functions) — the
 *     DECLARED UTC trading calendar the guard enforces (session days,
 *     the US regular session window, intraday dissemination-on-trade-date
 *     law; criterion 9).
 *   - `createEquitiesAdapterSession` — the SDK lifecycle
 *     (open/subscribe/nextEvent/onEvent/pump/close) over an INJECTED
 *     transport port, with the provider guard pipeline (documented schema
 *     validation, trading-calendar laws, record sequencing, action
 *     dedup, escape-hatch derivation) and the documented subscribe-frame
 *     construction helpers.
 *   - `EQUITIES_ENTITLEMENT` — the licensed-data declaration at FULL
 *     STRICTNESS (restricted access class, opaque license constraint
 *     refs, terms ref); every emitted record carries the entitlement
 *     ref, and emission without the declaration is a typed
 *     EntitlementError.
 *   - `EQUITIES_RATE_QUOTA` / `EQUITIES_RATE_QUOTA_SET` /
 *     `enforceEquitiesRateQuota` — the documented feed limits as
 *     declarative envelopes; enforcement is this adapter's duty.
 *   - `EQUITIES_HEALTH_THRESHOLDS` — the declared liveness envelope.
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
 *   - L2 (inverse): every feed name and semantic lives ONLY in this
 *     package's provider layer; the emitted canonical events are
 *     provider-neutral market-protocol shapes (trip-wired).
 *   - L4 quartet honesty, L9 lineage, licensed entitlement declaration,
 *     rate quota enforcement — all typed, deterministic, tested.
 *   - spec/ADAPTERS.md Licensing: licensed index data remains
 *     access-controlled and is not copied into artifacts contrary to
 *     provider terms (synthetic fixture values only).
 */

// The provider-neutral contract layer (the SDK's exported shapes, mirrored).
export * from './contract';

// The provider-namespace protocol error extension.
export type { EquitiesProtocolErrorCode } from './protocol';
export {
  EQUITIES_PROTOCOL_CODES,
  equitiesProtocolError,
  equitiesProtocolCodeOf,
  isEquitiesProtocolError,
} from './protocol';

// The declared source descriptor and identity.
export {
  EQUITIES_PROVIDER_ID,
  EQUITIES_VENUE,
  EQUITIES_ADAPTER,
  EQUITIES_CHANNELS,
  EQUITIES_EVENT_TYPES,
  EQUITIES_SYMBOL_UNIVERSES,
  EQUITIES_SOURCE_DESCRIPTOR,
} from './descriptor';

// The declared trading calendar (session semantics, criterion 9).
export type { SessionWindow, TradingCalendar } from './calendar';
export {
  EQUITIES_SESSION_CALENDAR,
  validateTradingCalendar,
  isSessionDay,
  isSessionInstantDay,
  tradingSessionOf,
  isTradingInstant,
  tradeDateDayIndex,
  utcDayIndexAt,
} from './calendar';

// The documented raw record schemas (guard + normalization + derivation).
export {
  EQUITIES_RAW_FIELD_NAMES,
  guardEquitiesPayload,
  guardIndexLevelPayload,
  guardConstituentWeightsPayload,
  guardCorporateActionsPayload,
  deriveIndexLevelPayload,
  deriveConstituentWeightPayload,
  deriveCorporateActionPayload,
  isNormalizedIndexLevel,
  isNormalizedConstituentWeight,
  isNormalizedCorporateAction,
} from './schemas';
export type { NormalizedIndexLevel, NormalizedConstituentWeight, NormalizedCorporateAction } from './schemas';

// The declared mapping tables.
export {
  EQUITIES_CHANNEL_TABLE_IDS,
  EQUITIES_INDEX_LEVEL_TABLE,
  EQUITIES_CONSTITUENT_WEIGHT_TABLE,
  EQUITIES_CORPORATE_ACTION_TABLE,
  EQUITIES_MAPPING_TABLES,
} from './mapping-tables';

// The declared entitlement (licensed data, full strictness).
export { EQUITIES_ENTITLEMENT } from './entitlement';

// The declarative rate quotas + enforcement.
export {
  EQUITIES_RATE_QUOTA,
  EQUITIES_RATE_QUOTA_SET,
  enforceEquitiesRateQuota,
} from './rate-quota';

// The declared health thresholds.
export { EQUITIES_HEALTH_THRESHOLDS } from './health';

// The documented subscription request construction.
export type { EquitiesChannel } from './requests';
export {
  EQUITIES_CHANNEL_ASSET_CLASSES,
  equitiesFeedSubject,
  equitiesSubscribeRequest,
  equitiesSubscription,
} from './requests';

// The guard transport (the provider inbound pipeline).
export type { EquitiesGuardTransport } from './guard-transport';
export { createEquitiesGuardTransport } from './guard-transport';

// The adapter session.
export type { EquitiesSessionConfig } from './session';
export {
  createEquitiesAdapterSession,
  createEquitiesSessionWithoutEntitlement,
} from './session';

/** Package identity and ownership (Work Order T038). */
export const packageInfo = {
  name: '@tradrl/adapter-equities',
  owner: 'T038',
  status: 'implemented',
} as const;
