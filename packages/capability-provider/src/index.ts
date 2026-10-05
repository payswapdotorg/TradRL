/**
 * @tradrl/capability-provider — public API.
 *
 * Owning Work Order: T045 (frozen write surface: packages/capability-provider).
 *
 * The provider-neutral capability-provider interface — the typed
 * contract through which EXTERNAL capability providers (human experts,
 * specialist firms, T046 arena adapters, T047 marketplace vendors) plug
 * their capabilities into the platform, speaking the same integrity
 * language the internal services use:
 *
 *   - provider DECLARATIONS: offered capability contracts in T017's
 *     language, MEASURED evidence per L16a (never profession labels),
 *     versioned and append-only (the supersede history);
 *   - ENGAGEMENT ENVELOPES: capability request -> provider quote ->
 *     engagement -> deliverable, with the verification contract frozen
 *     at request time (goalposts never move) and the deadline as a
 *     typed gate;
 *   - DELIVERABLE + VERIFICATION contracts: typed outcome coverage over
 *     the frozen contract, the verdict a pure fold (code, never
 *     prompts — L20), rejected deliverables retained (reproducibility);
 *   - TYPED PROVIDER ERRORS: a closed, machine-checkable vocabulary
 *     located by dotted paths;
 *   - PROVENANCE: content-addressed ids everywhere, an append-only
 *     chain-verified exchange log per tenant (L12), and the L18
 *     local-import path (a verified capability artifact becomes a
 *     T017-consumable imported-artifact SkillRecord draft whose
 *     attainment evidence IS the platform's verification report).
 *
 * Arena is OPTIONAL (L17): this interface is the seam external
 * expertise enters through; the native loop works without it.
 *
 * Package laws (mirroring the merged lanes):
 * - Zero runtime dependencies; pure data and pure functions only.
 * - No `any`; every exported shape has a hand-rolled total type guard.
 * - No ambient clock (`Date.now()` never appears) and no ambient
 *   randomness — every id is content-addressed (L9/determinism).
 * - Cross-lane shapes (T017 skills, T041 sdk/api) are STRUCTURAL
 *   MIRRORS (D-003/D-004) — src/interop.test.ts is the drift trip
 *   wire; the runtime code imports none of them.
 */

// Errors and results
export type { ProviderErrorCode, ProviderError, ProviderResult } from './errors';
export {
  PROVIDER_ERROR_CODES,
  API_BOUNDARY_ERROR_FAMILY_OF,
  isProviderErrorCode,
  fail,
  failures,
  ok,
  missingField,
  invalidField,
  invalidType,
} from './errors';

// Structural primitives (deepFreeze discipline, JSON model, digests)
export type { Brand, JsonValue, JsonObject } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeInteger,
  isPositiveInteger,
  isMemberOf,
  isArrayOf,
  deepFreeze,
  isDeeplyFrozen,
  deepCloneJson,
  isJsonValue,
  isJsonObject,
  canonicalJson,
  stableDigest,
  stableDigestJson,
  isDigest,
  fnv1a32Hex,
} from './primitives';

// TimestampMs mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './primitives';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs, timestampMs } from './primitives';

// Ids (owned exchange spaces + opaque cross-lane mirrors)
export type {
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
} from './ids';
export {
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
} from './ids';

// The T017 + T041 structural mirrors (D-003/D-004 — never imports)
export type {
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
  JobKindMirror,
  JobStatusMirror,
  JobRecordMirror,
  PageMirror,
  SdkErrorFamilyMirror,
  MirrorJsonValue,
} from './mirrors';
export {
  LABEL_EVIDENCE_KEYS_MIRROR,
  CAPABILITY_EVIDENCE_KINDS_MIRROR,
  MEASUREMENT_METRICS_MIRROR,
  SKILL_ORIGINS_MIRROR,
  CAPABILITY_GAP_KINDS_MIRROR,
  JOB_KINDS_MIRROR,
  JOB_STATUSES_MIRROR,
  SDK_ERROR_FAMILIES_MIRROR,
  IDEMPOTENCY_KEY_PATTERN_MIRROR,
  isLabelEvidenceKeyMirror,
  labelKeyPaths,
  isCapabilityEvidenceKindMirror,
  isMeasurementMetricMirror,
  isMeasuredEvidenceMirror,
  isSkillOriginMirror,
  isSkillApplicabilityMirror,
  isCapabilityGapKindMirror,
  isCapabilityGapMirror,
  isJobKindMirror,
  isJobStatusMirror,
  isJobRecordMirror,
  isSdkErrorFamilyMirror,
  isValidIdempotencyKeyMirror,
  deriveIdempotencyKeyMirror,
} from './mirrors';

