/**
 * @tradrl/organization — control-plane mirrors (goal + constraint set).
 *
 * STRUCTURAL MIRRORS of @tradrl/control-domain (T007) — DO NOT DIVERGE IN
 * SHAPE. The frozen workspace lockfile forbids a package dependency between
 * contract packages, so this module re-declares the GoalStatement /
 * ConstraintSetStatement shapes by STRUCTURE (never by import):
 * `GoalStatementMirror` is field-for-field identical to control-domain's
 * `GoalStatement`, and the brand tags (`GoalRef`, `ConstraintSetRef`,
 * `TenantId`, `ProjectId`, `TradRL.TimestampMs`) match the canonical
 * declarations, so the mirrors are mutually assignable at compile time —
 * the trip wire in interop.test.ts fails `pnpm typecheck` if either side
 * drifts (D-003/D-004).
 *
 * These are the inputs the organization compiler compiles FROM
 * (spec/ARCHITECTURE.md: "Given goals, constraints, market/data universe
 * and resource budgets, discover agent count, specializations, ...").
 *
 * Spec anchors: spec/ARCHITECTURE-LOCK.md L7 (constraint-aware evaluation —
 * the constraint set drives feasibility, never acceptance), L12 (tenant
 * scope), L15 (goal/decision lineage); spec/DOMAIN-MODEL.md (Goal,
 * ConstraintSet).
 */

import {
  type ConstraintSetRef,
  type GoalRef,
  type TenantId,
  type TimestampMs,
  isFiniteNumber,
  isIdentifierPath,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
  isUnitInterval,
} from './primitives';

// ---------------------------------------------------------------------------
// Predicate vocabulary (structural mirror of control-domain's predicates)
// ---------------------------------------------------------------------------

/** Scalar value observable in an evaluation metric space. Mirror. */
export type CriterionValueMirror = number | string | boolean;

/**
 * Executable predicate over a criterion metric. Discriminated by `kind` —
 * the SAME closed vocabulary and the SAME semantics as control-domain's
 * `CriterionPredicate`. The organization compiler executes these mirrors
 * (feasibility screening only — ACCEPTANCE remains the evaluation lane's,
 * T012); the shapes must never diverge.
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
 * total interpreter for the mirrored vocabulary (control-domain owns the
 * canonical engine; this organization-local evaluator exists so the
 * compiler can screen candidate feasibility against BLOCKING constraints
 * without importing the control plane). Pure; never throws; returns
 * `false` when the value's type cannot pair with the predicate (a
 * non-numeric value under a numeric limit is not satisfied — fail-closed).
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
      return value === predicate.value;
    case 'notEquals':
      return value !== predicate.value;
    case 'oneOf':
      return typeof value === 'string' && predicate.values.includes(value);
    case 'flag':
      return typeof value === 'boolean' && value === predicate.expected;
  }
}

// ---------------------------------------------------------------------------
// Goal statement mirror
// ---------------------------------------------------------------------------

/**
 * One structured success criterion — mirror of control-domain's
 * `SuccessCriterion`. `metric` is an identifier path into the outcome
 * metric space the evaluation lane populates; the organization compiler's
 * DECLARED demand derivation reads the FIRST path segment of each metric
 * (see compiler.ts).
 */
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

/**
 * The structured success criteria — mirror of control-domain's
 * `GoalSuccessCriteria`. Non-empty; criterion ids unique;
 * `requiredSatisfaction` in [0, 1].
 */
export interface GoalSuccessCriteriaMirror {
  readonly criteria: readonly SuccessCriterionMirror[];
  /** Required share of criteria satisfied for attainment, [0, 1]. */
  readonly requiredSatisfaction: number;
}

/**
 * Evaluation horizon — mirror of control-domain's `GoalHorizon`.
 * `endsAt` is EXCLUSIVE: the horizon covers `[startsAt, endsAt)`.
 */
export interface GoalHorizonMirror {
  readonly startsAt: TimestampMs;
  readonly endsAt: TimestampMs;
  readonly label?: string;
}

/**
 * The evaluation discipline the goal demands — mirror of control-domain's
 * `GoalEvaluationPolicy`. The refs are OPAQUE string references to policy
 * records owned by the evaluation lane (T012). `adversarialRequired`
 * drives the compiler's adversarial-population axis (L10 discipline).
 */
export interface GoalEvaluationPolicyMirror {
  readonly blindRef: string;
  readonly walkForwardRef: string;
  readonly regimeRef: string;
  /** Adversarial stress requirement before attainment is claimable (L10). */
  readonly adversarialRequired: boolean;
}

/**
 * The goal statement as the organization compiler receives it — mirror of
 * control-domain's `GoalStatement` (field-for-field; mutually assignable —
 * interop.test.ts). The compiler compiles FROM this record; it never
 * mutates it and never scores acceptance.
 */
