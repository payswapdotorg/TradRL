// deploy/vercel/runtime/hydration.ts — THE PROJECT HYDRATION READ (FW-34-A,
// Round C register item 3 — the loading-vs-empty truth).
//
// THE HOLE THIS CLOSES (ROUND-C-REPORT §3.3 — L4, M1, S2): the console's
// resume first-paint renders 4–45s of "No project history is on record
// yet" / "Not compiled yet" / shrinking counts on a WARM, fully-populated
// scope while its own sequential boot bundle (meta -> listing -> project
// -> goal -> knowledge -> outcomes -> post-mortems -> submissions -> jobs
// -> risk -> org-status) is still in flight. The honest-empty state and
// the loading state are INDISTINGUISHABLE client-side: every empty render
// the console can produce before its reads land reads exactly like the
// record-loss signature (L4: "reads like record loss"; M1: "the exact
// perception behind my Round B filing"). The console cannot fix this
// alone — it needs the HOST's own view of what is on record for the scope
// in ONE round trip it can fire FIRST, so "the host holds N records, the
// console has fetched 0 of them" (LOADING) and "the host holds 0 records"
// (HONEST-EMPTY) become distinguishable — never by lying in either
// direction.
//
// WHAT THIS IS: ONE additive host-owned read route —
//
//   GET /v1/projects/:projectId/hydration
//
// — served BEFORE the boundary wrap with developer-credential authn (the
// W-8 host-route law; the path is declared NOWHERE in the frozen T041
// route table, so without this module it answers the typed not_found, and
// under port overrides the durable arm falls through exactly like the
// jobs + submissions routes — the pre-W-8 law). The response is the
// loading-vs-empty truth in one round trip:
//
//   - `organization` — the project's own bind state (bound?, the ref) and
//     the LATEST watch snapshot on record for it, VERBATIM (the same
//     per-instance watch store GET /v1/organizations/:ref/status serves —
//     after FW-34-A every instance reports it at the DURABLE COMPILE
//     instant, so the snapshot is byte-identical across instances): the
//     console can paint the Organization card from THIS read instead of
//     the bundle's LAST one (L4's 45s "Not compiled yet" window).
//   - `records` — ONE COUNT PER SURFACE the console's boot bundle reads:
//     jobs (the GET /v1/jobs fold), submissions (the GET
//     /v1/execution/submissions fold), outcomes / post-mortems /
//     knowledge (the POST query port chains). Every count comes from the
//     EXACT SAME fold the console's own read drives (the composition
//     wires the same service objects into this route's input), so the
//     counts never disagree with the reads that follow.
//   - THE HONESTY LAW (never a lying zero): a surface whose fold answers
//     its typed port failure serves `null` — NOT READABLE, named in the
//     `unreadable` list — never 0 (a 0 would assert "honestly empty"
//     about a surface that could not be read). A count of 0 means exactly
//     what it says: the fold served an empty page.
//   - `disclosure` — the plain-language source note (the anti-deception
//     law's own surface).
//
// THE CONSUMPTION SHAPE (coordinated with apps/web — additive): the
// console fires this read FIRST in its boot bundle; while the rest of the
// bundle is in flight, a section whose read has not landed renders its
// LOADING state when the host's count for that surface is > 0 (or the
// read is in flight and the surface is unreadable), and its HONEST-EMPTY
// state when the host's count is 0. When a read lands, the console's own
// state wins (the counts are the same by construction). The response adds
// no new truth of its own — it bundles the host's existing folds into one
// round trip so the first paint never has to guess.
//
// THE AUTH LAW (the W-8 host-route law, verbatim): the host owns the
// credential registrations, so it authenticates this route itself — a
// Bearer token that is not the deployment's registered developer
// credential is the typed 401 (`unauthenticated`); the served records are
// the CREDENTIAL TENANT'S own (L12 by construction — every fold keys on
// the authorized tenant, never a request value). A project with no record
// on this backing answers the typed not-found (unknown and cross-tenant
// stay indistinguishable, the boundary's own law). DOCUMENTED LIMITATION
// (honest, the W-8 precedent): this read runs outside the T041 pipeline's
// metering/audit tail; it is a READ only, additive to the prebuilt
// function's host-route section.
//
// NO CORS headers are ever emitted (the same-origin law — pinned by
// deploy/vercel/vercel.test.ts, which scans the runtime tree).
//
// THE NO-CYCLE LAW (the risk-utilization.ts precedent): this module is
// imported BY runtime/routes.ts (the dispatcher), so it imports ONLY
// types from './routes' (type-only imports are erased — no runtime cycle)
// and builds its own envelope helpers from the frozen service's own
// primitives.
//
// Zero-dep law: platform APIs only. Spec anchors: R43 (the composed API
// surface — additive), R46 (every failure path typed; never a crash), L12,
// L20, UX-DESIGN §7 (the anti-deception law), ROUND-C-REPORT §3.3 + §6
// (FW-34-A).

