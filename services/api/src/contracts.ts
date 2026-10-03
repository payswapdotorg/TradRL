// @tradrl/api-service — THE BOUNDARY'S OWN ROUTE CONTRACTS.
//
// The versioned public-plane route contracts (/v1/...) and the private
// service-to-service contracts (/internal/...): the request/response
// shapes, the wire envelope, the pagination discipline and the API
// version negotiation surface. THIS module is the contract the SDK
// (packages/sdk) mirrors STRUCTURALLY — same names, same shapes — and
// the SDK's interop test is the drift trip wire (D-003/D-004 law).
//
// THE PLANE LAW (Work Order): two strictly separated planes —
//   - PUBLIC: versioned /v1 routes for tenant/project/goal
//     management, organization status/watch reads, research + learning
//     job submission ROUTES (async submitted/running/complete), firm-
//     knowledge READ queries, outcome/evidence reads, and execution
//     REQUESTS (forwarded through the T040 gateway, never executed);
//   - PRIVATE: /internal routes for the control-plane and
//     agent-runtime services on a SEPARATE auth plane — a public
//     token hitting a private route is the typed 403
//     `wrong_auth_plane`.
//
// THE VERSION LAW: the path's version prefix is the contract version;
// an unsupported prefix is the typed `unsupported_version` naming the
// served versions. `GET /v1/meta` is the negotiation surface.
//
// Spec anchors: R43 (developer API/SDK), R41 (usage accounting hooks),
// R29 (provider-neutral shapes — no vendor specifics at this
// boundary, L13/L14), L8/L12/L20.

import { deepFreeze } from './primitives';
import type { ApiError } from './errors';
import { isApiError } from './errors';
import type { IdempotencyKey, JobId, OrganizationRef, ProjectId, RequestId, TenantId } from './ids';
import { isIdempotencyKey, isJobId, isOrganizationRef, isProjectId, isRequestId, isTenantId } from './ids';
import type {
  ConstraintSetStatement,
  GoalStatement,
  KnowledgeQueryOptions,
  ProjectLifecycleEvent,
  ProjectRecord,
  Scope,
  StrategyIntent,
} from './mirrors';
import {
  isGoalStatement,
  isConstraintSetStatement,
  isProjectLifecycleEvent,
  isProjectRecord,
  isStrategyIntent,
} from './mirrors';
import type { OutcomeQuery, OutcomeQueryOptions, PostMortemQuery } from './mirrors-outcomes';
import { isOutcomeQuery, isOutcomeQueryOptions, isPostMortemQuery } from './mirrors-outcomes';
import { isRecord, isNonEmptyString, isNonNegativeSafeInteger, isPositiveSafeInteger, isTimestampMs, isJsonValue } from './primitives';

// ---------------------------------------------------------------------------
// The API version surface
// ---------------------------------------------------------------------------

/** The served API versions (the path-prefix contract versions). */
export const API_VERSIONS = ['v1'] as const;

/** One served API version. */
export type ApiVersion = (typeof API_VERSIONS)[number];

/** The current (newest) served version. */
export const CURRENT_API_VERSION: ApiVersion = 'v1';

