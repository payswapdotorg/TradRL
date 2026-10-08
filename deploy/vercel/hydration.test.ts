// deploy/vercel/hydration.test.ts — THE PROJECT HYDRATION READ (FW-34-A,
// Round C register item 3 — the loading-vs-empty truth).
//
// Pure, offline, deterministic: NO live provider calls, NO network, NO
// real Vercel (the durable arm rides the fake provider fleet's fetch,
// exactly like deploy/vercel/durable.test.ts + record-durability.test.ts).
//
// THE ROUND-C EVIDENCE THIS CLOSES (ROUND-C-REPORT §3.3 — L4, M1, S2): the
// console's resume first-paint renders 4–45s of "No project history is on
// record yet" / "Not compiled yet" / shrinking counts on a WARM,
// fully-populated scope while its sequential boot bundle is still in
// flight — the honest-empty state and the loading state are
// INDISTINGUISHABLE client-side (L4: "reads like record loss"; M1: "the
// exact perception behind my Round B filing"). The host's own
// loading-vs-empty truth — GET /v1/projects/:projectId/hydration — gives
// the console ONE round trip it can fire FIRST.
//
// WHAT THIS FILE PINS — through the FULL function handler (api/router.ts:
// tick -> wrap -> session routes -> demo-substance routes -> boundary ->
// drain) plus the pure route's own unit laws:
//   - THE ONE-GLANCE CONTRACT: the read serves, per surface the console's
//     boot bundle reads, the honest record COUNT from the EXACT SAME fold
//     the console's own read of that surface drives (pinned by driving
//     BOTH in the same deployment and comparing — the counts can never
//     disagree with the reads that follow);
//   - THE HONESTY LAW (never a lying zero): a surface whose fold answers
//     its typed port failure serves `null` and is named in `unreadable` —
//     never 0 (a 0 asserts "honestly empty" about a surface that could
//     not be read);
//   - THE ORGANIZATION BLOCK: the project's own bind state + the LATEST
//     watch snapshot on record, VERBATIM (the same store the org-status
//     read serves — the compile-instant identity FW-34-A's other half
//     pins in record-durability.test.ts);
//   - THE ROUTE'S OWN LAWS: developer-credential authn first (the typed
//     401), the typed not-found for a project with no record on the
//     backing, and the fall-through laws (non-GET methods, port
//     overrides, the durable backing without a built seam — the
//     pre-FW-34-A behavior, byte-identical);
//   - THE SESSION GATE: a foreign project's hydration read answers the
//     typed not-found for a session-scoped request (the jobs list + the
//     execution blotter's own law — L3's switch-in, closed on this read
//     too);
//   - L12 BY CONSTRUCTION: every fold keys on the AUTHORIZED tenant,
//     never a request value (pinned by spy).
//
// Spec anchors: R43 (additive), R46, L12, L20, UX-DESIGN §7 (the
// anti-deception law), ROUND-C-REPORT §3.3 + §6 (FW-34-A).

import { describe, expect, it } from 'vitest';
import { composeDeployment, degradedPorts } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { fakeProviders } from '../wire/smoketest';
import { CONSOLE_SESSION_HEADER } from './runtime/session-routes';
import { DEMO_ORG_SNAPSHOT_AT, DEMO_ORGANIZATION_REF, DEMO_PROJECT_ID } from './runtime/demo';
import { buildProjectHydrationRead, matchProjectHydrationPath, serveProjectHydrationRoute, type ProjectHydrationRead, type ProjectHydrationRouteInput } from './runtime/hydration';
import type { DemoSubstanceAuthorization, DemoSubstanceRequest, VerifyDeveloperAuthorization } from './runtime/routes';
import { validConstraintSet, validGoal } from '../../services/api/src/fixtures';
import type { OrgStatusSnapshot, ProjectRecord, TimestampMs } from '../../services/api/src/index';
import type { FunctionRequest, FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// The harness (the risk-utilization.test.ts pattern — the full function path)
// ---------------------------------------------------------------------------

const VALID_ENV = {
  [API_ENV_KEYS.apiDeveloperToken]: 'tok-deploy-demo',
  [API_ENV_KEYS.apiDeveloperTenant]: 'tenant-demo',
  [API_ENV_KEYS.apiDeveloperPrincipal]: 'public-console',
};

function apiEnv(overrides: Record<string, string | undefined> = {}) {
  return readApiEnv({ ...VALID_ENV, ...overrides });
}

const BEARER = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };

