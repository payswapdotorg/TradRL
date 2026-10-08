// deploy/vercel/record-durability.test.ts — THE FW-33-A TESTS (Round B
// blocker 1 — the launched-desk record durability wave, the round's #1
// finding: S5/M1/L3/S1/S2/M5).
//
// WHAT IS PINNED (the defect's whole class, through the FULL function
// handler — runtime/compose.ts + api/router.ts, the REAL Neon adapters
// over the fake provider fleet, no network):
//
//   (a) THE FRESH-INSTANCE FOLD: a promoted decision minted by the host
//       promote route (POST /v1/jobs/:jobId/promote) WRITE-THROUGHS into
//       tradrl_outcomes (the outcome lane — the same putOutcome path the
//       boot-world fixtures ride) and a NEW serverless instance's boot
//       projection SERVES it: the decision/outcome read, the derived
//       stream (blotter + post-mortem) and the per-id job read all answer
//       on the fresh instance, never the pre-fix honest emptiness (S5:
//       "capsules 8->3, gateway decisions 1->0" — the export's folds lost
//       the records; the export folds over exactly these surfaces).
//
//   (b) THE HEAL PATH: instance A promotes; instance B — WARM, booted
//       BEFORE the promotion, its registry never minted the record —
//       serves the honest emptiness BEFORE its bounded staleness heal,
//       then the heal (the FW-31-B interval, extended by FW-33-A to the
//       outcome/post-mortem/knowledge surfaces + the QUIET re-projection)
//       lands the fresh truth and the record SERVES on the same warm
//       instance — exactly once, deduped by outcomeId. The re-promotion
//       on B mints the SAME content-addressed id (the identity law).
//
//   (c) THE EXPORT MANIFEST STABILITY: every record set the console's
//       export folds (outcomes, post-mortems, knowledge, submissions, the
//       completed jobs with results) is IDENTICAL across instance
//       recreation — the seed's manifest counts match the fresh
//       instance's, per surface, per project (the demo scope's fixture
//       substance included). THE EXPORT NEVER LOSES A RECORD.
//
// Spec anchors: R46 (every failure path typed), L12 (the authorized
// tenant's own rows only), L20 (the heal re-folds, never re-decides),
// the W-25D ordering law (the mint's write rides the pending drain), the
// W-30 round-trip law (the boot projection's reads stay seven — the heal
// adds CONSTANT per-interval reads), ROUND-B-REPORT §3 defect 1 + §5
// (FW-33-A).
//
// Honest disclosures pinned in comments: the LIVE gateway rows of the
// recording execution gateway remain per-instance (no durable submissions
// table exists — outside this wave's surface); the mint's write CONFIRMS
// on the next request's drain (the promote route is sync-hosted).

import { describe, expect, it, vi } from 'vitest';
import { composeDeployment } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { fakeProviders } from '../wire/smoketest';
import { NeonOutcomeLearningStore, NeonProjectStore, type NeonStoreDeps } from '../adapters/neon/stores';
import type { NeonConfig } from '../adapters/neon/client';
import type { FetchLike } from '../adapters/shared';
import { validConstraintSet, validGoal } from '../../services/api/src/fixtures';
import { DEMO_PROJECT_ID } from './runtime/demo';
import { HYDRATION_AT } from './runtime/durable';
import type { FunctionRequest, FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// The fixed fake world (the durable.test.ts harness law — never a real credential)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-fw33a';
const TOKEN = 'tok-deploy-fw33a';
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

/** The env source of a durable deployment with the internal credential (the machinery tick + the heal ride it). */
function durableSourceWithMachinery(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
    ...NEON_KEYS,
    [API_ENV_KEYS.apiInternalToken]: 'tok-internal-fw33a',
    [API_ENV_KEYS.apiInternalPrincipal]: 'fw33a-machinery',
    ...overrides,
  };
}

/** The fixed instant base of the scenario (deterministic durable rows + deterministic machinery ticks). */
const T0 = 1_800_500_000_000;

/** Compose one durable instance over the injected fetch (a fresh "serverless instance"). */
function composeInstance(source: Record<string, string | undefined>, fetchLike: FetchLike) {
  return composeDeployment(readApiEnv(source), {}, { fetchLike, instants: { next: () => T0 } });
}