/** Guard: a served API version. */
export function isApiVersion(v: unknown): v is ApiVersion {
  return typeof v === 'string' && (API_VERSIONS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The wire envelope (every response)
// ---------------------------------------------------------------------------

/** The headers of one request (the boundary's wire discipline: auth, idempotency, version). */
export interface ApiRequestHeaders {
  /** `Authorization: Bearer <token>` — the credential token (public or internal plane). */
  readonly authorization?: string;
  /** The caller's idempotency key (REQUIRED on consequential routes). */
  readonly 'idempotency-key'?: string;
}

/** The headers of one response. */
export interface ApiResponseHeaders {
  /** The served request's id (echoed in the body envelope too). */
  readonly 'x-request-id'?: string;
  /** The retry signal of a rate-limited response (ms). */
  readonly 'retry-after-ms'?: string;
  /** `true` when a consequential route replayed the ORIGINAL result. */
  readonly 'x-idempotent-replay'?: string;
  /** The served contract version. */
  readonly 'x-api-version'?: string;
}

/** One request crossing the boundary. EVERY field is untrusted input (SECURITY.md). */
export interface ApiRequest {
  readonly method: string;
  /** The full path incl. the version prefix (`/v1/projects`, `/internal/jobs/transitions`). */
  readonly path: string;
  readonly headers: ApiRequestHeaders;
  /** Query-string parameters (parsed by the host; still untrusted). */
  readonly query?: Readonly<Record<string, string>>;
  /** The JSON body (unvalidated until the pipeline's validation stage). */
  readonly body?: unknown;
}

/** Guard: an API request (structural — the body stays unvalidated by design). */
export function isApiRequest(v: unknown): v is ApiRequest {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.method)) return false;
  if (!isNonEmptyString(v.path)) return false;
  if (!isRecord(v.headers)) return false;
  if (v.headers.authorization !== undefined && !isNonEmptyString(v.headers.authorization)) return false;
  if (v.headers['idempotency-key'] !== undefined && !isNonEmptyString(v.headers['idempotency-key'])) return false;
  if (v.query !== undefined && !isRecord(v.query)) return false;
  return true;
}

/** The success envelope of every 2xx response. */
export interface ApiSuccessBody<T> {
  readonly requestId: RequestId;
  readonly data: T;
}

/** The error envelope of every non-2xx response. */
export interface ApiErrorBody {
  readonly requestId: RequestId;
  readonly error: ApiError;
}

/** One response leaving the boundary. */
export interface ApiResponse {
  readonly status: number;
  readonly headers: ApiResponseHeaders;
  readonly body: ApiSuccessBody<unknown> | ApiErrorBody | null;
}

/** Guard: a response (the envelope discipline). */
export function isApiResponse(v: unknown): v is ApiResponse {
  if (!isRecord(v)) return false;
  if (!isPositiveSafeInteger(v.status)) return false;
  if (!isRecord(v.headers)) return false;
  if (v.body !== null) {
    if (!isRecord(v.body)) return false;
    if (!isRequestId(v.body.requestId)) return false;
    if ('error' in v.body) return isApiError(v.body.error);
    return 'data' in v.body;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pagination (the listing discipline)
// ---------------------------------------------------------------------------

/** The page-size law: 1..100 items per page. */
export const MAX_PAGE_SIZE = 100;

/** One page of a listing. */
export interface Page<T> {
  readonly items: readonly T[];
  /** The next page's cursor; absent on the last page. */
  readonly nextCursor?: string;
}

/** Guard: a page (structural). */
export function isPage<T>(v: unknown, itemGuard: (item: unknown) => item is T): v is Page<T> {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.items) || !v.items.every((item) => itemGuard(item))) return false;
  if (v.nextCursor !== undefined && !isNonEmptyString(v.nextCursor)) return false;
  return true;
}

/** The pagination parameters of a listing request. */
export interface PaginationParams {
  /** The previous page's `nextCursor` (opaque). */
  readonly cursor?: string;
  /** Page size, 1..100 (default 50). */
  readonly limit?: number;
}

