// @tradrl/example-e2e-trading — STAGE 8: STRATEGY / PORTFOLIO (T018).
//
// Portfolio construction over the director's directive: base allocation
// (equal weight) + the director's target-allocation deltas, drift-gated
// rebalancing with exact decimal quantities floored to the lot grid and
// capped by available cash, limit-price discipline tick-floored at the
// point-in-time mark, and the constraint gate run BEFORE emission
// (blocking violations are IntentRefusal records — constraint primacy).
// The intent records are the T019/T040 gate's input shape; the interop
// test pushes them through the REAL `validateStrategyIntent`.

import {
  add, compare, divideRoundHalfUp, floorToGrid, multiply, signedSubtract, subtract, sum as sumOf,
} from './decimals';
import { canonicalJson, deepFreeze, fnv1a32Hex, type JsonValue } from './primitives';
import { fail, ok, type ExampleResult, type ExampleError } from './errors';
import type {
  AccountFillMirror, ConstraintSetStatementMirror, GoalStatementMirror,
  ObservationWindowMirror, PortfolioStateMirror, PortfolioWeightMirror, PositionRecordMirror,
  StrategyLineageMirror, ConstraintCheckMirror,
} from './mirrors/control';
import { runConstraintGateMirror } from './mirrors/control';
import type {
  StrategyIntentMirror, StrategyRunMirror, StrategySpecMirror, IntentRefusalMirror,
  StrategyRunInputMirror,
} from './mirrors/strategy';
import type { DirectorDecisionMirror } from './mirrors/director';

const PRECISION = 8;

export function streamKey(venue: string, instrument: string): string {
  return `${venue}|${instrument}`;
}

// ---------------------------------------------------------------------------
// Portfolio state construction + transitions
// ---------------------------------------------------------------------------

export function initialPortfolioState(
  lineage: StrategyLineageMirror,
  cash: string,
  asOf: number,
): PortfolioStateMirror {
  const content = {
    positions: [],
    weights: [],
    cash,
    realizedPnl: '0',
    unrealizedPnl: '0',
    asOf,
    lineage,
  };
  return deepFreeze({
    ...content,
    stateId: `ps:${fnv1a32Hex(canonicalJson(content as unknown as JsonValue))}`,
  } as PortfolioStateMirror);
}

export function portfolioStateIdOf(content: Omit<PortfolioStateMirror, 'stateId'>): string {
  return `ps:${fnv1a32Hex(canonicalJson(content as unknown as JsonValue))}`;
}

export function computeWeights(
  positions: readonly PositionRecordMirror[],
  cash: string,
  marks: ReadonlyMap<string, { price: string; source: 'last_trade' | 'mid_quote' } | null>,
): readonly PortfolioWeightMirror[] {
  const notionals = positions.map((position) => multiply(position.quantity, marks.get(streamKey(position.venueId, position.instrumentId))?.price ?? '0'));
  const gross = add(cash, sumOf(notionals));
  if (compare(gross, '0') <= 0) {
    return positions.map((position) => ({ instrumentId: position.instrumentId, weight: '0', markSource: marks.get(streamKey(position.venueId, position.instrumentId))?.source ?? 'last_trade' }));
  }
  return positions.map((position, index) => ({
    instrumentId: position.instrumentId,
    weight: divideRoundHalfUp(notionals[index]!, gross, PRECISION),
    markSource: marks.get(streamKey(position.venueId, position.instrumentId))?.source ?? 'last_trade',
  }));
}

