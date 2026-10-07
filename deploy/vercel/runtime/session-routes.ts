// deploy/vercel/runtime/session-routes.ts — THE HOST-OWNED SESSION-SCOPE
// ROUTES (FW-MI-A, defects MI-D1 + MI-D8 — the wave-1 trust blockers).
//
// WHAT THIS IS: the session-isolation layer for the SHARED-ORIGIN demo
// deployment. The deployed console is anonymous by design (no auth — the
// one developer credential is baked into the public shell), so every
// browser session on the origin shares ONE tenant — and before this
// module, every session saw EVERY session's launched projects in the
// Settings switcher, the command palette AND the export's
// projectDirectory (the wave-1 evidence: 9/9 professionals hit it;
// Northline's M1 saw "a rival fund's desks" in his switcher; Alder's S5
// REJECTED over "other desks' names inside my audit export"; Meridian's
// L3 switched into a colleague's desk by id and "read its full envelope
// with no barrier — a reportable control failure"). That contradicted the
// product's own Settings copy: "every read and every record stays inside
// it."
//
// THE LAW (MI-D1's required behavior): each browser session sees ONLY
//   (a) its OWN launched projects, and
//   (b) the shared DEMO project —
// in the listing (the switcher/palette/export directory), AND a direct
// cross-session read by project id is the typed not-found (unknown and
// foreign stay indistinguishable — the boundary's own law). The console
// carries a stable session id (generated on first load, held in
// localStorage, sent as the `x-tradrl-console-session` header —
// apps/web/src/core/session.ts); the host stamps every successful
// create-project with the owning session (router.ts's response-side
// stamp: the demo arm's per-instance map, the durable arm's additive
// `ownerSession` field on the goal-set row payload — the W-28 `world`
// precedent, no schema change) and filters every session-scoped surface
// by it. UNOWNED projects (pre-FW-MI-A creates, the boot world's seed,
// direct SDK creates without the header) are visible to NO session — the
// wave-1 cross-session leak closes for old rows too.
//
// THE ROUTES (additive, BEFORE the boundary wrap — the W-8 host-route
// precedent; the frozen route table is untouched, and a request WITHOUT
// the session header never reaches this module: the boundary serves it
// byte-identically, so SDK parity is preserved):
//
//   GET /v1/projects                    the session listing — the demo
//                                       project + the session's own
//                                       projects, one full page (a
//                                       session's view is bounded by
//                                       construction; no cursor is ever
//                                       served on this path — MI-D8's
//                                       "no silent cap" law: the served
//                                       page IS the whole session view)
//   GET /v1/projects/:projectId        the session detail — the demo
//                                       project, the session's own
//                                       project, or the typed not-found
//   GET /v1/projects/:projectId/goal   the session goal read — gated the
//                                       same way; under DURABLE served
//                                       FRESH from the goal-set row (the
//                                       session-listing JOIN), never the
//                                       per-instance projection
//   GET /v1/jobs?project=<id>           the session gate — blocked (the
//   GET /v1/execution/submissions       typed not-found) for a foreign
//                                       project, DELEGATED to the
//                                       existing demo-substance routes
//                                       when the gate passes (null —
//                                       the caller falls through)
//
// THE FRESHNESS LAW (MI-D8's data-loss half): under DURABLE the session
// listing/detail/goal read the DURABLE TABLES through the session-listing
// JOIN (one round trip — deploy/adapters/neon/stores.ts), never the
// instance's boot projection. The wave-1 root cause of "after reload MY
// two desks became UNREACHABLE": a warm serverless instance's projection
// predates projects created on OTHER instances, so the boundary's
// listing served a stale registry. The JOIN is fresh by construction —
// the moment a create's write drained, every instance's session view
// carries it (the W-27 durable jobs lane is untouched; this is the same
// durability discipline brought to the session's OWN project registry).
//
// THE AUTH LAW (the W-8 host-route law, verbatim): the host owns the
// credential registrations, so it authenticates these routes itself — a
// Bearer token that is not the deployment's registered developer
// credential is the typed 401; the served rows are the CREDENTIAL
// TENANT'S own (L12 by construction — the tenant comes from the
// authorization, never a request value). The responses use the
// boundary's own envelope discipline (imported from runtime/routes.ts —
// never duplicated). DOCUMENTED LIMITATION (honest, the W-8 precedent):
// these reads run outside the T041 pipeline's metering/audit tail; every
// consequential route stays behind the frozen boundary. The frozen POST
// query routes (knowledge/outcomes) remain TENANT-scoped, not
// session-scoped — a crafted cross-session query against them still
// answers the tenant's rows (disclosed; the console's own flows only
// query the session's own scope).
//
// NO CORS headers are ever emitted (the same-origin law — pinned by
// deploy/vercel/vercel.test.ts, which scans this file too).
//
// Zero-dep law: platform APIs only. Spec anchors: L12 (tenant isolation
// — this module narrows it to the session for the shared-credential
// console), L20, R46 (the typed degraded state — a failed session read
// is the typed 503, never a stale or partial view), MI-D1, MI-D8.

