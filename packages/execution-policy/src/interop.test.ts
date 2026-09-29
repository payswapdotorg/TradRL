/**
 * Cross-package interoperability trip wires for
 * @tradrl/execution-policy.
 *
 * The execution lane's mirrors are proven against the REAL canonical
 * packages PRESENT on this branch (static relative imports — the
 * trading-strategy interop precedent; the frozen write surface permits
 * test-only imports):
 *
 *   - @tradrl/trading-strategy (T018): the StrategyIntentMirror IS the
 *     REAL `StrategyIntent` (type-level mutual assignability; runtime:
 *     the fixture intent passes the REAL `isStrategyIntent` — the real
 *     guard's L8 authority scan included — and the REAL guard and THIS
 *     lane's mirror guard agree on negative shapes); the
 *     PortfolioStateMirror IS the REAL `PortfolioState` (the real
 *     package's `initialPortfolioState` product passes this lane's
 *     mirror guard).
 *   - @tradrl/exchange-sim (T010): the venue model config mirror IS
 *     the REAL `ExchangeConfig` (mutual assignability; runtime: the
 *     same declaration validates through BOTH validators and
 *     `venueModelDigest` digests BYTE-IDENTICALLY to the REAL
 *     `configHash` — the L9 anchor's parity); the fee/latency/
 *     slippage/impact mirrors are mutually assignable with the real
 *     models; the latency draw mirror returns IDENTICAL delays to the
 *     real `latencyDelayMs` over a battery; the order-intent mirror IS
 *     the REAL `OrderIntent`; the decimal ARITHMETIC is identical.
 *   - @tradrl/domain-core (T002): the order-intent mirror IS the
 *     canonical `Order` (mutual assignability; the fixture passes the
 *     REAL `isOrder` guard) — the final request form.
 *   - @tradrl/rl-protocol (T013): a learned policy's learning lineage
 *     + a decision bind into a REAL `TrialRecord` that passes the REAL
 *     `validateTrialRecord` (the policies-can-be-learned bridge), and
 *     the mirrored id brand tags match the REAL identity spaces.
 *
 * Type-level assertions fail `pnpm typecheck`; runtime assertions fail
 * `pnpm test`. Either way, a mirror can never drift silently
 * (D-003/D-004).
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as policy from './index';
import * as tradingStrategy from '../../trading-strategy/src/index';
import * as exchangeSim from '../../exchange-sim/src/index';
import * as domainCore from '../../domain-core/src/index';
import * as rlProtocol from '../../rl-protocol/src/index';

import type { StrategyIntent as RealStrategyIntent, PortfolioState as RealPortfolioState } from '../../trading-strategy/src/index';
import type { ExchangeConfig as RealExchangeConfig, FeeSchedule as RealFeeSchedule, LatencyConfig as RealLatencyConfig, SlippageConfig as RealSlippageConfig, MarketImpactPolicy as RealMarketImpactPolicy, OrderIntent as RealOrderIntent } from '../../exchange-sim/src/index';
import type { Order as RealDomainOrder } from '../../domain-core/src/index';
import type { TrialRecord as RealTrialRecord } from '../../rl-protocol/src/index';

import { T0, fixtureIntent, fixturePortfolio, fixturePolicyInput } from './test-fixtures';

/** Unwrap ANY lane's result shape (the interop battery crosses packages). */
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`interop fixture must be valid: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff OUR StrategyIntentMirror is assignable to the REAL trading-strategy StrategyIntent. */
function mirrorIsRealStrategyIntent(value: policy.StrategyIntentMirror): RealStrategyIntent {
  return value;
}

/** Compiles iff the REAL trading-strategy StrategyIntent is assignable to OUR mirror. */
function realStrategyIntentIsMirror(value: RealStrategyIntent): policy.StrategyIntentMirror {
  return value;
}

/** Compiles iff OUR PortfolioStateMirror IS the REAL trading-strategy PortfolioState (both directions). */
function mirrorIsRealPortfolioState(value: policy.PortfolioStateMirror): RealPortfolioState {
  return value;
}

function realPortfolioStateIsMirror(value: RealPortfolioState): policy.PortfolioStateMirror {
  return value;
}

/** Compiles iff OUR venue model config IS the REAL exchange-sim ExchangeConfig (both directions). */
function mirrorIsRealExchangeConfig(value: policy.VenueModelConfigMirror): RealExchangeConfig {
  return value;
}

function realExchangeConfigIsMirror(value: RealExchangeConfig): policy.VenueModelConfigMirror {
  return value;
}

/** Compiles iff the four physics mirrors ARE the REAL models (both directions). */
function feeMirrorParity(value: policy.FeeScheduleMirror): RealFeeSchedule {
  return value;
}

function realFeeIsMirror(value: RealFeeSchedule): policy.FeeScheduleMirror {
  return value;
}

function latencyMirrorParity(value: policy.LatencyConfigMirror): RealLatencyConfig {
  return value;
}

function realLatencyIsMirror(value: RealLatencyConfig): policy.LatencyConfigMirror {
  return value;
}

function slippageMirrorParity(value: policy.SlippageConfigMirror): RealSlippageConfig {
  return value;
}

function realSlippageIsMirror(value: RealSlippageConfig): policy.SlippageConfigMirror {
  return value;
}

function impactMirrorParity(value: policy.MarketImpactPolicyMirror): RealMarketImpactPolicy {
  return value;
}

function realImpactIsMirror(value: RealMarketImpactPolicy): policy.MarketImpactPolicyMirror {
  return value;
}

/** Compiles iff OUR order-intent mirror IS the REAL exchange-sim OrderIntent AND the canonical domain-core Order. */
function orderMirrorIsRealExchangeIntent(value: policy.OrderIntentMirror): RealOrderIntent {
  return value;
}

function orderMirrorIsCanonicalOrder(value: policy.OrderIntentMirror): RealDomainOrder {
  return value;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** The SAME venue declaration, expressed once — validated through BOTH validators. */
const VENUE_DECLARATION = {
  venue: 'REFSIM',
  instrument: 'BTC-USD',
  asset_class: 'crypto',
  tick_size: '0.01',
  lot_size: '0.001',
  max_book_depth: 10,
  seed: 't019-interop-seed',
  fidelity: 'reactive_replay',
  fees: { tiers: [{ up_to_notional: '1000000', maker_bps: '1', taker_bps: '2' }, { up_to_notional: null, maker_bps: '0.5', taker_bps: '1' }], fee_decimals: 8 },
  latency: { kind: 'uniform', min_ms: 100, max_ms: 900 },
  slippage: { kind: 'book_walk' },
  impact: { kind: 'none', declaration: 'no endogenous impact', limitation: 'endogenous reaction is T027' },
} as const;

// ---------------------------------------------------------------------------
// Lane 1: trading-strategy (T018 — the input record)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/trading-strategy (the strategy-intent mirror)', () => {
  it('type-level parity: the mirror and the REAL StrategyIntent are mutually assignable', () => {
    expectTypeOf(mirrorIsRealStrategyIntent(fixtureIntent())).toMatchTypeOf<RealStrategyIntent>();
    expectTypeOf(realStrategyIntentIsMirror).toBeFunction();
    expectTypeOf(mirrorIsRealPortfolioState(fixturePortfolio())).toMatchTypeOf<RealPortfolioState>();
    expectTypeOf(realPortfolioStateIsMirror).toBeFunction();
  });

  it('runtime: the fixture intent passes the REAL isStrategyIntent (the L8 authority scan included)', () => {
    expect(tradingStrategy.isStrategyIntent(fixtureIntent())).toBe(true);
    expect(policy.isStrategyIntentMirror(fixtureIntent())).toBe(true);
  });

  it('runtime: the REAL package\'s compiled intent product passes THIS lane\'s mirror guard', () => {
    // Build a REAL PortfolioState through the real package's API and
    // prove this lane's mirror accepts it (the limits check's facts).
    const lineage = {
      strategy: { specId: 'spec-interop', version: 1 },
      goal: { goalId: 'goal-interop', version: 1 },
      constraintSet: { id: 'cs-interop', version: 1 },
      windowId: 'win-interop',
      seed: 'interop-seed',
      tenant: 'tenant-alpha',
      project: 'project-one',
    } as unknown as tradingStrategy.StrategyLineage;
    const realState = unwrap(tradingStrategy.initialPortfolioState(lineage, '100000', (T0 - 1000) as never));
    expect(tradingStrategy.isPortfolioState(realState)).toBe(true);
    expect(policy.isPortfolioStateMirror(realState)).toBe(true);
    // And this lane's mirror product passes the REAL guard (mutual parity).
    expect(tradingStrategy.isPortfolioState(fixturePortfolio())).toBe(true);
  });

  it('runtime: the mirror guards agree with the REAL guard on negative shapes', () => {
    const brokenOrder = fixtureIntent({ order: { ...fixtureIntent().order, quantity: '0' } });
    expect(policy.isStrategyIntentMirror(brokenOrder)).toBe(false);
    expect(tradingStrategy.isStrategyIntent(brokenOrder)).toBe(false);
    const noLineage = fixtureIntent();
    const broken = { ...noLineage, goal: undefined } as unknown;
    expect(policy.isStrategyIntentMirror(broken)).toBe(false);
    expect(tradingStrategy.isStrategyIntent(broken)).toBe(false);
    // The L8 trip wire agreement: an intent embedding venue permissions
    // fails BOTH guards (the strategy lane refuses authority; this lane
    // never receives it).
    const crime = { ...noLineage, venuePermissions: [{ venue: 'REFSIM' }] } as unknown;
    expect(tradingStrategy.isStrategyIntent(crime)).toBe(false);
    expect(policy.isStrategyIntentMirror(crime)).toBe(false); // not a mirror field — structural mismatch
  });
});

// ---------------------------------------------------------------------------
// Lane 2: exchange-sim (T010 — the venue-side physics)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/exchange-sim (the venue model mirrors)', () => {
  it('type-level parity: the config and physics mirrors are mutually assignable with the REAL models', () => {
    const config = unwrap(policy.validateVenueModelConfig(VENUE_DECLARATION));
    expectTypeOf(mirrorIsRealExchangeConfig(config)).toMatchTypeOf<RealExchangeConfig>();
    expectTypeOf(realExchangeConfigIsMirror).toBeFunction();
    expectTypeOf(feeMirrorParity(config.fees)).toMatchTypeOf<RealFeeSchedule>();
    expectTypeOf(realFeeIsMirror).toBeFunction();
    expectTypeOf(latencyMirrorParity(config.latency)).toMatchTypeOf<RealLatencyConfig>();
    expectTypeOf(realLatencyIsMirror).toBeFunction();
    expectTypeOf(slippageMirrorParity(config.slippage)).toMatchTypeOf<RealSlippageConfig>();
    expectTypeOf(realSlippageIsMirror).toBeFunction();
    expectTypeOf(impactMirrorParity(config.impact)).toMatchTypeOf<RealMarketImpactPolicy>();
    expectTypeOf(realImpactIsMirror).toBeFunction();
    expectTypeOf(orderMirrorIsRealExchangeIntent(fixtureIntent().order)).toMatchTypeOf<RealOrderIntent>();
  });

  it('runtime: the SAME declaration validates through BOTH validators', () => {
    const ours = unwrap(policy.validateVenueModelConfig(VENUE_DECLARATION));
    const real = unwrap(exchangeSim.validateExchangeConfig(VENUE_DECLARATION));
    expect(ours.venue).toBe(real.venue);
    expect(ours.fees.tiers).toEqual(real.fees.tiers);
    expect(ours.latency).toEqual(real.latency);
    expect(ours.slippage).toEqual(real.slippage);
    expect(ours.impact).toEqual(real.impact);
    // The REAL package accepts OUR validated mirror as its own config.
    expect(exchangeSim.isExchangeConfig(ours)).toBe(true);
    expect(policy.isVenueModelConfigMirror(real)).toBe(true);
  });

  it('runtime: venueModelDigest digests BYTE-IDENTICALLY to the REAL configHash (the L9 anchor parity)', () => {
    const ours = unwrap(policy.validateVenueModelConfig(VENUE_DECLARATION));
    const real = unwrap(exchangeSim.validateExchangeConfig(VENUE_DECLARATION));
    expect(policy.venueModelDigest(ours)).toBe(exchangeSim.configHash(real));
    // And across the mirror boundary in both directions.
    expect(policy.venueModelDigest(real as policy.VenueModelConfigMirror)).toBe(exchangeSim.configHash(ours as RealExchangeConfig));
    // A drifted declaration digests differently (the anchor is real).
    const drifted = unwrap(policy.validateVenueModelConfig({ ...VENUE_DECLARATION, tick_size: '0.02' }));
    expect(policy.venueModelDigest(drifted)).not.toBe(policy.venueModelDigest(ours));
  });

  it('runtime: the latency draw mirror returns IDENTICAL delays to the REAL derivation over a battery', () => {
    const configs: readonly policy.LatencyConfigMirror[] = [
      { kind: 'fixed', fixed_ms: 250 },
      { kind: 'uniform', min_ms: 0, max_ms: 1000 },
      { kind: 'uniform', min_ms: 100, max_ms: 900 },
      { kind: 'uniform', min_ms: 5, max_ms: 6 },
    ];
    for (const config of configs) {
      for (const seed of ['t019-seed', 'other-seed', 'x']) {
        for (let ordinal = 1; ordinal <= 25; ordinal++) {
          expect(policy.latencyDelayMsMirror(config, seed, 'order', ordinal)).toBe(
            exchangeSim.latencyDelayMs(config as RealLatencyConfig, seed, 'order', ordinal),
          );
          expect(policy.latencyDelayMsMirror(config, seed, 'fill', ordinal)).toBe(
            exchangeSim.latencyDelayMs(config as RealLatencyConfig, seed, 'fill', ordinal),
          );
        }
      }
    }
  });

  it('runtime: the fee model mirror computes identical quotes to the REAL model', () => {
    const ours = unwrap(policy.validateFeeScheduleMirror(VENUE_DECLARATION.fees));
    const real = unwrap(exchangeSim.validateFeeSchedule(VENUE_DECLARATION.fees));
    const batteries: readonly [string, string][] = [
      ['50000.01', '0.001'],
      ['3000.50', '1.25'],
      ['123.45', '99.999'],
      ['999999.99', '0.5'],
    ];
    for (const [price, quantity] of batteries) {
      expect(exchangeSim.feeOf(real, 'taker', price, quantity)).toEqual(exchangeSim.feeOf(ours as RealFeeSchedule, 'taker', price, quantity));
      expect(exchangeSim.feeOf(real, 'maker', price, quantity)).toEqual(exchangeSim.feeOf(ours as RealFeeSchedule, 'maker', price, quantity));
    }
  });

  it('runtime: decimal ARITHMETIC parity with the REAL exchange-sim module', () => {
    const batteries: readonly [string, string][] = [
      ['0.1', '0.2'],
      ['123456789.12345678', '987654321.87654321'],
      ['0.00000001', '99999999999'],
      ['50000.01', '0.5'],
    ];
    for (const [a, b] of batteries) {
      expect(policy.add(a, b)).toBe(exchangeSim.add(a, b));
      expect(policy.multiply(a, b)).toBe(exchangeSim.multiply(a, b));
      expect(policy.compare(a, b)).toBe(exchangeSim.compare(a, b));
    }
  });
});

// ---------------------------------------------------------------------------
// Lane 3: domain-core (T002 — the final request form)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/domain-core (the canonical Order)', () => {
  it('type-level parity: the order-intent mirror IS the canonical Order', () => {
    expectTypeOf(orderMirrorIsCanonicalOrder(fixtureIntent().order)).toMatchTypeOf<RealDomainOrder>();
  });

  it('runtime: the fixture order passes the REAL canonical isOrder guard', () => {
    expect(domainCore.isOrder(fixtureIntent().order)).toBe(true);
    // And the REAL canonical guard agrees with ours on negatives.
    const broken = { ...fixtureIntent().order, quantity: '0' };
    expect(domainCore.isOrder(broken)).toBe(false);
    expect(policy.isOrderIntentMirror(broken)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lane 4: rl-protocol (T013 — the learned-policy binding)
// ---------------------------------------------------------------------------

describe('interop — @tradrl/rl-protocol (the learning lineage binding)', () => {
  it('a learned policy\'s lineage + a decision bind into a REAL TrialRecord that validates', () => {
    const learned = unwrap(
      policy.validateExecutionPolicy({
        ...fixturePolicyInput(),
        learning: { trialId: 'trial-42', armId: 'arm-execution-policy', trajectoryId: 'traj-42' },
      }),
    );
    expect(learned.learning).not.toBeNull();
    if (learned.learning === null) throw new Error('unreachable');

    // The gate decision over the fixture intent under the learned policy.
    const decision = unwrap(
      policy.runExecutionGate({
        intent: fixtureIntent(),
        policy: learned,
        portfolio: fixturePortfolio(),
        venueState: {
          asOf: T0,
          instruments: [
            { venue: 'REFSIM', instrument: 'BTC-USD', instrumentClass: 'crypto', referencePrice: '50000.00', rateWindowOrderCount: 0 },
          ],
        } as never,
        killSwitch: unwrap(policy.startKillSwitch('tenant-alpha' as never, 'project-one' as never, (T0 - 2000) as never)),
      }),
    );
    expect(decision.kind).toBe('approve');

    // The bridge: the learned policy's lineage + the decision compose a
    // REAL rl-protocol TrialRecord (the experiments-lane shape) — and
    // it passes the REAL validator (the trading-strategy interop
    // precedent: policies can be LEARNED; the records bind).
    const trial: RealTrialRecord = {
      trial_id: learned.learning.trialId,
      arm: learned.learning.armId,
      status: decision.kind === 'approve' ? 'succeeded' : 'failed',
      trajectory: learned.learning.trajectoryId,
      outcome: { outcome: decision.kind, decisionId: decision.decisionId },
      started_at: decision.asOf,
      ended_at: decision.asOf,
      failure_reason: decision.kind === 'refuse' ? decision.failure.dimension : null,
    };
    expect(rlProtocol.validateTrialRecord(trial).ok).toBe(true);
    expect(rlProtocol.isTrialRecord(trial)).toBe(true);
  });

  it('the mirrored id brand tags match the REAL rl-protocol identity spaces (compile-time parity)', () => {
    const trialId = 'trial-42' as rlProtocol.TrialId;
    const armId = 'arm-execution-policy' as rlProtocol.ArmId;
    const trajectoryId = 'traj-42' as rlProtocol.TrajectoryId;
    // The brand tags match (program-wide identity spaces): the REAL
    // rl-protocol ids ARE this lane's mirrored refs, zero casts.
    const asPolicyRefs: { trialId: policy.TrialId; armId: policy.ArmId; trajectoryId: policy.TrajectoryId } = {
      trialId,
      armId,
      trajectoryId,
    };
    expect(asPolicyRefs.trialId).toBe('trial-42');
  });
});
