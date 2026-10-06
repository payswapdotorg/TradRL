// @tradrl/example-e2e-trading — CONTROL-PLANE MIRRORS.
//
// Structural mirrors of the control plane the slice compiles from:
// the goal statement + constraint set + predicate evaluator
// (packages/control-domain, consumed via trading-strategy's
// control-mirror), the runConstraintGate semantics, and the
// trading-strategy market/account mirrors the strategy lane consumes
// (ObservationWindow, AccountFill, CorporateAction, PortfolioState).
// tests/end-to-end-trading/interop.test.ts feeds this slice's
// goal/constraint records through the REAL trading-strategy guards.

import type { GoalRef, ConstraintSetRef, TenantId, ProjectId, InstrumentId, VenueId } from '../ids';

// ---------------------------------------------------------------------------
// Predicates + criteria (control-domain / trading-strategy control mirror)
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
  readonly id: GoalRef;
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
  readonly id: ConstraintSetRef;
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

export interface ConstraintGateReportMirror {
  readonly checks: readonly ConstraintCheckMirror[];
  readonly satisfied: number;
  readonly violated: number;
  readonly notApplicable: number;
  readonly errors: number;
  readonly blockingViolations: number;
  readonly advisoryViolations: number;
  readonly pass: boolean;
}

/** Predicate evaluation (mirror of `evaluateCriterionPredicateMirror`). */
export function evaluatePredicateMirror(
  predicate: CriterionPredicateMirror,
  observed: CriterionValueMirror,
): boolean {
  switch (predicate.kind) {
    case 'limit.max':
      return typeof observed === 'number' && observed <= predicate.bound;
    case 'limit.min':
      return typeof observed === 'number' && observed >= predicate.bound;
    case 'limit.range':
      return typeof observed === 'number' && observed >= predicate.min && observed <= predicate.max;
    case 'equals':
      return observed === predicate.value;
    case 'notEquals':
      return observed !== predicate.value;
    case 'oneOf':
      return typeof observed === 'string' && (predicate.values as readonly string[]).includes(observed);
    case 'flag':
      return observed === predicate.expected;
  }
}

/** The constraint gate (mirror of trading-strategy `runConstraintGate`). */
export function runConstraintGateMirror(
  set: ConstraintSetStatementMirror,
  context: ConstraintContextMirror,
): ConstraintGateReportMirror {
  const checks: ConstraintCheckMirror[] = set.constraints.map((constraint) => {
    const phase = context[constraint.domain];
    const has = Object.prototype.hasOwnProperty.call(phase, constraint.subject);
    if (!has) {
      return {
        constraintId: constraint.id,
        domain: constraint.domain,
        subject: constraint.subject,
        severity: constraint.severity,
        status: 'not_applicable',
        reason: `subject "${constraint.subject}" not present in the ${constraint.domain} phase`,
      } satisfies ConstraintCheckMirror;
    }
    const observed = phase[constraint.subject]!;
    const passed = evaluatePredicateMirror(constraint.predicate, observed);
    return {
      constraintId: constraint.id,
      domain: constraint.domain,
      subject: constraint.subject,
      severity: constraint.severity,
      status: passed ? 'satisfied' : 'violated',
      observed,
    } satisfies ConstraintCheckMirror;
  });
  const satisfied = checks.filter((check) => check.status === 'satisfied').length;
  const violated = checks.filter((check) => check.status === 'violated').length;
  const notApplicable = checks.filter((check) => check.status === 'not_applicable').length;
  const errors = checks.filter((check) => check.status === 'error').length;
  const blockingViolations = checks.filter((check) => check.status === 'violated' && check.severity === 'blocking').length;
  const advisoryViolations = checks.filter((check) => check.status === 'violated' && check.severity === 'advisory').length;
  return {
    checks,
    satisfied,
    violated,
    notApplicable,
    errors,
    blockingViolations,
    advisoryViolations,
    pass: blockingViolations === 0 && errors === 0,
  };
}

// ---------------------------------------------------------------------------
// Goal attainment (success criteria evaluation — L7 constraint-aware)
// ---------------------------------------------------------------------------

export interface CriterionOutcomeMirror {
  readonly criterionId: string;
  readonly metric: string;
  readonly satisfied: boolean;
  readonly observed: CriterionValueMirror;
}

export interface GoalAttainmentMirror {
  readonly criteria: readonly CriterionOutcomeMirror[];
  readonly satisfiedCount: number;
  readonly totalCount: number;
  readonly satisfactionShare: number;
  readonly attained: boolean;
}

