// @tradrl/trading-strategy — control-plane mirrors (goal + constraint set)
// and the CONSTRAINT GATE.
//
// STRUCTURAL MIRRORS of @tradrl/control-domain (T007) — DO NOT DIVERGE IN
// SHAPE. The frozen workspace lockfile forbids a package dependency
// between contract packages, so this module re-declares the
// GoalStatement / ConstraintSetStatement shapes by STRUCTURE (never by
// import): field-for-field identical to control-domain's records, with
// the same brand tags (`GoalRef`, `ConstraintSetRef`, `TenantId`,
// `TradRL.TimestampMs`), so the mirrors are mutually assignable at
// compile time — the trip wire in src/interop.test.ts fails
// `pnpm typecheck` if either side drifts (D-003/D-004).
//
// WHY THIS LANE MIRRORS THEM (spec/ARCHITECTURE.md core flow: "... ->
// Research/Learning -> Strategy/Portfolio/Risk -> Execution -> ..."): the
// strategy domain COMPILES goals and constraints into tradable intent —
// it never replaces them. A ConstraintSet is an INPUT to every strategy
// decision (constraint primacy, R1: "user constraints are executable
// acceptance criteria"); the gate below runs BEFORE intent emission and
// an unsatisfied blocking constraint produces a typed REFUSAL naming the
// violated predicate — never a best-effort constrained-down intent.
//
// THE GATE ENGINE mirrors @tradrl/domain-core's `evaluateConstraintSet`
// semantics (T002 owns the canonical engine; this strategy-local
// evaluator exists so the gate can run without importing the control
// plane — the same declared-interpreter discipline
// @tradrl/organization uses for feasibility screening):
//   - subjects are identifier paths into the four phase maps
//     (observation / state / action / outcome); a missing subject means
//     `not_applicable` — point-in-time evaluation (L4);
//   - runtime type conflicts (a numeric limit against a string subject)
//     are `error` checks and force the gate to fail — fail-closed;
//   - a wholly inapplicable set satisfies NOTHING (fail-closed: no
//     vacuous pass);
//   - `pass` is true iff zero blocking violations AND zero errors
//     (advisories do not refuse — they are recorded, never dropped).
//
// Spec anchors: spec/DOMAIN-MODEL.md (Goal, ConstraintSet),
// spec/ARCHITECTURE-LOCK.md L4, L7, L8, L12, L15.

import {
  isFiniteNumber,
  isIdentifierPath,
  isMemberOf,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
  isUnitInterval,
  type TimestampMs,
} from './primitives';
import {
  type ConstraintSetRef,
  type GoalRef,
  type TenantId,
  isConstraintSetRef,
  isGoalRef,
  isTenantId,
} from './ids';

// ---------------------------------------------------------------------------
// Predicate vocabulary (structural mirror of control-domain's predicates)
// ---------------------------------------------------------------------------

/** Scalar value observable in an evaluation context. Mirror. */
export type CriterionValueMirror = number | string | boolean;

/**
 * Executable predicate over a criterion metric or constraint subject.
 * Discriminated by `kind` — the SAME closed vocabulary and the SAME
 * semantics as control-domain's `CriterionPredicate` (itself the mirror
 * of domain-core's `Predicate`). The constraint gate executes these
 * mirrors; the shapes must never diverge.
 */
export type CriterionPredicateMirror =
  | { readonly kind: 'limit.max'; readonly bound: number }
  | { readonly kind: 'limit.min'; readonly bound: number }
  | { readonly kind: 'limit.range'; readonly min: number; readonly max: number }
  | { readonly kind: 'equals'; readonly value: CriterionValueMirror }
  | { readonly kind: 'notEquals'; readonly value: CriterionValueMirror }
  | { readonly kind: 'oneOf'; readonly values: readonly string[] }
  | { readonly kind: 'flag'; readonly expected: boolean };

/** The closed predicate-kind vocabulary (mirror). */
export const CRITERION_PREDICATE_KINDS_MIRROR: readonly CriterionPredicateMirror['kind'][] = [
  'limit.max',
  'limit.min',
  'limit.range',
  'equals',
  'notEquals',
  'oneOf',
  'flag',
] as const;

