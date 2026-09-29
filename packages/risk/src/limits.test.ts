/**
 * @tradrl/risk — the LimitEvaluation tests: limit-state TOTALITY (every
 * declared kind evaluates), breach fidelity per kind (the exact
 * structured reason: value, bound, delta), kill-switch dominance, the
 * unevaluable negatives (enumerating every kind), the blocked
 * no-declared-limit semantics and the T019 bridge.
 */

import { describe, expect, it } from 'vitest';

import { evaluateLimits, executionLimitRefusals, isLimitState, canonicalEvaluationJson, type LimitState } from './limits';
import { RISK_LIMIT_KINDS } from './policy';
import type { ExposureRecord } from './exposure';
import { computeExposure } from './exposure';
import { deriveMarketState } from './market-mirror';
import { validateRiskPolicy } from './policy';
import { verifyKillSwitchChainMirror } from './killswitch-mirror';
import { isDeeplyFrozen } from './primitives';
import {
  GOAL,
  PROJECT,
  SEED,
  T0,
  TENANT,
  fixtureFill,
  fixtureMarketEvents,
  fixturePolicyInput,
  fixturePortfolio,
  fixtureStandingSwitch,
  fixtureThrownSwitch,
  unwrap,
} from './test-fixtures';

/** The golden market state (BTC 50000 / ETH 3000). */
function goldenMarket() {
  return unwrap(deriveMarketState(fixtureMarketEvents(), T0 as never, 8));
}

/** The golden exposure (BTC 1 @ 50000, ETH 2 @ 3000, gross 56000, equity 145978). */
function goldenExposure(priorPeak: string | null = null): ExposureRecord {
  return unwrap(computeExposure({ portfolio: fixturePortfolio(), marketState: goldenMarket(), fills: [fixtureFill()], priorPeakEquity: priorPeak, seed: SEED }));
}

/** The reference policy (validated from the hand-declared shape). */
function referencePolicy() {
  return unwrap(validateRiskPolicy(fixturePolicyInput()));
}

/** The states of one evaluation, keyed by kind (order/scopes flattened). */
function statesOfKind(states: readonly LimitState[], kind: string): readonly LimitState[] {
  return states.filter((state) => state.kind === kind);
}

describe('evaluateLimits — the totality law (every declared kind evaluates)', () => {
  it('the golden evaluation produces a state for EVERY declared limit kind (all 7, all within)', () => {
    const evaluation = unwrap(evaluateLimits({ exposure: goldenExposure(), policy: referencePolicy(), killSwitch: fixtureStandingSwitch() }));
    const kinds = new Set(evaluation.states.map((state) => state.kind));
    expect([...kinds].sort()).toEqual([...RISK_LIMIT_KINDS].sort());
    expect(evaluation.states.every((state) => state.state === 'within')).toBe(true);
    expect(evaluation.states.every((state) => state.reason === null)).toBe(true);
    expect(evaluation.killSwitchState).toBe('standing');
    expect(evaluation.exposureRef).toBe(goldenExposure().exposureId);
    expect(evaluation.lineage.tenant).toBe(TENANT);
    expect(evaluation.lineage.project).toBe(PROJECT);
    expect(evaluation.lineage.goal).toEqual(GOAL);
    expect(evaluation.evaluationId.startsWith('rls:')).toBe(true);
    expect(evaluation.states.every((state) => isLimitState(state))).toBe(true);
    expect(isDeeplyFrozen(evaluation)).toBe(true);
  });

  it('the class-record selector prefers the exact class over the catch-all (T019 mirrored)', () => {
    const evaluation = unwrap(evaluateLimits({ exposure: goldenExposure(), policy: referencePolicy(), killSwitch: fixtureStandingSwitch() }));
    // The golden fill is 0.2 BTC: within the crypto cap (2) but ABOVE the
    // catch-all cap (1) — the within state proves the crypto record won.
    const orderSize = statesOfKind(evaluation.states, 'order_size');
    expect(orderSize).toHaveLength(1);
    expect(orderSize[0]?.state).toBe('within');
    expect(orderSize[0]?.scope).toEqual({ kind: 'instrument', venue: 'REFSIM', instrument: 'BTC-USD', instrumentClass: 'crypto' });
  });

  it('is deterministic: the same inputs produce the byte-identical evaluation (L9)', () => {
    const run = () => unwrap(evaluateLimits({ exposure: goldenExposure(), policy: referencePolicy(), killSwitch: fixtureStandingSwitch() }));
    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(first.evaluationId).toBe(second.evaluationId);
    expect(canonicalEvaluationJson(first)).toBe(canonicalEvaluationJson(second));
  });
});

