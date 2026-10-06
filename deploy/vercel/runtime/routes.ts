// deploy/vercel/runtime/routes.ts — THE HOST-OWNED DEMO-SUBSTANCE READ
// ROUTES (T052 follow-up W-8 — the Phase-2 fix-forward, R2/R5).
//
// WHAT THIS IS: two ADDITIVE read-only routes the HOST (this Vercel
// function) serves from the demo backing's seeded data, BEFORE the
// request is wrapped into the frozen T041 route table (services/api is
// frozen — its route table is untouched; these paths are declared
// NOWHERE in it, so without this module they answer the typed
// not_found, and under the DURABLE backing / port overrides they still
// do — the pre-W-8 behavior is preserved everywhere the demo handle is
// absent):
//
//   GET /v1/execution/submissions?project=<projectId>
//     THE EXECUTION BLOTTER (R2 — "the Execution section is an empty
//     placeholder today", 0/15 personas): one page of
//     GatewaySubmissionRecord rows — the console's Execution section
//     reads exactly this shape (routed | refused; the boundary's own
//     guard passes on every row) — the SEEDED demo blotter (order ids,
//     instruments, sides, quantity/notional/fee, states, routing,
//     timestamps + the R3 decision-audit additive fields) plus every
//     LIVE submission the demo gateway has routed for the project.
//
//   GET /v1/projects/:projectId/goal
//     THE SEEDED GOAL + CONSTRAINT SET (R5 — "a limit without a number
//     is not a limit"): the demo project's goal statement and
//     constraint set with NUMERIC predicate bounds end-to-end. Serves
//     the DEMO project's seeded goal; any other project answers the
//     typed not-found (only the demo project has a host-seeded goal —
//     launched projects carry their goal/constraint set in their own
//     create request, which the console already holds).
//
// THE AUTH LAW: the host owns the credential registrations (the
// secure-boundary act — runtime/compose.ts), so the host authenticates
// these routes itself with the same law the boundary applies: a
// Bearer token that is not the deployment's registered developer
// credential is the typed 401 (`unauthenticated`); the served records
// are the CREDENTIAL tenant's own (L12 by construction — the demo
// world is seeded per composition for exactly that tenant, and only
// one developer credential exists per deployment). The responses use
// the boundary's own envelope discipline ({ requestId, data } /
// { requestId, error }, the x-request-id/x-api-version headers, the
// Page listing shape). DOCUMENTED LIMITATION (honest): host-owned
// routes run outside the T041 pipeline's metering/audit tail — they
// are demo-substance READS only; every consequential route stays
// behind the frozen boundary.
//
// NO CORS headers are ever emitted (the same-origin law — pinned by
// deploy/vercel/vercel.test.ts, which scans this file too).
//
// THE DURABLE GOAL READ (W-25D, D-5 — additive, durable-only): under the
// DURABLE backing the same path (GET /v1/projects/:projectId/goal) serves
// the seam's HYDRATED goal set of ANY of the credential tenant's projects
// (serveDurableGoalRoute below) — the create-project input's goal +
// constraint set, persisted at createProject time and rehydrated at every
// cold start. The two backings serve their own data with the same
// envelope discipline (never merged).
//
// Zero-dep law: platform APIs only. Spec anchors: R43 (the composed
// API surface — additive), L12, L20, R46, phase2-competitive-report
// R2/R5, D-5.

import {
  apiError,
  canonicalJson,
  CURRENT_API_VERSION,
  deepFreeze,
  fnv1a32Hex,
  isProjectId,
  mintRequestId,
  type ApiError,
  type ApiRequest,
  type ApiResponse,
  type RequestId,
} from '../../../services/api/src/index';
import { DEMO_PROJECT_ID, demoConstraintSet, demoGoalStatement, demoSubmissionsOf, type DemoPorts } from './demo';
import type { DurableBackingHandle } from './durable';

/** The host auth's verdict: the credential tenant + principal behind the presented token. */
export interface DemoSubstanceAuthorization {
  readonly tenant: string;
  readonly principal: string;
}

/** The composition's host-auth seam (runtime/compose.ts mints it from the registered developer credential). */
export type VerifyDeveloperAuthorization = (authorization: string | undefined) => DemoSubstanceAuthorization | null;

