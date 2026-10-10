// deploy/vercel/auth-routes.test.ts — THE PRINCIPAL AUTH ROUTES' PINS
// (FW-39-1, the identity wave 1 — the G-11 restart-orphan substrate).
//
// Pure, offline, deterministic: the REAL composition (runtime/compose.ts)
// over the fake provider fleet's fetch (deploy/wire/smoketest.ts — no
// network, FIXED FAKE credentials), driving the FULL function handler
// (api/router.ts: tick -> wrap -> auth route -> session routes ->
// demo-substance routes -> boundary -> drain). What this file pins —
// the work order's test law:
//
//   - REGISTER + WHOAMI: the named principal registers (201), the minted
//     token identifies on whoami (200), and the credential material —
//     the salt, the verifier, the passphrase — NEVER crosses any wire
//     the routes serve;
//   - LOGIN: the passphrase exchanges for a scoped, expiring token; an
//     unknown name and a wrong passphrase answer the BYTE-IDENTICAL
//     typed 401 (unknown-vs-foreign indistinguishable);
//   - LOGOUT + REVOCATION: the token dies (whoami 401 after logout), the
//     revocation is enforced loudly (a second logout answers the 401),
//     and it is DURABLE truth (a fresh instance rejects the same token);
//   - TOKEN EXPIRY: a token past its exp is dead (the injected mutable
//     clock advances past the TTL);
//   - THE DEMO BACKING'S HONEST UNAVAILABILITY (R46): every auth route
//     answers the typed not-available 503 naming the durable-backing
//     requirement (an account must never silently cold-start reset) —
//     authn still first (a bad bearer answers the 401 even under demo);
//   - THE ADOPTION LAW: the calling session's OWN desks re-stamp
//     ownerPrincipal additively (idempotent, per-desk response, the demo
//     project never adoptable, the request body never a widening
//     parameter);
//   - THE 'principal-owned' MARKER: a logged-in principal's desks list
//     as own even under a FRESH session id (the G-11 closure), and the
//     principal identity itself NEVER crosses the wire on reads (the
//     ownerSession precedent);
//   - THE CREATE-STAMP: a create carrying a valid principal token stamps
//     ownerPrincipal BESIDE ownerSession (lineage preserved);
//   - SDK PARITY: a wrong-method /v1/auth path falls through to the
//     boundary's typed not-found.
//
// FW-40-D (the auth-route brute-force guard) pins the work order's five
// laws + the honest mechanics:
//   (a) five FAILED registers on one identity -> the SIXTH attempt
//       answers the typed 429 (the guard consults BEFORE the route);
//   (b) a SUCCESSFUL LOGIN after four failures RESETS the identity
//       bucket (legitimate users are not locked out by their own
//       success);
//   (c) the ADOPT route is NOT throttled beyond the existing law — it
//       stays exactly as shipped (no guard, no counting, no parameter);
//   (d) the 429 is TYPED + DISCLOSED per the R46 vocabulary (the closed
//       `rate_limited` code, retryAfterMs + the retry-after-ms header,
//       the reason naming the exhausted budget);
//   (e) WHOAMI (a read) is not throttled by the failure counter;
//   + the per-source bucket bounds identity-probing (a fresh name per
//     attempt), the fixed window rolls with the injected clock, the
//     bounds are env-configurable and fail CLOSED on a malformed value,
//     the state is in-memory per instance (a cold start clears it), a
//     degraded store read charges NEITHER bucket (R46), the authn-401 +
//     not-available-503 teachings stay louder than the throttle, and a
//     validation 400 charges nothing (no honest identity to charge).
//
// The DURABLE substrate pins (the registry's cold-start survival) live
// here too — the same fake fetch backs a SECOND composition (a fresh
// "serverless instance" over the same durable truth).

import { describe, expect, it } from 'vitest';
import { composeDeployment } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { fakeProviders } from '../wire/smoketest';
import { validCreateProjectRequest } from '../../services/api/src/fixtures';
import { DEMO_PROJECT_ID } from './runtime/demo';
import { CONSOLE_SESSION_HEADER } from './runtime/session-routes';
import { PRINCIPAL_TOKEN_HEADER, PRINCIPAL_TOKEN_TTL_MS } from './runtime/auth-routes';
import type { FunctionRequest, FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// The harness (the full function-handler path — the durable.test.ts shape)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-auth';
const TOKEN = 'tok-deploy-auth';
const PRINCIPAL = 'public-console';
const AUTH_KEY = 'test-auth-hmac-key-fixed';
const NEON_KEYS = {
  NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech',
  NEON_DATABASE: 'neondb',
  NEON_API_USER: 'neondb_owner',
  NEON_API_KEY: 'fake-neon-key-demo',
};
const T0 = 1_800_400_000_000;
const SESSION_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // 32-hex — the console's mint shape
const SESSION_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; // a FRESH session id (the restart)

/** A durable env WITH the auth key configured (the wave-1 deployment shape). */
function authSource(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
    ...NEON_KEYS,
    [API_ENV_KEYS.authTokenKey]: AUTH_KEY,
    ...overrides,
  };
}

/**
 * The composition over a MUTABLE clock: the token mint/verify instants
 * advance per test (the expiry pin's lever), while the seam's bookkeeping
 * rides the same source.
 */
function composeAuthInstance(source: Record<string, string | undefined>, fetchLike: import('../adapters/shared').FetchLike): { deployment: ReturnType<typeof composeDeployment>; advanceTo: (at: number) => void } {
  let now = T0;
  const deployment = composeDeployment(readApiEnv(source), {}, { fetchLike, instants: { next: () => now } });
  return { deployment, advanceTo: (at: number) => { now = at; } };
}

