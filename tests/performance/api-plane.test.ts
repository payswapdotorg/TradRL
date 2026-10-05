/**
 * T050 — the API plane's per-request WORK laws (the deterministic
 * performance surface).
 *
 * THE LAW (spec/REQUIREMENTS.md R39/R40/R41 + ARCHITECTURE-LOCK L9/L12/L20,
 * pinned AT SCALE as operation-count and complexity laws — never wall
 * clock): the deployed API plane's work is BOUNDED and EXACTLY LINEAR
 * in its requests, its retries are deduplicated to one consequential
 * execution, its refusals cost bounded work, its audit trail carries
 * EXACTLY the authenticated consequential requests, its tenants stay
 * isolated under interleaved load, and the whole plane reproduces
 * byte-identically under an identical scripted drive.
 *
 * THE METHOD (the tests/performance/README.md discipline): every
 * scenario drives the REAL service (services/api's fixtureService —
 * the same in-memory ports, scripted instants and deterministic
 * policies the service's own suite uses) through scripted request
 * sequences and asserts the COUNTS, not the timings. No network, no
 * clock, no randomness — the work is the count, and the count is
 * exact.
 *
 * Relation to services/api/src/*.test.ts: the per-request laws (ONE
 * 429, ONE replay, ONE refusal) are pinned there; THIS suite pins the
 * same laws as SCALING LAWS — the exhaustion sequence, the retry
 * storm, the interleaved tenants, the 64-request reproduction — the
 * shapes a production deployment actually experiences.
 */

import { describe, expect, it } from 'vitest';

import {
  PROJECT_A,
  T0,
  TENANT_A,
  TENANT_B,
  TOKEN_A,
  TOKEN_B,
  fixtureService,
  request,
  validCreateProjectRequest,
  validStrategyIntent,
} from '../../services/api/src/fixtures';
import { canonicalJson } from '../../services/api/src/index';
import { usageAggregateCoherent, usageTenantConsistent } from '../../services/api/src/metering';

/** Type-only import for the response shape the scenarios read. */
type ResponseShape = { status: number; body: unknown; headers: Record<string, string> };

/** The typed error of a response (the service suite's own helper, mirrored). */
function errorOf(response: ResponseShape): { code: string; message: string; status: number } {
  const body = response.body as { error?: { code: string; message: string } } | null;
  if (body === null || typeof body !== 'object' || body.error === undefined) {
    throw new Error(`expected an error envelope, got ${JSON.stringify(response.body)}`);
  }
  return { ...body.error, status: response.status };
}

/** One consequential execution request (the idempotent route). A missing token/key is omitted from the headers entirely. */
function executionRequest(token: string | undefined, intent: unknown, key: string | undefined): Record<string, unknown> {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  if (key !== undefined) headers['idempotency-key'] = key;
  return { method: 'POST', path: '/v1/execution/requests', headers, body: { intent } };
}

// ---------------------------------------------------------------------------
// LAW 1 — metering is EXACTLY linear (one record per request, at scale)
// ---------------------------------------------------------------------------

