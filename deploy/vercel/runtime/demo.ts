// deploy/vercel/runtime/demo.ts — THE DEMO BACKING (T052 follow-up W-3f).
//
// WHAT THIS IS: when the durable-provider env keys (NEON_*, UPSTASH_*)
// are absent — the public free-tier default — the composed API is
// served over the REAL in-memory fake ports from the frozen service's
// own fixtures (services/api/src/fixtures.ts, imported exactly the way
// runtime/compose.ts already imports createApiService from the frozen
// service tree — never edited), seeded with the fixture demo data for
// the deployment's credential tenant. The data routes (/v1/projects,
// jobs, knowledge, outcomes, execution) then really serve that data;
// every mutation works against per-instance in-memory state (serverless
// cold starts reset it — acceptable and honest under the SIMULATED
// badge, UX-DESIGN §7 anti-deception).
//
// WHAT THIS IS NOT: durable. The demo ports are in-memory fakes. The
// durable adapters (deploy/wire — Neon/Upstash/R2/Resend/Apify) own
// the durable cases; the async/sync hydration seam stays documented in
// deploy/wire/production.md (NOT attempted here — T041's ports are
// sync by design, the durable adapters are async).
//
// SEEDING THROUGH THE REAL ROUTES (L20 runs for real): the demo world
// is not injected around the boundary — it is driven THROUGH it. The
// demo project is created via POST /v1/projects, bound via POST
// /v1/projects/:id/organization, and the watch surface's org-status
// snapshot is reported via POST /internal/organizations/status (the
// only writer of that API-owned store). The full T041 pipeline (authn
// -> authz -> tenant injection -> validation -> handler -> audit ->
// metering) executes for every seed request.
//
// THE DEMO MACHINERY (the honest animation of the async pattern): the
// boundary's job store is API-OWNED state that only the PRIVATE plane
// can advance (POST /internal/jobs/transitions — services/api's own
// law). When the internal credential is configured, the per-request
// host-side tick plays the machinery role through that REAL route:
// non-terminal jobs advance submitted -> running -> complete on a
// fixed schedule, so the launch journey's async progress renders on
// the console. Without the internal credential the stores stay
// un-bound/un-reported (org-status answers the honest typed
// not-found; jobs stay submitted) — never a crash (R46).
//
// Zero-dep law: platform APIs only. Spec anchors: R46, L12/L20,
// UX-DESIGN §7, D-033.

import {
  fakeControlPlane,
  fakeFirmMemory,
  fakeJobSubmission,
  fakeOutcomeLearning,
  fixtureKnowledge,
  recordingGateway,
  routedSubmission,
  validCreateProjectRequest,
  validOrgStatusSnapshot,
} from '../../../services/api/src/fixtures';
import {
  deepFreeze,
  isOrgStatusSnapshot,
  isOutcomeRecordMirror,
  isPostMortemRecordMirror,
  type ApiService,
  type OrgStatusSnapshot,
  type OutcomeRecordMirror,
  type PostMortemRecordMirror,
  type TimestampMs,
} from '../../../services/api/src/index';

// ---------------------------------------------------------------------------
// The demo seed constants (fixed, deterministic, tenant-scoped at seed time)
// ---------------------------------------------------------------------------

/** The demo project (listable at GET /v1/projects; set it as TRADRL_CONSOLE_PROJECT_ID to land in the seeded view). */
export const DEMO_PROJECT_ID = 'prj-demo-console';

/** The demo organization the project binds to (the watch surface's ref). */
export const DEMO_ORGANIZATION_REF = 'org:tradrl-demo';

/** The demo seed's fixed instant base (mirrors the fixtures' T0 — the seeded records are deterministically in the past). */
const DEMO_T0 = 1_720_000_000_000 as TimestampMs;

/** The demo machinery's schedule: a job renders RUNNING this long after submission. */
export const DEMO_JOB_RUNNING_AFTER_MS = 3_000;

/** The demo machinery's schedule: a job renders COMPLETE this long after submission. */
export const DEMO_JOB_COMPLETE_AFTER_MS = 8_000;

