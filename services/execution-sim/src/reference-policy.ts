/**
 * @tradrl/execution_sim (service) — the reference declarations: the
 * full-featured execution policy, the simulation spec, the standing
 * kill switch and the venue states.
 *
 * THE REFERENCE POLICY declares EVERY check dimension (the Work
 * Order: "A reference policy: a full-featured declared policy (every
 * check dimension present)"): the standing kill switch binding, the
 * principal allowlist, the authority grants (limit + market kinds),
 * per-class cap records (crypto specific + the '*' catch-all), the
 * (venue, instrument) allowlist, the per-venue rate budget, and the
 * opaque credential bindings — under the canonical check order
 * (kill_switch first).
 *
 * The fixture venue models mirror a two-instrument crypto venue
 * (BTC-USD, ETH-USD on REFSIM) with a tiered fee schedule, uniform
 * latency, book-walk slippage and the declared-absence impact policy
 * — the exchange-sim reference shape.
 */

import {
  DEFAULT_CHECK_ORDER,
  deepFreeze,
  startKillSwitch,
  validateExecutionPolicy,
  validateExecutionSimulationSpec,
  validateVenueModelConfig,
  venueModelDigest,
  type ExecutionPolicy,
  type ExecutionSimulationSpec,
  type KillSwitchLog,
  type PortfolioStateMirror,
  type TimestampMs,
  type VenueModelRef,
} from '../../../packages/execution-policy/src/index';

/** The reference scope (L12/L15). */
export const REFERENCE_TENANT = 'tenant-reference';
export const REFERENCE_PROJECT = 'project-reference';

/** The reference principal: the strategy spec id allowed to act. */
export const REFERENCE_PRINCIPAL = 'spec-reference-eq-drift';

/** The reference venue identities. */
export const REFERENCE_VENUE = 'REFSIM';
export const REFERENCE_BTC = 'BTC-USD';
export const REFERENCE_ETH = 'ETH-USD';

/** The fixture clock base (explicit literals — no ambient clock). */
export const REFERENCE_T0 = 1_700_000_000_000;

/** The standing kill switch of the reference scope (genesis at T0 - 10s). */
export function referenceKillSwitch(): KillSwitchLog {
  const result = startKillSwitch(REFERENCE_TENANT as never, REFERENCE_PROJECT as never, (REFERENCE_T0 - 10_000) as never);
  if (!result.ok) throw new Error(`reference kill switch must start: ${JSON.stringify(result.errors)}`);
  return result.value;
}

/** The BTC-USD venue model (the exchange-sim reference shape). */
export function referenceBtcModel(): VenueModelRef {
  const config = unwrapv(
    validateVenueModelConfig({
      venue: REFERENCE_VENUE,
      instrument: REFERENCE_BTC,
      asset_class: 'crypto',
      tick_size: '0.01',
      lot_size: '0.001',
      max_book_depth: 10,
      seed: 't019-reference-seed',
      fidelity: 'reactive_replay',
      fees: {
        tiers: [
          { up_to_notional: '1000000', maker_bps: '1', taker_bps: '2' },
          { up_to_notional: null, maker_bps: '0.5', taker_bps: '1' },
        ],
        fee_decimals: 8,
      },
      latency: { kind: 'uniform', min_ms: 100, max_ms: 900 },
      slippage: { kind: 'book_walk' },
      impact: {
        kind: 'none',
        declaration: 'no endogenous market impact: the scripted venue matches against the visible book only',
        limitation: 'endogenous market reaction is the reactive-world lane (T027); the simulator composes this declared absence',
      },
    }),
  );
  return deepFreeze({ config, configDigest: venueModelDigest(config), engineRef: 'engine:refsim-btc@1' });
}

/** The ETH-USD venue model (the same physics, a different book). */
export function referenceEthModel(): VenueModelRef {
  const config = unwrapv(
    validateVenueModelConfig({
      venue: REFERENCE_VENUE,
      instrument: REFERENCE_ETH,
      asset_class: 'crypto',
      tick_size: '0.01',
      lot_size: '0.01',
      max_book_depth: 10,
      seed: 't019-reference-seed',
      fidelity: 'reactive_replay',
      fees: {
        tiers: [
          { up_to_notional: '1000000', maker_bps: '1', taker_bps: '2' },
          { up_to_notional: null, maker_bps: '0.5', taker_bps: '1' },
        ],
        fee_decimals: 8,
      },
      latency: { kind: 'uniform', min_ms: 100, max_ms: 900 },
      slippage: { kind: 'book_walk' },
      impact: {
        kind: 'none',
        declaration: 'no endogenous market impact: the scripted venue matches against the visible book only',
        limitation: 'endogenous market reaction is the reactive-world lane (T027); the simulator composes this declared absence',
      },
    }),
  );
  return deepFreeze({ config, configDigest: venueModelDigest(config), engineRef: 'engine:refsim-eth@1' });
}

