// deploy/vercel/runtime/notes.ts — THE RESEARCH-NOTE INGESTION (FW-45, the
// E-6 research-world MVP — M3's decisive item, Round L register E-6:
// "desk-ledger arithmetic, not research compute over my data"; the seven-
// round lone NO, would_pilot TRUE throughout).
//
// THE HOLE THIS CLOSES (ROUND-L-REPORT §4 E-6, M3's six seams re-proved
// verbatim): the research world was CLOSED — (a) the wizard's Data-sources
// hint taught only "Comma-separated data source refs." at the exact point
// where 'external' is declared, accepted silently with no boundary
// teaching; (b) the Research submit surface accepted only Objective +
// Notes free text with no ingestion surface in any form; (e) the marker
// job's submitted text occurred ZERO times in the export — the job record
// carries only jobId/kind/project/result/status/tenant, so the analyst's
// notes never reached the chain; (f) dataSources [research, external]
// stored, consumed by nothing.
//
// WHAT THIS IS: the HOST-OWNED consequential route
//
//   POST /v1/projects/:projectId/notes
//
// — the W-8/FW-31-A/FW-32-A host-route law (served BEFORE the boundary
// wrap with developer-credential authn; the path is declared NOWHERE in
// the frozen T041 route table). An attached note is a TITLED TEXT record
// of the analyst's OWN input (a paste target — the MVP deliberately
// builds NO file upload, NO connector, NO live feed), stored VERBATIM on
// the project's goal-set row — the SAME opaque payload column the launch
// world (W-28 D-8) and the ownership stamps (FW-MI-A/FW-39-1) ride, the
// storage precedent the work order names. One storage, three consumers:
// the host goal route serves the notes back (the console's boot re-read —
// the `world` additive-field precedent), the research deliverable's
// provenance block names them (runtime/deliverable.ts), and the console
// derives one note-attached export event per row (apps/web export-record)
// — THE NOTES REACH THE CHAIN (seam e answered).
//
// THE CONTRACT (typed per the established laws — authn first):
//   401 unauthenticated  — a Bearer token that is not the deployment's
//                         registered developer credential (the W-8 law).
//   400 validation_failed — the body is not a note: not an object, a
//                         missing/empty/oversized title (1..120 chars) or
//                         text (1..16,000 chars), or a non-string field.
//                         The broken paths are named in the problems —
//                         NEVER a half-applied note (the draft-store law:
//                         untrusted input is structurally parsed and
//                         refused whole). 400 is the boundary's own
//                         untrusted-payload status (the SAME typed code
//                         every frozen route answers — never a novel one).
//   404 not_found        — no goal set on record for the project (unknown
//                         and cross-tenant stay indistinguishable, the
//                         boundary's own law). The note rides a record
//                         that must exist — fail-closed, never a note on
//                         nothing.
//   503 unavailable      — the storage read/write failed (the drain's
//                         own typed failure surfaces — the mutation is
//                         unconfirmed, the caller learns); a DEGRADED
//                         revocation read on the actor stamp fails closed
//                         too (the FW-39-3 law).
//   200 { note }         — the minted record (or, on a re-attach of a
//                         note the project already carries — the same
//                         title + text, the client's own idempotency-key
//                         unit — the SAME stored record: the FIRST mint
//                         stands, never a duplicate row).
//
// THE MINT (pure, deterministic): noteId is CONTENT-ADDRESSED over the
// note's own envelope (tenant + project + attachedAt + title + text) —
// the house id grammar (`note:` + 8 hex). The attachedAt is the ROUTE'S
// OWN observation (L4 — never a request value, never backdated). The
// optional ACTOR stamp (the promoting request's VALID principal token —
// the FW-39-3 promote law) rides as the additive actorPrincipal/actorAt
// fields; an anonymous attach carries the honest absence; the FIRST
// stored record stands on an idempotent replay (the storage surfaces
// dedupe per content — the same law the client's idempotency key
// derives).
//
// DISCLOSED LIMITATIONS (honest — UX-DESIGN §7 anti-deception):
//   - The note is STORED VERBATIM and REFERENCED — nothing computes over
//     it (no parsing into parameters, no research-compute over the
//     analyst's data — M3's actual ask, disclosed as the NEXT step, never
//     claimed here).
//   - NO file upload, NO connector, NO live feed: the ingestion surface
//     is a paste target; 'external' data sources remain accepted, stored
//     as declarations, and HONESTLY NOT FETCHED (no live external data
//     exists in this deployment — the seam (a) hint teaches exactly
//     this).
//   - Under the DEMO backing the storage is PER-INSTANCE (the demo arm's
//     own law — a serverless cold start resets it; honest under the
//     SIMULATED badge, the promote registry's own disclosed limitation).
//     Under the DURABLE backing the note merges into the goal-set row
//     and write-throughs on the SAME pending drain every stamp rides —
//     DURABLE RECORD, served by every instance's projection.
//   - The row's own concurrency law is the goal-set row's (read-then-
//     merge-then-write of the whole opaque payload); the attach follows
//     the stamps' own ordering law.
//   - Host-owned routes run outside the T041 pipeline's metering/audit
//     tail — the one W-8 limitation every host route carries.
//
// NO CORS headers are ever emitted (the same-origin law — pinned by
// deploy/vercel/vercel.test.ts, which scans this file too).
//
// THE NO-CYCLE LAW (the risk-utilization/promotion precedent): this
// module is imported BY deploy/vercel/api/router.ts + runtime/compose.ts,
// so it imports ONLY frozen-service primitives + types and builds its own
// envelope helpers — never a runtime dependency on './routes'.
//
// Zero-dep law: platform APIs only. Spec anchors: R43 (additive), R45
// (provenance), R46 (every failure path typed; never a crash), L4 (the
// attachedAt is the route's own instant), L12 (every fold keys on the
// AUTHORIZED tenant), ROUND-L-REPORT §4 E-6 + ROUND-K-REPORT §4 E-6.