/** A direct store over the fake fleet (row-level assertions against the durable truth). */
function storesOver(fetchLike: FetchLike): { outcomeLearning: NeonOutcomeLearningStore; project: NeonProjectStore } {
  const deps: NeonStoreDeps = { config: NEON_CONFIG, fetchLike, instants: { next: () => T0 } };
  return { outcomeLearning: new NeonOutcomeLearningStore(deps), project: new NeonProjectStore(deps) };
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

type Deployment = ReturnType<typeof composeInstance>;

/** Drive one request through the FULL function handler; returns the parsed JSON body. */
async function drive(deployment: Deployment, request: FunctionRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const { response, captured } = capture();
  await handleDeploymentRequest(deployment, request, response);
  const written = captured();
  return { status: written.status, body: JSON.parse(written.payload ?? 'null') as Record<string, unknown> };
}

/** Flush the fire-and-forget heal's microtask chain (the fake fleet's fetch resolves on microtasks; the heal + a quiet refresh ride ~12 awaited fetches). */
async function flushAsyncWork(): Promise<void> {
  for (let settle = 0; settle < 400; settle += 1) await Promise.resolve();
}

/**
 * THE LAUNCHED-DESK SEED (the console's flow, every step through the FULL
 * handler): create the project, submit the console-launch kickoff job, let
 * the machinery tick complete it (the release-candidate result), and —
 * optionally — PROMOTE it. Returns the kickoff job's id + the promoted
 * decision (when the promote step ran).
 */
async function seedLaunchedDesk(
  deployment: Deployment,
  projectId: string,
  idempotencyPrefix: string,
): Promise<{ readonly jobId: string; readonly status: string; readonly result: { readonly kind: string } }> {
  const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'content-type': 'application/json' }, body: createProjectBody(projectId) }));
  expect(created.status).toBe(201);
  const kickoff = await drive(deployment, streamingRequest({
    method: 'POST',
    url: '/v1/jobs/research',
    headers: { ...BEARER, 'idempotency-key': `idem:${idempotencyPrefix}:kickoff` },
    body: { kind: 'research', projectId, spec: consoleLaunchSpec() },
  }));
  expect(kickoff.status).toBe(202); // the kickoff request's tick compiled the org (the R4 pass)
  const jobId = (kickoff.body as { data: { jobId: string } }).data.jobId;
  // The machinery tick at +10s completes the job (age >= the 8s schedule).
  vi.setSystemTime(T0 + 10_000);
  const progressed = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
  expect(progressed.status).toBe(200);
  const finished = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/jobs/${jobId}`, headers: BEARER }));
  expect(finished.status).toBe(200);
  return (finished.body as { data: { jobId: string; status: string; result: { kind: string } } }).data;
}

/** The served outcome ids of one project (the frozen /v1/outcomes/query read — the export's outcome fold's own surface). */
async function outcomeIdsOf(deployment: Deployment, projectId: string): Promise<readonly string[]> {
  const outcomes = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/outcomes/query', headers: BEARER, body: { project: projectId, at: T0 + 60_000 } }));
  expect(outcomes.status).toBe(200);
  return ((outcomes.body as { data: { items: readonly { outcomeId: string }[] } }).data).items.map((record) => record.outcomeId);
}

/** The served post-mortem ids of one project (the export's post-mortem fold's own surface). */
async function postMortemIdsOf(deployment: Deployment, projectId: string): Promise<readonly string[]> {
  const mortems = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/post-mortems/query', headers: BEARER, body: { project: projectId, at: T0 + 60_000, latestPerOutcome: true } }));
  expect(mortems.status).toBe(200);
  return ((mortems.body as { data: { items: readonly { postMortemId: string }[] } }).data).items.map((record) => record.postMortemId);
}

/** The served knowledge ids of one project (the export's knowledge fold's own surface). */
async function knowledgeIdsOf(deployment: Deployment, projectId: string): Promise<readonly string[]> {
  const knowledge = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/knowledge/query', headers: BEARER, body: { project: projectId, at: T0 + 60_000 } }));
  expect(knowledge.status).toBe(200);
  return ((knowledge.body as { data: { items: readonly { record: { knowledgeId: string } }[] } }).data).items.map((entry) => entry.record.knowledgeId);
}

/** The served execution-submission ids of one project (the export's gateway-decision fold's own surface). */
async function submissionIdsOf(deployment: Deployment, projectId: string): Promise<readonly string[]> {
  const blotter = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/execution/submissions?project=${encodeURIComponent(projectId)}`, headers: BEARER }));
  expect(blotter.status).toBe(200);
  return ((blotter.body as { data: { items: readonly { submissionId: string }[] } }).data).items.map((row) => row.submissionId);
}