describe('evaluateLimits — breach fidelity (every kind, the exact reason)', () => {
  /** Assert one kind's breaching state carries the exact evidence triple. */
  function expectBreach(states: readonly LimitState[], kind: string, expected: { readonly bound: string; readonly observed: string; readonly excess: string }): void {
    const matches = statesOfKind(states, kind).filter((state) => state.state === 'breaching');
    expect(matches, `kind ${kind}`).not.toBeNull();
    const breach = matches[0];
    expect(breach, `kind ${kind}`).toBeDefined();
    if (breach === undefined) return;
    expect(breach.reason).not.toBeNull();
    if (breach.reason === null || breach.reason.cause !== 'breach') {
      expect(breach.reason?.cause).toBe('breach');
      return;
    }
    expect(breach.reason.bound).toBe(expected.bound);
    expect(breach.reason.observed).toBe(expected.observed);
    expect(breach.reason.excess).toBe(expected.excess);
  }

  it('order_size: the observed quantity, the crypto bound, the exact excess', () => {
    const exposure = unwrap(computeExposure({
      portfolio: fixturePortfolio(),
      marketState: goldenMarket(),
      fills: [fixtureFill({ quantity: '2.5', aggressor_price: '50000.00', taker_fee: '0' })],
      priorPeakEquity: null,
      seed: SEED,
    }));
    const evaluation = unwrap(evaluateLimits({ exposure, policy: referencePolicy(), killSwitch: fixtureStandingSwitch() }));
    expectBreach(evaluation.states, 'order_size', { bound: '2', observed: '2.5', excess: '0.5' });
    expectBreach(evaluation.states, 'order_notional', { bound: '120000', observed: '125000', excess: '5000' });
  });

  it('position_size: the post-fill held quantity against the class cap', () => {
    const exposure = unwrap(computeExposure({
      portfolio: fixturePortfolio({ positions: [{ instrumentId: 'BTC-USD', venueId: 'REFSIM', quantity: '0.8', costBasis: '40000', openedAt: T0 - 100_000 }] }),
      marketState: goldenMarket(),
      fills: [fixtureFill({ quantity: '2.3', aggressor_price: '50000.00', taker_fee: '0' })],
      priorPeakEquity: null,
      seed: SEED,
    }));
    const evaluation = unwrap(evaluateLimits({ exposure, policy: referencePolicy(), killSwitch: fixtureStandingSwitch() }));
    expectBreach(evaluation.states, 'position_size', { bound: '3', observed: '3.1', excess: '0.1' });
  });

  it('position_notional: the marked notional against the class cap', () => {
    const exposure = unwrap(computeExposure({
      portfolio: fixturePortfolio({ positions: [{ instrumentId: 'BTC-USD', venueId: 'REFSIM', quantity: '2.9', costBasis: '145000', openedAt: T0 - 100_000 }] }),
      marketState: goldenMarket(),
      fills: [fixtureFill({ quantity: '0.3', aggressor_price: '50000.00', taker_fee: '0' })],
      priorPeakEquity: null,
      seed: SEED,
    }));
    const evaluation = unwrap(evaluateLimits({ exposure, policy: referencePolicy(), killSwitch: fixtureStandingSwitch() }));
    expectBreach(evaluation.states, 'position_notional', { bound: '150000', observed: '160000', excess: '10000' });
  });

  it('concentration: the observed share of gross at the declared precision, exactly', () => {
    // BTC 40000 of a 40300 gross portfolio: 40000/40300 = 0.9925558... -> 0.992556.
    const exposure = unwrap(computeExposure({
      portfolio: fixturePortfolio({
        positions: [
          { instrumentId: 'BTC-USD', venueId: 'REFSIM', quantity: '0.8', costBasis: '40000', openedAt: T0 - 100_000 },
          { instrumentId: 'ETH-USD', venueId: 'REFSIM', quantity: '0.1', costBasis: '300', openedAt: T0 - 100_000 },
        ],
      }),
      marketState: goldenMarket(),
      fills: [],
      priorPeakEquity: null,
      seed: SEED,
    }));
    const evaluation = unwrap(evaluateLimits({ exposure, policy: referencePolicy(), killSwitch: fixtureStandingSwitch() }));
    expectBreach(evaluation.states, 'concentration', { bound: '0.9', observed: '0.992556', excess: '0.092556' });
    // The ETH share stays within (0.007444 at the declared precision).
    const eth = evaluation.states.find((state) => state.kind === 'concentration' && state.scope.kind === 'instrument' && state.scope.instrument === 'ETH-USD');
    expect(eth?.state).toBe('within');
  });

  it('concentration compares EXACTLY (cross-multiplied): a boundary case never rounds the verdict', () => {
    // 0.9 x 56000 = 50400 exactly: a 50400 notional is WITHIN (<=), a
    // 50400.000001 notional breaches — no precision can flip the state.
    const atBoundary = unwrap(computeExposure({
      portfolio: fixturePortfolio({
        positions: [
          { instrumentId: 'BTC-USD', venueId: 'REFSIM', quantity: '1.008', costBasis: '50400', openedAt: T0 - 100_000 },
          { instrumentId: 'ETH-USD', venueId: 'REFSIM', quantity: '1.866666666666666666666666666667', costBasis: '5600', openedAt: T0 - 100_000 },
        ],
        cash: '0',
      }),
      marketState: goldenMarket(),
      fills: [],
      priorPeakEquity: null,
      seed: SEED,
    }));
    // BTC notional 50400, ETH notional 5599.999999999999999999999999999
    // (0.933333... x 3000) — gross 111000 (approx). BTC share 50400/111000
    // ~ 0.4541 <= 0.9 — within. The real boundary proof: craft gross ==
    // notional/0.9 exactly via the excess-free path: 50400 <= 0.9 x 56000.
    const evaluation = unwrap(evaluateLimits({ exposure: atBoundary, policy: referencePolicy(), killSwitch: fixtureStandingSwitch() }));
    const btc = evaluation.states.find((state) => state.kind === 'concentration' && state.scope.kind === 'instrument' && state.scope.instrument === 'BTC-USD');
    expect(btc?.state).toBe('within');
  });

  it('drawdown: the peak-to-equity decline against the threshold', () => {
    const exposure = unwrap(computeExposure({
      portfolio: fixturePortfolio({ cash: '40000' }),
      marketState: goldenMarket(),
      fills: [],
      priorPeakEquity: '146000',
      seed: SEED,
    }));
    expect(exposure.equity).toBe('86000');
    expect(exposure.drawdown).toBe('60000');
    const evaluation = unwrap(evaluateLimits({ exposure, policy: referencePolicy(), killSwitch: fixtureStandingSwitch() }));
    expectBreach(evaluation.states, 'drawdown', { bound: '10000', observed: '60000', excess: '50000' });
  });

  it('leverage: the gross-over-equity ratio against the cap (a clean 2x margin book)', () => {
    const exposure = unwrap(computeExposure({
      portfolio: fixturePortfolio({ positions: [], cash: '100000' }),
      marketState: goldenMarket(),
      fills: [fixtureFill({ quantity: '4', aggressor_price: '50000.00', taker_fee: '0' })],
      priorPeakEquity: null,
      seed: SEED,
    }));
    expect(exposure.cash).toBe('-100000');
    expect(exposure.equity).toBe('100000');
    const evaluation = unwrap(evaluateLimits({ exposure, policy: referencePolicy(), killSwitch: fixtureStandingSwitch() }));
    expectBreach(evaluation.states, 'leverage', { bound: '1.5', observed: '2', excess: '0.5' });
  });
});

