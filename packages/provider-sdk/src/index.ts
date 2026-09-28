/**
 * @tradrl/provider-sdk — the provider-neutral adapter SDK.
 *
 * The foundation every external integration (crypto/exchange adapters,
 * equities/news/alternative-data adapters, broker/OMS adapters — Work
 * Orders T037/T038/T039) builds on. External systems are substrates
 * (spec/ADAPTERS.md); canonical domain contracts remain provider-neutral
 * (L2/L13/L14), so the SDK knows NO provider: no vendor name, field or
 * semantic appears in any SDK type — the provider-neutrality trip-wire
 * (a grep test over the package sources) fails the build if one ever does.
 *
 * Public API:
 *   - `SourceDescriptor` — provider-neutral identity + capability card
 *     (categories, symbol universes, channels, canonical event types,
 *     latency class); validated collect-all, deep-frozen.
 *   - `AdapterSession` — the normalized lifecycle
 *     (open/subscribe/onEvent/close) over an injected `TransportPort`
 *     (send/recv/close — interface only; NO network in this package).
 *   - `CanonicalEmitter` — raw->canonical mapping through a declared
 *     `MappingTable` (raw field -> canonical field, source-time policy),
 *     emitting the canonical event shape (structural mirrors) carrying the
 *     availability quartet (L4), the ingestion provenance block (L9) and
 *     the entitlement ref; unmapped raw fields are typed MappingErrors —
 *     silent drops are unrepresentable.
 *   - `EntitlementEnvelope` — declared license/access constraints (opaque
 *     refs); emission without a declaration is a typed EntitlementError.
 *   - `RateQuotaEnvelope` — declarative rate/quota records + schedule
 *     feasibility over a scripted timeline (enforcement is T037+'s duty).
 *   - `HealthThresholds` — liveness/staleness records over declared
 *     thresholds (assessed against an injected instant — no wall clock).
 *   - Typed error taxonomy — TransportError / MappingError /
 *     EntitlementError / ProtocolError / TimeoutError with guards.
 *   - Test harness — `FakeTransport` (scripted timeline) and
 *     `adapterContractCases` (the contract cases every adapter MUST pass).
 *
 * Zero runtime dependencies; hand-rolled total guards; everything handed
 * out is deep-frozen. Mirrors follow law D-004 (structural mirrors, never
 * imports): TimestampMs, taxonomy, payloads and provenance re-declare the
 * canonical shapes; `src/interop.test.ts` trip-wires them against
 * @tradrl/market-protocol on this branch (and, structurally identically,
 * against the T008 data plane on the lead integration tree).
 */

// Errors and results
export type {
  SdkFieldErrorCode,
  SdkFieldError,
  SdkValidation,
  AdapterErrorKind,
  TransportErrorCode,
  MappingErrorCode,
  EntitlementErrorCode,
  ProtocolErrorCode,
  TimeoutErrorCode,
  AdapterErrorCode,
  AdapterError,
  SdkResult,
} from './errors';
export {
  transportError,
  mappingError,
  entitlementError,
  protocolError,
  timeoutError,
  isAdapterError,
  isTransportError,
  isMappingError,
  isEntitlementError,
  isProtocolError,
  isTimeoutError,
  validationFailure,
  validationSuccess,
  failure,
  success,
} from './errors';

// Identifiers and shared field guards
export type {
  ProviderId,
  VenueId,
  InstrumentId,
  EventId,
  LineageId,
  AdapterId,
  AdapterVersion,
  EntitlementId,
  MappingTableId,
  ChannelId,
  UniverseId,
} from './fields';
export {
  isRecord,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isFiniteNumber,
  isUniqueNonEmptyStringArray,
} from './fields';

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './timestamp';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs } from './timestamp';

// Decimal string numerics (mirror of the canonical discipline)
export type { DecimalString } from './decimals';
export { isUnsignedDecimal, isSignedDecimal, isPositiveDecimal, isSignedPositiveDecimal, compareDecimal } from './decimals';

// JSON value model
export type { JsonValue, JsonObject } from './json';
export { isJsonValue, isJsonObject } from './json';

// Taxonomy (mirror of the canonical event-type taxonomy + asset classes)
export type { EventPayloadMap, EventType, PayloadOf, AssetClass } from './taxonomy';
export { EVENT_TYPES, ASSET_CLASSES, isEventType, isAssetClass } from './taxonomy';

