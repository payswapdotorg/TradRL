// deploy/vercel/durable.test.ts — THE DURABLE SEAM + ACTIVATION TESTS
// (W-25D defect D-5; W-26B the durable full-surface activation).
//
// Pure, offline, deterministic: the REAL Neon adapters (deploy/wire W-3d)
// over the fake provider fleet's fetch (deploy/wire/smoketest.ts — no
// network, FIXED FAKE credentials), driving the REAL composition
// (runtime/compose.ts) and the FULL function handler (api/router.ts).
// What is pinned — the work order's test law:
//   (a) THE COLD-START SURVIVAL (the D-5 payoff): a launched project + its
//       goal set, organization binding and lifecycle state persist in the
//       durable store and REHYDRATE on every new instance (M1's scenario);
//   (b) THE WRITE-THROUGH on every mutation surface (createProject /
//       transition / bindOrganization — the durable rows exist, in
//       dependency order);
//   (c) THE ORDERING LAW: a failed durable write degrades to the typed 503
//       and the unconfirmed mutation NEVER serves (the re-projection wipes
//       it — never a crash, never a silent divergence, never a silent
//       empty);
//   (d) THE DEGRADATION MATRIX: Neon absent -> the typed `deploy_adapter_absent`
//       503s while everything else works; Neon down at boot -> the typed
//       `neon_unreachable` 503s per request, healed by the per-request
//       retry when Neon recovers;
//   (e) THE BOOT HYDRATION ORDER + COMPLETENESS: the registry first, then
//       the per-project event log, then the knowledge/outcome records —
//       observable through the projection report;
//   (f) THE DEMO PATH stays byte-identical (the seam activates ONLY on the
//       durable resolution);
//   (g) THE GOAL READ under the durable backing (the host-owned route
//       serving the rehydrated goal set — the W-23 console fetch's answer);
//   (h) THE W-26B ACTIVATION — the durable resolution as a SUPERSET of
//       demo: the launch journey END-TO-END (J3: create 201 -> job submit
//       202 -> the machinery tick advances submitted -> running -> complete
//       with the release-candidate result); the demo world's two-boot law
//       (the registry guard skips the create, the per-instance job store
//       re-seeds, the fixture substance boots into the Neon stores and
//       hydrates); the fixture boot-write's idempotency (a second boot
//       writes NOTHING new); the tick's org compile for a user-launched
//       project + the org-status surface (including the R7 post-cold-start
//       snapshot re-report); the cold-start survival WITH the full world;
//       the boot-world failure law (a failed seed write = the typed 503,
//       retried per request, healed on recovery — never a silent partial
//       world); and the request's own drain-failure law unchanged under a
//       latched boot world.
//
// Spec anchors: R46, ARCHITECTURE-LOCK L4/L8/L12/L15, D-033, D-5;
// deploy/wire/production.md (the composition law).

import { describe, expect, it, vi } from 'vitest';
import { composeDeployment, DEPLOY_ADAPTER_PENDING } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { fakeProviders } from '../wire/smoketest';
import { NeonFirmMemoryStore, NeonOutcomeLearningStore, NeonProjectStore, type NeonStoreDeps } from '../adapters/neon/stores';
import type { NeonConfig } from '../adapters/neon/client';
import type { FetchLike } from '../adapters/shared';
import { fixtureKnowledge, validConstraintSet, validGoal, validStrategyIntent } from '../../services/api/src/fixtures';
import { DEMO_ORGANIZATION_REF, DEMO_PROJECT_ID, compiledOrganizationRefOf, demoConstraintSet, demoGoalStatement } from './runtime/demo';
import type { FunctionRequest, FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// The fixed fake world (never a real credential)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-durable';
const TOKEN = 'tok-deploy-durable';
const PRINCIPAL = 'public-console';
const NEON_KEYS = {
  NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech',
  NEON_DATABASE: 'neondb',
  NEON_API_USER: 'neondb_owner',
  NEON_API_KEY: 'fake-neon-key-demo',
};
const NEON_CONFIG: NeonConfig = {
  apiHost: NEON_KEYS.NEON_API_HOST,
  database: NEON_KEYS.NEON_DATABASE,
  apiUser: NEON_KEYS.NEON_API_USER,
  apiKey: NEON_KEYS.NEON_API_KEY,
};

/** The env source of a durable deployment (Neon keys only — the beachhead shape). */
function durableSource(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
    ...NEON_KEYS,
    ...overrides,
  };
}

/**
 * The env source of a durable deployment WITH the internal credential
 * configured (the private plane open — the machinery tick + the org-status
 * reports run; the W-26B activation's full surface).
 */
function durableSourceWithMachinery(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return durableSource({ [API_ENV_KEYS.apiInternalToken]: 'tok-internal-durable', [API_ENV_KEYS.apiInternalPrincipal]: 'durable-machinery', ...overrides });
}

/** The fixed instant base of the scenario (deterministic durable rows). */
const T0 = 1_800_400_000_000;

/** Compose one durable instance over the injected fetch (a fresh "serverless instance"). */
function composeInstance(source: Record<string, string | undefined>, fetchLike: FetchLike) {
  return composeDeployment(readApiEnv(source), {}, { fetchLike, instants: { next: () => T0 } });
}

/** A direct store over the fake fleet (pre-population + row-level assertions). */
function storesOver(fetchLike: FetchLike): { firmMemory: NeonFirmMemoryStore; outcomeLearning: NeonOutcomeLearningStore; project: NeonProjectStore } {
  const deps: NeonStoreDeps = { config: NEON_CONFIG, fetchLike, instants: { next: () => T0 } };
  return { firmMemory: new NeonFirmMemoryStore(deps), outcomeLearning: new NeonOutcomeLearningStore(deps), project: new NeonProjectStore(deps) };
}

/** The bearer headers of the deployment's developer credential. */
const BEARER = { authorization: `Bearer ${TOKEN}` };

/** One create-project body (the REAL T007 goal/constraint shapes, tenant-scoped). */
function createProjectBody(projectId: string, at = T0): Record<string, unknown> {
  return { id: projectId, name: `the ${projectId} desk`, executionMode: 'simulation', goal: validGoal(TENANT), constraintSet: validConstraintSet(TENANT), at };
}

/** An outage-controllable fetch (the R46 lever — up/down without rebuilding the fleet). */
function outageFetch(inner: FetchLike): { readonly fetchLike: FetchLike; setOutage(down: boolean): void } {
  let down = false;
  return {
    fetchLike: (url, init) => (down ? Promise.reject(new Error('connection refused (simulated provider outage)')) : inner(url, init)),
    setOutage: (value: boolean) => {
      down = value;
    },
  };
}

/** A write-counting fetch (the idempotency observable — every Neon INSERT crossing the wire). */
function insertCountingFetch(inner: FetchLike): { readonly fetchLike: FetchLike; readonly inserts: () => number } {
  let inserts = 0;
  return {
    fetchLike: (url, init) => {
      if (typeof init?.body === 'string' && init.body.includes('INSERT INTO tradrl_')) inserts += 1;
      return inner(url, init);
    },
    inserts: () => inserts,
  };
}

