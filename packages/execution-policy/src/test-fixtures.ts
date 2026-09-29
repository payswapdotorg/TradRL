// @tradrl/execution-policy — shared test fixtures (internal test support;
// NOT exported from the package index — the contract surface stays clean).
//
// The fixtures mirror the discipline of the sibling packages' test
// suites: hand-assembled records that are VALID by construction (the
// unwrap helper fails loudly if a fixture drifts from the contract),
// with override-based variants for the negative paths.

import type { ExecutionPolicy } from './policy';
import { DEFAULT_CHECK_ORDER } from './policy';
import type { KillSwitchLog } from './kill-switch';
import { startKillSwitch } from './kill-switch';
import type { PortfolioStateMirror, StrategyIntentMirror } from './strategy-mirror';
import type { ExecutionVenueState } from './venue-mirror';
import type { ExecutionPolicyResult } from './errors';

/** The fixture clock base (explicit literals — no ambient clock). */
export const T0 = 1_700_000_000_000;

/** The fixture ISO instant of T0. */
export const ISO_T0 = '2023-11-14T22:13:20.000Z';

/** Unwrap a fixture result or fail loudly (fixtures are valid by construction). */
export function unwrap<T>(result: ExecutionPolicyResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// The strategy-intent fixture (THE INPUT RECORD)
// ---------------------------------------------------------------------------

/**
 * A valid limit-buy strategy intent on (REFSIM, BTC-USD). Overrides
 * replace top-level fields (loosely typed — the fixture discipline of
 * the sibling packages: one cast at the boundary, guard-checked by the
 * tests through the real validators).
 */
export function fixtureIntent(overrides: Record<string, unknown> = {}): StrategyIntentMirror {
  const base = {
    intentId: 'si:fixture0001',
    sequence: 1,
    order: {
      clientOrderId: 't019-fx-1',
      instrumentId: 'BTC-USD',
      venueId: 'REFSIM',
      side: 'buy',
      kind: 'limit',
      quantity: '0.5',
      price: '50000.00',
      timeInForce: 'gtc',
      createdAt: ISO_T0,
    },
    constraintProof: {
      constraintSet: { id: 'cs-fixture', version: 1 },
      satisfied: [
        {
          constraintId: 'max-positions',
          domain: 'state',
          subject: 'state.positions',
          severity: 'blocking',
          predicate: { kind: 'limit.max', bound: 5 },
          observed: 0,
        },
      ],
      advisoryViolations: [],
    },
    goal: { goalId: 'goal-fixture', version: 1 },
    strategy: { specId: 'spec-fixture', version: 1 },
    windowRefs: ['win-fixture-1'],
    seed: 't019-seed',
    tenant: 'tenant-alpha',
    project: 'project-one',
    riskPolicyRefs: ['risk-policy:fixture-core@1'],
    rationale: {
      kind: 'initial_allocation',
      instrumentId: 'BTC-USD',
      targetWeight: '0.5',
      currentWeight: '0',
      drift: '0.5',
    },
    asOf: T0,
  } as unknown as StrategyIntentMirror;
  return { ...base, ...overrides } as unknown as StrategyIntentMirror;
}

// ---------------------------------------------------------------------------
// The portfolio-state fixture (the limits check's facts)
// ---------------------------------------------------------------------------

/** A valid empty genesis portfolio state, overridable per test. */
export function fixturePortfolio(overrides: Record<string, unknown> = {}): PortfolioStateMirror {
  const base = {
    stateId: 'ps:fixture000',
    positions: [],
    weights: [],
    cash: '100000',
    realizedPnl: '0',
    unrealizedPnl: '0',
    asOf: T0 - 1_000,
    lineage: {
      strategy: { specId: 'spec-fixture', version: 1 },
      goal: { goalId: 'goal-fixture', version: 1 },
      constraintSet: { id: 'cs-fixture', version: 1 },
      windowId: 'win-fixture-1',
      seed: 't019-seed',
      tenant: 'tenant-alpha',
      project: 'project-one',
    },
  } as unknown as PortfolioStateMirror;
  return { ...base, ...overrides } as unknown as PortfolioStateMirror;
}

// ---------------------------------------------------------------------------
// The venue-state fixture (the rate/limits facts)
// ---------------------------------------------------------------------------

/** A valid venue state covering (REFSIM, BTC-USD) and (REFSIM, ETH-USD), overridable per test. */
export function fixtureVenueState(overrides: Record<string, unknown> = {}): ExecutionVenueState {
  const base = {
    asOf: T0,
    instruments: [
      { venue: 'REFSIM', instrument: 'BTC-USD', instrumentClass: 'crypto', referencePrice: '50000.00', rateWindowOrderCount: 0 },
      { venue: 'REFSIM', instrument: 'ETH-USD', instrumentClass: 'crypto', referencePrice: '3000.00', rateWindowOrderCount: 0 },
    ],
  } as unknown as ExecutionVenueState;
  return { ...base, ...overrides } as unknown as ExecutionVenueState;
}

// ---------------------------------------------------------------------------
// The kill-switch fixture
// ---------------------------------------------------------------------------

/** A standing kill-switch log for the fixture scope. */
export function fixtureKillSwitch(): KillSwitchLog {
  return unwrap(startKillSwitch('tenant-alpha' as never, 'project-one' as never, (T0 - 2_000) as never));
}

// ---------------------------------------------------------------------------
// The execution-policy fixture (the full-featured declaration)
// ---------------------------------------------------------------------------

/** Deep-cloneable policy overrides (loosely typed — the fixture discipline). */
export type PolicyOverrides = Record<string, unknown>;

/**
 * A FULL-FEATURED policy fixture: every check dimension present and
 * populated (the reference shape the service mirrors), overridable per
 * test. The kill-switch binding matches {@link fixtureKillSwitch}'s id.
 */
export function fixturePolicyInput(overrides: PolicyOverrides = {}): Omit<ExecutionPolicy, 'policyId'> {
  const standingSwitch = fixtureKillSwitch();
  const base = {
    version: 1,
    tenant: 'tenant-alpha',
    project: 'project-one',
    identity: { principals: ['spec-fixture'] },
    authorization: [{ scopeRef: 'grant:fixture-execute@1', orderKinds: ['limit', 'market'] }],
    limits: [
      { instrumentClass: 'crypto', maxOrderSize: '1', maxOrderNotional: '60000', maxPositionSize: '2', maxPositionNotional: '110000' },
      { instrumentClass: '*', maxOrderSize: '0.5', maxOrderNotional: '30000', maxPositionSize: '1', maxPositionNotional: '55000' },
    ],
    venuePermissions: [{ venue: 'REFSIM', instrument: 'BTC-USD', instrumentClass: 'crypto' }],
    rateLimits: [{ venue: 'REFSIM', windowMs: 60_000, maxOrders: 10 }],
    credentials: [{ venue: 'REFSIM', credentialRef: 'cred:refsim-main@1' }],
    killSwitch: { switchId: standingSwitch.switchId },
    audit: { emission: 'every_decision' },
    checkOrder: [...DEFAULT_CHECK_ORDER],
    learning: null,
    asOf: T0 - 3_000,
  } as unknown as Omit<ExecutionPolicy, 'policyId'>;
  return { ...base, ...overrides } as unknown as Omit<ExecutionPolicy, 'policyId'>;
}
