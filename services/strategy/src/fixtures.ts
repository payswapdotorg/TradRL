/**
 * @tradrl/strategy (service) — the scripted fixtures.
 *
 * The fixtures the reference service's tests and golden constants are
 * computed from (byte-stable by construction — every instant, price and
 * quantity is a literal):
 *
 *   - `referenceWindow1/2/3()` — three scripted observation windows over
 *     the three-instrument universe: quotes and trade prints, provenance
 *     `simulated` (a Market World produced them — never real-world
 *     truth, L5/L6), strictly ordered, L4-bounded (every event is
 *     available at the decision instant).
 *   - `referenceScenario()` — the SATISFIED path, engineered to exercise
 *     the whole contract surface (exact-decimal quantities derived
 *     below):
 *       Step 1 — the equal-weight initial allocation over 30000 cash:
 *       three buys (BTC 0.2 @ 50000, ETH 3.33 @ 3000 lot-floored from
 *       3.33333333, SOL 100 @ 100), cash-capped in universe order.
 *       Step 2 — BTC's mark 50000 -> 90000 drives the decision-time BTC
 *       weight to 18000/38000 = 0.47368421 (drift 0.14035088 > band
 *       0.05): a drift SELL of BTC 0.059, a cash-capped BUY of SOL 0.1
 *       (the whole 10 remaining cash), ETH's buy lot-floored to zero
 *       (unaffordable). The declared fills settle the step-1 requests;
 *       a SOL cash dividend exercises the corporate-action path.
 *       Step 3 — the marks settle (BTC 52000, ETH 3050, SOL 102.5):
 *       only BTC is outside the band (0.22175 vs 0.33333333) — one BUY
 *       of BTC 0.07; a SOL 2:1 split exercises the split path.
 *   - `referenceRefusingScenario()` — the REFUSING path: the same
 *     windows under {@link REFERENCE_REFUSING_CONSTRAINT_SET} (the
 *     universe ceiling of two vs the universe's three) with NO declared
 *     fills (nothing was ever emitted to fill): every step's candidates
 *     are refused as IntentRefusal RECORDS naming the violated
 *     predicate, and the portfolio never leaves its genesis shape.
 *
 * Declared fills are INPUTS (the harness assumption that the venue
 * filled the emitted requests — execution simulation is T019's lane).
 */

import {
  type AccountFill,
  type MarketEventMirror,
  type ObservationWindow,
} from '../../../packages/trading-strategy/src/index';
import {
  REFERENCE_CONSTRAINT_SET,
  REFERENCE_GOAL,
  REFERENCE_REFUSING_CONSTRAINT_SET,
  REFERENCE_STRATEGY_SPEC,
  type ScenarioStep,
  type StrategyScenario,
} from './strategist';

const DAY = 86_400_000;
const T1 = 1_700_000_000_000;
const T2 = T1 + DAY;
const T3 = T2 + DAY;

/** A scripted trade print (provenance: simulated — a Market World product). */
function scriptedTrade(eventId: string, instrument: string, price: string, sequence: number, time: number): MarketEventMirror {
  return {
    event_id: eventId,
    venue: 'REFSIM',
    instrument: instrument as never,
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: time as never,
    source_time: null,
    available_time: time as never,
    ingestion_time: time as never,
    sequence,
    provider: 'refsim',
    provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
    payload: { price, size: '2.5', side: 'buy', trade_id: `${eventId}-print` },
  } as never;
}

/** A scripted top-of-book quote. */
function scriptedQuote(eventId: string, instrument: string, bid: string, ask: string, sequence: number, time: number): MarketEventMirror {
  return {
    event_id: eventId,
    venue: 'REFSIM',
    instrument: instrument as never,
    asset_class: 'crypto',
    event_type: 'quote',
    event_time: time as never,
    source_time: null,
    available_time: time as never,
    ingestion_time: time as never,
    sequence,
    provider: 'refsim',
    provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
    payload: { bid_price: bid, bid_size: '5', ask_price: ask, ask_size: '5' },
  } as never;
}

function windowOf(windowId: string, events: readonly MarketEventMirror[], asOf: number): ObservationWindow {
  const sorted = [...events].sort((a, b) => a.event_time - b.event_time || a.sequence - b.sequence);
  return {
    window_id: windowId,
    events: sorted,
    asOf: asOf as never,
    starts_at: (asOf - DAY) as never,
    ends_at: (asOf + 1) as never,
  } as never;
}

/** A declared account fill (the harness assumption: the venue filled the request). */
function declaredFill(fillId: string, instrument: string, side: 'buy' | 'sell', price: string, quantity: string, fee: string, time: number): AccountFill {
  return {
    fill_id: fillId,
    instrument: instrument as never,
    venue: 'REFSIM',
    side,
    price,
    quantity,
    fee,
    event_time: time as never,
  } as never;
}