describe('the metering linearity law (work grows exactly with requests)', () => {
  it('40 mixed requests produce EXACTLY 40 usage records — no amplification, no loss', () => {
    const { service } = fixtureService();
    for (let index = 0; index < 16; index++) {
      service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
      service.handle(request('POST', '/v1/knowledge/query', TOKEN_A, { project: PROJECT_A, at: T0 }) as never);
    }
    for (let index = 0; index < 8; index++) {
      service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, `project-perf-linear-${index}`)) as never);
    }
    const usage = service.usageAll();
    expect(usage.length).toBe(40); // 16 meta + 16 knowledge + 8 creates — every one metered exactly once
    expect(usageTenantConsistent(usage, TENANT_A as never)).toBe(true);
  });

  it('the NEXT 24 requests add EXACTLY 24 more (64 total) and the per-route aggregate stays coherent at both scales', () => {
    const { service } = fixtureService();
    const driveBatch = (): void => {
      for (let index = 0; index < 16; index++) {
        service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
        service.handle(request('POST', '/v1/knowledge/query', TOKEN_A, { project: PROJECT_A, at: T0 }) as never);
      }
    };
    driveBatch();
    expect(service.usageAll().length).toBe(32);
    for (let index = 0; index < 8; index++) {
      service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, `project-perf-linear2-${index}`)) as never);
    }
    expect(service.usageAll().length).toBe(40); // +8, exactly
    for (let index = 0; index < 12; index++) {
      service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
      service.handle(request('POST', '/v1/knowledge/query', TOKEN_A, { project: PROJECT_A, at: T0 }) as never);
    }
    const usage = service.usageAll();
    expect(usage.length).toBe(64); // 40 + 24 — EXACTLY linear, never superlinear, never lossy
    // The per-route aggregate folds the same counts the records carry (the private read path).
    const read = service.handle(request('GET', `/internal/usage/${TENANT_A}`, 'tok-int-usage-reader-0006') as never) as never as ResponseShape;
    const aggregate = (read.body as { data: { totalRequests: number; byRoute: Record<string, number> } }).data;
    expect(aggregate.totalRequests).toBe(64);
    expect(aggregate.byRoute['meta:read']).toBe(28);
    expect(aggregate.byRoute['knowledge:read']).toBe(28);
    expect(aggregate.byRoute['projects:write']).toBe(8);
    expect(usageAggregateCoherent(aggregate)).toBe(true);
  });

  it('failures meter too: a 12-failure sequence produces exactly 12 records with the exact status sequence', () => {
    const { service } = fixtureService();
    const statuses: number[] = [];
    statuses.push((service.handle(request('GET', '/v1/meta', undefined) as never) as never as ResponseShape).status);                    // 401 (no credential)
    statuses.push((service.handle(request('GET', '/internal/usage/x', TOKEN_A) as never) as never as ResponseShape).status);             // 403 (wrong plane)
    statuses.push((service.handle(request('GET', '/v1/unknown', TOKEN_A) as never) as never as ResponseShape).status);                   // 404 (unknown route)
    statuses.push((service.handle(request('POST', '/v1/projects', TOKEN_A, { broken: true }) as never) as never as ResponseShape).status); // 400 (invalid body)
    for (let index = 0; index < 8; index++) {
      statuses.push((service.handle(request('GET', '/v1/meta', TOKEN_A) as never) as never as ResponseShape).status);                    // 200 x8
    }
    expect(statuses).toEqual([401, 403, 404, 400, 200, 200, 200, 200, 200, 200, 200, 200]);
    const usage = service.usageAll();
    expect(usage.length).toBe(12); // every request metered — failure work is accounted work
    expect((usage as readonly { status: number }[]).map((record) => record.status)).toEqual(statuses);
  });
});

// ---------------------------------------------------------------------------
// LAW 2 — the rate-limit exhaustion law (bounded refusal work + the
// deterministic retry signal)
// ---------------------------------------------------------------------------

