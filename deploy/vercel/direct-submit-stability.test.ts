// deploy/vercel/direct-submit-stability.test.ts — THE FW-47-B SERVER-SIDE
// M-3 TESTS (Round M register M-3 — the direct-submit job record
// instability, L2-cont's two-exports-two-records shape, 7+ seats' export
// evidence, the dead worker's 12s-apart re-derivation).
//
// WHAT IS PINNED (through the FULL function handler — runtime/compose.ts +
// api/router.ts, the REAL Neon adapters over the fake provider fleet, no
// network — the record-durability.test.ts harness law):
//
//   (a) THE TWO-EXPORTS-IDENTICAL LAW (M-3, the regression pin): a
//       direct-submit research job completes on the instance that observed
//       the completion (completedAt stamps ONCE at the completion
//       transition's own instant — the observing tick's clock), and a
//       reload that lands on a WARM instance that had learned the job
//       NON-TERMINALLY serves the IDENTICAL record — never the warm
//       instance's own re-derivation at the reload clock. The measured
//       L2-cont shape (17:57:58.371 -> 18:00:46.991, ~3 minutes apart) is
//       reproduced at the seam: recordA attests T0+13s (the completing
//       instance's own stamp — CORRECT pre-fix and post-fix, never the
//       defect), recordB attests the SAME instant. The defect was never
//       the completing instance — it was the warm stale instance's
//       re-derivation, so the fix lives at the SEAM (the awaited pre-sync
//       adoption + the payload-derived replay keys + the
//       immutable-once-terminal write guard on the W-27 job.put lane),
//       never in demo.ts (a live desk's progress is genuinely observed
//       now — the tick law stands).
//
//   (b) THE BACKEND-DROP COLD PATH (keep-green): a FRESH serverless
//       instance over the same durable truth hydrates the terminal record
//       VERBATIM (the W-27 boot hydration replays the durable row through
//       the real public job routes; the port serves the record's exact
//       jobId, status, result and timestamps) and its tick never
//       re-derives — the per-id read attests the SAME completedAt. This
//       pins that the W-27 lane itself was ALWAYS honest: the cold path
//       was green before the fix and stays green after it (the fix's
//       guards never touch it — a missing durable row writes; a
//       non-terminal row lets the normal progression through).
//
// THE LAW (M-3 closed): a direct-submit job record is IMMUTABLE ONCE
// COMPLETE — completedAt stamps once at the completion transition's own
// instant, the deliverable composes once, and two exports of the same
// scope attest the IDENTICAL record.

import { describe, expect, it, vi } from 'vitest';
import { composeDeployment } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { fakeProviders } from '../wire/smoketest';
import type { FetchLike } from '../adapters/shared';
import { validConstraintSet, validGoal } from '../../services/api/src/fixtures';
import type { FunctionRequest, FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// The fixed fake world (the record-durability harness law — never a real credential)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-fw47b';
const TOKEN = 'tok-deploy-fw47b';
const PRINCIPAL = 'public-console';
const NEON_KEYS = {
  NEON_API_HOST: 'ep-fw47b-pooler.us-east-2.aws.neon.tech',
  NEON_DATABASE: 'neondb',
  NEON_API_USER: 'neondb_owner',
  NEON_API_KEY: 'fake-neon-key-fw47b',
};

/** The env source of a durable deployment with the internal credential (the machinery tick + the heal ride it). */
function durableSourceWithMachinery(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
    ...NEON_KEYS,
    [API_ENV_KEYS.apiInternalToken]: 'tok-internal-fw47b',
    [API_ENV_KEYS.apiInternalPrincipal]: 'fw47b-machinery',
    ...overrides,
  };
}

/**
 * The fixed instant base of the scenario. THE SCHEDULE (the machinery's own
 * law, runtime/demo.ts): a job renders RUNNING 3s after submission and
 * COMPLETE 8s after — so the kickoff at T0+3s completes on a tick observed
 * at T0+13s (age 10s), and the warm instance's re-derivation at the reload
 * clock T0+176s (age 173s) is the measured L2-cont divergence class
 * (~3 minutes apart, the exact measured gap).
 */
const T0 = 1_800_800_000_000;
/** The completion transition's OWN instant — the completing instance's observing tick clock (the pinned stamp). */
const COMPLETED_AT = T0 + 13_000;
/** The reload instant — the request the balancer routes to the WARM instance long after the completion. */
const RELOAD_AT = T0 + 176_000;

/** Compose one durable instance over the injected fetch (a fresh "serverless instance"). */
function composeInstance(source: Record<string, string | undefined>, fetchLike: FetchLike) {
  return composeDeployment(readApiEnv(source), {}, { fetchLike, instants: { next: () => T0 } });
}