/** The env source WITH the internal credential (the org bind + the org-status report ride the private plane — the machinery law). */
function envWithMachinery(): Record<string, string | undefined> {
  return {
    ...VALID_ENV,
    [API_ENV_KEYS.apiInternalToken]: 'tok-internal-hydration',
    [API_ENV_KEYS.apiInternalPrincipal]: 'hydration-machinery',
  };
}

/** The durable source over the fake provider fleet (the record-durability.test.ts composition). */
function durableSource(): Record<string, string | undefined> {
  return {
    ...envWithMachinery(),
    NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech',
    NEON_DATABASE: 'neondb',
    NEON_API_USER: 'neondb_owner',
    NEON_API_KEY: 'fake-neon-key-demo',
  };
}

function streamingRequest(parts: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown }): FunctionRequest {
  return { method: parts.method ?? 'GET', url: parts.url ?? '/v1/meta', headers: parts.headers ?? {}, body: parts.body };
}

interface CapturedResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly payload: string | null;
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

/** Drive one request through the FULL function handler; returns status/headers + the parsed body. */
async function drive(deployment: ReturnType<typeof composeDeployment>, request: FunctionRequest): Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown> }> {
  const { response, captured } = capture();
  await handleDeploymentRequest(deployment, request, response);
  const written = captured();
  return { status: written.status, headers: written.headers, body: JSON.parse(written.payload ?? 'null') as Record<string, unknown> };
}

/** The composed deployment (the ok variant — every helper is called after the ok guard). */
type Deployment = Extract<ReturnType<typeof composeDeployment>, { ok: true }>;

/** Drive the hydration read through the full handler; returns the data payload. */
async function driveHydration(deployment: Deployment, project: string, headers: Record<string, string> = BEARER): Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown>; data: ProjectHydrationRead }> {
  const result = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/projects/${encodeURIComponent(project)}/hydration`, headers }));
  return { status: result.status, headers: result.headers, body: result.body, data: result.body.data as unknown as ProjectHydrationRead };
}

/** The console's own jobs read (the boot bundle's GET /v1/jobs fold — the count's own source). */
async function jobsCountOf(deployment: Deployment, project: string): Promise<number> {
  const read = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/jobs?project=${encodeURIComponent(project)}`, headers: BEARER }));
  expect(read.status).toBe(200);
  return (read.body.data as { items: readonly unknown[] }).items.length;
}

