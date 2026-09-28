// @tradrl/control-plane — the append-only, replayable audit log.
//
// The audit log is the control plane's operation journal: every SUCCESSFUL
// state-changing operation is appended as an entry carrying its intent
// (the operation payload), its lineage block (L15) and the instant it was
// applied. FAILED operations never enter the log — the log is a
// state-replay artifact, not an access log (access/observability is T043).
//
// Replay (`replayAuditLog`) re-executes the logged intents through the
// SAME pure domain functions the service used (compiler, record factory,
// binding, reducer). Because those functions are deterministic, replay
// reproduces the exact live state — this is the determinism proof tested
// in audit.test.ts:
//   - replay(log) === live state (deep equality);
//   - replay(log) twice yields deeply-equal state;
//   - applying the log twice (log concatenated onto itself) yields
//     deeply-equal state — the fold skips entries whose sequence is at or
//     below its watermark (idempotent at-least-once application);
//   - a corrupted log (sequence gap, structurally invalid entry,
//     incoherent operation) is rejected with a typed error.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L15 (lineage on every record),
// L9 (reproducible lineage — state is replayable from the journal).

import {
  AcceptanceCriteria,
  ControlDomainError,
  GoalStatement,
  ConstraintSetStatement,
  OrganizationRef,
  ProjectId,
  ProjectLineage,
  ProjectLifecycleEvent,
  ProjectRecord,
  ProjectRecordDraft,
  TenantId,
  TimestampMs,
  advanceProject,
  bindOrganizationToProject,
  compileAcceptance,
  createProjectRecord,
  deepFreeze,
  isProjectLineage,
  isTimestampMs,
  isTenantId,
  isProjectId,
} from '../../../packages/control-domain/src/index';

// ---------------------------------------------------------------------------
// Audit records
// ---------------------------------------------------------------------------

/** Discriminator vocabulary of audit operations. */
export const PROJECT_AUDIT_OPERATION_KINDS = [
  'acceptance.compiled',
  'project.created',
  'organization.bound',
  'project.transitioned',
] as const;

export type ProjectAuditOperationKind = (typeof PROJECT_AUDIT_OPERATION_KINDS)[number];

/**
 * The INTENT of one audited operation (event-sourcing payload). Each kind
 * carries everything needed to re-execute the operation deterministically.
 */
export type ProjectAuditOperation =
  | {
      readonly kind: 'acceptance.compiled';
      readonly goal: GoalStatement;
      readonly constraintSet: ConstraintSetStatement;
    }
  | {
      readonly kind: 'project.created';
      readonly draft: ProjectRecordDraft;
    }
  | {
      readonly kind: 'organization.bound';
      readonly organizationRef: OrganizationRef;
    }
  | {
      readonly kind: 'project.transitioned';
      readonly event: ProjectLifecycleEvent;
    };

/** The context every audited operation is recorded with. */
export interface AuditContext {
  readonly at: TimestampMs;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly lineage: ProjectLineage;
}

/**
 * One append-only audit entry. `sequence` is 1-based and gapless within a
 * log; the lineage block makes continuity queryable on every record (L15).
 */
export interface ProjectAuditEntry {
  readonly sequence: number;
  readonly at: TimestampMs;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly lineage: ProjectLineage;
  readonly operation: ProjectAuditOperation;
}

// ---------------------------------------------------------------------------
// Guards (total, hand-rolled, never throw)
// ---------------------------------------------------------------------------

function isProjectAuditOperation(v: unknown): v is ProjectAuditOperation {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const op = v as Record<string, unknown>;
  switch (op.kind) {
    case 'acceptance.compiled':
      // Full structural validation happens at replay time (compileAcceptance
      // re-validates); here we require the payloads to be present records.
      return typeof op.goal === 'object' && op.goal !== null && !Array.isArray(op.goal)
        && typeof op.constraintSet === 'object' && op.constraintSet !== null && !Array.isArray(op.constraintSet);
    case 'project.created':
      return typeof op.draft === 'object' && op.draft !== null && !Array.isArray(op.draft);
    case 'organization.bound':
      return typeof op.organizationRef === 'string' && op.organizationRef.trim().length > 0;
    case 'project.transitioned':
      return typeof op.event === 'string' && op.event.trim().length > 0;
    default:
      return false;
  }
}