/** The served job records of one project (the export's job-capsule fold's own surface — the completed-with-result ones). */
async function jobsOf(deployment: Deployment, projectId: string): Promise<readonly { jobId: string; status: string; result: unknown }[]> {
  const jobs = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/jobs?project=${encodeURIComponent(projectId)}`, headers: BEARER }));
  expect(jobs.status).toBe(200);
  return ((jobs.body as { data: { items: readonly { jobId: string; status: string; result: unknown }[] } }).data).items;
}

/** The export-manifest-equivalent record snapshot of one project (every surface composeWorkspaceExport folds over — the R9b counts' own inputs). */
async function exportFoldOf(deployment: Deployment, projectId: string) {
  const [outcomes, postMortems, knowledge, submissions, jobs] = await Promise.all([
    outcomeIdsOf(deployment, projectId),
    postMortemIdsOf(deployment, projectId),
    knowledgeIdsOf(deployment, projectId),
    submissionIdsOf(deployment, projectId),
    jobsOf(deployment, projectId),
  ]);
  return {
    // The serve ORDER legitimately differs across instances (base rows
    // first vs wrapper-appended — both are the same record SET); the export
    // folds count records, so the stability pin compares the SETS.
    outcomes: [...outcomes].sort(),
    postMortems: [...postMortems].sort(),
    knowledge: [...knowledge].sort(),
    submissions: [...submissions].sort(),
    jobs: jobs.map((job) => ({ jobId: job.jobId, status: job.status })),
    // The manifest count equivalents (apps/web composeWorkspaceExport's counts):
    capsules: outcomes.length + postMortems.length + knowledge.length + submissions.length + jobs.filter((job) => job.status === 'complete' && job.result !== null && typeof job.result === 'object').length,
    decisionsGateway: submissions.length,
  };
}

// ---------------------------------------------------------------------------
// (a) THE FRESH-INSTANCE FOLD — promote -> write-through -> a NEW instance serves
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-33-A: the promoted decision persists (the fresh-instance fold)', () => {
  it('promote -> the mint WRITE-THROUGHS into tradrl_outcomes (the same putOutcome lane the boot fixtures ride) -> a NEW instance\'s boot serves the decision + the derived stream + the job (never the pre-fix honest emptiness)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // the boot world settles

      // THE LAUNCH + THE COMPLETION (the console's flow, the full handler).
      const finished = await seedLaunchedDesk(instanceA, 'prj-fw33a-fold', 'fw33a-fold');
      expect(finished.status).toBe('complete');
      expect(finished.result.kind).toBe('release-candidate');

      // THE PROMOTION (the host-owned route, before the boundary wrap) —
      // the mint queues its durable write-through at MINT time.
      const promoted = await drive(instanceA, streamingRequest({ method: 'POST', url: `/v1/jobs/${finished.jobId}/promote`, headers: BEARER }));
      expect(promoted.status).toBe(200);
      const decision = (promoted.body as { data: { decision: { outcomeId: string; promotedFromJob: string; decisionBody: string }; replay: boolean } }).data.decision;
      expect(decision.promotedFromJob).toBe(finished.jobId);
      expect(decision.decisionBody).toBe('desk:research-promotion');

      // A's OWN serve (the registry-backed read): the decision serves
      // ALONGSIDE the derived outcome — exactly once (dedupe by outcomeId).
      const servedOnA = await outcomeIdsOf(instanceA, 'prj-fw33a-fold');
      expect(servedOnA.filter((id) => id === decision.outcomeId)).toHaveLength(1);

      // THE DRAIN (the ordering law): the promote route is sync-hosted, so
      // the mint's write confirms on the NEXT request's drain — the
      // console's own beat cadence (its 1s job poll) drains it within a beat.
      const drained = await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      expect(drained.status).toBe(200);

      // THE DURABLE TRUTH: the row is in tradrl_outcomes — the store-level
      // pin (the write-through landed, the (tenant, outcome id) upsert).
      const direct = storesOver(providers.fetchLike);
      const storedOutcomes = await direct.outcomeLearning.queryOutcomes({ tenant: TENANT, project: 'prj-fw33a-fold' }, { at: HYDRATION_AT, retention: null });
      expect(storedOutcomes.ok).toBe(true);
      // FW-33-B (pre-existing, fixed en route): the narrowing the .value
      // access below needs — the file's own idiom; FW-33-A shipped this
      // line missing (a type error on main, caught by this wave's gate).
      if (!storedOutcomes.ok) return;
      expect((storedOutcomes.value as readonly { outcomeId: string }[]).some((row) => row.outcomeId === decision.outcomeId)).toBe(true);

      // THE FRESH INSTANCE (the reload-equivalent: a new serverless
      // instance boots from the durable truth alone — its promotion
      // registry is EMPTY, so the record can only serve from the store).
      const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceB.ok).toBe(true);
      if (!instanceB.ok) return;
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // the boot world settles + hydrates

      // THE DECISION SERVES on the fresh instance (the pre-fix defect: the
      // registry was per-instance, the record vanished — S5's "gateway
      // decisions 1->0" + the decision's capsule "8->3").
      const servedOnB = await outcomeIdsOf(instanceB, 'prj-fw33a-fold');
      expect(servedOnB.filter((id) => id === decision.outcomeId)).toHaveLength(1);
      // ...and the WHOLE record set matches A's own serve (the derived
      // outcome re-derived from the durable envelope + the promoted
      // decision read back from the durable row — the ids are
      // content-addressed, so identical records carry identical ids).
      expect([...servedOnB].sort()).toEqual([...servedOnA].sort());

      // The derived stream + the job read serve on the fresh instance too
      // (the launch envelope + the org bind + the durable job all hydrate).
      expect((await postMortemIdsOf(instanceB, 'prj-fw33a-fold'))).toHaveLength(1);
      expect((await submissionIdsOf(instanceB, 'prj-fw33a-fold'))).toHaveLength(3); // 2 routed fills + 1 honest refusal
      const bJob = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/jobs/${finished.jobId}`, headers: BEARER }));
      expect(bJob.status).toBe(200);
      expect(((bJob.body as { data: { status: string; result: { kind: string } } }).data).result.kind).toBe('release-candidate');
    } finally {
      vi.useRealTimers();
    }
  });

  it('idempotence under the durable lane: the re-promotion on the FRESH instance mints the SAME content-addressed id (the identity law — never a duplicate row)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      const finished = await seedLaunchedDesk(instanceA, 'prj-fw33a-idem', 'fw33a-idem');
      const promoted = await drive(instanceA, streamingRequest({ method: 'POST', url: `/v1/jobs/${finished.jobId}/promote`, headers: BEARER }));
      expect(promoted.status).toBe(200);
      const decisionA = (promoted.body as { data: { decision: { outcomeId: string } } }).data.decision;
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // the drain confirms the mint's write

      // A's idempotent replay (the same instance): the SAME record, replay=true.
      const replay = await drive(instanceA, streamingRequest({ method: 'POST', url: `/v1/jobs/${finished.jobId}/promote`, headers: BEARER }));
      expect((replay.body as { data: { replay: boolean } }).data.replay).toBe(true);
      expect((replay.body as { data: { decision: { outcomeId: string } } }).data.decision.outcomeId).toBe(decisionA.outcomeId);

      // The fresh instance re-promotes (its registry is empty): a FIRST
      // mint on B — the SAME content-addressed id (the identity is derived
      // from the tenant + the job, never the instance), and the write is a
      // no-op against the row that already landed (the (tenant, outcome id)
      // upsert + the lane's projection-match skip).
      const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceB.ok).toBe(true);
      if (!instanceB.ok) return;
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      const promotedOnB = await drive(instanceB, streamingRequest({ method: 'POST', url: `/v1/jobs/${finished.jobId}/promote`, headers: BEARER }));
      expect(promotedOnB.status).toBe(200);
      const mintB = (promotedOnB.body as { data: { decision: { outcomeId: string }; replay: boolean } }).data;
      expect(mintB.replay).toBe(false); // B's registry never minted — this is a first mint on B
      expect(mintB.decision.outcomeId).toBe(decisionA.outcomeId); // ...but the identity is instance-independent
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // B's drain
      // Exactly ONE row serves (the durable row + B's registry row dedupe by outcomeId).
      expect((await outcomeIdsOf(instanceB, 'prj-fw33a-idem')).filter((id) => id === decisionA.outcomeId)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// (b) THE HEAL PATH — a warm instance that never saw the promotion heals
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-33-A: the staleness heal re-reads the derived truth (the warm-instance half)', () => {
  it('instance A promotes; instance B (WARM, booted before the promotion, its registry never minted it) serves the honest emptiness BEFORE the interval, then the heal\'s derived-truth half lands the fresh projection and the record SERVES — exactly once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();
      // INSTANCE A carries the launch + the completion (T0 -> T0+10s).
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      const finished = await seedLaunchedDesk(instanceA, 'prj-fw33a-heal', 'fw33a-heal');
      expect(finished.status).toBe('complete');

      // INSTANCE B boots at T0+11s — AFTER the launch, BEFORE the
      // promotion: its boot projection carries the project + the complete
      // job (the hydration replays it), and its first tick ARMS the heal
      // interval (T0+11s). B's promotion registry is empty and always will
      // be — the record can only ever reach B through the durable truth.
      vi.setSystemTime(T0 + 11_000);
      const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceB.ok).toBe(true);
      if (!instanceB.ok) return;
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));

      // A promotes at T0+12s; A's next request drains the mint's write
      // (the ordering law — the record is durable truth from here on).
      vi.setSystemTime(T0 + 12_000);
      const promoted = await drive(instanceA, streamingRequest({ method: 'POST', url: `/v1/jobs/${finished.jobId}/promote`, headers: BEARER }));
      expect(promoted.status).toBe(200);
      const decision = (promoted.body as { data: { decision: { outcomeId: string } } }).data.decision;
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));

      // THE REPRODUCED DEFECT STATE (honest, pre-heal): B's request at
      // T0+15s is 4s into its 10s interval — no heal yet — and B's serving
      // projection predates the promotion, so the outcome read serves
      // WITHOUT the promoted decision (the pre-fix forever-state: nothing
      // ever re-read the derived truth on a warm instance).
      vi.setSystemTime(T0 + 15_000);
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      const beforeHeal = await outcomeIdsOf(instanceB, 'prj-fw33a-heal');
      expect(beforeHeal.includes(decision.outcomeId)).toBe(false);

      // THE HEAL: B's request at T0+22s (11s since the interval armed)
      // fires the bounded staleness heal — the jobs half, the org half,
      // and FW-33-A's derived-truth half: the fresh tenant-wide outcome
      // read finds a row of a project B's projection SERVES whose id it
      // lacks, the QUIET re-projection rebuilds the serving projection
      // from the fresh truth (no degradation at any point), and the
      // derived streams re-fold with it. Fire-and-forget: flush.
      vi.setSystemTime(T0 + 22_000);
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      await flushAsyncWork();

      // The promoted decision now SERVES on the SAME warm instance —
      // exactly once (the projection's row + the empty registry fold).
      const afterHeal = await outcomeIdsOf(instanceB, 'prj-fw33a-heal');
      expect(afterHeal.filter((id) => id === decision.outcomeId)).toHaveLength(1);
      // ...and the heal never degraded the serving surface: the read
      // answered 200 throughout (the quiet re-projection's own law).
      expect(afterHeal.length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the WARM instance\'s derived stream heals too: B booted BEFORE a launch on A, its derived folds serve emptiness, then the heal\'s registry probe refreshes the projection and the derived stream re-folds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();
      // INSTANCE B boots FIRST (T0) over the demo-seeded store — its
      // projection predates the launch; its first tick arms the heal (T0).
      const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceB.ok).toBe(true);
      if (!instanceB.ok) return;
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));

      // INSTANCE A carries the FULL launch at T0+2s..T0+12s (create +
      // console-launch kickoff + the tick's completion; the goal set with
      // the world, the org bind and the job all persist durably).
      vi.setSystemTime(T0 + 2_000);
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      const finished = await seedLaunchedDesk(instanceA, 'prj-fw33a-stream', 'fw33a-stream');
      expect(finished.status).toBe('complete');
      // A's own derived stream serves (the launch envelope is complete on A).
      expect((await submissionIdsOf(instanceA, 'prj-fw33a-stream'))).toHaveLength(3);

      // B BEFORE the heal (T0+5s — 5s into its interval): the derived
      // folds answer the honest emptiness (B's goal sets + org binds
      // predate the launch — the FW-MI-B fold gates on them).
      vi.setSystemTime(T0 + 5_000);
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      expect((await submissionIdsOf(instanceB, 'prj-fw33a-stream'))).toHaveLength(0);
      expect((await outcomeIdsOf(instanceB, 'prj-fw33a-stream'))).toHaveLength(0);

      // THE HEAL at T0+11s: the registry probe (the fresh JOIN carries a
      // project id B's projection has not SEEN) triggers the quiet
      // re-projection — the goal set with the world + the org bind + the
      // job hydrate, and the derived stream re-folds from the fresh truth.
      vi.setSystemTime(T0 + 11_000);
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      await flushAsyncWork();

      // The derived stream serves on the SAME warm instance — byte-stable
      // ids (the derivation is deterministic over the durable envelope).
      expect((await submissionIdsOf(instanceB, 'prj-fw33a-stream'))).toHaveLength(3);
      expect((await outcomeIdsOf(instanceB, 'prj-fw33a-stream'))).toHaveLength(1);
      expect((await postMortemIdsOf(instanceB, 'prj-fw33a-stream'))).toHaveLength(1);
      // The per-id job read serves too (the heal's jobs half — FW-31-B's
      // own lane, riding the same interval).
      const bJob = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/jobs/${finished.jobId}`, headers: BEARER }));
      expect(bJob.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// (c) THE EXPORT MANIFEST STABILITY — the seed's counts survive instance recreation
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-33-A: the export never loses a record (the manifest stability across instance recreation)', () => {
  it('seed -> reload-equivalent (a fresh instance) -> every record set the export folds is IDENTICAL (S5\'s capsules 8->3, gateway decisions 1->0 — closed; the demo scope\'s fixture substance included)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));

      // THE SEED: the launched desk (launch + completion + promotion) over
      // the demo-seeded world. The promotion's write drains on A's next
      // request (the ordering law).
      const finished = await seedLaunchedDesk(instanceA, 'prj-fw33a-export', 'fw33a-export');
      const promoted = await drive(instanceA, streamingRequest({ method: 'POST', url: `/v1/jobs/${finished.jobId}/promote`, headers: BEARER }));
      expect(promoted.status).toBe(200);
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));

      // THE PRE-RELOAD EXPORT FOLD (what composeWorkspaceExport would
      // serialize): both scopes' complete record sets + the manifest counts.
      const deskBefore = await exportFoldOf(instanceA, 'prj-fw33a-export');
      const demoBefore = await exportFoldOf(instanceA, DEMO_PROJECT_ID);
      expect(deskBefore.outcomes).toHaveLength(2); // the derived outcome + the promoted decision
      expect(deskBefore.submissions).toHaveLength(3); // the derived blotter (2 fills + 1 refusal)
      expect(deskBefore.capsules).toBe(7); // 2 outcomes + 1 post-mortem + 3 submissions + 1 completed job
      expect(demoBefore.outcomes).toHaveLength(1); // the fixture outcome

      // THE RELOAD-EQUIVALENT: a fresh serverless instance boots from the
      // durable truth alone (its registry, its watch store, its live
      // blotter — all empty; only the durable rows + the deterministic
      // folds remain — exactly what a cold new instance holds after a
      // browser reload lands on it).
      const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceB.ok).toBe(true);
      if (!instanceB.ok) return;
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));

      // THE MANIFEST STABILITY: every surface, every scope — IDENTICAL.
      // (The live gateway rows of the recording gateway are per-instance
      // by design — no durable submissions table exists; this scenario
      // routes no live submissions, so the folds hold exactly.)
      const deskAfter = await exportFoldOf(instanceB, 'prj-fw33a-export');
      const demoAfter = await exportFoldOf(instanceB, DEMO_PROJECT_ID);
      expect(deskAfter).toEqual(deskBefore);
      expect(demoAfter).toEqual(demoBefore);
      expect(deskAfter.capsules).toBe(deskBefore.capsules); // the manifest count, pinned
      expect(deskAfter.decisionsGateway).toBe(deskBefore.decisionsGateway); // S5's 1->0, closed
    } finally {
      vi.useRealTimers();
    }
  });
});
