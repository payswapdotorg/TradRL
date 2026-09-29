// @tradrl/trading-strategy — the compiled strategy run.
//
// `compileStrategyRun` is the STRATEGY half of the core flow's arrow
// (spec/ARCHITECTURE.md: "Research/Learning -> Strategy/Portfolio/Risk
// -> Execution"): it compiles a strategy spec + a portfolio state + an
// observation window + a constraint set + a seed into the tradable
// intent sequence — the auditable bridge between "the organization has
// learned something" and "an order request exists".
//
// THE COMPILATION (pure, deterministic, fail-closed):
//
//   (StrategySpec, PortfolioState, ObservationWindow,
//    ConstraintSetStatementMirror, GoalStatementMirror, seed)
//       -> compileStrategyRun -> StrategyRun
//
//   1. VALIDATION — the spec, state, window, constraint set and goal
//      are validated through their collect-all validators; the goal's
//      tenant must equal the spec's tenant AND the constraint set's
//      tenant (L12 — cross-tenant compilation is a typed
//      `tenant_missing` error); the state's lineage strategy/goal/
//      constraint-set refs must agree with the run's inputs (L9 — a
//      state from another decision context is a `lineage_gap`); every
//      position must be inside the spec universe (`universe_violation`).
//   2. MARKS — the window must price every universe instrument
//      (`observation_gap` otherwise — never best-effort pricing).
//   3. TARGETS — the declared allocation policy derives the target
//      weights (spec.ts `targetWeights`: weights FROM observations).
//   4. DECISIONS — the declared rebalancing policy derives the CANDIDATE
//      actions: under `drift_band`, an instrument rebalances when
//      |current - target| EXCEEDS the band (strictly — exactly-at-band
//      does not trigger; boundary-tested); under `scheduled`, every
//      instrument rebalances. The candidate quantity is
//      lot-floor((targetValue - currentValue) / mark) for a buy and the
//      held quantity (lot-floored) for a sell — exact decimals, the
//      divided site at the spec's precision.
//   5. THE CONSTRAINT GATE RUNS BEFORE INTENT EMISSION (constraint
//      primacy — the Work Order's law): for every candidate action, the
//      gate evaluates the FULL constraint set over the decision context
//      (observation facts + state facts + the candidate's action facts);
//      a violated or errored BLOCKING constraint converts the candidate
//      into an IntentRefusal RECORD naming the violated predicate —
//      never a best-effort constrained-down intent (user constraints
//      are executable acceptance criteria, R1). Advisory violations are
//      recorded on the emitted intent, never dropped.
//   6. EMISSION — surviving candidates become StrategyIntents: the
//      OrderIntent-shaped mirror under the declared price discipline
//      (market, or limit tick-floored at the window's anchor price),
//      with the satisfied-predicate proof, the full lineage, and the
//      structured rationale.
//
// DETERMINISM: same (spec, state, window, constraint set, seed) ->
// byte-identical intents + refusals (deep-equal, twice — the golden
// fixtures prove it). No ambient clock (the decision instant is the
// window's `asOf`), no ambient randomness (the reference policies are
// deterministic; stochastic policies draw ONLY through the spec's
// declared seeded generators).
//
// L8: the run record is scanned for embedded authority — a run carrying
// venue permissions, credential refs or authority verbs fails
// validation (`authority_in_strategy`).
//
// Spec anchors: spec/ARCHITECTURE.md (core flow, Evaluation, Execution),
// spec/ARCHITECTURE-LOCK.md L4, L7, L8, L9, L11, L12, L15,
// spec/DOMAIN-MODEL.md (Goal, ConstraintSet, Trajectory).

