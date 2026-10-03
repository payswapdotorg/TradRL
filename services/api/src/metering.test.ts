/**
 * @tradrl/api-service — the metering + audit tests.
 *
 * METERING (R41 hooks — "per-tenant per-route usage records emitted on
 * EVERY request ... record only, no enforcement"):
 *   - EVERY request meters — successes AND failures (401, 403, 404,
 *     429, 400 all included);
 *   - the records are tenant-scoped (L12) and route-family-dimensioned;
 *   - the internal plane meters under the `svc:` service namespace
 *     (internal reads never pollute a tenant's consumption facts);
 *   - DETERMINISM (L9): identical request sequences -> identical
 *     metering bytes (content-addressed record ids);
 *   - the aggregate is coherent (total = sum of per-route counts);
 *   - RECORD ONLY: nothing in the ledger refuses anything.
 *
 * AUDIT (T043's discipline, emitted): every CONSEQUENTIAL request
 * (mutations, execution, job submissions, internal writes) emits one
 * chain-verified record carrying who/what/when/tenant/route/
 * consequence; denials of consequential routes are audited too; the
 * chain verifies; tampering (dropping a record) is detectable.
 */

import { describe, expect, it } from 'vitest';

import {
  PROJECT_A,
  TENANT_A,
  TENANT_B,
  TOKEN_A,
  TOKEN_B,
  TOKEN_INTERNAL_RUNTIME,
  TOKEN_INTERNAL_USAGE,
  T0,
  errorOf,
  fixtureService,
  request,
  validCreateProjectRequest,
  validStrategyIntent,
} from './fixtures';
import { usageAggregateCoherent, usageTenantConsistent, isUsageRecord } from './metering';
import { verifyApiAuditChain } from './audit';

describe('metering — every request emits exactly one usage record', () => {
  it('successes meter (status + route family + tenant)', () => {
    const { service } = fixtureService();
    service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
    service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, 'project-meter-1')) as never);
    const usage = service.usageOf(TENANT_A as never);
    expect(usage.length).toBe(2);
    const [meta, create] = usage as unknown as { route: string; method: string; status: number; path: string }[];
    expect(meta.route).toBe('meta:read');
    expect(meta.method).toBe('GET');
    expect(meta.status).toBe(200);
    expect(create.route).toBe('projects:write');
    expect(create.status).toBe(201);
  });

  it('failures meter too (401, 403, 404, 400, 429)', () => {
    const { service } = fixtureService({ rateLimit: { windowMs: 60_000, maxRequests: 2 } });
    service.handle(request('GET', '/v1/meta', undefined) as never);                 // 401
    service.handle(request('GET', '/internal/usage/x', TOKEN_A) as never);          // 403 wrong plane
    service.handle(request('GET', '/v1/unknown', TOKEN_A) as never);                // 404
    service.handle(request('POST', '/v1/projects', TOKEN_A, { broken: true }) as never); // 400
    service.handle(request('GET', '/v1/meta', TOKEN_A) as never);                   // 200
    service.handle(request('GET', '/v1/meta', TOKEN_A) as never);                   // 200
    service.handle(request('GET', '/v1/meta', TOKEN_A) as never);                   // 429
    const usage = service.usageAll();
    expect(usage.length).toBe(7);
    const statuses = (usage as readonly { status: number }[]).map((record) => record.status);
    expect(statuses).toEqual([401, 403, 404, 400, 200, 200, 429]);
  });

  it('the records satisfy the usage-record guard and are tenant-consistent', () => {
    const { service } = fixtureService();
    service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
    service.handle(request('GET', '/v1/meta', TOKEN_B) as never);
    const usageA = service.usageOf(TENANT_A as never);
    expect(usageA.every((record) => isUsageRecord(record))).toBe(true);
    expect(usageTenantConsistent(usageA, TENANT_A as never)).toBe(true);
  });

  it('the internal plane meters under the svc: namespace (internal reads never pollute tenant facts)', () => {
    const { service } = fixtureService();
    service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
    service.handle(request('GET', `/internal/usage/${TENANT_A}`, TOKEN_INTERNAL_USAGE) as never);
    service.handle(request('POST', '/internal/organizations/status', TOKEN_INTERNAL_RUNTIME, { snapshot: { organizationRef: 'org:m', tenant: TENANT_A, project: 'project-m', status: 'active', at: T0, instanceRefs: [] } }) as never);
    // The tenant's ledger has ONLY the developer request.
    expect(service.usageOf(TENANT_A as never).length).toBe(1);
    // The platform-wide ledger has all three; the internal ones carry svc: tenants.
    const all = service.usageAll() as unknown as { tenant: string; credentialId: string }[];
    expect(all.length).toBe(3);
    const internalTenants = all.filter((record) => record.tenant.startsWith('svc:')).map((record) => record.tenant);
    expect(internalTenants).toEqual(['svc:usage-reader', 'svc:agent-runtime']);
  });

  it('the aggregate is coherent and the private read serves it', () => {
    const { service } = fixtureService();
    service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
    service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
    service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, 'project-meter-2')) as never);
    const read = service.handle(request('GET', `/internal/usage/${TENANT_A}`, TOKEN_INTERNAL_USAGE) as never) as never as { body: { data: { totalRequests: number; byRoute: Record<string, number> } } };
    const aggregate = read.body.data;
    expect(aggregate.totalRequests).toBe(3);
    expect(aggregate.byRoute['meta:read']).toBe(2);
    expect(aggregate.byRoute['projects:write']).toBe(1);
    expect(usageAggregateCoherent(aggregate)).toBe(true);
  });

  it('DETERMINISM: identical request sequences produce identical metering bytes (content-addressed ids)', () => {
    const drive = (): string => {
      const { service } = fixtureService();
      service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
      service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, 'project-determinism')) as never);
      service.handle(request('GET', '/v1/projects/project-determinism', TOKEN_A) as never);
      service.handle(request('POST', '/v1/execution/requests', TOKEN_A, { intent: validStrategyIntent(TENANT_A, PROJECT_A) }, undefined) as never);
      return JSON.stringify(service.usageAll());
    };
    expect(drive()).toBe(drive());
  });

  it('RECORD ONLY: the ledger never refuses anything (a 1000-request tenant still serves request 1001)', () => {
    const { service } = fixtureService({ rateLimit: { windowMs: 60_000, maxRequests: 3 } });
    for (let index = 0; index < 5; index++) {
      service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
    }
    // The rate limiter refused requests 4-5, but the LEDGER recorded all five — and served the read.
    const usage = service.usageOf(TENANT_A as never);
    expect(usage.length).toBe(5);
    const read = service.handle(request('GET', `/internal/usage/${TENANT_A}`, TOKEN_INTERNAL_USAGE) as never) as never as { body: { data: { totalRequests: number } } };
    expect(read.body.data.totalRequests).toBe(5);
  });
});

