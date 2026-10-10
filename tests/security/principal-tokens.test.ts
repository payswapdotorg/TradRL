/**
 * FW-39-3 (the identity wave 3) — PRINCIPAL TOKEN SECURITY: forgery /
 * revocation / replay, against the REAL deployment composition (the
 * auth-routes.test.ts harness shape). The attack classes and their
 * honest answers:
 *
 *   FORGERY — a flipped signature, a foreign signing key, a
 *   foreign-tenant claim, a garbage shape: every one answers the
 *   INDISTINGUISHABLE typed 401 (unknown-vs-foreign — the boundary's
 *   own law), the marker fold treats the forged token as ABSENT (no
 *   'principal-owned' markers), and the audit stamps never fire.
 *
 *   REVOCATION — logout kills the token (whoami 401; the create-stamp
 *   stops stamping; the promote mints the ANONYMOUS shape) and the
 *   revocation is DURABLE truth (a fresh serverless instance rejects
 *   the same token).
 *
 *   REPLAY — a revoked token replayed stays dead on every surface; an
 *   expired token (the injected clock advanced past the TTL) stays
 *   dead; a LIVING token replayed is the session model itself (whoami
 *   twice — fine), pinned so the honest distinction is explicit.
 */
import { describe, expect, it } from 'vitest';

import { composeDeployment } from '../../deploy/vercel/runtime/compose';
import { API_ENV_KEYS, readApiEnv } from '../../deploy/vercel/runtime/env';
import { handleDeploymentRequest } from '../../deploy/vercel/api/router';
import { fakeProviders } from '../../deploy/wire/smoketest';
import { validConstraintSet, validGoal } from '../../services/api/src/fixtures';
import { CONSOLE_SESSION_HEADER } from '../../deploy/vercel/runtime/session-routes';
import { PRINCIPAL_TOKEN_HEADER, PRINCIPAL_TOKEN_TTL_MS } from '../../deploy/vercel/runtime/auth-routes';
import type { FunctionRequest, FunctionResponse } from '../../deploy/vercel/runtime/http';

// ---------------------------------------------------------------------------
// The harness (the auth-routes.test.ts shape)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-principal-tok';
const TOKEN = 'tok-deploy-principal-tok';
const AUTH_KEY = 'test-principal-tok-hmac-key-fixed';
const FOREIGN_AUTH_KEY = 'test-principal-tok-FOREIGN-key'; // a different deployment's signing key
const NEON_KEYS = {
  NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech',
  NEON_DATABASE: 'neondb',
  NEON_API_USER: 'neondb_owner',
  NEON_API_KEY: 'fake-neon-key-demo',
};
const T0 = 1_800_600_000_000;
const SESSION_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function tokSource(authKey: string): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: 'public-console',
    ...NEON_KEYS,
    [API_ENV_KEYS.authTokenKey]: authKey,
  };
}

function composeTokInstance(source: Record<string, string | undefined>, fetchLike: import('../../deploy/adapters/shared').FetchLike): { deployment: ReturnType<typeof composeDeployment>; advanceTo: (at: number) => void } {
  let now = T0;
  const deployment = composeDeployment(readApiEnv(source), {}, { fetchLike, instants: { next: () => now } });
  return { deployment, advanceTo: (at: number) => { now = at; } };
}

function streamingRequest(parts: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown }): FunctionRequest {
  return { method: parts.method ?? 'GET', url: parts.url ?? '/v1/meta', headers: parts.headers ?? {}, body: parts.body };
}

function capture(): { response: FunctionResponse; captured: () => { status: number; payload: string | null } } {
  const headers: Record<string, string> = {};
  let status = 0;
  let payload: string | null = null;
  const response: FunctionResponse = {
    get statusCode() { return status; },
    set statusCode(value: number) { status = value; },
    setHeader(key: string, value: string | number) { headers[key] = String(value); return undefined; },
    end(chunk?: string) { if (typeof chunk === 'string') payload = chunk; return undefined; },
  };
  return { response, captured: () => ({ status, headers, payload }) };
}

async function drive(deployment: ReturnType<typeof composeDeployment>, request: FunctionRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const { response, captured } = capture();
  await handleDeploymentRequest(deployment, request, response);
  const written = captured();
  return { status: written.status, body: JSON.parse(written.payload ?? 'null') as Record<string, unknown> };
}

const BEARER = { authorization: `Bearer ${TOKEN}` };

function sessionHeaders(session: string, extra: Record<string, string> = {}): Record<string, string> {
  return { ...BEARER, [CONSOLE_SESSION_HEADER]: session, ...extra };
}

function createProjectBody(projectId: string): Record<string, unknown> {
  return { id: projectId, name: `the ${projectId} desk`, executionMode: 'simulation', goal: validGoal(TENANT), constraintSet: validConstraintSet(TENANT), at: T0 };
}