// ---------------------------------------------------------------------------
// The function-handler harness (the full path: settled -> wrap -> host
// route -> boundary -> drain -> response)
// ---------------------------------------------------------------------------

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

/** Drive one request through the FULL function handler; returns the parsed JSON body. */
async function drive(deployment: ReturnType<typeof composeInstance>, request: FunctionRequest): Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown> }> {
  const { response, captured } = capture();
  await handleDeploymentRequest(deployment, request, response);
  const written = captured();
  return { status: written.status, headers: written.headers, body: JSON.parse(written.payload ?? 'null') as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// (a)+(b) THE COLD-START SURVIVAL + THE WRITE-THROUGH (the D-5 payoff)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the durable seam: the cold-start survival (D-5)', () => {
  it('a launched project + its goal set, organization binding and lifecycle state REHYDRATE on a new instance (M1: the project is in the switcher with its world)', async () => {
    const providers = fakeProviders();

    // INSTANCE 1: the boot projection over an empty durable store, then the launch.
    const first = composeInstance(durableSource(), providers.fetchLike);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.backing).toBe('durable');
    expect(first.durable).not.toBeNull();
    await first.durable!.settled();
    expect(first.durable!.lastProjection()).toEqual({ projects: 0, events: 0, knowledge: 0, outcomes: 0, postMortems: 0, skipped: [] });

    const created = first.service.handle({ method: 'POST', path: '/v1/projects', headers: BEARER, body: createProjectBody('prj-durable-desk-a') });
    expect(created.status).toBe(201);
    expect((await first.durable!.drain()).ok).toBe(true); // the write-through lands (goal set -> record)
    const bound = first.service.handle({ method: 'POST', path: '/v1/projects/prj-durable-desk-a/organization', headers: BEARER, body: { organizationRef: 'org:durable-desk-a', at: T0 + 1_000 } });
    expect(bound.status).toBe(200);
    expect((await first.durable!.drain()).ok).toBe(true); // record -> event
    const activated = first.service.handle({ method: 'POST', path: '/v1/projects/prj-durable-desk-a/lifecycle', headers: BEARER, body: { event: 'activate', at: T0 + 2_000 } });
    expect(activated.status).toBe(200);
    expect((await first.durable!.drain()).ok).toBe(true); // record -> event

    // THE WRITE-THROUGH, row by row: the durable store holds the registry
    // record, the goal set and the append-only event log (dependency order).
    const direct = storesOver(providers.fetchLike);
    const record = await direct.project.getProjectRecord(TENANT, 'prj-durable-desk-a');
    expect(record.ok).toBe(true);
    const goalSet = await direct.project.goalSetOf(TENANT, 'prj-durable-desk-a');
    expect(goalSet.ok).toBe(true);
    if (goalSet.ok && goalSet.value !== null) {
      expect(goalSet.value.goal).toEqual(validGoal(TENANT));
      expect(goalSet.value.constraintSet).toEqual(validConstraintSet(TENANT));
    }
    const events = await direct.project.projectEventsOf(TENANT, 'prj-durable-desk-a');
    expect(events.ok).toBe(true);
    if (events.ok) expect(events.value.map((event) => event.event)).toEqual(['organization-bound', 'activate']);

    // INSTANCE 2 (the cold start): the whole world rehydrates through the
    // REAL control plane's own law — the project lists with its ACTIVE
    // lifecycle, its bound organization, and its goal set.
    const second = composeInstance(durableSource(), providers.fetchLike);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    await second.durable!.settled();
    expect(second.durable!.lastProjection()).toEqual({ projects: 1, events: 2, knowledge: 0, outcomes: 0, postMortems: 0, skipped: [] });
    const listed = second.service.handle({ method: 'GET', path: '/v1/projects', headers: BEARER, query: {} });
    expect(listed.status).toBe(200);
    const page = (listed.body as { data: { items: readonly { id: string; lifecycle: { status: string; organizationRef: string | null } }[] } }).data;
    expect(page.items.map((project) => project.id)).toEqual(['prj-durable-desk-a']);
    expect(page.items[0]!.lifecycle.status).toBe('active'); // the transition replayed
    expect(page.items[0]!.lifecycle.organizationRef).toBe('org:durable-desk-a'); // the binding replayed
    const one = second.service.handle({ method: 'GET', path: '/v1/projects/prj-durable-desk-a', headers: BEARER });
    expect(one.status).toBe(200);
    const goalRead = second.durable!.goalOf('prj-durable-desk-a');
    expect(goalRead.ok).toBe(true);
    if (goalRead.ok && goalRead.value !== null) {
      expect(goalRead.value.goal).toEqual(validGoal(TENANT)); // the goal records ride the create-project input
      expect(goalRead.value.constraintSet).toEqual(validConstraintSet(TENANT));
    }
    // The rehydrated instance keeps writing through: a pause survives too.
    const paused = second.service.handle({ method: 'POST', path: '/v1/projects/prj-durable-desk-a/lifecycle', headers: BEARER, body: { event: 'pause', at: T0 + 3_000 } });
    expect(paused.status).toBe(200);
    expect((await second.durable!.drain()).ok).toBe(true);
    const third = composeInstance(durableSource(), providers.fetchLike);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    await third.durable!.settled();
    const relisted = third.service.handle({ method: 'GET', path: '/v1/projects', headers: BEARER, query: {} });
    const repage = (relisted.body as { data: { items: readonly { lifecycle: { status: string } }[] } }).data;
    expect(repage.items[0]!.lifecycle.status).toBe('paused');
  });

  it('M1\'s scenario through the FULL function handler: launch on instance A, land on instance B, the project is in the switcher with its world', async () => {
    const providers = fakeProviders();
    const instanceA = composeInstance(durableSource(), providers.fetchLike);
    expect(instanceA.ok).toBe(true);
    if (!instanceA.ok) return;

    const launch = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-durable-desk-b') }));
    expect(launch.status).toBe(201); // the router drained the durable writes before serving
    const bound = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects/prj-durable-desk-b/organization', headers: BEARER, body: { organizationRef: 'org:durable-desk-b', at: T0 + 1_000 } }));
    expect(bound.status).toBe(200);
    const activated = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects/prj-durable-desk-b/lifecycle', headers: BEARER, body: { event: 'activate', at: T0 + 2_000 } }));
    expect(activated.status).toBe(200);

    const instanceB = composeInstance(durableSource(), providers.fetchLike);
    expect(instanceB.ok).toBe(true);
    if (!instanceB.ok) return;
    const switcher = await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));
    expect(switcher.status).toBe(200);
    const items = ((switcher.body as { data: { items: readonly { id: string }[] } }).data).items;
    // W-26B: the first router-driven request on the new instance ran the
    // BOOT WORLD — the demo project is seeded once per DATABASE (the
    // registry guard), so the durable resolution serves it ALONGSIDE every
    // user-launched project (the superset law; creation order — the demo
    // seed's fixed past createdAt sorts first).
    expect(items.map((project) => project.id)).toEqual(['prj-demo-console', 'prj-durable-desk-b']);
    const goal = await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/projects/prj-durable-desk-b/goal', headers: BEARER }));
    expect(goal.status).toBe(200);
    const goalBody = (goal.body as { data: { goal: unknown; constraintSet: unknown } }).data;
    expect(goalBody.goal).toEqual(validGoal(TENANT));
    expect(goalBody.constraintSet).toEqual(validConstraintSet(TENANT));
    // The demo project's OWN goal serves too (the seeded records persisted
    // at create time and rehydrated — the same content the demo route serves).
    const demoGoal = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/projects/${DEMO_PROJECT_ID}/goal`, headers: BEARER }));
    expect(demoGoal.status).toBe(200);
    const demoGoalBody = (demoGoal.body as { data: { goal: unknown; constraintSet: unknown } }).data;
    expect(demoGoalBody.goal).toEqual(demoGoalStatement(TENANT));
    expect(demoGoalBody.constraintSet).toEqual(demoConstraintSet(TENANT));
  });
});

// ---------------------------------------------------------------------------
// (c) THE ORDERING LAW (the failure half — pinned)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the durable seam: the write-through ordering law', () => {
  it('a failed durable write degrades to the typed 503; the unconfirmed mutation NEVER serves (the re-projection wipes it — never a silent divergence)', async () => {
    const providers = fakeProviders();
    const outage = outageFetch(providers.fetchLike);
    const deployment = composeInstance(durableSource(), outage.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    await deployment.durable!.settled(); // the boot projection over the empty store

    outage.setOutage(true); // Neon goes down MID-INSTANCE (after the boot)
    const created = deployment.service.handle({ method: 'POST', path: '/v1/projects', headers: BEARER, body: createProjectBody('prj-phantom') });
    expect(created.status).toBe(201); // the boundary's own (pre-drain) answer — the in-memory mutation applied
    const drained = await deployment.durable!.drain();
    expect(drained.ok).toBe(false);
    if (drained.ok) return;
    expect(drained.error.code).toBe('neon_unreachable');

    // The stale projection never serves: reads answer the typed 503 with the
    // durable failure's own code (never an empty 200 — that would be the
    // silent divergence), while everything else (authn/authz, meta) keeps
    // working (the matrix).
    const listed = deployment.service.handle({ method: 'GET', path: '/v1/projects', headers: BEARER, query: {} });
    expect(listed.status).toBe(503);
    expect((listed.body as { error: { code: string; message: string } }).error.message).toContain('neon_unreachable');
    // The re-projection against the outage FAILS — the per-request retry
    // keeps the surfaces in the typed degraded state (no circuit state).
    await deployment.durable!.settled();
    const stillDegraded = deployment.service.handle({ method: 'GET', path: '/v1/projects', headers: BEARER, query: {} });
    expect(stillDegraded.status).toBe(503);
    expect((stillDegraded.body as { error: { code: string; message: string } }).error.message).toContain('neon_unreachable');
    const unauthenticated = deployment.service.handle({ method: 'GET', path: '/v1/projects', headers: {}, query: {} });
    expect(unauthenticated.status).toBe(401); // authn runs BEFORE the port
    const meta = deployment.service.handle({ method: 'GET', path: '/v1/meta', headers: BEARER });
    expect(meta.status).toBe(200);

    // RECOVERY: Neon comes back; the per-request retry re-projects from the
    // durable truth — the phantom (never persisted) is gone.
    outage.setOutage(false);
    await deployment.durable!.settled();
    const relisted = deployment.service.handle({ method: 'GET', path: '/v1/projects', headers: BEARER, query: {} });
    expect(relisted.status).toBe(200);
    expect(((relisted.body as { data: { items: readonly unknown[] } }).data).items).toEqual([]);
  });

  it('the router integration (W-26B): a failed BOOT-WORLD write degrades the first serve with the typed 503 — the seeded world is unconfirmed, never a silent partial (the ordering law, ridden by the boot seed)', async () => {
    const providers = fakeProviders();
    const outage = outageFetch(providers.fetchLike);
    const deployment = composeInstance(durableSource(), outage.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    await deployment.durable!.settled();

    outage.setOutage(true); // Neon goes down MID-INSTANCE, after the boot projection
    // The FIRST router-driven request runs the W-26B boot world: the demo
    // world seed rides the real routes (the in-memory mutations apply), the
    // DRAIN hits the outage — the typed 503 replaces the response (the
    // seeded world is UNCONFIRMED; the seam re-projects and the next
    // request retries — pinned in the activation battery below).
    const response = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-unconfirmed') }));
    expect(response.status).toBe(503);
    const error = (response.body as { requestId: unknown; error: { code: string; message: string } }).error;
    expect(error.code).toBe('unavailable');
    expect(error.message).toContain('neon_unreachable');
    expect(error.message).toContain('unconfirmed');
  });
});

// ---------------------------------------------------------------------------
// (d) THE DEGRADATION MATRIX (Neon absent + Neon down)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the durable seam: the degradation matrix', () => {
  it('Neon ABSENT (an explicit durable backing without Neon keys): the Neon-backed routes answer the typed deploy_adapter_absent 503s; everything else works', () => {
    const deployment = composeInstance({ [API_ENV_KEYS.apiDeveloperToken]: TOKEN, [API_ENV_KEYS.apiDeveloperTenant]: TENANT, [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL, TRADRL_DEPLOY_BACKING: 'durable' }, fakeProviders().fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    expect(deployment.backing).toBe('durable');
    expect(deployment.durable).toBeNull(); // the seam is not built — Neon's keys are incomplete
    const surfaces = [
      { method: 'GET', path: '/v1/projects', query: {}, body: undefined },
      { method: 'POST', path: '/v1/knowledge/query', body: { project: 'prj_x', at: T0 } },
      { method: 'POST', path: '/v1/outcomes/query', body: { project: 'prj_x', at: T0 } },
      { method: 'POST', path: '/v1/post-mortems/query', body: { project: 'prj_x', at: T0 } },
    ];
    for (const surface of surfaces) {
      const response = deployment.service.handle({ method: surface.method, path: surface.path, headers: BEARER, ...(surface.query === undefined ? {} : { query: surface.query }), ...(surface.body === undefined ? {} : { body: surface.body }) });
      expect(response.status, surface.path).toBe(503);
      expect((response.body as { error: { code: string; message: string } }).error.message, surface.path).toContain('deploy_adapter_absent');
    }
    // The gateway keeps the honest pending stub; jobs follow the matrix for
    // Apify (absent keys -> the typed absent); meta + authn keep working.
    const execution = deployment.service.handle({ method: 'POST', path: '/v1/execution/requests', headers: { ...BEARER, 'idempotency-key': 'idem:w25d:absent' }, body: { intent: validStrategyIntent(TENANT, 'prj_x') } });
    expect((execution.body as { error: { message: string } }).error.message).toContain(DEPLOY_ADAPTER_PENDING);
    const job = deployment.service.handle({ method: 'POST', path: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:w25d:absent-job' }, body: { kind: 'research', projectId: 'prj_x', spec: {} } });
    expect((job.body as { error: { message: string } }).error.message).toContain('deploy_adapter_absent');
    expect(deployment.service.handle({ method: 'GET', path: '/v1/meta', headers: BEARER }).status).toBe(200);
    expect(deployment.service.handle({ method: 'GET', path: '/v1/projects', headers: {}, query: {} }).status).toBe(401);
  });

  it('Neon DOWN at boot: every Neon-backed route answers the typed neon_unreachable 503 per request; the per-request retry heals the surfaces when Neon recovers', async () => {
    const providers = fakeProviders();
    const outage = outageFetch(providers.fetchLike);
    outage.setOutage(true); // down BEFORE the first request (the cold start)
    const deployment = composeInstance(durableSource(), outage.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    await deployment.durable!.settled(); // the boot projection FAILS (typed, never a crash)
    expect(deployment.durable!.lastFailure()?.code).toBe('neon_unreachable');

    for (const surface of [
      { method: 'GET', path: '/v1/projects', query: {} },
      { method: 'POST', path: '/v1/knowledge/query', body: { project: 'prj_x', at: T0 } },
      { method: 'POST', path: '/v1/outcomes/query', body: { project: 'prj_x', at: T0 } },
    ] as const) {
      const response = deployment.service.handle({ method: surface.method, path: surface.path, headers: BEARER, ...('query' in surface ? { query: surface.query } : {}), ...('body' in surface ? { body: surface.body } : {}) });
      expect(response.status, surface.path).toBe(503);
      expect((response.body as { error: { code: string; message: string } }).error.message, surface.path).toContain('neon_unreachable');
    }
    expect(deployment.service.handle({ method: 'GET', path: '/v1/meta', headers: BEARER }).status).toBe(200); // everything else works
    // The host-owned goal read answers the SAME typed degradation (R46).
    const goal = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj_x/goal', headers: BEARER }));
    expect(goal.status).toBe(503);
    expect((goal.body as { error: { code: string } }).error.code).toBe('unavailable');

    outage.setOutage(false); // Neon recovers — the per-request retry re-projects
    await deployment.durable!.settled();
    const listed = deployment.service.handle({ method: 'GET', path: '/v1/projects', headers: BEARER, query: {} });
    expect(listed.status).toBe(200);
    expect(((listed.body as { data: { items: readonly unknown[] } }).data).items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (e) THE BOOT HYDRATION ORDER + COMPLETENESS
// ---------------------------------------------------------------------------

describe('deploy/vercel — the durable seam: the boot hydration order + completeness', () => {
  it("the projection reads the registry FIRST, replays each project's event log, then hydrates the knowledge/outcomes of the RECONSTRUCTED projects only (the report is the observable)", async () => {
    const providers = fakeProviders();
    const direct = storesOver(providers.fetchLike);

    // A reconstructable project: record + goal set + events + knowledge + outcome + post-mortem.
    const goal = validGoal(TENANT);
    const constraintSet = validConstraintSet(TENANT);
    const record = { id: 'prj-hydrated', tenantId: TENANT, name: 'the hydrated desk', executionMode: 'simulation', lifecycle: { projectId: 'prj-hydrated', status: 'draft', acceptanceCriteriaId: 'ac:x', organizationRef: null }, lineage: { projectId: 'prj-hydrated', goal: { goalId: 'goal-tenant-durable', version: 1 }, constraintSet: { id: 'cs-tenant-durable', version: 1 } }, createdAt: T0, updatedAt: T0 };
    expect((await direct.project.putProjectRecord(TENANT, record)).ok).toBe(true);
    expect((await direct.project.putGoalSet(TENANT, 'prj-hydrated', { goal, constraintSet })).ok).toBe(true);
    expect((await direct.project.appendProjectEvent({ tenant: TENANT, projectId: 'prj-hydrated', event: 'organization-bound', at: T0 + 1, detail: { organizationRef: 'org:hydrated' } })).ok).toBe(true);
    const knowledgeEnvelope = { record: { knowledgeId: 'fkr:hydrate-1', ordinal: 1, tenant: TENANT, project: 'prj-hydrated', claim: { kind: 'decision_pattern', polarity: 'harmful', dimension: 'timing', lagBand: null }, confidence: '0.8', evidenceCount: 1, provenance: {}, validity: {}, asOf: T0 - 1, priorChainHead: 'genesis' }, status: 'active' as const, supersededBy: null };
    expect((await direct.firmMemory.putKnowledge(TENANT, knowledgeEnvelope)).ok).toBe(true);
    const outcomeRecord = { outcomeId: 'ocm:hydrate-1', ordinal: 1, tenant: TENANT, project: 'prj-hydrated', decision: { decisionRef: 'xd:1', intentRef: 'si:1', disposition: 'filled' }, outcomeClass: 'adverse_gap', expectation: {}, realization: {}, deviation: {}, evidence: [], lineage: {}, asOf: T0, priorChainHead: 'genesis' };
    expect((await direct.outcomeLearning.putOutcome(TENANT, outcomeRecord)).ok).toBe(true);
    const postMortemRecord = { postMortemId: 'pmr:hydrate-1', ordinal: 1, tenant: TENANT, project: 'prj-hydrated', subject: {}, expected: {}, happened: {}, gap: {}, hypotheses: [], evidence: [], lineage: { tenant: TENANT, project: 'prj-hydrated' }, asOf: T0, priorChainHead: 'genesis' };
    expect((await direct.outcomeLearning.putPostMortem(TENANT, postMortemRecord)).ok).toBe(true);

    // An ORPHAN record (no durable goal set — it cannot reconstruct) whose
    // knowledge must NOT hydrate (the registry-first order law's observable),
    // and a FOREIGN tenant's knowledge row (L12 — never served).
    const orphan = { ...record, id: 'prj-orphan', lifecycle: { ...record.lifecycle, projectId: 'prj-orphan' }, lineage: { ...record.lineage, projectId: 'prj-orphan' } };
    expect((await direct.project.putProjectRecord(TENANT, orphan)).ok).toBe(true);
    expect((await direct.firmMemory.putKnowledge(TENANT, { record: { ...knowledgeEnvelope.record, knowledgeId: 'fkr:orphan-1', project: 'prj-orphan' }, status: 'active', supersededBy: null })).ok).toBe(true);
    expect((await direct.firmMemory.putKnowledge('tenant-foreign', { record: { ...knowledgeEnvelope.record, knowledgeId: 'fkr:foreign-1', tenant: 'tenant-foreign', project: 'prj-hydrated' }, status: 'active', supersededBy: null })).ok).toBe(true);

    const deployment = composeInstance(durableSource(), providers.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    await deployment.durable!.settled();
    expect(deployment.durable!.lastProjection()).toEqual({
      projects: 1,
      events: 1,
      knowledge: 1,
      outcomes: 1,
      postMortems: 1,
      skipped: [{ project: 'prj-orphan', reason: 'no durable goal set (the record cannot reconstruct through the real control plane)' }],
    });

    // The reconstructed project's world serves through the real routes.
    const knowledge = deployment.service.handle({ method: 'POST', path: '/v1/knowledge/query', headers: BEARER, body: { project: 'prj-hydrated', at: T0 + 10_000 } });
    expect(knowledge.status).toBe(200);
    expect(((knowledge.body as { data: { items: readonly { record: { knowledgeId: string } }[] } }).data).items.map((entry) => entry.record.knowledgeId)).toEqual(['fkr:hydrate-1']);
    const outcomes = deployment.service.handle({ method: 'POST', path: '/v1/outcomes/query', headers: BEARER, body: { project: 'prj-hydrated', at: T0 + 10_000 } });
    expect(outcomes.status).toBe(200);
    expect(((outcomes.body as { data: { items: readonly { outcomeId: string }[] } }).data).items.map((entry) => entry.outcomeId)).toEqual(['ocm:hydrate-1']);
    const mortems = deployment.service.handle({ method: 'POST', path: '/v1/post-mortems/query', headers: BEARER, body: { project: 'prj-hydrated', at: T0 + 10_000 } });
    expect(mortems.status).toBe(200);
    expect(((mortems.body as { data: { items: readonly { postMortemId: string }[] } }).data).items.map((entry) => entry.postMortemId)).toEqual(['pmr:hydrate-1']);

    // The orphan's knowledge NEVER serves (the project did not reconstruct);
    // the reconstructed project's org binding replayed through the real binder.
    const orphanKnowledge = deployment.service.handle({ method: 'POST', path: '/v1/knowledge/query', headers: BEARER, body: { project: 'prj-orphan', at: T0 + 10_000 } });
    expect(orphanKnowledge.status).toBe(200);
    expect(((orphanKnowledge.body as { data: { items: readonly unknown[] } }).data).items).toEqual([]);
    const one = deployment.service.handle({ method: 'GET', path: '/v1/projects/prj-hydrated', headers: BEARER });
    expect(one.status).toBe(200);
    expect(((one.body as { data: { lifecycle: { organizationRef: string | null } } }).data).lifecycle.organizationRef).toBe('org:hydrated');
    // The point-in-time law (L4): a knowledge query BEFORE the record's asOf serves nothing.
    const early = deployment.service.handle({ method: 'POST', path: '/v1/knowledge/query', headers: BEARER, body: { project: 'prj-hydrated', at: T0 - 10_000 } });
    expect(((early.body as { data: { items: readonly unknown[] } }).data).items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (f) THE DEMO PATH STAYS BYTE-IDENTICAL (the seam activates only on durable)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the durable seam: the demo path stays byte-identical', () => {
  it('no durable keys => the DEMO backing (the seam never builds); an explicit demo override wins even with Neon keys present', () => {
    const providers = fakeProviders();
    const demoDefault = composeInstance({ [API_ENV_KEYS.apiDeveloperToken]: TOKEN, [API_ENV_KEYS.apiDeveloperTenant]: TENANT, [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL }, providers.fetchLike);
    expect(demoDefault.ok).toBe(true);
    if (!demoDefault.ok) return;
    expect(demoDefault.backing).toBe('demo');
    expect(demoDefault.durable).toBeNull();
    expect(demoDefault.demo).not.toBeNull();
    const listed = demoDefault.service.handle({ method: 'GET', path: '/v1/projects', headers: BEARER, query: {} });
    expect(listed.status).toBe(200);
    expect(((listed.body as { data: { items: readonly { id: string }[] } }).data).items.map((project) => project.id)).toEqual(['prj-demo-console']); // the seeded demo world, byte-identical

    const demoExplicit = composeInstance(durableSource({ TRADRL_DEPLOY_BACKING: 'demo' }), providers.fetchLike);
    expect(demoExplicit.ok).toBe(true);
    if (!demoExplicit.ok) return;
    expect(demoExplicit.backing).toBe('demo');
    expect(demoExplicit.durable).toBeNull(); // the explicit override wins — the seam never activates
    const explicitListed = demoExplicit.service.handle({ method: 'GET', path: '/v1/projects', headers: BEARER, query: {} });
    expect(((explicitListed.body as { data: { items: readonly { id: string }[] } }).data).items.map((project) => project.id)).toEqual(['prj-demo-console']);
  });
});

// ---------------------------------------------------------------------------
// (g) THE GOAL READ UNDER THE DURABLE BACKING (the host-owned route)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the durable seam: the goal read route', () => {
  it("the hydrated goal set serves (200, the create-project input's own records); unknown projects answer the typed 404; authn runs first (401); the execution blotter path falls through to the boundary (404)", async () => {
    const providers = fakeProviders();
    const deployment = composeInstance(durableSource(), providers.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    await deployment.durable!.settled();
    const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-goal-route') }));
    expect(created.status).toBe(201);

    const goal = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-goal-route/goal', headers: BEARER }));
    expect(goal.status).toBe(200);
    const goalBody = (goal.body as { data: { goal: unknown; constraintSet: unknown } }).data;
    expect(goalBody.goal).toEqual(validGoal(TENANT));
    expect(goalBody.constraintSet).toEqual(validConstraintSet(TENANT));

    const unknown = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-unknown/goal', headers: BEARER }));
    expect(unknown.status).toBe(404);
    expect((unknown.body as { error: { code: string } }).error.code).toBe('not_found');
    const unauthenticated = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-goal-route/goal' }));
    expect(unauthenticated.status).toBe(401);
    // The execution blotter is demo-substance only — under durable it falls
    // through to the frozen boundary (the typed not_found, the pre-W-8 behavior).
    const blotter = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/execution/submissions?project=prj-goal-route', headers: BEARER }));
    expect(blotter.status).toBe(404);
    expect((blotter.body as { error: { code: string } }).error.code).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// (h) THE W-26B ACTIVATION — the durable resolution as a SUPERSET of demo
// ---------------------------------------------------------------------------

describe('deploy/vercel — the W-26B activation: the launch journey under durable (J3, end-to-end through the full function handler)', () => {
  it('create 201 -> job submit 202 -> the machinery tick advances submitted -> running -> complete with the release-candidate result (fake timers: the tick instants are deterministic)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();
      const deployment = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(deployment.ok).toBe(true);
      if (!deployment.ok) return;
      expect(deployment.durable).not.toBeNull();
      expect(deployment.durable!.tick).not.toBeNull(); // the internal credential is configured — the machinery runs

      // The launch journey (the console's flow), every step through the FULL
      // function handler. The first request also pays the W-26B boot world
      // (the demo project seeds into Neon — the superset floor).
      const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-j3-launch') }));
      expect(created.status).toBe(201);
      const kickoff = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:w26b:j3:kickoff' }, body: { kind: 'research', projectId: 'prj-j3-launch', spec: { source: 'w26b-j3-test' } } }));
      expect(kickoff.status).toBe(202); // R1: the job-submission port is the SAME simulated engine demo composes
      const kickoffJob = (kickoff.body as { data: { jobId: string; status: string } }).data;
      expect(kickoffJob.status).toBe('submitted');

      // Mid-flight: the tick at +4s renders the job RUNNING.
      vi.setSystemTime(T0 + 4_000);
      await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      const running = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/jobs/${kickoffJob.jobId}`, headers: BEARER }));
      expect(running.status).toBe(200);
      expect(((running.body as { data: { status: string } }).data).status).toBe('running');

      // Completion: the tick at +10s renders the job COMPLETE with the
      // release-candidate result (the research kind's own result shape).
      vi.setSystemTime(T0 + 10_000);
      await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      const complete = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/jobs/${kickoffJob.jobId}`, headers: BEARER }));
      expect(complete.status).toBe(200);
      const finished = (complete.body as { data: { status: string; result: { kind: string; specId: string; project: string } } }).data;
      expect(finished.status).toBe('complete');
      expect(finished.result).toEqual({ kind: 'release-candidate', specId: 'spec-demo-director', version: 1, project: 'prj-j3-launch' });

      // The whole launch PERSISTED (D-5): the registry row + goal set exist.
      const direct = storesOver(providers.fetchLike);
      const record = await direct.project.getProjectRecord(TENANT, 'prj-j3-launch');
      expect(record.ok).toBe(true);
      // And the user-launched project's org compiled through the tick (the
      // R4 pass over the hydrated control plane) — the bind persisted.
      const bound = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-j3-launch', headers: BEARER }));
      expect(((bound.body as { data: { lifecycle: { organizationRef: string | null } } }).data).lifecycle.organizationRef).toBe(compiledOrganizationRefOf('prj-j3-launch'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('R1 isolated: the execution gateway routes under durable (the SAME demoExecutionGateway factory) and a job submission answers 202 — the seam-live ports are the simulated engines, not the typed stubs', async () => {
    const providers = fakeProviders();
    const deployment = composeInstance(durableSource(), providers.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    // The first request pays the boot world (the demo project exists for the intent's scope).
    await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
    const execution = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/execution/requests',
      headers: { ...BEARER, 'idempotency-key': 'idem:w26b:execution:1' },
      body: { intent: validStrategyIntent(TENANT, DEMO_PROJECT_ID as never) },
    }));
    expect(execution.status).toBe(200);
    const routed = (execution.body as { data: { kind: string; venue: string; submissionId: string } }).data;
    expect(routed.kind).toBe('routed'); // the demo gateway's own record shape (the fixture's routedSubmission)
    expect(routed.venue).toBe('BROKER-FIX');
    // NOTE (the R1/R6 resolution, disclosed in the PR): under the seam-LIVE
    // durable resolution the job-submission port is the SAME simulated
    // engine the demo backing composes (imported — the J3 launch journey
    // must hold under durable: the superset law). The matrix's Apify rows
    // (typed absent / pending) keep governing the seam-NOT-built state and
    // the host-owned ingestion lanes.
    const job = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:w26b:jobs:1' }, body: { kind: 'research', projectId: DEMO_PROJECT_ID, spec: {} } }));
    expect(job.status).toBe(202);
  });
});

describe('deploy/vercel — the W-26B activation: the demo world under durable (the two-boot law)', () => {
  it('fresh durable boot -> the demo project + goal + org binding + org status + the fixture substance serve; second boot -> the registry guard skips the create, the jobs re-seed per instance, the substance hydrates from the store rows', async () => {
    const providers = fakeProviders();
    const counting = insertCountingFetch(providers.fetchLike);

    // INSTANCE 1 (the fresh database): the first request runs the boot world.
    const first = composeInstance(durableSourceWithMachinery(), counting.fetchLike);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const listed = await drive(first, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));
    expect(listed.status).toBe(200);
    expect((((listed.body as { data: { items: readonly { id: string }[] } }).data).items).map((project) => project.id)).toEqual([DEMO_PROJECT_ID]);

    // The demo project serves with its world: the goal (the host route, the
    // hydrated records), the org binding, the org status (the seed's report).
    const goal = await drive(first, streamingRequest({ method: 'GET', url: `/v1/projects/${DEMO_PROJECT_ID}/goal`, headers: BEARER }));
    expect(goal.status).toBe(200);
    expect((goal.body as { data: { goal: unknown; constraintSet: unknown } }).data).toEqual({ goal: demoGoalStatement(TENANT), constraintSet: demoConstraintSet(TENANT) });
    const one = await drive(first, streamingRequest({ method: 'GET', url: `/v1/projects/${DEMO_PROJECT_ID}`, headers: BEARER }));
    expect(((one.body as { data: { lifecycle: { organizationRef: string | null } } }).data).lifecycle.organizationRef).toBe(DEMO_ORGANIZATION_REF);
    const orgStatus = await drive(first, streamingRequest({ method: 'GET', url: `/v1/organizations/${DEMO_ORGANIZATION_REF}/status?project=${encodeURIComponent(DEMO_PROJECT_ID)}`, headers: BEARER }));
    expect(orgStatus.status).toBe(200);
    expect(((orgStatus.body as { data: { status: string; project: string } }).data).status).toBe('active');

    // The fixture substance serves through the REAL read routes (the boot
    // world wrote the fixture rows into the Neon stores; the projection
    // serves them like any durable row).
    const knowledge = await drive(first, streamingRequest({ method: 'POST', url: '/v1/knowledge/query', headers: BEARER, body: { project: DEMO_PROJECT_ID, at: T0 + 10_000 } }));
    expect(knowledge.status).toBe(200);
    const knowledgeItems = ((knowledge.body as { data: { items: readonly { record: { knowledgeId: string } }[] } }).data).items;
    expect(knowledgeItems.map((entry) => entry.record.knowledgeId)).toEqual(fixtureKnowledge(TENANT, DEMO_PROJECT_ID).map((entry) => entry.record.knowledgeId));
    const outcomes = await drive(first, streamingRequest({ method: 'POST', url: '/v1/outcomes/query', headers: BEARER, body: { project: DEMO_PROJECT_ID, at: T0 + 10_000 } }));
    expect((((outcomes.body as { data: { items: readonly { outcomeId: string }[] } }).data).items).map((entry) => entry.outcomeId)).toEqual(['out:demo0001']);
    const mortems = await drive(first, streamingRequest({ method: 'POST', url: '/v1/post-mortems/query', headers: BEARER, body: { project: DEMO_PROJECT_ID, at: T0 + 10_000 } }));
    expect((((mortems.body as { data: { items: readonly { postMortemId: string }[] } }).data).items).map((entry) => entry.postMortemId)).toEqual(['pmr:demo0001']);

    // The seeded jobs exist in the API-owned per-instance store (submitted —
    // the tick's schedule has not elapsed for them yet).
    const firstJobs = first.service.jobs().filter((job) => job.project === DEMO_PROJECT_ID);
    expect(firstJobs.map((job) => job.kind).sort()).toEqual(['learning', 'research']);
    expect(firstJobs.every((job) => job.status === 'submitted')).toBe(true);

    // The store rows after the first boot (the write-through + the fixture boot-writes).
    const direct = storesOver(providers.fetchLike);
    const registryRows = await direct.project.projectRecordsOf(TENANT);
    expect(registryRows.ok).toBe(true);
    if (registryRows.ok) expect(registryRows.value.filter((row) => (row as { id: string }).id === DEMO_PROJECT_ID)).toHaveLength(1);
    const insertsAfterFirstBoot = counting.inserts();

    // INSTANCE 2 (the cold start, the same database): the registry guard
    // skips the create; the jobs re-seed per instance; the substance
    // hydrates from the store rows; the org status serves (the R7
    // post-cold-start snapshot re-report — the watch store is per-instance).
    const second = composeInstance(durableSourceWithMachinery(), counting.fetchLike);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const relisted = await drive(second, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));
    expect(relisted.status).toBe(200);
    expect((((relisted.body as { data: { items: readonly { id: string }[] } }).data).items).map((project) => project.id)).toEqual([DEMO_PROJECT_ID]);
    // THE REGISTRY GUARD: exactly ONE demo project row (no duplicate create
    // — the guard skipped it), and the second boot issued NO new writes.
    const registryAgain = await direct.project.projectRecordsOf(TENANT);
    expect(registryAgain.ok).toBe(true);
    if (registryAgain.ok) expect(registryAgain.value.filter((row) => (row as { id: string }).id === DEMO_PROJECT_ID)).toHaveLength(1);
    expect(counting.inserts()).toBe(insertsAfterFirstBoot); // the idempotency pin: the second boot wrote NOTHING new
    // The jobs re-seeded per instance (a fresh service's own store).
    const secondJobs = second.service.jobs().filter((job) => job.project === DEMO_PROJECT_ID);
    expect(secondJobs.map((job) => job.kind).sort()).toEqual(['learning', 'research']);
    // The substance hydrates from the store rows the first boot wrote.
    const knowledgeAgain = await drive(second, streamingRequest({ method: 'POST', url: '/v1/knowledge/query', headers: BEARER, body: { project: DEMO_PROJECT_ID, at: T0 + 10_000 } }));
    expect((((knowledgeAgain.body as { data: { items: readonly { record: { knowledgeId: string } }[] } }).data).items).map((entry) => entry.record.knowledgeId)).toEqual(fixtureKnowledge(TENANT, DEMO_PROJECT_ID).map((entry) => entry.record.knowledgeId));
    const outcomesAgain = await drive(second, streamingRequest({ method: 'POST', url: '/v1/outcomes/query', headers: BEARER, body: { project: DEMO_PROJECT_ID, at: T0 + 10_000 } }));
    expect((((outcomesAgain.body as { data: { items: readonly { outcomeId: string }[] } }).data).items).map((entry) => entry.outcomeId)).toEqual(['out:demo0001']);
    const mortemsAgain = await drive(second, streamingRequest({ method: 'POST', url: '/v1/post-mortems/query', headers: BEARER, body: { project: DEMO_PROJECT_ID, at: T0 + 10_000 } }));
    expect((((mortemsAgain.body as { data: { items: readonly { postMortemId: string }[] } }).data).items).map((entry) => entry.postMortemId)).toEqual(['pmr:demo0001']);
    // The org status serves on the fresh instance (the R7 re-report through
    // the real private route — the per-instance watch store was empty).
    const orgStatusAgain = await drive(second, streamingRequest({ method: 'GET', url: `/v1/organizations/${DEMO_ORGANIZATION_REF}/status?project=${encodeURIComponent(DEMO_PROJECT_ID)}`, headers: BEARER }));
    expect(orgStatusAgain.status).toBe(200);
    expect(((orgStatusAgain.body as { data: { status: string; project: string; organizationRef: string } }).data).organizationRef).toBe(DEMO_ORGANIZATION_REF);
  });
});

describe('deploy/vercel — the W-26B activation: the machinery tick under durable (the org compile + the Home org surface)', () => {
  it('a user-launched project compiles through the tick (the R4 pass over the hydrated control plane); the bind PERSISTS; the org-status surface serves across cold starts (the R7 re-report for hydrated bindings)', async () => {
    const providers = fakeProviders();
    const deployment = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    // The first request pays the boot world (the demo project seeds).
    await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
    // The launch: create + the kickoff job (the console's flow). The create's
    // `at` is a PAST instant — the real control plane's monotonic audit law
    // requires every later bind's at >= the record's updatedAt.
    const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-durable-compile', Date.now() - 60_000) }));
    expect(created.status).toBe(201);
    // BEFORE any tick compiled it: the durable event log holds NO binding
    // for the project (the create landed only the registry row + goal set;
    // the create request's own tick ran BEFORE the create existed).
    const direct = storesOver(providers.fetchLike);
    const eventsBefore = await direct.project.projectEventsOf(TENANT, 'prj-durable-compile');
    expect(eventsBefore.ok).toBe(true);
    if (eventsBefore.ok) expect(eventsBefore.value.filter((event) => event.event === 'organization-bound')).toEqual([]);
    const kickoff = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:w26b:compile:job' }, body: { kind: 'research', projectId: 'prj-durable-compile', spec: {} } }));
    expect(kickoff.status).toBe(202);

    // The kickoff request's tick compiled the org (the bind through the real
    // public route + the watch snapshot through the real private route) —
    // the NEXT request's response serves the BOUND project.
    const bound = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-durable-compile', headers: BEARER }));
    expect(((bound.body as { data: { lifecycle: { organizationRef: string | null } } }).data).lifecycle.organizationRef).toBe(compiledOrganizationRefOf('prj-durable-compile'));
    // The Home org surface: the org-status read serves the compiled team's snapshot.
    const status = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/organizations/${compiledOrganizationRefOf('prj-durable-compile')}/status?project=${encodeURIComponent('prj-durable-compile')}`, headers: BEARER }));
    expect(status.status).toBe(200);
    const snapshot = (status.body as { data: { tenant: string; project: string; status: string; instanceRefs: readonly string[] } }).data;
    expect(snapshot.status).toBe('active');
    expect(snapshot.tenant).toBe(TENANT);
    expect(snapshot.instanceRefs).toEqual(['ai:director-1', 'ai:researcher-2']);
    // The bind PERSISTED (the event log — the W-25D write-through law).
    const events = await direct.project.projectEventsOf(TENANT, 'prj-durable-compile');
    expect(events.ok).toBe(true);
    if (events.ok) expect(events.value.map((event) => event.event)).toContain('organization-bound');

    // THE COLD START: a fresh instance's projection serves the launched
    // project WITH its binding, and the R7 pass re-reports the org-status
    // snapshot (the per-instance watch store was empty).
    const second = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const relisted = await drive(second, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));
    expect(relisted.status).toBe(200);
    const items = ((relisted.body as { data: { items: readonly { id: string; lifecycle: { organizationRef: string | null } }[] } }).data).items;
    // THE FULL WORLD survives the cold start (the W-26B superset): the demo
    // project (the boot world's seed, once per database) AND the
    // user-launched project, both with their bindings, creation order.
    expect(items.map((project) => project.id)).toEqual([DEMO_PROJECT_ID, 'prj-durable-compile']);
    const relaunched = items.find((project) => project.id === 'prj-durable-compile');
    expect(relaunched?.lifecycle.organizationRef).toBe(compiledOrganizationRefOf('prj-durable-compile')); // the binding rehydrated
    // The demo substance rehydrates too (the store rows the first boot wrote).
    const knowledgeCold = await drive(second, streamingRequest({ method: 'POST', url: '/v1/knowledge/query', headers: BEARER, body: { project: DEMO_PROJECT_ID, at: T0 + 10_000 } }));
    expect((((knowledgeCold.body as { data: { items: readonly { record: { knowledgeId: string } }[] } }).data).items).map((entry) => entry.record.knowledgeId)).toEqual(fixtureKnowledge(TENANT, DEMO_PROJECT_ID).map((entry) => entry.record.knowledgeId));
    const statusAgain = await drive(second, streamingRequest({ method: 'GET', url: `/v1/organizations/${compiledOrganizationRefOf('prj-durable-compile')}/status?project=${encodeURIComponent('prj-durable-compile')}`, headers: BEARER }));
    expect(statusAgain.status).toBe(200); // the R7 re-report — the DEGRADED-post-reload behavior is gone under the activation
    expect(((statusAgain.body as { data: { status: string } }).data).status).toBe('active');
  });
});

