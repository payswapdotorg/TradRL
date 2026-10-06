// @tradrl/example-e2e-trading — THE REFERENCE SCENARIO (R44).
//
// The single deterministic input of the reference run: a growth goal with
// executable constraints and budgets, a two-instrument crypto universe on
// the REFSIM venue, a scripted recorded history (trades, quotes, news,
// social signal, fundamental, macro release — each with its availability
// quartet), seeded venue physics, the control-plane declarations and a
// three-decision schedule. Everything the run produces derives from
// these bytes.

import { deepFreeze } from './primitives';
import type { TradingScenario } from './scenario';

export const T0 = 1_717_459_200_000; // 2024-06-04T00:00:00.000Z
const MINUTE = 60_000;

function tradeEvent(
  sequence: number,
  instrument: string,
  minutesOffset: number,
  price: string,
  size: string,
  side: 'buy' | 'sell',
): TradingScenario['marketEvents'][number] {
  const at = T0 + minutesOffset * MINUTE;
  return {
    event_id: `ev-trade-${sequence.toString().padStart(3, '0')}`,
    venue: 'REFSIM',
    instrument,
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: at,
    source_time: at - 1_000,
    available_time: at + 100,
    ingestion_time: at + 150,
    sequence,
    provider: 'refsim-recorder',
    provenance: { origin: 'historical', adapter: { id: 'adapter-example-refsim', version: '0.0.0' }, derived_from: [], transform: null },
    payload: { price, size, side },
  };
}

function quoteEvent(
  sequence: number,
  instrument: string,
  minutesOffset: number,
  bid: string,
  ask: string,
): TradingScenario['marketEvents'][number] {
  const at = T0 + minutesOffset * MINUTE;
  return {
    event_id: `ev-quote-${sequence.toString().padStart(3, '0')}`,
    venue: 'REFSIM',
    instrument,
    asset_class: 'crypto',
    event_type: 'quote',
    event_time: at,
    source_time: at - 1_000,
    available_time: at + 100,
    ingestion_time: at + 150,
    sequence,
    provider: 'refsim-recorder',
    provenance: { origin: 'historical', adapter: { id: 'adapter-example-refsim', version: '0.0.0' }, derived_from: [], transform: null },
    payload: { bid_price: bid, bid_size: '4', ask_price: ask, ask_size: '4' },
  };
}

function newsEvent(sequence: number, instrument: string, minutesOffset: number, headline: string): TradingScenario['marketEvents'][number] {
  const at = T0 + minutesOffset * MINUTE;
  return {
    event_id: `ev-news-${sequence.toString().padStart(3, '0')}`,
    venue: 'REFSIM',
    instrument,
    asset_class: 'crypto',
    event_type: 'news',
    event_time: at,
    source_time: at - 2_000,
    available_time: at + 100,
    ingestion_time: at + 150,
    sequence,
    provider: 'refsim-news',
    provenance: { origin: 'historical', adapter: { id: 'adapter-example-news', version: '0.0.0' }, derived_from: [], transform: null },
    payload: { headline, symbols: [instrument], source: 'reference-wire' },
  };
}

function socialEvent(sequence: number, instrument: string, minutesOffset: number, score: string): TradingScenario['marketEvents'][number] {
  const at = T0 + minutesOffset * MINUTE;
  return {
    event_id: `ev-social-${sequence.toString().padStart(3, '0')}`,
    venue: 'REFSIM',
    instrument,
    asset_class: 'crypto',
    event_type: 'social_signal',
    event_time: at,
    source_time: at - 2_000,
    available_time: at + 100,
    ingestion_time: at + 150,
    sequence,
    provider: 'refsim-social',
    provenance: { origin: 'historical', adapter: { id: 'adapter-example-alternative', version: '0.0.0' }, derived_from: [], transform: null },
    payload: { platform: 'reference-forum', metric: 'sentiment-score', value: score },
  };
}

function fundamentalEvent(sequence: number, instrument: string, minutesOffset: number, period: string, value: string): TradingScenario['marketEvents'][number] {
  const at = T0 + minutesOffset * MINUTE;
  return {
    event_id: `ev-fund-${sequence.toString().padStart(3, '0')}`,
    venue: 'REFSIM',
    instrument,
    asset_class: 'crypto',
    event_type: 'fundamental',
    event_time: at,
    source_time: at - 5_000,
    available_time: at + 100,
    ingestion_time: at + 150,
    sequence,
    provider: 'refsim-fundamentals',
    provenance: { origin: 'historical', adapter: { id: 'adapter-example-equities', version: '0.0.0' }, derived_from: [], transform: null },
    payload: { field: 'INDEX_LEVEL', period, value, unit: 'index' },
  };
}

