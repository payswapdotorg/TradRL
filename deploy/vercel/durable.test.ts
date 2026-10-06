// deploy/vercel/durable.test.ts — THE W-3e HYDRATION SEAM TESTS (W-25D, defect D-5).
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
//       serving the rehydrated goal set — the W-23 console fetch's answer).
//
// Spec anchors: R46, ARCHITECTURE-LOCK L4/L8/L12/L15, D-033, D-5;
// deploy/wire/production.md (the composition law).

import { describe, expect, it } from 'vitest';
import { composeDeployment, DEPLOY_ADAPTER_PENDING } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { fakeProviders } from '../wire/smoketest';
import { NeonFirmMemoryStore, NeonOutcomeLearningStore, NeonProjectStore, type NeonStoreDeps } from '../adapters/neon/stores';
import type { NeonConfig } from '../adapters/neon/client';
import type { FetchLike } from '../adapters/shared';
import { validConstraintSet, validGoal, validStrategyIntent } from '../../services/api/src/fixtures';
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
    expect(items.map((project) => project.id)).toEqual(['prj-durable-desk-b']);
    const goal = await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/projects/prj-durable-desk-b/goal', headers: BEARER }));
    expect(goal.status).toBe(200);
    const goalBody = (goal.body as { data: { goal: unknown; constraintSet: unknown } }).data;
    expect(goalBody.goal).toEqual(validGoal(TENANT));
    expect(goalBody.constraintSet).toEqual(validConstraintSet(TENANT));
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

  it('the router integration: the drain failure replaces the response with the typed 503 (the same request id; the mutation is unconfirmed)', async () => {
    const providers = fakeProviders();
    const outage = outageFetch(providers.fetchLike);
    const deployment = composeInstance(durableSource(), outage.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    await deployment.durable!.settled();

    outage.setOutage(true);
    const response = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: BEARER, body: createProjectBody('prj-unconfirmed') }));
    expect(response.status).toBe(503);
    const error = (response.body as { requestId: unknown; error: { code: string; message: string } }).error;
    expect(error.code).toBe('unavailable');
    expect(error.message).toContain('neon_unreachable');
    expect(error.message).toContain('unconfirmed');
    expect((response.body as { requestId: unknown }).requestId).toBe(response.headers['x-request-id']); // the SAME request id the boundary minted
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
