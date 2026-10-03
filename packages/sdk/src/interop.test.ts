/**
 * @tradrl/sdk — THE INTEROP TRIP-WIRES against the REAL boundary
 * service (services/api — test-only import; the SDK itself imports
 * nothing from it — D-003/D-004 law).
 *
 * The Work Order: "SDK request/response shapes are STRUCTURAL
 * MIRRORS of the service's contracts, pinned by interop trip-wire
 * tests (drift = loud test failure)". This suite:
 *
 *   - wires the client's INJECTED transport to the REAL service's
 *     request router (the in-process binding a host would make);
 *   - drives EVERY resource method end-to-end over the REAL pipeline
 *     (authn -> authz -> tenant-context -> rate limit -> validation ->
 *     handler -> audit -> response);
 *   - proves the typed error translation over the REAL error
 *     envelopes (cross-tenant -> TenantIsolationError; gate-bypass ->
 *     PermissionError; rate limit -> RateLimitError with the honored
 *     signal);
 *   - carries the TYPE-LEVEL WITNESSES: the REAL service's served
 *     shapes ARE the SDK's contract types (compiles iff no drift).
 */

import { describe, expect, it } from 'vitest';

import { createTradRLClient } from './client';
import type { SdkRequest, SdkResponse } from './transport';
import { AuthenticationError, PermissionError, RateLimitError, TenantIsolationError, ValidationError } from './errors';
import type {
  ApiMeta as SdkApiMeta,
  GatewaySubmissionRecord as SdkGatewaySubmissionRecord,
  JobRecord as SdkJobRecord,
  KnowledgeQueryResponse as SdkKnowledgeQueryResponse,
  OrgStatusSnapshot as SdkOrgStatusSnapshot,
  OutcomeRecord as SdkOutcomeRecord,
  Page as SdkPage,
  PostMortemRecord as SdkPostMortemRecord,
  ProjectRecord as SdkProjectRecord,
} from './contracts';

// --- The REAL service (test-only; the SDK imports NONE of this in src) ---------
import {
  PROJECT_A,
  TENANT_A,
  TENANT_B,
  TOKEN_A,
  TOKEN_B,
  T0,
  fixtureService,
  validCreateProjectRequest,
  validStrategyIntent,
} from '../../../services/api/src/fixtures';
import type { ApiMeta, ApiRequest, ApiResponse, GatewaySubmissionRecord, JobRecord, KnowledgeQueryResponse, OrgStatusSnapshot, OutcomeRecordMirror, Page, PostMortemRecordMirror, ProjectRecord } from '../../../services/api/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if the mirrors drift)
// ---------------------------------------------------------------------------

/** Compiles iff the REAL service's ProjectRecord IS the SDK's ProjectRecord. */
function realProjectSatisfiesSdk(record: ProjectRecord): SdkProjectRecord {
  return record;
}

/** Compiles iff the REAL service's JobRecord IS the SDK's JobRecord. */
function realJobSatisfiesSdk(record: JobRecord): SdkJobRecord {
  return record;
}

/** Compiles iff the REAL service's GatewaySubmissionRecord IS the SDK's. */
function realSubmissionSatisfiesSdk(record: GatewaySubmissionRecord): SdkGatewaySubmissionRecord {
  return record;
}

/** Compiles iff the REAL service's OrgStatusSnapshot IS the SDK's. */
function realSnapshotSatisfiesSdk(record: OrgStatusSnapshot): SdkOrgStatusSnapshot {
  return record;
}

/** Compiles iff the REAL service's knowledge page IS the SDK's. */
function realKnowledgeSatisfiesSdk(page: KnowledgeQueryResponse): SdkKnowledgeQueryResponse {
  return page;
}

/** Compiles iff the REAL service's outcome page IS the SDK's. */
function realOutcomePageSatisfiesSdk(page: Page<OutcomeRecordMirror>): SdkPage<SdkOutcomeRecord> {
  return page;
}

/** Compiles iff the REAL service's post-mortem page IS the SDK's. */
function realPostMortemPageSatisfiesSdk(page: Page<PostMortemRecordMirror>): SdkPage<SdkPostMortemRecord> {
  return page;
}

