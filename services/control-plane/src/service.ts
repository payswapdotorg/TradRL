// @tradrl/control-plane — the reference ControlPlane service.
//
// A service object OVER the pure domain (packages/control-domain):
// compileAcceptance + the lifecycle reducer + the record factories, wired
// to an in-memory tenant-scoped ProjectStore, an append-only replayable
// audit log, and a tenant-scoped acceptance-criteria registry (what T012
// and T016 consume — see README.md).
//
// Operation discipline (transactional ordering):
//   1. every operation runs ALL pure validation first (compiler, record
//      factory, reducer — typed errors, no state touched);
//   2. only then do mutations happen (store, registry, audit append);
//   3. every SUCCESSFUL mutation is journaled; failures leave no trace in
//      state or log (an un-compilable goal is rejected before anything is
//      written — the work order's "compiles acceptance criteria first").
//
// Tenant isolation (L12): every accessor takes the tenant scope as an
// argument and cross-tenant access is INDISTINGUISHABLE from a missing id
// (`project-not-found`) — the error never confirms existence in another
// tenant.
//
// Zero runtime dependencies: the service consumes the contract package by
// RELATIVE SOURCE IMPORT (the frozen workspace lockfile forbids adding a
// workspace dependency between importers; root tsconfig covers both trees,
// and the Tech Lead reconciles manifests at merge).
//
// Spec anchors: spec/ARCHITECTURE.md core flow (Goal/Constraint Compiler),
// spec/ARCHITECTURE-LOCK.md L7, L12, L15, spec/DOMAIN-MODEL.md (Project).

import {
  AcceptanceCriteria,
  AcceptanceCriteriaId,
  ControlDomainError,
  ConstraintSetStatement,
  ExecutionMode,
  GoalStatement,
  OrganizationRef,
  ProjectId,
  ProjectLineage,
  ProjectLifecycleEvent,
  ProjectRecord,
  ProjectTransitionEffect,
  TenantId,
  TimestampMs,
  advanceProject,
  bindOrganizationToProject,
  compileAcceptance,
  createProjectRecord,
  deepFreeze,
} from '../../../packages/control-domain/src/index';
import { ProjectAuditEntry, ProjectAuditLog } from './audit';
import { ProjectStore } from './store';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Input of `createProject`: identity, scope, name, mode, goal + constraint set, instant. */
export interface CreateProjectInput {
  readonly id: ProjectId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly executionMode: ExecutionMode;
  readonly goal: GoalStatement;
  readonly constraintSet: ConstraintSetStatement;
  readonly at: TimestampMs;
}

/** Input of `bindOrganization`: scope, project, organization ref, instant. */
export interface BindOrganizationInput {
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly organizationRef: OrganizationRef;
  readonly at: TimestampMs;
}

/** Input of `transition` / `archive`: scope, project, lifecycle event, instant. */
export interface TransitionInput {
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly event: ProjectLifecycleEvent;
  readonly at: TimestampMs;
}

/** Result of a lifecycle transition: the next record plus the emitted effects. */
export interface TransitionedProject {
  readonly record: ProjectRecord;
  readonly effects: readonly ProjectTransitionEffect[];
}

// ---------------------------------------------------------------------------
// The service object
// ---------------------------------------------------------------------------

/** The ControlPlane service surface (all accessors tenant-scoped). */
export interface ControlPlane {
  /**
   * Creates a project: compiles the acceptance criteria FIRST (rejecting
   * un-compilable goals with typed errors before any state changes), then
   * creates the draft record with the criteria bound, stores it and
   * journals both operations. Returns the frozen draft record.
   */
  createProject(input: CreateProjectInput): ProjectRecord;
  /** Binds (or re-binds, in draft/paused) an organization to the project. */
  bindOrganization(input: BindOrganizationInput): ProjectRecord;
  /** Applies a lifecycle event through the reducer; returns record + effects. */
  transition(input: TransitionInput): TransitionedProject;
  /** Convenience: archives the project (`transition` with the `archive` event). */
  archive(input: Omit<TransitionInput, 'event'>): TransitionedProject;
  /** Reads one project (throws `project-not-found`, incl. cross-tenant). */
  getProject(tenantId: TenantId, projectId: ProjectId): ProjectRecord;
  /**
   * The compiled AcceptanceCriteria of a project — the artifact T012
   * (evaluation) and T016 (organization compiler) consume.
   */
  acceptanceCriteriaFor(tenantId: TenantId, projectId: ProjectId): AcceptanceCriteria;
  /** All projects of one tenant, in creation order. */
  projectsOf(tenantId: TenantId): readonly ProjectRecord[];
  /** All compiled criteria of one tenant, in compilation order. */
  acceptanceCriteriaOf(tenantId: TenantId): readonly AcceptanceCriteria[];
  /** The tenant-scoped audit journal (operator/replay view). */
  auditLog(tenantId: TenantId): readonly ProjectAuditEntry[];
}

/**
 * Constructs a fresh, independent ControlPlane service object (own store,
 * own audit log, own criteria registry). Deeply frozen — the only state is
 * inside the closures.
 */
