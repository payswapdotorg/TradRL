/**
 * @tradrl/execution_sim (service) — the scripted fixtures: the intent
 * batches (from trading-strategy mirrors), the venue states and the
 * refusal-path variants.
 *
 * THE SIX REFUSAL PATHS (the Work Order: "fixtures that trip EACH
 * check dimension in order (identity fail, authorization fail, limit
 * fail, venue fail, rate fail, kill-switch fail — six refusal paths,
 * each asserting first-failure-wins and the structured reason)"):
 * every variant below trips EXACTLY ONE dimension of the reference
 * policy — the sibling dimensions stay compliant, so the simulator's
 * refusal provably names the tripped check at its declared position.
 *
 * The APPROVE batch (the golden scenario) drives three intents
 * through the scripted venue: a crossing limit buy on BTC (partial
 * fill over two levels), a market sell on BTC (the position reduces),
 * and a limit buy on ETH (full fill) — producing the golden decision
 * + fill sequence.
 */

import {
  type ExecutionVenueState,
  type StrategyIntentMirror,
  type PortfolioStateMirror,
} from '../../../packages/execution-policy/src/index';
import {
  REFERENCE_BTC,
  REFERENCE_ETH,
  REFERENCE_PRINCIPAL,
  REFERENCE_PROJECT,
  REFERENCE_T0,
  REFERENCE_TENANT,
  REFERENCE_VENUE,
} from './reference-policy';

/** The fixture ISO instant of REFERENCE_T0. */
const ISO_T0 = '2023-11-14T22:13:20.000Z';