/** Guard: pagination parameters. */
export function isPaginationParams(v: unknown): v is PaginationParams {
  if (v === undefined) return true;
  if (!isRecord(v)) return false;
  if (v.cursor !== undefined && !isNonEmptyString(v.cursor)) return false;
  if (v.limit !== undefined && !(isPositiveSafeInteger(v.limit) && (v.limit as number) <= MAX_PAGE_SIZE)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Route families (the permission vocabulary — public and private)
// ---------------------------------------------------------------------------

/** The public route families (the authz permission vocabulary of the public plane). */
export const PUBLIC_ROUTE_FAMILIES = [
  'meta:read',
  'projects:read',
  'projects:write',
  'knowledge:read',
  'outcomes:read',
  'jobs:read',
  'jobs:write',
  'execution:write',
  'organizations:read',
] as const;

/** One public route family. */
export type PublicRouteFamily = (typeof PUBLIC_ROUTE_FAMILIES)[number];

/** The private route families (the internal services' permission vocabulary). */
export const PRIVATE_ROUTE_FAMILIES = [
  'internal:organizations:write',
  'internal:jobs:write',
  'internal:usage:read',
] as const;

/** One private route family. */
export type PrivateRouteFamily = (typeof PRIVATE_ROUTE_FAMILIES)[number];

/** One route family of either plane. */
export type RouteFamily = PublicRouteFamily | PrivateRouteFamily;

/** Guard: a public route family. */
export function isPublicRouteFamily(v: unknown): v is PublicRouteFamily {
  return typeof v === 'string' && (PUBLIC_ROUTE_FAMILIES as readonly string[]).includes(v);
}

/** Guard: a private route family. */
export function isPrivateRouteFamily(v: unknown): v is PrivateRouteFamily {
  return typeof v === 'string' && (PRIVATE_ROUTE_FAMILIES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The job contracts (the async submitted/running/complete pattern)
// ---------------------------------------------------------------------------

/** The job kinds this boundary routes (the platform's job shapes — the machinery is NOT this lane's). */
export const JOB_KINDS = ['research', 'learning'] as const;

/** One job kind. */
export type JobKind = (typeof JOB_KINDS)[number];

/** Guard: a job kind. */
export function isJobKind(v: unknown): v is JobKind {
  return typeof v === 'string' && (JOB_KINDS as readonly string[]).includes(v);
}

/** The job status vocabulary (the async pattern's states). */
export const JOB_STATUSES = ['submitted', 'running', 'complete', 'failed'] as const;

/** One job status. */
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Guard: a job status. */
export function isJobStatus(v: unknown): v is JobStatus {
  return typeof v === 'string' && (JOB_STATUSES as readonly string[]).includes(v);
}

/** The request body of a job submission (research or learning). `spec` is the job lane's own spec shape — opaque passthrough. */
export interface SubmitJobRequest {
  readonly kind: JobKind;
  readonly projectId: ProjectId;
  /** The job specification (opaque to the boundary — the job machinery owns its semantics; JSON only). */
  readonly spec: unknown;
}

/** Guard: a job submission request. */
export function isSubmitJobRequest(v: unknown): v is SubmitJobRequest {
  if (!isRecord(v)) return false;
  if (!isJobKind(v.kind)) return false;
  if (!isProjectId(v.projectId)) return false;
  if (!isJsonValue(v.spec)) return false;
  return true;
}

/** The job record as the boundary serves it (the platform's job shape at this surface). */
export interface JobRecord {
  readonly jobId: JobId;
  readonly kind: JobKind;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly status: JobStatus;
  readonly submittedAt: number;
  /** Present when complete/failed: the job lane's own result/failure record (opaque JSON). */
  readonly result?: unknown;
  readonly completedAt?: number;
}

/** Guard: a job record. */
export function isJobRecord(v: unknown): v is JobRecord {
  if (!isRecord(v)) return false;
  if (!isJobId(v.jobId)) return false;
  if (!isJobKind(v.kind)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!isJobStatus(v.status)) return false;
  if (!isTimestampMs(v.submittedAt)) return false;
  if (v.result !== undefined && !isJsonValue(v.result)) return false;
  if (v.completedAt !== undefined && !isTimestampMs(v.completedAt)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The public route request/response contracts
// ---------------------------------------------------------------------------

/** `GET /v1/meta` — the version-negotiation + capability surface. */
export interface ApiMeta {
  readonly apiVersion: ApiVersion;
  readonly supportedVersions: readonly ApiVersion[];
  readonly routeFamilies: readonly PublicRouteFamily[];
}

/** Guard: the meta payload. */
export function isApiMeta(v: unknown): v is ApiMeta {
  if (!isRecord(v)) return false;
  if (!isApiVersion(v.apiVersion)) return false;
  if (!Array.isArray(v.supportedVersions) || !v.supportedVersions.every((x) => isApiVersion(x))) return false;
  if (!Array.isArray(v.routeFamilies) || !v.routeFamilies.every((x) => isPublicRouteFamily(x))) return false;
  return true;
}

/** `POST /v1/projects` — create a project (the control-plane shapes, mirrored; tenant injected from the credential). */
export interface CreateProjectRequest {
  readonly id: ProjectId;
  readonly name: string;
  readonly executionMode: string;
  readonly goal: GoalStatement;
  readonly constraintSet: ConstraintSetStatement;
  /** The creation instant (epoch ms — injected by convention; the caller supplies it, the control plane stamps it). */
  readonly at: number;
}

/** Guard: a create-project request. */
export function isCreateProjectRequest(v: unknown): v is CreateProjectRequest {
  if (!isRecord(v)) return false;
  if (!isProjectId(v.id)) return false;
  if (!isNonEmptyString(v.name)) return false;
  if (typeof v.executionMode !== 'string' || !['simulation', 'shadow', 'live'].includes(v.executionMode)) return false;
  if (!isGoalStatement(v.goal)) return false;
  if (!isConstraintSetStatement(v.constraintSet)) return false;
  if (!isTimestampMs(v.at)) return false;
  return true;
}

/** `POST /v1/projects/:projectId/lifecycle` — apply a lifecycle event. */
export interface TransitionProjectRequest {
  readonly event: ProjectLifecycleEvent;
  readonly at: number;
}

/** Guard: a transition request. */
export function isTransitionProjectRequest(v: unknown): v is TransitionProjectRequest {
  return isRecord(v) && isProjectLifecycleEvent(v.event) && isTimestampMs(v.at);
}

/** `POST /v1/projects/:projectId/organization` — bind an organization. */
export interface BindOrganizationRequest {
  readonly organizationRef: OrganizationRef;
  readonly at: number;
}

/** Guard: a bind-organization request. */
export function isBindOrganizationRequest(v: unknown): v is BindOrganizationRequest {
  return isRecord(v) && isOrganizationRef(v.organizationRef) && isTimestampMs(v.at);
}

/** The transition response: the next record plus the emitted effects (the control plane's shapes). */
export interface TransitionProjectResponse {
  readonly record: ProjectRecord;
  readonly effects: readonly unknown[];
}

/** Guard: a transition response. */
export function isTransitionProjectResponse(v: unknown): v is TransitionProjectResponse {
  return isRecord(v) && isProjectRecord(v.record) && Array.isArray(v.effects);
}

/** `POST /v1/knowledge/query` — the firm-knowledge point-in-time READ query (T034 shapes; tenant injected). */
export interface KnowledgeQueryRequest {
  readonly project: string;
  readonly at: number;
  readonly activeOnly?: boolean;
  readonly kinds?: readonly string[];
  readonly polarity?: string;
  readonly dimension?: string;
  readonly lagBand?: string;
  readonly minEvidenceCount?: number;
  readonly minConfidence?: string;
  readonly knowledgeId?: string;
}

/** Guard: a knowledge-query request. */
export function isKnowledgeQueryRequest(v: unknown): v is KnowledgeQueryRequest {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.project)) return false;
  if (!isTimestampMs(v.at)) return false;
  if (v.activeOnly !== undefined && typeof v.activeOnly !== 'boolean') return false;
  if (v.kinds !== undefined && !(Array.isArray(v.kinds) && v.kinds.every((x) => typeof x === 'string' && x.length > 0))) return false;
  if (v.polarity !== undefined && !isNonEmptyString(v.polarity)) return false;
  if (v.dimension !== undefined && !isNonEmptyString(v.dimension)) return false;
  if (v.lagBand !== undefined && !isNonEmptyString(v.lagBand)) return false;
  if (v.minEvidenceCount !== undefined && !isPositiveSafeInteger(v.minEvidenceCount)) return false;
  if (v.minConfidence !== undefined && !isNonEmptyString(v.minConfidence)) return false;
  if (v.knowledgeId !== undefined && !isNonEmptyString(v.knowledgeId)) return false;
  return true;
}

/** The knowledge-query response page. */
export interface KnowledgeQueryResponse extends Page<unknown> {
  /** The query instant the serving projection ran at (echoed — L4's evidence). */
  readonly at: number;
}

/** `POST /v1/outcomes/query` — the outcome READ query (T033 shapes; tenant injected). */
export interface OutcomeQueryRequest extends Omit<OutcomeQuery, 'tenant'> {
  readonly at: number;
}

/** Guard: an outcome-query request. */
export function isOutcomeQueryRequest(v: unknown): v is OutcomeQueryRequest {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.project)) return false;
  if (!isTimestampMs(v.at)) return false;
  return isOutcomeQuery({ tenant: 'probe', project: v.project as string, decisionRef: v.decisionRef, intentRef: v.intentRef, outcomeClass: v.outcomeClass, sessionRef: v.sessionRef, outcomeRecordRef: v.outcomeRecordRef });
}

/** `POST /v1/post-mortems/query` — the evidence READ query (T033 shapes; tenant injected). */
export interface PostMortemQueryRequest extends Omit<PostMortemQuery, 'tenant'> {
  readonly at: number;
  readonly latestPerOutcome?: boolean;
}

/** Guard: a post-mortem-query request. */
export function isPostMortemQueryRequest(v: unknown): v is PostMortemQueryRequest {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.project)) return false;
  if (!isTimestampMs(v.at)) return false;
  if (v.latestPerOutcome !== undefined && typeof v.latestPerOutcome !== 'boolean') return false;
  return isPostMortemQuery({ tenant: 'probe', project: v.project as string, decisionRef: v.decisionRef, outcomeRecordRef: v.outcomeRecordRef, attributionClass: v.attributionClass });
}

