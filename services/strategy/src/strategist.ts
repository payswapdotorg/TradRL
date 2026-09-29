/**
 * @tradrl/strategy (service) — the reference deterministic strategist.
 *
 * The REFERENCE implementation of @tradrl/trading-strategy's contract
 * (the organization-compiler precedent: the service consumes its
 * contract package via a relative source import — the frozen workspace
 * lockfile admits no new package dependency edges on this branch):
 *
 *   - `REFERENCE_STRATEGY_SPEC` — the declared policy: EQUAL-WEIGHT
 *     allocation over a scripted three-instrument crypto universe,
 *     DRIFT-BAND rebalancing (band 0.05, strictly-exceeds trigger),
 *     LIMIT intents anchored at the last trade print (tick-aligned),
 *     opaque risk-policy refs, zero seeded generators (the policy is a
 *     deterministic function of its declared inputs — the spec says so
 *     by declaring none), and an opaque organization binding.
 *   - `REFERENCE_GOAL` / `REFERENCE_CONSTRAINT_SET` — the fixture pair:
 *     the satisfied path (constraints the scenario abides) and
 *     `REFERENCE_REFUSING_CONSTRAINT_SET` (the refusing path: a blocking
 *     constraint the scenario violates, so the gate converts every
 *     candidate into a refusal RECORD).
 *   - `driveStrategyScenario` — the deterministic scenario driver: per
 *     step, compile the run (intents/refusals — the constraint gate runs
 *     BEFORE emission), apply the step's DECLARED account fills and
 *     corporate actions through the contract's pure transition, append
 *     the transition to the chain-verified log, and finally emit the
 *     append-only backtest record (one candidate per step, with
 *     attainment evidence bindings derived by the gating rule mirror).
 *
 * SCOPE LAW (Work Order T018 non-scope): the fills a scenario declares
 * are INPUTS, exactly like observations — the reference service does
 * NOT simulate execution (T019 owns execution policy/simulation; the
 * fixtures' fills document the harness assumption that the venue filled
 * the requests, and nothing more). No network, no market-data I/O, no
 * ambient clock (`Date.now()` never appears), no ambient randomness.
 *
 * Spec anchors: spec/ARCHITECTURE.md (core flow "Strategy/Portfolio/
 * Risk -> Execution"; Evaluation: "Preserve search history"),
 * spec/ARCHITECTURE-LOCK.md L4, L7, L8, L9, L11, L12, L15.
 */

import {
  applyPortfolioEvents,
  appendBacktestCandidate,
  appendTransition,
  compileStrategyRun,
  initialPortfolioState,
  isIdentifierPath,
  startBacktestRecord,
  startTransitionLog,
  validateStrategySpec,
  type AccountFill,
  type BacktestCandidate,
  type BacktestRecord,
  type ConstraintSetStatementMirror,
  type CorporateAction,
  type GoalStatementMirror,
  type ObservationWindow,
  type PortfolioState,
  type PortfolioTransitionLog,
  type StrategyLineage,
  type StrategyResult,
  type StrategyRun,
  type StrategySpec,
  fail,
  ok,
} from '../../../packages/trading-strategy/src/index';

// ---------------------------------------------------------------------------
// The reference declarations (the spec, the goal, the constraint pair)
// ---------------------------------------------------------------------------

/** The reference universe: three crypto instruments on one scripted venue. */
export const REFERENCE_UNIVERSE = [
  { instrumentId: 'BTC-USD', venueId: 'REFSIM', lotSize: '0.001', tickSize: '0.01' },
  { instrumentId: 'ETH-USD', venueId: 'REFSIM', lotSize: '0.01', tickSize: '0.01' },
  { instrumentId: 'SOL-USD', venueId: 'REFSIM', lotSize: '0.1', tickSize: '0.001' },
] as const;

/** The reference tenant/project/goal identities (L12/L15). */
export const REFERENCE_TENANT = 'tenant-reference';
export const REFERENCE_PROJECT = 'project-reference';
export const REFERENCE_GOAL_ID = 'goal-reference-1';
export const REFERENCE_CONSTRAINT_SET_ID = 'cs-reference-1';
export const REFERENCE_SPEC_ID = 'spec-reference-eq-drift';

/**
 * The reference strategy spec — the DECLARED policy the driver
 * interprets (see the module header). Version 1; deterministic (zero
 * seeded-generator declarations).
 */
