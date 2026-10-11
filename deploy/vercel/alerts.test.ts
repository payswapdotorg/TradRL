// deploy/vercel/alerts.test.ts — THE PRICE-ALERT DECLARATION (FW-46, the
// S2 market-facing surface — S2's top friction, Round L seventh round:
// "zero charts, live data feeds, or price alerts anywhere in the console").
//
// WHAT IS PINNED (the host-owned POST /v1/projects/:projectId/alerts route
// + the storage law, through the FULL function handler — the notes.ts
// harness pattern, the FW-45 precedent this wave mirrors):
//
//   - AUTHN FIRST — a request without the deployment's registered
//     developer credential is the typed 401 (the W-8 law);
//   - THE UNTRUSTED-INPUT GATE — the alert is STRUCTURALLY PARSED before
//     any storage: a body that is not an object, a missing/empty/oversized
//     market, a direction outside 'above'|'below', or a level that is not
//     a positive exact-decimal string answers the typed 400
//     validation_failed (the boundary's own untrusted-payload law — never
//     a novel status) with the broken paths named — NEVER a half-applied
//     alert (the draft-store law);
//   - FAIL-CLOSED TARGET — an alert attaches ONLY to a project with a goal
//     set on record (the alert rides the SAME opaque row the launch world,
//     the ownership stamps and the research notes ride); a project with no
//     goal set answers the typed 404, never an alert on a record that
//     does not exist;
//   - THE MINT — the record is content-addressed over its own envelope
//     (tenant + project + declaredAt + market + direction + level), and
//     its declaredAt is the ROUTE'S OWN observation (L4 — never a request
//     value);
//   - IDEMPOTENT PER CONTENT — re-declaring an alert the project already
//     carries (the same market + direction + level — the client's own
//     idempotency-key unit) returns the STORED record, never a duplicate
//     row (the FIRST mint stands);
//   - THE READ-BACK — the host goal route (GET /v1/projects/:id/goal)
//     serves the declared alerts as the ADDITIVE `alerts` field (the
//     `world`/`notes` precedent), so the console's boot bundle re-reads
//     them after a reload;
//   - THE DURABLE WRITE-THROUGH — under the DURABLE backing the alert
//     merges into the project's goal-set row and a FRESH serverless
//     instance serves it from the durable truth — DURABLE RECORD, not
//     per-instance state. Under the DEMO backing the storage is
//     per-instance (the demo arm's own law, honest under the SIMULATED
//     badge).
//
// Spec anchors: R43 (additive), R45 (provenance), R46 (every failure path
// typed; never a crash), L4 (the declaredAt is the route's own instant),
// L12 (the route keys on the AUTHORIZED tenant — a foreign project answers
// the typed 404), the FW-45 storage precedent this wave mirrors.

import { describe, expect, it } from 'vitest';
import { composeDeployment } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { fakeProviders } from '../wire/smoketest';
import { NeonProjectStore, type NeonStoreDeps } from '../adapters/neon/stores';
import type { NeonConfig } from '../adapters/neon/client';
import type { FetchLike } from '../adapters/shared';
import { validConstraintSet, validGoal } from '../../services/api/src/fixtures';
import type { FunctionRequest, FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// The fixed fake world (the record-durability harness law — never a real credential)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-fw46';
const TOKEN = 'tok-deploy-fw46';
const PRINCIPAL = 'public-console';
const NEON_KEYS = {
  NEON_API_HOST: 'ep-fw46-pooler.us-east-2.aws.neon.tech',
  NEON_DATABASE: 'neondb',
  NEON_API_USER: 'neondb_owner',
  NEON_API_KEY: 'fake-neon-key-fw46',
};
const NEON_CONFIG: NeonConfig = {
  apiHost: NEON_KEYS.NEON_API_HOST,
  database: NEON_KEYS.NEON_DATABASE,
  apiUser: NEON_KEYS.NEON_API_USER,
  apiKey: NEON_KEYS.NEON_API_KEY,
};

const T0 = 1_800_600_000_000;

const BEARER = { authorization: `Bearer ${TOKEN}` };

function createProjectBody(projectId: string, at = T0): Record<string, unknown> {
  return { id: projectId, name: `the ${projectId} desk`, executionMode: 'simulation', goal: validGoal(TENANT), constraintSet: validConstraintSet(TENANT), at };
}

// ---------------------------------------------------------------------------
// The function-handler harness (the full path: settled -> boot world ->
// tick -> wrap -> host route -> boundary -> drain -> response)
// ---------------------------------------------------------------------------

function streamingRequest(parts: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown }): FunctionRequest {
  return { method: parts.method ?? 'GET', url: parts.url ?? '/v1/meta', headers: parts.headers ?? {}, body: parts.body };
}

