// @tradrl/api-service — THE REQUEST PIPELINE (L20: in code, never prompts).
//
// THE DECLARED STAGE ORDER (the Work Order, verbatim law):
//   authn -> authz -> tenant-context injection -> rate limit ->
//   input validation -> handler -> audit emission -> response.
// EVERY failure at EVERY stage is a typed ApiError; EVERY request —
// success or failure, either plane — emits exactly one usage record
// (R41 metering); every CONSEQUENTIAL request (the route declaration
// says so: mutations + execution + job submissions + internal writes)
// emits one chain-verified audit record carrying who/what/when/
// tenant/route/consequence.
//
// THE L8 LAW (the charter's hardest): the execution handler forwards
// intents through the injected ExecutionGatewayPort and does NOTHING
// else. A direct-execution code path is the typed `gate_bypass_attempt`:
//   - submitting an APPROVE decision record as the request body
//     (authority is the GATE's output, never a caller's input);
//   - submitting a GatewayOrderRequest-shaped record ('gor:' — the
//     translation contract's output, never a caller's input);
//   - an intent embedding execution authority (the L8 authority-embedding
//     scan: grant/token/credential/permission keys).
// The gate-bypass test (execution.test.ts) fires all three.
//
// THE L12 LAW: the tenant context is INJECTED from the credential
// (public plane) or the declared internal scope (private plane) —
// NEVER trusted from a body. A declared scope that disagrees with the
// injected context is the typed `cross_tenant_access` at the routing
// layer. API-owned state (jobs, org-status snapshots) serves the
// typed error on foreign reads; backing-service reads are scoped by
// the injected tenant (foreign data is unreachable, fail-closed).
//
// Spec anchors: SECURITY.md (trust zones, untrusted input, audit),
// ARCHITECTURE-LOCK.md L8/L12/L20, R41/R43.

import {
  canonicalJson,
  credentialValueViolations,
  deepFreeze,
  fnv1a32Hex,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isRecord,
  isTimestampMs,
  type TimestampMs,
} from './primitives';
import { apiError, type ApiError } from './errors';
import type { ApiRequest, ApiResponse, ApiSuccessBody, ApiErrorBody } from './contracts';
import {
  CURRENT_API_VERSION,
  IDEMPOTENT_REPLAY_HEADER,
  MAX_PAGE_SIZE,
  isCreateProjectRequest,
  isExecutionRequest,
  isInternalJobTransitionRequest,
  isInternalOrgStatusRequest,
  isKnowledgeQueryRequest,
  isOutcomeQueryRequest,
  isPostMortemQueryRequest,
  isSubmitJobRequest,
  isTransitionProjectRequest,
  isBindOrganizationRequest,
  isApiRequest,
} from './contracts';
import type { IdempotencyKey, JobId, OrganizationRef, ProjectId, RequestId, TenantId } from './ids';
import { mintRequestId, isJobId, isOrganizationRef, isProjectId, isTenantId } from './ids';
import {
  authenticate,
  authorizePlane,
  authorizeRoute,
  planeOf,
  type ApiCredential,
  type CredentialRegistry,
  type InternalCredential,
  type DeveloperCredential,
} from './auth';
import { RateLimiter } from './ratelimit';
import { UsageLedger } from './metering';
import { IdempotencyStore } from './idempotency';
import {
  appendApiAuditRecord,
  apiAuditRecordAt,
  startApiAuditTrail,
  type ApiAuditTrail,
  type ApiAuditRecordDraft,
} from './audit';
import { resolveRoute, declaredFamilies } from './router';
import type {
  ControlPlanePort,
  ExecutionGatewayPort,
  FirmMemoryPort,
  JobSubmissionPort,
  OutcomeLearningPort,
  PortFailure,
  PortResult,
} from './ports';
import type { GatewaySubmissionRecord, Scope } from './mirrors';
import { isApproveDecisionRecord, isGatewaySubmissionRecord, intentAuthorityViolations, isStrategyIntent, isProjectRecord } from './mirrors';
import type { InstantSource } from './instants';
import { isOrgStatusSnapshot, type JobRecord, type OrgStatusSnapshot, type Page } from './contracts';
import { isJobRecord } from './contracts';

// ---------------------------------------------------------------------------
// The service state (the composition root's closure)
// ---------------------------------------------------------------------------

/** The pagination cursor registry: minted tokens -> the listing offsets they name (deterministic given the request sequence). */
export interface PaginationIndex {
  mint(family: string, offset: number): string;
  resolve(token: string): number | null;
}

/** The API service's internal state (owned by createApiService; never exposed mutable). */
export interface ApiServiceState {
  readonly registry: CredentialRegistry;
  readonly controlPlane: ControlPlanePort;
  readonly firmMemory: FirmMemoryPort;
  readonly outcomeLearning: OutcomeLearningPort;
  readonly executionGateway: ExecutionGatewayPort;
  readonly jobSubmission: JobSubmissionPort;
  readonly limiter: RateLimiter;
  readonly usage: UsageLedger;
  readonly idempotency: IdempotencyStore;
  readonly instants: InstantSource;
  /** The injected serving policy for knowledge queries (T034's retention shape — opaque here). */
  readonly knowledgeRetention: unknown;
  /** The injected retention policy for outcome/post-mortem queries (T033's shape — opaque here). */
  readonly outcomeRetention: unknown;
  /** API-owned state: the job store (jobId -> record) + org-status snapshots (orgRef/project -> snapshot). */
  readonly jobs: Map<string, JobRecord>;
  readonly orgStatus: Map<string, OrgStatusSnapshot>;
  /** Per-scope audit trails (the chain-verified consequence log). */
  readonly trails: Map<string, ApiAuditTrail>;
  /** The pagination cursor registry. */
  readonly cursors: PaginationIndex;
  /** The request counter (request-id determinism input). */
  requestCounter: number;
}

// ---------------------------------------------------------------------------
// The instant source (the no-ambient-clock law) — re-exported for the composition root
// ---------------------------------------------------------------------------

