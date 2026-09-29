// @tradrl/risk — shared test fixtures (internal test support; NOT exported
// from the package index — the contract surface stays clean).
//
// The fixtures mirror the discipline of the sibling packages' test suites:
// hand-assembled records that are VALID by construction (the unwrap helper
// fails loudly if a fixture drifts from the contract), with override-based
// variants for the negative paths.
//
// THE GOLDEN SCENARIO (the numbers the whole suite reasons over — every
// value below was hand-computed exactly):
//   Portfolio: BTC-USD 0.8 + ETH-USD 2 held on REFSIM, cash 100000.
//   Market: BTC 50000 / ETH 3000 (the last trade prints).
//   Fill: buy 0.2 BTC, aggressor price 50010.00 (slippage), taker fee 20.00.
//   Exposure: BTC position 1 (notional 50000), ETH 2 (6000), gross 56000,
//   cash 100000 - (0.2 x 50010 + 20) = 89978, equity 145978, peak 145978
//   (no prior), drawdown 0. All limits within under the reference policy.

import { deepFreeze } from './primitives';
import type { ConstraintSetMirror } from './control-mirror';
import type { PortfolioStateMirror } from './portfolio-mirror';
import type { FillMirror } from './fill-mirror';
import type { MarketEventMirror } from './market-mirror';
import type { RiskPolicy } from './policy';
import { validateRiskPolicy } from './policy';
import { compileRiskPolicy } from './compile';
import type { RiskResult } from './errors';

/** The fixture clock base (explicit literals — no ambient clock). */
export const T0 = 1_700_000_000_000;

/** The fixture scope. */
export const TENANT = 'tenant-alpha';
export const PROJECT = 'project-one';

/** The fixture lineage refs. */
export const GOAL = { goalId: 'goal-fixture', version: 1 } as const;
export const CONSTRAINT_SET_REF = { id: 'cs-risk-fixture', version: 1 } as const;
export const SEED = 't020-seed';

