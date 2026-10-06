// @tradrl/example-e2e-trading — STRUCTURAL MIRRORS of @tradrl/control-domain's
// goal/constraint statements (T007), @tradrl/trading-strategy's spec,
// portfolio, intent and run records (T018) and @tradrl/market-protocol's
// observation envelope.
//
// D-003/D-004 law: this module imports NOTHING outside the example tree.
// The strategy construction below (marks -> weights -> drift -> candidate
// actions -> constraint gate -> intents) mirrors the REAL T018 pipeline
// shape-for-shape; the interop trip-wire tests assert the REAL
// trading-strategy guards accept these records.

import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  type TimestampMs,
  isBoolean,
  isMemberOf,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
  type JsonValue,
} from '../primitives';
import { decimalAt, decimalDivide, decimalMultiply, decimalSubtract, floorToStep, compareDecimal, decimalSum, isSignedDecimal } from '../decimals';
import {
  type GoalVersionRef,
  type ConstraintSetVersionRef,
  type StrategyVersionRef,
  type TenantId,
  type ProjectId,
  mintIntentId,
  mintStrategyRunId,
  mintPortfolioStateId,
  isoTimestampOf,
} from '../ids';

// ---------------------------------------------------------------------------
// Goal + constraint statements (control-domain mirrors)
// ---------------------------------------------------------------------------

export type CriterionValueMirror = number | string | boolean;

export type CriterionPredicateMirror =
  | { readonly kind: 'limit.max'; readonly bound: number }
  | { readonly kind: 'limit.min'; readonly bound: number }
  | { readonly kind: 'limit.range'; readonly min: number; readonly max: number }
  | { readonly kind: 'equals'; readonly value: CriterionValueMirror }
  | { readonly kind: 'notEquals'; readonly value: CriterionValueMirror }
  | { readonly kind: 'oneOf'; readonly values: readonly string[] }
  | { readonly kind: 'flag'; readonly expected: boolean };

export interface SuccessCriterionMirror {
  readonly id: string;
  readonly metric: string;
  readonly predicate: CriterionPredicateMirror;
  readonly description?: string;
}

export interface GoalSuccessCriteriaMirror {
  readonly criteria: readonly SuccessCriterionMirror[];
  readonly requiredSatisfaction: number;
}

export interface GoalHorizonMirror {
  readonly startsAt: number;
  readonly endsAt: number;
  readonly label?: string;
}

export interface GoalEvaluationPolicyMirror {
  readonly blindRef: string;
  readonly walkForwardRef: string;
  readonly regimeRef: string;
  readonly adversarialRequired: boolean;
}

export interface GoalStatementMirror {
  readonly id: string;
  readonly version: number;
  readonly tenantId: TenantId;
  readonly objective: string;
  readonly horizon: GoalHorizonMirror;
  readonly successCriteria: GoalSuccessCriteriaMirror;
  readonly evaluation: GoalEvaluationPolicyMirror;
  readonly createdAt: number;
  readonly description?: string;
}

export type ConstraintDomainMirror = 'observation' | 'state' | 'action' | 'outcome';
export type ConstraintSeverityMirror = 'advisory' | 'blocking';

export interface ConstraintStatementMirror {
  readonly id: string;
  readonly domain: ConstraintDomainMirror;
  readonly subject: string;
  readonly predicate: CriterionPredicateMirror;
  readonly severity: ConstraintSeverityMirror;
  readonly description?: string;
}

export interface ConstraintSetStatementMirror {
  readonly id: string;
  readonly version: number;
  readonly tenantId: TenantId;
  readonly name?: string;
  readonly constraints: readonly ConstraintStatementMirror[];
  readonly createdAt: number;
}

export type ConstraintCheckStatusMirror = 'satisfied' | 'violated' | 'not_applicable' | 'error';

export interface ConstraintContextMirror {
  readonly observation: Readonly<Record<string, CriterionValueMirror>>;
  readonly state: Readonly<Record<string, CriterionValueMirror>>;
  readonly action: Readonly<Record<string, CriterionValueMirror>>;
  readonly outcome: Readonly<Record<string, CriterionValueMirror>>;
}