/** An outage-controllable fetch (the R46 lever). */
function outageFetch(inner: import('../adapters/shared').FetchLike): { readonly fetchLike: import('../adapters/shared').FetchLike; setOutage(down: boolean): void } {
  let down = false;
  return {
    fetchLike: (url, init) => (down ? Promise.reject(new Error('connection refused (simulated provider outage)')) : inner(url, init)),
    setOutage: (value: boolean) => { down = value; },
  };
}

interface CapturedResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly payload: string | null;
}

function streamingRequest(parts: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown }): FunctionRequest {
  return { method: parts.method ?? 'GET', url: parts.url ?? '/v1/meta', headers: parts.headers ?? {}, body: parts.body };
}

function capture(): { response: FunctionResponse; captured: () => CapturedResponse } {
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

type Composition = ReturnType<typeof composeDeployment>;

/** Drive one request through the FULL function handler; returns the parsed JSON body. */
async function drive(deployment: Composition, request: FunctionRequest): Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown> }> {
  const { response, captured } = capture();
  await handleDeploymentRequest(deployment, request, response);
  const written = captured();
  return { status: written.status, headers: written.headers, body: JSON.parse(written.payload ?? 'null') as Record<string, unknown> };
}

/** The bearer headers of the deployment's developer credential. */
const BEARER = { authorization: `Bearer ${TOKEN}` };

/** The session-scoped headers of one console session. */
function sessionHeaders(session: string, extra: Record<string, string> = {}): Record<string, string> {
  return { ...BEARER, [CONSOLE_SESSION_HEADER]: session, ...extra };
}

/** The register/login bodies. */
function registerBody(name: string, passphrase: string): Record<string, unknown> {
  return { name, passphrase };
}

/** The auth headers carrying one minted principal token. */
function principalHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { ...BEARER, [PRINCIPAL_TOKEN_HEADER]: token, ...extra };
}

/** One registered principal's minted token + identity (the ceremony's common preamble). */
async function registeredPrincipal(instance: { deployment: Composition; advanceTo: (at: number) => void }): Promise<{ readonly token: string; readonly principalId: string }> {
  const registered = await drive(instance.deployment, streamingRequest({
    method: 'POST', url: '/v1/auth/register', headers: { ...BEARER, 'content-type': 'application/json' },
    body: registerBody('alice', 'correct horse battery staple'),
  }));
  expect(registered.status).toBe(201);
  const data = registered.body.data as { token: string; principal: { id: string } };
  return { token: data.token, principalId: data.principal.id };
}

