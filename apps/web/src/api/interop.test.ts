// @tradrl/web-console — THE API TRIP-WIRES: the structural mirrors in
// src/api/* vs the REAL @tradrl/sdk + services/api surfaces.
//
// THE LAW (Work Order T042): "the console NEVER imports workspace
// packages; it mirrors @tradrl/sdk's client/error/pagination shapes and
// drives them through an injected transport adapter" + "All cross-package
// shapes consumed via STRUCTURAL MIRRORS + interop trip-wire tests only"
// (D-003/D-004). The runtime mirror imports NOTHING; THIS test file is
// the sanctioned exception (the program-wide interop precedent,
// packages/sdk/src/interop.test.ts): it imports the REAL sibling
// surfaces TEST-ONLY and pins the parity — if the real surface drifts
// from the mirror, this suite FAILS LOUDLY.
//
// Pins:
//   - the error-code vocabulary, the families and the code->family map,
//     member for member, against the REAL SDK's exported tables;
//   - the pagination envelope (Page<T>), the version constants and the
//     replay header, by literal + against the REAL SDK's values;
//   - the idempotency-key grammar + the DETERMINISTIC derivation
//     (identical parts -> identical key, cross-checked against the REAL
//     SDK's derivation — the same parts must derive the same key);
//   - the transport interface shapes (type-level witnesses);
//   - the client method surface + route paths (literal route table);
//   - TRANSPORT INJECTABILITY: a scripted fake transport drives the
//     mirrored client end to end (negotiation, envelope parse, typed
//     errors, idempotency header, retry of the retryable families);
//   - the REAL fixture service driven THROUGH the mirrored client.

import { describe, expect, it } from 'vitest';

// --- The REAL sibling surfaces (test-only; the mirror imports NONE of this) ---
import * as realSdk from '../../../../packages/sdk/src/index';
import type { ApiRequest, ApiResponse } from '../../../../services/api/src/index';
import { PROJECT_A, TENANT_A, TENANT_B, TOKEN_A, TOKEN_INTERNAL_RUNTIME, T0, fixtureService, validCreateProjectRequest, validStrategyIntent } from '../../../../services/api/src/fixtures';

// --- The console's mirrors (the surface under test) ---
import { createConsoleClient, isIdempotentReplay, type ConsoleClient } from './client';
import { API_ERROR_CODES, API_ERROR_FAMILIES, API_ERROR_FAMILY_OF, ApiConsoleError, AuthenticationError, ConflictError, NotFoundError, PermissionError, RateLimitError, TenantIsolationError, UnavailableError, ValidationError, VersionMismatchError, errorFromEnvelope, isRetryable } from './errors';
import { CURRENT_API_VERSION, IDEMPOTENT_REPLAY_HEADER, MAX_PAGE_SIZE, type ApiMeta, type GatewaySubmissionRecord, type JobRecord, type OrgStatusSnapshot, type OutcomeRecord, type Page, type PostMortemRecord, type ProjectRecord } from './contracts';
import { IDEMPOTENCY_KEY_PATTERN, deriveIdempotencyKey, isValidIdempotencyKey } from './idempotency';
import { collectAll, countOf, cursorOf, hasNext } from './pagination';
import type { ApiTransport, SdkRequest, SdkResponse } from './transport';

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail typecheck if the real surface drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the REAL SDK's served record types ARE the mirror's record types. */
function realProjectSatisfiesMirror(record: realSdk.ProjectRecord): ProjectRecord { return record; }
function realJobSatisfiesMirror(record: realSdk.JobRecord): JobRecord { return record; }
function realSnapshotSatisfiesMirror(record: realSdk.OrgStatusSnapshot): OrgStatusSnapshot { return record; }
function realOutcomeSatisfiesMirror(record: realSdk.OutcomeRecord): OutcomeRecord { return record; }
function realPostMortemSatisfiesMirror(record: realSdk.PostMortemRecord): PostMortemRecord { return record; }
function realSubmissionSatisfiesMirror(record: realSdk.GatewaySubmissionRecord): GatewaySubmissionRecord { return record; }
function realPageSatisfiesMirror<T>(page: realSdk.Page<T>): Page<T> { return page; }
function realMetaSatisfiesMirror(meta: realSdk.ApiMeta): ApiMeta { return meta; }

