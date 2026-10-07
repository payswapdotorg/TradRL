// THE CLIENT HEADER PINS (FW-MI-A, MI-D1) — the client mirror's additive
// `headers` construction seam: the console session header rides every
// request the client sends, the credential's authorization ALWAYS wins
// (a caller cannot override the token through this seam), and the
// per-request headers (the idempotency key) still apply.

import { describe, expect, it } from 'vitest';
import type { ApiTransport, SdkRequest } from './transport';
import { createConsoleClient } from './client';
import { CONSOLE_SESSION_HEADER } from '../core/session';

/** A scripted transport that records every request it serves (the injected seam — the client under test rides it). */
function recordingTransport(): { readonly transport: ApiTransport; readonly requests: SdkRequest[] } {
  const requests: SdkRequest[] = [];
  const transport: ApiTransport = async (request) => {
    requests.push(request);
    const ok = (data: unknown) => ({ status: 200, headers: {}, body: { requestId: 'req-session-headers', data } });
    const key = `${request.method} ${decodeURIComponent(request.path.split('?')[0])}`;
    if (key === 'GET /v1/meta') return ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] });
    if (key === 'GET /v1/projects') return ok({ items: [] });
    if (key === 'POST /v1/projects') return ok({ id: 'prj-created', tenantId: 'tenant-a' });
    return { status: 404, headers: {}, body: { requestId: 'req-session-headers', error: { code: 'not_found', message: 'no route', status: 404 } } };
  };
  return { transport, requests };
}

describe('api/client — the session-header construction seam (FW-MI-A, MI-D1)', () => {
  it('the session header rides EVERY request alongside the authorization (the negotiation + the listing + the create)', async () => {
    const api = recordingTransport();
    const client = createConsoleClient({ transport: api.transport, token: 'token-a', headers: { [CONSOLE_SESSION_HEADER]: 'session-a-000000000001' } });
    await client.negotiateVersion();
    await client.projects.listAll();
    await client.projects.create({ id: 'prj-created', name: 'desk', executionMode: 'simulation', goal: {} as never, constraintSet: {} as never, at: 1 });
    expect(api.requests.length).toBeGreaterThanOrEqual(3);
    for (const request of api.requests) {
      expect(request.headers[CONSOLE_SESSION_HEADER]).toBe('session-a-000000000001'); // the session header is on every wire request
      expect(request.headers.authorization).toBe('Bearer token-a'); // the credential still rides (L12 — the boundary's own auth)
    }
  });

  it('the credential ALWAYS wins: an extra header cannot override the authorization (the seam never widens access)', async () => {
    const api = recordingTransport();
    const client = createConsoleClient({ transport: api.transport, token: 'token-a', headers: { authorization: 'Bearer forged', [CONSOLE_SESSION_HEADER]: 'session-a' } });
    await client.negotiateVersion();
    expect(api.requests[0]?.headers.authorization).toBe('Bearer token-a'); // the token, never the forged header
    expect(api.requests[0]?.headers[CONSOLE_SESSION_HEADER]).toBe('session-a');
  });

  it('the per-request idempotency header still applies (the create carries its key alongside the session header)', async () => {
    const api = recordingTransport();
    const client = createConsoleClient({ transport: api.transport, token: 'token-a', headers: { [CONSOLE_SESSION_HEADER]: 'session-a' } });
    await client.negotiateVersion();
    await client.projects.create({ id: 'prj-created', name: 'desk', executionMode: 'simulation', goal: {} as never, constraintSet: {} as never, at: 1 }, { idempotencyKey: 'idem-1' });
    const create = api.requests.find((request) => request.method === 'POST') as SdkRequest;
    expect(create.headers['idempotency-key']).toBe('idem-1'); // the per-request header still rides
    expect(create.headers[CONSOLE_SESSION_HEADER]).toBe('session-a'); // alongside the session header
  });

  it('no headers configured = the pre-fix wire shape (authorization only) — the seam is additive, never required', async () => {
    const api = recordingTransport();
    const client = createConsoleClient({ transport: api.transport, token: 'token-a' });
    await client.negotiateVersion();
    expect(api.requests[0]?.headers).toEqual({ authorization: 'Bearer token-a' });
  });
});