import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  type JsonValue,
  type TimestampMs,
} from './primitives';
import {
  type ConstraintSetVersionRef,
  type GoalVersionRef,
  type Seed,
  type StrategyRunId,
  type StrategyVersionRef,
  mintStrategyRunId,
} from './ids';
import {
  type ConstraintSetStatementMirror,
  type ConstraintContextMirror,
  type ConstraintCheckMirror,
  type GoalStatementMirror,
  runConstraintGate,
  isConstraintSetStatementMirror,
  isGoalStatementMirror,
} from './control-mirror';
import { type ObservationWindow, isObservationWindow, markPriceOf } from './market-mirror';
import {
  type OrderIntentMirror,
  type DecimalString,
  isoTimestampOf,
} from './exchange-mirror';
import {
  type StrategySpec,
  isStrategySpec,
  targetWeights,
  validateStrategySpec,
} from './spec';
import {
  type PortfolioState,
  type PositionRecord,
  isPortfolioState,
  validatePortfolioState,
} from './portfolio';
import {
  type ConstraintProof,
  type IntentReasonKind,
  type IntentRefusal,
  type IntentRationale,
  type StrategyIntent,
  type SatisfiedPredicateProof,
  type ViolatedPredicate,
  isStrategyIntent,
  isIntentRefusal,
} from './intent';
import {
  add as decAdd,
  compare as decCompare,
  divideRoundHalfUp,
  floorToGrid,
  isEqual as decIsEqual,
  isZero as decIsZero,
  multiply as decMultiply,
  subtract as decSubtract,
} from './decimals';
import { authorityViolations } from './authority';
import {
  type StrategyError,
  type StrategyResult,
  fail,
  failures,
  invalidField,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The run record
// ---------------------------------------------------------------------------

/**
 * One compiled strategy run: the intent sequence + the refusal records +
 * the full input lineage + the derived, content-addressed identity and
 * the input digest (L9: same inputs -> same id; a mutated input changes
 * the digest and therefore the id).
 */
export interface StrategyRun {
  /** Content-addressed: `strat:` + digest of the canonical input lineage. */
  readonly runId: StrategyRunId;
  /** The strategy version the run compiled. */
  readonly strategy: StrategyVersionRef;
  /** The goal version the strategy serves. */
  readonly goal: GoalVersionRef;
  /** The constraint-set version the run gated under. */
  readonly constraintSet: ConstraintSetVersionRef;
  /** The observation window id the decisions were computed from. */
  readonly windowId: string;
  /** The portfolio state id the run decided over. */
  readonly stateId: string;
  /** The run's deterministic seed. */
  readonly seed: Seed;
  readonly tenant: string;
  readonly project: string;
  /** The decision instant (the window's asOf — no ambient clock). */
  readonly asOf: TimestampMs;
  /** The emitted intents, in deterministic order (universe order, buys before sells per instrument pair). */
  readonly intents: readonly StrategyIntent[];
  /** The refusal records, in deterministic order (constraint primacy). */
  readonly refusals: readonly IntentRefusal[];
  /** Digest over the canonical JSON of ALL declared inputs. */
  readonly inputDigest: string;
}

/** Guard: `StrategyRun` (structural; the laws live in `validateStrategyRun`). */
export function isStrategyRun(v: unknown): v is StrategyRun {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.runId) || !(v.runId as string).startsWith('strat:')) return false;
  if (!isRecord(v.strategy) || !isNonEmptyString((v.strategy as Record<string, unknown>).specId)) return false;
  if (!isRecord(v.goal) || !isNonEmptyString((v.goal as Record<string, unknown>).goalId)) return false;
  if (!isRecord(v.constraintSet) || !isNonEmptyString((v.constraintSet as Record<string, unknown>).id)) return false;
  if (!isNonEmptyString(v.windowId)) return false;
  if (!isNonEmptyString(v.stateId)) return false;
  if (!isNonEmptyString(v.seed)) return false;
  if (!isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (!Array.isArray(v.intents) || !v.intents.every((x) => isStrategyIntent(x))) return false;
  if (!Array.isArray(v.refusals) || !v.refusals.every((x) => isIntentRefusal(x))) return false;
  if (typeof v.inputDigest !== 'string' || !/^[0-9a-f]{8}$/.test(v.inputDigest)) return false;
  // The L8 trip wire.
  if (authorityViolations(v).length > 0) return false;
  return true;
}