describe('deploy/vercel — the W-26B activation: the boot-world failure law + the request\'s own drain law', () => {
  it('a failed boot-world write: the first serve degrades typed (503, the durable failure\'s code, unconfirmed), the retry keeps degrading while Neon is down, and the recovery heals (the seeded world serves)', async () => {
    const providers = fakeProviders();
    const outage = outageFetch(providers.fetchLike);
    const deployment = composeInstance(durableSource(), outage.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    await deployment.durable!.settled(); // the boot projection over the empty store (Neon up)

    outage.setOutage(true); // Neon goes down before the first request
    const first = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));
    expect(first.status).toBe(503);
    const error = (first.body as { error: { code: string; message: string } }).error;
    expect(error.code).toBe('unavailable');
    expect(error.message).toContain('neon_unreachable');
    expect(error.message).toContain('unconfirmed');
    // The retry (still down): the latch cleared — the boot world retried and degraded again.
    const second = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));
    expect(second.status).toBe(503);
    // The recovery: the next request's retry lands the whole boot world.
    outage.setOutage(false);
    const healed = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));
    expect(healed.status).toBe(200);
    expect((((healed.body as { data: { items: readonly { id: string }[] } }).data).items).map((project) => project.id)).toEqual([DEMO_PROJECT_ID]);
  });

  it('the request\'s OWN drain failure keeps the W-25D law under a latched boot world: the typed 503 replaces the boundary\'s answer with the SAME request id (the mutation is unconfirmed)', async () => {
    const providers = fakeProviders();
    const outage = outageFetch(providers.fetchLike);
    const deployment = composeInstance(durableSource(), outage.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    // The first request pays a HEALTHY boot world (the demo project seeds).
    const boot = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));
    expect(boot.status).toBe(200);

    outage.setOutage(true); // Neon goes down MID-INSTANCE, after the boot world latched
    const response = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-unconfirmed-own') }));
    expect(response.status).toBe(503);
    const error = (response.body as { requestId: unknown; error: { code: string; message: string } }).error;
    expect(error.code).toBe('unavailable');
    expect(error.message).toContain('neon_unreachable');
    expect(error.message).toContain('unconfirmed');
    expect((response.body as { requestId: unknown }).requestId).toBe(response.headers['x-request-id']); // the SAME request id the boundary minted (a real one this time)
    // The demo world SURVIVES the failed write (the re-projection keeps the
    // confirmed durable truth; only the unconfirmed create is wiped).
    outage.setOutage(false);
    await deployment.durable!.settled();
    const relisted = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));
    expect(relisted.status).toBe(200);
    expect((((relisted.body as { data: { items: readonly { id: string }[] } }).data).items).map((project) => project.id)).toEqual([DEMO_PROJECT_ID]);
  });
});