// ---------------------------------------------------------------------------
// The demo records (the outcome/post-mortem seed — T033 mirror shapes)
// ---------------------------------------------------------------------------

/**
 * The demo outcome record (T033's OutcomeRecordMirror, field for field).
 * Exported for the guard pins: `isOutcomeRecordMirror(demoOutcomeRecord(...))`.
 */
export function demoOutcomeRecord(tenant: string, project: string): OutcomeRecordMirror {
  return deepFreeze({
    outcomeId: 'out:demo0001',
    ordinal: 1,
    tenant,
    project,
    decision: { decisionRef: 'xd:demo0001', intentRef: 'si:demo0001', disposition: 'filled' },
    outcomeClass: 'adverse_gap',
    expectation: { expectedQuantity: '0.75', expectedRealized: '45.5', tolerance: '0.05', declaredBy: 'spec-demo-director' },
    realization: { filledQuantity: '0.75', realizedOutcome: '-12.5', feeTotal: '0.02', notionalTotal: '45750.375', unrealizedAtDecision: '0' },
    deviation: { quantityShortfall: '0', realizedGap: '-12.5', withinTolerance: false },
    evidence: [
      { kind: 'shadow_outcome', ref: 'swo:demo0001' },
      { kind: 'shadow_session', ref: 'shs:demo0001' },
      { kind: 'decision', ref: 'xd:demo0001' },
    ],
    lineage: {
      shadow: {
        sessionId: 'shs:demo0001',
        fidelity: { mode: 'shadow', fill_origin: 'simulated' },
        executionPolicy: { policyId: 'xp-demo', version: 1 },
        riskPolicy: { policyId: 'rp-demo', version: 1 },
        configDigests: { worldConfigHash: 'demo-world-0001', engineConfigHash: 'demo-engine-0001', dataset: 'demo-dataset-v1' },
        run: { runId: 'run-demo-0001', episodeId: 'ep-demo-0001' },
        cursor: { cursorId: 'cur-demo-0001', position: 1 },
        seed: 'demo-seed-0001',
        tenant,
        project,
      },
      shadowOutcomeRef: 'swo:demo0001',
      shadowOutcomeOrdinal: 1,
      shadowAsOf: DEMO_T0 as TimestampMs,
      decisionStreamPosition: 1,
      trajectoryRef: null,
      experiment: null,
    },
    asOf: DEMO_T0 as TimestampMs,
    priorChainHead: '00000000',
  });
}

/**
 * The demo post-mortem record (T033's PostMortemRecordMirror, field for field).
 * Exported for the guard pins: `isPostMortemRecordMirror(demoPostMortemRecord(...))`.
 */
export function demoPostMortemRecord(tenant: string, project: string): PostMortemRecordMirror {
  return deepFreeze({
    postMortemId: 'pmr:demo0001',
    ordinal: 1,
    subject: { outcomeRecordRef: 'out:demo0001', decisionRef: 'xd:demo0001', intentRef: 'si:demo0001', outcomeClass: 'adverse_gap' },
    expected: { expectedQuantity: '0.75', expectedRealized: '45.5', tolerance: '0.05' },
    happened: { disposition: 'filled', filledQuantity: '0.75', realizedOutcome: '-12.5', feeTotal: '0.02', notionalTotal: '45750.375' },
    gap: { quantityShortfall: '0', realizedGap: '-12.5', withinTolerance: false },
    hypotheses: [
      {
        class: 'decision',
        confidence: '0.8',
        detail: { dimension: 'timing' },
        evidence: [{ kind: 'decision', ref: 'xd:demo0001' }],
        note: 'the demo hypothesis: the rebalance window was missed by the simulated venue lag',
      },
    ],
    evidence: [
      { kind: 'shadow_outcome', ref: 'swo:demo0001' },
      { kind: 'shadow_session', ref: 'shs:demo0001' },
    ],
    lineage: { tenant, project, shadowSessionRef: 'shs:demo0001', shadowOutcomeRef: 'swo:demo0001', trajectoryRef: null, experiment: null },
    asOf: (DEMO_T0 + 1_000) as TimestampMs,
    priorChainHead: '00000000',
  });
}