/** The canonical JSON tree of the run's declared inputs (the digest basis). */
function runInputTree(
  spec: StrategySpec,
  state: PortfolioState,
  window: ObservationWindow,
  constraintSet: ConstraintSetStatementMirror,
  goal: GoalStatementMirror,
  seed: Seed,
): JsonValue {
  return {
    spec: { specId: spec.specId, version: spec.version },
    state: state.stateId,
    window: { windowId: window.window_id, asOf: window.asOf, eventCount: window.events.length },
    constraintSet: { id: constraintSet.id, version: constraintSet.version },
    goal: { goalId: goal.id, version: goal.version },
    seed,
  };
}

// ---------------------------------------------------------------------------
// The decision context (the gate's facts, assembled from declared inputs)
// ---------------------------------------------------------------------------

/**
 * Assemble the constraint-gate context of one candidate action from the
 * run's declared inputs — OBSERVATION facts (window shape: event counts,
 * per-instrument marks), STATE facts (portfolio shape: cash, position
 * counts, weights, per-instrument quantities), ACTION facts (the
 * candidate's side, quantity, notional, and the post-trade portfolio
 * weight it would produce) and OUTCOME facts (empty at decision time —
 * outcomes belong to the evaluation lane; the gate never fabricates
 * them). Pure and deterministic.
 */
function decisionContext(
  spec: StrategySpec,
  state: PortfolioState,
  window: ObservationWindow,
  marks: ReadonlyMap<string, { readonly price: string; readonly source: string }>,
  candidate: { readonly side: 'buy' | 'sell'; readonly instrumentId: string; readonly quantity: string; readonly notional: string },
): ConstraintContextMirror {
  const observation: Record<string, string | number | boolean> = {
    'window.events': window.events.length,
    'window.trades': window.events.filter((event) => event.event_type === 'trade').length,
    'window.quotes': window.events.filter((event) => event.event_type === 'quote').length,
    'window.asOf': window.asOf,
  };
  const stateFacts: Record<string, string | number | boolean> = {
    'state.cash': state.cash,
    'state.positions': state.positions.length,
    'state.universe': spec.universe.length,
    'state.asOf': state.asOf,
  };
  for (const position of state.positions) {
    stateFacts[`state.position.${position.instrumentId}.quantity`] = position.quantity;
    stateFacts[`state.position.${position.instrumentId}.costBasis`] = position.costBasis;
  }
  for (const weight of state.weights) {
    stateFacts[`state.weight.${weight.instrumentId}`] = weight.weight;
  }
  for (const [instrument, mark] of marks.entries()) {
    stateFacts[`state.mark.${instrument}`] = mark.price;
  }
  const actionFacts: Record<string, string | number | boolean> = {
    'action.side': candidate.side,
    'action.instrument': candidate.instrumentId,
    'action.quantity': candidate.quantity,
    'action.notional': candidate.notional,
  };
  return deepFreeze({
    observation: deepFreeze(observation),
    state: deepFreeze(stateFacts),
    action: deepFreeze(actionFacts),
    outcome: deepFreeze({} as Record<string, never>),
  });
}

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

/** The compile input (every member validated before decisions begin). */
export interface StrategyRunInput {
  readonly spec: StrategySpec;
  readonly state: PortfolioState;
  readonly window: ObservationWindow;
  readonly constraintSet: ConstraintSetStatementMirror;
  readonly goal: GoalStatementMirror;
  readonly seed: Seed;
}

/**
 * THE COMPILER (see the module header for the six-step walkthrough).
 * Pure and deterministic: the same input object always yields a
 * deeply-equal run (byte-identical serialization). Failures are typed
 * collect-all errors, never exceptions.
 */
