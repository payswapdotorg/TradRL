/**
 * @tradrl/sdk — the client tests over a scripted fake transport (the
 * in-test implementation of the INJECTED interface; the SDK ships
 * none — that is the zero-dep law being tested as much as the
 * client).
 *
 * Covers: the auth-header injection; the version negotiation on init
 * (success + the typed VersionMismatchError on mismatch); every
 * resource family's happy path against scripted envelopes; the
 * idempotency-key auto-derivation on consequential calls; the
 * envelope parsing (request ids, error translation).
 */

import { describe, expect, it } from 'vitest';

import { createTradRLClient } from './client';
import type { SdkRequest, SdkResponse } from './transport';
import { ApiSdkError, VersionMismatchError } from './errors';

// ---------------------------------------------------------------------------
// The scripted fake transport
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

function scriptedTransport(script: (request: SdkRequest) => SdkResponse | { readonly __throw: Error }): { transport: (request: SdkRequest) => Promise<SdkResponse>; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    transport: async (request) => {
      calls.push({ method: request.method, path: request.path, headers: { ...request.headers }, body: request.body });
      const outcome = script(request);
      if ('__throw' in outcome) throw outcome.__throw;
      return outcome;
    },
  };
}

function success<T>(data: T, status = 200, headers: Record<string, string> = {}): SdkResponse {
  return { status, headers: { 'x-request-id': 'req:00000001', ...headers }, body: { requestId: 'req:00000001', data } };
}

function failure(code: string, message: string, status: number, extra: Record<string, unknown> = {}): SdkResponse {
  return { status, headers: { 'x-request-id': 'req:00000001' }, body: { requestId: 'req:00000001', error: { code, message, status, ...extra } } };
}

const META = { apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: ['projects:read', 'projects:write'] };
const PROJECT = {
  id: 'prj_1',
  tenantId: 'tenant_acme',
  name: 'Alpha',
  executionMode: 'simulation',
  lifecycle: { projectId: 'prj_1', status: 'draft', acceptanceCriteriaId: 'ac:0123abcd', organizationRef: null },
  lineage: { projectId: 'prj_1', goal: { goalId: 'goal_1', version: 1 }, constraintSet: { id: 'cs_1', version: 1 } },
  createdAt: 1, updatedAt: 1,
};

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

describe('the auth-header injection', () => {
  it('every request carries the Bearer token', async () => {
    const { transport, calls } = scriptedTransport(() => success(META));
    const client = createTradRLClient({ transport, token: 'tok-test-1' });
    await client.meta();
    expect(calls[0]!.headers.authorization).toBe('Bearer tok-test-1');
  });
});

describe('the version negotiation on init', () => {
  it('the first request negotiates via GET /v1/meta and proceeds when the version is served', async () => {
    const { transport, calls } = scriptedTransport((request) => (request.path === '/v1/meta' ? success(META) : success(PROJECT)));
    const client = createTradRLClient({ transport, token: 'tok' });
    const project = await client.projects.get('prj_1');
    expect(project.id).toBe('prj_1');
    // The negotiation call happened first.
    expect(calls[0]!.path).toBe('/v1/meta');
    expect(calls[1]!.path).toBe('/v1/projects/prj_1');
  });

  it('a service that does not serve the client\'s version throws the typed VersionMismatchError on init', async () => {
    const { transport } = scriptedTransport(() => success({ apiVersion: 'v2', supportedVersions: ['v2'], routeFamilies: [] }));
    const client = createTradRLClient({ transport, token: 'tok' });
    await expect(client.meta()).rejects.toBeInstanceOf(VersionMismatchError);
    await expect(client.projects.get('prj_1')).rejects.toMatchObject({ family: 'version' });
  });

  it('negotiateVersion() forces the negotiation explicitly', async () => {
    const { transport, calls } = scriptedTransport(() => success(META));
    const client = createTradRLClient({ transport, token: 'tok' });
    const meta = await client.negotiateVersion();
    expect(meta.apiVersion).toBe('v1');
    expect(calls.length).toBe(1);
  });

  it('skipNegotiation skips the init call (pinned-endpoint deployments)', async () => {
    const { transport, calls } = scriptedTransport(() => success(PROJECT));
    const client = createTradRLClient({ transport, token: 'tok', skipNegotiation: true });
    await client.projects.get('prj_1');
    expect(calls.length).toBe(1);
    expect(calls[0]!.path).toBe('/v1/projects/prj_1');
  });
});

