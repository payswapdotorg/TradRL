/**
 * Behavioral tests for the portfolio state: the pure transition (exact
 * decimals, the unsigned domain law, the L4 mark discipline), the
 * content-addressed identity, the genesis constructor, and the
 * append-only chain-verified transition log.
 */

import { describe, expect, it } from 'vitest';

import {
  add,
  applyPortfolioEvents,
  appendTransition,
  divideRoundHalfUp,
  initialPortfolioState,
  isPortfolioState,
  isPortfolioTransitionLog,
  multiply,
  startTransitionLog,
  subtract,
  validatePortfolioState,
  verifyTransitionChain,
  type AccountFill,
  type CorporateAction,
  type MarketEventMirror,
  type ObservationWindow,
  type PortfolioState,
  type StrategyLineage,
} from './index';

const T0 = 1_700_000_000_000;
const BTC = 'BTC-USD' as never;
const ETH = 'ETH-USD' as never;
const VENUE = 'SIM' as never;

function lineage(): StrategyLineage {
  return {
    strategy: { specId: 'spec-1', version: 1 },
    goal: { goalId: 'goal-1', version: 1 },
    constraintSet: { id: 'cs-1', version: 1 },
    windowId: 'win-1',
    seed: 'seed-1',
    tenant: 'tenant-alpha',
    project: 'project-one',
  } as unknown as StrategyLineage;
}

function window(events: readonly { readonly instrument: string; readonly price: string; readonly time: number; readonly sequence: number }[], asOf = T0): ObservationWindow {
  const mirrors: MarketEventMirror[] = events.map((event) => ({
    event_id: `evt-${event.sequence}`,
    venue: VENUE,
    instrument: event.instrument as never,
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: event.time as never,
    source_time: null,
    available_time: event.time as never,
    ingestion_time: event.time as never,
    sequence: event.sequence,
    provider: 'sim',
    provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
    payload: { price: event.price, size: '1', side: 'buy', trade_id: `t-${event.sequence}` },
  }));
  return {
    window_id: `win-${asOf}`,
    events: mirrors,
    asOf: asOf as never,
    starts_at: (T0 - 1000) as never,
    ends_at: (asOf + 1) as never,
  };
}

function fill(id: string, instrument: string, side: 'buy' | 'sell', price: string, quantity: string, fee: string, time: number): AccountFill {
  return {
    fill_id: id,
    instrument: instrument as never,
    venue: VENUE,
    side,
    price,
    quantity,
    fee,
    event_time: time as never,
  };
}

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// Exact decimal arithmetic (acceptance 8)
// ---------------------------------------------------------------------------

describe('exact decimal arithmetic (exchange-sim decimals law)', () => {
  it('0.1 + 0.2 is exactly 0.3 — no float drift anywhere', () => {
    expect(add('0.1', '0.2')).toBe('0.3');
    expect(subtract('0.3', '0.1')).toBe('0.2');
    expect(multiply('0.1', '0.3')).toBe('0.03');
  });

  it('weight/quantity computations assert exact decimal products', () => {
    // 0.14 BTC at 50000.17: the exact product, byte-stable.
    expect(multiply('0.14', '50000.17')).toBe('7000.0238');
    // The one divided site: half-up at a declared precision.
    expect(divideRoundHalfUp('1', '3', 8)).toBe('0.33333333');
    expect(divideRoundHalfUp('2', '3', 8)).toBe('0.66666667');
    expect(divideRoundHalfUp('7000.0238', '50000.17', 8)).toBe('0.14');
  });

  it('large-magnitude products stay exact beyond float precision', () => {
    // Verified independently with BigInt: 123456789.12345678 * 987654321.87654321.
    expect(multiply('123456789.12345678', '987654321.87654321')).toBe('121932631342783101.4583142722374638');
  });
});

// ---------------------------------------------------------------------------
// The genesis state
// ---------------------------------------------------------------------------