import {
  apiError,
  deepFreeze,
  isProjectId,
  isProjectRecord,
  type ApiResponse,
  type RequestId,
} from '../../../services/api/src/index';
import type { SessionProjectRow, StoreResult } from '../../adapters/neon/stores';
import type { StoreFailure } from '../../adapters/shared';
import { DEMO_PROJECT_ID, isLaunchWorldRecord } from './demo';
import { demoRouteError, demoRouteRequestId, demoRouteSuccess, type DemoSubstanceAuthorization, type DemoSubstanceRequest, type VerifyDeveloperAuthorization } from './routes';

/** The console session header (the client mirror: apps/web/src/core/session.ts — same name, same shape law). */
export const CONSOLE_SESSION_HEADER = 'x-tradrl-console-session';

/** Guard: a well-formed console session id (the client mints 32-hex; the shape law accepts the url-safe class, 8-64 chars). */
export function isConsoleSessionId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v);
}

/**
 * The request's console session (the header's value), or null when the
 * request carries none or a malformed one (null = the pre-FW-MI-A
 * behavior: the boundary serves the request, byte-identical — SDK parity).
 * The headers value is probed STRUCTURALLY (the boundary's own
 * ApiRequestHeaders and the host's test harnesses carry different
 * declared shapes; the lookup keys on the header's name alone).
 */
export function consoleSessionOf(headers: unknown): string | null {
  if (headers === null || typeof headers !== 'object') return null;
  const presented = (headers as { readonly [CONSOLE_SESSION_HEADER]?: unknown })[CONSOLE_SESSION_HEADER];
  return isConsoleSessionId(presented) ? presented : null;
}

/** The demo composition's session-ownership surface (compose.ts builds it; the router records into it at create time). */
export interface DemoSessionWorld {
  /** The owning session of one project id (undefined = unowned). */
  readonly sessionOwners: ReadonlyMap<string, string>;
  /** The tenant's project records as the demo composition's own control plane serves them (per-instance, honestly under SIMULATED). */
  readonly recordsOf: (tenant: string) => readonly unknown[];
}

/** The durable composition's session-rows surface (the seam handle's fresh JOIN read). */
export interface DurableSessionWorld {
  readonly sessionProjectRows: () => Promise<StoreResult<readonly SessionProjectRow[]>>;
}

/** The structural surface the dispatcher consumes from the composition (a subset of DeploymentComposition — the injection seam stays pure). */
export interface SessionScopeDeployment {
  /** The host auth seam (the composition's registered developer credential). */
  readonly verifyDeveloperAuthorization: VerifyDeveloperAuthorization;
  /** The demo composition's session world (non-null exactly when the composition owns the demo world). */
  readonly demo: DemoSessionWorld | null;
  /** The durable composition's session world (non-null when the seam built; the fresh rows read is live whenever the seam is). */
  readonly durable: DurableSessionWorld | null;
}

/** One resolved session scope (the per-request ownership data the routes consume). */
export type ConsoleSessionScope =
  | {
    readonly kind: 'demo';
    readonly session: string;
    /** The demo composition's per-instance ownership map (a cold start resets it — with the whole demo world, honestly under SIMULATED). */
    readonly owners: ReadonlyMap<string, string>;
    /** The tenant's project records, as the demo control plane serves them (the composition's own in-memory store). */
    readonly records: readonly unknown[];
  }
  | {
    readonly kind: 'durable';
    readonly session: string;
    /** The FRESH session-listing rows (the durable tables — never the instance's projection; the MI-D8 freshness law). */
    readonly rows: readonly SessionProjectRow[];
  }
  | {
    readonly kind: 'degraded';
    readonly session: string;
    /** The typed failure of the session read (the routes answer the R46 503 — fail closed, never a stale view). */
    readonly error: StoreFailure;
  };

/**
 * THE VISIBILITY LAW (MI-D1): one project is visible to one session iff
 * it is the shared DEMO project (clause (b)) or this session owns it
 * (clause (a)). Unowned projects (a null owner) are visible to NO
 * session.
 */