/** The bearer headers of the deployment's developer credential. */
const BEARER = { authorization: `Bearer ${TOKEN}` };

/** One create-project body (the REAL T007 goal/constraint shapes, tenant-scoped). */
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

/** The served job record's shape (the per-id GET /v1/jobs/:jobId the console's job polling + export derivation ride). */
interface ServedJob {
  readonly jobId: string;
  readonly status: string;
  readonly completedAt?: number;
  readonly submittedAt: number;
  readonly result?: unknown;
}

/** The per-id job read (the server-side attestation of the record an export derives from). */
async function jobRead(deployment: Deployment, jobId: string): Promise<ServedJob> {
  const read = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/jobs/${jobId}`, headers: BEARER }));
  expect(read.status).toBe(200);
  return (read.body.data ?? {}) as ServedJob;
}

/**
 * THE M-3 SCENARIO SEED (the L2-cont shape, paced): instance A boots and
 * carries the create; instance B (the warm instance the balancer keeps
 * routing the console's polls to) boots BEFORE the kickoff so its job store
 * learns the job only through the heal's G-6-gated import — NON-TERMINALLY
 * (the submitted record: A stays quiet between the kickoff and the
 * completion, so the durable row holds nothing terminal yet). The kickoff is
 * WORLD-LESS by design (a direct-submit research spec — no launch world ever
 * exists, so no world divergence can trigger the FW-42-A probe: this test
 * isolates the JOB-RECORD stability the wave closes).
 */
async function seedDirectSubmitJob(): Promise<{
  readonly providers: ReturnType<typeof fakeProviders>;
  readonly instanceA: Deployment;
  readonly instanceB: Deployment;
  readonly jobId: string;
}> {
  const providers = fakeProviders();
  const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
  expect(instanceA.ok).toBe(true);
  if (!instanceA.ok) throw new Error('instance A failed to compose');
  await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // A's boot world settles
  vi.setSystemTime(T0 + 1_000);
  const created = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'content-type': 'application/json' }, body: createProjectBody('prj-fw47b-m3') }));
  expect(created.status).toBe(201);
  // INSTANCE B boots at T0+2s — AFTER the create, BEFORE the kickoff: its
  // boot projection holds the project, its job store predates the job, and
  // its first tick ARMS the staleness-heal interval (the warm instance).
  vi.setSystemTime(T0 + 2_000);
  const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
  expect(instanceB.ok).toBe(true);
  if (!instanceB.ok) throw new Error('instance B failed to compose');
  await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
  // THE KICKOFF ON A (T0+3s): the direct-submit research job.
  vi.setSystemTime(T0 + 3_000);
  const kickoff = await drive(instanceA, streamingRequest({
    method: 'POST',
    url: '/v1/jobs/research',
    headers: { ...BEARER, 'idempotency-key': 'idem:fw47b:m3:kickoff' },
    body: { kind: 'research', projectId: 'prj-fw47b-m3', spec: { source: 'fw47b-m3-evidence', objective: 'measure the direct-submit record stability across warm-instance reloads' } },
  }));
  expect(kickoff.status).toBe(202);
  const jobId = (kickoff.body as { data: { jobId: string } }).data.jobId;
  // A's next request drains the submitted record onto the durable row.
  vi.setSystemTime(T0 + 4_000);
  await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
  // B's poll at T0+12s (10s since the interval armed at T0+2s): the heal
  // FIRES (fire-and-forget — flush) and its jobs half imports the
  // NON-TERMINAL submitted record into B's store. The tick itself advances
  // nothing (the import lands asynchronously; B's synchronous tick sees no
  // job yet) — B has now LEARNED the job non-terminally, the exact state
  // the measured reload landed on.
  vi.setSystemTime(T0 + 12_000);
  await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
  await flushAsyncWork();
  // THE COMPLETION ON A (T0+13s): A's tick observes the kickoff job at age
  // 10s >= the machinery's 8s schedule and completes it — the transition
  // stamps the completion's OWN instant (the observing tick's clock,
  // T0+13s; the completing instance's stamp was ALWAYS correct — never the
  // defect). A's next request (T0+14s) drains the terminal record onto the
  // durable row: the durable truth is complete at T0+13s from here on.
  vi.setSystemTime(COMPLETED_AT);
  await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
  vi.setSystemTime(T0 + 14_000);
  await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
  return { providers, instanceA, instanceB, jobId };
}

// ---------------------------------------------------------------------------
// (a) THE TWO-EXPORTS-IDENTICAL LAW — the L2-cont regression pin
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-47-B (M-3): the direct-submit job record is immutable once terminal (the two-exports-identical law)', () => {
  it('THE RELOAD SHAPE: a warm instance that learned the job non-terminally serves the completing instance\'s terminal record VERBATIM (recordB === recordA, completedAt T0+13s) — never its own re-derivation at the reload clock (L2-cont\'s measured 17:57:58.371 -> 18:00:46.991 divergence class, dead at the seam)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const { instanceA, instanceB, jobId } = await seedDirectSubmitJob();

      // EXPORT A (the first attestation): the completing instance's own
      // per-id read — completedAt stamps at the completion transition's own
      // instant, the observing tick's clock. This half was CORRECT pre-fix
      // (the completing instance was never the defect) and stays correct.
      const recordA = await jobRead(instanceA, jobId);
      expect(recordA.status).toBe('complete');
      expect(recordA.completedAt).toBe(COMPLETED_AT); // T0+13s — the completion transition's OWN instant
      expect(recordA.result).toBeDefined(); // the deliverable composed ONCE

      // THE RELOAD (T0+176s, ~3 minutes later — the measured gap): the
      // balancer routes the console's poll to the WARM instance. Its heal
      // interval has long elapsed (164s), so its tick fires — and the
      // request must land on the instance AFTER it adopted the durable
      // terminal record (the awaited pre-sync), never on a machinery
      // advancement that re-derives the completion at the reload clock.
      vi.setSystemTime(RELOAD_AT);
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      await flushAsyncWork(); // the fire-and-forget rest of the heal + the write-through drain

      // EXPORT B (the second attestation, the same scope): the warm
      // instance's per-id read. THE PIN: the IDENTICAL record — the same
      // terminal status, the same completedAt (T0+13s, the completing
      // instance's stamp), the same composed result. The pre-fix warm
      // instance re-derived the completion at its own tick clock
      // (recordB.completedAt = T0+176s — the measured L2-cont divergence);
      // the post-fix instance adopts the durable terminal record BEFORE its
      // machinery tick can re-derive, and the write-through lane's
      // immutable-once-terminal guard keeps the DURABLE truth un-clobberable
      // regardless.
      const recordB = await jobRead(instanceB, jobId);
      expect(recordB.status).toBe('complete');
      expect(recordB.completedAt).toBe(COMPLETED_AT); // NEVER the reload clock
      expect(recordB.completedAt).toBe(recordA.completedAt); // the two exports attest the IDENTICAL stamp
      expect(recordB.result).toEqual(recordA.result); // the deliverable composes ONCE — the adopted record carries it verbatim

      // THE DURABLE TRUTH STAYS IMMUTABLE: the completing instance's own
      // read, taken AFTER the reload landed on the warm instance, still
      // attests the original stamp (a re-derivation that clobbered the
      // durable row — the pre-fix write-through — would surface here too).
      const recordAAfter = await jobRead(instanceA, jobId);
      expect(recordAAfter.completedAt).toBe(COMPLETED_AT);
      expect(recordAAfter.result).toEqual(recordA.result);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// (b) THE BACKEND-DROP COLD PATH (keep-green) — the W-27 lane was always honest
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-47-B (M-3): the backend-drop cold path (the W-27 boot hydration serves the terminal record verbatim)', () => {
  it('a FRESH serverless instance over the same durable truth hydrates the terminal record VERBATIM and never re-derives — the per-id read attests the same completedAt (keep-green: the W-27 lane itself was always honest; the fix\'s guards never touch the cold path)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const { providers, instanceA, jobId } = await seedDirectSubmitJob();
      const recordA = await jobRead(instanceA, jobId);
      expect(recordA.status).toBe('complete');
      expect(recordA.completedAt).toBe(COMPLETED_AT);

      // THE BACKEND DROP (the reload-equivalent's harder half): a NEW
      // serverless instance boots from the durable truth alone — its boot
      // world REPLAYS the tenant's durable job records through the REAL
      // public job routes (the port serves each record verbatim — the exact
      // jobId, status, result and timestamps), so its store holds the
      // terminal record from the first serve and its tick advances nothing.
      vi.setSystemTime(T0 + 180_000);
      const instanceC = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceC.ok).toBe(true);
      if (!instanceC.ok) return;
      await drive(instanceC, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // the boot world settles + hydrates
      await flushAsyncWork();

      const recordC = await jobRead(instanceC, jobId);
      expect(recordC.status).toBe('complete');
      expect(recordC.completedAt).toBe(COMPLETED_AT); // the durable row's own stamp, verbatim across the instance boundary
      expect(recordC.completedAt).toBe(recordA.completedAt);
      expect(recordC.result).toEqual(recordA.result); // the composed deliverable rides the record — no per-read re-composition
    } finally {
      vi.useRealTimers();
    }
  });
});