describe('the rate-limit exhaustion law (a budget of 3, a storm of 10)', () => {
  it('exactly 3 succeed, exactly 7 refuse, every refusal carries the deterministic retry signal, and every request still meters', () => {
    const { service } = fixtureService({ rateLimit: { windowMs: 60_000, maxRequests: 3 } });
    const statuses: number[] = [];
    const retrySignals: string[] = [];
    for (let index = 0; index < 10; index++) {
      const response = service.handle(request('GET', '/v1/meta', TOKEN_A) as never) as never as ResponseShape;
      statuses.push(response.status);
      if (response.status === 429) retrySignals.push(response.headers['retry-after-ms']);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429, 429, 429, 429, 429, 429]);
    // The scripted clock advances 1 ms per request: retryAfterMs = windowMs - elapsed, exactly.
    expect(retrySignals).toEqual(['59997', '59996', '59995', '59994', '59993', '59992', '59991']);
    // Every refusal metered — the refusal work is one bounded record per request, never unbounded.
    const usage = service.usageAll();
    expect(usage.length).toBe(10);
    expect((usage as readonly { status: number }[]).map((record) => record.status)).toEqual(statuses);
    expect((usage as readonly { status: number }[]).filter((record) => record.status === 429).length).toBe(7);
  });

  it('the exhaustion is PER CREDENTIAL: tenant B keeps serving while tenant A is refused', () => {
    const { service } = fixtureService({ rateLimit: { windowMs: 60_000, maxRequests: 3 } });
    for (let index = 0; index < 6; index++) {
      service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
    }
    const aStatuses = (service.usageOf(TENANT_A as never) as readonly { status: number }[]).map((record) => record.status);
    expect(aStatuses.filter((status) => status === 429).length).toBe(3); // A exhausted after 3
    const bResponse = service.handle(request('GET', '/v1/meta', TOKEN_B) as never) as never as ResponseShape;
    expect(bResponse.status).toBe(200); // B's own budget is untouched (L12: the limiter is per-credential)
    expect((service.usageOf(TENANT_B as never) as readonly { status: number }[]).every((record) => record.status === 200)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LAW 3 — the retry-storm law (idempotent replays dedupe to ONE
// consequential execution)
// ---------------------------------------------------------------------------

describe('the retry-storm law (1 execution + 50 replays = 1 execution)', () => {
  it('50 replays of the same keyed execution request cost ONE gateway call, produce byte-identical responses, and audit every attempt honestly', () => {
    const { service, bundle } = fixtureService();
    const intent = validStrategyIntent(TENANT_A, PROJECT_A, 41);
    const key = 'idem:perf:storm:1';
    const first = service.handle(executionRequest(TOKEN_A, intent, key) as never) as never as ResponseShape;
    expect(first.status).toBe(200);
    expect(first.headers['x-idempotent-replay']).toBeUndefined(); // the original is not a replay

    for (let index = 0; index < 50; index++) {
      const replay = service.handle(executionRequest(TOKEN_A, intent, key) as never) as never as ResponseShape;
      expect(replay.status).toBe(first.status);
      expect(JSON.stringify(replay.body)).toBe(JSON.stringify(first.body)); // the ORIGINAL response, byte-identical
      expect(replay.headers['x-idempotent-replay']).toBe('true');
    }

    // The CONSEQUENCE happened EXACTLY ONCE: one gateway port call.
    expect(bundle.gateway.submitted.length).toBe(1);

    // The audit trail is the honest traffic record: every consequential REQUEST is audited —
    // the original as request.allowed, each replay as request.replayed naming the SAME submission.
    const trails = service.auditTrails() as unknown as readonly { records: { action: string; consequence: { status: number; affected: { objectType: string; ref: string } | null } }[] }[];
    expect(trails.length).toBe(1);
    const records = trails[0].records;
    expect(records.length).toBe(51);
    expect(records.filter((record) => record.action === 'request.allowed').length).toBe(1);
    expect(records.filter((record) => record.action === 'request.replayed').length).toBe(50);
    const submissionRefs = new Set(records.map((record) => record.consequence.affected?.ref ?? 'none'));
    expect(submissionRefs.size).toBe(1); // every attempt names the ONE submission — retries never mint consequences

    // The metering ledger is honest about the traffic: every attempt metered.
    expect(service.usageAll().length).toBe(51);
  });
});

// ---------------------------------------------------------------------------
// LAW 4 — the refusal law (a kill-switch refusal costs ONE bounded port
// call; its replays dedupe like any other result)
// ---------------------------------------------------------------------------

describe('the refusal law (a refused execution is bounded work, and replays of a refusal never re-refuse)', () => {
  const refused = {
    kind: 'refused' as const,
    submissionId: 'xgs:00000001',
    decisionId: null,
    auditId: 'xga:00000002',
    refusal: { stage: 'kill_switch' as const, switchId: 'ks:main', thrownAt: T0, reason: 'operator threw the standing switch' },
    refusedAt: T0 as never,
  };

  it('10 unique refused executions cost exactly 10 port calls, 10 usage records, 10 audit records', () => {
    const { service, bundle } = fixtureService({ gatewayScript: () => refused });
    for (let index = 0; index < 10; index++) {
      const intent = validStrategyIntent(TENANT_A, PROJECT_A, 100 + index);
      const response = service.handle(executionRequest(TOKEN_A, intent, `idem:perf:refused:${index}`) as never) as never as ResponseShape;
      expect(response.status).toBe(200); // the gate refused, not the boundary (the typed record is the success shape)
      expect((response.body as { data: { kind: string } }).data.kind).toBe('refused');
    }
    expect(bundle.gateway.submitted.length).toBe(10); // exactly one bounded port call per unique request
    expect(service.usageAll().length).toBe(10);
    const trails = service.auditTrails() as unknown as readonly { records: unknown[] }[];
    expect(trails.reduce((total, trail) => total + trail.records.length, 0)).toBe(10);
  });

  it('replaying a REFUSED execution never hits the gate again (the failed result is history too)', () => {
    const { service, bundle } = fixtureService({ gatewayScript: () => refused });
    const intent = validStrategyIntent(TENANT_A, PROJECT_A, 200);
    const key = 'idem:perf:refused-replay';
    const first = service.handle(executionRequest(TOKEN_A, intent, key) as never) as never as ResponseShape;
    for (let index = 0; index < 10; index++) {
      const replay = service.handle(executionRequest(TOKEN_A, intent, key) as never) as never as ResponseShape;
      expect(JSON.stringify(replay.body)).toBe(JSON.stringify(first.body));
      expect(replay.headers['x-idempotent-replay']).toBe('true');
    }
    expect(bundle.gateway.submitted.length).toBe(1); // the refusal itself happened exactly once
    expect(service.usageAll().length).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// LAW 5 — the exact audit-count law (the trail carries EXACTLY the
// authenticated consequential requests)
// ---------------------------------------------------------------------------

describe('the exact audit-count law', () => {
  it('a 9-request mixed sequence leaves EXACTLY 4 audit records — the authenticated consequential ones with resolvable scopes, and nothing else', () => {
    const { service } = fixtureService();
    service.handle(request('GET', '/v1/meta', TOKEN_A) as never);                                                              // read — never audited
    service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, 'project-perf-audit-1')) as never); // audited (create, valid id)
    service.handle(request('POST', '/v1/projects', TOKEN_A, { broken: true }) as never);                                        // 400, scope unresolvable — NOT audited
    service.handle({ ...request('POST', '/v1/jobs/research', TOKEN_A, { kind: 'research', projectId: 'project-perf-audit-1', spec: {} }), headers: { authorization: `Bearer ${TOKEN_A}`, 'idempotency-key': 'idem:perf:audit:job' } } as never); // audited (job, valid projectId)
    service.handle(executionRequest(TOKEN_A, validStrategyIntent(TENANT_A, PROJECT_A, 61), 'idem:perf:audit:exec-1') as never); // audited (execution, valid intent)
    service.handle(executionRequest(TOKEN_A, validStrategyIntent(TENANT_A, PROJECT_A, 62), undefined) as never); // 400 idempotency_required — audited (the intent is valid; denials of consequential routes are audited)
    service.handle(executionRequest(undefined, validStrategyIntent(TENANT_A, PROJECT_A, 63), 'idem:perf:audit:exec-3') as never); // 401 — no credential, NOT audited
    service.handle(request('GET', '/v1/projects', TOKEN_A) as never);                                                           // read — never audited
    service.handle(request('POST', '/v1/knowledge/query', TOKEN_A, { project: PROJECT_A, at: T0 }) as never);                  // read — never audited

    const trails = service.auditTrails() as unknown as readonly { records: unknown[] }[];
    const totalAuditRecords = trails.reduce((total, trail) => total + trail.records.length, 0);
    expect(totalAuditRecords).toBe(4); // create + job + execution + the execution denial — EXACTLY
    expect(service.usageAll().length).toBe(9); // and every one of the 9 metered
  });
});

// ---------------------------------------------------------------------------
// LAW 6 — L12 at interleaved scale
// ---------------------------------------------------------------------------

describe('tenant isolation under interleaved load (L12 at scale)', () => {
  it('96 interleaved requests across two tenants: every usage record lands in exactly its own tenant, every audit trail is exactly its own scope', () => {
    const { service } = fixtureService();
    for (let index = 0; index < 32; index++) {
      service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
      service.handle(request('GET', '/v1/meta', TOKEN_B) as never);
      service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, `project-perf-interleave-${index}`)) as never);
    }
    const usageA = service.usageOf(TENANT_A as never);
    const usageB = service.usageOf(TENANT_B as never);
    expect(usageA.length).toBe(64); // 32 reads + 32 creates
    expect(usageB.length).toBe(32); // 32 reads
    expect(service.usageAll().length).toBe(96);
    expect(usageTenantConsistent(usageA, TENANT_A as never)).toBe(true);
    expect(usageTenantConsistent(usageB, TENANT_B as never)).toBe(true);
    // Every audit trail belongs to tenant A's scopes only (B performed no consequential request).
    const trails = service.auditTrails() as unknown as readonly { records: unknown[] }[];
    expect(trails.reduce((total, trail) => total + trail.records.length, 0)).toBe(32); // exactly the 32 creates
  });
});

// ---------------------------------------------------------------------------
// LAW 7 — the whole plane reproduces byte-identically (L9 at scale)
// ---------------------------------------------------------------------------

describe('whole-plane byte-determinism over a 64-request mixed sequence', () => {
  const INSTANTS = Array.from({ length: 96 }, (_, index) => T0 + index);

  /** The scripted mixed drive: reads, writes, a 401, a 404, a 400, idempotent replays, two tenants — 64 requests exactly. */
  function drive(handle: (request: unknown) => unknown): string[] {
    const responses: string[] = [];
    const send = (one: unknown): void => {
      responses.push(JSON.stringify(handle(one)));
    };
    for (let index = 0; index < 24; index++) {
      send(request('GET', '/v1/meta', TOKEN_A));
      send(request('GET', '/v1/projects', TOKEN_A));
    }
    for (let index = 0; index < 8; index++) {
      send(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, `project-perf-determinism-${index}`)));
    }
    send(request('GET', '/v1/meta', undefined)); // 401
    send(request('GET', '/v1/unknown', TOKEN_A)); // 404
    send(request('POST', '/v1/projects', TOKEN_A, { broken: true })); // 400
    send(executionRequest(TOKEN_A, validStrategyIntent(TENANT_A, PROJECT_A, 71), 'idem:perf:determinism:exec'));
    send(executionRequest(TOKEN_A, validStrategyIntent(TENANT_A, PROJECT_A, 71), 'idem:perf:determinism:exec')); // the replay
    send({ ...request('POST', '/v1/jobs/research', TOKEN_A, { kind: 'research', projectId: 'project-perf-determinism-0', spec: {} }), headers: { authorization: `Bearer ${TOKEN_A}`, 'idempotency-key': 'idem:perf:determinism:job' } });
    send(request('POST', '/v1/knowledge/query', TOKEN_A, { project: PROJECT_A, at: T0 }));
    send(request('GET', '/v1/meta', TOKEN_B)); // the second tenant, interleaved at the tail
    expect(responses.length).toBe(64);
    return responses;
  }

  it('two identically-scripted services produce byte-identical responses, usage ledgers and audit trails', () => {
    const first = fixtureService({ instants: INSTANTS, rateLimit: { windowMs: 60_000, maxRequests: 10_000 } });
    const second = fixtureService({ instants: INSTANTS, rateLimit: { windowMs: 60_000, maxRequests: 10_000 } });
    const responsesA = drive((one) => first.service.handle(one as never));
    const responsesB = drive((one) => second.service.handle(one as never));
    expect(responsesB).toEqual(responsesA); // every response byte-identical
    expect(canonicalJson(second.service.usageAll() as never)).toBe(canonicalJson(first.service.usageAll() as never));
    expect(canonicalJson(second.service.auditTrails() as never)).toBe(canonicalJson(first.service.auditTrails() as never));
    // The drive itself is bounded: 64 requests, 64 usage records (the replay metered, the dedupe held).
    expect(first.service.usageAll().length).toBe(64);
  });
});
