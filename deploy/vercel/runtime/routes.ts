// deploy/vercel/runtime/routes.ts — THE HOST-OWNED DEMO-SUBSTANCE READ
// ROUTES (T052 follow-up W-8 — the Phase-2 fix-forward, R2/R5).
//
// WHAT THIS IS: three ADDITIVE read-only routes the HOST (this Vercel
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
//     EVERY PROJECT'S OWN GOAL + CONSTRAINT SET (R5 — "a limit without
//     a number is not a limit"; W-25B, D-4): the demo project's goal
//     statement and constraint set with NUMERIC predicate bounds
//     end-to-end (the seeded records, byte-identical to the pre-W-25B
//     behavior), and EVERY OTHER project's own goal + constraint set —
//     the create-project records the demo backing retained at the
//     control-plane port seam (runtime/demo.ts's demoControlPlane:
//     every create rides the same port the demo seed's own create
//     rides, so a LAUNCHED project's goal is on record the moment it
//     exists — D-4's root cause was that the route never read them
//     back). A project with no goal on record still answers the typed
//     not-found (unknown and cross-tenant indistinguishable).
//
//   GET /v1/jobs?project=<projectId>   (W-25A, D-3)
//     THE JOBS LIST: one page of JobRecord rows — the backing's
//     API-OWNED job store, the SAME store the per-id GET
//     /v1/jobs/:jobId reads (the frozen route), folded to the
//     credential tenant's own rows for the requested project — the
//     SEEDED demo jobs (the W-25A seed: one research + one learning
//     submission for the demo project) plus every LIVE submission the
//     boundary accepted (a launched project's kickoff job included —
//     after a console reload the read refills it). The console's boot
//     read dispatches the existing job-updated event per served row,
//     so the Research section and the palette's JOB group populate on
//     every fresh boot (D-3: "JOB: not searchable in any scope"; the
//     J8-spec goal — navigate to a job via the palette alone).
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
// THE DURABLE SUBSTANCE READS (W-25D's goal, D-5; W-26C's jobs list +
// blotter, R4): under the DURABLE backing the host serves the same
// substance paths the demo arm serves, through the demo arm's OWN route
// handlers (imported, never duplicated — the same folds, the same auth,
// the same envelope): GET /v1/projects/:projectId/goal reads the seam's
// HYDRATED goal set (the create-project input's records, persisted at
// createProject time and rehydrated at every cold start — W-25D); since
// W-26C, GET /v1/jobs?project= (D-3 — the console's Research list and
// palette JOB entries broke under durable) and GET
// /v1/execution/submissions (the execution blotter) serve from the
// composed service's per-instance stores — demoJobsOf over the composed
// service's API-owned job store (the same store the per-id GET reads;
// the boot world re-seeds the demo jobs per instance) and the
// submissions fold over the seeded demo blotter + the durable
// composition's recording gateway (serveDurableSubstanceRoute below).
// The two backings serve their own data with the same envelope
// discipline (never merged); under port overrides (the injection seam
// owns its own world) the jobs + submissions routes fall through to the
// boundary exactly as before (the pre-W-8 law).
//
// Zero-dep law: platform APIs only. Spec anchors: R43 (the composed
// API surface — additive), L12, L20, R46, phase2-competitive-report
// R2/R5, D-5, D-3 (W-25A + W-26C), D-4 (W-25B).

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
  type JobRecord,
  type RequestId,
} from '../../../services/api/src/index';
import { DEMO_PROJECT_ID, demoConstraintSet, demoGoalSetOf, demoGoalStatement, demoSubmissionsOf, type DemoPorts, type DemoSubstanceSource, type DurableDemoSubstance } from './demo';
import type { DurableBackingHandle } from './durable';

/** The host auth's verdict: the credential tenant + principal behind the presented token. */
export interface DemoSubstanceAuthorization {
  readonly tenant: string;
  readonly principal: string;
}

/** The composition's host-auth seam (runtime/compose.ts mints it from the registered developer credential). */
export type VerifyDeveloperAuthorization = (authorization: string | undefined) => DemoSubstanceAuthorization | null;

/**
 * The execution-blotter + jobs-list routes' STRUCTURAL input (W-26C, R4):
 * the folds' source + the host auth — BOTH arms build it (the demo arm
 * from its DemoPorts, the durable arm from the composition's own pair),
 * so the two routes serve with literally the same handlers, folds, auth
 * and envelope under both backings.
 */
