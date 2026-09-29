/**
 * @tradrl/risk-engine (service) — the reference fixtures (Work Order T020).
 *
 * Hand-assembled records that are VALID by construction (the unwrap helper
 * fails loudly on drift), with override-based variants for the breach
 * paths. Every number below was hand-computed exactly:
 *
 * THE GOLDEN SCENARIO (the numbers the whole service suite reasons over):
 *   Policy v1 compiles from the reference constraint set (crypto class
 *   caps: order size 2 / order notional 120000 / position size 3 /
 *   position notional 150000; catch-all 1 / 60000 / 2 / 110000;
 *   concentration 0.9; drawdown 10000; leverage 1.5).
 *   Step 1 @ T0 — portfolio BTC 0.8 + ETH 2, cash 100000; market BTC
 *   50000 / ETH 3000; fill buy 0.2 BTC at aggressor 50010.00, taker fee
 *   20.00. Exposure: BTC position 1 (notional 50000), ETH 2 (6000),
 *   gross 56000, cash 100000 - (0.2 x 50010 + 20) = 89978, equity 145978,
 *   peak 145978 (genesis), drawdown 0. Every limit WITHIN.
 *   Step 2 @ T0+60000 — the post-step-1 book marked at BTC 40000 / ETH
 *   2400, no fills. gross 44800, equity 134778, peak threads to 145978,
 *   drawdown 11200 — the drawdown limit (10000) BREACHES by 1200. The
 *   only breaching kind.
 *   Step 3 @ T0+120000 — policy v2 (drawdown 15000) supersedes v1 (L11);
 *   the same facts now measure WITHIN under the current head.
 *
 * THE BREATH OF THE BREACH FIXTURES (one per limit kind — the Work
 * Order's "a breach scenario per limit kind"): order_size (2.5 BTC buy
 * over the 2 cap), order_notional (1.9 BTC buy at BTC 65000 -> 123500
 * over 120000), position_size (3.5 BTC held over 3), position_notional
 * (2.5 BTC held at BTC 65000 -> 162500 over 150000), concentration (a
 * single-instrument book -> ratio 1 over 0.9), drawdown (the golden
 * step 2), leverage (a margin buy: buy 2 BTC over 10000 cash at BTC
 * 50000 with ETH 2.78 at 7000 -> cash -90030, gross 169460, equity
 * 79430, ratio 2.133451 over 1.5).
 *
 * THE KILL-SWITCH FIXTURES are hand-built with the SAME FNV-1a
 * derivations T019 mints with (chain head = fnv(prev + canonical(content));
 * record id = ksw-genesis-seeded; switch id = ksw: + fnv(canonical(genesis
 * content))) so they verify under `verifyKillSwitchChainMirror` exactly
 * like a REAL T019 log — the engine test additionally drives the engine
 * with a log produced by the REAL execution-policy API (the interop law).
 *
 * Zero runtime dependencies. No ambient clock (`Date.now()` never
 * appears) — every instant is an explicit fixture literal.
 */

import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  type KillSwitchLogMirror,
  type KillSwitchRecordMirror,
  type PortfolioStateMirror,
  type RiskResult,
} from '../../../packages/risk/src/index';

// ---------------------------------------------------------------------------
// The reference scope (explicit literals — no ambient anything)
// ---------------------------------------------------------------------------

/** The fixture clock base (epoch ms). */
export const T0 = 1_700_000_000_000;

/** The reference scope. */
export const TENANT = 'tenant-alpha';
export const PROJECT = 'project-one';
export const SEED = 't020-reference-seed';

/** The reference lineage refs. */
export const GOAL = { goalId: 'goal-t020', version: 1 } as const;
export const REFERENCE_CONSTRAINT_SET = { id: 'cs-risk-reference', version: 1 } as const;

/** The reference venues and instruments. */
export const VENUE = 'REFSIM';
export const BTC = 'BTC-USD';
export const ETH = 'ETH-USD';