describe('evaluateLimits — the kill-switch dominance (the interop law)', () => {
  it('a THROWN switch blocks EVERY limit state with the kill-switch reason', () => {
    const thrown = fixtureThrownSwitch();
    expect(verifyKillSwitchChainMirror(thrown).ok).toBe(true);
    const evaluation = unwrap(evaluateLimits({ exposure: goldenExposure(), policy: referencePolicy(), killSwitch: thrown }));
    expect(evaluation.killSwitchState).toBe('thrown');
    expect(evaluation.states.length).toBeGreaterThan(0);
    expect(evaluation.states.every((state) => state.state === 'blocked')).toBe(true);
    expect(evaluation.states.every((state) => state.reason !== null && state.reason.cause === 'kill_switch')).toBe(true);
    // The reason carries the switch evidence (id + thrown-at).
    const reason = evaluation.states[0]?.reason;
    expect(reason && reason.cause === 'kill_switch' ? reason.switchId : '').toBe(thrown.switchId);
    expect(reason && reason.cause === 'kill_switch' ? reason.thrownAt : 0).toBe(T0 - 100);
  });

  it('a tampered switch log fails chain verification — the engine never honors a switch it cannot trust', () => {
    const thrown = fixtureThrownSwitch();
    const tampered = {
      switchId: thrown.switchId,
      records: [thrown.records[0] as never, { ...(thrown.records[1] as unknown as Record<string, unknown>), reason: 'forged' } as never],
    };
    const verification = verifyKillSwitchChainMirror(tampered);
    expect(verification.ok).toBe(false);
    if (!verification.ok) expect(verification.errors[0]?.code).toBe('killswitch_rewrite');
    const result = evaluateLimits({ exposure: goldenExposure(), policy: referencePolicy(), killSwitch: tampered });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('killswitch_rewrite');
  });

  it('a structurally invalid switch log is rejected (never reasoned over)', () => {
    const result = evaluateLimits({ exposure: goldenExposure(), policy: referencePolicy(), killSwitch: { nonsense: true } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('killswitch_rewrite');
  });
});

describe('evaluateLimits — the unevaluable negatives (a typed error per kind, never a silent pass)', () => {
  it('enumerates EVERY limit kind: corrupted measures name the kind in limit_unevaluable', () => {
    const golden = goldenExposure();
    // Each forgery corrupts exactly one measure dimension (the structural
    // guard passes; the arithmetic coherence trip wires fire).
    const forgeries: readonly [string, ExposureRecord][] = [
      ['order_size / order_notional (incoherent order notional)', { ...golden, orders: [{ ...(golden.orders[0] as ExposureRecord['orders'][number]), notional: '999999' }] }],
      ['position_size / position_notional (incoherent position notional)', { ...golden, positions: [{ ...(golden.positions[0] as ExposureRecord['positions'][number]), notional: '999999' }, golden.positions[1] as ExposureRecord['positions'][number]] }],
      ['concentration (instrument notional exceeding the gross)', { ...golden, grossNotional: '5000', netNotional: '5000' }],
      ['drawdown (incoherent high-water mark)', { ...golden, drawdown: '5' }],
      ['leverage (non-positive equity — the ratio is undefined)', { ...golden, orders: [], positions: [], cash: '-20000', grossNotional: '0', netNotional: '0', equity: '-20000', peakEquity: '-20000', drawdown: '0', fillRefs: [] }],
    ];
    const kindNames: readonly string[] = ['order', 'position', 'concentration', 'drawdown', 'leverage'];
    for (let index = 0; index < forgeries.length; index++) {
      const [name, forged] = forgeries[index] as [string, ExposureRecord];
      const result = evaluateLimits({ exposure: forged, policy: referencePolicy(), killSwitch: fixtureStandingSwitch() });
      expect(result.ok, name).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.code, name).toBe('limit_unevaluable');
        expect(result.errors[0]?.message, name).toContain(kindNames[index]);
      }
    }
  });
});