// ---------------------------------------------------------------------------
// The pins
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-39-1: the principal auth routes over the DURABLE backing', () => {
  it('register + whoami: the named principal registers (201) and the minted token identifies (200) — the credential material NEVER crosses the wire', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;

    const registered = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/register', headers: { ...BEARER, 'content-type': 'application/json' },
      body: registerBody('alice', 'correct horse battery staple'),
    }));
    expect(registered.status).toBe(201);
    const data = registered.body.data as { principal: { id: string; name: string }; token: string; expiresAt: number };
    expect(data.principal.name).toBe('alice');
    expect(data.principal.id).toMatch(/^prn-/);
    expect(typeof data.token).toBe('string');
    expect(data.token.startsWith('v1.')).toBe(true); // the token's structural shape
    expect(data.expiresAt).toBe(T0 + PRINCIPAL_TOKEN_TTL_MS); // the 12h TTL over the injected clock
    // THE VERIFIER-NEVER-SERVED LAW: no credential material crosses any wire.
    expect(JSON.stringify(registered.body)).not.toContain('verifier');
    expect(JSON.stringify(registered.body)).not.toContain('salt');
    expect(JSON.stringify(registered.body)).not.toContain('correct horse');

    // whoami: the token identifies the principal.
    const whoami = await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: principalHeaders(data.token) }));
    expect(whoami.status).toBe(200);
    const whoamiData = whoami.body.data as { principal: { id: string; name: string }; expiresAt: number };
    expect(whoamiData.principal).toEqual(data.principal);
    expect(whoamiData.expiresAt).toBe(data.expiresAt);
    expect(JSON.stringify(whoami.body)).not.toContain('verifier');

    // whoami without a token / with garbage: the uniform typed 401 (indistinguishable).
    const noToken = await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: { ...BEARER } }));
    expect(noToken.status).toBe(401);
    expect((noToken.body.error as { code: string }).code).toBe('unauthenticated');
    const garbage = await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: principalHeaders('v1.not-a-token.at-all') }));
    expect(garbage.status).toBe(401);
    expect((garbage.body.error as { code: string; message: string }).message).toBe((noToken.body.error as { code: string; message: string }).message);
  });

  it('login: the passphrase exchanges for a token; an UNKNOWN name and a WRONG passphrase answer the BYTE-IDENTICAL typed 401 (indistinguishable)', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    if (!instance.deployment.ok) return;
    await registeredPrincipal(instance);

    // A correct login.
    const login = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/login', headers: { ...BEARER, 'content-type': 'application/json' },
      body: registerBody('alice', 'correct horse battery staple'),
    }));
    expect(login.status).toBe(200);
    const data = login.body.data as { token: string; principal: { name: string } };
    expect(data.principal.name).toBe('alice');
    expect(data.token.startsWith('v1.')).toBe(true);
    expect(JSON.stringify(login.body)).not.toContain('verifier');

    // The two failure classes — byte-identical envelopes.
    const unknownName = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/login', headers: { ...BEARER, 'content-type': 'application/json' },
      body: registerBody('bob', 'whatever-passphrase'),
    }));
    const wrongPassphrase = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/login', headers: { ...BEARER, 'content-type': 'application/json' },
      body: registerBody('alice', 'wrong passphrase entirely'),
    }));
    expect(unknownName.status).toBe(401);
    expect(wrongPassphrase.status).toBe(401);
    expect(unknownName.body.error).toEqual(wrongPassphrase.body.error); // THE indistinguishability pin
  });

  it('register validation: a short passphrase / a missing name answer the typed 400 with problems; a duplicate name answers the typed 409', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    if (!instance.deployment.ok) return;
    await registeredPrincipal(instance);

    const short = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/register', headers: { ...BEARER, 'content-type': 'application/json' },
      body: { name: 'bob', passphrase: 'short' },
    }));
    expect(short.status).toBe(400);
    const problems = (short.body.error as { code: string; problems: readonly { path: string }[] }).problems;
    expect((short.body.error as { code: string }).code).toBe('validation_failed');
    expect(problems.map((entry) => entry.path)).toContain('passphrase');

    const missingName = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/register', headers: { ...BEARER, 'content-type': 'application/json' },
      body: { passphrase: 'a-long-enough-passphrase' },
    }));
    expect(missingName.status).toBe(400);
    expect((missingName.body.error as { code: string }).code).toBe('validation_failed');

    const duplicate = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/register', headers: { ...BEARER, 'content-type': 'application/json' },
      body: registerBody('alice', 'another-good-passphrase'),
    }));
    expect(duplicate.status).toBe(409);
    expect((duplicate.body.error as { code: string }).code).toBe('conflict');
  });

  it('logout revokes the token: whoami 401 after logout, a SECOND logout answers the 401 (the revocation enforced loudly), and the revocation is DURABLE (a fresh instance rejects the same token)', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    if (!instance.deployment.ok) return;
    const { token } = await registeredPrincipal(instance);

    // The token works, then dies.
    expect((await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: principalHeaders(token) }))).status).toBe(200);
    const logout = await drive(instance.deployment, streamingRequest({ method: 'POST', url: '/v1/auth/logout', headers: principalHeaders(token) }));
    expect(logout.status).toBe(200);
    expect((logout.body.data as { revoked: boolean }).revoked).toBe(true);
    const afterLogout = await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: principalHeaders(token) }));
    expect(afterLogout.status).toBe(401);
    // A second logout with the DEAD token answers the 401 (idempotent at the store layer; enforced loudly at the route).
    const secondLogout = await drive(instance.deployment, streamingRequest({ method: 'POST', url: '/v1/auth/logout', headers: principalHeaders(token) }));
    expect(secondLogout.status).toBe(401);

    // A FRESH instance over the same durable truth: the revocation rehydrates (cold-start survival of the revocation list).
    const second = composeAuthInstance(authSource(), providers.fetchLike);
    if (!second.deployment.ok) return;
    const crossInstance = await drive(second.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: principalHeaders(token) }));
    expect(crossInstance.status).toBe(401); // the revocation is durable truth — the token stays dead
    // ...while a FRESH login mints a living token (the registry survived the cold start too).
    const relogin = await drive(second.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/login', headers: { ...BEARER, 'content-type': 'application/json' },
      body: registerBody('alice', 'correct horse battery staple'),
    }));
    expect(relogin.status).toBe(200);
    expect((await drive(second.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: principalHeaders((relogin.body.data as { token: string }).token) }))).status).toBe(200);
  });

  it('token expiry: a token past its exp is dead (the injected clock advances past the TTL)', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    if (!instance.deployment.ok) return;
    const { token } = await registeredPrincipal(instance);
    expect((await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: principalHeaders(token) }))).status).toBe(200);
    // Advance the clock past the expiry — the token dies.
    instance.advanceTo(T0 + PRINCIPAL_TOKEN_TTL_MS + 1);
    const expired = await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: principalHeaders(token) }));
    expect(expired.status).toBe(401);
  });

  it('R46: a degraded credential-store read FAILS CLOSED — whoami answers the typed 503, never a partial principal view', async () => {
    const providers = fakeProviders();
    const outage = outageFetch(providers.fetchLike);
    const instance = composeAuthInstance(authSource(), outage.fetchLike);
    if (!instance.deployment.ok) return;
    const { token } = await registeredPrincipal(instance);
    outage.setOutage(true);
    const degraded = await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: principalHeaders(token) }));
    expect(degraded.status).toBe(503);
    expect((degraded.body.error as { code: string }).code).toBe('unavailable');
    outage.setOutage(false);
    // Neon recovers -> the token is honored again (the per-request retry law).
    expect((await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: principalHeaders(token) }))).status).toBe(200);
  });

  it('SDK parity: a wrong-method /v1/auth path falls through to the boundary\'s typed not-found; the boundary\'s other behavior is byte-identical', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    if (!instance.deployment.ok) return;
    const wrongMethod = await drive(instance.deployment, streamingRequest({ method: 'GET', url: '/v1/auth/register', headers: { ...BEARER } }));
    expect(wrongMethod.status).toBe(404);
    expect((wrongMethod.body.error as { code: string }).code).toBe('not_found');
  });
});

