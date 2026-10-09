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
// THE STANDING RISK-UTILIZATION READ (FW-31-A, Round A blocker 1 —
// risk_tooling, the only losing dimension): GET /v1/risk/utilization?
// project=<id> — ONE additive host-owned read serving, per constraint in
// the project's own goal set, the declared bound + the STANDING CURRENT
// UTILIZATION (a number only when the records on file can produce a
// defensible one — else null with status "unknown", never fabricated)
// + the ACTIVE-BREACH aggregation (every refusal on file, bound-vs-
// observed, audit refs, instants). Served by BOTH arms with the same
// auth + envelope discipline (see runtime/risk-utilization.ts — the
// module owns the read; this file only dispatches).
//
// Zero-dep law: platform APIs only. Spec anchors: R43 (the composed
// API surface — additive), L12, L20, R46, phase2-competitive-report
// R2/R5, D-5, D-3 (W-25A + W-26C), D-4 (W-25B), ROUND-A-REPORT §4
// blocker 1 + §6 (FW-31-A).

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
  type ConstraintSetStatement,
  type FirmMemoryPort,
  type GoalStatement,
  type JobRecord,
  type OrgStatusSnapshot,
  type OutcomeLearningPort,
  type OutcomeRecordMirror,
  type PostMortemRecordMirror,
  type RequestId,
  type ServedKnowledge,
  type TimestampMs,
} from '../../../services/api/src/index';
import { DEMO_PROJECT_ID, demoConstraintSet, demoGoalSetOf, demoGoalStatement, demoSubmissionsOf, demoWorldOf, isLaunchWorldRecord, withDerivedHorizonLabel, type DemoPorts, type DemoSubstanceSource, type DurableDemoSubstance } from './demo';
import type { DurableBackingHandle, DdlApplyResult, DdlVerifyResult } from './durable';
import { matchProjectHydrationPath, serveProjectHydrationRoute } from './hydration';
import { RISK_UTILIZATION_ROUTE_PATH, serveRiskUtilizationRoute } from './risk-utilization';

/**
 * One outcome-records read over a backing's outcome-learning port (the
 * risk-utilization read's risk-budget source). Null = NOT READABLE (the
 * port's typed failure) — never an empty array: an honest zero-record
 * read is an empty array (the empty sum is 0, disclosed with its count);
 * a failed read is unknown, and the read degrades to null/unknown (the
 * honesty law — FW-31-A).
 */
function outcomeRecordsOf(port: OutcomeLearningPort, tenant: string, project: string): readonly OutcomeRecordMirror[] | null {
  const result = port.queryOutcomes({ tenant, project }, { at: Date.now() as TimestampMs, retention: null });
  return result.ok ? result.value : null;
}

/**
 * One post-mortem-records read over a backing's outcome-learning port (the
 * hydration read's fold — the FW-31-A honesty law, verbatim: null = NOT
 * READABLE, never a lying zero).
 */
function postMortemRecordsOf(port: OutcomeLearningPort, tenant: string, project: string): readonly PostMortemRecordMirror[] | null {
  const result = port.queryPostMortems({ tenant, project }, { at: Date.now() as TimestampMs, retention: null });
  return result.ok ? result.value : null;
}

/**
 * One knowledge read over a backing's firm-memory port (the hydration
 * read's fold — the SAME read POST /v1/knowledge/query drives; null = NOT
 * READABLE, never a lying zero — the FW-31-A honesty law).
 */
function knowledgeRecordsOf(port: FirmMemoryPort, tenant: string, project: string): readonly ServedKnowledge[] | null {
  const result = port.queryKnowledge({ tenant, project }, { at: Date.now() as TimestampMs, retention: null });
  return result.ok ? result.value : null;
}

/** The host auth's verdict: the credential tenant + principal behind the presented token. */
export interface DemoSubstanceAuthorization {
  readonly tenant: string;
  readonly principal: string;
}

