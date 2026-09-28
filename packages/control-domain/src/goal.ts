// @tradrl/control-domain — GoalStatement: mirror of the goal contract.
//
// STRUCTURAL MIRROR of @tradrl/domain-core/src/goal.ts (T002) — DO NOT
// DIVERGE IN SHAPE. The frozen workspace lockfile forbids a package
// dependency between contract packages, so this module re-declares the goal
// shapes by STRUCTURE (never by import):
// - `objective` / `horizon` / `successCriteria` mirror domain-core's `Goal`
//   fields one-for-one (see the mapping table in the package README).
// - The scalar time representation is the control plane's canonical
//   `TimestampMs` (time-engine mirror) instead of domain-core's ISO-string
//   `Timestamp` — one time representation across the whole control plane.
// - Where domain-core's `GoalSuccessCriteria` points at a versioned
//   constraint set, the control plane requires the criteria to be
//   STRUCTURED RECORDS carried in the statement itself: "user constraints
//   are executable acceptance criteria" (R1 discipline; L5/L7) — prose
//   criteria cannot compile.
//
// Spec anchors: spec/DOMAIN-MODEL.md (Goal), spec/REQUIREMENTS.md R1,
// spec/ARCHITECTURE-LOCK.md L12 (tenant scope), L15 (versioned goal
// lineage), L7 (objective-and-constraint based attainment).

import {
  isFiniteNumber,
  isIdentifierPath,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isUnitInterval,
} from './primitives';
import { GoalRef, TenantId, isGoalRef, isTenantId } from './ids';
import { TimestampMs, isTimestampMs } from './timestamp';

// ---------------------------------------------------------------------------
// Predicate vocabulary (structural mirror of domain-core's `Predicate`)
// ---------------------------------------------------------------------------

/** Scalar value observable in an evaluation metric space. */
export type CriterionValue = number | string | boolean;

/**
 * Executable predicate over a criterion metric. Discriminated by `kind` —
 * the SAME closed vocabulary and the SAME semantics as
 * `@tradrl/domain-core`'s `Predicate` (limit bounds, typed equality,
 * membership, flags). The evaluation lane (T012) executes these mirrors;
 * the control plane never imports the domain-core originals.
 */
export type CriterionPredicate =
  | { readonly kind: 'limit.max'; readonly bound: number }
  | { readonly kind: 'limit.min'; readonly bound: number }
  | { readonly kind: 'limit.range'; readonly min: number; readonly max: number }
  | { readonly kind: 'equals'; readonly value: CriterionValue }
  | { readonly kind: 'notEquals'; readonly value: CriterionValue }
  | { readonly kind: 'oneOf'; readonly values: readonly string[] }
  | { readonly kind: 'flag'; readonly expected: boolean };

export const CRITERION_PREDICATE_KINDS: readonly CriterionPredicate['kind'][] = [
  'limit.max',
  'limit.min',
  'limit.range',
  'equals',
  'notEquals',
  'oneOf',
  'flag',
] as const;

// ---------------------------------------------------------------------------
// Structured success criteria
// ---------------------------------------------------------------------------

/**
 * One structured success criterion: WHAT must hold, over WHICH metric, and
 * the executable predicate that decides it. `metric` is an identifier path
 * into the outcome metric space the evaluation lane (T012) populates — the
 * same address space as domain-core constraint subjects, so criteria and
 * constraints speak about the same measurement families (see the gating
 * rule in acceptance.ts).
 *
 * This record is the unit of "structured success criteria": a goal whose
 * success criteria are prose (or anything that is not a list of these
 * records) FAILS TO COMPILE with a typed error — attainment is never
 * left to interpretation.
 */
export interface SuccessCriterion {
  /** Unique within the goal statement. */
  readonly id: string;
  /** Identifier path of the metric this criterion decides attainment on. */
  readonly metric: string;
  /** Executable predicate over the metric value. */
  readonly predicate: CriterionPredicate;
  /** Human context. NEVER interpreted. */
  readonly description?: string;
}

/**
 * The structured form of domain-core's `GoalSuccessCriteria`: the criteria
 * list replaces the constraint-set pointer (the constraint set is an
 * explicit second input to the compiler), and `requiredSatisfaction`
 * keeps the identical semantics — required share of applicable criteria
 * satisfied, closed interval [0, 1].
 */
export interface GoalSuccessCriteria {
  /** Non-empty; criterion ids unique. A goal that succeeds at nothing is degenerate. */
  readonly criteria: readonly SuccessCriterion[];
  /** Required share of criteria satisfied for attainment, [0, 1]. */
  readonly requiredSatisfaction: number;
}

// ---------------------------------------------------------------------------
// Horizon (structural mirror of domain-core's `GoalHorizon`)
// ---------------------------------------------------------------------------

