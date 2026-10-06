// @tradrl/example-e2e-trading — THE SCENARIO (T048's determinism anchor).
//
// One frozen, fully-explicit record: the user goal, the constraint set, the
// resource budget, the tradable universe, every injected instant, every
// seed, and the recorded market stream (the adapter-shaped canonical events
// of T037/T038). The WHOLE byte-reproducible run derives from this file and
// nothing else — no ambient clock, no randomness, no environment reads.
//
// Timeline (all instants explicit, epoch ms):
//   T0                        the scenario anchor (2026-06-01T00:00:00Z era)
//   T0+1000..T0+4000          the recorded market stream (trades/news/fundamental)
//   T0+6000                   researchAsOf   (all four research bodies compute)
//   T0+8000                   decisionAsOf   (the director synthesizes — L4 gate)
//   T0+9000                   strategyAsOf   (the strategy compiles its run)
//   T0+10000..                orderClock     (the order-level clock — L16)
//   T0+15000                  outcomeAsOf    (the shadow book settles)

import { deepFreeze } from './primitives';
import type { ConstraintSetStatementMirror, GoalStatementMirror } from './mirrors/strategy';
import type { BookSnapshotSeedMirror, ExchangeConfigMirror } from './mirrors/exchange';
import type { ReactiveWorldConfigMirror } from './mirrors/world';
import type { ExecutionPolicyMirror, RiskPolicyMirror } from './mirrors/authority';

// ---------------------------------------------------------------------------
// The scenario record
// ---------------------------------------------------------------------------

/** A recorded canonical market event (the adapter-shaped stream member). */
export interface StreamEvent {
  readonly event_id: string;
  readonly venue: string;
  readonly instrument: string;
  readonly asset_class: 'crypto';
  readonly event_type: 'trade' | 'news' | 'fundamental';
  readonly event_time: number;
  readonly source_time: number | null;
  readonly available_time: number;
  readonly ingestion_time: number;
  readonly sequence: number;
  readonly provider: string;
  readonly provenance: {
    readonly origin: 'historical';
    readonly adapter: { readonly id: string; readonly version: string };
    readonly derived_from: readonly string[];
    readonly transform: null;
  };
  readonly entitlement: string;
  readonly mapping: { readonly table_id: string; readonly source_time_policy: 'exchange_event_time' };
  readonly payload:
    | { readonly price: string; readonly size: string; readonly side: 'buy' | 'sell'; readonly trade_id?: string }
    | { readonly kind: string; readonly polarityHint: 'positive' | 'negative' | 'neutral'; readonly note: string }
    | { readonly field: string; readonly period: string; readonly value: string; readonly unit?: string; readonly source?: string };
}

export interface ScenarioInstants {
  readonly t0: number;
  readonly researchAsOf: number;
  readonly decisionAsOf: number;
  readonly strategyAsOf: number;
  readonly orderClockBase: number;
  readonly fillApplicationAsOf: number;
  readonly outcomeAsOf: number;
}

export interface ScenarioRecord {
  readonly scenarioId: string;
  readonly tenant: string;
  readonly project: string;
  readonly goal: GoalStatementMirror;
  readonly constraintSet: ConstraintSetStatementMirror;
  readonly budget: {
    readonly maxAgentCount: number;
    readonly toolCallBudgetPerDecision: number;
    readonly computeUnits: string;
  };
  readonly universe: readonly {
    readonly instrumentId: string;
    readonly venueId: string;
    readonly lotSize: string;
    readonly tickSize: string;
    readonly instrumentClass: string;
  }[];
  readonly instants: ScenarioInstants;
  readonly seeds: {
    readonly world: string;
    readonly director: string;
    readonly strategy: string;
  };
  readonly stream: readonly StreamEvent[];
  readonly bookSeed: BookSnapshotSeedMirror;
  readonly exchangeConfig: ExchangeConfigMirror;
  /** Per-instrument engine bindings (the driver routes by instrument; all share the venue, the fidelity and the fee/latency/slippage/impact physics). */
  readonly engineBindings: readonly {
    readonly instrumentId: string;
    readonly tickSize: string;
    readonly lotSize: string;
    readonly bookSeed: BookSnapshotSeedMirror;
  }[];
  readonly worldConfig: ReactiveWorldConfigMirror;
  readonly executionPolicy: ExecutionPolicyMirror;
  readonly riskPolicy: RiskPolicyMirror;
  readonly initialCash: string;
  readonly substrate: string;
}

