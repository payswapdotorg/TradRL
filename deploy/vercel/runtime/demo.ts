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
// THE DEMO SUBSTANCE (T052 follow-up W-8 — the Phase-2 fix-forward):
// the seeded demo world now carries the substance the competitive
// experiment proved missing (phase2-competitive-report.md R2-R5):
//   - R2: an EXECUTION BLOTTER — seeded gateway-submission records
//     (routed fills + one honest risk-limit refusal) with order ids,
//     instruments, sides, quantity/notional/fee, states, routing and
//     timestamps, consistent with the seeded fill (the 0.75 BTC-USD
//     limit buy whose notional 45750.375 / fee 0.02 the outcome
//     record has carried since W-3f). Served read-only through the
//     HOST-OWNED demo-substance route GET /v1/execution/submissions
//     (runtime/routes.ts — additive; the frozen T041 route table is
//     untouched) plus every live submission the demo gateway records.
//   - R3: DECISION AUDIT SUBSTANCE on the seeded decision records —
//     additive fields (`decisionBody`, `decisionRationale`,
//     `riskChecks`, `evidence`) carrying the deciding body (a named
//     desk), the decision's stated rationale (audit-grade prose, the
//     post-mortem-note class — never hidden chain-of-thought), the
//     pre-trade risk checks with outcomes, and evidence refs that
//     resolve to the REAL seeded records (out:demo0001, pmr:demo0001,
//     swo/shs:demo0001). The field names deliberately avoid the
//     console watch surface's reasoning-key vocabulary
//     (apps/web/src/core/watch.ts REASONING_KEYS) so the enriched
//     records keep passing its chain-of-thought firewall.
//   - R4: the machinery's ORG-COMPILE PASS — the W-3f compile ran
//     only for the seeded demo project at boot; the tick now compiles
//     ANY user-launched project of the credential tenant (bind
//     through the real public route + the watch snapshot through the
//     real private route), once per project, point-in-time stable.
//   - R5: the demo project's seeded goal + constraint set carry
//     NUMERIC bounds end-to-end (demoGoalStatement/demoConstraintSet
//     — every predicate.bound / predicate.value a number), served
//     read-only through the host-owned GET /v1/projects/:id/goal —
//     which, since W-25B (D-4), serves EVERY project's OWN goal: the
//     backing retains each create-project request's goal + constraint
//     set at the control-plane port seam (demoControlPlane below — the
//     demo seed's own create and every user launch ride the same path)
//     and the route serves them back, so a launched project's Goal/
//     Risk cards survive a reload (the console's W-23 boot read finally
//     gets its 200).
//
// THE SEEDED JOBS (W-25A, D-3 — "JOB: not searchable in any scope"):
//   - the demo world seed submits ONE research + ONE learning job for
//     the demo project through the REAL public routes (the full
//     pipeline: L12 tenant injection, the idempotency law, the audit +
//     metering tail) — the API-owned job store (the same store the
//     per-id GET /v1/jobs/:jobId reads) then carries the demo
//     project's jobs on EVERY fresh boot, and the HOST-OWNED list
//     route GET /v1/jobs?project=<id> (runtime/routes.ts — additive;
//     the frozen T041 route table is untouched) serves them, so the
//     console's boot read (W-25A's client half) refills state.jobs
//     after every reload/scope-switch: the Research section lists the
//     seeded jobs on FIRST render and the palette's JOB group has
//     entries to find (the J8-spec goal — navigate to a job via the
//     palette alone). The machinery (when the internal credential is
//     configured) advances the seeded jobs like every other job
//     (submitted -> running -> complete, the research one with the
//     release-candidate result); without it they stay submitted —
//     honest under SIMULATED either way.
//
// Zero-dep law: platform APIs only. Spec anchors: R46, L12/L20,
// UX-DESIGN §7, D-033, phase2-competitive-report R2-R5, D-3 (W-25A),
// D-4 (W-25B).

import {
  fakeControlPlane,
  fakeFirmMemory,
  fakeJobSubmission,
  fakeOutcomeLearning,
  fixtureKnowledge,
  recordingGateway,
  routedSubmission,
  validOrgStatusSnapshot,
} from '../../../services/api/src/fixtures';
import {
  deepFreeze,
  fnv1a32Hex,
  canonicalJson,
  isGatewaySubmissionRecord,
  isOrgStatusSnapshot,
  isOutcomeRecordMirror,
  isPostMortemRecordMirror,
  isRecord,
  type ApiService,
  type ControlPlanePort,
  type ExecutionGatewayPort,
  type FirmMemoryPort,
  type GatewaySubmissionRecord,
  type GoalStatement,
  type JobRecord,
  type OutcomeLearningPort,
  type ConstraintSetStatement,
  type OrgStatusSnapshot,
  type OutcomeRecordMirror,
  type PostMortemRecordMirror,
  type StrategyIntent,
  type TenantId,
  type TimestampMs,
} from '../../../services/api/src/index';
import { deriveProjectEvidence, type ProjectEvidenceSeed } from './project-evidence';
import {
  composeResearchDeliverableResult,
  emptyDeliverableSource,
  type DeliverableObservedState,
  type DeliverableSource,
} from './deliverable';

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

/**
 * THE DETERMINISTIC DEMO-JOB IDENTITY (FW-31-B, Round A blocker 3's re-seed
 * half + D-053's disclosed limitation, narrowed): the seeded demo jobs'
 * `submittedAt` — the demo world's OWN fixed instant base, the same anchor
 * every other seeded demo record already carries (the outcome, the
 * post-mortem, the blotter rows, the goal horizon — all DEMO_T0-dated,
 * "the demo data is honestly dated 2024"). Before FW-31-B the re-seed
 * minted its job ids + submittedAt from the instance's boot instant
 * (`fnv1a([kind, tenant, project, spec, at, n])` — `at` differs per
 * serverless instance), so the demo scope's job list ROTATED across
 * reloads (Round A: job ids + "observed" timestamps jumping
 * 04:33→04:24→04:33, mid-flight submitted jobs vanishing, the unread count
 * drifting — personas S5/S2's C10 evidence). With the identity fixed to
 * the demo epoch the per-instance re-seed is idempotent IN IDENTITY, not
 * just effect: every instance stores the byte-identical pair.
 */
export const DEMO_SEED_JOB_SUBMITTED_AT: TimestampMs = DEMO_T0;

/** The seeded demo jobs' deterministic completion instant (the machinery's own schedule, applied to the fixed submission instant — byte-stable across instances). */
export const DEMO_SEED_JOB_COMPLETED_AT: TimestampMs = (DEMO_T0 + DEMO_JOB_COMPLETE_AFTER_MS) as TimestampMs;

/** The demo organization's deterministic observation instant (the watch snapshot's `at` for the DEMO project — after the seeded blotter activity, so the demo world tells one coherent 2024 story). */
export const DEMO_ORG_SNAPSHOT_AT: TimestampMs = (DEMO_T0 + 180_000) as TimestampMs;

/** The demo capital budget (the seeded constraint set's numeric `equals` bound — the R5 story). */
export const DEMO_CAPITAL_BUDGET = 250_000;

/** The demo risk budget (the seeded constraint set's numeric `equals` bound — the R5 story). */
export const DEMO_RISK_BUDGET = 25_000;

/** The demo execution desk — the deciding body the seeded decision records name (the R3 story). */
export const DEMO_EXECUTION_DESK = 'desk:tradrl-demo-execution';

/** The pre-trade risk gate — the deciding body named on the seeded refusal (the R3 story). */
export const DEMO_RISK_GATE = 'gate:pre-trade-risk';

// ---------------------------------------------------------------------------
// The demo goal + constraint set (R5 — numeric bounds end-to-end)
// ---------------------------------------------------------------------------

/**
 * The demo project's goal statement (T007's GoalStatement, demo-branded).
 * Every success criterion carries a NUMERIC predicate bound — the Risk
 * section's render can display the numbers (R5: "a limit without a number
 * is not a limit"). Exported for the host-owned goal read route
 * (runtime/routes.ts) and the seed's create-project request.
 */
export function demoGoalStatement(tenant: string): GoalStatement {
  return deepFreeze({
    id: 'goal-tradrl-demo' as GoalStatement['id'],
    version: 1,
    tenantId: tenant as GoalStatement['tenantId'],
    objective: 'Operate the TradRL demo organization inside its declared risk envelope with committee-grade evidence on every step',
    horizon: { startsAt: (DEMO_T0 - 90 * 24 * 3_600_000) as TimestampMs, endsAt: (DEMO_T0 + 90 * 24 * 3_600_000) as TimestampMs, label: 'the demo evaluation window' },
    successCriteria: {
      criteria: [
        { id: 'c-return', metric: 'returns.sharpe', predicate: { kind: 'limit.min', bound: 1.0 }, description: 'risk-adjusted return' },
        { id: 'c-drawdown', metric: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.15 }, description: 'bounded drawdown' },
        { id: 'c-costs', metric: 'costs.bps', predicate: { kind: 'limit.max', bound: 25 }, description: 'execution cost ceiling' },
      ],
      requiredSatisfaction: 2 / 3,
    },
    evaluation: { blindRef: 'blind:v1', walkForwardRef: 'wf:v1', regimeRef: 'regime:v1', adversarialRequired: true },
    createdAt: (DEMO_T0 - 1000) as TimestampMs,
    description: 'the seeded demo goal of the TradRL console',
  });
}

/**
 * The demo project's constraint set (T007's ConstraintSetStatement,
 * demo-branded). Every predicate bound/value is a NUMBER (R5) — the
 * capital/risk budgets the launch flow echoes, the gross-exposure cap the
 * seeded intents' constraint proofs cite (k-position, limit.max 2), the
 * turnover ceiling and the drawdown hard limit. Exported for the
 * host-owned goal read route and the seed's create-project request.
 */
export function demoConstraintSet(tenant: string): ConstraintSetStatement {
  return deepFreeze({
    id: 'cs-tradrl-demo' as ConstraintSetStatement['id'],
    version: 1,
    tenantId: tenant as ConstraintSetStatement['tenantId'],
    name: 'the TradRL demo constraint set',
    constraints: [
      { id: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: DEMO_CAPITAL_BUDGET }, severity: 'blocking', description: 'the demo capital budget' },
      { id: 'k-risk-budget', domain: 'outcome', subject: 'risk.budget', predicate: { kind: 'equals', value: DEMO_RISK_BUDGET }, severity: 'blocking', description: 'the demo risk budget' },
      { id: 'k-position', domain: 'state', subject: 'position.grossExposure', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking', description: 'gross exposure cap (the seeded intents cite this proof)' },
      { id: 'k-turnover', domain: 'action', subject: 'costs.dailyTurnover', predicate: { kind: 'limit.max', bound: 500 }, severity: 'advisory', description: 'daily turnover ceiling' },
      { id: 'k-drawdown', domain: 'outcome', subject: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.15 }, severity: 'blocking', description: 'drawdown hard limit' },
    ],
    createdAt: (DEMO_T0 - 1000) as TimestampMs,
  });
}

