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
  compiledOrganizationRefOf,
  DEMO_CAPITAL_BUDGET,
  DEMO_EXECUTION_DESK,
  DEMO_JOB_COMPLETE_AFTER_MS,
  DEMO_JOB_RUNNING_AFTER_MS,
  DEMO_ORGANIZATION_REF,
  DEMO_PROJECT_ID,
  DEMO_RISK_BUDGET,
  demoBlotterIsValid,
  demoConstraintSet,
  demoGoalSetOf,
  demoGoalStatement,
  demoJobsOf,
  demoOutcomeRecordIsValid,
  demoOutcomeRecord,
  demoPostMortemRecordIsValid,
  demoProjectEvidenceOf,
  demoSubmissionBlotter,
  demoWorldOf,
} from './runtime/demo';
import { validCreateProjectRequest, validStrategyIntent } from '../../services/api/src/fixtures';
import { canonicalJson, isGatewaySubmissionRecord, isJobRecord, isOutcomeRecordMirror, type ApiService } from '../../services/api/src/index';
import { handleDeploymentRequest } from './api/router';
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

  it('THE MATRIX — an explicit "durable" override (even with no provider keys) => the typed degraded stubs (never a throw)', () => {
    const composed = composeDeployment(apiEnv({ TRADRL_DEPLOY_BACKING: 'durable' }));
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.backing).toBe('durable');
    expect(composed.demo).toBeNull();
    // The Neon-backed surfaces answer the typed `deploy_adapter_absent` (the
    // seam is not built — Neon's keys are incomplete; the matrix's Neon-absent
    // row); the gateway keeps the honest pending stub; jobs follow the matrix
    // for Apify (absent keys -> the typed absent). W-25D: the SEAM-LIVE law
    // (hydration + write-through + the cold-start survival) is pinned by
    // deploy/vercel/durable.test.ts.
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const projects = composed.service.handle({ method: 'GET', path: '/v1/projects', headers: bearer, query: {} });
    expect(projects.status).toBe(503);
    expect((projects.body as { error: { code: string; message: string } }).error.message).toContain('deploy_adapter_absent');
    const execution = composed.service.handle({ method: 'POST', path: '/v1/execution/requests', headers: { ...bearer, 'idempotency-key': 'idem:w25d:matrix' }, body: { intent: validStrategyIntent(VALID_ENV[API_ENV_KEYS.apiDeveloperTenant] as string, 'prj_x') } });
    expect((execution.body as { error: { message: string } }).error.message).toContain(DEPLOY_ADAPTER_PENDING);
  });

  it('THE MATRIX — durable-provider keys present (full OR partial) => DURABLE; the data routes answer the typed degraded 503s until the host awaits the projection (R46)', () => {
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
      // Full set: the seam is built, but a PURE composition makes no network
      // calls — the projection runs only when the host awaits settled() (the
      // router does; see durable.test.ts for the seam-live law).
      expect(errorBody.error.message, label).toContain(providerKeys === DURABLE_KEYS ? 'durable_projection_pending' : 'deploy_adapter_absent');
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

// ---------------------------------------------------------------------------
// The demo execution blotter (R2 — W-8: the Execution section's substance)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the demo execution blotter (R2: order ids, states, routing — never an empty placeholder)', () => {
  it('every seeded row IS the boundary\'s own GatewaySubmissionRecord shape (the guard passes on each) and carries the blotter substance', () => {
    expect(demoBlotterIsValid()).toBe(true); // the boundary's own structural guard, row for row
    // A flat row view for the assertions below (the additive fields are
    // optional on the wire; the view widens them for direct access).
    const rows = demoSubmissionBlotter() as unknown as readonly {
      kind: string; submissionId: string; auditId: string; decisionId: string | null; venue?: string; routedAt?: number; refusal?: { stage: string }; refusedAt?: number;
      order?: { instrumentId: string; side: string; quantity: string; clientOrderId: string };
      fill?: { state: string; notional: string; fee: string };
      riskChecks?: readonly { dimension: string; outcome: string }[];
    }[];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(isGatewaySubmissionRecord(row)).toBe(true);
      expect(row.submissionId).toMatch(/^xgs:[0-9a-f]{8}$/); // the boundary's own id grammar
      expect(typeof row.auditId === 'string' && row.auditId.startsWith('xga:')).toBe(true);
    }
    const buy = rows[0]!;
    const trim = rows[1]!;
    const refused = rows[2]!;
    // Row 1 — the seeded fill's own story: the 0.75 BTC-USD limit buy whose
    // notional 45750.375 / fee 0.02 the outcome record out:demo0001 carries.
    expect(buy.kind).toBe('routed');
    expect(buy.decisionId).toBe('xd:demo0001'); // the outcome record's own decision ref — one coherent tale
    expect(buy.venue).toBe('BROKER-FIX');
    expect(buy.order?.instrumentId).toBe('BTC-USD');
    expect(buy.order?.side).toBe('buy');
    expect(buy.order?.quantity).toBe('0.75');
    expect(buy.order?.clientOrderId).toBe('ord-demo-0001');
    expect(buy.fill?.state).toBe('filled');
    expect(buy.fill?.notional).toBe('45750.375');
    expect(buy.fill?.fee).toBe('0.02');
    // Row 2 — the same shadow session's trim (a sell, a second instrument).
    expect(trim.kind).toBe('routed');
    // Row 3 — the honest refusal: the hard risk gate demonstrably says no.
    expect(refused.kind).toBe('refused');
    expect(refused.refusal?.stage).toBe('risk_limits');
    expect(refused.riskChecks).toEqual([{ dimension: 'risk_limits', outcome: 'refused' }]);
    expect(typeof refused.refusedAt).toBe('number');
  });

  it('the host route GET /v1/execution/submissions serves the seeded blotter through the FULL function handler (the page envelope, no CORS)', async () => {
    const composed = composeDeployment(apiEnv());
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const { response, captured } = capture();
    await handleDeploymentRequest(composed, streamingRequest({
      method: 'GET',
      url: `/v1/execution/submissions?project=${encodeURIComponent(DEMO_PROJECT_ID)}`,
      headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` },
    }), response);
    const written = captured();
    expect(written.status).toBe(200);
    expect(written.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(written.headers['x-api-version']).toBe('v1');
    expect(written.headers['x-request-id']).toMatch(/^req:/);
    for (const key of Object.keys(written.headers)) expect(key.toLowerCase()).not.toContain('access-control');
    const body = JSON.parse(written.payload as string) as { requestId: string; data: { items: readonly { kind: string; submissionId: string }[] } };
    expect(body.requestId).toBe(written.headers['x-request-id']);
    expect(body.data.items.map((row) => row.kind)).toEqual(['routed', 'routed', 'refused']);
    expect(body.data.items.every((row) => row.submissionId.startsWith('xgs:'))).toBe(true);
  });

  it('the host route auth law mirrors the boundary\'s own: absent/unknown Bearer is the typed 401; a missing project param is the typed 400', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const noToken = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: `/v1/execution/submissions?project=${DEMO_PROJECT_ID}`, headers: {} }), noToken.response);
    expect(noToken.captured().status).toBe(401);
    expect((JSON.parse(noToken.captured().payload as string) as { error: { code: string } }).error.code).toBe('unauthenticated');
    const wrongToken = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: `/v1/execution/submissions?project=${DEMO_PROJECT_ID}`, headers: { authorization: 'Bearer tok-wrong' } }), wrongToken.response);
    expect(wrongToken.captured().status).toBe(401);
    const noProject = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: '/v1/execution/submissions', headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` } }), noProject.response);
    expect(noProject.captured().status).toBe(400);
    expect((JSON.parse(noProject.captured().payload as string) as { error: { code: string } }).error.code).toBe('validation_failed');
  });

  it('the project scoping: a foreign project\'s page is empty (the seeded rows are the demo project\'s own)', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const { response, captured } = capture();
    await handleDeploymentRequest(composed, streamingRequest({
      method: 'GET',
      url: '/v1/execution/submissions?project=prj-someone-elses',
      headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` },
    }), response);
    expect(captured().status).toBe(200);
    expect((JSON.parse(captured().payload as string) as { data: { items: readonly unknown[] } }).data.items).toEqual([]);
  });

  it('ADDITIVE / backward-compatible: under the DURABLE backing, under port overrides, and for non-GET methods the route falls through to the boundary (the typed not_found — the pre-W-8 behavior)', async () => {
    for (const [label, composed] of [
      ['the durable backing', composeDeployment(apiEnv({ TRADRL_DEPLOY_BACKING: 'durable' }))],
      ['port overrides (the injection seam owns its own world)', composeDeployment(apiEnv(), { controlPlane: degradedPorts().controlPlane })],
      ['the demo backing (a non-GET method)', composeDeployment(apiEnv())],
    ] as const) {
      expect(composed.ok, label).toBe(true);
      if (!composed.ok) continue;
      const { response, captured } = capture();
      await handleDeploymentRequest(composed, streamingRequest({
        method: label === 'the demo backing (a non-GET method)' ? 'POST' : 'GET',
        url: `/v1/execution/submissions?project=${DEMO_PROJECT_ID}`,
        headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}`, 'idempotency-key': 'idem:w8:falloff' },
        chunks: ['{}'],
      }), response);
      expect(captured().status, label).toBe(404);
      expect((JSON.parse(captured().payload as string) as { error: { code: string } }).error.code, label).toBe('not_found');
    }
  });

  it('live execution requests join the blotter: a real POST /v1/execution/requests is recorded and served after the seeded rows', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const intent = validStrategyIntent(VALID_ENV[API_ENV_KEYS.apiDeveloperTenant], DEMO_PROJECT_ID as never);
    const response = composed.service.handle({
      method: 'POST',
      path: '/v1/execution/requests',
      headers: { ...bearer, 'idempotency-key': 'idem:demo:blotter:live:1' },
      body: { intent },
    });
    expect(response.status).toBe(200);
    const { response: routeResponse, captured } = capture();
    await handleDeploymentRequest(composed, streamingRequest({
      method: 'GET',
      url: `/v1/execution/submissions?project=${DEMO_PROJECT_ID}`,
      headers: bearer,
    }), routeResponse);
    const body = JSON.parse(captured().payload as string) as { data: { items: readonly { submissionId: string }[] } };
    expect(body.data.items).toHaveLength(4); // 3 seeded + the live routed submission
    const live = body.data.items[3]!;
    expect(live.submissionId).toBe((response.body as { data: { submissionId: string } }).data.submissionId);
  });
});

