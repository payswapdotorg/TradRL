// deploy/vercel/seam-freshness.test.ts — THE FW-36-A TESTS (Round E register
// §3.1 + §3.4 + §3.5 + §3.8 — the export seam's last mile).
//
// WHAT IS PINNED (every fix through the FULL function handler —
// runtime/compose.ts + api/router.ts, the REAL Neon adapters over the fake
// provider fleet, no network):
//
//   (1) THE AWAITED OUTCOME FRESHNESS GATE (§3.1c — S5's stale export: an
//       export ~15s post-promote was missing records the surfaces already
//       rendered): a WARM instance whose serving projection predates a
//       promote that CONFIRMED on ANOTHER instance serves the promoted
//       record on its VERY NEXT outcome-family read — the fire-and-forget
//       staleness heal's window is closed on the read path itself, so the
//       export's read (the capsule fold's source) is the SAME FRESH seam
//       read the surfaces render from (no cache, no staleness gap), and
//       the fold-agreement law (FW-35-A) holds across the whole family.
//
//   (2) THE DETERMINISTIC COMPLETION INSTANT (§3.8 — L3's cross-record
//       timestamp disagreement: a promoted decision cited its producing
//       job completing at 00:09:58.876Z while the job's own sheet read
//       00:12:49.817Z, no reconciling note): the transition's `at` is the
//       EVENT'S own instant (the async pattern's schedule — submittedAt +
//       the offset), never the observer's wall clock — so two instances
//       that tick the SAME job at different wall instants write and serve
//       the IDENTICAL completed record, the durable row never flaps, and
//       the promote's frozen citation agrees with the job's own sheet at
//       every later read (ONE TRUTH PER INSTANT).
//
//   (3) THE DURABLE CONSOLE-EVENTS SEAM (§3.1 — the auditor's question
//       "which artifact is the record?"): the export's events telemetry,
//       PERSISTED LIKE THE RECORDS. A session posts its workspace-event
//       payloads; a FRESH instance (a new browser session / a cold start)
//       reads the WHOLE cross-session log — the events arm and the record
//       blocks finally agree on durability. Idempotent by content-addressed
//       id (a retried batch re-inserts nothing); L12 (the authorized
//       tenant's own rows); the append's writes CONFIRM before the response
//       (the ordering law — a failed write is the typed 503, the retry
//       heals); the auth + validation laws (the W-8 host-route family).
//
// Spec anchors: R43 (additive), R45, R46 (every failure path typed), L4
// (the L4 law applied to the risk fold — pinned in risk-utilization.test.ts
// + project-evidence.test.ts), L12, L20, the W-25D ordering law, ROUND-E
// REPORT §3 + §6 (FW-36-A).

import { describe, expect, it, vi } from 'vitest';
import { composeDeployment } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { fakeProviders } from '../wire/smoketest';
import { NeonJobStore, type NeonStoreDeps } from '../adapters/neon/stores';
import type { NeonConfig } from '../adapters/neon/client';
import type { FetchLike } from '../adapters/shared';
import { validConstraintSet, validGoal } from '../../services/api/src/fixtures';
import { DEMO_JOB_COMPLETE_AFTER_MS, DEMO_JOB_RUNNING_AFTER_MS, DEMO_PROJECT_ID } from './runtime/demo';
import type { FunctionRequest, FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// The fixed fake world (the record-durability harness law — never a real credential)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-fw36a';
const TOKEN = 'tok-deploy-fw36a';
const PRINCIPAL = 'public-console';
const NEON_KEYS = {
  NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech',
  NEON_DATABASE: 'neondb',
  NEON_API_USER: 'neondb_owner',
  NEON_API_KEY: 'fake-neon-key-fw36a',
};
const NEON_CONFIG: NeonConfig = {
  apiHost: NEON_KEYS.NEON_API_HOST,
  database: NEON_KEYS.NEON_DATABASE,
  apiUser: NEON_KEYS.NEON_API_USER,
  apiKey: NEON_KEYS.NEON_API_KEY,
};

/** The env source of a durable deployment with the internal credential (the machinery tick + the heal ride it). */
function durableSourceWithMachinery(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
    ...NEON_KEYS,
    [API_ENV_KEYS.apiInternalToken]: 'tok-internal-fw36a',
    [API_ENV_KEYS.apiInternalPrincipal]: 'fw36a-machinery',
    ...overrides,
  };
}