export type { InstantSource } from './instants';

// ---------------------------------------------------------------------------
// Helpers: typed-error translation of port failures
// ---------------------------------------------------------------------------

/** Translate a backing-service port failure into the boundary's typed error (deterministic mapping). */
function portFailureToError(routeName: string, failure: PortFailure): ApiError {
  switch (failure.code) {
    case 'project-not-found':
      return apiError('not_found', `no ${routeName} target exists for the requesting tenant's scope (unknown and cross-tenant are indistinguishable — L12)`);
    case 'illegal-transition':
    case 'missing-acceptance-criteria':
    case 'missing-organization-binding':
    case 'invalid-binding-state':
    case 'duplicate_decision':
      return apiError('conflict', failure.message, { problems: failure.problems?.map((p) => ({ path: p.path, message: p.message })) });
    case 'invalid-project-record':
    case 'invalid-lifecycle-state':
      return apiError('validation_failed', failure.message, { problems: failure.problems?.map((p) => ({ path: p.path, message: p.message })) });
    default:
      return apiError('unavailable', `the backing service refused (${failure.code}): ${failure.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers: the response constructors
// ---------------------------------------------------------------------------

function successResponse(requestId: RequestId, data: unknown, status = 200, headers: Record<string, string> = {}): ApiResponse {
  return deepFreeze({ status, headers: { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION, ...headers }, body: { requestId, data } });
}

function errorResponse(requestId: RequestId, error: ApiError): ApiResponse {
  const headers: Record<string, string> = { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION };
  if (error.retryAfterMs !== undefined) headers['retry-after-ms'] = String(error.retryAfterMs);
  return deepFreeze({ status: error.status, headers, body: { requestId, error } });
}

// ---------------------------------------------------------------------------
// Helpers: the pagination discipline
// ---------------------------------------------------------------------------

/** Deterministic pagination over a listing: slice [offset, offset+limit), mint the next cursor when more remain. */
function paginate<T>(state: ApiServiceState, family: string, items: readonly T[], cursor: string | undefined, limit: number | undefined): Page<T> {
  const pageSize = limit === undefined ? 50 : Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
  let offset = 0;
  if (cursor !== undefined) {
    const resolved = state.cursors.resolve(cursor);
    if (resolved === null) {
      throw new ApiErrorLike(apiError('validation_failed', 'the pagination cursor is unknown at this boundary (cursors are minted by this service only)'));
    }
    offset = resolved;
  }
  const slice = items.slice(offset, offset + pageSize);
  const nextOffset = offset + pageSize;
  const page: Page<T> = nextOffset < items.length
    ? { items: slice, nextCursor: state.cursors.mint(family, nextOffset) }
    : { items: slice };
  return deepFreeze(page);
}

// ---------------------------------------------------------------------------
// The audit emission (the pipeline's ONLY trail-write path)
// ---------------------------------------------------------------------------

function trailOf(state: ApiServiceState, scope: Scope): ApiAuditTrail {
  const key = `${scope.tenant}/${scope.project}`;
  let trail = state.trails.get(key);
  if (trail === undefined) {
    const started = startApiAuditTrail(scope.tenant, scope.project);
    if (!started.ok) throw new Error(`audit trail start failed: ${started.error.message}`);
    trail = started.value;
    state.trails.set(key, trail);
  }
  return trail;
}

function emitAudit(state: ApiServiceState, draft: ApiAuditRecordDraft): void {
  const trail = trailOf(state, { tenant: draft.tenant, project: draft.project });
  const minted = apiAuditRecordAt(trail, draft);
  if (!minted.ok) throw new Error(`audit emission failed: ${minted.error.message}`);
  const appended = appendApiAuditRecord(trail, minted.value);
  if (!appended.ok) throw new Error(`audit append failed: ${appended.error.message}`);
  state.trails.set(`${draft.tenant}/${draft.project}`, appended.value);
}

// ---------------------------------------------------------------------------
// The tenant-context injection (L12)
// ---------------------------------------------------------------------------

/** The injected tenant context of one request (the pipeline stage 3 output). */
interface InjectedContext {
  readonly tenant: TenantId;
  readonly meteringTenant: TenantId;
}

/** Inject the tenant context: developer credentials carry their tenant; internal requests declare their scope. */
function injectTenantContext(credential: ApiCredential, request: ApiRequest): InjectedContext {
  if (credential.kind === 'developer') {
    return { tenant: (credential as DeveloperCredential).tenant, meteringTenant: (credential as DeveloperCredential).tenant };
  }
  // Internal plane: the scope is declared by the request's own body (validated by the handler);
  // until a handler resolves it, metering lands in the service-principal namespace.
  const principal = (credential as InternalCredential).principal;
  return { tenant: `svc:${principal}` as TenantId, meteringTenant: `svc:${principal}` as TenantId };
}

/** The L12 routing-layer check: a DECLARED scope (body/path) that disagrees with the injected context is the typed error. */
function requireSameTenant(action: string, injected: TenantId, declared: TenantId): { readonly ok: true } | { readonly ok: false; readonly error: ApiError } {
  if (injected !== declared) {
    return {
      ok: false,
      error: apiError(
        'cross_tenant_access',
        `${action} by tenant ${JSON.stringify(injected)} names the scope of tenant ${JSON.stringify(declared)} — tenant data, memory, trajectories, artifacts, credentials and usage are isolated (L12); cross-tenant access is refused at the routing layer`,
      ),
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// THE PIPELINE
// ---------------------------------------------------------------------------

/**
 * Handle one request through the whole pipeline. Deterministic given
 * (state, request, the injected instant sequence): identical request
 * sequences produce identical response bytes, usage bytes and audit
 * bytes (the golden test pins this).
 */
export function handleApiRequest(state: ApiServiceState, request: ApiRequest): ApiResponse {
  // --- Stage 0: structural request validation (the wire shape itself is untrusted). ---
  if (!isApiRequest(request)) {
    return errorResponse(mintRequestId(fnv1a32Hex('malformed')) as RequestId, apiError('validation_failed', 'the request is not a structural ApiRequest (method, path, headers required)'));
  }

  // One injected instant per request (the no-ambient-clock law).
  const at = state.instants.next() as TimestampMs;
  state.requestCounter += 1;
  const requestId = mintRequestId(fnv1a32Hex(canonicalJson([request.method, request.path, at, state.requestCounter]))) as RequestId;

  // --- Stage 1: authn. ---
  const authn = authenticate(state.registry, request.headers.authorization);
  if (!authn.ok) {
    return finish(state, requestId, request, null, null, errorResponse(requestId, authn.error), at, null);
  }
  const credential = authn.credential;

  // --- Route resolution (post-authn so unknown tokens never learn the route table). ---
  const resolved = resolveRoute(request.method, request.path);
  if (!resolved.ok) {
    return finish(state, requestId, request, credential, null, errorResponse(requestId, resolved.error), at, null);
  }
  const { route, params } = resolved.resolved;

  // --- Stage 2a: the PLANE law. ---
  const plane = authorizePlane(credential, route.plane);
  if (!plane.ok) {
    return finish(state, requestId, request, credential, route, errorResponse(requestId, plane.error), at, null);
  }

  // --- Stage 2b: authz (the route family). ---
  const authz = authorizeRoute(credential, route.family);
  if (!authz.ok) {
    return finish(state, requestId, request, credential, route, errorResponse(requestId, authz.error), at, null);
  }

  // --- Stage 3: tenant-context injection (L12). ---
  const context = injectTenantContext(credential, request);

  // --- Stage 4: rate limit. ---
  const rate = state.limiter.consume(credential.credentialId, route.family, at);
  if (!rate.ok) {
    return finish(state, requestId, request, credential, route, errorResponse(requestId, rate.error), at, context);
  }

  // --- Stage 5: input validation + idempotency (per-route dispatch). ---
  const dispatched = dispatch(state, requestId, request, credential, context, route, params, at);
  return dispatched;
}

// ---------------------------------------------------------------------------
// The per-route dispatch (stages 5-7: validation -> idempotency -> handler)
// ---------------------------------------------------------------------------

function dispatch(
  state: ApiServiceState,
  requestId: RequestId,
  request: ApiRequest,
  credential: ApiCredential,
  context: InjectedContext,
  route: { readonly name: string; readonly pattern: string; readonly family: string; readonly idempotency: string; readonly consequential: boolean },
  params: Readonly<Record<string, string>>,
  at: TimestampMs,
): ApiResponse {
  const body = request.body;

  // --- The idempotency pre-law: REQUIRED keys must be present (checked before body validation so the 400 names the header). ---
  if (route.idempotency === 'required') {
    const rawKey = request.headers['idempotency-key'];
    if (rawKey === undefined || !isNonEmptyString(rawKey)) {
      return finish(state, requestId, request, credential, route, errorResponse(requestId, apiError('idempotency_required', 'this consequential route requires an Idempotency-Key header — replays dedupe to the original result (R43)')), at, context);
    }
  }

  // --- The opacity trip wire runs over EVERY payload (SECURITY.md: credential material never crosses). ---
  if (body !== undefined) {
    const violations = credentialValueViolations(body);
    if (violations.length > 0) {
      return finish(state, requestId, request, credential, route, errorResponse(requestId, apiError('validation_failed', `the request body embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — this boundary carries opaque refs only, never values (SECURITY.md Secrets)`, { problems: violations.map((v) => ({ path: v, message: 'credential-shaped key carrying a value — refs only, never values' })) })), at, context);
    }
  }

  // --- The idempotency dedupe check (consequential routes with a key). ---
  let idempotencyKey: IdempotencyKey | null = null;
  if (route.idempotency !== 'none') {
    const rawKey = request.headers['idempotency-key'];
    if (rawKey !== undefined && isNonEmptyString(rawKey)) {
      idempotencyKey = rawKey as IdempotencyKey;
      const verdict = state.idempotency.begin(credential.credentialId, route.pattern, idempotencyKey, body);
      if (verdict.kind === 'replay') {
        // THE REPLAY: the original response, byte-identical, marked.
        const replayHeaders: Record<string, string> = { [IDEMPOTENT_REPLAY_HEADER]: 'true' };
        return finish(state, requestId, request, credential, route, deepFreeze({ status: verdict.entry.responseStatus, headers: { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION, ...replayHeaders }, body: verdict.entry.responseBody as ApiSuccessBody<unknown> | ApiErrorBody }), at, context);
      }
      if (verdict.kind === 'conflict') {
        return finish(state, requestId, request, credential, route, errorResponse(requestId, verdict.error), at, context);
      }
    }
  }

  // --- Stages 5b+6: per-route validation + the handler. ---
  const handled = runHandler(state, requestId, request, credential, context, route, params, body, at);

  // --- The idempotency commit (a completed consequential request's result is history). ---
  if (idempotencyKey !== null && handled.status < 500) {
    const committed = state.idempotency.complete(credential.credentialId, route.pattern, idempotencyKey, body, handled.status, handled.body, at as number);
    if (!committed.ok) {
      return finish(state, requestId, request, credential, route, errorResponse(requestId, committed.error), at, context);
    }
  }

  return finish(state, requestId, request, credential, route, handled, at, context);
}

// ---------------------------------------------------------------------------
// The handlers (stage 6) — one function per route family
// ---------------------------------------------------------------------------

function runHandler(
  state: ApiServiceState,
  requestId: RequestId,
  request: ApiRequest,
  credential: ApiCredential,
  context: InjectedContext,
  route: { readonly name: string; readonly family: string },
  params: Readonly<Record<string, string>>,
  body: unknown,
  at: TimestampMs,
): ApiResponse {
  switch (route.name) {
    case 'meta':
      return successResponse(requestId, deepFreeze({ apiVersion: CURRENT_API_VERSION, supportedVersions: ['v1'], routeFamilies: declaredFamilies('public') }));

    case 'projects.create':
      return handleCreateProject(state, requestId, context, body, at);
    case 'projects.list':
      return handleListProjects(state, requestId, context, request.query?.['cursor'], request.query?.['limit']);
    case 'projects.get':
      return handleGetProject(state, requestId, context, params['projectId'] ?? '');
    case 'projects.lifecycle':
      return handleLifecycle(state, requestId, context, params['projectId'] ?? '', body, at);
    case 'projects.bindOrganization':
      return handleBindOrganization(state, requestId, context, params['projectId'] ?? '', body, at);

    case 'knowledge.query':
      return handleKnowledgeQuery(state, requestId, context, body, at, request.query?.['cursor'], request.query?.['limit']);
    case 'outcomes.query':
      return handleOutcomeQuery(state, requestId, context, body, at, request.query?.['cursor'], request.query?.['limit']);
    case 'postMortems.query':
      return handlePostMortemQuery(state, requestId, context, body, at, request.query?.['cursor'], request.query?.['limit']);

    case 'jobs.research':
    case 'jobs.learning':
      return handleSubmitJob(state, requestId, context, body, at, route.name === 'jobs.research' ? 'research' : 'learning');
    case 'jobs.get':
      return handleGetJob(state, requestId, context, params['jobId'] ?? '');

    case 'execution.requests':
      return handleExecutionRequest(state, requestId, context, body, at);

    case 'organizations.status':
      return handleOrgStatus(state, requestId, context, params['organizationRef'] ?? '', request.query?.['project'] ?? '');

    case 'internal.organizations.status':
      return handleInternalOrgStatus(state, requestId, credential, body, at);
    case 'internal.jobs.transitions':
      return handleInternalJobTransition(state, requestId, body, at);
    case 'internal.usage':
      return handleInternalUsage(state, requestId, params['tenantId'] ?? '');

    default:
      return errorResponse(requestId, apiError('not_found', `no handler is declared for ${JSON.stringify(route.name)}`));
  }
}

// --- The project handlers (T007 shapes through the control-plane port) -------

function handleCreateProject(state: ApiServiceState, requestId: RequestId, context: InjectedContext, body: unknown, at: TimestampMs): ApiResponse {
  if (!isCreateProjectRequest(body)) {
    return errorResponse(requestId, apiError('validation_failed', 'the create-project body is invalid (id, name, executionMode, goal, constraintSet, at)', { problems: collectCreateProjectProblems(body) }));
  }
  // L12 at the routing layer: the goal's and constraint-set's declared tenants must BE the injected tenant.
  const goalCheck = requireSameTenant('createProject(goal)', context.tenant, body.goal.tenantId);
  if (!goalCheck.ok) return errorResponse(requestId, goalCheck.error);
  const constraintCheck = requireSameTenant('createProject(constraintSet)', context.tenant, body.constraintSet.tenantId);
  if (!constraintCheck.ok) return errorResponse(requestId, constraintCheck.error);

  const result = state.controlPlane.createProject({
    id: body.id,
    tenantId: context.tenant,
    name: body.name,
    executionMode: body.executionMode,
    goal: body.goal,
    constraintSet: body.constraintSet,
    at: body.at,
  });
  if (!result.ok) return errorResponse(requestId, portFailureToError('createProject', result.error));
  return successResponse(requestId, result.value, 201);
}

function collectCreateProjectProblems(body: unknown): { readonly path: string; readonly message: string }[] {
  const problems: { readonly path: string; readonly message: string }[] = [];
  if (!isRecord(body)) return [{ path: 'body', message: 'must be an object' }];
  if (body.id === undefined) problems.push({ path: 'id', message: 'the project id is required' });
  if (body.name === undefined || !isNonEmptyString(body.name)) problems.push({ path: 'name', message: 'a non-empty project name is required' });
  if (body.executionMode === undefined || !['simulation', 'shadow', 'live'].includes(String(body.executionMode))) problems.push({ path: 'executionMode', message: 'executionMode must be one of simulation | shadow | live' });
  if (body.goal === undefined) problems.push({ path: 'goal', message: 'the goal statement is required (T007 GoalStatement shape)' });
  if (body.constraintSet === undefined) problems.push({ path: 'constraintSet', message: 'the constraint-set statement is required (T007 ConstraintSetStatement shape)' });
  if (body.at === undefined || !isTimestampMs(body.at)) problems.push({ path: 'at', message: 'the creation instant (epoch ms) is required' });
  return problems;
}

function handleListProjects(state: ApiServiceState, requestId: RequestId, context: InjectedContext, cursor: string | undefined, limit: string | undefined): ApiResponse {
  const parsedLimit = limit === undefined ? undefined : Number(limit);
  if (limit !== undefined && (!Number.isInteger(parsedLimit) || (parsedLimit as number) < 1 || (parsedLimit as number) > MAX_PAGE_SIZE)) {
    return errorResponse(requestId, apiError('validation_failed', `the limit query parameter must be an integer in [1, ${MAX_PAGE_SIZE}]`));
  }
  const result = state.controlPlane.projectsOf(context.tenant);
  if (!result.ok) return errorResponse(requestId, portFailureToError('projects.list', result.error));
  try {
    return successResponse(requestId, paginate(state, 'projects.list', result.value, cursor, parsedLimit));
  } catch (error) {
    if (error instanceof ApiErrorLike) return errorResponse(requestId, (error as ApiErrorLike).error);
    throw error;
  }
}

function handleGetProject(state: ApiServiceState, requestId: RequestId, context: InjectedContext, projectId: string): ApiResponse {
  if (!isProjectId(projectId)) {
    return errorResponse(requestId, apiError('validation_failed', 'the project id path parameter must be a non-empty string'));
  }
  const result = state.controlPlane.getProject(context.tenant, projectId as ProjectId);
  if (!result.ok) return errorResponse(requestId, portFailureToError('projects.get', result.error));
  return successResponse(requestId, result.value);
}

function handleLifecycle(state: ApiServiceState, requestId: RequestId, context: InjectedContext, projectId: string, body: unknown, at: TimestampMs): ApiResponse {
  if (!isProjectId(projectId)) {
    return errorResponse(requestId, apiError('validation_failed', 'the project id path parameter must be a non-empty string'));
  }
  if (!isTransitionProjectRequest(body)) {
    return errorResponse(requestId, apiError('validation_failed', 'the lifecycle body is invalid (event, at)', { problems: [{ path: 'event', message: 'one of activate | pause | resume | complete | abandon | archive' }, { path: 'at', message: 'the transition instant (epoch ms) is required' }] }));
  }
  const result = state.controlPlane.transition({ tenantId: context.tenant, projectId: projectId as ProjectId, event: body.event, at: body.at });
  if (!result.ok) return errorResponse(requestId, portFailureToError('projects.lifecycle', result.error));
  return successResponse(requestId, result.value);
}

function handleBindOrganization(state: ApiServiceState, requestId: RequestId, context: InjectedContext, projectId: string, body: unknown, at: TimestampMs): ApiResponse {
  if (!isProjectId(projectId)) {
    return errorResponse(requestId, apiError('validation_failed', 'the project id path parameter must be a non-empty string'));
  }
  if (!isBindOrganizationRequest(body)) {
    return errorResponse(requestId, apiError('validation_failed', 'the bind-organization body is invalid (organizationRef, at)'));
  }
  const result = state.controlPlane.bindOrganization({ tenantId: context.tenant, projectId: projectId as ProjectId, organizationRef: body.organizationRef, at: body.at });
  if (!result.ok) return errorResponse(requestId, portFailureToError('projects.bindOrganization', result.error));
  return successResponse(requestId, result.value);
}

// --- The knowledge/outcome handlers (READ queries through the serving ports) -

function handleKnowledgeQuery(state: ApiServiceState, requestId: RequestId, context: InjectedContext, body: unknown, at: TimestampMs, cursor: string | undefined, limit: string | undefined): ApiResponse {
  if (!isKnowledgeQueryRequest(body)) {
    return errorResponse(requestId, apiError('validation_failed', 'the knowledge-query body is invalid (project, at, optional filters)', { problems: [{ path: 'project', message: 'the project scope is required' }, { path: 'at', message: 'the query instant (epoch ms) is required — L4: the future is never returned' }] }));
  }
  const parsedLimit = limit === undefined ? undefined : Number(limit);
  if (limit !== undefined && (!Number.isInteger(parsedLimit) || (parsedLimit as number) < 1 || (parsedLimit as number) > MAX_PAGE_SIZE)) {
    return errorResponse(requestId, apiError('validation_failed', `the limit query parameter must be an integer in [1, ${MAX_PAGE_SIZE}]`));
  }
  // The tenant is INJECTED (L12); the query is built here, never trusted from the body.
  const query = {
    tenant: context.tenant as string,
    project: body.project,
    ...(body.kinds === undefined ? {} : { kinds: body.kinds }),
    ...(body.polarity === undefined ? {} : { polarity: body.polarity }),
    ...(body.dimension === undefined ? {} : { dimension: body.dimension }),
    ...(body.lagBand === undefined ? {} : { lagBand: body.lagBand }),
    ...(body.minEvidenceCount === undefined ? {} : { minEvidenceCount: body.minEvidenceCount }),
    ...(body.minConfidence === undefined ? {} : { minConfidence: body.minConfidence }),
    ...(body.knowledgeId === undefined ? {} : { knowledgeId: body.knowledgeId }),
  };
  const options = { at: body.at as TimestampMs, retention: state.knowledgeRetention, ...(body.activeOnly === undefined ? {} : { activeOnly: body.activeOnly }) };
  const result = state.firmMemory.queryKnowledge(query, options);
  if (!result.ok) return errorResponse(requestId, portFailureToError('knowledge.query', result.error));
  try {
    return successResponse(requestId, deepFreeze({ at: body.at, ...paginate(state, 'knowledge.query', result.value, cursor, parsedLimit) }));
  } catch (error) {
    if (error instanceof ApiErrorLike) return errorResponse(requestId, (error as ApiErrorLike).error);
    throw error;
  }
}

function handleOutcomeQuery(state: ApiServiceState, requestId: RequestId, context: InjectedContext, body: unknown, at: TimestampMs, cursor: string | undefined, limit: string | undefined): ApiResponse {
  if (!isOutcomeQueryRequest(body)) {
    return errorResponse(requestId, apiError('validation_failed', 'the outcome-query body is invalid (project, at, optional filters)'));
  }
  const parsedLimit = limit === undefined ? undefined : Number(limit);
  if (limit !== undefined && (!Number.isInteger(parsedLimit) || (parsedLimit as number) < 1 || (parsedLimit as number) > MAX_PAGE_SIZE)) {
    return errorResponse(requestId, apiError('validation_failed', `the limit query parameter must be an integer in [1, ${MAX_PAGE_SIZE}]`));
  }
  const query = {
    tenant: context.tenant as string,
    project: body.project,
    ...(body.decisionRef === undefined ? {} : { decisionRef: body.decisionRef }),
    ...(body.intentRef === undefined ? {} : { intentRef: body.intentRef }),
    ...(body.outcomeClass === undefined ? {} : { outcomeClass: body.outcomeClass }),
    ...(body.sessionRef === undefined ? {} : { sessionRef: body.sessionRef }),
    ...(body.outcomeRecordRef === undefined ? {} : { outcomeRecordRef: body.outcomeRecordRef }),
  };
  const options = { at: body.at as TimestampMs, retention: state.outcomeRetention };
  const result = state.outcomeLearning.queryOutcomes(query, options);
  if (!result.ok) return errorResponse(requestId, portFailureToError('outcomes.query', result.error));
  try {
    return successResponse(requestId, paginate(state, 'outcomes.query', result.value, cursor, parsedLimit));
  } catch (error) {
    if (error instanceof ApiErrorLike) return errorResponse(requestId, (error as ApiErrorLike).error);
    throw error;
  }
}

function handlePostMortemQuery(state: ApiServiceState, requestId: RequestId, context: InjectedContext, body: unknown, at: TimestampMs, cursor: string | undefined, limit: string | undefined): ApiResponse {
  if (!isPostMortemQueryRequest(body)) {
    return errorResponse(requestId, apiError('validation_failed', 'the post-mortem-query body is invalid (project, at, optional filters)'));
  }
  const parsedLimit = limit === undefined ? undefined : Number(limit);
  if (limit !== undefined && (!Number.isInteger(parsedLimit) || (parsedLimit as number) < 1 || (parsedLimit as number) > MAX_PAGE_SIZE)) {
    return errorResponse(requestId, apiError('validation_failed', `the limit query parameter must be an integer in [1, ${MAX_PAGE_SIZE}]`));
  }
  const query = {
    tenant: context.tenant as string,
    project: body.project,
    ...(body.decisionRef === undefined ? {} : { decisionRef: body.decisionRef }),
    ...(body.outcomeRecordRef === undefined ? {} : { outcomeRecordRef: body.outcomeRecordRef }),
    ...(body.attributionClass === undefined ? {} : { attributionClass: body.attributionClass }),
  };
  const options = { at: body.at as TimestampMs, retention: state.outcomeRetention, ...(body.latestPerOutcome === undefined ? {} : { latestPerOutcome: body.latestPerOutcome }) };
  const result = state.outcomeLearning.queryPostMortems(query, options);
  if (!result.ok) return errorResponse(requestId, portFailureToError('postMortems.query', result.error));
  try {
    return successResponse(requestId, paginate(state, 'postMortems.query', result.value, cursor, parsedLimit));
  } catch (error) {
    if (error instanceof ApiErrorLike) return errorResponse(requestId, (error as ApiErrorLike).error);
    throw error;
  }
}

// --- The job handlers (the async submitted/running/complete pattern) ---------

function handleSubmitJob(state: ApiServiceState, requestId: RequestId, context: InjectedContext, body: unknown, at: TimestampMs, kind: 'research' | 'learning'): ApiResponse {
  if (!isSubmitJobRequest(body)) {
    return errorResponse(requestId, apiError('validation_failed', `the ${kind}-job submission body is invalid (kind, projectId, spec)`, { problems: [{ path: 'kind', message: `must be "${kind}"` }, { path: 'projectId', message: 'the project scope is required' }, { path: 'spec', message: 'the job specification is required (JSON only — the job machinery owns its semantics)' }] }));
  }
  if (body.kind !== kind) {
    return errorResponse(requestId, apiError('validation_failed', `the job kind ${JSON.stringify(body.kind)} does not match the route (${kind})`));
  }
  const result = state.jobSubmission.submitJob({ kind, tenant: context.tenant, project: body.projectId, spec: body.spec, at: at as number });
  if (!result.ok) return errorResponse(requestId, portFailureToError(`${kind}-job submission`, result.error));
  // The boundary's job store: the async pattern's read model (the machinery reports transitions via the private plane).
  state.jobs.set(result.value.jobId as string, result.value);
  return successResponse(requestId, result.value, 202);
}

function handleGetJob(state: ApiServiceState, requestId: RequestId, context: InjectedContext, jobId: string): ApiResponse {
  if (!isJobId(jobId)) {
    return errorResponse(requestId, apiError('validation_failed', 'the job id path parameter must carry the job: prefix grammar'));
  }
  const job = state.jobs.get(jobId);
  if (job === undefined) {
    return errorResponse(requestId, apiError('not_found', `no job ${JSON.stringify(jobId)} exists at this boundary (unknown and cross-tenant are indistinguishable — L12)`));
  }
  // API-owned state: the typed cross-tenant error (T044's law — observable, never a silent miss).
  if (job.tenant !== context.tenant) {
    return errorResponse(requestId, apiError('cross_tenant_access', `a job read by tenant ${JSON.stringify(context.tenant)} targets a job of tenant ${JSON.stringify(job.tenant)} — tenant data is isolated (L12); cross-tenant access is refused at the routing layer`));
  }
  return successResponse(requestId, job);
}

// --- THE EXECUTION REQUEST HANDLER (the L8 route) ----------------------------

/**
 * THE L8 ROUTE: forward one strategy intent through the injected
 * ExecutionGatewayPort — the ONLY execution path this boundary will
 * ever have. The handler performs NO authority computation: the
 * gateway's pipeline IS the authority; its typed outcome (routed or
 * refused) is served verbatim. Direct-execution attempts — submitted
 * authority instead of an intent — are the typed `gate_bypass_attempt`.
 */
function handleExecutionRequest(state: ApiServiceState, requestId: RequestId, context: InjectedContext, body: unknown, at: TimestampMs): ApiResponse {
  // THE GATE-BYPASS SCAN (L8, first — before any other validation matters):
  if (isRecord(body)) {
    const submitted: unknown = body.intent ?? body;
    // (a) submitting an APPROVE decision — authority is the GATE's output, never a caller's input.
    if (isApproveDecisionRecord(submitted)) {
      return errorResponse(requestId, apiError('gate_bypass_attempt', 'the submitted body is an APPROVE decision record — authority is the execution gateway\'s OUTPUT, never a caller\'s input; this boundary forwards intents THROUGH the T040 gateway and never executes, translates or honors submitted authority (L8)'));
    }
    // (b) submitting a gateway order request — the translation contract's output, never a caller's input.
    if (isRecord(submitted) && typeof (submitted as Record<string, unknown>).requestRef === 'string' && String((submitted as Record<string, unknown>).requestRef).startsWith('gor:')) {
      return errorResponse(requestId, apiError('gate_bypass_attempt', 'the submitted body is a GatewayOrderRequest (\'gor:\') — the translation contract\'s output; submitting it directly is a gate-bypass attempt (L8)'));
    }
    // (c) an intent-shaped body embedding execution authority (the L8 authority-embedding scan).
    const authorityViolations = intentAuthorityViolations(submitted);
    if (authorityViolations.length > 0) {
      return errorResponse(requestId, apiError('gate_bypass_attempt', `the submitted intent embeds execution authority under key(s) ${authorityViolations.join(', ')} — risk/authorization policy stays in the gateway's opaque refs; an embedded grant, token, credential or permission is the crime (L8)`, { problems: authorityViolations.map((v) => ({ path: v, message: 'authority-embedding key — remove it; the gateway holds authority, never the request' })) }));
    }
  }
  if (!isExecutionRequest(body)) {
    return errorResponse(requestId, apiError('validation_failed', 'the execution-request body is invalid — it must be { intent: <StrategyIntent> } (si:-prefixed intentId, order form, constraint proof, lineage, rationale, asOf)', { problems: [{ path: 'intent', message: 'a structurally valid StrategyIntent is required (the T018/T019 shape the gate decides over)' }] }));
  }
  // L12 at the routing layer: the intent's declared scope must BE the injected context.
  const tenantCheck = requireSameTenant('execution.requests(intent.tenant)', context.tenant, body.intent.tenant);
  if (!tenantCheck.ok) return errorResponse(requestId, tenantCheck.error);

  // THE FORWARD — the ONLY thing this handler does with execution.
  const result: PortResult<GatewaySubmissionRecord> = state.executionGateway.submitRequest(body.intent);
  if (!result.ok) {
    // A gateway-side typed refusal at the port boundary surfaces as the typed unavailable error (the gateway's own refusal records arrive as ok:'refused' submissions).
    return errorResponse(requestId, portFailureToError('execution.requests', result.error));
  }
  if (!isGatewaySubmissionRecord(result.value)) {
    return errorResponse(requestId, apiError('unavailable', 'the execution gateway returned a record outside the submission contract — refusing to serve it (fail-closed)'));
  }
  return successResponse(requestId, result.value);
}