export function compileStrategyRun(input: StrategyRunInput): StrategyResult<StrategyRun> {
  const errors: StrategyError[] = [];

  // --- 1. Validation -------------------------------------------------------
  const specResult = validateStrategySpec(input.spec);
  if (!specResult.ok) {
    return { ok: false, errors: specResult.errors.map((error) => ({ ...error, path: `spec.${error.path}` })) };
  }
  const spec = specResult.value;

  if (!isPortfolioState(input.state)) {
    const stateResult = validatePortfolioState(input.state);
    if (!stateResult.ok) {
      return { ok: false, errors: stateResult.errors.map((error) => ({ ...error, path: `state.${error.path}` })) };
    }
    return fail('invalid_state', 'the portfolio state failed the structural guard');
  }
  const state = input.state;

  if (!isObservationWindow(input.window)) {
    return fail('invalid_state', 'the observation window is malformed (ordering, L4 anchor or bounds)');
  }
  const window = input.window;

  if (!isConstraintSetStatementMirror(input.constraintSet)) {
    return fail('invalid_field', 'the constraint-set statement mirror is malformed');
  }
  const constraintSet = input.constraintSet;

  if (!isGoalStatementMirror(input.goal)) {
    return fail('invalid_field', 'the goal statement mirror is malformed');
  }
  const goal = input.goal;

  if (!isNonEmptyString(input.seed)) {
    return fail('invalid_field', 'the seed must be a non-empty string');
  }
  const seed = input.seed;

  // L12: one tenant across goal, constraints and spec.
  if (spec.tenant !== goal.tenantId) {
    return fail('tenant_missing', `the spec's tenant "${spec.tenant}" disagrees with the goal's tenant "${goal.tenantId}" — cross-tenant compilation is a typed error (L12)`);
  }
  if (spec.tenant !== constraintSet.tenantId) {
    return fail('tenant_missing', `the spec's tenant "${spec.tenant}" disagrees with the constraint set's tenant "${constraintSet.tenantId}" — cross-tenant compilation is a typed error (L12)`);
  }
  if (state.lineage.tenant !== spec.tenant) {
    return fail('tenant_missing', `the state's tenant "${state.lineage.tenant}" disagrees with the spec's tenant "${spec.tenant}" (L12)`);
  }
  if (state.lineage.project !== spec.project) {
    return fail('lineage_gap', `the state's project "${state.lineage.project}" disagrees with the spec's project "${spec.project}" (L12/L15)`);
  }

  // L9: the state's lineage refs agree with the run's inputs.
  if (state.lineage.strategy.specId !== spec.specId || state.lineage.strategy.version !== spec.version) {
    return fail('lineage_gap', 'the state\'s strategy lineage disagrees with the compiled spec version (L9)');
  }
  if (state.lineage.goal.goalId !== goal.id || state.lineage.goal.version !== goal.version) {
    return fail('lineage_gap', 'the state\'s goal lineage disagrees with the run\'s goal version (L9)');
  }
  if (state.lineage.constraintSet.id !== constraintSet.id || state.lineage.constraintSet.version !== constraintSet.version) {
    return fail('lineage_gap', 'the state\'s constraint-set lineage disagrees with the run\'s constraint-set version (L9)');
  }

  // The decision instant is the window's asOf (no ambient clock).
  const asOf = window.asOf;
  if (asOf < state.asOf) {
    return fail('invalid_state', `the decision instant (${String(asOf)}) precedes the state's asOf (${String(state.asOf)}) — the portfolio clock is monotonic (L4)`);
  }

  // --- 2. Marks over the universe (fail-closed) -----------------------------
  const universeByInstrument = new Map<string, (typeof spec.universe)[number]>();
  for (const entry of spec.universe) {
    universeByInstrument.set(entry.instrumentId, entry);
  }
  // Universe discipline: the state's positions must be inside the universe.
  for (const position of state.positions) {
    if (!universeByInstrument.has(position.instrumentId)) {
      return fail('universe_violation', `the portfolio holds "${position.instrumentId}" which is not in the spec's universe — a strategy cannot rebalance a position outside its declared universe`);
    }
  }
  const marks = new Map<string, { readonly price: string; readonly source: string }>();
  for (const entry of spec.universe) {
    const mark = markPriceOf(window, entry.instrumentId, spec.decimalPrecision);
    if (mark === null) {
      return fail('observation_gap', `the observation window carries no trade or quote for universe instrument "${entry.instrumentId}" — the run cannot size or price its decisions (fail-closed, never best-effort)`);
    }
    marks.set(entry.instrumentId, mark);
  }

  // --- 3. Targets -------------------------------------------------------------
  const targets = targetWeights(spec);
  const targetByInstrument = new Map<string, { readonly instrumentId: string; readonly venueId: string; readonly weight: string }>();
  for (const target of targets) {
    targetByInstrument.set(target.instrumentId, target);
  }
  const positionByInstrument = new Map<string, PositionRecord>();
  for (const position of state.positions) {
    positionByInstrument.set(position.instrumentId, position);
  }

  // Total portfolio value at the DECISION-TIME marks (cash + Σ quantity*mark).
  let totalValue = state.cash;
  for (const position of state.positions) {
    const mark = marks.get(position.instrumentId);
    if (mark !== undefined && !decIsZero(position.quantity)) {
      totalValue = decAdd(totalValue, decMultiply(position.quantity, mark.price));
    }
  }

  // The DECISION-TIME weights: computed fresh from THIS window's marks —
  // NOT read from the state's recorded weights (those are the LAST
  // snapshot's audit data; prices moved since). The drift that triggers
  // rebalancing is against what the portfolio is worth NOW, valued at
  // the marks the decisions are priced at. Exact products; the divided
  // site at the spec's precision ("0" when unheld or the book is empty).
  const currentWeightByInstrument = new Map<string, string>();
  for (const target of targets) {
    const position = positionByInstrument.get(target.instrumentId);
    const mark = marks.get(target.instrumentId) as { readonly price: string; readonly source: string };
    if (position === undefined || decIsZero(position.quantity) || decIsZero(totalValue)) {
      currentWeightByInstrument.set(target.instrumentId, '0');
      continue;
    }
    const value = decMultiply(position.quantity, mark.price);
    currentWeightByInstrument.set(target.instrumentId, divideRoundHalfUp(value, totalValue, spec.decimalPrecision));
  }

  // --- 4. Candidate actions ------------------------------------------------------
  const band = spec.rebalancing.trigger === 'drift_band' ? (spec.rebalancing.band as string) : null;
  interface Candidate {
    readonly side: 'buy' | 'sell';
    readonly instrumentId: string;
    readonly venueId: string;
    readonly quantity: string;
    readonly notional: string;
    readonly reason: IntentReasonKind;
    readonly targetWeight: string;
    readonly currentWeight: string;
    readonly drift: string;
  }
  const candidates: Candidate[] = [];
  // The buy discipline: buys are capped by AVAILABLE CASH, processed in
  // universe order (deterministic); sells do NOT fund buys within the
  // same decision — settlement is the execution lane's clock, not the
  // strategy's (L16: strategic and order-level control have distinct
  // clocks and authority). A strategy never emits an intent it cannot
  // pay for.
  let availableCash = state.cash;
  for (const target of targets) {
    const entry = universeByInstrument.get(target.instrumentId) as (typeof spec.universe)[number];
    const mark = marks.get(target.instrumentId) as { readonly price: string; readonly source: string };
    const position = positionByInstrument.get(target.instrumentId);
    const heldQuantity = position === undefined ? '0' : position.quantity;
    const currentWeight = currentWeightByInstrument.get(target.instrumentId) ?? '0';
    // The drift: |current - target|, exact (both are non-negative decimals;
    // the larger minus the smaller).
    const drift = decCompare(currentWeight, target.weight) >= 0
      ? decSubtract(currentWeight, target.weight)
      : decSubtract(target.weight, currentWeight);

    // The trigger: drift_band -> strictly EXCEEDS the band (at-band does
    // NOT trigger); scheduled -> always.
    if (band !== null && decCompare(drift, band) <= 0) continue;

    const reason: IntentReasonKind = band === null ? 'rebalance_scheduled' : decIsZero(currentWeight) && decIsZero(heldQuantity) ? 'initial_allocation' : 'rebalance_drift';
    const currentValue = decMultiply(heldQuantity, mark.price);
    const targetValue = decMultiply(totalValue, target.weight);
    if (decCompare(targetValue, currentValue) > 0) {
      // BUY: the value gap converted to quantity at the mark, lot-floored,
      // capped by the remaining cash (the buy discipline above).
      const gap = decSubtract(targetValue, currentValue);
      const byGap = divideRoundHalfUp(gap, mark.price, spec.decimalPrecision);
      const byCash = decIsZero(mark.price) ? '0' : divideRoundHalfUp(availableCash, mark.price, spec.decimalPrecision);
      const affordable = decCompare(byGap, byCash) <= 0 ? byGap : byCash;
      const quantity = floorToGrid(affordable, entry.lotSize);
      if (decIsZero(quantity)) continue; // below one lot or unaffordable: no order (a dust order is not a decision)
      const notional = decMultiply(quantity, mark.price);
      availableCash = decSubtract(availableCash, notional);
      candidates.push({
        side: 'buy',
        instrumentId: target.instrumentId,
        venueId: entry.venueId,
        quantity,
        notional,
        reason,
        targetWeight: target.weight,
        currentWeight,
        drift,
      });
    } else {
      // SELL: reduce toward the target (never below it), lot-floored.
      const gap = decSubtract(currentValue, targetValue);
      const rawQuantity = divideRoundHalfUp(gap, mark.price, spec.decimalPrecision);
      const quantity = floorToGrid(rawQuantity, entry.lotSize);
      if (decIsZero(quantity)) continue;
      // The long-only law: never sell more than held.
      const sellable = decCompare(quantity, heldQuantity) > 0 ? heldQuantity : quantity;
      if (decIsZero(sellable)) continue;
      candidates.push({
        side: 'sell',
        instrumentId: target.instrumentId,
        venueId: entry.venueId,
        quantity: sellable,
        notional: decMultiply(sellable, mark.price),
        reason,
        targetWeight: target.weight,
        currentWeight,
        drift,
      });
    }
  }

  // --- 5 + 6. The gate, then emission ------------------------------------------
  const intents: StrategyIntent[] = [];
  const refusals: IntentRefusal[] = [];
  let intentSequence = 0;
  let refusalSequence = 0;
  const lineage = {
    strategy: { specId: spec.specId, version: spec.version } as StrategyVersionRef,
    goal: { goalId: goal.id, version: goal.version } as GoalVersionRef,
    constraintSet: { id: constraintSet.id, version: constraintSet.version } as ConstraintSetVersionRef,
  };

  for (const candidate of candidates) {
    const context = decisionContext(spec, state, window, marks, candidate);
    const report = runConstraintGate(constraintSet, context);

    // The blocking crime scene: violated OR errored blocking checks, in
    // constraint-set order (deterministic).
    const blocking = report.checks.filter(
      (check) => check.severity === 'blocking' && (check.status === 'violated' || check.status === 'error'),
    );
    if (blocking.length > 0) {
      refusalSequence += 1;
      refusals.push(
        deepFreeze({
          sequence: refusalSequence,
          cause: blocking.some((check) => check.status === 'error') && blocking.every((check) => check.status === 'error')
            ? 'constraint_error'
            : 'constraint_refused',
          violated: blocking.map((check): ViolatedPredicate => {
            const constraint = constraintSet.constraints.find((c) => c.id === check.constraintId);
            return {
              constraintId: check.constraintId,
              domain: check.domain,
              subject: check.subject,
              severity: check.severity,
              predicate: (constraint === undefined ? { kind: 'flag', expected: false } : constraint.predicate) as ViolatedPredicate['predicate'],
              ...(check.observed !== undefined ? { observed: check.observed } : {}),
            };
          }),
          candidate: {
            side: candidate.side,
            instrumentId: candidate.instrumentId,
            venueId: candidate.venueId,
            quantity: candidate.quantity,
          },
          goal: lineage.goal,
          strategy: lineage.strategy,
          windowRefs: [window.window_id],
          seed,
          tenant: spec.tenant,
          project: spec.project,
          asOf,
        }) as IntentRefusal,
      );
      continue; // REFUSED — no intent, never a constrained-down order.
    }

    // The satisfied-predicate proof: every satisfied check, in set order.
    const satisfiedProofs: SatisfiedPredicateProof[] = report.checks
      .filter((check) => check.status === 'satisfied')
      .map((check): SatisfiedPredicateProof => {
        const constraint = constraintSet.constraints.find((c) => c.id === check.constraintId);
        return {
          constraintId: check.constraintId,
          domain: check.domain,
          subject: check.subject,
          severity: check.severity,
          predicate: (constraint === undefined ? { kind: 'flag', expected: false } : constraint.predicate) as SatisfiedPredicateProof['predicate'],
          observed: check.observed as string | number | boolean,
        };
      });
    const advisoryViolations: ConstraintCheckMirror[] = report.checks.filter(
      (check) => check.severity === 'advisory' && check.status === 'violated',
    );

    // The order-intent mirror under the declared price discipline.
    const mark = marks.get(candidate.instrumentId) as { readonly price: string; readonly source: string };
    const entry = universeByInstrument.get(candidate.instrumentId) as (typeof spec.universe)[number];
    let order: OrderIntentMirror;
    if (spec.priceDiscipline.kind === 'market') {
      order = {
        clientOrderId: `si-${spec.specId}-${spec.version}-${window.window_id}-${candidate.instrumentId}-${candidate.side}`,
        instrumentId: candidate.instrumentId as OrderIntentMirror['instrumentId'],
        venueId: entry.venueId as OrderIntentMirror['venueId'],
        side: candidate.side,
        kind: 'market',
        quantity: candidate.quantity as DecimalString,
        timeInForce: 'day',
        createdAt: isoTimestampOf(asOf),
      };
    } else {
      const anchorPrice = deriveAnchorPrice(window, candidate.instrumentId, spec.priceDiscipline.anchor, spec.decimalPrecision);
      const price = floorToGrid(anchorPrice, entry.tickSize);
      order = {
        clientOrderId: `si-${spec.specId}-${spec.version}-${window.window_id}-${candidate.instrumentId}-${candidate.side}`,
        instrumentId: candidate.instrumentId as OrderIntentMirror['instrumentId'],
        venueId: entry.venueId as OrderIntentMirror['venueId'],
        side: candidate.side,
        kind: 'limit',
        quantity: candidate.quantity as DecimalString,
        price: price as DecimalString,
        timeInForce: 'gtc',
        createdAt: isoTimestampOf(asOf),
      };
    }

    const rationale: IntentRationale = {
      kind: candidate.reason,
      instrumentId: candidate.instrumentId,
      targetWeight: candidate.targetWeight,
      currentWeight: candidate.currentWeight,
      drift: candidate.drift,
    };

    intentSequence += 1;
    const intentContent = {
      sequence: intentSequence,
      order,
      constraintProof: {
        constraintSet: lineage.constraintSet,
        satisfied: satisfiedProofs,
        advisoryViolations,
      } as ConstraintProof,
      goal: lineage.goal,
      strategy: lineage.strategy,
      windowRefs: [window.window_id],
      seed,
      tenant: spec.tenant,
      project: spec.project,
      riskPolicyRefs: spec.riskPolicyRefs,
      rationale,
      asOf,
    };
    const intentId = `si:${fnv1a32Hex(canonicalJson(intentContent as unknown as JsonValue))}`;
    intents.push(deepFreeze({ ...intentContent, intentId }) as StrategyIntent);
  }

  const inputDigest = fnv1a32Hex(canonicalJson(runInputTree(spec, state, window, constraintSet, goal, seed)));
  const run: StrategyRun = deepFreeze({
    runId: mintStrategyRunId(inputDigest),
    strategy: lineage.strategy,
    goal: lineage.goal,
    constraintSet: lineage.constraintSet,
    windowId: window.window_id,
    stateId: state.stateId,
    seed,
    tenant: spec.tenant,
    project: spec.project,
    asOf,
    intents,
    refusals,
    inputDigest,
  });
  return ok(run);
}

