// @tradrl/control-domain — ProjectRecord: the durable control-plane record.
//
// The ProjectRecord is the control plane's spine: it connects the goal
// VERSION and constraint-set VERSION it was launched with (lineage, L15),
// the compiled AcceptanceCriteria that defines attainment (L7 — never raw
// PnL), the bound organization (by opaque ref, T016), and the execution
// mode (simulation | shadow | live — the hard consequentiality separation
// R23/L16-spirit, mirrored from domain-core). Lifecycle state is embedded
// (`ProjectLifecycleState`), and the audit fields (createdAt/updatedAt)
// are monotonic `TimestampMs`.
//
// Records are immutable: every change (binding, transition) is a NEW
// deeply-frozen record produced by the domain functions below —
// copy-on-write, mirroring the agent-body lane's discipline.
//
// Spec anchors: spec/DOMAIN-MODEL.md (Project), ADR-0002 (project-primary
// primitive), spec/ARCHITECTURE-LOCK.md L12 (tenant scope inherited by
// every descendant), L15 (lineage), R23 (execution mode separation).

import { deepFreeze, isNonEmptyString, isRecord } from './primitives';
import {
  AcceptanceCriteriaId,
  ConstraintSetVersionRef,
  GoalVersionRef,
  OrganizationRef,
  ProjectId,
  TenantId,
  isAcceptanceCriteriaId,
  isConstraintSetVersionRef,
  isGoalVersionRef,
  isOrganizationRef,
  isProjectId,
  isTenantId,
} from './ids';
import { TimestampMs, compareTimestampMs, isTimestampMs } from './timestamp';
import {
  ExecutionMode,
  EXECUTION_MODES,
  isExecutionMode,
} from './execution-mode';
import {
  ProjectLifecycleEvent,
  ProjectLifecycleState,
  ProjectTransitionEffect,
  ProjectTransitionResult,
  isProjectLifecycleState,
  transitionProject,
} from './lifecycle';
import { ControlDomainError } from './errors';

// ---------------------------------------------------------------------------
// Lineage (L15: continuity is queryable on every record)
// ---------------------------------------------------------------------------

/**
 * Project-scoped lineage block: the project id plus the goal version and
 * constraint-set version the project was launched with. Every persisted
 * control-plane record that belongs to a project (the ProjectRecord
 * itself, audit entries) carries this block — "goal, research, decision,
 * execution and outcome share lineage" is enforced by making the lineage
 * ids non-optional and guard-validated.
 */
export interface ProjectLineage {
  readonly projectId: ProjectId;
  readonly goal: GoalVersionRef;
  readonly constraintSet: ConstraintSetVersionRef;
}

