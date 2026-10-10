/**
 * FW-39-3 (the identity wave 3) — CROSS-PRINCIPAL ISOLATION, the L12
 * analog at the PRINCIPAL layer (docs/design/IDENTITY-MODEL.md §5 Wave
 * 3; the tests/security/tenant-isolation.test.ts battery's shape, driven
 * against the REAL deployment composition instead of the security
 * service: the shared-credential console's principals all live in ONE
 * tenant, so the isolation law under test is the OWN-DESKS WALL —
 * principal A's desks are NEVER principal B's own, on every surface the
 * console folds: the host's session listing markers (the honest
 * 'tenant-available' vs 'principal-owned' split), the client wall fold
 * (core/tenant.ts sessionOwnDesksOf — the switcher/palette/Oversight
 * all ride it), and the identity-never-crosses wire law (only the
 * derived marker serves, never ownerSession/ownerPrincipal).
 *
 * The REAL composition (runtime/compose.ts) over the fake provider
 * fleet's fetch (deploy/wire/smoketest.ts — no network, FIXED FAKE
 * credentials), driving the FULL function handler (api/router.ts: tick
 * -> wrap -> auth route -> session routes -> boundary -> drain), with
 * the REAL client folds imported from apps/web/src/core/tenant.ts —
 * the surfaces the shipped console actually renders.
 */
import { describe, expect, it } from 'vitest';

import { composeDeployment } from '../../deploy/vercel/runtime/compose';
import { API_ENV_KEYS, readApiEnv } from '../../deploy/vercel/runtime/env';
import { handleDeploymentRequest } from '../../deploy/vercel/api/router';
import { fakeProviders } from '../../deploy/wire/smoketest';
import { validConstraintSet, validGoal } from '../../services/api/src/fixtures';
import { CONSOLE_SESSION_HEADER } from '../../deploy/vercel/runtime/session-routes';
import { PRINCIPAL_TOKEN_HEADER } from '../../deploy/vercel/runtime/auth-routes';
import { DEMO_PROJECT_ID } from '../../deploy/vercel/runtime/demo';
import type { FunctionRequest, FunctionResponse } from '../../deploy/vercel/runtime/http';
import { isSessionOwnDesk, sessionOwnDesksOf } from '../../apps/web/src/core/tenant';
import type { ProjectRecord } from '../../apps/web/src/api/contracts';

// ---------------------------------------------------------------------------
// The harness (the auth-routes.test.ts shape, verbatim)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-principal-iso';
const TOKEN = 'tok-deploy-principal-iso';
const AUTH_KEY = 'test-principal-iso-hmac-key';
const NEON_KEYS = {
  NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech',
  NEON_DATABASE: 'neondb',
  NEON_API_USER: 'neondb_owner',
  NEON_API_KEY: 'fake-neon-key-demo',
};
const T0 = 1_800_500_000_000;
const SESSION_ALICE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // alice's device
const SESSION_BOB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; // bob's device

function isoSource(): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: 'public-console',
    ...NEON_KEYS,
    [API_ENV_KEYS.authTokenKey]: AUTH_KEY,
  };
}