describe('deploy/vercel — FW-39-1: the DEMO backing\'s honest unavailability (R46 — an account must never silently cold-start reset)', () => {
  it('every auth route answers the typed not-available 503 naming the durable-backing requirement — loudly, never a fake in-memory account', async () => {
    const deployment = composeDeployment(readApiEnv({
      [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
      [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
      [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
      [API_ENV_KEYS.authTokenKey]: AUTH_KEY, // the key IS configured — the backing is the blocker
    }));
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    for (const request of [
      streamingRequest({ method: 'POST', url: '/v1/auth/register', headers: { ...BEARER, 'content-type': 'application/json' }, body: registerBody('alice', 'correct horse battery staple') }),
      streamingRequest({ method: 'POST', url: '/v1/auth/login', headers: { ...BEARER, 'content-type': 'application/json' }, body: registerBody('alice', 'correct horse battery staple') }),
      streamingRequest({ method: 'POST', url: '/v1/auth/logout', headers: principalHeaders('v1.anything.here') }),
      streamingRequest({ url: '/v1/auth/whoami', headers: principalHeaders('v1.anything.here') }),
      streamingRequest({ method: 'POST', url: '/v1/auth/adopt', headers: principalHeaders('v1.anything.here') }),
    ]) {
      const answer = await drive(deployment, request);
      expect(answer.status).toBe(503);
      const error = answer.body.error as { code: string; message: string };
      expect(error.code).toBe('unavailable');
      expect(error.message).toContain('DURABLE'); // the loud teaching — the requirement is named
      expect(error.message).toContain('cold-start reset'); // the reason is named
    }
    // AUTHN STILL FIRST: a bad bearer under the demo backing answers the 401, not the 503.
    const unauthenticated = await drive(deployment, streamingRequest({ url: '/v1/auth/whoami' }));
    expect(unauthenticated.status).toBe(401);
    expect((unauthenticated.body.error as { code: string }).code).toBe('unauthenticated');
  });

  it('the durable backing WITHOUT the signing key answers the typed not-available naming the configuration requirement (never a derived fallback key)', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource({ [API_ENV_KEYS.authTokenKey]: undefined }), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;
    const answer = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/register', headers: { ...BEARER, 'content-type': 'application/json' },
      body: registerBody('alice', 'correct horse battery staple'),
    }));
    expect(answer.status).toBe(503);
    const error = answer.body.error as { code: string; message: string };
    expect(error.code).toBe('unavailable');
    expect(error.message).toContain('TRADRL_AUTH_TOKEN_KEY');
    // The principal token resolver sees NO principal context in that state (nothing could be minted).
    const listing = await drive(instance.deployment, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_A, { [PRINCIPAL_TOKEN_HEADER]: 'v1.anything.here' }) }));
    expect(listing.status).toBe(200); // the listing serves its normal two-valued markers — no principal context, honestly
  });
});