/** Compiles iff the transport wire shapes are identical (the adapter seam holds). */
function realRequestSatisfiesMirror(request: realSdk.SdkRequest): SdkRequest { return request; }
function realResponseSatisfiesMirror(response: realSdk.SdkResponse): SdkResponse { return response; }
function realTransportSatisfiesMirror(transport: realSdk.ApiTransport): ApiTransport { return transport; }

// ---------------------------------------------------------------------------
// The vocabulary trip-wires (drift in the REAL surface fails here)
// ---------------------------------------------------------------------------

describe('trip-wire: the error taxonomy matches the REAL SDK, member for member', () => {
  it('the error-code vocabulary is identical (order included)', () => {
    expect([...API_ERROR_CODES]).toEqual([...realSdk.SDK_ERROR_CODES]);
  });

  it('the family vocabulary is identical', () => {
    expect([...API_ERROR_FAMILIES]).toEqual([...realSdk.SDK_ERROR_FAMILIES]);
  });

  it('the code -> family mapping is identical for EVERY code', () => {
    for (const code of API_ERROR_CODES) {
      expect(API_ERROR_FAMILY_OF[code]).toBe(realSdk.SDK_ERROR_FAMILY_OF[code]);
    }
  });

  it('the mirror class names match the SDK class names (the hierarchy shape)', () => {
    expect(AuthenticationError.name).toBe(realSdk.AuthenticationError.name);
    expect(PermissionError.name).toBe(realSdk.PermissionError.name);
    expect(TenantIsolationError.name).toBe(realSdk.TenantIsolationError.name);
    expect(RateLimitError.name).toBe(realSdk.RateLimitError.name);
    expect(ValidationError.name).toBe(realSdk.ValidationError.name);
    expect(ConflictError.name).toBe(realSdk.ConflictError.name);
    expect(UnavailableError.name).toBe(realSdk.UnavailableError.name);
    expect(NotFoundError.name).toBe(realSdk.NotFoundError.name);
    expect(VersionMismatchError.name).toBe(realSdk.VersionMismatchError.name);
  });

  it('envelope translation: every code maps to the SDK-matching family class', () => {
    for (const code of API_ERROR_CODES) {
      const mirrorError = errorFromEnvelope({ code, message: 'm', status: 400 });
      const realError = realSdk.errorFromEnvelope({ code, message: 'm', status: 400 });
      expect(mirrorError.name).toBe(realError.name);
      expect(mirrorError.family).toBe(realError.family);
      expect(mirrorError.code).toBe(realError.code);
    }
  });

  it('the retry policy matches the SDK\'s (rate-limit + unavailable only)', () => {
    for (const code of API_ERROR_CODES) {
      const mirrorError = new ApiConsoleError(code, 'm', 500);
      const realError = new realSdk.ApiSdkError(code, 'm', 500);
      expect(isRetryable(mirrorError)).toBe(realSdk.isRetryable(realError));
    }
  });

  it('unknown codes surface as unavailable (never swallowed), exactly like the SDK', () => {
    expect(errorFromEnvelope({ code: 'brand_new_code', message: 'm' }).family).toBe(realSdk.errorFromEnvelope({ code: 'brand_new_code', message: 'm' }).family);
  });
});

describe('trip-wire: the pagination envelope + the version constants match the REAL SDK', () => {
  it('Page<T> is { items, nextCursor? } — the SDK\'s own envelope', () => {
    const page: Page<number> = { items: [1, 2] };
    expect(realPageSatisfiesMirror<number>(page)).toBe(page);
    expect(hasNext(page)).toBe(false);
    expect(cursorOf(page)).toBeNull();
    expect(countOf(page)).toBe(2);
    const next: Page<number> = { items: [3], nextCursor: 'cur-2' };
    expect(hasNext(next)).toBe(true);
    expect(cursorOf(next)).toBe('cur-2');
  });

  it('the version + page-size + replay-header constants match the REAL SDK', () => {
    expect(CURRENT_API_VERSION).toBe(realSdk.CURRENT_API_VERSION);
    expect(CURRENT_API_VERSION).toBe('v1');
    expect(MAX_PAGE_SIZE).toBe(realSdk.MAX_PAGE_SIZE);
    expect(MAX_PAGE_SIZE).toBe(100);
    expect(IDEMPOTENT_REPLAY_HEADER).toBe(realSdk.IDEMPOTENT_REPLAY_HEADER);
    expect(IDEMPOTENT_REPLAY_HEADER).toBe('x-idempotent-replay');
  });
});

