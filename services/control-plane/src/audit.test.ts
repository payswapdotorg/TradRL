import { describe, expect, it } from 'vitest';
import {
  ControlDomainError,
  type GoalRef,
  type ConstraintSetRef,
  type GoalStatement,
  type ConstraintSetStatement,
  type ProjectId,
  type TenantId,
  type TimestampMs,
  deepFreeze,
} from '../../../packages/control-domain/src/index';
import {
  exampleConstraintSetStatement,
  exampleGoalStatement,
} from '../../../packages/control-domain/src/examples';
import { createControlPlane } from './service';
import {
  type ProjectAuditEntry,
  type ReplayedState,
  ProjectAuditLog,
  isProjectAuditEntry,
  replayAuditLog,
} from './audit';

const tenantA = 'tenant_acme' as TenantId;
const tenantB = 'tenant_beta' as TenantId;
const T0 = 1_800_200_000_000 as TimestampMs;

function cloneGoal(): GoalStatement {
  return JSON.parse(JSON.stringify(exampleGoalStatement)) as GoalStatement;
}
function cloneSet(): ConstraintSetStatement {
  return JSON.parse(JSON.stringify(exampleConstraintSetStatement)) as ConstraintSetStatement;
}

function expectTypedError(code: string, run: () => void): void {
  try {
    run();
    expect.unreachable(`expected a typed error with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ControlDomainError);
    expect((error as ControlDomainError).code).toBe(code);
  }
}

/**
 * A full single-tenant control-plane scenario:
 * compile+create prj_one, bind, activate, pause, resume, complete;
 * compile+create prj_two, bind, activate, pause, archive.
 */
function runScenario() {
  const plane = createControlPlane();
  plane.createProject({
    id: 'prj_one' as ProjectId,
    tenantId: tenantA,
    name: 'Alpha One',
    executionMode: 'simulation',
    goal: cloneGoal(),
    constraintSet: cloneSet(),
    at: T0,
  });
  plane.bindOrganization({ tenantId: tenantA, projectId: 'prj_one' as ProjectId, organizationRef: 'org_one' as never, at: (T0 + 1) as TimestampMs });
  plane.transition({ tenantId: tenantA, projectId: 'prj_one' as ProjectId, event: 'activate', at: (T0 + 2) as TimestampMs });
  plane.transition({ tenantId: tenantA, projectId: 'prj_one' as ProjectId, event: 'pause', at: (T0 + 3) as TimestampMs });
  plane.transition({ tenantId: tenantA, projectId: 'prj_one' as ProjectId, event: 'resume', at: (T0 + 4) as TimestampMs });
  plane.transition({ tenantId: tenantA, projectId: 'prj_one' as ProjectId, event: 'complete', at: (T0 + 5) as TimestampMs });

  plane.createProject({
    id: 'prj_two' as ProjectId,
    tenantId: tenantA,
    name: 'Alpha Two',
    executionMode: 'shadow',
    goal: { ...cloneGoal(), id: 'goal_beta' as never, version: 2 },
    constraintSet: { ...cloneSet(), version: 3 },
    at: (T0 + 6) as TimestampMs,
  });
  plane.bindOrganization({ tenantId: tenantA, projectId: 'prj_two' as ProjectId, organizationRef: 'org_two' as never, at: (T0 + 7) as TimestampMs });
  plane.transition({ tenantId: tenantA, projectId: 'prj_two' as ProjectId, event: 'activate', at: (T0 + 8) as TimestampMs });
  plane.transition({ tenantId: tenantA, projectId: 'prj_two' as ProjectId, event: 'pause', at: (T0 + 9) as TimestampMs });
  plane.archive({ tenantId: tenantA, projectId: 'prj_two' as ProjectId, at: (T0 + 10) as TimestampMs });
  return plane;
}

function liveState(plane: ReturnType<typeof createControlPlane>): ReplayedState {
  return deepFreeze({
    projects: plane.projectsOf(tenantA),
    acceptanceCriteria: plane.acceptanceCriteriaOf(tenantA),
  });
}

// ---------------------------------------------------------------------------
// The log itself
// ---------------------------------------------------------------------------

describe('ProjectAuditLog', () => {
  it('append assigns gapless 1-based sequences and freezes entries', () => {
    const log = new ProjectAuditLog();
    const context = {
      at: T0,
      tenantId: tenantA,
      projectId: 'prj_x' as ProjectId,
      lineage: {
        projectId: 'prj_x' as ProjectId,
        goal: { goalId: 'g', version: 1 },
        constraintSet: { id: 'c', version: 1 },
      },
    };
    const e1 = log.append({ kind: 'project.transitioned', event: 'activate' }, context);
    const e2 = log.append({ kind: 'project.transitioned', event: 'pause' }, context);
    expect(e1.sequence).toBe(1);
    expect(e2.sequence).toBe(2);
    expect(isProjectAuditEntry(e1)).toBe(true);
    expect(() => {
      (e1 as { sequence: number }).sequence = 99;
    }).toThrow(TypeError);
  });

  it('append rejects malformed operations/contexts (fail-closed journal)', () => {
    const log = new ProjectAuditLog();
    expectTypedError('invalid-audit-log', () =>
      log.append({ kind: 'unknown.kind' } as never, {
        at: T0,
        tenantId: tenantA,
        projectId: 'prj_x' as ProjectId,
        lineage: { projectId: 'prj_x' as ProjectId, goal: { goalId:'g' as GoalRef, version: 1 }, constraintSet: { id:'c' as ConstraintSetRef, version: 1 } },
      }),
    );
    expectTypedError('invalid-audit-log', () =>
      log.append({ kind: 'project.transitioned', event: 'activate' }, {
        at: T0,
        tenantId: tenantA,
        projectId: 'prj_x' as ProjectId,
        lineage: { projectId: 'prj_OTHER' as ProjectId, goal: { goalId:'g' as GoalRef, version: 1 }, constraintSet: { id:'c' as ConstraintSetRef, version: 1 } },
      }),
    );
  });

  it('entriesFor filters by tenant without leaking other tenants', () => {
    const plane = createControlPlane();
    plane.createProject({ id: 'prj_a' as ProjectId, tenantId: tenantA, name: 'A', executionMode: 'simulation', goal: cloneGoal(), constraintSet: cloneSet(), at: T0 });
    plane.createProject({ id: 'prj_b' as ProjectId, tenantId: tenantB, name: 'B', executionMode: 'live', goal: cloneGoal(), constraintSet: cloneSet(), at: (T0 + 1) as TimestampMs });
    const aEntries = plane.auditLog(tenantA);
    const bEntries = plane.auditLog(tenantB);
    expect(aEntries.every((e) => e.tenantId === tenantA)).toBe(true);
    expect(bEntries.every((e) => e.tenantId === tenantB)).toBe(true);
    expect(aEntries).toHaveLength(2); // compile + create
    expect(bEntries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Replay — the determinism proof (acceptance #8)
// ---------------------------------------------------------------------------

describe('replayAuditLog — determinism proof', () => {
  const plane = runScenario();
  const log = plane.auditLog(tenantA);

  it('the scenario journal is well-formed, gapless and 14 entries long', () => {
    expect(log).toHaveLength(14);
    expect(log.map((e, i) => e.sequence === i + 1).every(Boolean)).toBe(true);
  });

  it('replaying the log reproduces the LIVE state exactly (deep equality)', () => {
    const replayed = replayAuditLog(log);
    expect(replayed).toEqual(liveState(plane));
    expect(replayed.projects.map((p) => p.id)).toEqual(['prj_one', 'prj_two']);
    expect(replayed.projects[0]?.lifecycle.status).toBe('completed');
    expect(replayed.projects[1]?.lifecycle.status).toBe('archived');
    expect(replayed.acceptanceCriteria).toHaveLength(2);
  });

  it('applying the log TWICE yields deeply-equal state (pure replay)', () => {
    const first = replayAuditLog(log);
    const second = replayAuditLog(log);
    expect(first).toEqual(second);
  });

  it('applying the log twice ONTO ITSELF (concatenated) yields deeply-equal state (idempotent fold)', () => {
    const once = replayAuditLog(log);
    const twice = replayAuditLog([...log, ...log]);
    expect(twice).toEqual(once);
  });

  it('the replayed state is deeply frozen', () => {
    const replayed = replayAuditLog(log);
    expect(Object.isFrozen(replayed.projects)).toBe(true);
    expect(() => {
      (replayed.projects[0] as { name: string }).name = 'hijacked';
    }).toThrow(TypeError);
  });
});

describe('replayAuditLog — corruption rejection', () => {
  const plane = runScenario();
  const log = plane.auditLog(tenantA);

  it('rejects a sequence GAP (dropped entry) with invalid-audit-log', () => {
    const gapped = [...log.slice(0, 2), ...log.slice(3)];
    expectTypedError('invalid-audit-log', () => replayAuditLog(gapped));
  });

  it('rejects a reordered/duplicated-sequence log with invalid-audit-log', () => {
    const reordered = [log[1] as ProjectAuditEntry, log[0] as ProjectAuditEntry, ...log.slice(2)];
    expectTypedError('invalid-audit-log', () => replayAuditLog(reordered));
  });

  it('rejects structurally invalid entries', () => {
    const corrupt: unknown = { ...log[0], at: 'yesterday' };
    expectTypedError('invalid-audit-log', () =>
      replayAuditLog([corrupt as unknown as ProjectAuditEntry, ...log.slice(1)]),
    );
  });

  it('rejects an operation referencing a project never created earlier in the replay', () => {
    const orphan: ProjectAuditEntry = deepFreeze({
      ...(log[2] as ProjectAuditEntry), // an organization.bound entry
      sequence: 1,
    });
    expectTypedError('invalid-audit-log', () => replayAuditLog([orphan]));
  });

  it('rejects a duplicate creation of the same project id', () => {
    const created = log[1] as ProjectAuditEntry; // project.created for prj_one
    const duplicated = [log[0], created, created, ...log.slice(2)] as ProjectAuditEntry[];
    // Entry 3 has sequence 2 (duplicate of entry 2's sequence... same object,
    // same sequence) -> watermark skip keeps it silent UNLESS sequences
    // differ. Build an explicit sequence-3 duplicate to force re-execution.
    const forced: ProjectAuditEntry = deepFreeze({ ...created, sequence: 3 });
    const entries = [log[0], created, forced] as ProjectAuditEntry[];
    expectTypedError('invalid-audit-log', () => replayAuditLog(entries));
  });

  it('rejects a transition that the domain rules refuse at replay time', () => {
    // Take the full valid log, then append an illegal second archive attempt
    // on prj_two (already archived) with the next sequence number.
    const illegal: ProjectAuditEntry = deepFreeze({
      ...(log[log.length - 1] as ProjectAuditEntry),
      sequence: log.length + 1,
      at: (T0 + 99) as TimestampMs,
    });
    expectTypedError('invalid-audit-log', () => replayAuditLog([...log, illegal]));
  });
});