describe('deploy/vercel — FW-39-1: the adoption route (the calling session\'s own desks, additively re-stamped)', () => {
  /** The common scenario: session A owns two desks; alice is registered + logged in. */
  async function adoptionScenario(): Promise<{ instance: { deployment: Composition; advanceTo: (at: number) => void }; token: string; principalId: string }> {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    if (!instance.deployment.ok) throw new Error('composition failed');
    for (const projectId of ['prj-a-1', 'prj-a-2']) {
      const created = await drive(instance.deployment, streamingRequest({
        method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A), 'content-type': 'application/json' },
        body: validCreateProjectRequest(TENANT, projectId, `the ${projectId} desk`),
      }));
      expect(created.status).toBe(201);
    }
    // A THIRD desk owned by ANOTHER session (never adoptable by A).
    const foreign = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders('cccccccccccccccccccccccccccccccc'), 'content-type': 'application/json' },
      body: validCreateProjectRequest(TENANT, 'prj-c-1', 'the foreign desk'),
    }));
    expect(foreign.status).toBe(201);
    const { token, principalId } = await registeredPrincipal(instance);
    return { instance, token, principalId };
  }

  it('adopt re-stamps the calling session\'s OWN desks (per-desk response, idempotent, the demo project NEVER adoptable, the body NEVER a widening parameter)', async () => {
    const { instance, token } = await adoptionScenario();
    // The adoption carries a BODY naming foreign desks — it is IGNORED entirely (never a widening parameter).
    const adopted = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/adopt', headers: sessionHeaders(SESSION_A, { [PRINCIPAL_TOKEN_HEADER]: token, 'content-type': 'application/json' }),
      body: { projects: ['prj-c-1', DEMO_PROJECT_ID] },
    }));
    expect(adopted.status).toBe(200);
    const data = adopted.body.data as { adoptions: readonly { projectId: string; adopted: boolean; changed: boolean }[]; principal: { id: string } };
    expect(data.adoptions.map((entry) => entry.projectId).sort()).toEqual(['prj-a-1', 'prj-a-2']); // A's OWN desks ONLY — the body changed nothing
    expect(data.adoptions.every((entry) => entry.adopted && entry.changed)).toBe(true); // both newly stamped

    // IDEMPOTENT: a second adoption of the same session reports changed: false — no write.
    const again = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/adopt', headers: sessionHeaders(SESSION_A, { [PRINCIPAL_TOKEN_HEADER]: token }),
    }));
    expect(again.status).toBe(200);
    const againData = again.body.data as { adoptions: readonly { projectId: string; adopted: boolean; changed: boolean }[] };
    expect(againData.adoptions.every((entry) => entry.adopted && !entry.changed)).toBe(true);

    // A DIFFERENT session's adoption answers THAT session's own desks only (prj-c-1 — its own
    // launch): it can adopt its own desk into the calling principal, but NEVER another
    // session's desks (A's two desks are absent from its response — no expropriation).
    const otherAdopt = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/adopt', headers: sessionHeaders('cccccccccccccccccccccccccccccccc', { [PRINCIPAL_TOKEN_HEADER]: token }),
    }));
    expect(otherAdopt.status).toBe(200);
    expect((otherAdopt.body.data as { adoptions: readonly { projectId: string }[] }).adoptions.map((entry) => entry.projectId)).toEqual(['prj-c-1']);

    // Adopt WITHOUT the session header: the typed validation failure naming the session law.
    const noSession = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/adopt', headers: principalHeaders(token),
    }));
    expect(noSession.status).toBe(400);
    expect((noSession.body.error as { code: string }).code).toBe('validation_failed');
  });

  it('THE G-11 CLOSURE: after adoption, a FRESH session id + the principal token lists the desks as OWN (\'principal-owned\') — and the principal identity NEVER crosses the wire', async () => {
    const { instance, token } = await adoptionScenario();
    const adopted = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/adopt', headers: sessionHeaders(SESSION_A, { [PRINCIPAL_TOKEN_HEADER]: token }),
    }));
    expect(adopted.status).toBe(200);

    // The fresh session (SESSION_B — the browser restart) WITHOUT the token: tenant-available only.
    const beforeLogin = await drive(instance.deployment, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_B) }));
    const beforeItems = (beforeLogin.body.data as { items: readonly { id: string; consoleSessionScope?: string }[] }).items;
    expect(beforeItems.find((item) => item.id === 'prj-a-1')?.consoleSessionScope).toBe('tenant-available');

    // WITH the token: 'principal-owned' — the shipped client's isSessionOwnDesk fold reads it as own.
    const afterLogin = await drive(instance.deployment, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_B, { [PRINCIPAL_TOKEN_HEADER]: token }) }));
    const afterItems = (afterLogin.body.data as { items: readonly { id: string; consoleSessionScope?: string; ownerPrincipal?: unknown; ownerSession?: unknown }[] }).items;
    expect(afterItems.find((item) => item.id === 'prj-a-1')?.consoleSessionScope).toBe('principal-owned');
    expect(afterItems.find((item) => item.id === 'prj-a-2')?.consoleSessionScope).toBe('principal-owned');
    expect(afterItems.find((item) => item.id === DEMO_PROJECT_ID)?.consoleSessionScope).toBe('tenant-available'); // the shared scope stays shared
    expect(afterItems.find((item) => item.id === 'prj-c-1')?.consoleSessionScope).toBe('tenant-available'); // another session's desk is NOT alice's
    // THE IDENTITY-NEVER-CROSSES LAW (the ownerSession precedent): only the derived marker serves.
    expect(afterItems.every((item) => item.ownerPrincipal === undefined && item.ownerSession === undefined)).toBe(true);

    // The DETAIL agrees with the listing (never a contradictory marker).
    const detail = await drive(instance.deployment, streamingRequest({ url: '/v1/projects/prj-a-1', headers: sessionHeaders(SESSION_B, { [PRINCIPAL_TOKEN_HEADER]: token }) }));
    expect(detail.status).toBe(200);
    expect((detail.body.data as { consoleSessionScope?: string }).consoleSessionScope).toBe('principal-owned');
  });

  it('the create-stamp: a create carrying BOTH the session header and a valid principal token stamps ownerPrincipal BESIDE ownerSession; a headerless-session create with the token stamps the principal alone', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    if (!instance.deployment.ok) return;
    const { token } = await registeredPrincipal(instance);

    // BOTH stamps: the creating session still sees 'session-owned' (the session marker wins for its own creator).
    const created = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A, { [PRINCIPAL_TOKEN_HEADER]: token }), 'content-type': 'application/json' },
      body: validCreateProjectRequest(TENANT, 'prj-both', 'the both-stamps desk'),
    }));
    expect(created.status).toBe(201);
    const creatorListing = await drive(instance.deployment, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_A) }));
    const creatorItems = (creatorListing.body.data as { items: readonly { id: string; consoleSessionScope?: string }[] }).items;
    expect(creatorItems.find((item) => item.id === 'prj-both')?.consoleSessionScope).toBe('session-owned');
    // A FRESH session with the token: 'principal-owned' (the principal stamp is beside the session stamp — lineage preserved).
    const freshListing = await drive(instance.deployment, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_B, { [PRINCIPAL_TOKEN_HEADER]: token }) }));
    const freshItems = (freshListing.body.data as { items: readonly { id: string; consoleSessionScope?: string }[] }).items;
    expect(freshItems.find((item) => item.id === 'prj-both')?.consoleSessionScope).toBe('principal-owned');

    // The principal-alone stamp: a headerless-session create (the SDK shape) with the token.
    const headerless = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...principalHeaders(token), 'content-type': 'application/json' },
      body: validCreateProjectRequest(TENANT, 'prn-sdk', 'the sdk desk'),
    }));
    expect(headerless.status).toBe(201);
    const sdkListing = await drive(instance.deployment, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_B, { [PRINCIPAL_TOKEN_HEADER]: token }) }));
    const sdkItems = (sdkListing.body.data as { items: readonly { id: string; consoleSessionScope?: string }[] }).items;
    expect(sdkItems.find((item) => item.id === 'prn-sdk')?.consoleSessionScope).toBe('principal-owned');
  });
});