export const REFERENCE_STRATEGY_SPEC: StrategySpec = {
  specId: REFERENCE_SPEC_ID as never,
  version: 1,
  tenant: REFERENCE_TENANT as never,
  project: REFERENCE_PROJECT as never,
  goal: REFERENCE_GOAL_ID as never,
  name: 'reference equal-weight drift-band strategist',
  universe: REFERENCE_UNIVERSE.map((entry) => ({ ...entry })) as never,
  allocation: { kind: 'equal_weight' },
  rebalancing: { trigger: 'drift_band', band: '0.05', cadenceMs: 86_400_000, description: 'rebalance when |current - target| strictly exceeds 5%' },
  priceDiscipline: { kind: 'limit', anchor: 'last_trade' },
  riskPolicyRefs: ['risk-policy:reference-core@1' as never],
  generators: [], // the policy is deterministic — the spec declares it so
  decimalPrecision: 8,
  organization: {
    organizationId: 'org-reference-1' as never,
    assignmentRefs: ['assignment-reference-trading-director' as never],
  },
  createdAt: 1_699_000_000_000 as never,
} as unknown as StrategySpec;

/** The reference goal statement mirror (the strategy serves THIS). */
export const REFERENCE_GOAL: GoalStatementMirror = {
  id: REFERENCE_GOAL_ID as never,
  version: 1,
  tenantId: REFERENCE_TENANT as never,
  objective: 'Hold a diversified crypto reserve at equal weight, rebalanced within declared drift bands, without breaching the risk constraints.',
  horizon: { startsAt: 1_699_000_000_000 as never, endsAt: 1_700_864_000_000 as never, label: 'reference horizon' },
  successCriteria: {
    criteria: [
      { id: 'drawdown', metric: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.25 }, description: 'bounded drawdown' },
      { id: 'concentration', metric: 'risk.concentration.maxWeight', predicate: { kind: 'limit.max', bound: 0.5 }, description: 'no single position over half the book' },
    ],
    requiredSatisfaction: 1,
  },
  evaluation: {
    blindRef: 'blind:reference@1',
    walkForwardRef: 'walk-forward:reference@1',
    regimeRef: 'regime:reference@1',
    adversarialRequired: true,
  },
  createdAt: 1_699_000_000_000 as never,
} as unknown as GoalStatementMirror;

/**
 * The SATISFIED-path constraint fixture: constraints the reference
 * scenario abides (a position-count ceiling and an advisory trade-count
 * floor). Every candidate the driver computes passes the gate under it.
 */
export const REFERENCE_CONSTRAINT_SET: ConstraintSetStatementMirror = {
  id: REFERENCE_CONSTRAINT_SET_ID as never,
  version: 1,
  tenantId: REFERENCE_TENANT as never,
  name: 'reference satisfied path',
  constraints: [
    {
      id: 'max-positions',
      domain: 'state',
      subject: 'state.positions',
      predicate: { kind: 'limit.max', bound: 5 },
      severity: 'blocking',
      description: 'at most five concurrent positions',
    },
    {
      id: 'min-observations',
      domain: 'observation',
      subject: 'window.events',
      predicate: { kind: 'limit.min', bound: 1 },
      severity: 'advisory',
      description: 'every decision sees at least one observation',
    },
  ],
  createdAt: 1_699_000_000_000 as never,
} as unknown as ConstraintSetStatementMirror;

/**
 * The REFUSING-path constraint fixture: a blocking constraint the
 * reference scenario VIOLATES AT EVERY STEP — the spec's universe
 * carries THREE instruments while the ceiling allows TWO (the decision
 * context's `state.universe` fact is 3 > 2 under every step's gate
 * evaluation). The gate must convert every candidate into an
 * IntentRefusal naming the violated predicate, never a constrained-down
 * intent (constraint primacy).
 */
export const REFERENCE_REFUSING_CONSTRAINT_SET: ConstraintSetStatementMirror = {
  id: REFERENCE_CONSTRAINT_SET_ID as never,
  version: 2,
  tenantId: REFERENCE_TENANT as never,
  name: 'reference refusing path',
  constraints: [
    {
      id: 'universe-ceiling',
      domain: 'state',
      subject: 'state.universe',
      predicate: { kind: 'limit.max', bound: 2 },
      severity: 'blocking',
      description: 'at most two universe instruments — the reference universe has three, so every candidate is refused',
    },
  ],
  createdAt: 1_699_000_000_000 as never,
} as unknown as ConstraintSetStatementMirror;

