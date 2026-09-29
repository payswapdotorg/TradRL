/**
 * Cross-package interoperability trip wires for @tradrl/trading-strategy.
 *
 * The strategy lane's mirrors are proven against the REAL canonical
 * packages PRESENT on this branch (static relative imports — the
 * market-world/rl-protocol interop precedent; the frozen write surface
 * permits test-only imports):
 *
 *   - @tradrl/exchange-sim (T010): the OrderIntentMirror is EXACTLY the
 *     real `OrderIntent` (type-level mutual assignability; runtime:
 *     fixture intents pass the REAL `isOrderIntent` AND the REAL
 *     `validateOrderIntent` against a matching venue/instrument); a
 *     REAL `Fill` (with our order as the taker) maps onto an
 *     `AccountFill` — the transition input carries everything the
 *     account perspective needs; decimal ARITHMETIC parity (the mirror
 *     computes identical results to the real module on an adversarial
 *     battery).
 *   - @tradrl/control-domain (T007): the GoalStatementMirror /
 *     ConstraintSetStatementMirror are field-for-field the real
 *     `GoalStatement` / `ConstraintSetStatement` (mutual assignability;
 *     runtime: the mirrors pass the REAL guards, and the real records
 *     pass THIS package's mirror guards).
 *   - @tradrl/evaluation (T012): an AttainmentEvidence binding minus
 *     its evidence ref IS the real `CriterionBinding` (assignability +
 *     the REAL `isCriterionBinding` guard) — the backtest trail's
 *     bindings feed the REAL evaluation compiler unmodified.
 *   - @tradrl/market-protocol: the MarketEventMirror IS a real
 *     `MarketEvent` (assignability; runtime: fixture events pass the
 *     REAL `validateMarketEvent` and payload validators).
 *   - @tradrl/rl-protocol (T013): a backtest candidate's learning
 *     lineage binds into the REAL trial shape — a `TrialRecord`
 *     constructed from the candidate passes the REAL
 *     `validateTrialRecord` (the strategies-can-be-learned bridge).
 *
 * Type-level assertions fail `pnpm typecheck`; runtime assertions fail
 * `pnpm test`. Either way, a mirror can never drift silently
 * (D-003/D-004).
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as strategy from './index';
import * as exchangeSim from '../../exchange-sim/src/index';
import * as controlDomain from '../../control-domain/src/index';
import * as domainCore from '../../domain-core/src/index';
import * as evaluation from '../../evaluation/src/index';
import * as marketProtocol from '../../market-protocol/src/index';
import * as rlProtocol from '../../rl-protocol/src/index';

import type { OrderIntent as RealOrderIntent } from '../../exchange-sim/src/index';
import type { GoalStatement as RealGoalStatement, ConstraintSetStatement as RealConstraintSetStatement } from '../../control-domain/src/index';
import type { CriterionBinding as RealCriterionBinding } from '../../evaluation/src/index';
import type { MarketEvent as RealMarketEvent } from '../../market-protocol/src/index';
import type { TrialRecord as RealTrialRecord } from '../../rl-protocol/src/index';

const T0 = 1_700_000_000_000;
const ISO = '2023-11-14T22:13:20.000Z';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff OUR OrderIntentMirror is assignable to the REAL exchange-sim OrderIntent. */
function mirrorIsRealOrderIntent(value: strategy.OrderIntentMirror): RealOrderIntent {
  return value;
}

/** Compiles iff the REAL exchange-sim OrderIntent is assignable to OUR mirror. */
function realOrderIntentIsMirror(value: RealOrderIntent): strategy.OrderIntentMirror {
  return value;
}

/** Compiles iff OUR goal mirror IS the REAL control-domain GoalStatement (both directions). */
function goalMirrorParity(value: strategy.GoalStatementMirror): RealGoalStatement {
  return value;
}

function realGoalIsMirror(value: RealGoalStatement): strategy.GoalStatementMirror {
  return value;
}

/** Compiles iff OUR constraint-set mirror IS the REAL control-domain ConstraintSetStatement (both directions). */
function constraintSetMirrorParity(value: strategy.ConstraintSetStatementMirror): RealConstraintSetStatement {
  return value;
}

