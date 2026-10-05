/**
 * T048 — STATION 3: STRATEGY/RISK (T018).
 *
 * The REAL `compileStrategyRun` over the slice's own declared spec —
 * equal-weight allocation over the two-instrument crypto universe,
 * drift-band rebalancing, LIMIT intents anchored at the last trade
 * print (the adapter's BTC and ETH marks) — against the genesis
 * portfolio, the observation window the ADAPTER events define, and
 * the slice's constraint set.
 *
 * THE HONEST WIRING: the observation window IS the adapter station's
 * canonical trade events (the trading-strategy `MarketEventMirror` is
 * law-for-law the adapter's canonical event — the mirrors are the
 * D-003/D-004 discipline; the compiler's L4 boundary and mark
 * derivation run over the adapter's honest quartets).
 *
 * THE NEGATIVE PATH: the same window + spec under the REFUSING
 * constraint set (a blocking universe ceiling of one against the
 * spec's two instruments) — every candidate becomes a typed
 * IntentRefusal RECORD (constraint primacy), never a constrained-down
 * intent.
 */

import {
  applyPortfolioEvents,
  compileStrategyRun,
  initialPortfolioState,
  type ConstraintSetStatementMirror,
  type GoalStatementMirror,
  type IntentRefusal,
  type MarketEventMirror,
  type ObservationWindow,
  type AccountFill,
  type PortfolioState,
  type StrategyRun,
  type StrategySpec,
} from '../../../packages/trading-strategy/src/index';
import type { EmittedEvent } from '../../../adapters/binance/src/index';

import { BTC, ETH, PRINCIPAL, PROJECT, SEED, STRATEGY_DECISION_AT, T0, TENANT, VENUE, GENESIS_CASH, unwrap } from './scope';

/** The step-2 decision instant (the drift-correction window's asOf). */
export const STRATEGY_STEP2_AT = T0 + 340_000;

/**
 * The window's event merge: the trade prints the ADAPTER sessions emitted,
 * filtered to the ones AVAILABLE at the anchor instant (the L4 boundary the
 * compiler enforces), merged into the window's total order (event_time,
 * sequence) — a production host merges its vendor streams exactly this way
 * before the window closes.
 */
function sliceTrades(binanceEvents: readonly EmittedEvent[], asOf: number): readonly MarketEventMirror[] {
  return binanceEvents
    .filter((event): event is EmittedEvent & { readonly event_type: 'trade' } => event.event_type === 'trade')
    .filter((event) => event.available_time <= asOf)
    .map((event) => event as unknown as MarketEventMirror)
    .sort((a, b) => (a.event_time !== b.event_time ? a.event_time - b.event_time : a.sequence - b.sequence));
}

// ---------------------------------------------------------------------------
// The slice's declarations
// ---------------------------------------------------------------------------

/** The strategy spec id. */
export const SPEC_ID = PRINCIPAL;

/** The goal id. */
export const GOAL_ID = 'goal-e2e-slice';

/** The satisfied-path constraint-set id. */
export const CONSTRAINT_SET_ID = 'cs-e2e-slice';

/** The window id (the lineage anchor of every emitted intent). */
export const WINDOW_ID = 'win-e2e-t0320';

/**
 * The slice's strategy spec: equal weight over BTC-USDT + ETH-USDT on
 * BINANCE, drift-band 5% (strictly-exceeds), limit orders anchored at
 * the last trade print, no seeded generators (a deterministic function
 * of the declared inputs), exact 8-decimal arithmetic.
 */
export function sliceSpec(): StrategySpec {
  return {
    specId: SPEC_ID as never,
    version: 1,
    tenant: TENANT as never,
    project: PROJECT as never,
    goal: GOAL_ID as never,
    name: 'the e2e slice equal-weight drift-band strategist',
    universe: [
      { instrumentId: BTC, venueId: VENUE, lotSize: '0.001', tickSize: '0.01' },
      { instrumentId: ETH, venueId: VENUE, lotSize: '0.01', tickSize: '0.01' },
    ] as never,
    allocation: { kind: 'equal_weight' },
    rebalancing: { trigger: 'drift_band', band: '0.05', cadenceMs: 86_400_000, description: 'rebalance when |current - target| strictly exceeds 5%' },
    priceDiscipline: { kind: 'limit', anchor: 'last_trade' },
    riskPolicyRefs: ['risk-policy:e2e-slice@1' as never],
    generators: [],
    decimalPrecision: 8,
    organization: {
      organizationId: 'org-e2e-slice' as never,
      assignmentRefs: ['assignment-e2e-trading-director' as never],
    },
    createdAt: (T0 - 3_600_000) as never,
  } as unknown as StrategySpec;
}