// ---------------------------------------------------------------------------
// The gating-rule mirror (attainment bindings)
// ---------------------------------------------------------------------------

/**
 * The gating rule mirror — T007 control-domain's documented rule: a
 * constraint GATES a criterion when their identifier paths are
 * segment-wise prefixes of each other (a constraint on "risk" gates a
 * criterion on "risk.maxDrawdown"). Used to derive the backtest
 * candidates' attainment evidence bindings honestly (the trail's
 * bindings then feed the REAL evaluation lane — proven in the package's
 * interop trip wire).
 */
export function gatesConstraintMirror(subject: unknown, metric: unknown): boolean {
  if (typeof subject !== 'string' || typeof metric !== 'string') return false;
  if (!isIdentifierPath(subject) || !isIdentifierPath(metric)) return false;
  const subjectSegments = subject.split('.');
  const metricSegments = metric.split('.');
  const shorter = subjectSegments.length <= metricSegments.length ? subjectSegments : metricSegments;
  const longer = subjectSegments.length <= metricSegments.length ? metricSegments : subjectSegments;
  return shorter.every((segment, index) => segment === longer[index]);
}

/**
 * Derive the attainment evidence bindings of the reference goal under
 * the reference constraint set: one binding per success criterion, its
 * gating/blocking constraint ids by the gating rule, and the opaque
 * evidence ref this harness pins (the evaluation lane owns scoring —
 * L7; this lane emits the bindings only).
 */
export function referenceAttainmentBindings(
  goal: GoalStatementMirror,
  constraintSet: ConstraintSetStatementMirror,
): readonly BacktestCandidate['attainment'][number][] {
  return goal.successCriteria.criteria.map((criterion) => {
    const gating = constraintSet.constraints
      .filter((constraint) => gatesConstraintMirror(constraint.subject, criterion.metric))
      .map((constraint) => constraint.id);
    const blocking = constraintSet.constraints
      .filter((constraint) => gatesConstraintMirror(constraint.subject, criterion.metric) && constraint.severity === 'blocking')
      .map((constraint) => constraint.id);
    return {
      criterionId: criterion.id,
      requiredSatisfaction: goal.successCriteria.requiredSatisfaction,
      gatingConstraintIds: gating.length > 0 ? gating : constraintSet.constraints.map((constraint) => constraint.id),
      blockingConstraintIds: blocking,
      evidenceRef: `eval-evidence:reference/${criterion.id}@1`,
    };
  });
}

// ---------------------------------------------------------------------------
// The scenario driver
// ---------------------------------------------------------------------------

/** One scenario step: the observation window plus the DECLARED events of the step. */
export interface ScenarioStep {
  readonly window: ObservationWindow;
  /** Declared account fills of the step (inputs — the harness does not simulate execution; T019 owns that). */
  readonly fills: readonly AccountFill[];
  /** Declared corporate actions of the step. */
  readonly corporateActions: readonly CorporateAction[];
}

/** The scenario input: the declarations plus the steps, in order. */
export interface StrategyScenario {
  readonly spec: StrategySpec;
  readonly goal: GoalStatementMirror;
  readonly constraintSet: ConstraintSetStatementMirror;
  readonly seed: StrategyLineage['seed'];
  /** The opening cash of the genesis state. */
  readonly initialCash: string;
  readonly steps: readonly ScenarioStep[];
}

/** The scenario result: the runs, the transition log, the genesis/final states and the backtest record. */
export interface ScenarioResult {
  readonly runs: readonly StrategyRun[];
  readonly log: PortfolioTransitionLog;
  /** The genesis state (the run-state serialization's anchor). */
  readonly genesis: PortfolioState;
  readonly finalState: PortfolioState;
  readonly backtest: BacktestRecord;
}

function unwrap<T>(result: StrategyResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`reference strategist: unexpected failure: ${JSON.stringify(result.errors)}`);
}

/**
 * Drive the reference scenario (see the module header). Deterministic:
 * the same scenario always yields the deeply-equal result (proven by
 * the golden fixtures). The driver is PURE over its inputs — no clock,
 * no randomness; every instant arrives in the steps' windows.
 */