// The provider declaration (the versioned capability catalogue)
export type { ProviderCapabilityOffer, ProviderDeclaration, ProviderDeclarationDraft } from './declaration';
export {
  isProviderCapabilityOffer,
  isProviderDeclaration,
  validateProviderDeclaration,
  declarationIdentityContent,
  createProviderDeclaration,
  supersedeProviderDeclaration,
} from './declaration';

// The verification contract (the frozen goalposts + the typed verdict)
export type {
  VerificationKind,
  VerificationRequirement,
  VerificationOutcome,
  VerificationVerdict,
  ProviderVerificationReport,
} from './verification';
export {
  VERIFICATION_KINDS,
  isVerificationKind,
  isVerificationRequirement,
  verificationContractProblems,
  isVerificationOutcome,
  isVerificationVerdict,
  isProviderVerificationReport,
  verdictOf,
  coverageProblems,
  mintVerificationReport,
  validateVerificationReport,
} from './verification';

// The engagement envelopes (request / quote / engagement / deliverable)
export type {
  DeliverableKind,
  CapabilityRequest,
  CapabilityRequestDraft,
  ProviderTerms,
  ProviderQuote,
  DeclarationQuoteView,
  EngagementStatus,
  Engagement,
  ProviderClaim,
  Deliverable,
} from './engagement';
export {
  DELIVERABLE_KINDS,
  isDeliverableKind,
  isCapabilityRequest,
  validateCapabilityRequest,
  requestIdentityContent,
  isProviderTerms,
  isProviderQuote,
  quoteMatchProblems,
  ENGAGEMENT_TRANSITIONS,
  isEngagementStatus,
  isLegalTransition,
  isEngagement,
  isProviderClaim,
  isDeliverable,
  validateDeliverable,
} from './engagement';

// The exchange (the append-only, chain-verified state machine)
export type {
  ExchangeLogKind,
  ExchangeLogEntry,
  ProviderExchangeState,
  ProviderExchangeView,
  ExchangeOperationResult,
  VerificationOperationResult,
} from './exchange';
export {
  EXCHANGE_LOG_KINDS,
  GENESIS_CHAIN_HEAD,
  createProviderExchange,
  verifyExchangeChain,
  providerExchangeView,
  serializeProviderExchange,
  providerExchangeDigest,
  registerProviderDeclaration,
  issueCapabilityRequest,
  submitProviderQuote,
  openEngagement,
  liveEngagementFor,
  submitDeliverable,
  verifyDeliverable,
  withdrawEngagement,
} from './exchange';

// The L18 local-import path + the T041 job projection
export type { ImportedSkillRecordDraft, CapabilityRequestJobPayload } from './localize';
export {
  IMPORT_PROTOCOL_VERSION,
  importAsSkillRecordDraft,
  CAPABILITY_REQUEST_JOB_OPERATION,
  capabilityRequestJobPayload,
  narrowCapabilityRequestJobPayload,
  capabilityRequestJobIdempotencyKey,
} from './localize';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/capability-provider',
  owner: 'T045',
  status: 'implemented',
  concepts: [
    'ProviderDeclaration',
    'CapabilityRequest',
    'ProviderQuote',
    'Engagement',
    'Deliverable',
    'VerificationReport',
    'ProviderExchange',
    'ImportedSkillRecordDraft',
  ],
} as const;