function capture(): { response: FunctionResponse; captured: () => { readonly status: number; readonly payload: string | null } } {
  let status = 0;
  let payload: string | null = null;
  const response: FunctionResponse = {
    get statusCode() {
      return status;
    },
    set statusCode(value: number) {
      status = value;
    },
    setHeader() {
      return undefined;
    },
    end(chunk?: string) {
      if (typeof chunk === 'string') payload = chunk;
      return undefined;
    },
  };
  return { response, captured: () => ({ status, payload }) };
}

async function drive(deployment: ReturnType<typeof composeDeployment>, request: FunctionRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const { response, captured } = capture();
  await handleDeploymentRequest(deployment, request, response);
  const written = captured();
  return { status: written.status, body: JSON.parse(written.payload ?? 'null') as Record<string, unknown> };
}

/** The demo env (no durable keys — the DEMO backing composes). */
function demoSource(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
    ...overrides,
  };
}

/** The durable env (the fake Neon fleet — the record-durability harness law). */
function durableSource(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
    ...NEON_KEYS,
    [API_ENV_KEYS.apiInternalToken]: 'tok-internal-fw46',
    [API_ENV_KEYS.apiInternalPrincipal]: 'fw46-machinery',
    ...overrides,
  };
}

/** Compose one deployment over the injected fetch (a fresh "serverless instance"). */
function composeInstance(source: Record<string, string | undefined>, fetchLike?: FetchLike) {
  return composeDeployment(readApiEnv(source), {}, fetchLike === undefined ? {} : { fetchLike, instants: { next: () => T0 } });
}

/** The minted alert record's shape as the route serves it. */
interface ServedAlert {
  readonly alertId: string;
  readonly tenant: string;
  readonly project: string;
  readonly declaredAt: number;
  readonly market: string;
  readonly direction: 'above' | 'below';
  readonly level: string;
  readonly actorPrincipal?: string;
  readonly actorAt?: number;
}