// --- The organization status handlers ----------------------------------------

function handleOrgStatus(state: ApiServiceState, requestId: RequestId, context: InjectedContext, organizationRef: string, project: string): ApiResponse {
  if (!isOrganizationRef(organizationRef)) {
    return errorResponse(requestId, apiError('validation_failed', 'the organization ref path parameter must be a non-empty string'));
  }
  if (!isProjectId(project)) {
    return errorResponse(requestId, apiError('validation_failed', 'the project query parameter is required (the watch surface is project-scoped)'));
  }
  const snapshot = state.orgStatus.get(`${organizationRef}/${project}`);
  if (snapshot === undefined) {
    return errorResponse(requestId, apiError('not_found', `no organization status snapshot exists for ${JSON.stringify(organizationRef)} in the requested scope`));
  }
  // API-owned state: the typed cross-tenant error (T044's law).
  if (snapshot.tenant !== context.tenant) {
    return errorResponse(requestId, apiError('cross_tenant_access', `an organization status read by tenant ${JSON.stringify(context.tenant)} targets a snapshot of tenant ${JSON.stringify(snapshot.tenant)} — tenant data is isolated (L12)`));
  }
  return successResponse(requestId, snapshot);
}

function handleInternalOrgStatus(state: ApiServiceState, requestId: RequestId, credential: ApiCredential, body: unknown, at: TimestampMs): ApiResponse {
  if (!isInternalOrgStatusRequest(body)) {
    return errorResponse(requestId, apiError('validation_failed', 'the internal org-status report is invalid (snapshot: the OrgStatusSnapshot shape)'));
  }
  const snapshot = body.snapshot;
  if (!isOrgStatusSnapshot(snapshot)) {
    return errorResponse(requestId, apiError('validation_failed', 'the snapshot failed its structural guard (organizationRef, tenant, project, status, at, instanceRefs)'));
  }
  state.orgStatus.set(`${snapshot.organizationRef as string}/${snapshot.project as string}`, deepFreeze(snapshot));
  return successResponse(requestId, deepFreeze({ stored: true, organizationRef: snapshot.organizationRef, project: snapshot.project }), 200);
}

