// @tradrl/control-domain — AcceptanceCriteria: the COMPILED artifact.
//
// This is the core deliverable of the Goal/Constraint Compiler stage of the
// core flow (spec/ARCHITECTURE.md: "User -> Goal/Constraint Compiler -> ...").
// `compileAcceptance(goal, constraintSet)` is a PURE, DETERMINISTIC function:
// - same inputs -> deeply-equal outputs (the artifact id is content-addressed
//   from the lineage, no ambient clock, no randomness);
// - unstructured success criteria FAIL to compile with a typed error;
// - cross-tenant goal/constraint-set pairs FAIL to compile (L12);
// - the output is deeply frozen (immutable compiled artifact).
//
// PnL-solicitude (L7, by construction): the compiled artifact carries ONLY
// the definitions of attainment — criteria (metric + executable predicate),
// the gating constraints, and the evaluation policy (blind / walk-forward /
// regime / adversarial refs owned by T012). There is NO field anywhere on
// this record where a realized PnL number or a verdict could be stored:
// "attained" can only be decided by the evaluation lane (T012) executing
// these definitions under the referenced discipline. The structural
// assertion lives in acceptance.test.ts.
//
// Spec anchors: spec/DOMAIN-MODEL.md (Goal, ConstraintSet, Project),
// spec/EVALUATION-PROTOCOL.md (acceptance = objective-and-constraint based;
// blind/walk-forward/adversarial discipline), spec/ARCHITECTURE-LOCK.md
// L7, L10, L12, L15.

import { deepFreeze, isNonEmptyString, isRecord, isUnitInterval, isArrayOf } from './primitives';
import {
  AcceptanceCriteriaId,
  ConstraintSetVersionRef,
  GoalVersionRef,
  acceptanceCriteriaId,
  isAcceptanceCriteriaId,
  isConstraintSetVersionRef,
  isGoalVersionRef,
} from './ids';
import {
  ConstraintSetStatement,
  isConstraintSetStatement,
} from './constraints';
import {
  GoalStatement,
  SuccessCriterion,
  isCriterionPredicate,
  isGoalStatement,
  isSuccessCriterion,
} from './goal';
import { ControlDomainError, ControlErrorCode } from './errors';

// ---------------------------------------------------------------------------
// Lineage (L15: continuity is queryable on every control-plane record)
// ---------------------------------------------------------------------------

/**
 * Lineage block of a compiled artifact: the versioned goal and constraint
 * set it was compiled from. The artifact is compiled BEFORE a project
 * exists, so it cannot yet carry a project id — the project binds the
 * artifact and then carries the full three-part lineage
 * (`ProjectLineage`); the query chain is
 * project -> criteria id -> (goal version, constraint set version).
 */
export interface AcceptanceLineage {
  readonly goal: GoalVersionRef;
  readonly constraintSet: ConstraintSetVersionRef;
}

/** Guard: `AcceptanceLineage` (non-empty ids, versioned refs). */
export function isAcceptanceLineage(v: unknown): v is AcceptanceLineage {
  if (!isRecord(v)) return false;
  return isGoalVersionRef(v.goal) && isConstraintSetVersionRef(v.constraintSet);
}

// ---------------------------------------------------------------------------
// The compiled artifact
// ---------------------------------------------------------------------------

/**
 * One success criterion PAIRED with the ids of the constraints that gate
 * it. The pairing is derived by the compiler's gating rule
 * ({@link gatesConstraint}): a constraint gates a criterion when they
 * address the same measurement family (their identifier paths are
 * segment-wise prefixes of each other), regardless of the constraint's
 * phase — a constraint on "risk" gates a criterion on
 * "risk.maxDrawdown", a constraint on "returns.sharpe.netOfFees" gates a
 * criterion on "returns.sharpe".
 */
export interface CompiledCriterion {
  readonly criterion: SuccessCriterion;
  /** Constraint ids (resolvable in `constraints`) that gate this criterion. */
  readonly gatingConstraintIds: readonly string[];
}

/**
 * Evaluation policy compiled into the artifact: the opaque refs to the
 * blind/unseen policy, walk-forward split and regime coverage definitions
 * (all owned by T012 — the control plane pins them, never resolves them),
 * the adversarial requirement (L10), and the required share of criteria
 * satisfied for attainment.
 */
export interface EvaluationPolicy {
  readonly blindRef: string;
  readonly walkForwardRef: string;
  readonly regimeRef: string;
  readonly adversarialRequired: boolean;
  /** Required share of criteria satisfied for attainment, [0, 1]. */
  readonly requiredSatisfaction: number;
}

