// deploy/vercel/runtime.test.ts — the function-side runtime tests (T052 + W-3f).
//
// Pure, offline, deterministic: NO live provider calls, NO network, NO
// real Vercel. What is pinned:
//   - the HTTP adaptation vectors (the mount-prefix strip, the query
//     parse, the body parse, the response write — including the
//     NO-CORS law);
//   - the composition: the typed not-configured state, the backing
//     resolution matrix (W-3f: demo/durable/degraded), the real T041
//     pipeline end-to-end, the L12 tenant-injection probes, and the
//     demo machinery (the internal-plane drives the API-owned stores
//     through the REAL private routes).
//
// Spec anchors: R41/R43/R46, ARCHITECTURE-LOCK L12/L20, UX-DESIGN §7,
// D-033.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeDeployment, DEPLOY_ADAPTER_PENDING, degradedPorts, getDeploymentService } from './runtime/compose';
import { API_ENV_KEYS, DURABLE_PROVIDER_ENV_KEYS, missingApiEnvKeys, readApiEnv, readConsoleEnv, resolveDeployBacking } from './runtime/env';
import {
  DEMO_JOB_COMPLETE_AFTER_MS,
  DEMO_JOB_RUNNING_AFTER_MS,
  DEMO_ORGANIZATION_REF,
  DEMO_PROJECT_ID,
  demoOutcomeRecordIsValid,
  demoPostMortemRecordIsValid,
} from './runtime/demo';
import { validStrategyIntent } from '../../services/api/src/fixtures';
import { FUNCTION_MOUNT_PATH, publicPathOf, queryOf, readJsonBody, toApiRequest, writeApiResponse, writeDegraded, type FunctionRequest, type FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_ENV = {
  [API_ENV_KEYS.apiDeveloperToken]: 'tok-deploy-demo',
  [API_ENV_KEYS.apiDeveloperTenant]: 'tenant-demo',
  [API_ENV_KEYS.apiDeveloperPrincipal]: 'public-console',
};

function apiEnv(overrides: Record<string, string> = {}) {
  return readApiEnv({ ...VALID_ENV, ...overrides });
}

/** A minimal streaming request (the raw-body path). */
function streamingRequest(parts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  chunks?: string[];
  body?: unknown;
}): FunctionRequest {
  const chunks = parts.chunks ?? [];
  return {
    method: parts.method ?? 'GET',
    url: parts.url ?? '/v1/meta',
    headers: parts.headers ?? {},
    body: parts.body,
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          return index < chunks.length ? { value: chunks[index++] as string, done: false } : { value: undefined, done: true };
        },
      };
    },
  };
}