/** The host-route serving input. */
export interface DemoSubstanceRouteInput {
  /** The demo backing's ports (the seeded blotter + the live gateway recordings). */
  readonly ports: DemoPorts;
  /** The host auth seam (the composition's registered developer credential). */
  readonly verifyDeveloperAuthorization: VerifyDeveloperAuthorization;
}

/** The demo-substance read paths this host serves (additive — declared nowhere in the frozen route table). */
export const DEMO_SUBSTANCE_ROUTE_PATHS = deepFreeze(['/v1/execution/submissions', '/v1/projects/:projectId/goal'] as const);

// ---------------------------------------------------------------------------
// The envelope discipline (mirrors the boundary's own response builders)
// ---------------------------------------------------------------------------

/** The minimal request surface the host routes consume (the wrapped ApiRequest carries exactly these). */
type DemoSubstanceRequest = Pick<ApiRequest, 'method' | 'path' | 'query' | 'headers'>;

function demoRouteRequestId(request: DemoSubstanceRequest, serial: number): RequestId {
  return mintRequestId(fnv1a32Hex(canonicalJson(['demo-substance-route', request.method, request.path, serial] as never)));
}

function demoRouteSuccess(requestId: RequestId, data: unknown, status = 200): ApiResponse {
  return deepFreeze({ status, headers: { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION }, body: { requestId, data } });
}

function demoRouteError(requestId: RequestId, error: ApiError): ApiResponse {
  const headers: Record<string, string> = { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION };
  if (error.retryAfterMs !== undefined) headers['retry-after-ms'] = String(error.retryAfterMs);
  return deepFreeze({ status: error.status, headers, body: { requestId, error } });
}

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

/** GET /v1/execution/submissions?project=<id> — the execution blotter (R2). */
function executionSubmissionsRoute(input: DemoSubstanceRouteInput, request: DemoSubstanceRequest, requestId: RequestId): ApiResponse {
  const authorization = input.verifyDeveloperAuthorization(request.headers.authorization);
  if (authorization === null) {
    return demoRouteError(requestId, apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'));
  }
  const project = request.query?.project;
  if (project === undefined || !isProjectId(project)) {
    return demoRouteError(requestId, apiError('validation_failed', 'the project query parameter is required (the execution blotter is project-scoped)'));
  }
  // L12 by construction: the served rows are the credential tenant's own
  // (the demo world is seeded per composition for exactly this tenant).
  return demoRouteSuccess(requestId, deepFreeze({ items: demoSubmissionsOf(input.ports, project) }));
}

/** The `/v1/projects/:projectId/goal` path match (the captured project id, or null). */
function matchProjectGoalPath(path: string): string | null {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 4) return null;
  if (segments[0] !== 'v1' || segments[1] !== 'projects' || segments[3] !== 'goal') return null;
  const projectId = segments[2] as string;
  return isProjectId(projectId) ? projectId : null;
}