/** Guard: `CriterionValueMirror`. */
export function isCriterionValueMirror(v: unknown): v is CriterionValueMirror {
  if (typeof v === 'boolean') return true;
  if (typeof v === 'string') return isNonEmptyString(v);
  return isFiniteNumber(v);
}

/** Guard: `CriterionPredicateMirror` (total over the closed union). */
export function isCriterionPredicateMirror(v: unknown): v is CriterionPredicateMirror {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'limit.max':
    case 'limit.min':
      return isFiniteNumber(v.bound);
    case 'limit.range':
      return isFiniteNumber(v.min) && isFiniteNumber(v.max) && v.min <= v.max;
    case 'equals':
    case 'notEquals':
      return isCriterionValueMirror(v.value);
    case 'oneOf':
      return (
        Array.isArray(v.values) &&
        v.values.length > 0 &&
        v.values.every((x) => isNonEmptyString(x))
      );
    case 'flag':
      return typeof v.expected === 'boolean';
    default:
      return false;
  }
}

/**
 * Evaluates a criterion predicate against a measured value — the DECLARED,
 * total interpreter for the mirrored vocabulary. Pure; never throws;
 * returns `false` when the value's type cannot pair with the predicate (a
 * non-numeric value under a numeric limit is not satisfied — fail-closed,
 * mirroring domain-core's semantics).
 */
export function evaluateCriterionPredicateMirror(
  predicate: CriterionPredicateMirror,
  value: CriterionValueMirror,
): boolean {
  switch (predicate.kind) {
    case 'limit.max':
      return typeof value === 'number' && value <= predicate.bound;
    case 'limit.min':
      return typeof value === 'number' && value >= predicate.bound;
    case 'limit.range':
      return typeof value === 'number' && value >= predicate.min && value <= predicate.max;
    case 'equals':
      return value === predicate.value; // strict equality; type coherence is the gate's job
    case 'notEquals':
      return value !== predicate.value; // strict inequality; type coherence is the gate's job
    case 'oneOf':
      return typeof value === 'string' && predicate.values.includes(value);
    case 'flag':
      return typeof value === 'boolean' && value === predicate.expected;
  }
}

// ---------------------------------------------------------------------------
// Goal statement mirror (structural mirror of control-domain's GoalStatement)
// ---------------------------------------------------------------------------

/** One structured success criterion. Mirror of control-domain's `SuccessCriterion`. */
export interface SuccessCriterionMirror {
  /** Unique within the goal statement. */
  readonly id: string;
  /** Identifier path of the metric this criterion decides attainment on. */
  readonly metric: string;
  /** Executable predicate over the metric value. */
  readonly predicate: CriterionPredicateMirror;
  /** Human context. NEVER interpreted. */
  readonly description?: string;
}

/** The structured success criteria block. Mirror of control-domain's `GoalSuccessCriteria`. */
export interface GoalSuccessCriteriaMirror {
  /** Non-empty; criterion ids unique. */
  readonly criteria: readonly SuccessCriterionMirror[];
  /** Required share of criteria satisfied for attainment, [0, 1]. */
  readonly requiredSatisfaction: number;
}

/** Evaluation horizon: `[startsAt, endsAt)` in epoch milliseconds. Mirror. */
export interface GoalHorizonMirror {
  readonly startsAt: TimestampMs;
  readonly endsAt: TimestampMs;
  readonly label?: string;
}

/** Evaluation policy declaration authored with the goal. Mirror (opaque T012 refs). */
export interface GoalEvaluationPolicyMirror {
  readonly blindRef: string;
  readonly walkForwardRef: string;
  readonly regimeRef: string;
  readonly adversarialRequired: boolean;
}