// ---------------------------------------------------------------------------
// The demo ports (the fixture fakes, knowledge/outcome data seeded)
// ---------------------------------------------------------------------------

/** The demo backing's five ports (the REAL fixture fakes — the same objects the composition injects). */
export interface DemoPorts {
  readonly controlPlane: ReturnType<typeof fakeControlPlane>;
  readonly firmMemory: ReturnType<typeof fakeFirmMemory>;
  readonly outcomeLearning: ReturnType<typeof fakeOutcomeLearning>;
  readonly executionGateway: ReturnType<typeof recordingGateway>;
  readonly jobSubmission: ReturnType<typeof fakeJobSubmission>;
}
/**
 * Build the demo ports (the REAL fixture fakes, imported from the
 * frozen service's own fixtures — never edited). The knowledge and
 * outcome ports are seeded READ data scoped to the deployment's
 * credential tenant (L12: a foreign tenant's credential is served
 * nothing of it); the control plane starts empty — the demo project is
 * created through the real route (see seedDemoWorld); the gateway
 * serves ROUTED submissions for every valid intent (the fixture's own
 * L8 record shapes); the job port records submissions (the async
 * pattern's entry state).
 */
export function seedDemoBacking(tenant: string): DemoPorts {
  return {
    controlPlane: fakeControlPlane(),
    firmMemory: fakeFirmMemory([...fixtureKnowledge(tenant, DEMO_PROJECT_ID)]),
    outcomeLearning: fakeOutcomeLearning([demoOutcomeRecord(tenant, DEMO_PROJECT_ID)], [demoPostMortemRecord(tenant, DEMO_PROJECT_ID)]),
    executionGateway: recordingGateway((intent) => routedSubmission(intent, intent.asOf)),
    jobSubmission: fakeJobSubmission(),
  };
}

// ---------------------------------------------------------------------------
// The demo world seed (every mutation THROUGH the real routes — L20 for real)
// ---------------------------------------------------------------------------

/** The demo world seed's inputs (the host's env-derived values — never hardcoded). */
export interface DemoWorldSeed {
  /** The credential tenant (L12 — the seed is scoped to it; the goal/constraint same-tenant law is enforced by the real route). */
  readonly tenant: string;
  /** The public-plane developer token (the demo project create + organization bind). */
  readonly developerToken: string;
  /** The private-plane internal token (the org-status report + the machinery tick); `null` = the private plane stays closed. */
  readonly internalToken: string | null;
}

/** The demo world seed outcome. */
export interface DemoWorldSeedResult {
  /** Whether the watch surface's org-status snapshot was reported (requires the internal credential). */
  readonly orgStatusSeeded: boolean;
}

/**
 * Seed the demo world through the REAL routes, immediately after the
 * service is composed: one project (the fixture goal/constraint shapes
 * for the credential tenant) +, when the internal credential is
 * configured, the organization bind and the org-status snapshot report
 * (the watch surface's only writer). `at` is the host-injected boot
 * instant. Throws only on an impossible seed (the fixture builders are
 * the canonical valid shapes — a failure means the frozen contract
 * drifted, which must be loud).
 */