/** Guard: `ProjectAuditEntry` (sequence, instants, tenant, lineage identity). */
export function isProjectAuditEntry(v: unknown): v is ProjectAuditEntry {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const entry = v as Record<string, unknown>;
  if (typeof entry.sequence !== 'number' || !Number.isInteger(entry.sequence) || entry.sequence < 1) {
    return false;
  }
  if (!isTimestampMs(entry.at)) return false;
  if (!isTenantId(entry.tenantId)) return false;
  if (!isProjectId(entry.projectId)) return false;
  if (!isProjectLineage(entry.lineage)) return false;
  if ((entry.lineage as ProjectLineage).projectId !== entry.projectId) return false;
  if (!isProjectAuditOperation(entry.operation)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The append-only log
// ---------------------------------------------------------------------------

/**
 * The in-memory audit log. `append` is the ONLY mutation; entries are
 * deeply frozen and immutable once written. Sequence numbers are gapless.
 */
export class ProjectAuditLog {
  readonly #entries: ProjectAuditEntry[] = [];

  /**
   * Appends one operation record. Throws
   * `ControlDomainError('invalid-audit-log')` when the operation or context
   * is structurally invalid (fail-closed: a malformed entry never enters
   * the journal).
   */
  append(operation: ProjectAuditOperation, context: AuditContext): ProjectAuditEntry {
    const problems: string[] = [];
    if (!isProjectAuditOperation(operation)) {
      problems.push('operation: unknown kind or malformed payload');
    }
    if (!isTimestampMs(context.at)) problems.push('at: invalid TimestampMs');
    if (!isTenantId(context.tenantId)) problems.push('tenantId: invalid TenantId');
    if (!isProjectId(context.projectId)) problems.push('projectId: invalid ProjectId');
    if (!isProjectLineage(context.lineage)) {
      problems.push('lineage: invalid ProjectLineage');
    } else if (context.lineage.projectId !== context.projectId) {
      problems.push('lineage.projectId: must equal the audited projectId');
    }
    if (problems.length > 0) {
      throw new ControlDomainError(
        'invalid-audit-log',
        'ProjectAuditLog.append: invalid entry',
        problems,
      );
    }
    const entry: ProjectAuditEntry = deepFreeze({
      sequence: this.#entries.length + 1,
      at: context.at,
      tenantId: context.tenantId,
      projectId: context.projectId,
      lineage: context.lineage,
      operation,
    });
    this.#entries.push(entry);
    return entry;
  }

  /** All entries, frozen (spanning every tenant that operated on this log). */
  entries(): readonly ProjectAuditEntry[] {
    return deepFreeze([...this.#entries]);
  }

  /** Only the entries of one tenant — the tenant-scoped view of the journal. */
  entriesFor(tenantId: TenantId): readonly ProjectAuditEntry[] {
    return deepFreeze(this.#entries.filter((e) => e.tenantId === tenantId));
  }
}

// ---------------------------------------------------------------------------
// Replay (the determinism proof)
// ---------------------------------------------------------------------------

/** The replayed control-plane state: projects + compiled criteria, in replay order. */
export interface ReplayedState {
  readonly projects: readonly ProjectRecord[];
  readonly acceptanceCriteria: readonly AcceptanceCriteria[];
}

/**
 * Replays an audit log into state by re-executing every entry's intent
 * through the same pure domain functions the live service used.
 *
 * Semantics:
 * - entries must be structurally valid and GAPLESS per the fold
 *   (`sequence === watermark + 1`); a gap throws `invalid-audit-log`;
 * - entries with `sequence <= watermark` are SKIPPED — applying the same
 *   log twice (or concatenating it onto itself) is idempotent and yields
 *   deeply-equal state;
 * - an entry whose operation cannot re-execute coherently (unknown
 *   project reference, duplicate creation, binding/transition rejected by
 *   the domain rules) is reported as `invalid-audit-log` — a journal that
 *   cannot rebuild its state is corrupt by definition.
 */
export function replayAuditLog(entries: readonly ProjectAuditEntry[]): ReplayedState {
  const byId = new Map<ProjectId, ProjectRecord>();
  const acceptanceCriteria: AcceptanceCriteria[] = [];
  let watermark = 0;

  for (const entry of entries) {
    if (!isProjectAuditEntry(entry)) {
      throw new ControlDomainError(
        'invalid-audit-log',
        'replayAuditLog: an entry failed structural validation',
        ['entry: expected a valid ProjectAuditEntry record'],
      );
    }
    if (entry.sequence <= watermark) continue; // idempotent re-apply
    if (entry.sequence !== watermark + 1) {
      throw new ControlDomainError(
        'invalid-audit-log',
        `replayAuditLog: sequence gap before entry ${entry.sequence}`,
        [`expected sequence ${watermark + 1}, got ${entry.sequence}`],
      );
    }
    watermark = entry.sequence;
    applyEntry(entry, byId, acceptanceCriteria);
  }

  return deepFreeze({
    projects: deepFreeze([...byId.values()]),
    acceptanceCriteria: deepFreeze([...acceptanceCriteria]),
  });
}

function applyEntry(
  entry: ProjectAuditEntry,
  byId: Map<ProjectId, ProjectRecord>,
  acceptanceCriteria: AcceptanceCriteria[],
): void {
  const operation = entry.operation;
  switch (operation.kind) {
    case 'acceptance.compiled': {
      const compiled = reexecute(
        () => compileAcceptance(operation.goal, operation.constraintSet),
        entry,
      );
      acceptanceCriteria.push(compiled);
      return;
    }
    case 'project.created': {
      if (byId.has(entry.projectId)) {
        throw corrupt(entry, 'project.created for an id that already exists in the replayed state');
      }
      const record = reexecute(() => createProjectRecord(operation.draft), entry);
      if (record.tenantId !== entry.tenantId) {
        throw corrupt(entry, 'project.created draft tenant does not match the entry tenant');
      }
      byId.set(record.id, record);
      return;
    }
    case 'organization.bound': {
      const current = requireReplayed(entry, byId);
      const next = reexecute(
        () => bindOrganizationToProject(current, operation.organizationRef, entry.at),
        entry,
      );
      byId.set(next.id, next);
      return;
    }
    case 'project.transitioned': {
      const current = requireReplayed(entry, byId);
      const next = reexecute(() => advanceProject(current, operation.event, entry.at), entry);
      byId.set(next.record.id, next.record);
      return;
    }
  }
}

function requireReplayed(
  entry: ProjectAuditEntry,
  byId: Map<ProjectId, ProjectRecord>,
): ProjectRecord {
  const record = byId.get(entry.projectId);
  if (record === undefined) {
    throw corrupt(entry, 'operation references a project not created earlier in the replayed state');
  }
  if (record.tenantId !== entry.tenantId) {
    throw corrupt(entry, 'operation tenant does not match the project record tenant');
  }
  return record;
}

function corrupt(entry: ProjectAuditEntry, detail: string): ControlDomainError {
  return new ControlDomainError(
    'invalid-audit-log',
    `replayAuditLog: entry ${entry.sequence} is incoherent`,
    [detail],
  );
}

function reexecute<T>(operation: () => T, entry: ProjectAuditEntry): T {
  try {
    return operation();
  } catch (error) {
    const cause = error instanceof ControlDomainError ? `${error.code}: ${error.message}` : String(error);
    throw new ControlDomainError(
      'invalid-audit-log',
      `replayAuditLog: entry ${entry.sequence} failed to re-execute`,
      [cause],
    );
  }
}