/**
 * The REFERENCE EXECUTION POLICY — the full-featured declaration
 * (every check dimension present): the standing kill switch, the
 * principal allowlist (the reference strategy), the authority grants
 * (limit + market), the crypto cap records + the '*' catch-all, the
 * two-pair venue allowlist, the per-venue rate budget (10 orders per
 * minute) and the two opaque credential bindings.
 */
export function referenceExecutionPolicy(): ExecutionPolicy {
  const killSwitch = referenceKillSwitch();
  const result = validateExecutionPolicy({
    version: 1,
    tenant: REFERENCE_TENANT,
    project: REFERENCE_PROJECT,
    identity: { principals: [REFERENCE_PRINCIPAL] },
    authorization: [
      { scopeRef: 'grant:reference-execute-limit@1', orderKinds: ['limit'] },
      { scopeRef: 'grant:reference-execute-market@1', orderKinds: ['market'] },
    ],
    limits: [
      { instrumentClass: 'crypto', maxOrderSize: '1', maxOrderNotional: '60000', maxPositionSize: '2', maxPositionNotional: '110000' },
      { instrumentClass: '*', maxOrderSize: '0.5', maxOrderNotional: '30000', maxPositionSize: '1', maxPositionNotional: '55000' },
    ],
    venuePermissions: [
      { venue: REFERENCE_VENUE, instrument: REFERENCE_BTC, instrumentClass: 'crypto' },
      { venue: REFERENCE_VENUE, instrument: REFERENCE_ETH, instrumentClass: 'crypto' },
    ],
    rateLimits: [{ venue: REFERENCE_VENUE, windowMs: 60_000, maxOrders: 10 }],
    credentials: [
      { venue: REFERENCE_VENUE, credentialRef: 'cred:refsim-main@1' },
    ],
    killSwitch: { switchId: killSwitch.switchId },
    audit: { emission: 'every_decision' },
    checkOrder: [...DEFAULT_CHECK_ORDER],
    learning: null,
    asOf: (REFERENCE_T0 - 30_000) as never,
  });
  if (!result.ok) throw new Error(`the reference policy must validate: ${JSON.stringify(result.errors)}`);
  return result.value;
}

/**
 * The REFERENCE SIMULATION SPEC — `simulated_matching` fidelity over
 * the two venue models (the honest declaration: the scripted venue
 * walks the visible book over the exchange-sim physics mirrors).
 */
export function referenceSimulationSpec(): ExecutionSimulationSpec {
  const result = validateExecutionSimulationSpec({
    fidelity: 'simulated_matching',
    venueModels: [referenceBtcModel(), referenceEthModel()],
    seed: 't019-reference-seed',
    tenant: REFERENCE_TENANT,
    project: REFERENCE_PROJECT,
  });
  if (!result.ok) throw new Error(`the reference spec must validate: ${JSON.stringify(result.errors)}`);
  return result.value;
}

/**
 * The reference genesis portfolio: 100000 quote-currency cash, no
 * positions, the reference lineage (the limits check's starting
 * facts).
 */
export function referenceGenesisPortfolio(): PortfolioStateMirror {
  return {
    stateId: 'ps:t019genesis',
    positions: [],
    weights: [],
    cash: '100000',
    realizedPnl: '0',
    unrealizedPnl: '0',
    asOf: (REFERENCE_T0 - 5_000) as never,
    lineage: {
      strategy: { specId: REFERENCE_PRINCIPAL, version: 1 },
      goal: { goalId: 'goal-reference-1', version: 1 },
      constraintSet: { id: 'cs-reference-1', version: 1 },
      windowId: 'win-reference-1',
      seed: 't019-reference-seed',
      tenant: REFERENCE_TENANT,
      project: REFERENCE_PROJECT,
    },
  } as unknown as PortfolioStateMirror;
}

// --- Local helper (the fixture discipline: unwrap-or-throw at the boundary) ---

function unwrapv<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`reference declaration must validate: ${JSON.stringify(result.errors)}`);
}