export function seedDemoWorld(service: ApiService, seed: DemoWorldSeed, at: number): DemoWorldSeedResult {
  const developer = { authorization: `Bearer ${seed.developerToken}` };
  // 1. The demo project (the full pipeline: L12 tenant injection, the
  //    goal/constraint same-tenant law, the audit + metering tail).
  const created = service.handle({
    method: 'POST',
    path: '/v1/projects',
    headers: developer,
    body: validCreateProjectRequest(seed.tenant, DEMO_PROJECT_ID, 'the TradRL demo project'),
  });
  if (created.status !== 201) {
    throw new Error(`demo backing: the demo project seed was refused (${created.status}) — the frozen create contract may have drifted`);
  }
  if (seed.internalToken === null) {
    // The private plane is closed: no bind, no org-status report. The
    // console simply never queries org-status for the unbound project
    // (honest — the watch store is empty until a reporter exists).
    return { orgStatusSeeded: false };
  }
  // 2. The organization bind (public route, projects:write).
  const bound = service.handle({
    method: 'POST',
    path: `/v1/projects/${encodeURIComponent(DEMO_PROJECT_ID)}/organization`,
    headers: developer,
    body: { organizationRef: DEMO_ORGANIZATION_REF, at },
  });
  if (bound.status !== 200) {
    throw new Error(`demo backing: the demo organization bind was refused (${bound.status}) — the frozen bind contract may have drifted`);
  }
  // 3. The org-status snapshot report (the private plane — the watch
  //    surface's only writer; the full pipeline runs: internal authn,
  //    the snapshot guard, the audit + metering tail).
  const snapshot: OrgStatusSnapshot = deepFreeze({ ...validOrgStatusSnapshot(seed.tenant, DEMO_PROJECT_ID, DEMO_ORGANIZATION_REF), at });
  if (!isOrgStatusSnapshot(snapshot)) {
    // Unreachable (the fixture builder is the canonical shape) — the
    // boundary is fail-closed; the demo seed is too.
    throw new Error('demo backing: the demo org-status snapshot failed its structural guard');
  }
  const reported = service.handle({
    method: 'POST',
    path: '/internal/organizations/status',
    headers: { authorization: `Bearer ${seed.internalToken}` },
    body: { snapshot },
  });
  if (reported.status !== 200) {
    throw new Error(`demo backing: the demo org-status report was refused (${reported.status}) — the frozen internal contract may have drifted`);
  }
  return { orgStatusSeeded: true };
}

// ---------------------------------------------------------------------------
// The demo machinery (advances jobs THROUGH the real private plane)
// ---------------------------------------------------------------------------

/**
 * One demo machinery tick: advance every non-terminal job toward
 * completion THROUGH THE REAL PRIVATE PLANE (POST
 * /internal/jobs/transitions — the async pattern's only transition
 * writer; the transition legality machine in services/api rejects
 * illegal moves, so the tick is idempotent by construction). `at` is
 * the host-injected request instant. Research jobs complete with a
 * release-candidate result record (the console's release-candidate
 * notice + evidence surfaces); learning jobs complete with a plain
 * training summary.
 */
export function demoMachineryTick(service: ApiService, internalToken: string, at: number): void {
  for (const job of service.jobs()) {
    if (job.status === 'complete' || job.status === 'failed') continue;
    const age = at - job.submittedAt;
    let status: 'running' | 'complete' | null = null;
    if (age >= DEMO_JOB_COMPLETE_AFTER_MS) status = 'complete';
    else if (age >= DEMO_JOB_RUNNING_AFTER_MS) status = 'running';
    if (status === null) continue;
    service.handle({
      method: 'POST',
      path: '/internal/jobs/transitions',
      headers: { authorization: `Bearer ${internalToken}` },
      body: status === 'complete'
        ? {
            jobId: job.jobId,
            status: 'complete',
            at,
            result: job.kind === 'research'
              ? { kind: 'release-candidate', specId: 'spec-demo-director', version: 1, project: job.project }
              : { kind: 'training-summary', epochs: 3, project: job.project },
          }
        : { jobId: job.jobId, status: 'running', at },
    });
  }
}

// ---------------------------------------------------------------------------
// The guard pins (structural — the demo records ARE the mirror shapes)
// ---------------------------------------------------------------------------

/** Guard pin: the demo outcome record satisfies the boundary's own structural guard. */
export function demoOutcomeRecordIsValid(tenant: string, project: string): boolean {
  return isOutcomeRecordMirror(demoOutcomeRecord(tenant, project));
}

/** Guard pin: the demo post-mortem record satisfies the boundary's own structural guard. */
export function demoPostMortemRecordIsValid(tenant: string, project: string): boolean {
  return isPostMortemRecordMirror(demoPostMortemRecord(tenant, project));
}
