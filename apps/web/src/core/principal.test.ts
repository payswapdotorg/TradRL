// Tests for THE NAMED PRINCIPAL (FW-39-2, identity Wave 2 —
// core/principal.ts): the token store (pure + storage-seamed), the auth
// client against the DOCUMENTED contract (POST /v1/auth/register|login|
// logout, GET /v1/auth/whoami, POST /v1/auth/adopt — typed 401/404/503,
// the DEMO backing's typed not-available), the whoami cache, and the
// panel's pure folds (the adoption ceremony's rows + the per-desk
// outcome fold).
//
// Laws pinned here (pure assertions — injected maps + scripted
// transports, no DOM, no clock):
//   - the token store's read/persist/clear round-trip and its honest
//     degradations (a malformed record reads as absent; a storage that
//     throws never crashes the boot);
//   - the auth client's request grammar (method, path, the Bearer
//     principal token, the session header on EVERY call — adopt's
//     "calling session" law) and its envelope discipline (the { requestId,
//     data } success shape; the typed error envelope through the shared
//     mirror; a transport that throws degrades to the unavailable
//     family);
//   - the DEMO not-available (503 unavailable family) is
//     programmatically distinguishable — isAuthUnavailableError — the
//     surface's teaching state's own gate;
//   - the mint guard: an answer without a well-formed token or name is
//     the typed unavailable, never a fabricated session;
//   - the token GRAMMAR pin (FW-40-E): the guard accepts the HOST's own
//     mint — `v1.<base64url(canonical-json claims)>.<base64url(hmac)>`
//     (deploy/vercel/runtime/auth-routes.ts, mintPrincipalToken) — and
//     rejects the dot-free legacy shape the old mocks used. THE SEAM THE
//     DOT-FREE MOCKS MASKED: the union battery passed while the
//     production register/login flow threw the typed 503 (the client's
//     own wrong regex vs the host's real dotted mint);
//   - the adoption rows: the session's OWN desks minus the shared demo
//     desk (never adoptable — every session's teaching desk);
//   - the per-desk outcome fold's idempotence (an `already` outcome
//     keeps the adopted state and names it; an unnamed row keeps its
//     prior state).

import { describe, expect, it } from 'vitest';
import type { ApiTransport, SdkRequest, SdkResponse } from '../api/transport';
import { ApiConsoleError } from '../api/errors';
import type { ProjectRecord } from '../api/contracts';
import {
  adoptionOutcomeApplied,
  adoptionRowsOf,
  accountFormEdited,
  accountModeSwitched,
  anonymousAccountPanel,
  authenticatedAccountPanel,
  clearStoredPrincipalSession,
  createPrincipalAuthClient,
  createWhoamiCache,
  isAuthUnavailableError,
  isPrincipalToken,
  parseStoredPrincipalSession,
  persistPrincipalSession,
  PRINCIPAL_SESSION_STORAGE_KEY,
  readStoredPrincipalSession,
  serializePrincipalSession,
  unavailableAccountPanel,
  createPrincipalHeaderState,
  withPrincipalHeaders,
} from './principal';

// ---------------------------------------------------------------------------
// The scripted transport + the envelope helpers (the client-host-routes
// test's own pattern)
// ---------------------------------------------------------------------------

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

function envelopeError(status: number, code: string, message: string): SdkResponse {
  return { status, headers: {}, body: { requestId: 'req-test', error: { code, message, status } } };
}

const SESSION_HEADERS = { 'x-tradrl-console-session': 'session-0123456789abcdef' };

// THE HOST'S REAL MINT GRAMMAR (FW-40-E — the seam the dot-free mocks masked):
// `v1.<base64url(canonical-json claims)>.<base64url(hmac-sha256)>` — the
// exact shape deploy/vercel/runtime/auth-routes.ts's mintPrincipalToken
// mints. Every mock below rides this shape so the scripted answers can
// never again diverge from the production wire.
const TOKEN = 'v1.eyJzdWIiOiJwcm4tMSIsIm5hbWUiOiJkZXNrLm93bmVyIn0.aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_-AbCdEfGhI';
/** A second, DISTINCT well-formed mint (the cross-token checks — never a shared key). */
const OTHER_TOKEN = 'v1.eyJzdWIiOiJwcm4tMiIsIm5hbWUiOiJvdGhlci5kZXNrIn0.aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_-JhGfEdCbA';
const MINT = { token: TOKEN, principal: { id: 'prn-1', name: 'desk.owner' } };

