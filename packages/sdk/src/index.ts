// @tradrl/sdk — public API.
//
// Owning Work Order: T041 (frozen write surface: packages/sdk + services/api).
//
// THE TYPED DEVELOPER CLIENT (R43): zero runtime dependencies, an
// injectable fetch-compatible transport (no implementation shipped),
// the full typed resource surface mirroring the public /v1 routes
// (same names, same shapes — pinned by interop trip-wire tests
// against the REAL service), the typed ApiError hierarchy
// (auth/permission/tenant/rate-limit/validation/conflict/unavailable
// — each programmatically distinguishable), pagination/cursor
// helpers, rate-limit-aware retry/backoff, API-version negotiation
// on client init, and idempotency-key generation helpers.
//
// Cross-lane law (D-003/D-004): the request/response shapes are
// STRUCTURAL MIRRORS of @tradrl/api-service's contracts — never
// imports; src/interop.test.ts is the drift trip wire.

export const packageInfo = {
  name: '@tradrl/sdk',
  owner: 'T041',
  status: 'implemented',
  concepts: [
    'ApiTransport (injectable, fetch-compatible — no implementation shipped)',
    'TradRLClient (the typed resource surface over the public /v1 routes)',
    'ApiSdkError hierarchy (auth/permission/tenant/rate-limit/validation/conflict/unavailable)',
    'pagination/cursor helpers (bounded collectors)',
    'rate-limit-aware retry (honoring server retry signals)',
    'API-version negotiation on client init',
    'idempotency-key generation helpers (deterministic derivation + injected entropy)',
  ],
} as const;

// The transport
export type { ApiTransport, SdkRequest, SdkResponse } from './transport';
export { isSdkResponse, TransportUnavailableError } from './transport';

// The typed error taxonomy
export type { SdkErrorCode, SdkErrorFamily, SdkProblem } from './errors';
export {
  SDK_ERROR_CODES, SDK_ERROR_FAMILIES, SDK_ERROR_FAMILY_OF,
  ApiSdkError, AuthenticationError, PermissionError, TenantIsolationError,
  RateLimitError, ValidationError, ConflictError, UnavailableError,
  NotFoundError, VersionMismatchError, errorFromEnvelope, isRetryable,
} from './errors';

// The contracts (structural mirrors of the service's public contracts)
export type {
  ApiVersion, ApiSuccessBody, ApiErrorBody, Page, PaginationParams,
  ExecutionMode, CriterionPredicate, SuccessCriterion, GoalStatement,
  ConstraintStatement, ConstraintSetStatement, ProjectRecord,
  ProjectLifecycleEvent, ServedKnowledge, KnowledgeQueryRequest,
  KnowledgeQueryResponse, OutcomeQueryRequest, OutcomeRecord,
  PostMortemQueryRequest, PostMortemRecord, JobKind, JobStatus, JobRecord,
  SubmitJobRequest, OrderIntent, ExecutionRequest, StrategyIntent,
  GatewayRefusal, GatewaySubmissionRecord, OrganizationStatus,
  OrgStatusSnapshot, ApiMeta, PublicRouteFamily,
} from './contracts';
export { API_VERSIONS, CURRENT_API_VERSION, MAX_PAGE_SIZE, PUBLIC_ROUTE_FAMILIES, IDEMPOTENT_REPLAY_HEADER } from './contracts';

// The retry discipline
export type { RetryPolicy } from './retry';
export { DEFAULT_RETRY_POLICY, isRetryPolicy, retryDelayMs, withRetry } from './retry';

// The pagination helpers
export { hasNext, cursorOf, countOf, collectAll, pagesOf } from './pagination';

// The idempotency helpers
export { deriveIdempotencyKey, idempotencyKeyFromEntropy, isValidIdempotencyKey, IDEMPOTENCY_KEY_PATTERN, IdempotencyScope } from './idempotency';

// The client
export type { TradRLClient, TradRLClientConfig, ConsequentialOptions } from './client';
export { createTradRLClient, isIdempotentReplay } from './client';