/** `POST /v1/execution/requests` — THE L8 route: the execution REQUEST (a StrategyIntent, forwarded through the gateway). */
export interface ExecutionRequest {
  readonly intent: StrategyIntent;
}

/** Guard: an execution request (ONLY an intent — decisions/gateway-order-requests are gate-bypass attempts). */
export function isExecutionRequest(v: unknown): v is ExecutionRequest {
  return isRecord(v) && isStrategyIntent(v.intent);
}

// ---------------------------------------------------------------------------
// The organization status contracts (watch reads)
// ---------------------------------------------------------------------------

/** The organization's operating status vocabulary (the watch surface's states). */
export const ORGANIZATION_STATUSES = ['forming', 'active', 'suspended', 'terminated'] as const;

/** One organization status. */
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/** Guard: an organization status. */
export function isOrganizationStatus(v: unknown): v is OrganizationStatus {
  return typeof v === 'string' && (ORGANIZATION_STATUSES as readonly string[]).includes(v);
}

/** One organization status snapshot as the watch surface serves it (written by the agent runtime through the private plane). */
export interface OrgStatusSnapshot {
  readonly organizationRef: OrganizationRef;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly status: OrganizationStatus;
  /** The snapshot instant (epoch ms — the reporting service's injected instant). */
  readonly at: number;
  /** The reporting agent-runtime's opaque instance refs (counts by role are the referent's own concern). */
  readonly instanceRefs: readonly string[];
}