/** The fixed instant base of the scenario (deterministic durable rows + deterministic machinery ticks). */
const T0 = 1_800_600_000_000;

/** Compose one durable instance over the injected fetch (a fresh "serverless instance"). */
function composeInstance(source: Record<string, string | undefined>, fetchLike: FetchLike) {
  return composeDeployment(readApiEnv(source), {}, { fetchLike, instants: { next: () => T0 } });
}

/** A direct store over the fake fleet (row-level assertions against the durable truth). */
function storesOver(fetchLike: FetchLike): { jobs: NeonJobStore } {
  const deps: NeonStoreDeps = { config: NEON_CONFIG, fetchLike, instants: { next: () => T0 } };
  return { jobs: new NeonJobStore(deps) };
}

/** The bearer headers of the deployment's developer credential. */
const BEARER = { authorization: `Bearer ${TOKEN}` };

/** One create-project body (the REAL T007 goal/constraint shapes, tenant-scoped). */
function createProjectBody(projectId: string, at = T0): Record<string, unknown> {
  return { id: projectId, name: `the ${projectId} desk`, executionMode: 'simulation', goal: validGoal(TENANT), constraintSet: validConstraintSet(TENANT), at };
}

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

// ---------------------------------------------------------------------------
// The function-handler harness (the full path: settled -> boot world -> gate
// -> tick -> wrap -> host route -> boundary -> drain -> response)
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

type Deployment = ReturnType<typeof composeInstance>;

/** Drive one request through the FULL function handler; returns the parsed JSON body. */
async function drive(deployment: Deployment, request: FunctionRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const { response, captured } = capture();
  await handleDeploymentRequest(deployment, request, response);
  const written = captured();
  return { status: written.status, body: JSON.parse(written.payload ?? 'null') as Record<string, unknown> };
}

/** Flush the fire-and-forget heal's microtask chain (the fake fleet's fetch resolves on microtasks). */
async function flushAsyncWork(): Promise<void> {
  for (let settle = 0; settle < 400; settle += 1) await Promise.resolve();
}

/** The served outcome ids of one project (the frozen /v1/outcomes/query read — the export's outcome fold's own surface). */
async function outcomeIdsOf(deployment: Deployment, projectId: string, at = T0 + 60_000): Promise<readonly string[]> {
  const outcomes = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/outcomes/query', headers: BEARER, body: { project: projectId, at } }));
  expect(outcomes.status).toBe(200);
  return ((outcomes.body as { data: { items: readonly { outcomeId: string }[] } }).data).items.map((item) => item.outcomeId);
}

