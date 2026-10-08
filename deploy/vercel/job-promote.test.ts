// deploy/vercel — THE RESEARCH→DECISION PROMOTION (FW-32-A, Round A
// blocker 2): the host-owned POST /v1/jobs/:jobId/promote route + the
// outcome-learning seam it drives, through the FULL function path
// (handleDeploymentRequest — the risk-utilization test's own harness
// pattern).
//
// Laws pinned here (runtime/job-promote.ts header):
//   - AUTHN FIRST — a Bearer token that is not the deployment's registered
//     developer credential is the typed 401 (the W-8 law);
//   - the job lookup answers the typed 404 (unknown and cross-tenant
//     indistinguishable — the boundary's own law);
//   - a non-promotable job answers the typed 409 (the frozen service's own
//     conflict family) with the job's actual state quoted;
//   - THE MINT cites the job + its deliverable honestly (the audit
//     rationale names the job id, the spec id + version, the completion
//     instant, and the no-execution truth); the record passes the
//     boundary's own structural mirror guard;
//   - IDEMPOTENT PER JOB — promoting twice returns the SAME record with
//     replay=true, never a duplicate;
//   - THE SEAM — the minted decision serves through the FROZEN
//     /v1/outcomes/query read (the org's own decision stream), deduped by
//     outcomeId, and NOT through /v1/post-mortems/query (a promotion mints
//     no post-mortem);
//   - L12 — a foreign tenant's promotion lookup finds nothing (the 404);
//   - no CORS headers are ever emitted (the same-origin law).

