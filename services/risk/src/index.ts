/**
 * @tradrl/risk-engine — the reference risk engine (Work Order T020).
 *
 * Public API:
 *   - The run session — `createRiskRun` (the genesis policy + the
 *     honored kill-switch log), `processRiskStep` /
 *     `processRiskSteps` (the measurement pipeline: derive the market
 *     state from declared events, measure the exposure threading the
 *     high-water mark, evaluate every declared limit under the trail's
 *     current head honoring the switch, emit the L7 measures, append
 *     the audit record), `supersedeRunPolicy` (the L11 path —
 *     superseded versions retained).
 *   - The resumable run state — `serializeRiskRunState` /
 *     `resumeRiskRunState` (canonical bytes; chain-verified resume —
 *     serialize -> parse -> resume is proven by the tests), plus the
 *     coherence and outcome-chain verifiers the resume gate rests on.
 *   - The scenario — the reference compile helpers, the golden
 *     three-step run (within -> drawdown breach -> superseded within)
 *     and its driver.
 *   - The fixtures — the reference constraint sets (v1 + the v2
 *     supersession source), the golden portfolio/market/fill records,
 *     the hand-derived kill-switch logs (standing + thrown) and the
 *     per-kind breach scenarios (one per limit kind).
 *   - Golden — the byte-stable determinism digests and counts.
 *
 * Zero runtime dependencies. The service consumes its contract
 * package, @tradrl/risk, via a relative source import (the frozen
 * write surface permits no lockfile-touching workspace edge — the
 * services/strategy + services/execution-sim precedent; the Lead may
 * convert to `workspace:*` at the next serialized lockfile change). No
 * ambient clock (`Date.now()` never appears) — every instant is an
 * explicit parameter. No network, no venues, no credentials: real
 * venue binding is T040.
 *
 * The engine INFORMS, it never decides (L7): the limit states, measures
 * and audit records this engine emits are data for T019's execution
 * gate and T012's evaluation — acceptance verdicts are inexpressible
 * here.
 */

// The engine
export type { RiskStep, RiskStepOutcome, RiskRunSession, CreateRiskRunInput, SupersedeRunPolicyInput } from './engine';
export {
  RISK_RUN_STATE_SCHEMA,
  isRiskRunSession,
  createRiskRun,
  processRiskStep,
  processRiskSteps,
  supersedeRunPolicy,
  verifyRunCoherence,
  verifyRunOutcomeChain,
  serializeRiskRunState,
  resumeRiskRunState,
  riskRunDigest,
  runPolicy,
} from './engine';

// The scenario
export {
  REFERENCE_RATIO_PRECISION,
  REFERENCE_QUOTE_PRECISION,
  REFERENCE_SUPERSESSION_REASON,
  compileReferencePolicyV1,
  compileReferencePolicyV2,
  createReferenceRun,
  referenceScenarioSteps,
  driveReferenceScenario,
} from './scenario';

// The fixtures
export type { BreachFixture } from './fixtures';
export {
  T0,
  TENANT,
  PROJECT,
  SEED,
  GOAL,
  REFERENCE_CONSTRAINT_SET,
  VENUE,
  BTC,
  ETH,
  unwrap,
  referenceConstraintSetV1,
  referenceConstraintSetV2,
  portfolioOf,
  goldenPortfolio,
  postStepOnePortfolio,
  tradeEvent,
  btcEthMarket,
  btcOnlyMarket,
  fillOf,
  goldenFill,
  buildSwitchLog,
  standingSwitchLog,
  thrownSwitchLog,
  singleStepBreachFixtures,
  GOLDEN_DRAWDOWN_BREACH,
} from './fixtures';

// The golden determinism constants
export {
  GOLDEN_RUN_DIGEST,
  GOLDEN_STEP_COUNT,
  GOLDEN_EXPOSURE_COUNT,
  GOLDEN_EVALUATION_COUNT,
  GOLDEN_MEASURE_COUNT,
  GOLDEN_AUDIT_RECORD_COUNT,
  GOLDEN_BREACHING_TOTAL,
  GOLDEN_DRAWDOWN_SERIES,
  GOLDEN_POLICY_VERSIONS,
  GOLDEN_BLOCKED_SWITCH_STATES,
} from './golden';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/risk-engine',
  owner: 'T020',
  status: 'implemented',
  concepts: [
    'processRiskStep',
    'supersedeRunPolicy',
    'serializeRiskRunState',
    'resumeRiskRunState',
    'riskRunDigest',
    'GOLDEN_RUN_DIGEST',
  ],
} as const;
