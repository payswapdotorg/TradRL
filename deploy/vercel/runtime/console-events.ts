// deploy/vercel/runtime/console-events.ts — THE DURABLE CONSOLE-EVENTS SEAM
// (FW-36-A, Round E register §3.1 — the export seam's last mile, the
// auditor's question: "which artifact is the record?").
//
// THE HOLE THIS CLOSES (ROUND-E-REPORT §3.1 — 7/9 personas touched it): the
// export's `events` block IS the console's in-memory session history
// (apps/web's state.history — linked per dispatch, opened [] at every
// browser session), while the export's record blocks re-read from the host.
// A page load or a browser restart therefore legitimately REBUILT the
// records but RESET the chain: 910→186→36 events across one session's page
// loads (L3); 623→123 with ZERO digest overlap across a restart while the
// record blocks survived byte-identical (M3); 328→105 (S5); 912→161 (L4);
// 941→86 (M1); 431→101 (M5); 571→112 (S1) — the events arm was page-lifetime
// telemetry masquerading as the project's history, and the manifest's
// chainScopeNote disclosed the cross-project span but never the reset.
//
// WHAT THIS IS: the RUNTIME HALF of the durable answer — TWO additive
// host-owned routes, served BEFORE the boundary wrap with
// developer-credential authn (the W-8 law; the paths are declared NOWHERE
// in the frozen T041 route table, so without this module they answer the
// typed not_found, and under the DEMO backing they still do — the events
// seam is the DURABLE arm's own surface, like the runbook):
//
//   POST /v1/projects/:projectId/events
//     THE APPEND: one batch of the console's workspace events — the EXACT
//     payloads its reducer linked (opaque to the seam beyond the structural
//     `kind`/`at` the route validates). The writes queue onto the seam's
//     pending drain and CONFIRM before the response serves (the ordering
//     law — a failed write is the typed 503; the caller's idempotent retry
//     re-inserts nothing: rows key on the payload's own content-addressed
//     id). L12 by construction: the rows key on the AUTHORIZED tenant.
//
//   GET /v1/projects/:projectId/events
//     THE READ: the project's WHOLE append-only, CROSS-SESSION event log
//     from the FRESH durable tables (never a per-instance projection — the
//     MI-D8 session-listing law), in the events' own instant order. A
//     fresh browser session reads this log, re-links its chain over these
//     payloads, and its export then carries the FULL project event history
//     — the events arm and the record blocks finally agree on durability.
//     The auditor's answer: THIS LOG is the record; the export's chain is
//     a projection of it, recomputed under the file's own published rules.
//
// THE CONSUMPTION SHAPE (coordinated with apps/web — additive, the
// FW-34-A hydration-read precedent): the console posts its linked events
// under the scope it holds (batched, idempotent) and, on boot, reads this
// log FIRST so a fresh session's history starts from the durable truth
// instead of []. The console-side wiring is the apps/web half of the wave.
//
// NO CORS headers are ever emitted (the same-origin law — pinned by
// deploy/vercel/vercel.test.ts, which scans the runtime tree).
//
// THE NO-CYCLE LAW (the risk-utilization.ts precedent): this module is
// imported BY deploy/vercel/api/router.ts, so it imports ONLY types from
// './routes' + './durable' (type-only imports are erased — no runtime
// cycle) and builds its own envelope helpers from the frozen service's own
// primitives.
//
// Zero-dep law: platform APIs only. Spec anchors: R43 (additive), R45
// (provenance), R46 (every failure path typed; never a crash), L12, L20,
// UX-DESIGN §7 (the anti-deception law), ROUND-E-REPORT §3.1 + §6 (FW-36-A).

import {
  apiError,
  canonicalJson,
  CURRENT_API_VERSION,
  deepFreeze,
  fnv1a32Hex,
  isProjectId,
  isRecord,
  mintRequestId,
  type ApiError,
  type ApiRequest,
  type ApiResponse,
  type RequestId,
} from '../../../services/api/src/index';
import { consoleEventIdOf, type ConsoleEventAppend } from '../../adapters/neon/stores';
import type { DurableBackingHandle } from './durable';
import type { VerifyDeveloperAuthorization } from './routes';

/** The console-events routes' path segment (the `/v1/projects/:projectId/events` grammar — additive, declared nowhere in the frozen route table). */
const CONSOLE_EVENTS_PATH_SEGMENT = 'events';

/** One append batch's maximum size (the safety law — the console's batches are small; a hostile batch is the typed validation failure, never an unbounded write). */
const MAX_APPEND_BATCH = 512;

/**
 * The minimal request surface the console-events routes consume (the wrapped
 * ApiRequest carries exactly these — the PARSED BODY included: the append's
 * own input, never a re-parse at the route).
 */
export type ConsoleEventsRequest = Pick<ApiRequest, 'method' | 'path' | 'headers' | 'body'>;

// ---------------------------------------------------------------------------
// The route's structural input
// ---------------------------------------------------------------------------