// ---------------------------------------------------------------------------
// (1) THE AWAITED OUTCOME FRESHNESS GATE — S5's stale export
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-36-A: the export seam freshness (S5\'s stale export, §3.1c)', () => {
  it('THE GATE: a WARM instance whose projection predates a promote that CONFIRMED on ANOTHER instance serves the promoted record on its VERY NEXT outcome read — the export read is the same FRESH seam read the surfaces render from (the heal window closed on the read path)', async () => {
    vi.useFakeTimers();
    try {
      const providers = fakeProviders();
      const project = 'prj-fw36a-fresh';

      // INSTANCE B boots FIRST at T0 (WARM — its boot projection + heal interval
      // predate the whole scenario; the pre-fix heal is fire-and-forget).
      vi.setSystemTime(T0);
      const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceB.ok).toBe(true);
      if (!instanceB.ok) return;
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER })); // the boot world settles; the heal ARMS at T0

      // INSTANCE A carries the launch at T0 (the console's flow): create + the
      // console-launch kickoff. A's request-path tick compiles the org.
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      const created = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'content-type': 'application/json' }, body: createProjectBody(project) }));
      expect(created.status).toBe(201);
      const kickoff = await drive(instanceA, streamingRequest({
        method: 'POST',
        url: '/v1/jobs/research',
        headers: { ...BEARER, 'idempotency-key': 'idem:fw36a:fresh:kickoff' },
        body: { kind: 'research', projectId: project, spec: consoleLaunchSpec() },
      }));
      expect(kickoff.status).toBe(202);
      const jobId = (kickoff.body as { data: { jobId: string } }).data.jobId;

      // T0+11s: B's heal fires (its interval elapsed) — B's projection learns the
      // project via the registry probe + the quiet re-projection, and the jobs
      // half replays the kickoff ('submitted' at this instant) into B's store.
      // THIS is the warm state S5's console session was in: B KNOWS the project,
      // and B's projection holds no promoted outcome row — none exists yet.
      vi.setSystemTime(T0 + 11_000);
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      await flushAsyncWork();

      // T0+12s: A's tick completes the kickoff (the deterministic schedule —
      // see (2) below) and the write-through drains with A's request.
      vi.setSystemTime(T0 + 12_000);
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));

      // T0+13s: A PROMOTES (the promote path's drain confirms — the promoted
      // decision is durable TRUTH from this instant on; A's own registry serves
      // it, so A's surfaces render it immediately — exactly S5's promote).
      vi.setSystemTime(T0 + 13_000);
      const promoted = await drive(instanceA, streamingRequest({ method: 'POST', url: `/v1/jobs/${jobId}/promote`, headers: BEARER }));
      expect(promoted.status).toBe(200);
      const decision = (promoted.body as { data: { decision: { outcomeId: string; promotedFromJob: string }; replay: boolean } }).data.decision;
      expect(decision.promotedFromJob).toBe(jobId);
      const beforeOnA = await outcomeIdsOf(instanceA, project);
      expect(beforeOnA).toContain(decision.outcomeId); // A's surfaces render it — S5 observed exactly this

      // T0+15s — S5's export window: B's outcome read lands INSIDE the heal
      // interval (B's last heal attempt was T0+11s; the next is not eligible
      // until T0+21s). PRE-FW-36-A the fire-and-forget heal had not landed and
      // B served the STALE projection — the export's capsule fold then MISSED
      // the promoted decision + its capsule while the surfaces rendered both
      // (S5: "md5-identical to exp1 — the promotion decision + capsule MISSING
      // from the export while BOTH render on Decisions/Evidence surfaces").
      // POST-FW-36-A: the AWAITED GATE probes the durable truth, finds the
      // promoted row of a project B's projection SERVES whose id it LACKS, and
      // the quiet re-projection runs to completion BEFORE the read serves.
      vi.setSystemTime(T0 + 15_000);
      const served = await outcomeIdsOf(instanceB, project);
      expect(served).toContain(decision.outcomeId); // THE FRESH READ — never the stale snapshot
      // The promoted decision rides the page EXACTLY ONCE (idempotent by the
      // content-addressed id — the wrapper's own dedup law).
      expect(served.filter((id) => id === decision.outcomeId)).toHaveLength(1);

      // THE FOLD-AGREEMENT LAW (FW-35-A, now freshness-gated): the hydration
      // read's outcome count — the SAME wrapped chain — counts the promoted
      // decision on the SAME warm instance (never the pre-fix divergent zero).
      const hydration = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/projects/${project}/hydration`, headers: BEARER }));
      expect(hydration.status).toBe(200);
      const hydrationRecords = ((hydration.body as { data: { records: { outcomes: number | null } } }).data).records;
      expect(hydrationRecords.outcomes).toBe(served.length); // one count, every fold

      // And the standing risk read's own fold agrees too (the same port chain).
      const risk = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/risk/utilization?project=${encodeURIComponent(project)}`, headers: BEARER }));
      expect(risk.status).toBe(200);
      const riskDisclosure = ((risk.body as { data: { disclosure: string } }).data).disclosure;
      expect(riskDisclosure).toContain('DURABLE seam');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// (2) THE DETERMINISTIC COMPLETION INSTANT — L3's cross-record disagreement
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-36-A: one truth per instant (L3\'s cross-record timestamp disagreement, §3.8)', () => {
  it('THE SCHEDULE STAMPS THE EVENT, NEVER THE OBSERVER: two instances tick the SAME kickoff at different wall instants and both serve the IDENTICAL completed record (submittedAt + the schedule); the durable row never flaps; the promote\'s frozen citation agrees with the job\'s own sheet', async () => {
    vi.useFakeTimers();
    try {
      const providers = fakeProviders();
      const project = 'prj-fw36a-agree';

      // INSTANCE B first (warm — it will complete its OWN replayed copy much
      // later, at a different wall instant than A's: the pre-fix flap).
      vi.setSystemTime(T0);
      const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceB.ok).toBe(true);
      if (!instanceB.ok) return;
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));

      // INSTANCE A: the launch + the kickoff at T0.
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      const created = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'content-type': 'application/json' }, body: createProjectBody(project) }));
      expect(created.status).toBe(201);
      const kickoff = await drive(instanceA, streamingRequest({
        method: 'POST',
        url: '/v1/jobs/research',
        headers: { ...BEARER, 'idempotency-key': 'idem:fw36a:agree:kickoff' },
        body: { kind: 'research', projectId: project, spec: consoleLaunchSpec() },
      }));
      expect(kickoff.status).toBe(202);
      const jobId = (kickoff.body as { data: { jobId: string; submittedAt: number } }).data.jobId;
      const submittedAt = (kickoff.body as { data: { submittedAt: number } }).data.submittedAt;
      expect(submittedAt).toBe(T0); // the submission landed at the wall clock T0

      // B's heal at T0+11s replays the 'submitted' record into B's own store
      // (B now holds a NON-TERMINAL copy — the pre-fix divergence's fuel).
      vi.setSystemTime(T0 + 11_000);
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      await flushAsyncWork();

      // T0+12s: A's tick completes A's copy. PRE-FW-36-A the completedAt was
      // the REQUEST instant (T0+12s on A); POST-FW-36-A it is the SCHEDULE's
      // own event instant — submittedAt + 8s — never the observer's.
      vi.setSystemTime(T0 + 12_000);
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      const onA = await drive(instanceA, streamingRequest({ method: 'GET', url: `/v1/jobs/${jobId}`, headers: BEARER }));
      expect(((onA.body as { data: { status: string; completedAt?: number } }).data).status).toBe('complete');
      const completedAtA = ((onA.body as { data: { completedAt?: number } }).data).completedAt;
      expect(completedAtA).toBe(submittedAt + DEMO_JOB_COMPLETE_AFTER_MS); // THE SCHEDULE, not T0+12_000

      // T0+60s: B's OWN tick completes B's replayed copy at a wall instant
      // ~48s after A's — the pre-fix scenario wrote a SECOND, different
      // completedAt (the newest-upsert flap: whichever instance completed
      // last won the durable row, and the promote's frozen citation disagreed
      // with the sheet's later serve — L3's 00:09:58.876Z vs 00:12:49.817Z).
      // POST-FW-36-A both instances stamp the SAME schedule instant.
      vi.setSystemTime(T0 + 60_000);
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      await flushAsyncWork();
      const onB = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/jobs/${jobId}`, headers: BEARER }));
      expect(((onB.body as { data: { status: string } }).data).status).toBe('complete');
      const completedAtB = ((onB.body as { data: { completedAt?: number } }).data).completedAt;
      expect(completedAtB).toBe(completedAtA); // ONE TRUTH — both instances agree

      // THE DURABLE ROW never flapped: whichever write landed last carries the
      // identical payload (the newest-upsert is a content no-op).
      const direct = storesOver(providers.fetchLike);
      const durableRows = await direct.jobs.jobRecordsOf(TENANT, project);
      expect(durableRows.ok).toBe(true);
      if (durableRows.ok) {
        const row = durableRows.value.find((record) => (record as { jobId: string }).jobId === jobId) as { completedAt?: number } | undefined;
        expect(row?.completedAt).toBe(completedAtA);
      }

      // THE PROMOTION'S FROZEN CITATION (the rationale quotes the completedAt
      // its instance's store held at mint time) agrees with the job's own
      // sheet at every later read — L3's cross-record case, closed.
      vi.setSystemTime(T0 + 70_000);
      const promoted = await drive(instanceA, streamingRequest({ method: 'POST', url: `/v1/jobs/${jobId}/promote`, headers: BEARER }));
      expect(promoted.status).toBe(200);
      const rationale = ((promoted.body as { data: { decision: { decisionRationale: string } } }).data).decision.decisionRationale;
      expect(rationale).toContain(`completed at ${new Date(completedAtA as number).toISOString()}`);
      // ...and the sheet (served by the OTHER instance, later) still agrees.
      const sheet = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/jobs/${jobId}`, headers: BEARER }));
      expect(((sheet.body as { data: { completedAt?: number } }).data).completedAt).toBe(completedAtA);
    } finally {
      vi.useRealTimers();
    }
  });

  it('THE RUNNING TRANSITION rides the same law (submittedAt + the running offset, never the observer) — the machinery battery re-pinned for the launched desk', async () => {
    vi.useFakeTimers();
    try {
      const providers = fakeProviders();
      const project = 'prj-fw36a-running';
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      const created = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'content-type': 'application/json' }, body: createProjectBody(project) }));
      expect(created.status).toBe(201);
      const kickoff = await drive(instanceA, streamingRequest({
        method: 'POST',
        url: '/v1/jobs/research',
        headers: { ...BEARER, 'idempotency-key': 'idem:fw36a:running:kickoff' },
        body: { kind: 'research', projectId: project, spec: consoleLaunchSpec() },
      }));
      expect(kickoff.status).toBe(202);
      const jobId = (kickoff.body as { data: { jobId: string; submittedAt: number } }).data.jobId;

      // Before the running schedule elapses: nothing advances (the age gate).
      vi.setSystemTime(T0 + DEMO_JOB_RUNNING_AFTER_MS - 1);
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      const early = await drive(instanceA, streamingRequest({ method: 'GET', url: `/v1/jobs/${jobId}`, headers: BEARER }));
      expect(((early.body as { data: { status: string } }).data).status).toBe('submitted');

      // At T0+4s (a wall instant PAST the 3s running offset): the transition
      // is stamped at the SCHEDULE's instant (T0+3s), never T0+4s.
      vi.setSystemTime(T0 + 4_000);
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      const running = await drive(instanceA, streamingRequest({ method: 'GET', url: `/v1/jobs/${jobId}`, headers: BEARER }));
      const runningRecord = (running.body as { data: { status: string; completedAt?: number; submittedAt: number } }).data;
      expect(runningRecord.status).toBe('running');
      expect(runningRecord.completedAt).toBeUndefined(); // a running record carries no completion yet — never a fabricated one
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// (3) THE DURABLE CONSOLE-EVENTS SEAM — the auditor's question
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-36-A: the durable console-events seam (the auditor\'s question, §3.1)', () => {
  it('THE DURABLE CHAIN: session 1 posts its events; a FRESH instance (a new browser session / a cold start) reads the WHOLE cross-session log in the events\' own instant order — the events arm of the export finally persists like the record blocks', async () => {
    const providers = fakeProviders();
    const project = 'prj-fw36a-events';
    const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(instanceA.ok).toBe(true);
    if (!instanceA.ok) return;
    await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'content-type': 'application/json' }, body: createProjectBody(project) }));
    expect((await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/jobs/research', headers: { ...BEARER, 'idempotency-key': 'idem:fw36a:events:kickoff' }, body: { kind: 'research', projectId: project, spec: consoleLaunchSpec() } }))).status).toBe(202);

    // SESSION 1 (page 1): the console's own event vocabulary, posted as the
    // exact payloads its reducer linked (the kinds the personas measured
    // collapsing 623→123 across a restart).
    const sessionOneBatch = [
      { kind: 'connection-changed', at: T0 + 1_000, status: 'connected' },
      { kind: 'project-adopted', at: T0 + 2_000, projectId: project },
      { kind: 'job-updated', at: T0 + 3_000, job: { jobId: 'job:1', status: 'complete' } },
      { kind: 'outcome-recorded', at: T0 + 4_000, outcome: { outcomeId: 'out:1' } },
      { kind: 'anchor-advanced', at: T0 + 5_000 },
    ];
    const appended = await drive(instanceA, streamingRequest({ method: 'POST', url: `/v1/projects/${project}/events`, headers: { ...BEARER, 'content-type': 'application/json' }, body: { events: sessionOneBatch } }));
    expect(appended.status).toBe(200);
    expect((appended.body as { data: { projectId: string; accepted: number } }).data).toMatchObject({ projectId: project, accepted: 5 });

    // SESSION 2 (a fresh browser session on ANOTHER instance — the M3 restart:
    // pre-FW-36-A its export carried 123 events with ZERO digest overlap):
    // it posts ITS OWN events, then reads the log — and the read serves BOTH
    // sessions' events, the whole project history in one chain.
    const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(instanceB.ok).toBe(true);
    if (!instanceB.ok) return;
    await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER })); // the boot world settles
    const sessionTwoBatch = [
      { kind: 'connection-changed', at: T0 + 60_000, status: 'connected' },
      { kind: 'outcomes-loaded', at: T0 + 61_000, records: [] },
    ];
    const appendedTwo = await drive(instanceB, streamingRequest({ method: 'POST', url: `/v1/projects/${project}/events`, headers: { ...BEARER, 'content-type': 'application/json' }, body: { events: sessionTwoBatch } }));
    expect(appendedTwo.status).toBe(200);
    expect(((appendedTwo.body as { data: { accepted: number } }).data).accepted).toBe(2);

    // THE READ (on a THIRD fresh instance — the coldest possible start): the
    // WHOLE log, both sessions, the events' own instant order.
    const instanceC = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(instanceC.ok).toBe(true);
    if (!instanceC.ok) return;
    await drive(instanceC, streamingRequest({ method: 'GET', url: '/v1/projects', headers: BEARER }));
    const read = await drive(instanceC, streamingRequest({ method: 'GET', url: `/v1/projects/${project}/events`, headers: BEARER }));
    expect(read.status).toBe(200);
    const items = ((read.body as { data: { items: readonly { at: number; event: Record<string, unknown> }[]; disclosure: string } }).data).items;
    expect(items.map((entry) => entry.event)).toEqual([...sessionOneBatch, ...sessionTwoBatch]); // the exact payloads, the true event sequence
    expect(items.map((entry) => entry.at)).toEqual([...sessionOneBatch, ...sessionTwoBatch].map((event) => event.at)); // the events' OWN instants, in order
    expect(((read.body as { data: { disclosure: string } }).data).disclosure).toContain('this log is the record');
  });

  it('THE IDEMPOTENT RETRY: the same batch posted twice (a 503\'d append\'s retry) inserts nothing twice — the log stays exactly-once', async () => {
    const providers = fakeProviders();
    const project = 'prj-fw36a-idem';
    const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(instanceA.ok).toBe(true);
    if (!instanceA.ok) return;
    await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'content-type': 'application/json' }, body: createProjectBody(project) }));
    const batch = [
      { kind: 'section-selected', at: T0 + 1_000, section: 'evidence' },
      { kind: 'view-timestamp', at: T0 + 2_000, timestamp: T0 + 2_000 },
    ];
    const first = await drive(instanceA, streamingRequest({ method: 'POST', url: `/v1/projects/${project}/events`, headers: { ...BEARER, 'content-type': 'application/json' }, body: { events: batch } }));
    expect(first.status).toBe(200);
    // The retry (the console re-posts its unconfirmed batch).
    const retry = await drive(instanceA, streamingRequest({ method: 'POST', url: `/v1/projects/${project}/events`, headers: { ...BEARER, 'content-type': 'application/json' }, body: { events: batch } }));
    expect(retry.status).toBe(200);
    const read = await drive(instanceA, streamingRequest({ method: 'GET', url: `/v1/projects/${project}/events`, headers: BEARER }));
    const items = ((read.body as { data: { items: readonly { event: Record<string, unknown> }[] } }).data).items;
    expect(items).toHaveLength(2); // EXACTLY ONCE — the content-addressed id collides, nothing re-inserts
    expect(items.map((entry) => entry.event)).toEqual(batch);
  });

  it('THE LAWS: authn first (the typed 401); a malformed batch is the typed validation failure; an unknown project\'s append is the typed not-found; the read of an unknown project is the honest empty; under the DEMO backing the routes fall through (the pre-law)', async () => {
    const providers = fakeProviders();
    const instance = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
    expect(instance.ok).toBe(true);
    if (!instance.ok) return;
    const project = 'prj-fw36a-laws';
    await drive(instance, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'content-type': 'application/json' }, body: createProjectBody(project) }));

    // Authn first: no/garbage Bearer -> the typed 401.
    const noToken = await drive(instance, streamingRequest({ method: 'GET', url: `/v1/projects/${project}/events` }));
    expect(noToken.status).toBe(401);
    expect(((noToken.body as { error: { code: string } }).error).code).toBe('unauthenticated');
    const wrongToken = await drive(instance, streamingRequest({ method: 'POST', url: `/v1/projects/${project}/events`, headers: { authorization: 'Bearer tok-wrong' }, body: { events: [{ kind: 'x', at: 1 }] } }));
    expect(wrongToken.status).toBe(401);

    // A malformed batch: the typed validation failure, NOTHING appended.
    const before = await drive(instance, streamingRequest({ method: 'GET', url: `/v1/projects/${project}/events`, headers: BEARER }));
    const beforeCount = (((before.body as { data: { items: readonly unknown[] } }).data).items).length;
    for (const malformed of [
      { events: 'not-an-array' },
      { events: [] },
      { events: [{ at: 5 }, { kind: 'x', at: 5 }] }, // a missing kind
      { events: [{ kind: 'x' }] }, // a missing instant
      { events: [{ kind: 'x', at: 0 }] }, // a non-positive instant
      { events: [{ kind: 'x', at: 1.5 }] }, // a non-integer instant
      'not-an-object',
    ]) {
      const refused = await drive(instance, streamingRequest({ method: 'POST', url: `/v1/projects/${project}/events`, headers: { ...BEARER, 'content-type': 'application/json' }, body: malformed as unknown }));
      expect(refused.status).toBe(400);
      expect(((refused.body as { error: { code: string } }).error).code).toBe('validation_failed');
    }
    const after = await drive(instance, streamingRequest({ method: 'GET', url: `/v1/projects/${project}/events`, headers: BEARER }));
    expect((((after.body as { data: { items: readonly unknown[] } }).data).items).length).toBe(beforeCount); // nothing crossed

    // An unknown project's append: the typed not-found (the durable-truth gate).
    const unknown = await drive(instance, streamingRequest({ method: 'POST', url: '/v1/projects/prj-never-created/events', headers: { ...BEARER, 'content-type': 'application/json' }, body: { events: [{ kind: 'x', at: 1 }] } }));
    expect(unknown.status).toBe(404);
    expect(((unknown.body as { error: { code: string } }).error).code).toBe('not_found');

    // The read of an unknown project: the HONEST EMPTY (the read-route family's law).
    const emptyRead = await drive(instance, streamingRequest({ method: 'GET', url: '/v1/projects/prj-never-created/events', headers: BEARER }));
    expect(emptyRead.status).toBe(200);
    expect((((emptyRead.body as { data: { items: readonly unknown[] } }).data).items).length).toBe(0);

    // A foreign method on the path: the fall-through (the boundary's own answer).
    const put = await drive(instance, streamingRequest({ method: 'PUT', url: `/v1/projects/${project}/events`, headers: { ...BEARER, 'content-type': 'application/json' }, body: {} }));
    expect(put.status).toBe(404);

    // Under the DEMO backing the routes fall through (the events seam is the
    // DURABLE arm's surface — the pre-law, byte-identical).
    const demoEnv: Record<string, string | undefined> = { ...durableSourceWithMachinery() };
    delete demoEnv[NEON_KEYS.NEON_API_HOST as string];
    delete demoEnv[NEON_KEYS.NEON_DATABASE as string];
    delete demoEnv[NEON_KEYS.NEON_API_USER as string];
    delete demoEnv[NEON_KEYS.NEON_API_KEY as string];
    const demo = composeInstance(demoEnv, providers.fetchLike);
    expect(demo.ok).toBe(true);
    if (!demo.ok) return;
    const fellThrough = await drive(demo, streamingRequest({ method: 'GET', url: `/v1/projects/${DEMO_PROJECT_ID}/events`, headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(fellThrough.status).toBe(404);
    expect(((fellThrough.body as { error: { code: string } }).error).code).toBe('not_found');
  });
});
