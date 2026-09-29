/**
 * Cross-package interoperability trip wires for @tradrl/risk.
 *
 * The risk lane's mirrors are proven against the REAL canonical packages
 * PRESENT on this branch (static relative imports — the
 * trading-strategy/execution-policy interop precedent; the frozen write
 * surface permits test-only imports):
 *
 *   - @tradrl/control-domain (T007): the ConstraintSetMirror IS the REAL
 *     `ConstraintSetStatement` (type-level mutual assignability;
 *     runtime: a REAL-shape constraint set — every predicate kind,
 *     both severities, unique ids — passes BOTH guards, and a REAL set
 *     COMPILES through compileRiskPolicy into a valid policy).
 *   - @tradrl/execution-policy (T019): the ClassLimitRecord IS the REAL
 *     `LimitRecord` (mutually assignable); the KillSwitchLogMirror IS
 *     the REAL `KillSwitchLog` — a log produced by the REAL
 *     `startKillSwitch` / `throwKillSwitch` verifies under THIS lane's
 *     chain verification and BLOCKS every limit state in the risk
 *     engine (the kill-switch interop law); the execution-limit
 *     refusals satisfy the REAL `isRefusalReason` guard (the gate
 *     consumes these states); the class-kind vocabulary matches the
 *     REAL `LIMIT_KINDS`; the minted `risk-policy:` refs satisfy the
 *     REAL `isRiskPolicyRef` (the reservation this lane resolves).
 *   - @tradrl/trading-strategy (T018): the PortfolioStateMirror IS the
 *     REAL `PortfolioState` (mutually assignable; the REAL package's
 *     `initialPortfolioState` product passes this lane's mirror guard).
 *   - @tradrl/exchange-sim (T010): the FillMirror IS the REAL `Fill`
 *     (mutually assignable; a dual-guard fill feeds computeExposure);
 *     the decimal ARITHMETIC is identical over a battery.
 *   - @tradrl/market-protocol (T003): the MarketEventMirror IS the REAL
 *     trade/quote event (mutually assignable; a REAL-validated event
 *     drives deriveMarketState).
 *
 * Type-level assertions fail `pnpm typecheck`; runtime assertions fail
 * `pnpm test`. Either way, a mirror can never drift silently
 * (D-003/D-004).
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as risk from './index';
import * as controlDomain from '../../control-domain/src/index';
import * as executionPolicy from '../../execution-policy/src/index';
import * as tradingStrategy from '../../trading-strategy/src/index';
import * as exchangeSim from '../../exchange-sim/src/index';
import * as marketProtocol from '../../market-protocol/src/index';

import type { ConstraintSetStatement as RealConstraintSet, ConstraintStatement as RealConstraint } from '../../control-domain/src/index';
import type { LimitRecord as RealLimitRecord, KillSwitchLog as RealKillSwitchLog, RefusalReason as RealRefusalReason } from '../../execution-policy/src/index';
import type { PortfolioState as RealPortfolioState, StrategyLineage as RealStrategyLineage } from '../../trading-strategy/src/index';
import type { Fill as RealFill } from '../../exchange-sim/src/index';
import type { TradeEvent as RealTradeEvent } from '../../market-protocol/src/index';

import { SEED, T0, fixtureFill, fixtureMarketEvents, fixturePolicy, fixturePortfolio, unwrap } from './test-fixtures';

/** Unwrap ANY lane's result shape (the interop battery crosses packages). */
function unwrapAny<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`interop fixture must be valid: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff OUR ConstraintSetMirror is assignable to the REAL control-domain ConstraintSetStatement. */
function mirrorIsRealConstraintSet(value: risk.ConstraintSetMirror): RealConstraintSet {
  return value;
}

/** Compiles iff the REAL control-domain ConstraintSetStatement is assignable to OUR mirror. */
function realConstraintSetIsMirror(value: RealConstraintSet): risk.ConstraintSetMirror {
  return value;
}

/** Compiles iff OUR ClassLimitRecord IS the REAL execution-policy LimitRecord (both directions). */
function mirrorIsRealLimitRecord(value: risk.ClassLimitRecord): RealLimitRecord {
  return value;
}

function realLimitRecordIsMirror(value: RealLimitRecord): risk.ClassLimitRecord {
  return value;
}

/** Compiles iff OUR KillSwitchLogMirror IS the REAL execution-policy KillSwitchLog (both directions). */
function mirrorIsRealKillSwitchLog(value: risk.KillSwitchLogMirror): RealKillSwitchLog {
  return value;
}

function realKillSwitchLogIsMirror(value: RealKillSwitchLog): risk.KillSwitchLogMirror {
  return value;
}

/** Compiles iff OUR PortfolioStateMirror IS the REAL trading-strategy PortfolioState (both directions). */
function mirrorIsRealPortfolioState(value: risk.PortfolioStateMirror): RealPortfolioState {
  return value;
}

function realPortfolioStateIsMirror(value: RealPortfolioState): risk.PortfolioStateMirror {
  return value;
}

/** Compiles iff OUR FillMirror IS the REAL exchange-sim Fill (both directions). */
function mirrorIsRealFill(value: risk.FillMirror): RealFill {
  return value;
}

function realFillIsMirror(value: RealFill): risk.FillMirror {
  return value;
}

/** Compiles iff OUR trade-event mirror IS the REAL market-protocol TradeEvent (the one-directional
 *  mirror-to-real parity — the trading-strategy interop precedent: market-protocol's ids are
 *  deliberately UNbranded, so real-to-mirror flows through the runtime guards instead). */
function mirrorIsRealTradeEvent(value: Extract<risk.MarketEventMirror, { readonly event_type: 'trade' }>): RealTradeEvent {
  return value;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** A REAL-shape constraint set (control-domain's own guard accepts it). */
const REAL_SHAPE_SET: RealConstraintSet = {
  id: 'cs-interop' as RealConstraintSet['id'],
  version: 1,
  tenantId: 'tenant-alpha' as RealConstraintSet['tenantId'],
  name: 'interop constraints',
  createdAt: (T0 - 60_000) as never,
  constraints: [
    { id: 'c-order-size', domain: 'action', subject: 'risk.order_size.crypto', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking' },
    { id: 'c-order-notional', domain: 'action', subject: 'risk.order_notional.crypto', predicate: { kind: 'limit.max', bound: 120000 }, severity: 'blocking' },
    { id: 'c-position-size', domain: 'state', subject: 'risk.position_size.crypto', predicate: { kind: 'limit.max', bound: 3 }, severity: 'blocking' },
    { id: 'c-position-notional', domain: 'state', subject: 'risk.position_notional.crypto', predicate: { kind: 'limit.max', bound: 150000 }, severity: 'blocking' },
    { id: 'c-drawdown', domain: 'state', subject: 'risk.drawdown', predicate: { kind: 'limit.max', bound: 10000 }, severity: 'blocking' },
    { id: 'c-returns-sharpe', domain: 'observation', subject: 'returns.sharpe', predicate: { kind: 'limit.min', bound: 1 }, severity: 'advisory' },
    { id: 'c-positions', domain: 'outcome', subject: 'state.positions', predicate: { kind: 'oneOf', values: ['a', 'b'] }, severity: 'advisory' },
  ] as readonly RealConstraint[],
};

// ---------------------------------------------------------------------------
// Lane 1: control-domain (T007 — the compilation source)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/control-domain (the constraint-set mirror)', () => {
  it('type-level parity: the mirror and the REAL ConstraintSetStatement are mutually assignable', () => {
    expectTypeOf(mirrorIsRealConstraintSet(REAL_SHAPE_SET as unknown as risk.ConstraintSetMirror)).toMatchTypeOf<RealConstraintSet>();
    expectTypeOf(realConstraintSetIsMirror).toBeFunction();
  });

  it('runtime: the REAL-shape set passes BOTH guards (the shared predicate vocabulary included)', () => {
    expect(controlDomain.isConstraintSetStatement(REAL_SHAPE_SET)).toBe(true);
    expect(risk.isConstraintSetMirror(REAL_SHAPE_SET)).toBe(true);
    // The guards agree on a negative shape too.
    const broken = { ...REAL_SHAPE_SET, constraints: [{ id: '', domain: 'state', subject: 'risk.drawdown', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking' }] };
    expect(controlDomain.isConstraintSetStatement(broken)).toBe(false);
    expect(risk.isConstraintSetMirror(broken)).toBe(false);
  });

  it('runtime: a REAL set COMPILES into a valid risk policy (constraint -> limit records)', () => {
    const policy = unwrapAny(
      risk.compileRiskPolicy({
        constraintSet: REAL_SHAPE_SET,
        goal: { goalId: 'goal-interop', version: 1 },
        tenant: 'tenant-alpha' as never,
        project: 'project-interop' as never,
        asOf: (T0 - 50_000) as never,
        ratioPrecision: 6,
      }),
    );
    expect(risk.isRiskPolicy(policy)).toBe(true);
    // The blocking crypto class-kind caps + the drawdown threshold landed...
    const crypto = policy.classLimits.find((limit) => limit.instrumentClass === 'crypto');
    expect(crypto).toEqual({ instrumentClass: 'crypto', maxOrderSize: '2', maxOrderNotional: '120000', maxPositionSize: '3', maxPositionNotional: '150000' });
    expect(policy.drawdown).toEqual({ maxDrawdown: '10000' });
    // ...and ONLY the risk-bearing blocking constraints compiled (the advisories did not).
    expect(policy.compiledFrom).toEqual(['c-order-size', 'c-order-notional', 'c-position-size', 'c-position-notional', 'c-drawdown']);
    expect(policy.concentration).toBeNull();
    expect(policy.leverage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lane 2: execution-policy (T019 — the gate this lane feeds)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/execution-policy (the limits + the kill switch)', () => {
  it('type-level parity: the class-limit record IS the REAL LimitRecord (both directions)', () => {
    const record: risk.ClassLimitRecord = { instrumentClass: 'crypto', maxOrderSize: '2', maxOrderNotional: '120000', maxPositionSize: '3', maxPositionNotional: '150000' };
    expectTypeOf(mirrorIsRealLimitRecord(record)).toMatchTypeOf<RealLimitRecord>();
    expectTypeOf(realLimitRecordIsMirror).toBeFunction();
  });

  it('the class-kind vocabulary matches the REAL LIMIT_KINDS exactly (the totality enumeration)', () => {
    const ours = risk.RISK_LIMIT_KINDS.filter((kind): kind is risk.ClassLimitKind => kind === 'order_size' || kind === 'order_notional' || kind === 'position_size' || kind === 'position_notional');
    expect([...ours].sort()).toEqual([...executionPolicy.LIMIT_KINDS].sort());
  });

  it('the kill-switch interop law: a REAL thrown switch log BLOCKS every risk limit state', () => {
    // A REAL log, produced by the REAL package's own API.
    const standing = unwrapAny(executionPolicy.startKillSwitch('tenant-alpha' as never, 'project-one' as never, (T0 - 2_000) as never));
    const thrown = unwrapAny(executionPolicy.throwKillSwitch(standing, 'interop circuit breaker', (T0 - 100) as never));
    // The REAL log IS our mirror (mutual assignability, zero casts).
    expectTypeOf(mirrorIsRealKillSwitchLog(thrown)).toMatchTypeOf<RealKillSwitchLog>();
    expectTypeOf(realKillSwitchLogIsMirror).toBeFunction();
    expect(risk.isKillSwitchLogMirror(thrown)).toBe(true);
    expect(risk.verifyKillSwitchChainMirror(thrown).ok).toBe(true);

    // The interop law: every state is blocked, with the REAL switch's evidence.
    const market = unwrapAny(risk.deriveMarketState(fixtureMarketEvents(), T0 as never, 8));
    const exposure = unwrapAny(risk.computeExposure({ portfolio: fixturePortfolio(), marketState: market, fills: [fixtureFill()], priorPeakEquity: null, seed: SEED }));
    const evaluation = unwrapAny(risk.evaluateLimits({ exposure, policy: fixturePolicy(), killSwitch: thrown }));
    expect(evaluation.killSwitchState).toBe('thrown');
    expect(evaluation.states.length).toBeGreaterThan(0);
    expect(evaluation.states.every((state) => state.state === 'blocked')).toBe(true);
    for (const state of evaluation.states) {
      expect(state.reason?.cause).toBe('kill_switch');
      if (state.reason !== null && state.reason.cause === 'kill_switch') {
        expect(state.reason.switchId).toBe(thrown.switchId);
        expect(state.reason.thrownAt).toBe(T0 - 100);
      }
    }
    // And the standing REAL log does not block.
    const standingEvaluation = unwrapAny(risk.evaluateLimits({ exposure, policy: fixturePolicy(), killSwitch: standing }));
    expect(standingEvaluation.states.every((state) => state.state !== 'blocked')).toBe(true);
  });

  it('the execution-limit refusals satisfy the REAL isRefusalReason guard (the gate consumes these states)', () => {
    const standing = unwrapAny(executionPolicy.startKillSwitch('tenant-alpha' as never, 'project-one' as never, (T0 - 2_000) as never));
    const market = unwrapAny(risk.deriveMarketState(fixtureMarketEvents(), T0 as never, 8));
    const exposure = unwrapAny(
      risk.computeExposure({ portfolio: fixturePortfolio(), marketState: market, fills: [fixtureFill({ quantity: '2.5', aggressor_price: '50000.00', taker_fee: '0' })], priorPeakEquity: null, seed: SEED }),
    );
    const evaluation = unwrapAny(risk.evaluateLimits({ exposure, policy: fixturePolicy(), killSwitch: standing }));
    const refusals = risk.executionLimitRefusals(evaluation);
    expect(refusals.length).toBeGreaterThan(0);
    for (const refusal of refusals) {
      const asReal: RealRefusalReason = refusal; // zero casts — the bridge IS the gate's shape
      expect(executionPolicy.isRefusalReason(asReal)).toBe(true);
    }
  });

  it('the minted risk-policy refs satisfy the REAL isRiskPolicyRef (the reservation this lane resolves)', () => {
    const policy = fixturePolicy();
    const ref = risk.riskPolicyRefOf(risk.riskPolicyVersionRef(policy));
    expect(executionPolicy.isRiskPolicyRef(ref)).toBe(true);
    expect(tradingStrategy.isRiskPolicyRef(ref)).toBe(true);
    // The ref parses back to the policy version it names.
    expect(risk.parseRiskPolicyRef(ref)).toEqual({ policyId: policy.policyId, version: policy.version });
  });
});

// ---------------------------------------------------------------------------
// Lane 3: trading-strategy (T018 — the portfolio facts)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/trading-strategy (the portfolio-state mirror)', () => {
  it('type-level parity: the mirror and the REAL PortfolioState are mutually assignable', () => {
    expectTypeOf(mirrorIsRealPortfolioState(fixturePortfolio())).toMatchTypeOf<RealPortfolioState>();
    expectTypeOf(realPortfolioStateIsMirror).toBeFunction();
  });

  it('runtime: the REAL package\'s genesis portfolio product passes THIS lane\'s mirror guard', () => {
    const lineage = {
      strategy: { specId: 'spec-interop', version: 1 },
      goal: { goalId: 'goal-interop', version: 1 },
      constraintSet: { id: 'cs-interop', version: 1 },
      windowId: 'win-interop',
      seed: 'interop-seed',
      tenant: 'tenant-alpha',
      project: 'project-interop',
    } as unknown as RealStrategyLineage;
    const realState = unwrapAny(tradingStrategy.initialPortfolioState(lineage, '100000', (T0 - 1000) as never));
    expect(tradingStrategy.isPortfolioState(realState)).toBe(true);
    expect(risk.isPortfolioStateMirror(realState)).toBe(true);
    // And this lane's mirror fixture passes the REAL guard (mutual parity).
    expect(tradingStrategy.isPortfolioState(fixturePortfolio())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lane 4: exchange-sim (T010 — the fills)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/exchange-sim (the fill mirror + the arithmetic)', () => {
  it('type-level parity: the fill mirror IS the REAL Fill (both directions)', () => {
    expectTypeOf(mirrorIsRealFill(fixtureFill())).toMatchTypeOf<RealFill>();
    expectTypeOf(realFillIsMirror).toBeFunction();
  });

  it('runtime: the same fill passes BOTH guards (the structural law shared)', () => {
    const fill = fixtureFill();
    expect(exchangeSim.isFill(fill)).toBe(true);
    expect(risk.isFillMirror(fill)).toBe(true);
    // The guards agree on a shared negative shape (an empty quantity —
    // the REAL guard rejects non-strings/empties; THIS lane additionally
    // demands the unsigned decimal grammar, so it is the STRICTER of the
    // two — the interop direction that matters: REAL fills always pass).
    const broken = { ...fill, quantity: '' };
    expect(exchangeSim.isFill(broken)).toBe(false);
    expect(risk.isFillMirror(broken)).toBe(false);
  });

  it('runtime: a dual-guard fill feeds computeExposure (the exposure inputs are REAL-shaped)', () => {
    const market = unwrapAny(risk.deriveMarketState(fixtureMarketEvents(), T0 as never, 8));
    const exposure = unwrapAny(risk.computeExposure({ portfolio: fixturePortfolio(), marketState: market, fills: [fixtureFill()], priorPeakEquity: null, seed: SEED }));
    expect(exposure.orders[0]?.fillRef).toBe('xsf-00000001');
  });

  it('runtime: decimal ARITHMETIC parity with the REAL exchange-sim module', () => {
    const batteries: readonly [string, string][] = [
      ['0.1', '0.2'],
      ['123456789.12345678', '987654321.87654321'],
      ['0.00000001', '99999999999'],
      ['50000.01', '0.5'],
      ['40300', '40000'],
    ];
    for (const [a, b] of batteries) {
      expect(risk.add(a, b)).toBe(exchangeSim.add(a, b));
      expect(risk.multiply(a, b)).toBe(exchangeSim.multiply(a, b));
      expect(risk.compare(a, b)).toBe(exchangeSim.compare(a, b));
    }
  });
});

// ---------------------------------------------------------------------------
// Lane 5: market-protocol (T003 — the declared market inputs)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/market-protocol (the market-event mirror)', () => {
  it('type-level parity: the trade-event mirror IS the REAL TradeEvent', () => {
    expectTypeOf(mirrorIsRealTradeEvent(fixtureMarketEvents()[0] as Extract<risk.MarketEventMirror, { event_type: 'trade' }>)).toMatchTypeOf<RealTradeEvent>();
  });

  it('runtime: the fixture trade events pass the REAL validateMarketEvent AND this lane\'s mirror guard', () => {
    for (const event of fixtureMarketEvents()) {
      expect(marketProtocol.validateMarketEvent(event).ok).toBe(true);
      expect(risk.isMarketEventMirror(event)).toBe(true);
    }
    // The guards agree on a negative shape (a broken payload).
    const broken = { ...fixtureMarketEvents()[0], payload: { price: '0', size: '0', side: 'buy' } };
    expect(marketProtocol.validateMarketEvent(broken).ok).toBe(false);
    expect(risk.isMarketEventMirror(broken)).toBe(false);
  });

  it('runtime: a REAL-validated event drives deriveMarketState (the pricing facts derive from canonical events)', () => {
    const validated = unwrapAny(marketProtocol.validateMarketEvent(fixtureMarketEvents()[0]));
    const state = unwrapAny(risk.deriveMarketState([validated], T0 as never, 8));
    const btc = state.instruments.find((entry) => entry.instrument === 'BTC-USD');
    expect(btc?.referencePrice).toBe('50000.00');
    expect(btc?.priceSource).toBe('last_trade');
  });
});
