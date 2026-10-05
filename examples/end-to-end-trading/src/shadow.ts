/**
 * T048 — STATION 7: SHADOW TRADING + REALIZED OUTCOMES (T030).
 *
 * The REAL `createShadowSession` + `runShadowSession`: the paper lane
 * that paper-executes the strategy's BTC intent against the REACTIVE
 * WORLD (station 2's service, consumed through T030's injected
 * `ReactiveWorldPort`) with the FULL control stack (the same T019
 * policy + T020 risk policy as the live lane) enforced BEFORE any
 * submission — the L5/R23 mode separation: this lane is 'shadow', and
 * the same intent reaching the LIVE gateway was refused at stage 3.
 *
 * The session drives the world (settle -> submit -> settle), the
 * engine matches the order with the declared physics, the fills arrive
 * with their FULL PHYSICS LINEAGE, the exact-decimal shadow book
 * accounts them through the latency windows, and every decision —
 * filled, partial, expired, refused — lands in the chain-verified
 * ShadowOutcomeLog: T033's input surface, the slice's REALIZED
 * OUTCOMES.
 *
 * THE NEGATIVE PATHS: a cross-tenant intent (the control stack refuses
 * with ZERO world submissions) and the mode-honesty law ('live' is a
 * typed `fidelity_claim_dishonest` — the shadow lane cannot claim
 * live fidelity).
 */

import {
  createShadowSession,
  runShadowSession,
  verifyShadowOutcomeChain,
  shadowOutcomeDigest,
  type ShadowSession,
} from '../../../services/shadow-trading/src/index';
import type { StrategyIntentMirror } from '../../../packages/execution-policy/src/index';
import type { StrategyRun } from '../../../packages/trading-strategy/src/index';

import { BTC, GENESIS_CASH, PROJECT, SEED, STRATEGY_DECISION_AT, T0, TENANT, VENUE, unwrap } from './scope';
import { sliceExecutionPolicy, sliceKillSwitch, sliceRiskPolicy } from './control-stack';
import { CONSTRAINT_SET_ID, GOAL_ID, SPEC_ID, WINDOW_ID } from './strategy';
import { SHADOW_PARTICIPANT, buildReactiveWorld, sliceWorldSpec, type ReactiveWorldStation } from './reactive-world';
import type { EmittedEvent } from '../../../adapters/binance/src/index';

// ---------------------------------------------------------------------------
// The venue facts + the decision source
// ---------------------------------------------------------------------------

/** The shadow lane's venue state: the BTC mark the adapter printed, rate counters zero. */
function shadowVenueState(): Record<string, unknown> {
  return {
    asOf: T0,
    instruments: [{ venue: VENUE, instrument: BTC, instrumentClass: 'crypto', referencePrice: '50100.00', rateWindowOrderCount: 0 }],
  };
}

/** The risk lane's declared market events (the point-in-time pricing facts — the adapter's BTC prints). */
function shadowMarketEvents(): readonly Record<string, unknown>[] {
  return [
    {
      event_id: 'e2e-shadow-btc-2',
      venue: VENUE,
      instrument: BTC,
      asset_class: 'crypto',
      event_type: 'trade',
      event_time: T0 + 330_000,
      source_time: null,
      available_time: T0 + 330_000,
      ingestion_time: T0 + 330_000,
      sequence: 2,
      provider: 'adapter-binance',
      provenance: { origin: 'historical', adapter: { id: 'adapter-binance', version: '0.0.0' }, derived_from: [], transform: null },
      payload: { price: '62000.00', size: '0.10', side: 'buy' },
    },
    {
      event_id: 'e2e-shadow-btc-1',
      venue: VENUE,
      instrument: BTC,
      asset_class: 'crypto',
      event_type: 'trade',
      event_time: T0 + 20_000,
      source_time: null,
      available_time: T0 + 20_000,
      ingestion_time: T0 + 20_000,
      sequence: 1,
      provider: 'adapter-binance',
      provenance: { origin: 'historical', adapter: { id: 'adapter-binance', version: '0.0.0' }, derived_from: [], transform: null },
      payload: { price: '50100.00', size: '0.25', side: 'buy' },
    },
  ];
}