function macroEvent(sequence: number, instrument: string, minutesOffset: number, actual: string, forecast: string): TradingScenario['marketEvents'][number] {
  const at = T0 + minutesOffset * MINUTE;
  return {
    event_id: `ev-macro-${sequence.toString().padStart(3, '0')}`,
    venue: 'REFSIM',
    instrument,
    asset_class: 'macro',
    event_type: 'macro_release',
    event_time: at,
    source_time: at - 5_000,
    available_time: at + 100,
    ingestion_time: at + 150,
    sequence,
    provider: 'refsim-macro',
    provenance: { origin: 'historical', adapter: { id: 'adapter-example-equities', version: '0.0.0' }, derived_from: [], transform: null },
    payload: { indicator: 'CPI_REFERENCE', region: 'US', period: 'm-1', actual, forecast },
  };
}

const PHYSICS = {
  tick_size: '',
  lot_size: '',
  max_book_depth: 10,
  seed: 'seed/t048/refsim-engine',
  fidelity: 'reactive_replay' as const,
  fees: {
    tiers: [
      { up_to_notional: '10000', maker_bps: '5', taker_bps: '10' },
      { up_to_notional: null, maker_bps: '6', taker_bps: '12' },
    ],
    fee_decimals: 2,
  },
  latency: { kind: 'fixed' as const, fixed_ms: 250 },
  slippage: { kind: 'book_walk' as const },
  impact: {
    kind: 'none',
    declaration: 'no exogenous impact model — fills are book-mediated only',
    limitation: 'order book depth at arrival is the sole liquidity source; no cross-venue impact, no queued-order depletion beyond the book, no permanent impact decay',
  },
};