/** The console-events routes' structural input (the router wires the composition's own surfaces). */
export interface ConsoleEventsRouteInput {
  /** The host auth seam (the composition's registered developer credential — the W-8 law). */
  readonly verifyDeveloperAuthorization: VerifyDeveloperAuthorization;
  /** The durable seam (the append lane + the fresh read — the handle's own typed surfaces). */
  readonly durable: DurableBackingHandle;
}

// ---------------------------------------------------------------------------
// The envelope discipline (the risk-utilization/hydration precedent — built
// from the frozen service's own primitives, no runtime dependency on './routes')
// ---------------------------------------------------------------------------

/** One console-events request id (deterministic per method+path+serial — the demo-substance routes' own mint). */
function consoleEventsRouteRequestId(request: ConsoleEventsRequest, serial: number): RequestId {
  return mintRequestId(fnv1a32Hex(canonicalJson(['console-events-route', request.method, request.path, serial] as never)));
}

/** The shared success envelope (the boundary's own { requestId, data } shape + the version header). */
function consoleEventsRouteSuccess(requestId: RequestId, data: unknown): ApiResponse {
  return deepFreeze({ status: 200, headers: { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION }, body: { requestId, data } });
}

/** The shared error envelope (the boundary's own { requestId, error } shape). */
function consoleEventsRouteError(requestId: RequestId, error: ApiError): ApiResponse {
  return deepFreeze({ status: error.status, headers: { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION }, body: { requestId, error } });
}

// ---------------------------------------------------------------------------
// The path matcher (the /v1/projects/:projectId/events grammar)
// ---------------------------------------------------------------------------

/**
 * Match `/v1/projects/:projectId/events` (4 segments — never the 3-segment
 * session detail path, never the goal/hydration 4-segment siblings). Returns
 * the captured project id when the path AND the id are well-formed, else
 * `null` (the caller falls through to the frozen boundary, which answers the
 * typed not-found for malformed ids — the goal route's own law).
 */
export function matchConsoleEventsPath(path: string): string | null {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 4) return null;
  if (segments[0] !== 'v1' || segments[1] !== 'projects' || segments[3] !== CONSOLE_EVENTS_PATH_SEGMENT) return null;
  const projectId = segments[2] as string;
  return isProjectId(projectId) ? projectId : null;
}

// ---------------------------------------------------------------------------
// The batch validation (structural — the payload stays opaque beyond kind/at)
// ---------------------------------------------------------------------------