import {
  apiError,
  canonicalJson,
  CURRENT_API_VERSION,
  deepFreeze,
  fnv1a32Hex,
  isRecord,
  mintRequestId,
  problem,
  type ApiError,
  type ApiRequest,
  type ApiResponse,
  type RequestId,
} from '../../../services/api/src/index';
import type { StoreFailure } from '../../adapters/shared';
import type { PrincipalResolution } from './auth-routes'; // TYPE-ONLY (the no-cycle law: erased at runtime)

// ---------------------------------------------------------------------------
// The record + the untrusted-input gate
// ---------------------------------------------------------------------------

/**
 * One ATTACHED RESEARCH NOTE — the analyst's own titled text, stored
 * VERBATIM (the E-6 MVP's record class). Every field is the mint's own
 * or the input's own, verbatim; nothing here is computed over the text
 * (the disclosed next step, never a claimed capability).
 */
export interface ResearchNoteRecord {
  /** The content-addressed identity (`note:` + 8 hex — the house id grammar). */
  readonly noteId: string;
  /** The AUTHORIZED tenant (L12 — never a request value). */
  readonly tenant: string;
  /** The project whose goal-set row carries the note. */
  readonly project: string;
  /** The route's OWN observation instant (L4 — never a request value). */
  readonly attachedAt: number;
  /** The note's title, verbatim (1..120 characters). */
  readonly title: string;
  /** The note's text, verbatim (1..16,000 characters — a paste target, not a file). */
  readonly text: string;
  /**
   * The attaching ACTOR (the FW-39-3 audit-stamp law): the principal id
   * whose VALID token rode the attach request. ADDITIVE; absent on an
   * ANONYMOUS attach — the honest absence, never fabricated. The FIRST
   * stored record stands on an idempotent replay (never re-attributed).
   */
  readonly actorPrincipal?: string;
  /** The actor stamp's OWN observed instant (the mint's own attachedAt — L4). Absent exactly when `actorPrincipal` is. */
  readonly actorAt?: number;
}

