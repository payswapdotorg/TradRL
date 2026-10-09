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
import { NeonFirmMemoryStore, NeonJobStore, NeonOutcomeLearningStore, NeonProjectStore, type NeonStoreDeps } from '../adapters/neon/stores';
import type { NeonConfig } from '../adapters/neon/client';
import type { FetchLike } from '../adapters/shared';
import { fixtureKnowledge, validConstraintSet, validGoal, validStrategyIntent } from '../../services/api/src/fixtures';
import { DEMO_ORGANIZATION_REF, DEMO_PROJECT_ID, DEMO_SEED_JOB_COMPLETED_AT, DEMO_SEED_JOB_SUBMITTED_AT, compiledOrganizationRefOf, demoConstraintSet, demoGoalStatement, demoSeedJobRecord } from './runtime/demo';
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
    expect(first.durable!.lastProjection()).toEqual({ projects: 0, events: 0, knowledge: 0, outcomes: 0, postMortems: 0, jobs: 0, skipped: [] });

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
    expect(second.durable!.lastProjection()).toEqual({ projects: 1, events: 2, knowledge: 0, outcomes: 0, postMortems: 0, jobs: 0, skipped: [] });
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
      jobs: 0,
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
    // The execution blotter now SERVES under durable too (W-26C, R4 — the
    // same fold the demo arm serves, over the composition's per-instance
    // stores): the pre-W-26C fallthrough 404 is retired. A project with no
    // gateway submissions answers an honest EMPTY page (never a leak).
    const blotter = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/execution/submissions?project=prj-goal-route', headers: BEARER }));
    expect(blotter.status).toBe(200);
    expect(((blotter.body as { data: { items: readonly unknown[] } }).data).items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE LAUNCH WORLD CAPTURE (D-8, W-28): the Market World section was bound to
// the console's IN-SESSION launch draft, so after a reload (or a cold start)
// it rendered its teaching empty state FOREVER for every launched project
// (the re-run's ONLY project blocker). The durable fix: the kickoff job's
// OPAQUE spec (the only console->host carrier the frozen contracts leave room
// for — the create-project parser keeps exactly its own six fields) carries
// the world; the seam's job port CAPTURES it structurally at submission and
// MERGES it into the goal-set row's opaque payload (tradrl_project_goals —
// no schema change), where it rehydrates at every cold start and the
// host-owned goal route serves it back as the bundle's ADDITIVE `world`
// field.
// ---------------------------------------------------------------------------

/** The console's kickoff-job spec (apps/web toLaunchJobSpec's shape — the world fields + the launch context). */
function consoleLaunchSpec(): Record<string, unknown> {
  return {
    kind: 'console-launch',
    objective: 'Find and keep an edge in momentum.',
    horizon: { startsAt: T0, endsAt: T0 + 2_592_000_000, label: 'the launch window' },
    capitalBudget: '500000.00',
    riskBudget: '40000.00',
    markets: ['BTC-USD', 'ETH-USD'],
    venues: ['binance', 'kraken'],
    dataSources: ['candle-v1', 'depth-v1'],
    executionMode: 'simulation',
    preferences: [{ key: 'rebalance', value: 'daily' }],
  };
}

/** The extracted world the backings persist + serve (the world fields only — deploy/vercel's launchWorldOfSpec law). */
function extractedWorld(): Record<string, unknown> {
  return {
    markets: ['BTC-USD', 'ETH-USD'],
    venues: ['binance', 'kraken'],
    dataSources: ['candle-v1', 'depth-v1'],
    executionMode: 'simulation',
    capitalBudget: '500000.00',
    riskBudget: '40000.00',
    horizon: { startsAt: T0, endsAt: T0 + 2_592_000_000, label: 'the launch window' },
  };
}

describe('deploy/vercel — the durable seam: the launch world capture (D-8, W-28)', () => {
  it('the launch story: create + a console-launch kickoff job -> the goal-set row carries the MERGED world, the goal route serves it as the ADDITIVE field, and a COLD START rehydrates it (the reload/cold-start path, closed)', async () => {
    const providers = fakeProviders();
    // Count ONLY the goal-set upserts (the world-merge write's own lane — the job rows' writes are a different table and must not pollute the count).
    let goalSetInserts = 0;
    const counting: FetchLike = (url, init) => {
      if (typeof init?.body === 'string' && init.body.includes('INSERT INTO tradrl_project_goals')) goalSetInserts += 1;
      return providers.fetchLike(url, init);
    };
    const deployment = composeInstance(durableSource(), counting);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    await deployment.durable!.settled();

    // THE LAUNCH: the create (goal + constraint set), then the kickoff job whose spec carries the world.
    const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-world-desk') }));
    expect(created.status).toBe(201); // the router drained the create's writes (goal set -> record)
    const kickoff = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:w28:kickoff' }, body: { kind: 'research', projectId: 'prj-world-desk', spec: consoleLaunchSpec() } }));
    expect(kickoff.status).toBe(202); // the router drained the world's merge write before serving

    // THE DURABLE ROW: the goal set now carries the MERGED world (the opaque payload's additive field).
    const direct = storesOver(providers.fetchLike);
    const goalSet = await direct.project.goalSetOf(TENANT, 'prj-world-desk');
    expect(goalSet.ok).toBe(true);
    if (goalSet.ok && goalSet.value !== null) {
      expect(goalSet.value.goal).toEqual(validGoal(TENANT));
      expect(goalSet.value.constraintSet).toEqual(validConstraintSet(TENANT));
      expect(goalSet.value.world).toEqual(extractedWorld()); // the captured world, merged into the same row
    }

    // THE GOAL ROUTE: the bundle serves the ADDITIVE `world` field.
    const goal = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-world-desk/goal', headers: BEARER }));
    expect(goal.status).toBe(200);
    const goalBody = (goal.body as { data: { goal: unknown; constraintSet: unknown; world?: unknown } }).data;
    expect(goalBody.goal).toEqual(validGoal(TENANT));
    expect(goalBody.constraintSet).toEqual(validConstraintSet(TENANT));
    expect(goalBody.world).toEqual(extractedWorld());

    // IDEMPOTENCE (the W-27 byte-identical pattern): a re-submission of the
    // SAME world queues NOTHING — the goal-set row is written once (the new
    // job's own tradrl_jobs row is a different table and does not touch this count).
    const insertsAfterFirst = goalSetInserts;
    const resubmitted = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:w28:resubmit' }, body: { kind: 'research', projectId: 'prj-world-desk', spec: consoleLaunchSpec() } }));
    expect(resubmitted.status).toBe(202);
    expect(goalSetInserts).toBe(insertsAfterFirst); // no second goal-set write (the identical world is a no-op)

    // THE COLD START: the projection rehydrates the world from the row, and the goal route serves it on the fresh instance.
    const second = composeInstance(durableSource(), providers.fetchLike);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    await second.durable!.settled();
    const hydrated = second.durable!.goalOf('prj-world-desk');
    expect(hydrated.ok).toBe(true);
    if (hydrated.ok && hydrated.value !== null) expect(hydrated.value.world).toEqual(extractedWorld());
    const coldGoal = await drive(second, streamingRequest({ method: 'GET', url: '/v1/projects/prj-world-desk/goal', headers: BEARER }));
    expect(coldGoal.status).toBe(200);
    expect(((coldGoal.body as { data: { world?: unknown } }).data).world).toEqual(extractedWorld()); // the reloaded console renders the PERSISTED world

    // THE DEMO PROJECT stays world-less (the teaching empty state's scope — preserved by design).
    const demoGoal = await drive(second, streamingRequest({ method: 'GET', url: `/v1/projects/${DEMO_PROJECT_ID}/goal`, headers: BEARER }));
    expect(demoGoal.status).toBe(200);
    expect((demoGoal.body as { data: Record<string, unknown> }).data).not.toHaveProperty('world'); // NO world field — the pre-W-28 serve shape
  });

  it('the capture is STRUCTURAL: a non-console-launch spec (the demo seed\'s own shape) and the DEMO project never capture a world; a hydration replay never re-captures (the spec rides `{ hydrated: true }`)', async () => {
    const providers = fakeProviders();
    const deployment = composeInstance(durableSource(), providers.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    await deployment.durable!.settled();

    // A launched desk whose kickoff job carried a DEMO-SEED-shaped spec (no console-launch kind marker): no world captured.
    await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-world-foreign') }));
    const submitted = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:w28:foreign' }, body: { kind: 'research', projectId: 'prj-world-foreign', spec: { kind: 'demo-seed', note: 'not a console launch', feeds: ['candles:1m'] } } }));
    expect(submitted.status).toBe(202);
    const foreign = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-world-foreign/goal', headers: BEARER }));
    expect(foreign.status).toBe(200);
    expect((foreign.body as { data: Record<string, unknown> }).data).not.toHaveProperty('world'); // a malformed/foreign spec captures nothing (R46)

    // A console-launch job for the DEMO project: the capture's demo-project guard keeps the demo goal world-less.
    const demoJob = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:w28:demo' }, body: { kind: 'research', projectId: DEMO_PROJECT_ID, spec: consoleLaunchSpec() } }));
    expect(demoJob.status).toBe(202);
    const demoGoal = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/projects/${DEMO_PROJECT_ID}/goal`, headers: BEARER }));
    expect(demoGoal.status).toBe(200);
    expect((demoGoal.body as { data: Record<string, unknown> }).data).not.toHaveProperty('world'); // the demo scope's teaching empty state is preserved

    // A hydration replay never re-captures: the boot world replays the durable job through the real
    // POST route with the `{ hydrated: true }` marker spec (never a console-launch one). A second
    // instance's hydration must leave the goal-set rows exactly as they are (no world churn).
    const second = composeInstance(durableSource(), providers.fetchLike);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const booted = await drive(second, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // the first request runs the boot world (the jobs hydration included)
    expect(booted.status).toBe(200);
    const rehydrated = await storesOver(providers.fetchLike).project.goalSetOf(TENANT, 'prj-world-foreign');
    expect(rehydrated.ok).toBe(true);
    if (rehydrated.ok && rehydrated.value !== null) expect(rehydrated.value.world).toBeUndefined(); // still world-less — the replay never captured
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
      const finished = (complete.body as { data: { status: string; result: { kind: string; specId: string; project: string; summary: string; lineage: { promotedDecision: string | null; statement: string }; disclosure: string } } }).data;
      expect(finished.status).toBe('complete');
      // FW-36-A (Round E register E-1): the completion's release candidate is
      // the COMPOSED deliverable — additive on the stub's preserved shape,
      // with the composed summary + honest lineage + SIMULATED disclosure.
      // This launch (a research spec that is not a console-launch spec) has
      // no captured world: the summary's world sentence is the honest
      // no-launch-world statement naming THIS project, never the old stub.
      expect(finished.result.kind).toBe('release-candidate');
      expect(finished.result.specId).toBe('spec-launch-director'); // the per-project launch director
      expect(finished.result.project).toBe('prj-j3-launch');
      expect(finished.result.summary).toContain('no launch world on record for prj-j3-launch');
      expect(finished.result.lineage.promotedDecision).toBeNull(); // pending promotion — the honest composition-instant truth
      expect(finished.result.disclosure).toContain('SIMULATED');

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

    // The seeded jobs exist in the API-owned per-instance store — and
    // (FW-31-B) they are the DETERMINISTIC pair: the demo-epoch submittedAt
    // means the first request's tick already completed them at their fixed
    // completion instant (the pre-fix re-seed minted fresh ids per boot
    // instant and left them 'submitted' — the rotating job list, closed).
    const firstJobs = first.service.jobs().filter((job) => job.project === DEMO_PROJECT_ID);
    expect(firstJobs.map((job) => job.kind).sort()).toEqual(['learning', 'research']);
    expect(firstJobs.every((job) => job.status === 'complete')).toBe(true);
    const seedByKind = new Map(firstJobs.map((job) => [job.kind as string, job]));
    expect(seedByKind.get('research')).toMatchObject({ jobId: demoSeedJobRecord(TENANT, 'research').jobId, status: 'complete', submittedAt: DEMO_SEED_JOB_SUBMITTED_AT, completedAt: DEMO_SEED_JOB_COMPLETED_AT });
    expect(seedByKind.get('learning')).toMatchObject({ jobId: demoSeedJobRecord(TENANT, 'learning').jobId, status: 'complete', submittedAt: DEMO_SEED_JOB_SUBMITTED_AT, completedAt: DEMO_SEED_JOB_COMPLETED_AT });

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
    // The jobs re-seeded per instance (a fresh service's own store) — and
    // (FW-31-B) the re-seed is idempotent IN IDENTITY: the second instance
    // carries the BYTE-IDENTICAL pair (same ids, same submittedAt, same
    // deterministic completion) — the pre-fix rotation (fresh ids + fresh
    // timestamps per instance) is closed.
    const secondJobs = second.service.jobs().filter((job) => job.project === DEMO_PROJECT_ID);
    expect(secondJobs.map((job) => job.kind).sort()).toEqual(['learning', 'research']);
    expect(secondJobs.map((job) => ({ jobId: job.jobId, submittedAt: job.submittedAt, status: job.status, completedAt: job.completedAt }))).toEqual(
      firstJobs.map((job) => ({ jobId: job.jobId, submittedAt: job.submittedAt, status: job.status, completedAt: job.completedAt })),
    );
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

// ---------------------------------------------------------------------------
// THE W-26C DURABLE DEMO-SUBSTANCE ROUTES (R4 — D-3 + the blotter under
// durable: the same folds, the same auth, the same envelope as the demo arm)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the W-26C durable demo-substance routes (R4)', () => {
  it('GET /v1/jobs?project= serves the re-seeded demo jobs + a user-launched project\'s jobs — D-3 preserved under durable (the SAME fold, auth + envelope identical to the demo arm)', async () => {
    const providers = fakeProviders();
    const deployment = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;

    // The first request pays the boot world: the demo jobs re-seed per instance.
    await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
    const demoJobs = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/jobs?project=${encodeURIComponent(DEMO_PROJECT_ID)}`, headers: BEARER }));
    expect(demoJobs.status).toBe(200);
    expect(demoJobs.headers['x-api-version']).toBe('v1');
    expect(demoJobs.headers['x-request-id']).toMatch(/^req:/);
    const jobsBody = (demoJobs.body as { requestId: unknown; data: { items: readonly { kind: string; tenant: string; project: string }[] } });
    expect(jobsBody.requestId).toBe(demoJobs.headers['x-request-id']); // the envelope discipline, identical to the demo arm
    expect(jobsBody.data.items.map((job) => job.kind).sort()).toEqual(['learning', 'research']); // the re-seeded demo jobs
    expect(jobsBody.data.items.every((job) => job.tenant === TENANT && job.project === DEMO_PROJECT_ID)).toBe(true); // L12 + the project scope

    // A user-launched project's kickoff job serves for THAT project only.
    const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-durable-jobs', Date.now() - 60_000) }));
    expect(created.status).toBe(201);
    const kickoff = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:w26c:jobs:kickoff' }, body: { kind: 'research', projectId: 'prj-durable-jobs', spec: {} } }));
    expect(kickoff.status).toBe(202);
    const launchedJobs = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/jobs?project=${encodeURIComponent('prj-durable-jobs')}`, headers: BEARER }));
    const launchedItems = ((launchedJobs.body as { data: { items: readonly { jobId: string }[] } }).data).items;
    expect(launchedItems).toHaveLength(1); // the kickoff job through the SAME fold (demoJobsOf over the composed service)

    // The auth + envelope discipline is identical to the demo arm.
    const unauthenticated = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/jobs?project=${DEMO_PROJECT_ID}` }));
    expect(unauthenticated.status).toBe(401);
    expect((unauthenticated.body as { error: { code: string } }).error.code).toBe('unauthenticated');
    const wrongToken = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/jobs?project=${DEMO_PROJECT_ID}`, headers: { authorization: 'Bearer tok-wrong-durable' } }));
    expect(wrongToken.status).toBe(401);
    const missingProject = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/jobs', headers: BEARER }));
    expect(missingProject.status).toBe(400);
    expect((missingProject.body as { error: { code: string } }).error.code).toBe('validation_failed');
    // A foreign project's page is empty (L12 by construction — the fold filters on the AUTHORIZED tenant).
    const foreign = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/jobs?project=prj-someone-elses', headers: BEARER }));
    expect(foreign.status).toBe(200);
    expect(((foreign.body as { data: { items: readonly unknown[] } }).data).items).toEqual([]);
    // Non-GET still falls through to the frozen boundary (the pre-W-8 law).
    const postJobs = await drive(deployment, streamingRequest({ method: 'POST', url: `/v1/jobs?project=${DEMO_PROJECT_ID}`, headers: { ...BEARER, 'idempotency-key': 'idem:w26c:jobs:post' }, body: {} }));
    expect(postJobs.status).toBe(404);
    expect((postJobs.body as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('GET /v1/execution/submissions serves the blotter: the seeded demo rows + the session\'s live routed submissions, project-scoped (R2 under durable)', async () => {
    const providers = fakeProviders();
    const deployment = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;

    // The first request pays the boot world (the demo project seeds).
    await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
    const seeded = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/execution/submissions?project=${encodeURIComponent(DEMO_PROJECT_ID)}`, headers: BEARER }));
    expect(seeded.status).toBe(200);
    const seededRows = ((seeded.body as { data: { items: readonly { kind: string; submissionId: string; venue: string }[] } }).data).items;
    expect(seededRows).toHaveLength(3); // the SEEDED demo blotter (two routed fills + the honest risk-limit refusal)
    expect(seededRows.every((row) => row.kind === 'routed' || row.kind === 'refused')).toBe(true);
    expect(seededRows.filter((row) => row.kind === 'routed').every((row) => row.venue === 'BROKER-FIX')).toBe(true);

    // A live routed submission joins the blotter through the seam-live gateway.
    const execution = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/execution/requests',
      headers: { ...BEARER, 'idempotency-key': 'idem:w26c:blotter:live' },
      body: { intent: validStrategyIntent(TENANT, DEMO_PROJECT_ID as never) },
    }));
    expect(execution.status).toBe(200);
    const withLive = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/execution/submissions?project=${encodeURIComponent(DEMO_PROJECT_ID)}`, headers: BEARER }));
    const liveRows = ((withLive.body as { data: { items: readonly { submissionId: string }[] } }).data).items;
    expect(liveRows).toHaveLength(4); // 3 seeded + 1 live (the recording gateway's blotter — the same fold the demo arm serves)
    const routed = (execution.body as { data: { submissionId: string } }).data;
    expect(liveRows.some((row) => row.submissionId === routed.submissionId)).toBe(true); // the session's own submission is on the blotter

    // A user-launched project's blotter carries only ITS live rows (never the demo seed's).
    const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-durable-blotter', Date.now() - 60_000) }));
    expect(created.status).toBe(201);
    const deskExecution = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/execution/requests',
      headers: { ...BEARER, 'idempotency-key': 'idem:w26c:blotter:desk' },
      body: { intent: validStrategyIntent(TENANT, 'prj-durable-blotter' as never) },
    }));
    expect(deskExecution.status).toBe(200);
    const deskBlotter = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/execution/submissions?project=${encodeURIComponent('prj-durable-blotter')}`, headers: BEARER }));
    const deskRows = ((deskBlotter.body as { data: { items: readonly { submissionId: string }[] } }).data).items;
    expect(deskRows).toHaveLength(1); // the desk's own live row only — the project scoping holds both ways

    // The auth law is identical to the demo arm's.
    const unauthenticated = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/execution/submissions?project=${DEMO_PROJECT_ID}` }));
    expect(unauthenticated.status).toBe(401);
    const missingProject = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/execution/submissions', headers: BEARER }));
    expect(missingProject.status).toBe(400);
    expect((missingProject.body as { error: { code: string } }).error.code).toBe('validation_failed');
  });
});

// ---------------------------------------------------------------------------
// THE W-26C BOOT-WORLD RACE HARDENING (R5 — the concurrent cold-boot
// collision self-heals on the FIRST retry)
// ---------------------------------------------------------------------------

/**
 * The W-26C race levers over the fake Neon fleet (deterministic cold-boot
 * windows — the live wire's concurrency, made schedulable for the tests):
 *  - SCAN HOLD: every COALESCE(MAX(ordinal)) scan is held until released —
 *    two boot worlds can both read the EMPTY ordinal space before either
 *    insert lands (the true concurrent cold-boot window; the production
 *    incident's mechanism, reproduced deterministically).
 *  - REGISTRY HOLD (armed at scan release): every subsequent registry
 *    SELECT is held until released (then the hold disarms) — the failure
 *    path's re-projection is observable landing BEFORE the typed 503
 *    leaves (the W-26C law: the failure never outruns the durable truth).
 */
function raceGatedFetch(inner: FetchLike): {
  readonly fetchLike: FetchLike;
  whenScansHeld(count: number): Promise<void>;
  releaseScans(): void;
  whenRegistriesHeld(count: number): Promise<void>;
  releaseRegistries(): void;
} {
  const SCAN_MARKER = 'SELECT COALESCE(MAX(ordinal)';
  const REGISTRY_MARKER = 'SELECT payload FROM tradrl_projects WHERE tenant = $1 ORDER BY created_at';
  let scansArmed = true;
  let registriesArmed = false;
  let scansHeld = 0;
  let registriesHeld = 0;
  const scanWaiters: Array<() => void> = [];
  const registryWaiters: Array<() => void> = [];
  interface CountWaiter { readonly count: number; readonly resolve: () => void }
  let scanCounts: CountWaiter[] = [];
  let registryCounts: CountWaiter[] = [];
  const settleCounts = (held: number, waiters: CountWaiter[]): { readonly ready: CountWaiter[]; readonly pending: CountWaiter[] } => ({
    ready: waiters.filter((waiter) => held >= waiter.count),
    pending: waiters.filter((waiter) => held < waiter.count),
  });
  const onScanHeld = (): void => {
    const { ready, pending } = settleCounts(scansHeld, scanCounts);
    scanCounts = pending;
    for (const waiter of ready) waiter.resolve();
  };
  const onRegistryHeld = (): void => {
    const { ready, pending } = settleCounts(registriesHeld, registryCounts);
    registryCounts = pending;
    for (const waiter of ready) waiter.resolve();
  };
  const fetchLike: FetchLike = (url, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    if (url.endsWith('/sql') && scansArmed && body.includes(SCAN_MARKER)) {
      scansHeld += 1;
      onScanHeld();
      return new Promise((resolve) => { scanWaiters.push(() => { resolve(inner(url, init)); }); });
    }
    if (url.endsWith('/sql') && registriesArmed && body.includes(REGISTRY_MARKER)) {
      registriesHeld += 1;
      onRegistryHeld();
      return new Promise((resolve) => { registryWaiters.push(() => { resolve(inner(url, init)); }); });
    }
    return inner(url, init);
  };
  return {
    fetchLike,
    whenScansHeld: (count) => new Promise<void>((resolve) => {
      if (scansHeld >= count) resolve();
      else scanCounts = [...scanCounts, { count, resolve }];
    }),
    releaseScans: () => { scansArmed = false; registriesArmed = true; for (const waiter of scanWaiters.splice(0)) waiter(); },
    whenRegistriesHeld: (count) => new Promise<void>((resolve) => {
      if (registriesHeld >= count) resolve();
      else registryCounts = [...registryCounts, { count, resolve }];
    }),
    releaseRegistries: () => { registriesArmed = false; for (const waiter of registryWaiters.splice(0)) waiter(); },
  };
}

describe('deploy/vercel — the W-26C boot-world race hardening (R5)', () => {
  it('two compositions over ONE fake Neon race the cold boot: the loser\'s append-only event collides on the live PK; its 503 never outruns the durable truth; the NEXT retry completes (the 503 is transient, never permanent)', async () => {
    const providers = fakeProviders();
    const gate = raceGatedFetch(providers.fetchLike);
    const first = composeInstance(durableSourceWithMachinery(), gate.fetchLike);
    const second = composeInstance(durableSourceWithMachinery(), gate.fetchLike);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Both cold boots start together over the SAME empty durable store (the
    // production incident's start line). The scan gate holds every
    // MAX-ordinal scan until BOTH boot worlds have read the EMPTY ordinal
    // space — the true concurrency window (both scans before either
    // insert), reproduced deterministically.
    let firstDone = false;
    let secondDone = false;
    const firstBoot = drive(first, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })).finally(() => { firstDone = true; });
    const secondBoot = drive(second, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })).finally(() => { secondDone = true; });
    await gate.whenScansHeld(2);
    gate.releaseScans(); // both scans read the empty log; both inserts race for ordinal 1 — exactly one lands, the other answers the live PK's 400
    // The winner's post-seed re-projection + the loser's failure-path
    // re-projection both reach their registry reads and park there.
    await gate.whenRegistriesHeld(2);

    // THE W-26C LAW (R5): the loser's typed 503 NEVER outruns the durable
    // truth — the failure-path re-projection is AWAITED before the failure
    // surfaces, so the failed attempt's next registry guard reads the
    // winner's rows fresh and skips the re-seed. While the re-projections
    // are parked, NEITHER response has left the function.
    expect(firstDone).toBe(false);
    expect(secondDone).toBe(false);
    gate.releaseRegistries();

    const firstResponse = await firstBoot;
    const secondResponse = await secondBoot;
    const raced = [[first, firstResponse], [second, secondResponse]] as const;
    expect(raced.map(([, response]) => response.status).sort()).toEqual([200, 503]); // exactly one winner + one collision
    const loserEntry = raced.find(([, response]) => response.status === 503);
    const winnerEntry = raced.find(([, response]) => response.status === 200);
    expect(loserEntry).toBeDefined();
    expect(winnerEntry).toBeDefined();
    if (loserEntry === undefined || winnerEntry === undefined) return;
    const [loser] = loserEntry;
    const [winner] = winnerEntry;
    void winner;

    // The failure is the LIVE PK's wire error (the production incident's
    // exact 400), surfaced through the boot world's typed degraded state.
    const failure = (loserEntry[1].body as { error: { code: string; message: string } }).error;
    expect(failure.code).toBe('unavailable');
    expect(failure.message).toContain('tradrl_project_events_pkey');
    expect(failure.message).toContain('unconfirmed');

    // The durable truth landed BEFORE the 503 left: the loser's projection
    // already hydrates the winner's world (the next guard reads it fresh).
    const loserProjection = loser.durable!.lastProjection();
    expect(loserProjection?.projects).toBe(1);
    expect(loserProjection?.events).toBe(1); // the winner's organization-bound event — the loser's colliding append never landed

    // THE FIRST RETRY COMPLETES (the guard now sees the durable truth —
    // the 503 is transient, never permanent).
    const retry = await drive(loser, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));
    expect(retry.status).toBe(200);
    expect((((retry.body as { data: { items: readonly { id: string }[] } }).data).items).map((project) => project.id)).toEqual([DEMO_PROJECT_ID]);

    // No duplicated world in the durable truth (the loser's re-seed never
    // ran; the guard skipped it): exactly one demo project row + one event.
    const direct = storesOver(providers.fetchLike);
    const registryRows = await direct.project.projectRecordsOf(TENANT);
    expect(registryRows.ok).toBe(true);
    if (registryRows.ok) expect(registryRows.value.filter((row) => (row as { id: string }).id === DEMO_PROJECT_ID)).toHaveLength(1);
    const events = await direct.project.projectEventsOf(TENANT, DEMO_PROJECT_ID);
    expect(events.ok).toBe(true);
    if (events.ok) expect(events.value.map((event) => event.event)).toEqual(['organization-bound']);
    // And a second retry is stable (latched — never a repeating 503).
    const settled = await drive(loser, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));
    expect(settled.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// THE W-27 DURABLE JOBS SURFACE (D-7 — the launched project's job records
// survive cold starts: the per-id detail 404 loop + the boot-time empty
// list, both closed by the write-through lane + the hydration replay)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the W-27 durable jobs surface (D-7)', () => {
  it('a launched project\'s kickoff job SURVIVES the cold start: the write-through persists the submission, and the new instance serves BOTH the jobs list (the host route) and the per-id detail (the FROZEN route, unchanged) with the EXACT durable jobId', async () => {
    const providers = fakeProviders();

    // INSTANCE A: the launch + the kickoff research job (the console's flow).
    const first = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const created = await drive(first, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-durable-jobs-a', Date.now() - 60_000) }));
    expect(created.status).toBe(201);
    const kickoff = await drive(first, streamingRequest({ method: 'POST', url: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:w27:kickoff' }, body: { kind: 'research', projectId: 'prj-durable-jobs-a', spec: { source: 'w27-durable-jobs' } } }));
    expect(kickoff.status).toBe(202);
    const kickoffJob = (kickoff.body as { data: { jobId: string; status: string; project: string } }).data;
    expect(kickoffJob.status).toBe('submitted');

    // THE WRITE-THROUGH LANDED (the router drained the submission before the
    // 202 left): the durable jobs store holds the record.
    const direct = new NeonJobStore({ config: NEON_CONFIG, fetchLike: providers.fetchLike, instants: { next: () => T0 } });
    const durableRows = await direct.jobRecordsOf(TENANT, 'prj-durable-jobs-a');
    expect(durableRows.ok).toBe(true);
    if (durableRows.ok) {
      expect(durableRows.value.map((row) => (row as { jobId: string }).jobId)).toEqual([kickoffJob.jobId]);
    }

    // INSTANCE B (the cold start — the D-7 scenario): the first request pays
    // the boot world, whose HYDRATION replays the durable job record back
    // into the fresh instance's API-owned job store through the REAL public
    // job route. The projection report carries the hydrated jobs count.
    const second = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    await second.durable!.settled();
    expect(second.durable!.lastProjection()?.jobs).toBe(1);
    // (1) THE JOBS LIST (the host route, D-3's fold): the launched project's
    // page carries its durable kickoff — never again "No research jobs"
    // after a reload.
    const listed = await drive(second, streamingRequest({ method: 'GET', url: `/v1/jobs?project=${encodeURIComponent('prj-durable-jobs-a')}`, headers: BEARER }));
    expect(listed.status).toBe(200);
    const listedItems = ((listed.body as { data: { items: readonly { jobId: string; status: string; project: string }[] } }).data).items;
    expect(listedItems.map((job) => job.jobId)).toEqual([kickoffJob.jobId]); // the EXACT durable id — the hydrated record, not a re-mint
    expect(listedItems[0]!.status).toBe('submitted');
    // (2) THE PER-ID DETAIL (the FROZEN 3-segment route, UNCHANGED — served
    // by the boundary over the hydrated store): 200 on the fresh instance —
    // the D-7 404 poller loop is gone.
    const detail = await drive(second, streamingRequest({ method: 'GET', url: `/v1/jobs/${encodeURIComponent(kickoffJob.jobId)}`, headers: BEARER }));
    expect(detail.status).toBe(200);
    expect(((detail.body as { data: { jobId: string; project: string } }).data).jobId).toBe(kickoffJob.jobId);
    expect(((detail.body as { data: { project: string } }).data).project).toBe('prj-durable-jobs-a');
    // (3) The demo scope's list still serves its RE-SEEDED demo jobs (the
    // demo project's jobs stay per-instance — the write-through exclusion).
    const demoList = await drive(second, streamingRequest({ method: 'GET', url: `/v1/jobs?project=${encodeURIComponent(DEMO_PROJECT_ID)}`, headers: BEARER }));
    const demoItems = ((demoList.body as { data: { items: readonly { kind: string }[] } }).data).items;
    expect(demoItems.map((job) => job.kind).sort()).toEqual(['learning', 'research']);
    // (4) L12 unchanged: a foreign project's page is empty.
    const foreign = await drive(second, streamingRequest({ method: 'GET', url: `/v1/jobs?project=${encodeURIComponent('prj-someone-elses')}`, headers: BEARER }));
    expect(foreign.status).toBe(200);
    expect(((foreign.body as { data: { items: readonly unknown[] } }).data).items).toEqual([]);
    // (5) THE DEMO EXCLUSION (row-level): the durable jobs store holds NO
    // row for the demo project (only the launched project's kickoff).
    const demoRows = await direct.jobRecordsOf(TENANT, DEMO_PROJECT_ID);
    expect(demoRows.ok).toBe(true);
    if (demoRows.ok) expect(demoRows.value).toEqual([]);
  });

  it('the machinery tick\'s TRANSITIONS persist too: submitted -> complete rides the write-through, and the cold-start instance serves the COMPLETED record with its release-candidate result (the frozen route)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();
      const first = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const created = await drive(first, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-durable-jobs-b', T0 - 60_000) }));
      expect(created.status).toBe(201);
      const kickoff = await drive(first, streamingRequest({ method: 'POST', url: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:w27:transition' }, body: { kind: 'research', projectId: 'prj-durable-jobs-b', spec: {} } }));
      expect(kickoff.status).toBe(202);
      const jobId = (kickoff.body as { data: { jobId: string } }).data.jobId;

      // The tick at +10s advances the kickoff to COMPLETE (through the real
      // private plane); the transition's write-through drains with the
      // request (the ordering law).
      vi.setSystemTime(T0 + 10_000);
      const ticked = await drive(first, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      expect(ticked.status).toBe(200);
      const finished = await drive(first, streamingRequest({ method: 'GET', url: `/v1/jobs/${encodeURIComponent(jobId)}`, headers: BEARER }));
      expect(((finished.body as { data: { status: string } }).data).status).toBe('complete');

      // THE COLD START: the fresh instance hydrates the COMPLETED record —
      // status, result and completedAt all durable.
      const second = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      const coldDetail = await drive(second, streamingRequest({ method: 'GET', url: `/v1/jobs/${encodeURIComponent(jobId)}`, headers: BEARER }));
      expect(coldDetail.status).toBe(200);
      const coldRecord = (coldDetail.body as { data: { status: string; result: { kind: string; specId: string; project: string; summary: string } } }).data;
      expect(coldRecord.status).toBe('complete');
      // FW-36-A (E-1): the durable completion is the composed deliverable —
      // byte-identically rehydrated by the cold start (the frozen truth of
      // the completion instant; the additive shape never a schema change).
      expect(coldRecord.result.kind).toBe('release-candidate');
      expect(coldRecord.result.specId).toBe('spec-launch-director');
      expect(coldRecord.result.project).toBe('prj-durable-jobs-b');
      expect(coldRecord.result.summary).toContain('no launch world on record for prj-durable-jobs-b');
      // And the machinery tick does NOT re-transition the terminal durable
      // job (the async pattern's own legality machine — a terminal record
      // never re-opens; the write-through lane stays quiet).
      const afterTick = await drive(second, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      expect(afterTick.status).toBe(200);
      const stillDone = await drive(second, streamingRequest({ method: 'GET', url: `/v1/jobs/${encodeURIComponent(jobId)}`, headers: BEARER }));
      expect(((stillDone.body as { data: { status: string } }).data).status).toBe('complete');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the seam\'s jobs read answers the TYPED degraded state while the projection is pending (never a silent empty)', async () => {
    const providers = fakeProviders();
    const deployment = composeInstance(durableSource(), providers.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    expect(deployment.durable).not.toBeNull();
    // Before the first settled(): the typed pending failure (R46 — the host
    // routes would surface the typed degraded state, never an empty 200).
    const pending = deployment.durable!.jobsOf('prj-any');
    expect(pending.ok).toBe(false);
    if (!pending.ok) expect(pending.error.code).toBe('durable_projection_pending');
    await deployment.durable!.settled();
    const ready = deployment.durable!.jobsOf('prj-any');
    expect(ready.ok).toBe(true);
    if (ready.ok) expect(ready.value).toEqual([]); // an unknown project's page is empty (never a leak)
  });
});

// ---------------------------------------------------------------------------
// FW-MI-A (MI wave 1): THE SESSION-SCOPE SURFACES UNDER DURABLE — the
// ownership stamp surviving cold starts + the FRESH session listing
// (defects MI-D1 + MI-D8, the durable arm)
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-MI-A: the durable session scope (the ownership stamp, the fresh JOIN listing, the cross-instance freshness)', () => {
  const SESSION_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // 32-hex — the console's mint shape
  const SESSION_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  function sessionHeaders(session: string): Record<string, string> {
    return { ...BEARER, 'x-tradrl-console-session': session };
  }

  it('the ownership stamp persists: a session-scoped create stamps the goal-set row, and a COLD instance serves the session view from it (the session\'s own desks survive reloads + cold starts)', async () => {
    const providers = fakeProviders();
    const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(instanceA.ok).toBe(true);
    if (!instanceA.ok) return;

    // session A launches a desk through the FULL handler (the stamp rides the drain)
    const created = await drive(instanceA, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A), 'content-type': 'application/json' },
      body: createProjectBody('prj-session-a-1'),
    }));
    expect(created.status).toBe(201);

    // the goal-set row carries the OWNING session (the additive field on the opaque payload)
    const direct = storesOver(providers.fetchLike);
    const goalSet = await direct.project.goalSetOf(TENANT, 'prj-session-a-1');
    expect(goalSet.ok).toBe(true);
    if (!goalSet.ok) return;
    expect(goalSet.value?.ownerSession).toBe(SESSION_A); // THE STAMP
    expect(goalSet.value?.goal).toEqual(validGoal(TENANT)); // the create's own records, unchanged

    // the COLD instance: session A still sees its desk (the durable ownership — the session's own projects hydrate for the session view)
    const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(instanceB.ok).toBe(true);
    if (!instanceB.ok) return;
    const ownListing = await drive(instanceB, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_A) }));
    expect(ownListing.status).toBe(200);
    expect(((ownListing.body as { data: { items: readonly { id: string }[] } }).data).items.map((project) => project.id)).toEqual([DEMO_PROJECT_ID, 'prj-session-a-1']);

    // ...and session B sees the SAME registry rows — FW-31-B's law: under
    // durable the listing is the TENANT'S OWN registry (a browser restart
    // that minted a fresh session id must never orphan a durable desk —
    // Round A blocker 3), with the MARKER carrying the session grouping
    // (A's desk is 'tenant-available' to B, 'session-owned' to A).
    const otherListing = await drive(instanceB, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_B) }));
    expect(otherListing.status).toBe(200);
    const otherItems = ((otherListing.body as { data: { items: readonly { id: string; consoleSessionScope?: string }[] } }).data).items;
    expect(otherItems.map((project) => project.id)).toEqual([DEMO_PROJECT_ID, 'prj-session-a-1']);
    expect(otherItems.find((project) => project.id === 'prj-session-a-1')?.consoleSessionScope).toBe('tenant-available');
    const ownItems = ((ownListing.body as { data: { items: readonly { id: string; consoleSessionScope?: string }[] } }).data).items;
    expect(ownItems.find((project) => project.id === 'prj-session-a-1')?.consoleSessionScope).toBe('session-owned');
    expect(ownItems.find((project) => project.id === DEMO_PROJECT_ID)?.consoleSessionScope).toBe('tenant-available'); // the shared teaching scope
  });

  it('FW-31-B\'s durable law: EVERY registry row serves to every session (detail + goal + the jobs/blotter gates) — the ownerSession identity NEVER crosses the wire, and an id OUTSIDE the registry stays the typed not-found', async () => {
    const providers = fakeProviders();
    const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(instanceA.ok).toBe(true);
    if (!instanceA.ok) return;
    await drive(instanceA, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A), 'content-type': 'application/json' },
      body: createProjectBody('prj-session-a-1'),
    }));

    // a FRESH instance (the cold start): the session view, not the projection, answers
    const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(instanceB.ok).toBe(true);
    if (!instanceB.ok) return;

    // B's direct id read of A's desk now SERVES (FW-31-B — the tenant's own
    // registry; the pre-fix law orphaned the desk when A's session id died),
    // carrying the marker — never the ownerSession identity itself.
    const foreignDetail = await drive(instanceB, streamingRequest({ url: '/v1/projects/prj-session-a-1', headers: sessionHeaders(SESSION_B) }));
    expect(foreignDetail.status).toBe(200);
    const detailData = foreignDetail.body.data as { id: string; consoleSessionScope?: string; ownerSession?: unknown };
    expect(detailData.id).toBe('prj-session-a-1');
    expect(detailData.consoleSessionScope).toBe('tenant-available');
    expect(detailData.ownerSession).toBeUndefined(); // the ownership identity is host-side only — never in the console's read
    const foreignGoal = await drive(instanceB, streamingRequest({ url: '/v1/projects/prj-session-a-1/goal?project=prj-session-a-1', headers: sessionHeaders(SESSION_B) }));
    expect(foreignGoal.status).toBe(200);
    const foreignJobs = await drive(instanceB, streamingRequest({ url: '/v1/jobs?project=prj-session-a-1', headers: sessionHeaders(SESSION_B) }));
    expect(foreignJobs.status).toBe(200); // the gate passes for every registry row
    const foreignBlotter = await drive(instanceB, streamingRequest({ url: '/v1/execution/submissions?project=prj-session-a-1', headers: sessionHeaders(SESSION_B) }));
    expect(foreignBlotter.status).toBe(200);

    // ...while an id OUTSIDE the tenant's registry answers the typed
    // not-found (unknown and foreign indistinguishable — the boundary's own
    // law, preserved).
    const unknownDetail = await drive(instanceB, streamingRequest({ url: '/v1/projects/prj-never-created', headers: sessionHeaders(SESSION_B) }));
    expect(unknownDetail.status).toBe(404);
    expect((unknownDetail.body.error as { code: string }).code).toBe('not_found');
    const unknownJobs = await drive(instanceB, streamingRequest({ url: '/v1/jobs?project=prj-never-created', headers: sessionHeaders(SESSION_B) }));
    expect(unknownJobs.status).toBe(404);

    // A's own detail + goal read serve — the goal FRESH from the JOIN row, with the ownerSession field NEVER crossing the wire
    const ownDetail = await drive(instanceB, streamingRequest({ url: '/v1/projects/prj-session-a-1', headers: sessionHeaders(SESSION_A) }));
    expect(ownDetail.status).toBe(200);
    expect(((ownDetail.body.data as { consoleSessionScope?: string }).consoleSessionScope)).toBe('session-owned');
    const ownGoal = await drive(instanceB, streamingRequest({ url: '/v1/projects/prj-session-a-1/goal?project=prj-session-a-1', headers: sessionHeaders(SESSION_A) }));
    expect(ownGoal.status).toBe(200);
    const goalBundle = ownGoal.body.data as { goal: unknown; constraintSet: unknown; ownerSession?: unknown };
    expect(goalBundle.goal).toEqual(validGoal(TENANT)); // the launch's own goal, served fresh
    expect(goalBundle.constraintSet).toEqual(validConstraintSet(TENANT));
    expect(goalBundle.ownerSession).toBeUndefined(); // the ownership field is host-side only — never in the console's read
  });

  it('MI-D8\'s root cause, closed: a WARM instance\'s session listing sees another instance\'s create IMMEDIATELY (the fresh JOIN) — where the frozen boundary\'s projection view still serves the boot snapshot', async () => {
    const providers = fakeProviders();
    // instance B boots FIRST (its projection settles over the pre-create world)
    const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(instanceB.ok).toBe(true);
    if (!instanceB.ok) return;
    const warmBoot = await drive(instanceB, streamingRequest({ url: '/v1/projects', headers: BEARER }));
    expect(warmBoot.status).toBe(200); // the projection settled (the boundary's listing answered)

    // instance A (a DIFFERENT serverless instance) creates a project for session A
    const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(instanceA.ok).toBe(true);
    if (!instanceA.ok) return;
    await drive(instanceA, streamingRequest({
      method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A), 'content-type': 'application/json' },
      body: createProjectBody('prj-warm-1'),
    }));

    // THE FIX: instance B's SESSION listing reads the durable tables (the JOIN) — the desk A just launched is ALREADY there (the wave-1 evidence: "after reload MY two desks became UNREACHABLE" — the warm projection never re-read the registry)
    const sessionListing = await drive(instanceB, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_A) }));
    expect(sessionListing.status).toBe(200);
    expect(((sessionListing.body as { data: { items: readonly { id: string }[] } }).data).items.map((project) => project.id)).toEqual([DEMO_PROJECT_ID, 'prj-warm-1']);

    // ...while the HEADERLESS boundary listing on the same warm instance still serves the boot projection (the frozen boundary's own, unchanged behavior — the session routes are the additive fix, never a re-implementation)
    const boundaryListing = await drive(instanceB, streamingRequest({ url: '/v1/projects', headers: BEARER }));
    const boundaryIds = ((boundaryListing.body as { data: { items: readonly { id: string }[] } }).data).items.map((project) => project.id);
    expect(boundaryIds).toEqual([DEMO_PROJECT_ID]); // the pre-fix projection staleness, preserved byte-identically for the headerless SDK caller
  });
});

// ---------------------------------------------------------------------------
// FW-31-B (Round A blockers 3 + 6): the durable scope persistence wave —
// the full-project-list switcher route (tenant-scoped, session markers),
// the DETERMINISTIC demo-job re-seed (identity-stable across instance
// boots), and the P02 LAUNCH-COMPILE STALL's root cause + heal (a warm
// instance whose job store + watch store predate a launch that landed on
// ANOTHER instance: the console's per-id job polls answered the typed
// 404 forever and the compiled org was unobservable — the bounded
// staleness heal re-reads the durable truth and replays the missing
// records through the REAL public routes).
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-31-B: the durable scope persistence (the full-project-list switcher + the deterministic re-seed + the P02 stall heal)', () => {
  const SESSION_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const SESSION_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const SESSION_FRESH = 'ffffffffffffffffffffffffffffffff'; // a browser restart's minted id — no owned desks

  function sessionHeaders(session: string): Record<string, string> {
    return { ...BEARER, 'x-tradrl-console-session': session };
  }

  it('the switcher lists ALL the tenant\'s durable projects — session-created desks marked session-owned, every other registry row (an SDK create, the demo project) marked tenant-available; a FRESH session (the browser restart) reaches every one', async () => {
    const providers = fakeProviders();
    const instance = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(instance.ok).toBe(true);
    if (!instance.ok) return;

    // session A launches a desk; session B launches another; an SDK caller (headerless) creates a third.
    await drive(instance, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A), 'content-type': 'application/json' }, body: createProjectBody('prj-fw31b-a') }));
    await drive(instance, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_B), 'content-type': 'application/json' }, body: createProjectBody('prj-fw31b-b') }));
    await drive(instance, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'content-type': 'application/json' }, body: createProjectBody('prj-fw31b-sdk') }));

    // A's listing: the WHOLE registry (Round A blocker 3's fix — the switcher never orphans a durable desk), marked.
    const listing = await drive(instance, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_A) }));
    expect(listing.status).toBe(200);
    const items = ((listing.body as { data: { items: readonly { id: string; consoleSessionScope?: string; ownerSession?: unknown }[] } }).data).items;
    expect(items.map((project) => project.id)).toEqual([DEMO_PROJECT_ID, 'prj-fw31b-a', 'prj-fw31b-b', 'prj-fw31b-sdk']);
    expect(items.find((project) => project.id === 'prj-fw31b-a')?.consoleSessionScope).toBe('session-owned');
    expect(items.find((project) => project.id === 'prj-fw31b-b')?.consoleSessionScope).toBe('tenant-available');
    expect(items.find((project) => project.id === 'prj-fw31b-sdk')?.consoleSessionScope).toBe('tenant-available'); // an SDK create is a tenant scope, not a session's
    expect(items.find((project) => project.id === DEMO_PROJECT_ID)?.consoleSessionScope).toBe('tenant-available');
    expect(items.every((project) => project.ownerSession === undefined)).toBe(true); // the ownership identity NEVER crosses the wire

    // THE BROWSER-RESTART LAW: a FRESH session (a new minted id — S1's
    // restart scenario) reaches EVERY durable project in the switcher AND
    // by id (the detail + the goal), so scope selection survives the
    // restart — the pre-fix law orphaned A's compiled org entirely.
    const freshListing = await drive(instance, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_FRESH) }));
    expect(((freshListing.body as { data: { items: readonly { id: string }[] } }).data).items.map((project) => project.id)).toEqual([DEMO_PROJECT_ID, 'prj-fw31b-a', 'prj-fw31b-b', 'prj-fw31b-sdk']);
    const recoveredDetail = await drive(instance, streamingRequest({ url: '/v1/projects/prj-fw31b-a', headers: sessionHeaders(SESSION_FRESH) }));
    expect(recoveredDetail.status).toBe(200);
    expect(((recoveredDetail.body.data as { consoleSessionScope?: string }).consoleSessionScope)).toBe('tenant-available');
    const recoveredGoal = await drive(instance, streamingRequest({ url: '/v1/projects/prj-fw31b-a/goal?project=prj-fw31b-a', headers: sessionHeaders(SESSION_FRESH) }));
    expect(recoveredGoal.status).toBe(200); // the recovered desk's own goal serves its re-selecting session
  });

  it('L12 holds: a FOREIGN tenant\'s registry row NEVER lists (the fresh JOIN is the credential tenant\'s own — pre-populated directly into the store)', async () => {
    const providers = fakeProviders();
    // A foreign tenant's durable rows, written directly through the store
    // layer (the honest cross-tenant artifact — the JOIN must never carry it).
    const direct = storesOver(providers.fetchLike);
    const foreignRecord = { tenantId: 'tenant-other', id: 'prj-fw31b-foreign', name: 'the foreign desk', executionMode: 'simulation', lifecycle: { status: 'draft', organizationRef: null, createdAt: T0, updatedAt: T0 }, createdAt: T0, updatedAt: T0 };
    const goalWritten = await direct.project.putGoalSet('tenant-other', 'prj-fw31b-foreign', { goal: validGoal('tenant-other'), constraintSet: validConstraintSet('tenant-other') });
    expect(goalWritten.ok).toBe(true);
    const recordWritten = await direct.project.putProjectRecord('tenant-other', foreignRecord);
    expect(recordWritten.ok).toBe(true);

    const instance = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(instance.ok).toBe(true);
    if (!instance.ok) return;
    const listing = await drive(instance, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_A) }));
    const ids = ((listing.body as { data: { items: readonly { id: string }[] } }).data).items.map((project) => project.id);
    expect(ids).toEqual([DEMO_PROJECT_ID]); // the foreign row never lists — L12 by construction
    const foreignRead = await drive(instance, streamingRequest({ url: '/v1/projects/prj-fw31b-foreign', headers: sessionHeaders(SESSION_A) }));
    expect(foreignRead.status).toBe(404); // ...and never reads by id (unknown and foreign indistinguishable)
  });

  it('DETERMINISTIC RE-SEED: two instance boots at DIFFERENT wall-clock instants carry the BYTE-IDENTICAL demo jobs (the pre-fix rotation — fresh ids + timestamps per instance — closed; fake timers prove the instant-independence)', async () => {
    vi.useFakeTimers();
    try {
      const providers = fakeProviders();
      // INSTANCE 1 boots at T0; INSTANCE 2 boots a full day later (the
      // pre-fix re-seed minted its ids from the pipeline's request instant —
      // a different day, different ids, the rotating job list).
      vi.setSystemTime(T0);
      const first = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      await drive(first, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));

      vi.setSystemTime(T0 + 24 * 3_600_000);
      const second = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      await drive(second, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));

      const shape = (job: { jobId: string; kind: string; status: string; submittedAt: number; completedAt?: number }) =>
        ({ jobId: job.jobId, kind: job.kind, status: job.status, submittedAt: job.submittedAt, ...(job.completedAt === undefined ? {} : { completedAt: job.completedAt }) });
      const firstJobs = first.service.jobs().filter((job) => job.project === DEMO_PROJECT_ID).map(shape);
      const secondJobs = second.service.jobs().filter((job) => job.project === DEMO_PROJECT_ID).map(shape);
      expect(firstJobs).toHaveLength(2);
      expect(secondJobs).toEqual(firstJobs); // BYTE-IDENTICAL across boots a day apart
      // ...and the identity is the deterministic shape (the demo epoch, never the boot instant).
      expect(firstJobs.map((job) => job.submittedAt).every((at) => at === DEMO_SEED_JOB_SUBMITTED_AT)).toBe(true);
      expect(firstJobs.map((job) => job.jobId).sort()).toEqual([demoSeedJobRecord(TENANT, 'research').jobId, demoSeedJobRecord(TENANT, 'learning').jobId].sort());

      // The demo ORG's watch snapshot is instant-stable too (the "observed
      // 04:33→04:24→04:33" rotation, closed): the demo epoch's fixed
      // observation instant, byte-identical on both instances.
      const firstSnapshot = first.service.orgStatusSnapshots().find((snapshot) => snapshot.project === DEMO_PROJECT_ID);
      const secondSnapshot = second.service.orgStatusSnapshots().find((snapshot) => snapshot.project === DEMO_PROJECT_ID);
      expect(firstSnapshot).toBeDefined();
      expect(secondSnapshot).toEqual(firstSnapshot);
    } finally {
      vi.useRealTimers();
    }
  });

  it('THE P02 STALL, root-caused and healed: a WARM instance that booted BEFORE the launch answers the kickoff poll 404 — the bounded staleness heal replays the durable job + reports the compiled org\'s snapshot, and the poll serves', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();
      // INSTANCE B boots FIRST (warm — its boot projection + job store
      // predate the launch; this is the instance the balancer keeps routing
      // the console's polls to: Round A's L1/M1 stall). Its first tick ARMS
      // the heal interval (T0).
      const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceB.ok).toBe(true);
      if (!instanceB.ok) return;
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER })); // the boot world settles

      // INSTANCE A (a different serverless instance) carries the launch at
      // T0+2s: create + the kickoff job (the durable truth moves).
      vi.setSystemTime(T0 + 2_000);
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      const created = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(SESSION_A), 'content-type': 'application/json' }, body: createProjectBody('prj-fw31b-stall', T0 + 2_000) }));
      expect(created.status).toBe(201);
      const kickoff = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:fw31b:stall:kickoff' }, body: { kind: 'research', projectId: 'prj-fw31b-stall', spec: { source: 'fw31b-stall-test' } } }));
      expect(kickoff.status).toBe(202);
      const kickoffJob = (kickoff.body as { data: { jobId: string } }).data;

      // THE PRE-FIX STALL, reproduced on the warm instance at T0+9s — BEFORE
      // B's heal interval elapses (armed at T0): the per-id poll answers the
      // typed 404 (the FROZEN route reads the instance's own API-owned
      // store, which predates the launch) — and the compiled org's status
      // read 404s the same way (the org IS compiled in the durable truth —
      // A's kickoff-drive tick bound it — but B's projection + watch store
      // predate the launch and nothing ever re-read the truth there). This
      // is L1/M1's stall: CONNECTION degrades, the launch phase never
      // advances, the org never compiles — as observed.
      vi.setSystemTime(T0 + 9_000);
      const stalledPoll = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/jobs/${kickoffJob.jobId}`, headers: BEARER }));
      expect(stalledPoll.status).toBe(404);
      const stalledOrg = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/organizations/${encodeURIComponent(compiledOrganizationRefOf('prj-fw31b-stall'))}/status?project=${encodeURIComponent('prj-fw31b-stall')}`, headers: BEARER }));
      expect(stalledOrg.status).toBe(404);

      // A's later tick completes the kickoff (age 10s) and the write-through
      // persists the transition — the durable truth now carries the COMPLETE
      // record (the compiled org's bind already persisted at the launch).
      vi.setSystemTime(T0 + 12_000);
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));

      // THE HEAL: past the staleness interval, B's next request (T0+15s)
      // fires the bounded heal (one fresh tenant-wide jobs read + the fresh
      // JOIN for the snapshot pass) — the missing records replay through the
      // REAL public routes into B's own store, and the compiled org's
      // snapshot reports through the REAL private route. The heal is
      // fire-and-forget; flush the microtask chain it rides. FW-33-A
      // lengthened the chain (the derived-truth probe's fresh reads — the
      // session JOIN + the tenant-wide outcome/post-mortem/knowledge
      // reads — and, on divergence, the quiet re-projection's own seven
      // reads — all BEFORE the jobs half's replay): a fixed small loop
      // no longer covers it. Flush until the queue genuinely drains
      // (bounded, never hanging: each turn either makes progress or the
      // chain has settled).
      vi.setSystemTime(T0 + 15_000);
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      for (let settle = 0; settle < 400; settle += 1) await Promise.resolve(); // the fake fleet's fetch resolves on microtasks; the heal chain is O(reads) deep

      // The poll now serves on the SAME warm instance — the launch
      // un-sticks (the record carries A's durable completion: the
      // release-candidate result, the persisted completedAt).
      const healedPoll = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/jobs/${kickoffJob.jobId}`, headers: BEARER }));
      expect(healedPoll.status).toBe(200);
      const healedJob = (healedPoll.body as { data: { jobId: string; status: string; result: { kind: string } } }).data;
      expect(healedJob.jobId).toBe(kickoffJob.jobId);
      expect(healedJob.status).toBe('complete');
      expect(healedJob.result.kind).toBe('release-candidate');

      // ...and the compiled org's snapshot is observable on the same warm
      // instance (the "org never compiles" half — the org WAS compiled in
      // the durable truth; B can finally observe it).
      const healedOrg = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/organizations/${encodeURIComponent(compiledOrganizationRefOf('prj-fw31b-stall'))}/status?project=${encodeURIComponent('prj-fw31b-stall')}`, headers: BEARER }));
      expect(healedOrg.status).toBe(200);
      expect(((healedOrg.body as { data: { status: string; project: string } }).data).project).toBe('prj-fw31b-stall');
    } finally {
      vi.useRealTimers();
    }
  });
});

// THE LAUNCHED-DESK EVIDENCE STREAM UNDER DURABLE (FW-MI-B — MI-D2 +
// MI-D10): the SAME per-project derivation the demo arm serves, over the
// seam's OWN surfaces — the hydrated goal set (goal + constraint set +
// the W-28 world) and the hydrated control plane's compile gate. The
// derived stream is read-time derivation over durable rows, so a COLD
// START serves the desk's evidence stream IDENTICALLY (the demo arm's
// honest per-instance limitation does not apply here: the envelope
// itself is durable).
// ---------------------------------------------------------------------------

describe('deploy/vercel — the launched-desk evidence stream under durable (FW-MI-B: the derived stream serves + survives the cold start)', () => {
  it('launch -> the kickoff request\'s tick compiles the org -> the blotter + the outcome/post-mortem reads serve the desk\'s OWN stream (named bodies, the fixture constraint set\'s own position cap quoted in the refusal)', async () => {
    const providers = fakeProviders();
    const deployment = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;

    // The first request pays the boot world (the demo project seeds).
    await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));

    // THE LAUNCH: the fixture goal/constraint set (validConstraintSet carries
    // the k-position state cap — the packet's own example of a position limit
    // from the project's constraint set) + the console-launch kickoff job
    // (the world: BTC/ETH on binance/kraken, capital 500000.00, risk 40000.00).
    // The create's `at` is a PAST instant on the REAL clock (the control
    // plane's monotonic audit law: the tick's bind at Date.now() must be
    // >= the record's updatedAt — the W-26B compile test's own law; the
    // DERIVED records' instants derive from the goal's own createdAt, not
    // from this wall clock, so the stream itself stays deterministic).
    const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-durable-evidence', Date.now() - 60_000) }));
    expect(created.status).toBe(201);
    const kickoff = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/jobs/research',
      headers: { ...BEARER, 'idempotency-key': 'idem:fwmib:durable:kickoff' },
      body: { kind: 'research', projectId: 'prj-durable-evidence', spec: consoleLaunchSpec() },
    }));
    expect(kickoff.status).toBe(202); // the kickoff request's tick compiled the org (the R4 pass over the hydrated control plane)

    // THE BLOTTER: the desk's own derived stream — 3 rows, named bodies, the
    // numeric refusal quoting the project's OWN k-position cap (bound 2,
    // observed 2.4 — the same constraint its fixture constraint set declares).
    const blotter = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/execution/submissions?project=prj-durable-evidence', headers: BEARER }));
    expect(blotter.status).toBe(200);
    const rows = ((blotter.body as { data: { items: readonly Record<string, unknown>[] } }).data).items;
    expect(rows).toHaveLength(3);
    const routed = rows.filter((row) => row.kind === 'routed') as unknown as readonly { decisionBody: string; fill: { notional: string }; order: { quantity: string; price: string }; riskChecks: readonly unknown[] }[];
    const refused = rows.find((row) => row.kind === 'refused') as unknown as { decisionBody: string; refusal: { stage: string; refusals: readonly { constraintId: string; subject: string; predicate: { kind: string; bound: number }; observed: string }[] } };
    expect(routed).toHaveLength(2);
    expect(routed.every((row) => row.decisionBody === 'desk:prj-durable-evidence-execution')).toBe(true); // NAMED — never "unknown" (MI-D10)
    expect(refused.decisionBody).toBe('gate:pre-trade-risk');
    expect(routed.every((row) => row.riskChecks.length === 7)).toBe(true);
    expect(routed[0]!.fill.notional).toBe('48000'); // 0.8 x 60000 — exact (capital 500000.00, risk 40000.00)
    const quoted = refused.refusal.refusals[0]!;
    expect(quoted.constraintId).toBe('k-position'); // the project's OWN constraint-set position cap
    expect(quoted.subject).toBe('position.grossExposure');
    expect(quoted.predicate.kind).toBe('limit.max');
    expect(quoted.predicate.bound).toBe(2);
    expect(quoted.observed).toBe('2.4');

    // THE OUTCOME + POST-MORTEM READS (the frozen routes over the WRAPPED seam port).
    const outcomes = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/outcomes/query', headers: BEARER, body: { project: 'prj-durable-evidence', at: T0 + 10_000 } }));
    expect(outcomes.status).toBe(200);
    const outcomeItems = ((outcomes.body as { data: { items: readonly { outcomeId: string; outcomeClass: string; decisionBody: string; expectation: { declaredBy: string }; deviation: { realizedGap: string; withinTolerance: boolean } }[] } }).data).items;
    expect(outcomeItems).toHaveLength(1);
    expect(outcomeItems[0]!.outcomeClass).toBe('adverse_gap');
    expect(outcomeItems[0]!.decisionBody).toBe('desk:prj-durable-evidence-execution');
    expect(outcomeItems[0]!.expectation.declaredBy).toBe('spec-launch-director');
    expect(outcomeItems[0]!.deviation.realizedGap).toBe('-60'); // -12 - 48, exact
    expect(outcomeItems[0]!.deviation.withinTolerance).toBe(false);
    const mortems = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/post-mortems/query', headers: BEARER, body: { project: 'prj-durable-evidence', at: T0 + 10_000, latestPerOutcome: true } }));
    expect(mortems.status).toBe(200);
    const mortemItems = ((mortems.body as { data: { items: readonly { postMortemId: string; subject: { outcomeRecordRef: string }; hypotheses: readonly { confidence: string; note: string }[] }[] } }).data).items;
    expect(mortemItems).toHaveLength(1);
    expect(mortemItems[0]!.subject.outcomeRecordRef).toBe(outcomeItems[0]!.outcomeId); // attached to its outcome
    expect(mortemItems[0]!.hypotheses[0]!.confidence).toBe('0.8'); // confidence-rated
    expect(mortemItems[0]!.hypotheses[0]!.note).toContain('simulated'); // the honesty discipline

    // THE COLD START: a fresh instance over the same durable store — the
    // goal set (with the world) + the bound project hydrate, so the SAME
    // derived stream serves IDENTICALLY (read-time derivation over durable
    // rows; the demo arm's per-instance limitation does not apply here).
    const second = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const coldBlotter = await drive(second, streamingRequest({ method: 'GET', url: '/v1/execution/submissions?project=prj-durable-evidence', headers: BEARER }));
    expect(coldBlotter.status).toBe(200);
    const coldRows = ((coldBlotter.body as { data: { items: readonly { submissionId: string; decisionBody?: string }[] } }).data).items;
    expect(coldRows.map((row) => row.submissionId)).toEqual(rows.map((row) => (row as { submissionId: string }).submissionId)); // byte-identical ids — the same stream
    const coldOutcomes = await drive(second, streamingRequest({ method: 'POST', url: '/v1/outcomes/query', headers: BEARER, body: { project: 'prj-durable-evidence', at: T0 + 10_000 } }));
    expect((((coldOutcomes.body as { data: { items: readonly { outcomeId: string }[] } }).data).items).map((entry) => entry.outcomeId)).toEqual(outcomeItems.map((entry) => entry.outcomeId));

    // THE DEMO PROJECT's fixture substance stays untouched under durable too (the derivation excludes it — the boot-world fixture rows are its story).
    const demoOutcomes = await drive(second, streamingRequest({ method: 'POST', url: '/v1/outcomes/query', headers: BEARER, body: { project: DEMO_PROJECT_ID, at: T0 + 10_000 } }));
    expect((((demoOutcomes.body as { data: { items: readonly { outcomeId: string }[] } }).data).items).map((entry) => entry.outcomeId)).toEqual(['out:demo0001']);
  });
});

// ---------------------------------------------------------------------------
// W-30 (PROD-504): THE ROUND-TRIP LAW — the boot projection's SQL fetch count
// is CONSTANT regardless of project count (the regression the production
// 504 shipped: ~6 queries PER PROJECT, ≈151 sequential fetches at 25 durable
// projects, past the 10s function cap before authn on every cold start).
// RED on the pre-fix code shape (count(3) = 19 ≠ count(30) = 181), GREEN on
// the batched reads. The completeness assertions prove the batched read
// actually HYDRATES the whole world — a projection that read nothing would
// also be constant.
// ---------------------------------------------------------------------------

describe('deploy/vercel — W-30: the boot-projection round-trip law (PROD-504)', () => {
  it('the hydration ceiling the projection reads at IS the point-in-time MAX (the tenant-wide knowledge boot read refuses every other shape — the two constants must stay one)', async () => {
    const { HYDRATION_AT } = await import('./runtime/durable');
    expect(HYDRATION_AT).toBe(Number.MAX_SAFE_INTEGER);
  });


  /** Seed N full projects through the durable stores over the injected fetch (registry row + goal set + one binding event + knowledge + outcome + post-mortem + job each). */
  async function seedProjects(providers: ReturnType<typeof fakeProviders>, count: number): Promise<void> {
    const direct = storesOver(providers.fetchLike);
    const jobStore = new NeonJobStore({ config: NEON_CONFIG, fetchLike: providers.fetchLike, instants: { next: () => T0 } });
    for (let index = 0; index < count; index += 1) {
      const projectId = `prj-law-${index}`;
      expect((await direct.project.putGoalSet(TENANT, projectId, { goal: validGoal(TENANT), constraintSet: validConstraintSet(TENANT) })).ok).toBe(true);
      expect((await direct.project.putProjectRecord(TENANT, {
        id: projectId,
        tenantId: TENANT,
        name: `the law desk ${index}`,
        executionMode: 'simulation',
        lifecycle: { status: 'draft', organizationRef: null },
        createdAt: T0 + index,
        updatedAt: T0 + index,
      })).ok).toBe(true);
      expect((await direct.project.appendProjectEvent({ tenant: TENANT, projectId, event: 'organization-bound', at: T0 + index + 1, detail: { organizationRef: `org:law-${index}` } })).ok).toBe(true);
      expect((await direct.firmMemory.putKnowledge(TENANT, {
        record: { knowledgeId: `fkr:law-${index}`, ordinal: 1, tenant: TENANT, project: projectId, claim: { kind: 'claim' }, confidence: '0.800', evidenceCount: 1, provenance: { source: 'law' }, validity: { from: T0, to: null }, asOf: T0, priorChainHead: 'genesis' },
        status: 'active',
        supersededBy: null,
      })).ok).toBe(true);
      expect((await direct.outcomeLearning.putOutcome(TENANT, { outcomeId: `ocm:law-${index}`, ordinal: 1, tenant: TENANT, project: projectId, decisionRef: `dec:law-${index}`, outcomeClass: 'profit', expectation: {}, realization: {}, deviation: {}, evidence: [], lineage: {}, asOf: T0, priorChainHead: 'genesis' })).ok).toBe(true);
      expect((await direct.outcomeLearning.putPostMortem(TENANT, { postMortemId: `pmr:law-${index}`, ordinal: 1, tenant: TENANT, project: projectId, subject: {}, expected: {}, happened: {}, gap: {}, hypotheses: [], evidence: [], lineage: {}, asOf: T0, priorChainHead: 'genesis' })).ok).toBe(true);
      expect((await jobStore.putJobRecord(TENANT, { jobId: `job:${String(index).padStart(8, '0')}`, kind: 'research', tenant: TENANT, project: projectId, status: 'submitted', submittedAt: T0 + index })).ok).toBe(true);
    }
  }

  it('the cold-boot projection issues the SAME number of SQL round trips at 3 and at 30 durable projects (≤ 12) — and the batched reads hydrate the whole world', async () => {
    const counts: number[] = [];
    for (const projectCount of [3, 30]) {
      const providers = fakeProviders();
      await seedProjects(providers, projectCount);

      // THE COLD INSTANCE over the same durable store (the fake fleet's
      // in-memory tables), with a counting fetch around the injected one.
      let fetches = 0;
      const counting: FetchLike = (url, init) => {
        fetches += 1;
        return providers.fetchLike(url, init);
      };
      const instance = composeInstance(durableSource(), counting);
      expect(instance.ok).toBe(true);
      if (!instance.ok) return;
      await instance.durable!.settled(); // the boot projection — and nothing else

      // COMPLETENESS (the honesty half of the law): the batched reads
      // actually hydrated EVERY project's whole world — projects, binding
      // events, knowledge, outcomes, post-mortems and jobs alike.
      expect(instance.durable!.lastProjection()).toEqual({
        projects: projectCount,
        events: projectCount,
        knowledge: projectCount,
        outcomes: projectCount,
        postMortems: projectCount,
        jobs: projectCount,
        skipped: [],
      });
      // The rehydrated control plane serves the full registry (creation order).
      const listed = instance.service.handle({ method: 'GET', path: '/v1/projects', headers: BEARER, query: {} });
      expect(listed.status).toBe(200);
      const page = (listed.body as { data: { items: readonly { id: string; lifecycle: { organizationRef: string | null } }[] } }).data;
      expect(page.items.length).toBe(projectCount);
      expect(page.items[0]!.lifecycle.organizationRef).toBe('org:law-0'); // the binding event replayed through the real binder

      counts.push(fetches);
    }
    // THE LAW: the count is CONSTANT w.r.t. project count, and small.
    expect(counts[0]).toBe(counts[1]);
    expect(counts[0]).toBeLessThanOrEqual(12);
  });
});