export interface FoldRouteInput {
  /** The submissions fold's source (the seeded blotter + a recording gateway — DemoPorts under demo, the durable composition's own pair under durable). */
  readonly ports: DemoSubstanceSource;
  /** The host auth seam (the composition's registered developer credential). */
  readonly verifyDeveloperAuthorization: VerifyDeveloperAuthorization;
  /**
   * THE JOBS-STORE READ (D-3, W-25A): the backing's API-owned job records —
   * the SAME store the per-id GET /v1/jobs/:jobId reads — folded to one
   * tenant's rows for one project (runtime/demo.ts's demoJobsOf; the call
   * site wires it over the composed service). L12 by construction: the
   * fold filters on the AUTHORIZED tenant, never a request value.
   */
  readonly jobsOf: (tenant: string, project: string) => readonly JobRecord[];
}

/** The host-route serving input (the demo dispatcher's — the fold routes' structural surface + the demo goal route's capture). */
export interface DemoSubstanceRouteInput extends FoldRouteInput {
  /** The demo backing's FULL port set (the goal route's capture reads the control-plane seam — demoGoalSetOf). */
  readonly ports: DemoPorts;
}

/** The demo-substance read paths this host serves (additive — declared nowhere in the frozen route table). */
export const DEMO_SUBSTANCE_ROUTE_PATHS = deepFreeze(['/v1/execution/submissions', '/v1/projects/:projectId/goal', '/v1/jobs'] as const);

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