// ---------------------------------------------------------------------------
// The frozen reference scenario
// ---------------------------------------------------------------------------

const T0 = 1_780_000_000_000;

export const REFERENCE_SCENARIO: ScenarioRecord = deepFreeze({
  scenarioId: 'e2e-reference/1',
  tenant: 'tenant-e2e',
  project: 'project-e2e',

  // -- The user goal (compiled by the goal compiler seam; L15 root) --------
  goal: {
    id: 'goal/e2e-reference',
    version: 1,
    tenantId: 'tenant-e2e',
    objective:
      'Grow the reference portfolio through sustained participation in the seeded crypto universe while preserving capital under the declared constraint set.',
    horizon: { startsAt: T0, endsAt: T0 + 30 * 24 * 3600 * 1000, label: 'reference-horizon-30d' },
    successCriteria: {
      criteria: [
        {
          id: 'criterion/capital-preservation',
          metric: 'outcome.portfolio.drawdown',
          predicate: { kind: 'limit.max', bound: 0.1 },
          description: 'Peak-to-trough drawdown must stay within 10% (advisory in the reference run).',
        },
        {
          id: 'criterion/participation',
          metric: 'outcome.fill.participation',
          predicate: { kind: 'limit.min', bound: 0.5 },
          description: 'At least half of the directed rebalance must fill in the reference window.',
        },
      ],
      requiredSatisfaction: 0.5,
    },
    evaluation: {
      blindRef: 'evaluation/blind/e2e-reference@1',
      walkForwardRef: 'evaluation/walk-forward/e2e-reference@1',
      regimeRef: 'evaluation/regime/e2e-reference@1',
      adversarialRequired: false,
    },
    createdAt: T0,
    description: 'The T048 reference goal: deterministic, small, fully observable.',
  },

  // -- The constraint set (blocking on action/outcome paths) ---------------
  constraintSet: {
    id: 'constraints/e2e-core',
    version: 1,
    tenantId: 'tenant-e2e',
    name: 'e2e-core-constraints',
    constraints: [
      {
        id: 'constraint/max-order-notional',
        domain: 'action',
        subject: 'notional',
        predicate: { kind: 'limit.max', bound: 40000 },
        severity: 'blocking',
        description: 'A single order may not exceed 40000 units of notional.',
      },
      {
        id: 'constraint/single-instrument-weight',
        domain: 'state',
        subject: 'targetWeight',
        predicate: { kind: 'limit.max', bound: 0.5 },
        severity: 'blocking',
        description: 'No instrument may exceed 50% of the target book.',
      },
      {
        id: 'constraint/venue-allowlist',
        domain: 'action',
        subject: 'venueId',
        predicate: { kind: 'oneOf', values: ['REFSIM'] },
        severity: 'blocking',
        description: 'Only the reference simulator venue is tradable.',
      },
      {
        id: 'constraint/concentration-advisory',
        domain: 'state',
        subject: 'positionWeight',
        predicate: { kind: 'limit.max', bound: 0.45 },
        severity: 'advisory',
        description: 'Positions above 45% of equity are recorded (advisory only).',
      },
    ],
    createdAt: T0,
  },

  // -- The resource budget (the organization compiler's input) -------------
  budget: {
    maxAgentCount: 7,
    toolCallBudgetPerDecision: 64,
    computeUnits: '256',
  },

  // -- The tradable universe (exchange-grid declared) ----------------------
  universe: [
    { instrumentId: 'BTC-USD', venueId: 'REFSIM', lotSize: '0.001', tickSize: '0.01', instrumentClass: 'crypto' },
    { instrumentId: 'ETH-USD', venueId: 'REFSIM', lotSize: '0.01', tickSize: '0.01', instrumentClass: 'crypto' },
    { instrumentId: 'SOL-USD', venueId: 'REFSIM', lotSize: '0.1', tickSize: '0.001', instrumentClass: 'crypto' },
  ],

  // -- Every injected instant (no ambient clock anywhere) ------------------
  instants: {
    t0: T0,
    researchAsOf: T0 + 6_000,
    decisionAsOf: T0 + 8_000,
    strategyAsOf: T0 + 9_000,
    orderClockBase: T0 + 10_000,
    fillApplicationAsOf: T0 + 15_000,
    outcomeAsOf: T0 + 15_000,
  },

  // -- The deterministic seeds ----------------------------------------------
  seeds: {
    world: 'seed/e2e/world-1',
    director: 'seed/e2e/director-1',
    strategy: 'seed/e2e/strategy-1',
  },

  // -- The recorded market stream (adapter-shaped canonical events) --------
  // Trades: BTC +1.5% (trending-up), ETH +1.0%, SOL flat. News: positive
  // sentiment spike on BTC. Fundamental: positive health indicator on BTC.
  stream: [
    // BTC-USD trades (up-leg: 50000 -> 50750, netMoveRatio +0.015)
    streamTrade('evt-0001', 'BTC-USD', 1, T0 + 1_000, '50000.00', '1.250', 'buy'),
    streamTrade('evt-0002', 'BTC-USD', 2, T0 + 1_500, '50100.00', '0.750', 'sell'),
    streamTrade('evt-0003', 'BTC-USD', 3, T0 + 2_500, '50400.00', '2.000', 'buy'),
    streamTrade('evt-0004', 'BTC-USD', 4, T0 + 3_500, '50750.00', '1.000', 'buy'),
    // ETH-USD trades (up-leg: 3000 -> 3030, netMoveRatio +0.01)
    streamTrade('evt-0005', 'ETH-USD', 1, T0 + 1_200, '3000.00', '10.000', 'buy'),
    streamTrade('evt-0006', 'ETH-USD', 2, T0 + 2_200, '3010.00', '6.000', 'sell'),
    streamTrade('evt-0007', 'ETH-USD', 3, T0 + 3_800, '3030.00', '8.000', 'buy'),
    // SOL-USD trades (flat: 100 -> 100.1)
    streamTrade('evt-0008', 'SOL-USD', 1, T0 + 1_400, '100.000', '500.000', 'buy'),
    streamTrade('evt-0009', 'SOL-USD', 2, T0 + 2_800, '99.900', '300.000', 'sell'),
    streamTrade('evt-0010', 'SOL-USD', 3, T0 + 4_000, '100.100', '200.000', 'buy'),
    // The sentiment lane's news event (BTC positive spike)
    {
      event_id: 'evt-0011',
      venue: 'REFSIM',
      instrument: 'BTC-USD',
      asset_class: 'crypto',
      event_type: 'news',
      event_time: T0 + 2_000,
      source_time: T0 + 1_999,
      available_time: T0 + 2_250,
      ingestion_time: T0 + 2_250,
      sequence: 1,
      provider: 'adapter-binance',
      provenance: {
        origin: 'historical',
        adapter: { id: 'adapter-binance', version: '0.0.0' },
        derived_from: [],
        transform: null,
      },
      entitlement: 'entitlement:binance/spot-major@1',
      mapping: { table_id: 'mapping/binance/spot-major@1', source_time_policy: 'exchange_event_time' },
      payload: { kind: 'sentiment-spike', polarityHint: 'positive', note: 'reference sentiment spike on BTC' },
    },
    // The fundamental lane's event (BTC health indicator positive)
    {
      event_id: 'evt-0012',
      venue: 'REFSIM',
      instrument: 'BTC-USD',
      asset_class: 'crypto',
      event_type: 'fundamental',
      event_time: T0 + 2_400,
      source_time: null,
      available_time: T0 + 2_600,
      ingestion_time: T0 + 2_600,
      sequence: 1,
      provider: 'adapter-equities',
      provenance: {
        origin: 'historical',
        adapter: { id: 'adapter-equities', version: '0.0.0' },
        derived_from: [],
        transform: null,
      },
      entitlement: 'entitlement:equities/index-level@1',
      mapping: { table_id: 'mapping/equities/fundamentals@1', source_time_policy: 'exchange_event_time' },
      payload: { field: 'NETWORK_ACTIVITY', period: '2026-06', value: '0.72', unit: 'index-points' },
    },
  ],

  // -- The seeded exchange book (resting liquidity; L6 declaration) --------
  bookSeed: {
    bids: [
      { price: '49980.00', size: '3.000' },
      { price: '49950.00', size: '5.000' },
    ],
    asks: [
      { price: '50100.00', size: '2.000' },
      { price: '50200.00', size: '4.000' },
      { price: '50350.00', size: '6.000' },
    ],
  },

  // -- Per-instrument engine bindings (one engine per instrument; shared physics) --
  engineBindings: [
    {
      instrumentId: 'BTC-USD',
      tickSize: '0.01',
      lotSize: '0.001',
      bookSeed: {
        bids: [
          { price: '49980.00', size: '3.000' },
          { price: '49950.00', size: '5.000' },
        ],
        asks: [
          { price: '50100.00', size: '2.000' },
          { price: '50200.00', size: '4.000' },
          { price: '50350.00', size: '6.000' },
        ],
      },
    },
    {
      instrumentId: 'ETH-USD',
      tickSize: '0.01',
      lotSize: '0.01',
      bookSeed: {
        bids: [
          { price: '3015.00', size: '30.000' },
          { price: '3005.00', size: '50.000' },
        ],
        asks: [
          { price: '3025.00', size: '25.000' },
          { price: '3035.00', size: '40.000' },
        ],
      },
    },
    {
      instrumentId: 'SOL-USD',
      tickSize: '0.001',
      lotSize: '0.1',
      bookSeed: {
        bids: [
          { price: '99.950', size: '600.000' },
          { price: '99.900', size: '800.000' },
        ],
        asks: [
          { price: '100.050', size: '500.000' },
          { price: '100.200', size: '700.000' },
        ],
      },
    },
  ],

  // -- The exchange physics (fees/latency/slippage/impact — L6 declared) ---
  exchangeConfig: {
    venue: 'REFSIM',
    instrument: 'BTC-USD',
    asset_class: 'crypto',
    tick_size: '0.01',
    lot_size: '0.001',
    max_book_depth: 16,
    seed: 'seed/e2e/world-1',
    fidelity: 'reactive_replay',
    fees: {
      tiers: [
        { up_to_notional: '10000', maker_bps: '1.0', taker_bps: '2.0' },
        { up_to_notional: null, maker_bps: '0.8', taker_bps: '1.6' },
      ],
      fee_decimals: 2,
    },
    latency: { kind: 'fixed', fixed_ms: 250 },
    slippage: { kind: 'book_walk' },
    impact: {
      kind: 'none',
      declaration: 'reference slice: no endogenous impact of participant orders on prices',
      limitation: 'resting liquidity is fixed at seed time; no replenishment (L6 declared approximation)',
    },
  },

  // -- The reactive world config (T027 mirror — mode-honest) ---------------
  worldConfig: {
    world_id: 'world/e2e-reactive-1',
    mode: 'reactive_replay',
    information_policy: 'point-in-time',
    tenant: 'tenant-e2e',
    project: 'project-e2e',
    seed: 'seed/e2e/world-1',
    as_of: T0 + 6_000,
    streams: [
      { venue: 'REFSIM', instrument: 'BTC-USD' },
      { venue: 'REFSIM', instrument: 'ETH-USD' },
      { venue: 'REFSIM', instrument: 'SOL-USD' },
    ],
    exchange: { venue: 'REFSIM', instrument: 'BTC-USD', tick_size: '0.01', lot_size: '0.001' },
    physics_refs: {
      fee_policy: 'fees/two-tier-bps@1',
      latency_policy: 'latency/fixed-250ms@1',
      slippage_policy: 'slippage/book-walk@1',
      impact_policy: 'impact/none-declared@1',
    },
    participants: [
      { instance: 'agent/e2e-execution', role: 'candidate', feed: 'feed/e2e-orders' },
      { instance: 'agent/e2e-liquidity-maker', role: 'co_participant', feed: null },
    ],
    interleaving: { kind: 'stream_first' },
    playback_speed: 1,
  },

  // -- The execution policy (the gate stack's declared law) ----------------
  executionPolicy: {
    policyId: 'xpol:e2e-reference',
    version: 1,
    tenant: 'tenant-e2e',
    project: 'project-e2e',
    identity: { principals: ['spec/e2e-reference'] },
    authorization: [{ scopeRef: 'grant:e2e-reference-market-limits', orderKinds: ['market', 'limit'] }],
    limits: [
      {
        instrumentClass: 'crypto',
        maxOrderSize: '20',
        maxOrderNotional: '40000',
        maxPositionSize: '12',
        maxPositionNotional: '60000',
      },
    ],
    venuePermissions: [
      { venue: 'REFSIM', instrument: 'BTC-USD', instrumentClass: 'crypto' },
      { venue: 'REFSIM', instrument: 'ETH-USD', instrumentClass: 'crypto' },
      { venue: 'REFSIM', instrument: 'SOL-USD', instrumentClass: 'crypto' },
    ],
    rateLimits: [{ venue: 'REFSIM', windowMs: 60_000, maxOrders: 10 }],
    credentials: [{ venue: 'REFSIM', credentialRef: 'cred:refsim/e2e-reference@1' }],
    killSwitch: { switchId: 'ksw:e2e-reference-1' },
    audit: { emission: 'every_decision' },
    checkOrder: ['kill_switch', 'identity', 'authorization', 'limits', 'venue_permissions', 'rate_limits', 'credentials'],
    asOf: T0,
  },

  // -- The risk policy (compiled from the constraint set — T020 seam) ------
  riskPolicy: {
    policyId: 'rpol:e2e-reference',
    version: 1,
    tenant: 'tenant-e2e',
    project: 'project-e2e',
    goal: { goalId: 'goal/e2e-reference', version: 1 },
    constraintSet: { id: 'constraints/e2e-core', version: 1 },
    classLimits: [
      {
        instrumentClass: 'crypto',
        maxOrderSize: '20',
        maxOrderNotional: '40000',
        maxPositionSize: '12',
        maxPositionNotional: '60000',
      },
    ],
    compiledFrom: ['constraints/e2e-core@1'],
    asOf: T0,
  },

  // -- The opening book + substrate ------------------------------------------
  initialCash: '100000',
  substrate: 'substrate/e2e-reasoner@1',
});