/**
 * The demo project's create-project request (the demo goal + constraint
 * set, numeric bounds end-to-end) — the body `seedDemoWorld` drives
 * THROUGH the real POST /v1/projects route (the full T007 pipeline: L12
 * tenant injection, the goal/constraint same-tenant law, the audit +
 * metering tail).
 */
export function demoCreateProjectRequest(tenant: string, projectId: string): Record<string, unknown> {
  return deepFreeze({
    id: projectId,
    name: 'the TradRL demo project',
    executionMode: 'simulation',
    goal: demoGoalStatement(tenant),
    constraintSet: demoConstraintSet(tenant),
    at: DEMO_T0,
  });
}

// ---------------------------------------------------------------------------
// The seeded jobs (D-3, W-25A — the jobs seam's demo substance)
// ---------------------------------------------------------------------------

/**
 * The seeded research job's spec (the demo project's standing research
 * pass — the same opaque-spec law every job submission rides: the job
 * machinery owns the semantics, the boundary carries the JSON). Driven
 * through the REAL POST /v1/jobs/research route by seedDemoWorld.
 */
export function demoSeedResearchJobSpec(): Record<string, unknown> {
  return deepFreeze({ kind: 'demo-seed', note: 'the demo project\'s seeded kickoff research job (W-25A, D-3)', feeds: ['candles:1m', 'news:sentiment'] });
}

/**
 * The seeded learning job's spec (the demo project's standing training
 * pass). Driven through the REAL POST /v1/jobs/learning route by
 * seedDemoWorld.
 */
export function demoSeedLearningJobSpec(): Record<string, unknown> {
  return deepFreeze({ kind: 'demo-seed', note: 'the demo project\'s seeded training job (W-25A, D-3)', epochs: 3 });
}

/**
 * THE SEEDED DEMO JOBS' DETERMINISTIC RECORDS (FW-31-B): the fixed-shape
 * `JobRecord` each instance's re-seed stores — a content-addressed id
 * (the boundary's own `job:` + 8-hex grammar, derived from the tenant +
 * the demo scope + the kind, NEVER the boot instant) and the demo-epoch
 * `submittedAt`. These are the records the port-level priming latch
 * (demoSeedJobPrimingOf below) serves for the seed's own submissions, so
 * `seedDemoJobs` — which drives through the REAL public routes, exactly
 * as before — lands the byte-identical pair on every serverless instance
 * (D-053's "per-instance by design" now rotates NOTHING).
 */
export function demoSeedJobRecord(tenant: string, kind: 'research' | 'learning'): JobRecord {
  return deepFreeze({
    jobId: `job:${fnv1a32Hex(canonicalJson(['demo-seed-job', tenant, DEMO_PROJECT_ID, kind] as never))}` as JobRecord['jobId'],
    kind,
    tenant: tenant as JobRecord['tenant'],
    project: DEMO_PROJECT_ID as JobRecord['project'],
    status: 'submitted',
    submittedAt: DEMO_SEED_JOB_SUBMITTED_AT,
  });
}

/**
 * THE SEEDED PAIR'S OWN IDENTITY (FW-34-A, the M3 job-blink root cause's
 * fix half): is this job record one of THIS tenant's two deterministic demo
 * SEED records (the content-addressed ids `demoSeedJobRecord` derives — the
 * tenant + the demo scope + the kind, never the boot instant)? The durable
 * job write-through lane (W-27, D-7) excludes EXACTLY these two records:
 * they are re-stored byte-identically by EVERY instance's per-instance
 * re-seed (R3's disclosed limitation — the frozen service's closure), so
 * persisting them would re-queue an identical upsert on every cold start
 * (harmless but pure noise — the lane never re-writes what did not change,
 * and the projection-match skip already covers it; the exclusion keeps the
 * durable table free of the seed pair's write flapping as the re-seeded
 * 'submitted' record lands and the tick re-advances it to 'complete').
 *
 * The PRE-FW-34-A lane excluded the WHOLE demo project — every
 * USER-submitted job in the shared teaching scope (M3's job:b32e6a51,
 * submitted by a research persona working the demo scope) was per-instance
 * state: it vanished from live surfaces AND the fresh export whenever the
 * balancer routed a later read to an instance that never received the
 * submission, and the per-id GET /v1/jobs/:jobId (the promoted decision's
 * producing-job backlink) answered the typed 404 there — the exact
 * system-of-record violation Round C's register item 5 filed. The
 * exclusion now keys on the SEED PAIR'S OWN IDENTITY, so every OTHER
 * demo-scope job rides the lane like any launched desk's job (the D-7
 * law's whole point): submission + every transition write-through, the
 * boot hydration replays it on fresh instances, and the staleness heal's
 * jobs half re-reads it on warm ones.
 */
export function isDemoSeedJob(tenant: string, job: { readonly jobId: unknown }): boolean {
  if (typeof job.jobId !== 'string') return false;
  return job.jobId === demoSeedJobRecord(tenant, 'research').jobId || job.jobId === demoSeedJobRecord(tenant, 'learning').jobId;
}

/** One captured job-submission port input (the seam's structural shape — the validated, tenant-injected submission the port sees). */
interface DemoSeedJobInput {
  readonly kind: unknown;
  readonly tenant: unknown;
  readonly project: unknown;
  readonly spec: unknown;
}

/** Guard: one input IS the demo seed's own submission (the exact spec + the demo scope + the credential-side kind — a user submission of a lookalike spec to another project never matches). */
function isDemoSeedSubmission(input: DemoSeedJobInput): boolean {
  if (input.project !== DEMO_PROJECT_ID) return false;
  if (input.kind === 'research') return canonicalJson(input.spec as never) === canonicalJson(demoSeedResearchJobSpec() as never);
  if (input.kind === 'learning') return canonicalJson(input.spec as never) === canonicalJson(demoSeedLearningJobSpec() as never);
  return false;
}

/**
 * THE DEMO-SEED PRIMING LATCH (FW-31-B): a per-port-instance once-latch that
 * serves the deterministic seeded record for the seed's OWN submission (the
 * exact demo-seed spec + the demo project + the fixed idempotency keys the
 * boundary's own per-instance idempotency cache already dedupes — so the
 * seed hits the port at most once per kind per instance). The FIRST
 * matching submission returns `demoSeedJobRecord` verbatim; any LATER
 * lookalike (a user replaying the demo seed's spec shape) falls through to
 * the fixture engine's normal mint — the latch is the seed's own identity
 * law, never a general interception. Shared by BOTH backings' job ports:
 * the demo arm's `demoJobSubmission` wrapper and the durable seam's
 * hydration-aware port (durable.ts) — one law, two port seams.
 */
export function demoSeedJobPrimingLatch(): {
  /** The deterministic record when THIS submission is the seed's own first submission of its kind on this port instance; null = not the seed's (fall through). */
  prime(input: DemoSeedJobInput): JobRecord | null;
} {
  const primed = new Set<string>();
  return {
    prime(input: DemoSeedJobInput): JobRecord | null {
      if (!isDemoSeedSubmission(input)) return null;
      const kind = input.kind as 'research' | 'learning';
      const tenant = input.tenant as string;
      const key = `${tenant}/${kind}`;
      if (primed.has(key)) return null; // once per kind per port instance — a lookalike later rides the normal mint
      primed.add(key);
      return demoSeedJobRecord(tenant, kind);
    },
  };
}

/** The demo project's watch-snapshot instant: the deterministic demo epoch for the DEMO project, the caller's own instant for every launched desk (a live desk's observation is genuinely fresh). */
export function demoOrgSnapshotInstantOf(projectId: string, at: number): number {
  return projectId === DEMO_PROJECT_ID ? DEMO_ORG_SNAPSHOT_AT : at;
}

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
    // R3 (W-8) — the decision-audit substance, ADDITIVE fields on the
    // mirror shape (the structural guards check presence, never absence;
    // the names deliberately avoid the console watch surface's
    // reasoning-key vocabulary so the chain-of-thought firewall keeps
    // passing): the deciding body behind decision xd:demo0001, its stated
    // rationale (audit prose, the post-mortem-note class), and the
    // pre-trade risk checks that passed before the fill.
    decisionBody: DEMO_EXECUTION_DESK,
    decisionRationale: 'The desk approved the 0.75 BTC-USD rebalance on a 0.07 weight drift against the 0.25 target; the realized fill landed -12.5 against the 45.5 expectation (tolerance 0.05) — the adverse gap post-mortem pmr:demo0001 attributes to the simulated venue lag.',
    riskChecks: [
      { dimension: 'kill_switch', outcome: 'pass' },
      { dimension: 'identity', outcome: 'pass' },
      { dimension: 'authorization', outcome: 'pass' },
      { dimension: 'limits', outcome: 'pass' },
      { dimension: 'venue_permissions', outcome: 'pass' },
      { dimension: 'rate_limits', outcome: 'pass' },
      { dimension: 'credentials', outcome: 'pass' },
    ],
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
// The demo execution blotter (R2 — the execution surface's seeded substance)
// ---------------------------------------------------------------------------

/** One seeded blotter row's order echo (the intent's order form, verbatim fields). */
interface DemoBlotterOrder {
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly venueId: string;
  readonly side: 'buy' | 'sell';
  readonly kind: string;
  readonly quantity: string;
  readonly price: string;
  readonly timeInForce: string;
  readonly createdAt: string;
}

/** One seeded blotter row's simulated fill (the honest SIMULATED economics). */
interface DemoBlotterFill {
  readonly state: 'filled';
  readonly quantity: string;
  readonly price: string;
  readonly notional: string;
  readonly fee: string;
  readonly filledAt: number;
}

/** A deterministic demo submission id ('xgs:' + 8 hex — the boundary's own grammar). */
function demoSubmissionId(story: string): string {
  return `xgs:${fnv1a32Hex(canonicalJson(['demo-submission', story] as never))}`;
}

/** One pre-trade risk check as the decision-audit substance carries it (the watch surface's own shape). */
export interface DemoRiskCheck {
  readonly dimension: string;
  readonly outcome: string;
}

/** A typed evidence reference (kind + ref — the records' own evidence-refs shape). */
export interface DemoEvidenceRef {
  readonly kind: string;
  readonly ref: string;
}

/**
 * ONE SEEDED BLOTTER ROW: the boundary's own GatewaySubmissionRecord shape
 * (routed | refused — the guard passes on every row) PLUS the ADDITIVE
 * demo-substance fields (the console's contracts may gain optional fields
 * in parallel — the render surface owns their display):
 *   - `order` — the order form echo (ids, instrument, side, quantity, price);
 *   - `fill` — the simulated fill (state, notional, fee, timestamps);
 *   - `decisionBody` / `decisionRationale` / `riskChecks` / `evidence` — the
 *     R3 decision-audit substance (a named deciding body, the decision's
 *     stated rationale, the pre-trade risk checks with outcomes, evidence
 *     refs that resolve to the REAL seeded records). The names deliberately
 *     avoid the console watch surface's reasoning-key vocabulary
 *     (apps/web/src/core/watch.ts REASONING_KEYS) — the enriched records
 *     keep passing its chain-of-thought firewall.
 */