function handleInternalJobTransition(state: ApiServiceState, requestId: RequestId, body: unknown, at: TimestampMs): ApiResponse {
  if (!isInternalJobTransitionRequest(body)) {
    return errorResponse(requestId, apiError('validation_failed', 'the internal job-transition report is invalid (jobId, status, at, optional result)'));
  }
  const job = state.jobs.get(body.jobId as string);
  if (job === undefined) {
    return errorResponse(requestId, apiError('not_found', `no job ${JSON.stringify(body.jobId)} exists at this boundary`));
  }
  // The async pattern's legal transitions: submitted -> running -> complete | failed (terminal).
  const legal: Record<string, readonly string[]> = {
    submitted: ['running', 'complete', 'failed'],
    running: ['complete', 'failed'],
    complete: [],
    failed: [],
  };
  if (!(legal[job.status] as readonly string[]).includes(body.status)) {
    return errorResponse(requestId, apiError('conflict', `the job transition ${job.status} -> ${body.status} is illegal (the async pattern's machine: submitted -> running -> complete | failed; terminal states never re-open)`));
  }
  const next: JobRecord = deepFreeze({
    ...job,
    status: body.status,
    ...(body.result === undefined ? {} : { result: body.result }),
    ...(body.status === 'complete' || body.status === 'failed' ? { completedAt: body.at } : {}),
  });
  state.jobs.set(body.jobId as string, next);
  return successResponse(requestId, next);
}

