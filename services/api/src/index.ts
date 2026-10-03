// @tradrl/api-service — public API.
//
// Owning Work Order: T041 (frozen write surface: services/api + packages/sdk).
//
// THE DEVELOPER API BOUNDARY (R43): the public/private plane
// separation, the code-enforced request pipeline (authn -> authz ->
// tenant-context injection -> rate limit -> input validation ->
// handler -> audit emission -> response — L20), per-tenant per-route
// usage metering (R41 hooks, record only), idempotency on
// consequential routes, and execution REQUESTS forwarded through the
// T040 gateway shapes — NEVER executed here (L8).
//
// Cross-lane law (D-003/D-004): this service owns NO contract package
// among the frozen siblings — every composed lane's shapes are
// STRUCTURAL MIRRORS (mirrors.ts, mirrors-outcomes.ts), and
// src/interop.test.ts imports the REAL packages test-only as the
// drift trip wire. The SDK (packages/sdk) mirrors THIS service's
// contracts; its interop test is the second trip wire.

export { packageInfo } from './identity';

// Primitives, errors, ids
export type { Brand, Mutable, JsonValue, JsonObject, TimestampMs } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isUnitInterval,
  isOneOf,
  isMemberOf,
  isArrayOf,
  isIdentifierPath,
  deepFreeze,
  isDeeplyFrozen,
  deepCloneJson,
  isJsonValue,
  isJsonObject,
  canonicalJson,
  fnv1a32Hex,
  fnv1a32Int,
  stableDigest,
  isDigest,
  isTimestampMs,
  compareTimestampMs,
  isCanonicalUnsignedDecimal,
  isCanonicalSignedDecimal,
  isCanonicalPositiveDecimal,
  isUnitIntervalDecimal,
  isRfc3339Timestamp,
  CREDENTIAL_VALUE_KEY_ROOTS,
  isCredentialValueKey,
  credentialValueViolations,
} from './primitives';

export type { ApiErrorCode, ApiError, ApiProblem, ApiResult } from './errors';
export { API_ERROR_CODES, API_ERROR_STATUS, isApiErrorCode, isApiError, apiError, problem, ok, fail } from './errors';

export type {
  TenantId, ProjectId, GoalRef, ConstraintSetRef, OrganizationRef, GoalVersionRef, ConstraintSetVersionRef,
  DeveloperCredentialId, InternalCredentialId, RequestId, JobId, UsageRecordId, ApiAuditRecordId,
  OrgStatusSnapshotId, IdempotencyKey, CursorToken,
} from './ids';
export {
  isTenantId, isProjectId, isGoalRef, isConstraintSetRef, isOrganizationRef,
  isDeveloperCredentialId, isInternalCredentialId, isRequestId, isJobId, isUsageRecordId,
  isApiAuditRecordId, isOrgStatusSnapshotId, isIdempotencyKey, isCursorToken,
  mintRequestId, mintJobId, mintUsageRecordId, mintApiAuditRecordId, mintDeveloperCredentialId,
  mintInternalCredentialId, mintOrgStatusSnapshotId, mintCursorToken,
} from './ids';

