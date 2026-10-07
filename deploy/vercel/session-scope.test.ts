// deploy/vercel — THE SESSION-SCOPE PINS (FW-MI-A, defects MI-D1 + MI-D8).
//
// THE WAVE-1 EVIDENCE (9/9 professionals — the #1 trust blocker): every
// browser session on the shared origin saw EVERY session's launched
// projects — Northline's M1 saw "a rival fund's desks (G7 Rates RV, FX
// Carry) in my switcher, palette, and export's projectDirectory"; Alder's
// S5 (REJECT): "my own export file embeds a 24-project directory including
// other firms' desks"; Meridian's L3 (compliance): "I switched into my PM
// colleague's G7 Rates desk and read its full envelope with no barrier —
// a reportable control failure."
//
// WHAT THIS FILE PINS — the DEMO backing's half of the fix, through the
// FULL function handler (api/router.ts: tick -> wrap -> session routes ->
// demo-substance routes -> boundary -> drain):
//   - a session's listing serves the DEMO project + THE SESSION'S OWN
//     projects — never another session's (MI-D1's required behavior);
//   - the create-stamp: a session-scoped POST /v1/projects records the
//     OWNING session (the response-side stamp — the project appears in
//     the creator's listing from the first response on);
//   - cross-session reads by id (the detail, the goal bundle, the jobs
//     list, the execution blotter) answer the typed not-found — unknown
//     and foreign indistinguishable (L3's switch-in, closed);
//   - UNOWNED projects (a headerless create — the boot world's seed, a
//     direct SDK create) are visible to NO session;
//   - SDK PARITY: a caller WITHOUT the session header gets the boundary's
//     byte-identical full-tenant behavior (the pre-fix view), and a
//     MALFORMED header is ignored the same way;
//   - the typed 401 for a bad bearer on the session routes.
//
// The DURABLE half (the Neon ownership stamp surviving cold starts + the
// fresh JOIN listing) is pinned in durable.test.ts's FW-MI-A describe.

import { describe, expect, it } from 'vitest';
import { composeDeployment } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { CONSOLE_SESSION_HEADER } from './runtime/session-routes';
import { validCreateProjectRequest } from '../../services/api/src/fixtures';
import { DEMO_PROJECT_ID } from './runtime/demo';
import type { FunctionRequest, FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// The harness (the full function-handler path — the same shape as
// runtime.test.ts / durable.test.ts)
// ---------------------------------------------------------------------------

const TOKEN = 'tok-deploy-demo';
const TENANT = 'tenant-demo';
const PRINCIPAL = 'public-console';
const SESSION_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // 32-hex — the console's mint shape
const SESSION_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function apiEnv(overrides: Record<string, string> = {}) {
  return readApiEnv({
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
    ...overrides,
  });
}

interface CapturedResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly payload: string | null;
}

function streamingRequest(parts: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown }): FunctionRequest {
  return { method: parts.method ?? 'GET', url: parts.url ?? '/v1/meta', headers: parts.headers ?? {}, body: parts.body };
}

function capture(): { response: FunctionResponse; captured: () => CapturedResponse } {
  const headers: Record<string, string> = {};
  let status = 0;
  let payload: string | null = null;
  const response: FunctionResponse = {
    get statusCode() {
      return status;
    },
    set statusCode(value: number) {
      status = value;
    },
    setHeader(key: string, value: string | number) {
      headers[key] = String(value);
      return undefined;
    },
    end(chunk?: string) {
      if (typeof chunk === 'string') payload = chunk;
      return undefined;
    },
  };
  return { response, captured: () => ({ status, headers, payload }) };
}

/** The bearer headers of the deployment's developer credential. */
const BEARER = { authorization: `Bearer ${TOKEN}` };

/** The session-scoped headers of one console session. */
function sessionHeaders(session: string): Record<string, string> {
  return { ...BEARER, [CONSOLE_SESSION_HEADER]: session };
}

/** Drive one request through the FULL function handler; returns the parsed JSON body. */
async function drive(deployment: ReturnType<typeof composeDeployment>, request: FunctionRequest): Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown> }> {
  const { response, captured } = capture();
  await handleDeploymentRequest(deployment, request, response);
  const written = captured();
  return { status: written.status, headers: written.headers, body: JSON.parse(written.payload ?? 'null') as Record<string, unknown> };
}

