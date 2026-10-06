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
  type ApiService,
  type ControlPlanePort,
  type ExecutionGatewayPort,
  type GatewaySubmissionRecord,
  type GoalStatement,
  type JobRecord,
  type ConstraintSetStatement,
  type OrgStatusSnapshot,
  type OutcomeRecordMirror,
  type PostMortemRecordMirror,
  type StrategyIntent,
  type TenantId,
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
  /** The create-project input's goal statement, verbatim. */
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
          goal: input.goal as GoalStatement,
          constraintSet: input.constraintSet as ConstraintSetStatement,
        });
      }
      return result;
    },
  };
}

/** The demo backing's ports (the REAL fixture fakes — the same objects the composition injects) + the seeded blotter. */
export interface DemoPorts {
  /** The demo control plane (the fixture fake, wrapped to retain every create-project goal set — W-25B's capture seam). */
  readonly controlPlane: ReturnType<typeof demoControlPlane>;
  readonly firmMemory: ReturnType<typeof fakeFirmMemory>;
  readonly outcomeLearning: ReturnType<typeof fakeOutcomeLearning>;
  readonly executionGateway: ReturnType<typeof demoExecutionGateway>;
  readonly jobSubmission: ReturnType<typeof fakeJobSubmission>;
  /** The seeded execution blotter (R2 — read data, like the outcome records; served by the host-owned read route). */
  readonly submissions: readonly GatewaySubmissionRecord[];
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
}

/**
 * The demo project's full execution blotter at one instant: the SEEDED rows
 * (all scoped to the demo project) plus every LIVE submission the demo
 * gateway has routed for the requested project. Order-stable (seeded first,
 * then live in routing order). The parameter is the structural source
 * (W-26C: DemoSubstanceSource — DemoPorts satisfies it; the durable arm
 * passes its own seam-built pair through the SAME fold).
 */
export function demoSubmissionsOf(ports: DemoSubstanceSource, project: string): readonly GatewaySubmissionRecord[] {
  // The seeded rows are the DEMO project's own (the record shape carries no
  // scope fields — the console's watch fold inherits the workspace scope,
  // and the host read route scopes by the project query parameter).
  const seeded = project === DEMO_PROJECT_ID ? ports.submissions : [];
  const live = ports.executionGateway.recorded.filter((entry) => entry.project === project).map((entry) => entry.record);
  return Object.freeze([...seeded, ...live]);
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
  return {
    controlPlane: demoControlPlane(),
    firmMemory: fakeFirmMemory([...fixtureKnowledge(tenant, DEMO_PROJECT_ID)]),
    outcomeLearning: fakeOutcomeLearning([demoOutcomeRecord(tenant, DEMO_PROJECT_ID)], [demoPostMortemRecord(tenant, DEMO_PROJECT_ID)]),
    executionGateway: demoExecutionGateway(),
    jobSubmission: fakeJobSubmission(),
    submissions: demoSubmissionBlotter(),
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
  const snapshot = demoOrgStatusSnapshot(seed.tenant, DEMO_PROJECT_ID, DEMO_ORGANIZATION_REF, at);
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
    const snapshot = demoOrgStatusSnapshot(context.tenant, project.id, organizationRef, at);
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
 * summary.
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
    service.handle({
      method: 'POST',
      path: '/internal/jobs/transitions',
      headers: { authorization: `Bearer ${context.internalToken}` },
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

/** Guard pin: every seeded blotter row satisfies the boundary's own GatewaySubmissionRecord guard. */
export function demoBlotterIsValid(): boolean {
  return demoSubmissionBlotter().every((row) => isGatewaySubmissionRecord(row));
}