/** Builds one recorded trade event (the canonical adapter shape). */
function streamTrade(
  eventId: string,
  instrument: string,
  sequence: number,
  eventTime: number,
  price: string,
  size: string,
  side: 'buy' | 'sell',
): StreamEvent {
  return deepFreeze({
    event_id: eventId,
    venue: 'REFSIM',
    instrument,
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: eventTime,
    source_time: eventTime,
    available_time: eventTime + 250,
    ingestion_time: eventTime + 250,
    sequence,
    provider: 'adapter-binance',
    provenance: {
      origin: 'historical',
      adapter: { id: 'adapter-binance', version: '0.0.0' },
      derived_from: [],
      transform: null,
    },
    entitlement: 'entitlement:binance/spot-major@1',
    mapping: { table_id: 'mapping/binance/spot-major@1', source_time_policy: 'exchange_event_time' },
    payload: { price, size, side, trade_id: `t-${eventId.slice(-4)}` },
  });
}

/** Guard: the scenario record (structure only — the stages validate deeply). */
export function isScenarioRecord(v: unknown): v is ScenarioRecord {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as ScenarioRecord).scenarioId === 'string' &&
    Array.isArray((v as ScenarioRecord).stream) &&
    Array.isArray((v as ScenarioRecord).universe)
  );
}