/** Unwrap a fixture result or fail loudly (fixtures are valid by construction). */
export function unwrap<T>(result: RiskResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// The risk-bearing constraint set (the compilation source)
// ---------------------------------------------------------------------------

/**
 * The reference constraint set: every limit kind declared — the four
 * class kinds (the unqualified subjects compile to the '*' catch-all;
 * the `.crypto`-qualified ones to the named class), plus concentration,
 * drawdown and leverage. All blocking; the class-kind caps are 'action'
 * domain, the portfolio kinds 'state' domain.
 */
export function fixtureConstraintSet(): ConstraintSetMirror {
  return deepFreeze({
    id: 'cs-risk-fixture',
    version: 1,
    tenantId: TENANT,
    name: 'reference risk constraints',
    createdAt: (T0 - 60_000) as never,
    constraints: [
      { id: 'c-order-size-all', domain: 'action', subject: 'risk.order_size', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking', description: 'max single order size, all classes' },
      { id: 'c-order-notional-all', domain: 'action', subject: 'risk.order_notional', predicate: { kind: 'limit.max', bound: 60000 }, severity: 'blocking' },
      { id: 'c-position-size-all', domain: 'state', subject: 'risk.position_size', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking' },
      { id: 'c-position-notional-all', domain: 'state', subject: 'risk.position_notional', predicate: { kind: 'limit.max', bound: 110000 }, severity: 'blocking' },
      { id: 'c-order-size-crypto', domain: 'action', subject: 'risk.order_size.crypto', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking' },
      { id: 'c-order-notional-crypto', domain: 'action', subject: 'risk.order_notional.crypto', predicate: { kind: 'limit.max', bound: 120000 }, severity: 'blocking' },
      { id: 'c-position-size-crypto', domain: 'state', subject: 'risk.position_size.crypto', predicate: { kind: 'limit.max', bound: 3 }, severity: 'blocking' },
      { id: 'c-position-notional-crypto', domain: 'state', subject: 'risk.position_notional.crypto', predicate: { kind: 'limit.max', bound: 150000 }, severity: 'blocking' },
      { id: 'c-concentration', domain: 'state', subject: 'risk.concentration', predicate: { kind: 'limit.max', bound: 0.9 }, severity: 'blocking' },
      { id: 'c-drawdown', domain: 'state', subject: 'risk.drawdown', predicate: { kind: 'limit.max', bound: 10000 }, severity: 'blocking' },
      { id: 'c-leverage', domain: 'state', subject: 'risk.leverage', predicate: { kind: 'limit.max', bound: 1.5 }, severity: 'blocking' },
    ],
  } as unknown as ConstraintSetMirror);
}

/** Compile the reference policy from the reference constraint set (version 1). */
export function fixturePolicy(): RiskPolicy {
  return unwrap(
    compileRiskPolicy({
      constraintSet: fixtureConstraintSet(),
      goal: GOAL,
      tenant: TENANT as never,
      project: PROJECT as never,
      asOf: (T0 - 50_000) as never,
      ratioPrecision: 6,
    }),
  );
}

/** A hand-declared policy input (the non-compiled shape — negative-path base). */
export function fixturePolicyInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    version: 1,
    supersedes: null,
    tenant: TENANT,
    project: PROJECT,
    goal: GOAL,
    constraintSet: CONSTRAINT_SET_REF,
    classLimits: [
      { instrumentClass: 'crypto', maxOrderSize: '2', maxOrderNotional: '120000', maxPositionSize: '3', maxPositionNotional: '150000' },
      { instrumentClass: '*', maxOrderSize: '1', maxOrderNotional: '60000', maxPositionSize: '2', maxPositionNotional: '110000' },
    ],
    concentration: { maxConcentrationRatio: '0.9', ratioPrecision: 6 },
    drawdown: { maxDrawdown: '10000' },
    leverage: { maxLeverageRatio: '1.5', ratioPrecision: 6 },
    compiledFrom: ['c-order-size-crypto', 'c-concentration'],
    asOf: T0 - 50_000,
  };
  return { ...base, ...overrides };
}

/** Validate a hand-declared policy (the unwrap-or-throw test helper). */
export function validateFixturePolicy(input: Record<string, unknown>): RiskResult<RiskPolicy> {
  return validateRiskPolicy(input);
}

// ---------------------------------------------------------------------------
// The portfolio-state fixture (the exposure computation's facts)
// ---------------------------------------------------------------------------

/** The golden portfolio: BTC 0.8 + ETH 2 held, cash 100000. */
export function fixturePortfolio(overrides: Record<string, unknown> = {}): PortfolioStateMirror {
  const base = {
    stateId: 'ps:t020golden',
    positions: [
      { instrumentId: 'BTC-USD', venueId: 'REFSIM', quantity: '0.8', costBasis: '40000', openedAt: T0 - 100_000 },
      { instrumentId: 'ETH-USD', venueId: 'REFSIM', quantity: '2', costBasis: '6000', openedAt: T0 - 100_000 },
    ],
    weights: [
      { instrumentId: 'BTC-USD', weight: '0.4', markSource: 'last_trade' },
      { instrumentId: 'ETH-USD', weight: '0.06', markSource: 'last_trade' },
    ],
    cash: '100000',
    realizedPnl: '0',
    unrealizedPnl: '0',
    asOf: T0 - 1_000,
    lineage: {
      strategy: { specId: 'spec-fixture', version: 1 },
      goal: { goalId: 'goal-fixture', version: 1 },
      constraintSet: { id: 'cs-risk-fixture', version: 1 },
      windowId: 'win-fixture-1',
      seed: SEED,
      tenant: TENANT,
      project: PROJECT,
    },
  } as unknown as PortfolioStateMirror;
  return { ...base, ...overrides } as unknown as PortfolioStateMirror;
}

// ---------------------------------------------------------------------------
// The market-event fixtures (the declared inputs — market-protocol mirrors)
// ---------------------------------------------------------------------------

/** A simulated-origin trade event on (venue, instrument) at `price`. */
export function fixtureTradeEvent(overrides: {
  readonly eventId: string;
  readonly venue: string;
  readonly instrument: string;
  readonly price: string;
  readonly sequence: number;
  readonly eventTime?: number;
}): MarketEventMirror {
  const eventTime = overrides.eventTime ?? T0 - 500;
  return deepFreeze({
    event_id: overrides.eventId,
    venue: overrides.venue,
    instrument: overrides.instrument,
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: eventTime,
    source_time: null,
    available_time: eventTime,
    ingestion_time: eventTime,
    sequence: overrides.sequence,
    provider: 'refsim-feed',
    provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
    payload: { price: overrides.price, size: '0.1', side: 'buy' },
  } as unknown as MarketEventMirror);
}

/** The golden market events: BTC 50000 + ETH 3000 trade prints. */
export function fixtureMarketEvents(): readonly MarketEventMirror[] {
  return [
    fixtureTradeEvent({ eventId: 'ev-btc-1', venue: 'REFSIM', instrument: 'BTC-USD', price: '50000.00', sequence: 1 }),
    fixtureTradeEvent({ eventId: 'ev-eth-1', venue: 'REFSIM', instrument: 'ETH-USD', price: '3000.00', sequence: 2 }),
  ];
}

// ---------------------------------------------------------------------------
// The fill fixture (the exposure input's execution evidence)
// ---------------------------------------------------------------------------

/** The golden fill: buy 0.2 BTC at aggressor 50010.00 with a 20.00 taker fee. */
export function fixtureFill(overrides: Record<string, unknown> = {}): FillMirror {
  const base = {
    fill_id: 'xsf-00000001',
    trade_id: 'xsf-00000001',
    venue: 'REFSIM',
    instrument: 'BTC-USD',
    quartet: { event_time: T0, source_time: null, available_time: T0 + 500, ingestion_time: T0 },
    sequence: 1,
    taker_order_id: 'xo-000001',
    maker_order_id: 'xo-000000',
    aggressor_side: 'buy',
    price: '50000.00',
    aggressor_price: '50010.00',
    quantity: '0.2',
    taker_fee: '20.00',
    maker_fee: '10.00',
    latency_ms: 500,
  } as unknown as FillMirror;
  return { ...base, ...overrides } as unknown as FillMirror;
}

// ---------------------------------------------------------------------------
// The kill-switch log builder (the T019 derivations, hand-rolled)
// ---------------------------------------------------------------------------

import { canonicalJson, fnv1a32Hex } from './primitives';
import type { KillSwitchLogMirror, KillSwitchRecordMirror } from './killswitch-mirror';

/**
 * Build a mirror switch log by hand using the SAME derivations
 * execution-policy mints with (chain head = fnv(prev + canonical(content));
 * record id = ksr: + fnv(head + canonical(content)); switch id = ksw: +
 * fnv(canonical(genesis content))) — so the hand-built log verifies under
 * `verifyKillSwitchChainMirror` exactly like a REAL T019 log (the interop
 * test proves the real-log case).
 */
export function buildSwitchLog(
  entries: readonly { readonly state: 'standing' | 'thrown'; readonly reason?: string; readonly thrownAt?: number; readonly asOf: number }[],
): KillSwitchLogMirror {
  const records: KillSwitchRecordMirror[] = [];
  let previousHead = 'ksw-genesis';
  entries.forEach((entry, index) => {
    const content = {
      sequence: index + 1,
      state: entry.state,
      reason: entry.state === 'thrown' ? (entry.reason ?? 'circuit breaker') : null,
      thrownAt: entry.state === 'thrown' ? (entry.thrownAt ?? T0) : null,
      tenant: TENANT,
      project: PROJECT,
      asOf: entry.asOf,
    };
    const chainHead = fnv1a32Hex(`${previousHead}${canonicalJson(content)}`);
    records.push(deepFreeze({
      ...content,
      recordId: `ksr:${fnv1a32Hex(`${chainHead}${canonicalJson(content)}`)}`,
      chainHead,
    }) as KillSwitchRecordMirror);
    previousHead = chainHead;
  });
  const genesis = records[0] as KillSwitchRecordMirror;
  const genesisContent = {
    sequence: genesis.sequence,
    state: genesis.state,
    reason: genesis.reason,
    thrownAt: genesis.thrownAt,
    tenant: genesis.tenant,
    project: genesis.project,
    asOf: genesis.asOf,
  };
  return deepFreeze({ switchId: `ksw:${fnv1a32Hex(canonicalJson(genesisContent))}`, records } as unknown as KillSwitchLogMirror);
}

/** A STANDING switch log for the fixture scope (the armed genesis). */
export function fixtureStandingSwitch(): KillSwitchLogMirror {
  return buildSwitchLog([{ state: 'standing', asOf: T0 - 2_000 }]);
}

/** A THROWN switch log for the fixture scope (genesis then throw). */
export function fixtureThrownSwitch(): KillSwitchLogMirror {
  return buildSwitchLog([
    { state: 'standing', asOf: T0 - 2_000 },
    { state: 'thrown', reason: 'risk desk circuit breaker', thrownAt: T0 - 100, asOf: T0 - 100 },
  ]);
}