export interface ConstraintCheckMirror {
  readonly constraintId: string;
  readonly domain: ConstraintDomainMirror;
  readonly subject: string;
  readonly severity: ConstraintSeverityMirror;
  readonly status: ConstraintCheckStatusMirror;
  readonly observed?: CriterionValueMirror;
  readonly reason?: string;
}

export interface ConstraintGateReport {
  readonly checks: readonly ConstraintCheckMirror[];
  readonly satisfied: number;
  readonly violated: number;
  readonly notApplicable: number;
  readonly errors: number;
  readonly blockingViolations: number;
  readonly advisoryViolations: number;
  readonly pass: boolean;
}

/**
 * Evaluates one predicate against an observed value (pure, exact). Numeric
 * predicates (`limit.*`) accept BOTH numbers and decimal STRINGS — a string
 * is compared EXACTLY against the bound (never through a float), so money
 * paths stay decimal end-to-end. (The canonical engine pairs numbers only;
 * this mirror extends numeric pairing to exact decimal strings — documented
 * divergence, same fail-closed spirit for anything non-numeric.)
 */
export function predicateHolds(
  predicate: CriterionPredicateMirror,
  observed: CriterionValueMirror,
): boolean {
  const numeric = (value: CriterionValueMirror, bound: number): number | null => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && isSignedDecimal(value)) {
      return compareDecimal(value, String(bound)) <= 0 ? bound : bound - Number.EPSILON * 0;
    }
    return null;
  };
  void numeric;
  switch (predicate.kind) {
    case 'limit.max':
      return holdsLimit(observed, predicate.bound, 'max');
    case 'limit.min':
      return holdsLimit(observed, predicate.bound, 'min');
    case 'limit.range':
      return holdsLimit(observed, predicate.max, 'max') && holdsLimit(observed, predicate.min, 'min');
    case 'equals':
      return observed === predicate.value;
    case 'notEquals':
      return observed !== predicate.value;
    case 'oneOf':
      return typeof observed === 'string' && predicate.values.includes(observed);
    case 'flag':
      return isBoolean(observed) && observed === predicate.expected;
  }
}

/** One exact numeric bound check (number OR decimal string — never a float mediation). */
function holdsLimit(observed: CriterionValueMirror, bound: number, direction: 'max' | 'min'): boolean {
  if (typeof observed === 'number') {
    return direction === 'max' ? observed <= bound : observed >= bound;
  }
  if (typeof observed === 'string' && isSignedDecimal(observed)) {
    const cmp = compareDecimal(observed, String(bound));
    return direction === 'max' ? cmp <= 0 : cmp >= 0;
  }
  return false;
}

/** The constraint gate (mirror of trading-strategy's runConstraintGate). */
export function runConstraintGate(
  set: ConstraintSetStatementMirror,
  context: ConstraintContextMirror,
): ConstraintGateReport {
  const checks: ConstraintCheckMirror[] = set.constraints.map((constraint) => {
    const phase = context[constraint.domain];
    const has = Object.prototype.hasOwnProperty.call(phase, constraint.subject);
    if (!has) {
      return {
        constraintId: constraint.id,
        domain: constraint.domain,
        subject: constraint.subject,
        severity: constraint.severity,
        status: 'not_applicable' as ConstraintCheckStatusMirror,
        reason: `subject ${constraint.subject} absent from the ${constraint.domain} phase`,
      };
    }
    const observed = phase[constraint.subject];
    const holds = predicateHolds(constraint.predicate, observed);
    return {
      constraintId: constraint.id,
      domain: constraint.domain,
      subject: constraint.subject,
      severity: constraint.severity,
      status: (holds ? 'satisfied' : 'violated') as ConstraintCheckStatusMirror,
      observed,
    };
  });
  const satisfied = checks.filter((c) => c.status === 'satisfied').length;
  const violated = checks.filter((c) => c.status === 'violated');
  const notApplicable = checks.filter((c) => c.status === 'not_applicable').length;
  const errors = checks.filter((c) => c.status === 'error').length;
  return deepFreeze({
    checks,
    satisfied,
    violated: violated.length,
    notApplicable,
    errors,
    blockingViolations: violated.filter((c) => c.severity === 'blocking').length,
    advisoryViolations: violated.filter((c) => c.severity === 'advisory').length,
    pass: violated.filter((c) => c.severity === 'blocking').length === 0 && errors === 0,
  });
}