export function sessionSeesProject(projectId: string, session: string, ownerOf: (projectId: string) => string | null): boolean {
  return projectId === DEMO_PROJECT_ID || ownerOf(projectId) === session;
}

/** The owning session of one project under one resolved scope (null = unowned/unknown). */
function ownerOfScope(scope: ConsoleSessionScope, projectId: string): string | null {
  if (scope.kind === 'demo') {
    const owner = scope.owners.get(projectId);
    return typeof owner === 'string' && owner.length > 0 ? owner : null;
  }
  if (scope.kind === 'durable') {
    const row = scope.rows.find((candidate) => projectOfRow(candidate) === projectId);
    return row === undefined ? null : row.ownerSession;
  }
  return null;
}

/** The project id of one session row (empty when the payload carries none — malformed rows never match a gated id). */
function projectOfRow(row: SessionProjectRow): string {
  const record = row.project;
  if (typeof record !== 'object' || record === null) return '';
  const id = (record as { readonly id?: unknown }).id;
  return typeof id === 'string' ? id : '';
}

/** One 401 (the boundary's own unauthenticated law — the host routes' shared shape). */
function unauthenticated(requestId: RequestId): ApiResponse {
  return demoRouteError(requestId, apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'));
}

/** One 404 (the boundary's indistinguishability law: unknown, foreign-tenant and foreign-session look identical). */
function sessionNotFound(requestId: RequestId, projectId: string): ApiResponse {
  return demoRouteError(requestId, apiError('not_found', `no project ${JSON.stringify(projectId)} is readable by this console session at this boundary`));
}

/** One 503 (the R46 law: a failed session read degrades — never a stale or partial view). */
function sessionDegraded(requestId: RequestId, error: StoreFailure): ApiResponse {
  return demoRouteError(requestId, apiError('unavailable', `the session read failed (${error.code}): ${error.message} — the session-scoped route answers the typed degraded state (R46)`));
}

/** The `/v1/projects/:projectId` path match (3 segments — never the 4-segment goal path). */
function matchSessionProjectPath(path: string): string | null {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 3) return null;
  if (segments[0] !== 'v1' || segments[1] !== 'projects') return null;
  const projectId = segments[2] as string;
  return isProjectId(projectId) ? projectId : null;
}

/** The `/v1/projects/:projectId/goal` path match (4 segments — the goal bundle path). */
function matchSessionProjectGoalPath(path: string): string | null {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 4) return null;
  if (segments[0] !== 'v1' || segments[1] !== 'projects' || segments[3] !== 'goal') return null;
  const projectId = segments[2] as string;
  return isProjectId(projectId) ? projectId : null;
}

// ---------------------------------------------------------------------------
// THE DISPATCHER
// ---------------------------------------------------------------------------

/**
 * Serve one request off the host-owned session-scope routes (FW-MI-A).
 * Returns the response when the request is a session-scoped path AND the
 * request carries a well-formed console session header; null when it is
 * not (the caller falls through to the demo-substance routes + the frozen
 * boundary — the pre-fix behavior, byte-identical, so a session header on
 * any OTHER route changes nothing and a headerless caller keeps full SDK
 * parity). The jobs list + the execution blotter return null when the
 * session gate PASSES (the existing demo-substance routes serve them
 * unchanged) and the typed not-found when it BLOCKS.
 */