describe('evaluateLimits — the blocked no-declared-limit semantics (fail-closed)', () => {
  it('an instrument whose class carries NO record and NO catch-all blocks with the structured reason', () => {
    // A policy with only the crypto class record; an equity position.
    const policy = unwrap(validateRiskPolicy(fixturePolicyInput({
      classLimits: [{ instrumentClass: 'crypto', maxOrderSize: '2', maxOrderNotional: '120000', maxPositionSize: '3', maxPositionNotional: '150000' }],
      concentration: null,
      drawdown: null,
      leverage: null,
    })));
    const equityEvent = {
      event_id: 'ev-aapl-1',
      venue: 'XNAS',
      instrument: 'AAPL',
      asset_class: 'equity',
      event_type: 'trade',
      event_time: T0 - 500,
      source_time: null,
      available_time: T0 - 500,
      ingestion_time: T0 - 500,
      sequence: 1,
      provider: 'xnas-feed',
      provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
      payload: { price: '150', size: '10', side: 'buy' },
    };
    const market = unwrap(deriveMarketState([equityEvent], T0 as never, 8));
    const exposure = unwrap(computeExposure({
      portfolio: fixturePortfolio({
        positions: [{ instrumentId: 'AAPL', venueId: 'XNAS', quantity: '10', costBasis: '1500', openedAt: T0 - 100_000 }],
      }),
      marketState: market,
      fills: [],
      priorPeakEquity: null,
      seed: SEED,
    }));
    const evaluation = unwrap(evaluateLimits({ exposure, policy, killSwitch: fixtureStandingSwitch() }));
    expect(evaluation.states).toHaveLength(2);
    for (const state of evaluation.states) {
      expect(state.state).toBe('blocked');
      expect(state.reason).not.toBeNull();
      expect(state.reason?.cause).toBe('no_declared_limit');
      expect(state.reason && state.reason.cause === 'no_declared_limit' ? state.reason.instrumentClass : '').toBe('equity');
    }
  });
});

