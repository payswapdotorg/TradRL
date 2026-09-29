/**
 * Behavioral tests for compileStrategyRun — the determinism law, the
 * constraint gate (primacy: refusal records, never constrained-down
 * intents), the drift-band boundary law, and the fail-closed input
 * gates (observation_gap, universe_violation, lineage_gap, L12).
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  compileStrategyRun,
  isIntentRefusal,
  isStrategyIntent,
  isStrategyRun,
  runsEqual,
  validateStrategyRun,
  type ConstraintSetStatementMirror,
  type GoalStatementMirror,
  type MarketEventMirror,
  type ObservationWindow,
  type PortfolioState,
  type StrategyLineage,
  type StrategyRun,
  type StrategySpec,
} from './index';

const T0 = 1_700_000_000_000;
const TENANT = 'tenant-alpha' as StrategySpec['tenant'];
const PROJECT = 'project-one' as StrategySpec['project'];
const GOAL_ID = 'goal-1' as GoalStatementMirror['id'];
const CS_ID = 'cs-1' as ConstraintSetStatementMirror['id'];
const SPEC_ID = 'spec-eq' as StrategySpec['specId'];
const SEED = 'seed-fixed-1' as StrategyLineage['seed'];
const WINDOW_ID = 'win-001';
const BTC = 'BTC-USD' as StrategySpec['universe'][number]['instrumentId'];
const ETH = 'ETH-USD' as StrategySpec['universe'][number]['instrumentId'];
const VENUE = 'SIM' as StrategySpec['universe'][number]['venueId'];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fixtureSpec(overrides?: Record<string, unknown>): StrategySpec {
  const base = {
    specId: SPEC_ID,
    version: 1,
    tenant: TENANT,
    project: PROJECT,
    goal: GOAL_ID,
    name: 'equal-weight drift-band reference',
    universe: [
      { instrumentId: BTC, venueId: VENUE, lotSize: '0.001', tickSize: '0.01' },
      { instrumentId: ETH, venueId: VENUE, lotSize: '0.01', tickSize: '0.01' },
    ],
    allocation: { kind: 'equal_weight' },
    rebalancing: { trigger: 'drift_band', band: '0.05', cadenceMs: 86_400_000 },
    priceDiscipline: { kind: 'limit', anchor: 'last_trade' },
    riskPolicyRefs: ['risk-policy:core@1' as StrategySpec['riskPolicyRefs'][number]],
    generators: [],
    decimalPrecision: 8,
    organization: {
      organizationId: 'org-1' as StrategySpec['organization'] extends infer O
        ? O extends { readonly organizationId: infer R } ? R : never
        : never,
      assignmentRefs: ['assignment-trading-director' as never],
    },
    createdAt: T0 - 100_000,
  } as unknown as Record<string, unknown>;
  return { ...base, ...overrides } as unknown as StrategySpec;
}

function fixtureGoal(tenant: string = TENANT): GoalStatementMirror {
  return ({
    id: GOAL_ID,
    version: 1,
    tenantId: tenant as GoalStatementMirror['tenantId'],
    objective: 'Grow the reserve while never breaching the risk limits.',
    horizon: { startsAt: T0 - 1_000_000, endsAt: T0 + 30 * 86_400_000 },
    successCriteria: {
      criteria: [
        { id: 'c1', metric: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 } },
        { id: 'c2', metric: 'risk.volatility', predicate: { kind: 'limit.max', bound: 0.3 } },
      ],
      requiredSatisfaction: 1,
    },
    evaluation: {
      blindRef: 'blind:v1',
      walkForwardRef: 'wf:v1',
      regimeRef: 'regime:v1',
      adversarialRequired: true,
    },
    createdAt: T0 - 200_000,
  }) as unknown as GoalStatementMirror;
}

function fixtureConstraintSet(
  constraints: ConstraintSetStatementMirror['constraints'] = [],
  tenant: string = TENANT,
): ConstraintSetStatementMirror {
  return ({
    id: CS_ID,
    version: 1,
    tenantId: tenant as ConstraintSetStatementMirror['tenantId'],
    name: 'test set',
    constraints,
    createdAt: T0 - 150_000,
  }) as unknown as ConstraintSetStatementMirror;
}

function tradeEvent(
  eventId: string,
  instrument: string,
  price: string,
  sequence: number,
  eventTime: number,
): MarketEventMirror {
  return {
    event_id: eventId,
    venue: VENUE as never,
    instrument: instrument as never,
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: eventTime as never,
    source_time: null,
    available_time: eventTime as never,
    ingestion_time: eventTime as never,
    sequence,
    provider: 'sim',
    provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
    payload: { price, size: '1', side: 'buy', trade_id: `${eventId}-t` },
  };
}

function fixtureWindow(events: readonly MarketEventMirror[], asOf = T0): ObservationWindow {
  const sorted = [...events].sort((a, b) => a.event_time - b.event_time || a.sequence - b.sequence);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    window_id: WINDOW_ID,
    events: sorted,
    asOf: asOf as never,
    starts_at: (first === undefined ? asOf - 1000 : first.event_time) as never,
    ends_at: (asOf + 1) as never,
  };
}

function fixtureState(
  weights: readonly { readonly instrumentId: string; readonly weight: string }[],
  cash = '10000',
  positions: readonly { readonly instrumentId: string; readonly quantity: string; readonly costBasis: string }[] = [],
): PortfolioState {
  const lineage: StrategyLineage = {
    strategy: { specId: SPEC_ID, version: 1 },
    goal: { goalId: GOAL_ID, version: 1 },
    constraintSet: { id: CS_ID, version: 1 },
    windowId: WINDOW_ID,
    seed: SEED,
    tenant: TENANT,
    project: PROJECT,
  };
  const positionsList = positions.map((position) => ({
    instrumentId: position.instrumentId as never,
    venueId: VENUE as never,
    quantity: position.quantity,
    costBasis: position.costBasis,
    openedAt: (T0 - 50_000) as never,
  }));
  return {
    stateId: 'ps:00000000',
    positions: positionsList,
    weights: weights.map((weight) => ({
      instrumentId: weight.instrumentId as never,
      weight: weight.weight,
      markSource: 'last_trade' as const,
    })),
    cash,
    realizedPnl: '0',
    unrealizedPnl: '0',
    asOf: T0 as never,
    lineage,
  } as unknown as PortfolioState;
}

function fullInput(weights: readonly { readonly instrumentId: string; readonly weight: string }[]) {
  return {
    spec: fixtureSpec(),
    state: fixtureState(weights),
    window: fixtureWindow([
      tradeEvent('e1', BTC, '50000', 1, T0 - 500),
      tradeEvent('e2', ETH, '3000', 2, T0 - 400),
    ]),
    constraintSet: fixtureConstraintSet(),
    goal: fixtureGoal(),
    seed: SEED,
  };
}

function unwrapRun(result: ReturnType<typeof compileStrategyRun>): StrategyRun {
  if (result.ok) return result.value;
  throw new Error(`compile failed: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// Determinism (acceptance 3)
// ---------------------------------------------------------------------------

describe('compileStrategyRun — determinism', () => {
  it('the same (spec, state, window, constraints, seed) yields a byte-identical run, twice', () => {
    const first = unwrapRun(compileStrategyRun(fullInput([{ instrumentId: BTC, weight: '0.7' }, { instrumentId: ETH, weight: '0.3' }])));
    const second = unwrapRun(compileStrategyRun(fullInput([{ instrumentId: BTC, weight: '0.7' }, { instrumentId: ETH, weight: '0.3' }])));
    expect(runsEqual(first, second)).toBe(true);
    expect(canonicalJson(first as never)).toBe(canonicalJson(second as never));
    // The golden shape: deep-equal intents AND refusals.
    expect(first.intents).toStrictEqual(second.intents);
    expect(first.refusals).toStrictEqual(second.refusals);
    expect(first.runId).toBe(second.runId);
    expect(first.inputDigest).toBe(second.inputDigest);
  });

  it('a different seed changes the lineage and therefore the run id', () => {
    const input = fullInput([{ instrumentId: BTC, weight: '0.7' }, { instrumentId: ETH, weight: '0.3' }]);
    const a = unwrapRun(compileStrategyRun(input));
    const b = unwrapRun(compileStrategyRun({ ...input, seed: 'seed-other' as never }));
    expect(a.runId).not.toBe(b.runId);
  });

  it('emitted intents satisfy the intent guard and the run passes validation', () => {
    const run = unwrapRun(compileStrategyRun(fullInput([{ instrumentId: BTC, weight: '0.7' }, { instrumentId: ETH, weight: '0.3' }])));
    for (const intent of run.intents) expect(isStrategyIntent(intent)).toBe(true);
    const validated = validateStrategyRun(run);
    expect(validated.ok).toBe(true);
    expect(isStrategyRun(run)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The constraint gate (acceptance 4)
// ---------------------------------------------------------------------------

describe('compileStrategyRun — constraint primacy', () => {
  // NOTE (the mirrored engine's law, documented in control-mirror.ts):
  // numeric limit predicates address NUMERIC facts; money facts are exact
  // decimal strings addressable by equals/oneOf — a numeric limit over a
  // string subject is an ERROR check that refuses fail-closed (tested
  // below). The violated/satisfied paths therefore use numeric facts
  // (counts) and string facts (under oneOf).

  it('an unsatisfied BLOCKING constraint refuses the intent with the violated predicate named (negative path)', () => {
    const constraintSet = fixtureConstraintSet([
      {
        id: 'max-positions',
        domain: 'state',
        subject: 'state.positions',
        predicate: { kind: 'limit.max', bound: 0 },
        severity: 'blocking',
      },
    ]);
    // BTC over weight 0.7 vs target 0.5 with band 0.05: a sell candidate —
    // but the state holds one position and the constraint allows zero.
    const run = unwrapRun(
      compileStrategyRun({
        spec: fixtureSpec(),
        state: fixtureState([{ instrumentId: BTC, weight: '0.7' }, { instrumentId: ETH, weight: '0.3' }], '0', [
          { instrumentId: BTC, quantity: '0.14', costBasis: '6000' },
        ]),
        window: fixtureWindow([
          tradeEvent('e1', BTC, '50000', 1, T0 - 500),
          tradeEvent('e2', ETH, '3000', 2, T0 - 400),
        ]),
        constraintSet,
        goal: fixtureGoal(),
        seed: SEED,
      }),
    );
    expect(run.intents).toHaveLength(0);
    expect(run.refusals.length).toBeGreaterThanOrEqual(1);
    const refusal = run.refusals[0] as unknown as import('./index').IntentRefusal;
    expect(isIntentRefusal(refusal)).toBe(true);
    expect(refusal.cause).toBe('constraint_refused');
    expect(refusal.violated[0]?.constraintId).toBe('max-positions');
    expect(refusal.violated[0]?.subject).toBe('state.positions');
    expect(refusal.violated[0]?.predicate).toEqual({ kind: 'limit.max', bound: 0 });
    expect(refusal.violated[0]?.observed).toBe(1);
    // The refusal carries the full lineage an intent would carry.
    expect(refusal.tenant).toBe(TENANT);
    expect(refusal.project).toBe(PROJECT);
    expect(refusal.goal.goalId).toBe(GOAL_ID);
    expect(refusal.strategy.specId).toBe(SPEC_ID);
    expect(refusal.windowRefs).toEqual([WINDOW_ID]);
    // The refused candidate is identified too.
    expect(refusal.candidate.instrumentId).toBe(BTC);
    expect(refusal.candidate.side).toBe('sell');
  });

  it('a SATISFIED blocking constraint emits the intent with the satisfied-predicate proof (positive path)', () => {
    const constraintSet = fixtureConstraintSet([
      {
        id: 'max-positions',
        domain: 'state',
        subject: 'state.positions',
        predicate: { kind: 'limit.max', bound: 5 },
        severity: 'blocking',
      },
    ]);
    const run = unwrapRun(
      compileStrategyRun({
        spec: fixtureSpec(),
        state: fixtureState([{ instrumentId: BTC, weight: '0.7' }, { instrumentId: ETH, weight: '0.3' }], '0', [
          { instrumentId: BTC, quantity: '0.14', costBasis: '6000' },
        ]),
        window: fixtureWindow([
          tradeEvent('e1', BTC, '50000', 1, T0 - 500),
          tradeEvent('e2', ETH, '3000', 2, T0 - 400),
        ]),
        constraintSet,
        goal: fixtureGoal(),
        seed: SEED,
      }),
    );
    expect(run.refusals).toHaveLength(0);
    expect(run.intents.length).toBeGreaterThanOrEqual(1);
    for (const intent of run.intents) {
      const proof = intent.constraintProof.satisfied.find((entry) => entry.constraintId === 'max-positions');
      expect(proof).toBeDefined();
      expect(proof?.observed).toBe(1);
      expect(proof?.domain).toBe('state');
    }
  });

  it('a string-fact constraint (oneOf over the action side) refuses a disallowed side', () => {
    const constraintSet = fixtureConstraintSet([
      {
        id: 'sells-only',
        domain: 'action',
        subject: 'action.side',
        predicate: { kind: 'oneOf', values: ['sell'] },
        severity: 'blocking',
      },
    ]);
    // Give the portfolio cash so a BUY candidate arises (ETH underweight).
    const run = unwrapRun(
      compileStrategyRun({
        spec: fixtureSpec(),
        state: fixtureState([{ instrumentId: BTC, weight: '0.5' }, { instrumentId: ETH, weight: '0' }], '10000', [
          { instrumentId: BTC, quantity: '0.1', costBasis: '5000' },
        ]),
        window: fixtureWindow([
          tradeEvent('e1', BTC, '50000', 1, T0 - 500),
          tradeEvent('e2', ETH, '3000', 2, T0 - 400),
        ]),
        constraintSet,
        goal: fixtureGoal(),
        seed: SEED,
      }),
    );
    const buyRefusal = run.refusals.find((refusal) => refusal.candidate.side === 'buy');
    expect(buyRefusal).toBeDefined();
    expect(buyRefusal?.violated[0]?.constraintId).toBe('sells-only');
    expect(buyRefusal?.violated[0]?.observed).toBe('buy');
    expect(run.intents.every((intent) => intent.order.side === 'sell')).toBe(true);
  });

  it('an errored blocking constraint (type conflict) refuses fail-closed', () => {
    const constraintSet = fixtureConstraintSet([
      {
        id: 'side-is-limit',
        domain: 'action',
        subject: 'action.notional', // a decimal string under a numeric limit
        predicate: { kind: 'limit.max', bound: 3 },
        severity: 'blocking',
      },
    ]);
    const run = unwrapRun(
      compileStrategyRun({
        spec: fixtureSpec(),
        state: fixtureState([{ instrumentId: BTC, weight: '0.7' }, { instrumentId: ETH, weight: '0.3' }], '0', [
          { instrumentId: BTC, quantity: '0.14', costBasis: '6000' },
        ]),
        window: fixtureWindow([
          tradeEvent('e1', BTC, '50000', 1, T0 - 500),
          tradeEvent('e2', ETH, '3000', 2, T0 - 400),
        ]),
        constraintSet,
        goal: fixtureGoal(),
        seed: SEED,
      }),
    );
    expect(run.intents).toHaveLength(0);
    expect(run.refusals[0]?.cause).toBe('constraint_error');
  });

  it('an ADVISORY violation does not refuse — it rides the intent as a structured record', () => {
    const constraintSet = fixtureConstraintSet([
      {
        id: 'adv-notify',
        domain: 'state',
        subject: 'state.positions',
        predicate: { kind: 'limit.min', bound: 10 },
        severity: 'advisory',
      },
      {
        id: 'max-positions',
        domain: 'state',
        subject: 'state.positions',
        predicate: { kind: 'limit.max', bound: 5 },
        severity: 'blocking',
      },
    ]);
    const run = unwrapRun(
      compileStrategyRun({
        spec: fixtureSpec(),
        state: fixtureState([{ instrumentId: BTC, weight: '0.7' }, { instrumentId: ETH, weight: '0.3' }], '0', [
          { instrumentId: BTC, quantity: '0.14', costBasis: '6000' },
        ]),
        window: fixtureWindow([
          tradeEvent('e1', BTC, '50000', 1, T0 - 500),
          tradeEvent('e2', ETH, '3000', 2, T0 - 400),
        ]),
        constraintSet,
        goal: fixtureGoal(),
        seed: SEED,
      }),
    );
    expect(run.intents.length).toBeGreaterThanOrEqual(1);
    expect(run.refusals).toHaveLength(0);
    for (const intent of run.intents) {
      expect(intent.constraintProof.advisoryViolations.some((check) => check.constraintId === 'adv-notify')).toBe(true);
    }
  });

  it('a not-applicable subject (missing from the phase map) neither refuses nor proves', () => {
    const constraintSet = fixtureConstraintSet([
      {
        id: 'outcome-never-present',
        domain: 'outcome',
        subject: 'outcome.attainment',
        predicate: { kind: 'flag', expected: true },
        severity: 'blocking',
      },
    ]);
    const run = unwrapRun(
      compileStrategyRun({
        spec: fixtureSpec(),
        state: fixtureState([{ instrumentId: BTC, weight: '0.7' }, { instrumentId: ETH, weight: '0.3' }], '0', [
          { instrumentId: BTC, quantity: '0.14', costBasis: '6000' },
        ]),
        window: fixtureWindow([
          tradeEvent('e1', BTC, '50000', 1, T0 - 500),
          tradeEvent('e2', ETH, '3000', 2, T0 - 400),
        ]),
        constraintSet,
        goal: fixtureGoal(),
        seed: SEED,
      }),
    );
    expect(run.intents.length).toBeGreaterThanOrEqual(1); // not_applicable does not refuse (L4 point-in-time)
    for (const intent of run.intents) {
      expect(intent.constraintProof.satisfied.some((entry) => entry.constraintId === 'outcome-never-present')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The drift-band boundary law (acceptance 9)
// ---------------------------------------------------------------------------

describe('compileStrategyRun — drift-band boundary', () => {
  // The boundary arithmetic (exact decimals, marks drive the drift):
  // ETH fixed at 1.5 units @ 3000 (value 4500); BTC 0.11 units with the
  // mark varied so the DECISION-TIME BTC weight lands exactly at / just
  // inside / just outside target 0.5 + band 0.05.
  //   BTC mark 50000 -> value 5500, total 10000 -> weight 0.55 EXACTLY = target + band
  //   BTC mark 49800 -> value 5478, total 9978 -> weight 0.54900882 (drift 0.04900882 < band)
  //   BTC mark 50200 -> value 5522, total 10022 -> weight 0.55098783 (drift 0.05098783 > band)
  const bandCases = [
    { label: 'exactly-at-band', btcMark: '50000', expectIntent: false },
    { label: 'epsilon-inside', btcMark: '49800', expectIntent: false },
    { label: 'epsilon-outside', btcMark: '50200', expectIntent: true },
  ];

  for (const testCase of bandCases) {
    it(`drift ${testCase.label}: BTC mark ${testCase.btcMark} -> ${testCase.expectIntent ? 'rebalance intent' : 'no intent'}`, () => {
      const run = unwrapRun(
        compileStrategyRun({
          spec: fixtureSpec(),
          state: fixtureState([{ instrumentId: BTC, weight: '0.5' }, { instrumentId: ETH, weight: '0.5' }], '0', [
            { instrumentId: BTC, quantity: '0.11', costBasis: '5500' },
            { instrumentId: ETH, quantity: '1.5', costBasis: '4500' },
          ]),
          window: fixtureWindow([
            tradeEvent('e1', BTC, testCase.btcMark, 1, T0 - 500),
            tradeEvent('e2', ETH, '3000', 2, T0 - 400),
          ]),
          constraintSet: fixtureConstraintSet(),
          goal: fixtureGoal(),
          seed: SEED,
        }),
      );
      const btcMovements = [...run.intents, ...run.refusals].filter(
        (record) =>
          ('order' in record && record.order.instrumentId === BTC) ||
          ('candidate' in record && record.candidate.instrumentId === BTC),
      );
      expect(btcMovements.length > 0).toBe(testCase.expectIntent);
      if (testCase.expectIntent) {
        // The rationale names the drift-band decision.
        const intent = run.intents.find((entry) => entry.order.instrumentId === BTC);
        expect(intent).toBeDefined();
        expect(intent?.rationale.kind).toBe('rebalance_drift');
        expect(intent?.rationale.targetWeight).toBe('0.5');
        expect(intent?.rationale.currentWeight).toBe('0.55098783');
        expect(intent?.rationale.drift).toBe('0.05098783');
      }
    });
  }

  it('a zero-weight instrument with no position buys under initial_allocation', () => {
    const run = unwrapRun(
      compileStrategyRun({
        spec: fixtureSpec(),
        state: fixtureState([{ instrumentId: BTC, weight: '0.5' }, { instrumentId: ETH, weight: '0' }], '10000', [
          { instrumentId: BTC, quantity: '0.1', costBasis: '5000' },
        ]),
        window: fixtureWindow([
          tradeEvent('e1', BTC, '50000', 1, T0 - 500),
          tradeEvent('e2', ETH, '3000', 2, T0 - 400),
        ]),
        constraintSet: fixtureConstraintSet(),
        goal: fixtureGoal(),
        seed: SEED,
      }),
    );
    const ethBuy = run.intents.find((intent) => intent.order.instrumentId === ETH);
    expect(ethBuy).toBeDefined();
    expect(ethBuy?.order.side).toBe('buy');
    expect(ethBuy?.rationale.kind).toBe('initial_allocation');
  });
});

// ---------------------------------------------------------------------------
// Fail-closed input gates
// ---------------------------------------------------------------------------

describe('compileStrategyRun — fail-closed inputs', () => {
  it('a window missing a universe instrument fails with observation_gap (never best-effort pricing)', () => {
    const result = compileStrategyRun({
      spec: fixtureSpec(),
      state: fixtureState([{ instrumentId: BTC, weight: '0.5' }, { instrumentId: ETH, weight: '0.5' }]),
      window: fixtureWindow([tradeEvent('e1', BTC, '50000', 1, T0 - 500)]), // no ETH observation
      constraintSet: fixtureConstraintSet(),
      goal: fixtureGoal(),
      seed: SEED,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('observation_gap');
  });

  it('a position outside the spec universe fails with universe_violation', () => {
    const state = fixtureState([{ instrumentId: BTC, weight: '1' }], '0', [
      { instrumentId: 'SOL-USD', quantity: '10', costBasis: '500' },
    ]);
    const result = compileStrategyRun({
      spec: fixtureSpec(),
      state,
      window: fixtureWindow([
        tradeEvent('e1', BTC, '50000', 1, T0 - 500),
        tradeEvent('e2', ETH, '3000', 2, T0 - 400),
      ]),
      constraintSet: fixtureConstraintSet(),
      goal: fixtureGoal(),
      seed: SEED,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('universe_violation');
  });

  it('cross-tenant goal/spec fails with tenant_missing (L12)', () => {
    const result = compileStrategyRun({
      spec: fixtureSpec(),
      state: fixtureState([{ instrumentId: BTC, weight: '0.5' }, { instrumentId: ETH, weight: '0.5' }]),
      window: fixtureWindow([
        tradeEvent('e1', BTC, '50000', 1, T0 - 500),
        tradeEvent('e2', ETH, '3000', 2, T0 - 400),
      ]),
      constraintSet: fixtureConstraintSet(),
      goal: fixtureGoal('tenant-beta'),
      seed: SEED,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('tenant_missing');
  });

  it('a state whose lineage disagrees with the run inputs fails with lineage_gap (L9)', () => {
    const state = fixtureState([{ instrumentId: BTC, weight: '0.5' }, { instrumentId: ETH, weight: '0.5' }]);
    const mutated = { ...state, lineage: { ...state.lineage, strategy: { specId: 'spec-OTHER', version: 1 } } } as unknown as PortfolioState;
    const result = compileStrategyRun({
      spec: fixtureSpec(),
      state: mutated,
      window: fixtureWindow([
        tradeEvent('e1', BTC, '50000', 1, T0 - 500),
        tradeEvent('e2', ETH, '3000', 2, T0 - 400),
      ]),
      constraintSet: fixtureConstraintSet(),
      goal: fixtureGoal(),
      seed: SEED,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('lineage_gap');
  });

  it('a decision instant before the state asOf fails (monotonic clock, L4)', () => {
    const state = fixtureState([{ instrumentId: BTC, weight: '0.5' }, { instrumentId: ETH, weight: '0.5' }]);
    const result = compileStrategyRun({
      spec: fixtureSpec(),
      state,
      window: fixtureWindow(
        [
          tradeEvent('e1', BTC, '50000', 1, T0 - 500),
          tradeEvent('e2', ETH, '3000', 2, T0 - 400),
        ],
        T0 - 10,
      ),
    } as never);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Emission discipline
// ---------------------------------------------------------------------------

describe('compileStrategyRun — emission discipline', () => {
  it('limit intents carry a tick-aligned price from the declared anchor', () => {
    const run = unwrapRun(
      compileStrategyRun({
        spec: fixtureSpec(),
        state: fixtureState([{ instrumentId: BTC, weight: '0.7' }, { instrumentId: ETH, weight: '0.3' }], '0', [
          { instrumentId: BTC, quantity: '0.14', costBasis: '6000' },
        ]),
        window: fixtureWindow([
          tradeEvent('e1', BTC, '50000.17', 1, T0 - 500),
          tradeEvent('e2', ETH, '3000', 2, T0 - 400),
        ]),
        constraintSet: fixtureConstraintSet(),
        goal: fixtureGoal(),
        seed: SEED,
      }),
    );
    const sell = run.intents.find((intent) => intent.order.side === 'sell');
    expect(sell).toBeDefined();
    expect(sell?.order.kind).toBe('limit');
    expect(sell?.order.price).toBe('50000.17');
  });

  it('market intents carry no price under the market discipline', () => {
    const spec = fixtureSpec({ priceDiscipline: { kind: 'market' } });
    const run = unwrapRun(
      compileStrategyRun({
        spec,
        state: fixtureState([{ instrumentId: BTC, weight: '0.7' }, { instrumentId: ETH, weight: '0.3' }], '0', [
          { instrumentId: BTC, quantity: '0.14', costBasis: '6000' },
        ]),
        window: fixtureWindow([
          tradeEvent('e1', BTC, '50000', 1, T0 - 500),
          tradeEvent('e2', ETH, '3000', 2, T0 - 400),
        ]),
        constraintSet: fixtureConstraintSet(),
        goal: fixtureGoal(),
        seed: SEED,
      }),
    );
    const sell = run.intents.find((intent) => intent.order.side === 'sell');
    expect(sell?.order.kind).toBe('market');
    expect(sell?.order.price).toBeUndefined();
  });

  it('quantities are lot-aligned (the venue would reject anything else)', () => {
    const run = unwrapRun(
      compileStrategyRun({
        spec: fixtureSpec(),
        state: fixtureState([{ instrumentId: BTC, weight: '0.7' }, { instrumentId: ETH, weight: '0.3' }], '0', [
          { instrumentId: BTC, quantity: '0.14', costBasis: '6000' },
        ]),
        window: fixtureWindow([
          tradeEvent('e1', BTC, '50000', 1, T0 - 500),
          tradeEvent('e2', ETH, '3000', 2, T0 - 400),
        ]),
        constraintSet: fixtureConstraintSet(),
        goal: fixtureGoal(),
        seed: SEED,
      }),
    );
    for (const intent of run.intents) {
      const entry = fixtureSpec().universe.find((u) => u.instrumentId === intent.order.instrumentId);
      expect(entry).toBeDefined();
      // lot 0.001 for BTC, 0.01 for ETH: quantity must be a multiple.
      const quantity = Number(intent.order.quantity);
      const lot = Number(entry?.lotSize);
      expect(Math.abs(quantity / lot - Math.round(quantity / lot))).toBeLessThan(1e-12);
    }
  });
});
