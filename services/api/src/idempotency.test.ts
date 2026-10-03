/**
 * @tradrl/api-service — the idempotency tests (the consequential-route
 * law: "Idempotency keys REQUIRED on consequential routes (execution
 * requests, job submissions) — replays dedupe to the original
 * result").
 *
 * Covers: the REQUIRED-key law (missing key -> typed 400
 * idempotency_required on execution + both job routes); the replay
 * law (same credential + same route + same key + same body -> the
 * ORIGINAL response byte-identical, marked
 * `x-idempotent-replay: true`, ZERO backing-service calls); the
 * conflict law (same key, DIFFERENT body -> typed 409
 * idempotency_conflict — the first stands); key scoping (another
 * caller or another route with the same key is a DIFFERENT
 * operation); and the determinism law (the stored fingerprint is the
 * canonical body digest — identical bytes, identical verdicts).
 */

import { describe, expect, it } from 'vitest';

import {
  PROJECT_A,
  TENANT_A,
  TENANT_B,
  TOKEN_A,
  TOKEN_B,
  T0,
  errorOf,
  fixtureService,
  request,
  validStrategyIntent,
} from './fixtures';

function keyed(token: string, key: string | undefined, method: string, path: string, body: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (key !== undefined) headers['idempotency-key'] = key;
  return { method, path, headers, body };
}

describe('the REQUIRED-key law', () => {
  it('an execution request without a key is the typed 400 idempotency_required', () => {
    const { service, bundle } = fixtureService();
    const response = service.handle(keyed(TOKEN_A, undefined, 'POST', '/v1/execution/requests', { intent: validStrategyIntent(TENANT_A, PROJECT_A) }) as never) as never as { status: number; body: unknown };
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('idempotency_required');
    expect(bundle.gateway.submitted.length).toBe(0);
  });

  it('research and learning job submissions without keys are the same typed error', () => {
    const { service, bundle } = fixtureService();
    for (const path of ['/v1/jobs/research', '/v1/jobs/learning']) {
      const response = service.handle(keyed(TOKEN_A, undefined, 'POST', path, { kind: path.endsWith('research') ? 'research' : 'learning', projectId: 'project-keys', spec: {} }) as never) as never as { status: number; body: unknown };
      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe('idempotency_required');
    }
    expect(bundle.jobs.submissions.length).toBe(0);
  });
});

describe('the replay law (replays dedupe to the original result)', () => {
  it('the same key + body replays the ORIGINAL response byte-identically with the replay marker and zero new calls', () => {
    const intent = validStrategyIntent(TENANT_A, PROJECT_A, 1);
    const { service, bundle } = fixtureService();
    const first = service.handle(keyed(TOKEN_A, 'idem:replay:1', 'POST', '/v1/execution/requests', { intent }) as never) as never as { status: number; body: unknown; headers: Record<string, string> };
    expect(bundle.gateway.submitted.length).toBe(1);

    const replay = service.handle(keyed(TOKEN_A, 'idem:replay:1', 'POST', '/v1/execution/requests', { intent }) as never) as never as { status: number; body: unknown; headers: Record<string, string> };
    expect(replay.status).toBe(first.status);
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(first.body));
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    expect(first.headers['x-idempotent-replay']).toBeUndefined();
    expect(bundle.gateway.submitted.length).toBe(1); // ZERO new calls.
  });

  it('job submissions replay the same way (the async pattern\'s submission is deduped)', () => {
    const { service, bundle } = fixtureService();
    const body = { kind: 'research', projectId: 'project-replay-jobs', spec: { question: 'lag structure' } };
    const first = service.handle(keyed(TOKEN_A, 'idem:job:replay', 'POST', '/v1/jobs/research', body) as never) as never as { status: number; body: unknown };
    const replay = service.handle(keyed(TOKEN_A, 'idem:job:replay', 'POST', '/v1/jobs/research', body) as never) as never as { status: number; body: unknown; headers: Record<string, string> };
    expect(replay.status).toBe(first.status);
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(first.body));
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    expect(bundle.jobs.submissions.length).toBe(1);
  });

  it('a replayed FAILURE also dedupes (a refused execution replays as refused, without a second gate run)', () => {
    const refused = {
      kind: 'refused' as const,
      submissionId: 'xgs:00000001',
      decisionId: null,
      auditId: 'xga:00000002',
      refusal: { stage: 'rate_budget' as const, venue: 'BROKER-FIX', budget: 5, observed: 5, windowMs: 60_000 },
      refusedAt: T0 as never,
    };
    const intent = validStrategyIntent(TENANT_A, PROJECT_A, 2);
    const { service, bundle } = fixtureService({ gatewayScript: () => refused });
    const first = service.handle(keyed(TOKEN_A, 'idem:replay:refused', 'POST', '/v1/execution/requests', { intent }) as never) as never as { status: number; body: unknown };
    const replay = service.handle(keyed(TOKEN_A, 'idem:replay:refused', 'POST', '/v1/execution/requests', { intent }) as never) as never as { status: number; body: unknown };
    expect(replay.status).toBe(first.status);
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(first.body));
    expect(bundle.gateway.submitted.length).toBe(1);
  });
});