/** Unwrap a fixture result or fail loudly (fixtures are valid by construction). */
export function unwrap<T>(result: RiskResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// The constraint sets (the compilation source — control-domain mirrors)
// ---------------------------------------------------------------------------

/** One reference constraint row (the control-domain mirror's statement shape). */
interface ReferenceConstraint {
  readonly id: string;
  readonly domain: 'observation' | 'state' | 'action' | 'outcome';
  readonly subject: string;
  readonly predicate: { readonly kind: 'limit.max'; readonly bound: number };
  readonly severity: 'advisory' | 'blocking';
  readonly description?: string;
}

/** The reference set's shared rows (v1 = exactly these; v2 = the drawdown bound loosened). */
function referenceConstraintRows(drawdownBound: number): readonly ReferenceConstraint[] {
  return [
    { id: 'c-order-size-all', domain: 'action', subject: 'risk.order_size', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking', description: 'max single order size, all classes' },
    { id: 'c-order-notional-all', domain: 'action', subject: 'risk.order_notional', predicate: { kind: 'limit.max', bound: 60000 }, severity: 'blocking' },
    { id: 'c-position-size-all', domain: 'state', subject: 'risk.position_size', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking' },
    { id: 'c-position-notional-all', domain: 'state', subject: 'risk.position_notional', predicate: { kind: 'limit.max', bound: 110000 }, severity: 'blocking' },
    { id: 'c-order-size-crypto', domain: 'action', subject: 'risk.order_size.crypto', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking' },
    { id: 'c-order-notional-crypto', domain: 'action', subject: 'risk.order_notional.crypto', predicate: { kind: 'limit.max', bound: 120000 }, severity: 'blocking' },
    { id: 'c-position-size-crypto', domain: 'state', subject: 'risk.position_size.crypto', predicate: { kind: 'limit.max', bound: 3 }, severity: 'blocking' },
    { id: 'c-position-notional-crypto', domain: 'state', subject: 'risk.position_notional.crypto', predicate: { kind: 'limit.max', bound: 150000 }, severity: 'blocking' },
    { id: 'c-concentration', domain: 'state', subject: 'risk.concentration', predicate: { kind: 'limit.max', bound: 0.9 }, severity: 'blocking' },
    { id: 'c-drawdown', domain: 'state', subject: 'risk.drawdown', predicate: { kind: 'limit.max', bound: drawdownBound }, severity: 'blocking' },
    { id: 'c-leverage', domain: 'state', subject: 'risk.leverage', predicate: { kind: 'limit.max', bound: 1.5 }, severity: 'blocking' },
  ];
}

/**
 * The reference constraint set, version 1: every limit kind declared —
 * the four class kinds (unqualified subjects compile to the '*' catch-
 * all; the `.crypto`-qualified ones to the named class), plus
 * concentration, drawdown and leverage. All blocking; class-kind caps
 * are 'action' domain, the portfolio kinds 'state' domain.
 */
export function referenceConstraintSetV1(): Record<string, unknown> {
  return deepFreeze({
    id: 'cs-risk-reference',
    version: 1,
    tenantId: TENANT,
    name: 'reference risk constraints',
    createdAt: (T0 - 60_000) as never,
    constraints: referenceConstraintRows(10000),
  });
}

/**
 * The reference constraint set, version 2 — the L11 SUPERSESSION source:
 * identical to v1 except the drawdown cap loosens to 15000 (and the
 * set's own version bumps to 2 — the policy's constraint-set ref names
 * the version it compiled from).
 */
export function referenceConstraintSetV2(): Record<string, unknown> {
  return deepFreeze({
    id: 'cs-risk-reference',
    version: 2,
    tenantId: TENANT,
    name: 'reference risk constraints (v2: drawdown loosened)',
    createdAt: (T0 + 119_000) as never,
    constraints: referenceConstraintRows(15000),
  });
}

// ---------------------------------------------------------------------------
// The portfolio states (the exposure computation's facts — T018 mirrors)
// ---------------------------------------------------------------------------

/** A portfolio-state mirror with the reference lineage and explicit overrides. */
export function portfolioOf(overrides: {
  readonly stateId: string;
  readonly positions: readonly { readonly instrumentId: string; readonly quantity: string; readonly costBasis: string; readonly openedAt: number }[];
  readonly weights: readonly { readonly instrumentId: string; readonly weight: string; readonly markSource: 'last_trade' | 'mid_quote' }[];
  readonly cash: string;
  readonly asOf: number;
  readonly constraintSetVersion?: number;
}): PortfolioStateMirror {
  const base = {
    stateId: overrides.stateId,
    positions: overrides.positions.map((position) => ({ venueId: VENUE, ...position })),
    weights: overrides.weights,
    cash: overrides.cash,
    realizedPnl: '0',
    unrealizedPnl: '0',
    asOf: overrides.asOf,
    lineage: {
      strategy: { specId: 'spec-t020', version: 1 },
      goal: { goalId: GOAL.goalId, version: GOAL.version },
      constraintSet: { id: REFERENCE_CONSTRAINT_SET.id, version: overrides.constraintSetVersion ?? REFERENCE_CONSTRAINT_SET.version },
      windowId: 'win-t020-1',
      seed: SEED,
      tenant: TENANT,
      project: PROJECT,
    },
  };
  return deepFreeze(base as unknown as PortfolioStateMirror);
}

/** The golden step-1 portfolio: BTC 0.8 + ETH 2 held, cash 100000. */
export function goldenPortfolio(): PortfolioStateMirror {
  return portfolioOf({
    stateId: 'ps:t020-s1',
    positions: [
      { instrumentId: BTC, quantity: '0.8', costBasis: '40000', openedAt: T0 - 100_000 },
      { instrumentId: ETH, quantity: '2', costBasis: '6000', openedAt: T0 - 100_000 },
    ],
    weights: [
      { instrumentId: BTC, weight: '0.4', markSource: 'last_trade' },
      { instrumentId: ETH, weight: '0.06', markSource: 'last_trade' },
    ],
    cash: '100000',
    asOf: T0 - 1_000,
  });
}

/** The post-step-1 portfolio (the golden step-2/3 book): BTC 1 + ETH 2, cash 89978. */
export function postStepOnePortfolio(stateId: string, asOf: number, constraintSetVersion = 1): PortfolioStateMirror {
  return portfolioOf({
    stateId,
    positions: [
      { instrumentId: BTC, quantity: '1', costBasis: '50002', openedAt: T0 - 100_000 },
      { instrumentId: ETH, quantity: '2', costBasis: '6000', openedAt: T0 - 100_000 },
    ],
    weights: [
      { instrumentId: BTC, weight: '0.35', markSource: 'last_trade' },
      { instrumentId: ETH, weight: '0.05', markSource: 'last_trade' },
    ],
    cash: '89978',
    asOf,
    constraintSetVersion,
  });
}

// ---------------------------------------------------------------------------
// The market events (the declared inputs — market-protocol mirrors)
// ---------------------------------------------------------------------------

/** A simulated-origin trade print on (venue, instrument) at `price`. */
export function tradeEvent(overrides: {
  readonly eventId: string;
  readonly instrument: string;
  readonly price: string;
  readonly sequence: number;
  readonly eventTime: number;
}): Record<string, unknown> {
  return deepFreeze({
    event_id: overrides.eventId,
    venue: VENUE,
    instrument: overrides.instrument,
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: overrides.eventTime,
    source_time: null,
    available_time: overrides.eventTime,
    ingestion_time: overrides.eventTime,
    sequence: overrides.sequence,
    provider: 'refsim-feed',
    provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
    payload: { price: overrides.price, size: '0.1', side: 'buy' },
  });
}

/** A two-print REFSIM market (BTC then ETH) at the given marks. */
export function btcEthMarket(btcPrice: string, ethPrice: string, eventTime: number): readonly Record<string, unknown>[] {
  return [
    tradeEvent({ eventId: `ev-btc-${eventTime}`, instrument: BTC, price: btcPrice, sequence: 1, eventTime }),
    tradeEvent({ eventId: `ev-eth-${eventTime}`, instrument: ETH, price: ethPrice, sequence: 2, eventTime }),
  ];
}

/** A one-print REFSIM market (BTC only). */
export function btcOnlyMarket(btcPrice: string, eventTime: number): readonly Record<string, unknown>[] {
  return [tradeEvent({ eventId: `ev-btc-${eventTime}`, instrument: BTC, price: btcPrice, sequence: 1, eventTime })];
}

// ---------------------------------------------------------------------------
// The fills (the exposure inputs' execution evidence — exchange-sim mirrors)
// ---------------------------------------------------------------------------

/** A taker-side fill (the account is the aggressor — this lane's declared interpretation). */
export function fillOf(overrides: {
  readonly fillId: string;
  readonly instrument: string;
  readonly aggressorSide: 'buy' | 'sell';
  readonly price: string;
  readonly aggressorPrice: string;
  readonly quantity: string;
  readonly takerFee: string;
  readonly eventTime: number;
  readonly sequence: number;
}): Record<string, unknown> {
  return deepFreeze({
    fill_id: overrides.fillId,
    trade_id: overrides.fillId,
    venue: VENUE,
    instrument: overrides.instrument,
    quartet: { event_time: overrides.eventTime, source_time: null, available_time: overrides.eventTime + 500, ingestion_time: overrides.eventTime },
    sequence: overrides.sequence,
    taker_order_id: `xo-${overrides.fillId}`,
    maker_order_id: `xo-${overrides.fillId}-m`,
    aggressor_side: overrides.aggressorSide,
    price: overrides.price,
    aggressor_price: overrides.aggressorPrice,
    quantity: overrides.quantity,
    taker_fee: overrides.takerFee,
    maker_fee: '10.00',
    latency_ms: 500,
  });
}

/** The golden fill: buy 0.2 BTC at aggressor 50010.00 with a 20.00 taker fee. */
export function goldenFill(): Record<string, unknown> {
  return fillOf({
    fillId: 'xsf-r-00000001',
    instrument: BTC,
    aggressorSide: 'buy',
    price: '50000.00',
    aggressorPrice: '50010.00',
    quantity: '0.2',
    takerFee: '20.00',
    eventTime: T0,
    sequence: 1,
  });
}

// ---------------------------------------------------------------------------
// The kill-switch logs (hand-derived T019 chains — the interop fixtures)
// ---------------------------------------------------------------------------

/** The switch-log chain derivations (execution-policy's own, mirrored by hand — see module header). */
function switchRecordContent(record: Omit<KillSwitchRecordMirror, 'recordId' | 'chainHead'>): string {
  return canonicalJson({
    sequence: record.sequence,
    state: record.state,
    reason: record.reason,
    thrownAt: record.thrownAt,
    tenant: record.tenant,
    project: record.project,
    asOf: record.asOf,
  });
}

/**
 * Build a switch log by hand with the SAME derivations execution-policy
 * mints with: chain head = fnv(prev + canonical(content)); record id =
 * `ksr:` + fnv(chainHead + canonical(content)); switch id = `ksw:` +
 * fnv(canonical(genesis content)); the chain seeds at 'ksw-genesis'. The
 * engine test proves a log produced by the REAL T019 API behaves
 * identically (the interop law).
 */
export function buildSwitchLog(
  entries: readonly { readonly state: 'standing' | 'thrown'; readonly reason?: string; readonly thrownAt?: number; readonly asOf: number }[],
): KillSwitchLogMirror {
  if (entries.length === 0) throw new Error('buildSwitchLog requires at least the standing genesis entry');
  const records: KillSwitchRecordMirror[] = [];
  let previousHead = 'ksw-genesis';
  entries.forEach((entry, index) => {
    const content = {
      sequence: index + 1,
      state: entry.state,
      reason: entry.state === 'thrown' ? (entry.reason ?? 'circuit breaker') : null,
      thrownAt: entry.state === 'thrown' ? (entry.thrownAt ?? entry.asOf) : null,
      tenant: TENANT,
      project: PROJECT,
      asOf: entry.asOf,
    } as Omit<KillSwitchRecordMirror, 'recordId' | 'chainHead'>;
    const chainHead = fnv1a32Hex(`${previousHead}${switchRecordContent(content)}`);
    records.push(deepFreeze({ ...content, recordId: `ksr:${fnv1a32Hex(`${chainHead}${switchRecordContent(content)}`)}`, chainHead }) as KillSwitchRecordMirror);
    previousHead = chainHead;
  });
  const genesis = records[0] as KillSwitchRecordMirror;
  return deepFreeze({ switchId: `ksw:${fnv1a32Hex(switchRecordContent(genesis))}`, records }) as unknown as KillSwitchLogMirror;
}

/** A STANDING switch log for the reference scope (the armed genesis). */
export function standingSwitchLog(): KillSwitchLogMirror {
  return buildSwitchLog([{ state: 'standing', asOf: T0 - 2_000 }]);
}

/** A THROWN switch log for the reference scope (genesis, then the throw). */
export function thrownSwitchLog(reason = 'risk desk circuit breaker', thrownAt = T0 + 90_000): KillSwitchLogMirror {
  return buildSwitchLog([
    { state: 'standing', asOf: T0 - 2_000 },
    { state: 'thrown', reason, thrownAt, asOf: thrownAt },
  ]);
}

// ---------------------------------------------------------------------------
// The per-kind breach fixtures (one scenario per limit kind)
// ---------------------------------------------------------------------------

/** One breach scenario: the step inputs plus the expected evidence for the target kind. */
export interface BreachFixture {
  /** The fixture's name (the limit kind it isolates as far as the caps allow). */
  readonly name: string;
  readonly portfolio: PortfolioStateMirror;
  readonly marketEvents: readonly Record<string, unknown>[];
  readonly fills: readonly Record<string, unknown>[];
  readonly asOf: number;
  /** The kind whose breach this fixture pins. */
  readonly kind: 'order_size' | 'order_notional' | 'position_size' | 'position_notional' | 'concentration' | 'drawdown' | 'leverage';
  /** The scope the breach lands on ('portfolio' or the instrument id). */
  readonly scopeInstrument: string | null;
  /** The hand-computed evidence triple (exact decimals). */
  readonly bound: string;
  readonly observed: string;
  readonly excess: string;
}

/**
 * The six single-step breach fixtures (the drawdown one needs the
 * threaded high-water mark and lives in the engine tests as the golden
 * step 2; see {@link GOLDEN_DRAWDOWN_BREACH}). Every number is
 * hand-computed exactly — see the module header.
 */
export function singleStepBreachFixtures(): readonly BreachFixture[] {
  return deepFreeze([
    {
      // A 2.5 BTC buy over the crypto order-size cap 2 (the order also
      // breaches order_notional/position/concentration — the fixture
      // pins THIS kind's evidence).
      name: 'order_size breach',
      portfolio: goldenPortfolio(),
      marketEvents: btcEthMarket('50000.00', '3000.00', T0 - 500),
      fills: [fillOf({ fillId: 'xsf-r-os-1', instrument: BTC, aggressorSide: 'buy', price: '50000.00', aggressorPrice: '50010.00', quantity: '2.5', takerFee: '20.00', eventTime: T0, sequence: 1 })],
      asOf: T0,
      kind: 'order_size',
      scopeInstrument: BTC,
      bound: '2',
      observed: '2.5',
      excess: '0.5',
    },
    {
      // A 1.9 BTC buy at BTC 65000: order notional 123500 over the
      // 120000 cap (the order size 1.9 stays within 2).
      name: 'order_notional breach',
      portfolio: goldenPortfolio(),
      marketEvents: btcEthMarket('65000.00', '3000.00', T0 - 500),
      fills: [fillOf({ fillId: 'xsf-r-on-1', instrument: BTC, aggressorSide: 'buy', price: '65000.00', aggressorPrice: '65000.00', quantity: '1.9', takerFee: '0', eventTime: T0, sequence: 1 })],
      asOf: T0,
      kind: 'order_notional',
      scopeInstrument: BTC,
      bound: '120000',
      observed: '123500',
      excess: '3500',
    },
    {
      // 3.5 BTC held over the position-size cap 3 (no fills — the
      // position measures breach without any order measure).
      name: 'position_size breach',
      portfolio: portfolioOf({
        stateId: 'ps:t020-ps-breach',
        positions: [
          { instrumentId: BTC, quantity: '3.5', costBasis: '140000', openedAt: T0 - 100_000 },
          { instrumentId: ETH, quantity: '2', costBasis: '6000', openedAt: T0 - 100_000 },
        ],
        weights: [{ instrumentId: BTC, weight: '0.9', markSource: 'last_trade' }],
        cash: '100000',
        asOf: T0 - 1_000,
      }),
      marketEvents: btcEthMarket('50000.00', '3000.00', T0 - 500),
      fills: [],
      asOf: T0,
      kind: 'position_size',
      scopeInstrument: BTC,
      bound: '3',
      observed: '3.5',
      excess: '0.5',
    },
    {
      // 2.5 BTC held at BTC 65000: position notional 162500 over the
      // 150000 cap (the size 2.5 stays within 3).
      name: 'position_notional breach',
      portfolio: portfolioOf({
        stateId: 'ps:t020-pn-breach',
        positions: [
          { instrumentId: BTC, quantity: '2.5', costBasis: '100000', openedAt: T0 - 100_000 },
          { instrumentId: ETH, quantity: '2', costBasis: '6000', openedAt: T0 - 100_000 },
        ],
        weights: [{ instrumentId: BTC, weight: '0.9', markSource: 'last_trade' }],
        cash: '100000',
        asOf: T0 - 1_000,
      }),
      marketEvents: btcEthMarket('65000.00', '3000.00', T0 - 500),
      fills: [],
      asOf: T0,
      kind: 'position_notional',
      scopeInstrument: BTC,
      bound: '150000',
      observed: '162500',
      excess: '12500',
    },
    {
      // A single-instrument book: BTC 2.5 at 50000 is the whole gross —
      // concentration 1 over the 0.9 cap (the ONLY breaching kind).
      name: 'concentration breach',
      portfolio: portfolioOf({
        stateId: 'ps:t020-conc-breach',
        positions: [{ instrumentId: BTC, quantity: '2.5', costBasis: '100000', openedAt: T0 - 100_000 }],
        weights: [{ instrumentId: BTC, weight: '1', markSource: 'last_trade' }],
        cash: '100000',
        asOf: T0 - 1_000,
      }),
      marketEvents: btcOnlyMarket('50000.00', T0 - 500),
      fills: [],
      asOf: T0,
      kind: 'concentration',
      scopeInstrument: BTC,
      bound: '0.9',
      observed: '1',
      excess: '0.1',
    },
    {
      // A margin buy: 10000 cash, BTC 1 + ETH 2.78 held; buy 2 BTC at
      // aggressor 50010 fee 10 -> cash -90030, gross 169460, equity
      // 79430, leverage 169460/79430 = 2.133451 over the 1.5 cap (the
      // ONLY breaching kind — BTC concentration 150000/169460 = 0.885
      // stays within 0.9; every class cap holds).
      name: 'leverage breach',
      portfolio: portfolioOf({
        stateId: 'ps:t020-lev-breach',
        positions: [
          { instrumentId: BTC, quantity: '1', costBasis: '50000', openedAt: T0 - 100_000 },
          { instrumentId: ETH, quantity: '2.78', costBasis: '19460', openedAt: T0 - 100_000 },
        ],
        weights: [{ instrumentId: BTC, weight: '0.6', markSource: 'last_trade' }],
        cash: '10000',
        asOf: T0 - 1_000,
      }),
      marketEvents: btcEthMarket('50000.00', '7000.00', T0 - 500),
      fills: [fillOf({ fillId: 'xsf-r-lev-1', instrument: BTC, aggressorSide: 'buy', price: '50000.00', aggressorPrice: '50010.00', quantity: '2', takerFee: '10.00', eventTime: T0, sequence: 1 })],
      asOf: T0,
      kind: 'leverage',
      scopeInstrument: null,
      bound: '1.5',
      observed: '2.133451',
      excess: '0.633451',
    },
  ]);
}

/** The golden scenario's step-2 drawdown breach evidence (the threaded high-water mark's breach). */
export const GOLDEN_DRAWDOWN_BREACH: Readonly<{ readonly kind: 'drawdown'; readonly bound: string; readonly observed: string; readonly excess: string }> = deepFreeze({
  kind: 'drawdown',
  bound: '10000',
  observed: '11200',
  excess: '1200',
});
