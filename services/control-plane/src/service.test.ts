import { describe, expect, it } from 'vitest';
import {
  ControlDomainError,
  type GoalStatement,
  type ConstraintSetStatement,
  type OrganizationRef,
  type ProjectId,
  type TenantId,
  type TimestampMs,
  isProjectRecord,
  isDeeplyFrozen,
  parseAcceptanceCriteriaId,
} from '../../../packages/control-domain/src/index';
import {
  exampleConstraintSetStatement,
  exampleGoalStatement,
} from '../../../packages/control-domain/src/examples';
import { createControlPlane } from './service';

const tenantA = 'tenant_acme' as TenantId;
const tenantB = 'tenant_beta' as TenantId;
const T0 = 1_800_300_000_000 as TimestampMs;
const ORG = 'org_compiled_1' as OrganizationRef;

function cloneGoal(): GoalStatement {
  return JSON.parse(JSON.stringify(exampleGoalStatement)) as GoalStatement;
}
function cloneSet(): ConstraintSetStatement {
  return JSON.parse(JSON.stringify(exampleConstraintSetStatement)) as ConstraintSetStatement;
}

function expectTypedError(code: string, run: () => void): ControlDomainError {
  try {
    run();
    expect.unreachable(`expected a typed error with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ControlDomainError);
    const typed = error as ControlDomainError;
    expect(typed.code).toBe(code);
    return typed;
  }
}

describe('createProject — compiles acceptance criteria FIRST', () => {
  it('creates a draft project with the compiled criteria bound and journals both operations', () => {
    const plane = createControlPlane();
    const record = plane.createProject({
      id: 'prj_alpha' as ProjectId,
      tenantId: tenantA,
      name: 'Crypto Majors Alpha',
      executionMode: 'simulation',
      goal: cloneGoal(),
      constraintSet: cloneSet(),
      at: T0,
    });
    expect(isProjectRecord(record)).toBe(true);
    expect(isDeeplyFrozen(record)).toBe(true);
    expect(record.lifecycle.status).toBe('draft');
    expect(record.lifecycle.organizationRef).toBeNull();
    expect(record.lineage.goal).toEqual({ goalId: 'goal_alpha', version: 1 });
    expect(record.lineage.constraintSet).toEqual({ id: 'cs_alpha', version: 2 });
    expect(plane.auditLog(tenantA)).toHaveLength(2); // acceptance.compiled + project.created
    expect(plane.auditLog(tenantA).map((e) => e.operation.kind)).toEqual([
      'acceptance.compiled',
      'project.created',
    ]);
  });

  it('rejects an UN-COMPILABLE goal (unstructured criteria) BEFORE any state change', () => {
    const plane = createControlPlane();
    const prose: unknown = { ...cloneGoal(), successCriteria: 'be extremely profitable' };
    expectTypedError('unstructured-criteria', () =>
      plane.createProject({
        id: 'prj_bad' as ProjectId,
        tenantId: tenantA,
        name: 'Bad Goal',
        executionMode: 'simulation',
        goal: prose as GoalStatement,
        constraintSet: cloneSet(),
        at: T0,
      }),
    );
    // No state, no journal: the failure left no trace.
    expect(plane.projectsOf(tenantA)).toEqual([]);
    expect(plane.auditLog(tenantA)).toEqual([]);
    expect(plane.acceptanceCriteriaOf(tenantA)).toEqual([]);
  });

  it('rejects a cross-tenant goal/constraint-set pair with goal-set-tenant-mismatch', () => {
    const plane = createControlPlane();
    expectTypedError('goal-set-tenant-mismatch', () =>
      plane.createProject({
        id: 'prj_x' as ProjectId,
        tenantId: tenantA,
        name: 'Cross-tenant',
        executionMode: 'simulation',
        goal: cloneGoal(),
        constraintSet: { ...cloneSet(), tenantId: tenantB },
        at: T0,
      }),
    );
    expect(plane.projectsOf(tenantA)).toEqual([]);
  });

  it('rejects a duplicate project id within the tenant (and leaves the log untouched)', () => {
    const plane = createControlPlane();
    plane.createProject({
      id: 'prj_dup' as ProjectId,
      tenantId: tenantA,
      name: 'First',
      executionMode: 'simulation',
      goal: cloneGoal(),
      constraintSet: cloneSet(),
      at: T0,
    });
    const logLength = plane.auditLog(tenantA).length;
    expectTypedError('duplicate-project', () =>
      plane.createProject({
        id: 'prj_dup' as ProjectId,
        tenantId: tenantA,
        name: 'Second',
        executionMode: 'simulation',
        goal: cloneGoal(),
        constraintSet: cloneSet(),
        at: T0 + 1,
      }),
    );
    expect(plane.projectsOf(tenantA)).toHaveLength(1);
    expect(plane.auditLog(tenantA)).toHaveLength(logLength);
  });
});

describe('acceptanceCriteriaFor — the T012/T016 read path', () => {
  it('returns the compiled artifact whose id parses back to the record lineage (L15)', () => {
    const plane = createControlPlane();
    plane.createProject({
      id: 'prj_alpha' as ProjectId,
      tenantId: tenantA,
      name: 'Alpha',
      executionMode: 'simulation',
      goal: cloneGoal(),
      constraintSet: cloneSet(),
      at: T0,
    });
    const criteria = plane.acceptanceCriteriaFor(tenantA, 'prj_alpha' as ProjectId);
    expect(criteria.tenantId).toBe(tenantA);
    expect(parseAcceptanceCriteriaId(criteria.id)).toEqual({
      goal: { goalId: 'goal_alpha', version: 1 },
      constraintSet: { id: 'cs_alpha', version: 2 },
    });
    expect(criteria.criteria.length).toBe(3);
    expect(criteria.constraints.length).toBe(4);
    expect(isDeeplyFrozen(criteria)).toBe(true);
  });

  it('every entry of the registry is guard-valid and listed per tenant', () => {
    const plane = createControlPlane();
    plane.createProject({ id: 'prj_1' as ProjectId, tenantId: tenantA, name: 'One', executionMode: 'simulation', goal: cloneGoal(), constraintSet: cloneSet(), at: T0 });
    plane.createProject({ id: 'prj_2' as ProjectId, tenantId: tenantB, name: 'Two', executionMode: 'shadow', goal: cloneGoal(), constraintSet: cloneSet(), at: T0 + 1 });
    expect(plane.acceptanceCriteriaOf(tenantA)).toHaveLength(1);
    expect(plane.acceptanceCriteriaOf(tenantB)).toHaveLength(1);
  });
});

describe('lifecycle through the service', () => {
  function seeded() {
    const plane = createControlPlane();
    const record = plane.createProject({
      id: 'prj_alpha' as ProjectId,
      tenantId: tenantA,
      name: 'Alpha',
      executionMode: 'simulation',
      goal: cloneGoal(),
      constraintSet: cloneSet(),
      at: T0,
    });
    return { plane, record };
  }

  it('refuses activation without a bound organization (typed, no state change)', () => {
    const { plane } = seeded();
    expectTypedError('missing-organization-binding', () =>
      plane.transition({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, event: 'activate', at: T0 + 1 }),
    );
    expect(plane.getProject(tenantA, 'prj_alpha' as ProjectId).lifecycle.status).toBe('draft');
  });

  it('binds the organization, then activates with the organization.activate effect', () => {
    const { plane } = seeded();
    plane.bindOrganization({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, organizationRef: ORG, at: T0 + 1 });
    const activated = plane.transition({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, event: 'activate', at: T0 + 2 });
    expect(activated.record.lifecycle.status).toBe('active');
    expect(activated.record.lifecycle.organizationRef).toBe(ORG);
    expect(activated.effects).toEqual([
      {
        kind: 'organization.activate',
        projectId: 'prj_alpha' as ProjectId,
        organizationRef: ORG,
        acceptanceCriteriaId: activated.record.lifecycle.acceptanceCriteriaId,
      },
    ]);
  });

  it('runs the full happy path: bind -> activate -> pause -> resume -> complete (terminal)', () => {
    const { plane } = seeded();
    plane.bindOrganization({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, organizationRef: ORG, at: T0 + 1 });
    plane.transition({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, event: 'activate', at: T0 + 2 });
    plane.transition({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, event: 'pause', at: T0 + 3 });
    plane.transition({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, event: 'resume', at: T0 + 4 });
    const completed = plane.transition({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, event: 'complete', at: T0 + 5 });
    expect(completed.record.lifecycle.status).toBe('completed');
    expect(completed.effects.map((e) => e.kind)).toEqual(['evaluation.finalize', 'organization.suspend']);
    // Terminal: every further event is refused.
    expectTypedError('illegal-transition', () =>
      plane.transition({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, event: 'archive', at: T0 + 6 }),
    );
    expect(plane.getProject(tenantA, 'prj_alpha' as ProjectId).lifecycle.status).toBe('completed');
  });

  it('archives via the convenience method: bind -> activate -> pause -> archive (terminal)', () => {
    const { plane } = seeded();
    plane.bindOrganization({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, organizationRef: ORG, at: T0 + 1 });
    plane.transition({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, event: 'activate', at: T0 + 2 });
    plane.transition({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, event: 'pause', at: T0 + 3 });
    const archived = plane.archive({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, at: T0 + 4 });
    expect(archived.record.lifecycle.status).toBe('archived');
    expect(archived.effects).toEqual([{ kind: 'record.archive', projectId: 'prj_alpha' as ProjectId }]);
  });

  it('refuses binding while active with invalid-binding-state (pause first)', () => {
    const { plane } = seeded();
    plane.bindOrganization({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, organizationRef: ORG, at: T0 + 1 });
    plane.transition({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, event: 'activate', at: T0 + 2 });
    expectTypedError('invalid-binding-state', () =>
      plane.bindOrganization({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, organizationRef: 'org_2' as OrganizationRef, at: T0 + 3 }),
    );
  });

  it('refuses non-monotonic operation instants (audit fields never go backwards)', () => {
    const { plane } = seeded();
    expectTypedError('invalid-project-record', () =>
      plane.bindOrganization({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, organizationRef: ORG, at: ts(T0 - 1) }),
    );
  });

  it('getProject reads the current record and throws project-not-found for unknown ids', () => {
    const { plane } = seeded();
    expect(plane.getProject(tenantA, 'prj_alpha' as ProjectId).id).toBe('prj_alpha');
    expectTypedError('project-not-found', () =>
      plane.getProject(tenantA, 'prj_ghost' as ProjectId),
    );
  });

  it('the journal grows in lockstep with successful operations only', () => {
    const { plane } = seeded();
    expect(plane.auditLog(tenantA)).toHaveLength(2);
    plane.bindOrganization({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, organizationRef: ORG, at: T0 + 1 });
    expect(plane.auditLog(tenantA)).toHaveLength(3);
    // A failed transition journals nothing.
    expectTypedError('illegal-transition', () =>
      plane.transition({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, event: 'pause', at: T0 + 2 }),
    );
    expect(plane.auditLog(tenantA)).toHaveLength(3);
    plane.transition({ tenantId: tenantA, projectId: 'prj_alpha' as ProjectId, event: 'activate', at: T0 + 2 });
    expect(plane.auditLog(tenantA)).toHaveLength(4);
  });
});

describe('tenant isolation through the service (L12)', () => {
  function twoTenantPlane() {
    const plane = createControlPlane();
    plane.createProject({
      id: 'prj_private' as ProjectId,
      tenantId: tenantA,
      name: 'Tenant A private project',
      executionMode: 'live',
      goal: cloneGoal(),
      constraintSet: cloneSet(),
      at: T0,
    });
    plane.bindOrganization({ tenantId: tenantA, projectId: 'prj_private' as ProjectId, organizationRef: ORG, at: T0 + 1 });
    return plane;
  }

  it('cross-tenant getProject is rejected exactly like an unknown id (no existence leak)', () => {
    const plane = twoTenantPlane();
    const cross = expectTypedError('project-not-found', () =>
      plane.getProject(tenantB, 'prj_private' as ProjectId),
    );
    const unknown = expectTypedError('project-not-found', () =>
      plane.getProject(tenantB, 'prj_nonexistent' as ProjectId),
    );
    // The two errors share the code and the semantic message: tenant B
    // learns nothing about tenant A's project. (Each error echoes the id
    // the CALLER itself supplied — never the owning tenant, never a
    // confirmation that the id exists elsewhere.)
    expect(cross.code).toBe(unknown.code);
    expect(cross.message).toContain('project not found for the requesting tenant');
    expect(unknown.message).toContain('project not found for the requesting tenant');
    expect(cross.message).not.toContain(String(tenantA));
    expect(cross.details.length).toBe(unknown.details.length);
  });

  it('cross-tenant transition, binding and criteria reads are all rejected', () => {
    const plane = twoTenantPlane();
    expectTypedError('project-not-found', () =>
      plane.transition({ tenantId: tenantB, projectId: 'prj_private' as ProjectId, event: 'activate', at: T0 + 2 }),
    );
    expectTypedError('project-not-found', () =>
      plane.bindOrganization({ tenantId: tenantB, projectId: 'prj_private' as ProjectId, organizationRef: ORG, at: T0 + 2 }),
    );
    expectTypedError('project-not-found', () =>
      plane.acceptanceCriteriaFor(tenantB, 'prj_private' as ProjectId),
    );
    expectTypedError('project-not-found', () =>
      plane.archive({ tenantId: tenantB, projectId: 'prj_private' as ProjectId, at: T0 + 2 }),
    );
  });

  it('a failed cross-tenant attempt leaves the owning tenant state untouched', () => {
    const plane = twoTenantPlane();
    const before = plane.getProject(tenantA, 'prj_private' as ProjectId);
    const logBefore = plane.auditLog(tenantA).length;
    expectTypedError('project-not-found', () =>
      plane.transition({ tenantId: tenantB, projectId: 'prj_private' as ProjectId, event: 'activate', at: T0 + 2 }),
    );
    expect(plane.getProject(tenantA, 'prj_private' as ProjectId)).toEqual(before);
    expect(plane.auditLog(tenantA)).toHaveLength(logBefore);
    expect(plane.projectsOf(tenantB)).toEqual([]);
  });

  it('tenant B can operate its own projects with the SAME ids without interference', () => {
    const plane = twoTenantPlane();
    plane.createProject({
      id: 'prj_private' as ProjectId, // same id, different tenant
      tenantId: tenantB,
      name: 'Tenant B project',
      executionMode: 'simulation',
      goal: { ...cloneGoal(), tenantId: tenantB },
      constraintSet: { ...cloneSet(), tenantId: tenantB },
      at: T0 + 1,
    });
    expect(plane.projectsOf(tenantA).map((r) => r.name)).toEqual(['Tenant A private project']);
    expect(plane.projectsOf(tenantB).map((r) => r.name)).toEqual(['Tenant B project']);
    expect(plane.acceptanceCriteriaOf(tenantA)).toHaveLength(1);
    expect(plane.acceptanceCriteriaOf(tenantB)).toHaveLength(1);
  });
});

describe('service object discipline', () => {
  it('the ControlPlane object is deeply frozen', () => {
    const plane = createControlPlane();
    expect(() => {
      (plane as { createProject: unknown }).createProject = () => 'hijacked';
    }).toThrow(TypeError);
  });

  it('independent service instances carry independent state', () => {
    const a = createControlPlane();
    const b = createControlPlane();
    a.createProject({ id: 'prj_iso' as ProjectId, tenantId: tenantA, name: 'A', executionMode: 'simulation', goal: cloneGoal(), constraintSet: cloneSet(), at: T0 });
    expect(b.projectsOf(tenantA)).toEqual([]);
    expect(a.projectsOf(tenantA)).toHaveLength(1);
  });
});

describe('service package index (single import site for consumers)', () => {
  it('re-exports the domain contract surface and the service surface without collision', async () => {
    const index = await import('./index');
    // Domain contract surface (what T012/T016 code against).
    expect(typeof index.compileAcceptance).toBe('function');
    expect(typeof index.transitionProject).toBe('function');
    expect(typeof index.isProjectRecord).toBe('function');
    expect(typeof index.isTimestampMs).toBe('function');
    // Service surface.
    expect(typeof index.createControlPlane).toBe('function');
    expect(typeof index.replayAuditLog).toBe('function');
    expect(typeof index.ProjectStore).toBe('function');
    expect(index.packageInfo).toEqual({
      name: '@tradrl/control-plane',
      owner: 'T007',
      status: 'implemented',
    });
  });
});