describe('initialPortfolioState', () => {
  it('derives a content-addressed identity and passes validation', () => {
    const state = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    expect(state.stateId.startsWith('ps:')).toBe(true);
    expect(isPortfolioState(state)).toBe(true);
    expect(unwrap(validatePortfolioState(state)).stateId).toBe(state.stateId);
  });

  it('same genesis inputs -> same id; different cash -> different id', () => {
    const a = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    const b = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    const c = unwrap(initialPortfolioState(lineage(), '20000', T0 as never));
    expect(a.stateId).toBe(b.stateId);
    expect(a.stateId).not.toBe(c.stateId);
  });

  it('a lineage-less genesis fails with lineage_gap', () => {
    const result = initialPortfolioState({} as never, '10000', T0 as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('lineage_gap');
  });
});

// ---------------------------------------------------------------------------
// The pure transition
// ---------------------------------------------------------------------------

describe('applyPortfolioEvents', () => {
  it('a buy opens a position with exact cost basis and reduces cash', () => {
    const initial = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    const result = applyPortfolioEvents(
      initial,
      { fills: [fill('f1', BTC, 'buy', '50000', '0.1', '1', T0)], corporateActions: [] },
      window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }]),
      8,
      T0 as never,
    );
    const { state } = unwrap(result);
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0]?.quantity).toBe('0.1');
    expect(state.positions[0]?.costBasis).toBe('5000'); // 0.1 * 50000, exact
    expect(state.cash).toBe('4999'); // 10000 - 5000 - 1 (fee), exact
    expect(state.weights[0]?.weight).toBe(divideRoundHalfUp('5000', '9999', 8));
    // The input state is untouched (pure transition).
    expect(initial.positions).toHaveLength(0);
    expect(initial.cash).toBe('10000');
  });

  it('a sell realizes PnL exactly (signed) and closes the position', () => {
    let state = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    state = unwrap(applyPortfolioEvents(state, { fills: [fill('f1', BTC, 'buy', '50000', '0.1', '1', T0)], corporateActions: [] }, window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }]), 8, T0 as never)).state;
    state = unwrap(applyPortfolioEvents(state, { fills: [fill('f2', BTC, 'sell', '60000', '0.1', '2', T0)], corporateActions: [] }, window([{ instrument: BTC, price: '60000', time: T0 - 100, sequence: 1 }]), 8, T0 as never)).state;
    expect(state.positions).toHaveLength(0); // fully closed
    // realized = 6000 - 5000 - 2 = 998 (exact, positive)
    expect(state.realizedPnl).toBe('998');
    // cash = 4999 + 6000 - 2 = 10997
    expect(state.cash).toBe('10997');
    expect(state.unrealizedPnl).toBe('0');
  });

  it('a sell at a loss records NEGATIVE realized PnL exactly (a loss is a fact)', () => {
    let state = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    state = unwrap(applyPortfolioEvents(state, { fills: [fill('f1', BTC, 'buy', '50000', '0.1', '1', T0)], corporateActions: [] }, window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }]), 8, T0 as never)).state;
    state = unwrap(applyPortfolioEvents(state, { fills: [fill('f2', BTC, 'sell', '40000', '0.1', '1', T0)], corporateActions: [] }, window([{ instrument: BTC, price: '40000', time: T0 - 100, sequence: 1 }]), 8, T0 as never)).state;
    expect(state.realizedPnl).toBe('-1001'); // 4000 - 5000 - 1
    expect(unwrap(validatePortfolioState(state)).realizedPnl).toBe('-1001');
  });

  it('a PARTIAL sell reduces cost basis by the exact proportional share', () => {
    let state = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    state = unwrap(applyPortfolioEvents(state, { fills: [fill('f1', BTC, 'buy', '50000', '0.1', '1', T0)], corporateActions: [] }, window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }]), 8, T0 as never)).state;
    state = unwrap(applyPortfolioEvents(state, { fills: [fill('f2', BTC, 'sell', '50000', '0.03', '0', T0)], corporateActions: [] }, window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }]), 8, T0 as never)).state;
    // Sold 3/10 of the holding: cost share 1500, proceeds 1500, fee 0.
    expect(state.positions[0]?.quantity).toBe('0.07');
    expect(state.positions[0]?.costBasis).toBe('3500');
    expect(state.realizedPnl).toBe('0');
  });

  it('a cash dividend adds the exact product to cash; a split multiplies quantity exactly', () => {
    let state = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    state = unwrap(applyPortfolioEvents(state, { fills: [fill('f1', BTC, 'buy', '50000', '0.1', '0', T0)], corporateActions: [] }, window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }]), 8, T0 as never)).state;
    const dividend: CorporateAction = { action_id: 'd1', instrument: BTC, kind: 'cash_dividend', cashPerUnit: '12.5', ex_time: T0 as never };
    state = unwrap(applyPortfolioEvents(state, { fills: [], corporateActions: [dividend] }, window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }]), 8, T0 as never)).state;
    expect(state.cash).toBe('5001.25'); // 5000 remaining + 0.1 * 12.5, exact
    const split: CorporateAction = { action_id: 's1', instrument: BTC, kind: 'split', splitRatio: '2', ex_time: T0 as never };
    state = unwrap(applyPortfolioEvents(state, { fills: [], corporateActions: [split] }, window([{ instrument: BTC, price: '25000', time: T0 - 100, sequence: 1 }]), 8, T0 as never)).state;
    expect(state.positions[0]?.quantity).toBe('0.2');
    expect(state.positions[0]?.costBasis).toBe('5000'); // basis preserved
  });

  it('a sell exceeding the holding is the typed negative_result (long-only law)', () => {
    const state = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    const result = applyPortfolioEvents(
      state,
      { fills: [fill('f1', BTC, 'sell', '50000', '0.1', '0', T0)], corporateActions: [] },
      window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }]),
      8,
      T0 as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('negative_result');
  });

  it('a buy beyond cash is the typed negative_result', () => {
    const state = unwrap(initialPortfolioState(lineage(), '100', T0 as never));
    const result = applyPortfolioEvents(
      state,
      { fills: [fill('f1', BTC, 'buy', '50000', '0.1', '0', T0)], corporateActions: [] },
      window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }]),
      8,
      T0 as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('negative_result');
  });

  it('a missing mark over a HELD instrument is the typed observation_gap (fail-closed)', () => {
    const state = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    const bought = unwrap(applyPortfolioEvents(state, { fills: [fill('f1', BTC, 'buy', '50000', '0.1', '0', T0)], corporateActions: [] }, window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }]), 8, T0 as never)).state;
    // Next window: only ETH trades — BTC is unmarked.
    const result = applyPortfolioEvents(
      bought,
      { fills: [], corporateActions: [] },
      window([{ instrument: ETH, price: '3000', time: T0 - 100, sequence: 1 }]),
      8,
      T0 as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('observation_gap');
  });

  it('a window anchor disagreeing with asOf is rejected (L4 point-in-time marks)', () => {
    const state = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    const result = applyPortfolioEvents(
      state,
      { fills: [], corporateActions: [] },
      window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }], T0 - 50),
      8,
      T0 as never,
    );
    expect(result.ok).toBe(false);
  });

  it('the clock is monotonic: asOf before the state asOf is rejected', () => {
    const state = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    const result = applyPortfolioEvents(
      state,
      { fills: [], corporateActions: [] },
      window([{ instrument: BTC, price: '50000', time: T0 - 2000, sequence: 1 }], T0 - 1000),
      8,
      (T0 - 1000) as never,
    );
    expect(result.ok).toBe(false);
  });

  it('emitted states are deeply frozen and validate (tamper detection on the content id)', () => {
    const state = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    const next = unwrap(applyPortfolioEvents(state, { fills: [fill('f1', BTC, 'buy', '50000', '0.1', '0', T0)], corporateActions: [] }, window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }]), 8, T0 as never)).state;
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.positions[0])).toBe(true);
    // Tamper: rebuild with a mutated cash and revalidate — the id no longer matches.
    const tampered = { ...next, cash: '999999' } as PortfolioState;
    const result = validatePortfolioState(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('chain_mismatch');
  });
});