/** The title's honest bound (a title, not a paragraph — the input gate teaches it). */
export const RESEARCH_NOTE_TITLE_MAX = 120;

/** The text's honest bound (a page of pasted notes — big enough for a real export's notes, bounded enough for one opaque row). */
export const RESEARCH_NOTE_TEXT_MAX = 16_000;

/** The note-attach body's validated shape. */
export interface ResearchNoteInput {
  readonly title: string;
  readonly text: string;
}

/**
 * THE UNTRUSTED-INPUT GATE (the draft-store law): parse the request body
 * STRUCTURALLY, fail-closed, and refuse WHOLE — never a half-applied
 * note. The bounds are policy, taught in the problems themselves.
 */
export function parseResearchNoteBody(body: unknown): { readonly ok: true; readonly input: ResearchNoteInput } | { readonly ok: false; readonly problems: readonly ReturnType<typeof problem>[] } {
  if (!isRecord(body)) {
    return { ok: false, problems: Object.freeze([problem('body', 'the request body must be a JSON object carrying title and text')]) };
  }
  const problems: ReturnType<typeof problem>[] = [];
  let title: string | null = null;
  let text: string | null = null;
  const titleValue = (body as { readonly title?: unknown }).title;
  if (typeof titleValue !== 'string' || titleValue.trim().length === 0 || titleValue.trim().length > RESEARCH_NOTE_TITLE_MAX) {
    problems.push(problem('title', `the note title must be a string of 1..${RESEARCH_NOTE_TITLE_MAX} characters (surrounding whitespace is not counted)`));
  } else {
    title = titleValue.trim();
  }
  const textValue = (body as { readonly text?: unknown }).text;
  if (typeof textValue !== 'string' || textValue.length === 0 || textValue.length > RESEARCH_NOTE_TEXT_MAX) {
    problems.push(problem('text', `the note text must be a non-empty string of at most ${RESEARCH_NOTE_TEXT_MAX} characters (paste the note — it is stored verbatim and fetches nothing)`));
  } else {
    text = textValue;
  }
  if (title === null || text === null) return { ok: false, problems: Object.freeze(problems) };
  return { ok: true, input: { title, text } };
}

/**
 * Structural parse of ONE SERVED note record (the way-out half of the
 * untrusted-input law: a stored row that no longer parses serves as
 * ABSENT — skipped honestly, never a crash, never a half-record — R46).
 */
export function parseResearchNoteRecord(value: unknown): ResearchNoteRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.noteId !== 'string' || value.noteId.length === 0) return null;
  if (typeof value.tenant !== 'string' || value.tenant.length === 0) return null;
  if (typeof value.project !== 'string' || value.project.length === 0) return null;
  if (typeof value.attachedAt !== 'number' || !Number.isFinite(value.attachedAt)) return null;
  if (typeof value.title !== 'string' || value.title.length === 0) return null;
  if (typeof value.text !== 'string' || value.text.length === 0) return null;
  const actorPrincipal = (value as { readonly actorPrincipal?: unknown }).actorPrincipal;
  const actorAt = (value as { readonly actorAt?: unknown }).actorAt;
  return {
    noteId: value.noteId,
    tenant: value.tenant,
    project: value.project,
    attachedAt: value.attachedAt,
    title: value.title,
    text: value.text,
    ...(typeof actorPrincipal === 'string' && actorPrincipal.length > 0 && typeof actorAt === 'number' && Number.isFinite(actorAt) ? { actorPrincipal, actorAt } : {}),
  };
}

/** The well-formed notes of one stored `notes` field (an opaque unknown — malformed entries are skipped honestly, R46). */
export function researchNotesOf(field: unknown): readonly ResearchNoteRecord[] {
  if (!Array.isArray(field)) return [];
  const notes: ResearchNoteRecord[] = [];
  for (const entry of field) {
    const parsed = parseResearchNoteRecord(entry);
    if (parsed !== null) notes.push(parsed);
  }
  return Object.freeze(notes);
}