// ---------------------------------------------------------------------------
// The jobs seam (D-3, W-25A — the list route + the seeded jobs: "JOB: not
// searchable in any scope" fixed at the host; the console's boot read rides
// this route to refill state.jobs after every reload/scope-switch)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the jobs seam (D-3, W-25A: the seeded jobs + the host-owned list route)', () => {
  it('the demo world seed submits the SEEDED JOBS through the REAL routes: one research + one learning job for the demo project, the credential tenant, in the API-owned store (the same store the per-id GET reads)', () => {
    const composed = composeDeployment(apiEnv());
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const jobs = composed.service.jobs();
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.tenant === VALID_ENV[API_ENV_KEYS.apiDeveloperTenant])).toBe(true); // L12: the seed is the credential tenant's own
    expect(jobs.every((job) => job.project === DEMO_PROJECT_ID)).toBe(true);
    expect(jobs.map((job) => job.kind).sort()).toEqual(['learning', 'research']); // both kinds seeded
    expect(jobs.every((job) => isJobRecord(job) && job.status === 'submitted' && typeof job.submittedAt === 'number')).toBe(true); // the boundary's own guard, record for record
    // The store the per-id GET reads (the frozen route) carries exactly the seeded rows.
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    for (const job of jobs) {
      const read = composed.service.handle({ method: 'GET', path: `/v1/jobs/${job.jobId}`, headers: bearer });
      expect(read.status).toBe(200);
      expect((read.body as { data: { jobId: string } }).data.jobId).toBe(job.jobId);
    }
  });

  it('the host route GET /v1/jobs?project=<id> serves the seeded jobs through the FULL function handler (the page envelope, no CORS)', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const { response, captured } = capture();
    await handleDeploymentRequest(composed, streamingRequest({
      method: 'GET',
      url: `/v1/jobs?project=${encodeURIComponent(DEMO_PROJECT_ID)}`,
      headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` },
    }), response);
    const written = captured();
    expect(written.status).toBe(200);
    expect(written.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(written.headers['x-api-version']).toBe('v1');
    expect(written.headers['x-request-id']).toMatch(/^req:/);
    for (const key of Object.keys(written.headers)) expect(key.toLowerCase()).not.toContain('access-control');
    const body = JSON.parse(written.payload as string) as { requestId: string; data: { items: readonly { jobId: string; kind: string; tenant: string; project: string; status: string }[] } };
    expect(body.requestId).toBe(written.headers['x-request-id']);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items.every((job) => isJobRecord(job))).toBe(true); // the boundary's own guard passes on every served row
    expect(body.data.items.every((job) => job.tenant === VALID_ENV[API_ENV_KEYS.apiDeveloperTenant] && job.project === DEMO_PROJECT_ID)).toBe(true);
    expect(body.data.items.map((job) => job.kind).sort()).toEqual(['learning', 'research']);
  });

  it('the host route auth law mirrors the boundary\'s own: absent/unknown Bearer is the typed 401; a missing project param is the typed 400', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const noToken = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: `/v1/jobs?project=${DEMO_PROJECT_ID}`, headers: {} }), noToken.response);
    expect(noToken.captured().status).toBe(401);
    expect((JSON.parse(noToken.captured().payload as string) as { error: { code: string } }).error.code).toBe('unauthenticated');
    const wrongToken = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: `/v1/jobs?project=${DEMO_PROJECT_ID}`, headers: { authorization: 'Bearer tok-wrong' } }), wrongToken.response);
    expect(wrongToken.captured().status).toBe(401);
    const noProject = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: '/v1/jobs', headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` } }), noProject.response);
    expect(noProject.captured().status).toBe(400);
    expect((JSON.parse(noProject.captured().payload as string) as { error: { code: string } }).error.code).toBe('validation_failed');
  });

  it('the L12/project scoping: a foreign project\'s page is empty, and the fold never serves another tenant\'s rows (demoJobsOf filters on the AUTHORIZED tenant)', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const foreign = capture();
    await handleDeploymentRequest(composed, streamingRequest({
      method: 'GET',
      url: '/v1/jobs?project=prj-someone-elses',
      headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` },
    }), foreign.response);
    expect(foreign.captured().status).toBe(200);
    expect((JSON.parse(foreign.captured().payload as string) as { data: { items: readonly unknown[] } }).data.items).toEqual([]); // no fabricated rows, byte-identical empty page
    // The fold itself (the route's data seam): the authorized tenant's own rows only — a foreign tenant's fold is empty even for the demo project.
    expect(demoJobsOf(composed.service, VALID_ENV[API_ENV_KEYS.apiDeveloperTenant], DEMO_PROJECT_ID)).toHaveLength(2);
    expect(demoJobsOf(composed.service, 'tenant-other-demo', DEMO_PROJECT_ID)).toEqual([]);
  });

  it('live submissions join the list: a launched project\'s kickoff job is served for THAT project only (the console reload-refill story\'s host half)', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const created = composed.service.handle({
      method: 'POST',
      path: '/v1/projects',
      headers: { ...bearer, 'idempotency-key': 'idem:w25a:jobs:launch:1' },
      body: validCreateProjectRequest(VALID_ENV[API_ENV_KEYS.apiDeveloperTenant], 'prj-launched-jobs', 'the user-launched project'),
    });
    expect(created.status).toBe(201);
    const kickoff = composed.service.handle({
      method: 'POST',
      path: '/v1/jobs/research',
      headers: { ...bearer, 'idempotency-key': 'idem:w25a:jobs:launch:2' },
      body: { kind: 'research', projectId: 'prj-launched-jobs', spec: { source: 'w25a-runtime-test' } },
    });
    expect(kickoff.status).toBe(202);
    const kickoffJobId = (kickoff.body as { data: { jobId: string } }).data.jobId;
    // The LAUNCHED project's list carries its kickoff job (and nothing else).
    const launched = capture();
    await handleDeploymentRequest(composed, streamingRequest({
      method: 'GET',
      url: `/v1/jobs?project=${encodeURIComponent('prj-launched-jobs')}`,
      headers: bearer,
    }), launched.response);
    const launchedBody = JSON.parse(launched.captured().payload as string) as { data: { items: readonly { jobId: string }[] } };
    expect(launchedBody.data.items.map((job) => job.jobId)).toEqual([kickoffJobId]);
    // The DEMO project's list is untouched (2 seeded rows — the project scoping holds both ways).
    const demo = capture();
    await handleDeploymentRequest(composed, streamingRequest({
      method: 'GET',
      url: `/v1/jobs?project=${encodeURIComponent(DEMO_PROJECT_ID)}`,
      headers: bearer,
    }), demo.response);
    const demoBody = JSON.parse(demo.captured().payload as string) as { data: { items: readonly { jobId: string }[] } };
    expect(demoBody.data.items).toHaveLength(2);
    expect(demoBody.data.items.every((job) => job.jobId !== kickoffJobId)).toBe(true);
  });

  it('ADDITIVE / backward-compatible: under the DURABLE backing, under port overrides, and for non-GET methods the route falls through to the boundary (the typed not_found — the pre-W-25A behavior)', async () => {
    for (const [label, composed] of [
      ['the durable backing', composeDeployment(apiEnv({ TRADRL_DEPLOY_BACKING: 'durable' }))],
      ['port overrides (the injection seam owns its own world — no demo seed)', composeDeployment(apiEnv(), { controlPlane: degradedPorts().controlPlane })],
      ['the demo backing (a non-GET method)', composeDeployment(apiEnv())],
    ] as const) {
      expect(composed.ok, label).toBe(true);
      if (!composed.ok) continue;
      const { response, captured } = capture();
      await handleDeploymentRequest(composed, streamingRequest({
        method: label === 'the demo backing (a non-GET method)' ? 'POST' : 'GET',
        url: `/v1/jobs?project=${DEMO_PROJECT_ID}`,
        headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}`, 'idempotency-key': 'idem:w25a:falloff' },
        chunks: ['{}'],
      }), response);
      expect(captured().status, label).toBe(404);
      expect((JSON.parse(captured().payload as string) as { error: { code: string } }).error.code, label).toBe('not_found');
    }
  });
});