describe('audit — consequential requests emit the who/what/when/tenant/route/consequence record', () => {
  it('an allowed consequential request emits request.allowed with the route + consequence blocks', () => {
    const { service } = fixtureService();
    service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, 'project-audit-1')) as never);
    const trails = service.auditTrails() as unknown as { tenant: string; project: string; records: { actor: { kind: string; ref: string }; action: string; route: { method: string; pattern: string; family: string }; consequence: { status: number; affected: { objectType: string; ref: string } | null }; at: number }[] }[];
    expect(trails.length).toBe(1);
    const trail = trails[0]!;
    expect(trail.tenant).toBe(TENANT_A);
    expect(trail.project).toBe('project-audit-1');
    expect(trail.records.length).toBe(1);
    const record = trail.records[0]!;
    expect(record.actor.kind).toBe('principal'); // T043's actor vocabulary.
    expect(record.actor.ref).toBe('developer-alpha');
    expect(record.action).toBe('request.allowed');
    expect(record.route.pattern).toBe('/v1/projects');
    expect(record.route.family).toBe('projects:write');
    expect(record.consequence.status).toBe(201);
    expect(record.consequence.affected).toEqual({ objectType: 'project', ref: 'project-audit-1' });
    expect(record.at).toBeGreaterThan(0);
  });

  it('a DENIED consequential request is audited as request.denied', () => {
    const { service } = fixtureService();
    // The cross-tenant forgery attempt (denied at the routing layer).
    const forged = { ...validCreateProjectRequest(TENANT_A, 'project-audit-denied'), goal: { ...(validCreateProjectRequest(TENANT_A, 'x')['goal'] as Record<string, unknown>), tenantId: TENANT_B } };
    service.handle(request('POST', '/v1/projects', TOKEN_A, forged) as never);
    const trails = service.auditTrails() as unknown as { records: { action: string; consequence: { status: number } }[] }[];
    expect(trails.length).toBe(1);
    expect(trails[0]!.records[0]!.action).toBe('request.denied');
    expect(trails[0]!.records[0]!.consequence.status).toBe(403);
  });

  it('the execution route audits with the goal lineage (T043\'s lineage shape)', () => {
    const { service } = fixtureService();
    service.handle({ method: 'POST', path: '/v1/execution/requests', headers: { authorization: `Bearer ${TOKEN_A}`, 'idempotency-key': 'idem:audit:exec' }, body: { intent: validStrategyIntent(TENANT_A, 'project-audit-exec') } } as never);
    const trails = service.auditTrails() as unknown as { records: { lineage: { goal: { goalId: string; version: number } | null }; consequence: { affected: { objectType: string } | null } }[] }[];
    expect(trails.length).toBe(1);
    const record = trails[0]!.records[0]!;
    expect(record.lineage.goal).toEqual({ goalId: 'goal-tenant-alpha', version: 1 });
    expect(record.consequence.affected?.objectType).toBe('gateway-submission');
  });

  it('the idempotent REPLAY is audited as request.replayed', () => {
    const intent = validStrategyIntent(TENANT_A, 'project-audit-replay', 9);
    const { service } = fixtureService();
    const keyed = { method: 'POST', path: '/v1/execution/requests', headers: { authorization: `Bearer ${TOKEN_A}`, 'idempotency-key': 'idem:audit:replay' }, body: { intent } };
    service.handle(keyed as never);
    service.handle(keyed as never);
    const trails = service.auditTrails() as unknown as { records: { action: string }[] }[];
    const actions = trails[0]!.records.map((record) => record.action);
    expect(actions).toEqual(['request.allowed', 'request.replayed']);
  });

  it('the chain verifies; tampering (dropping a record) is detectable', () => {
    const { service } = fixtureService();
    service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, 'project-chain-1')) as never);
    service.handle(request('POST', '/v1/projects/project-chain-1/lifecycle', TOKEN_A, { event: 'abandon', at: T0 + 10 }) as never);
    const trail = service.auditTrail(TENANT_A as never, 'project-chain-1' as never) as unknown as { records: unknown[] };
    expect(trail.records.length).toBe(2);
    expect(verifyApiAuditChain(trail as never).ok).toBe(true);

    // Tamper: drop the FIRST record (a sequence gap — detectable; tail-truncation alone is the
    // one rewrite a chain cannot see without an external head witness, which the operator holds).
    const records = (trail as unknown as { records: unknown[] }).records;
    const tampered = { ...(trail as unknown as Record<string, unknown>), records: records.slice(1) };
    const verdict = verifyApiAuditChain(tampered as never);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error.code).toBe('conflict');

    // Tamper: reorder the records.
    const reordered = { ...(trail as unknown as Record<string, unknown>), records: [records[1]!, records[0]!] };
    expect(verifyApiAuditChain(reordered as never).ok).toBe(false);

    // Tamper: rewrite the surviving record's consequence.
    const rewritten = {
      ...(trail as unknown as Record<string, unknown>),
      records: [{ ...((trail as unknown as { records: Record<string, unknown>[] }).records[0]!), consequence: { status: 200, affected: null, idempotentReplay: false } }],
    };
    expect(verifyApiAuditChain(rewritten as never).ok).toBe(false);
  });

  it('the audit scopes are isolated: one scope\'s trail never contains another\'s records', () => {
    const { service } = fixtureService();
    service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, 'project-scope-a')) as never);
    service.handle(request('POST', '/v1/projects', TOKEN_B, validCreateProjectRequest(TENANT_B, 'project-scope-b')) as never);
    const trails = service.auditTrails() as unknown as { tenant: string; records: { tenant: string }[] }[];
    expect(trails.length).toBe(2);
    for (const trail of trails) {
      expect(trail.records.every((record) => record.tenant === trail.tenant)).toBe(true);
    }
  });

  it('an authn failure (no scope resolvable) leaves no trail — but still meters', () => {
    const { service } = fixtureService();
    service.handle(request('GET', '/v1/meta', undefined) as never);
    expect((service.auditTrails() as unknown[]).length).toBe(0);
    expect(service.usageAll().length).toBe(1);
  });
});

void errorOf;