// ---------------------------------------------------------------------------
// The mint (pure, deterministic over the envelope)
// ---------------------------------------------------------------------------

/** The content-addressed note id over the note's own envelope (the house id grammar). */
export function mintResearchNote(tenant: string, project: string, at: number, input: ResearchNoteInput, actor?: { readonly principalId: string }): ResearchNoteRecord {
  return deepFreeze({
    noteId: `note:${fnv1a32Hex(canonicalJson(['research-note', tenant, project, at, input.title, input.text] as never))}`,
    tenant,
    project,
    attachedAt: at,
    title: input.title,
    text: input.text,
    ...(actor === undefined ? {} : { actorPrincipal: actor.principalId, actorAt: at }),
  });
}

// ---------------------------------------------------------------------------
// The storage seam (both backings implement it)
// ---------------------------------------------------------------------------

/** The typed attach outcome: the stored record, or the typed failure (target absent = the honest 404; anything else = the drain's own 503). */
export type NoteAttachOutcome =
  | { readonly ok: true; readonly note: ResearchNoteRecord }
  | { readonly ok: false; readonly error: StoreFailure };

/**
 * The composition's note-attachment surface — ONE function the route
 * drives, implemented per backing: under DURABLE the goal-set row merge
 * (the same pending drain every stamp rides — the write confirms before
 * the response leaves, the W-25D ordering law) and write-through,
 * idempotent PER CONTENT (a re-attach of the same title+text returns
 * the STORED record — the FIRST mint stands); under DEMO the
 * per-instance capture (the promote registry's own disclosed law). NULL
 * under port overrides (the route is absent — the boundary's typed
 * not-found, the pre-law).
 */
export interface NoteIngestionSurface {
  /** Attach one minted note to the project's record (idempotent per noteId — the FIRST stored record stands). */
  readonly attach: (tenant: string, project: string, note: ResearchNoteRecord) => Promise<NoteAttachOutcome>;
}

// ---------------------------------------------------------------------------
// The envelope discipline (the promotion precedent: built from the frozen
// service's own primitives — no runtime dependency on './routes')
// ---------------------------------------------------------------------------

/** The minimal request surface the note route consumes (the wrapped ApiRequest carries exactly these + the body). */
export type NoteAttachRequest = Pick<ApiRequest, 'method' | 'path' | 'headers'> & { readonly body?: unknown };

function noteRouteRequestId(request: NoteAttachRequest, serial: number): RequestId {
  return mintRequestId(fnv1a32Hex(canonicalJson(['note-attach-route', request.method, request.path, serial] as never)));
}

function noteRouteSuccess(requestId: RequestId, data: unknown): ApiResponse {
  return deepFreeze({ status: 200, headers: { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION }, body: { requestId, data } });
}

function noteRouteError(requestId: RequestId, error: ApiError): ApiResponse {
  const headers: Record<string, string> = { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION };
  if (error.retryAfterMs !== undefined) headers['retry-after-ms'] = String(error.retryAfterMs);
  return deepFreeze({ status: error.status, headers, body: { requestId, error } });
}

/** The `/v1/projects/:projectId/notes` path match (the captured project id, or null). */
export function matchNoteAttachPath(path: string): string | null {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 4) return null;
  if (segments[0] !== 'v1' || segments[1] !== 'projects' || segments[3] !== 'notes') return null;
  const projectId = segments[2] as string;
  return projectId.length > 0 ? projectId : null;
}

/** The note route's structural input (the composition builds it; null notes = the route is absent under port overrides). */
export interface NoteAttachRouteInput {
  /** The host auth seam (the composition's registered developer credential — the W-8 law). */
  readonly verifyDeveloperAuthorization: (authorization: string | undefined) => { readonly tenant: string; readonly principal: string } | null;
  /** The backing's note-attachment surface (the storage seam above). */
  readonly notes: NoteIngestionSurface;
  /**
   * THE PRINCIPAL TOKEN RESOLVER (FW-39-3, the audit stamp — optional so
   * existing constructions stay valid): the auth surface's shared verdict
   * law. A VALID token stamps the mint's additive actor fields; an
   * absent/invalid one mints the ANONYMOUS shape; a DEGRADED revocation
   * read answers the typed 503 (fail closed — the promote route's own law).
   */
  readonly resolvePrincipalToken?: (headers: unknown, tenant: string) => Promise<PrincipalResolution>;
}