export function driveStrategyScenario(scenario: StrategyScenario): StrategyResult<ScenarioResult> {
  const specCheck = validateStrategySpec(scenario.spec);
  if (!specCheck.ok) {
    return { ok: false, errors: specCheck.errors.map((error) => ({ ...error, path: `scenario.spec.${error.path}` })) };
  }
  const spec = specCheck.value;
  if (spec.tenant !== scenario.goal.tenantId || spec.tenant !== scenario.constraintSet.tenantId) {
    return fail('tenant_missing', 'the scenario\'s spec, goal and constraint set must share one tenant (L12)');
  }
  if (scenario.steps.length === 0) {
    return fail('invalid_field', 'a scenario has at least one step');
  }

  // The lineage windowId pins the FIRST window (the genesis anchor);
  // the per-step windows ride the runs and transitions.
  const firstWindow = scenario.steps[0] as ScenarioStep;
  const lineage: StrategyLineage = {
    strategy: { specId: spec.specId, version: spec.version },
    goal: { goalId: scenario.goal.id, version: scenario.goal.version },
    constraintSet: { id: scenario.constraintSet.id, version: scenario.constraintSet.version },
    windowId: firstWindow.window.window_id,
    seed: scenario.seed,
    tenant: spec.tenant,
    project: spec.project,
  };

  const genesis = unwrap(initialPortfolioState(lineage, scenario.initialCash, firstWindow.window.asOf));
  let state = genesis;
  let log = startTransitionLog(state);
  const runs: StrategyRun[] = [];
  let backtest = startBacktestRecord(lineage.goal, spec.tenant, spec.project);
  const attainment = referenceAttainmentBindings(scenario.goal, scenario.constraintSet);

  for (const [index, step] of scenario.steps.entries()) {
    // 1. Compile the run: intents/refusals under the constraint gate.
    const run = compileStrategyRun({
      spec,
      state,
      window: step.window,
      constraintSet: scenario.constraintSet,
      goal: scenario.goal,
      seed: scenario.seed,
    });
    if (!run.ok) {
      return { ok: false, errors: run.errors.map((error) => ({ ...error, path: `scenario.steps[${index}].${error.path}` })) };
    }
    runs.push(run.value);

    // 2. Apply the step's DECLARED events through the pure transition.
    const transition = applyPortfolioEvents(
      state,
      { fills: step.fills, corporateActions: step.corporateActions },
      step.window,
      spec.decimalPrecision,
      step.window.asOf,
    );
    if (!transition.ok) {
      return { ok: false, errors: transition.errors.map((error) => ({ ...error, path: `scenario.steps[${index}].transition.${error.path}` })) };
    }
    const appended = appendTransition(log, transition.value.transition);
    if (!appended.ok) {
      return { ok: false, errors: appended.errors.map((error) => ({ ...error, path: `scenario.steps[${index}].log` })) };
    }
    log = appended.value;
    state = transition.value.state;

    // 3. Append the step's backtest candidate (L11: every candidate
    //    retained — refusals are records with structured reasons).
    const refused = run.value.refusals.length > 0;
    const candidate: BacktestCandidate = {
      candidateId: `btc:step-${index + 1}-${run.value.runId.slice(6)}` as never,
      sequence: index + 1,
      strategy: { specId: spec.specId, version: spec.version },
      window: {
        windowId: step.window.window_id,
        startsAt: step.window.starts_at,
        endsAt: step.window.ends_at,
      },
      attainment,
      disposition: refused ? 'rejected' : 'retained',
      reason: refused
        ? { kind: 'constraint_refused', violatedConstraintIds: [...new Set(run.value.refusals.flatMap((refusal) => refusal.violated.map((violated) => violated.constraintId)))] }
        : { kind: 'attained', attainedCriteria: attainment.length, totalCriteria: attainment.length },
      learning: null,
      goal: { goalId: scenario.goal.id, version: scenario.goal.version },
      tenant: spec.tenant,
      project: spec.project,
      recordedAt: step.window.asOf,
    };
    const appendedCandidate = appendBacktestCandidate(backtest, candidate);
    if (!appendedCandidate.ok) {
      return { ok: false, errors: appendedCandidate.errors.map((error) => ({ ...error, path: `scenario.steps[${index}].backtest` })) };
    }
    backtest = appendedCandidate.value;
  }

  return ok({ runs, log, genesis, finalState: state, backtest });
}