function handleInternalUsage(state: ApiServiceState, requestId: RequestId, tenantId: string): ApiResponse {
  if (!isTenantId(tenantId)) {
    return errorResponse(requestId, apiError('validation_failed', 'the tenant id path parameter must be a non-empty string'));
  }
  const aggregate = state.usage.aggregateOf(tenantId as TenantId);
  return successResponse(requestId, deepFreeze({ tenant: tenantId, totalRequests: aggregate.totalRequests, byRoute: aggregate.byRoute }));
}

// ---------------------------------------------------------------------------
// Stage 7-8: the audit emission + metering + the response (every request)
// ---------------------------------------------------------------------------

/** The typed-error throw marker used by the pagination helper (caught at the call sites). */
class ApiErrorLike extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
  }
}

/**
 * The pipeline's tail: audit the consequential requests, meter EVERY
 * request, and return the response. Called exactly once per request
 * from exactly one exit path (the single tail keeps the
 * one-usage-record-per-request law structural).
 */
function finish(
  state: ApiServiceState,
  requestId: RequestId,
  request: ApiRequest,
  credential: ApiCredential | null,
  route: { readonly name: string; readonly pattern: string; readonly family: string; readonly consequential: boolean } | null,
  response: ApiResponse,
  at: TimestampMs,
  context: InjectedContext | null,
): ApiResponse {
  // --- The audit emission (consequential requests only; scope-resolvable ones trail, authn failures have no scope). ---
  if (route !== null && route.consequential && credential !== null) {
    const auditScope = auditScopeOf(state, credential, context, request, route, response);
    if (auditScope !== null) {
      const action = response.status >= 400 ? 'request.denied' : response.headers[IDEMPOTENT_REPLAY_HEADER] === 'true' ? 'request.replayed' : 'request.allowed';
      emitAudit(state, {
        actor: {
          kind: credential.kind === 'developer' ? 'principal' : 'service',
          ref: credential.principal,
        },
        action,
        object: { kind: 'platform-object', objectType: 'api-request', ref: requestId },
        route: { method: request.method.toUpperCase(), pattern: route.pattern, family: route.family },
        consequence: {
          status: response.status,
          affected: affectedObjectOf(request, route, response),
          idempotentReplay: response.headers[IDEMPOTENT_REPLAY_HEADER] === 'true',
        },
        at,
        tenant: auditScope.tenant,
        project: auditScope.project,
        lineage: { goal: auditScope.goal, project: auditScope.project },
      });
    }
  }

  // --- The metering (EVERY request — R41 hooks, record only). ---
  state.usage.record({
    tenant: context === null ? ('svc:unauthenticated' as TenantId) : context.meteringTenant,
    credentialId: credential === null ? 'anonymous' : credential.credentialId,
    route: route === null ? 'unrouted' : route.family,
    method: request.method.toUpperCase(),
    path: request.path,
    status: response.status,
    at,
  });

  return response;
}