/** Guard: `ProjectLineage` (non-empty ids, versioned refs, identity consistency is checked by the record guard). */
export function isProjectLineage(v: unknown): v is ProjectLineage {
  if (!isRecord(v)) return false;
  if (!isProjectId(v.projectId)) return false;
  if (!isGoalVersionRef(v.goal)) return false;
  if (!isConstraintSetVersionRef(v.constraintSet)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// ProjectRecord
// ---------------------------------------------------------------------------

/** Draft accepted by `createProjectRecord` — everything except lifecycle state. */
export interface ProjectRecordDraft {
  readonly id: ProjectId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly executionMode: ExecutionMode;
  /**
   * The goal version + constraint-set version this project was launched
   * with. `lineage.projectId` MUST equal `id` (identity consistency,
   * guard-enforced).
   */
  readonly lineage: ProjectLineage;
  /** Pre-compiled acceptance criteria (the control-plane service always compiles before creation). */
  readonly acceptanceCriteriaId?: AcceptanceCriteriaId;
  readonly createdAt: TimestampMs;
}

/**
 * The durable control-plane project record. Fields:
 * - `id` / `tenantId`: identity + L12 scope (every persisted descendant
 *   inherits the tenant).
 * - `lifecycle`: machine status + the criteria/organization bindings.
 * - `lineage`: the L15 lineage block (goal version, constraint-set
 *   version, project id).
 * - `executionMode`: simulation | shadow | live, fixed at creation —
 *   escalation to live is a control-plane decision with its own
 *   authorization path (T040), never a data patch (contracts/domain/
 *   project.md).
 * - audit fields: `createdAt` / `updatedAt` (`TimestampMs`, updatedAt >=
 *   createdAt, monotonic across updates).
 */
export interface ProjectRecord {
  readonly id: ProjectId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly executionMode: ExecutionMode;
  readonly lifecycle: ProjectLifecycleState;
  readonly lineage: ProjectLineage;
  readonly createdAt: TimestampMs;
  readonly updatedAt: TimestampMs;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Guard: `ProjectRecord` (includes identity + audit-field consistency). */
export function isProjectRecord(v: unknown): v is ProjectRecord {
  if (!isRecord(v)) return false;
  if (!isProjectId(v.id)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isNonEmptyString(v.name)) return false;
  if (!isExecutionMode(v.executionMode)) return false;
  if (!isProjectLifecycleState(v.lifecycle)) return false;
  if (v.lifecycle.projectId !== v.id) return false; // identity consistency
  if (!isProjectLineage(v.lineage)) return false;
  if (v.lineage.projectId !== v.id) return false; // lineage points at itself
  if (!isTimestampMs(v.createdAt)) return false;
  if (!isTimestampMs(v.updatedAt)) return false;
  if (compareTimestampMs(v.updatedAt, v.createdAt) < 0) return false; // updatedAt >= createdAt
  return true;
}

// ---------------------------------------------------------------------------
// Factory (single lifecycle entry point)
// ---------------------------------------------------------------------------

/**
 * Constructs a deeply frozen `ProjectRecord` in state `draft` with the
 * given bindings (organization deliberately NOT bindable at creation —
 * binding is a separate, audited control-plane act). Throws
 * `ControlDomainError('invalid-project-record')` with field-prefixed
 * problems on invalid input, including lineage/identity mismatch.
 */
export function createProjectRecord(draft: ProjectRecordDraft): ProjectRecord {
  const problems: string[] = [];
  if (!isProjectId(draft.id)) problems.push('id: invalid ProjectId (non-empty string)');
  if (!isTenantId(draft.tenantId)) problems.push('tenantId: invalid TenantId');
  if (!isNonEmptyString(draft.name)) problems.push('name: non-empty string required');
  if (!isExecutionMode(draft.executionMode)) {
    problems.push(`executionMode: expected one of ${EXECUTION_MODES.join(' | ')}`);
  }
  if (!isProjectLineage(draft.lineage)) {
    problems.push('lineage: invalid ProjectLineage (projectId + versioned goal/constraint-set refs)');
  } else if (draft.lineage.projectId !== draft.id) {
    problems.push('lineage.projectId: must equal the record id');
  }
  if (draft.acceptanceCriteriaId !== undefined && !isAcceptanceCriteriaId(draft.acceptanceCriteriaId)) {
    problems.push('acceptanceCriteriaId: invalid content-addressed AcceptanceCriteriaId');
  }
  if (!isTimestampMs(draft.createdAt)) problems.push('createdAt: invalid TimestampMs');
  if (problems.length > 0) {
    throw new ControlDomainError('invalid-project-record', 'createProjectRecord: invalid draft', problems);
  }

  const record: ProjectRecord = {
    id: draft.id,
    tenantId: draft.tenantId,
    name: draft.name,
    executionMode: draft.executionMode,
    lifecycle: deepFreeze({
      projectId: draft.id,
      status: 'draft',
      acceptanceCriteriaId: draft.acceptanceCriteriaId === undefined ? null : draft.acceptanceCriteriaId,
      organizationRef: null,
    }),
    lineage: draft.lineage,
    createdAt: draft.createdAt,
    updatedAt: draft.createdAt,
  };
  return deepFreeze(record);
}

// ---------------------------------------------------------------------------
// Organization binding
// ---------------------------------------------------------------------------

/** Result of a binding: the next record. */
export interface BoundProject {
  readonly record: ProjectRecord;
}

/**
 * Binds (or re-binds) an organization to a project. Legal ONLY while the
 * project is `draft` (initial compilation) or `paused` (the reorganization
 * window — pause, re-compile with T016, re-bind, resume). Binding while
 * `active` must pause first; terminal states never re-bind. Throws
 * `ControlDomainError('invalid-binding-state')` otherwise and
 * `invalid-project-record` on structurally invalid input or a
 * non-monotonic `at`.
 */
export function bindOrganizationToProject(
  record: ProjectRecord,
  organizationRef: OrganizationRef,
  at: TimestampMs,
): ProjectRecord {
  assertRecordAndMonotonicTime(record, at, 'bindOrganizationToProject');
  if (!isOrganizationRef(organizationRef)) {
    throw new ControlDomainError(
      'invalid-project-record',
      'bindOrganizationToProject: invalid organization ref',
      ['organizationRef: non-empty opaque reference required'],
    );
  }
  if (record.lifecycle.status !== 'draft' && record.lifecycle.status !== 'paused') {
    throw new ControlDomainError(
      'invalid-binding-state',
      `bindOrganizationToProject: cannot bind while ${record.lifecycle.status}`,
      [
        `status: ${record.lifecycle.status} — organization binding is legal only in draft or paused`,
      ],
    );
  }
  const next: ProjectRecord = {
    ...record,
    lifecycle: { ...record.lifecycle, organizationRef },
    updatedAt: at,
  };
  return deepFreeze(next);
}

// ---------------------------------------------------------------------------
// Record-level transition (reducer + audit stamping)
// ---------------------------------------------------------------------------

export interface AdvanceProjectResult {
  readonly record: ProjectRecord;
  readonly effects: readonly ProjectTransitionEffect[];
}

/**
 * Applies a lifecycle event to a ProjectRecord through the pure reducer
 * and stamps `updatedAt` (monotonic: `at` must be >= the record's
 * `updatedAt`). Returns the NEXT deeply-frozen record plus the emitted
 * effects. Throws the reducer's typed errors (`illegal-transition`,
    `missing-acceptance-criteria`, `missing-organization-binding`) and
    `invalid-project-record` for structurally invalid input.
 */
export function advanceProject(
  record: ProjectRecord,
  event: ProjectLifecycleEvent,
  at: TimestampMs,
): AdvanceProjectResult {
  assertRecordAndMonotonicTime(record, at, 'advanceProject');
  const transition: ProjectTransitionResult = transitionProject(record.lifecycle, event);
  const next: ProjectRecord = {
    ...record,
    lifecycle: transition.state,
    updatedAt: at,
  };
  return deepFreeze({ record: deepFreeze(next), effects: transition.effects });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertRecordAndMonotonicTime(
  record: ProjectRecord,
  at: TimestampMs,
  operation: string,
): void {
  const problems: string[] = [];
  if (!isProjectRecord(record)) {
    problems.push('record: invalid ProjectRecord');
  }
  if (!isTimestampMs(at)) {
    problems.push('at: invalid TimestampMs');
  } else if (isProjectRecord(record) && compareTimestampMs(at, record.updatedAt) < 0) {
    problems.push('at: must be >= record.updatedAt (audit fields are monotonic)');
  }
  if (problems.length > 0) {
    throw new ControlDomainError('invalid-project-record', `${operation}: invalid input`, problems);
  }
}