/** GET /v1/execution/submissions?project=<id> — the execution blotter (R2; both arms — W-26C R4). */
function executionSubmissionsRoute(input: FoldRouteInput, request: DemoSubstanceRequest, requestId: RequestId): ApiResponse {
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

/** GET /v1/jobs?project=<id> — the jobs list (D-3, the W-25A seam; both arms — W-26C R4). */
function jobsListRoute(input: FoldRouteInput, request: DemoSubstanceRequest, requestId: RequestId): ApiResponse {
  const authorization = input.verifyDeveloperAuthorization(request.headers.authorization);
  if (authorization === null) {
    return demoRouteError(requestId, apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'));
  }
  const project = request.query?.project;
  if (project === undefined || !isProjectId(project)) {
    return demoRouteError(requestId, apiError('validation_failed', 'the project query parameter is required (the jobs list is project-scoped)'));
  }
  // L12 by construction: the served rows are the credential tenant's own —
  // the fold filters on the AUTHORIZED tenant (a request value never
  // steers it), and a foreign project's page is empty, never a leak.
  return demoRouteSuccess(requestId, deepFreeze({ items: input.jobsOf(authorization.tenant, project) }));
}

/** The `/v1/projects/:projectId/goal` path match (the captured project id, or null). */
function matchProjectGoalPath(path: string): string | null {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 4) return null;
  if (segments[0] !== 'v1' || segments[1] !== 'projects' || segments[3] !== 'goal') return null;
  const projectId = segments[2] as string;
  return isProjectId(projectId) ? projectId : null;
}

/**
 * GET /v1/projects/:projectId/goal (R5, W-25B/D-4) — the project's OWN goal
 * + constraint set under the DEMO backing:
 *   - the DEMO project -> the seeded records (the hard-coded
 *     demoGoalStatement/demoConstraintSet exports — byte-identical to
 *     the pre-W-25B behavior);
 *   - a LAUNCHED project -> ITS OWN goal + constraint set, the create-input
 *     records the backing retained at the control-plane port seam
 *     (runtime/demo.ts's demoControlPlane — every create rides the same
 *     port the demo seed's own create rides, so the capture holds them);
 *   - a project with no goal on record (unknown ids, cross-tenant, a
 *     refused create, a record lost to a serverless cold start) -> the
 *     typed not-found (unchanged; unknown and cross-tenant stay
 *     indistinguishable, the boundary's own law).
 * L12 by construction: the served records are the AUTHORIZED tenant's
 * own (the fold keys on `authorization.tenant`, never a request value —
 * a foreign tenant's goal never crosses).
 */
function projectGoalRoute(input: DemoSubstanceRouteInput, request: DemoSubstanceRequest, requestId: RequestId, projectId: string): ApiResponse {
  const authorization = input.verifyDeveloperAuthorization(request.headers.authorization);
  if (authorization === null) {
    return demoRouteError(requestId, apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'));
  }
  if (projectId === DEMO_PROJECT_ID) {
    // The seeded records — byte-identical to the pre-W-25B serve (the demo
    // project's goal stays the fixed seed whatever the capture holds).
    return demoRouteSuccess(requestId, deepFreeze({ goal: demoGoalStatement(authorization.tenant), constraintSet: demoConstraintSet(authorization.tenant) }));
  }
  const captured = demoGoalSetOf(input.ports, authorization.tenant, projectId);
  if (captured === null) {
    // No goal on record for this project at this host (unknown and
    // cross-tenant stay indistinguishable, the boundary's own law).
    return demoRouteError(requestId, apiError('not_found', `no goal statement exists for ${JSON.stringify(projectId)} at this host (the goal read serves each project's own create-project records; nothing is on record for this one)`));
  }
  return demoRouteSuccess(requestId, deepFreeze({ goal: captured.goal, constraintSet: captured.constraintSet }));
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
  if (request.path === '/v1/jobs') {
    // The exact 2-segment list path (the per-id GET /v1/jobs/:jobId is
    // the frozen route's own 3-segment shape — never a collision).
    return jobsListRoute(input, request, demoRouteRequestId(request, serial));
  }
  const goalProject = matchProjectGoalPath(request.path);
  if (goalProject !== null) {
    return projectGoalRoute(input, request, demoRouteRequestId(request, serial), goalProject);
  }
  return null;
}

// ---------------------------------------------------------------------------
// THE DURABLE SUBSTANCE ROUTES (W-25D's goal read, D-5; W-26C's jobs list
// + execution blotter, R4 — the durable arm's host-owned reads)
// ---------------------------------------------------------------------------

/** The durable backing's substance-route surface (the seam handle + the demo-substance folds + the host auth seam). */
export type DurableSubstanceRouteInput = {
  /** The durable seam (the hydrated goal sets + the typed degraded state). */
  readonly durable: DurableBackingHandle;
  /** The host auth seam (the composition's registered developer credential). */
  readonly verifyDeveloperAuthorization: VerifyDeveloperAuthorization;
  /**
   * THE DURABLE DEMO-SUBSTANCE READS (W-26C, R4 — D-3 + the blotter under
   * durable): the SAME folds the demo arm serves (demoJobsOf +
   * demoSubmissionsOf — imported, never duplicated), wired by the
   * composition over the composed service's per-instance stores. `null`
   * when the composition does not own the world (port overrides) — the
   * jobs + submissions routes then fall through to the boundary exactly
   * as before (the pre-W-8 law).
   */
  readonly demoSubstance: DurableDemoSubstance | null;
};

/**
 * THE DURABLE ARM'S SUBSTANCE DISPATCHER (W-26C, R4): under the DURABLE
 * backing the host serves — with the SAME auth + envelope discipline the
 * demo arm applies, through the SAME route handlers (imported, never
 * duplicated) — the paths that previously fell through to the boundary:
 *
 *   GET /v1/jobs?project=<id>            (D-3 — the Research list + the
 *                                        palette JOB entries; the re-seeded
 *                                        demo jobs + every live submission
 *                                        the boundary accepted, from the
 *                                        composed service's API-owned job
 *                                        store — the same store the per-id
 *                                        GET reads)
 *   GET /v1/execution/submissions        (the execution blotter — the
 *                                        seeded demo rows + the session's
 *                                        live routed submissions, from the
 *                                        seeded demo blotter + the durable
 *                                        composition's recording gateway)
 *   GET /v1/projects/:projectId/goal     (the W-25D goal read, D-5 —
 *                                        UNCHANGED: the seam's hydrated
 *                                        goal sets, the create-project
 *                                        input's records persisted at
 *                                        createProject time and rehydrated
 *                                        at every cold start; the typed
 *                                        not-found for a project without
 *                                        one, the typed 503 while the
 *                                        projection is degraded — R46)
 *
 * Returns `null` when the request is NOT one of them (the caller falls
 * through to the frozen boundary — the pre-W-8 behavior, byte-identical)
 * or when the method is not the route's own. Under port overrides
 * (`demoSubstance === null`) the jobs + submissions routes fall through —
 * the injection seam owns its own world.
 */
export function serveDurableSubstanceRoute(input: DurableSubstanceRouteInput, request: DemoSubstanceRequest, serial: number): ApiResponse | null {
  if (request.method !== 'GET') return null;
  // R4 (W-26C): the jobs list + the execution blotter serve under durable
  // through the DEMO arm's own handlers — the same folds (demoJobsOf +
  // demoSubmissionsOf), the same auth, the same envelope, D-3 preserved.
  if (input.demoSubstance !== null && (request.path === '/v1/jobs' || request.path === '/v1/execution/submissions')) {
    const foldInput: FoldRouteInput = {
      ports: input.demoSubstance.ports,
      verifyDeveloperAuthorization: input.verifyDeveloperAuthorization,
      jobsOf: input.demoSubstance.jobsOf,
    };
    if (request.path === '/v1/execution/submissions') {
      // The exact 2-segment blotter path (the boundary's own 3-segment
      // per-resource shapes are never collided with).
      return executionSubmissionsRoute(foldInput, request, demoRouteRequestId(request, serial));
    }
    // The exact 2-segment list path (the per-id GET /v1/jobs/:jobId is
    // the frozen route's own 3-segment shape — never a collision).
    return jobsListRoute(foldInput, request, demoRouteRequestId(request, serial));
  }
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