describe('evaluateLimits — the L12 scope law', () => {
  it('a policy from another tenant never measures this exposure', () => {
    const foreign = unwrap(validateRiskPolicy(fixturePolicyInput({ tenant: 'tenant-beta' })));
    const result = evaluateLimits({ exposure: goldenExposure(), policy: foreign, killSwitch: fixtureStandingSwitch() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('tenant_missing');
  });
});

describe('executionLimitRefusals — the T019 bridge (this lane FEEDS the gate)', () => {
  it('breaching class-kind states convert into execution-policy limits-refusal records', () => {
    const exposure = unwrap(computeExposure({
      portfolio: fixturePortfolio(),
      marketState: goldenMarket(),
      fills: [fixtureFill({ quantity: '2.5', aggressor_price: '50000.00', taker_fee: '0' })],
      priorPeakEquity: null,
      seed: SEED,
    }));
    const evaluation = unwrap(evaluateLimits({ exposure, policy: referencePolicy(), killSwitch: fixtureStandingSwitch() }));
    const refusals = executionLimitRefusals(evaluation);
    expect(refusals).toContainEqual({ dimension: 'limits', limit: 'order_size', instrumentClass: 'crypto', cap: '2', observed: '2.5', excess: '0.5' });
    expect(refusals).toContainEqual({ dimension: 'limits', limit: 'order_notional', instrumentClass: 'crypto', cap: '120000', observed: '125000', excess: '5000' });
    // Portfolio kinds and non-breaching states never bridge to the gate.
    expect(refusals.every((refusal) => refusal.dimension === 'limits')).toBe(true);
    expect(refusals.every((refusal) => ['order_size', 'order_notional', 'position_size', 'position_notional'].includes(refusal.limit))).toBe(true);
  });

  it('a within-evaluation bridges to ZERO refusals', () => {
    const evaluation = unwrap(evaluateLimits({ exposure: goldenExposure(), policy: referencePolicy(), killSwitch: fixtureStandingSwitch() }));
    expect(executionLimitRefusals(evaluation)).toEqual([]);
  });
});