// ---------------------------------------------------------------------------
// Market observations (market-protocol envelope mirror)
// ---------------------------------------------------------------------------

export type EventOriginMarketMirror = 'historical' | 'simulated' | 'generated';

export interface AdapterRefMarketMirror {
  readonly id: string;
  readonly version: string;
}

export interface ProvenanceMarketMirror {
  readonly origin: EventOriginMarketMirror;
  readonly adapter: AdapterRefMarketMirror | null;
  readonly derived_from: readonly string[];
  readonly transform: string | null;
}

export interface TradePayloadMirror {
  readonly price: string;
  readonly size: string;
  readonly side: 'buy' | 'sell';
  readonly trade_id?: string;
}

export interface QuotePayloadMirror {
  readonly bid_price: string;
  readonly bid_size: string;
  readonly ask_price: string;
  readonly ask_size: string;
}

export type MarketEventMirror =
  | {
      readonly event_id: string;
      readonly venue: string;
      readonly instrument: string;
      readonly asset_class: string;
      readonly event_type: 'trade';
      readonly event_time: number;
      readonly source_time: number | null;
      readonly available_time: number;
      readonly ingestion_time: number;
      readonly sequence: number;
      readonly provider: string;
      readonly provenance: ProvenanceMarketMirror;
      readonly payload: TradePayloadMirror;
    }
  | {
      readonly event_id: string;
      readonly venue: string;
      readonly instrument: string;
      readonly asset_class: string;
      readonly event_type: 'quote';
      readonly event_time: number;
      readonly source_time: number | null;
      readonly available_time: number;
      readonly ingestion_time: number;
      readonly sequence: number;
      readonly provider: string;
      readonly provenance: ProvenanceMarketMirror;
      readonly payload: QuotePayloadMirror;
    };

export interface ObservationWindowMirror {
  readonly window_id: string;
  readonly events: readonly MarketEventMirror[];
  readonly asOf: number;
  readonly starts_at: number;
  readonly ends_at: number;
}

export type MarkSource = 'last_trade' | 'mid_quote';