/** A response capturer (asserts the no-CORS law on every write). */
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
    setHeader(key: string, value: string | number) {
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

// ---------------------------------------------------------------------------
// The path law (the mount-prefix strip — pinned vectors)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the HTTP path adaptation', () => {
  it('strips the function mount from the rewritten URL and passes the public path verbatim', () => {
    expect(publicPathOf(`${FUNCTION_MOUNT_PATH}/v1/meta`)).toBe('/v1/meta');
    expect(publicPathOf(`${FUNCTION_MOUNT_PATH}/v1/projects/prj_alpha?cursor=cur%3Aabc`)).toBe('/v1/projects/prj_alpha');
    expect(publicPathOf(`${FUNCTION_MOUNT_PATH}/internal/usage/tenant-beta`)).toBe('/internal/usage/tenant-beta');
  });

  it('accepts the already-public path (direct function invocation) and degrades empty paths to the root', () => {
    expect(publicPathOf('/v1/meta')).toBe('/v1/meta');
    expect(publicPathOf('/internal/jobs/transitions?x=1')).toBe('/internal/jobs/transitions');
    expect(publicPathOf(FUNCTION_MOUNT_PATH)).toBe('/');
    expect(publicPathOf(`${FUNCTION_MOUNT_PATH}/`)).toBe('/');
    expect(publicPathOf(undefined)).toBe('/');
    expect(publicPathOf('')).toBe('/');
  });

  it('percent-decodes each PATH segment (the console encodes path parameters; the route table expects decoded ids) — W-3f', () => {
    // The console's client: `/v1/jobs/${encodeURIComponent('job:abc123')}`.
    expect(publicPathOf(`${FUNCTION_MOUNT_PATH}/v1/jobs/job%3Aabc123`)).toBe('/v1/jobs/job:abc123');
    expect(publicPathOf('/v1/organizations/org%3Atradrl-demo/status')).toBe('/v1/organizations/org:tradrl-demo/status');
    // An encoded slash decodes to the separator (a '/'-bearing id is unaddressable
    // by the route table's patterns either way — the typed not-found answers).
    expect(publicPathOf('/v1/projects/prj%2Fweird')).toBe('/v1/projects/prj/weird');
    // A malformed escape passes through (the route table's guards answer the typed error — never a crash).
    expect(publicPathOf('/v1/projects/prj-%zz')).toBe('/v1/projects/prj-%zz');
    // Unencoded colons pass verbatim (the no-encoding direct path).
    expect(publicPathOf('/v1/jobs/job:abc123')).toBe('/v1/jobs/job:abc123');
  });

  it('parses the query into the flat record (last value wins on duplicates)', () => {
    expect(queryOf(`${FUNCTION_MOUNT_PATH}/v1/projects?cursor=cur%3Aabc&limit=25`)).toEqual({ cursor: 'cur:abc', limit: '25' });
    expect(queryOf('/v1/projects?limit=1&limit=9')).toEqual({ limit: '9' });
    expect(queryOf('/v1/meta')).toEqual({});
    expect(queryOf(undefined)).toEqual({});
  });

  it('builds the ApiRequest with forwarded auth headers and parsed body (pinned vector)', async () => {
    const wrapped = await toApiRequest(
      streamingRequest({
        method: 'POST',
        url: `${FUNCTION_MOUNT_PATH}/v1/knowledge/query?cursor=cur%3Ax`,
        headers: { authorization: 'Bearer tok-1', 'idempotency-key': 'idem-7' },
        chunks: ['{"kind":"claim"', '}'],
      }),
    );
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;
    const request = wrapped.request;
    expect(request.path).toBe('/v1/knowledge/query');
    expect(request.method).toBe('POST');
    expect(request.headers.authorization).toBe('Bearer tok-1');
    expect(request.headers['idempotency-key']).toBe('idem-7');
    expect(request.query).toEqual({ cursor: 'cur:x' });
    expect(request.body).toEqual({ kind: 'claim' });
  });

  it('uses the @vercel/node pre-parsed body when present and never parses GET bodies', async () => {
    const preParsed = await toApiRequest(streamingRequest({ method: 'POST', url: '/v1/projects', body: { id: 'prj_x' } }));
    expect(preParsed.ok && preParsed.request.body).toEqual({ id: 'prj_x' });
    const asString = await toApiRequest(streamingRequest({ method: 'POST', url: '/v1/projects', body: '{"id":"prj_y"}' }));
    expect(asString.ok && asString.request.body).toEqual({ id: 'prj_y' });
    const get = await toApiRequest(streamingRequest({ method: 'GET', url: '/v1/meta', chunks: ['{"ignored":true}'] }));
    expect(get.ok && get.request.body).toBeUndefined();
  });

  it('malformed JSON is the typed invalid_json failure (never a throw)', async () => {
    const malformed = await toApiRequest(streamingRequest({ method: 'POST', url: '/v1/projects', chunks: ['{"nope"'] }));
    expect(malformed).toEqual({ ok: false, code: 'invalid_json' });
    expect(await readJsonBody(streamingRequest({ method: 'POST', url: '/v1/projects', body: 'not json' }))).toEqual({ ok: false, code: 'invalid_json' });
  });
});