/**
 * The compiled acceptance criteria — the executable definition of
 * "attained" for a (goal version, constraint set version) pair.
 *
 * Versioning: the record is content-addressed — `id` is derived
 * deterministically from the lineage, so recompiling the same lineage
 * yields the IDENTICAL record (same id, `version` 1). A goal or
 * constraint-set version bump changes the id, producing a distinct
 * artifact. Identity is `(id, version)`; the compiler always emits
 * version 1 because content-addressing already discriminates every
 * distinct compilation.
 *
 * Self-containment: the full validated constraint snapshot is embedded,
 * so the evaluation lane (T012) and the organization compiler (T016) can
 * execute the artifact WITHOUT resolving external state (see
 * services/control-plane/README.md).
 */
export interface AcceptanceCriteria {
  readonly id: AcceptanceCriteriaId;
  readonly version: number;
  /** Owning tenant (L12). */
  readonly tenantId: string;
  readonly lineage: AcceptanceLineage;
  /** Non-empty; criterion ids unique. */
  readonly criteria: readonly CompiledCriterion[];
  /** Validated snapshot of the constraint set; constraint ids unique. May be empty (satisfies nothing). */
  readonly constraints: ConstraintSetStatement['constraints'];
  readonly policy: EvaluationPolicy;
}

// ---------------------------------------------------------------------------
// Guards (total, hand-rolled, never throw)
// ---------------------------------------------------------------------------

/** Guard: `CompiledCriterion`. */
export function isCompiledCriterion(v: unknown): v is CompiledCriterion {
  if (!isRecord(v)) return false;
  if (!isSuccessCriterion(v.criterion)) return false;
  if (!Array.isArray(v.gatingConstraintIds)) return false;
  const seen = new Set<string>();
  for (const id of v.gatingConstraintIds) {
    if (!isNonEmptyString(id)) return false;
    if (seen.has(id)) return false; // no duplicate gates within a criterion
    seen.add(id);
  }
  return true;
}

/** Guard: `EvaluationPolicy`. */
export function isEvaluationPolicy(v: unknown): v is EvaluationPolicy {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.blindRef)) return false;
  if (!isNonEmptyString(v.walkForwardRef)) return false;
  if (!isNonEmptyString(v.regimeRef)) return false;
  if (typeof v.adversarialRequired !== 'boolean') return false;
  if (!isUnitInterval(v.requiredSatisfaction)) return false;
  return true;
}