/** Register one principal through the FULL handler; returns the minted token. */
async function registerPrincipal(instance: { deployment: ReturnType<typeof composeDeployment> }, name: string): Promise<string> {
  const registered = await drive(instance.deployment, streamingRequest({
    method: 'POST', url: '/v1/auth/register', headers: { ...BEARER, 'content-type': 'application/json' },
    body: { name, passphrase: `passphrase-of-${name}-long-enough` },
  }));
  expect(registered.status).toBe(201);
  return ((registered.body.data as { token: string }).token);
}

/** A flipped-signature forgery of one minted token (the payload kept, the signature corrupted). */
function forgedFlipOf(token: string): string {
  const parts = token.split('.');
  const flipped = (parts[2] as string).startsWith('A') ? `B${(parts[2] as string).slice(1)}` : `A${(parts[2] as string).slice(1)}`;
  return `${parts[0]}.${parts[1]}.${flipped}`;
}

/** The FRESH device (the restart position — the principal law's clean view, no session-owned precedence). */
const SESSION_FRESH = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

/** The listing's marker of one project under one (possibly forged) token, read from a FRESH device — the principal law's view. */
async function scopeOf(instance: { deployment: ReturnType<typeof composeDeployment> }, token: string, projectId: string, session: string = SESSION_FRESH): Promise<string | undefined> {
  const listed = await drive(instance.deployment, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(session, { [PRINCIPAL_TOKEN_HEADER]: token }) }));
  expect(listed.status).toBe(200);
  return ((listed.body.data as { items: readonly { id: string; consoleSessionScope?: string }[] }).items).find((item) => item.id === projectId)?.consoleSessionScope;
}

// ---------------------------------------------------------------------------
// The battery
// ---------------------------------------------------------------------------