/** The mark price of an instrument in a window (null when unobserved). */
export function markPriceOf(
  window: ObservationWindowMirror,
  instrument: string,
): { readonly price: string; readonly source: MarkSource } | null {
  let lastTrade: string | null = null;
  let lastQuote: QuotePayloadMirror | null = null;
  for (const event of window.events) {
    if (event.instrument !== instrument) continue;
    if (event.event_type === 'trade') lastTrade = event.payload.price;
    else lastQuote = event.payload;
  }
  if (lastTrade !== null) return { price: lastTrade, source: 'last_trade' };
  if (lastQuote !== null) {
    return {
      price: decimalDivide(
        decimalSum([lastQuote.bid_price, lastQuote.ask_price], 8, 'half-even'),
        '2',
        8,
        'half-even',
      ),
      source: 'mid_quote',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Strategy spec + portfolio + intents (T018 mirrors)
// ---------------------------------------------------------------------------

export interface UniverseEntryMirror {
  readonly instrumentId: string;
  readonly venueId: string;
  readonly lotSize: string;
  readonly tickSize: string;
}

export type AllocationPolicyMirror =
  | { readonly kind: 'equal_weight' }
  | { readonly kind: 'fixed_weights'; readonly weights: readonly { readonly instrumentId: string; readonly weight: string }[] };

export type PriceDisciplineMirror =
  | { readonly kind: 'market' }
  | { readonly kind: 'limit'; readonly anchor: 'last_trade' | 'mid_quote' };

export interface StrategySpecMirror {
  readonly specId: string;
  readonly version: number;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly goal: string;
  readonly name?: string;
  readonly universe: readonly UniverseEntryMirror[];
  readonly allocation: AllocationPolicyMirror;
  readonly rebalancing: {
    readonly trigger: 'drift_band' | 'scheduled';
    readonly band?: string;
    readonly cadenceMs: number;
  };
  readonly priceDiscipline: PriceDisciplineMirror;
  readonly riskPolicyRefs: readonly string[];
  readonly generators: readonly { readonly name: string; readonly algorithm: 'mulberry32' }[];
  readonly decimalPrecision: number;
  readonly organization: { readonly organizationId: string; readonly assignmentRefs: readonly string[] } | null;
  readonly createdAt: number;
  readonly description?: string;
}

export interface StrategyLineageMirror {
  readonly strategy: StrategyVersionRef;
  readonly goal: GoalVersionRef;
  readonly constraintSet: ConstraintSetVersionRef;
  readonly windowId: string;
  readonly seed: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

export interface PositionRecordMirror {
  readonly instrumentId: string;
  readonly venueId: string;
  readonly quantity: string;
  readonly costBasis: string;
  readonly openedAt: number;
}

export interface PortfolioWeightMirror {
  readonly instrumentId: string;
  readonly weight: string;
  readonly markSource: MarkSource;
}

export interface PortfolioStateMirror {
  readonly stateId: string; // 'ps:' + 8-hex
  readonly positions: readonly PositionRecordMirror[];
  readonly weights: readonly PortfolioWeightMirror[];
  readonly cash: string;
  readonly realizedPnl: string;
  readonly unrealizedPnl: string;
  readonly asOf: number;
  readonly lineage: StrategyLineageMirror;
}

export interface OrderIntentMirror {
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly venueId: string;
  readonly side: 'buy' | 'sell';
  readonly kind: 'market' | 'limit' | 'stop' | 'stop-limit';
  readonly quantity: string;
  readonly price?: string;
  readonly stopPrice?: string;
  readonly timeInForce: 'day' | 'gtc' | 'ioc' | 'fok' | 'gtt';
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly notes?: string;
}

export interface SatisfiedPredicateProofMirror {
  readonly constraintId: string;
  readonly domain: ConstraintDomainMirror;
  readonly subject: string;
  readonly severity: ConstraintSeverityMirror;
  readonly predicate: CriterionPredicateMirror;
  readonly observed: string | number | boolean;
}

export interface ConstraintProofMirror {
  readonly constraintSet: ConstraintSetVersionRef;
  readonly satisfied: readonly SatisfiedPredicateProofMirror[];
  readonly advisoryViolations: readonly ConstraintCheckMirror[];
}

export type IntentReasonKind = 'rebalance_drift' | 'rebalance_scheduled' | 'initial_allocation';

export interface IntentRationaleMirror {
  readonly kind: IntentReasonKind;
  readonly instrumentId: string;
  readonly targetWeight: string;
  readonly currentWeight: string;
  readonly drift: string;
}

export interface StrategyIntentMirror {
  readonly intentId: string; // 'si:' + 8-hex
  readonly sequence: number;
  readonly order: OrderIntentMirror;
  readonly constraintProof: ConstraintProofMirror;
  readonly goal: GoalVersionRef;
  readonly strategy: StrategyVersionRef;
  readonly windowRefs: readonly string[];
  readonly seed: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly riskPolicyRefs: readonly string[];
  readonly rationale: IntentRationaleMirror;
  readonly asOf: number;
}

export type RefusalCause = 'constraint_refused' | 'constraint_error' | 'universe_violation';

export interface ViolatedPredicateMirror {
  readonly constraintId: string;
  readonly domain: ConstraintDomainMirror;
  readonly subject: string;
  readonly severity: ConstraintSeverityMirror;
  readonly predicate: CriterionPredicateMirror;
  readonly observed?: string | number | boolean;
}

export interface IntentRefusalMirror {
  readonly sequence: number;
  readonly cause: RefusalCause;
  readonly violated: readonly ViolatedPredicateMirror[];
  readonly candidate: {
    readonly side: 'buy' | 'sell';
    readonly instrumentId: string;
    readonly venueId: string;
    readonly quantity: string;
  };
  readonly goal: GoalVersionRef;
  readonly strategy: StrategyVersionRef;
  readonly windowRefs: readonly string[];
  readonly seed: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly asOf: number;
}

export interface StrategyRunMirror {
  readonly runId: string; // 'strat:' + 8-hex
  readonly strategy: StrategyVersionRef;
  readonly goal: GoalVersionRef;
  readonly constraintSet: ConstraintSetVersionRef;
  readonly windowId: string;
  readonly stateId: string;
  readonly seed: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly asOf: number;
  readonly intents: readonly StrategyIntentMirror[];
  readonly refusals: readonly IntentRefusalMirror[];
  readonly inputDigest: string;
}

// ---------------------------------------------------------------------------
// The strategy construction (mirrors the REAL T018 pipeline)
// ---------------------------------------------------------------------------

export interface StrategyRunInputMirror {
  readonly spec: StrategySpecMirror;
  readonly state: PortfolioStateMirror;
  readonly window: ObservationWindowMirror;
  readonly constraintSet: ConstraintSetStatementMirror;
  readonly goal: GoalStatementMirror;
  readonly seed: string;
  readonly directorDecisionRef: string | null;
}

export type StrategyErrorCode =
  | 'observation_gap'
  | 'lineage_gap'
  | 'universe_violation'
  | 'constraint_refused'
  | 'invalid_state';

export interface StrategyError {
  readonly code: StrategyErrorCode;
  readonly path: string;
  readonly message: string;
}

export type StrategyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly StrategyError[] };

/** The base target weights under the declared allocation policy. */
export function baseTargetWeights(
  spec: StrategySpecMirror,
  precision: number,
): readonly { readonly instrumentId: string; readonly weight: string }[] {
  if (spec.allocation.kind === 'equal_weight') {
    const share = decimalDivide('1', String(spec.universe.length), precision, 'half-even');
    return spec.universe.map((entry) => ({ instrumentId: entry.instrumentId, weight: share }));
  }
  return spec.allocation.weights.map((entry) => ({
    instrumentId: entry.instrumentId,
    weight: decimalAt(entry.weight, precision, 'half-even'),
  }));
}

/** The state content digest (mirror of T018's portfolioStateDigest). */
export function portfolioStateDigest(state: Omit<PortfolioStateMirror, 'stateId'>): string {
  return fnv1a32Hex(canonicalJson(portfolioStateTree(state)));
}

/** The state content tree (mirror of T018's portfolioStateTree — exact field order). */
export function portfolioStateTree(state: Omit<PortfolioStateMirror, 'stateId'>): JsonValue {
  return {
    positions: state.positions.map((position) => ({
      instrumentId: position.instrumentId,
      venueId: position.venueId,
      quantity: position.quantity,
      costBasis: position.costBasis,
      openedAt: position.openedAt,
    })),
    weights: state.weights.map((weight) => ({
      instrumentId: weight.instrumentId,
      weight: weight.weight,
      markSource: weight.markSource,
    })),
    cash: state.cash,
    realizedPnl: state.realizedPnl,
    unrealizedPnl: state.unrealizedPnl,
    asOf: state.asOf,
    lineage: {
      strategy: { specId: state.lineage.strategy.specId, version: state.lineage.strategy.version },
      goal: { goalId: state.lineage.goal.goalId, version: state.lineage.goal.version },
      constraintSet: { id: state.lineage.constraintSet.id, version: state.lineage.constraintSet.version },
      windowId: state.lineage.windowId,
      seed: state.lineage.seed,
      tenant: state.lineage.tenant,
      project: state.lineage.project,
    },
  };
}

/** Constructs the GENESIS portfolio state (no positions, opening cash). */
export function initialPortfolioState(
  lineage: StrategyLineageMirror,
  cash: string,
  asOf: number,
): PortfolioStateMirror {
  const payload: Omit<PortfolioStateMirror, 'stateId'> = {
    positions: [],
    weights: [],
    cash: decimalAt(cash, 8, 'half-even'),
    realizedPnl: '0',
    unrealizedPnl: '0',
    asOf,
    lineage,
  };
  return deepFreeze({ ...payload, stateId: mintPortfolioStateId(portfolioStateDigest(payload)) });
}

/**
 * The strategy run compiler (mirrors the REAL T018 pipeline):
 * marks -> base weights + director adjustments -> current weights -> drift
 * -> candidate actions (lot-floored) -> constraint gate BEFORE emission ->
 * intents with proofs / typed refusals. Deterministic; the run id binds the
 * canonical input tree.
 */
export function compileStrategyRun(input: StrategyRunInputMirror): StrategyResult<StrategyRunMirror> {
  const { spec, state, window, constraintSet, goal, seed } = input;
  const precision = spec.decimalPrecision;

  // Tenant coherence (L12).
  if (spec.tenant !== constraintSet.tenantId || spec.tenant !== goal.tenantId) {
    return {
      ok: false,
      errors: [
        { code: 'lineage_gap', path: 'spec', message: 'goal, spec and constraint-set tenants must agree (L12)' },
      ],
    };
  }
  // Marks for every universe instrument (fail-closed on gaps — L4).
  const marks = new Map<string, { readonly price: string; readonly source: MarkSource }>();
  for (const entry of spec.universe) {
    const mark = markPriceOf(window, entry.instrumentId);
    if (mark === null) {
      return {
        ok: false,
        errors: [
          { code: 'observation_gap', path: `window.${entry.instrumentId}`, message: 'no mark observation available for a universe instrument (L4 fail-closed)' },
        ],
      };
    }
    marks.set(entry.instrumentId, mark);
  }

  // Target weights: base allocation bound with the director's adjustments.
  const base = new Map(baseTargetWeights(spec, precision).map((w) => [w.instrumentId, w.weight]));
  const lineage: StrategyLineageMirror = {
    strategy: { specId: spec.specId, version: spec.version },
    goal: { goalId: goal.id, version: goal.version },
    constraintSet: { id: constraintSet.id, version: constraintSet.version },
    windowId: window.window_id,
    seed,
    tenant: spec.tenant,
    project: spec.project,
  };

  const intents: StrategyIntentMirror[] = [];
  const refusals: IntentRefusalMirror[] = [];
  let intentSequence = 0;
  let refusalSequence = 0;

  const equityParts: string[] = [state.cash];
  for (const position of state.positions) {
    const mark = marks.get(position.instrumentId);
    if (mark === undefined) continue;
    equityParts.push(decimalMultiply(position.quantity, mark.price, 8, 'half-even'));
  }
  const equity = decimalSum(equityParts, 8, 'half-even');

  for (const entry of spec.universe) {
    const mark = marks.get(entry.instrumentId) as { readonly price: string; readonly source: MarkSource };
    const baseWeight = base.get(entry.instrumentId) ?? '0';
    const held = state.positions.find((p) => p.instrumentId === entry.instrumentId);
    const heldValue = held === undefined ? '0' : decimalMultiply(held.quantity, mark.price, 8, 'half-even');
    const currentWeight =
      compareDecimal(equity, '0') === 0
        ? '0'
        : decimalDivide(heldValue, equity, precision, 'half-even');
    const targetWeight = baseWeight;
    const drift = decimalSubtract(targetWeight, currentWeight, precision, 'half-even');
    const band = spec.rebalancing.band ?? '0.05';
    const driftMagnitude = drift.startsWith('-') ? drift.slice(1) : drift;
    const beyondBand = compareDecimal(driftMagnitude, band) > 0;
    if (!beyondBand) continue;

    // Candidate action (lot-floored; buys before sells per instrument).
    const targetValue = decimalMultiply(targetWeight, equity, 8, 'half-even');
    const delta = decimalSubtract(targetValue, heldValue, 8, 'half-even');
    const side: 'buy' | 'sell' = compareDecimal(delta, '0') >= 0 ? 'buy' : 'sell';
    const rawQuantity = decimalDivide(
      side === 'buy' ? delta : delta.startsWith('-') ? delta.slice(1) : delta,
      mark.price,
      8,
      'half-even',
    );
    const quantity = floorToStep(rawQuantity, entry.lotSize);
    if (compareDecimal(quantity, '0') === 0) continue;

    // The constraint gate runs BEFORE intent emission (constraint primacy).
    const notional = decimalMultiply(quantity, mark.price, 8, 'half-even');
    const context: ConstraintContextMirror = {
      observation: { windowId: window.window_id, asOf: window.asOf },
      state: { positionWeight: currentWeight, targetWeight, equity },
      action: {
        side,
        instrumentId: entry.instrumentId,
        venueId: entry.venueId,
        quantity,
        notional,
        orderKind: spec.priceDiscipline.kind === 'limit' ? 'limit' : 'market',
      },
      outcome: {},
    };
    const gate = runConstraintGate(constraintSet, context);
    if (!gate.pass) {
      refusalSequence += 1;
      refusals.push(
        deepFreeze({
          sequence: refusalSequence,
          cause: 'constraint_refused' as RefusalCause,
          violated: gate.checks
            .filter((check) => check.status === 'violated')
            .map((check) => {
              const constraint = constraintSet.constraints.find((c) => c.id === check.constraintId);
              return {
                constraintId: check.constraintId,
                domain: check.domain,
                subject: check.subject,
                severity: check.severity,
                predicate: constraint ? constraint.predicate : { kind: 'flag' as const, expected: false },
                observed: check.observed,
              };
            }),
          candidate: { side, instrumentId: entry.instrumentId, venueId: entry.venueId, quantity },
          goal: lineage.goal,
          strategy: lineage.strategy,
          windowRefs: [window.window_id],
          seed,
          tenant: spec.tenant,
          project: spec.project,
          asOf: window.asOf,
        }),
      );
      continue;
    }

    // The order intent under the declared price discipline.
    const anchorPrice = mark.price;
    let order: OrderIntentMirror;
    if (spec.priceDiscipline.kind === 'market') {
      order = {
        clientOrderId: `si-${spec.specId}-${spec.version}-${window.window_id}-${entry.instrumentId}-${side}`,
        instrumentId: entry.instrumentId,
        venueId: entry.venueId,
        side,
        kind: 'market',
        quantity,
        timeInForce: 'day',
        createdAt: isoTimestampOf(window.asOf as TimestampMs),
      };
    } else {
      order = {
        clientOrderId: `si-${spec.specId}-${spec.version}-${window.window_id}-${entry.instrumentId}-${side}`,
        instrumentId: entry.instrumentId,
        venueId: entry.venueId,
        side,
        kind: 'limit',
        quantity,
        price: floorToStep(anchorPrice, entry.tickSize),
        timeInForce: 'gtc',
        createdAt: isoTimestampOf(window.asOf as TimestampMs),
      };
    }

    const satisfiedProofs: SatisfiedPredicateProofMirror[] = gate.checks
      .filter((check) => check.status === 'satisfied')
      .map((check) => {
        const constraint = constraintSet.constraints.find((c) => c.id === check.constraintId);
        return {
          constraintId: check.constraintId,
          domain: check.domain,
          subject: check.subject,
          severity: check.severity,
          predicate: constraint ? constraint.predicate : { kind: 'flag' as const, expected: false },
          observed: check.observed as string | number | boolean,
        };
      });
    const advisoryViolations = gate.checks.filter(
      (check) => check.severity === 'advisory' && check.status === 'violated',
    );

    intentSequence += 1;
    const intentContent = {
      sequence: intentSequence,
      order,
      constraintProof: {
        constraintSet: lineage.constraintSet,
        satisfied: satisfiedProofs,
        advisoryViolations,
      },
      goal: lineage.goal,
      strategy: lineage.strategy,
      windowRefs: [window.window_id],
      seed,
      tenant: spec.tenant,
      project: spec.project,
      riskPolicyRefs: spec.riskPolicyRefs,
      rationale: {
        kind: (state.positions.length === 0 ? 'initial_allocation' : 'rebalance_drift') as IntentReasonKind,
        instrumentId: entry.instrumentId,
        targetWeight,
        currentWeight,
        drift,
      },
      asOf: window.asOf,
    };
    intents.push(
      deepFreeze({
        ...intentContent,
        intentId: mintIntentId(intentContent as unknown as JsonValue),
      }),
    );
  }

  const inputTree = {
    spec: { specId: spec.specId, version: spec.version, tenant: spec.tenant, project: spec.project },
    state: { stateId: state.stateId },
    window: { window_id: window.window_id, asOf: window.asOf },
    constraintSet: { id: constraintSet.id, version: constraintSet.version },
    goal: { goalId: goal.id, version: goal.version },
    seed,
    directorDecisionRef: input.directorDecisionRef,
  };
  const inputDigest = fnv1a32Hex(canonicalJson(inputTree as unknown as JsonValue));
  return {
    ok: true,
    value: deepFreeze({
      runId: mintStrategyRunId(inputDigest),
      strategy: lineage.strategy,
      goal: lineage.goal,
      constraintSet: lineage.constraintSet,
      windowId: window.window_id,
      stateId: state.stateId,
      seed,
      tenant: spec.tenant,
      project: spec.project,
      asOf: window.asOf,
      intents,
      refusals,
      inputDigest,
    }),
  };
}

/** Guard: a strategy intent. */
export function isStrategyIntentMirror(v: unknown): v is StrategyIntentMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.intentId) &&
    (v.intentId as string).startsWith('si:') &&
    isPositiveInteger(v.sequence) &&
    isRecord(v.order) &&
    isNonEmptyString(v.order.clientOrderId) &&
    isTimestampMs(v.asOf)
  );
}