/** The listed project ids of one session-scoped (or headerless) listing response. */
function listedIdsOf(body: Record<string, unknown>): readonly string[] {
  const data = body.data as { items: readonly { id: string }[] } | undefined;
  return data?.items.map((project) => project.id) ?? [];
}

// ---------------------------------------------------------------------------
// The pins
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-MI-A: the session-scope routes over the DEMO backing (MI-D1 + MI-D8)', () => {
  it('a session with no projects sees EXACTLY the shared demo project — the pre-fix shared-tenant listing is gone for session callers', async () => {
    const composed = composeDeployment(apiEnv());
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const listed = await drive(composed, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_A) }));
    expect(listed.status).toBe(200);
    expect(listedIdsOf(listed.body)).toEqual([DEMO_PROJECT_ID]); // the demo project ONLY (MI-D1 clause (b))
    expect(listed.body.data).not.toHaveProperty('nextCursor'); // one full page — the served page IS the whole session view (MI-D8's no-silent-cap law)
  });

  it('the create-stamp: a session-scoped launch records the OWNING session — the creator sees the desk from the first response on, no other session does', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;

    // session A launches a desk
    const created = await drive(composed, streamingRequest({
      method: 'POST',
      url: '/v1/projects',
      headers: { ...sessionHeaders(SESSION_A), 'content-type': 'application/json' },
      body: validCreateProjectRequest(TENANT, 'prj-session-a-1', 'G7 Rates Relative Value'),
    }));
    expect(created.status).toBe(201); // the boundary's own create verdict (the pipeline ran — L12 tenant injection, validation, audit)

    // A's listing: demo + the desk A just launched
    const ownListing = await drive(composed, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_A) }));
    expect(listedIdsOf(ownListing.body)).toEqual([DEMO_PROJECT_ID, 'prj-session-a-1']);

    // B's listing: demo ONLY — A's desk never crosses (M1's "a rival fund's desks in my switcher", closed)
    const otherListing = await drive(composed, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_B) }));
    expect(listedIdsOf(otherListing.body)).toEqual([DEMO_PROJECT_ID]);
  });

  it('cross-session reads by id answer the typed not-found — the detail, the goal bundle, the jobs list and the execution blotter (L3\'s switch-in, closed)', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    await drive(composed, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A), 'content-type': 'application/json' },
      body: validCreateProjectRequest(TENANT, 'prj-session-a-1', 'G7 Rates Relative Value'),
    }));

    // the DETAIL: A reads its own desk; B reads the same id and gets the typed 404
    const ownDetail = await drive(composed, streamingRequest({ url: '/v1/projects/prj-session-a-1', headers: sessionHeaders(SESSION_A) }));
    expect(ownDetail.status).toBe(200);
    const foreignDetail = await drive(composed, streamingRequest({ url: '/v1/projects/prj-session-a-1', headers: sessionHeaders(SESSION_B) }));
    expect(foreignDetail.status).toBe(404);
    expect((foreignDetail.body.error as { code: string }).code).toBe('not_found'); // unknown and foreign indistinguishable — the boundary's own law

    // the GOAL bundle: B's read of A's goal answers the typed 404 (L3's "read its full envelope", closed)
    const foreignGoal = await drive(composed, streamingRequest({ url: '/v1/projects/prj-session-a-1/goal?project=prj-session-a-1', headers: sessionHeaders(SESSION_B) }));
    expect(foreignGoal.status).toBe(404);

    // the jobs list + the execution blotter: B's reads of A's desk answer the typed 404
    const foreignJobs = await drive(composed, streamingRequest({ url: '/v1/jobs?project=prj-session-a-1', headers: sessionHeaders(SESSION_B) }));
    expect(foreignJobs.status).toBe(404);
    const foreignBlotter = await drive(composed, streamingRequest({ url: '/v1/execution/submissions?project=prj-session-a-1', headers: sessionHeaders(SESSION_B) }));
    expect(foreignBlotter.status).toBe(404);

    // ...while A's own gated reads serve normally (the gate passes for the owner)
    const ownJobs = await drive(composed, streamingRequest({ url: '/v1/jobs?project=prj-session-a-1', headers: sessionHeaders(SESSION_A) }));
    expect(ownJobs.status).toBe(200);
    const ownBlotter = await drive(composed, streamingRequest({ url: '/v1/execution/submissions?project=prj-session-a-1', headers: sessionHeaders(SESSION_A) }));
    expect(ownBlotter.status).toBe(200);
    const ownGoal = await drive(composed, streamingRequest({ url: '/v1/projects/prj-session-a-1/goal?project=prj-session-a-1', headers: sessionHeaders(SESSION_A) }));
    expect(ownGoal.status).toBe(200); // the demo goal route serves the create's captured goal set
    const goalBundle = ownGoal.body.data as { goal: unknown; constraintSet: unknown };
    expect(goalBundle.goal).toEqual(validCreateProjectRequest(TENANT, 'prj-session-a-1').goal); // the launch's OWN goal statement, served back to its owner
  });

  it('UNOWNED projects (a headerless create — the boot world\'s seed, a direct SDK create) are visible to NO session', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;

    // an SDK-style create: NO session header on the create
    const created = await drive(composed, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'content-type': 'application/json' },
      body: validCreateProjectRequest(TENANT, 'prj-sdk-1', 'the SDK desk'),
    }));
    expect(created.status).toBe(201);

    // no session sees it in the listing (unowned = not in any session view)
    const listingA = await drive(composed, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_A) }));
    expect(listedIdsOf(listingA.body)).toEqual([DEMO_PROJECT_ID]);
    const listingB = await drive(composed, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_B) }));
    expect(listedIdsOf(listingB.body)).toEqual([DEMO_PROJECT_ID]);

    // and no session reads it by id
    const detail = await drive(composed, streamingRequest({ url: '/v1/projects/prj-sdk-1', headers: sessionHeaders(SESSION_A) }));
    expect(detail.status).toBe(404);
  });

  it('SDK PARITY: a caller WITHOUT the session header gets the boundary\'s full-tenant behavior, byte-identical (the pre-fix view preserved)', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    await drive(composed, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A), 'content-type': 'application/json' },
      body: validCreateProjectRequest(TENANT, 'prj-session-a-1', 'G7 Rates Relative Value'),
    }));

    // the headerless listing serves the WHOLE tenant (the boundary's own route — the SDK's view)
    const headerless = await drive(composed, streamingRequest({ url: '/v1/projects', headers: BEARER }));
    expect(headerless.status).toBe(200);
    expect(listedIdsOf(headerless.body)).toEqual([DEMO_PROJECT_ID, 'prj-session-a-1']);
    // the headerless detail serves the record (the boundary's own route)
    const headerlessDetail = await drive(composed, streamingRequest({ url: '/v1/projects/prj-session-a-1', headers: BEARER }));
    expect(headerlessDetail.status).toBe(200);

    // a MALFORMED session header is IGNORED (the shape law) — the boundary serves, exactly as the headerless caller
    const malformed = await drive(composed, streamingRequest({ url: '/v1/projects', headers: { ...BEARER, [CONSOLE_SESSION_HEADER]: 'short' } }));
    expect(malformed.status).toBe(200);
    expect(listedIdsOf(malformed.body)).toEqual([DEMO_PROJECT_ID, 'prj-session-a-1']);
  });

  it('the session routes authenticate with the host\'s own law — a bad bearer answers the typed 401', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const unauthenticated = await drive(composed, streamingRequest({ url: '/v1/projects', headers: { [CONSOLE_SESSION_HEADER]: SESSION_A } }));
    expect(unauthenticated.status).toBe(401);
    expect((unauthenticated.body.error as { code: string }).code).toBe('unauthenticated');
  });

  it('the demo project stays visible to EVERY session — the shared teaching scope (MI-D1\'s clause (b), preserved)', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    for (const session of [SESSION_A, SESSION_B, 'cccccccccccccccccccccccccccccccc']) {
      const listing = await drive(composed, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(session) }));
      expect(listedIdsOf(listing.body)).toContain(DEMO_PROJECT_ID);
      const demoDetail = await drive(composed, streamingRequest({ url: `/v1/projects/${DEMO_PROJECT_ID}`, headers: sessionHeaders(session) }));
      expect(demoDetail.status).toBe(200);
      const demoGoal = await drive(composed, streamingRequest({ url: `/v1/projects/${DEMO_PROJECT_ID}/goal?project=${DEMO_PROJECT_ID}`, headers: sessionHeaders(session) }));
      expect(demoGoal.status).toBe(200); // the seeded goal serves every session
    }
  });
});