export async function serveSessionScopedRoute(deployment: SessionScopeDeployment, request: DemoSubstanceRequest, serial: number): Promise<ApiResponse | null> {
  if (request.method !== 'GET') return null;
  const session = consoleSessionOf(request.headers);
  if (session === null) return null;
  // The cheap sync path check BEFORE any data read (a session header on an
  // unrelated route never costs a query).
  const isListing = request.path === '/v1/projects';
  const goalProject = matchSessionProjectGoalPath(request.path);
  const project = matchSessionProjectPath(request.path);
  const isGatedRead = request.path === '/v1/jobs' || request.path === '/v1/execution/submissions';
  if (!isListing && goalProject === null && project === null && !isGatedRead) return null;
  const requestId = demoRouteRequestId(request, serial);
  // The host-route auth law (W-8): the credential tenant, never a request value.
  const authorization = deployment.verifyDeveloperAuthorization(request.headers.authorization);
  if (authorization === null) return unauthenticated(requestId);
  // Resolve the scope — one read (the demo map + records, or the durable JOIN).
  let scope: ConsoleSessionScope | null;
  if (deployment.demo !== null) {
    scope = { kind: 'demo', session, owners: deployment.demo.sessionOwners, records: deployment.demo.recordsOf(authorization.tenant) };
  } else if (deployment.durable !== null) {
    const rows = await deployment.durable.sessionProjectRows();
    scope = rows.ok ? { kind: 'durable', session, rows: rows.value } : { kind: 'degraded', session, error: rows.error };
  } else {
    scope = null; // port overrides own the world — no session scoping (the pre-W-8 law)
  }
  if (scope === null) return null;

  // GET /v1/projects — the session listing: the demo project + the
  // session's own projects, ONE FULL PAGE (no cursor is ever served here —
  // MI-D8's "no silent cap": the served page IS the whole session view).
  if (isListing) {
    if (scope.kind === 'degraded') return sessionDegraded(requestId, scope.error);
    const ownerOf = (candidate: string): string | null => ownerOfScope(scope, candidate);
    const source: readonly unknown[] = scope.kind === 'demo' ? scope.records : scope.rows.map((row) => row.project);
    const items: unknown[] = [];
    for (const record of source) {
      if (!isProjectRecord(record)) continue; // malformed rows are skipped fail-closed (the projection's own law)
      if (!sessionSeesProject(record.id, session, ownerOf)) continue;
      items.push(record);
    }
    return demoRouteSuccess(requestId, deepFreeze({ items: Object.freeze(items) }));
  }

  // GET /v1/projects/:projectId/goal — the session goal read.
  if (goalProject !== null) {
    if (scope.kind === 'degraded') return sessionDegraded(requestId, scope.error);
    const ownerOf = (candidate: string): string | null => ownerOfScope(scope, candidate);
    if (!sessionSeesProject(goalProject, session, ownerOf)) return sessionNotFound(requestId, goalProject);
    if (scope.kind === 'demo') {
      // The demo arm's goal data is per-instance (the port capture) — the
      // gate passed, so fall through to the existing demo goal route (it
      // re-auths and serves, unchanged).
      return null;
    }
    // DURABLE: serve FRESH from the JOIN row — never the instance's
    // projection (a session's own goal cards survive a reload onto a stale
    // warm instance). The ownerSession field NEVER crosses the wire (only
    // goal + constraintSet + the structurally-validated world).
    const row = scope.rows.find((candidate) => projectOfRow(candidate) === goalProject);
    if (row === undefined || row.goalSet === null) {
      return demoRouteError(requestId, apiError('not_found', `no goal statement exists for ${JSON.stringify(goalProject)} in the durable projection of this tenant (the goal read serves the create-project input's persisted goal set)`));
    }
    const goalSet = row.goalSet;
    return demoRouteSuccess(requestId, deepFreeze({
      goal: goalSet.goal,
      constraintSet: goalSet.constraintSet,
      ...(isLaunchWorldRecord(goalSet.world) ? { world: goalSet.world } : {}),
    }));
  }

  // GET /v1/projects/:projectId — the session detail.
  if (project !== null) {
    if (scope.kind === 'degraded') return sessionDegraded(requestId, scope.error);
    const ownerOf = (candidate: string): string | null => ownerOfScope(scope, candidate);
    if (!sessionSeesProject(project, session, ownerOf)) return sessionNotFound(requestId, project);
    if (scope.kind === 'demo') {
      const record = scope.records.find((candidate) => isProjectRecord(candidate) && candidate.id === project);
      if (record === undefined) return sessionNotFound(requestId, project);
      return demoRouteSuccess(requestId, record);
    }
    const row = scope.rows.find((candidate) => projectOfRow(candidate) === project);
    if (row === undefined || !isProjectRecord(row.project)) return sessionNotFound(requestId, project);
    return demoRouteSuccess(requestId, row.project);
  }

  // THE SESSION GATE on the host-owned project-scoped reads (the jobs list
  // + the execution blotter): a foreign project answers the typed
  // not-found (L3's "switched into a colleague's desk and read its full
  // envelope" — closed); the demo project and the session's own projects
  // fall through to the existing routes, which serve them unchanged.
  const projectQuery = request.query?.project;
  if (projectQuery === undefined || !isProjectId(projectQuery)) return null; // the existing routes' own validation answers
  if (scope.kind === 'degraded') return sessionDegraded(requestId, scope.error);
  const ownerOf = (candidate: string): string | null => ownerOfScope(scope, candidate);
  if (!sessionSeesProject(projectQuery, session, ownerOf)) {
    return sessionNotFound(requestId, projectQuery);
  }
  return null; // the gate passed — the existing demo-substance routes serve the read
}