// ---------------------------------------------------------------------------
// The seeded decision substance (R3 — deciding body, rationale, risk checks,
// live evidence refs — additive fields on the seeded decision records)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the seeded decision substance (R3: auditable decisions, additive fields)', () => {
  it('the enriched outcome record still satisfies the boundary\'s mirror guard and carries the deciding body, the stated rationale and the risk checks — served through the REAL route', () => {
    const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
    expect(demoOutcomeRecordIsValid(tenant, DEMO_PROJECT_ID)).toBe(true);
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const outcomes = composed.service.handle({
      method: 'POST',
      path: '/v1/outcomes/query',
      headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` },
      body: { project: DEMO_PROJECT_ID, at: 1_730_000_000_000 },
    });
    expect(outcomes.status).toBe(200);
    const record = (outcomes.body as { data: { items: readonly Record<string, unknown>[] } }).data.items[0]!;
    expect(record.decisionBody).toBe(DEMO_EXECUTION_DESK);
    expect(typeof record.decisionRationale).toBe('string');
    expect((record.decisionRationale as string).length).toBeGreaterThan(40); // rationale PROSE, not a bare ref
    expect(record.riskChecks).toEqual(expect.arrayContaining([
      { dimension: 'kill_switch', outcome: 'pass' },
      { dimension: 'limits', outcome: 'pass' },
    ]));
  });

  it('the blotter rows\' decision audit substance: a named deciding body per verdict, rationale prose, risk checks with outcomes, and evidence refs that resolve to REAL seeded records', () => {
    const rows = demoSubmissionBlotter() as unknown as readonly {
      decisionBody?: string; decisionRationale?: string; riskChecks?: readonly { dimension: string; outcome: string }[]; evidence?: readonly { kind: string; ref: string }[]; kind: string;
    }[];
    for (const row of rows) {
      expect(typeof row.decisionBody).toBe('string'); // never "unknown/unspecified" again
      expect((row.decisionRationale as string).length).toBeGreaterThan(40);
      expect(row.riskChecks?.length).toBeGreaterThan(0); // never "Risk checks: none" again
      expect(row.evidence?.length).toBeGreaterThan(0); // never dead chips again
    }
    // The routed rows name the desk; the refusal names the risk gate (the body that decided).
    expect(rows[0]!.decisionBody).toBe(DEMO_EXECUTION_DESK);
    expect(rows[2]!.decisionBody).toBe('gate:pre-trade-risk');
    // The evidence refs resolve to records the seed REALLY serves (the outcome
    // + post-mortem queries are the capsules' read surfaces).
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const outcomes = composed.service.handle({ method: 'POST', path: '/v1/outcomes/query', headers: bearer, body: { project: DEMO_PROJECT_ID, at: 1_730_000_000_000 } });
    const postMortems = composed.service.handle({ method: 'POST', path: '/v1/post-mortems/query', headers: bearer, body: { project: DEMO_PROJECT_ID, at: 1_730_000_000_000, latestPerOutcome: true } });
    const servedRefs = new Set<string>([
      ...((outcomes.body as { data: { items: readonly { outcomeId: string; evidence: readonly { ref: string }[] }[] } }).data.items.flatMap((record) => [record.outcomeId, ...record.evidence.map((entry) => entry.ref)])),
      ...((postMortems.body as { data: { items: readonly { postMortemId: string; evidence: readonly { ref: string }[] }[] } }).data.items.flatMap((record) => [record.postMortemId, ...record.evidence.map((entry) => entry.ref)])),
    ]);
    for (const ref of rows[0]!.evidence!.map((entry) => entry.ref)) {
      expect(servedRefs.has(ref)).toBe(true); // swo:demo0001, shs:demo0001, out:demo0001 — all real
    }
  });

  it('TRIP-WIRE — the additive field names stay off the console watch surface\'s reasoning-key vocabulary (the chain-of-thought firewall never trips on the enriched records)', () => {
    // The vocabulary mirrored from apps/web/src/core/watch.ts REASONING_KEYS
    // (frozen there; mirrored here as a test-only trip wire — deploy code
    // never imports the console, D-003/D-004 law). An additive field that
    // matches one of these keys would make the console's watch fold refuse
    // the record (ChainOfThoughtExposureError) — this pin keeps the demo
    // substance and the firewall compatible.
    const reasoningKeys = ['reasoning', 'rationale', 'chainOfThought', 'chain_of_thought', 'thought', 'thoughts', 'thinking', 'innerMonologue', 'inner_monologue', 'monologue', 'prompt', 'systemPrompt', 'system_prompt', 'scratchpad', 'deliberation', 'explanation', 'justification'];
    const isReasoningKey = (key: string): boolean => {
      const lowered = key.toLowerCase();
      return reasoningKeys.some((candidate) => lowered === candidate.toLowerCase() || lowered === `the${candidate.toLowerCase()}`);
    };
    const collectKeys = (value: unknown, into: string[]): void => {
      if (Array.isArray(value)) { value.forEach((item) => collectKeys(item, into)); return; }
      if (typeof value !== 'object' || value === null) return;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) { into.push(key); collectKeys(child, into); }
    };
    const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
    const enrichedRecords: unknown[] = [demoSubmissionBlotter(), demoOutcomeRecord(tenant, DEMO_PROJECT_ID)];
    for (const record of enrichedRecords) {
      const keys: string[] = [];
      collectKeys(record, keys);
      for (const key of keys) expect(isReasoningKey(key)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The seeded constraint numeric bounds (R5 — a limit without a number is not
// a limit; the seed side carries numbers end-to-end)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the seeded constraint numeric bounds (R5: every bound a number, end-to-end)', () => {
  it('every seeded constraint predicate carries a NUMERIC bound/value, and the goal\'s success criteria too', () => {
    const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
    for (const constraint of demoConstraintSet(tenant).constraints) {
      const predicate = constraint.predicate as { kind: string; bound?: unknown; value?: unknown; min?: unknown; max?: unknown };
      if (predicate.kind === 'limit.max' || predicate.kind === 'limit.min') expect(typeof predicate.bound).toBe('number');
      else if (predicate.kind === 'limit.range') { expect(typeof predicate.min).toBe('number'); expect(typeof predicate.max).toBe('number'); }
      else if (predicate.kind === 'equals' || predicate.kind === 'notEquals') expect(typeof predicate.value).toBe('number');
    }
    expect(demoConstraintSet(tenant).constraints.map((constraint) => constraint.id)).toEqual(['k-capital-budget', 'k-risk-budget', 'k-position', 'k-turnover', 'k-drawdown']);
    const budget = demoConstraintSet(tenant).constraints[0]!.predicate as { value: unknown };
    expect(budget.value).toBe(DEMO_CAPITAL_BUDGET); // 250000 — a number, not "250000.00"
    expect((demoConstraintSet(tenant).constraints[1]!.predicate as { value: unknown }).value).toBe(DEMO_RISK_BUDGET);
    for (const criterion of demoGoalStatement(tenant).successCriteria.criteria) {
      expect(typeof (criterion.predicate as { bound?: unknown }).bound).toBe('number');
    }
  });

  it('end-to-end: the numeric-bound goal/constraint set is ACCEPTED by the real create route (the demo project IS it) and served by the host goal route', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    // The demo project was created through the REAL route with exactly these
    // shapes at seed time — the lineage refs prove the numeric set landed.
    const project = composed.service.handle({ method: 'GET', path: `/v1/projects/${DEMO_PROJECT_ID}`, headers: bearer });
    expect(project.status).toBe(200);
    const record = (project.body as { data: { lineage: { goal: { goalId: string }; constraintSet: { id: string; version: number } } } }).data;
    expect(record.lineage.goal.goalId).toBe('goal-tradrl-demo');
    expect(record.lineage.constraintSet.id).toBe('cs-tradrl-demo');
    // The host goal route serves the same numeric bounds (the console's read path).
    const { response, captured } = capture();
    await handleDeploymentRequest(composed, streamingRequest({
      method: 'GET',
      url: `/v1/projects/${encodeURIComponent(DEMO_PROJECT_ID)}/goal`,
      headers: bearer,
    }), response);
    expect(captured().status).toBe(200);
    const body = JSON.parse(captured().payload as string) as { requestId: string; data: { goal: { id: string; successCriteria: { criteria: readonly { predicate: { bound?: unknown } }[] } }; constraintSet: { id: string; constraints: readonly { predicate: { bound?: unknown; value?: unknown } }[] } } };
    expect(body.data.goal.id).toBe('goal-tradrl-demo');
    expect(body.data.constraintSet.id).toBe('cs-tradrl-demo');
    expect(body.data.constraintSet.constraints.every((constraint) => typeof constraint.predicate.bound === 'number' || typeof constraint.predicate.value === 'number')).toBe(true);
    expect(body.data.goal.successCriteria.criteria.every((criterion) => typeof criterion.predicate.bound === 'number')).toBe(true);
    expect(body.requestId).toBe(captured().headers['x-request-id']);
  });

  it('the host goal route: 401 without the credential; the typed not-found for any project but the demo project', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const unauthenticated = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: `/v1/projects/${DEMO_PROJECT_ID}/goal`, headers: {} }), unauthenticated.response);
    expect(unauthenticated.captured().status).toBe(401);
    const foreign = capture();
    await handleDeploymentRequest(composed, streamingRequest({
      method: 'GET',
      url: '/v1/projects/prj-not-the-demo/goal',
      headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` },
    }), foreign.response);
    expect(foreign.captured().status).toBe(404);
    expect((JSON.parse(foreign.captured().payload as string) as { error: { code: string } }).error.code).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// The launched-scope goal route (D-4, W-25B — the demo backing serves