import { describe, expect, it } from 'vitest';
import { composeDeployment } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { demoCreateProjectRequest } from './runtime/demo';
import {
  createPromotionRegistry,
  mintPromotedDecision,
  outcomeLearningWithPromotedDecisions,
  serveJobPromoteRoute,
  promotedDecisionIsValid,
  type PromotedDecisionRecord,
} from './runtime/job-promote';
import { isOutcomeRecordMirror, type JobRecord, type OutcomeLearningPort, type TimestampMs } from '../../services/api/src/index';
import type { FunctionRequest, FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// Helpers (the risk-utilization test's own harness pattern)
// ---------------------------------------------------------------------------

const VALID_ENV = {
  [API_ENV_KEYS.apiDeveloperToken]: 'tok-promote-demo',
  [API_ENV_KEYS.apiDeveloperTenant]: 'tenant-promote',
  [API_ENV_KEYS.apiDeveloperPrincipal]: 'public-console',
  [API_ENV_KEYS.apiInternalToken]: 'tok-promote-internal',
  [API_ENV_KEYS.apiInternalPrincipal]: 'machinery',
};

function apiEnv(overrides: Record<string, string> = {}) {
  return readApiEnv({ ...VALID_ENV, ...overrides });
}

const BEARER = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
const INTERNAL = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiInternalToken]}` };

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
    setHeader(key: string, value: number | string) {
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

/** Submit a research job through the REAL public route + complete it through the REAL private plane (the demo machinery's own transitions). */
async function completedResearchJob(deployment: ReturnType<typeof composeDeployment>, projectId: string): Promise<JobRecord> {
  const submitted = await drive(deployment, streamingRequest({
    method: 'POST',
    url: '/v1/jobs/research',
    headers: { ...BEARER, 'idempotency-key': 'idem:promote-test:research' },
    body: { kind: 'research', projectId, spec: { objective: 'the promotion test run', notes: 'FW-32-A' } },
  }));
  expect(submitted.status).toBe(202);
  const job = submitted.body.data as unknown as JobRecord;
  const transitioned = await drive(deployment, streamingRequest({
    method: 'POST',
    url: '/internal/jobs/transitions',
    headers: INTERNAL,
    body: { jobId: job.jobId, status: 'complete', at: Date.now(), result: { kind: 'release-candidate', specId: 'spec-promote-test', version: 3, project: projectId } },
  }));
  expect(transitioned.status).toBe(200);
  return transitioned.body.data as unknown as JobRecord;
}

// ---------------------------------------------------------------------------
// The route contract (through the full function path)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the research→decision promotion route (FW-32-A, Round A blocker 2)', () => {
  it('mints a decision citing the job + its deliverable, and the decision serves through the FROZEN /v1/outcomes/query read (the same seam the org decision stream rides)', async () => {
    const deployment = composeDeployment(apiEnv(), {});
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) throw new Error('unreachable');
    // A project to submit into (the full pipeline — the demo seed's own
    // create-project request shape, scoped to THIS composition's tenant).
    const created = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/projects',
      headers: { ...BEARER, 'idempotency-key': 'idem:promote-test:project' },
      body: demoCreateProjectRequest(VALID_ENV[API_ENV_KEYS.apiDeveloperTenant], 'prj-promo0001'),
    }));
    expect(created.status).toBe(201);
    const job = await completedResearchJob(deployment, 'prj-promo0001');

    // THE PROMOTION — the host-owned route, before the boundary wrap.
    const promoted = await drive(deployment, streamingRequest({
      method: 'POST',
      url: `/v1/jobs/${encodeURIComponent(job.jobId)}/promote`,
      headers: BEARER,
    }));
    expect(promoted.status).toBe(200);
    const decision = promoted.body.data as unknown as { decision: PromotedDecisionRecord; replay: boolean };
    expect(decision.replay).toBe(false);
    // The record passes the boundary's own structural guard (the mirror law).
    expect(promotedDecisionIsValid(decision.decision)).toBe(true);
    expect(isOutcomeRecordMirror(decision.decision)).toBe(true);
    // The honest citation: the job, the deliverable, the backlink.
    expect(decision.decision.promotedFromJob).toBe(job.jobId);
    expect(decision.decision.decisionBody).toBe('desk:research-promotion');
    expect(decision.decision.decisionRationale).toContain(job.jobId);
    expect(decision.decision.decisionRationale).toContain('spec-promote-test');
    expect(decision.decision.decisionRationale).toContain('version 3');
    expect(decision.decision.decisionRationale).toContain('no execution');
    expect(decision.decision.outcomeClass).toBe('no_execution');
    expect(decision.decision.project).toBe('prj-promo0001');
    expect(decision.decision.tenant).toBe('tenant-promote');
    // No CORS headers (the same-origin law).
    expect(Object.keys(promoted.headers).some((key) => key.toLowerCase() === 'access-control-allow-origin')).toBe(false);

    // THE SEAM: the minted decision serves through the FROZEN outcome read —
    // the org's own decision stream, deduped by outcomeId.
    const outcomes = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/outcomes/query',
      headers: BEARER,
      body: { project: 'prj-promo0001', at: Date.now() },
    }));
    expect(outcomes.status).toBe(200);
    const servedRows = ((outcomes.body.data as { items: unknown[] }).items) as PromotedDecisionRecord[];
    const served = servedRows.find((row) => row.outcomeId === decision.decision.outcomeId);
    expect(served).toBeDefined();
    expect(served?.promotedFromJob).toBe(job.jobId);
    // Idempotent on the read too: exactly ONE promoted row for the job.
    expect(servedRows.filter((row) => (row as { promotedFromJob?: string }).promotedFromJob === job.jobId)).toHaveLength(1);
    // A promotion mints NO post-mortem (the wrapper's own law).
    const postMortems = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/post-mortems/query',
      headers: BEARER,
      body: { project: 'prj-promo0001', at: Date.now(), latestPerOutcome: true },
    }));
    expect(((postMortems.body.data as { items: unknown[] }).items)).toHaveLength(0);

    // IDEMPOTENT PER JOB: promoting twice returns the SAME record, replay=true.
    const replay = await drive(deployment, streamingRequest({
      method: 'POST',
      url: `/v1/jobs/${encodeURIComponent(job.jobId)}/promote`,
      headers: BEARER,
    }));
    expect(replay.status).toBe(200);
    expect((replay.body.data as { replay: boolean }).replay).toBe(true);
    expect((replay.body.data as { decision: PromotedDecisionRecord }).decision).toEqual(decision.decision);
  });

  it('answers the typed 401 for a missing or wrong credential (authn first — the W-8 law)', async () => {
    const deployment = composeDeployment(apiEnv(), {});
    if (!deployment.ok) throw new Error('unreachable');
    const job = await completedResearchJob(deployment, 'prj-promo0001');
    const cases: Record<string, string>[] = [{}, { authorization: 'Bearer tok-wrong' }];
    for (const headers of cases) {
      const refused = await drive(deployment, streamingRequest({ method: 'POST', url: `/v1/jobs/${encodeURIComponent(job.jobId)}/promote`, headers }));
      expect(refused.status).toBe(401);
      expect((refused.body.error as { code: string }).code).toBe('unauthenticated');
    }
  });

  it('answers the typed 404 for an unknown job (and a foreign tenant stays indistinguishable)', async () => {
    const deployment = composeDeployment(apiEnv(), {});
    if (!deployment.ok) throw new Error('unreachable');
    const missing = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/jobs/job:does-not-exist/promote', headers: BEARER }));
    expect(missing.status).toBe(404);
    expect((missing.body.error as { code: string }).code).toBe('not_found');
  });

  it('answers the typed 409 for a job that is not a completed research release candidate (the actual state quoted, never fabricated eligibility)', async () => {
    const deployment = composeDeployment(apiEnv(), {});
    if (!deployment.ok) throw new Error('unreachable');
    // A research job still RUNNING: promotable gate refuses honestly.
    const submitted = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/jobs/research',
      headers: { ...BEARER, 'idempotency-key': 'idem:promote-test:running' },
      body: { kind: 'research', projectId: 'prj-promo0001', spec: { objective: 'still running' } },
    }));
    expect(submitted.status).toBe(202);
    const runningJob = submitted.body.data as unknown as JobRecord;
    const tooEarly = await drive(deployment, streamingRequest({ method: 'POST', url: `/v1/jobs/${encodeURIComponent(runningJob.jobId)}/promote`, headers: BEARER }));
    expect(tooEarly.status).toBe(409);
    expect((tooEarly.body.error as { code: string }).code).toBe('conflict');
    expect((tooEarly.body.error as { message: string }).message).toContain('status submitted');

    // A completed LEARNING job (training summary): same typed refusal.
    const learning = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/jobs/learning',
      headers: { ...BEARER, 'idempotency-key': 'idem:promote-test:learning' },
      body: { kind: 'learning', projectId: 'prj-promo0001', spec: { objective: 'train' } },
    }));
    expect(learning.status).toBe(202);
    const learningJob = learning.body.data as unknown as JobRecord;
    await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/internal/jobs/transitions',
      headers: INTERNAL,
      body: { jobId: learningJob.jobId, status: 'complete', at: Date.now(), result: { kind: 'training-summary', epochs: 3, project: 'prj-promo0001' } },
    }));
    const wrongKind = await drive(deployment, streamingRequest({ method: 'POST', url: `/v1/jobs/${encodeURIComponent(learningJob.jobId)}/promote`, headers: BEARER }));
    expect(wrongKind.status).toBe(409);
    expect((wrongKind.body.error as { message: string }).message).toContain('kind learning');
  });

  it('falls through to the boundary (the typed not-found) when the composition does not own the world (port overrides — the pre-law)', async () => {
    // An overridden port set owns its own world: the registry is absent and
    // the promote route never registers — the boundary answers for the path.
    const deployment = composeDeployment(apiEnv(), { firmMemory: { queryKnowledge: () => ({ ok: true, value: [] }) } });
    if (!deployment.ok) throw new Error('unreachable');
    expect(deployment.promotions).toBeNull();
    const fellThrough = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/jobs/job:anything/promote', headers: BEARER }));
    expect(fellThrough.status).toBe(404);
    expect((fellThrough.body.error as { code: string }).code).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// The unit surface (the mint + the registry + the wrapper, driven directly)
// ---------------------------------------------------------------------------

describe('runtime/job-promote — the mint, the registry and the seam wrapper (unit)', () => {
  const JOB_ID = 'job:promote01' as JobRecord['jobId'];
  const TENANT_ID = 'tenant-promote' as JobRecord['tenant'];
  const PROJECT_ID = 'prj-promo0001' as JobRecord['project'];
  const JOB: JobRecord = {
    jobId: JOB_ID,
    kind: 'research',
    tenant: TENANT_ID,
    project: PROJECT_ID,
    status: 'complete',
    submittedAt: 1_700_000_000_000,
    completedAt: 1_700_000_008_000,
    result: { kind: 'release-candidate', specId: 'spec-demo-director', version: 1, project: PROJECT_ID },
  };

  it('mints a deterministic, guard-passing record (identical inputs -> identical bytes)', () => {
    const first = mintPromotedDecision('tenant-promote', JOB, 1_700_000_100_000);
    const second = mintPromotedDecision('tenant-promote', JOB, 1_700_000_100_000);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(promotedDecisionIsValid(first)).toBe(true);
    expect(first.outcomeId).toMatch(/^out:/);
    expect(first.decision.decisionRef).toMatch(/^xd:/);
    expect(first.decision.intentRef).toMatch(/^si:/);
    expect(first.asOf).toBe(1_700_000_100_000);
    expect(first.lineage.shadow.sessionId).toMatch(/^shs:/);
    expect(first.lineage.shadowOutcomeRef).toMatch(/^swo:/);
  });

  it('refuses to mint for a job with no release-candidate result (loud — never a fabricated promotion)', () => {
    const notCandidate = { ...JOB, result: { kind: 'training-summary', epochs: 3 } } as unknown as JobRecord;
    expect(() => mintPromotedDecision('tenant-promote', notCandidate, 1)).toThrow(/release-candidate/);
  });

  it('keys the registry on tenant + job (L12: a foreign tenant finds nothing) and replays verbatim', () => {
    const registry = createPromotionRegistry();
    const first = registry.record('tenant-promote', JOB, 1_700_000_100_000);
    expect(first.replay).toBe(false);
    const replay = registry.record('tenant-promote', JOB, 1_700_000_999_999);
    expect(replay.replay).toBe(true);
    expect(replay.decision).toEqual(first.decision); // the FIRST mint stands — the later instant never rewrites it
    expect(registry.outcomesOf('tenant-promote', 'prj-promo0001')).toHaveLength(1);
    expect(registry.outcomesOf('tenant-other', 'prj-promo0001')).toHaveLength(0); // L12
    expect(registry.outcomesOf('tenant-promote', 'prj-other')).toHaveLength(0);
    expect(registry.decisionOfJob('tenant-promote', JOB.jobId)).toEqual(first.decision);
    expect(registry.decisionOfJob('tenant-other', JOB.jobId)).toBeNull();
  });

  it('wraps the outcome port: the promoted rows serve alongside the base rows, deduped by outcomeId; the post-mortem read passes through untouched', () => {
    const QUERY_AT = 1_700_000_200_000 as TimestampMs;
    const registry = createPromotionRegistry();
    const minted = registry.record('tenant-promote', JOB, 1_700_000_100_000).decision;
    const baseRow = mintPromotedDecision('tenant-promote', { ...JOB, jobId: 'job:base000001' as JobRecord['jobId'] }, 1_700_000_100_000);
    const inner: OutcomeLearningPort = {
      queryOutcomes: () => ({ ok: true, value: [baseRow] }),
      queryPostMortems: () => ({ ok: true, value: [] }),
    };
    const wrapped = outcomeLearningWithPromotedDecisions(inner, registry.outcomesOf);
    const served = wrapped.queryOutcomes({ tenant: 'tenant-promote', project: 'prj-promo0001' }, { at: QUERY_AT, retention: null });
    expect(served.ok).toBe(true);
    if (!served.ok) throw new Error('unreachable');
    expect(served.value).toHaveLength(2); // base + promoted
    expect(served.value.some((row) => row.outcomeId === minted.outcomeId)).toBe(true);
    // A base row that already carries the promoted id is never duplicated.
    const dedupInner: OutcomeLearningPort = {
      queryOutcomes: () => ({ ok: true, value: [baseRow, minted] }),
      queryPostMortems: () => ({ ok: true, value: [] }),
    };
    const deduped = outcomeLearningWithPromotedDecisions(dedupInner, registry.outcomesOf).queryOutcomes({ tenant: 'tenant-promote', project: 'prj-promo0001' }, { at: QUERY_AT, retention: null });
    expect(deduped.ok && deduped.value).toHaveLength(2);
    // The base port's typed failure passes through untouched (R46).
    const failing: OutcomeLearningPort = {
      queryOutcomes: () => ({ ok: false, error: { code: 'degraded', message: 'projection degraded' } }),
      queryPostMortems: () => ({ ok: true, value: [] }),
    };
    const passedThrough = outcomeLearningWithPromotedDecisions(failing, registry.outcomesOf).queryOutcomes({ tenant: 'tenant-promote', project: 'prj-promo0001' }, { at: QUERY_AT, retention: null });
    expect(passedThrough.ok).toBe(false);
  });

  it('the route unit: non-matching paths and methods fall through (null — the pre-FW-32-A behavior)', () => {
    const registry = createPromotionRegistry();
    const input = {
      verifyDeveloperAuthorization: (authorization: string | undefined) => (authorization === 'Bearer tok' ? { tenant: 'tenant-promote', principal: 'p' } : null),
      jobs: () => [JOB],
      promotions: registry,
    };
    expect(serveJobPromoteRoute(input, { method: 'GET', path: '/v1/jobs/job:promote01/promote', headers: {} }, 1)).toBeNull();
    expect(serveJobPromoteRoute(input, { method: 'POST', path: '/v1/jobs', headers: {} }, 2)).toBeNull();
    expect(serveJobPromoteRoute(input, { method: 'POST', path: '/v1/execution/requests', headers: {} }, 3)).toBeNull();
  });
});
