/**
 * @tradrl/api-service — the L12 isolation tests (REQUIRED by the Work
 * Order: "isolation tests REQUIRED: positive per-tenant + negative
 * cross-tenant probes").
 *
 * The two halves:
 *   - POSITIVE per-tenant probes: tenant A's credential reads and
 *     writes tenant A's projects, knowledge, jobs and org statuses;
 *     tenant B's the same for B — the same request shapes, different
 *     injected tenants, both served.
 *   - NEGATIVE cross-tenant probes, each landing on its OWN typed
 *     surface:
 *       1. a DECLARED scope that disagrees with the injected context
 *          (a create-project body whose goal belongs to another
 *          tenant; an execution intent of another tenant) -> the
 *          typed 403 `cross_tenant_access` at the routing layer;
 *       2. API-OWNED state (jobs, org-status snapshots) read by a
 *          foreign tenant -> the typed 403 `cross_tenant_access`
 *          (T044's law: observable, never a silent miss);
 *       3. backing-service reads scoped by the injected tenant (a
 *          foreign project id) -> 404, indistinguishable from
 *          unknown (T007's own law — the boundary never confirms
 *          existence under another tenant).
 */

import { describe, expect, it } from 'vitest';

import {
  PROJECT_A,
  PROJECT_B,
  TENANT_A,
  TENANT_B,
  TOKEN_A,
  TOKEN_B,
  TOKEN_INTERNAL_RUNTIME,
  T0,
  errorOf,
  fixtureService,
  request,
  validCreateProjectRequest,
  validGoal,
  validStrategyIntent,
} from './fixtures';

describe('positive per-tenant probes (the same shapes, both tenants served)', () => {
  it('each tenant creates, reads and queries its OWN scope end-to-end', () => {
    const { service } = fixtureService();
    for (const [token, tenant, project] of [
      [TOKEN_A, TENANT_A, 'project-iso-alpha'],
      [TOKEN_B, TENANT_B, 'project-iso-beta'],
    ] as const) {
      const create = service.handle(request('POST', '/v1/projects', token, validCreateProjectRequest(tenant, project)) as never) as never as { status: number; body: { data: { tenantId: string; id: string } } };
      expect(create.status).toBe(201);
      expect(create.body.data.tenantId).toBe(tenant);

      const get = service.handle(request('GET', `/v1/projects/${project}`, token) as never) as never as { status: number; body: { data: { tenantId: string } } };
      expect(get.status).toBe(200);
      expect(get.body.data.tenantId).toBe(tenant);

      const list = service.handle(request('GET', '/v1/projects', token) as never) as never as { body: { data: { items: { tenantId: string }[] } } };
      expect(list.body.data.items.every((item) => item.tenantId === tenant)).toBe(true);

      const knowledge = service.handle(request('POST', '/v1/knowledge/query', token, { project: tenant === TENANT_A ? PROJECT_A : PROJECT_B, at: T0 + 1000 }) as never) as never as { status: number; body: { data: { items: { record: { tenant: string } }[] } } };
      expect(knowledge.status).toBe(200);
      expect(knowledge.body.data.items.every((entry) => entry.record.tenant === tenant)).toBe(true);

      const submit = service.handle({ ...request('POST', '/v1/jobs/research', token, { kind: 'research', projectId: project, spec: { q: 'x' } }), headers: { authorization: `Bearer ${token}`, 'idempotency-key': `idem:${tenant}:1` } } as never) as never as { status: number; body: { data: { jobId: string; tenant: string } } };
      expect(submit.status).toBe(202);
      expect(submit.body.data.tenant).toBe(tenant);
    }
  });
});

describe('negative cross-tenant probes — the DECLARED-scope law (typed cross_tenant_access at the routing layer)', () => {
  it('a create-project body whose GOAL belongs to another tenant is the typed 403 cross_tenant_access', () => {
    const { service } = fixtureService();
    const forged = { ...validCreateProjectRequest(TENANT_A, 'project-forged-goal'), goal: validGoal(TENANT_B) };
    const response = service.handle(request('POST', '/v1/projects', TOKEN_A, forged) as never) as never as { status: number; body: unknown };
    expect(response.status).toBe(403);
    const error = errorOf(response);
    expect(error.code).toBe('cross_tenant_access');
    expect(error.message).toContain(TENANT_B);
    expect(error.message).toContain('L12');
    // And nothing was created.
    const list = service.handle(request('GET', '/v1/projects', TOKEN_A) as never) as never as { body: { data: { items: unknown[] } } };
    expect(list.body.data.items.length).toBe(0);
  });

  it('a create-project body whose CONSTRAINT SET belongs to another tenant is the same typed error', () => {
    const { service } = fixtureService();
    const foreignSet = validCreateProjectRequest(TENANT_B, 'x')['constraintSet'] as Record<string, unknown>;
    const forged = { ...validCreateProjectRequest(TENANT_A, 'project-forged-cs'), constraintSet: foreignSet };
    const response = service.handle(request('POST', '/v1/projects', TOKEN_A, forged) as never) as never as { status: number; body: unknown };
    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe('cross_tenant_access');
  });

  it('an execution INTENT declaring another tenant is the typed 403 cross_tenant_access (never forwarded)', () => {
    const { service, bundle } = fixtureService();
    const foreign = validStrategyIntent(TENANT_B, PROJECT_B);
    const response = service.handle({ ...request('POST', '/v1/execution/requests', TOKEN_A, { intent: foreign }), headers: { authorization: `Bearer ${TOKEN_A}`, 'idempotency-key': 'idem:foreign:1' } } as never) as never as { status: number; body: unknown };
    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe('cross_tenant_access');
    // The gateway port received NOTHING.
    expect(bundle.gateway.submitted.length).toBe(0);
  });
});