/** Derive the anchor price of one instrument under the declared discipline (exact decimal). */
function deriveAnchorPrice(
  window: ObservationWindow,
  instrument: string,
  anchor: 'last_trade' | 'mid_quote',
  precision: number,
): string {
  let lastTrade: string | null = null;
  let lastQuote: { readonly bid_price: string; readonly ask_price: string } | null = null;
  for (const event of window.events) {
    if (event.instrument !== instrument) continue;
    if (event.event_type === 'trade') lastTrade = event.payload.price;
    else lastQuote = event.payload;
  }
  if (anchor === 'last_trade' && lastTrade !== null) return lastTrade;
  if (lastQuote !== null) {
    return divideRoundHalfUp(decAdd(lastQuote.bid_price, lastQuote.ask_price), '2', precision);
  }
  return lastTrade as string;
}

// ---------------------------------------------------------------------------
// Validation (collect-all)
// ---------------------------------------------------------------------------

/**
 * Collect-all validation of an untrusted run record. Beyond the
 * structural guard: the L8 authority scan over the whole tree, the
 * sequence laws (intents 1..N, refusals 1..M), the run-id/content
 * coherence (the id carries the input digest) and the tenant/project
 * presence (L12). On success the value is returned narrowed, deeply
 * frozen.
 */