/** The composition's host-auth seam (runtime/compose.ts mints it from the registered developer credential). */
export type VerifyDeveloperAuthorization = (authorization: string | undefined) => DemoSubstanceAuthorization | null;

/**
 * The internal auth's verdict (W-28, lane B): the principal behind the
 * presented internal credential. The principal is the audit name (the
 * boundary's own law — WHO, not WHAT); the runbook routes are SCHEMA-LEVEL
 * (no tenant scope — they touch NO tenant data, L12 by construction: the
 * DDL is schema-only, the verify queries information_schema only). The
 * host-owned runbook routes authenticate themselves with the SAME law the
 * boundary applies to its /internal/* routes: a Bearer token that is not
 * the deployment's registered internal credential is the typed 401.
 */
export interface InternalAuthorization {
  readonly principal: string;
}

/**
 * The composition's internal host-auth seam (runtime/compose.ts mints it
 * from the registered internal credential — the same secure-boundary act
 * that registers the developer credential, W-3f's private-plane closure).
 * Returns `null` when the internal credential is NOT configured OR the
 * presented token does not match — the host-owned internal routes then
 * answer the typed 401 (authn first — the existing demo-substance routes'
 * own law).
 */
export type VerifyInternalAuthorization = (authorization: string | undefined) => InternalAuthorization | null;

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
  /**
   * THE WATCH-STORE SNAPSHOTS (FW-34-A — the hydration read's organization
   * fold): the composition's own service surface (the SAME per-instance
   * store GET /v1/organizations/:ref/status serves). Optional so existing
   * constructions stay valid; the router always wires it.
   */
  readonly watchSnapshots?: () => readonly OrgStatusSnapshot[];
}

/** The demo-substance read paths this host serves (additive — declared nowhere in the frozen route table; the risk-utilization read since FW-31-A; the hydration read since FW-34-A). */
export const DEMO_SUBSTANCE_ROUTE_PATHS = deepFreeze(['/v1/execution/submissions', '/v1/projects/:projectId/goal', '/v1/projects/:projectId/hydration', '/v1/jobs', '/v1/risk/utilization'] as const);

// ---------------------------------------------------------------------------
// The envelope discipline (mirrors the boundary's own response builders)
// ---------------------------------------------------------------------------

/** The minimal request surface the host routes consume (the wrapped ApiRequest carries exactly these). */
export type DemoSubstanceRequest = Pick<ApiRequest, 'method' | 'path' | 'query' | 'headers'>;

/**
 * The envelope helpers (shared with the session-scope routes — FW-MI-A):
 * the SAME request-id minting + success/error envelope discipline the
 * demo-substance routes built (imported, never duplicated).
 */
export function demoRouteRequestId(request: DemoSubstanceRequest, serial: number): RequestId {
  return mintRequestId(fnv1a32Hex(canonicalJson(['demo-substance-route', request.method, request.path, serial] as never)));
}

/** The shared success envelope (the boundary's own { requestId, data } shape + the version header). */
export function demoRouteSuccess(requestId: RequestId, data: unknown, status = 200): ApiResponse {
  return deepFreeze({ status, headers: { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION }, body: { requestId, data } });
}