// ---------------------------------------------------------------------------
// The transition log (append-only, chain-verified)
// ---------------------------------------------------------------------------

describe('the transition log', () => {
  function twoStepLog() {
    const initial = unwrap(initialPortfolioState(lineage(), '10000', T0 as never));
    let log = startTransitionLog(initial);
    const first = unwrap(applyPortfolioEvents(initial, { fills: [fill('f1', BTC, 'buy', '50000', '0.1', '0', T0)], corporateActions: [] }, window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }]), 8, T0 as never));
    log = unwrap(appendTransition(log, first.transition));
    const second = unwrap(applyPortfolioEvents(first.state, { fills: [fill('f2', BTC, 'sell', '51000', '0.1', '0', T0)], corporateActions: [] }, window([{ instrument: BTC, price: '51000', time: T0 - 100, sequence: 1 }]), 8, T0 as never));
    log = unwrap(appendTransition(log, second.transition));
    return { log, states: [initial, first.state, second.state] };
  }

  it('appends transitions with contiguous sequences and a growing chain', () => {
    const { log } = twoStepLog();
    expect(isPortfolioTransitionLog(log)).toBe(true);
    expect(log.transitions.map((entry) => entry.sequence)).toEqual([1, 2]);
    expect(log.currentState).toBe(log.transitions[1]?.after);
  });

  it('verifyTransitionChain passes on the honest log and fails on tampered content', () => {
    const { log } = twoStepLog();
    expect(verifyTransitionChain(log).ok).toBe(true);
    // Tamper with a fill price inside the recorded history.
    const firstEntry = log.transitions[0] as { readonly fills: readonly AccountFill[] };
    const tamperedTransition = {
      ...log.transitions[0],
      fills: [{ ...firstEntry.fills[0], price: '1' }],
    };
    const tampered = { ...log, transitions: [tamperedTransition, log.transitions[1]] };
    const result = verifyTransitionChain(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('a gap in the sequence is the typed chain_mismatch (append-only law)', () => {
    const { log, states } = twoStepLog();
    const next = unwrap(applyPortfolioEvents(states[2] as PortfolioState, { fills: [], corporateActions: [] }, window([{ instrument: BTC, price: '51000', time: T0 - 100, sequence: 1 }]), 8, T0 as never));
    const wrongSequence = { ...next.transition, sequence: 9 } as never;
    const result = appendTransition(log, wrongSequence);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('a transition that does not chain onto the current state is rejected', () => {
    const { log, states } = twoStepLog();
    // Replay the FIRST transition again (starts from the initial state).
    const first = unwrap(applyPortfolioEvents(states[0] as PortfolioState, { fills: [fill('f1', BTC, 'buy', '50000', '0.1', '0', T0)], corporateActions: [] }, window([{ instrument: BTC, price: '50000', time: T0 - 100, sequence: 1 }]), 8, T0 as never));
    const result = appendTransition(log, first.transition);
    expect(result.ok).toBe(false);
  });
});