export function createControlPlane(): ControlPlane {
  const store = new ProjectStore();
  const auditLog = new ProjectAuditLog();
  // TenantId -> (AcceptanceCriteriaId -> compiled artifact).
  const criteriaByTenant = new Map<string, Map<AcceptanceCriteriaId, AcceptanceCriteria>>();

  function requireProject(tenantId: TenantId, projectId: ProjectId): ProjectRecord {
    const record = store.get(tenantId, projectId);
    if (record === undefined) {
      // Unknown id and cross-tenant access are deliberately indistinguishable:
      // the message never confirms existence under another tenant (L12).
      throw new ControlDomainError(
        'project-not-found',
        'project not found for the requesting tenant',
        [`projectId: ${JSON.stringify(projectId)}`],
      );
    }
    return record;
  }

  function registerCriteria(criteria: AcceptanceCriteria): void {
    let bucket = criteriaByTenant.get(criteria.tenantId);
    if (bucket === undefined) {
      bucket = new Map<AcceptanceCriteriaId, AcceptanceCriteria>();
      criteriaByTenant.set(criteria.tenantId, bucket);
    }
    bucket.set(criteria.id, criteria);
  }

  const service: ControlPlane = {
    createProject(input: CreateProjectInput): ProjectRecord {
      // 1. Compile FIRST — un-compilable goals (unstructured criteria,
      //    invalid constraint set, cross-tenant goal/set pair) are rejected
      //    with typed errors BEFORE any state changes.
      const criteria = compileAcceptance(input.goal, input.constraintSet);
      // L12: the project's tenant scope, the goal statement and the
      // constraint set must be ONE scope — a project may never carry
      // another tenant's compiled criteria.
      if (criteria.tenantId !== input.tenantId) {
        throw new ControlDomainError(
          'project-tenant-mismatch',
          'createProject: the goal/constraint-set tenant scope differs from the project tenant scope',
          [
            `project tenant: ${JSON.stringify(input.tenantId)}`,
            `goal/constraint-set tenant: ${JSON.stringify(criteria.tenantId)}`,
          ],
        );
      }
      // L12: the project's tenant scope, the goal statement and the
      // constraint set must be ONE scope — a project may never carry
      // another tenant's compiled criteria.
      if (criteria.tenantId !== input.tenantId) {
        throw new ControlDomainError(
          'project-tenant-mismatch',
          'createProject: the goal/constraint-set tenant scope differs from the project tenant scope',
          [
            `project tenant: ${JSON.stringify(input.tenantId)}`,
            `goal/constraint-set tenant: ${JSON.stringify(criteria.tenantId)}`,
          ],
        );
      }

      // 2. Pure record construction (validates draft, lineage identity).
      const lineage: ProjectLineage = deepFreeze({
        projectId: input.id,
        goal: { goalId: input.goal.id, version: input.goal.version },
        constraintSet: { id: input.constraintSet.id, version: input.constraintSet.version },
      });
      const record = createProjectRecord({
        id: input.id,
        tenantId: input.tenantId,
        name: input.name,
        executionMode: input.executionMode,
        lineage,
        acceptanceCriteriaId: criteria.id,
        createdAt: input.at,
      });

      // 3. Mutations (duplicate id throws here, before journaling).
      store.create(record);
      registerCriteria(criteria);
      const context = { at: input.at, tenantId: record.tenantId, projectId: record.id, lineage };
      auditLog.append(
        { kind: 'acceptance.compiled', goal: input.goal, constraintSet: input.constraintSet },
        context,
      );
      auditLog.append(
        {
          kind: 'project.created',
          draft: {
            id: input.id,
            tenantId: input.tenantId,
            name: input.name,
            executionMode: input.executionMode,
            lineage,
            acceptanceCriteriaId: criteria.id,
            createdAt: input.at,
          },
        },
        context,
      );
      return record;
    },

    bindOrganization(input: BindOrganizationInput): ProjectRecord {
      const record = requireProject(input.tenantId, input.projectId);
      const next = bindOrganizationToProject(record, input.organizationRef, input.at);
      store.update(next);
      auditLog.append(
        { kind: 'organization.bound', organizationRef: input.organizationRef },
        { at: input.at, tenantId: record.tenantId, projectId: record.id, lineage: record.lineage },
      );
      return next;
    },

    transition(input: TransitionInput): TransitionedProject {
      const record = requireProject(input.tenantId, input.projectId);
      const advanced = advanceProject(record, input.event, input.at);
      store.update(advanced.record);
      auditLog.append(
        { kind: 'project.transitioned', event: input.event },
        { at: input.at, tenantId: record.tenantId, projectId: record.id, lineage: record.lineage },
      );
      return advanced;
    },

    archive(input: Omit<TransitionInput, 'event'>): TransitionedProject {
      return service.transition({ ...input, event: 'archive' });
    },

    getProject(tenantId: TenantId, projectId: ProjectId): ProjectRecord {
      return requireProject(tenantId, projectId);
    },

    acceptanceCriteriaFor(tenantId: TenantId, projectId: ProjectId): AcceptanceCriteria {
      const record = requireProject(tenantId, projectId);
      const criteriaId = record.lifecycle.acceptanceCriteriaId;
      if (criteriaId === null) {
        throw new ControlDomainError(
          'missing-acceptance-criteria',
          'project has no compiled acceptance criteria',
          [`projectId: ${JSON.stringify(projectId)}`, 'status: ' + record.lifecycle.status],
        );
      }
      const criteria = criteriaByTenant.get(record.tenantId)?.get(criteriaId);
      if (criteria === undefined) {
        // Unreachable through the service API (createProject registers the
        // artifact before the record becomes visible); kept fail-closed.
        throw new ControlDomainError(
          'missing-acceptance-criteria',
          'project references acceptance criteria that are not registered',
          [`acceptanceCriteriaId: ${JSON.stringify(criteriaId)}`],
        );
      }
      return criteria;
    },

    projectsOf(tenantId: TenantId): readonly ProjectRecord[] {
      return store.list(tenantId);
    },

    acceptanceCriteriaOf(tenantId: TenantId): readonly AcceptanceCriteria[] {
      return deepFreeze([...(criteriaByTenant.get(tenantId)?.values() ?? [])]);
    },

    auditLog(tenantId: TenantId): readonly ProjectAuditEntry[] {
      return auditLog.entriesFor(tenantId);
    },
  };

  return deepFreeze(service);
}