// EVERY project's own goal, not just the seed's)
// ---------------------------------------------------------------------------

describe("deploy/vercel — the launched-scope goal route (D-4, W-25B: the demo backing serves every project's own goal)", () => {
  /**
   * The launch flow's own create-project request (apps/web
   * toCreateProjectInput's shape — the records the launch wizard sends
   * when the user drafts a goal): the drafted objective + criteria with
   * NUMERIC bounds, the drafted constraints, and the two budget
   * constraints the launch flow appends (exact decimal strings).
   */
  function launchedCreateProjectRequest(tenant: string, projectId: string, objective: string): Record<string, unknown> {
    return {
      id: projectId,
      name: 'the user-launched project',
      executionMode: 'simulation',
      goal: {
        id: `goal-${projectId}`, version: 1, tenantId: tenant,
        objective,
        horizon: { startsAt: 1_700_000_000_000, endsAt: 1_700_000_000_000 + 90 * 24 * 3_600_000, label: 'the launch window' },
        successCriteria: {
          criteria: [
            { id: 'sc-1', metric: 'pnl.net', predicate: { kind: 'limit.min', bound: 0 }, description: 'net profit is non-negative' },
            { id: 'sc-2', metric: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, description: 'bounded drawdown' },
          ],
          requiredSatisfaction: 0.5,
        },
        evaluation: { blindRef: 'eval:blind-1', walkForwardRef: 'eval:wf-1', regimeRef: 'eval:regime-1', adversarialRequired: true },
        createdAt: 1_700_000_000_000,
      },
      constraintSet: {
        id: `cs-${projectId}`, version: 1, tenantId: tenant,
        constraints: [
          { id: 'c-1', domain: 'outcome', subject: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, severity: 'blocking', description: 'the drawdown ceiling' },
          { id: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: '10000.00' }, severity: 'blocking' },
          { id: 'k-risk-budget', domain: 'outcome', subject: 'risk.budget', predicate: { kind: 'equals', value: '250.00' }, severity: 'blocking' },
        ],
        createdAt: 1_700_000_000_000,
      },
      at: 1_700_000_000_000,
    };
  }

  it('the launch story (demo backing): a project created through the REAL route serves ITS OWN goal + constraint set at GET /v1/projects/:id/goal — the records it was created with, D-4 closed', async () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const request = launchedCreateProjectRequest(VALID_ENV[API_ENV_KEYS.apiDeveloperTenant], 'prj-launched-goal', 'Find and keep an edge in momentum.');
    const created = composed.service.handle({ method: 'POST', path: '/v1/projects', headers: bearer, body: request });
    expect(created.status).toBe(201);
    // THE GOAL READ (the console's W-23 boot read — after a reload this is the route that refills the Goal/Risk cards): 200 with ITS own records.
    const { response, captured } = capture();
    await handleDeploymentRequest(composed, streamingRequest({
      method: 'GET',
      url: '/v1/projects/prj-launched-goal/goal',
      headers: bearer,
    }), response);
    const written = captured();
    expect(written.status).toBe(200);
    expect(written.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(written.headers['x-api-version']).toBe('v1');
    expect(written.headers['x-request-id']).toMatch(/^req:/);
    for (const key of Object.keys(written.headers)) expect(key.toLowerCase()).not.toContain('access-control');
    const body = JSON.parse(written.payload as string) as { requestId: string; data: { goal: unknown; constraintSet: unknown } };
    expect(body.requestId).toBe(written.headers['x-request-id']);
    expect(body.data.goal).toEqual(request.goal); // ITS OWN goal — the create input verbatim (the drafted objective, criteria, evaluation)
    expect(body.data.constraintSet).toEqual(request.constraintSet); // ITS OWN constraint set (the drafted numeric bounds + the budget constraints)
  });

  it('the demo project stays byte-identical: the seeded records serve exactly as before, and the capture never steers the demo branch', async () => {
    const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    // A launched create exists first — the capture holds records, and the demo branch must still serve the fixed seed.
    const created = composed.service.handle({ method: 'POST', path: '/v1/projects', headers: bearer, body: launchedCreateProjectRequest(tenant, 'prj-launched-goal-beside-demo', 'a second launched objective') });
    expect(created.status).toBe(201);
    const { response, captured } = capture();
    await handleDeploymentRequest(composed, streamingRequest({
      method: 'GET',
      url: `/v1/projects/${encodeURIComponent(DEMO_PROJECT_ID)}/goal`,
      headers: bearer,
    }), response);
    expect(captured().status).toBe(200);
    const body = JSON.parse(captured().payload as string) as { data: unknown };
    expect(body.data).toEqual({ goal: demoGoalStatement(tenant), constraintSet: demoConstraintSet(tenant) }); // byte-identical to the pre-W-25B serve
    // And the demo seed's own create rode the same port: its captured records ARE the seeded exports (the capture's completeness pin).
    expect(composed.demo).not.toBeNull();
    if (composed.demo === null) return;
    expect(demoGoalSetOf(composed.demo.ports, tenant, DEMO_PROJECT_ID)).toEqual({ tenant, project: DEMO_PROJECT_ID, goal: demoGoalStatement(tenant), constraintSet: demoConstraintSet(tenant) });
  });

  it('a project with no goal on record answers the typed not-found (unchanged); a REFUSED create leaves nothing — a duplicate-id create never overwrites the first goal', async () => {
    const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    // An unknown project (never created): the typed not-found, exactly as before.
    const unknown = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: '/v1/projects/prj-never-created/goal', headers: bearer }), unknown.response);
    expect(unknown.captured().status).toBe(404);
    expect((JSON.parse(unknown.captured().payload as string) as { error: { code: string } }).error.code).toBe('not_found');
    // The refused create: the SAME id again with a DIFFERENT goal — the frozen port refuses (conflict -> the typed unavailable), and the capture keeps the FIRST records only.
    const first = launchedCreateProjectRequest(tenant, 'prj-goal-conflict', 'the first objective');
    const created = composed.service.handle({ method: 'POST', path: '/v1/projects', headers: bearer, body: first });
    expect(created.status).toBe(201);
    const second = launchedCreateProjectRequest(tenant, 'prj-goal-conflict', 'a hostile replacement objective');
    const refused = composed.service.handle({ method: 'POST', path: '/v1/projects', headers: bearer, body: second });
    expect(refused.status).not.toBe(201); // the frozen port's conflict (its typed mapping) — no second create ever landed
    const read = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: '/v1/projects/prj-goal-conflict/goal', headers: bearer }), read.response);
    expect(read.captured().status).toBe(200);
    const body = JSON.parse(read.captured().payload as string) as { data: { goal: { objective: string } } };
    expect(body.data.goal.objective).toBe('the first objective'); // the refused create never overwrote the captured goal set
  });

  it('L12 — a foreign tenant\'s goal never crosses: the fold keys on the AUTHORIZED tenant, and a goal declaring a foreign tenant is refused at create (the same-tenant law) leaving no record', async () => {
    const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
    const composed = composeDeployment(apiEnv());
    if (!composed.ok || composed.demo === null) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    // The same-tenant law at the create seam: a goal declaring a FOREIGN tenant is refused before any port call — nothing is ever captured.
    const hostile = launchedCreateProjectRequest(tenant, 'prj-hostile-goal', 'an honest objective') as { goal: { tenantId: string } };
    hostile.goal.tenantId = 'tenant:attacker';
    const refused = composed.service.handle({ method: 'POST', path: '/v1/projects', headers: bearer, body: hostile });
    expect(refused.status).toBe(403);
    expect((refused.body as { error: { code: string } }).error.code).toBe('cross_tenant_access');
    expect(composed.demo.ports.controlPlane.goalSets.has(`${tenant}/prj-hostile-goal`)).toBe(false); // L12: nothing captured for the refused create
    // The fold itself (the route's data seam): only the AUTHORIZED tenant's records serve — a foreign tenant's fold finds nothing, never a leak.
    const created = composed.service.handle({ method: 'POST', path: '/v1/projects', headers: bearer, body: launchedCreateProjectRequest(tenant, 'prj-launched-l12', 'the scoped objective') });
    expect(created.status).toBe(201);
    expect(demoGoalSetOf(composed.demo.ports, tenant, 'prj-launched-l12')?.goal.objective).toBe('the scoped objective');
    expect(demoGoalSetOf(composed.demo.ports, 'tenant-other-demo', 'prj-launched-l12')).toBeNull();
    // A SECOND composition (another deployment, another credential tenant) owns its own empty capture: the first tenant's project is the typed not-found there.
    const otherComposed = composeDeployment(apiEnv({ [API_ENV_KEYS.apiDeveloperTenant]: 'tenant-other-demo' }));
    expect(otherComposed.ok).toBe(true);
    if (!otherComposed.ok) return;
    const other = capture();
    await handleDeploymentRequest(otherComposed, streamingRequest({
      method: 'GET',
      url: '/v1/projects/prj-launched-l12/goal',
      headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` },
    }), other.response);
    expect(other.captured().status).toBe(404); // its own world: no goal of the first tenant's project exists in it (unknown and cross-tenant indistinguishable)
    expect((JSON.parse(other.captured().payload as string) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('the honest per-instance limitation: a fresh composition (a serverless cold start) carries no previous instance\'s launched-project goal — the demo project still serves (its seed re-runs)', async () => {
    const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
    const first = composeDeployment(apiEnv());
    if (!first.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const created = first.service.handle({ method: 'POST', path: '/v1/projects', headers: bearer, body: launchedCreateProjectRequest(tenant, 'prj-cold-start', 'an objective that will not survive the cold start') });
    expect(created.status).toBe(201);
    const served = capture();
    await handleDeploymentRequest(first, streamingRequest({ method: 'GET', url: '/v1/projects/prj-cold-start/goal', headers: bearer }), served.response);
    expect(served.captured().status).toBe(200); // the warm instance serves it
    // A FRESH composition of the same env — a new instance: the capture is per-instance (the demo backing's honest SIMULATED semantics; durability is the DURABLE backing's surface, D-5/W-25D).
    const second = composeDeployment(apiEnv());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const cold = capture();
    await handleDeploymentRequest(second, streamingRequest({ method: 'GET', url: '/v1/projects/prj-cold-start/goal', headers: bearer }), cold.response);
    expect(cold.captured().status).toBe(404);
    expect((JSON.parse(cold.captured().payload as string) as { error: { code: string } }).error.code).toBe('not_found');
    // The demo project serves on the fresh instance exactly as ever (its seed re-runs at composition).
    const demo = capture();
    await handleDeploymentRequest(second, streamingRequest({ method: 'GET', url: `/v1/projects/${encodeURIComponent(DEMO_PROJECT_ID)}/goal`, headers: bearer }), demo.response);
    expect(demo.captured().status).toBe(200);
  });

  it('ADDITIVE / backward-compatible: under port overrides the demo goal route is not served (the boundary\'s own typed not_found — the demo capture never serves a world it does not own)', async () => {
    const composed = composeDeployment(apiEnv(), { controlPlane: degradedPorts().controlPlane });
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const { response, captured } = capture();
    await handleDeploymentRequest(composed, streamingRequest({
      method: 'GET',
      url: `/v1/projects/${DEMO_PROJECT_ID}/goal`,
      headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` },
    }), response);
    expect(captured().status).toBe(404);
    expect((JSON.parse(captured().payload as string) as { error: { code: string } }).error.code).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// The launched-org compile (R4 — user-launched projects compile like the demo)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the launched-org compile (R4: a user launch produces organization snapshots)', () => {
  /** The user-launch harness: create a project through the REAL route + the kickoff research job (the console's launch flow). */
  function launchProject(service: ApiService, projectId: string): { jobId: string; submittedAt: number } {
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const created = service.handle({
      method: 'POST',
      path: '/v1/projects',
      headers: bearer,
      body: validCreateProjectRequest(VALID_ENV[API_ENV_KEYS.apiDeveloperTenant], projectId, 'the user-launched project'),
    });
    expect(created.status).toBe(201);
    const job = service.handle({
      method: 'POST',
      path: '/v1/jobs/research',
      headers: { ...bearer, 'idempotency-key': `idem:w8:launch:${projectId}` },
      body: { kind: 'research', projectId, spec: { source: 'w8-runtime-test', project: projectId } },
    });
    expect(job.status).toBe(202);
    const record = (job.body as { data: { jobId: string; submittedAt: number } }).data;
    return { jobId: record.jobId, submittedAt: record.submittedAt };
  }

  it('the full story: launch -> one machinery tick -> the project is BOUND and the watch read serves the compiled team\'s snapshot', () => {
    const composed = composeDeployment(apiEnv({ [API_ENV_KEYS.apiInternalToken]: 'tok-internal-demo', [API_ENV_KEYS.apiInternalPrincipal]: 'demo-machinery' }));
    expect(composed.ok).toBe(true);
    if (!composed.ok || composed.demo === null || composed.demo.tick === null) return;
    const launch = launchProject(composed.service, 'prj-user-launch-1');
    // Before the tick: the launched project is unbound and the watch read is the honest not-found.
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const before = composed.service.handle({ method: 'GET', path: '/v1/projects/prj-user-launch-1', headers: bearer });
    expect((before.body as { data: { lifecycle: { organizationRef: string | null } } }).data.lifecycle.organizationRef).toBeNull();
    // One tick (the console's first poll beat after the launch): the compile pass binds + reports.
    const compileAt = 1_730_000_000_123;
    composed.demo.tick(compileAt);
    const bound = composed.service.handle({ method: 'GET', path: '/v1/projects/prj-user-launch-1', headers: bearer });
    expect((bound.body as { data: { lifecycle: { organizationRef: string | null } } }).data.lifecycle.organizationRef).toBe(compiledOrganizationRefOf('prj-user-launch-1'));
    const status = composed.service.handle({
      method: 'GET',
      path: `/v1/organizations/${compiledOrganizationRefOf('prj-user-launch-1')}/status`,
      headers: bearer,
      query: { project: 'prj-user-launch-1' },
    });
    expect(status.status).toBe(200);
    const snapshot = (status.body as { data: { tenant: string; project: string; status: string; at: number; instanceRefs: readonly string[] } }).data;
    expect(snapshot.tenant).toBe(VALID_ENV[API_ENV_KEYS.apiDeveloperTenant]);
    expect(snapshot.project).toBe('prj-user-launch-1');
    expect(snapshot.status).toBe('active');
    expect(snapshot.at).toBe(compileAt); // the compile instant — point-in-time stable
    expect(snapshot.instanceRefs).toEqual(['ai:director-1', 'ai:researcher-2']); // the compiled team
    // The same tick advances the kickoff job (the machinery's other pass is unchanged).
    composed.demo.tick(launch.submittedAt + DEMO_JOB_COMPLETE_AFTER_MS + 1);
    const job = composed.service.handle({ method: 'GET', path: `/v1/jobs/${launch.jobId}`, headers: bearer });
    expect((job.body as { data: { status: string } }).data.status).toBe('complete');
  });

  it('the compile is ONCE per project and point-in-time stable: later ticks never re-bind or re-report (the snapshot keeps its compile instant); the demo project\'s own snapshot keeps its boot instant', () => {
    const composed = composeDeployment(apiEnv({ [API_ENV_KEYS.apiInternalToken]: 'tok-internal-demo', [API_ENV_KEYS.apiInternalPrincipal]: 'demo-machinery' }));
    if (!composed.ok || composed.demo === null || composed.demo.tick === null) return;
    launchProject(composed.service, 'prj-user-launch-2');
    const compileAt = 1_730_000_100_000;
    composed.demo.tick(compileAt);
    const snapshotsAfterFirst = composed.service.orgStatusSnapshots().filter((snapshot) => snapshot.project === 'prj-user-launch-2');
    expect(snapshotsAfterFirst).toHaveLength(1);
    composed.demo.tick(compileAt + 60_000);
    composed.demo.tick(compileAt + 120_000);
    const snapshotsAfterMore = composed.service.orgStatusSnapshots().filter((snapshot) => snapshot.project === 'prj-user-launch-2');
    expect(snapshotsAfterMore).toHaveLength(1); // never re-reported
    expect(snapshotsAfterMore[0]!.at).toBe(compileAt); // the compile instant stays
    // The demo project's own snapshot is the BOOT one (its org ref is the seeded one, not a compile ref).
    const demoSnapshots = composed.service.orgStatusSnapshots().filter((snapshot) => snapshot.project === DEMO_PROJECT_ID);
    expect(demoSnapshots.every((snapshot) => snapshot.organizationRef === DEMO_ORGANIZATION_REF)).toBe(true);
  });

  it('WITHOUT the internal credential: the machinery is absent (tick null) — a launched project stays unbound and the watch read stays the honest not-found (R46)', () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok || composed.demo === null) return;
    expect(composed.demo.tick).toBeNull();
    launchProject(composed.service, 'prj-user-launch-3');
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const project = composed.service.handle({ method: 'GET', path: '/v1/projects/prj-user-launch-3', headers: bearer });
    expect((project.body as { data: { lifecycle: { organizationRef: string | null } } }).data.lifecycle.organizationRef).toBeNull();
    const status = composed.service.handle({
      method: 'GET',
      path: `/v1/organizations/${compiledOrganizationRefOf('prj-user-launch-3')}/status`,
      headers: bearer,
      query: { project: 'prj-user-launch-3' },
    });
    expect(status.status).toBe(404);
    expect((status.body as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('a non-bindable project (activated before any tick) is skipped WITHOUT a request — the machinery never crashes the request (R46)', () => {
    const composed = composeDeployment(apiEnv({ [API_ENV_KEYS.apiInternalToken]: 'tok-internal-demo', [API_ENV_KEYS.apiInternalPrincipal]: 'demo-machinery' }));
    if (!composed.ok || composed.demo === null || composed.demo.tick === null) return;
    launchProject(composed.service, 'prj-user-launch-4');
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const activated = composed.service.handle({
      method: 'POST',
      path: '/v1/projects/prj-user-launch-4/lifecycle',
      headers: bearer,
      body: { event: 'activate', at: 1_730_000_200_000 },
    });
    expect(activated.status).toBe(200);
    composed.demo.tick(1_730_000_200_500); // would be refused by the real bind route (active) — the pass must skip, not crash
    const project = composed.service.handle({ method: 'GET', path: '/v1/projects/prj-user-launch-4', headers: bearer });
    expect((project.body as { data: { lifecycle: { organizationRef: string | null; status: string } } }).data.lifecycle.organizationRef).toBeNull();
    // And the request path still serves (the tick never took anything down).
    const meta = composed.service.handle({ method: 'GET', path: '/v1/meta', headers: bearer });
    expect(meta.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// The launch world capture, DEMO arm (D-8, W-28): the console's kickoff job
// spec carries the world; the demo backing's job port retains it per instance
// (the same extraction the DURABLE seam persists into the goal-set row), and
// the host goal route serves it back as the bundle's ADDITIVE `world` field —
// so the console's Market World section renders the PERSISTED world after a
// reload (the pre-fix section rendered its teaching empty state forever).
// ---------------------------------------------------------------------------

describe('deploy/vercel — the launched world capture, demo arm (D-8, W-28: every project\'s own world at the goal route)', () => {
  /** The console's kickoff-job spec (apps/web toLaunchJobSpec's shape). */
  function consoleLaunchSpec(): Record<string, unknown> {
    return {
      kind: 'console-launch',
      objective: 'Find and keep an edge in momentum.',
      horizon: { startsAt: 1_700_000_000_000, endsAt: 1_700_002_592_000_000 },
      capitalBudget: '500000.00',
      riskBudget: '40000.00',
      markets: ['BTC-USD', 'ETH-USD'],
      venues: ['binance', 'kraken'],
      dataSources: ['candle-v1', 'depth-v1'],
      executionMode: 'simulation',
      preferences: [],
    };
  }

  /** The extracted world the job port retains (the world fields only). */
  function extractedWorld(): Record<string, unknown> {
    return {
      markets: ['BTC-USD', 'ETH-USD'],
      venues: ['binance', 'kraken'],
      dataSources: ['candle-v1', 'depth-v1'],
      executionMode: 'simulation',
      capitalBudget: '500000.00',
      riskBudget: '40000.00',
      horizon: { startsAt: 1_700_000_000_000, endsAt: 1_700_002_592_000_000 },
    };
  }

  /** The D-4 suite's own create-project request shape (a local mirror — the D-4 fixture lives inside its own describe scope). */
  function createRequest(tenant: string, projectId: string, objective: string): Record<string, unknown> {
    const base = validCreateProjectRequest(tenant, projectId) as { goal: { objective: string }; constraintSet: unknown };
    return { ...base, name: `the ${projectId} desk`, goal: { ...base.goal, objective } };
  }

  it('the launch story (demo backing): create + a console-launch kickoff job -> the goal route serves the bundle WITH the ADDITIVE world field — and the demo project + a foreign spec stay world-less', async () => {
    const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
    const composed = composeDeployment(apiEnv());
    if (!composed.ok || composed.demo === null) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };

    // A launched desk + its kickoff job carrying the world spec.
    const created = composed.service.handle({ method: 'POST', path: '/v1/projects', headers: bearer, body: createRequest(tenant, 'prj-world-demo', 'the world story objective') });
    expect(created.status).toBe(201);
    const submitted = composed.service.handle({ method: 'POST', path: '/v1/jobs/research', headers: { ...bearer, 'idempotency-key': 'idem:w28:demo-arm' }, body: { kind: 'research', projectId: 'prj-world-demo', spec: consoleLaunchSpec() } });
    expect(submitted.status).toBe(202);

    // THE GOAL ROUTE: the bundle carries the ADDITIVE world field.
    const { response, captured } = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: '/v1/projects/prj-world-demo/goal', headers: bearer }), response);
    expect(captured().status).toBe(200);
    const body = JSON.parse(captured().payload as string) as { data: { goal: unknown; constraintSet: unknown; world?: unknown } };
    expect(body.data.goal).toEqual(createRequest(tenant, 'prj-world-demo', 'the world story objective').goal);
    expect(body.data.world).toEqual(extractedWorld()); // the captured world, served back

    // The capture itself (the fold): the authorized tenant's own, per project.
    expect(demoWorldOf(composed.demo.ports, tenant, 'prj-world-demo')).toEqual(extractedWorld());
    expect(demoWorldOf(composed.demo.ports, 'tenant-other-demo', 'prj-world-demo')).toBeNull(); // L12: a foreign tenant's fold finds nothing
    expect(demoWorldOf(composed.demo.ports, tenant, 'prj-never-created')).toBeNull(); // an unknown project has no world

    // THE DEMO PROJECT stays world-less (its seed jobs ride demo-seed specs — the teaching empty state's scope, preserved).
    const demo = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: `/v1/projects/${encodeURIComponent(DEMO_PROJECT_ID)}/goal`, headers: bearer }), demo.response);
    expect(demo.captured().status).toBe(200);
    expect((JSON.parse(demo.captured().payload as string) as { data: Record<string, unknown> }).data).not.toHaveProperty('world');

    // A FOREIGN spec (no console-launch kind marker) captures nothing — the goal route serves no world for it.
    const foreignCreated = composed.service.handle({ method: 'POST', path: '/v1/projects', headers: bearer, body: createRequest(tenant, 'prj-world-foreign', 'the foreign spec objective') });
    expect(foreignCreated.status).toBe(201);
    const foreignJob = composed.service.handle({ method: 'POST', path: '/v1/jobs/research', headers: { ...bearer, 'idempotency-key': 'idem:w28:foreign-spec' }, body: { kind: 'research', projectId: 'prj-world-foreign', spec: { kind: 'demo-seed', note: 'not a console launch' } } });
    expect(foreignJob.status).toBe(202);
    const foreign = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: '/v1/projects/prj-world-foreign/goal', headers: bearer }), foreign.response);
    expect(foreign.captured().status).toBe(200);
    expect((JSON.parse(foreign.captured().payload as string) as { data: Record<string, unknown> }).data).not.toHaveProperty('world'); // a malformed/foreign spec captures nothing (R46)

    // The honest per-instance limitation (the demo capture's own medium — same as the goal-set capture).
    const second = composeDeployment(apiEnv());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    if (second.demo === null) return;
    const cold = capture();
    await handleDeploymentRequest(second, streamingRequest({ method: 'GET', url: '/v1/projects/prj-world-demo/goal', headers: bearer }), cold.response);
    expect(cold.captured().status).toBe(404); // the fresh instance's capture is per-instance (durability is the DURABLE backing's surface, D-8's durable half)
  });
});