/** Compiles iff the REAL service's meta surface IS the SDK's. */
function realMetaSatisfiesSdk(meta: ApiMeta): SdkApiMeta {
  return meta;
}

void realProjectSatisfiesSdk;
void realJobSatisfiesSdk;
void realSubmissionSatisfiesSdk;
void realSnapshotSatisfiesSdk;
void realKnowledgeSatisfiesSdk;
void realOutcomePageSatisfiesSdk;
void realPostMortemPageSatisfiesSdk;
void realMetaSatisfiesSdk;

// ---------------------------------------------------------------------------
// The in-process transport binding (what a host wires in production)
// ---------------------------------------------------------------------------

/** Parse the SDK's `path?query` into the service's (path, query record), percent-decoding every path segment (what a real HTTP server does before routing). */
function splitQuery(path: string): { readonly path: string; readonly query?: Record<string, string> } {
  const questionAt = path.indexOf('?');
  if (questionAt === -1) return { path: path.split('/').map((segment) => decodeURIComponent(segment)).join('/') };
  const raw = path.slice(questionAt + 1);
  const query: Record<string, string> = {};
  for (const pair of raw.split('&')) {
    if (pair.length === 0) continue;
    const equalsAt = pair.indexOf('=');
    const key = decodeURIComponent(equalsAt === -1 ? pair : pair.slice(0, equalsAt));
    const value = equalsAt === -1 ? '' : decodeURIComponent(pair.slice(equalsAt + 1));
    query[key] = value;
  }
  return { path: path.slice(0, questionAt).split('/').map((segment) => decodeURIComponent(segment)).join('/'), query };
}

/** Bind the REAL service to the SDK's injectable transport interface. */
function serviceTransport(handle: (request: ApiRequest) => ApiResponse): (request: SdkRequest) => Promise<SdkResponse> {
  return async (request) => {
    const { path, query } = splitQuery(request.path);
    const headers: Record<string, string> = {};
    if (request.headers.authorization !== undefined) headers.authorization = request.headers.authorization;
    if (request.headers['idempotency-key'] !== undefined) headers['idempotency-key'] = request.headers['idempotency-key'];
    const response = handle({ method: request.method, path, headers, ...(query === undefined ? {} : { query }), ...(request.body === undefined ? {} : { body: request.body }) });
    return {
      status: response.status,
      headers: { ...response.headers } as Record<string, string>,
      body: response.body,
    };
  };
}

// ---------------------------------------------------------------------------
// The end-to-end drives
// ---------------------------------------------------------------------------