function realConstraintSetIsMirror(value: RealConstraintSetStatement): strategy.ConstraintSetStatementMirror {
  return value;
}

/** Compiles iff OUR attainment binding (minus the evidence ref) IS the REAL evaluation CriterionBinding. */
function attainmentBindingIsCriterionBinding(
  binding: strategy.AttainmentEvidence,
): RealCriterionBinding {
  return {
    criterionId: binding.criterionId,
    requiredSatisfaction: binding.requiredSatisfaction,
    gatingConstraintIds: binding.gatingConstraintIds,
    blockingConstraintIds: binding.blockingConstraintIds,
  };
}

/** Compiles iff OUR trade/quote event mirrors ARE the REAL canonical MarketEvents. */
function tradeMirrorIsRealMarketEvent(value: Extract<strategy.MarketEventMirror, { readonly event_type: 'trade' }>): RealMarketEvent {
  return value;
}

function quoteMirrorIsRealMarketEvent(value: Extract<strategy.MarketEventMirror, { readonly event_type: 'quote' }>): RealMarketEvent {
  return value;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function fixtureLimitIntent(): strategy.OrderIntentMirror {
  return ({
    clientOrderId: 'si-interop-1',
    instrumentId: 'BTC-USD',
    venueId: 'SIM',
    side: 'buy',
    kind: 'limit',
    quantity: '0.001',
    price: '50000.01',
    timeInForce: 'gtc',
    createdAt: ISO,
  }) as unknown as strategy.OrderIntentMirror;
}

function fixtureMarketIntent(): strategy.OrderIntentMirror {
  return ({
    clientOrderId: 'si-interop-2',
    instrumentId: 'ETH-USD',
    venueId: 'SIM',
    side: 'sell',
    kind: 'market',
    quantity: '0.01',
    timeInForce: 'day',
    createdAt: ISO,
  }) as unknown as strategy.OrderIntentMirror;
}

function fixtureTradeMirror(): Extract<strategy.MarketEventMirror, { readonly event_type: 'trade' }> {
  return {
    event_id: 'evt-1',
    venue: 'SIM',
    instrument: 'BTC-USD',
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: T0,
    source_time: null,
    available_time: T0,
    ingestion_time: T0,
    sequence: 1,
    provider: 'sim',
    provenance: { origin: 'historical', adapter: { id: 'sim-adapter', version: '1.0.0' }, derived_from: [], transform: null },
    payload: { price: '50000.01', size: '0.25', side: 'buy', trade_id: 't-1' },
  } as never;
}

function fixtureQuoteMirror(): Extract<strategy.MarketEventMirror, { readonly event_type: 'quote' }> {
  return {
    event_id: 'evt-2',
    venue: 'SIM',
    instrument: 'BTC-USD',
    asset_class: 'crypto',
    event_type: 'quote',
    event_time: T0 + 1,
    source_time: null,
    available_time: T0 + 1,
    ingestion_time: T0 + 1,
    sequence: 2,
    provider: 'sim',
    provenance: { origin: 'historical', adapter: { id: 'sim-adapter', version: '1.0.0' }, derived_from: [], transform: null },
    payload: { bid_price: '49999.99', bid_size: '1.5', ask_price: '50000.01', ask_size: '1.25' },
  } as never;
}

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// Lane 1: exchange-sim (T010)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/exchange-sim (the order-intent mirror)', () => {
  it('type-level parity: the mirror and the real OrderIntent are mutually assignable', () => {
    expectTypeOf(mirrorIsRealOrderIntent(fixtureLimitIntent())).toMatchTypeOf<RealOrderIntent>();
    expectTypeOf(realOrderIntentIsMirror).toBeFunction();
    expectTypeOf(goalMirrorParity).toBeFunction();
  });

  it('runtime: fixture intents pass the REAL isOrderIntent guard', () => {
    expect(exchangeSim.isOrderIntent(fixtureLimitIntent())).toBe(true);
    expect(exchangeSim.isOrderIntent(fixtureMarketIntent())).toBe(true);
  });

  it('runtime: fixture intents pass the REAL validateOrderIntent against a matching venue/instrument', () => {
    const limit = unwrap(
      exchangeSim.validateOrderIntent(fixtureLimitIntent(), { venue: 'SIM' as never, instrument: 'BTC-USD' as never }),
    );
    expect(limit.clientOrderId).toBe('si-interop-1');
    const market = unwrap(
      exchangeSim.validateOrderIntent(fixtureMarketIntent(), { venue: 'SIM' as never, instrument: 'ETH-USD' as never }),
    );
    expect(market.kind).toBe('market');
    // A venue mismatch fails exactly as the real engine would reject it.
    const mismatched = exchangeSim.validateOrderIntent(fixtureLimitIntent(), { venue: 'OTHER' as never, instrument: 'BTC-USD' as never });
    expect(mismatched.ok).toBe(false);
  });

  it('runtime: the mirror guards agree with the REAL guard on negative shapes', () => {
    const broken = { ...fixtureLimitIntent(), price: undefined };
    expect(strategy.isOrderIntentMirror(broken)).toBe(false);
    expect(exchangeSim.isOrderIntent(broken)).toBe(false);
    const zeroQty = { ...fixtureLimitIntent(), quantity: '0' };
    expect(strategy.isOrderIntentMirror(zeroQty)).toBe(false);
    expect(exchangeSim.isOrderIntent(zeroQty)).toBe(false);
  });

  it('a REAL exchange Fill (our order as taker) maps onto an AccountFill — the transition input', () => {
    // A real fill as the engine emits it (records.ts shape).
    const realFill = {
      fill_id: 'xf-00000001',
      trade_id: 'xf-00000001',
      venue: 'SIM',
      instrument: 'BTC-USD',
      quartet: { event_time: T0, source_time: null, available_time: T0 + 12, ingestion_time: T0 },
      sequence: 1,
      taker_order_id: 'xo-00000001',
      maker_order_id: 'xo-00000002',
      aggressor_side: 'buy',
      price: '50000.01',
      aggressor_price: '50000.02',
      quantity: '0.001',
      taker_fee: '0.05',
      maker_fee: '0.02',
      latency_ms: 12,
    };
    expect(exchangeSim.isFill(realFill)).toBe(true);
    // The account-perspective mapping (documented in exchange-mirror.ts):
    // our order was the taker, so the account's price is the aggressor
    // price, its fee the taker fee, its side the aggressor side.
    const accountFill = {
      fill_id: realFill.fill_id,
      instrument: realFill.instrument,
      venue: realFill.venue,
      side: realFill.aggressor_side,
      price: realFill.aggressor_price,
      quantity: realFill.quantity,
      fee: realFill.taker_fee,
      event_time: realFill.quartet.event_time,
    } as unknown as strategy.AccountFill;
    expect(strategy.isAccountFill(accountFill)).toBe(true);
    // The account fill feeds the pure transition (a full round trip).
    const lineage = {
      strategy: { specId: 'spec-1', version: 1 },
      goal: { goalId: 'goal-1', version: 1 },
      constraintSet: { id: 'cs-1', version: 1 },
      windowId: 'win-1',
      seed: 'seed-1',
      tenant: 'tenant-alpha',
      project: 'project-one',
    } as unknown as strategy.StrategyLineage;
    const initial = unwrap(strategy.initialPortfolioState(lineage, '1000', (T0 - 1000) as never));
    const window = {
      window_id: 'win-1',
      events: [fixtureTradeMirror()],
      asOf: T0,
      starts_at: T0 - 1000,
      ends_at: T0 + 1,
    } as unknown as strategy.ObservationWindow;
    const applied = unwrap(
      strategy.applyPortfolioEvents(initial, { fills: [accountFill], corporateActions: [] }, window, 8, T0 as never),
    );
    expect(applied.state.positions[0]?.quantity).toBe('0.001');
  });

  it('decimal ARITHMETIC parity: the mirror computes identical results to the real module', () => {
    const batteries: readonly [string, string][] = [
      ['0.1', '0.2'],
      ['123456789.12345678', '987654321.87654321'],
      ['0.00000001', '99999999999'],
      ['1', '3'],
      ['7000.0238', '50000.17'],
    ];
    for (const [a, b] of batteries) {
      expect(strategy.add(a, b)).toBe(exchangeSim.add(a, b));
      expect(strategy.multiply(a, b)).toBe(exchangeSim.multiply(a, b));
      expect(strategy.divideRoundHalfUp(a, b, 8)).toBe(exchangeSim.divideRoundHalfUp(a, b, 8));
      expect(strategy.compare(a, b)).toBe(exchangeSim.compare(a, b));
    }
    expect(strategy.floorToGrid('0.12345', '0.001')).toBe(exchangeSim.floorToGrid('0.12345', '0.001'));
    expect(strategy.isAlignedToGrid('0.12', '0.01')).toBe(exchangeSim.isAlignedToGrid('0.12', '0.01'));
  });
});