function composeInstance(fetchLike: import('../../deploy/adapters/shared').FetchLike) {
  return composeDeployment(readApiEnv(isoSource()), {}, { fetchLike, instants: { next: () => T0 } });
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

type Composition = ReturnType<typeof composeDeployment>;

async function drive(deployment: Composition, request: FunctionRequest): Promise<{ status: number; body: Record<string, unknown> }> {
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

/** Register one named principal through the FULL handler; returns the minted token. */
async function registerPrincipal(instance: Composition, name: string): Promise<string> {
  const registered = await drive(instance, streamingRequest({
    method: 'POST', url: '/v1/auth/register', headers: { ...BEARER, 'content-type': 'application/json' },
    body: { name, passphrase: `passphrase-of-${name}-long-enough` },
  }));
  expect(registered.status).toBe(201);
  return ((registered.body.data as { token: string }).token);
}

/** One principal's desk listing (the session + the principal token headers — the console's own request shape). */
async function listingOf(instance: Composition, session: string, token: string | null): Promise<readonly { id: string; consoleSessionScope?: string; ownerPrincipal?: unknown; ownerSession?: unknown }[]> {
  const headers = token === null ? sessionHeaders(session) : sessionHeaders(session, { [PRINCIPAL_TOKEN_HEADER]: token });
  const listed = await drive(instance, streamingRequest({ url: '/v1/projects', headers }));
  expect(listed.status).toBe(200);
  return ((listed.body.data as { items: readonly { id: string; consoleSessionScope?: string; ownerPrincipal?: unknown; ownerSession?: unknown }[] }).items);
}

// ---------------------------------------------------------------------------
// The battery
// ---------------------------------------------------------------------------

describe('FW-39-3 security: cross-principal isolation (the L12 analog at the principal layer)', () => {
  it('the listing markers never lie: bob sees alice\'s desk as tenant-available, NEVER as his own — and his own as principal-owned', async () => {
    const providers = fakeProviders();
    const instance = composeInstance(providers.fetchLike);
    expect(instance.ok).toBe(true);
    if (!instance.ok) return;
    const alice = await registerPrincipal(instance, 'alice');
    const bob = await registerPrincipal(instance, 'bob');

    // Each principal launches a desk from their own device with their own token.
    for (const [session, token, project] of [[SESSION_ALICE, alice, 'prj-alice-desk'], [SESSION_BOB, bob, 'prj-bob-desk']] as const) {
      const created = await drive(instance, streamingRequest({
        method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(session, { [PRINCIPAL_TOKEN_HEADER]: token }), 'content-type': 'application/json' },
        body: createProjectBody(project),
      }));
      expect(created.status).toBe(201);
    }

    // BOB's view from a FRESH device (the restart position — the principal law's clean view, no session-owned precedence): his desk is principal-owned; alice's desk (and the shared demo) is tenant-available.
    const SESSION_FRESH_BOB = 'efefefefefefefefefefefefefefefef';
    const bobItems = await listingOf(instance, SESSION_FRESH_BOB, bob);
    expect(bobItems.find((item) => item.id === 'prj-bob-desk')?.consoleSessionScope).toBe('principal-owned');
    expect(bobItems.find((item) => item.id === 'prj-alice-desk')?.consoleSessionScope).toBe('tenant-available');
    expect(bobItems.find((item) => item.id === DEMO_PROJECT_ID)?.consoleSessionScope).toBe('tenant-available');

    // ALICE's view from a fresh device: the mirror image — her desk principal-owned, bob's tenant-available.
    const SESSION_FRESH_ALICE = 'edededededededededededededededed';
    const aliceItems = await listingOf(instance, SESSION_FRESH_ALICE, alice);
    expect(aliceItems.find((item) => item.id === 'prj-alice-desk')?.consoleSessionScope).toBe('principal-owned');
    expect(aliceItems.find((item) => item.id === 'prj-bob-desk')?.consoleSessionScope).toBe('tenant-available');

    // THE IDENTITY-NEVER-CROSSES LAW (the ownerSession precedent): only the derived marker serves.
    expect(bobItems.every((item) => item.ownerPrincipal === undefined && item.ownerSession === undefined)).toBe(true);
    expect(aliceItems.every((item) => item.ownerPrincipal === undefined && item.ownerSession === undefined)).toBe(true);
  });

  it('the client WALL fold (the switcher/palette/Oversight surface): principal B\'s own desks = B\'s desks + the shared demo ONLY — alice\'s desk is invisible to bob on every console surface', async () => {
    const providers = fakeProviders();
    const instance = composeInstance(providers.fetchLike);
    expect(instance.ok).toBe(true);
    if (!instance.ok) return;
    const alice = await registerPrincipal(instance, 'alice');
    const bob = await registerPrincipal(instance, 'bob');
    for (const [session, token, project] of [[SESSION_ALICE, alice, 'prj-alice-desk'], [SESSION_BOB, bob, 'prj-bob-desk']] as const) {
      const created = await drive(instance, streamingRequest({
        method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(session, { [PRINCIPAL_TOKEN_HEADER]: token }), 'content-type': 'application/json' },
        body: createProjectBody(project),
      }));
      expect(created.status).toBe(201);
    }

    // The REAL client fold over the SERVED listing (what the shipped console renders).
    const bobDirectory = (await listingOf(instance, SESSION_BOB, bob)) as unknown as readonly ProjectRecord[];
    const aliceDirectory = (await listingOf(instance, SESSION_ALICE, alice)) as unknown as readonly ProjectRecord[];

    // The wall census: each principal's own desks = their desk + the shared demo — NOTHING else.
    expect(sessionOwnDesksOf(bobDirectory, DEMO_PROJECT_ID).map((project) => project.id).sort()).toEqual(['prj-bob-desk', DEMO_PROJECT_ID].sort());
    expect(sessionOwnDesksOf(aliceDirectory, DEMO_PROJECT_ID).map((project) => project.id).sort()).toEqual(['prj-alice-desk', DEMO_PROJECT_ID].sort());
    // The own-desk predicate agrees on every row (alice's desk is NEVER bob's own).
    expect(isSessionOwnDesk(bobDirectory.find((project) => project.id === 'prj-alice-desk') as ProjectRecord)).toBe(false);
    expect(isSessionOwnDesk(bobDirectory.find((project) => project.id === 'prj-bob-desk') as ProjectRecord)).toBe(true);
    // And the mirror for alice.
    expect(isSessionOwnDesk(aliceDirectory.find((project) => project.id === 'prj-bob-desk') as ProjectRecord)).toBe(false);
  });

  it('the G-11 closure under a FRESH device: alice\'s token marks her desk own from a brand-new session — while bob\'s token NEVER marks it', async () => {
    const providers = fakeProviders();
    const instance = composeInstance(providers.fetchLike);
    expect(instance.ok).toBe(true);
    if (!instance.ok) return;
    const alice = await registerPrincipal(instance, 'alice');
    const bob = await registerPrincipal(instance, 'bob');
    const created = await drive(instance, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_ALICE, { [PRINCIPAL_TOKEN_HEADER]: alice }), 'content-type': 'application/json' },
      body: createProjectBody('prj-alice-desk'),
    }));
    expect(created.status).toBe(201);

    // A brand-new device (a fresh session id — the restart orphan's position) + ALICE's token: own.
    const freshDevice = 'cccccccccccccccccccccccccccccccc';
    const freshAlice = await listingOf(instance, freshDevice, alice);
    expect(freshAlice.find((item) => item.id === 'prj-alice-desk')?.consoleSessionScope).toBe('principal-owned');
    // The same fresh device + BOB's token: alice's desk is tenant-available — bob's token NEVER widens his wall.
    const freshBob = await listingOf(instance, freshDevice, bob);
    expect(freshBob.find((item) => item.id === 'prj-alice-desk')?.consoleSessionScope).toBe('tenant-available');
  });

  it('the honest shared-tenant disclosure, pinned: a direct read of another principal\'s desk by id serves MARKED (tenant-available), never as own — the FW-31-B registry law under principals', async () => {
    const providers = fakeProviders();
    const instance = composeInstance(providers.fetchLike);
    expect(instance.ok).toBe(true);
    if (!instance.ok) return;
    const alice = await registerPrincipal(instance, 'alice');
    const bob = await registerPrincipal(instance, 'bob');
    const created = await drive(instance, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_ALICE, { [PRINCIPAL_TOKEN_HEADER]: alice }), 'content-type': 'application/json' },
      body: createProjectBody('prj-alice-desk'),
    }));
    expect(created.status).toBe(201);

    // Bob's session reads alice's desk BY ID: under the DURABLE backing the tenant registry
    // serves it (FW-31-B — the frozen knowledge/outcome routes are tenant-scoped, the
    // disclosed shared-credential limitation), but the marker law holds: NEVER 'own'.
    const detail = await drive(instance, streamingRequest({
      url: `/v1/projects/${'prj-alice-desk'}`, headers: sessionHeaders(SESSION_BOB, { [PRINCIPAL_TOKEN_HEADER]: bob }),
    }));
    expect(detail.status).toBe(200);
    expect((detail.body.data as { consoleSessionScope?: string }).consoleSessionScope).toBe('tenant-available');
    // Alice's own read of the same desk from a fresh device: principal-owned.
    const own = await drive(instance, streamingRequest({
      url: '/v1/projects/prj-alice-desk', headers: sessionHeaders('dddddddddddddddddddddddddddddddd', { [PRINCIPAL_TOKEN_HEADER]: alice }),
    }));
    expect((own.body.data as { consoleSessionScope?: string }).consoleSessionScope).toBe('principal-owned');
    // And the identity NEVER crosses on the detail read either.
    expect((own.body.data as Record<string, unknown>).ownerPrincipal).toBeUndefined();
    expect((own.body.data as Record<string, unknown>).ownerSession).toBeUndefined();
  });
});
