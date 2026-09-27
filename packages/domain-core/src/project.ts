// @tradrl/domain-core — Project: the durable unit of continuity (ADR-0002, L15).
//
// The Project connects goal, constraints, market/data universe, organization,
// experiments, decisions, execution, outcomes and lessons. It is the root
// lineage record: downstream records (Decision, Outcome, Lesson, experiments)
// carry projectId and link back; the Project carries the references that
// exist at creation/compile time.
//
// Laws honored here:
// - L15 project continuity: goal/research/decision/execution/outcome share
//   lineage through this record and its id.
// - L12 tenant isolation: the Project carries the tenant id that every
//   persisted descendant must inherit.
// - L17/R23: execution mode separates simulation/shadow/live from the start.

import {
  Timestamp,
  compareTimestamps,
  isNonEmptyString,
  isRecord,
  isTimestamp,
} from './primitives';
import {
  GoalId,
  OrganizationId,
  ProjectId,
  TenantId,
  isGoalId,
  isOrganizationId,
  isProjectId,
  isTenantId,
} from './ids';
import { ConstraintSetRef, isConstraintSetRef } from './constraints';
import { DataScope, MarketScope, isDataScope, isMarketScope } from './market-scope';

export type ProjectStatus =
  | 'draft'
  | 'compiling'
  | 'active'
  | 'paused'
  | 'completed'
  | 'terminated'
  | 'archived';

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  'draft',
  'compiling',
  'active',
  'paused',
  'completed',
  'terminated',
  'archived',
] as const;

/** Consequentiality of project execution. Hard separation (R23, L16 spirit). */
export type ExecutionMode = 'simulation' | 'shadow' | 'live';

export const EXECUTION_MODES: readonly ExecutionMode[] = ['simulation', 'shadow', 'live'] as const;

export interface Project {
  readonly id: ProjectId;
  /** Owning tenant. Every persisted descendant inherits this scope (L12). */
  readonly tenantId: TenantId;
  readonly name: string;
  readonly description?: string;
  readonly status: ProjectStatus;
  readonly createdAt: Timestamp;
  /** Last status/materialization change. Must be >= createdAt when present. */
  readonly updatedAt?: Timestamp;
  readonly goalId: GoalId;
  /** The goal's constraint set materialized for this project (pinned version). */
  readonly constraintSet: ConstraintSetRef;
  /** Materialized market universe (must satisfy the goal's allowed market scope). */
  readonly marketScope: MarketScope;
  /** Materialized data universe (must satisfy the goal's allowed data scope). */
  readonly dataScope: DataScope;
  /** Organization compiled for this project. Present once compilation succeeded. */
  readonly organizationId?: OrganizationId;
  readonly executionMode: ExecutionMode;
  /** Lineage: project this one was forked/derived from. */
  readonly parentProjectId?: ProjectId;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isProjectStatus(v: unknown): v is ProjectStatus {
  return isNonEmptyString(v) && (PROJECT_STATUSES as readonly string[]).includes(v);
}

export function isExecutionMode(v: unknown): v is ExecutionMode {
  return isNonEmptyString(v) && (EXECUTION_MODES as readonly string[]).includes(v);
}

export function isProject(v: unknown): v is Project {
  if (!isRecord(v)) return false;
  if (!isProjectId(v.id)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isNonEmptyString(v.name)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  if (!isProjectStatus(v.status)) return false;
  if (!isTimestamp(v.createdAt)) return false;
  if (v.updatedAt !== undefined) {
    if (!isTimestamp(v.updatedAt)) return false;
    if (compareTimestamps(v.createdAt, v.updatedAt) > 0) return false;
  }
  if (!isGoalId(v.goalId)) return false;
  if (!isConstraintSetRef(v.constraintSet)) return false;
  if (!isMarketScope(v.marketScope)) return false;
  if (!isDataScope(v.dataScope)) return false;
  if (v.organizationId !== undefined && !isOrganizationId(v.organizationId)) return false;
  if (!isExecutionMode(v.executionMode)) return false;
  if (v.parentProjectId !== undefined && !isProjectId(v.parentProjectId)) return false;
  return true;
}
