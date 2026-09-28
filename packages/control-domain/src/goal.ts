// @tradrl/control-domain — GoalStatement: the control plane's authored goal
// contract (R1, spec/DOMAIN-MODEL.md "Goal", spec/ARCHITECTURE.md core flow
// "User -> Goal/Constraint Compiler -> ...").
//
// The control plane IS the Goal/Constraint Compiler's host: goals enter the
// program here as structured records and are compiled (see acceptance.ts)
// into executable AcceptanceCriteria. The shapes below mirror
// packages/domain-core/src/goal.ts BY STRUCTURE (never imported — D-004):
//
// - `GoalHorizon` is an EXACT structural mirror of domain-core's GoalHorizon
//   (assignable in both directions; trip-wired in src/interop.test.ts).
// - `GoalStatement` carries the domain-core Goal's compile-relevant components
//   (objective, horizon, constraint-set reference, success criteria) plus the
//   control-plane additions the compiled artifact needs:
//     * `version` — control-plane goal version. Domain-core goals are
//       immutable with no in-record version ("identity is the version"); the
//       control plane pins a {goalId, version} lineage ref (L15) so a project
//       always records WHICH goal statement it was launched with.
//     * `evaluationPolicy` — the goal pins its evaluation protocol (blind /
//       walk-forward / regime) at authoring time, so evaluation cannot be
//       shopped later (L10 adversarial evaluation, L11 search integrity).
//       spec/ARCHITECTURE.md "Evaluation": "Acceptance is objective-and-
//       constraint based. Use blind/unseen, walk-forward, regime ... tests".
//     * `successCriteria` — a non-empty LIST of structured criteria. Each
//       criterion mirrors the SHAPE of domain-core's GoalSuccessCriteria
//       (constraint-set reference lifted to the goal level + required
//       satisfaction share) and adds a criterion id and an optional gating
//       constraint selector. A domain-core Goal maps to a GoalStatement with
//       exactly one criterion carrying the same requiredSatisfaction —
//       documented interpretation, generalizing the singular shape without
//       contradicting it.
//
// Laws honored here (spec/ARCHITECTURE-LOCK.md):
// - L5 "User constraints are executable acceptance criteria": success
//   criteria are structured records, never prose — `objective` and
//   `description` are human interpretation only, NEVER executed.
// - L7: requiredSatisfaction compares against constraint-satisfaction ratios;
//   no field on this record can express attainment by raw PnL.
// - L12: goal statements carry no tenant field themselves — they are always
//   handled inside a tenant-scoped ProjectRecord.

import {
  Timestamp,
  compareTimestamps,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestamp,
  isUnitInterval,
} from './primitives';
import { GoalRef, isGoalRef } from './ids';
import { ConstraintSetRef, isConstraintSetRef } from './constraints';

// ---------------------------------------------------------------------------
// GoalHorizon — EXACT structural mirror of domain-core's GoalHorizon
// ---------------------------------------------------------------------------

/** Evaluation horizon. `endsAt` is EXCLUSIVE (the goal covers [startsAt, endsAt)). */
export interface GoalHorizon {
  readonly startsAt: Timestamp;
  readonly endsAt: Timestamp;
  readonly label?: string;
}