import {
  apiError,
  canonicalJson,
  CURRENT_API_VERSION,
  deepFreeze,
  fnv1a32Hex,
  isProjectId,
  isProjectRecord,
  mintRequestId,
  type ApiError,
  type ApiResponse,
  type GatewaySubmissionRecord,
  type JobRecord,
  type OrgStatusSnapshot,
  type OutcomeRecordMirror,
  type PostMortemRecordMirror,
  type ProjectRecord,
  type RequestId,
  type ServedKnowledge,
} from '../../../services/api/src/index';
import type { DemoSubstanceRequest, VerifyDeveloperAuthorization } from './routes';

/** The hydration read's path segment (the `/v1/projects/:projectId/hydration` grammar — additive, declared nowhere in the frozen route table). */
const HYDRATION_PATH_SEGMENT = 'hydration';

// ---------------------------------------------------------------------------
// The route's structural input (both arms wire the same shape — the W-26C law)
// ---------------------------------------------------------------------------

/**
 * The hydration read's fold sources — EXACTLY the same folds/routes the
 * console's own boot bundle reads, wired by each arm's dispatcher (the
 * composition injects its own service objects; this module owns no data).
 */
export interface ProjectHydrationRouteInput {
  /** The host auth seam (the composition's registered developer credential — the W-8 law). */
  readonly verifyDeveloperAuthorization: VerifyDeveloperAuthorization;
  /**
   * The project record of (tenant, project) — the bind state's source (the
   * SAME control-plane store the boundary's project reads serve). `null` =
   * no record on this backing (the typed not-found; unknown and
   * cross-tenant stay indistinguishable).
   */
  readonly projectOf: (tenant: string, project: string) => ProjectRecord | null;
  /** The jobs-list fold (the SAME fold GET /v1/jobs?project= serves). */
  readonly jobsOf: (tenant: string, project: string) => readonly JobRecord[];
  /** The submissions fold (the SAME fold GET /v1/execution/submissions serves). */
  readonly submissionsOf: (tenant: string, project: string) => readonly GatewaySubmissionRecord[];
  /**
   * The outcomes fold (the SAME port chain POST /v1/outcomes/query drives).
   * `null` = NOT READABLE (a typed port failure — the honesty law: never a
   * lying zero).
   */
  readonly outcomesOf: (tenant: string, project: string) => readonly OutcomeRecordMirror[] | null;
  /** The post-mortems fold (the SAME port chain POST /v1/post-mortems/query drives) — `null` = NOT READABLE. */
  readonly postMortemsOf: (tenant: string, project: string) => readonly PostMortemRecordMirror[] | null;
  /** The knowledge fold (the SAME port chain POST /v1/knowledge/query drives) — `null` = NOT READABLE. */
  readonly knowledgeOf: (tenant: string, project: string) => readonly ServedKnowledge[] | null;
  /**
   * The watch store's snapshots (the SAME per-instance store GET
   * /v1/organizations/:ref/status serves — the composition's own service
   * surface). The read serves the latest snapshot of the requested project;
   * absent wiring answers none (the organization card paints from the
   * bundle's own org-status read, the pre-FW-34-A behavior).
   */
  readonly watchSnapshots?: () => readonly OrgStatusSnapshot[];
}

// ---------------------------------------------------------------------------
// The read's shape (the response contract — additive, consumed by apps/web)
// ---------------------------------------------------------------------------

/** One surface's loading truth: the honest count, or `null` when the fold was NOT READABLE (never a lying zero). */
export type HydrationRecordCount = number | null;

/** The per-surface record counts the console's boot bundle will read. */
export interface ProjectHydrationRecords {
  /** GET /v1/jobs?project= — the same fold (the store never fails: a plain count). */
  readonly jobs: number;
  /** GET /v1/execution/submissions — the same fold (the store never fails: a plain count). */
  readonly submissions: number;
  /** POST /v1/outcomes/query — the same port chain; `null` = NOT READABLE. */
  readonly outcomes: HydrationRecordCount;
  /** POST /v1/post-mortems/query — the same port chain; `null` = NOT READABLE. */
  readonly postMortems: HydrationRecordCount;
  /** POST /v1/knowledge/query — the same port chain; `null` = NOT READABLE. */
  readonly knowledge: HydrationRecordCount;
  /** The surfaces whose folds were NOT READABLE (named — the honesty law's own disclosure). */
  readonly unreadable: readonly string[];
}