describe('deploy/vercel — the W-26B activation: the degraded matrix unchanged (Neon absent — the gateway/seed/tick NEVER run)', () => {
  it('an explicit durable backing without Neon keys: the router-driven surfaces answer the typed stubs and the provider is NEVER touched (0 Neon calls — no projection, no seed, no tick)', async () => {
    const providers = fakeProviders();
    const counting = insertCountingFetch(providers.fetchLike);
    const deployment = composeInstance({ [API_ENV_KEYS.apiDeveloperToken]: TOKEN, [API_ENV_KEYS.apiDeveloperTenant]: TENANT, [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL, TRADRL_DEPLOY_BACKING: 'durable' }, counting.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    expect(deployment.backing).toBe('durable');
    expect(deployment.durable).toBeNull(); // the seam is not built — no activation exists
    // The router-driven path: the Neon-backed surfaces degrade typed, the
    // gateway keeps the pending stub, jobs follow the matrix for Apify.
    const projects = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));
    expect(projects.status).toBe(503);
    expect((projects.body as { error: { message: string } }).error.message).toContain('deploy_adapter_absent');
    const execution = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/execution/requests', headers: { ...BEARER, 'idempotency-key': 'idem:w26b:absent:exec' }, body: { intent: validStrategyIntent(TENANT, 'prj_x' as never) } }));
    expect((execution.body as { error: { message: string } }).error.message).toContain(DEPLOY_ADAPTER_PENDING);
    const job = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:w26b:absent:job' }, body: { kind: 'research', projectId: 'prj_x', spec: {} } }));
    expect((job.body as { error: { message: string } }).error.message).toContain('deploy_adapter_absent');
    expect((await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }))).status).toBe(200); // everything else works
    // THE ACTIVATION NEVER RAN: not a single Neon statement crossed the wire
    // (no boot projection, no seed write, no fixture write, no tick write).
    expect(counting.inserts()).toBe(0);
    expect(providers.seen.neon).toBe(0);
  });
});