/** Applies account fills to a portfolio state (the T018 event law, mirrored). */
export function applyAccountFills(
  state: PortfolioStateMirror,
  fills: readonly AccountFillMirror[],
  asOf: number,
): ExampleResult<PortfolioStateMirror> {
  let cash = state.cash;
  let realizedPnl = state.realizedPnl;
  const positions: PositionRecordMirror[] = state.positions.map((position) => ({ ...position }));
  for (const fill of [...fills].sort((a, b) => a.event_time - b.event_time || (a.fill_id < b.fill_id ? -1 : 1))) {
    const index = positions.findIndex((position) => position.instrumentId === fill.instrument && position.venueId === fill.venue);
    const notional = multiply(fill.quantity, fill.price);
    if (fill.side === 'buy') {
      const outflow = add(notional, fill.fee);
      if (compare(cash, outflow) < 0) {
        return fail('invalid_state', `fill ${fill.fill_id} overdrafts cash (${cash} < ${outflow}) — the gate should have refused this`, 'fills');
      }
      cash = subtract(cash, outflow);
      if (index >= 0) {
        const existing = positions[index]!;
        positions[index] = { ...existing, quantity: add(existing.quantity, fill.quantity), costBasis: add(existing.costBasis, outflow) };
      } else {
        positions.push({ instrumentId: fill.instrument, venueId: fill.venue, quantity: fill.quantity, costBasis: outflow, openedAt: fill.event_time });
      }
    } else {
      if (index < 0) {
        return fail('invalid_state', `sell fill ${fill.fill_id} with no position — a fabricated sale`, 'fills');
      }
      const existing = positions[index]!;
      if (compare(existing.quantity, fill.quantity) < 0) {
        return fail('invalid_state', `sell fill ${fill.fill_id} exceeds held quantity`, 'fills');
      }
      const costShare = divideRoundHalfUp(multiply(existing.costBasis, fill.quantity), existing.quantity, PRECISION);
      realizedPnl = add(realizedPnl, signedSubtract(subtract(notional, fill.fee), costShare));
      cash = add(cash, subtract(notional, fill.fee));
      const remaining = subtract(existing.quantity, fill.quantity);
      if (remaining === '0') {
        positions.splice(index, 1);
      } else {
        positions[index] = { ...existing, quantity: remaining, costBasis: subtract(existing.costBasis, costShare) };
      }
    }
  }
  const content = {
    positions,
    weights: [],
    cash,
    realizedPnl,
    unrealizedPnl: '0',
    asOf,
    lineage: state.lineage,
  };
  return ok(deepFreeze({
    ...content,
    stateId: portfolioStateIdOf(content),
  } as PortfolioStateMirror));
}

// ---------------------------------------------------------------------------
// The run compiler
// ---------------------------------------------------------------------------

export interface StrategyCompileOutcome {
  readonly run: StrategyRunMirror;
  /** The refusals emitted for constraint-blocked candidates. */
  readonly refusals: readonly IntentRefusalMirror[];
}