/** The project's organization state as this backing knows it (the Organization card's paint-from-read-one data). */
export interface ProjectHydrationOrganization {
  /** Whether the project record carries a bound organization ref (the compile state — the host's OWN answer, not the console's not-yet-fetched one). */
  readonly bound: boolean;
  /** The bound organization ref, when bound. */
  readonly organizationRef: string | null;
  /**
   * The LATEST watch snapshot on record for this project, VERBATIM (the
   * same store the org-status read serves; after FW-34-A every instance
   * reports it at the durable compile instant, so it is byte-identical
   * across instances). `null` = none on record at this host (an honestly
   * unobserved org — the console renders its teaching empty state).
   */
  readonly watchSnapshot: OrgStatusSnapshot | null;
}

/** THE PROJECT HYDRATION READ — the host's one-glance loading-vs-empty truth for one scope. */
export interface ProjectHydrationRead {
  readonly projectId: string;
  /** The read's own instant (ISO) — the counts' as-of (a current-instant standing read, the FW-31-A precedent). */
  readonly asOf: string;
  readonly organization: ProjectHydrationOrganization;
  readonly records: ProjectHydrationRecords;
  /** The plain-language source note (the anti-deception law's own surface). */
  readonly disclosure: string;
}

// ---------------------------------------------------------------------------
// The envelope discipline (the risk-utilization.ts precedent — built from the frozen service's own primitives)
// ---------------------------------------------------------------------------

/** One hydration request id (deterministic per method+path+serial — the demo-substance routes' own mint). */
function hydrationRouteRequestId(request: DemoSubstanceRequest, serial: number): RequestId {
  return mintRequestId(fnv1a32Hex(canonicalJson(['project-hydration-route', request.method, request.path, serial] as never)));
}

/** The shared success envelope (the boundary's own { requestId, data } shape + the version header). */
function hydrationRouteSuccess(requestId: RequestId, data: unknown): ApiResponse {
  return deepFreeze({ status: 200, headers: { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION }, body: { requestId, data } });
}

/** The shared error envelope (the boundary's own { requestId, error } shape). */
function hydrationRouteError(requestId: RequestId, error: ApiError): ApiResponse {
  return deepFreeze({ status: error.status, headers: { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION }, body: { requestId, error } });
}

// ---------------------------------------------------------------------------
// The read itself (pure — the tests drive it directly)
// ---------------------------------------------------------------------------

/** The disclosure's backing clause (what this read serves from, per arm — the risk-utilization.ts precedent). */
function hydrationBackingClause(backing: 'demo' | 'durable'): string {
  return backing === 'demo'
    ? "served from the DEMO backing's per-instance records (the same stores the console's own reads drive; a serverless cold start resets the demo world, honest under the SIMULATED badge)"
    : "served from the DURABLE seam's hydrated surfaces and the composition's per-instance stores (the same objects the console's own reads drive; the durable rows persist across cold starts)";
}

/**
 * Build the project hydration read (pure, deterministic, never throws).
 * Every count comes from the caller's folds — the SAME folds the console's
 * own reads drive; an unreadable surface is a named `null`, never a lying
 * zero (the honesty law).
 */
export function buildProjectHydrationRead(input: {
  readonly projectId: string;
  readonly project: ProjectRecord;
  readonly records: ProjectHydrationRecords;
  readonly watchSnapshots: readonly OrgStatusSnapshot[];
  readonly asOf: string;
  readonly backing: 'demo' | 'durable';
}): ProjectHydrationRead {
  const organizationRef = input.project.lifecycle.organizationRef;
  const bound = typeof organizationRef === 'string' && organizationRef.length > 0;
  // The latest watch snapshot of THIS project (the store holds the latest
  // per organizationRef/project pair; a project is bound to at most one org,
  // so the project filter is exact). Ties (same `at`) resolve to the last
  // reported — the store's own replacement order.
  const ofProject = input.watchSnapshots.filter((snapshot) => snapshot.project === input.projectId);
  const watchSnapshot = ofProject.length === 0
    ? null
    : ofProject.reduce((latest, candidate) => (candidate.at >= latest.at ? candidate : latest));
  return deepFreeze({
    projectId: input.projectId,
    asOf: input.asOf,
    organization: deepFreeze({ bound, organizationRef: bound ? organizationRef : null, watchSnapshot }),
    records: input.records,
    disclosure: [
      'THE LOADING-VS-EMPTY TRUTH: every records.* count is the honest count the SAME fold serves the console\u2019s own read of that surface (never a projection, never a cache); a surface whose fold answered its typed failure serves null and is named in `unreadable` \u2014 never a fabricated zero. While the console\u2019s boot bundle is in flight, a section whose read has not landed renders LOADING when the host\u2019s count is > 0 or the surface is unreadable, and its honest empty state when the count is 0.',
      'organization.watchSnapshot is the LATEST snapshot on record at this host, verbatim (the same store GET /v1/organizations/:ref/status serves); a null watchSnapshot with bound true means the org is bound but no observation is on record at this instance yet (the watch store is per-instance; the boot/heal pass re-reports it).',
      `This read is ${hydrationBackingClause(input.backing)}.`,
    ].join(' '),
  });
}