/** Resolve the audit scope of a consequential request (tenant + project + goal lineage when derivable). */
function auditScopeOf(
  state: ApiServiceState,
  credential: ApiCredential,
  context: InjectedContext | null,
  request: ApiRequest,
  route: { readonly name: string },
  response: ApiResponse,
): { readonly tenant: TenantId; readonly project: ProjectId; readonly goal: { readonly goalId: string; readonly version: number } | null } | null {
  const body = request.body;
  switch (route.name) {
    case 'projects.create': {
      if (isRecord(body) && isProjectId(body.id)) {
        const goal = isRecord(body.goal) && typeof (body.goal as Record<string, unknown>).id === 'string' && typeof (body.goal as Record<string, unknown>).version === 'number'
          ? { goalId: (body.goal as { id: string; version: number }).id, version: (body.goal as { id: string; version: number }).version }
          : null;
        return { tenant: context?.tenant ?? (credential as DeveloperCredential).tenant, project: body.id as ProjectId, goal };
      }
      return null;
    }
    case 'projects.lifecycle':
    case 'projects.bindOrganization': {
      const projectId = request.path.split('/')[3];
      return isProjectId(projectId) ? { tenant: context?.tenant ?? (credential as DeveloperCredential).tenant, project: projectId as ProjectId, goal: null } : null;
    }
    case 'jobs.research':
    case 'jobs.learning': {
      if (isRecord(body) && isProjectId(body.projectId)) {
        return { tenant: context?.tenant ?? (credential as DeveloperCredential).tenant, project: body.projectId as ProjectId, goal: null };
      }
      return null;
    }
    case 'execution.requests': {
      const intent = isRecord(body) ? body.intent : null;
      if (isStrategyIntent(intent)) {
        return { tenant: context?.tenant ?? intent.tenant, project: intent.project, goal: { goalId: intent.goal.goalId, version: intent.goal.version } };
      }
      return null;
    }
    case 'internal.organizations.status': {
      if (isRecord(body) && isOrgStatusSnapshot(body.snapshot)) {
        return { tenant: body.snapshot.tenant, project: body.snapshot.project, goal: null };
      }
      return null;
    }
    case 'internal.jobs.transitions': {
      if (isRecord(body) && isJobId(body.jobId)) {
        const job = state.jobs.get(body.jobId as string);
        if (job !== undefined) return { tenant: job.tenant, project: job.project, goal: null };
      }
      return null;
    }
    default:
      return null;
  }
}