export interface GoalStatementMirror {
  readonly id: GoalRef;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
  /** Owning tenant (L12). */
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
// Constraint set mirror
// ---------------------------------------------------------------------------

/** Phase of the trading loop a constraint applies to. Mirror of control-domain. */
export type ConstraintDomainMirror = 'observation' | 'state' | 'action' | 'outcome';

/** The closed constraint-domain vocabulary (mirror). */
export const CONSTRAINT_DOMAINS_MIRROR: readonly ConstraintDomainMirror[] = [
  'observation',
  'state',
  'action',
  'outcome',
] as const;

/** How a violation of this constraint is aggregated. Mirror of control-domain. */
export type ConstraintSeverityMirror = 'advisory' | 'blocking';

/** The closed constraint-severity vocabulary (mirror). */
export const CONSTRAINT_SEVERITIES_MIRROR: readonly ConstraintSeverityMirror[] = [
  'advisory',
  'blocking',
] as const;

/**
 * A single executable constraint — mirror of control-domain's
 * `ConstraintStatement`. `subject` is a key into the evaluation context —
 * the same identifier-path address space as criterion metrics. The
 * organization compiler screens candidates against BLOCKING constraints
 * whose subjects address search-measurable axes (see compiler.ts); every
 * other constraint binds evaluation (T012), never the search.
 */
export interface ConstraintStatementMirror {
  /** Unique within the set. */
  readonly id: string;
  readonly domain: ConstraintDomainMirror;
  readonly subject: string;
  readonly predicate: CriterionPredicateMirror;
  readonly severity: ConstraintSeverityMirror;
  /** Human explanation. NEVER interpreted. */
  readonly description?: string;
}

/**
 * A versioned collection of executable constraints, tenant-scoped — mirror
 * of control-domain's `ConstraintSetStatement`. May be EMPTY (a vacuous
 * set: it satisfies nothing, it never passes vacuously — the mirror keeps
 * control-domain's fail-closed semantics).
 */
export interface ConstraintSetStatementMirror {
  readonly id: ConstraintSetRef;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
  /** Owning tenant (L12). Must match the goal's tenant to compile. */
  readonly tenantId: TenantId;
  readonly name?: string;
  readonly constraints: readonly ConstraintStatementMirror[];
  readonly createdAt: TimestampMs;
}

// ---------------------------------------------------------------------------
// Guards (total, hand-rolled, never throw)
// ---------------------------------------------------------------------------

/** Guard: `SuccessCriterionMirror`. */
export function isSuccessCriterionMirror(v: unknown): v is SuccessCriterionMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isIdentifierPath(v.metric)) return false;
  if (!isCriterionPredicateMirror(v.predicate)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

/** Guard: `GoalSuccessCriteriaMirror`. */
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

/** Guard: `GoalHorizonMirror`. */
export function isGoalHorizonMirror(v: unknown): v is GoalHorizonMirror {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.startsAt) || !isTimestampMs(v.endsAt)) return false;
  if (v.endsAt <= v.startsAt) return false; // non-empty horizon
  if (v.label !== undefined && !isNonEmptyString(v.label)) return false;
  return true;
}

/** Guard: `GoalEvaluationPolicyMirror`. */
export function isGoalEvaluationPolicyMirror(v: unknown): v is GoalEvaluationPolicyMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.blindRef)) return false;
  if (!isNonEmptyString(v.walkForwardRef)) return false;
  if (!isNonEmptyString(v.regimeRef)) return false;
  if (typeof v.adversarialRequired !== 'boolean') return false;
  return true;
}

/** Guard: `GoalStatementMirror`. */
export function isGoalStatementMirror(v: unknown): v is GoalStatementMirror {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'string' || v.id.trim().length === 0) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (typeof v.tenantId !== 'string' || v.tenantId.trim().length === 0) return false;
  if (!isNonEmptyString(v.objective)) return false;
  if (!isGoalHorizonMirror(v.horizon)) return false;
  if (!isGoalSuccessCriteriaMirror(v.successCriteria)) return false;
  if (!isGoalEvaluationPolicyMirror(v.evaluation)) return false;
  if (!isTimestampMs(v.createdAt)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

/** Guard: `ConstraintDomainMirror`. */
export function isConstraintDomainMirror(v: unknown): v is ConstraintDomainMirror {
  return isNonEmptyString(v) && (CONSTRAINT_DOMAINS_MIRROR as readonly string[]).includes(v);
}

/** Guard: `ConstraintSeverityMirror`. */
export function isConstraintSeverityMirror(v: unknown): v is ConstraintSeverityMirror {
  return isNonEmptyString(v) && (CONSTRAINT_SEVERITIES_MIRROR as readonly string[]).includes(v);
}

/** Guard: `ConstraintStatementMirror`. */
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

/** Guard: `ConstraintSetStatementMirror`. */
export function isConstraintSetStatementMirror(v: unknown): v is ConstraintSetStatementMirror {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'string' || v.id.trim().length === 0) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (typeof v.tenantId !== 'string' || v.tenantId.trim().length === 0) return false;
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
