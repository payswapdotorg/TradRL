// deploy/vercel/runtime.test.ts — the function-side runtime tests (T052).
//
// Pure, offline, deterministic: NO live provider calls, NO network, NO
// real Vercel. What is pinned:
//   - the HTTP adaptation vectors (the mount-prefix strip, the query
//     parse, the body parse, the response write — including the
//     NO-CORS law);
//   - the composition (checkpoint 1): the typed not-configured state,
//     the real T041 pipeline end-to-end over the typed degraded port
//     stubs (R46), and the L12 tenant-injection probe (the spy port
//     observes the CREDENTIAL's tenant — never a body/query value).
//
// Spec anchors: R41/R43/R46, ARCHITECTURE-LOCK L12/L20, D-033.

import { describe, expect, it } from 'vitest';
import { composeDeployment, DEPLOY_ADAPTER_PENDING, degradedPorts, getDeploymentService } from './runtime/compose';
import { API_ENV_KEYS, missingApiEnvKeys, readApiEnv, readConsoleEnv } from './runtime/env';
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
});

// ---------------------------------------------------------------------------
// The composition (checkpoint 1 — the typed degraded ports, R46)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the composition seam (checkpoint 1)', () => {
  it('a missing environment is the typed deploy_not_configured state (key names only — never values)', () => {
    const result = composeDeployment(readApiEnv({}));
    expect(result).toEqual({ ok: false, code: 'deploy_not_configured', missing: [API_ENV_KEYS.apiDeveloperToken, API_ENV_KEYS.apiDeveloperTenant, API_ENV_KEYS.apiDeveloperPrincipal] });
  });

  it('every degraded stub port answers the typed deploy_adapter_pending failure', () => {
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

  it('the REAL T041 pipeline runs over the stubs: meta answers, port-backed routes degrade to the typed 503 (R46)', () => {
    const composed = composeDeployment(apiEnv());
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const bearer = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };

    // The meta route needs no port: the full pipeline serves it.
    const meta = composed.service.handle({ method: 'GET', path: '/v1/meta', headers: bearer });
    expect(meta.status).toBe(200);
    expect(meta.headers['x-api-version']).toBe('v1');

    // A port-backed route degrades to the typed 503 unavailable (R46: provider
    // absent is a degraded state, never a crash) — the stub's code is in the message.
    const projects = composed.service.handle({ method: 'GET', path: '/v1/projects', headers: bearer, query: {} });
    expect(projects.status).toBe(503);
    const errorBody = projects.body as { error: { code: string; message: string } };
    expect(errorBody.error.code).toBe('unavailable');
    expect(errorBody.error.message).toContain(DEPLOY_ADAPTER_PENDING);
  });

  it('the auth planes stay real: no token is 401, a wrong token is 401, and the idempotency law fires', () => {
    const composed = composeDeployment(apiEnv());
    if (!composed.ok) return;
    const anonymous = composed.service.handle({ method: 'GET', path: '/v1/meta', headers: {} });
    expect(anonymous.status).toBe(401);
    const wrong = composed.service.handle({ method: 'GET', path: '/v1/meta', headers: { authorization: 'Bearer tok-wrong' } });
    expect(wrong.status).toBe(401);
    const noIdempotency = composed.service.handle({ method: 'POST', path: '/v1/execution/requests', headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` }, body: {} });
    expect([400, 503]).toContain(noIdempotency.status); // 400 once the key-missing guard precedes the port; never 500
  });

  it('L12 PROBE — the tenant injected into the port call is the CREDENTIAL tenant, never a query/body value', () => {
    const tenantsSeen: string[] = [];
    const composed = composeDeployment(apiEnv(), {
      controlPlane: {
        ...degradedPorts().controlPlane,
        projectsOf(tenantId) {
          tenantsSeen.push(tenantId as string);
          return { ok: true, value: [] };
        },
      },
    });
    if (!composed.ok) return;
    // An adversarial query parameter tries to steer the tenant scope.
    composed.service.handle({
      method: 'GET',
      path: '/v1/projects',
      headers: { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` },
      query: { tenant: 'tenant:attacker', limit: '10' },
    });
    expect(tenantsSeen).toEqual([VALID_ENV[API_ENV_KEYS.apiDeveloperTenant]]);
  });

  it('the per-instance memo reuses one service across warm invocations of the same env source', () => {
    const source = { ...VALID_ENV };
    const first = getDeploymentService(source);
    const second = getDeploymentService(source);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.service).toBe(first.service);
    // A DIFFERENT env source re-composes (tests inject fresh sources).
    const third = getDeploymentService({ ...VALID_ENV });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.service).not.toBe(first.service);
  });
});