describe('trip-wire: the idempotency derivation matches the REAL SDK\'s', () => {
  it('the key grammar is idem: + 8-hex (both sides)', () => {
    expect(IDEMPOTENCY_KEY_PATTERN.source).toBe(realSdk.IDEMPOTENCY_KEY_PATTERN.source);
    expect(String(IDEMPOTENCY_KEY_PATTERN)).toBe('/^idem:[0-9a-f]{8}$/');
  });

  it('identical parts -> identical key, AND the SAME key the REAL SDK derives (L9, one law everywhere)', () => {
    const parts = { operation: 'projects.create', body: { id: 'prj-1', name: 'X', at: T0 } };
    const mirrorKey = deriveIdempotencyKey(parts);
    expect(mirrorKey).toBe(deriveIdempotencyKey(parts)); // deterministic
    expect(mirrorKey).toBe(realSdk.deriveIdempotencyKey(parts)); // == the SDK's derivation
    expect(deriveIdempotencyKey([parts])).toBe(realSdk.deriveIdempotencyKey([parts]));
    expect(deriveIdempotencyKey('simple')).toBe(realSdk.deriveIdempotencyKey('simple'));
  });

  it('different parts -> different keys; the wire-header law is shared', () => {
    expect(deriveIdempotencyKey({ a: 1 })).not.toBe(deriveIdempotencyKey({ a: 2 }));
    expect(isValidIdempotencyKey('idem:811c9dc5')).toBe(true);
    expect(isValidIdempotencyKey('')).toBe(false);
    expect(isValidIdempotencyKey('x'.repeat(257))).toBe(false);
  });
});

describe('trip-wire: the transport wire shapes match the REAL SDK\'s', () => {
  it('the request/response/transport witnesses hold (type-level, plus runtime parity of the guard)', () => {
    const request: SdkRequest = { method: 'GET', path: '/v1/meta', headers: {} };
    expect(realRequestSatisfiesMirror(request)).toBe(request);
    const response: SdkResponse = { status: 200, headers: {}, body: null };
    expect(realResponseSatisfiesMirror(response)).toBe(response);
    const transport: ApiTransport = async () => response;
    expect(typeof realTransportSatisfiesMirror(transport)).toBe('function');
  });
});

