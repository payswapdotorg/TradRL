// @tradrl/control-domain — branded identity references.
//
// Id discipline (mirrors @tradrl/domain-core/src/ids.ts):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - The FORMAT of an id (prefix, uuid, ulid, ...) is decided by the creating
//   lane/service; these contracts only require opaque non-empty strings —
//   with one exception: `AcceptanceCriteriaId` is CONTENT-ADDRESSED by the
//   compiler (see acceptance.ts), so its textual form is part of this
//   contract.
//
// Cross-lane ownership map (who owns the referent):
// - GoalRef       -> the goal record (T002 domain-core owns the Goal
//                    contract; the control plane pins versions of goal
//                    STATEMENTS for lineage, L15).
// - ConstraintSetRef -> the constraint-set record (T002 domain-core owns
//                    the ConstraintSet contract).
// - ProjectId     -> the project identity. T002 owns the Project record
//                    contract; T007 owns project LIFECYCLE. This is a
//                    SHARED identity space: the brand tag matches
//                    domain-core's `ProjectId` exactly so the two
//                    declarations are mutually assignable (deliberate; see
//                    interop.test.ts). Domain-core's `ProjectStatus`
//                    `compiling` label maps to "draft with partial
//                    bindings" here (README).
// - OrganizationRef -> the compiled organization (T016 owns the referent;
//                    bound to projects by the control plane).
// - TenantId      -> the tenant scope (L12). Brand tag matches
//                    domain-core's `TenantId`: one program-wide tenant
//                    identity space.
// - AcceptanceCriteriaId -> T007-owned (the compiled artifact identity,
//                    content-addressed from goal + constraint-set lineage).

import { Brand, isNonEmptyString, isPositiveInteger, isRecord } from './primitives';

// ---------------------------------------------------------------------------
// Opaque branded ids
// ---------------------------------------------------------------------------

/** Opaque reference to a goal record (referent contract owned by T002). */
export type GoalRef = Brand<string, 'GoalRef'>;

/** Opaque reference to a constraint-set record (referent contract owned by T002). */
export type ConstraintSetRef = Brand<string, 'ConstraintSetRef'>;

/**
 * Project identity. Shared identity space with domain-core's `ProjectId`
 * (same brand tag, mutually assignable — the control plane manages the
 * lifecycle of the records T002 defines).
 */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Opaque reference to a compiled organization (referent owned by T016). */
export type OrganizationRef = Brand<string, 'OrganizationRef'>;

/** Tenant (customer firm) identity. Shared program-wide identity space (L12). */
export type TenantId = Brand<string, 'TenantId'>;

/**
 * Identity of a compiled AcceptanceCriteria record. CONTENT-ADDRESSED: the
 * compiler derives it deterministically from the goal and constraint-set
 * lineage, so equal lineages always compile to the same id (see
 * `acceptanceCriteriaId()` below).
 */
export type AcceptanceCriteriaId = Brand<string, 'AcceptanceCriteriaId'>;

// ---------------------------------------------------------------------------
// Versioned pointers (lineage carriers, L15)
// ---------------------------------------------------------------------------

/**
 * Versioned pointer to a goal statement: identity is `(goalId, version)`.
 * A revised goal is a NEW VERSION (mirroring domain-core's new-record
 * discipline for goal revision — goals never mutate in place).
 */
export interface GoalVersionRef {
  readonly goalId: GoalRef;
  /** Integer >= 1; monotonically increasing per goalId. */
  readonly version: number;
}

/**
 * Versioned pointer to a constraint set: identity is `(id, version)`.
 * Structural mirror of domain-core's `ConstraintSetRef` record (the
 * versioned-pointer discipline — pinned at compile time, never floats).
 */
export interface ConstraintSetVersionRef {
  readonly id: ConstraintSetRef;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time (see interop.test.ts for the shared-space tags).

export const isGoalRef = (v: unknown): v is GoalRef => isNonEmptyString(v);
export const isConstraintSetRef = (v: unknown): v is ConstraintSetRef => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isOrganizationRef = (v: unknown): v is OrganizationRef => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isAcceptanceCriteriaId = (v: unknown): v is AcceptanceCriteriaId =>
  isNonEmptyString(v) && parseAcceptanceCriteriaId(v) !== null;

export function isGoalVersionRef(v: unknown): v is GoalVersionRef {
  if (!isRecord(v)) return false;
  return isGoalRef(v.goalId) && isPositiveInteger(v.version);
}

export function isConstraintSetVersionRef(v: unknown): v is ConstraintSetVersionRef {
  if (!isRecord(v)) return false;
  return isConstraintSetRef(v.id) && isPositiveInteger(v.version);
}

// ---------------------------------------------------------------------------
// Content-addressed AcceptanceCriteriaId
// ---------------------------------------------------------------------------

/**
 * Builds the content-addressed `AcceptanceCriteriaId` from the compiled
 * lineage. The encoding is `ac:` + the JSON encoding of
 * `[goalId, goalVersion, constraintSetId, constraintSetVersion]` — a
 * deterministic, INJECTIVE serialization (JSON string escaping removes any
 * separator ambiguity between the two opaque ids), so:
 * - equal lineages always produce the same id (replay determinism);
 * - distinct lineages never collide;
 * - the lineage is recoverable via {@link parseAcceptanceCriteriaId}.
 */
export function acceptanceCriteriaId(
  goal: GoalVersionRef,
  constraintSet: ConstraintSetVersionRef,
): AcceptanceCriteriaId {
  return `ac:${JSON.stringify([goal.goalId, goal.version, constraintSet.id, constraintSet.version])}` as AcceptanceCriteriaId;
}

/**
 * Parses a content-addressed `AcceptanceCriteriaId` back into its lineage
 * refs; `null` when the value does not carry the canonical `ac:` form.
 * Total: never throws, rejects any malformed input.
 */
export function parseAcceptanceCriteriaId(
  v: unknown,
): { readonly goal: GoalVersionRef; readonly constraintSet: ConstraintSetVersionRef } | null {
  if (!isNonEmptyString(v) || !v.startsWith('ac:')) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(v.slice(3));
  } catch {
    return null;
  }
  if (!Array.isArray(decoded) || decoded.length !== 4) return null;
  const [goalId, goalVersion, setId, setVersion] = decoded as [unknown, unknown, unknown, unknown];
  if (!isGoalRef(goalId) || !isPositiveInteger(goalVersion)) return null;
  if (!isConstraintSetRef(setId) || !isPositiveInteger(setVersion)) return null;
  return {
    goal: { goalId, version: goalVersion },
    constraintSet: { id: setId, version: setVersion },
  };
}