// ---------------------------------------------------------------------------
// The route contract (the demo arm — the composition's own per-instance law)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the price-alert declaration route (FW-46, the S2 market surface)', () => {
  it('AUTHN FIRST: a request without the developer credential is the typed 401 — never a stored alert', async () => {
    const deployment = composeInstance(demoSource());
    expect(deployment.ok).toBe(true);
    const refused = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/projects/prj-fw46-a/alerts',
      body: { market: 'BTC-USD', direction: 'above', level: '61000.50' },
    }));
    expect(refused.status).toBe(401);
    expect((refused.body.error as { code: string }).code).toBe('unauthenticated');
  });

  it('THE UNTRUSTED-INPUT GATE: a malformed body answers the typed 400 validation_failed (the boundary\'s own untrusted-payload law) with the broken paths named — never a half-applied alert', async () => {
    const deployment = composeInstance(demoSource());
    const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'idempotency-key': 'idem:fw46:project' }, body: createProjectBody('prj-fw46-a') }));
    expect(created.status).toBe(201);
    for (const [label, body] of [
      ['not an object', '"a string body"'], // a VALID-JSON non-object — this pins the route's own typed gate (the platform's invalid_json 400 is a different, also-correct refusal)
      ['no market', { direction: 'above', level: '61000.50' }],
      ['empty market', { market: '   ', direction: 'above', level: '61000.50' }],
      ['oversized market', { market: 'x'.repeat(65), direction: 'above', level: '61000.50' }],
      ['non-string market', { market: 42, direction: 'above', level: '61000.50' }],
      ['no direction', { market: 'BTC-USD', level: '61000.50' }],
      ['foreign direction', { market: 'BTC-USD', direction: 'sideways', level: '61000.50' }],
      ['non-string direction', { market: 'BTC-USD', direction: 1, level: '61000.50' }],
      ['no level', { market: 'BTC-USD', direction: 'above' }],
      ['non-decimal level', { market: 'BTC-USD', direction: 'above', level: '61,000.50' }],
      ['exponent level', { market: 'BTC-USD', direction: 'above', level: '6.1e4' }],
      ['negative level', { market: 'BTC-USD', direction: 'above', level: '-61000.50' }],
      ['zero level', { market: 'BTC-USD', direction: 'above', level: '0' }],
      ['non-string level', { market: 'BTC-USD', direction: 'above', level: 61000.5 }],
      ['oversized level', { market: 'BTC-USD', direction: 'above', level: '61000.' + '0'.repeat(40) }],
    ] as const) {
      const refused = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects/prj-fw46-a/alerts', headers: BEARER, body }));
      expect(refused.status, label).toBe(400);
      expect((refused.body.error as { code: string }).code, label).toBe('validation_failed');
    }
    // nothing stored: the goal route serves NO alerts after the refused declarations
    const goal = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw46-a/goal', headers: BEARER }));
    expect(goal.status).toBe(200);
    expect((goal.body.data as { alerts?: unknown }).alerts).toBeUndefined();
  });

  it('FAIL-CLOSED TARGET: a project with no goal set on record answers the typed 404 (the alert rides a record that must exist — never an alert on nothing)', async () => {
    const deployment = composeInstance(demoSource());
    const refused = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/projects/prj-never-created/alerts',
      headers: BEARER,
      body: { market: 'BTC-USD', direction: 'above', level: '61000.50' },
    }));
    expect(refused.status).toBe(404);
    expect((refused.body.error as { code: string }).code).toBe('not_found');
  });

  it('THE MINT: the alert stores verbatim (market + direction + level), carries its own scope + content-addressed id, and serves back on the goal route as the ADDITIVE alerts field (the world/notes precedent)', async () => {
    const deployment = composeInstance(demoSource());
    const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'idempotency-key': 'idem:fw46:project-b' }, body: createProjectBody('prj-fw46-b') }));
    expect(created.status).toBe(201);
    const declared = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/projects/prj-fw46-b/alerts',
      headers: BEARER,
      body: { market: 'BTC-USD', direction: 'above', level: '61000.50' },
    }));
    expect(declared.status).toBe(200);
    const alert = (declared.body.data as { alert: ServedAlert }).alert;
    expect(alert.market).toBe('BTC-USD'); // verbatim
    expect(alert.direction).toBe('above'); // verbatim
    expect(alert.level).toBe('61000.50'); // verbatim
    expect(alert.tenant).toBe(TENANT); // the AUTHORIZED tenant, never a request value
    expect(alert.project).toBe('prj-fw46-b');
    expect(alert.alertId).toMatch(/^alert:[0-9a-f]{8}$/); // content-addressed, the house's own id grammar
    expect(Number.isFinite(alert.declaredAt)).toBe(true); // the route's own observation (L4)
    expect(alert.actorPrincipal).toBeUndefined(); // an anonymous declaration — the honest absence
    // THE READ-BACK: the goal route serves the alert (the console's boot re-read)
    const goal = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw46-b/goal', headers: BEARER }));
    expect(goal.status).toBe(200);
    const served = (goal.body.data as { alerts?: readonly ServedAlert[] }).alerts;
    expect(served).toEqual([alert]);
    // IDEMPOTENT PER CONTENT: the identical declaration (the same market +
    // direction + level) returns the SAME record — never a duplicate
    const replay = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/projects/prj-fw46-b/alerts',
      headers: BEARER,
      body: { market: 'BTC-USD', direction: 'above', level: '61000.50' },
    }));
    expect(replay.status).toBe(200);
    const replayed = (replay.body.data as { alert: ServedAlert }).alert;
    expect(replayed.alertId).toBe(alert.alertId);
    const goalAfter = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw46-b/goal', headers: BEARER }));
    expect(((goalAfter.body.data as { alerts?: readonly ServedAlert[] }).alerts ?? []).length).toBe(1); // exactly one row
    // a SECOND, different alert appends (the desk's own list grows)
    const second = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/projects/prj-fw46-b/alerts',
      headers: BEARER,
      body: { market: 'ETH-USD', direction: 'below', level: '3200' },
    }));
    expect(second.status).toBe(200);
    const goalTwo = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw46-b/goal', headers: BEARER }));
    expect(((goalTwo.body.data as { alerts?: readonly ServedAlert[] }).alerts ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The durable arm (the fake Neon fleet — the record-durability harness law)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the durable alert storage (FW-46: the alert is durable record, not per-instance state)', () => {
  it('THE WRITE-THROUGH + THE FRESH INSTANCE: an alert declared on instance A merges into the project\'s goal-set row, and a NEW serverless instance composed over the same durable truth serves it on its own goal route', async () => {
    const providers = fakeProviders();
    const instanceA = composeInstance(durableSource(), providers.fetchLike);
    expect(instanceA.ok).toBe(true);
    // create + declare on instance A (the full pipeline, the durable drain confirms)
    const created = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'idempotency-key': 'idem:fw46:d-project' }, body: createProjectBody('prj-fw46-d') }));
    expect(created.status).toBe(201);
    const declared = await drive(instanceA, streamingRequest({
      method: 'POST',
      url: '/v1/projects/prj-fw46-d/alerts',
      headers: BEARER,
      body: { market: 'BTC-USD', direction: 'above', level: '61000.50' },
    }));
    expect(declared.status).toBe(200);
    const alert = (declared.body.data as { alert: ServedAlert }).alert;
    // instance A's own goal route serves it
    const goalA = await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw46-d/goal', headers: BEARER }));
    expect(((goalA.body.data as { alerts?: readonly ServedAlert[] }).alerts ?? []).map((row) => row.alertId)).toEqual([alert.alertId]);

    // THE FRESH INSTANCE — a new "serverless instance" over the same durable truth
    const instanceB = composeInstance(durableSource(), providers.fetchLike);
    expect(instanceB.ok).toBe(true);
    const goalB = await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw46-d/goal', headers: BEARER }));
    expect(goalB.status).toBe(200);
    const servedB = (goalB.body.data as { alerts?: readonly ServedAlert[] }).alerts ?? [];
    expect(servedB.map((row) => row.alertId)).toEqual([alert.alertId]); // the durable truth carries the alert — never the pre-fix per-instance emptiness
    expect(servedB[0]?.level).toBe('61000.50'); // verbatim across instances
    // the row-level truth: the goal-set row itself carries the alerts (the same opaque payload column `world`/`notes` ride)
    const deps: NeonStoreDeps = { config: NEON_CONFIG, fetchLike: providers.fetchLike, instants: { next: () => T0 } };
    const store = new NeonProjectStore(deps);
    const row = await store.goalSetOf(TENANT, 'prj-fw46-d');
    if (!row.ok) throw new Error(`the goal-set read failed: ${row.error.code}`);
    const alerts = (row.value as { readonly alerts?: readonly ServedAlert[] } | null)?.alerts ?? [];
    expect(alerts.map((entry) => entry.alertId)).toEqual([alert.alertId]);
  });
});