/**
 * Serve ONE POST /v1/projects/:projectId/notes request. Returns `null`
 * when the request is NOT the note route (the caller falls through to the
 * frozen boundary — the pre-FW-45 behavior, byte-identical). Authn FIRST
 * (the typed 401); the untrusted-input gate answers the typed 400
 * validation_failed (the boundary's own untrusted-payload status — never
 * a half-applied note); the storage answers the typed 404 (no goal set on
 * record — fail-closed) or the drain's own typed 503; the mint is
 * idempotent per content. FW-39-3: a request carrying a VALID principal
 * token stamps the additive actor fields; a degraded revocation read
 * fails closed (the typed 503).
 */
export async function serveNoteAttachRoute(input: NoteAttachRouteInput, request: NoteAttachRequest, serial: number): Promise<ApiResponse | null> {
  if (request.method !== 'POST') return null;
  const projectId = matchNoteAttachPath(request.path);
  if (projectId === null) return null;
  const requestId = noteRouteRequestId(request, serial);
  // AUTHN FIRST (the boundary's own 401 law — the W-8 host routes' own shape).
  const authorization = input.verifyDeveloperAuthorization(request.headers.authorization);
  if (authorization === null) {
    return noteRouteError(requestId, apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'));
  }
  // THE UNTRUSTED-INPUT GATE (fail-closed, refused whole — the typed 400
  // validation_failed, the boundary's own untrusted-payload law).
  const parsed = parseResearchNoteBody(request.body);
  if (!parsed.ok) {
    return noteRouteError(requestId, apiError('validation_failed', 'the research-note body is not valid (the title and text are required, bounded, and stored verbatim — this deployment fetches nothing)', { problems: parsed.problems }));
  }
  // FW-39-3 — THE ACTOR RESOLUTION (the audit stamp, the promote route's law):
  // resolved only on the valid-input path. A VALID token stamps the mint; an
  // absent/invalid one mints the anonymous shape; a DEGRADED revocation read
  // FAILS CLOSED (the typed 503 — an unverifiable token is never honored).
  let actor: { readonly principalId: string } | undefined;
  if (input.resolvePrincipalToken !== undefined) {
    const resolution = await input.resolvePrincipalToken(request.headers, authorization.tenant);
    if (resolution.kind === 'degraded') {
      return noteRouteError(requestId, apiError('unavailable', `the revocation-list read failed (${resolution.error.code}): ${resolution.error.message} — the note attach fails closed (R46); retry attaches idempotently`));
    }
    if (resolution.kind === 'valid') actor = { principalId: resolution.token.principalId };
  }
  // THE MINT (L4: the route's OWN observation instant — never a request value).
  const note = mintResearchNote(authorization.tenant, projectId, Date.now(), parsed.input, actor);
  // THE STORAGE (L12 by construction — the surface keys on the AUTHORIZED tenant;
  // unknown and cross-tenant projects answer the typed 404, indistinguishably).
  const attached = await input.notes.attach(authorization.tenant, projectId, note);
  if (!attached.ok) {
    if (attached.error.code === 'research_note_target_absent') {
      return noteRouteError(requestId, apiError('not_found', `no goal set exists for ${JSON.stringify(projectId)} at this host (the note attaches to the project's own goal-set record — the record must exist; unknown and cross-tenant are indistinguishable)`));
    }
    return noteRouteError(requestId, apiError('unavailable', `the research-note storage failed (${attached.error.code}): ${attached.error.message} — the attach is unconfirmed (R46)`));
  }
  return noteRouteSuccess(requestId, deepFreeze({ note: attached.note }));
}
