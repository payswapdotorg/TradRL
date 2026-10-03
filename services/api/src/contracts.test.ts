/**
 * @tradrl/api-service — the contract + golden-determinism tests.
 *
 * CONTRACTS: the route-table law (every declared route resolves; the
 * plane partition is total); the wire envelope discipline (success
 * and error shapes, the request-id echo); the pagination discipline
 * (deterministic pages, minted cursors, the last page carries no
 * cursor); the response-shape guards over every route family's
 * served data.
 *
 * GOLDEN DETERMINISM (L9): identical inputs -> identical bytes. Two
 * service instances built from identical fixtures and driven by
 * identical request sequences produce byte-identical RESPONSES,
 * USAGE records and AUDIT trails — the metering/idempotency/audit
 * construction laws pinned end-to-end.
 */

import { describe, expect, it } from 'vitest';

import {
  TENANT_A,
  TOKEN_A,
  TOKEN_INTERNAL_RUNTIME,
  T0,
  errorOf,
  fixtureService,
  request,
  validCreateProjectRequest,
  validStrategyIntent,
} from './fixtures';
import { ROUTES, PUBLIC_ROUTES, PRIVATE_ROUTES, resolveRoute } from './router';
import { isApiResponse, isPage, isProjectRecord, isJobRecord, isOrgStatusSnapshot, isGatewaySubmissionRecord, isServedKnowledge } from './index';

describe('the route table (the frozen contract)', () => {
  it('every declared route resolves for its own method+pattern', () => {
    for (const route of ROUTES) {
      const path = route.pattern.replace(':projectId', 'project-x').replace(':jobId', 'job:0123abcd').replace(':organizationRef', 'org:x').replace(':tenantId', 'tenant-x');
      const resolved = resolveRoute(route.method, path);
      expect(resolved.ok, `${route.method} ${path}`).toBe(true);
      if (resolved.ok) {
        expect(resolved.resolved.route.name).toBe(route.name);
      }
    }
  });

  it('the planes partition the table totally: every public route is /v1/*, every private route is /internal/*', () => {
    for (const route of PUBLIC_ROUTES) {
      expect(route.pattern.startsWith('/v1/')).toBe(true);
      expect(route.plane).toBe('public');
    }
    for (const route of PRIVATE_ROUTES) {
      expect(route.pattern.startsWith('/internal/')).toBe(true);
      expect(route.plane).toBe('private');
    }
  });

  it('the consequential routes are exactly the mutations + execution + job submissions + internal writes', () => {
    const consequential = ROUTES.filter((route) => route.consequential).map((route) => route.name).sort();
    expect(consequential).toEqual([
      'execution.requests',
      'internal.jobs.transitions',
      'internal.organizations.status',
      'jobs.learning',
      'jobs.research',
      'projects.bindOrganization',
      'projects.create',
      'projects.lifecycle',
    ]);
  });

  it('the idempotency-REQUIRED routes are exactly the execution + job-submission routes', () => {
    const required = ROUTES.filter((route) => route.idempotency === 'required').map((route) => route.name).sort();
    expect(required).toEqual(['execution.requests', 'jobs.learning', 'jobs.research']);
  });
});

describe('the wire envelope discipline', () => {
  it('every response satisfies the response guard', () => {
    const { service } = fixtureService();
    const responses = [
      service.handle(request('GET', '/v1/meta', TOKEN_A) as never),
      service.handle(request('GET', '/v1/unknown', TOKEN_A) as never),
      service.handle(request('GET', '/v1/meta', undefined) as never),
    ];
    for (const response of responses) {
      expect(isApiResponse(response)).toBe(true);
    }
  });
});

describe('the pagination discipline', () => {
  it('lists paginate deterministically and the last page carries no cursor', () => {
    const { service } = fixtureService();
    // Create 7 projects.
    for (let index = 1; index <= 7; index++) {
      service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, `project-page-${index}`)) as never);
    }
    // Page through with limit=3.
    const page1 = service.handle(request('GET', '/v1/projects', TOKEN_A, undefined, { limit: '3' }) as never) as never as { body: { data: { items: unknown[]; nextCursor?: string } } };
    expect(page1.body.data.items.length).toBe(3);
    expect(page1.body.data.nextCursor).toMatch(/^cur:[0-9a-f]{8}$/);

    const page2 = service.handle(request('GET', '/v1/projects', TOKEN_A, undefined, { limit: '3', cursor: page1.body.data.nextCursor! }) as never) as never as { body: { data: { items: unknown[]; nextCursor?: string } } };
    expect(page2.body.data.items.length).toBe(3);
    expect(page2.body.data.nextCursor).toMatch(/^cur:[0-9a-f]{8}$/);

    const page3 = service.handle(request('GET', '/v1/projects', TOKEN_A, undefined, { limit: '3', cursor: page2.body.data.nextCursor! }) as never) as never as { body: { data: { items: unknown[]; nextCursor?: string } } };
    expect(page3.body.data.items.length).toBe(1);
    expect(page3.body.data.nextCursor).toBeUndefined();

    // The pages are disjoint and cover everything.
    const ids = [...page1.body.data.items, ...page2.body.data.items, ...page3.body.data.items].map((item) => (item as { id: string }).id);
    expect(new Set(ids).size).toBe(7);
  });

  it('the served pages satisfy the page guard over the record guards', () => {
    const { service } = fixtureService();
    service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, 'project-guard')) as never);
    const page = (service.handle(request('GET', '/v1/projects', TOKEN_A) as never) as never as { body: { data: unknown } }).body.data;
    expect(isPage(page, (item): item is never => isProjectRecord(item) as never)).toBe(true);
  });
});