export type DemoBlotterRow = GatewaySubmissionRecord & {
  readonly order?: DemoBlotterOrder;
  readonly fill?: DemoBlotterFill;
  readonly decisionBody?: string;
  readonly decisionRationale?: string;
  readonly riskChecks?: readonly DemoRiskCheck[];
  readonly evidence?: readonly DemoEvidenceRef[];
};

/** The pre-trade risk-check pass list the routed rows carry (the R3 audit substance). */
const PASSED_PRE_TRADE_CHECKS: readonly DemoRiskCheck[] = deepFreeze([
  { dimension: 'kill_switch', outcome: 'pass' },
  { dimension: 'identity', outcome: 'pass' },
  { dimension: 'authorization', outcome: 'pass' },
  { dimension: 'limits', outcome: 'pass' },
  { dimension: 'venue_permissions', outcome: 'pass' },
  { dimension: 'rate_limits', outcome: 'pass' },
  { dimension: 'credentials', outcome: 'pass' },
]);

/**
 * THE DEMO EXECUTION BLOTTER (R2, W-8): seeded gateway-submission records —
 * the console's Execution section reads exactly the GatewaySubmissionRecord
 * shape (routed | refused), so every row IS that shape (the boundary's own
 * guard passes on each), enriched with ADDITIVE fields the console render
 * may surface: `order` (the order form echo — ids, instrument, side,
 * quantity, price), `fill` (the simulated fill — state, notional, fee,
 * timestamps), and the R3 decision-audit substance (`decisionBody`,
 * `decisionRationale`, `riskChecks`, `evidence` — refs that resolve to the
 * REAL seeded records). Row 1 is THE seeded fill's own story: the 0.75
 * BTC-USD limit buy at 61000.50 (notional 45750.375, fee 0.02) whose
 * adverse gap out:demo0001 / post-mortem pmr:demo0001 carry — the blotter
 * and the Outcomes section now tell one coherent tale. Row 3 is an honest
 * risk-limit refusal: the hard risk gate demonstrably refuses (the
 * k-position gross-exposure cap the demo constraint set declares).
 */
export function demoSubmissionBlotter(): readonly DemoBlotterRow[] {
  const buyOrder: DemoBlotterOrder = {
    clientOrderId: 'ord-demo-0001',
    instrumentId: 'BTC-USD',
    venueId: 'BROKER-FIX',
    side: 'buy',
    kind: 'limit',
    quantity: '0.75',
    price: '61000.50',
    timeInForce: 'gtc',
    createdAt: new Date(DEMO_T0).toISOString(),
  };
  const trimOrder: DemoBlotterOrder = {
    clientOrderId: 'ord-demo-0002',
    instrumentId: 'ETH-USD',
    venueId: 'BROKER-FIX',
    side: 'sell',
    kind: 'limit',
    quantity: '6.0',
    price: '3412.10',
    timeInForce: 'gtc',
    createdAt: new Date(DEMO_T0 + 60_000).toISOString(),
  };
  const refusedOrder: DemoBlotterOrder = {
    clientOrderId: 'ord-demo-0003',
    instrumentId: 'BTC-USD',
    venueId: 'BROKER-FIX',
    side: 'buy',
    kind: 'limit',
    quantity: '0.9',
    price: '61000.50',
    timeInForce: 'gtc',
    createdAt: new Date(DEMO_T0 + 120_000).toISOString(),
  };
  const seededFill: DemoBlotterFill = { state: 'filled', quantity: '0.75', price: '61000.50', notional: '45750.375', fee: '0.02', filledAt: DEMO_T0 + 250 };
  const trimFill: DemoBlotterFill = { state: 'filled', quantity: '6.0', price: '3412.10', notional: '20472.60', fee: '0.03', filledAt: DEMO_T0 + 60_250 };
  return deepFreeze([
    // Row 1 — the seeded adverse-gap trade: routed + filled; decision
    // xd:demo0001 / intent si:demo0001 (the outcome record's own refs).
    {
      kind: 'routed',
      submissionId: demoSubmissionId('0001'),
      decisionId: 'xd:demo0001',
      auditId: 'xga:demo0001',
      requestRef: 'gor:demo0001',
      venue: 'BROKER-FIX',
      adapterRef: 'adapter:demo-broker',
      channelRef: 'chan:demo-main',
      routedAt: DEMO_T0 as TimestampMs,
      order: buyOrder,
      fill: seededFill,
      decisionBody: DEMO_EXECUTION_DESK,
      decisionRationale: 'Rebalance drift on BTC-USD reached 0.07 against the 0.25 target weight; the desk ordered a 0.75 limit buy at the seeded session price to restore the band. The gateway routed it; the fill economics (notional 45750.375, fee 0.02) are the outcome out:demo0001\'s own realization.',
      riskChecks: PASSED_PRE_TRADE_CHECKS,
      evidence: [
        { kind: 'shadow_outcome', ref: 'swo:demo0001' },
        { kind: 'shadow_session', ref: 'shs:demo0001' },
        { kind: 'outcome', ref: 'out:demo0001' },
      ],
    },
    // Row 2 — the same shadow session's trim: routed + filled, clean.
    {
      kind: 'routed',
      submissionId: demoSubmissionId('0002'),
      decisionId: 'xd:demo0002',
      auditId: 'xga:demo0002',
      requestRef: 'gor:demo0002',
      venue: 'BROKER-FIX',
      adapterRef: 'adapter:demo-broker',
      channelRef: 'chan:demo-main',
      routedAt: (DEMO_T0 + 60_000) as TimestampMs,
      order: trimOrder,
      fill: trimFill,
      decisionBody: DEMO_EXECUTION_DESK,
      decisionRationale: 'Trim the ETH-USD overweight after the session\'s adverse gap; a 6.0 limit sell reduces concentrated exposure ahead of the post-mortem window.',
      riskChecks: PASSED_PRE_TRADE_CHECKS,
      evidence: [
        { kind: 'shadow_session', ref: 'shs:demo0001' },
        { kind: 'outcome', ref: 'out:demo0001' },
      ],
    },
    // Row 3 — the honest refusal: the hard risk gate demonstrably says no
    // (the risk-limits stage; the k-position cap the demo constraint set
    // declares). A blotter that only ever fills would be a lie.
    {
      kind: 'refused',
      submissionId: demoSubmissionId('0003'),
      decisionId: null,
      auditId: 'xga:demo0003',
      refusal: {
        stage: 'risk_limits',
        evaluationId: 'rev:demo0003',
        refusals: [
          { constraintId: 'k-position', domain: 'state', subject: 'position.grossExposure', severity: 'blocking', predicate: { kind: 'limit.max', bound: 2 }, observed: '2.4' },
        ],
      },
      refusedAt: (DEMO_T0 + 120_000) as TimestampMs,
      order: refusedOrder,
      decisionBody: DEMO_RISK_GATE,
      decisionRationale: 'The order was refused at the risk-limits stage: projected gross exposure 2.4 exceeds the blocking limit.max bound 2 (constraint k-position of cs-tradrl-demo). The desk\'s request never reached routing.',
      riskChecks: [{ dimension: 'risk_limits', outcome: 'refused' }],
      evidence: [{ kind: 'gateway-audit', ref: 'xga:demo0003' }],
    },
  ]);
}

// ---------------------------------------------------------------------------
// THE PER-PROJECT EVIDENCE STREAM (FW-MI-B — MI-D2 + MI-D10: every
// LAUNCHED desk gets its own honest simulated evidence stream)
// ---------------------------------------------------------------------------

/**
 * The structural ports a per-project evidence derivation reads (the
 * W-25B goal-set capture + the W-28 world capture + the project listing
 * for the compiled gate). Widened exactly like DemoMachineryContext's
 * own `ports` — `DemoPorts` satisfies it structurally, and lighter
 * callers (the tests) may pass the pair alone.
 */
export interface DemoEvidencePorts {
  /** The demo control plane (its goalSets capture — every create's goal + constraint set). */
  readonly controlPlane: ReturnType<typeof demoControlPlane>;
  /** The demo job-submission port (its worlds capture — every console-launch spec's world). */
  readonly jobSubmission: ReturnType<typeof demoJobSubmission>;
}

/**
 * THE DEMO ARM'S PER-PROJECT EVIDENCE FOLD (FW-MI-B, MI-D2): one
 * LAUNCHED project's derived evidence stream — the pure generator
 * (runtime/project-evidence.ts) applied to the project's OWN captured
 * envelope (its goal set + its launch world) behind the COMPILE gate
 * (the project's organization ref must be bound — a draft desk has no
 * trading history; the machinery's org-compile pass binds it once per
 * project, so the stream comes into existence at compile time exactly
 * like the organization itself does).
 *
 * The gates (each answers `null` — the honest pre-fix emptiness):
 *   - the DEMO project is excluded (it carries its own hand-authored
 *     seed, pinned byte-identical by tests — the derived stream would
 *     double its records);
 *   - no captured goal set / no captured world (a foreign create, a
 *     pre-W-28 launch, a cross-tenant read) — nothing to derive FROM;
 *   - not compiled (organizationRef null) — the desk has not launched;
 *   - a malformed or zero-budget envelope — the generator's own gate.
 *
 * L12 by construction: the captures key on the AUTHORIZED tenant (the
 * pipeline injected it at create/submit; a foreign tenant's fold finds
 * nothing). Deterministic: the same captured envelope derives the same
 * records on every call, every instance, every cold start — no seeded
 * state exists to lose.
 */
export function demoProjectEvidenceOf(ports: DemoEvidencePorts, tenant: string, project: string): ProjectEvidenceSeed | null {
  if (project === DEMO_PROJECT_ID) return null; // the demo scope's own hand-authored seed is the whole story there
  const goalSet = ports.controlPlane.goalSets.get(`${tenant}/${project}`);
  if (goalSet === undefined) return null; // no captured goal set — nothing to derive from
  const world = ports.jobSubmission.worlds.get(`${tenant}/${project}`);
  if (world === undefined) return null; // no captured launch world — no markets to trade
  const organizationRef = organizationRefOfProject(ports.controlPlane, tenant, project);
  if (organizationRef === null) return null; // not compiled — a draft desk has no trading history
  return deriveProjectEvidence({ tenant, project, goal: goalSet.goal, constraintSet: goalSet.constraintSet, world, organizationRef });
}

// ---------------------------------------------------------------------------
// THE DELIVERABLE SOURCE (FW-36-A, Round E register E-1 — the research
// deliverable composition's inputs, over each backing's own captured
// surfaces; the demoProjectEvidenceOf/durableProjectEvidenceOf precedent)
// ---------------------------------------------------------------------------