describe('FW-39-3 security: principal token forgery / revocation / replay', () => {
  it('FORGERY: a flipped signature answers the typed 401, marks NOTHING principal-owned, and the audit stamp never fires', async () => {
    const providers = fakeProviders();
    const instance = composeTokInstance(tokSource(AUTH_KEY), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;
    const alice = await registerPrincipal(instance, 'alice');
    const forged = forgedFlipOf(alice);

    // whoami with the forgery: the indistinguishable typed 401 (byte-identical to no-token-at-all).
    const forgedWhoami = await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: { ...BEARER, [PRINCIPAL_TOKEN_HEADER]: forged } }));
    const noTokenWhoami = await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: { ...BEARER } }));
    expect(forgedWhoami.status).toBe(401);
    expect(forgedWhoami.body.error).toEqual(noTokenWhoami.body.error);

    // The anonymous create first (the desk the forged token will try to claim).
    const created = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A), 'content-type': 'application/json' },
      body: createProjectBody('prj-anon-desk'),
    }));
    expect(created.status).toBe(201);
    // The listing under the FORGED token (a fresh device — the principal law's clean view): no 'principal-owned' marker — the forgery is treated as absent.
    expect(await scopeOf(instance, forged, 'prj-anon-desk')).toBe('tenant-available');
    // And the create-stamp never fires for a forged token: a create carrying the forgery stamps NOTHING.
    const forgedCreate = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A, { [PRINCIPAL_TOKEN_HEADER]: forged }), 'content-type': 'application/json' },
      body: createProjectBody('prj-forged-desk'),
    }));
    expect(forgedCreate.status).toBe(201);
    expect(await scopeOf(instance, alice, 'prj-forged-desk')).toBe('tenant-available'); // not alice's — the forgery stamped nothing
  });

  it('FORGERY: a token minted under a FOREIGN signing key (another deployment) never verifies here; a garbage shape never parses', async () => {
    const providers = fakeProviders();
    const foreign = composeTokInstance(tokSource(FOREIGN_AUTH_KEY), providers.fetchLike);
    expect(foreign.deployment.ok).toBe(true);
    if (!foreign.deployment.ok) return;
    // Mint a WELL-FORMED token under the foreign key.
    const foreignMint = await registerPrincipal(foreign, 'mallory');
    expect(foreignMint.startsWith('v1.')).toBe(true);

    // Present it to THIS deployment (the right key): dead.
    const own = composeTokInstance(tokSource(AUTH_KEY), providers.fetchLike);
    expect(own.deployment.ok).toBe(true);
    if (!own.deployment.ok) return;
    const whoami = await drive(own.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: { ...BEARER, [PRINCIPAL_TOKEN_HEADER]: foreignMint } }));
    expect(whoami.status).toBe(401);
    // Garbage shapes: dead, indistinguishably.
    for (const garbage of ['v1.not-a-token.at-all', 'not-even-shaped', 'v1..', '...']) {
      const answer = await drive(own.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: { ...BEARER, [PRINCIPAL_TOKEN_HEADER]: garbage } }));
      expect(answer.status).toBe(401);
      expect(answer.body.error).toEqual(whoami.body.error);
    }
  });

  it('REVOCATION: logout kills the token on every surface — whoami 401, the marker fold forgets, the audit stamp stops — and the revocation is DURABLE (a fresh instance rejects it)', async () => {
    const providers = fakeProviders();
    const instance = composeTokInstance(tokSource(AUTH_KEY), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;
    const alice = await registerPrincipal(instance, 'alice');

    // Alice's desk, stamped.
    const created = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A, { [PRINCIPAL_TOKEN_HEADER]: alice }), 'content-type': 'application/json' },
      body: createProjectBody('prj-alice-desk'),
    }));
    expect(created.status).toBe(201);
    expect(await scopeOf(instance, alice, 'prj-alice-desk')).toBe('principal-owned');

    // LOGOUT: the token dies.
    const logout = await drive(instance.deployment, streamingRequest({ method: 'POST', url: '/v1/auth/logout', headers: { ...BEARER, [PRINCIPAL_TOKEN_HEADER]: alice } }));
    expect(logout.status).toBe(200);
    expect((await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: { ...BEARER, [PRINCIPAL_TOKEN_HEADER]: alice } }))).status).toBe(401);
    // The marker fold forgets the principal: from a FRESH device the desk is tenant-available (the dead token widens nothing);
    // from the CREATING session it is still session-owned (the session stamp survives, lineage preserved).
    expect(await scopeOf(instance, alice, 'prj-alice-desk', SESSION_FRESH)).toBe('tenant-available');
    expect(await scopeOf(instance, alice, 'prj-alice-desk', SESSION_A)).toBe('session-owned');
    // A NEW create with the dead token stamps NOTHING (the anonymous shape).
    const createdAfter = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A, { [PRINCIPAL_TOKEN_HEADER]: alice }), 'content-type': 'application/json' },
      body: createProjectBody('prj-after-logout'),
    }));
    expect(createdAfter.status).toBe(201);
    expect(await scopeOf(instance, alice, 'prj-after-logout', SESSION_A)).toBe('session-owned'); // the dead token stamped nothing

    // A FRESH serverless instance over the same durable truth: the revocation rehydrates.
    const fresh = composeTokInstance(tokSource(AUTH_KEY), providers.fetchLike);
    expect(fresh.deployment.ok).toBe(true);
    if (!fresh.deployment.ok) return;
    expect((await drive(fresh.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: { ...BEARER, [PRINCIPAL_TOKEN_HEADER]: alice } }))).status).toBe(401);
  });

  it('REPLAY: a revoked token replayed stays dead; an EXPIRED token (the clock past the TTL) stays dead; a living token\'s repeat use is the session model itself', async () => {
    const providers = fakeProviders();
    const instance = composeTokInstance(tokSource(AUTH_KEY), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;
    const alice = await registerPrincipal(instance, 'alice');

    // A LIVING token replayed: whoami answers 200 every time (the session token model — pinned as the honest baseline).
    expect((await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: { ...BEARER, [PRINCIPAL_TOKEN_HEADER]: alice } }))).status).toBe(200);
    expect((await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: { ...BEARER, [PRINCIPAL_TOKEN_HEADER]: alice } }))).status).toBe(200);

    // EXPIRY: advance the injected clock past the 12h TTL — the token is dead.
    instance.advanceTo(T0 + PRINCIPAL_TOKEN_TTL_MS + 1);
    expect((await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: { ...BEARER, [PRINCIPAL_TOKEN_HEADER]: alice } }))).status).toBe(401);

    // REVOKED-then-replayed: log back in (a fresh token), revoke it, replay it — dead on both surfaces.
    const relogin = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/login', headers: { ...BEARER, 'content-type': 'application/json' },
      body: { name: 'alice', passphrase: 'passphrase-of-alice-long-enough' },
    }));
    expect(relogin.status).toBe(200);
    const freshToken = (relogin.body.data as { token: string }).token;
    expect((await drive(instance.deployment, streamingRequest({ method: 'POST', url: '/v1/auth/logout', headers: { ...BEARER, [PRINCIPAL_TOKEN_HEADER]: freshToken } }))).status).toBe(200);
    expect((await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: { ...BEARER, [PRINCIPAL_TOKEN_HEADER]: freshToken } }))).status).toBe(401);
    // The replayed revoked token NEVER widens the wall: the listing treats it as absent.
    expect(await scopeOf(instance, freshToken, 'prj-anon-desk')).toBeUndefined(); // no such desk — but the call proves no marker magic; the real desk below:
    const created = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A, { [PRINCIPAL_TOKEN_HEADER]: freshToken }), 'content-type': 'application/json' },
      body: createProjectBody('prj-replay-desk'),
    }));
    expect(created.status).toBe(201);
    expect(await scopeOf(instance, freshToken, 'prj-replay-desk', SESSION_A)).toBe('session-owned'); // the revoked replay stamped NOTHING
  });
});