/** The shared error envelope (the boundary's own { requestId, error } shape + the retry header when present). */
export function demoRouteError(requestId: RequestId, error: ApiError): ApiResponse {
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
  // (the demo world is seeded per composition for exactly this tenant;
  // the DERIVED per-project rows key on the authorized tenant — FW-MI-B).
  return demoRouteSuccess(requestId, deepFreeze({ items: demoSubmissionsOf(input.ports, authorization.tenant, project) }));
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
    // project's goal stays the fixed seed whatever the capture holds). The
    // demo project's goal set carries NO world by design (its seed jobs
    // ride demo-seed specs — D-8's teaching empty state is correct for the
    // demo scope), so the bundle serves no `world` field here either.
    return demoRouteSuccess(requestId, deepFreeze({ goal: demoGoalStatement(authorization.tenant), constraintSet: demoConstraintSet(authorization.tenant) }));
  }
  const captured = demoGoalSetOf(input.ports, authorization.tenant, projectId);
  if (captured === null) {
    // No goal on record for this project at this host (unknown and
    // cross-tenant stay indistinguishable, the boundary's own law).
    return demoRouteError(requestId, apiError('not_found', `no goal statement exists for ${JSON.stringify(projectId)} at this host (the goal read serves each project's own create-project records; nothing is on record for this one)`));
  }
  // D-8 (W-28): the launch's world specification, retained at the job-port
  // seam when this project's kickoff job carried a console-launch spec —
  // served as the ADDITIVE `world` field so the console's Market World
  // section renders the PERSISTED world after a reload or a scope switch
  // (absent for a project launched pre-W-28 or without a world — the
  // console degrades to its teaching empty state, never a fabricated one).
  const world = demoWorldOf(input.ports, authorization.tenant, projectId);
  return demoRouteSuccess(requestId, deepFreeze({
    goal: captured.goal,
    constraintSet: captured.constraintSet,
    ...(world === null ? {} : { world }),
  }));
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
  // THE PROJECT HYDRATION READ (FW-34-A, Round C register item 3 — the
  // loading-vs-empty truth): served from the SAME folds the console's own
  // boot bundle reads (the demo backing's per-instance stores — honest
  // under SIMULATED), so the first paint can distinguish LOADING from
  // HONEST-EMPTY without lying in either direction.
  if (matchProjectHydrationPath(request.path) !== null) {
    return serveProjectHydrationRoute(
      {
        verifyDeveloperAuthorization: input.verifyDeveloperAuthorization,
        projectOf: (tenant, project) => {
          const listed = input.ports.controlPlane.projectsOf(tenant as never);
          return listed.ok ? (listed.value.find((record) => (record.id as string) === project) ?? null) : null;
        },
        jobsOf: input.jobsOf,
        submissionsOf: (tenant, project) => demoSubmissionsOf(input.ports, tenant, project),
        outcomesOf: (tenant, project) => outcomeRecordsOf(input.ports.outcomeLearning, tenant, project),
        postMortemsOf: (tenant, project) => postMortemRecordsOf(input.ports.outcomeLearning, tenant, project),
        knowledgeOf: (tenant, project) => knowledgeRecordsOf(input.ports.firmMemory, tenant, project),
        ...(input.watchSnapshots === undefined ? {} : { watchSnapshots: input.watchSnapshots }),
      },
      request,
      serial,
      'demo',
    );
  }
  if (request.path === '/v1/execution/submissions') {
    return executionSubmissionsRoute(input, request, demoRouteRequestId(request, serial));
  }
  if (request.path === '/v1/jobs') {
    // The exact 2-segment list path (the per-id GET /v1/jobs/:jobId is
    // the frozen route's own 3-segment shape — never a collision).
    return jobsListRoute(input, request, demoRouteRequestId(request, serial));
  }
  if (request.path === RISK_UTILIZATION_ROUTE_PATH) {
    // THE STANDING RISK-UTILIZATION READ (FW-31-A): the demo arm's wiring
    // — the constraint bounds from the project's OWN goal set (the demo
    // project's seeded records byte-identical, every launched project's
    // W-25B capture), the observations from the SAME blotter fold the
    // execution route serves, and the risk-budget source from the
    // backing's own (FW-MI-B wrapped) outcome-learning port. L12 by
    // construction: every fold keys on the AUTHORIZED tenant.
    return serveRiskUtilizationRoute(
      {
        verifyDeveloperAuthorization: input.verifyDeveloperAuthorization,
        goalSetOf: (tenant, project) => {
          if (project === DEMO_PROJECT_ID) {
            // The seeded records — byte-identical to the goal route's own
            // demo-project serve (the capture holds them too, but the seed
            // is the canonical source for the demo scope).
            return { ok: true, value: { goal: demoGoalStatement(tenant), constraintSet: demoConstraintSet(tenant) } };
          }
          const captured = demoGoalSetOf(input.ports, tenant, project);
          return { ok: true, value: captured === null ? null : { goal: captured.goal, constraintSet: captured.constraintSet } };
        },
        submissionsOf: (tenant, project) => demoSubmissionsOf(input.ports, tenant, project),
        outcomesOf: (tenant, project) => outcomeRecordsOf(input.ports.outcomeLearning, tenant, project),
        backing: 'demo',
      },
      request,
      serial,
    );
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
  /**
   * THE WATCH-STORE SNAPSHOTS (FW-34-A — the hydration read's organization
   * fold): the composition's own service surface (the SAME per-instance
   * store GET /v1/organizations/:ref/status serves). Optional so existing
   * constructions stay valid; the router always wires it.
   */
  readonly watchSnapshots?: () => readonly OrgStatusSnapshot[];
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
  // THE PROJECT HYDRATION READ (FW-34-A, Round C register item 3 — the
  // loading-vs-empty truth): served from the SAME folds the console's own
  // boot bundle reads — the seam's hydrated projection (the project record
  // + the knowledge/outcome port chains) and the composition's per-instance
  // stores (the jobs + submissions folds, the watch store). Under port
  // overrides (demoSubstance === null) the read falls through to the
  // boundary exactly like the jobs + submissions routes (the pre-W-8 law).
  if (matchProjectHydrationPath(request.path) !== null) {
    if (input.demoSubstance === null) return null;
    const demoSubstance = input.demoSubstance;
    return serveProjectHydrationRoute(
      {
        verifyDeveloperAuthorization: input.verifyDeveloperAuthorization,
        projectOf: (tenant, project) => {
          const listed = input.durable.ports.controlPlane.projectsOf(tenant as never);
          return listed.ok ? (listed.value.find((record) => (record.id as string) === project) ?? null) : null;
        },
        jobsOf: demoSubstance.jobsOf,
        submissionsOf: (tenant, project) => demoSubmissionsOf(demoSubstance.ports, tenant, project),
        outcomesOf: (tenant, project) => outcomeRecordsOf(demoSubstance.outcomeLearning, tenant, project),
        postMortemsOf: (tenant, project) => postMortemRecordsOf(demoSubstance.outcomeLearning, tenant, project),
        knowledgeOf: (tenant, project) => knowledgeRecordsOf(demoSubstance.firmMemory, tenant, project),
        ...(input.watchSnapshots === undefined ? {} : { watchSnapshots: input.watchSnapshots }),
      },
      request,
      serial,
      'durable',
    );
  }
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
  if (request.path === RISK_UTILIZATION_ROUTE_PATH) {
    // THE STANDING RISK-UTILIZATION READ (FW-31-A), the durable arm's
    // wiring: the constraint bounds from the seam's HYDRATED goal set
    // (the W-25D surface the goal route reads — the typed degraded 503
    // and the typed not-found are the read's own), the observations from
    // the SAME demoSubstancesOf blotter fold the execution route serves
    // (this composition's own stores), and the risk-budget source from
    // the SAME WRAPPED OUTCOME-LEARNING CHAIN POST /v1/outcomes/query
    // serves (demoSubstance.outcomeLearning — the seam's hydrated port +
    // the per-project evidence fold + the promoted-decisions registry,
    // the composition's own one port object). FW-35-A (Round D register
    // §3.8, L1's third-round finding): the fold PREVIOUSLY read the
    // seam's BARE hydrated port, so a launched desk's risk-budget row
    // read "0 outcome record(s) readable by this fold" while the
    // Outcomes surface rendered the derived + promoted records the
    // wrapped chain serves — the fold/seam divergence, now closed by
    // construction: both reads fold THE SAME PORT OBJECT, so the count
    // the risk fold names is exactly the count the console's own outcome
    // read (and the export's capsule fold) carries. Under port overrides
    // (demoSubstance === null — the injection seam owns its own world)
    // the route falls through to the boundary exactly like the jobs +
    // submissions routes (the pre-W-8 law).
    const demoSubstance = input.demoSubstance;
    if (demoSubstance === null) return null;
    return serveRiskUtilizationRoute(
      {
        verifyDeveloperAuthorization: input.verifyDeveloperAuthorization,
        goalSetOf: (_tenant, project) => {
          const read = input.durable.goalOf(project);
          if (!read.ok) return { ok: false, code: read.error.code, message: read.error.message };
          if (read.value === null) return { ok: true, value: null };
          const goal = read.value.goal;
          const constraintSet = read.value.constraintSet;
          // Structural narrowing of the hydrated row (the goal route
          // serves the records verbatim; THIS read must iterate the
          // constraints — a malformed row answers the honest not-found,
          // never fabricated bounds, never a crash — R46).
          if (typeof goal !== 'object' || goal === null || typeof constraintSet !== 'object' || constraintSet === null || !Array.isArray((constraintSet as { readonly constraints?: unknown }).constraints)) {
            return { ok: true, value: null };
          }
          return { ok: true, value: { goal: goal as GoalStatement, constraintSet: constraintSet as ConstraintSetStatement } };
        },
        submissionsOf: (tenant, project) => demoSubmissionsOf(demoSubstance.ports, tenant, project),
        outcomesOf: (tenant, project) => outcomeRecordsOf(demoSubstance.outcomeLearning, tenant, project),
        backing: 'durable',
      },
      request,
      serial,
    );
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
  // D-8 (W-28): the launch's world specification, persisted at the job-spec
  // seam into the goal-set row's opaque payload (a cold start's projection
  // hydrates it back) — served as the ADDITIVE `world` field, structurally
  // re-validated (a pre-W-28 or malformed payload never crosses; the
  // console degrades to its teaching empty state, never a fabricated one).
  // FW-37-A (F-4): the served world's horizon label is the SPAN-DERIVED one
  // (withDerivedHorizonLabel) — a world persisted before this wave (the
  // console's stale 'one day' annotation on a multi-day horizon) serves the
  // same computed label as a fresh capture, never a contradictory one.
  const world = read.value.world;
  return demoRouteSuccess(requestId, deepFreeze({
    goal: read.value.goal,
    constraintSet: read.value.constraintSet,
    ...(isLaunchWorldRecord(world) ? { world: withDerivedHorizonLabel(world) } : {}),
  }));
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

// ---------------------------------------------------------------------------
// THE HOST-OWNED INTERNAL DDL RUNBOOK ROUTES (W-28, lane B)
//   POST /internal/deploy/ddl/apply  — apply EVERY DDL record in
//                                     `NEON_DDL_RECORDS` (idempotent by
//                                     construction) over the SAME Neon
//                                     SQL-over-HTTP client the durable
//                                     stores compose over; per-table report
//                                     with the honest `"ok"` result (the
//                                     wire does not distinguish "applied"
//                                     from "already-present" — the honesty
//                                     law forbids fabricating a distinction).
//   GET  /internal/deploy/ddl/verify — for each table named in
//                                     `NEON_DDL_RECORDS`, whether it exists
//                                     (information_schema only — L12: NO
//                                     tenant data queried; the query is
//                                     parameterized end-to-end).
//
// AUTH (the internal plane's own credential — authn FIRST, the boundary's
// own 401 law): BOTH routes require `Authorization: Bearer
// <TRADRL_API_INTERNAL_TOKEN>` (env contract in
// `deploy/vercel/runtime/env.ts` — `apiInternalToken`, principal
// `TRADRL_API_INTERNAL_PRINCIPAL`). Invalid/missing → the typed 401 envelope
// the boundary uses (`unauthenticated` — the SAME shape the existing
// demo-substance routes apply to a missing developer credential). When the
// deployment has NO durable backing (Neon keys absent → the seam was not
// built → `deployment.durable === null`): both routes answer the typed
// `deploy_adapter_absent` degraded response (503) — NEVER attempt any Neon
// traffic in that state (the matrix's Neon-absent precedent — pinned by
// test).
//
// HOST-OWNED PATTERN: these routes are served from the host-route section
// of `deploy/vercel/api/router.ts` BEFORE the boundary wrap — the EXACT
// pattern the W-8/W-25A demo-substance routes use (`GET /v1/jobs`,
// `GET /v1/execution/submissions`). The paths are declared nowhere in the
// frozen route table, so without this host-route section they would answer
// the typed not-found; under the DEMO backing they answer the typed
// `deploy_adapter_absent` 503 (the matrix's Neon-absent row — the seam was
// not built).
//
// R46 — every failure path typed; never a crash. L12 — the routes read NO
// tenant data (the DDL is schema-level; the verify query is information_schema
// only). Same-origin law — NO CORS headers ever. No secrets in errors or
// logs — the failure response carries the table name + the neon failure
// code ONLY (scrubbed of any secret-shaped material — the sweep precedent).
// Zero-dep law — platform APIs only.
// ---------------------------------------------------------------------------

/** The host-owned runbook routes' paths (additive — declared nowhere in the frozen route table). */
export const RUNBOOK_ROUTE_PATHS = deepFreeze(['/internal/deploy/ddl/apply', '/internal/deploy/ddl/verify'] as const);

/** The runbook routes' structural input (the durable seam handle + the host's internal auth seam). */
export interface RunbookRouteInput {
  /** The durable seam handle (null when the seam was not built — the matrix's Neon-absent row). */
  readonly durable: DurableBackingHandle | null;
  /** The host's internal-credential auth seam (returns null when the credential is not configured or the token is wrong). */
  readonly verifyInternalAuthorization: VerifyInternalAuthorization;
}

/** The minimal request surface the runbook routes consume (the wrapped ApiRequest carries exactly these). */
type RunbookRequest = Pick<ApiRequest, 'method' | 'path' | 'headers'>;

function runbookRequestId(request: RunbookRequest, serial: number): RequestId {
  return mintRequestId(fnv1a32Hex(canonicalJson(['runbook-route', request.method, request.path, serial] as never)));
}

/** POST /internal/deploy/ddl/apply — apply EVERY DDL record in `NEON_DDL_RECORDS` (idempotent). */
async function ddlApplyRoute(input: RunbookRouteInput, _request: RunbookRequest, requestId: RequestId): Promise<ApiResponse> {
  // AUTHN FIRST (the boundary's own 401 law — match the existing envelope shape exactly).
  const authorization = input.verifyInternalAuthorization(_request.headers.authorization);
  if (authorization === null) {
    return runbookError(requestId, apiError('unauthenticated', 'a Bearer internal credential token is required on this route of the internal plane'));
  }
  // The durable seam must be built (Neon keys present). When it is not, the
  // matrix's Neon-absent precedent applies: the typed `deploy_adapter_absent`
  // 503 — NEVER attempt any Neon traffic in that state.
  if (input.durable === null) {
    return runbookError(requestId, apiError('unavailable', 'the neon adapter is not configured (its environment keys are absent — see deploy/.env.example); the runbook route degrades this request (R46) — deploy_adapter_absent'));
  }
  // Apply EVERY DDL record. The runbook surface on the durable handle
  // composes over the SAME Neon SQL-over-HTTP client the durable stores
  // compose over (no new dependency, no re-implementation of the wire
  // format). On any Neon failure, the typed 503 carrying the failure
  // code ONLY (scrubbed — the table name + the code are safe; raw SQL
  // error text is NOT).
  const result: DdlApplyResult = await input.durable.runbook.applyDdl();
  if (!result.ok) {
    return runbookError(requestId, apiError('unavailable', `${result.error.message}`));
  }
  return runbookSuccess(requestId, deepFreeze({ tables: result.tables }));
}

/** GET /internal/deploy/ddl/verify — report schema truth for each table in `NEON_DDL_RECORDS`. */
async function ddlVerifyRoute(input: RunbookRouteInput, _request: RunbookRequest, requestId: RequestId): Promise<ApiResponse> {
  // AUTHN FIRST (the boundary's own 401 law — match the existing envelope shape exactly).
  const authorization = input.verifyInternalAuthorization(_request.headers.authorization);
  if (authorization === null) {
    return runbookError(requestId, apiError('unauthenticated', 'a Bearer internal credential token is required on this route of the internal plane'));
  }
  // The durable seam must be built (Neon keys present). When it is not, the
  // matrix's Neon-absent precedent applies: the typed `deploy_adapter_absent`
  // 503 — NEVER attempt any Neon traffic in that state.
  if (input.durable === null) {
    return runbookError(requestId, apiError('unavailable', 'the neon adapter is not configured (its environment keys are absent — see deploy/.env.example); the runbook route degrades this request (R46) — deploy_adapter_absent'));
  }
  // Verify schema truth: for each table named in `NEON_DDL_RECORDS`,
  // whether it exists (information_schema only — L12: NO tenant data
  // queried; the query is parameterized end-to-end).
  const result: DdlVerifyResult = await input.durable.runbook.verifyDdl();
  if (!result.ok) {
    return runbookError(requestId, apiError('unavailable', `${result.error.message}`));
  }
  return runbookSuccess(requestId, deepFreeze({ tables: result.tables, coverage: result.coverage }));
}

function runbookSuccess(requestId: RequestId, data: unknown, status = 200): ApiResponse {
  return deepFreeze({ status, headers: { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION }, body: { requestId, data } });
}

function runbookError(requestId: RequestId, error: ApiError): ApiResponse {
  const headers: Record<string, string> = { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION };
  if (error.retryAfterMs !== undefined) headers['retry-after-ms'] = String(error.retryAfterMs);
  return deepFreeze({ status: error.status, headers, body: { requestId, error } });
}

/**
 * Serve one request off the host-owned internal runbook routes. Returns
 * `null` when the request is NOT one of them (the caller falls through to
 * the demo-substance / durable-substance routes or the frozen boundary —
 * the pre-W-28 behavior, byte-identical) or when the method is not the
 * route's own (the boundary answers the typed not-found /
 * method-not-allowed for those paths itself, exactly as before). `serial`
 * is the caller's per-instance request counter — the minted request ids
 * stay unique per invocation (mirrors `serveDemoSubstanceRoute`'s serial).
 *
 * HOST-OWNED PATTERN (cites the W-8/W-25A precedent): the runbook routes
 * are served BEFORE the boundary wrap, exactly like the demo-substance
 * routes (`GET /v1/jobs`, `GET /v1/execution/submissions`). The paths are
 * declared nowhere in the frozen route table; without this host-route
 * section they would answer the typed not-found. Under the DEMO backing
 * (or the durable backing without Neon keys) they answer the typed
 * `deploy_adapter_absent` 503 (the matrix's Neon-absent row — the seam
 * was not built).
 */
export async function serveRunbookRoute(input: RunbookRouteInput, request: RunbookRequest, serial: number): Promise<ApiResponse | null> {
  if (request.path === '/internal/deploy/ddl/apply' && request.method === 'POST') {
    return ddlApplyRoute(input, request, runbookRequestId(request, serial));
  }
  if (request.path === '/internal/deploy/ddl/verify' && request.method === 'GET') {
    return ddlVerifyRoute(input, request, runbookRequestId(request, serial));
  }
  return null;
}