/** The goal statement as this lane receives it. Mirror of control-domain's `GoalStatement`. */
export interface GoalStatementMirror {
  readonly id: GoalRef;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
  /** Owning tenant (L12). Must match the constraint set's tenant to run. */
  readonly tenantId: TenantId;
  /** Human-readable objective statement. Interpreted, never executed. */
  readonly objective: string;
  readonly horizon: GoalHorizonMirror;
  readonly successCriteria: GoalSuccessCriteriaMirror;
  readonly evaluation: GoalEvaluationPolicyMirror;
  readonly createdAt: TimestampMs;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Constraint-set statement mirror (mirror of control-domain's ConstraintSetStatement)
// ---------------------------------------------------------------------------

/** Phase of the trading loop a constraint applies to. Mirror. */
export type ConstraintDomainMirror = 'observation' | 'state' | 'action' | 'outcome';

export const CONSTRAINT_DOMAINS_MIRROR: readonly ConstraintDomainMirror[] = [
  'observation',
  'state',
  'action',
  'outcome',
] as const;

/** How a violation is aggregated. Mirror. */
export type ConstraintSeverityMirror = 'advisory' | 'blocking';

export const CONSTRAINT_SEVERITIES_MIRROR: readonly ConstraintSeverityMirror[] = [
  'advisory',
  'blocking',
] as const;

/** A single executable constraint. Mirror of control-domain's `ConstraintStatement`. */
export interface ConstraintStatementMirror {
  /** Unique within the set. */
  readonly id: string;
  readonly domain: ConstraintDomainMirror;
  /** Identifier path into the phase map selected by `domain`. */
  readonly subject: string;
  readonly predicate: CriterionPredicateMirror;
  readonly severity: ConstraintSeverityMirror;
  /** Human explanation. NEVER interpreted. */
  readonly description?: string;
}

/** A versioned collection of executable constraints, tenant-scoped. Mirror. */
export interface ConstraintSetStatementMirror {
  readonly id: ConstraintSetRef;
  /** Integer >= 1. */
  readonly version: number;
  /** Owning tenant (L12). Must match the goal's tenant. */
  readonly tenantId: TenantId;
  readonly name?: string;
  readonly constraints: readonly ConstraintStatementMirror[];
  readonly createdAt: TimestampMs;
}

// ---------------------------------------------------------------------------
// Guards (total, hand-rolled, never throw)
// ---------------------------------------------------------------------------

export function isConstraintDomainMirror(v: unknown): v is ConstraintDomainMirror {
  return isMemberOf(CONSTRAINT_DOMAINS_MIRROR, v);
}

export function isConstraintSeverityMirror(v: unknown): v is ConstraintSeverityMirror {
  return isMemberOf(CONSTRAINT_SEVERITIES_MIRROR, v);
}

export function isSuccessCriterionMirror(v: unknown): v is SuccessCriterionMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isIdentifierPath(v.metric)) return false;
  if (!isCriterionPredicateMirror(v.predicate)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

export function isGoalSuccessCriteriaMirror(v: unknown): v is GoalSuccessCriteriaMirror {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.criteria) || v.criteria.length === 0) return false;
  if (!v.criteria.every((x) => isSuccessCriterionMirror(x))) return false;
  const seen = new Set<string>();
  for (const c of v.criteria) {
    const criterion = c as SuccessCriterionMirror;
    if (seen.has(criterion.id)) return false; // ids unique within the goal
    seen.add(criterion.id);
  }
  if (!isUnitInterval(v.requiredSatisfaction)) return false;
  return true;
}

export function isGoalHorizonMirror(v: unknown): v is GoalHorizonMirror {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.startsAt) || !isTimestampMs(v.endsAt)) return false;
  if (v.endsAt <= v.startsAt) return false; // non-empty horizon
  if (v.label !== undefined && !isNonEmptyString(v.label)) return false;
  return true;
}

export function isGoalEvaluationPolicyMirror(v: unknown): v is GoalEvaluationPolicyMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.blindRef)) return false;
  if (!isNonEmptyString(v.walkForwardRef)) return false;
  if (!isNonEmptyString(v.regimeRef)) return false;
  if (typeof v.adversarialRequired !== 'boolean') return false;
  return true;
}

