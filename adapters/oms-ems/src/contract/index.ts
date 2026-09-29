/**
 * @tradrl/adapter-oms-ems — the provider-neutral contract layer (public API).
 *
 * STRUCTURAL MIRRORS of @tradrl/provider-sdk's exported shapes (law
 * D-003/D-004: structural mirrors, never imports — the frozen workspace
 * lockfile forbids package dependencies). THIS package re-declares the
 * SDK's contract surface and implements it with its own code; the interop
 * test (../interop.test.ts) drift-checks every mirror against the REAL
 * @tradrl/provider-sdk and @tradrl/market-protocol on this branch:
 * type-level assignability witnesses, runtime constant parity and
 * payload-validator verdict parity, plus the SDK's own adapter contract
 * suite driven against this adapter's session.
 *
 * The OMS/EMS provider semantics (descriptor, schemas, mapping
 * tables, entitlement, quotas, guard transport, routing and reconciliation$
 * modules live in the parent modules — never here (L2/L13: this$
 * layer would pass the SDK's own neutrality trip-wire unchanged).
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
export type { EmittablePayloadMap, EmittableEventType, EventType, PayloadOf, AssetClass } from './taxonomy';
export { EVENT_TYPES, EMITTABLE_EVENT_TYPES, isEventType, isEmittableEventType, ASSET_CLASSES, isAssetClass } from './taxonomy';

// Deep freezing
export type { DeepFrozen } from './freeze';
export { deepFreeze } from './freeze';

// Payloads and registry (mirror of the canonical payload contracts)
export type { PayloadValidator, PayloadFieldSpec } from './payloads';
export { payloadRegistry, payloadFieldSpec, canonicalFieldsOf, validatePayloadFor } from './payloads';
export type { OtherPayload } from './payloads';
export { validateOtherPayload, isOtherPayload } from './payloads';

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