/** GET /v1/projects/:projectId/goal — the demo project's seeded goal + constraint set (R5). */
function projectGoalRoute(input: DemoSubstanceRouteInput, request: DemoSubstanceRequest, requestId: RequestId, projectId: string): ApiResponse {
  const authorization = input.verifyDeveloperAuthorization(request.headers.authorization);
  if (authorization === null) {
    return demoRouteError(requestId, apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'));
  }
  if (projectId !== DEMO_PROJECT_ID) {
    // Only the demo project has a host-seeded goal statement — honest typed
    // not-found for every other project (unknown and cross-tenant stay
    // indistinguishable, the boundary's own law).
    return demoRouteError(requestId, apiError('not_found', `no seeded goal statement exists for ${JSON.stringify(projectId)} at this host (the goal read serves the demo project's seeded goal)`));
  }
  return demoRouteSuccess(requestId, deepFreeze({ goal: demoGoalStatement(authorization.tenant), constraintSet: demoConstraintSet(authorization.tenant) }));
}

// ---------------------------------------------------------------------------
// The dispatcher (null = not a host route — fall through to the boundary)
// ---------------------------------------------------------------------------

/**
 * Serve one request off the host-owned demo-substance routes. Returns
 * `null` when the request is NOT one of them (the caller falls through
 * to the frozen boundary — the pre-W-8 behavior, byte-identical) or
 * when the method is not the route's own (the boundary answers the
 * typed not-found/method-not-allowed for those paths itself, exactly
 * as before). `serial` is the caller's per-instance request counter —
 * the minted request ids stay unique per invocation.
 */
export function serveDemoSubstanceRoute(input: DemoSubstanceRouteInput, request: DemoSubstanceRequest, serial: number): ApiResponse | null {
  if (request.method !== 'GET') return null;
  if (request.path === '/v1/execution/submissions') {
    return executionSubmissionsRoute(input, request, demoRouteRequestId(request, serial));
  }
  const goalProject = matchProjectGoalPath(request.path);
  if (goalProject !== null) {
    return projectGoalRoute(input, request, demoRouteRequestId(request, serial), goalProject);
  }
  return null;
}

// ---------------------------------------------------------------------------
// THE DURABLE GOAL READ ROUTE (W-25D, D-5 — additive, durable-only)
// ---------------------------------------------------------------------------

/** The durable backing's goal-read surface (the seam handle — runtime/durable.ts). */
export type DurableGoalRouteInput = {
  /** The durable seam (the hydrated goal sets + the typed degraded state). */
  readonly durable: DurableBackingHandle;
  /** The host auth seam (the composition's registered developer credential). */
  readonly verifyDeveloperAuthorization: VerifyDeveloperAuthorization;
};

/**
 * GET /v1/projects/:projectId/goal UNDER THE DURABLE BACKING (W-25D): the
 * project's goal + constraint set, served from the seam's HYDRATED goal
 * sets — the records that ride the create-project input (which main
 * already carries), persisted at createProject time and rehydrated at
 * every cold start (D-5: the project lands on another instance WITH ITS
 * WORLD — the W-23 console goal fetch gets a real answer). The same
 * envelope discipline as the demo-substance routes; the same auth law;
 * the typed not-found for a project without a hydrated goal set; the
 * typed 503 while the projection is degraded (never a crash, never a
 * silent empty — R46). The demo path serves its OWN route byte-identically
 * (the two backings never merge their data).
 */
export function serveDurableGoalRoute(input: DurableGoalRouteInput, request: DemoSubstanceRequest, serial: number): ApiResponse | null {
  if (request.method !== 'GET') return null;
  const goalProject = matchProjectGoalPath(request.path);
  if (goalProject === null) return null;
  const requestId = demoRouteRequestId(request, serial);
  const authorization = input.verifyDeveloperAuthorization(request.headers.authorization);
  if (authorization === null) {
    return demoRouteError(requestId, apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'));
  }
  const read = input.durable.goalOf(goalProject);
  if (!read.ok) {
    return demoRouteError(requestId, apiError('unavailable', `the durable projection is degraded (${read.error.code}): ${read.error.message} — the goal read answers the typed degraded state (R46)`));
  }
  if (read.value === null) {
    return demoRouteError(requestId, apiError('not_found', `no goal statement exists for ${JSON.stringify(goalProject)} in the durable projection of this tenant (the goal read serves the create-project input's persisted goal set)`));
  }
  return demoRouteSuccess(requestId, deepFreeze({ goal: read.value.goal, constraintSet: read.value.constraintSet }));
}

// ---------------------------------------------------------------------------
// THE DRAIN-FAILURE RESPONSE (the W-25D ordering law's failure half)
// ---------------------------------------------------------------------------

/**
 * The response the host serves when a request's durable writes failed the
 * drain: the SAME request id and envelope headers the boundary minted, the
 * typed `unavailable` 503 carrying the durable failure's code — the caller
 * learns the mutation is UNCONFIRMED (the seam re-projects from the durable
 * truth; the unconfirmed mutation never serves). The boundary's own audit
 * trail keeps its record of the pipeline's decision (the port call
 * succeeded in-memory); the host-side degradation is this response — a
 * documented limitation of the sync-port seam (the T041-side async
 * widening removes it).
 */
export function drainedFailureResponse(original: ApiResponse, failure: { readonly code: string; readonly message: string }): ApiResponse {
  const body = original.body as { readonly requestId?: unknown } | null;
  const requestId = (typeof body?.requestId === 'string' ? body.requestId : original.headers['x-request-id']) as RequestId;
  const headers: Record<string, string> = { ...original.headers };
  delete headers['retry-after-ms'];
  return deepFreeze({
    status: 503,
    headers,
    body: {
      requestId,
      error: apiError('unavailable', `the durable write failed (${failure.code}): ${failure.message} — the mutation is unconfirmed; the seam re-projects from the durable store and the boundary degrades this request (R46)`),
    },
  });
}