// ---------------------------------------------------------------------------
// Lane 2: control-domain (T007)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/control-domain (the goal/constraint mirrors)', () => {
  function fixtureGoalMirror(): strategy.GoalStatementMirror {
    return ({
      id: 'goal-1',
      version: 1,
      tenantId: 'tenant-alpha',
      objective: 'Grow the reserve within risk limits.',
      horizon: { startsAt: T0, endsAt: T0 + 86_400_000, label: 'daily' },
      successCriteria: {
        criteria: [
          { id: 'c1', metric: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, description: 'drawdown' },
        ],
        requiredSatisfaction: 1,
      },
      evaluation: { blindRef: 'blind:v1', walkForwardRef: 'wf:v1', regimeRef: 'regime:v1', adversarialRequired: true },
      createdAt: T0,
      description: 'fixture',
    }) as unknown as strategy.GoalStatementMirror;
  }

  function fixtureConstraintSetMirror(): strategy.ConstraintSetStatementMirror {
    return ({
      id: 'cs-1',
      version: 1,
      tenantId: 'tenant-alpha',
      name: 'fixture set',
      constraints: [
        {
          id: 'k1',
          domain: 'state',
          subject: 'state.positions',
          predicate: { kind: 'limit.max', bound: 5 },
          severity: 'blocking',
        },
        {
          id: 'a1',
          domain: 'observation',
          subject: 'window.trades',
          predicate: { kind: 'limit.min', bound: 1 },
          severity: 'advisory',
        },
      ],
      createdAt: T0,
    }) as unknown as strategy.ConstraintSetStatementMirror;
  }

  it('type-level parity: both mirror pairs are mutually assignable with the real records', () => {
    expectTypeOf(goalMirrorParity(fixtureGoalMirror())).toMatchTypeOf<RealGoalStatement>();
    expectTypeOf(realGoalIsMirror).toBeFunction();
    expectTypeOf(constraintSetMirrorParity(fixtureConstraintSetMirror())).toMatchTypeOf<RealConstraintSetStatement>();
    expectTypeOf(realConstraintSetIsMirror).toBeFunction();
  });

  it('runtime: the mirrors pass the REAL control-domain guards', () => {
    expect(controlDomain.isGoalStatement(fixtureGoalMirror())).toBe(true);
    expect(controlDomain.isConstraintSetStatement(fixtureConstraintSetMirror())).toBe(true);
  });

  it('runtime: THIS package\'s mirror guards accept the real records', () => {
    expect(strategy.isGoalStatementMirror(fixtureGoalMirror())).toBe(true);
    expect(strategy.isConstraintSetStatementMirror(fixtureConstraintSetMirror())).toBe(true);
  });

  it('runtime: the mirrors agree on negative shapes (duplicate constraint ids, bad horizons)', () => {
    const dup = { ...fixtureConstraintSetMirror(), constraints: [...fixtureConstraintSetMirror().constraints, fixtureConstraintSetMirror().constraints[0]] };
    expect(strategy.isConstraintSetStatementMirror(dup)).toBe(false);
    expect(controlDomain.isConstraintSetStatement(dup)).toBe(false);
    const emptyHorizon = { ...fixtureGoalMirror(), horizon: { startsAt: T0, endsAt: T0 } };
    expect(strategy.isGoalStatementMirror(emptyHorizon)).toBe(false);
    expect(controlDomain.isGoalStatement(emptyHorizon)).toBe(false);
  });

  it('the gate\'s semantics mirror domain-core\'s engine verdict on the same facts', () => {
    // domain-core's REAL engine (T002 owns the canonical semantics) over
    // its own set/context shape:
    const engineSet = {
      id: 'cs-1',
      version: 1,
      createdAt: new Date(T0).toISOString(),
      constraints: [
        { id: 'k1', domain: 'state', subject: 'state.positions', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking' },
        { id: 'e1', domain: 'state', subject: 'state.cash', predicate: { kind: 'limit.max', bound: 5 }, severity: 'blocking' },
      ],
    } as never;
    const report = domainCore.evaluateConstraintSet(
      engineSet,
      {
        observations: {},
        state: { 'state.positions': 2, 'state.cash': '1000' },
        actions: {},
        outcomes: {},
      } as never,
      new Date(T0).toISOString() as never,
    );
    expect(report.pass).toBe(false); // violated + error, exactly as the canonical engine rules
    // OUR gate over the mirrored set/context: the SAME verdict, check for check.
    const mirrorReport = strategy.runConstraintGate(
      ({
        id: 'cs-1',
        version: 1,
        tenantId: 'tenant-alpha',
        constraints: [
          { id: 'k1', domain: 'state', subject: 'state.positions', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking' },
          { id: 'e1', domain: 'state', subject: 'state.cash', predicate: { kind: 'limit.max', bound: 5 }, severity: 'blocking' },
        ],
        createdAt: T0,
      }) as never,
      {
        observation: {},
        state: { 'state.positions': 2, 'state.cash': '1000' },
        action: {},
        outcome: {},
      },
    );
    expect(mirrorReport.pass).toBe(false);
    expect(mirrorReport.violated).toBe(1);
    expect(mirrorReport.errors).toBe(1);
    // Per-check parity.
    const engineById = new Map(report.checks.map((check) => [check.constraintId, check.status] as const));
    const mirrorById = new Map(mirrorReport.checks.map((check) => [check.constraintId, check.status] as const));
    expect(engineById.get('k1')).toBe('violated');
    expect(mirrorById.get('k1')).toBe('violated');
    expect(engineById.get('e1')).toBe('error');
    expect(mirrorById.get('e1')).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Lane 3: evaluation (T012)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/evaluation (the attainment bindings)', () => {
  it('type-level parity: the binding minus its evidence ref IS the real CriterionBinding', () => {
    const binding: strategy.AttainmentEvidence = {
      criterionId: 'c1',
      requiredSatisfaction: 1,
      gatingConstraintIds: ['k1', 'k2'],
      blockingConstraintIds: ['k1'],
      evidenceRef: 'eval-evidence:c1@1',
    };
    expectTypeOf(attainmentBindingIsCriterionBinding(binding)).toMatchTypeOf<RealCriterionBinding>();
  });

  it('runtime: the binding (minus the evidence ref) passes the REAL isCriterionBinding guard', () => {
    const binding = {
      criterionId: 'c1',
      requiredSatisfaction: 0.9,
      gatingConstraintIds: ['k1', 'k2'],
      blockingConstraintIds: ['k1'],
      evidenceRef: 'eval-evidence:c1@1',
    };
    expect(strategy.isAttainmentEvidence(binding)).toBe(true);
    expect(
      evaluation.isCriterionBinding({
        criterionId: binding.criterionId,
        requiredSatisfaction: binding.requiredSatisfaction,
        gatingConstraintIds: binding.gatingConstraintIds,
        blockingConstraintIds: binding.blockingConstraintIds,
      }),
    ).toBe(true);
  });

  it('runtime: a broken binding breaks BOTH guards identically (empty gating list)', () => {
    const broken = {
      criterionId: 'c1',
      requiredSatisfaction: 1,
      gatingConstraintIds: [],
      blockingConstraintIds: [],
      evidenceRef: 'e',
    };
    expect(strategy.isAttainmentEvidence(broken)).toBe(false);
    expect(
      evaluation.isCriterionBinding({
        criterionId: broken.criterionId,
        requiredSatisfaction: broken.requiredSatisfaction,
        gatingConstraintIds: broken.gatingConstraintIds,
        blockingConstraintIds: broken.blockingConstraintIds,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lane 4: market-protocol (the observation substrate)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/market-protocol (the observation mirrors)', () => {
  it('type-level parity: the trade/quote mirrors ARE real MarketEvents', () => {
    expectTypeOf(tradeMirrorIsRealMarketEvent(fixtureTradeMirror())).toMatchTypeOf<RealMarketEvent>();
    expectTypeOf(quoteMirrorIsRealMarketEvent(fixtureQuoteMirror())).toMatchTypeOf<RealMarketEvent>();
  });

  it('runtime: the mirrors pass the REAL validateMarketEvent', () => {
    expect(marketProtocol.validateMarketEvent(fixtureTradeMirror()).ok).toBe(true);
    expect(marketProtocol.validateMarketEvent(fixtureQuoteMirror()).ok).toBe(true);
    // And the payload validators directly.
    expect(marketProtocol.validateTradePayload(fixtureTradeMirror().payload)).toHaveLength(0);
    expect(marketProtocol.validateQuotePayload(fixtureQuoteMirror().payload)).toHaveLength(0);
  });

  it('runtime: negative shapes fail BOTH the mirror guard and the REAL validator', () => {
    const broken = { ...fixtureTradeMirror(), available_time: (T0 - 1) as never };
    expect(strategy.isMarketEventMirror(broken)).toBe(false);
    expect(marketProtocol.validateMarketEvent(broken).ok).toBe(false);
    const orphan = {
      ...fixtureTradeMirror(),
      provenance: { origin: 'historical', adapter: null, derived_from: [], transform: null },
    };
    expect(strategy.isMarketEventMirror(orphan)).toBe(false);
    expect(marketProtocol.validateMarketEvent(orphan).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lane 5: rl-protocol (T013 — the learned-strategy binding)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/rl-protocol (the learning lineage binding)', () => {
  it('a backtest candidate\'s learning lineage binds into a REAL TrialRecord that validates', () => {
    const candidate = {
      candidateId: 'btc:aabbccdd',
      sequence: 1,
      strategy: { specId: 'spec-learned', version: 3 },
      window: { windowId: 'win-1', startsAt: T0 - 1000, endsAt: T0 },
      attainment: [
        {
          criterionId: 'c1',
          requiredSatisfaction: 1,
          gatingConstraintIds: ['k1'],
          blockingConstraintIds: ['k1'],
          evidenceRef: 'eval-evidence:c1@1',
        },
      ],
      disposition: 'retained',
      reason: { kind: 'attained', attainedCriteria: 1, totalCriteria: 1 },
      learning: { trialId: 'trial-42', armId: 'arm-eq-weight', trajectoryId: 'traj-42' },
      goal: { goalId: 'goal-1', version: 1 },
      tenant: 'tenant-alpha',
      project: 'project-one',
      recordedAt: T0,
    } as unknown as strategy.BacktestCandidate;
    expect(strategy.isBacktestCandidate(candidate)).toBe(true);

    // The bridge: the candidate's learning lineage + disposition compose
    // a REAL rl-protocol TrialRecord (the experiments-lane shape the
    // bridge emits) — and it passes the REAL validator.
    const learning = candidate.learning;
    expect(learning).not.toBeNull();
    if (learning !== null) {
      const trial: RealTrialRecord = {
        trial_id: learning.trialId,
        arm: learning.armId,
        status: candidate.disposition === 'rejected' ? 'failed' : 'succeeded',
        trajectory: learning.trajectoryId,
        outcome: { disposition: candidate.disposition },
        started_at: candidate.window.startsAt,
        ended_at: candidate.window.endsAt,
        failure_reason: candidate.disposition === 'rejected' ? candidate.reason.kind : null,
      };
      const validated = rlProtocol.validateTrialRecord(trial);
      expect(validated.ok).toBe(true);
      expect(rlProtocol.isTrialRecord(trial)).toBe(true);
    }
  });

  it('the mirrored id brand tags match the REAL rl-protocol identity spaces (compile-time parity)', () => {
    const trialId = 'trial-42' as rlProtocol.TrialId;
    const armId = 'arm-eq-weight' as rlProtocol.ArmId;
    const trajectoryId = 'traj-42' as rlProtocol.TrajectoryId;
    // The brand tags match (program-wide identity spaces): the REAL
    // rl-protocol ids ARE this lane's mirrored refs, zero casts.
    const asStrategyRefs: { trialId: strategy.TrialId; armId: strategy.ArmId; trajectoryId: strategy.TrajectoryId } = {
      trialId,
      armId,
      trajectoryId,
    };
    expect(asStrategyRefs.trialId).toBe('trial-42');
  });
});