describe('the resource surface (same names, same shapes as the routes)', () => {
  it('projects.create POSTs the body and derives the idempotency key', async () => {
    const { transport, calls } = scriptedTransport((request) => (request.path === '/v1/meta' ? success(META) : success(PROJECT, 201)));
    const client = createTradRLClient({ transport, token: 'tok' });
    const goal = { id: 'goal_1', version: 1, tenantId: 'tenant_acme', objective: 'x', horizon: { startsAt: 1, endsAt: 2 }, successCriteria: { criteria: [{ id: 'c', metric: 'm', predicate: { kind: 'limit.max' as const, bound: 1 } }], requiredSatisfaction: 1 }, evaluation: { blindRef: 'b', walkForwardRef: 'w', regimeRef: 'r', adversarialRequired: true }, createdAt: 1 } as never;
    const created = await client.projects.create({ id: 'prj_1', name: 'Alpha', executionMode: 'simulation', goal, constraintSet: { id: 'cs_1', version: 1, tenantId: 'tenant_acme', constraints: [], createdAt: 1 }, at: 1 });
    expect(created.id).toBe('prj_1');
    const call = calls[calls.length - 1]!;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/v1/projects');
    expect(call.headers['idempotency-key']).toMatch(/^idem:[0-9a-f]{8}$/);
    expect((call.body as { id: string }).id).toBe('prj_1');
  });

  it('projects.list builds the query string and serves the page', async () => {
    const { transport, calls } = scriptedTransport((request) => (request.path === '/v1/meta' ? success(META) : success({ items: [PROJECT], nextCursor: 'cur:0123abcd' })));
    const client = createTradRLClient({ transport, token: 'tok' });
    const page = await client.projects.list({ limit: 50 });
    expect(page.items.length).toBe(1);
    expect(page.nextCursor).toBe('cur:0123abcd');
    expect(calls[calls.length - 1]!.path).toBe('/v1/projects?limit=50');
  });

  it('projects.transition and bindOrganization POST their routes', async () => {
    const { transport, calls } = scriptedTransport((request) => (request.path === '/v1/meta' ? success(META) : request.path.endsWith('/lifecycle') ? success({ record: PROJECT, effects: [] }) : success(PROJECT)));
    const client = createTradRLClient({ transport, token: 'tok' });
    const transitioned = await client.projects.transition('prj_1', 'activate', 5);
    expect(transitioned.record.id).toBe('prj_1');
    expect(calls[calls.length - 1]!.path).toBe('/v1/projects/prj_1/lifecycle');
    expect((calls[calls.length - 1]!.body as { event: string }).event).toBe('activate');

    await client.projects.bindOrganization('prj_1', 'org:1', 6);
    expect(calls[calls.length - 1]!.path).toBe('/v1/projects/prj_1/organization');
  });

  it('knowledge.query, outcomes.query and outcomes.postMortems POST their bodies', async () => {
    const { transport, calls } = scriptedTransport((request) => {
      if (request.path === '/v1/meta') return success(META);
      if (request.path === '/v1/knowledge/query') return success({ at: 7, items: [], nextCursor: undefined });
      if (request.path === '/v1/outcomes/query') return success({ items: [{ outcomeId: 'out:1', ordinal: 1, tenant: 't', project: 'p', outcomeClass: 'as_expected', asOf: 1 }] });
      return success({ items: [{ postMortemId: 'pmr:1', ordinal: 1, asOf: 2 }] });
    });
    const client = createTradRLClient({ transport, token: 'tok' });
    const knowledge = await client.knowledge.query({ project: 'p', at: 7 });
    expect(knowledge.at).toBe(7);
    const outcomes = await client.outcomes.query({ project: 'p', at: 7 });
    expect(outcomes.items[0]!.outcomeId).toBe('out:1');
    const postMortems = await client.outcomes.postMortems({ project: 'p', at: 7 });
    expect(postMortems.items[0]!.postMortemId).toBe('pmr:1');
    expect(calls.map((call) => call.path)).toContain('/v1/knowledge/query');
    expect(calls.map((call) => call.path)).toContain('/v1/outcomes/query');
    expect(calls.map((call) => call.path)).toContain('/v1/post-mortems/query');
  });

  it('jobs.submitResearch / submitLearning / get drive the async pattern', async () => {
    const job = { jobId: 'job:0123abcd', kind: 'research', tenant: 't', project: 'p', status: 'submitted', submittedAt: 1 };
    const { transport, calls } = scriptedTransport((request) => (request.path === '/v1/meta' ? success(META) : success(job, 202)));
    const client = createTradRLClient({ transport, token: 'tok' });
    const submitted = await client.jobs.submitResearch({ projectId: 'p', spec: { q: 'lag' } });
    expect(submitted.status).toBe('submitted');
    expect(calls[calls.length - 1]!.path).toBe('/v1/jobs/research');
    expect(calls[calls.length - 1]!.headers['idempotency-key']).toMatch(/^idem:[0-9a-f]{8}$/);
    expect((calls[calls.length - 1]!.body as { kind: string }).kind).toBe('research');

    await client.jobs.submitLearning({ projectId: 'p', spec: {} });
    expect(calls[calls.length - 1]!.path).toBe('/v1/jobs/learning');

    await client.jobs.get('job:0123abcd');
    expect(calls[calls.length - 1]!.path).toBe('/v1/jobs/job%3A0123abcd');
  });

  it('execution.submitRequest forwards { intent } with the key', async () => {
    const routed = { kind: 'routed', submissionId: 'xgs:1', decisionId: 'xd:1', auditId: 'xga:1', requestRef: 'gor:1', venue: 'v', adapterRef: 'a', channelRef: 'c', routedAt: 1 };
    const { transport, calls } = scriptedTransport((request) => (request.path === '/v1/meta' ? success(META) : success(routed)));
    const client = createTradRLClient({ transport, token: 'tok' });
    const intent = {
      intentId: 'si:1', sequence: 1, order: { clientOrderId: 'o', instrumentId: 'i', venueId: 'v', side: 'buy', kind: 'limit', quantity: '1', price: '2', timeInForce: 'gtc', createdAt: '2024-01-01T00:00:00Z' },
      constraintProof: {}, goal: { goalId: 'g', version: 1 }, strategy: { specId: 's', version: 1 }, windowRefs: ['w'], seed: 's', tenant: 't', project: 'p', riskPolicyRefs: [], rationale: {}, asOf: 1,
    };
    const submission = await client.execution.submitRequest(intent as never);
    expect(submission.kind).toBe('routed');
    const call = calls[calls.length - 1]!;
    expect(call.path).toBe('/v1/execution/requests');
    expect((call.body as { intent: { intentId: string } }).intent.intentId).toBe('si:1');
    expect(call.headers['idempotency-key']).toMatch(/^idem:[0-9a-f]{8}$/);
  });

  it('organizations.status builds the project query', async () => {
    const snapshot = { organizationRef: 'org:1', tenant: 't', project: 'p', status: 'active', at: 1, instanceRefs: [] };
    const { transport, calls } = scriptedTransport((request) => (request.path === '/v1/meta' ? success(META) : success(snapshot)));
    const client = createTradRLClient({ transport, token: 'tok' });
    const served = await client.organizations.status('org:1', 'p');
    expect(served.status).toBe('active');
    expect(calls[calls.length - 1]!.path).toBe('/v1/organizations/org%3A1/status?project=p');
  });
});