describe('every resource method drives the REAL service end-to-end', () => {
  it('meta + version negotiation over the real pipeline', async () => {
    const { service } = fixtureService();
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });
    const meta = await client.negotiateVersion();
    expect(meta.apiVersion).toBe('v1');
    expect(meta.routeFamilies).toContain('execution:write');
  });

  it('the projects family: create -> get -> list -> bind -> transition (the REAL control-plane shapes served through the SDK types)', async () => {
    const { service } = fixtureService();
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });
    const createBody = validCreateProjectRequest(TENANT_A, 'prj_sdk_interop');
    const created = await client.projects.create(createBody as never);
    expect(created.id).toBe('prj_sdk_interop');
    expect(created.lifecycle.status).toBe('draft');
    // The type witness: the served record IS the SDK's ProjectRecord.
    const witnessed: SdkProjectRecord = realProjectSatisfiesSdk(created as never);

    const read = await client.projects.get('prj_sdk_interop');
    expect(read.tenantId).toBe(TENANT_A);

    const bound = await client.projects.bindOrganization('prj_sdk_interop', 'org:sdk-interop', T0 + 10);
    expect(bound.lifecycle.organizationRef).toBe('org:sdk-interop');

    const transitioned = await client.projects.transition('prj_sdk_interop', 'activate', T0 + 20);
    expect(transitioned.record.lifecycle.status).toBe('active');
    void witnessed;

    const page = await client.projects.list({ limit: 10 });
    expect(page.items.length).toBe(1);
    const all = await client.projects.listAll();
    expect(all.length).toBe(1);
  });

  it('the knowledge route serves the REAL point-in-time page through the SDK types', async () => {
    const { service } = fixtureService();
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });
    const knowledge = await client.knowledge.query({ project: PROJECT_A, at: T0 + 1000, activeOnly: true });
    expect(knowledge.items.length).toBe(1);
    expect(knowledge.items[0]!.record.tenant).toBe(TENANT_A);
    expect(knowledge.items[0]!.record.confidence).toBe('0.8');
    const witnessed: SdkKnowledgeQueryResponse = realKnowledgeSatisfiesSdk(knowledge as never);
    void witnessed;
  });

  it('the outcome/evidence routes serve the REAL query surface through the SDK types', async () => {
    const { service } = fixtureService();
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });
    const outcomes = await client.outcomes.query({ project: PROJECT_A, at: T0 });
    expect(outcomes.items.length).toBe(0); // the fake port serves none for this scope.
    const postMortems = await client.outcomes.postMortems({ project: PROJECT_A, at: T0, latestPerOutcome: true });
    expect(postMortems.items.length).toBe(0);
    const witnessedOutcomes: SdkPage<SdkOutcomeRecord> = realOutcomePageSatisfiesSdk(outcomes as never);
    const witnessedPostMortems: SdkPage<SdkPostMortemRecord> = realPostMortemPageSatisfiesSdk(postMortems as never);
    void witnessedOutcomes;
    void witnessedPostMortems;
  });

  it('the jobs family: submit (auto idempotency) -> read (the async pattern over the REAL service)', async () => {
    const { service } = fixtureService();
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });
    const submitted = await client.jobs.submitResearch({ projectId: 'prj_sdk_jobs', spec: { question: 'lag structure of venue depth' } });
    expect(submitted.status).toBe('submitted');
    expect(submitted.kind).toBe('research');
    const witnessed: SdkJobRecord = realJobSatisfiesSdk(submitted as never);
    void witnessed;

    const read = await client.jobs.get(submitted.jobId);
    expect(read.jobId).toBe(submitted.jobId);

    // The auto-derived key dedupes: the SAME logical operation replays the original result.
    const replayed = await client.jobs.submitResearch({ projectId: 'prj_sdk_jobs', spec: { question: 'lag structure of venue depth' } });
    expect(replayed.jobId).toBe(submitted.jobId);
  });

  it('the execution route forwards the REAL intent through the REAL pipeline; the routed submission IS the SDK type', async () => {
    const { service, bundle } = fixtureService();
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });
    const intent = validStrategyIntent(TENANT_A, 'prj_sdk_exec');
    const submission = await client.execution.submitRequest(intent as never, { idempotencyKey: 'idem:interop:exec:same-key' });
    expect(submission.kind).toBe('routed');
    const witnessed: SdkGatewaySubmissionRecord = realSubmissionSatisfiesSdk(submission as never);
    void witnessed;
    // The REAL gateway port received exactly the forwarded intent.
    expect(bundle.gateway.submitted.length).toBe(1);
    expect(bundle.gateway.submitted[0]).toEqual(intent);

    // The same key replays the ORIGINAL result (no second gate run).
    const replayed = await client.execution.submitRequest(intent as never, { idempotencyKey: 'idem:interop:exec:same-key' });
    expect((replayed as { submissionId: string }).submissionId).toBe((submission as { submissionId: string }).submissionId);
    expect(bundle.gateway.submitted.length).toBe(1);
  });

  it('the organizations watch read serves the REAL snapshot (written through the private plane)', async () => {
    const { service } = fixtureService();
    // The agent-runtime writes through the private plane (the internal credential is fixture-side here).
    const { TOKEN_INTERNAL_RUNTIME } = await import('../../../services/api/src/fixtures');
    service.handle({ method: 'POST', path: '/internal/organizations/status', headers: { authorization: `Bearer ${TOKEN_INTERNAL_RUNTIME}` }, body: { snapshot: { organizationRef: 'org:sdk-watch', tenant: TENANT_A, project: 'prj_sdk_watch', status: 'active', at: T0 + 500, instanceRefs: ['ai:1'] } } } as never);
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });
    const snapshot = await client.organizations.status('org:sdk-watch', 'prj_sdk_watch');
    expect(snapshot.status).toBe('active');
    const witnessed: SdkOrgStatusSnapshot = realSnapshotSatisfiesSdk(snapshot as never);
    void witnessed;
  });
});