/** A directory row with the host's additive session-scope marker. */
function directoryRow(id: string, marker: 'session-owned' | 'principal-owned' | 'tenant-available' | 'none'): ProjectRecord {
  return {
    id,
    tenantId: 'tenant-a',
    name: `desk ${id}`,
    executionMode: 'simulation',
    lifecycle: { projectId: id, status: 'active', acceptanceCriteriaId: null, organizationRef: null },
    lineage: { projectId: id, goal: { goalId: 'goal-1', version: 1 }, constraintSet: { id: 'cs-1', version: 1 } },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...(marker === 'none' ? {} : { consoleSessionScope: marker }),
  } as unknown as ProjectRecord;
}

// ---------------------------------------------------------------------------
// The principal-token grammar (FW-40-E — the seam pin the dot-free mocks
// failed to provide)
// ---------------------------------------------------------------------------

describe('the principal-token grammar (the host\'s own mint — FW-40-E\'s seam pin)', () => {
  /**
   * THE HOST'S OWN RECIPE (deploy/vercel/runtime/auth-routes.ts,
   * mintPrincipalToken): `v1.` + base64url(canonical-json claims) + `.` +
   * base64url(hmac-sha256 over the prefix). The signature is HMAC-SHA256
   * base64url — ALWAYS exactly 43 chars (32 bytes, padding stripped).
   */
  function hostMint(claims: Record<string, unknown>): string {
    const keys = Object.keys(claims).sort();
    const canonical = `{${keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(claims[key])}`).join(',')}}`;
    const payload = Buffer.from(canonical, 'utf8').toString('base64url');
    const signature = Buffer.from('h'.repeat(32), 'utf8').toString('base64url'); // 32 bytes -> the 43-char hmac length
    return `v1.${payload}.${signature}`;
  }

  it('accepts the HOST\'S OWN MINT — the register/login answer\'s exact shape (the pin the dot-free mocks failed to provide)', () => {
    const token = hostMint({ sub: 'prn-1a2b3c4d5e6f7890', name: 'desk.owner', tid: 'tenant-0123456789abcdef', iat: 1_760_000_000_000, exp: 1_760_432_000_000, jti: '0123456789abcdef0123456789abcdef', scope: 'principal-desks' });
    const segments = token.split('.');
    expect(segments).toHaveLength(3);
    expect(segments[0]).toBe('v1');
    expect((segments[2] as string).length).toBe(43); // the hmac-sha256 base64url length, exactly
    expect(isPrincipalToken(token)).toBe(true); // THE SEAM: the host's real mint passes the guard
    // GENEROUS bounds — never tighter than the host's real output: a 128-char
    // principal name (the host's own cap) mints a ~410-char payload and passes
    expect(isPrincipalToken(hostMint({ sub: 'prn-1', name: 'a'.repeat(128), tid: 'tenant-0123456789abcdef', iat: 1_760_000_000_000, exp: 1_760_432_000_000, jti: '0123456789abcdef0123456789abcdef', scope: 'principal-desks' }))).toBe(true);
  });

  it('rejects everything that is not the host\'s grammar (empty, garbage, the dot-free legacy mock, wrong version, non-url-safe bytes, out-of-bounds segments)', () => {
    for (const bad of [
      '',
      'not-a-token',
      'tok-principal-0123456789abcdef', // the DOT-FREE LEGACY MOCK — never the host's grammar (the seam this fix closes)
      'short',
      'v1.only', // a segment missing
      'v1.only.', // the signature segment empty
      'v2.eyJzdWIiOiJwcm4tMSJ9.aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_-AbCdEfGhI', // wrong version
      'v1.eyJzdWIiOiJwcm4tMSJ9.aBcDeF+/Gh=', // non-url-safe bytes (+ and =)
      `v1.${'x'.repeat(7)}.${'a'.repeat(43)}`, // payload under the generous floor
      `v1.${'x'.repeat(64)}.${'a'.repeat(15)}`, // signature under the floor
      `v1.${'x'.repeat(1025)}.${'a'.repeat(43)}`, // payload over the ceiling
      `v1.${'x'.repeat(64)}.${'a'.repeat(129)}`, // signature over the ceiling
      'v1.payload.signature.extra', // too many segments
    ]) {
      expect(isPrincipalToken(bad)).toBe(false);
    }
    expect(isPrincipalToken(null)).toBe(false);
    expect(isPrincipalToken(undefined)).toBe(false);
    expect(isPrincipalToken(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The token store
// ---------------------------------------------------------------------------

describe('the principal session store (the storage seam)', () => {
  it('persists and reads back one stored session (the whoami cache\'s persisted half)', () => {
    const map = new Map<string, string>();
    const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
    expect(readStoredPrincipalSession(storage)).toBeNull(); // absent — a fresh browser
    persistPrincipalSession(storage, { token: TOKEN, name: 'desk.owner' });
    expect(readStoredPrincipalSession(storage)).toEqual({ token: TOKEN, name: 'desk.owner' });
    expect(map.get(PRINCIPAL_SESSION_STORAGE_KEY)).toBe(serializePrincipalSession({ token: TOKEN, name: 'desk.owner' }));
  });

  it('clears to the honest absence (an empty value reads as null)', () => {
    const map = new Map<string, string>([[PRINCIPAL_SESSION_STORAGE_KEY, serializePrincipalSession({ token: TOKEN, name: 'desk.owner' })]]);
    const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
    clearStoredPrincipalSession(storage);
    expect(readStoredPrincipalSession(storage)).toBeNull();
  });

  it('degrades a malformed record to absent — never a half-trusted token (the strict parse)', () => {
    expect(parseStoredPrincipalSession(null)).toBeNull();
    expect(parseStoredPrincipalSession('')).toBeNull();
    expect(parseStoredPrincipalSession('not json')).toBeNull();
    expect(parseStoredPrincipalSession('{"token":"short","name":"x"}')).toBeNull(); // the token grammar guards
    expect(parseStoredPrincipalSession(`{"token":"${TOKEN}"}`)).toBeNull(); // no name
    expect(parseStoredPrincipalSession(`{"token":"${TOKEN}","name":""}`)).toBeNull(); // empty name
    expect(parseStoredPrincipalSession(`{"token":"${TOKEN}","name":"desk.owner"}`)).not.toBeNull();
  });

  it('never crashes on a throwing storage (the private-mode degradation: per-boot sessions)', () => {
    const refusing = {
      getItem: (): string | null => { throw new Error('refused'); },
      setItem: (): void => { throw new Error('refused'); },
    };
    expect(readStoredPrincipalSession(refusing)).toBeNull();
    expect(() => persistPrincipalSession(refusing, { token: TOKEN, name: 'desk.owner' })).not.toThrow();
    expect(() => clearStoredPrincipalSession(refusing)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The whoami cache
// ---------------------------------------------------------------------------

describe('the whoami cache (in-memory, keyed by token)', () => {
  it('writes, reads and clears per token (a stale token\'s answer never leaks to a new one)', () => {
    const cache = createWhoamiCache();
    expect(cache.read(TOKEN)).toBeNull();
    cache.write(TOKEN, { name: 'desk.owner' });
    expect(cache.read(TOKEN)).toEqual({ name: 'desk.owner' });
    expect(cache.read(OTHER_TOKEN)).toBeNull(); // keyed — never cross-token
    cache.clear();
    expect(cache.read(TOKEN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The auth client (the documented contract, defensively)
// ---------------------------------------------------------------------------

describe('the principal auth client — the documented contract\'s request grammar', () => {
  it('register drives POST /v1/auth/register with the credentials and the session header', async () => {
    const { transport, requests } = scripted([ok(MINT)]);
    const client = createPrincipalAuthClient({ transport, headers: SESSION_HEADERS });
    const mint = await client.register({ name: 'desk.owner', passphrase: 'correct horse battery staple' });
    expect(mint).toEqual({ token: TOKEN, name: 'desk.owner' });
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.path).toBe('/v1/auth/register');
    expect(requests[0]?.body).toEqual({ name: 'desk.owner', passphrase: 'correct horse battery staple' });
    expect(requests[0]?.headers['x-tradrl-console-session']).toBe('session-0123456789abcdef');
  });

  it('login drives POST /v1/auth/login; whoami carries the principal token on the PRINCIPAL-TOKEN HEADER (FW-39-3: never authorization — the boundary credential owns that header)', async () => {
    const { transport, requests } = scripted([ok(MINT), ok({ principal: { id: 'prn-1', name: 'desk.owner' } })]);
    const client = createPrincipalAuthClient({ transport, headers: SESSION_HEADERS });
    const mint = await client.login({ name: 'desk.owner', passphrase: 'correct horse battery staple' });
    expect(mint.token).toBe(TOKEN);
    const answer = await client.whoami(mint.token);
    expect(answer).toEqual({ name: 'desk.owner' });
    expect(requests[1]?.method).toBe('GET');
    expect(requests[1]?.path).toBe('/v1/auth/whoami');
    expect(requests[1]?.headers.authorization).toBeUndefined(); // the boundary credential's header is NEVER the principal token's
    expect(requests[1]?.headers['x-tradrl-principal-token']).toBe(TOKEN);
    expect(requests[1]?.headers['x-tradrl-console-session']).toBe('session-0123456789abcdef');
  });

  it('logout and adopt drive their POST routes with the principal-token header (adopt: no widening parameter — an empty body)', async () => {
    const { transport, requests } = scripted([ok({}), ok({ desks: [{ projectId: 'prj-own-1', adopted: true }] })]);
    const client = createPrincipalAuthClient({ transport, headers: SESSION_HEADERS });
    await client.logout(TOKEN);
    expect(requests[0]?.path).toBe('/v1/auth/logout');
    expect(requests[0]?.headers.authorization).toBeUndefined();
    expect(requests[0]?.headers['x-tradrl-principal-token']).toBe(TOKEN);
    const outcomes = await client.adopt(TOKEN);
    expect(outcomes).toEqual([{ projectId: 'prj-own-1', adopted: true, already: false }]);
    expect(requests[1]?.path).toBe('/v1/auth/adopt');
    expect(requests[1]?.headers['x-tradrl-principal-token']).toBe(TOKEN);
    expect(requests[1]?.body).toEqual({}); // parameterless per the contract — the calling session's own desks
  });

  it('parses the adopt per-desk response defensively (an `already` outcome is adopted=true, already=true)', async () => {
    const { transport } = scripted([ok({ desks: [
      { projectId: 'prj-own-1', adopted: true },
      { projectId: 'prj-own-2', already: true },
      { projectId: 'prj-own-3', adopted: false },
      { notAProjectId: true }, // skipped defensively, never a fabricated row
    ] })]);
    const client = createPrincipalAuthClient({ transport });
    const outcomes = await client.adopt(TOKEN);
    expect(outcomes).toEqual([
      { projectId: 'prj-own-1', adopted: true, already: false },
      { projectId: 'prj-own-2', adopted: true, already: true },
      { projectId: 'prj-own-3', adopted: false, already: false },
    ]);
  });
});

describe('the principal auth client — the typed answers (the honest degradations)', () => {
  it('the DEMO backing\'s typed not-available (503 unavailable) is programmatically distinguishable', async () => {
    const { transport } = scripted([envelopeError(503, 'unavailable', 'accounts are not available on this deployment (the demo backing answers the typed not-available — R46)')]);
    const client = createPrincipalAuthClient({ transport });
    const error = await client.login({ name: 'desk.owner', passphrase: 'x'.repeat(20) }).then(() => null, (cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiConsoleError);
    expect(isAuthUnavailableError(error)).toBe(true);
    expect((error as ApiConsoleError).message).toContain('not available on this deployment');
  });

  it('the typed 401 (an unknown/revoked token) and 404 (unknown-vs-foreign) translate through the shared mirror', async () => {
    const unauth = scripted([envelopeError(401, 'unauthenticated', 'the principal token is not on record')]);
    const clientA = createPrincipalAuthClient({ transport: unauth.transport });
    const errorA = await clientA.whoami(TOKEN).then(() => null, (cause: unknown) => cause);
    expect(errorA).toBeInstanceOf(ApiConsoleError);
    expect((errorA as ApiConsoleError).family).toBe('auth');
    expect(isAuthUnavailableError(errorA)).toBe(false);
    const notFound = scripted([envelopeError(404, 'not_found', 'no such principal')]);
    const clientB = createPrincipalAuthClient({ transport: notFound.transport });
    const errorB = await clientB.login({ name: 'nobody', passphrase: 'x'.repeat(20) }).then(() => null, (cause: unknown) => cause);
    expect((errorB as ApiConsoleError).family).toBe('not-found');
    expect((errorB as ApiConsoleError).message).toBe('no such principal');
  });

  it('a transport that throws degrades to the unavailable family (the honest cannot-reach, never a crash)', async () => {
    const transport: ApiTransport = async () => { throw new Error('network refused'); };
    const client = createPrincipalAuthClient({ transport });
    const error = await client.register({ name: 'desk.owner', passphrase: 'x'.repeat(20) }).then(() => null, (cause: unknown) => cause);
    expect(isAuthUnavailableError(error)).toBe(true);
    expect((error as ApiConsoleError).message).toContain('network refused');
  });

  it('an answer without a well-formed mint is the typed unavailable — never a fabricated session', async () => {
    for (const bad of [ok({}), ok({ token: 'short' }), ok({ token: TOKEN }), ok({ token: TOKEN, principal: {} })]) {
      const { transport } = scripted([bad]);
      const client = createPrincipalAuthClient({ transport });
      const error = await client.login({ name: 'desk.owner', passphrase: 'x'.repeat(20) }).then(() => null, (cause: unknown) => cause);
      expect(isAuthUnavailableError(error)).toBe(true);
    }
    const noDesks = scripted([ok({})]);
    const adoptClient = createPrincipalAuthClient({ transport: noDesks.transport });
    const adoptError = await adoptClient.adopt(TOKEN).then(() => null, (cause: unknown) => cause);
    expect(isAuthUnavailableError(adoptError)).toBe(true);
  });

  it('a non-envelope answer (a bare status) is the typed unavailable', async () => {
    const { transport } = scripted([{ status: 500, headers: {}, body: null }]);
    const client = createPrincipalAuthClient({ transport });
    const error = await client.logout(TOKEN).then(() => null, (cause: unknown) => cause);
    expect(isAuthUnavailableError(error)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The panel's pure folds
// ---------------------------------------------------------------------------

describe('the account panel folds', () => {
  it('the anonymous default is the demo flow\'s own shape (login-mode, empty edits, no adoption)', () => {
    const panel = anonymousAccountPanel();
    expect(panel.surface).toBe('anonymous');
    expect(panel.mode).toBe('login');
    expect(panel.edits).toEqual({});
    expect(panel.adoption).toBeNull();
    expect(panel.error).toBeNull();
    expect(unavailableAccountPanel('the reason').surface).toBe('unavailable');
    expect(authenticatedAccountPanel('desk.owner').principalName).toBe('desk.owner');
  });

  it('a form edit buffers by field; a mode switch carries the edits and clears the error', () => {
    let panel = anonymousAccountPanel();
    panel = accountFormEdited(panel, 'name', 'desk.owner');
    panel = accountFormEdited(panel, 'passphrase', 'correct horse battery staple');
    expect(panel.edits).toEqual({ name: 'desk.owner', passphrase: 'correct horse battery staple' });
    panel = { ...panel, error: 'an error' };
    panel = accountModeSwitched(panel, 'register');
    expect(panel.mode).toBe('register');
    expect(panel.error).toBeNull();
    expect(panel.edits.name).toBe('desk.owner'); // the edits carry over — the same user typing
    expect(accountModeSwitched(panel, 'register')).toBe(panel); // a same-mode switch is a no-op
  });

  it('the adoption rows are the session\'s OWN desks minus the shared demo desk', () => {
    const directory = [
      directoryRow('prj-demo-console', 'tenant-available'), // the shared teaching desk — never adoptable
      directoryRow('prj-own-1', 'session-owned'),
      directoryRow('prj-principal-1', 'principal-owned'), // wave 1's marker — the wall census reads it as own
      directoryRow('prj-foreign-1', 'tenant-available'), // another session's desk — never offered
      directoryRow('prj-legacy-1', 'none'), // the honest unmarked fallback — reads as own
    ];
    const rows = adoptionRowsOf(directory, 'prj-demo-console');
    expect(rows.map((row) => row.projectId)).toEqual(['prj-own-1', 'prj-principal-1', 'prj-legacy-1']);
    expect(rows.every((row) => row.status === 'offered')).toBe(true);
  });

  it('the per-desk outcome fold is idempotent and never fabricates (unnamed rows keep their state)', () => {
    const rows = adoptionRowsOf([directoryRow('prj-demo-console', 'tenant-available'), directoryRow('prj-own-1', 'session-owned'), directoryRow('prj-own-2', 'session-owned')], 'prj-demo-console');
    const first = adoptionOutcomeApplied(rows, [
      { projectId: 'prj-own-1', adopted: true, already: false },
      { projectId: 'prj-own-2', adopted: true, already: true },
    ]);
    expect(first.find((row) => row.projectId === 'prj-own-1')).toMatchObject({ status: 'adopted', detail: null });
    expect(first.find((row) => row.projectId === 'prj-own-2')).toMatchObject({ status: 'adopted', detail: 'already yours — adopted before this visit' });
    // the idempotent replay: the same answer folds to the same adopted states
    const again = adoptionOutcomeApplied(first, [
      { projectId: 'prj-own-1', adopted: true, already: true },
      { projectId: 'prj-own-2', adopted: true, already: true },
    ]);
    expect(again.find((row) => row.projectId === 'prj-own-1')?.status).toBe('adopted');
    // a refused desk names its failure; an unnamed row keeps its prior state
    const refused = adoptionOutcomeApplied(rows, [{ projectId: 'prj-own-1', adopted: false, already: false }]);
    expect(refused.find((row) => row.projectId === 'prj-own-1')?.status).toBe('failed');
    expect(refused.find((row) => row.projectId === 'prj-own-2')?.status).toBe('offered');
  });
});

// ---------------------------------------------------------------------------
// FW-39-3 (the identity wave 3): the principal-token header state + the
// header-carrying transport — the audit stamp's client half. The console's
// own consequential writes (launch create, research promote) carry the
// acting principal's token so the HOST's audit stamps fire; an anonymous
// boot adds NO header (the wire shape stays byte-identical — the additive
// law); the request's own headers win over the injected pair.
// ---------------------------------------------------------------------------
describe('FW-39-3: the live principal-token state + the header-carrying transport', () => {
  it('the state starts anonymous and carries the live token through setToken', () => {
    const state = createPrincipalHeaderState();
    expect(state.token()).toBeNull();
    state.setToken(TOKEN);
    expect(state.token()).toBe(TOKEN);
    state.setToken(null);
    expect(state.token()).toBeNull();
  });

  it('an ANONYMOUS boot adds NO principal header — the wire shape is byte-identical (the additive law)', async () => {
    const { transport, requests } = scripted([ok({})]);
    const state = createPrincipalHeaderState();
    const wrapped = withPrincipalHeaders(transport, state, 'tok-developer-boundary');
    await wrapped({ method: 'POST', path: '/v1/projects', headers: { 'content-type': 'application/json' }, body: {} });
    expect(requests[0]?.headers['x-tradrl-principal-token']).toBeUndefined();
    expect(requests[0]?.headers.authorization).toBe('Bearer tok-developer-boundary'); // the boundary credential rides as ever
  });

  it('a signed-in principal\'s writes carry BOTH the boundary credential and the principal-token header (the audit stamp fires host-side)', async () => {
    const { transport, requests } = scripted([ok({}), ok({})]);
    const state = createPrincipalHeaderState();
    state.setToken(TOKEN);
    const wrapped = withPrincipalHeaders(transport, state, 'tok-developer-boundary');
    await wrapped({ method: 'POST', path: '/v1/projects', headers: { 'content-type': 'application/json' }, body: {} });
    await wrapped({ method: 'POST', path: '/v1/jobs/job-1/promote', headers: {} });
    for (const request of requests) {
      expect(request.headers['x-tradrl-principal-token']).toBe(TOKEN);
      expect(request.headers.authorization).toBe('Bearer tok-developer-boundary');
    }
  });

  it('the request\'s OWN headers win over the injected pair (the auth client\'s per-call token is authoritative)', async () => {
    const { transport, requests } = scripted([ok({})]);
    const state = createPrincipalHeaderState();
    state.setToken('v1.eyJzdWIiOiJwcm4tOSJ9.aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_-StAlE9999'); // a stale (but well-formed) mint
    const wrapped = withPrincipalHeaders(transport, state, 'tok-developer-boundary');
    await wrapped({ method: 'GET', path: '/v1/auth/whoami', headers: { 'x-tradrl-principal-token': 'v1.eyJzdWIiOiJwcm4tOCJ9.aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_-PeRcAlL999', 'x-tradrl-console-session': 'session-0123456789abcdef' } });
    expect(requests[0]?.headers['x-tradrl-principal-token']).toBe('v1.eyJzdWIiOiJwcm4tOCJ9.aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_-PeRcAlL999');
    expect(requests[0]?.headers['x-tradrl-console-session']).toBe('session-0123456789abcdef');
  });

  it('logout clears the live token — the next write is anonymous again (the additive law, mirrored)', async () => {
    const { transport, requests } = scripted([ok({}), ok({})]);
    const state = createPrincipalHeaderState();
    state.setToken(TOKEN);
    const wrapped = withPrincipalHeaders(transport, state, 'tok-developer-boundary');
    await wrapped({ method: 'POST', path: '/v1/projects', headers: {} });
    state.setToken(null); // the plane's logout write-through
    await wrapped({ method: 'POST', path: '/v1/projects', headers: {} });
    expect(requests[0]?.headers['x-tradrl-principal-token']).toBe(TOKEN);
    expect(requests[1]?.headers['x-tradrl-principal-token']).toBeUndefined();
  });
});