describe('the conflict law (the first completion stands)', () => {
  it('the same key with a DIFFERENT body is the typed 409 idempotency_conflict', () => {
    const { service, bundle } = fixtureService();
    const intentA = validStrategyIntent(TENANT_A, PROJECT_A, 3);
    const intentB = validStrategyIntent(TENANT_A, PROJECT_A, 4);
    const first = service.handle(keyed(TOKEN_A, 'idem:conflict:1', 'POST', '/v1/execution/requests', { intent: intentA }) as never) as never as { status: number };
    expect(first.status).toBe(200);
    const conflict = service.handle(keyed(TOKEN_A, 'idem:conflict:1', 'POST', '/v1/execution/requests', { intent: intentB }) as never) as never as { status: number; body: unknown };
    expect(conflict.status).toBe(409);
    expect(errorOf(conflict).code).toBe('idempotency_conflict');
    expect(errorOf(conflict).message).toContain('the first completion stands');
    expect(bundle.gateway.submitted.length).toBe(1);
  });

  it('a different key with the same body is a NEW operation (no false dedupe)', () => {
    const intent = validStrategyIntent(TENANT_A, PROJECT_A, 5);
    const { service, bundle } = fixtureService();
    service.handle(keyed(TOKEN_A, 'idem:distinct:1', 'POST', '/v1/execution/requests', { intent }) as never);
    service.handle(keyed(TOKEN_A, 'idem:distinct:2', 'POST', '/v1/execution/requests', { intent }) as never);
    expect(bundle.gateway.submitted.length).toBe(2);
  });
});

describe('key scoping (the dedupe identity is credential + route + key)', () => {
  it('another CREDENTIAL with the same key is a different operation', () => {
    const intentB = validStrategyIntent(TENANT_B, 'project-beta-1', 6);
    const { service, bundle } = fixtureService();
    service.handle(keyed(TOKEN_A, 'idem:shared-key', 'POST', '/v1/execution/requests', { intent: validStrategyIntent(TENANT_A, PROJECT_A, 7) }) as never);
    const response = service.handle(keyed(TOKEN_B, 'idem:shared-key', 'POST', '/v1/execution/requests', { intent: intentB }) as never) as never as { status: number };
    expect(response.status).toBe(200);
    expect(bundle.gateway.submitted.length).toBe(2);
  });

  it('another ROUTE with the same key is a different operation', () => {
    const { service, bundle } = fixtureService();
    service.handle(keyed(TOKEN_A, 'idem:cross-route', 'POST', '/v1/jobs/research', { kind: 'research', projectId: 'project-xroute', spec: { a: 1 } }) as never);
    service.handle(keyed(TOKEN_A, 'idem:cross-route', 'POST', '/v1/jobs/learning', { kind: 'learning', projectId: 'project-xroute', spec: { b: 2 } }) as never);
    expect(bundle.jobs.submissions.length).toBe(2);
  });
});

describe('the determinism law (the fingerprint is the canonical body digest)', () => {
  it('key-order differences in the SAME body are the SAME operation (canonical JSON)', () => {
    const intent = validStrategyIntent(TENANT_A, PROJECT_A, 8);
    const { service, bundle } = fixtureService();
    const first = service.handle(keyed(TOKEN_A, 'idem:canonical', 'POST', '/v1/execution/requests', { intent, extra: { a: 1, b: 2 } }) as never) as never as { status: number; body: unknown };
    // The same body with keys in a different insertion order.
    const reordered = { extra: { b: 2, a: 1 }, intent };
    const replay = service.handle(keyed(TOKEN_A, 'idem:canonical', 'POST', '/v1/execution/requests', reordered) as never) as never as { status: number; body: unknown; headers: Record<string, string> };
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(first.body));
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    expect(bundle.gateway.submitted.length).toBe(1);
  });
});

void request;