/** Build one reference-scoped strategy intent (the trading-strategy mirror). */
function intent(
  sequence: number,
  order: {
    readonly clientOrderId: string;
    readonly instrumentId: string;
    readonly side: 'buy' | 'sell';
    readonly kind: string;
    readonly quantity: string;
    readonly price?: string;
    readonly stopPrice?: string;
  },
  overrides: Record<string, unknown> = {},
): StrategyIntentMirror {
  const base = {
    intentId: `si:t019fx${String(sequence).padStart(4, '0')}`,
    sequence,
    order: {
      clientOrderId: order.clientOrderId,
      instrumentId: order.instrumentId,
      venueId: REFERENCE_VENUE,
      side: order.side,
      kind: order.kind,
      quantity: order.quantity,
      ...(order.price !== undefined ? { price: order.price } : {}),
      ...(order.stopPrice !== undefined ? { stopPrice: order.stopPrice } : {}),
      timeInForce: 'gtc',
      createdAt: ISO_T0,
    },
    constraintProof: {
      constraintSet: { id: 'cs-reference-1', version: 1 },
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
    goal: { goalId: 'goal-reference-1', version: 1 },
    strategy: { specId: REFERENCE_PRINCIPAL, version: 1 },
    windowRefs: ['win-reference-1'],
    seed: 't019-reference-seed',
    tenant: REFERENCE_TENANT,
    project: REFERENCE_PROJECT,
    riskPolicyRefs: ['risk-policy:reference-core@1'],
    rationale: {
      kind: sequence === 1 ? 'initial_allocation' : 'rebalance_drift',
      instrumentId: order.instrumentId,
      targetWeight: '0.5',
      currentWeight: '0.25',
      drift: '0.25',
    },
    asOf: REFERENCE_T0,
  } as unknown as StrategyIntentMirror;
  return { ...base, ...overrides } as unknown as StrategyIntentMirror;
}

// ---------------------------------------------------------------------------
// The approve batch (the golden scenario: three compliant intents)
// ---------------------------------------------------------------------------

/**
 * The APPROVE batch: (1) a crossing limit buy of 0.75 BTC at 50100
 * (walks two ask levels -> fills 0.5 + 0.25), (2) a market sell of
 * 0.2 BTC (reduces the position), (3) a crossing limit buy of 0.8
 * ETH at 3050 (full fill at the best level — 0.8 stays under the
 * crypto maxOrderSize of 1).
 */
export function referenceApproveBatch(): readonly StrategyIntentMirror[] {
  return [
    intent(1, { clientOrderId: 't019-batch-1', instrumentId: REFERENCE_BTC, side: 'buy', kind: 'limit', quantity: '0.75', price: '50100.00' }),
    intent(2, { clientOrderId: 't019-batch-2', instrumentId: REFERENCE_BTC, side: 'sell', kind: 'market', quantity: '0.2' }),
    intent(3, { clientOrderId: 't019-batch-3', instrumentId: REFERENCE_ETH, side: 'buy', kind: 'limit', quantity: '0.8', price: '3050.00' }),
  ];
}

// ---------------------------------------------------------------------------
// The six refusal-path fixtures (each trips EXACTLY one dimension)
// ---------------------------------------------------------------------------

/** PATH 1 — identity fail: the intent comes from an undeclared principal. */
export function referenceIdentityFailIntent(): StrategyIntentMirror {
  return intent(
    1,
    { clientOrderId: 't019-identity-fail', instrumentId: REFERENCE_BTC, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' },
    { strategy: { specId: 'spec-intruder', version: 1 } },
  );
}

/** PATH 2 — authorization fail: a stop order (no grant permits stop kinds). */
export function referenceAuthorizationFailIntent(): StrategyIntentMirror {
  return intent(2, { clientOrderId: 't019-auth-fail', instrumentId: REFERENCE_BTC, side: 'sell', kind: 'stop', quantity: '0.5', stopPrice: '48000.00' });
}

/** PATH 3 — limits fail: a 1.5 BTC order breaches the crypto maxOrderSize of 1. */
export function referenceLimitFailIntent(): StrategyIntentMirror {
  return intent(3, { clientOrderId: 't019-limit-fail', instrumentId: REFERENCE_BTC, side: 'buy', kind: 'limit', quantity: '1.5', price: '50100.00' });
}

/** PATH 4 — venue permissions fail: SOL-USD is covered by the venue state but not allowlisted. */
export function referenceVenueFailIntent(): StrategyIntentMirror {
  return intent(4, { clientOrderId: 't019-venue-fail', instrumentId: 'SOL-USD', side: 'buy', kind: 'limit', quantity: '0.5', price: '101.00' });
}

/** PATH 5 — rate limits fail: the venue's rate window is already at the budget. */
export function referenceRateFailIntent(): StrategyIntentMirror {
  return intent(5, { clientOrderId: 't019-rate-fail', instrumentId: REFERENCE_BTC, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' });
}

/** PATH 6 — kill-switch fail: a compliant intent evaluated against a THROWN switch. */
export function referenceKillSwitchFailIntent(): StrategyIntentMirror {
  return intent(6, { clientOrderId: 't019-killswitch-fail', instrumentId: REFERENCE_BTC, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' });
}

/** PATH 7 (beyond the required six) — credentials fail: the venue has no credential binding. */
export function referenceCredentialFailIntent(): StrategyIntentMirror {
  return intent(7, { clientOrderId: 't019-credential-fail', instrumentId: REFERENCE_BTC, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' });
}

// ---------------------------------------------------------------------------
// The venue states
// ---------------------------------------------------------------------------

/**
 * The reference venue state: BTC marked at 50000 (rate counter 0),
 * ETH at 3000 (rate counter 0), SOL at 100 (rate counter 0) — SOL is
 * deliberately covered by the venue state while NOT allowlisted (the
 * venue-permission fixture's substrate).
 */
export function referenceVenueState(rateWindowOrderCount = 0): ExecutionVenueState {
  return {
    asOf: REFERENCE_T0 as never,
    instruments: [
      { venue: REFERENCE_VENUE, instrument: REFERENCE_BTC, instrumentClass: 'crypto', referencePrice: '50000.00', rateWindowOrderCount },
      { venue: REFERENCE_VENUE, instrument: REFERENCE_ETH, instrumentClass: 'crypto', referencePrice: '3000.00', rateWindowOrderCount },
      { venue: REFERENCE_VENUE, instrument: 'SOL-USD', instrumentClass: 'crypto', referencePrice: '100.00', rateWindowOrderCount },
    ],
  } as unknown as ExecutionVenueState;
}

/**
 * The reference seed books (the scripted venue's visible liquidity):
 * BTC asks 50000.00 x 0.5 and 50050.00 x 1.0 (the crossing limit buy
 * walks both); ETH asks 3000.00 x 2.0.
 */
export function referenceBtcBook(): { readonly bids: readonly { readonly price: string; readonly size: string }[]; readonly asks: readonly { readonly price: string; readonly size: string }[] } {
  return {
    bids: [
      { price: '49950.00', size: '0.8' },
      { price: '49900.00', size: '1.2' },
    ],
    asks: [
      { price: '50000.00', size: '0.5' },
      { price: '50050.00', size: '1.0' },
    ],
  };
}

export function referenceEthBook(): { readonly bids: readonly { readonly price: string; readonly size: string }[]; readonly asks: readonly { readonly price: string; readonly size: string }[] } {
  return {
    bids: [{ price: '2990.00', size: '3.0' }],
    asks: [{ price: '3000.00', size: '2.0' }],
  };
}

/** A portfolio holding 0.3 BTC (the position-size fixture's substrate, when needed). */
export function referenceBtcHoldingPortfolio(): PortfolioStateMirror {
  return {
    stateId: 'ps:t019holding',
    positions: [
      { instrumentId: REFERENCE_BTC, venueId: REFERENCE_VENUE, quantity: '0.3', costBasis: '15000', openedAt: (REFERENCE_T0 - 4_000) as never },
    ],
    weights: [],
    cash: '100000',
    realizedPnl: '0',
    unrealizedPnl: '0',
    asOf: (REFERENCE_T0 - 4_000) as never,
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