/** The demo scope's own observed world state: the SEEDED blotter's instruments + venues (never a fabricated world record). */
function demoSeededObservedState(): DeliverableObservedState {
  const markets: string[] = [];
  const venues: string[] = [];
  for (const row of demoSubmissionBlotter()) {
    const order = row.order; // optional on the enriched shape — the refused row's echo is present, a bare record's may not be
    if (order === undefined) continue;
    if (!markets.includes(order.instrumentId)) markets.push(order.instrumentId);
    if (!venues.includes(order.venueId)) venues.push(order.venueId);
  }
  return deepFreeze({ markets: Object.freeze(markets), venues: Object.freeze(venues) });
}

/** The promotion-reader the deliverable sources share (structural — the composition's PromotionRegistry satisfies it; never imported here). */
interface DeliverablePromotionReader {
  readonly decisionOfJob: (tenant: string, jobId: string) => { readonly outcomeId: string } | null;
}

/**
 * THE DEMO ARM'S DELIVERABLE SOURCE (FW-36-A E-1): the W-25B goal-set capture
 * (goal + constraint set, verbatim) + the W-28 world capture + the promotion
 * registry, keyed on the AUTHORIZED tenant (L12 — a foreign tenant's capture
 * never exists at this composition to begin with). The DEMO project's world
 * is world-less BY DESIGN (W-28's own law) — its observed state is the seeded
 * blotter's own instruments, and its mandate is the demo seed's own captured
 * goal set (the seed's create rode the same route, so the capture holds it).
 * Every read is nullable — nothing on record composes the HONEST degraded
 * statements, never a fabricated number (THE HONESTY LAW).
 */
export function demoDeliverableSourceOf(
  tenant: string,
  ports: DemoEvidencePorts,
  promotions: DeliverablePromotionReader | null,
): DeliverableSource {
  return {
    mandateOf(project) {
      const goalSet = ports.controlPlane.goalSets.get(`${tenant}/${project}`);
      if (goalSet === undefined) return null; // nothing captured — the composer's honest "no goal statement on record"
      const world = ports.jobSubmission.worlds.get(`${tenant}/${project}`) ?? null; // the DEMO project stays world-less by design
      return { goal: goalSet.goal, constraintSet: goalSet.constraintSet, world };
    },
    observedOf(project) {
      if (project === DEMO_PROJECT_ID) return demoSeededObservedState();
      const world = ports.jobSubmission.worlds.get(`${tenant}/${project}`);
      return world === undefined ? null : { markets: world.markets, venues: world.venues };
    },
    promotionOf(jobId) {
      const decision = promotions === null ? null : promotions.decisionOfJob(tenant, jobId);
      return decision === null ? null : { outcomeId: decision.outcomeId };
    },
  };
}

/**
 * THE DURABLE ARM'S DELIVERABLE SOURCE (FW-36-A E-1): the same law over the
 * W-25D seam's own hydrated surfaces (DurableEvidenceSource.goalSetOf — goal
 * + constraint set + the rehydrated W-28 world, already tenant-scoped by the
 * seam's construction) + the promotion registry. The DEMO project's observed
 * state is the same seeded blotter (the boot world writes those rows durably).
 */
export function durableDeliverableSourceOf(
  tenant: string,
  source: DurableEvidenceSource,
  promotions: DeliverablePromotionReader | null,
): DeliverableSource {
  return {
    mandateOf(project) {
      const goalSet = source.goalSetOf(project);
      return goalSet === null ? null : { goal: goalSet.goal, constraintSet: goalSet.constraintSet, world: goalSet.world };
    },
    // FW-38-A (G-6): the DEGRADED/ABSENT distinction rides the deliverable
    // source — a degraded seam goal read (the projection in flight or dirty)
    // is NEVER an honest "no goal on record", so the tick must not compose
    // the honest-absence text from it (the job waits one tick; the
    // projection's own settled() law lands it).
    ...(source.goalSetDegradedOf === undefined ? {} : { mandateDegradedOf: (project: string) => source.goalSetDegradedOf!(project) }),
    observedOf(project) {
      if (project === DEMO_PROJECT_ID) return demoSeededObservedState();
      const world = source.goalSetOf(project)?.world ?? null;
      return world === null ? null : { markets: world.markets, venues: world.venues };
    },
    promotionOf(jobId) {
      const decision = promotions === null ? null : promotions.decisionOfJob(tenant, jobId);
      return decision === null ? null : { outcomeId: decision.outcomeId };
    },
  };
}

/** The organization ref of one project of one tenant (null when unbound, unknown, or the listing fails — R46). */
function organizationRefOfProject(controlPlane: ControlPlanePort, tenant: string, project: string): string | null {
  const listed = controlPlane.projectsOf(tenant as TenantId);
  if (!listed.ok) return null; // R46: a port failure answers nothing — never a crash
  const record = listed.value.find((entry) => (entry.id as string) === project);
  if (record === undefined) return null;
  const organizationRef = record.lifecycle.organizationRef;
  return typeof organizationRef === 'string' && organizationRef.length > 0 ? organizationRef : null;
}

/**
 * THE DURABLE ARM'S EVIDENCE SOURCE (FW-MI-B): the same derivation over
 * the W-25D seam's own surfaces — the hydrated goal set (goal +
 * constraint set + the W-28 world, rehydrated at every cold start) and
 * the hydrated control plane's project listing (the compile gate).
 * Structural, like DemoEvidencePorts: the composition (runtime/compose.ts)
 * implements it over the DurableBackingHandle; the same pure generator
 * runs under both backings (imported, never duplicated).
 */
export interface DurableEvidenceSource {
  /** The durable goal set of one project (null when absent or degraded). */
  goalSetOf(project: string): { readonly goal: GoalStatement; readonly constraintSet: ConstraintSetStatement; readonly world: LaunchWorldRecord | null } | null;
  /**
   * FW-38-A (Round G register G-6): the goal-set read's DEGRADED state,
   * distinct from absent — true when the seam's goal read is currently the
   * typed degraded state (the projection in flight or dirty), in which
   * case the deliverable source's mandate read is NOT an honest absence and
   * the machinery tick must not compose from it (the composition must read
   * the CURRENT project's goal record — never the honest-absence text while
   * a goal exists behind the degraded read). Optional + additive: a source
   * that never degrades (the demo arm's per-instance capture) omits it.
   */
  readonly goalSetDegradedOf?: (project: string) => boolean;
  /** The organization ref of one project of one tenant (null when unbound, unknown or degraded). */
  organizationRefOf(tenant: string, project: string): string | null;
}

/** THE DURABLE ARM'S PER-PROJECT EVIDENCE FOLD (the same gates as the demo arm's, over the seam's own surfaces). */
export function durableProjectEvidenceOf(source: DurableEvidenceSource, tenant: string, project: string): ProjectEvidenceSeed | null {
  if (project === DEMO_PROJECT_ID) return null; // the demo project's fixture substance is boot-written (durable-world.ts R4)
  const goalSet = source.goalSetOf(project);
  if (goalSet === null) return null;
  if (goalSet.world === null) return null; // no launch world — no markets to trade
  const organizationRef = source.organizationRefOf(tenant, project);
  if (organizationRef === null) return null; // not compiled — a draft desk has no trading history
  return deriveProjectEvidence({ tenant, project, goal: goalSet.goal, constraintSet: goalSet.constraintSet, world: goalSet.world, organizationRef });
}

// ---------------------------------------------------------------------------
// THE OUTCOME DURABLE WRITE LANE (FW-33-A — the launched-desk record
// durability wave, Round B blocker 1): the typed surface a durable-backed
// outcome port carries so PER-INSTANCE derived records — a promoted
// decision the host promote route minted (runtime/job-promote.ts) — can
// WRITE-THROUGH into the durable outcome store, the same store lane the
// boot-world fixtures ride (NeonOutcomeLearningStore's putOutcome, queued
// onto the seam's pending drain per the W-25D ordering law). Under the
// DEMO backing no port carries a lane: the demo world's records stay
// per-instance, honestly under SIMULATED (the pre-law, unchanged).
// ---------------------------------------------------------------------------

/**
 * The outcome durable write lane (FW-33-A): queue one outcome record's
 * durable write-through onto the seam's pending drain. IDEMPOTENT by
 * construction — a record whose exact payload the serving projection (or
 * an already-queued write) already carries queues nothing; a foreign
 * tenant's record is refused (L12 — never queued). The drain's failure
 * law is the seam's own (the ordering law: a failed write is the typed
 * 503 on the request that drains it + the re-projection).
 */
export interface OutcomeDurableWriteLane {
  /** Queue the durable putOutcome write for one outcome record (idempotent; rides the drain). */
  readonly recordOutcome: (record: OutcomeRecordMirror) => void;
}

/**
 * The field a durable-backed outcome port carries the lane under (the
 * ports-with-extra-surfaces precedent — demoExecutionGateway's `recorded`,
 * demoJobSubmission's `worlds` capture). The derived-rows wrappers
 * PROPAGATE the field so the composition's wrapper chain (the seam port
 * -> outcomeLearningWithProjectEvidence ->
 * outcomeLearningWithPromotedDecisions) carries the lane end-to-end with
 * no composition change — the wrapper chain is the one composition-time
 * channel the seam's lane and the promotion registry share.
 */
export const OUTCOME_DURABLE_LANE_FIELD = 'outcomeDurableWriteLane';

/** An outcome-learning port that MAY carry the durable write lane (optional — the demo arm's fixture port never does). */
export type OutcomeLearningPortWithDurableLane = OutcomeLearningPort & {
  readonly [OUTCOME_DURABLE_LANE_FIELD]?: OutcomeDurableWriteLane;
};

/**
 * The structural lane probe (never a throw — R46): the durable write lane
 * a port carries, or null when it carries none (the demo arm's fixture
 * port, a hand-rolled test port, a foreign shape).
 */
export function outcomeDurableLaneOf(port: OutcomeLearningPort): OutcomeDurableWriteLane | null {
  const lane = (port as OutcomeLearningPortWithDurableLane)[OUTCOME_DURABLE_LANE_FIELD];
  if (typeof lane !== 'object' || lane === null) return null;
  return typeof lane.recordOutcome === 'function' ? lane : null;
}

/**
 * THE OUTCOME-LEARNING WRAPPER (FW-MI-B): the base port (the fixture
 * fake under demo, the seam's hydrated port under durable) wrapped so
 * the per-project derived records serve ALONGSIDE the base rows — the
 * frozen boundary's outcome/post-mortem reads (/v1/outcomes/query, /v1/post-mortems/query)
 * then serve a LAUNCHED desk's own stream exactly like the demo
 * project's seeded records. Idempotent by construction: the derived
 * ids are content-addressed, and a base row that already carries the
 * id (a re-hydration of the same record, a future durable persistence)
 * is never duplicated. The base port's typed failures pass through
 * untouched (the degraded states stay the seam's own — R46).
 *
 * FW-33-A: the wrapper PROPAGATES the base port's durable write lane
 * (when it carries one) onto the wrapper it returns, so the promoted-
 * decisions wrapper composed ABOVE it (runtime/job-promote.ts) can
 * write the host route's minted records through — the wrapper chain is
 * the one composition-time channel the seam's lane and the promotion
 * registry share (the composition wires the chain; the lane rides it).
 */