/** The async decision source over an explicit intent list (deterministic, in order). */
export function decisionSourceOf(intents: readonly unknown[]): AsyncIterator<unknown> {
  let cursor = 0;
  return {
    async next(): Promise<IteratorResult<unknown>> {
      if (cursor >= intents.length) return { done: true, value: undefined };
      const value = intents[cursor] as unknown;
      cursor += 1;
      return { done: false, value };
    },
  };
}

// ---------------------------------------------------------------------------
// The session construction + the run
// ---------------------------------------------------------------------------

/** Station 7's product: the finished session + the world station it drove. */
export interface ShadowLaneResult {
  readonly session: ShadowSession;
  readonly worldStation: ReactiveWorldStation;
}

/** The slice's shadow-session construction options (the negative paths' substrates). */
export interface SliceShadowSessionOptions {
  /** The mode declaration — 'shadow' (honest) or 'live' (the mode-honesty probe). */
  readonly mode?: 'shadow' | 'live';
}

/** One built slice session: a FRESH world + machine (the determinism law) + the creation RESULT. */
export interface SliceShadowSession {
  readonly worldStation: ReactiveWorldStation;
  /** The unwrapped creation result — the negative paths read the typed errors, the positives unwrap. */
  readonly created: ReturnType<typeof createShadowSession>;
}

/**
 * Build ONE slice shadow session over a FRESH reactive world + scripted
 * machine (identical inputs -> identical world evolution; the world is
 * single-episode-per-scope here) and the given decision source. Returns
 * the creation RESULT — the mode-honesty probe reads the typed errors;
 * the positive lanes unwrap. The injection seam the broken-link proofs
 * drive: any decision source (mangled, foreign, empty) rides the SAME
 * control stack.
 */
export async function buildSliceShadowSession(
  decisionSource: AsyncIterator<unknown>,
  binanceEvents: readonly EmittedEvent[],
  options: SliceShadowSessionOptions = {},
): Promise<SliceShadowSession> {
  const worldStation = await buildReactiveWorld(binanceEvents);
  const created = createShadowSession({
    mode: options.mode ?? 'shadow',
    tenant: TENANT,
    project: PROJECT,
    seed: SEED,
    participant: SHADOW_PARTICIPANT,
    world: worldStation.world,
    worldSpec: sliceWorldSpec(),
    timeMachine: worldStation.machine,
    cursorFrom: 'start',
    startAt: T0 as never,
    executionPolicy: sliceExecutionPolicy(),
    killSwitch: sliceKillSwitch(),
    risk: {
      policy: sliceRiskPolicy(),
      marketEvents: shadowMarketEvents(),
      quotePrecision: 8,
      priorPeakEquity: null,
    },
    genesisPortfolio: { positions: [], cash: GENESIS_CASH },
    venueState: shadowVenueState(),
    decisionSource,
    lineage: {
      strategy: { specId: SPEC_ID, version: 1 },
      goal: { goalId: GOAL_ID, version: 1 },
      constraintSet: { id: CONSTRAINT_SET_ID, version: 1 },
      windowId: WINDOW_ID,
    },
  });
  return { worldStation, created };
}

/**
 * Run the shadow lane: one session over the REAL reactive world + the
 * slice's scripted time machine, paper-executing the strategy run's
 * BTC intent (the world carries the BTC book; the ETH intent's venue
 * lane is the gateway's — documented).
 */
export async function runShadowLane(run: StrategyRun, step2Run: StrategyRun, binanceEvents: readonly EmittedEvent[]): Promise<ShadowLaneResult> {
  const btcIntent = run.intents.find((intent) => intent.order.instrumentId === BTC && intent.order.side === 'buy');
  const btcSellIntent = step2Run.intents.find((intent) => intent.order.instrumentId === BTC && intent.order.side === 'sell');
  if (btcIntent === undefined || btcSellIntent === undefined) {
    throw new Error('the strategy runs must carry the BTC buy and the BTC sell for the shadow lane');
  }

  const { worldStation, created } = await buildSliceShadowSession(decisionSourceOf([btcIntent, btcSellIntent]), binanceEvents);
  const session = unwrap(created, 'the shadow session must create');
  const finished = unwrap(await runShadowSession(session), 'the shadow session must run to exhaustion');
  return { session: finished, worldStation };
}

// ---------------------------------------------------------------------------
// The negative paths
// ---------------------------------------------------------------------------