describe('trip-wire: the client method surface + route table (literal)', () => {
  it("exposes exactly the SDK resource families and methods", () => {
    const client = createConsoleClient({ transport: async () => ({ status: 200, headers: {}, body: { data: {} } }), token: 't' });
    expect(Object.keys(client).sort()).toEqual(['execution', 'jobs', 'knowledge', 'meta', 'negotiateVersion', 'organizations', 'outcomes', 'projects', 'risk']);
    // THE W-23 AMENDMENT (documented drift, not silent): the projects
    // family carries ONE method the frozen SDK does not — `goal`, the
    // HOST-OWNED goal read (GET /v1/projects/:projectId/goal, the W-8
    // demo-substance route served from the deployed backing BEFORE the
    // boundary wrap; the route exists nowhere in the frozen route
    // table, so the SDK has no mirror of it). The console's goal-boot
    // read (D-1: the goal/constraint-set fetch at boot + on every
    // scope-change refetch) needs it; every other member stays
    // SDK-identical.
    expect(Object.keys(client.projects).sort()).toEqual(['bindOrganization', 'create', 'get', 'goal', 'list', 'listAll', 'transition']);
    // THE W-25A AMENDMENT (documented drift, not silent): the jobs
    // family carries ONE method the frozen SDK does not — `list`, the
    // HOST-OWNED jobs-list read (GET /v1/jobs?project=<id>, the W-25A
    // demo-substance route served from the deployed backing BEFORE the
    // boundary wrap — the backing's API-owned job store, the same store
    // the per-id GET reads; the route exists nowhere in the frozen route
    // table, so the SDK has no mirror of it). The console's jobs boot
    // read (D-3: the list fetch that refills state.jobs after every
    // reload/scope-switch) needs it; every other member stays
    // SDK-identical.
    // THE FW-32-A AMENDMENTS (documented drift, not silent): (1) the jobs
    // family gains `promote` — the HOST-OWNED consequential promotion
    // route (POST /v1/jobs/:jobId/promote — a completed research job's
    // release-candidate deliverable promoted as a decision citing the
    // job's evidence; idempotent per job; the route exists nowhere in
    // the frozen route table, so the SDK has no mirror of it); (2) the
    // NEW `risk` family carries `utilization` — the HOST-OWNED standing
    // risk-utilization read (GET /v1/risk/utilization?project=<id>, the
    // FW-31-A route — per-bound standing utilization + the active-breach
    // aggregation; likewise absent from the frozen route table). Every
    // other member stays SDK-identical.
    expect(Object.keys(client.jobs).sort()).toEqual(['get', 'list', 'promote', 'submitLearning', 'submitResearch']);
    expect(Object.keys(client.knowledge)).toEqual(['query']);
    expect(Object.keys(client.outcomes).sort()).toEqual(['postMortems', 'query']);
    // THE W-22 AMENDMENT (documented drift, not silent): the execution
    // family carries ONE method the frozen SDK does not — `submissions`,
    // the HOST-OWNED blotter read (GET /v1/execution/submissions, the
    // W-8 demo-substance route served from the deployed backing BEFORE
    // the boundary wrap; the route exists nowhere in the frozen route
    // table, so the SDK has no mirror of it). The console's blotter
    // read needs it; every other family stays member-identical.
    expect(Object.keys(client.execution).sort()).toEqual(['submissions', 'submitRequest']);
    expect(Object.keys(client.organizations)).toEqual(['status']);
    // THE FW-31-A/FW-32-A AMENDMENT (documented drift, not silent): the
    // risk family is console-only — `utilization`, the HOST-OWNED
    // standing risk-utilization read (see the jobs amendment above).
    expect(Object.keys(client.risk)).toEqual(['utilization']);
  });
});

// ---------------------------------------------------------------------------
// TRANSPORT INJECTABILITY — a scripted fake transport drives the client
// ---------------------------------------------------------------------------

/** A scripted transport: records every request, answers from a route table. */
function scriptedTransport(
  routes: Readonly<Record<string, (request: SdkRequest) => SdkResponse>>,
): { readonly transport: ApiTransport; readonly requests: SdkRequest[] } {
  const requests: SdkRequest[] = [];
  const transport: ApiTransport = async (request) => {
    requests.push(request);
    const answer = routes[`${request.method} ${request.path.split('?')[0]}`];
    if (answer === undefined) return { status: 404, headers: {}, body: { requestId: 'req-1', error: { code: 'not_found', message: 'no route', status: 404 } } };
    return answer(request);
  };
  return { transport, requests };
}

function ok(data: unknown): SdkResponse {
  return { status: 200, headers: {}, body: { requestId: 'req-1', data } };
}