// The mirrors (the composed lanes — structural, never imported)
export type {
  ExecutionMode, CriterionValue, CriterionPredicate, SuccessCriterion, GoalSuccessCriteria, GoalHorizon,
  GoalEvaluationPolicy, GoalStatement, ConstraintDomain, ConstraintSeverity, ConstraintStatement,
  ConstraintSetStatement, ProjectLifecycleStatus, ProjectLifecycleEvent, ProjectLifecycleState,
  ProjectLineage, ProjectRecord, OrderSide, CoreOrderKind, CoreTimeInForce, OrderIntentRecord,
  ConstraintCheckStatus, SatisfiedPredicateProof, ConstraintCheck, ConstraintProof, IntentReasonKind,
  IntentRationale, StrategyIntent, CheckResultRecord, ExecutionLineageRecord, ApproveDecisionRecord,
  GatewayRefusal, GatewaySubmissionRecord, KnowledgeKind, LagBand, KnowledgeClaim, KnowledgeProvenance,
  ValidityWindow, FirmKnowledgeRecord, KnowledgeQuery, KnowledgeQueryOptions, ServedKnowledge, Scope,
  PlatformAuditActorKind, AuditActor, AuditLineage, RiskPolicyRef,
} from './mirrors';
export {
  EXECUTION_MODES, isExecutionMode, isCriterionValue, isCriterionPredicate, isSuccessCriterion,
  isGoalSuccessCriteria, isGoalHorizon, isGoalEvaluationPolicy, isGoalStatement, CONSTRAINT_DOMAINS,
  isConstraintDomain, CONSTRAINT_SEVERITIES, isConstraintSeverity, isConstraintStatement,
  isConstraintSetStatement, PROJECT_LIFECYCLE_STATUSES, isProjectLifecycleStatus, PROJECT_LIFECYCLE_EVENTS,
  isProjectLifecycleEvent, isProjectLifecycleState, isProjectLineage, isProjectRecord, ORDER_SIDES,
  isOrderSide, CORE_ORDER_KINDS, isCoreOrderKind, isOrderKind, CORE_TIME_IN_FORCE, isCoreTimeInForce,
  isTimeInForce, isOrderIntentRecord, CONSTRAINT_CHECK_STATUSES, isConstraintCheckStatus,
  isSatisfiedPredicateProof, isConstraintCheck, isConstraintProof, INTENT_REASON_KINDS, isIntentReasonKind,
  isIntentRationale, INTENT_AUTHORITY_EMBEDDING_KEYS, intentAuthorityViolations, isRiskPolicyRef,
  isStrategyIntent, PRE_TRADE_CHECK_KINDS, isPreTradeCheckKind, isCheckResultRecord,
  isExecutionLineageRecord, isApproveDecisionRecord, isGatewayRefusal, isGatewaySubmissionId,
  isGatewaySubmissionRecord, KNOWLEDGE_KINDS, isKnowledgeKind, LAG_BANDS, isLagBand, CLAIM_POLARITIES,
  isClaimPolarity, DECISION_DIMENSIONS, isDecisionDimension, isKnowledgeClaim, isKnowledgeProvenance,
  isValidityWindow, isFirmKnowledgeRecord, isKnowledgeQuery, isKnowledgeQueryOptions, isServedKnowledge,
  isScope, sameScope, scopeKey, PLATFORM_AUDIT_ACTOR_KINDS, isPlatformAuditActorKind, isAuditActor,
  isAuditLineage, isOutcomeRef, isPostMortemRef,
} from './mirrors';

export type {
  OutcomeClassMirror, AttributionClassMirror, ModelErrorKindMirror, MarketMoveDirectionMirror,
  ShadowDispositionMirror, EvidenceKindMirror, EvidenceRefMirror, ShadowLineageBlockMirror,
  DecisionAttributionMirror, MarketMoveAttributionMirror, ModelErrorAttributionMirror,
  DataLagAttributionMirror, AttributionDetailMirror, AttributionHypothesisMirror,
  OutcomeExpectationMirror, OutcomeRealizationMirror, OutcomeDeviationMirror, OutcomeDecisionLinkMirror,
  ExperimentBindingMirror, OutcomeLineageMirror, OutcomeRecordMirror, PostMortemSubjectMirror,
  PostMortemExpectationMirror, PostMortemActualMirror, PostMortemGapMirror, PostMortemLineageMirror,
  PostMortemRecordMirror, OutcomeQuery, PostMortemQuery, OutcomeQueryOptions,
} from './mirrors-outcomes';
export {
  OUTCOME_CLASS_MIRRORS, isOutcomeClassMirror, ATTRIBUTION_CLASS_MIRRORS, isAttributionClassMirror,
  MODEL_ERROR_KIND_MIRRORS, isModelErrorKindMirror, isMarketMoveDirectionMirror, isShadowDispositionMirror,
  EVIDENCE_KIND_MIRRORS, isEvidenceKindMirror, isEvidenceRefMirror, isEvidenceRefList,
  isShadowLineageBlockMirror, isDecisionAttributionMirror, isMarketMoveAttributionMirror,
  isModelErrorAttributionMirror, isDataLagAttributionMirror, isAttributionHypothesisMirror,
  isOutcomeExpectationMirror, isOutcomeRealizationMirror, isOutcomeDeviationMirror,
  isOutcomeDecisionLinkMirror, isExperimentBindingMirror, isOutcomeLineageMirror, isOutcomeRecordMirror,
  isPostMortemSubjectMirror, isPostMortemExpectationMirror, isPostMortemActualMirror, isPostMortemGapMirror,
  isPostMortemLineageMirror, isPostMortemRecordMirror, isOutcomeQuery, isPostMortemQuery, isOutcomeQueryOptions,
} from './mirrors-outcomes';