// ---------------------------------------------------------------------------
// The path matcher (the /v1/projects/:projectId/hydration grammar)
// ---------------------------------------------------------------------------

/**
 * Match `/v1/projects/:projectId/hydration` (4 segments — never the
 * 3-segment session detail path, never the 4-segment goal path). Returns
 * the captured project id when the path AND the id are well-formed, else
 * `null` (the caller falls through to the frozen boundary, which answers
 * the typed not-found for malformed ids — the goal route's own law).
 */
export function matchProjectHydrationPath(path: string): string | null {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 4) return null;
  if (segments[0] !== 'v1' || segments[1] !== 'projects' || segments[3] !== HYDRATION_PATH_SEGMENT) return null;
  const projectId = segments[2] as string;
  return isProjectId(projectId) ? projectId : null;
}

// ---------------------------------------------------------------------------
// The route (authn first, the typed errors — the W-8 law)
// ---------------------------------------------------------------------------

/**
 * Serve ONE GET /v1/projects/:projectId/hydration request. The caller (the
 * demo/durable substance dispatchers in runtime/routes.ts) invokes this
 * only for the exact path + GET method; every other shape falls through
 * to the frozen boundary (the typed not-found / method-not-allowed — the
 * pre-FW-34-A behavior, byte-identical).
 */
export function serveProjectHydrationRoute(input: ProjectHydrationRouteInput, request: DemoSubstanceRequest, serial: number, backing: 'demo' | 'durable'): ApiResponse {
  const requestId = hydrationRouteRequestId(request, serial);
  // AUTHN FIRST (the boundary's own 401 law — the W-8 host routes' own shape).
  const authorization = input.verifyDeveloperAuthorization(request.headers.authorization);
  if (authorization === null) {
    return hydrationRouteError(requestId, apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'));
  }
  const projectId = matchProjectHydrationPath(request.path);
  if (projectId === null) {
    // Unreachable at the dispatcher's guarded call sites (it only routes a
    // matched path here) — the honest guard regardless: the boundary's own
    // validation shape, never a crash.
    return hydrationRouteError(requestId, apiError('validation_failed', 'the project path parameter must be a valid project id'));
  }
  // The project's own record — the bind state's source. No record on this
  // backing answers the typed not-found (unknown and cross-tenant stay
  // indistinguishable, the boundary's own law).
  const project = input.projectOf(authorization.tenant, projectId);
  if (project === null || !isProjectRecord(project)) {
    return hydrationRouteError(requestId, apiError('not_found', `no project ${JSON.stringify(projectId)} is readable at this host (the hydration read serves the project's own record set; nothing is on record for this one)`));
  }
  // THE FOLDS — each one the SAME fold the console's own read of that
  // surface drives (the composition wired its own service objects into this
  // input). L12 by construction on every axis: every fold keys on the
  // AUTHORIZED tenant, never a request value. A typed port failure is a
  // NAMED unreadable surface — never a lying zero (the honesty law).
  const outcomes = input.outcomesOf(authorization.tenant, projectId);
  const postMortems = input.postMortemsOf(authorization.tenant, projectId);
  const knowledge = input.knowledgeOf(authorization.tenant, projectId);
  const unreadable: string[] = [];
  if (outcomes === null) unreadable.push('outcomes');
  if (postMortems === null) unreadable.push('postMortems');
  if (knowledge === null) unreadable.push('knowledge');
  const records: ProjectHydrationRecords = deepFreeze({
    jobs: input.jobsOf(authorization.tenant, projectId).length,
    submissions: input.submissionsOf(authorization.tenant, projectId).length,
    outcomes: outcomes === null ? null : outcomes.length,
    postMortems: postMortems === null ? null : postMortems.length,
    knowledge: knowledge === null ? null : knowledge.length,
    unreadable: Object.freeze([...unreadable]),
  });
  const read = buildProjectHydrationRead({
    projectId,
    project,
    records,
    watchSnapshots: input.watchSnapshots === undefined ? [] : input.watchSnapshots(),
    asOf: new Date().toISOString(),
    backing,
  });
  return hydrationRouteSuccess(requestId, read);
}