export function compileStrategyRun(input: StrategyRunInputMirror): ExampleResult<StrategyCompileOutcome> {
  const { spec, state, window, constraintSet, goal, seed, directorDecision } = input;
  const errors: ExampleError[] = [];
  if (spec.tenant !== state.lineage.tenant || goal.tenantId !== spec.tenant) {
    return fail('tenant_mismatch', 'spec, goal and portfolio state must share ONE tenant (L12)', 'tenant');
  }
  if (spec.goal !== goal.id) {
    return fail('lineage_gap', `spec binds goal ${spec.goal} but the run received ${goal.id}`, 'spec.goal');
  }
  if (state.lineage.goal.goalId !== goal.id || state.lineage.constraintSet.id !== constraintSet.id) {
    return fail('lineage_gap', 'portfolio state lineage must bind the same goal/constraint set as the run (L9)', 'state.lineage');
  }
  void directorDecision;
  if (window.asOf < 0) {
    errors.push({ code: 'invalid_field', path: 'window.asOf', message: 'the window as-of must equal the director decision instant (L16 strategic clock)' });
  }
  if (errors.length > 0) return { ok: false, errors };

  // Marks over the universe (fail-closed).
  const marks = new Map<string, { price: string; source: 'last_trade' | 'mid_quote' }>();
  for (const entry of spec.universe) {
    let mark: { price: string; source: 'last_trade' | 'mid_quote' } | null = null;
    let lastTrade: { price: string; time: number } | null = null;
    let lastQuote: { bid: string; ask: string; time: number } | null = null;
    for (const event of window.events) {
      if (event.venue !== entry.venueId || event.instrument !== entry.instrumentId) continue;
      if (event.event_type === 'trade') {
        if (!lastTrade || event.event_time >= lastTrade.time) lastTrade = { price: event.payload.price, time: event.event_time };
      } else {
        if (!lastQuote || event.event_time >= lastQuote.time) lastQuote = { bid: event.payload.bid_price, ask: event.payload.ask_price, time: event.event_time };
      }
    }
    if (lastTrade) mark = { price: lastTrade.price, source: 'last_trade' };
    else if (lastQuote) mark = { price: divideRoundHalfUp(add(lastQuote.bid, lastQuote.ask), '2', PRECISION), source: 'mid_quote' };
    if (!mark) {
      return fail('observation_gap', `no mark for ${entry.instrumentId} in window ${window.window_id} — the strategy refuses to decide unmarked (L4)`, `marks.${entry.instrumentId}`);
    }
    marks.set(streamKey(entry.venueId, entry.instrumentId), mark);
  }

  // Base target weights + the director overlay.
  const baseWeights = new Map<string, string>();
  if (spec.allocation.kind === 'equal_weight') {
    for (const entry of spec.universe) {
      baseWeights.set(entry.instrumentId, divideRoundHalfUp('1', String(spec.universe.length), PRECISION));
    }
  } else {
    for (const entry of spec.allocation.weights) baseWeights.set(entry.instrumentId, entry.weight);
  }
  const targets = new Map<string, string>();
  for (const entry of spec.universe) {
    const base = baseWeights.get(entry.instrumentId) ?? '0';
    const adjustment =
      directorDecision.directive.kind === 'allocation-adjustment'
        ? directorDecision.directive.adjustments.find((a) => a.instrumentId === entry.instrumentId)?.deltaWeight
        : undefined;
    const tilted = adjustment === undefined ? base : add(base, adjustment);
    targets.set(entry.instrumentId, compare(tilted, '0') < 0 ? '0' : tilted);
  }

  // Current weights + equity.
  const notionals = state.positions.map((position) => ({
    position,
    notional: multiply(position.quantity, marks.get(streamKey(position.venueId, position.instrumentId))!.price),
  }));
  const grossNotional = sumOf(notionals.map((entry) => entry.notional));
  const equity = add(state.cash, grossNotional);
  const currentWeights = new Map<string, string>();
  for (const entry of spec.universe) {
    const notional = notionals.find((candidate) => candidate.position.instrumentId === entry.instrumentId)?.notional ?? '0';
    currentWeights.set(entry.instrumentId, compare(equity, '0') > 0 ? divideRoundHalfUp(notional, equity, PRECISION) : '0');
  }

  const band = spec.rebalancing.band ?? '0';
  const intents: StrategyIntentMirror[] = [];
  const refusals: IntentRefusalMirror[] = [];
  let intentSequence = 0;
  let refusalSequence = 0;
  // The buy discipline (the real run compiler's law): buys are capped by
  // the REMAINING cash, threaded across the universe in order — a
  // strategy never emits intents it cannot pay for.
  let availableCash = state.cash;

  for (const entry of spec.universe) {
    const target = targets.get(entry.instrumentId)!;
    const current = currentWeights.get(entry.instrumentId)!;
    const drift = signedSubtract(target, current);
    const driftMagnitude = drift.startsWith('-') ? drift.slice(1) : drift;
    if (compare(driftMagnitude, band) <= 0) continue;
    if (compare(drift, '0') === 0) continue;

    const mark = marks.get(streamKey(entry.venueId, entry.instrumentId))!;
    const heldQuantity = state.positions.find((position) => position.instrumentId === entry.instrumentId)?.quantity ?? '0';
    const reason: 'initial_allocation' | 'rebalance_drift' =
      current === '0' && heldQuantity === '0' ? 'initial_allocation' : 'rebalance_drift';
    let side: 'buy' | 'sell';
    let quantity: string;
    if (compare(drift, '0') > 0) {
      side = 'buy';
      const cashCap = divideRoundHalfUp(availableCash, mark.price, PRECISION);
      const capped = compare(quantityGapOf(drift, equity, mark.price), cashCap) <= 0 ? quantityGapOf(drift, equity, mark.price) : cashCap;
      quantity = floorToGrid(capped, entry.lotSize);
      if (compare(quantity, '0') <= 0) continue;
      availableCash = subtract(availableCash, multiply(quantity, mark.price));
    } else {
      side = 'sell';
      const rawQuantity = quantityGapOf(drift, equity, mark.price);
      const capped = compare(rawQuantity, heldQuantity) <= 0 ? rawQuantity : heldQuantity;
      quantity = floorToGrid(capped, entry.lotSize);
      if (compare(quantity, '0') <= 0) continue;
    }

    const limitPrice = floorToGrid(mark.price, entry.tickSize);
    const notional = multiply(quantity, limitPrice);
    const clientOrderId = `si-${spec.specId}-${spec.version}-${window.window_id}-${entry.instrumentId}-${side}`;

    // THE CONSTRAINT GATE — before emission (constraint primacy).
    const context = {
      observation: {
        'window.trades': window.events.filter((event) => event.event_type === 'trade').length,
        'window.quotes': window.events.filter((event) => event.event_type === 'quote').length,
        'window.asOf': window.asOf,
      },
      state: {
        'state.cash': Number(state.cash),
        'state.universe': spec.universe.length,
        'state.asOf': state.asOf,
        [`state.position.${entry.instrumentId}.quantity`]: Number(heldQuantity),
        [`state.weight.${entry.instrumentId}`]: Number(current),
        [`state.mark.${entry.instrumentId}`]: Number(mark.price),
      },
      action: {
        'action.side': side,
        'action.instrument': entry.instrumentId,
        'action.quantity': Number(quantity),
        'action.notional': Number(notional),
      },
      outcome: {},
    };
    const report = runConstraintGateMirror(constraintSet, context);
    const advisoryViolations: ConstraintCheckMirror[] = report.checks.filter(
      (check) => check.status === 'violated' && check.severity === 'advisory',
    );

    const proof = {
      constraintSet: { id: constraintSet.id, version: constraintSet.version },
      satisfied: report.checks
        .filter((check) => check.status === 'satisfied')
        .map((check) => ({
          constraintId: check.constraintId,
          domain: check.domain,
          subject: check.subject,
          severity: check.severity,
          predicate: predicateOf(constraintSet, check.constraintId),
          observed: check.observed ?? 'not-applicable',
        })),
      advisoryViolations,
    };

    if (!report.pass) {
      refusals.push(deepFreeze({
        sequence: ++refusalSequence,
        cause: 'constraint_refused',
        violated: report.checks
          .filter((check) => check.status === 'violated' && check.severity === 'blocking')
          .map((check) => ({
            constraintId: check.constraintId,
            domain: check.domain,
            subject: check.subject,
            severity: check.severity,
            predicate: predicateOf(constraintSet, check.constraintId),
            observed: check.observed,
          })),
        candidate: { side, instrumentId: entry.instrumentId, venueId: entry.venueId, quantity },
        goal: { goalId: goal.id, version: goal.version },
        strategy: { specId: spec.specId, version: spec.version },
        windowRefs: [window.window_id],
        seed,
        tenant: spec.tenant,
        project: spec.project,
        asOf: window.asOf,
      }));
      continue;
    }

    const content = {
      sequence: intentSequence + 1,
      order: {
        clientOrderId,
        instrumentId: entry.instrumentId,
        venueId: entry.venueId,
        side,
        kind: spec.priceDiscipline.kind === 'limit' ? 'limit' : 'market',
        quantity,
        ...(spec.priceDiscipline.kind === 'limit' ? { price: limitPrice } : {}),
        timeInForce: spec.priceDiscipline.kind === 'limit' ? 'gtc' : 'day',
        createdAt: new Date(window.asOf).toISOString(),
        notes: `director:${directorDecision.decisionId}`,
      },
      constraintProof: proof,
      goal: { goalId: goal.id, version: goal.version },
      strategy: { specId: spec.specId, version: spec.version },
      windowRefs: [window.window_id],
      seed,
      tenant: spec.tenant,
      project: spec.project,
      riskPolicyRefs: [...spec.riskPolicyRefs],
      rationale: {
        kind: reason,
        instrumentId: entry.instrumentId,
        targetWeight: target,
        currentWeight: current,
        drift,
      },
      asOf: window.asOf,
    };
    intents.push(deepFreeze({
      ...content,
      intentId: `si:${fnv1a32Hex(canonicalJson(content as unknown as JsonValue))}`,
    }));
    intentSequence += 1;
  }

  const runInputDigest = fnv1a32Hex(
    canonicalJson({
      spec: spec.specId, goal: goal.id, window: window.window_id, state: state.stateId,
      director: directorDecision.decisionId, seed,
    } as JsonValue),
  );
  const run: StrategyRunMirror = deepFreeze({
    runId: `strat:${runInputDigest}`,
    strategy: { specId: spec.specId, version: spec.version },
    goal: { goalId: goal.id, version: goal.version },
    constraintSet: { id: constraintSet.id, version: constraintSet.version },
    windowId: window.window_id,
    stateId: state.stateId,
    seed,
    tenant: spec.tenant,
    project: spec.project,
    asOf: window.asOf,
    intents,
    refusals,
    inputDigest: runInputDigest,
  });
  return ok({ run, refusals });
}