/**
 * Evaluation horizon. `startsAt`/`endsAt` are epoch milliseconds;
 * `endsAt` is EXCLUSIVE — the horizon covers `[startsAt, endsAt)` —
 * matching domain-core's horizon semantics.
 */
export interface GoalHorizon {
  readonly startsAt: TimestampMs;
  readonly endsAt: TimestampMs;
  readonly label?: string;
}

// ---------------------------------------------------------------------------
// Evaluation policy declaration (authored with the goal)
// ---------------------------------------------------------------------------

/**
 * The evaluation discipline the goal demands, declared at authoring and
 * COMPILED into the AcceptanceCriteria. The three refs are OPAQUE STRING
 * references to policy records owned by the evaluation lane (T012):
 * blind/unseen policy, walk-forward split definition, regime coverage
 * definition. Opaque means exactly that: the control plane never resolves
 * or interprets them; it pins them so attainment can only be claimed
 * through the referenced discipline (L7/L10 — friendly replay alone can
 * never release a project).
 */
export interface GoalEvaluationPolicy {
  readonly blindRef: string;
  readonly walkForwardRef: string;
  readonly regimeRef: string;
  /** Adversarial stress requirement before attainment is claimable (L10). */
  readonly adversarialRequired: boolean;
}

// ---------------------------------------------------------------------------
// GoalStatement
// ---------------------------------------------------------------------------

/**
 * The goal statement as the control plane receives it: objective (for
 * humans and compilers — never executed), horizon, STRUCTURED success
 * criteria, evaluation policy declaration, tenant scope and version.
 *
 * Versioning: goal statements are immutable; a revision is a NEW VERSION
 * under the same `id` (mirroring domain-core's discipline that goal
 * revision is a new record — there identity is the version, here the
 * version is explicit so L15 lineage can carry `(goalId, version)` pairs).
 */
export interface GoalStatement {
  readonly id: GoalRef;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
  /** Owning tenant (L12: goals are tenant-scoped). */
  readonly tenantId: TenantId;
  /** Human-readable objective statement. Interpreted, never executed. */
  readonly objective: string;
  readonly horizon: GoalHorizon;
  readonly successCriteria: GoalSuccessCriteria;
  readonly evaluation: GoalEvaluationPolicy;
  readonly createdAt: TimestampMs;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Guards (total, hand-rolled, never throw)
// ---------------------------------------------------------------------------

export function isCriterionValue(v: unknown): v is CriterionValue {
  if (typeof v === 'boolean') return true;
  if (typeof v === 'string') return isNonEmptyString(v);
  return isFiniteNumber(v);
}

export function isCriterionPredicate(v: unknown): v is CriterionPredicate {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'limit.max':
    case 'limit.min':
      return isFiniteNumber(v.bound);
    case 'limit.range':
      return isFiniteNumber(v.min) && isFiniteNumber(v.max) && v.min <= v.max;
    case 'equals':
    case 'notEquals':
      return isCriterionValue(v.value);
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

export function isSuccessCriterion(v: unknown): v is SuccessCriterion {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isIdentifierPath(v.metric)) return false;
  if (!isCriterionPredicate(v.predicate)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

export function isGoalSuccessCriteria(v: unknown): v is GoalSuccessCriteria {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.criteria) || v.criteria.length === 0) return false;
  if (!v.criteria.every((x) => isSuccessCriterion(x))) return false;
  const seen = new Set<string>();
  for (const c of v.criteria) {
    const criterion = c as SuccessCriterion;
    if (seen.has(criterion.id)) return false; // ids unique within the goal
    seen.add(criterion.id);
  }
  if (!isUnitInterval(v.requiredSatisfaction)) return false;
  return true;
}

export function isGoalHorizon(v: unknown): v is GoalHorizon {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.startsAt) || !isTimestampMs(v.endsAt)) return false;
  if (v.endsAt <= v.startsAt) return false; // non-empty horizon
  if (v.label !== undefined && !isNonEmptyString(v.label)) return false;
  return true;
}

export function isGoalEvaluationPolicy(v: unknown): v is GoalEvaluationPolicy {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.blindRef)) return false;
  if (!isNonEmptyString(v.walkForwardRef)) return false;
  if (!isNonEmptyString(v.regimeRef)) return false;
  if (typeof v.adversarialRequired !== 'boolean') return false;
  return true;
}

export function isGoalStatement(v: unknown): v is GoalStatement {
  if (!isRecord(v)) return false;
  if (!isGoalRef(v.id)) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isNonEmptyString(v.objective)) return false;
  if (!isGoalHorizon(v.horizon)) return false;
  if (!isGoalSuccessCriteria(v.successCriteria)) return false;
  if (!isGoalEvaluationPolicy(v.evaluation)) return false;
  if (!isTimestampMs(v.createdAt)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}