/** The console's own blotter read (the boot bundle's GET /v1/execution/submissions fold). */
async function submissionsCountOf(deployment: Deployment, project: string): Promise<number> {
  const read = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/execution/submissions?project=${encodeURIComponent(project)}`, headers: BEARER }));
  expect(read.status).toBe(200);
  return (read.body.data as { items: readonly unknown[] }).items.length;
}

/** The console's own outcomes read (the boot bundle's POST /v1/outcomes/query port chain). */
async function outcomesCountOf(deployment: Deployment, project: string, at: number): Promise<number> {
  const read = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/outcomes/query', headers: BEARER, body: { project, at } }));
  expect(read.status).toBe(200);
  return (read.body.data as { items: readonly unknown[] }).items.length;
}

/** The console's own post-mortems read (the boot bundle's POST /v1/post-mortems/query port chain). */
async function postMortemsCountOf(deployment: Deployment, project: string, at: number): Promise<number> {
  const read = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/post-mortems/query', headers: BEARER, body: { project, at, latestPerOutcome: true } }));
  expect(read.status).toBe(200);
  return (read.body.data as { items: readonly unknown[] }).items.length;
}

/** The console's own knowledge read (the boot bundle's POST /v1/knowledge/query port chain). */
async function knowledgeCountOf(deployment: Deployment, project: string, at: number): Promise<number> {
  const read = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/knowledge/query', headers: BEARER, body: { project, at } }));
  expect(read.status).toBe(200);
  return (read.body.data as { items: readonly unknown[] }).items.length;
}

/** The console's own org-status read (the boot bundle's LAST read — the watch snapshot's own surface). */
async function orgSnapshotOf(deployment: Deployment, organizationRef: string, project: string): Promise<Record<string, unknown>> {
  const read = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/organizations/${encodeURIComponent(organizationRef)}/status?project=${encodeURIComponent(project)}`, headers: BEARER }));
  expect(read.status).toBe(200);
  return read.body.data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The demo arm — the one-glance contract (the demo project's own read)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the project hydration read, the demo arm (FW-34-A)', () => {
  it('serves the demo project\'s loading-vs-empty truth in ONE round trip: per-surface counts from the SAME folds the console\'s own reads drive, the org block with the LATEST watch snapshot, the disclosure — the page envelope, no CORS', async () => {
    const composed = composeDeployment(apiEnv(envWithMachinery()));
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const at = Date.now();
    const { status, headers, data } = await driveHydration(composed, DEMO_PROJECT_ID);
    expect(status).toBe(200);
    expect(headers['content-type']).toBe('application/json; charset=utf-8');
    expect(headers['x-api-version']).toBe('v1');
    expect(headers['x-request-id']).toMatch(/^req:/);
    for (const key of Object.keys(headers)) expect(key.toLowerCase()).not.toContain('access-control');
    expect(data.projectId).toBe(DEMO_PROJECT_ID);
    expect(data.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // THE COUNTS ARE THE CONSOLE'S OWN READS' COUNTS — pinned by driving
    // both in the SAME deployment (the counts can never disagree with the
    // reads that follow; a section whose read has not landed can trust the
    // host's number).
    const [jobs, submissions, outcomes, postMortems, knowledge] = await Promise.all([
      jobsCountOf(composed, DEMO_PROJECT_ID),
      submissionsCountOf(composed, DEMO_PROJECT_ID),
      outcomesCountOf(composed, DEMO_PROJECT_ID, at),
      postMortemsCountOf(composed, DEMO_PROJECT_ID, at),
      knowledgeCountOf(composed, DEMO_PROJECT_ID, at),
    ]);
    expect(jobs).toBeGreaterThan(0); // the seeded pair is on record
    expect(submissions).toBeGreaterThan(0); // the seeded blotter is on record
    expect(data.records.jobs).toBe(jobs);
    expect(data.records.submissions).toBe(submissions);
    expect(data.records.outcomes).toBe(outcomes);
    expect(data.records.postMortems).toBe(postMortems);
    expect(data.records.knowledge).toBe(knowledge);
    expect(data.records.unreadable).toEqual([]); // every fold served

    // THE ORGANIZATION BLOCK — the project's own bind state + the LATEST
    // watch snapshot on record (the same store the org-status read serves):
    // the console paints the Organization card from THIS read, never the
    // 45s-late bundle tail (L4's "Not compiled yet" window).
    expect(data.organization.bound).toBe(true);
    expect(data.organization.organizationRef).toBe(DEMO_ORGANIZATION_REF);
    expect(data.organization.watchSnapshot).not.toBeNull();
    expect((data.organization.watchSnapshot as unknown as OrgStatusSnapshot).at).toBe(DEMO_ORG_SNAPSHOT_AT); // the deterministic demo epoch — byte-stable across instances
    const orgRead = await orgSnapshotOf(composed, DEMO_ORGANIZATION_REF, DEMO_PROJECT_ID);
    expect((data.organization.watchSnapshot as unknown as Record<string, unknown>)).toEqual(orgRead);

    // The disclosure names the truth + the arm (the anti-deception law).
    expect(data.disclosure).toContain('LOADING-VS-EMPTY TRUTH');
    expect(data.disclosure).toContain('DEMO backing');
    expect(data.disclosure).toContain('unreadable');
  });

  it('authn runs first (the typed 401 — the same law as every host route), and a project with no record on the backing answers the typed not-found', async () => {
    const composed = composeDeployment(apiEnv());
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const noToken = await drive(composed, streamingRequest({ method: 'GET', url: `/v1/projects/${DEMO_PROJECT_ID}/hydration` }));
    expect(noToken.status).toBe(401);
    expect((noToken.body as { error: { code: string } }).error.code).toBe('unauthenticated');
    const wrongToken = await drive(composed, streamingRequest({ method: 'GET', url: `/v1/projects/${DEMO_PROJECT_ID}/hydration`, headers: { authorization: 'Bearer tok-wrong' } }));
    expect(wrongToken.status).toBe(401);
    const unknown = await drive(composed, streamingRequest({ method: 'GET', url: '/v1/projects/prj-never-created/hydration', headers: BEARER }));
    expect(unknown.status).toBe(404);
    expect((unknown.body as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('ADDITIVE / backward-compatible: non-GET methods, port overrides and the durable backing without a built seam fall through to the boundary (the typed not_found — the pre-FW-34-A behavior)', async () => {
    const cases: readonly [string, ReturnType<typeof composeDeployment>, string][] = [
      ['a non-GET method (the demo backing)', composeDeployment(apiEnv()), 'POST'],
      ['port overrides (the injection seam owns its own world)', composeDeployment(apiEnv(), { controlPlane: degradedPorts().controlPlane }), 'GET'],
      ['the durable backing without Neon keys (the seam was not built)', composeDeployment(apiEnv({ TRADRL_DEPLOY_BACKING: 'durable' })), 'GET'],
    ];
    for (const [label, composed, method] of cases) {
      expect(composed.ok, label).toBe(true);
      if (!composed.ok) continue;
      const result = await drive(composed, streamingRequest({
        method,
        url: `/v1/projects/${DEMO_PROJECT_ID}/hydration`,
        headers: { ...BEARER, 'idempotency-key': 'idem:fw34a:hydration:falloff' },
        body: {},
      }));
      expect(result.status, label).toBe(404);
      expect((result.body as { error: { code: string } }).error.code, label).toBe('not_found');
    }
  });
});

// ---------------------------------------------------------------------------
// The durable arm — the seam's hydrated surfaces (the fake provider fleet)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the project hydration read, the durable arm (FW-34-A)', () => {
  it('the demo project\'s read serves from the seam\'s hydrated surfaces with counts that match the console\'s own reads — the disclosure naming the DURABLE arm', async () => {
    const providers = fakeProviders();
    const deployment = composeDeployment(readApiEnv(durableSource()), {}, { fetchLike: providers.fetchLike, instants: { next: () => 1_800_400_000_000 } });
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    const { status, data } = await driveHydration(deployment, DEMO_PROJECT_ID);
    expect(status).toBe(200);
    const at = Date.now();
    const [jobs, submissions, outcomes, postMortems, knowledge] = await Promise.all([
      jobsCountOf(deployment, DEMO_PROJECT_ID),
      submissionsCountOf(deployment, DEMO_PROJECT_ID),
      outcomesCountOf(deployment, DEMO_PROJECT_ID, at),
      postMortemsCountOf(deployment, DEMO_PROJECT_ID, at),
      knowledgeCountOf(deployment, DEMO_PROJECT_ID, at),
    ]);
    expect(jobs).toBeGreaterThan(0); // the boot world's re-seeded pair
    expect(data.records.jobs).toBe(jobs);
    expect(data.records.submissions).toBe(submissions);
    expect(data.records.outcomes).toBe(outcomes);
    expect(data.records.postMortems).toBe(postMortems);
    expect(data.records.knowledge).toBe(knowledge);
    expect(data.records.unreadable).toEqual([]);
    expect(data.organization.bound).toBe(true);
    expect(data.organization.organizationRef).toBe(DEMO_ORGANIZATION_REF);
    expect((data.organization.watchSnapshot as unknown as OrgStatusSnapshot).at).toBe(DEMO_ORG_SNAPSHOT_AT); // the compile-instant identity (FW-34-A's notification half): byte-stable across instances
    expect(data.disclosure).toContain('DURABLE');
    expect(data.disclosure).toContain('hydrated');
  });

  it('a launched desk serves its OWN truth: the create-only desk\'s counts are the honest zeros (no kickoff job, no blotter, no derived stream — the console renders HONEST-EMPTY, never a misleading loading state); the tick\'s compile pass has bound its org; a foreign id answers the typed not-found', async () => {
    const providers = fakeProviders();
    const deployment = composeDeployment(readApiEnv(durableSource()), {}, { fetchLike: providers.fetchLike, instants: { next: () => 1_800_400_000_000 } });
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
    const at = 1_700_500_000_000 as TimestampMs;
    const created = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/projects',
      headers: { ...BEARER, 'content-type': 'application/json' },
      body: { id: 'prj-hydration-desk', name: 'the hydration desk', executionMode: 'simulation', goal: validGoal(tenant), constraintSet: validConstraintSet(tenant), at },
    }));
    expect(created.status).toBe(201);

    const { status, data } = await driveHydration(deployment, 'prj-hydration-desk');
    expect(status).toBe(200);
    // The honest zeros (a create-only desk: no kickoff job, no blotter, no
    // derived stream) — a 0 here means EXACTLY what it says, so the
    // console's first paint renders the HONEST-EMPTY states, never a
    // misleading loading spinner.
    expect(data.records.jobs).toBe(0);
    expect(data.records.submissions).toBe(0);
    expect(data.records.outcomes).toBe(0);
    expect(data.records.postMortems).toBe(0);
    expect(data.records.knowledge).toBe(0);
    expect(data.records.unreadable).toEqual([]);
    // The org block: the request's own machinery tick (the router's step
    // 2b, BEFORE the host route serves) ran the compile pass — the desk is
    // bound to its compiled ref with the watch snapshot on record (the
    // product's own "org compiles ~10s" law; the snapshot's instant is the
    // compile event's, the FW-34-A identity law pinned in
    // record-durability.test.ts).
    expect(data.organization.bound).toBe(true);
    expect(data.organization.organizationRef).toBe('org:compiled-prj-hydration-desk');
    expect(data.organization.watchSnapshot).not.toBeNull();

    // A foreign id answers the typed not-found under durable too.
    const foreign = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-foreign-desk/hydration', headers: BEARER }));
    expect(foreign.status).toBe(404);
    expect((foreign.body as { error: { code: string } }).error.code).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// The session gate (the jobs list + the execution blotter's own law)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the hydration read rides the session gate (FW-34-A)', () => {
  it('a session-scoped request for a FOREIGN project answers the typed not-found; the demo project passes the gate and serves', async () => {
    const composed = composeDeployment(apiEnv());
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
    const sessionA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // 32-hex — the console's mint shape
    const sessionB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    // Session A owns a desk; session B does not.
    const created = await drive(composed, streamingRequest({
      method: 'POST',
      url: '/v1/projects',
      headers: { ...BEARER, 'content-type': 'application/json', [CONSOLE_SESSION_HEADER]: sessionA },
      body: { id: 'prj-hydration-owned', name: 'the owned desk', executionMode: 'simulation', goal: validGoal(tenant), constraintSet: validConstraintSet(tenant), at: 1_700_500_000_000 },
    }));
    expect(created.status).toBe(201);

    // B's request for A's desk answers the typed not-found (L3's switch-in,
    // closed on this read too — the gate applies the SAME visibility law as
    // the jobs list + the execution blotter).
    const blocked = await drive(composed, streamingRequest({ method: 'GET', url: '/v1/projects/prj-hydration-owned/hydration', headers: { ...BEARER, [CONSOLE_SESSION_HEADER]: sessionB } }));
    expect(blocked.status).toBe(404);
    expect((blocked.body as { error: { code: string } }).error.code).toBe('not_found');

    // The OWNER's own request passes the gate and serves the read.
    const own = await drive(composed, streamingRequest({ method: 'GET', url: '/v1/projects/prj-hydration-owned/hydration', headers: { ...BEARER, [CONSOLE_SESSION_HEADER]: sessionA } }));
    expect(own.status).toBe(200);

    // The DEMO project passes for every session (the shared teaching scope).
    const demo = await drive(composed, streamingRequest({ method: 'GET', url: `/v1/projects/${DEMO_PROJECT_ID}/hydration`, headers: { ...BEARER, [CONSOLE_SESSION_HEADER]: sessionB } }));
    expect(demo.status).toBe(200);

    // A headerless caller keeps full SDK parity (the pre-fix view).
    const headerless = await drive(composed, streamingRequest({ method: 'GET', url: '/v1/projects/prj-hydration-owned/hydration', headers: BEARER }));
    expect(headerless.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// The pure route's own laws (the unit battery — the risk-utilization.ts
// precedent: the route driven directly with structural inputs)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the hydration route\'s own laws (the pure battery)', () => {
  /** A minimal well-formed request for the pure route. */
  function hydrationRequest(path: string): DemoSubstanceRequest {
    return { method: 'GET', path, headers: { authorization: 'Bearer tok-pure' }, query: undefined };
  }

  /** A passing verifier (one tenant — the W-8 host law). */
  const verify: VerifyDeveloperAuthorization = (authorization): DemoSubstanceAuthorization | null =>
    authorization === 'Bearer tok-pure' ? { tenant: 'tenant-pure', principal: 'public-console' } : null;

  /** A project record shape for the fold inputs (the control-plane store's own row — the fakeControlPlane fixture's own construction law). */
  function projectRecord(organizationRef: string | null): ProjectRecord {
    return {
      id: 'prj-pure',
      tenantId: 'tenant-pure',
      name: 'the pure desk',
      executionMode: 'simulation',
      lifecycle: { projectId: 'prj-pure', status: 'draft', acceptanceCriteriaId: 'ac:fixture', organizationRef },
      lineage: { projectId: 'prj-pure', goal: { goalId: 'goal-fixture', version: 1 }, constraintSet: { id: 'cs-fixture', version: 1 } },
      createdAt: 1,
      updatedAt: 1,
    } as unknown as ProjectRecord;
  }

  it('THE HONESTY LAW: a surface whose fold answers its typed failure serves null and is named in unreadable — never a lying zero (a 0 asserts "honestly empty" about a surface that could not be read)', () => {
    const served = serveProjectHydrationRoute(
      {
        verifyDeveloperAuthorization: verify,
        projectOf: () => projectRecord('org:bound'),
        jobsOf: () => [],
        submissionsOf: () => [],
        outcomesOf: () => null, // NOT READABLE (the typed port failure)
        postMortemsOf: () => null, // NOT READABLE
        knowledgeOf: () => [], // honestly empty (the fold served an empty page)
      },
      hydrationRequest('/v1/projects/prj-pure/hydration'),
      0,
      'demo',
    );
    expect(served.status).toBe(200);
    const data = (served.body as { data: ProjectHydrationRead }).data;
    expect(data.records.jobs).toBe(0); // an honest zero (the fold served empty)
    expect(data.records.submissions).toBe(0);
    expect(data.records.outcomes).toBeNull(); // NEVER 0 — not readable
    expect(data.records.postMortems).toBeNull();
    expect(data.records.knowledge).toBe(0);
    expect(data.records.unreadable).toEqual(['outcomes', 'postMortems']);
    expect(data.disclosure).toContain('unreadable');
    // The LOADING-vs-EMPTY semantics the console consumes: an unreadable
    // surface renders LOADING (never "no records on record"), a 0 renders
    // the honest empty state.
    expect(data.disclosure).toContain('renders LOADING');
  });

  it('L12 BY CONSTRUCTION: every fold keys on the AUTHORIZED tenant, never a request value; the project read is the credential tenant\'s own', () => {
    const seen: { readonly kind: string; readonly tenant: string }[] = [];
    const served = serveProjectHydrationRoute(
      {
        verifyDeveloperAuthorization: verify,
        projectOf: (tenant, project) => {
          seen.push({ kind: 'projectOf', tenant });
          return project === 'prj-pure' ? projectRecord('org:bound') : null;
        },
        jobsOf: (tenant) => {
          seen.push({ kind: 'jobsOf', tenant });
          return [];
        },
        submissionsOf: (tenant) => {
          seen.push({ kind: 'submissionsOf', tenant });
          return [];
        },
        outcomesOf: (tenant) => {
          seen.push({ kind: 'outcomesOf', tenant });
          return [];
        },
        postMortemsOf: (tenant) => {
          seen.push({ kind: 'postMortemsOf', tenant });
          return [];
        },
        knowledgeOf: (tenant) => {
          seen.push({ kind: 'knowledgeOf', tenant });
          return [];
        },
      },
      hydrationRequest('/v1/projects/prj-pure/hydration'),
      0,
      'durable',
    );
    expect(served.status).toBe(200);
    expect(seen.length).toBe(6);
    for (const entry of seen) expect(entry.tenant).toBe('tenant-pure'); // the credential tenant — never a request value
  });

  it('the typed errors: the bad bearer answers the typed 401; a project with no record answers the typed not-found; a malformed id never reaches the route (the matcher\'s own law)', () => {
    const input: ProjectHydrationRouteInput = {
      verifyDeveloperAuthorization: verify,
      projectOf: () => null,
      jobsOf: () => [],
      submissionsOf: () => [],
      outcomesOf: () => [],
      postMortemsOf: () => [],
      knowledgeOf: () => [],
    };
    const unauthenticated = serveProjectHydrationRoute(input, { ...hydrationRequest('/v1/projects/prj-pure/hydration'), headers: { authorization: 'Bearer tok-wrong' } }, 0, 'demo');
    expect(unauthenticated.status).toBe(401);
    expect(((unauthenticated.body as { error: { code: string } }).error).code).toBe('unauthenticated');
    const unknown = serveProjectHydrationRoute(input, hydrationRequest('/v1/projects/prj-pure/hydration'), 0, 'demo');
    expect(unknown.status).toBe(404);
    expect(((unknown.body as { error: { code: string } }).error).code).toBe('not_found');
    expect(((unknown.body as { error: { message: string } }).error).message).toContain('prj-pure');
  });
});

// ---------------------------------------------------------------------------
// The path matcher's own grammar (the /v1/projects/:projectId/hydration law)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the hydration path matcher (the grammar, pinned)', () => {
  it('matches EXACTLY the 4-segment /v1/projects/:projectId/hydration path with a well-formed project id — never the session detail, never the goal path, never anything else', () => {
    expect(matchProjectHydrationPath('/v1/projects/prj-demo-console/hydration')).toBe('prj-demo-console');
    expect(matchProjectHydrationPath('//v1//projects//prj-a//hydration//')).toBe('prj-a'); // the segment-normalized grammar (the goal route's own law)
    // The neighbors never match:
    expect(matchProjectHydrationPath('/v1/projects/prj-demo-console')).toBeNull(); // the session detail (3 segments)
    expect(matchProjectHydrationPath('/v1/projects/prj-demo-console/goal')).toBeNull(); // the goal bundle
    expect(matchProjectHydrationPath('/v1/projects/prj-demo-console/hydration/extra')).toBeNull(); // 5 segments
    expect(matchProjectHydrationPath('/v1/projects/hydration')).toBeNull(); // the 3-segment shape with the segment as the id
    expect(matchProjectHydrationPath('/v1/organizations/org/hydration')).toBeNull();
    expect(matchProjectHydrationPath('/v1/projects/prj-demo-console/Hydration')).toBeNull(); // case-sensitive
    // The id grammar is the boundary's own (isProjectId = a non-empty
    // string — shape-valid ids match and the ROUTE's not-found answers
    // unknown ones, pinned above); an EMPTY project segment never matches.
    expect(matchProjectHydrationPath('/v1/projects//hydration')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The read builder's own laws (the watch-snapshot selection + the frozen shape)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the hydration read builder (the watch-snapshot selection)', () => {
  /** One watch snapshot fixture (the store's own shape). */
  function snapshot(organizationRef: string, project: string, at: number): OrgStatusSnapshot {
    return { organizationRef, project, at, instances: 2, status: 'active' } as unknown as OrgStatusSnapshot;
  }

  it('serves the LATEST snapshot of THIS project only — other projects\' snapshots never bleed (L12\'s project axis); ties resolve to the last reported (the store\'s own replacement order)', () => {
    const read = buildProjectHydrationRead({
      projectId: 'prj-mine',
      project: { lifecycle: { organizationRef: 'org:mine' } } as unknown as Parameters<typeof buildProjectHydrationRead>[0]['project'],
      records: { jobs: 0, submissions: 0, outcomes: 0, postMortems: 0, knowledge: 0, unreadable: [] },
      watchSnapshots: [
        snapshot('org:mine', 'prj-mine', 100),
        snapshot('org:other', 'prj-other', 900), // a different project — never served
        snapshot('org:mine', 'prj-mine', 300), // the latest of mine
        snapshot('org:mine', 'prj-mine', 300), // the tie — the last reported wins
      ],
      asOf: '2026-10-08T12:00:00.000Z',
      backing: 'durable',
    });
    expect(read.organization.bound).toBe(true);
    expect(read.organization.organizationRef).toBe('org:mine');
    expect((read.organization.watchSnapshot as OrgStatusSnapshot).at).toBe(300);
    expect(read.organization.watchSnapshot).toEqual(snapshot('org:mine', 'prj-mine', 300));
    expect(read.asOf).toBe('2026-10-08T12:00:00.000Z');
    expect(read.disclosure).toContain('DURABLE');
  });

  it('an UNBOUND project serves bound=false with no ref and no snapshot — the honest teaching empty state (never a fabricated observation)', () => {
    const read = buildProjectHydrationRead({
      projectId: 'prj-unbound',
      project: { lifecycle: { organizationRef: null } } as unknown as Parameters<typeof buildProjectHydrationRead>[0]['project'],
      records: { jobs: 0, submissions: 0, outcomes: 0, postMortems: 0, knowledge: 0, unreadable: [] },
      watchSnapshots: [snapshot('org:mine', 'prj-mine', 100)],
      asOf: '2026-10-08T12:00:00.000Z',
      backing: 'demo',
    });
    expect(read.organization.bound).toBe(false);
    expect(read.organization.organizationRef).toBeNull();
    expect(read.organization.watchSnapshot).toBeNull();
    expect(read.disclosure).toContain('DEMO backing');
  });
});