// ---------------------------------------------------------------------------
// THE LAUNCHED-DESK EVIDENCE STREAM (FW-MI-B — MI-D2 + MI-D10): a user's
// own launched desk gets its OWN honest simulated evidence stream — the
// same audit spine the seeded demo project serves (2 routed fills + 1
// NUMERIC pre-trade-risk refusal, an adverse-gap outcome with tolerance,
// a confidence-rated post-mortem), derived deterministically from the
// desk's OWN envelope (its captured goal set + launch world) behind the
// COMPILE gate. The wave-1 evidence (7/9 professionals, the #1 value
// blocker): S1 (founder) "my three launched desks produced zero orders,
// empty blotters, decision streams with evidence none and actor unknown
// — the audit spine that would convert me lives only in the seeded demo
// project"; L4 (execution trader) "the screen I'd open 400 times a day
// has no flow in it"; S2 (junior) "the product can't yet capture MY
// work". MI-D10 folds in: the stream's deciding bodies are NAMED
// (desk:<project>-execution / gate:pre-trade-risk) — never "unknown".
// ---------------------------------------------------------------------------

describe('deploy/vercel — the launched-desk evidence stream (FW-MI-B: MI-D2 + MI-D10 — every compiled desk gets its own honest simulated evidence stream)', () => {
  /** The console's launch flow, driven through the REAL routes: the create (goal + constraint set) + the kickoff job whose spec carries the launch world. */
  function launchDesk(service: ApiService, projectId: string, at: number): void {
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
    const created = service.handle({
      method: 'POST',
      path: '/v1/projects',
      headers: bearer,
      body: {
        id: projectId,
        name: `the ${projectId} desk`,
        executionMode: 'simulation',
        goal: {
          id: `goal-${projectId}`, version: 1, tenantId: tenant,
          objective: 'Find and keep an edge in momentum.',
          horizon: { startsAt: at, endsAt: at + 90 * 24 * 3_600_000, label: 'the launch window' },
          successCriteria: {
            criteria: [
              { id: 'sc-1', metric: 'pnl.net', predicate: { kind: 'limit.min', bound: 0 }, description: 'net profit is non-negative' },
              { id: 'sc-2', metric: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, description: 'bounded drawdown' },
            ],
            requiredSatisfaction: 0.5,
          },
          evaluation: { blindRef: 'eval:blind-1', walkForwardRef: 'eval:wf-1', regimeRef: 'eval:regime-1', adversarialRequired: true },
          createdAt: at,
        },
        constraintSet: {
          id: `cs-${projectId}`, version: 1, tenantId: tenant,
          constraints: [
            { id: 'c-1', domain: 'outcome', subject: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, severity: 'blocking', description: 'the drawdown ceiling' },
            { id: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: '500000.00' }, severity: 'blocking' },
            { id: 'k-risk-budget', domain: 'outcome', subject: 'risk.budget', predicate: { kind: 'equals', value: '40000.00' }, severity: 'blocking' },
          ],
          createdAt: at,
        },
        at,
      },
    });
    expect(created.status).toBe(201);
    const kickoff = service.handle({
      method: 'POST',
      path: '/v1/jobs/research',
      headers: { ...bearer, 'idempotency-key': `idem:fwmib:kickoff:${projectId}` },
      body: {
        kind: 'research',
        projectId,
        spec: {
          kind: 'console-launch',
          objective: 'Find and keep an edge in momentum.',
          horizon: { startsAt: at, endsAt: at + 90 * 24 * 3_600_000, label: 'the launch window' },
          capitalBudget: '500000.00',
          riskBudget: '40000.00',
          markets: ['BTC-USD', 'ETH-USD'],
          venues: ['binance', 'kraken'],
          dataSources: ['candle-v1', 'depth-v1'],
          executionMode: 'simulation',
          preferences: [],
        },
      },
    });
    expect(kickoff.status).toBe(202);
  }

  it('the full story: launch -> ONE machinery tick (the org compile) -> the blotter + the outcome/post-mortem reads serve the desk\'s OWN stream — named bodies, the 7 checks, a numeric refusal, an adverse-gap outcome, a confidence-rated post-mortem', async () => {
    const composed = composeDeployment(apiEnv({ [API_ENV_KEYS.apiInternalToken]: 'tok-internal-demo', [API_ENV_KEYS.apiInternalPrincipal]: 'demo-machinery' }));
    expect(composed.ok).toBe(true);
    if (!composed.ok || composed.demo === null || composed.demo.tick === null) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    const launchAt = 1_700_500_000_000;
    launchDesk(composed.service, 'prj-desk-evidence', launchAt);

    // BEFORE the compile: the honest pre-fix emptiness (a draft desk has no
    // trading history — the derivation's compile gate answers null).
    expect(demoProjectEvidenceOf(composed.demo.ports, VALID_ENV[API_ENV_KEYS.apiDeveloperTenant], 'prj-desk-evidence')).toBeNull();
    const preCompile = composed.service.handle({ method: 'POST', path: '/v1/outcomes/query', headers: bearer, body: { project: 'prj-desk-evidence', at: launchAt + 10_000 } });
    expect(((preCompile.body as { data: { items: readonly unknown[] } }).data).items).toEqual([]);

    // ONE request through the full handler: the router's per-request tick
    // compiles the organization (the R4 pass), and the SAME request's
    // blotter read serves the desk's own derived stream.
    const blotter = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: '/v1/execution/submissions?project=prj-desk-evidence', headers: bearer }), blotter.response);
    expect(blotter.captured().status).toBe(200);
    const rows = (JSON.parse(blotter.captured().payload as string) as { data: { items: readonly Record<string, unknown>[] } }).data.items;
    expect(rows).toHaveLength(3); // 2 routed fills + 1 honest pre-trade-risk refusal
    const routedRows = rows.filter((row) => row.kind === 'routed') as unknown as readonly { kind: string; decisionBody: string; decisionRationale: string; riskChecks: readonly { dimension: string; outcome: string }[]; order: { instrumentId: string; venueId: string; quantity: string; price: string }; fill: { notional: string; fee: string; quantity: string; price: string }; evidence: readonly { kind: string; ref: string }[] }[];
    const refusedRow = rows.find((row) => row.kind === 'refused') as unknown as { kind: string; decisionBody: string; decisionRationale: string; refusal: { stage: string; refusals: readonly { constraintId: string; subject: string; predicate: { kind: string; value?: string; bound?: number }; observed: string }[] }; order: { instrumentId: string; venueId: string; quantity: string; price: string } };
    expect(routedRows).toHaveLength(2);
    // THE NAMED DECIDING BODIES (MI-D10): the desk's own identity, the platform's named risk gate — never "unknown".
    expect(routedRows.every((row) => row.decisionBody === 'desk:prj-desk-evidence-execution')).toBe(true);
    expect(refusedRow.decisionBody).toBe('gate:pre-trade-risk');
    // THE SEVEN NAMED PRE-TRADE CHECKS on every routed row (the audit spine).
    expect(routedRows.every((row) => row.riskChecks.map((check) => check.dimension).join(',') === 'kill_switch,identity,authorization,limits,venue_permissions,rate_limits,credentials')).toBe(true);
    // THE INSTRUMENTS + VENUE are the desk's OWN world (BTC-USD/ETH-USD on binance — not the demo seed's BROKER-FIX).
    expect(routedRows[0]!.order.instrumentId).toBe('BTC-USD');
    expect(routedRows[0]!.order.venueId).toBe('binance');
    expect(routedRows[1]!.order.instrumentId).toBe('ETH-USD');
    // THE NOTIONAL MATH reconciles exactly from the printed qty x price (exact decimals).
    for (const row of routedRows) {
      const [intPart, fracPart = ''] = row.order.quantity.split('.');
      const [priceInt, priceFrac = ''] = row.order.price.split('.');
      let scale = fracPart.length + priceFrac.length;
      let product = BigInt(`${intPart}${fracPart}`) * BigInt(`${priceInt}${priceFrac}`);
      while (scale > 0 && product % 10n === 0n) { product /= 10n; scale -= 1; } // the canonical form strips trailing fraction zeros
      const plain = product.toString();
      const expected = scale === 0 ? plain : `${plain.padStart(scale + 1, '0').slice(0, -scale)}.${plain.padStart(scale + 1, '0').slice(-scale)}`;
      expect(row.fill.notional).toBe(expected);
    }
    expect(routedRows[0]!.fill.notional).toBe('48000'); // 0.8 x 60000 — sized inside the declared budgets
    // THE HONEST REFUSAL (FW-36-A, E-2): quotes the mandate's OWN declared
    // capital-budget bound (equals 500000.00) with the TRUE projected book —
    // the order line + the prior fills reconcile by inspection. The pre-fix
    // behavior (the c-1 drawdown ceiling quoted with observed = bound x 1.2,
    // a FABRICATED number reconciling to neither the order line nor the
    // book) is gone; the drawdown bound itself is now gate-evaluated as a
    // DERIVED fraction of the declared capital (12 / 500000 vs 0.2 — inside).
    expect(refusedRow.refusal.stage).toBe('risk_limits');
    const quoted = refusedRow.refusal.refusals[0]!;
    expect(quoted.constraintId).toBe('k-capital-budget');
    expect(quoted.subject).toBe('capital.budget');
    expect(quoted.predicate.kind).toBe('equals');
    expect(quoted.predicate.value).toBe('500000.00');
    // prior cumulative book 60000 + the candidate's own order line 8.333333 x 60000 = 499999.98, exact.
    expect(quoted.observed).toBe('559999.98');
    expect(refusedRow.order.quantity).toBe('8.333333');
    expect(refusedRow.order.price).toBe('60000');
    expect(refusedRow.decisionRationale).toContain('500000');
    expect(refusedRow.decisionRationale).toContain('559999.98');
    // The row carries the gate's OWN evaluation of every declared constraint
    // at the concentration candidate — the drawdown ceiling evaluated as the
    // DERIVED fraction of the declared capital, itemized.
    const drawdownEvaluation = (refusedRow as { limitsEvaluation?: readonly { constraintId: string; verdict: string; observed: string | null; arithmetic: string | null }[] }).limitsEvaluation?.find((row) => row.constraintId === 'c-1');
    expect(drawdownEvaluation?.verdict).toBe('pass');
    expect(drawdownEvaluation?.observed).toBe('0.000024'); // 12 / 500000 — derived, never fabricated
    expect(drawdownEvaluation?.arithmetic).toContain('12');
    expect(drawdownEvaluation?.arithmetic).toContain('500000');
    // THE AUDIT PROSE cites the desk's actual goal numbers (its budgets, verbatim).
    expect(routedRows[0]!.decisionRationale).toContain('500000.00');
    expect(routedRows[0]!.decisionRationale).toContain('40000.00');

    // THE OUTCOME + POST-MORTEM READS (the frozen boundary routes over the
    // wrapped port): the adverse-gap story with tolerance + the
    // confidence-rated hypothesis attached to its outcome.
    const outcomes = composed.service.handle({ method: 'POST', path: '/v1/outcomes/query', headers: bearer, body: { project: 'prj-desk-evidence', at: launchAt + 10_000 } });
    expect(outcomes.status).toBe(200);
    const outcomeItems = (outcomes.body as { data: { items: readonly { outcomeId: string; outcomeClass: string; decisionBody: string; expectation: { expectedRealized: string; tolerance: string; declaredBy: string }; realization: { realizedOutcome: string; notionalTotal: string }; deviation: { realizedGap: string; withinTolerance: boolean }; riskChecks: readonly unknown[] }[] } }).data.items;
    expect(outcomeItems).toHaveLength(1);
    const outcome = outcomeItems[0]!;
    expect(outcome.outcomeClass).toBe('adverse_gap');
    expect(outcome.decisionBody).toBe('desk:prj-desk-evidence-execution'); // the named body — MI-D10
    expect(outcome.expectation.declaredBy).toBe('spec-launch-director'); // the launch director — the spec-demo-director pattern, per-project
    expect(outcome.expectation.expectedRealized).toBe('48');
    expect(outcome.realization.realizedOutcome).toBe('-12');
    expect(outcome.expectation.tolerance).toBe('4.8');
    expect(outcome.deviation.realizedGap).toBe('-60');
    expect(outcome.deviation.withinTolerance).toBe(false);
    expect(outcome.riskChecks).toHaveLength(7);
    expect(outcome.realization.notionalTotal).toBe('48000'); // the fill's own economics — one coherent tale
    const mortems = composed.service.handle({ method: 'POST', path: '/v1/post-mortems/query', headers: bearer, body: { project: 'prj-desk-evidence', at: launchAt + 10_000, latestPerOutcome: true } });
    expect(mortems.status).toBe(200);
    const mortemItems = (mortems.body as { data: { items: readonly { postMortemId: string; subject: { outcomeRecordRef: string }; hypotheses: readonly { class: string; confidence: string; note: string }[] }[] } }).data.items;
    expect(mortemItems).toHaveLength(1);
    const mortem = mortemItems[0]!;
    expect(mortem.subject.outcomeRecordRef).toBe(outcome.outcomeId); // attached to ITS outcome (the D-2 convention)
    expect(mortem.hypotheses[0]!.class).toBe('decision');
    expect(mortem.hypotheses[0]!.confidence).toBe('0.8'); // confidence-rated
    expect(mortem.hypotheses[0]!.note).toContain('simulated'); // the honesty discipline — the attribution says simulated

    // DETERMINISM + IDEMPOTENCE: a re-read serves the SAME records (never a duplicate — the fold is pure).
    const reread = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: '/v1/execution/submissions?project=prj-desk-evidence', headers: bearer }), reread.response);
    const rereadRows = (JSON.parse(reread.captured().payload as string) as { data: { items: readonly { submissionId: string }[] } }).data.items;
    expect(rereadRows.map((row) => row.submissionId)).toEqual(rows.map((row) => (row as { submissionId: string }).submissionId));
  });

  it('the gates stay honest: WITHOUT the internal credential nothing compiles and nothing serves; a WORLD-LESS launch derives no stream; the DEMO project\'s own records stay byte-identical (the derived stream never doubles them)', async () => {
    const composed = composeDeployment(apiEnv()); // NO internal credential — the machinery is absent (tick null)
    expect(composed.ok).toBe(true);
    if (!composed.ok || composed.demo === null) return;
    expect(composed.demo.tick).toBeNull();
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };
    launchDesk(composed.service, 'prj-desk-unmachined', 1_700_600_000_000);
    // Uncompiled forever (no tick) — the honest pre-fix emptiness.
    const blotter = capture();
    await handleDeploymentRequest(composed, streamingRequest({ method: 'GET', url: '/v1/execution/submissions?project=prj-desk-unmachined', headers: bearer }), blotter.response);
    expect(blotter.captured().status).toBe(200);
    expect((JSON.parse(blotter.captured().payload as string) as { data: { items: readonly unknown[] } }).data.items).toEqual([]);
    const outcomes = composed.service.handle({ method: 'POST', path: '/v1/outcomes/query', headers: bearer, body: { project: 'prj-desk-unmachined', at: 1_700_600_010_000 } });
    expect(((outcomes.body as { data: { items: readonly unknown[] } }).data).items).toEqual([]);

    // A WORLD-LESS launch (a foreign kickoff spec — no console-launch world captured): no stream even once compiled.
    const machined = composeDeployment(apiEnv({ [API_ENV_KEYS.apiInternalToken]: 'tok-internal-demo', [API_ENV_KEYS.apiInternalPrincipal]: 'demo-machinery' }));
    if (!machined.ok || machined.demo === null || machined.demo.tick === null) return;
    const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
    const created = machined.service.handle({
      method: 'POST',
      path: '/v1/projects',
      headers: bearer,
      body: {
        id: 'prj-desk-worldless', name: 'the worldless desk', executionMode: 'simulation',
        goal: { id: 'goal-prj-desk-worldless', version: 1, tenantId: tenant, objective: 'an objective', horizon: { startsAt: 1_700_700_000_000, endsAt: 1_700_700_000_000 + 86_400_000 }, successCriteria: { criteria: [{ id: 'sc-1', metric: 'pnl.net', predicate: { kind: 'limit.min', bound: 0 } }], requiredSatisfaction: 1 }, evaluation: { blindRef: 'eval:b', walkForwardRef: 'eval:w', regimeRef: 'eval:r', adversarialRequired: true }, createdAt: 1_700_700_000_000 },
        constraintSet: { id: 'cs-prj-desk-worldless', version: 1, tenantId: tenant, constraints: [{ id: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: '100000.00' }, severity: 'blocking' }], createdAt: 1_700_700_000_000 },
        at: 1_700_700_000_000,
      },
    });
    expect(created.status).toBe(201);
    const kickoff = machined.service.handle({ method: 'POST', path: '/v1/jobs/research', headers: { ...bearer, 'idempotency-key': 'idem:fwmib:worldless' }, body: { kind: 'research', projectId: 'prj-desk-worldless', spec: { kind: 'demo-seed', note: 'not a console launch' } } });
    expect(kickoff.status).toBe(202);
    machined.demo.tick(1_700_700_001_000); // compiles the org — but no world means no honest desk stream
    expect((machined.service.handle({ method: 'GET', path: '/v1/projects/prj-desk-worldless', headers: bearer }).body as { data: { lifecycle: { organizationRef: string | null } } }).data.lifecycle.organizationRef).not.toBeNull();
    expect(demoProjectEvidenceOf(machined.demo.ports, tenant, 'prj-desk-worldless')).toBeNull();

    // THE DEMO PROJECT stays byte-identical: its own hand-authored seed serves, the derivation never touches it.
    expect(demoProjectEvidenceOf(machined.demo.ports, tenant, DEMO_PROJECT_ID)).toBeNull();
    const demoBlotter = capture();
    await handleDeploymentRequest(machined, streamingRequest({ method: 'GET', url: `/v1/execution/submissions?project=${encodeURIComponent(DEMO_PROJECT_ID)}`, headers: bearer }), demoBlotter.response);
    const demoRows = (JSON.parse(demoBlotter.captured().payload as string) as { data: { items: readonly { submissionId: string; decisionBody?: string }[] } }).data.items;
    expect(demoRows).toHaveLength(3); // the SEEDED demo blotter, unchanged
    expect(demoRows.every((row) => row.decisionBody === undefined || row.decisionBody === 'desk:tradrl-demo-execution' || row.decisionBody === 'gate:pre-trade-risk')).toBe(true);
    const demoOutcomes = machined.service.handle({ method: 'POST', path: '/v1/outcomes/query', headers: bearer, body: { project: DEMO_PROJECT_ID, at: 1_730_000_000_000 } });
    expect((((demoOutcomes.body as { data: { items: readonly { outcomeId: string }[] } }).data).items).map((entry) => entry.outcomeId)).toEqual(['out:demo0001']);
  });

  it('L12 + determinism across instances: a foreign tenant\'s fold finds nothing; two compositions derive the IDENTICAL stream for the same envelope (content-addressed ids)', async () => {
    const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
    const first = composeDeployment(apiEnv({ [API_ENV_KEYS.apiInternalToken]: 'tok-internal-demo', [API_ENV_KEYS.apiInternalPrincipal]: 'demo-machinery' }));
    if (!first.ok || first.demo === null || first.demo.tick === null) return;
    launchDesk(first.service, 'prj-desk-determinism', 1_700_800_000_000);
    first.demo.tick(1_700_800_001_000);
    const firstSeed = demoProjectEvidenceOf(first.demo.ports, tenant, 'prj-desk-determinism');
    expect(firstSeed).not.toBeNull();
    // L12: the fold keys on the AUTHORIZED tenant — a foreign tenant's captures never existed.
    expect(demoProjectEvidenceOf(first.demo.ports, 'tenant-other-demo', 'prj-desk-determinism')).toBeNull();
    // A SECOND composition (a fresh serverless instance): the same launch + the same compile derive the SAME bytes.
    const second = composeDeployment(apiEnv({ [API_ENV_KEYS.apiInternalToken]: 'tok-internal-demo', [API_ENV_KEYS.apiInternalPrincipal]: 'demo-machinery' }));
    if (!second.ok || second.demo === null || second.demo.tick === null) return;
    launchDesk(second.service, 'prj-desk-determinism', 1_700_800_000_000);
    second.demo.tick(1_700_800_001_000);
    const secondSeed = demoProjectEvidenceOf(second.demo.ports, tenant, 'prj-desk-determinism');
    expect(secondSeed).not.toBeNull();
    expect(canonicalJson(secondSeed as never)).toBe(canonicalJson(firstSeed as never)); // byte-identical — no seeded state, no drift
  });
});