export function outcomeLearningWithProjectEvidence(
  inner: OutcomeLearningPort,
  projectEvidenceOf: (tenant: string, project: string) => ProjectEvidenceSeed | null,
): OutcomeLearningPort {
  const lane = outcomeDurableLaneOf(inner); // null under demo — the per-instance law, unchanged
  return {
    queryOutcomes(query, options) {
      const result = inner.queryOutcomes(query, options);
      if (!result.ok) return result; // the base port's typed failure passes through untouched
      const seed = projectEvidenceOf(query.tenant, query.project);
      if (seed === null) return result;
      if (result.value.some((record) => record.outcomeId === seed.outcome.outcomeId)) return result; // idempotent — never a duplicate
      return { ok: true, value: Object.freeze([...result.value, seed.outcome]) };
    },
    queryPostMortems(query, options) {
      const result = inner.queryPostMortems(query, options);
      if (!result.ok) return result;
      const seed = projectEvidenceOf(query.tenant, query.project);
      if (seed === null) return result;
      if (result.value.some((record) => record.postMortemId === seed.postMortem.postMortemId)) return result;
      return { ok: true, value: Object.freeze([...result.value, seed.postMortem]) };
    },
    // FW-33-A: the lane rides the wrapper (the composition's outcome chain
    // stays lane-capable end-to-end; absent under demo — no field, no lane).
    ...(lane === null ? {} : { [OUTCOME_DURABLE_LANE_FIELD]: lane }),
  } as OutcomeLearningPort;
}

// ---------------------------------------------------------------------------
// The demo ports (the fixture fakes, knowledge/outcome/blotter data seeded)
// ---------------------------------------------------------------------------

/** One live-recorded gateway submission (the record + the intent's project scope). */
export interface DemoGatewayRecording {
  readonly record: GatewaySubmissionRecord;
  readonly project: string;
}

/**
 * The demo execution gateway: the REAL fixture recording fake, wrapped so
 * every submission the boundary ROUTES through it is also RECORDED (record
 * + the intent's project) — the host-owned execution blotter read route
 * (runtime/routes.ts) serves the seeded rows PLUS these live rows, so the
 * Execution section is a real blotter (seeded history + session activity).
 * The routed responses themselves are the fixture's own records, verbatim
 * (W-3f behavior unchanged).
 */