/** Guard — behaviorally identical to domain-core's `isGoalHorizon`. */
export function isGoalHorizon(v: unknown): v is GoalHorizon {
  if (!isRecord(v)) return false;
  if (!isTimestamp(v.startsAt) || !isTimestamp(v.endsAt)) return false;
  if (compareTimestamps(v.startsAt, v.endsAt) >= 0) return false; // non-empty horizon
  if (v.label !== undefined && !isNonEmptyString(v.label)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// GoalVersionRef — the L15 lineage reference to a goal statement
// ---------------------------------------------------------------------------

/**
 * Versioned reference to a goal statement: identity is (goalId, version).
 * Mirrors the versioning discipline of domain-core's ConstraintSetRef.
 */
export interface GoalVersionRef {
  readonly goalId: GoalRef;
  readonly version: number;
}

/** Guard: non-empty goal id and an integer version >= 1. */
export function isGoalVersionRef(v: unknown): v is GoalVersionRef {
  if (!isRecord(v)) return false;
  if (!isGoalRef(v.goalId)) return false;
  if (!isPositiveInteger(v.version)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// EvaluationPolicy — the goal pins its evaluation protocol
// ---------------------------------------------------------------------------

/**
 * Evaluation protocol pinned at goal authoring. All three references are
 * OPAQUE STRINGS owned by the evaluation lane (T012) — the control plane only
 * requires that they are pinned, non-empty and carried into the compiled
 * AcceptanceCriteria, so the evaluator cannot choose a friendly protocol
 * after the fact (L10/L11).
 */
export interface EvaluationPolicy {
  /** Opaque reference to the blind / unseen evaluation protocol artifact. */
  readonly blindEvaluationRef: string;
  /** Opaque reference to the walk-forward split protocol artifact. */
  readonly walkForwardRef: string;
  /** Opaque reference to the regime coverage protocol artifact. */
  readonly regimeRef: string;
}

/** Guard: all three protocol references are non-empty opaque strings. */
export function isEvaluationPolicy(v: unknown): v is EvaluationPolicy {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.blindEvaluationRef) && isNonEmptyString(v.walkForwardRef) && isNonEmptyString(v.regimeRef);
}

// ---------------------------------------------------------------------------
// SuccessCriterion — structured, executable attainment criterion
// ---------------------------------------------------------------------------

/**
 * One structured success criterion. Shape-mirrors domain-core's
 * GoalSuccessCriteria (required satisfaction share over a constraint set)
 * with the constraint-set reference lifted to the goal level, plus:
 * - `id`: criterion identity within the goal (evidence pairs back through it);
 * - `gatingConstraintIds`: optional selector of the constraint ids from the
 *   goal's constraint set that gate THIS criterion. Omitted (or `undefined`)
 *   means "all constraints in the set gate it". The compiler resolves the
 *   selector and rejects unknown, duplicate or empty selections.
 */
export interface SuccessCriterion {
  readonly id: string;
  /** Constraint ids from the goal's constraint set gating this criterion. Omitted = all. */
  readonly gatingConstraintIds?: readonly string[];
  /** Required share of applicable gating constraints satisfied, closed interval [0,1]. */
  readonly requiredSatisfaction: number;
  /** Human context. NEVER interpreted. */
  readonly description?: string;
}

/** Guard: `SuccessCriterion`. */
export function isSuccessCriterion(v: unknown): v is SuccessCriterion {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (v.gatingConstraintIds !== undefined) {
    if (!Array.isArray(v.gatingConstraintIds)) return false;
    if (!v.gatingConstraintIds.every((x) => isNonEmptyString(x))) return false;
    if (new Set(v.gatingConstraintIds).size !== v.gatingConstraintIds.length) return false;
    if (v.gatingConstraintIds.length === 0) return false; // empty selector is meaningless — omit instead
  }
  if (!isUnitInterval(v.requiredSatisfaction)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// GoalStatement
// ---------------------------------------------------------------------------

/**
 * A structured, versioned goal statement — the input the control plane
 * compiles. Invariants:
 * - non-empty horizon (startsAt < endsAt by instant);
 * - exactly one pinned constraint-set version for the whole statement;
 * - at least one success criterion, with unique criterion ids;
 * - a pinned evaluation protocol (all three refs non-empty);
 * - `objective`/`description` are human-readable interpretation and are never
 *   executed (spec/DOMAIN-MODEL.md Goal; contracts/domain/goal.md).
 */
export interface GoalStatement {
  readonly id: GoalRef;
  /** Control-plane goal version (>= 1). Revision of a goal is a new version. */
  readonly version: number;
  readonly createdAt: Timestamp;
  /** Human-readable objective statement. Interpretation, never execution. */
  readonly objective: string;
  readonly horizon: GoalHorizon;
  /** The goal's constraint set, pinned to a specific version. */
  readonly constraintSet: ConstraintSetRef;
  /** Structured success criteria (non-empty; ids unique within the goal). */
  readonly successCriteria: readonly SuccessCriterion[];
  /** Evaluation protocol pinned at authoring (L10/L11). */
  readonly evaluationPolicy: EvaluationPolicy;
  readonly description?: string;
}

/** Guard: `GoalStatement`. */
export function isGoalStatement(v: unknown): v is GoalStatement {
  if (!isRecord(v)) return false;
  if (!isGoalRef(v.id)) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (!isTimestamp(v.createdAt)) return false;
  if (!isNonEmptyString(v.objective)) return false;
  if (!isGoalHorizon(v.horizon)) return false;
  if (!isConstraintSetRef(v.constraintSet)) return false;
  if (!Array.isArray(v.successCriteria) || v.successCriteria.length === 0) return false;
  if (!v.successCriteria.every((c) => isSuccessCriterion(c))) return false;
  const ids = v.successCriteria.map((c) => (c as SuccessCriterion).id);
  if (new Set(ids).size !== ids.length) return false; // criterion ids unique
  if (!isEvaluationPolicy(v.evaluationPolicy)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}