/** The affected object of a consequential request (the created/acted-on referent, when derivable). */
function affectedObjectOf(
  request: ApiRequest,
  route: { readonly name: string },
  response: ApiResponse,
): { readonly objectType: string; readonly ref: string } | null {
  const body = response.body;
  if (body !== null && typeof body === 'object' && 'data' in (body as unknown as Record<string, unknown>)) {
    const data = (body as { data: unknown }).data;
    if (route.name === 'projects.create' && isProjectRecord(data)) return { objectType: 'project', ref: data.id };
    if ((route.name === 'jobs.research' || route.name === 'jobs.learning') && isJobRecord(data)) return { objectType: 'job', ref: data.jobId };
    if (route.name === 'execution.requests' && isGatewaySubmissionRecord(data)) return { objectType: 'gateway-submission', ref: data.submissionId };
    if (route.name === 'internal.jobs.transitions' && isJobRecord(data)) return { objectType: 'job', ref: data.jobId };
  }
  if (route.name === 'internal.organizations.status' && isRecord(request.body) && isOrgStatusSnapshot((request.body as { snapshot?: unknown }).snapshot)) {
    return { objectType: 'organization-status', ref: ((request.body as { snapshot: OrgStatusSnapshot }).snapshot).organizationRef as string };
  }
  return null;
}