/** Evaluates the goal's success criteria over the outcome phase facts. */
export function evaluateGoalAttainmentMirror(
  goal: GoalStatementMirror,
  outcomeFacts: Readonly<Record<string, CriterionValueMirror>>,
): GoalAttainmentMirror {
  const criteria: CriterionOutcomeMirror[] = goal.successCriteria.criteria.map((criterion) => {
    const has = Object.prototype.hasOwnProperty.call(outcomeFacts, criterion.metric);
    const observed = has ? outcomeFacts[criterion.metric]! : 'no-reading';
    const satisfied =
      has &&
      typeof observed !== 'string' &&
      evaluatePredicateMirror(criterion.predicate, observed);
    return { criterionId: criterion.id, metric: criterion.metric, satisfied, observed };
  });
  const satisfiedCount = criteria.filter((criterion) => criterion.satisfied).length;
  const totalCount = criteria.length;
  const satisfactionShare = totalCount === 0 ? 0 : satisfiedCount / totalCount;
  return {
    criteria,
    satisfiedCount,
    totalCount,
    satisfactionShare,
    attained: satisfactionShare >= goal.successCriteria.requiredSatisfaction,
  };
}

// ---------------------------------------------------------------------------
// Versioned refs (trading-strategy / director mirror)
// ---------------------------------------------------------------------------

export interface GoalVersionRefMirror {
  readonly goalId: GoalRef;
  readonly version: number;
}

export interface ConstraintSetVersionRefMirror {
  readonly id: ConstraintSetRef;
  readonly version: number;
}

export interface StrategyVersionRefMirror {
  readonly specId: string;
  readonly version: number;
}

// ---------------------------------------------------------------------------
// Market/account mirrors (trading-strategy market-mirror / exchange-mirror)
// ---------------------------------------------------------------------------

export type MarkSourceMirror = 'last_trade' | 'mid_quote';

/** One observation window over the recorded event stream (L4 anchor). */
export interface ObservationWindowMirror {
  readonly window_id: string;
  readonly events: readonly MarketEventLikeMirror[];
  readonly asOf: number;
  readonly starts_at: number;
  readonly ends_at: number;
}

/** The event subset the window carries (trade + quote). */
export type MarketEventLikeMirror =
  | {
      readonly event_id: string;
      readonly venue: VenueId;
      readonly instrument: InstrumentId;
      readonly event_type: 'trade';
      readonly event_time: number;
      readonly available_time: number;
      readonly sequence: number;
      readonly payload: { readonly price: string; readonly size: string; readonly side: 'buy' | 'sell' };
    }
  | {
      readonly event_id: string;
      readonly venue: VenueId;
      readonly instrument: InstrumentId;
      readonly event_type: 'quote';
      readonly event_time: number;
      readonly available_time: number;
      readonly sequence: number;
      readonly payload: {
        readonly bid_price: string;
        readonly bid_size: string;
        readonly ask_price: string;
        readonly ask_size: string;
      };
    };

export interface AccountFillMirror {
  readonly fill_id: string;
  readonly instrument: InstrumentId;
  readonly venue: VenueId;
  readonly side: 'buy' | 'sell';
  readonly price: string;
  readonly quantity: string;
  readonly fee: string;
  readonly event_time: number;
}

export interface CorporateActionMirror {
  readonly action_id: string;
  readonly instrument: InstrumentId;
  readonly kind: 'cash_dividend' | 'split';
  readonly cashPerUnit?: string;
  readonly splitRatio?: string;
  readonly ex_time: number;
}

// ---------------------------------------------------------------------------
// Portfolio state (trading-strategy portfolio.ts)
// ---------------------------------------------------------------------------

export interface StrategyLineageMirror {
  readonly strategy: StrategyVersionRefMirror;
  readonly goal: GoalVersionRefMirror;
  readonly constraintSet: ConstraintSetVersionRefMirror;
  readonly windowId: string;
  readonly seed: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

export interface PositionRecordMirror {
  readonly instrumentId: InstrumentId;
  readonly venueId: VenueId;
  readonly quantity: string;
  readonly costBasis: string;
  readonly openedAt: number;
}

export interface PortfolioWeightMirror {
  readonly instrumentId: InstrumentId;
  readonly weight: string;
  readonly markSource: MarkSourceMirror;
}

export interface PortfolioStateMirror {
  readonly stateId: string;
  readonly positions: readonly PositionRecordMirror[];
  readonly weights: readonly PortfolioWeightMirror[];
  readonly cash: string;
  readonly realizedPnl: string;
  readonly unrealizedPnl: string;
  readonly asOf: number;
  readonly lineage: StrategyLineageMirror;
}

export interface PortfolioTransitionMirror {
  readonly sequence: number;
  readonly before: string;
  readonly after: string;
  readonly fills: readonly AccountFillMirror[];
  readonly corporateActions: readonly CorporateActionMirror[];
  readonly windowId: string;
  readonly asOf: number;
  readonly lineage: StrategyLineageMirror;
}

export interface PortfolioTransitionLogMirror {
  readonly initialState: string;
  readonly currentState: string;
  readonly transitions: readonly PortfolioTransitionMirror[];
  readonly chainHead: string;
}