export function isGoalStatementMirror(v: unknown): v is GoalStatementMirror {
  if (!isRecord(v)) return false;
  if (!isGoalRef(v.id)) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isNonEmptyString(v.objective)) return false;
  if (!isGoalHorizonMirror(v.horizon)) return false;
  if (!isGoalSuccessCriteriaMirror(v.successCriteria)) return false;
  if (!isGoalEvaluationPolicyMirror(v.evaluation)) return false;
  if (!isTimestampMs(v.createdAt)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

export function isConstraintStatementMirror(v: unknown): v is ConstraintStatementMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isConstraintDomainMirror(v.domain)) return false;
  if (!isIdentifierPath(v.subject)) return false;
  if (!isCriterionPredicateMirror(v.predicate)) return false;
  if (!isConstraintSeverityMirror(v.severity)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

export function isConstraintSetStatementMirror(v: unknown): v is ConstraintSetStatementMirror {
  if (!isRecord(v)) return false;
  if (!isConstraintSetRef(v.id)) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (v.name !== undefined && !isNonEmptyString(v.name)) return false;
  if (!Array.isArray(v.constraints)) return false;
  const seen = new Set<string>();
  for (const c of v.constraints) {
    if (!isConstraintStatementMirror(c)) return false;
    const constraint = c as ConstraintStatementMirror;
    if (seen.has(constraint.id)) return false; // ids unique within the set
    seen.add(constraint.id);
  }
  if (!isTimestampMs(v.createdAt)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The constraint gate (declared interpreter — domain-core semantics, mirrored)
// ---------------------------------------------------------------------------

/** Status of one constraint check under the gate. Mirror of domain-core's `ConstraintCheckStatus`. */
export type ConstraintCheckStatusMirror = 'satisfied' | 'violated' | 'not_applicable' | 'error';

/**
 * The gate's evaluation context: the four phase maps, mirroring
 * domain-core's `ConstraintEvaluationContext`. The strategy run assembles
 * them from its DECLARED inputs — observation facts from the observation
 * window, state facts from the portfolio state, action facts from the
 * candidate intent, outcome facts from attainment evidence refs (the
 * evaluation lane's domain; the gate never fabricates outcomes).
 */
export interface ConstraintContextMirror {
  readonly observation: Readonly<Record<string, CriterionValueMirror>>;
  readonly state: Readonly<Record<string, CriterionValueMirror>>;
  readonly action: Readonly<Record<string, CriterionValueMirror>>;
  readonly outcome: Readonly<Record<string, CriterionValueMirror>>;
}

/** One constraint check the gate performed (the satisfied-predicate proof unit). */
export interface ConstraintCheckMirror {
  readonly constraintId: string;
  readonly domain: ConstraintDomainMirror;
  readonly subject: string;
  readonly severity: ConstraintSeverityMirror;
  readonly status: ConstraintCheckStatusMirror;
  /** Present when the subject was applicable (satisfied or violated). */
  readonly observed?: CriterionValueMirror;
  /** Present for `not_applicable` / `error` statuses. Human-readable, never executed. */
  readonly reason?: string;
}

/** Aggregate gate report over one decision context. Never throws. */
export interface ConstraintGateReport {
  readonly checks: readonly ConstraintCheckMirror[];
  readonly satisfied: number;
  readonly violated: number;
  readonly notApplicable: number;
  readonly errors: number;
  readonly blockingViolations: number;
  readonly advisoryViolations: number;
  /** True iff zero blocking violations AND zero errors (advisories do not refuse). */
  readonly pass: boolean;
}

const DOMAIN_TO_KEY: Record<ConstraintDomainMirror, keyof ConstraintContextMirror> = {
  observation: 'observation',
  state: 'state',
  action: 'action',
  outcome: 'outcome',
};

/** Guard: `ConstraintContextMirror` (four finite maps of constraint values). */
export function isConstraintContextMirror(v: unknown): v is ConstraintContextMirror {
  if (!isRecord(v)) return false;
  for (const key of ['observation', 'state', 'action', 'outcome'] as const) {
    const map = v[key];
    if (!isRecord(map)) return false;
    for (const value of Object.values(map)) {
      if (!isCriterionValueMirror(value)) return false;
    }
  }
  return true;
}

/** Guard: `ConstraintCheckMirror`. */
export function isConstraintCheckMirror(v: unknown): v is ConstraintCheckMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.constraintId)) return false;
  if (!isConstraintDomainMirror(v.domain)) return false;
  if (!isNonEmptyString(v.subject)) return false;
  if (!isConstraintSeverityMirror(v.severity)) return false;
  if (!isMemberOf(['satisfied', 'violated', 'not_applicable', 'error'] as const, v.status)) return false;
  if (v.observed !== undefined && !isCriterionValueMirror(v.observed)) return false;
  if (v.reason !== undefined && !isNonEmptyString(v.reason)) return false;
  return true;
}