/** Guard: an organization status snapshot. */
export function isOrgStatusSnapshot(v: unknown): v is OrgStatusSnapshot {
  if (!isRecord(v)) return false;
  if (!isOrganizationRef(v.organizationRef)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!isOrganizationStatus(v.status)) return false;
  if (!isTimestampMs(v.at)) return false;
  if (!Array.isArray(v.instanceRefs) || !v.instanceRefs.every((x) => isNonEmptyString(x))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The private-plane contracts
// ---------------------------------------------------------------------------

/** `POST /internal/organizations/status` — the agent runtime's status report. */
export interface InternalOrgStatusRequest {
  readonly snapshot: OrgStatusSnapshot;
}

/** Guard: an internal org-status report. */
export function isInternalOrgStatusRequest(v: unknown): v is InternalOrgStatusRequest {
  return isRecord(v) && isOrgStatusSnapshot(v.snapshot);
}

/** `POST /internal/jobs/transitions` — the job machinery's lifecycle report. */
export interface InternalJobTransitionRequest {
  readonly jobId: JobId;
  readonly status: JobStatus;
  /** Present when complete/failed. */
  readonly result?: unknown;
  readonly at: number;
}

/** Guard: an internal job-transition report. */
export function isInternalJobTransitionRequest(v: unknown): v is InternalJobTransitionRequest {
  if (!isRecord(v)) return false;
  if (!isJobId(v.jobId)) return false;
  if (!isJobStatus(v.status)) return false;
  if (v.result !== undefined && !isJsonValue(v.result)) return false;
  if (!isTimestampMs(v.at)) return false;
  return true;
}

/** `GET /internal/usage/:tenantId` — the usage/metering read (the R41 fact surface for T047's entitlements). */
export interface InternalUsageResponse {
  readonly tenant: TenantId;
  readonly totalRequests: number;
  /** Per-route-family counts (deterministic key order at serialization). */
  readonly byRoute: Readonly<Record<string, number>>;
}

/** Guard: an internal usage response. */
export function isInternalUsageResponse(v: unknown): v is InternalUsageResponse {
  if (!isRecord(v)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isNonNegativeSafeInteger(v.totalRequests)) return false;
  if (!isRecord(v.byRoute)) return false;
  return Object.values(v.byRoute).every((x) => isNonNegativeSafeInteger(x));
}

// ---------------------------------------------------------------------------
// The tenant-context law (L12 — the injection contract)
// ---------------------------------------------------------------------------

/**
 * The tenant context the pipeline injects: the acting credential's
 * tenant (developer plane) or the internal request's declared scope.
 * The tenant is NEVER trusted from a request body — a body carrying a
 * tenant that disagrees with the injected context is the typed
 * `cross_tenant_access` at the routing layer.
 */
export interface TenantContext {
  readonly tenant: TenantId;
  /** The project scope when the route is project-scoped (from the path/body, validated against the tenant's data). */
  readonly project?: ProjectId;
  /** The acting credential's id (audit/metering who). */
  readonly credentialId: string;
}

/** Guard: a tenant context. */
export function isTenantContext(v: unknown): v is TenantContext {
  if (!isRecord(v)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (v.project !== undefined && !isProjectId(v.project)) return false;
  if (!isNonEmptyString(v.credentialId)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Idempotency (the consequential-route law)
// ---------------------------------------------------------------------------

/** Extract the idempotency key from a request's headers (absent -> null). */
export function idempotencyKeyOf(request: ApiRequest): IdempotencyKey | null {
  const raw = request.headers['idempotency-key'];
  if (raw === undefined) return null;
  return isIdempotencyKey(raw) ? raw : null;
}

/** The replay marker carried by a deduped consequential response. */
export const IDEMPOTENT_REPLAY_HEADER = 'x-idempotent-replay';

deepFreeze(API_VERSIONS);
deepFreeze(PUBLIC_ROUTE_FAMILIES);
deepFreeze(PRIVATE_ROUTE_FAMILIES);
deepFreeze(JOB_KINDS);
deepFreeze(JOB_STATUSES);
deepFreeze(ORGANIZATION_STATUSES);

// Re-export the serving-scope types the contracts reference (one import surface).
export type { KnowledgeQuery, KnowledgeQueryOptions, Scope, StrategyIntent, ProjectRecord, ServedKnowledge, GatewaySubmissionRecord } from './mirrors';
export type { OutcomeQuery, OutcomeQueryOptions, PostMortemQuery, OutcomeRecordMirror, PostMortemRecordMirror } from './mirrors-outcomes';
export { isOutcomeQueryOptions } from './mirrors-outcomes';
