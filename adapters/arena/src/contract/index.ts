/**
 * @tradrl/adapter-arena — the provider-neutral contract layer (public API).
 *
 * STRUCTURAL MIRRORS of the consumed lanes (law D-003/D-004: structural
 * mirrors, never imports — the frozen workspace lockfile forbids package
 * dependencies). THIS package re-declares the consumed contract surfaces
 * and implements them with its own code; the interop test
 * (../interop.test.ts) drift-checks every mirror against the REAL
 * @tradrl/capability-provider, @tradrl/provider-sdk, @tradrl/skills and
 * @tradrl/sdk on this branch: type-level assignability witnesses, runtime
 * constant parity, validator verdict parity, and the REAL exchange driven
 * end-to-end with adapter-minted envelopes.
 *
 * The Arena wire provider semantics (descriptor, schemas, mapping tables,
 * entitlement tiers, quotas, guard transport, routing) live in the parent
 * modules — never here (L2/L13: this layer would pass the neutrality
 * trip-wire unchanged).
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
export type { ProviderId, ChannelId, MappingTableId, EntitlementId } from './fields';
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

// JSON value model
export type { JsonValue, JsonObject } from './json';
export { isJsonValue, isJsonObject } from './json';

// Deep freezing
export type { DeepFrozen } from './freeze';
export { deepFreeze } from './freeze';

// Transport port (interface only — no implementation in this package)
export type { OutboundMessage, InboundMessage, TransportSendResult, TransportRecvResult, TransportPort } from './transport';
export { isInboundMessage } from './transport';

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

// Source descriptors and capabilities (the human-expertise family)
export type { SourceCategory, LatencyClass, SourceCapabilities, SourceDescriptor } from './descriptors';
export {
  SOURCE_CATEGORIES,
  isSourceCategory,
  LATENCY_CLASSES,
  isLatencyClass,
  isSourceCapabilities,
  isSourceDescriptor,
  validateSourceDescriptor,
  isDeclaredChannel,
  isDeclaredCapability,
  isDeclaredDeliverableKind,
  isDeclaredVerificationKind,
} from './descriptors';

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

// The capability-provider LANGUAGE layer (mirror of @tradrl/capability-provider)
export type {
  ProviderErrorCode,
  ProviderError,
  ProviderResult,
  Brand,
  JsonValue as ProviderJsonValue,
  JsonObject as ProviderJsonObject,
  TimestampMs as ProviderTimestampMs,
  ProviderRef,
  ProviderDeclarationId,
  CapabilityRequestId,
  ProviderQuoteId,
  EngagementId,
  DeliverableId,
  ProviderVerificationReportId,
  CapabilityKey,
  TenantId,
  ProjectId,
  CapabilityGapId,
  AttainmentEvidenceRef,
  EvidenceRef,
  SkillRecordId,
  SkillArtifactRef,
  EnvironmentProfileRef,
  InstrumentClassRef,
  ExtractionVersionRef,
  LabelEvidenceKeyMirror,
  CapabilityEvidenceKindMirror,
  MeasurementMetricMirror,
  BenchmarkEvidenceMirror,
  MeasurementRecordEvidenceMirror,
  ResultRefEvidenceMirror,
  MeasuredEvidenceMirror,
  SkillOriginMirror,
  SkillApplicabilityMirror,
  CapabilityGapMirror,
  CapabilityGapKindMirror,
} from './provider';
export {
  PROVIDER_ERROR_CODES,
  isProviderErrorCode,
  isRecord as isProviderRecord,
  isNonEmptyString as isProviderNonEmptyString,
  isJsonValue as isProviderJsonValue,
  isJsonObject as isProviderJsonObject,
  deepFreeze as deepFreezeProvider,
  deepCloneJson,
  canonicalJson,
  stableDigest,
  stableDigestJson,
  isDigest,
  fnv1a32Hex,
  EXCHANGE_ID_PATTERN,
  isProviderRef,
  isProviderDeclarationId,
  isCapabilityRequestId,
  isProviderQuoteId,
  isEngagementId,
  isDeliverableId,
  isProviderVerificationReportId,
  isCapabilityKey,
  isTenantId,
  isProjectId,
  isCapabilityGapId,
  isAttainmentEvidenceRef,
  isEvidenceRef,
  isSkillRecordId,
  isSkillArtifactRef,
  isEnvironmentProfileRef,
  isInstrumentClassRef,
  isExtractionVersionRef,
  deriveProviderDeclarationId,
  deriveCapabilityRequestId,
  deriveProviderQuoteId,
  deriveEngagementId,
  deriveDeliverableId,
  deriveProviderVerificationReportId,
  LABEL_EVIDENCE_KEYS_MIRROR,
  isLabelEvidenceKeyMirror,
  labelKeyPaths,
  CAPABILITY_EVIDENCE_KINDS_MIRROR,
  isCapabilityEvidenceKindMirror,
  MEASUREMENT_METRICS_MIRROR,
  isMeasurementMetricMirror,
  isMeasuredEvidenceMirror,
  isSkillOriginMirror,
  isSkillApplicabilityMirror,
  CAPABILITY_GAP_KINDS_MIRROR,
  isCapabilityGapKindMirror,
  isCapabilityGapMirror,
} from './provider';

// The capability-provider ENVELOPE layer (mirror of @tradrl/capability-provider)
export type {
  DeliverableKind,
  VerificationKind,
  VerificationRequirement,
  VerificationOutcome,
  VerificationVerdict,
  ProviderVerificationReport,
  ProviderCapabilityOffer,
  ProviderDeclaration,
  ProviderDeclarationDraft,
  CapabilityRequest,
  CapabilityRequestDraft,
  ProviderTerms,
  ProviderQuote,
  DeclarationQuoteView,
  EngagementStatus,
  Engagement,
  ProviderClaim,
  Deliverable,
} from './provider-envelopes';
export {
  DELIVERABLE_KINDS,
  isDeliverableKind,
  VERIFICATION_KINDS,
  isVerificationKind,
  isVerificationRequirement,
  verificationContractProblems,
  isVerificationOutcome,
  isVerificationVerdict,
  isProviderVerificationReport,
  verdictOf,
  coverageProblems,
  isProviderCapabilityOffer,
  isProviderDeclaration,
  validateProviderDeclaration,
  declarationIdentityContent,
  isCapabilityRequest,
  validateCapabilityRequest,
  requestIdentityContent,
  isProviderTerms,
  isProviderQuote,
  quoteMatchProblems,
  validateProviderQuoteDraft,
  ENGAGEMENT_TRANSITIONS,
  isEngagementStatus,
  isLegalTransition,
  isEngagement,
  isProviderClaim,
  isDeliverable,
  validateDeliverable,
} from './provider-envelopes';

// The T041 job projection (the localization boundary)
export type { CapabilityRequestJobPayload } from './provider-jobs';
export {
  CAPABILITY_REQUEST_JOB_OPERATION,
  capabilityRequestJobPayload,
  narrowCapabilityRequestJobPayload,
  capabilityRequestJobIdempotencyKey,
  IDEMPOTENCY_KEY_PATTERN_MIRROR,
  isValidIdempotencyKeyMirror,
  deriveIdempotencyKeyMirror,
} from './provider-jobs';

// Mapping tables
export type {
  EnvelopeKind,
  FieldTransform,
  StructuredKind,
  StructuredCarry,
  ConstantField,
  ComputedField,
  InstantPolicy,
  FieldMapping,
  MappingTable,
  MappingTableValidation,
  MappingContext,
  MappingOutcome,
} from './mapping';
export {
  ENVELOPE_KINDS,
  isEnvelopeKind,
  SESSION_INJECTED_FIELDS,
  canonicalEnvelopeFields,
  isFieldTransform,
  STRUCTURED_KINDS,
  isStructuredKind,
  isComputedField,
  isInstantPolicy,
  accountedRawFields,
  validateMappingTable,
  applyMappingTable,
} from './mapping';

// Adapter session
export type {
  SessionState,
  AdapterRef,
  ChannelSubscription,
  AdapterSessionConfig,
  MintedEnvelope,
  EmittedEnvelope,
  EnvelopeHandler,
  AdapterSession,
  SessionConstruction,
} from './session';
export { createAdapterSession, narrowRoutedRequest, isAnnouncedEngagement } from './session';