/** The cross-tenant intent (a foreign tenant's decision in the slice's source — the L12 crime). */
export function crossTenantIntent(run: StrategyRun): StrategyIntentMirror {
  const intents: readonly StrategyIntentMirror[] = run.intents;
  const btcIntent = intents.find((intent) => intent.order.instrumentId === BTC);
  if (btcIntent === undefined) throw new Error('the strategy run must carry the BTC intent');
  return { ...btcIntent, intentId: 'si:e2e-cross-tenant', tenant: 'tenant-foreign' as never, order: { ...btcIntent.order, clientOrderId: 'e2e-cross-tenant' } };
}

/** The cross-tenant negative's evidence: the typed failure + the untouched world. */
export interface CrossTenantRefusal {
  /** The typed error codes (the collect-all refusal — `tenant_mismatch` first). */
  readonly codes: readonly string[];
  /** The failure's message (the crime is NAMED, never absorbed). */
  readonly message: string;
  /** The session's submission count: the world received NOTHING. */
  readonly worldSubmissions: number;
}

/**
 * Run the cross-tenant negative: a foreign tenant's intent in the decision
 * source fails the WHOLE run closed (the T030 law — a cross-tenant decision
 * is an operational crime, inexpressible, never evidence), with ZERO world
 * submissions along the way.
 */
export async function runCrossTenantRefusal(run: StrategyRun, binanceEvents: readonly EmittedEvent[]): Promise<CrossTenantRefusal> {
  const { created } = await buildSliceShadowSession(decisionSourceOf([crossTenantIntent(run)]), binanceEvents);
  if (!created.ok) {
    throw new Error(`the cross-tenant session must create: ${created.errors.map((error) => `${error.code}: ${error.message}`).join('; ')}`);
  }
  const session = created.value;
  const outcome = await runShadowSession(session);
  if (outcome.ok) {
    throw new Error('the cross-tenant run must FAIL CLOSED — a foreign decision ran as evidence (L12 is broken)');
  }
  return {
    codes: outcome.errors.map((error) => error.code),
    message: outcome.errors[0]?.message ?? '',
    worldSubmissions: session.submissions.length,
  };
}

/** The mode-honesty probe: creating a session that claims 'live' is the typed `fidelity_claim_dishonest`. */
export async function liveModeClaimRefusal(binanceEvents: readonly EmittedEvent[]): Promise<readonly string[]> {
  const { created } = await buildSliceShadowSession(decisionSourceOf([]), binanceEvents, { mode: 'live' });
  if (created.ok) {
    throw new Error("a 'live' session must NOT create — the mode-honesty law is broken");
  }
  return created.errors.map((error) => error.code);
}

// ---------------------------------------------------------------------------
// The realized-outcome summary
// ---------------------------------------------------------------------------

/** The realized-outcome summary: the slice's final product (T033's input surface, folded). */
export interface RealizedOutcomeSummary {
  /** The outcome log's record count. */
  readonly outcomes: number;
  /** The fills accounted into the shadow book. */
  readonly fills: number;
  /** The refusals (typed records — the control stack's evidence). */
  readonly refusals: number;
  /** The dispositions, in emission order. */
  readonly dispositions: readonly string[];
  /** The final paper book (positions + cash + realized PnL). */
  readonly book: { readonly positions: readonly { readonly instrument: string; readonly quantity: string; readonly costBasis: string }[]; readonly cash: string; readonly realizedPnl: string };
  /** The chain-verified outcome log's digest (byte-stable). */
  readonly outcomeDigest: string;
}

/** Fold the finished session into the realized-outcome summary. */
export function realizedOutcomes(session: ShadowSession): RealizedOutcomeSummary {
  if (!verifyShadowOutcomeChain(session.outcomeLog)) {
    throw new Error('the outcome chain must verify');
  }
  return {
    outcomes: session.outcomeLog.records.length,
    fills: session.fills.length,
    refusals: session.refusals.length,
    dispositions: session.outcomeLog.records.map((record) => record.disposition),
    book: {
      positions: session.book.positions.map((position) => ({ instrument: position.instrument, quantity: position.quantity, costBasis: position.costBasis })),
      cash: session.book.cash,
      realizedPnl: session.book.realizedPnl,
    },
    outcomeDigest: shadowOutcomeDigest(session.outcomeLog),
  };
}