export function demoExecutionGateway(): ExecutionGatewayPort & { readonly recorded: readonly DemoGatewayRecording[] } {
  const recorded: DemoGatewayRecording[] = [];
  const inner = recordingGateway((intent) => routedSubmission(intent, intent.asOf));
  return {
    get recorded(): readonly DemoGatewayRecording[] {
      return Object.freeze([...recorded]);
    },
    submitRequest(intent: StrategyIntent) {
      const result = inner.submitRequest(intent);
      if (result.ok) recorded.push({ record: result.value, project: intent.project });
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// The launch world specification (D-8, W-28 — the market world, persisted
// at the job-spec seam and served by the host-owned goal route)
// ---------------------------------------------------------------------------

/** The spec-kind marker the console's launch flow stamps on its kickoff job spec (apps/web core/launch.ts toLaunchJobSpec). */
export const LAUNCH_JOB_SPEC_KIND = 'console-launch';

/**
 * THE LAUNCH WORLD SPECIFICATION (D-8, W-28): the market-world fields the
 * console's launch wizard collects (markets/venues/data sources + the
 * world-shaped launch context — execution mode, the budgets, the horizon).
 * The console carries them in the kickoff job's OPAQUE spec (the only
 * console->host carrier the frozen contracts leave room for: the
 * create-project request's parser keeps exactly id/name/executionMode/goal/
 * constraintSet/at, while the job spec passes through untouched); the
 * backings capture the world HERE, at the job port seam, and persist it in
 * the goal-set record's opaque payload (the DURABLE seam merges it into the
 * tradrl_project_goals row — no schema change; the DEMO backing retains it
 * per instance). The host-owned goal route serves it back as the ADDITIVE
 * `world` field of the goal bundle, so the console's Market World section
 * renders the PERSISTED world after a reload, a scope switch or a cold
 * start (D-8's defect: the section was bound to the in-session launch
 * draft and rendered its teaching empty state forever after a reload).
 */
export interface LaunchWorldRecord {
  /** The markets (instrument ids), e.g. ['BTC-USD', 'ETH-USD']. */
  readonly markets: readonly string[];
  /** The venues, e.g. ['binance', 'kraken']. */
  readonly venues: readonly string[];
  /** The data source refs, e.g. ['candle-v1', 'depth-v1', 'trades-v1']. */
  readonly dataSources: readonly string[];
  /** The execution mode (simulation | shadow | live). */
  readonly executionMode: string;
  /** The capital budget — an exact decimal string. */
  readonly capitalBudget: string;
  /** The risk budget — an exact decimal string. */
  readonly riskBudget: string;
  /** The horizon (epoch ms bounds + the optional label). */
  readonly horizon: { readonly startsAt: number; readonly endsAt: number; readonly label?: string };
}

/** Guard: a non-empty array of non-empty strings (the world's list fields). */
function isNonEmptyStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

// ---------------------------------------------------------------------------
// THE HORIZON SPAN LABEL (FW-37-A, Round F register F-4 — the round's most
// frequent defect, 8/9 personas)
// ---------------------------------------------------------------------------

/** One UTC day, in epoch milliseconds (the span label's whole-day unit). */
const SPAN_DAY_MS = 86_400_000;

/**
 * THE SPAN-DERIVED HORIZON LABEL (FW-37-A, F-4): the human-readable horizon
 * label COMPUTED from the record's own bounds — never a free-text
 * annotation trusted off the wire. The pre-fix defect: the console's launch
 * draft stamps its default label ('one day') and never updates it when the
 * horizon end moves, so 30/45/60/90-day horizons rendered "(one day)" in
 * the research deliverable and the export's launchWorld.horizon.label while
 * the DATES stayed correct (S1's 90-day "2160h 00m 00s" review vs its
 * "(one day)" deliverable — 8/9 independent Round F confirmations). The
 * honest label is a COMPUTED FACT of the span: whole-day spans render in
 * days ('one day', '30 days', '90 days' — the 1-day case was the only
 * correct pre-fix rendering); any other span renders the wizard review's
 * own precise hours/minutes/seconds form ('2160h 00m 00s'), so the label
 * can NEVER contradict the bounds it annotates (reconcilable by
 * arithmetic — the anti-deception law's own standard).
 */
export function horizonSpanLabel(startsAt: number, endsAt: number): string {
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return 'an unverifiable span';
  const span = endsAt - startsAt;
  if (span <= 0) return 'an empty span';
  if (span % SPAN_DAY_MS === 0) {
    const days = span / SPAN_DAY_MS;
    return days === 1 ? 'one day' : `${days} days`;
  }
  const hours = Math.floor(span / 3_600_000);
  const minutes = Math.floor((span % 3_600_000) / 60_000);
  const seconds = Math.floor((span % 60_000) / 1000);
  return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

/**
 * Re-derive one captured launch world's horizon label from its own bounds
 * (FW-37-A, F-4 — the serve-side half): the capture seam derives the label
 * at extraction (launchWorldOfSpec), and the serve seams re-derive it so a
 * world persisted BEFORE this wave (a durable row carrying the console's
 * stale 'one day' annotation) serves the SAME span-derived label as a fresh
 * capture — one law, every record, never a contradictory annotation on the
 * wire. Pure + structural: a malformed horizon answers the record
 * unchanged (R46 — the guard already kept the row off the wire).
 */
export function withDerivedHorizonLabel(world: LaunchWorldRecord): LaunchWorldRecord {
  const horizon = world.horizon as { readonly startsAt?: unknown; readonly endsAt?: unknown } | null;
  if (horizon === null || typeof horizon !== 'object') return world;
  if (typeof horizon.startsAt !== 'number' || !Number.isFinite(horizon.startsAt)) return world;
  if (typeof horizon.endsAt !== 'number' || !Number.isFinite(horizon.endsAt)) return world;
  return deepFreeze({ ...world, horizon: { startsAt: horizon.startsAt, endsAt: horizon.endsAt, label: horizonSpanLabel(horizon.startsAt, horizon.endsAt) } });
}

/**
 * Re-derive ONE GOAL STATEMENT's horizon label from its own bounds (FW-38-A,
 * Round G register G-1 — the goal-capture seam, F-4's completion): FW-37-A
 * fixed the horizon label at the deliverable + launchWorld seams, but the
 * GOAL record is born at the CREATE-PROJECT capture with the console
 * wizard's free-text annotation trusted off the wire — and the wizard's
 * draft stamps its default label ('one day') and never updates it when the
 * horizon end moves, so 30/45/60/90-day spans served "horizon label: one
 * day" on the Goal card and in the export's goal record (9/9 Round G
 * personas) while the SAME launch's deliverable said "(span 90 days)". The
 * same span-derived law now applies to the goal statement: the label is a
 * COMPUTED FACT of the record's own bounds (horizonSpanLabel), never a
 * free-text annotation trusted off the wire — applied at the CAPTURE seams
 * (demoControlPlane.createProject + the durable control-plane port's
 * createProject, so the record is BORN right) and at the goal-read seams
 * (so a row persisted BEFORE this wave serves the same derived label as a
 * fresh capture — one law, every record, never a contradictory annotation
 * on the wire). Pure + structural: a malformed horizon answers the record
 * unchanged (R46 — the create-project parser's own guard already kept such
 * a row off the wire).
 */
export function withDerivedGoalHorizonLabel<T>(goal: T): T {
  if (!isRecord(goal)) return goal; // not a record-shaped goal — the value passes through unchanged (R46)
  const horizon = (goal as { readonly horizon?: unknown }).horizon as { readonly startsAt?: unknown; readonly endsAt?: unknown } | null | undefined;
  if (horizon === null || horizon === undefined || typeof horizon !== 'object') return goal;
  if (typeof horizon.startsAt !== 'number' || !Number.isFinite(horizon.startsAt)) return goal;
  if (typeof horizon.endsAt !== 'number' || !Number.isFinite(horizon.endsAt)) return goal;
  // The generic pass-through keeps the caller's own record type (the branded
  // TimestampMs bounds are the SAME numbers — the brand is compile-time only).
  return deepFreeze({ ...goal, horizon: { startsAt: horizon.startsAt, endsAt: horizon.endsAt, label: horizonSpanLabel(horizon.startsAt, horizon.endsAt) } }) as T;
}

/**
 * Guard: a structurally valid launch world record (D-8, W-28). The goal
 * route re-validates a DURABLE-decoded world with this before serving it —
 * a pre-W-28 or malformed payload never crosses to the console (the route
 * simply serves no `world` field; R46, never a crash).
 */
export function isLaunchWorldRecord(value: unknown): value is LaunchWorldRecord {
  return launchWorldOfSpec({ kind: LAUNCH_JOB_SPEC_KIND, ...(isRecord(value) ? value : {}) }) !== null;
}

/**
 * Extract the launch world specification from a job spec, STRUCTURALLY
 * (never a throw — R46): a spec is a console launch spec iff it carries the
 * `console-launch` kind marker AND every world field validates. Anything
 * else (the demo seed's `demo-seed` specs, hydration replays, foreign or
 * malformed specs) answers `null` — the backing captures nothing for it
 * (the demo project's goal stays world-less BY DESIGN: the demo scope's
 * teaching empty state is correct and must be preserved). The extracted
 * record is a frozen copy — the caller may persist it without aliasing the
 * request's spec object.
 *
 * FW-37-A (F-4): the horizon LABEL is derived from the horizon's own
 * bounds (horizonSpanLabel) — the console's free-text annotation is
 * deliberately NOT trusted off the wire (the launch draft's stale 'one day'
 * default rode 30/45/60/90-day horizons into the deliverable and the
 * export; the bounds are the machine truth, and the label is now a
 * computed fact of them, so it can never contradict the span it annotates).
 */
export function launchWorldOfSpec(spec: unknown): LaunchWorldRecord | null {
  if (!isRecord(spec)) return null;
  if (spec.kind !== LAUNCH_JOB_SPEC_KIND) return null;
  if (!isNonEmptyStringList(spec.markets)) return null;
  if (!isNonEmptyStringList(spec.venues)) return null;
  if (!isNonEmptyStringList(spec.dataSources)) return null;
  if (typeof spec.executionMode !== 'string' || spec.executionMode.length === 0) return null;
  if (typeof spec.capitalBudget !== 'string' || spec.capitalBudget.length === 0) return null;
  if (typeof spec.riskBudget !== 'string' || spec.riskBudget.length === 0) return null;
  const horizon = spec.horizon;
  if (!isRecord(horizon)) return null;
  if (typeof horizon.startsAt !== 'number' || typeof horizon.endsAt !== 'number') return null;
  return deepFreeze({
    markets: Object.freeze([...spec.markets]) as readonly string[],
    venues: Object.freeze([...spec.venues]) as readonly string[],
    dataSources: Object.freeze([...spec.dataSources]) as readonly string[],
    executionMode: spec.executionMode,
    capitalBudget: spec.capitalBudget,
    riskBudget: spec.riskBudget,
    horizon: { startsAt: horizon.startsAt, endsAt: horizon.endsAt, label: horizonSpanLabel(horizon.startsAt, horizon.endsAt) },
  });
}

// ---------------------------------------------------------------------------
// The create-project goal-set capture (D-4, W-25B — every launched
// project's own goal, retained host-side at the create seam)
// ---------------------------------------------------------------------------

/**
 * ONE CAPTURED CREATE-PROJECT GOAL SET: the create input's goal +
 * constraint set, VERBATIM (what the launch flow already sends —
 * apps/web toCreateProjectInput rides POST /v1/projects with exactly
 * these records, and the demo seed's own create carries the seeded
 * records through the same route). The frozen service's project record
 * keeps only the lineage REFS (goalId/version, constraintSet id/version)
 * — the statements themselves surface nowhere else, so the backing
 * retains them here (the demo-side half of what the DURABLE seam
 * persists in Neon: runtime/durable.ts's putGoalSet — the same records,
 * the same law, this backing's per-instance in-memory medium).
 */
export interface DemoGoalSetRecording {
  /** The tenant the pipeline injected at create (L12 — never a request value). */
  readonly tenant: string;
  /** The project the goal set belongs to (the create input's own id). */
  readonly project: string;
  /**
   * The create-project input's goal statement — verbatim EXCEPT the horizon
   * label, which is the SPAN-DERIVED one (FW-38-A, G-1:
   * withDerivedGoalHorizonLabel — the free-text annotation is not trusted
   * off the wire, the same law FW-37-A applied to the launch world).
   */
  readonly goal: GoalStatement;
  /** The create-project input's constraint set, verbatim. */
  readonly constraintSet: ConstraintSetStatement;
}

/**
 * The demo control plane: the REAL fixture fake, wrapped so every
 * create-project request's goal + constraint set is RETAINED host-side
 * (the same wrapping law as demoExecutionGateway — the port is the
 * seam, the fake is never re-implemented). The capture rides the PORT
 * seam, never the boundary: the input it sees is the VALIDATED,
 * tenant-injected create-project request (the full T041 pipeline ran —
 * L12 tenant injection, the goal/constraint same-tenant law, the audit
 * + metering tail), so the demo seed's own create and every user launch
 * ride the exact same path (D-4's root cause: the records exist at
 * creation; the read just never served them). Only SUCCESSFUL creates
 * are retained (a refused create leaves no goal on record — the typed
 * not-found stays for it). Per-instance in-memory, exactly like every
 * demo port: a serverless cold start resets it (honest under the
 * SIMULATED badge — durability is the DURABLE backing's own surface,
 * D-5/W-25D, never this one).
 */
export function demoControlPlane(): ReturnType<typeof fakeControlPlane> & { readonly goalSets: ReadonlyMap<string, DemoGoalSetRecording> } {
  const goalSets = new Map<string, DemoGoalSetRecording>();
  const inner = fakeControlPlane();
  return {
    ...inner, // the fake's own surface verbatim (the project store included)
    get goalSets(): ReadonlyMap<string, DemoGoalSetRecording> {
      return goalSets;
    },
    createProject(input) {
      const result = inner.createProject(input);
      if (result.ok) {
        goalSets.set(`${input.tenantId as string}/${input.id as string}`, {
          tenant: input.tenantId as string,
          project: input.id as string,
          // FW-38-A (G-1): the retained goal is born with the SPAN-DERIVED
          // horizon label (withDerivedGoalHorizonLabel) — the create input's
          // free-text annotation is NOT trusted off the wire (the wizard's
          // draft stamps 'one day' and never updates it; the demo seed's own
          // create rides the same law).
          goal: withDerivedGoalHorizonLabel(input.goal as GoalStatement),
          constraintSet: input.constraintSet as ConstraintSetStatement,
        });
      }
      return result;
    },
  };
}

/**
 * The demo job-submission port: the REAL fixture fake, wrapped so every
 * job submission whose spec carries a CONSOLE LAUNCH WORLD (D-8, W-28 —
 * launchWorldOfSpec) retains the world host-side per (tenant, project) —
 * the DEMO backing's half of what the DURABLE seam persists into the
 * goal-set row (the same world record, the same structural extraction;
 * this backing's per-instance in-memory medium — a serverless cold start
 * resets it, exactly like the goal-set capture, honest under the SIMULATED
 * badge). The submitted responses themselves are the fixture's own
 * records, verbatim (W-3f behavior unchanged). Only RESEARCH-submission
 * console-launch specs exist in practice (the console's kickoff job); the
 * wrapper is kind-agnostic and validates structurally, so a foreign or
 * malformed spec captures nothing (R46 — never a crash). Since FW-31-B the
 * wrapper ALSO carries the DEMO-SEED PRIMING LATCH (demoSeedJobPrimingLatch)
 * BEFORE the world capture: the seed's own first submission per kind on
 * this port instance returns the DETERMINISTIC seeded record (stable id +
 * demo-epoch submittedAt — the re-seed never rotates the job list again);
 * everything else falls through to the fixture engine, byte-identical.
 */
export function demoJobSubmission(): ReturnType<typeof fakeJobSubmission> & { readonly worlds: ReadonlyMap<string, LaunchWorldRecord> } {
  const worlds = new Map<string, LaunchWorldRecord>();
  const inner = fakeJobSubmission();
  const prime = demoSeedJobPrimingLatch();
  return {
    ...inner, // the fake's own surface verbatim (the submissions log included)
    get worlds(): ReadonlyMap<string, LaunchWorldRecord> {
      return worlds;
    },
    submitJob(input) {
      // FW-31-B: the deterministic demo-seed identity (before the capture — the seed's spec is never a console-launch spec, so the two never collide).
      const seeded = prime.prime(input);
      if (seeded !== null) return { ok: true, value: seeded };
      const world = launchWorldOfSpec(input.spec);
      if (world !== null) {
        worlds.set(`${input.tenant as string}/${input.project as string}`, world);
      }
      return inner.submitJob(input);
    },
  };
}

/**
 * The demo backing's captured launch world of one project of one tenant
 * (D-8, W-28 — the demo arm's goal-route read): the console-launch spec's
 * world the job port retained at submission. L12 by construction on both
 * axes: the pipeline injects the tenant at submission (a foreign tenant's
 * world never exists in this composition's capture to begin with) and the
 * fold keys on the AUTHORIZED tenant + the requested project (a foreign
 * read finds nothing — the goal route then serves no `world` field, the
 * console's teaching empty state). `null` for the demo project (its seed
 * jobs carry `demo-seed` specs, never a console-launch one — the demo
 * scope's teaching empty state is CORRECT and preserved by design).
 */
export function demoWorldOf(ports: DemoPorts, tenant: string, project: string): LaunchWorldRecord | null {
  // FW-37-A (F-4): the served world carries the SPAN-DERIVED horizon label
  // (withDerivedHorizonLabel) — a capture persisted before this wave (or a
  // test-injected record) serves the same computed label as a fresh capture.
  const world = ports.jobSubmission.worlds.get(`${tenant}/${project}`) ?? null;
  return world === null ? null : withDerivedHorizonLabel(world);
}

/** The demo backing's ports (the REAL fixture fakes — the same objects the composition injects) + the seeded blotter. */
export interface DemoPorts {
  /** The demo control plane (the fixture fake, wrapped to retain every create-project goal set — W-25B's capture seam). */
  readonly controlPlane: ReturnType<typeof demoControlPlane>;
  readonly firmMemory: ReturnType<typeof fakeFirmMemory>;
  /** The outcome-learning port — the fixture fake WRAPPED with the per-project evidence fold (FW-MI-B, MI-D2). */
  readonly outcomeLearning: OutcomeLearningPort;
  readonly executionGateway: ReturnType<typeof demoExecutionGateway>;
  /** The demo job-submission port (the fixture fake, wrapped to retain every console-launch world — D-8, W-28's capture seam). */
  readonly jobSubmission: ReturnType<typeof demoJobSubmission>;
  /** The seeded execution blotter (R2 — read data, like the outcome records; served by the host-owned read route). */
  readonly submissions: readonly GatewaySubmissionRecord[];
  /**
   * THE PER-PROJECT EVIDENCE FOLD (FW-MI-B, MI-D2): the derived blotter
   * rows of one launched project of one tenant (the same derivation the
   * outcome-learning wrapper serves for the outcome/post-mortem reads).
   * L12: keyed on the AUTHORIZED tenant — a foreign fold finds nothing.
   */
  readonly projectEvidenceOf: (tenant: string, project: string) => readonly GatewaySubmissionRecord[];
}

/**
 * The submissions fold's STRUCTURAL SOURCE (W-26C, R4): the seeded blotter
 * plus a recording gateway — exactly the two fields of DemoPorts the fold
 * reads. Widened from `DemoPorts` so the DURABLE arm passes its own
 * seam-built pair (the seeded demo blotter + the durable composition's
 * recording gateway) through the SAME fold without fabricating a demo
 * port set — the demo composition still passes its own DemoPorts (a
 * structural superset).
 */
export interface DemoSubstanceSource {
  /** The seeded execution blotter rows (read data — demoSubmissionBlotter under both backings). */
  readonly submissions: readonly GatewaySubmissionRecord[];
  /** A recording execution gateway — the fold reads its `recorded` live rows. */
  readonly executionGateway: { readonly recorded: readonly DemoGatewayRecording[] };
  /**
   * THE PER-PROJECT EVIDENCE FOLD (FW-MI-B, MI-D2): the derived blotter
   * rows of one launched project of one tenant — OPTIONAL so pre-FW-MI-B
   * constructions (tests, the seam-built pairs) stay valid; the demo arm
   * (DemoPorts) and the durable arm's demoSubstance both provide it.
   */
  readonly projectEvidenceOf?: (tenant: string, project: string) => readonly GatewaySubmissionRecord[];
}

/**
 * The durable arm's demo-substance read surface (W-26C, R4 — D-3 + the
 * blotter preserved under durable): the SAME folds the demo arm serves,
 * wired by the composition over ITS OWN per-instance stores (the composed
 * service's API-owned job store for `jobsOf`, and the seeded demo blotter
 * + the durable composition's recording gateway for the submissions
 * fold). Carried on the durable handle; `null` under port overrides (the
 * injection seam owns its own world — the routes then fall through to
 * the boundary, the pre-W-8 law).
 */
export interface DurableDemoSubstance {
  /** The submissions fold's source: the seeded demo blotter + the durable composition's recording gateway. */
  readonly ports: DemoSubstanceSource;
  /** The jobs fold (demoJobsOf over the composed service — the same store the per-id GET /v1/jobs/:jobId reads). */
  readonly jobsOf: (tenant: string, project: string) => readonly JobRecord[];
  /**
   * THE WRAPPED OUTCOME-LEARNING PORT CHAIN the composed service drives
   * (FW-34-A): the seam's hydrated port + the per-project evidence fold +
   * the promoted-decisions registry — the SAME object POST
   * /v1/outcomes/query and POST /v1/post-mortems/query serve. The
   * hydration read's counts must match what the console's own reads will
   * serve, never the seam's raw rows (an undercount would lie "loading"
   * about records that are already readable; the whole wrapped chain is
   * the console's read surface).
   */
  readonly outcomeLearning: OutcomeLearningPort;
  /**
   * THE FIRM-MEMORY PORT the composed service drives (FW-34-A): POST
   * /v1/knowledge/query's own data source (the seam's projection-backed
   * port under durable).
   */
  readonly firmMemory: FirmMemoryPort;
}

/**
 * The demo project's full execution blotter at one instant: the SEEDED rows
 * (all scoped to the demo project) plus the DERIVED rows of the requested
 * project (FW-MI-B, MI-D2 — every LAUNCHED desk's own evidence stream,
 * derived from its captured envelope behind the compile gate) plus every
 * LIVE submission the demo gateway has routed for the requested project.
 * Order-stable (seeded first, then derived, then live in routing order).
 * The parameters are the structural source (W-26C: DemoSubstanceSource —
 * DemoPorts satisfies it; the durable arm passes its own seam-built pair
 * through the SAME fold) and the AUTHORIZED tenant (L12: the derived rows
 * key on it — a foreign tenant's fold finds nothing, never a leak).
 */
export function demoSubmissionsOf(ports: DemoSubstanceSource, tenant: string, project: string): readonly GatewaySubmissionRecord[] {
  // The seeded rows are the DEMO project's own (the record shape carries no
  // scope fields — the console's watch fold inherits the workspace scope,
  // and the host read route scopes by the project query parameter).
  const seeded = project === DEMO_PROJECT_ID ? ports.submissions : [];
  const derived = ports.projectEvidenceOf === undefined ? [] : ports.projectEvidenceOf(tenant, project);
  const live = ports.executionGateway.recorded.filter((entry) => entry.project === project).map((entry) => entry.record);
  return Object.freeze([...seeded, ...derived, ...live]);
}

/**
 * The demo backing's job records for one project of one tenant (D-3, the
 * W-25A jobs seam): the composed service's API-OWNED job store — the
 * SAME store the per-id GET /v1/jobs/:jobId reads (the seed's jobs plus
 * every live submission the boundary accepted) — folded to the
 * credential tenant's own rows for the requested project. L12 by
 * construction on both axes: the pipeline injects the tenant at
 * submission (a foreign tenant's rows never exist in this composition's
 * store to begin with) and the fold filters on the AUTHORIZED tenant +
 * the project query parameter (a foreign project's page is empty, never
 * a leak). Order-stable: the store's insertion order (the seed's jobs
 * first, then every live submission in acceptance order).
 */
export function demoJobsOf(service: ApiService, tenant: string, project: string): readonly JobRecord[] {
  return Object.freeze(service.jobs().filter((job) => job.tenant === tenant && job.project === project));
}

/**
 * The demo backing's goal set of one project of one tenant (D-4, the
 * W-25B goal route's data seam): the create-project records the capture
 * retained — the demo project's own seeded records included (its create
 * rides the same port). L12 by construction on both axes: the pipeline
 * injects the tenant at create (a foreign tenant's goal set never exists
 * in this composition's capture to begin with — the same-tenant law
 * refused it) and the fold keys on the AUTHORIZED tenant + the requested
 * project (a foreign tenant's read finds nothing — the typed not-found,
 * never a leak).
 */
export function demoGoalSetOf(ports: DemoPorts, tenant: string, project: string): DemoGoalSetRecording | null {
  return ports.controlPlane.goalSets.get(`${tenant}/${project}`) ?? null;
}

/**
 * Build the demo ports (the REAL fixture fakes, imported from the
 * frozen service's own fixtures — never edited). The knowledge, outcome
 * and submission ports are seeded READ data scoped to the deployment's
 * credential tenant (L12: a foreign tenant's credential is served
 * nothing of it); the control plane starts empty — the demo project is
 * created through the real route (see seedDemoWorld), and the wrapper
 * retains every create's goal + constraint set for the host-owned goal
 * read (W-25B); the gateway serves ROUTED submissions for every valid
 * intent (the fixture's own L8 record shapes) and records them into the
 * live blotter; the job port records submissions (the async pattern's
 * entry state).
 */
export function seedDemoBacking(tenant: string): DemoPorts {
  const controlPlane = demoControlPlane();
  const jobSubmission = demoJobSubmission();
  const evidencePorts: DemoEvidencePorts = { controlPlane, jobSubmission };
  return {
    controlPlane,
    firmMemory: fakeFirmMemory([...fixtureKnowledge(tenant, DEMO_PROJECT_ID)]),
    // FW-MI-B (MI-D2): the outcome-learning fake WRAPPED — the frozen
    // outcome/post-mortem reads serve the demo project's seeded records
    // AND every launched desk's own derived stream (same derivation as
    // the blotter fold below; idempotent by content-addressed id).
    outcomeLearning: outcomeLearningWithProjectEvidence(
      fakeOutcomeLearning([demoOutcomeRecord(tenant, DEMO_PROJECT_ID)], [demoPostMortemRecord(tenant, DEMO_PROJECT_ID)]),
      (evidenceTenant, evidenceProject) => demoProjectEvidenceOf(evidencePorts, evidenceTenant, evidenceProject),
    ),
    executionGateway: demoExecutionGateway(),
    jobSubmission,
    submissions: demoSubmissionBlotter(),
    projectEvidenceOf: (evidenceTenant, evidenceProject) => demoProjectEvidenceOf(evidencePorts, evidenceTenant, evidenceProject)?.submissions ?? [],
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
 * service is composed: one project (the demo goal/constraint shapes —
 * NUMERIC bounds end-to-end, R5 — for the credential tenant) + the two
 * SEEDED JOBS for that project (D-3, W-25A: one research + one learning
 * submission through the real job routes — the jobs seam's demo
 * substance) and, when the internal credential is configured, the
 * organization bind and the org-status snapshot report (the watch
 * surface's only writer). `at` is the host-injected boot instant.
 * Throws only on an impossible seed (the demo builders are canonical
 * valid shapes — a failure means the frozen contract drifted, which
 * must be loud).
 */
export function seedDemoWorld(service: ApiService, seed: DemoWorldSeed, at: number): DemoWorldSeedResult {
  const developer = { authorization: `Bearer ${seed.developerToken}` };
  // 1. The demo project (the full pipeline: L12 tenant injection, the
  //    goal/constraint same-tenant law, the audit + metering tail).
  const created = service.handle({
    method: 'POST',
    path: '/v1/projects',
    headers: developer,
    body: demoCreateProjectRequest(seed.tenant, DEMO_PROJECT_ID),
  });
  if (created.status !== 201) {
    throw new Error(`demo backing: the demo project seed was refused (${created.status}) — the frozen create contract may have drifted`);
  }
  // 1b. THE SEEDED JOBS (D-3, W-25A): one research + one learning job
  //     for the demo project, submitted through the REAL public routes
  //     (the full pipeline: L12 tenant injection, the idempotency law,
  //     the audit + metering tail). The API-owned job store (the same
  //     store the per-id GET reads) then carries the demo project's
  //     jobs on every fresh boot, and the host-owned list route
  //     (GET /v1/jobs?project=<id>, runtime/routes.ts) serves them —
  //     the console's boot read refills state.jobs after every
  //     reload/scope-switch (D-3: "JOB: not searchable in any scope").
  //     A refusal means the frozen job contract drifted — it must be
  //     loud, exactly like the project seed above.
  seedDemoJobs(service, seed.developerToken);
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
  const snapshot = demoOrgStatusSnapshot(seed.tenant, DEMO_PROJECT_ID, DEMO_ORGANIZATION_REF, demoOrgSnapshotInstantOf(DEMO_PROJECT_ID, at));
  if (snapshot === null) {
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

/**
 * The seeded jobs, submitted through the REAL public routes (D-3, W-25A —
 * the same submissions `seedDemoWorld` drives at world-seed time). Split out
 * as its own seam by W-26B: under the DURABLE backing the demo world's
 * PROJECT is seeded once (the registry guard skips a re-create), but the
 * API-owned job store is per-instance (the frozen service's closure — the
 * disclosed limitation), so every fresh instance re-seeds its two demo jobs
 * through this exact path. The fixed idempotency keys keep the re-seed
 * idempotent PER INSTANCE (the boundary's idempotency store is per-instance
 * too — a same-instance replay returns the original job record).
 * Throws only on an impossible submission (the frozen job contract drifted —
 * loud, exactly like the world seed).
 */
export function seedDemoJobs(service: ApiService, developerToken: string): void {
  const developer = { authorization: `Bearer ${developerToken}` };
  const seededJobs: readonly { readonly path: string; readonly kind: 'research' | 'learning'; readonly idempotencyKey: string; readonly spec: Record<string, unknown> }[] = [
    { path: '/v1/jobs/research', kind: 'research', idempotencyKey: 'idem:demo:seed:research', spec: demoSeedResearchJobSpec() },
    { path: '/v1/jobs/learning', kind: 'learning', idempotencyKey: 'idem:demo:seed:learning', spec: demoSeedLearningJobSpec() },
  ];
  for (const seedJob of seededJobs) {
    const submitted = service.handle({
      method: 'POST',
      path: seedJob.path,
      headers: { ...developer, 'idempotency-key': seedJob.idempotencyKey },
      body: { kind: seedJob.kind, projectId: DEMO_PROJECT_ID, spec: seedJob.spec },
    });
    if (submitted.status !== 202) {
      throw new Error(`demo backing: the seeded ${seedJob.kind} job was refused (${submitted.status}) — the frozen job-submission contract may have drifted`);
    }
  }
}

// ---------------------------------------------------------------------------
// The demo machinery (org compile + job animation — THROUGH the real planes)
// ---------------------------------------------------------------------------

/** The machinery's fixed inputs (the composition's own values). */
export interface DemoMachineryContext {
  /**
   * The ports the org-compile pass reads (ONLY the control plane's project
   * listing). Widened by W-26B from `DemoPorts` to the structural minimum so
   * the SAME machinery law runs under the DURABLE backing over the W-25D
   * seam's HYDRATED control plane (the projection's project listing drives
   * the compile pass unchanged) — the demo composition still passes its own
   * DemoPorts (a structural superset).
   */
  readonly ports: { readonly controlPlane: ControlPlanePort };
  /**
   * THE DELIVERABLE SOURCE (FW-36-A, Round E register E-1): the research
   * completion's composed release-candidate reads the project's captured
   * mandate + observed world + composition-time promotion through this —
   * the backing's own captured surfaces (the demo arm's W-25B/W-28 captures;
   * the durable arm's hydrated goal sets). Required, never optional: a
   * composition with nothing on record passes `emptyDeliverableSource` and
   * the composer degrades to its honest statements (THE HONESTY LAW).
   */
  readonly deliverables: DeliverableSource;
  /** The credential tenant (L12 — the compile pass serves ONLY this tenant's projects). */
  readonly tenant: string;
  /** The public-plane developer token (the organization bind route). */
  readonly developerToken: string;
  /** The private-plane internal token (the org-status report + the job transitions). */
  readonly internalToken: string;
}

/**
 * One org-status snapshot for a machinery report (the fixture builder + the
 * reporting instant — the exact construction the world seed and the compile
 * pass use, split out by W-26B so the durable boot world reports through the
 * SAME shape). `null` only if the fixture builder fails its structural guard
 * (unreachable — it is the canonical shape); callers skip or throw per their
 * own failure law, never a crash here.
 */
export function demoOrgStatusSnapshot(tenant: string, project: string, organizationRef: string, at: number): OrgStatusSnapshot | null {
  const snapshot: OrgStatusSnapshot = deepFreeze({ ...validOrgStatusSnapshot(tenant, project, organizationRef), at });
  return isOrgStatusSnapshot(snapshot) ? snapshot : null;
}

/**
 * The organization ref the machinery compiles a launched project onto —
 * deterministic per project (the same project always compiles onto the
 * same organization; a re-compile would re-bind the same ref).
 */
export function compiledOrganizationRefOf(projectId: string): string {
  return `org:compiled-${projectId}`;
}

/**
 * THE ORG-COMPILE PASS (R4, W-8): the W-3f compile ran only for the seeded
 * demo project, at boot — every USER-LAUNCHED project stayed "Not compiled
 * yet / No organization snapshots" forever (phase2-competitive-report R4,
 * 9/15 personas blocked). This pass compiles EVERY bindable-but-unbound
 * project of the credential tenant, THROUGH the same real routes the demo
 * seed uses: the organization bind (POST /v1/projects/:id/organization —
 * the public plane, the full pipeline) + the watch snapshot report (POST
 * /internal/organizations/status — the private plane, the watch store's
 * only writer). The snapshot's `at` is the compile tick's instant — the
 * compile happens ONCE (the bind flips organizationRef, so later ticks
 * skip the project) and the point-in-time story stays stable (the org
 * becomes knowable at the compile instant; a later tick never rewrites
 * it). A project the real route refuses to bind (not draft/paused, a port
 * failure) is SKIPPED — never a crash (R46: the machinery must never take
 * the request down).
 */
function compileOrganizations(service: ApiService, context: DemoMachineryContext, at: number): void {
  const listed = context.ports.controlPlane.projectsOf(context.tenant as TenantId);
  if (!listed.ok) return; // R46: a port failure skips the pass — never a crash
  for (const project of listed.value) {
    if (project.lifecycle.organizationRef !== null) continue; // already compiled (or bound by its owner)
    if (project.lifecycle.status !== 'draft' && project.lifecycle.status !== 'paused') continue; // the real route would refuse — skip without the request
    const organizationRef = compiledOrganizationRefOf(project.id);
    // NOTE: the machinery drives the service DIRECTLY (service.handle), and
    // the T041 route table expects DECODED public paths (its own tests drive
    // raw ids; the HTTP layer percent-decodes before the wrap) — the raw id
    // goes into the path, never the encoded form.
    const bound = service.handle({
      method: 'POST',
      path: `/v1/projects/${project.id}/organization`,
      headers: { authorization: `Bearer ${context.developerToken}` },
      body: { organizationRef, at },
    });
    if (bound.status !== 200) continue; // the real route refused — honest, never a crash
    const snapshot = demoOrgStatusSnapshot(context.tenant, project.id, organizationRef, demoOrgSnapshotInstantOf(project.id, at));
    if (snapshot === null) continue; // unreachable (the fixture builder is the canonical shape) — skip, never a crash
    service.handle({
      method: 'POST',
      path: '/internal/organizations/status',
      headers: { authorization: `Bearer ${context.internalToken}` },
      body: { snapshot },
    });
  }
}

/**
 * One demo machinery tick: (1) the org-compile pass above, then (2) advance
 * every non-terminal job toward completion THROUGH THE REAL PRIVATE PLANE
 * (POST /internal/jobs/transitions — the async pattern's only transition
 * writer; the transition legality machine in services/api rejects illegal
 * moves, so the tick is idempotent by construction). `at` is the
 * host-injected request instant. Research jobs complete with a
 * release-candidate result record (the console's release-candidate notice
 * + evidence surfaces); learning jobs complete with a plain training
 * summary. Since FW-36-A (Round E register E-1) the release candidate is
 * COMPOSED from the project's own records (runtime/deliverable.ts) — the
 * mandate's declared actuals + the observed world + the honest lineage +
 * the SIMULATED disclosure — never the fixed pre-FW-36-A stub sentence.
 */
export function demoMachineryTick(service: ApiService, context: DemoMachineryContext, at: number): void {
  compileOrganizations(service, context, at);
  for (const job of service.jobs()) {
    if (job.status === 'complete' || job.status === 'failed') continue;
    const age = at - job.submittedAt;
    let status: 'running' | 'complete' | null = null;
    if (age >= DEMO_JOB_COMPLETE_AFTER_MS) status = 'complete';
    else if (age >= DEMO_JOB_RUNNING_AFTER_MS) status = 'running';
    if (status === null) continue;
    // FW-38-A (Round G register G-6 — the switch-path composition miss, S2's
    // seq-555 record): a research job whose mandate read is DEGRADED (the
    // durable projection in flight or dirty — the goal EXISTS behind the
    // read) must NOT complete this tick. The pre-fix law flattened the
    // degraded read into an absent mandate, so a kickoff deliverable composed
    // "a capital budget of not declared ... across the horizon no goal on
    // record ... under no declared constraints" while the Goal surface
    // carried the full mandate — an immutable chain record of a composition
    // that never read the project's own goal. The job stays non-terminal
    // (honest: the completion transition simply has not fired) and the next
    // tick — the router's settled() law lands the projection first —
    // composes the REAL mandate. An ABSENT mandate (the read is ready and
    // nothing is on record) is the honest pre-fix case and composes exactly
    // as before (THE HONESTY LAW).
    if (status === 'complete' && job.kind === 'research' && context.deliverables.mandateDegradedOf !== undefined && context.deliverables.mandateDegradedOf(job.project)) {
      continue;
    }
    // FW-31-B: the DEMO project's seeded jobs complete at their OWN
    // deterministic instant (the fixed submission instant + the schedule),
    // so the completed record — completedAt included — is byte-identical on
    // every instance (the pre-fix tick stamped the request instant, so the
    // same seeded job carried a different completedAt per serverless
    // instance). Every LAUNCHED desk's job keeps the live tick instant — a
    // live desk's progress is genuinely observed now.
    const transitionAt = job.project === DEMO_PROJECT_ID
      ? (job.submittedAt + (status === 'complete' ? DEMO_JOB_COMPLETE_AFTER_MS : DEMO_JOB_RUNNING_AFTER_MS))
      : at;
    service.handle({
      method: 'POST',
      path: '/internal/jobs/transitions',
      headers: { authorization: `Bearer ${context.internalToken}` },
      body: status === 'complete'
        ? {
            jobId: job.jobId,
            status: 'complete',
            at: transitionAt,
            // FW-36-A (E-1): the research deliverable is COMPOSED from the
            // project's own captured records (every number verbatim-traceable;
            // two different mandates produce observably different text —
            // THE HONESTY LAW), additive on the stub's preserved shape
            // (kind/specId/version/project — the promotion route reads them).
            // Pure + never a throw: a missing record degrades to its honest
            // statement (R46); the transition's own legality machine stays
            // the arbiter of everything else.
            result: job.kind === 'research'
              ? composeResearchDeliverableResult({
                  project: job.project,
                  director: job.project === DEMO_PROJECT_ID ? 'spec-demo-director' : 'spec-launch-director',
                  mandate: context.deliverables.mandateOf(job.project),
                  observed: context.deliverables.observedOf(job.project),
                  promotion: context.deliverables.promotionOf(job.jobId),
                })
              : { kind: 'training-summary', epochs: 3, project: job.project },
          }
        : { jobId: job.jobId, status: 'running', at: transitionAt },
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

/** Guard pin: every seeded blotter row satisfies the boundary's own GatewaySubmissionRecord guard. */
export function demoBlotterIsValid(): boolean {
  return demoSubmissionBlotter().every((row) => isGatewaySubmissionRecord(row));
}