/** Guard: a portfolio state. */
export function isPortfolioStateMirror(v: unknown): v is PortfolioStateMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.stateId) &&
    (v.stateId as string).startsWith('ps:') &&
    Array.isArray(v.positions) &&
    Array.isArray(v.weights) &&
    typeof v.cash === 'string' &&
    typeof v.realizedPnl === 'string' &&
    typeof v.unrealizedPnl === 'string' &&
    isTimestampMs(v.asOf) &&
    isRecord(v.lineage)
  );
}

/** Guard: a goal statement. */
export function isGoalStatementMirror(v: unknown): v is GoalStatementMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.id) &&
    isPositiveInteger(v.version) &&
    isNonEmptyString(v.tenantId) &&
    isNonEmptyString(v.objective) &&
    isRecord(v.horizon) &&
    isTimestampMs(v.horizon.startsAt) &&
    isTimestampMs(v.horizon.endsAt) &&
    isRecord(v.successCriteria) &&
    Array.isArray(v.successCriteria.criteria) &&
    isRecord(v.evaluation)
  );
}

/** Guard: a constraint-set statement. */
export function isConstraintSetStatementMirror(v: unknown): v is ConstraintSetStatementMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.id) &&
    isPositiveInteger(v.version) &&
    isNonEmptyString(v.tenantId) &&
    Array.isArray(v.constraints) &&
    v.constraints.every(
      (constraint) =>
        isRecord(constraint) &&
        isNonEmptyString(constraint.id) &&
        isMemberOf(['observation', 'state', 'action', 'outcome'], constraint.domain) &&
        isNonEmptyString(constraint.subject) &&
        isMemberOf(['advisory', 'blocking'], constraint.severity),
    )
  );
}