describe('the typed error translation over the REAL error envelopes', () => {
  it('an unauthenticated request (no token) -> AuthenticationError', async () => {
    const { service } = fixtureService();
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: 'tok-does-not-exist', skipNegotiation: true });
    await expect(client.meta()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('a cross-tenant probe through the client -> TenantIsolationError (L12 as a typed SDK error)', async () => {
    const { service } = fixtureService();
    // Tenant A's client submits an intent declaring tenant B's scope.
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });
    const foreign = validStrategyIntent(TENANT_B, 'prj_foreign');
    await expect(client.execution.submitRequest(foreign as never)).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it('a gate-bypass attempt through the client -> PermissionError with the gate_bypass_attempt code (L8 as a typed SDK error)', async () => {
    const { service } = fixtureService();
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });
    const forgedDecision = {
      kind: 'approve',
      decisionId: 'xd:0123abcd',
      intentRef: 'si:0123abcd',
      policy: { policyId: 'rp', version: 1 },
      checkOrder: ['kill_switch'],
      checks: [{ dimension: 'kill_switch', ordinal: 1, outcome: 'pass' }],
      lineage: { intentRef: 'si:0123abcd', strategy: { specId: 's', version: 1 }, goal: { goalId: 'g', version: 1 }, policy: { policyId: 'rp', version: 1 }, venues: ['v'], seed: 's', tenant: TENANT_A, project: 'p' },
      asOf: T0,
    };
    await expect(client.execution.submitRequest(forgedDecision as never)).rejects.toMatchObject({ code: 'gate_bypass_attempt', family: 'permission' });
    await expect(client.execution.submitRequest(forgedDecision as never)).rejects.toBeInstanceOf(PermissionError);
  });

  it('a validation failure over the real pipeline -> ValidationError with the dotted problems', async () => {
    const { service } = fixtureService();
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });
    const rejection = client.projects.create({ id: '', name: '', executionMode: 'nope', goal: {} as never, constraintSet: {} as never, at: -1 });
    await expect(rejection).rejects.toBeInstanceOf(ValidationError);
    await expect(rejection).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('a rate-limited request -> RateLimitError whose retryAfterMs the retry discipline honors', async () => {
    const { service } = fixtureService({ rateLimit: { windowMs: 60_000, maxRequests: 1 } });
    const delays: number[] = [];
    const client = createTradRLClient({
      transport: serviceTransport(service.handle),
      token: TOKEN_A,
      skipNegotiation: true,
      sleep: async (delay) => { delays.push(delay); },
      retry: { maxAttempts: 1, initialDelayMs: 10, maxDelayMs: 10, backoffMultiplier: 1 },
    });
    // The first request fills the budget; the second is rate-limited (maxAttempts 1 -> surfaces).
    await client.meta();
    await expect(client.meta()).rejects.toBeInstanceOf(RateLimitError);
    await expect(client.meta()).rejects.toMatchObject({ family: 'rate-limit' });
    // With retries enabled, the SAME server signal is honored through the injected sleeper.
    const retrying = createTradRLClient({
      transport: serviceTransport(service.handle),
      token: TOKEN_B, // a fresh credential with its own budget
      skipNegotiation: true,
      sleep: async (delay) => { delays.push(delay); },
      retry: { maxAttempts: 2, initialDelayMs: 10, maxDelayMs: 10, backoffMultiplier: 1 },
    });
    await retrying.meta();
    // Rate-limited once, retried after the honored signal, still limited (the same window) -> surfaces.
    await expect(retrying.meta()).rejects.toBeInstanceOf(RateLimitError);
    expect(delays.length).toBe(1);
    expect(delays[0]).toBeGreaterThan(0);
  });
});