function predicateOf(set: ConstraintSetStatementMirror, constraintId: string): {
  readonly kind: string;
  readonly bound?: number;
  readonly min?: number;
  readonly max?: number;
  readonly value?: number | string | boolean;
  readonly values?: readonly string[];
  readonly expected?: boolean;
} {
  const constraint = set.constraints.find((candidate) => candidate.id === constraintId);
  if (!constraint) return { kind: 'unknown' };
  const predicate = constraint.predicate as { kind: string; bound?: number; min?: number; max?: number; value?: number | string | boolean; values?: readonly string[]; expected?: boolean };
  return { ...predicate };
}

/** Quantity gap of a weight drift at the mark (|drift| x equity / price). */
function quantityGapOf(drift: string, equity: string, markPrice: string): string {
  const dollar = multiply(drift.startsWith('-') ? drift.slice(1) : drift, equity);
  return divideRoundHalfUp(dollar, markPrice, PRECISION);
}

// ---------------------------------------------------------------------------
// The reference strategy spec
// ---------------------------------------------------------------------------

export function referenceStrategySpec(
  scenario: import('./scenario').TradingScenario,
  riskPolicyRef: string,
  organizationId: string,
  assignmentRefs: readonly string[],
): StrategySpecMirror {
  // The specId IS the declared principal (T019 identity check binds them).
  return deepFreeze({
    specId: scenario.policies.execution.principal,
    version: 1,
    tenant: scenario.tenant,
    project: scenario.project,
    goal: scenario.goal.id,
    name: 'Reference equal-weight + director tilt',
    universe: scenario.universe.map((entry) => ({
      instrumentId: entry.instrument, venueId: entry.venue, lotSize: entry.lotSize, tickSize: entry.tickSize,
    })),
    allocation: { kind: 'equal_weight' },
    rebalancing: { trigger: 'drift_band', band: '0.02', cadenceMs: 1_200_000 },
    priceDiscipline: { kind: 'limit', anchor: 'last_trade' },
    riskPolicyRefs: [riskPolicyRef],
    generators: [],
    decimalPrecision: PRECISION,
    organization: { organizationId, assignmentRefs },
    createdAt: scenario.epochMs,
    description: 'Equal-weight base with the Trading Director target-allocation overlay; drift band 2%; limit at last-trade mark.',
  });
}
