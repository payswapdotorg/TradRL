// Tests for THE CONSOLE CLIENT'S HOST-ROUTE SURFACE (FW-32-A): the two new
// mirrored calls — the standing risk-utilization read (GET
// /v1/risk/utilization?project=…, the FW-31-A route) and the research→
// decision promotion (POST /v1/jobs/:jobId/promote) — driven over a
// scripted transport, pinning the request grammar (method, path, query,
// the idempotency key on the consequential promote) and the envelope
// parse (the { requestId, data } success shape; the typed error envelope).

import { describe, expect, it } from 'vitest';
import { createConsoleClient } from './client';
import type { ApiTransport, SdkRequest, SdkResponse } from './transport';

/** One scripted transport: records every request; serves the queued responses in order. */
function scripted(responses: SdkResponse[]): { transport: ApiTransport; requests: SdkRequest[] } {
  const requests: SdkRequest[] = [];
  let cursor = 0;
  const transport: ApiTransport = async (request) => {
    requests.push(request);
    const response = responses[cursor];
    cursor += 1;
    if (response === undefined) throw new Error('scripted transport exhausted');
    return response;
  };
  return { transport, requests };
}

function ok(data: unknown): SdkResponse {
  return { status: 200, headers: {}, body: { requestId: 'req-test', data } };
}

/** The version-negotiation meta envelope (the first request every client session makes). */
function metaOk(): SdkResponse {
  return ok({ service: 'tradrl-api', supportedVersions: ['v1'], capabilities: [] });
}

function envelopeError(status: number, code: string, message: string): SdkResponse {
  return { status, headers: {}, body: { requestId: 'req-test', error: { code, message } } };
}

const UTILIZATION_READ = {
  projectId: 'proj-a',
  asOf: '2026-10-08T05:00:00.000Z',
  bounds: [{ constraintId: 'k-capital', metric: 'capital.budget', boundMax: '300000000', severity: 'blocking', current: 0, source: 'the empty sum is 0', status: 'ok' }],
  activeBreaches: [],
  disclosure: 'THE HONESTY LAW',
};

describe('the console client — the FW-32-A host-route surface', () => {
  it('risk.utilization(project) drives GET /v1/risk/utilization?project=<id> and unwraps the envelope', async () => {
    const { transport, requests } = scripted([metaOk(), ok(UTILIZATION_READ)]);
    const client = createConsoleClient({ transport, token: 'tok-test' });
    const read = await client.risk.utilization('proj-a');
    expect(read.projectId).toBe('proj-a');
    expect(read.bounds).toHaveLength(1);
    expect(read.bounds[0]?.status).toBe('ok');
    // the first request was the version negotiation; the read rides second
    expect(requests[0]?.path).toBe('/v1/meta');
    expect(requests[1]?.method).toBe('GET');
    expect(requests[1]?.path).toBe('/v1/risk/utilization?project=proj-a');
    expect(requests[1]?.headers.authorization).toBe('Bearer tok-test');
  });

  it('jobs.promote(jobId) drives POST /v1/jobs/:jobId/promote with a derived idempotency key and unwraps the { decision, replay } payload', async () => {
    const decision = {
      outcomeId: 'out:promo0001', ordinal: 1, tenant: 'tenant-a', project: 'proj-a',
      decision: { decisionRef: 'xd:promo0001', intentRef: 'si:promo0001', disposition: 'filled' },
      outcomeClass: 'no_execution', promotedFromJob: 'job:research01', decisionBody: 'desk:research-promotion',
      asOf: 1, priorChainHead: '00000000',
    };
    const { transport, requests } = scripted([metaOk(), ok({ decision, replay: true }), ok({ decision, replay: true })]);
    const client = createConsoleClient({ transport, token: 'tok-test' });
    const promotion = await client.jobs.promote('job:research01');
    expect(promotion.replay).toBe(true);
    expect(promotion.decision.promotedFromJob).toBe('job:research01');
    expect(requests[1]?.method).toBe('POST');
    expect(requests[1]?.path).toBe('/v1/jobs/job%3Aresearch01/promote');
    expect(typeof requests[1]?.headers['idempotency-key']).toBe('string');
    expect((requests[1]?.headers['idempotency-key'] as string).length).toBeGreaterThan(0);
    // the same promote call derives the SAME key (the idempotence discipline)
    await client.jobs.promote('job:research01');
    expect(requests[2]?.path).toBe('/v1/jobs/job%3Aresearch01/promote');
    expect(requests[2]?.headers['idempotency-key']).toBe(requests[1]?.headers['idempotency-key']);
  });

  it('the typed error envelope surfaces as the typed console error (the promote route\'s 409 contract)', async () => {
    const { transport } = scripted([
      envelopeError(409, 'conflict', 'the job "job:x" is not promotable (kind learning, status complete, result training-summary)'),
    ]);
    const client = createConsoleClient({ transport, token: 'tok-test', skipNegotiation: true });
    await expect(client.jobs.promote('job:x')).rejects.toThrow(/not promotable/);
  });
});