describe('the envelope parsing', () => {
  it('a 2xx without an envelope throws the typed unavailable error', async () => {
    const { transport } = scriptedTransport(() => ({ status: 200, headers: {}, body: null }));
    const client = createTradRLClient({ transport, token: 'tok', skipNegotiation: true });
    await expect(client.meta()).rejects.toMatchObject({ family: 'unavailable' });
  });

  it('a non-2xx with an envelope throws the mapped typed error carrying the request id', async () => {
    const { transport } = scriptedTransport(() => failure('cross_tenant_access', 'foreign scope', 403));
    const client = createTradRLClient({ transport, token: 'tok', skipNegotiation: true });
    const rejection = client.meta();
    await expect(rejection).rejects.toBeInstanceOf(ApiSdkError);
    await expect(rejection).rejects.toMatchObject({ code: 'cross_tenant_access', requestId: 'req:00000001' });
  });

  it('a thrown transport surfaces as the typed unavailable error', async () => {
    const { transport } = scriptedTransport(() => ({ __throw: new Error('ECONNREFUSED') }));
    const client = createTradRLClient({ transport, token: 'tok', skipNegotiation: true, retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1 } });
    await expect(client.meta()).rejects.toMatchObject({ family: 'unavailable', code: 'unavailable' });
  });
});