/**
 * THE CONSTRAINT GATE. Evaluates every constraint of the mirrored set
 * against the decision context, mirroring domain-core's
 * `evaluateConstraintSet` semantics law-for-law: missing subjects are
 * `not_applicable` (point-in-time, L4); type conflicts are `error` checks
 * that force `pass: false` (fail-closed, L8/L20); `pass` requires zero
 * blocking violations AND zero errors. Pure, total, deterministic — the
 * report is a pure function of (set, context).
 */
export function runConstraintGate(
  set: ConstraintSetStatementMirror,
  context: ConstraintContextMirror,
): ConstraintGateReport {
  const checks: ConstraintCheckMirror[] = set.constraints.map((constraint): ConstraintCheckMirror => {
    const domainMap = context[DOMAIN_TO_KEY[constraint.domain]];
    const hasKey = Object.prototype.hasOwnProperty.call(domainMap, constraint.subject);
    if (!hasKey) {
      return {
        constraintId: constraint.id,
        domain: constraint.domain,
        subject: constraint.subject,
        severity: constraint.severity,
        status: 'not_applicable',
        reason: `subject "${constraint.subject}" not present in "${constraint.domain}" phase at evaluation time`,
      };
    }
    const observed = domainMap[constraint.subject];
    if (observed === undefined || !isCriterionValueMirror(observed)) {
      return {
        constraintId: constraint.id,
        domain: constraint.domain,
        subject: constraint.subject,
        severity: constraint.severity,
        status: 'error',
        reason: `subject "${constraint.subject}" holds a value outside the constraint-value vocabulary`,
      };
    }
    // Type pairing: a numeric predicate against a non-numeric value (or a
    // flag against a non-boolean, or oneOf against a non-string) is an
    // ERROR check — fail-closed, mirroring the canonical engine.
    const typeCoherent =
      (constraint.predicate.kind === 'limit.max' ||
      constraint.predicate.kind === 'limit.min' ||
      constraint.predicate.kind === 'limit.range'
        ? typeof observed === 'number'
        : constraint.predicate.kind === 'oneOf'
          ? typeof observed === 'string'
          : constraint.predicate.kind === 'flag'
            ? typeof observed === 'boolean'
            : typeof observed === typeof constraint.predicate.value);
    if (!typeCoherent) {
      return {
        constraintId: constraint.id,
        domain: constraint.domain,
        subject: constraint.subject,
        severity: constraint.severity,
        status: 'error',
        reason: `subject "${constraint.subject}" (${typeof observed}) cannot pair with predicate kind "${constraint.predicate.kind}"`,
      };
    }
    const satisfied = evaluateCriterionPredicateMirror(constraint.predicate, observed);
    return {
      constraintId: constraint.id,
      domain: constraint.domain,
      subject: constraint.subject,
      severity: constraint.severity,
      status: satisfied ? 'satisfied' : 'violated',
      observed,
    };
  });

  let satisfied = 0;
  let violated = 0;
  let notApplicable = 0;
  let errors = 0;
  let blockingViolations = 0;
  let advisoryViolations = 0;
  for (const check of checks) {
    if (check.status === 'satisfied') satisfied += 1;
    else if (check.status === 'violated') {
      violated += 1;
      if (check.severity === 'blocking') blockingViolations += 1;
      else advisoryViolations += 1;
    } else if (check.status === 'not_applicable') notApplicable += 1;
    else errors += 1;
  }
  return {
    checks: [...checks],
    satisfied,
    violated,
    notApplicable,
    errors,
    blockingViolations,
    advisoryViolations,
    pass: blockingViolations === 0 && errors === 0,
  };
}