/** The slice's goal statement (the strategy serves THIS). */
export function sliceGoal(): GoalStatementMirror {
  return {
    id: GOAL_ID as never,
    version: 1,
    tenantId: TENANT as never,
    objective: 'Hold the two-instrument crypto reserve at equal weight, rebalanced within the declared drift band, without breaching the risk constraints.',
    horizon: { startsAt: (T0 - 3_600_000) as never, endsAt: (T0 + 86_400_000) as never, label: 'the e2e slice horizon' },
    successCriteria: {
      criteria: [
        { id: 'drawdown', metric: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.25 }, description: 'bounded drawdown' },
        { id: 'concentration', metric: 'risk.concentration.maxWeight', predicate: { kind: 'limit.max', bound: 0.75 }, description: 'no single position over three quarters of the book' },
      ],
      requiredSatisfaction: 1,
    },
    evaluation: {
      blindRef: 'blind:e2e-slice@1',
      walkForwardRef: 'walk-forward:e2e-slice@1',
      regimeRef: 'regime:e2e-slice@1',
      adversarialRequired: true,
    },
    createdAt: (T0 - 3_600_000) as never,
  } as unknown as GoalStatementMirror;
}

/** The SATISFIED-path constraint set: the ceiling admits the spec's universe. */
export function sliceConstraintSet(): ConstraintSetStatementMirror {
  return {
    id: CONSTRAINT_SET_ID as never,
    version: 1,
    tenantId: TENANT as never,
    name: 'the e2e slice satisfied path',
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
    createdAt: (T0 - 3_600_000) as never,
  } as unknown as ConstraintSetStatementMirror;
}

/**
 * The REFUSING-path constraint set: a blocking universe ceiling of ONE
 * against the spec's TWO instruments — every candidate is refused as a
 * typed IntentRefusal RECORD (the strategy lane's negative path).
 */
export function sliceRefusingConstraintSet(): ConstraintSetStatementMirror {
  return {
    id: CONSTRAINT_SET_ID as never,
    version: 2,
    tenantId: TENANT as never,
    name: 'the e2e slice refusing path',
    constraints: [
      {
        id: 'universe-ceiling',
        domain: 'state',
        subject: 'state.universe',
        predicate: { kind: 'limit.max', bound: 1 },
        severity: 'blocking',
        description: 'at most one universe instrument — the slice spec declares two, so every candidate is refused',
      },
    ],
    createdAt: (T0 - 3_600_000) as never,
  } as unknown as ConstraintSetStatementMirror;
}

// ---------------------------------------------------------------------------
// The window + the genesis state
// ---------------------------------------------------------------------------

/**
 * The observation window: the ADAPTER station's trade events, filtered to
 * the prints AVAILABLE at the decision instant (the L4 boundary the compiler
 * enforces — the day's later rally print is the STEP-2 window's observation,
 * never step 1's).
 */
export function sliceWindow(binanceEvents: readonly EmittedEvent[]): ObservationWindow {
  return {
    window_id: WINDOW_ID,
    events: sliceTrades(binanceEvents, STRATEGY_DECISION_AT),
    asOf: STRATEGY_DECISION_AT as never,
    starts_at: T0 as never,
    ends_at: (STRATEGY_DECISION_AT + 1) as never,
  } as never;
}

/**
 * The genesis portfolio: the declared cash, no positions (the strategy's
 * lineage block carries the whole scope). The constraint-set version binds
 * the lineage (L9): the satisfied path runs against version 1, the REFUSING
 * path against the revised version 2.
 */
export function sliceGenesisPortfolio(constraintSetVersion: 1 | 2 = 1): PortfolioState {
  return unwrap(
    initialPortfolioState(
      {
        strategy: { specId: SPEC_ID, version: 1 },
        goal: { goalId: GOAL_ID, version: 1 },
        constraintSet: { id: CONSTRAINT_SET_ID, version: constraintSetVersion },
        windowId: WINDOW_ID,
        seed: SEED,
        tenant: TENANT,
        project: PROJECT,
      } as never,
      GENESIS_CASH,
      STRATEGY_DECISION_AT as never,
    ),
    'the genesis portfolio must initialize',
  );
}