// The boundary's own contracts (the SDK mirrors THESE)
export type {
  ApiVersion, ApiRequestHeaders, ApiResponseHeaders, ApiRequest, ApiErrorBody, ApiResponse,
  Page, PaginationParams, PublicRouteFamily, PrivateRouteFamily, RouteFamily, JobKind, JobStatus,
  SubmitJobRequest, JobRecord, ApiMeta, CreateProjectRequest, TransitionProjectRequest,
  BindOrganizationRequest, TransitionProjectResponse, KnowledgeQueryRequest, KnowledgeQueryResponse,
  OutcomeQueryRequest, PostMortemQueryRequest, ExecutionRequest, OrganizationStatus, OrgStatusSnapshot,
  InternalOrgStatusRequest, InternalJobTransitionRequest, InternalUsageResponse, TenantContext,
} from './contracts';
export {
  API_VERSIONS, CURRENT_API_VERSION, isApiVersion, isApiRequest, isApiResponse, MAX_PAGE_SIZE, isPage,
  isPaginationParams, PUBLIC_ROUTE_FAMILIES, PRIVATE_ROUTE_FAMILIES, isPublicRouteFamily,
  isPrivateRouteFamily, JOB_KINDS, isJobKind, JOB_STATUSES, isJobStatus, isSubmitJobRequest, isJobRecord,
  isApiMeta, isCreateProjectRequest, isTransitionProjectRequest, isBindOrganizationRequest,
  isTransitionProjectResponse, isKnowledgeQueryRequest, isOutcomeQueryRequest, isPostMortemQueryRequest,
  isExecutionRequest, ORGANIZATION_STATUSES, isOrganizationStatus, isOrgStatusSnapshot,
  isInternalOrgStatusRequest, isInternalJobTransitionRequest, isInternalUsageResponse, isTenantContext,
  idempotencyKeyOf, IDEMPOTENT_REPLAY_HEADER,
} from './contracts';

// The auth plane
export type { AuthPlane, DeveloperCredential, InternalCredential, ApiCredential, CredentialRegistration } from './auth';
export {
  AUTH_PLANES, isAuthPlane, isDeveloperCredential, isInternalCredential, isApiCredential, planeOf,
  CredentialRegistry, isCredentialRegistration, bearerTokenOf, authenticate, authorizePlane,
  authorizeRoute, developerCredentialIdFor, internalCredentialIdFor,
} from './auth';

// The pipeline stages' own contracts
export type { RateLimitPolicy } from './ratelimit';
export type { UsageRecord } from './metering';
export type { IdempotencyEntry, IdempotencyVerdict } from './idempotency';
export type { ApiAuditActionKind, ApiAuditObjectRef, ApiAuditRecord, ApiAuditRecordContent, ApiAuditRecordDraft, ApiAuditTrail } from './audit';
export type { InstantSource, ScriptedInstants } from './instants';
export type { PortFailure, PortResult, ControlPlanePort, FirmMemoryPort, OutcomeLearningPort, ExecutionGatewayPort, JobSubmissionPort } from './ports';
export type { ApiServiceState, PaginationIndex } from './pipeline';
export type { ApiServiceConfig, ApiService, ApiServiceConstruction } from './service';

// Router
export type { IdempotencyLaw, RouteDeclaration, ResolvedRoute } from './router';
export { PUBLIC_ROUTES, PRIVATE_ROUTES, ROUTES, resolveRoute, versionPrefixOf, declaredFamilies } from './router';

// The service composition root + the pipeline
export { createApiService } from './service';
export { handleApiRequest } from './pipeline';
export { createPaginationIndex } from './service';
export { scriptedInstants } from './instants';
export { RateLimiter, DEFAULT_RATE_LIMIT_POLICY, isRateLimitPolicy, rateStateCoherent } from './ratelimit';
export { UsageLedger, isUsageRecord, usageTenantConsistent, usageAggregateCoherent } from './metering';
export { IdempotencyStore, isIdempotencyEntry, bodyFingerprintOf } from './idempotency';
export {
  API_AUDIT_ACTION_KINDS, isApiAuditActionKind, isApiAuditObjectRef, isApiAuditRecord,
  apiAuditContentTree, canonicalApiAuditContentJson, isApiAuditTrail, startApiAuditTrail,
  apiAuditRecordAt, appendApiAuditRecord, verifyApiAuditChain,
} from './audit';