// Deep freezing
export type { DeepFrozen } from './freeze';
export { deepFreeze } from './freeze';

// Payloads and registry (mirror of the canonical payload contracts)
export type { PayloadValidator, PayloadFieldSpec } from './payloads/registry';
export { payloadRegistry, payloadFieldSpec, canonicalFieldsOf, validatePayloadFor } from './payloads/registry';
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

// Provenance at the ingest boundary (T008 mirror)
export type { EventOrigin, AdapterRef, IngestionProvenance } from './provenance';
export {
  EVENT_ORIGINS,
  isEventOrigin,
  isAdapterRef,
  isIngestionProvenance,
  validateIngestionProvenance,
  isSyntheticEvent,
} from './provenance';

// Entitlement envelope
export type { EntitlementAccessClass, EntitlementEnvelope, EntitlementRef } from './entitlement';
export {
  ENTITLEMENT_ACCESS_CLASSES,
  isEntitlementAccessClass,
  isEntitlementRef,
  isEntitlementEnvelope,
  validateEntitlementEnvelope,
  entitlementRefOf,
} from './entitlement';

// Source descriptors and capabilities
export type { SourceCategory, LatencyClass, SymbolUniverse, SourceCapabilities, SourceDescriptor } from './descriptors';
export {
  SOURCE_CATEGORIES,
  isSourceCategory,
  LATENCY_CLASSES,
  isLatencyClass,
  isSymbolUniverse,
  isSourceCapabilities,
  isSourceDescriptor,
  validateSourceDescriptor,
  declaredInstruments,
  isDeclaredInstrument,
  isDeclaredChannel,
  isDeclaredEventType,
} from './descriptors';

// Mapping tables
export type {
  FieldTransform,
  EventTimeBasis,
  AvailabilityBasis,
  SourceTimePolicy,
  FieldMapping,
  ConstantField,
  MappingTable,
  MappingTableValidation,
  TransformOutcome,
} from './mapping';
export {
  isFieldTransform,
  isSourceTimePolicy,
  timePolicyFields,
  accountedRawFields,
  validateMappingTable,
  applyFieldTransform,
  rawFieldOf,
} from './mapping';

// Transport port (interface only — no implementation in this package)
export type { OutboundMessage, InboundMessage, TransportSendResult, TransportRecvResult, TransportPort } from './transport';
export { isInboundMessage } from './transport';

// Canonical emitter
export type {
  MappingProvenance,
  EmittedEventCommon,
  EmittedEventFor,
  EmittedEvent,
  StreamBinding,
  DerivationSpec,
  EmitterConfig,
  EmitterConstruction,
  CanonicalEmitter,
} from './emitter';
export {
  createCanonicalEmitter,
  emittedStreamKey,
  validateEmittedFloor,
} from './emitter';

// Adapter session
export type {
  SessionState,
  SubscriptionSpec,
  AdapterSessionConfig,
  SessionConstruction,
  EventHandler,
  AdapterSession,
} from './session';
export { createAdapterSession } from './session';

// Rate/quota envelopes
export type { QuotaPolicy, RateQuotaEnvelope, QuotaViolation, FeasibilityReport } from './rate-quota';
export {
  QUOTA_POLICIES,
  isQuotaPolicy,
  isRateQuotaEnvelope,
  validateRateQuotaEnvelope,
  assessScheduleFeasibility,
} from './rate-quota';

// Health heartbeats
export type { HealthThresholds, HealthRecord } from './health';
export { isHealthThresholds, validateHealthThresholds, assessHealth } from './health';

// Test harness: scripted fake transport + adapter contract cases
export type {
  ScriptedInbound,
  ScriptedRecvFailure,
  ScriptedSendFailure,
  TransportScript,
  FakeTransportConstruction,
  FakeTransport,
} from './harness/fake-transport';
export {
  createFakeTransport,
  validateTransportScript,
  scriptedInbound,
  emptyScript,
  unwrapTransport,
} from './harness/fake-transport';
export type { AdapterContractSubject, ContractCase } from './harness/contract-tests';
export {
  adapterContractCases,
  contractAssert,
  contractExpectJsonEqual,
  contractExpectFailure,
  contractExpectSuccess,
} from './harness/contract-tests';

/** Package identity and ownership (Work Order T036). */
export const packageInfo = {
  name: '@tradrl/provider-sdk',
  owner: 'T036',
  status: 'implemented',
} as const;