// ---------------------------------------------------------------------------
// The compilation (the satisfied path + the refusing path)
// ---------------------------------------------------------------------------

/** Compile the satisfied-path run (intents out; the constraint gate runs BEFORE emission). */
export function compileSliceRun(binanceEvents: readonly EmittedEvent[]): StrategyRun {
  return unwrap(
    compileStrategyRun({
      spec: sliceSpec(),
      state: sliceGenesisPortfolio(),
      window: sliceWindow(binanceEvents),
      constraintSet: sliceConstraintSet(),
      goal: sliceGoal(),
      seed: SEED as never,
    }),
    'the strategy run must compile',
  );
}

/**
 * The step-2 window: the SAME adapter events with the later information
 * anchor — every print available at the step-2 instant (the rallied BTC
 * mark included — the drift-band trigger's observation).
 */
export function sliceWindow2(binanceEvents: readonly EmittedEvent[]): ObservationWindow {
  return {
    window_id: 'win-e2e-t0340',
    events: sliceTrades(binanceEvents, STRATEGY_STEP2_AT),
    asOf: STRATEGY_STEP2_AT as never,
    starts_at: T0 as never,
    ends_at: (STRATEGY_STEP2_AT + 1) as never,
  } as never;
}

/**
 * The step-1 DECLARED fills (the T018 discipline: declared fills are INPUTS
 * — the harness assumption that the venue filled the emitted requests;
 * execution simulation is T019/T027's lane, and the shadow lane MEASURES the
 * assumption below). Exact decimals: taker 2 bps of each notional.
 */
export function sliceStep1Fills(): readonly AccountFill[] {
  return [
    { fill_id: 'e2e-fill-btc-1', instrument: BTC as never, venue: VENUE as never, side: 'buy', price: '50100', quantity: '0.998', fee: '9.99996', event_time: (STRATEGY_DECISION_AT + 500) as never } as never,
    { fill_id: 'e2e-fill-eth-1', instrument: ETH as never, venue: VENUE as never, side: 'buy', price: '3000', quantity: '16.66', fee: '9.996', event_time: (STRATEGY_DECISION_AT + 500) as never } as never,
  ];
}

/** The step-2 state: the genesis + the step-1 declared fills (the pure transition). */
export function sliceStep2State(binanceEvents: readonly EmittedEvent[]): PortfolioState {
  return unwrap(
    applyPortfolioEvents(
      sliceGenesisPortfolio(),
      { fills: sliceStep1Fills(), corporateActions: [] } as never,
      sliceWindow(binanceEvents),
      8,
      STRATEGY_DECISION_AT as never,
    ),
    'the step-1 transition must apply',
  ).state;
}

/**
 * Compile the step-2 run (the drift correction): the held BTC position is
 * outside its band under the rallied mark — the emitted intents are the
 * slice's second decision.
 */
export function compileSliceStep2(binanceEvents: readonly EmittedEvent[]): StrategyRun {
  return unwrap(
    compileStrategyRun({
      spec: sliceSpec(),
      state: sliceStep2State(binanceEvents),
      window: sliceWindow2(binanceEvents),
      constraintSet: sliceConstraintSet(),
      goal: sliceGoal(),
      seed: SEED as never,
    }),
    'the step-2 strategy run must compile',
  );
}

/** Compile the REFUSING-path run (every candidate a typed refusal record — the negative path). */
export function compileRefusingSliceRun(binanceEvents: readonly EmittedEvent[]): StrategyRun {
  return unwrap(
    compileStrategyRun({
      spec: sliceSpec(),
      state: sliceGenesisPortfolio(2),
      window: sliceWindow(binanceEvents),
      constraintSet: sliceRefusingConstraintSet(),
      goal: sliceGoal(),
      seed: SEED as never,
    }),
    'the refusing strategy run must compile',
  );
}

/** The refusing run's refusal records, by cause (the tests' substrate). */
export function refusalCauses(run: StrategyRun): readonly string[] {
  return run.refusals.map((refusal: IntentRefusal) => refusal.cause);
}