describe('client: the injected transport drives every request (negotiation, envelope, headers)', () => {
  it('the FIRST request negotiates GET /v1/meta with the bearer token, then the real call', async () => {
    const { transport, requests } = scriptedTransport({
      'GET /v1/meta': () => ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] }),
      'GET /v1/projects/prj-1': () => ok({ id: 'prj-1', tenantId: 'tenant-a' }),
    });
    const client = createConsoleClient({ transport, token: 'tok-1' });
    const project = await client.projects.get('prj-1');
    expect(project).toEqual({ id: 'prj-1', tenantId: 'tenant-a' });
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual(['GET /v1/meta', 'GET /v1/projects/prj-1']);
    expect(requests.every((request) => request.headers.authorization === 'Bearer tok-1')).toBe(true);
    // negotiation is once-per-client (a third call issues no second meta)
    await client.projects.get('prj-1');
    expect(requests).toHaveLength(3);
  });

  it('a version the boundary no longer serves is the typed VersionMismatchError (the init law)', async () => {
    const { transport } = scriptedTransport({
      'GET /v1/meta': () => ok({ apiVersion: 'v1', supportedVersions: ['v2'], routeFamilies: [] }),
    });
    const client = createConsoleClient({ transport, token: 'tok-1' });
    await expect(client.negotiateVersion()).rejects.toMatchObject({ name: 'VersionMismatchError', code: 'unsupported_version' });
  });

  it('consequential calls carry the idempotency-key header (caller-provided or derived)', async () => {
    const seenKeys: string[] = [];
    const { transport, requests } = scriptedTransport({
      'GET /v1/meta': () => ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] }),
      'POST /v1/jobs/research': (request) => {
        seenKeys.push(request.headers['idempotency-key'] as string);
        return ok({ jobId: 'job-1', kind: 'research', tenant: 'tenant-a', project: 'p', status: 'submitted', submittedAt: T0 });
      },
    });
    const client = createConsoleClient({ transport, token: 'tok-1' });
    await client.jobs.submitResearch({ projectId: 'p', spec: { a: 1 } });
    await client.jobs.submitResearch({ projectId: 'p', spec: { a: 1 } }); // same body -> same derived key
    await client.jobs.submitResearch({ projectId: 'p', spec: { a: 1 } }, { idempotencyKey: 'idem:811c9dc5' });
    expect(seenKeys[0]).toMatch(IDEMPOTENCY_KEY_PATTERN);
    expect(seenKeys[1]).toBe(seenKeys[0]); // deterministic derivation
    expect(seenKeys[2]).toBe('idem:811c9dc5'); // the caller's key wins
    expect(requests.find((request) => request.path === '/v1/jobs/research')?.method).toBe('POST');
  });

  it('reads carry NO idempotency header; pagination params ride the query string', async () => {
    const { transport, requests } = scriptedTransport({
      'GET /v1/meta': () => ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] }),
      'GET /v1/projects': () => ok({ items: [] }),
    });
    const client = createConsoleClient({ transport, token: 'tok-1' });
    await client.projects.list({ cursor: 'cur-1', limit: 50 });
    const list = requests.find((request) => request.path.includes('/v1/projects?'));
    expect(list?.path).toBe('/v1/projects?cursor=cur-1&limit=50');
    expect(list?.headers['idempotency-key']).toBeUndefined();
  });

  it('the jobs.list read (the W-25A jobs boot seam): GET /v1/jobs?project=<id>, bearer + no idempotency header, the envelope unwraps to the Page<JobRecord> listing', async () => {
    const { transport, requests } = scriptedTransport({
      'GET /v1/meta': () => ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] }),
      'GET /v1/jobs': () => ok({ items: [
        { jobId: 'job:1a2b3c4d', kind: 'research', tenant: 'tenant-a', project: 'prj-1', status: 'submitted', submittedAt: T0 },
      ] }),
    });
    const client = createConsoleClient({ transport, token: 'tok-1' });
    const page = await client.jobs.list('prj-1');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.jobId).toBe('job:1a2b3c4d');
    const list = requests.find((request) => request.path === '/v1/jobs?project=prj-1');
    if (list === undefined) throw new Error('the jobs list read never rode the wire');
    expect(list.method).toBe('GET');
    expect(list.headers.authorization).toBe('Bearer tok-1');
    expect(list.headers['idempotency-key']).toBeUndefined(); // a read carries no idempotency header
  });

  it('the projects.goal read (the W-23 goal-boot seam): GET /v1/projects/:id/goal?project=:id, bearer + no idempotency header, the envelope unwraps to the { goal, constraintSet } bundle', async () => {
    // The wire shape pinned here is the LIVE production origin's own
    // (GET /v1/projects/prj-demo-console/goal serves `{ data: { goal:
    // GoalStatement, constraintSet: ConstraintSetStatement } }` — the
    // D-1 verification); the contract types need no field mapping.
    const { transport, requests } = scriptedTransport({
      'GET /v1/meta': () => ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] }),
      'GET /v1/projects/prj-1/goal': () => ok({ goal: { id: 'goal-1', tenantId: 'tenant-a' }, constraintSet: { id: 'cs-1', tenantId: 'tenant-a' } }),
    });
    const client = createConsoleClient({ transport, token: 'tok-1' });
    const bundle = await client.projects.goal('prj-1');
    expect(bundle.goal.id).toBe('goal-1');
    expect(bundle.constraintSet.id).toBe('cs-1');
    const goal = requests.find((request) => request.path.includes('/goal'));
    expect(goal?.method).toBe('GET');
    expect(goal?.path).toBe('/v1/projects/prj-1/goal?project=prj-1'); // the project-scoped query rides the path (the demo-substance routes' own law)
    expect(goal?.headers.authorization).toBe('Bearer tok-1');
    expect(goal?.headers['idempotency-key']).toBeUndefined(); // a read, never a consequential call
  });

  it('the projects.goal read surfaces the typed 404 (the host-owned route answers not_found for every project without a seeded goal — the caller degrades honestly on it)', async () => {
    const { transport } = scriptedTransport({
      'GET /v1/meta': () => ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] }),
      'GET /v1/projects/prj-launched/goal': () => ({ status: 404, headers: {}, body: { requestId: 'req-g', error: { code: 'not_found', message: 'no seeded goal statement exists for "prj-launched" at this host', status: 404 } } }),
    });
    const client = createConsoleClient({ transport, token: 'tok-1' });
    await expect(client.projects.goal('prj-launched')).rejects.toMatchObject({ name: 'NotFoundError', code: 'not_found', status: 404 });
  });

  it('the error envelope translates to the typed hierarchy (the boundary\'s own codes)', async () => {
    const { transport } = scriptedTransport({
      'GET /v1/meta': () => ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] }),
      'GET /v1/projects/missing': () => ({ status: 404, headers: {}, body: { requestId: 'req-9', error: { code: 'not_found', message: 'no such project', status: 404 } } }),
      'POST /v1/execution/requests': () => ({ status: 403, headers: {}, body: { requestId: 'req-8', error: { code: 'cross_tenant_access', message: 'L12', status: 403 } } }),
    });
    const client = createConsoleClient({ transport, token: 'tok-1' });
    await expect(client.projects.get('missing')).rejects.toMatchObject({ name: 'NotFoundError', code: 'not_found', requestId: 'req-9' });
    await expect(client.execution.submitRequest({ intentId: 'i' } as never)).rejects.toMatchObject({ name: 'TenantIsolationError', code: 'cross_tenant_access' });
  });

  it('the retry loop: the unavailable family retries up to maxAttempts, then surfaces (never infinite)', async () => {
    let calls = 0;
    const transport: ApiTransport = async (request) => {
      if (request.path === '/v1/meta') return ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] });
      calls += 1;
      return { status: 503, headers: {}, body: { requestId: 'r', error: { code: 'unavailable', message: 'down', status: 503 } } };
    };
    const client = createConsoleClient({ transport, token: 'tok-1', retry: { maxAttempts: 3 } });
    await expect(client.projects.get('p1')).rejects.toMatchObject({ name: 'UnavailableError' });
    expect(calls).toBe(3);
  });

  it('a thrown transport is the unavailable family as the BASE class (parity: the SDK also throws its base ApiSdkError)', async () => {
    const transport: ApiTransport = async () => {
      throw new Error('network gone');
    };
    const client = createConsoleClient({ transport, token: 'tok-1', skipNegotiation: true });
    await expect(client.meta()).rejects.toMatchObject({ name: 'ApiConsoleError', code: 'unavailable', family: 'unavailable', status: 503 });
  });

  it('collectAll walks cursors to the end and the max-pages guard stops a looping boundary', async () => {
    let page = 0;
    const pages: Page<number>[] = [
      { items: [1, 2], nextCursor: 'c2' },
      { items: [3], nextCursor: 'c3' },
      { items: [4], nextCursor: undefined },
    ];
    const walked = await collectAll(async (cursor) => {
      expect(cursor === undefined || typeof cursor === 'string').toBe(true);
      return pages[page++] as Page<number>;
    });
    expect(walked).toEqual([1, 2, 3, 4]);

    let loops = 0;
    await expect(
      collectAll(async () => {
        loops += 1;
        return { items: [loops], nextCursor: `loop-${loops}` };
      }, { maxPages: 5 }),
    ).rejects.toThrow(/max-pages guard/);
    expect(loops).toBe(5);
  });

  it('isIdempotentReplay reads the shared header name', () => {
    expect(isIdempotentReplay({ headers: { [IDEMPOTENT_REPLAY_HEADER]: 'true' } })).toBe(true);
    expect(isIdempotentReplay({ headers: {} })).toBe(false);
    expect(isIdempotentReplay({ headers: { 'x-idempotent-replay': 'false' } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE REAL SERVICE driven through the CONSOLE'S mirrored client
// ---------------------------------------------------------------------------

/** Percent-decode + split the mirrored client's `path?query` (what a host does before routing). */
function splitQuery(path: string): { readonly path: string; readonly query?: Record<string, string> } {
  const questionAt = path.indexOf('?');
  if (questionAt === -1) return { path: path.split('/').map((segment) => decodeURIComponent(segment)).join('/') };
  const query: Record<string, string> = {};
  for (const pair of path.slice(questionAt + 1).split('&')) {
    if (pair.length === 0) continue;
    const equalsAt = pair.indexOf('=');
    const key = decodeURIComponent(equalsAt === -1 ? pair : pair.slice(0, equalsAt));
    query[key] = decodeURIComponent(equalsAt === -1 ? '' : pair.slice(equalsAt + 1));
  }
  return { path: path.slice(0, questionAt).split('/').map((segment) => decodeURIComponent(segment)).join('/'), query };
}

/** Bind the REAL fixture service to the mirror's injected-transport interface. */
function serviceTransport(handle: (request: ApiRequest) => ApiResponse): ApiTransport {
  return async (request) => {
    const { path, query } = splitQuery(request.path);
    const headers: Record<string, string> = {};
    if (request.headers.authorization !== undefined) headers.authorization = request.headers.authorization;
    if (request.headers['idempotency-key'] !== undefined) headers['idempotency-key'] = request.headers['idempotency-key'];
    const response = handle({ method: request.method, path, headers, ...(query === undefined ? {} : { query }), ...(request.body === undefined ? {} : { body: request.body }) });
    return { status: response.status, headers: { ...response.headers } as Record<string, string>, body: response.body };
  };
}

function consoleClientOverRealService(token: string, share?: { readonly handle: (request: ApiRequest) => ApiResponse }): { readonly client: ConsoleClient; readonly requests: SdkRequest[]; readonly service: { readonly handle: (request: ApiRequest) => ApiResponse } } {
  const { service } = share === undefined ? fixtureService() : { service: { handle: share.handle } };
  const requests: SdkRequest[] = [];
  const transport: ApiTransport = async (request) => {
    requests.push(request);
    return serviceTransport(service.handle)(request);
  };
  return { client: createConsoleClient({ transport, token }), requests, service: { handle: service.handle } };
}

describe('the REAL fixture service driven through the CONSOLE\'S mirrored client', () => {
  it('meta + version negotiation over the REAL pipeline', async () => {
    const { client } = consoleClientOverRealService(TOKEN_A);
    const meta = await client.negotiateVersion();
    expect(meta.apiVersion).toBe('v1');
    expect(meta.supportedVersions).toContain('v1');
    expect(realMetaSatisfiesMirror(meta)).toBe(meta); // the witness: the served shape IS the mirror's
  });

  it('the projects family: create -> get -> list -> bindOrganization (the REAL control-plane shapes)', async () => {
    const { client } = consoleClientOverRealService(TOKEN_A);
    const created = await client.projects.create(validCreateProjectRequest(TENANT_A, 'prj_console_interop') as never);
    expect(created.id).toBe('prj_console_interop');
    expect(created.tenantId).toBe(TENANT_A);
    const witnessed: ProjectRecord = realProjectSatisfiesMirror(created as never);

    const read = await client.projects.get('prj_console_interop');
    expect(read.tenantId).toBe(TENANT_A);

    const bound = await client.projects.bindOrganization('prj_console_interop', 'org:console-interop', T0 + 10);
    expect(bound.lifecycle.organizationRef).toBe('org:console-interop');

    const listed = await client.projects.list({ limit: 10 });
    expect(listed.items.some((project) => project.id === 'prj_console_interop')).toBe(true);
    expect(realPageSatisfiesMirror(listed)).toBe(listed);
    expect(witnessed.id).toBe('prj_console_interop');
  });

  it('the async job pattern over the REAL service: submit -> read (the watch surface\'s served shape)', async () => {
    const { client } = consoleClientOverRealService(TOKEN_A);
    const submitted = await client.jobs.submitResearch({ projectId: 'prj_console_interop', spec: { question: 'does momentum persist?' } });
    expect(['submitted', 'running', 'complete']).toContain(submitted.status);
    const read = await client.jobs.get(submitted.jobId);
    expect(read.jobId).toBe(submitted.jobId);
    const witnessed: JobRecord = realJobSatisfiesMirror(read);
    expect(witnessed.kind).toBe('research');
  });

  it('the knowledge read: point-in-time query over the REAL firm-memory port', async () => {
    const { client } = consoleClientOverRealService(TOKEN_A);
    const knowledge = await client.knowledge.query({ project: PROJECT_A, at: T0 + 1000, activeOnly: true });
    expect(knowledge.items.length).toBeGreaterThan(0);
    expect(knowledge.items[0]?.record.tenant).toBe(TENANT_A);
  });

  it('the org-status watch read: the REAL served snapshot IS the mirror\'s OrgStatusSnapshot (written through the private plane)', async () => {
    const { client, service } = consoleClientOverRealService(TOKEN_A);
    // the agent-runtime writes the snapshot through the private plane (the internal credential is fixture-side here)
    service.handle({
      method: 'POST',
      path: '/internal/organizations/status',
      headers: { authorization: `Bearer ${TOKEN_INTERNAL_RUNTIME}` },
      body: { snapshot: { organizationRef: 'org:console-watch', tenant: TENANT_A, project: 'prj_console_watch', status: 'active', at: T0 + 500, instanceRefs: ['ai:1', 'ai:2'] } },
    } as never);
    const snapshot = await client.organizations.status('org:console-watch', 'prj_console_watch');
    expect(snapshot.status).toBe('active');
    expect(snapshot.instanceRefs).toEqual(['ai:1', 'ai:2']);
    const witnessed: OrgStatusSnapshot = realSnapshotSatisfiesMirror(snapshot);
    expect(witnessed.project).toBe('prj_console_watch');
  });

  it('the L8 execution route over the REAL gateway: a routed intent renders routed (the console REQUESTS; the gateway decides)', async () => {
    const { client } = consoleClientOverRealService(TOKEN_A);
    const submission = await client.execution.submitRequest(validStrategyIntent(TENANT_A, 'int-console-1') as never);
    expect(submission.kind).toBe('routed');
    const witnessed: GatewaySubmissionRecord = realSubmissionSatisfiesMirror(submission);
    expect(witnessed.submissionId.length).toBeGreaterThan(0);
  });

  it('the REAL cross-tenant refusal translates to the typed TenantIsolationError through the MIRROR (L12 at the boundary)', async () => {
    // tenant-alpha's credential forwards an intent declaring tenant-beta's scope -> the boundary refuses, typed
    const { client } = consoleClientOverRealService(TOKEN_A);
    const foreign = validStrategyIntent(TENANT_B, 'prj_console_foreign');
    await expect(client.execution.submitRequest(foreign as never)).rejects.toMatchObject({
      name: 'TenantIsolationError',
      code: 'cross_tenant_access',
    });
  });

  it('the REAL auth rejection translates to the typed AuthenticationError through the MIRROR', async () => {
    const { client } = consoleClientOverRealService('tok-not-a-credential');
    await expect(client.negotiateVersion()).rejects.toMatchObject({ name: 'AuthenticationError', code: 'unauthenticated' });
  });

  it('idempotent replay over the REAL service: the same derived key replays the ORIGINAL result', async () => {
    const { client, requests } = consoleClientOverRealService(TOKEN_A);
    const intent = validStrategyIntent(TENANT_A, 'int-console-replay');
    const first = await client.execution.submitRequest(intent as never);
    const second = await client.execution.submitRequest(intent as never); // same body -> same derived key
    expect(second).toEqual(first); // the ORIGINAL result replayed, not a second execution
    const keys = requests.filter((request) => request.path === '/v1/execution/requests').map((request) => request.headers['idempotency-key']);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[0]).toMatch(IDEMPOTENCY_KEY_PATTERN);
  });
});