export function validateStrategyRun(value: unknown, path = 'run'): StrategyResult<StrategyRun> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidField(`${path}`, 'must be an object')] };
  }
  const errors: StrategyError[] = [];

  if (value.tenant === undefined || !isNonEmptyString(value.tenant)) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the run carries no tenant scope (L12)' });
  }
  if (value.project === undefined || !isNonEmptyString(value.project)) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the run carries no project scope (L12/L15)' });
  }
  if (value.strategy === undefined || !isRecord(value.strategy)) {
    errors.push({ code: 'lineage_gap', path: `${path}.strategy`, message: 'the run carries no strategy version ref (L9)' });
  }
  if (value.goal === undefined || !isRecord(value.goal)) {
    errors.push({ code: 'lineage_gap', path: `${path}.goal`, message: 'the run carries no goal version ref (L9)' });
  }
  if (value.constraintSet === undefined || !isRecord(value.constraintSet)) {
    errors.push({ code: 'lineage_gap', path: `${path}.constraintSet`, message: 'the run carries no constraint-set version ref (L9)' });
  }
  if (value.windowId === undefined || !isNonEmptyString(value.windowId)) {
    errors.push({ code: 'lineage_gap', path: `${path}.windowId`, message: 'the run carries no observation window ref (L9)' });
  }
  if (value.seed === undefined || !isNonEmptyString(value.seed)) {
    errors.push({ code: 'lineage_gap', path: `${path}.seed`, message: 'the run carries no seed (L9)' });
  }

  for (const crimePath of authorityViolations(value)) {
    errors.push({
      code: 'authority_in_strategy',
      path: `${path}.${crimePath}`,
      message: `strategy runs embed no execution authority ("${crimePath}") (L8)`,
    });
  }

  if (Array.isArray(value.intents)) {
    value.intents.forEach((intent: unknown, index: number) => {
      if (!isStrategyIntent(intent)) {
        errors.push(invalidField(`${path}.intents[${index}]`, 'fails the intent guard (order mirror, proof, lineage, L8 scan)'));
      } else {
        const record = intent as StrategyIntent;
        if (record.sequence !== index + 1) {
          errors.push(invalidField(`${path}.intents[${index}].sequence`, `intents sequence 1..N in order (got ${String(record.sequence)})`));
        }
      }
    });
  }

  if (Array.isArray(value.refusals)) {
    value.refusals.forEach((refusal: unknown, index: number) => {
      if (!isIntentRefusal(refusal)) {
        errors.push(invalidField(`${path}.refusals[${index}]`, 'fails the refusal guard (violated predicates, lineage)'));
      } else {
        const record = refusal as IntentRefusal;
        if (record.sequence !== index + 1) {
          errors.push(invalidField(`${path}.refusals[${index}].sequence`, `refusals sequence 1..M in order (got ${String(record.sequence)})`));
        }
      }
    });
  }

  if (errors.length > 0) return failures(errors);
  if (!isStrategyRun(value)) {
    return fail('invalid_run', `${path} failed the structural run guard`);
  }
  const run = value as StrategyRun;
  if (run.runId !== mintStrategyRunId(run.inputDigest)) {
    return fail('invalid_run', `${path}.runId does not match the content-addressed id of its input digest`);
  }
  return ok(deepFreeze(run));
}

/** `true` iff both runs are deeply equal (the determinism proof's comparator). */
export function runsEqual(a: StrategyRun, b: StrategyRun): boolean {
  return canonicalJson(a as unknown as JsonValue) === canonicalJson(b as unknown as JsonValue);
}