// ---------------------------------------------------------------------------
// FW-40-D: the auth-route brute-force guard (the typed 429 throttle closing
// the identity design's known gap — the work order's five laws + the honest
// mechanics, over the SAME full-function-handler harness)
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-40-D: the auth-route brute-force guard (the typed 429 throttle)', () => {
  /** One login attempt through the full handler. */
  async function login(deployment: Composition, name: string, passphrase: string, extraHeaders: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown> }> {
    return drive(deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/login', headers: { ...BEARER, 'content-type': 'application/json', ...extraHeaders },
      body: registerBody(name, passphrase),
    }));
  }

  /** One register attempt through the full handler. */
  async function register(deployment: Composition, name: string, passphrase: string, extraHeaders: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown> }> {
    return drive(deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/register', headers: { ...BEARER, 'content-type': 'application/json', ...extraHeaders },
      body: registerBody(name, passphrase),
    }));
  }

  it('(a) five FAILED registers on one identity -> the SIXTH register attempt answers the typed 429; a DIFFERENT identity is untouched (per-identity buckets)', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;

    // alice exists; five duplicate-name registers (the typed 409s) are the
    // five FAILED attempts on that identity.
    expect((await register(instance.deployment, 'alice', 'correct horse battery staple')).status).toBe(201);
    for (let index = 0; index < 5; index += 1) {
      const failed = await register(instance.deployment, 'alice', 'another-passphrase-attempt');
      expect(failed.status).toBe(409); // each one a FAILED credential attempt (the duplicate-name probe)
      expect((failed.body.error as { code: string }).code).toBe('conflict');
    }
    // The SIXTH register attempt on alice: refused BEFORE the route runs.
    const sixth = await register(instance.deployment, 'alice', 'yet-another-passphrase');
    expect(sixth.status).toBe(429);
    const error = sixth.body.error as { code: string; message: string; retryAfterMs: number };
    expect(error.code).toBe('rate_limited');
    expect(error.message).toContain('principal identity'); // WHICH budget is exhausted, disclosed
    expect(error.message).toContain('5-failed-attempt budget');
    // The bucket is PER IDENTITY: a different name never sees alice's failures.
    const bob = await register(instance.deployment, 'bob', 'bob-own-passphrase-fine');
    expect(bob.status).toBe(201);
  });

  it('(b) a SUCCESSFUL LOGIN after four failures RESETS the identity bucket — the honest unlock (legitimate users are not locked out by their own success)', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;
    await registeredPrincipal(instance); // alice, passphrase 'correct horse battery staple'

    // Four failures (each allowed — the bucket allows 5).
    for (let index = 0; index < 4; index += 1) {
      expect((await login(instance.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(401);
    }
    // The SUCCESSFUL login — the reset.
    expect((await login(instance.deployment, 'alice', 'correct horse battery staple')).status).toBe(200);
    // Without the reset, the identity's bucket would sit at 4 and the very
    // next failure would be attempt #5-allowed-then-locked; WITH the reset,
    // alice gets a FRESH budget: five more failures all land as 401s...
    for (let index = 0; index < 5; index += 1) {
      expect((await login(instance.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(401);
    }
    // ...and only the attempt after those five answers the typed 429.
    const refused = await login(instance.deployment, 'alice', 'wrong passphrase entirely');
    expect(refused.status).toBe(429);
    expect((refused.body.error as { code: string }).code).toBe('rate_limited');
  });

  it('(c) the ADOPT route is NOT throttled beyond the existing law — it stays exactly as shipped (no guard, no counting, no widening parameter)', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;
    // Session A owns one desk; alice is registered + logged in.
    const created = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A), 'content-type': 'application/json' },
      body: validCreateProjectRequest(TENANT, 'prj-a-1', 'the guard desk'),
    }));
    expect(created.status).toBe(201);
    const { token } = await registeredPrincipal(instance);
    // Exhaust alice's identity bucket (the guard is live for register)...
    expect((await register(instance.deployment, 'alice', 'first-failing-register')).status).toBe(409);
    for (let index = 0; index < 4; index += 1) {
      expect((await register(instance.deployment, 'alice', `failing-register-${index}`)).status).toBe(409);
    }
    const refused = await register(instance.deployment, 'alice', 'the-refused-register');
    expect(refused.status).toBe(429); // the guard IS live on the credential routes
    // ...and the adopt route NEVER consults it: the ceremony answers its own
    // 200 law (per-desk adoption of the CALLING session's own desks).
    const adopted = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/adopt', headers: sessionHeaders(SESSION_A, { [PRINCIPAL_TOKEN_HEADER]: token }),
    }));
    expect(adopted.status).toBe(200);
    expect((adopted.body.data as { adoptions: readonly { projectId: string; adopted: boolean; changed: boolean }[] }).adoptions).toEqual([{ projectId: 'prj-a-1', adopted: true, changed: true }]);
    // ...not now, not under a hammer: 35 further adopts (past the source
    // budget the credential routes would have long refused) ALL answer 200
    // idempotently (changed: false) — the adopt law stays exactly as shipped.
    for (let index = 0; index < 35; index += 1) {
      const again = await drive(instance.deployment, streamingRequest({
        method: 'POST', url: '/v1/auth/adopt', headers: sessionHeaders(SESSION_A, { [PRINCIPAL_TOKEN_HEADER]: token }),
      }));
      expect(again.status).toBe(200);
      expect((again.body.data as { adoptions: readonly { adopted: boolean; changed: boolean }[] }).adoptions.every((entry) => entry.adopted && !entry.changed)).toBe(true);
    }
  });

  it('(d) the 429 is TYPED + DISCLOSED per the R46 vocabulary — the source bucket: 30 attempts from one client source -> the 31st answers rate_limited with the retry signal + header; a DIFFERENT source has its own budget', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;
    const sourceA = { 'x-forwarded-for': '203.0.113.9' };
    // 30 failed logins on 30 DISTINCT unknown names (identity-probing: no
    // per-identity bucket ever trips — each name fails exactly once) from
    // ONE client source.
    for (let index = 0; index < 30; index += 1) {
      const probed = await login(instance.deployment, `probe-name-${index}`, 'a-passphrase-of-length', sourceA);
      expect(probed.status).toBe(401);
    }
    // The 31st attempt from the same source: the typed 429, disclosed.
    const refused = await login(instance.deployment, 'any-name-at-all', 'a-passphrase-of-length', sourceA);
    expect(refused.status).toBe(429);
    const error = refused.body.error as { code: string; message: string; retryAfterMs: number; status: number };
    expect(error.code).toBe('rate_limited'); // the closed vocabulary's own code
    expect(error.status).toBe(429);
    expect(error.message).toContain('client source'); // WHICH budget is exhausted, disclosed
    expect(error.message).toContain('30-attempt budget');
    expect(error.message).toContain('900000ms window'); // the 15-minute default window, disclosed
    expect(error.retryAfterMs).toBe(900000); // the frozen clock: the window's full remainder
    expect(refused.headers['retry-after-ms']).toBe('900000'); // the envelope's own retry header (the SDK's backoff honors it)
    // A DIFFERENT client source carries its OWN budget (the platform-forwarded
    // address is what the host observes — forwarded through the wrap).
    const otherSource = await login(instance.deployment, 'any-name-at-all', 'a-passphrase-of-length', { 'x-forwarded-for': '198.51.100.7' });
    expect(otherSource.status).toBe(401); // allowed, failed on credentials — not refused by the throttle
  });

  it('(e) WHOAMI (a read) is NOT throttled by the failure counter — it answers 200 under a valid token even with the identity bucket exhausted, and never counts toward any budget', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;
    const { token } = await registeredPrincipal(instance);
    // Exhaust alice's identity bucket with failed logins...
    for (let index = 0; index < 5; index += 1) {
      expect((await login(instance.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(401);
    }
    expect((await login(instance.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(429); // the guard is live
    // ...and whoami (a read, token-gated) never consults it.
    const whoami = await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: principalHeaders(token) }));
    expect(whoami.status).toBe(200);
    expect(((whoami.body.data as { principal: { name: string } }).principal).name).toBe('alice');
    // Nor does whoami count toward any budget: a hammer of 35 whoami reads
    // (past the credential routes' source budget) ALL answer 200.
    for (let index = 0; index < 35; index += 1) {
      expect((await drive(instance.deployment, streamingRequest({ url: '/v1/auth/whoami', headers: principalHeaders(token) }))).status).toBe(200);
    }
  });

  it('the fixed window ROLLS with the injected clock: the budget clears when the window passes (never a permanent lock)', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;
    await registeredPrincipal(instance);
    for (let index = 0; index < 5; index += 1) {
      expect((await login(instance.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(401);
    }
    const refused = await login(instance.deployment, 'alice', 'wrong passphrase entirely');
    expect(refused.status).toBe(429);
    expect((refused.body.error as { retryAfterMs: number }).retryAfterMs).toBe(900000); // the whole window remains
    // Advance the clock PAST the window: the budget clears — the next
    // attempt is served by the route again (a fresh window, anchored now).
    instance.advanceTo(T0 + 900_000 + 1);
    expect((await login(instance.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(401);
    // And the new window's retry signal is anchored to the NEW first charge.
    for (let index = 0; index < 4; index += 1) {
      expect((await login(instance.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(401);
    }
    const refusedAgain = await login(instance.deployment, 'alice', 'wrong passphrase entirely');
    expect(refusedAgain.status).toBe(429);
    expect((refusedAgain.body.error as { retryAfterMs: number }).retryAfterMs).toBe(900_000); // anchored at T0+900001, still frozen there
  });

  it('the bounds are env-configurable (defaults sane; a tightened bound answers the same typed 429 with its own window)', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource({
      [API_ENV_KEYS.authThrottleIdentityFailures]: '2',
      [API_ENV_KEYS.authThrottleWindowMs]: '60000',
    }), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;
    await registeredPrincipal(instance);
    expect((await login(instance.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(401);
    expect((await login(instance.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(401);
    const refused = await login(instance.deployment, 'alice', 'wrong passphrase entirely');
    expect(refused.status).toBe(429);
    const error = refused.body.error as { message: string; retryAfterMs: number };
    expect(error.message).toContain('2-failed-attempt budget');
    expect(error.message).toContain('60000ms window');
    expect(error.retryAfterMs).toBe(60000);
  });

  it('an INVALID bound FAILS CLOSED at the composition seam (the typed 503 naming the key — a typo can never silently widen the guard)', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource({ [API_ENV_KEYS.authThrottleSourceAttempts]: 'zero' }), providers.fetchLike);
    expect(instance.deployment.ok).toBe(false); // the composition refuses to boot
    if (instance.deployment.ok) return;
    expect(instance.deployment.missing.join(' ')).toContain('TRADRL_AUTH_THROTTLE_SOURCE_ATTEMPTS');
    expect(instance.deployment.missing.join(' ')).toContain('positive integer');
    // The full handler serves the typed degraded 503 naming the key.
    const answer = await drive(instance.deployment, streamingRequest({ url: '/v1/meta', headers: { ...BEARER } }));
    expect(answer.status).toBe(503);
    expect((answer.body.error as { code: string; message: string }).code).toBe('deploy_not_configured');
    expect((answer.body.error as { code: string; message: string }).message).toContain('TRADRL_AUTH_THROTTLE_SOURCE_ATTEMPTS');
  });

  it('the guard state is IN-MEMORY PER INSTANCE: a fresh composition over the same durable truth clears the buckets (the honest cold-start disclosure)', async () => {
    const providers = fakeProviders();
    const first = composeAuthInstance(authSource(), providers.fetchLike);
    expect(first.deployment.ok).toBe(true);
    if (!first.deployment.ok) return;
    await registeredPrincipal(first);
    for (let index = 0; index < 5; index += 1) {
      expect((await login(first.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(401);
    }
    expect((await login(first.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(429);
    // A FRESH "serverless instance" (a cold start) over the same durable
    // truth: the buckets were the dead instance's own — the attempt is
    // served again (the scrypt KDF remains the cost floor beneath the
    // throttle; the durable registry itself survived, as FW-39-1 pinned).
    const second = composeAuthInstance(authSource(), providers.fetchLike);
    expect(second.deployment.ok).toBe(true);
    if (!second.deployment.ok) return;
    const afterColdStart = await login(second.deployment, 'alice', 'wrong passphrase entirely');
    expect(afterColdStart.status).toBe(401); // allowed — the failure counter died with the instance
  });

  it('a DEGRADED store read charges NEITHER bucket (R46: a backend outage never locks a user out)', async () => {
    const providers = fakeProviders();
    const outage = outageFetch(providers.fetchLike);
    const instance = composeAuthInstance(authSource(), outage.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;
    await registeredPrincipal(instance);
    outage.setOutage(true);
    const degraded = await login(instance.deployment, 'alice', 'wrong passphrase entirely');
    expect(degraded.status).toBe(503); // the typed degraded state — NOT a credential failure
    expect((degraded.body.error as { code: string }).code).toBe('unavailable');
    outage.setOutage(false);
    // Exactly the five REAL credential failures charge the identity bucket:
    // the outage's 503 charged nothing (a sixth 401 lands before the 429).
    for (let index = 0; index < 5; index += 1) {
      expect((await login(instance.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(401);
    }
    const refused = await login(instance.deployment, 'alice', 'wrong passphrase entirely');
    expect(refused.status).toBe(429);
    expect((refused.body.error as { message: string }).message).toContain('5-failed-attempt budget'); // 5, not 6 — the 503 never charged
  });

  it('the ORDERING law: authn FIRST (the 401) and the not-available teaching (the 503) stay louder than the throttle — a 429 never masks them', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;
    await registeredPrincipal(instance);
    for (let index = 0; index < 5; index += 1) {
      expect((await login(instance.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(401);
    }
    expect((await login(instance.deployment, 'alice', 'wrong passphrase entirely')).status).toBe(429); // the throttle is live
    // A request with a BAD bearer answers the 401 FIRST — even on the
    // exhausted identity (authn precedes the guard, the W-8 law).
    const unauthenticated = await drive(instance.deployment, streamingRequest({
      method: 'POST', url: '/v1/auth/register', headers: { 'content-type': 'application/json' }, body: registerBody('alice', 'whatever-passphrase'),
    }));
    expect(unauthenticated.status).toBe(401);
    expect((unauthenticated.body.error as { code: string }).code).toBe('unauthenticated');
    // Under the DEMO backing the not-available teaching stays louder than
    // the throttle: hammering the register route NEVER answers a 429 — the
    // surface does not exist to protect, so nothing is counted and the
    // typed 503 keeps teaching the durable-backing requirement.
    const demo = composeDeployment(readApiEnv({
      [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
      [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
      [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
      [API_ENV_KEYS.authTokenKey]: AUTH_KEY, // the key IS configured — the backing is the blocker
    }));
    expect(demo.ok).toBe(true);
    if (!demo.ok) return;
    for (let index = 0; index < 35; index += 1) {
      const answer = await register(demo, `demo-probe-${index}`, 'a-passphrase-of-length');
      expect(answer.status).toBe(503);
      expect((answer.body.error as { code: string }).code).toBe('unavailable');
      expect((answer.body.error as { message: string }).message).toContain('DURABLE');
    }
  });

  it('a validation failure (the typed 400) charges NEITHER bucket — a malformed body has no honest identity to charge', async () => {
    const providers = fakeProviders();
    const instance = composeAuthInstance(authSource(), providers.fetchLike);
    expect(instance.deployment.ok).toBe(true);
    if (!instance.deployment.ok) return;
    await registeredPrincipal(instance);
    // Ten malformed register bodies (a well-formed name, a short passphrase):
    // each answers the typed 400 and charges nothing.
    for (let index = 0; index < 10; index += 1) {
      const malformed = await register(instance.deployment, 'alice', 'short');
      expect(malformed.status).toBe(400);
      expect((malformed.body.error as { code: string }).code).toBe('validation_failed');
    }
    // The identity bucket is EMPTY: the next WELL-FORMED failing register on
    // alice (the 409) is served — and it takes the full five 409s to lock.
    const served = await register(instance.deployment, 'alice', 'a-legit-passphrase-here');
    expect(served.status).toBe(409);
    for (let index = 0; index < 4; index += 1) {
      expect((await register(instance.deployment, 'alice', 'a-legit-passphrase-here')).status).toBe(409);
    }
    expect((await register(instance.deployment, 'alice', 'a-legit-passphrase-here')).status).toBe(429);
  });
});