/** The append route's verdict: the validated, id-minted entries — or the typed validation failure. */
type AppendBatch =
  | { readonly ok: true; readonly entries: readonly ConsoleEventAppend[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate one append batch (FW-36-A): each event must be an object carrying
 * a non-empty string `kind` and a safe positive integer `at` (the event's
 * OWN instant — the console's injected-instant law); everything else in the
 * payload is OPAQUE to the seam (the console's own event union — the seam
 * never re-types it, never mutates it, never rejects a legal vocabulary
 * entry). Each validated payload mints its content-addressed event id (the
 * idempotence key — consoleEventIdOf, the one mint the read re-derives).
 */
function validateAppendBatch(body: unknown): AppendBatch {
  if (!isRecord(body) || !Array.isArray(body.events)) {
    return { ok: false, reason: 'the body must carry { events: [...] } — the append is a batch of the console\'s workspace events' };
  }
  const events = body.events as readonly unknown[];
  if (events.length === 0 || events.length > MAX_APPEND_BATCH) {
    return { ok: false, reason: `the batch must carry 1..${MAX_APPEND_BATCH} events (got ${events.length})` };
  }
  const entries: ConsoleEventAppend[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isRecord(event)) return { ok: false, reason: `events[${index}] is not an object` };
    const kind = event.kind;
    if (typeof kind !== 'string' || kind.length === 0) return { ok: false, reason: `events[${index}] lacks its kind (a non-empty string)` };
    const at = event.at;
    if (typeof at !== 'number' || !Number.isSafeInteger(at) || at <= 0) return { ok: false, reason: `events[${index}] lacks its own instant (a safe positive integer \`at\` — the event's injected instant)` };
    entries.push({ eventId: consoleEventIdOf(event), at, event });
  }
  return { ok: true, entries };
}

/** The project id of one session-JOIN row ('' when the payload carries none — malformed rows never gate an append open). */
function projectOfSessionRow(row: { readonly project: unknown }): string {
  if (!isRecord(row.project)) return '';
  const id = row.project.id;
  return typeof id === 'string' ? id : '';
}

// ---------------------------------------------------------------------------
// The routes (authn first, the typed errors — the W-8 law)
// ---------------------------------------------------------------------------

/** The append route's disclosure (the anti-deception law's own surface). */
const APPEND_DISCLOSURE = 'THE DURABLE EVENTS SEAM (FW-36-A): the events arm of the export, persisted like the records. This batch\u2019s event payload(s) are appended to the project\u2019s durable, append-only, cross-session event log \u2014 each keyed by its own content-addressed id (a retried batch re-inserts nothing), each carrying its own event instant, none ever rewritten (a change arrives as a NEW event, exactly like the console\u2019s own append-only chain). The writes CONFIRMED before this response served (the ordering law); a failed confirm is the typed 503 and the caller\u2019s idempotent retry heals.';

/** The read route's disclosure — the auditor's answer in plain language. */
const READ_DISCLOSURE = 'THE DURABLE EVENTS SEAM (FW-36-A): the project\u2019s WHOLE append-only, cross-session event log \u2014 every event every browser session posted under this project, in the events\u2019 own instant order (the true event sequence; ties break by the content-addressed id, deterministic). A fresh session reads this log and re-links its chain over these payloads, so its export carries the FULL project event history, not just the current page\u2019s \u2014 the events arm and the record blocks agree on durability. THE AUDITOR\u2019S ANSWER: this log is the record; an export\u2019s events chain is a projection of it, recomputed under the file\u2019s own published rules.';

/**
 * Serve ONE /v1/projects/:projectId/events request (POST = the append, GET =
 * the read). Returns `null` when the request is NOT the console-events route
 * (the caller falls through to the frozen boundary — the pre-FW-36-A
 * behavior, byte-identical). Authn FIRST (the typed 401 — the W-8 law); the
 * append's writes confirm on the CALLER's drain (the router's
 * drainedFailureResponse law — the promote-route pattern); the read serves
 * the FRESH durable tables (never a projection), the typed 503 when the
 * store degrades (R46 — never a silent empty).
 */
export async function serveConsoleEventsRoute(input: ConsoleEventsRouteInput, request: ConsoleEventsRequest, serial: number): Promise<ApiResponse | null> {
  const projectId = matchConsoleEventsPath(request.path);
  if (projectId === null) return null;
  const requestId = consoleEventsRouteRequestId(request, serial);
  // AUTHN FIRST (the boundary's own 401 law — the W-8 host routes' own shape).
  const authorization = input.verifyDeveloperAuthorization(request.headers.authorization);
  if (authorization === null) {
    return consoleEventsRouteError(requestId, apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'));
  }
  // THE APPEND (POST): validate the batch, gate on the project's durable
  // membership, queue the writes onto the seam's drain (the caller drains —
  // the promote-route pattern).
  if (request.method === 'POST') {
    const batch = validateAppendBatch(request.body);
    if (!batch.ok) {
      return consoleEventsRouteError(requestId, apiError('validation_failed', `the console-events batch is not well-formed: ${batch.reason}`));
    }
    // THE PROJECT GATE (the durable truth, never a projection): the fresh
    // session-JOIN read — a project that does not exist (or belongs to no
    // goal set on record) answers the typed not-found (unknown and
    // cross-tenant stay indistinguishable, the boundary's own law); a
    // degraded read is the typed 503 (R46).
    const rows = await input.durable.sessionProjectRows();
    if (!rows.ok) {
      return consoleEventsRouteError(requestId, apiError('unavailable', `the durable session listing failed (${rows.error.code}): ${rows.error.message} — the console-events append cannot confirm the project\u2019s membership; the boundary degrades this request (R46)`));
    }
    const member = rows.value.some((row) => projectOfSessionRow(row) === projectId);
    if (!member) {
      return consoleEventsRouteError(requestId, apiError('not_found', `no project ${JSON.stringify(projectId)} is on record at this seam (the console-events log is project-scoped; unknown and cross-tenant are indistinguishable)`));
    }
    // L12 by construction: the rows key on the seam's credential tenant —
    // the AUTHORIZED tenant (a foreign tenant's rows never exist in this
    // composition's store to begin with).
    input.durable.appendConsoleEvents(projectId, batch.entries);
    return consoleEventsRouteSuccess(requestId, deepFreeze({
      projectId,
      accepted: batch.entries.length,
      disclosure: APPEND_DISCLOSURE,
    }));
  }
  // THE READ (GET): the project's WHOLE durable event log, the fresh tables
  // (never a projection — the MI-D8 session-listing law), the events' own
  // instant order. An unknown project serves the HONEST EMPTY (no events on
  // record — the read-route family's own law, like the jobs list); a
  // degraded read is the typed 503 (never a silent empty).
  if (request.method === 'GET') {
    const read = await input.durable.consoleEventsOf(projectId);
    if (!read.ok) {
      return consoleEventsRouteError(requestId, apiError('unavailable', `the durable console-events read failed (${read.error.code}): ${read.error.message} — the boundary degrades this request (R46)`));
    }
    return consoleEventsRouteSuccess(requestId, deepFreeze({
      projectId,
      items: deepFreeze(read.value.map((entry) => ({ eventId: entry.eventId, at: entry.at, event: entry.event }))),
      disclosure: READ_DISCLOSURE,
    }));
  }
  // The path with a foreign method: null = the fall-through (the boundary
  // answers the typed method-not-found for the path — the pre-law).
  return null;
}