// ---------------------------------------------------------------------------
// The response adaptation (the no-CORS law)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the HTTP response adaptation', () => {
  it('writes the pipeline envelope: status, the envelope headers, JSON body, no-store — and NO CORS headers', () => {
    const { response, captured } = capture();
    writeApiResponse(response, {
      status: 200,
      headers: { 'x-request-id': 'req_1', 'x-api-version': 'v1' },
      body: { requestId: 'req_1', data: { apiVersion: 'v1' } } as never,
    });
    const written = captured();
    expect(written.status).toBe(200);
    expect(written.headers['x-request-id']).toBe('req_1');
    expect(written.headers['x-api-version']).toBe('v1');
    expect(written.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(written.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(written.payload as string)).toEqual({ requestId: 'req_1', data: { apiVersion: 'v1' } });
    for (const key of Object.keys(written.headers)) {
      expect(key.toLowerCase()).not.toContain('access-control');
    }
  });

  it('a null body (204-style) ends with no payload', () => {
    const { response, captured } = capture();
    writeApiResponse(response, { status: 204, headers: {}, body: null });
    expect(captured().status).toBe(204);
    expect(captured().payload).toBeNull();
  });

  it('the degraded writes carry the typed code and never a CORS header', () => {
    const { response, captured } = capture();
    writeDegraded(response, 503, 'deploy_not_configured', 'TRADRL_API_DEVELOPER_TOKEN missing');
    const written = captured();
    expect(written.status).toBe(503);
    expect(JSON.parse(written.payload as string)).toEqual({ error: { code: 'deploy_not_configured', message: 'TRADRL_API_DEVELOPER_TOKEN missing' } });
    expect(Object.keys(written.headers).every((key) => !key.toLowerCase().includes('access-control'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The environment reader (typed presence, names-only errors)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the environment reader', () => {
  it('absent keys are null (never an exception) and the missing list carries KEY NAMES ONLY', () => {
    const empty = readApiEnv({});
    expect(empty.apiDeveloperToken).toBeNull();
    expect(empty.apiInternalToken).toBeNull();
    expect(missingApiEnvKeys(empty)).toEqual([
      API_ENV_KEYS.apiDeveloperToken,
      API_ENV_KEYS.apiDeveloperTenant,
      API_ENV_KEYS.apiDeveloperPrincipal,
    ]);
  });

  it('the internal plane is optional: a token without a principal is the only internal-side gap', () => {
    expect(missingApiEnvKeys(apiEnv({ [API_ENV_KEYS.apiInternalToken]: 'tok-int' }))).toEqual([API_ENV_KEYS.apiInternalPrincipal]);
    expect(missingApiEnvKeys(apiEnv({ [API_ENV_KEYS.apiInternalToken]: 'tok-int', [API_ENV_KEYS.apiInternalPrincipal]: 'job-runner' }))).toEqual([]);
    expect(missingApiEnvKeys(apiEnv())).toEqual([]);
  });

  it('the console env defaults simulated=true (the anti-deception badge) until the real adapters land', () => {
    expect(readConsoleEnv({}).consoleSimulated).toBe(true);
    expect(readConsoleEnv({ TRADRL_CONSOLE_SIMULATED: 'false' }).consoleSimulated).toBe(false);
    expect(readConsoleEnv({ TRADRL_CONSOLE_SIMULATED: 'true' }).consoleSimulated).toBe(true);
  });

  it('the backing fields: the explicit override (raw — validated at the seam) + the durable-provider key PRESENCE (names only)', () => {
    const empty = readApiEnv({});
    expect(empty.deployBacking).toBeNull();
    expect(empty.durableProviderKeysPresent).toEqual([]);
    expect(readApiEnv({ TRADRL_DEPLOY_BACKING: 'demo' }).deployBacking).toBe('demo');
    const partial = readApiEnv({ NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech', UPSTASH_REDIS_REST_URL: 'https://demo.upstash.io' });
    expect(partial.durableProviderKeysPresent).toEqual(['NEON_API_HOST', 'UPSTASH_REDIS_REST_URL']); // NAMES, never values
  });

  it('resolveDeployBacking: demo by default, durable the moment any durable-provider key exists, explicit values win', () => {
    expect(resolveDeployBacking(readApiEnv({}))).toBe('demo');
    expect(resolveDeployBacking(readApiEnv({ NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech' }))).toBe('durable');
    expect(resolveDeployBacking(readApiEnv({ UPSTASH_REDIS_REST_TOKEN: 'demo-token' }))).toBe('durable');
    expect(resolveDeployBacking(readApiEnv({ TRADRL_DEPLOY_BACKING: 'demo', NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech' }))).toBe('demo');
    expect(resolveDeployBacking(readApiEnv({ TRADRL_DEPLOY_BACKING: 'durable' }))).toBe('durable');
    // An unknown raw value is NOT resolved here — the composition seam fails closed on it.
    expect(resolveDeployBacking(readApiEnv({ TRADRL_DEPLOY_BACKING: 'banana' }))).toBe('demo');
  });

  it('TRIP-WIRE — every DURABLE_PROVIDER_ENV_KEYS name is a key the wire composition actually reads (the single provider implementation)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const compositionSource = readFileSync(join(here, '../wire/composition.ts'), 'utf8');
    for (const key of DURABLE_PROVIDER_ENV_KEYS) {
      expect(compositionSource.includes(`'${key}'`)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The composition seam (the backing resolution matrix — W-3f)
// ---------------------------------------------------------------------------

/** A full fake durable-provider set (VALUES are fake; only presence matters). */
const DURABLE_KEYS = {
  NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech',
  NEON_DATABASE: 'neondb',
  NEON_API_USER: 'neondb_owner',
  NEON_API_KEY: 'demo-not-a-real-password',
  UPSTASH_REDIS_REST_URL: 'https://demo.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'demo-not-a-real-token',
};

describe('deploy/vercel — the composition seam (the backing resolution matrix)', () => {
  it('a missing environment is the typed deploy_not_configured state (key names only — never values)', () => {
    const result = composeDeployment(readApiEnv({}));
    expect(result).toEqual({ ok: false, code: 'deploy_not_configured', missing: [API_ENV_KEYS.apiDeveloperToken, API_ENV_KEYS.apiDeveloperTenant, API_ENV_KEYS.apiDeveloperPrincipal] });
  });

  it('an INVALID explicit TRADRL_DEPLOY_BACKING value is the typed not-configured state (fail-closed; key name + legal values, never the value)', () => {
    const result = composeDeployment(apiEnv({ TRADRL_DEPLOY_BACKING: 'banana' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('deploy_not_configured');
    expect(result.missing).toEqual(['TRADRL_DEPLOY_BACKING (must be exactly "demo" or "durable"; got an unrecognized value)']);
    for (const entry of result.missing) expect(entry.includes('banana')).toBe(false); // the VALUE never crosses into the error
  });

  it('every degraded stub port answers the typed deploy_adapter_pending failure (the DURABLE-path stubs — R46)', () => {
    const ports = degradedPorts();
    const failures = [
      ports.controlPlane.createProject({} as never),
      ports.controlPlane.getProject('tenant-a' as never, 'prj_x' as never),
      ports.controlPlane.projectsOf('tenant-a' as never),
      ports.controlPlane.transition({} as never),
      ports.controlPlane.bindOrganization({} as never),
      ports.firmMemory.queryKnowledge({} as never, {} as never),
      ports.outcomeLearning.queryOutcomes({} as never, {} as never),
      ports.outcomeLearning.queryPostMortems({} as never, {} as never),
      ports.executionGateway.submitRequest({} as never),
      ports.jobSubmission.submitJob({} as never),
    ];
    for (const failure of failures) {
      expect(failure.ok).toBe(false);
      if (failure.ok) continue;
      expect(failure.error.code).toBe(DEPLOY_ADAPTER_PENDING);
    }
  });

  it('THE MATRIX — no provider keys + no override => DEMO (the default); the demo handle is present', () => {
    const composed = composeDeployment(apiEnv());
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.backing).toBe('demo');
    expect(composed.demo).not.toBeNull();
  });

  it('THE MATRIX — an explicit "demo" override wins even when durable-provider keys are present', () => {
    const composed = composeDeployment(apiEnv({ TRADRL_DEPLOY_BACKING: 'demo', ...DURABLE_KEYS }));
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.backing).toBe('demo');
    expect(composed.demo).not.toBeNull();
  });

  it('THE MATRIX — an explicit "durable" override (even with no provider keys) => the typed pending stubs', () => {
    const composed = composeDeployment(apiEnv({ TRADRL_DEPLOY_BACKING: 'durable' }));
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.backing).toBe('durable');
    expect(composed.demo).toBeNull();
  });

  it('THE MATRIX — durable-provider keys present (full OR partial) => DURABLE; the data routes answer the typed 503 (R46 unchanged)', () => {
    for (const [label, providerKeys] of [['the full set', DURABLE_KEYS], ['a partial set (an operator opted in)', { NEON_API_HOST: DURABLE_KEYS.NEON_API_HOST }] as const] as const) {
      const composed = composeDeployment(apiEnv({ ...providerKeys }));
      expect(composed.ok, label).toBe(true);
      if (!composed.ok) continue;
      expect(composed.backing, label).toBe('durable');
      expect(composed.demo, label).toBeNull();
      const projects = composed.service.handle({
        method: 'GET',
        path: '/v1/projects',
        headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` },
        query: {},
      });
      expect(projects.status, label).toBe(503);
      const errorBody = projects.body as { error: { code: string; message: string } };
      expect(errorBody.error.code, label).toBe('unavailable');
      expect(errorBody.error.message, label).toContain(DEPLOY_ADAPTER_PENDING);
    }
  });

  it('the per-instance memo reuses one service (and one demo handle + backing) across warm invocations of the same env source', () => {
    const source = { ...VALID_ENV };
    const first = getDeploymentService(source);
    const second = getDeploymentService(source);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.backing).toBe('demo');
    expect(second.service).toBe(first.service);
    expect(second.demo).toBe(first.demo);
    expect(second.backing).toBe(first.backing);
    // A DIFFERENT env source re-composes (tests inject fresh sources).
    const third = getDeploymentService({ ...VALID_ENV });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.service).not.toBe(first.service);
  });
});

// ---------------------------------------------------------------------------
// The demo composition (the data routes really serve the fixture demo data)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the demo composition (J-catalog backing: projects, knowledge, outcomes, jobs, execution)', () => {
  it('the REAL T041 pipeline runs over the demo ports: meta answers and NO CORS-style header is emitted', () => {
    const composed = composeDeployment(apiEnv());
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const meta = composed.service.handle({ method: 'GET', path: '/v1/meta', headers: bearer });
    expect(meta.status).toBe(200);
    expect(meta.headers['x-api-version']).toBe('v1');
    for (const key of Object.keys(meta.headers)) {
      expect(key.toLowerCase()).not.toContain('access-control');
    }
  });

  it('projects are LISTABLE and readable: the seeded demo project serves through the real routes', () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const listed = composed.service.handle({ method: 'GET', path: '/v1/projects', headers: bearer, query: {} });
    expect(listed.status).toBe(200);
    const page = (listed.body as { data: { items: readonly { id: string; tenantId: string }[] } }).data;
    expect(page.items.map((project) => project.id)).toEqual([DEMO_PROJECT_ID]);
    expect(page.items.every((project) => project.tenantId === VALID_ENV[API_ENV_KEYS.apiDeveloperTenant])).toBe(true);
    const one = composed.service.handle({ method: 'GET', path: `/v1/projects/${DEMO_PROJECT_ID}`, headers: bearer });
    expect(one.status).toBe(200);
    const record = (one.body as { data: { id: string; lifecycle: { status: string } } }).data;
    expect(record.id).toBe(DEMO_PROJECT_ID);
    expect(record.lifecycle.status).toBe('draft');
  });

  it('knowledge serves the fixture demo record for the credential tenant (the body cannot steer the tenant — the pipeline injects it)', () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const query = composed.service.handle({
      method: 'POST',
      path: '/v1/knowledge/query',
      headers: bearer,
      body: { project: DEMO_PROJECT_ID, at: 1_730_000_000_000 },
    });
    expect(query.status).toBe(200);
    const data = (query.body as { data: { items: readonly { record: { tenant: string; project: string; knowledgeId: string } }[] } }).data;
    expect(data.items.length).toBe(1);
    expect(data.items[0]!.record.tenant).toBe(VALID_ENV[API_ENV_KEYS.apiDeveloperTenant]);
    expect(data.items[0]!.record.project).toBe(DEMO_PROJECT_ID);
    expect(data.items[0]!.record.knowledgeId.startsWith('fkr:')).toBe(true);
  });

  it('outcomes + post-mortems serve the demo records, and the records satisfy the boundary\'s own structural guards', () => {
    expect(demoOutcomeRecordIsValid(VALID_ENV[API_ENV_KEYS.apiDeveloperTenant], DEMO_PROJECT_ID)).toBe(true);
    expect(demoPostMortemRecordIsValid(VALID_ENV[API_ENV_KEYS.apiDeveloperTenant], DEMO_PROJECT_ID)).toBe(true);
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const outcomes = composed.service.handle({ method: 'POST', path: '/v1/outcomes/query', headers: bearer, body: { project: DEMO_PROJECT_ID, at: 1_730_000_000_000 } });
    expect(outcomes.status).toBe(200);
    const outcomeItems = (outcomes.body as { data: { items: readonly unknown[] } }).data.items;
    expect(outcomeItems.length).toBe(1);
    const postMortems = composed.service.handle({ method: 'POST', path: '/v1/post-mortems/query', headers: bearer, body: { project: DEMO_PROJECT_ID, at: 1_730_000_000_000, latestPerOutcome: true } });
    expect(postMortems.status).toBe(200);
    const postMortemItems = (postMortems.body as { data: { items: readonly unknown[] } }).data.items;
    expect(postMortemItems.length).toBe(1);
  });

  it('jobs: submit through the real route (202 + the idempotency law) and read back from the API-owned store', () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const submitted = composed.service.handle({
      method: 'POST',
      path: '/v1/jobs/research',
      headers: { ...bearer, 'idempotency-key': 'idem:demo:research:1' },
      body: { kind: 'research', projectId: DEMO_PROJECT_ID, spec: { source: 'deploy-runtime-test', feeds: ['news'] } },
    });
    expect(submitted.status).toBe(202);
    const job = (submitted.body as { data: { jobId: string; status: string; kind: string } }).data;
    expect(job.kind).toBe('research');
    expect(job.status).toBe('submitted');
    const read = composed.service.handle({ method: 'GET', path: `/v1/jobs/${job.jobId}`, headers: bearer });
    expect(read.status).toBe(200);
    expect((read.body as { data: { jobId: string } }).data.jobId).toBe(job.jobId);
  });

  it('execution: a valid intent forwards through the demo gateway port and serves the ROUTED submission (the L8 record verbatim)', () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const intent = validStrategyIntent(VALID_ENV[API_ENV_KEYS.apiDeveloperTenant], DEMO_PROJECT_ID as never);
    const response = composed.service.handle({
      method: 'POST',
      path: '/v1/execution/requests',
      headers: { ...bearer, 'idempotency-key': 'idem:demo:execution:1' },
      body: { intent },
    });
    expect(response.status).toBe(200);
    const submission = (response.body as { data: { kind: string; submissionId: string; venue: string } }).data;
    expect(submission.kind).toBe('routed');
    expect(submission.submissionId.startsWith('xgs:')).toBe(true);
    expect(submission.venue).toBe('BROKER-FIX');
  });

  it('the auth planes stay real over the demo ports: no token is 401, a wrong token is 401, the idempotency law fires as 400', () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const anonymous = composed.service.handle({ method: 'GET', path: '/v1/meta', headers: {} });
    expect(anonymous.status).toBe(401);
    const wrong = composed.service.handle({ method: 'GET', path: '/v1/meta', headers: { authorization: 'Bearer tok-wrong' } });
    expect(wrong.status).toBe(401);
    const noIdempotency = composed.service.handle({ method: 'POST', path: '/v1/execution/requests', headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` }, body: {} });
    expect(noIdempotency.status).toBe(400); // the key-missing guard precedes the port; never 500
  });
});

// ---------------------------------------------------------------------------
// The demo world seed + machinery (the internal plane drives the API-owned stores)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the demo world seed + machinery (through the REAL private routes)', () => {
  it('WITH the internal credential: the org-status snapshot is reported at boot, the project is bound, and the watch read serves it', () => {
    const composed = composeDeployment(apiEnv({ [API_ENV_KEYS.apiInternalToken]: 'tok-internal-demo', [API_ENV_KEYS.apiInternalPrincipal]: 'demo-machinery' }));
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.backing).toBe('demo');
    expect(composed.demo).not.toBeNull();
    if (composed.demo === null) return;
    expect(composed.demo.orgStatusSeeded).toBe(true);
    expect(composed.demo.tick).not.toBeNull();
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const project = composed.service.handle({ method: 'GET', path: `/v1/projects/${DEMO_PROJECT_ID}`, headers: bearer });
    expect((project.body as { data: { lifecycle: { organizationRef: string | null } } }).data.lifecycle.organizationRef).toBe(DEMO_ORGANIZATION_REF);
    const status = composed.service.handle({
      method: 'GET',
      path: `/v1/organizations/${DEMO_ORGANIZATION_REF}/status`,
      headers: bearer,
      query: { project: DEMO_PROJECT_ID },
    });
    expect(status.status).toBe(200);
    const snapshot = (status.body as { data: { tenant: string; project: string; status: string } }).data;
    expect(snapshot.tenant).toBe(VALID_ENV[API_ENV_KEYS.apiDeveloperTenant]);
    expect(snapshot.project).toBe(DEMO_PROJECT_ID);
    expect(snapshot.status).toBe('active');
  });

  it('WITHOUT the internal credential: no bind, no snapshot (the honest typed not-found), no tick — never a crash (R46)', () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    expect(composed.demo).not.toBeNull();
    if (composed.demo === null) return;
    expect(composed.demo.orgStatusSeeded).toBe(false);
    expect(composed.demo.tick).toBeNull();
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const project = composed.service.handle({ method: 'GET', path: `/v1/projects/${DEMO_PROJECT_ID}`, headers: bearer });
    expect((project.body as { data: { lifecycle: { organizationRef: string | null } } }).data.lifecycle.organizationRef).toBeNull();
    const status = composed.service.handle({
      method: 'GET',
      path: `/v1/organizations/${DEMO_ORGANIZATION_REF}/status`,
      headers: bearer,
      query: { project: DEMO_PROJECT_ID },
    });
    expect(status.status).toBe(404);
    expect((status.body as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('the machinery tick advances a submitted job through the REAL private plane: submitted -> running -> complete (idempotent at terminal)', () => {
    const composed = composeDeployment(apiEnv({ [API_ENV_KEYS.apiInternalToken]: 'tok-internal-demo', [API_ENV_KEYS.apiInternalPrincipal]: 'demo-machinery' }));
    if (!composed.ok || composed.demo === null || composed.demo.tick === null) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const tick = composed.demo.tick;
    const submitted = composed.service.handle({
      method: 'POST',
      path: '/v1/jobs/research',
      headers: { ...bearer, 'idempotency-key': 'idem:demo:machinery:1' },
      body: { kind: 'research', projectId: DEMO_PROJECT_ID, spec: { source: 'deploy-runtime-test' } },
    });
    expect(submitted.status).toBe(202);
    const job = (submitted.body as { data: { jobId: string; submittedAt: number; status: string } }).data;
    expect(job.status).toBe('submitted');

    // Before the schedule elapses: nothing advances.
    tick(job.submittedAt + DEMO_JOB_RUNNING_AFTER_MS - 1);
    const early = composed.service.handle({ method: 'GET', path: `/v1/jobs/${job.jobId}`, headers: bearer });
    expect((early.body as { data: { status: string } }).data.status).toBe('submitted');

    // The running threshold: one legal transition through the private plane.
    tick(job.submittedAt + DEMO_JOB_RUNNING_AFTER_MS + 1);
    const running = composed.service.handle({ method: 'GET', path: `/v1/jobs/${job.jobId}`, headers: bearer });
    expect((running.body as { data: { status: string } }).data.status).toBe('running');

    // The completion threshold: the research job completes with a release-candidate result.
    tick(job.submittedAt + DEMO_JOB_COMPLETE_AFTER_MS + 1);
    const complete = composed.service.handle({ method: 'GET', path: `/v1/jobs/${job.jobId}`, headers: bearer });
    const completed = (complete.body as { data: { status: string; result?: { kind?: string }; completedAt?: number } }).data;
    expect(completed.status).toBe('complete');
    expect(completed.result?.kind).toBe('release-candidate');
    expect(completed.completedAt).toBeDefined();

    // Terminal is terminal: further ticks change nothing (the legality machine refuses).
    tick(job.submittedAt + DEMO_JOB_COMPLETE_AFTER_MS + 60_000);
    const still = composed.service.handle({ method: 'GET', path: `/v1/jobs/${job.jobId}`, headers: bearer });
    expect((still.body as { data: { status: string } }).data.status).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
// The L12 probes (the demo backing)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the L12 probes through the demo ports', () => {
  it('L12 PROBE — the tenant injected into the demo-family port call is the CREDENTIAL tenant, never a query/body value', () => {
    const tenantsSeen: string[] = [];
    const demoPorts = degradedPorts(); // overridden probe base (the spy observes; the demo seed is skipped under overrides)
    const composed = composeDeployment(apiEnv(), {
      controlPlane: {
        ...demoPorts.controlPlane,
        projectsOf(tenantId) {
          tenantsSeen.push(tenantId as string);
          return { ok: true, value: [] };
        },
      },
    });
    if (!composed.ok) return;
    expect(composed.backing).toBe('demo'); // the DEMO resolution is active — the probe pins the law under it
    // An adversarial query parameter tries to steer the tenant scope.
    composed.service.handle({
      method: 'GET',
      path: '/v1/projects',
      headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` },
      query: { tenant: 'tenant:attacker', limit: '10' },
    });
    expect(tenantsSeen).toEqual([VALID_ENV[API_ENV_KEYS.apiDeveloperTenant]]);
  });

  it('L12 PROBE — the demo seed is scoped to the credential tenant: every served record carries ITS OWN composition tenant (no fixture-tenant leakage)', () => {
    // Two compositions, two credential tenants (a deployment registers ONE
    // developer credential — the L12 root). Each demo world is seeded for
    // ITS OWN tenant only; the fixture builders' own tenants
    // (tenant-alpha/tenant-beta) never leak into any served record.
    for (const tenant of [VALID_ENV[API_ENV_KEYS.apiDeveloperTenant], 'tenant-other-demo']) {
      const composed = composeDeployment(apiEnv({ [API_ENV_KEYS.apiDeveloperTenant]: tenant }));
      expect(composed.ok).toBe(true);
      if (!composed.ok) continue;
      const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
      const listed = composed.service.handle({ method: 'GET', path: '/v1/projects', headers: bearer, query: {} });
      const items = (listed.body as { data: { items: readonly { tenantId: string }[] } }).data.items;
      expect(items.length).toBe(1);
      expect(items.every((project) => project.tenantId === tenant)).toBe(true);
      const knowledge = composed.service.handle({ method: 'POST', path: '/v1/knowledge/query', headers: bearer, body: { project: DEMO_PROJECT_ID, at: 1_730_000_000_000 } });
      const knowledgeItems = (knowledge.body as { data: { items: readonly { record: { tenant: string } }[] } }).data.items;
      expect(knowledgeItems.length).toBe(1);
      expect(knowledgeItems[0]!.record.tenant).toBe(tenant);
      const outcomes = composed.service.handle({ method: 'POST', path: '/v1/outcomes/query', headers: bearer, body: { project: DEMO_PROJECT_ID, at: 1_730_000_000_000 } });
      const outcomeItems = (outcomes.body as { data: { items: readonly { tenant: string }[] } }).data.items;
      expect(outcomeItems.length).toBe(1);
      expect(outcomeItems[0]!.tenant).toBe(tenant);
    }
  });
});