/** THE reference scenario — the whole run derives from these bytes. */
export const REFERENCE_SCENARIO: TradingScenario = deepFreeze({
  schema: 'tradrl/example-e2e-trading-scenario@1',
  scenarioId: 't048-reference-1',
  tenant: 'tenant-e2e-reference',
  project: 'project-portfolio-one',
  seed: 'seed/t048/reference-1',
  epochMs: T0,
  goal: {
    id: 'goal/e2e-growth',
    version: 1,
    tenantId: 'tenant-e2e-reference',
    objective: 'Grow the reference portfolio over one trading hour while respecting the declared risk constraints (capital preservation first).',
    horizon: { startsAt: T0, endsAt: T0 + 30 * 24 * 60 * MINUTE, label: 'one month' },
    successCriteria: {
      criteria: [
        { id: 'c-equity', metric: 'outcome.final_equity', predicate: { kind: 'limit.min', bound: 100000 }, description: 'final equity at or above the initial 100000 (capital preservation)' },
        { id: 'c-drawdown', metric: 'outcome.max_drawdown', predicate: { kind: 'limit.max', bound: 20000 }, description: 'peak-to-final drawdown within 20000 quote units' },
      ],
      requiredSatisfaction: 0.5,
    },
    evaluation: {
      blindRef: 'evaluation/blind-holdout@1',
      walkForwardRef: 'evaluation/walk-forward@1',
      regimeRef: 'evaluation/regime-coverage@1',
      adversarialRequired: false,
    },
    createdAt: T0,
    description: 'The reference goal: constraint-aware growth — never raw PnL alone (L7).',
  },
  constraintSet: {
    id: 'cs/e2e-reference',
    version: 1,
    tenantId: 'tenant-e2e-reference',
    name: 'Reference constraint set',
    constraints: [
      { id: 'risk-order-size', domain: 'state', subject: 'risk.order_size', predicate: { kind: 'limit.max', bound: 20 }, severity: 'blocking', description: 'max single order 20 units (catch-all class — ETH scale; BTC is notional-bound)' },
      { id: 'risk-order-notional', domain: 'state', subject: 'risk.order_notional', predicate: { kind: 'limit.max', bound: 60000 }, severity: 'blocking' },
      { id: 'risk-position-size', domain: 'state', subject: 'risk.position_size', predicate: { kind: 'limit.max', bound: 50 }, severity: 'blocking' },
      { id: 'risk-position-notional', domain: 'state', subject: 'risk.position_notional', predicate: { kind: 'limit.max', bound: 300000 }, severity: 'blocking' },
      { id: 'risk-concentration', domain: 'state', subject: 'risk.concentration', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking', description: '100% single-instrument concentration cap' },
      { id: 'risk-drawdown', domain: 'state', subject: 'risk.drawdown', predicate: { kind: 'limit.max', bound: 20000 }, severity: 'blocking' },
      { id: 'state-cash-floor', domain: 'state', subject: 'state.cash', predicate: { kind: 'limit.min', bound: 0 }, severity: 'blocking', description: 'never negative cash' },
      { id: 'action-notional-cap', domain: 'action', subject: 'action.notional', predicate: { kind: 'limit.max', bound: 60000 }, severity: 'blocking', description: 'no single action above 60000 notional' },
      { id: 'advisory-observation-freshness', domain: 'observation', subject: 'window.trades', predicate: { kind: 'limit.min', bound: 2 }, severity: 'advisory', description: 'prefer at least two prints in the window' },
    ],
    createdAt: T0,
  },
  budgets: {
    maxAgents: 6,
    maxComputeUnits: 100,
    maxCoordinationWires: 100,
    maxLatencyMs: 3_600_000,
    maxEnumeratedCandidates: 10,
    retainLimitK: 3,
  },
  universe: [
    { venue: 'REFSIM', instrument: 'BTC-USDT', assetClass: 'crypto', lotSize: '0.0001', tickSize: '0.1' },
    { venue: 'REFSIM', instrument: 'ETH-USDT', assetClass: 'crypto', lotSize: '0.01', tickSize: '0.01' },
  ],
  marketEvents: [
    // ===== Window 1 [0, 20m] =====
    tradeEvent(1, 'BTC-USDT', 1, '50000', '0.30', 'buy'),
    tradeEvent(2, 'ETH-USDT', 1.1, '3000', '6', 'buy'),
    newsEvent(3, 'BTC-USDT', 2, 'Reference exchange lists new institutional custody desk'),
    socialEvent(4, 'BTC-USDT', 3, '0.60'),
    socialEvent(5, 'ETH-USDT', 3.5, '0.20'),
    fundamentalEvent(6, 'BTC-USDT', 4, 'w-2', '1000.00'),
    fundamentalEvent(7, 'BTC-USDT', 4.5, 'w-1', '1030.00'),
    macroEvent(8, 'ETH-USDT', 6, '2.50', '2.20'),
    tradeEvent(9, 'BTC-USDT', 9, '50100', '0.25', 'buy'),
    tradeEvent(10, 'ETH-USDT', 9.2, '3010', '5', 'buy'),
    tradeEvent(11, 'BTC-USDT', 9.5, '50600', '0.28', 'buy'),
    tradeEvent(12, 'ETH-USDT', 9.7, '3040', '6', 'buy'),
    tradeEvent(13, 'BTC-USDT', 13, '50700', '0.30', 'buy'),
    tradeEvent(14, 'ETH-USDT', 13.2, '3050', '5', 'buy'),
    tradeEvent(15, 'BTC-USDT', 13.5, '51200', '0.26', 'buy'),
    tradeEvent(16, 'ETH-USDT', 13.7, '3080', '4', 'buy'),
    quoteEvent(17, 'BTC-USDT', 15, '51250', '51350'),
    tradeEvent(18, 'BTC-USDT', 17, '51300', '0.20', 'buy'),
    tradeEvent(19, 'ETH-USDT', 18, '3090', '7', 'buy'),
    // ===== Window 2 [25m, 40m] =====
    tradeEvent(20, 'BTC-USDT', 25, '51400', '0.35', 'buy'),
    tradeEvent(21, 'ETH-USDT', 25.2, '3100', '5', 'buy'),
    tradeEvent(22, 'BTC-USDT', 25.5, '51900', '0.31', 'buy'),
    tradeEvent(23, 'ETH-USDT', 25.7, '3130', '6', 'buy'),
    newsEvent(24, 'BTC-USDT', 28, 'Reference custody desk inflows hit a record'),
    socialEvent(25, 'BTC-USDT', 29, '0.55'),
    socialEvent(26, 'ETH-USDT', 29.5, '0.25'),
    tradeEvent(27, 'BTC-USDT', 30, '52000', '0.30', 'buy'),
    tradeEvent(28, 'ETH-USDT', 30.2, '3140', '5', 'buy'),
    tradeEvent(29, 'BTC-USDT', 30.5, '52500', '0.27', 'buy'),
    tradeEvent(30, 'ETH-USDT', 30.7, '3170', '6', 'buy'),
    fundamentalEvent(31, 'BTC-USDT', 33, 'w-1', '1030.00'),
    fundamentalEvent(32, 'BTC-USDT', 33.5, 'w-0', '1055.00'),
    tradeEvent(33, 'BTC-USDT', 35, '52600', '0.33', 'buy'),
    tradeEvent(34, 'ETH-USDT', 36, '3180', '5', 'buy'),
    macroEvent(35, 'ETH-USDT', 38, '2.60', '2.30'),
    // ===== Window 3 [45m, 60m] =====
    tradeEvent(36, 'BTC-USDT', 45, '52700', '0.33', 'buy'),
    tradeEvent(37, 'ETH-USDT', 45.2, '3190', '6', 'buy'),
    tradeEvent(38, 'BTC-USDT', 45.5, '53200', '0.29', 'buy'),
    tradeEvent(39, 'ETH-USDT', 45.7, '3220', '5', 'buy'),
    newsEvent(40, 'BTC-USDT', 48, 'Reference desk announces expanded coverage'),
    socialEvent(41, 'BTC-USDT', 49, '0.58'),
    socialEvent(42, 'ETH-USDT', 49.5, '0.30'),
    tradeEvent(43, 'BTC-USDT', 50, '53300', '0.26', 'buy'),
    tradeEvent(44, 'ETH-USDT', 50.2, '3230', '5', 'buy'),
    tradeEvent(45, 'BTC-USDT', 50.5, '53800', '0.24', 'buy'),
    tradeEvent(46, 'ETH-USDT', 50.7, '3260', '4', 'buy'),
    fundamentalEvent(47, 'BTC-USDT', 53, 'w-1', '1055.00'),
    fundamentalEvent(48, 'BTC-USDT', 53.5, 'w-0', '1080.00'),
    tradeEvent(49, 'BTC-USDT', 55, '53900', '0.21', 'buy'),
    tradeEvent(50, 'ETH-USDT', 56, '3270', '5', 'buy'),
    macroEvent(51, 'ETH-USDT', 58, '2.40', '2.35'),
  ],
  bookSeeds: [
    {
      venue: 'REFSIM',
      instrument: 'BTC-USDT',
      seed: {
        bids: [
          { price: '49900', size: '0.6' },
          { price: '49800', size: '0.8' },
          { price: '49700', size: '1.0' },
        ],
        asks: [
          { price: '50000', size: '0.5' },
          { price: '50050', size: '0.5' },
          { price: '50100', size: '0.5' },
          { price: '50150', size: '0.5' },
          { price: '50200', size: '0.5' },
          { price: '50300', size: '1.5' },
          { price: '50400', size: '2.0' },
        ],
      },
    },
    {
      venue: 'REFSIM',
      instrument: 'ETH-USDT',
      seed: {
        bids: [
          { price: '2990', size: '12' },
          { price: '2980', size: '20' },
        ],
        asks: [
          { price: '3000', size: '10' },
          { price: '3005', size: '10' },
          { price: '3010', size: '10' },
          { price: '3015', size: '10' },
          { price: '3020', size: '14' },
          { price: '3030', size: '20' },
          { price: '3040', size: '25' },
        ],
      },
    },
  ],
  physics: [
    { venue: 'REFSIM', instrument: 'BTC-USDT', physics: { ...PHYSICS, tick_size: '0.1', lot_size: '0.0001' } },
    { venue: 'REFSIM', instrument: 'ETH-USDT', physics: { ...PHYSICS, tick_size: '0.01', lot_size: '0.01' } },
  ],
  policies: {
    execution: {
      principal: 'spec-t048-reference',
      grantScopeRef: 'grant:e2e-execute-limit@1',
      orderKinds: ['limit'],
      rateBudget: { windowMs: 45 * MINUTE, maxOrders: 10 },
      grantRateBudget: { windowMs: 45 * MINUTE, maxOrders: 3 },
      credentialRef: 'cred:e2e-main@1',
      adapterRef: 'adapter:adapter-example-paper@0.0.0',
      channelRef: 'chan:newOrderSingle',
    },
  },
  initialCash: '100000',
  decisions: [
    { atOffsetMs: 20 * MINUTE, lookbackMs: 20 * MINUTE },
    { atOffsetMs: 40 * MINUTE, lookbackMs: 15 * MINUTE },
    { atOffsetMs: 60 * MINUTE, lookbackMs: 15 * MINUTE },
  ],
});