/** Guard: `AcceptanceCriteria` (includes cross-field resolvability of gates). */
export function isAcceptanceCriteria(v: unknown): v is AcceptanceCriteria {
  if (!isRecord(v)) return false;
  if (!isAcceptanceCriteriaId(v.id)) return false;
  if (typeof v.version !== 'number' || !Number.isInteger(v.version) || v.version < 1) return false;
  if (!isNonEmptyString(v.tenantId)) return false;
  if (!isAcceptanceLineage(v.lineage)) return false;
  if (!Array.isArray(v.criteria) || v.criteria.length === 0) return false;
  if (!v.criteria.every((x) => isCompiledCriterion(x))) return false;
  const criterionIds = new Set<string>();
  for (const compiled of v.criteria) {
    const id = (compiled as CompiledCriterion).criterion.id;
    if (criterionIds.has(id)) return false; // ids unique
    criterionIds.add(id);
  }
  if (!Array.isArray(v.constraints)) return false;
  const constraintIds = new Set<string>();
  for (const c of v.constraints) {
    const constraint = c as ConstraintSetStatement['constraints'][number];
    if (!isNonEmptyString(constraint?.id)) return false;
    if (constraintIds.has(constraint.id)) return false;
    constraintIds.add(constraint.id);
  }
  if (!isEvaluationPolicy(v.policy)) return false;
  // Cross-field: every gate must resolve to an embedded constraint.
  for (const compiled of v.criteria) {
    for (const gate of (compiled as CompiledCriterion).gatingConstraintIds) {
      if (!constraintIds.has(gate)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// The gating rule
// ---------------------------------------------------------------------------

/**
 * `true` when the constraint `subject` gates the criterion `metric`: the
 * two identifier paths address the same measurement family, i.e. one is a
 * segment-wise prefix of the other. Total (non-strings => false).
 *
 * Examples:
 * - gatesConstraint('risk', 'risk.maxDrawdown') === true (family level)
 * - gatesConstraint('risk.maxDrawdown', 'risk.maxDrawdown') === true (exact)
 * - gatesConstraint('risk.maxDrawdown.daily', 'risk.maxDrawdown') === true (extension)
 * - gatesConstraint('risk', 'returns.sharpe') === false (different family)
 */
export function gatesConstraint(subject: string, metric: string): boolean {
  if (typeof subject !== 'string' || typeof metric !== 'string') return false;
  if (subject.length === 0 || metric.length === 0) return false;
  const a = subject.split('.');
  const b = metric.split('.');
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Diagnosis (typed-error classification for invalid inputs)
// ---------------------------------------------------------------------------

interface Diagnosis {
  readonly code: ControlErrorCode;
  readonly details: readonly string[];
}

/**
 * Classifies WHY a goal statement is invalid. Unstructured success
 * criteria (prose, non-records, non-array) get their own code —
 * "user constraints are executable acceptance criteria" — as do vacuous
 * (empty) criteria lists; everything else is a field-level
 * `invalid-goal` problem.
 */
function diagnoseGoal(v: unknown): Diagnosis {
  if (!isRecord(v)) {
    return { code: 'invalid-goal', details: ['goal: not a record'] };
  }
  const criteriaField = v.successCriteria;
  if (!isRecord(criteriaField) || !Array.isArray(criteriaField.criteria)) {
    return {
      code: 'unstructured-criteria',
      details: ['successCriteria: expected a structured record { criteria: SuccessCriterion[], requiredSatisfaction }'],
    };
  }
  if (criteriaField.criteria.length === 0) {
    return {
      code: 'empty-success-criteria',
      details: ['successCriteria.criteria: a goal must define at least one structured success criterion'],
    };
  }
  if (!criteriaField.criteria.every((x) => isSuccessCriterion(x))) {
    return {
      code: 'unstructured-criteria',
      details: ['successCriteria.criteria: every entry must be a structured SuccessCriterion record (id, metric, predicate)'],
    };
  }
  const problems: string[] = [];
  if (!isGoalStatement(v.id)) problems.push('id: invalid GoalRef (non-empty string)');
  if (typeof v.version !== 'number' || !Number.isInteger(v.version) || v.version < 1) {
    problems.push('version: expected an integer >= 1');
  }
  if (!isGoalStatement(v.tenantId) && !isNonEmptyString(v.tenantId)) {
    problems.push('tenantId: invalid TenantId');
  }
  if (!isNonEmptyString(v.objective)) problems.push('objective: non-empty string required');
  const horizon = v.horizon;
  if (!isRecord(horizon)) problems.push('horizon: invalid GoalHorizon record');
  else {
    if (typeof horizon.startsAt !== 'number' || !Number.isFinite(horizon.startsAt)) {
      problems.push('horizon.startsAt: invalid TimestampMs');
    }
    if (typeof horizon.endsAt !== 'number' || !Number.isFinite(horizon.endsAt)) {
      problems.push('horizon.endsAt: invalid TimestampMs');
    }
    if (
      typeof horizon.startsAt === 'number' &&
      typeof horizon.endsAt === 'number' &&
      Number.isFinite(horizon.startsAt) &&
      Number.isFinite(horizon.endsAt) &&
      horizon.endsAt <= horizon.startsAt
    ) {
      problems.push('horizon: endsAt must be strictly after startsAt');
    }
  }
  if (!isUnitInterval(criteriaField.requiredSatisfaction)) {
    problems.push('successCriteria.requiredSatisfaction: expected a number in [0, 1]');
  }
  const evaluation = v.evaluation;
  if (!isRecord(evaluation)) problems.push('evaluation: invalid GoalEvaluationPolicy record');
  else {
    if (!isNonEmptyString(evaluation.blindRef)) problems.push('evaluation.blindRef: non-empty opaque ref required');
    if (!isNonEmptyString(evaluation.walkForwardRef)) problems.push('evaluation.walkForwardRef: non-empty opaque ref required');
    if (!isNonEmptyString(evaluation.regimeRef)) problems.push('evaluation.regimeRef: non-empty opaque ref required');
    if (typeof evaluation.adversarialRequired !== 'boolean') {
      problems.push('evaluation.adversarialRequired: boolean required');
    }
  }
  if (typeof v.createdAt !== 'number' || !Number.isFinite(v.createdAt)) {
    problems.push('createdAt: invalid TimestampMs');
  }
  if (problems.length === 0) {
    // Unreachable when the goal guard is the sole authority; kept as the
    // fail-closed fallback for fields the guard rejects but the diagnosis
    // above does not cover (e.g. duplicate criterion ids, description).
    problems.push('goal: failed structural validation');
  }
  return { code: 'invalid-goal', details: problems };
}

/** Classifies WHY a constraint-set statement is invalid (field-level). */
function diagnoseConstraintSet(v: unknown): Diagnosis {
  if (!isRecord(v)) {
    return { code: 'invalid-constraint-set', details: ['constraintSet: not a record'] };
  }
  const problems: string[] = [];
  if (!isNonEmptyString(v.id)) problems.push('id: invalid ConstraintSetRef (non-empty string)');
  if (typeof v.version !== 'number' || !Number.isInteger(v.version) || v.version < 1) {
    problems.push('version: expected an integer >= 1');
  }
  if (!isNonEmptyString(v.tenantId)) problems.push('tenantId: invalid TenantId');
  if (!Array.isArray(v.constraints)) problems.push('constraints: expected an array of ConstraintStatement');
  else {
    const seen = new Set<string>();
    for (const c of v.constraints) {
      if (!isRecord(c)) {
        problems.push('constraints: every entry must be a ConstraintStatement record');
        break;
      }
      if (!isNonEmptyString(c.id)) {
        problems.push('constraints[].id: non-empty string required, unique within the set');
        break;
      }
      if (seen.has(c.id)) {
        problems.push(`constraints[].id: duplicate constraint id ${JSON.stringify(c.id)}`);
        break;
      }
      seen.add(c.id);
      if (!isCriterionPredicate(c.predicate)) {
        problems.push(`constraints[${JSON.stringify(c.id)}].predicate: invalid predicate record`);
      }
    }
  }
  if (typeof v.createdAt !== 'number' || !Number.isFinite(v.createdAt)) {
    problems.push('createdAt: invalid TimestampMs');
  }
  if (problems.length === 0) problems.push('constraintSet: failed structural validation');
  return { code: 'invalid-constraint-set', details: problems };
}

// ---------------------------------------------------------------------------
// The compiler (pure, deterministic, total over valid input)
// ---------------------------------------------------------------------------

/**
 * Compiles a goal statement and a constraint-set statement into the
 * executable AcceptanceCriteria artifact.
 *
 * Validation is FULL and FAIL-CLOSED (typed errors, never silent):
 * 1. the goal must be a structurally valid `GoalStatement` — success
 *    criteria that are not STRUCTURED RECORDS (prose, strings, partial
 *    shapes) are rejected with `unstructured-criteria`; an empty criteria
 *    list with `empty-success-criteria`;
 * 2. the constraint set must be a structurally valid
 *    `ConstraintSetStatement` (`invalid-constraint-set` otherwise);
 * 3. goal and constraint set must belong to the SAME TENANT
 *    (`goal-set-tenant-mismatch` — L12 makes cross-tenant compilation
 *    inexpressible).
 *
 * Determinism: the artifact id is content-addressed from the lineage; no
 * ambient clock, no randomness — compiling the same inputs twice yields
 * deeply-equal, deeply-frozen records.
 */
export function compileAcceptance(
  goal: GoalStatement,
  constraintSet: ConstraintSetStatement,
): AcceptanceCriteria {
  if (!isGoalStatement(goal)) {
    const diagnosis = diagnoseGoal(goal);
    throw new ControlDomainError(
      diagnosis.code,
      `compileAcceptance: ${diagnosis.code}`,
      diagnosis.details,
    );
  }
  if (!isConstraintSetStatement(constraintSet)) {
    const diagnosis = diagnoseConstraintSet(constraintSet);
    throw new ControlDomainError(
      diagnosis.code,
      `compileAcceptance: ${diagnosis.code}`,
      diagnosis.details,
    );
  }
  if (goal.tenantId !== constraintSet.tenantId) {
    throw new ControlDomainError(
      'goal-set-tenant-mismatch',
      'compileAcceptance: goal and constraint set belong to different tenants',
      [
        `goal tenant: ${JSON.stringify(goal.tenantId)}`,
        `constraint set tenant: ${JSON.stringify(constraintSet.tenantId)}`,
      ],
    );
  }

  const constraints = constraintSet.constraints;
  const criteria: CompiledCriterion[] = goal.successCriteria.criteria.map((criterion) => ({
    criterion,
    gatingConstraintIds: constraints
      .filter((constraint) => gatesConstraint(constraint.subject, criterion.metric))
      .map((constraint) => constraint.id),
  }));

  const lineage: AcceptanceLineage = {
    goal: { goalId: goal.id, version: goal.version },
    constraintSet: { id: constraintSet.id, version: constraintSet.version },
  };

  const compiled: AcceptanceCriteria = {
    id: acceptanceCriteriaId(lineage.goal, lineage.constraintSet),
    version: 1,
    tenantId: goal.tenantId,
    lineage,
    criteria,
    constraints,
    policy: {
      blindRef: goal.evaluation.blindRef,
      walkForwardRef: goal.evaluation.walkForwardRef,
      regimeRef: goal.evaluation.regimeRef,
      adversarialRequired: goal.evaluation.adversarialRequired,
      requiredSatisfaction: goal.successCriteria.requiredSatisfaction,
    },
  };
  return deepFreeze(compiled);
}

/** Type-level helper: an array of compiled criteria (used by consumers). */
export function isCompiledCriteriaList(
  v: unknown,
): v is readonly CompiledCriterion[] {
  return isArrayOf(v, isCompiledCriterion);
}