describe('the served shapes satisfy the contract guards', () => {
  it('projects serve the T007 ProjectRecord mirror', () => {
    const { service } = fixtureService();
    service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, 'project-shape')) as never);
    const record = (service.handle(request('GET', '/v1/projects/project-shape', TOKEN_A) as never) as never as { body: { data: unknown } }).body.data;
    expect(isProjectRecord(record)).toBe(true);
  });

  it('jobs serve the JobRecord contract; org status serves the snapshot contract; execution serves the T040 submission mirror; knowledge serves the T034 mirror', () => {
    const { service } = fixtureService();
    const job = (service.handle({ ...request('POST', '/v1/jobs/research', TOKEN_A, { kind: 'research', projectId: 'project-shapes', spec: {} }), headers: { authorization: `Bearer ${TOKEN_A}`, 'idempotency-key': 'idem:shapes:job' } } as never) as never as { body: { data: unknown } }).body.data;
    expect(isJobRecord(job)).toBe(true);

    service.handle(request('POST', '/internal/organizations/status', TOKEN_INTERNAL_RUNTIME, { snapshot: { organizationRef: 'org:shapes', tenant: TENANT_A, project: 'project-shapes', status: 'active', at: T0, instanceRefs: ['ai:1'] } }) as never);
    const snapshot = (service.handle(request('GET', '/v1/organizations/org:shapes/status', TOKEN_A, undefined, { project: 'project-shapes' }) as never) as never as { body: { data: unknown } }).body.data;
    expect(isOrgStatusSnapshot(snapshot)).toBe(true);

    const submission = (service.handle({ ...request('POST', '/v1/execution/requests', TOKEN_A, { intent: validStrategyIntent(TENANT_A, 'project-shapes') }), headers: { authorization: `Bearer ${TOKEN_A}`, 'idempotency-key': 'idem:shapes:exec' } } as never) as never as { body: { data: unknown } }).body.data;
    expect(isGatewaySubmissionRecord(submission)).toBe(true);

    const knowledge = (service.handle(request('POST', '/v1/knowledge/query', TOKEN_A, { project: 'project-alpha-1', at: T0 }) as never) as never as { body: { data: { items: unknown[] } } }).body.data.items;
    expect(knowledge.length).toBe(1);
    expect(isServedKnowledge(knowledge[0])).toBe(true);
  });
});

describe('GOLDEN DETERMINISM (identical inputs -> identical bytes)', () => {
  it('two identical instances driven by identical sequences produce byte-identical responses, usage and audit', () => {
    const drive = (): { responses: string; usage: string; audit: string } => {
      const { service } = fixtureService();
      const responses: string[] = [];
      responses.push(JSON.stringify(service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, 'project-gold')) as never)));
      responses.push(JSON.stringify(service.handle(request('POST', '/v1/projects/project-gold/organization', TOKEN_A, { organizationRef: 'org:gold', at: T0 + 1 }) as never)));
      responses.push(JSON.stringify(service.handle(request('POST', '/v1/projects/project-gold/lifecycle', TOKEN_A, { event: 'activate', at: T0 + 2 }) as never)));
      responses.push(JSON.stringify(service.handle({ ...request('POST', '/v1/jobs/research', TOKEN_A, { kind: 'research', projectId: 'project-gold', spec: { q: 'golden' } }), headers: { authorization: `Bearer ${TOKEN_A}`, 'idempotency-key': 'idem:gold:job' } } as never)));
      responses.push(JSON.stringify(service.handle(request('POST', '/v1/knowledge/query', TOKEN_A, { project: 'project-alpha-1', at: T0 + 3 }) as never)));
      responses.push(JSON.stringify(service.handle({ ...request('POST', '/v1/execution/requests', TOKEN_A, { intent: validStrategyIntent(TENANT_A, 'project-gold') }), headers: { authorization: `Bearer ${TOKEN_A}`, 'idempotency-key': 'idem:gold:exec' } } as never)));
      // The idempotent replay (deterministic dedupe).
      responses.push(JSON.stringify(service.handle({ ...request('POST', '/v1/execution/requests', TOKEN_A, { intent: validStrategyIntent(TENANT_A, 'project-gold') }), headers: { authorization: `Bearer ${TOKEN_A}`, 'idempotency-key': 'idem:gold:exec' } } as never)));
      return {
        responses: JSON.stringify(responses),
        usage: JSON.stringify(service.usageAll()),
        audit: JSON.stringify(service.auditTrails()),
      };
    };
    const first = drive();
    const second = drive();
    expect(first.responses).toBe(second.responses);
    expect(first.usage).toBe(second.usage);
    expect(first.audit).toBe(second.audit);
  });

  it('the request ids are content-addressed over the deterministic inputs (requestCounter + instant)', () => {
    const { service } = fixtureService();
    const first = service.handle(request('GET', '/v1/meta', TOKEN_A) as never) as unknown as { body: { requestId: string } };
    const second = service.handle(request('GET', '/v1/meta', TOKEN_A) as never) as unknown as { body: { requestId: string } };
    expect(first.body.requestId).not.toBe(second.body.requestId);
    expect(first.body.requestId).toMatch(/^req:[0-9a-f]{8}$/);

    // The SAME sequence on a fresh instance reproduces the SAME ids (the counter + instants are the inputs).
    const { service: again } = fixtureService();
    const repeat = again.handle(request('GET', '/v1/meta', TOKEN_A) as never) as unknown as { body: { requestId: string } };
    expect(repeat.body.requestId).toBe(first.body.requestId);
  });
});

void errorOf;