// ---------------------------------------------------------------------------
// The scripted windows
// ---------------------------------------------------------------------------

/**
 * Step 1's window: the opening marks (BTC 50000, ETH 3000, SOL 100 —
 * ETH priced by a QUOTE mid so the mid-quote mark discipline is
 * exercised, the others by trade prints).
 */
export function referenceWindow1(): ObservationWindow {
  return windowOf('ref-win-1', [
    scriptedQuote('ref-q1', 'ETH-USD', '2999.98', '3000.02', 1, T1 - 900),
    scriptedTrade('ref-t1', 'BTC-USD', '50000.00', 2, T1 - 800),
    scriptedTrade('ref-t2', 'SOL-USD', '100.000', 3, T1 - 700),
  ], T1);
}

/** Step 2's window: BTC's mark 50000 -> 90000 — the drift-band trigger fires. */
export function referenceWindow2(): ObservationWindow {
  return windowOf('ref-win-2', [
    scriptedTrade('ref-t3', 'BTC-USD', '90000.00', 1, T2 - 900),
    scriptedTrade('ref-t4', 'ETH-USD', '3000.00', 2, T2 - 800),
    scriptedTrade('ref-t5', 'SOL-USD', '100.000', 3, T2 - 700),
  ], T2);
}

/** Step 3's window: the marks settle back (only BTC remains outside its band). */
export function referenceWindow3(): ObservationWindow {
  return windowOf('ref-win-3', [
    scriptedTrade('ref-t6', 'BTC-USD', '52000.00', 1, T3 - 900),
    scriptedTrade('ref-t7', 'ETH-USD', '3050.00', 2, T3 - 800),
    scriptedTrade('ref-t8', 'SOL-USD', '102.500', 3, T3 - 700),
  ], T3);
}

// ---------------------------------------------------------------------------
// The scenarios
// ---------------------------------------------------------------------------

/**
 * The SATISFIED-path scenario (the step-by-step arithmetic is derived
 * in the module header; the declared fills mirror the emitted intents —
 * the harness assumption that the venue filled them, T019 owns the
 * simulation).
 */
export function referenceScenario(): StrategyScenario {
  const steps: readonly ScenarioStep[] = [
    {
      window: referenceWindow1(),
      // The initial allocation's three buys settle.
      fills: [
        declaredFill('ref-f1', 'BTC-USD', 'buy', '50000.00', '0.2', '0', T1),
        declaredFill('ref-f2', 'ETH-USD', 'buy', '3000.00', '3.33', '0', T1),
        declaredFill('ref-f3', 'SOL-USD', 'buy', '100.000', '100', '0', T1),
      ],
      corporateActions: [],
    },
    {
      window: referenceWindow2(),
      // The rebalance settles: BTC drift sell + the cash-capped SOL buy.
      fills: [
        declaredFill('ref-f4', 'BTC-USD', 'sell', '90000.00', '0.059', '0', T2),
        declaredFill('ref-f5', 'SOL-USD', 'buy', '100.000', '0.1', '0', T2),
      ],
      corporateActions: [
        // A SOL cash dividend (on the pre-fill 100 units: +5 cash, exact).
        { action_id: 'ref-div-1', instrument: 'SOL-USD' as never, kind: 'cash_dividend', cashPerUnit: '0.05', ex_time: T2 as never },
      ],
    },
    {
      window: referenceWindow3(),
      // The settling buy lands; the 2:1 SOL split exercises the split path.
      fills: [
        declaredFill('ref-f6', 'BTC-USD', 'buy', '52000.00', '0.07', '0', T3),
      ],
      corporateActions: [
        { action_id: 'ref-split-1', instrument: 'SOL-USD' as never, kind: 'split', splitRatio: '2', ex_time: T3 as never },
      ],
    },
  ];
  return {
    spec: REFERENCE_STRATEGY_SPEC,
    goal: REFERENCE_GOAL,
    constraintSet: REFERENCE_CONSTRAINT_SET,
    seed: 'reference-seed-1' as never,
    initialCash: '30000',
    steps,
  };
}

/**
 * The REFUSING-path scenario: the same windows under the refusing
 * constraint fixture with NO declared fills — the gate refuses every
 * candidate at every step (the universe ceiling of two vs the
 * universe's three), nothing is ever emitted, and the portfolio never
 * leaves its genesis shape.
 */
export function referenceRefusingScenario(): StrategyScenario {
  const satisfied = referenceScenario();
  return {
    spec: satisfied.spec,
    goal: satisfied.goal,
    constraintSet: REFERENCE_REFUSING_CONSTRAINT_SET,
    seed: satisfied.seed,
    initialCash: satisfied.initialCash,
    steps: satisfied.steps.map((step) => ({ window: step.window, fills: [], corporateActions: [] })),
  };
}