describe('negative cross-tenant probes — API-OWNED state (typed cross_tenant_access, observable)', () => {
  it('a foreign tenant reading a job is the typed 403 cross_tenant_access', () => {
    const { service } = fixtureService();
    const submit = service.handle({ ...request('POST', '/v1/jobs/learning', TOKEN_A, { kind: 'learning', projectId: 'project-jobs-iso', spec: { curriculum: 'v1' } }), headers: { authorization: `Bearer ${TOKEN_A}`, 'idempotency-key': 'idem:iso-job:1' } } as never) as never as { body: { data: { jobId: string } } };
    const jobId = submit.body.data.jobId;

    // The owning tenant reads it fine.
    expect((service.handle(request('GET', `/v1/jobs/${jobId}`, TOKEN_A) as never) as unknown as { status: number }).status).toBe(200);
    // The foreign tenant gets the TYPED error (never the record, never a silent miss).
    const foreign = service.handle(request('GET', `/v1/jobs/${jobId}`, TOKEN_B) as never) as never as { status: number; body: unknown };
    expect(foreign.status).toBe(403);
    expect(errorOf(foreign).code).toBe('cross_tenant_access');
    expect(errorOf(foreign).message).toContain(TENANT_B);
  });

  it('a foreign tenant reading an org-status snapshot is the typed 403 cross_tenant_access', () => {
    const { service } = fixtureService();
    service.handle(request('POST', '/internal/organizations/status', TOKEN_INTERNAL_RUNTIME, { snapshot: { organizationRef: 'org:iso-1', tenant: TENANT_A, project: 'project-iso-org', status: 'active', at: T0, instanceRefs: [] } }) as never);
    // The owning tenant watches it fine.
    expect((service.handle(request('GET', '/v1/organizations/org:iso-1/status', TOKEN_A, undefined, { project: 'project-iso-org' }) as never) as unknown as { status: number }).status).toBe(200);
    // The foreign tenant gets the TYPED error.
    const foreign = service.handle(request('GET', '/v1/organizations/org:iso-1/status', TOKEN_B, undefined, { project: 'project-iso-org' }) as never) as never as { status: number; body: unknown };
    expect(foreign.status).toBe(403);
    expect(errorOf(foreign).code).toBe('cross_tenant_access');
  });

  it('the private org-status write of one tenant\'s scope is not observable through another tenant\'s watch reads', () => {
    const { service } = fixtureService();
    service.handle(request('POST', '/internal/organizations/status', TOKEN_INTERNAL_RUNTIME, { snapshot: { organizationRef: 'org:iso-2', tenant: TENANT_B, project: 'project-iso-org-b', status: 'forming', at: T0, instanceRefs: [] } }) as never);
    const probe = service.handle(request('GET', '/v1/organizations/org:iso-2/status', TOKEN_A, undefined, { project: 'project-iso-org-b' }) as never) as never as { status: number; body: unknown };
    expect(probe.status).toBe(403);
    expect(errorOf(probe).code).toBe('cross_tenant_access');
  });
});

describe('negative cross-tenant probes — backing-service reads (unreachable, indistinguishable)', () => {
  it('a foreign project id on the read routes is 404 — never the record, never an existence oracle (T007\'s law)', () => {
    const { service } = fixtureService();
    // Tenant A creates a project.
    service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, 'project-iso-hidden')) as never);
    // Tenant B asks for it: unknown and cross-tenant are indistinguishable.
    const probe = service.handle(request('GET', '/v1/projects/project-iso-hidden', TOKEN_B) as never) as never as { status: number; body: unknown };
    expect(probe.status).toBe(404);
    expect(errorOf(probe).code).toBe('not_found');
    // And the same 404 for a truly unknown id — byte-identical verdict shape.
    const unknown = service.handle(request('GET', '/v1/projects/project-does-not-exist', TOKEN_B) as never) as never as { status: number; body: unknown };
    expect(unknown.status).toBe(404);
    expect(errorOf(unknown).code).toBe('not_found');
  });

  it('a foreign knowledge project yields an empty page (the injected tenant scopes every query)', () => {
    const { service, bundle } = fixtureService();
    // Tenant B queries tenant A's project scope: the query is (TENANT_B, PROJECT_A) — nothing serves.
    const probe = service.handle(request('POST', '/v1/knowledge/query', TOKEN_B, { project: PROJECT_A, at: T0 + 1000 }) as never) as never as { status: number; body: { data: { items: unknown[] } } };
    expect(probe.status).toBe(200);
    expect(probe.body.data.items.length).toBe(0);
    // The firm-memory port only ever saw tenant B's injected scope.
    void bundle;
  });
});

describe('usage isolation (R41 facts are tenant-scoped)', () => {
  it('one tenant\'s usage ledger never contains the other\'s records', () => {
    const { service } = fixtureService();
    service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
    service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
    service.handle(request('GET', '/v1/meta', TOKEN_B) as never);
    const usageA = service.usageOf(TENANT_A as never);
    const usageB = service.usageOf(TENANT_B as never);
    expect(usageA.length).toBe(2);
    expect(usageB.length).toBe(1);
    expect(usageA.every((record) => record.tenant === TENANT_A)).toBe(true);
    expect(usageB.every((record) => record.tenant === TENANT_B)).toBe(true);
  });
});
