import { describe, expect, it } from 'vitest';
import {
  PROJECT_LIFECYCLE_EVENTS,
  PROJECT_LIFECYCLE_STATUSES,
  PROJECT_LIFECYCLE_TRANSITIONS,
  type AcceptanceCriteriaId,
  type OrganizationRef,
  type ProjectId,
  type ProjectLifecycleEvent,
  type ProjectLifecycleState,
  type ProjectLifecycleStatus,
  type ProjectTransitionResult,
  ControlDomainError,
  IllegalProjectTransitionError,
  ProjectPreconditionError,
  canTransitionProjectLifecycle,
  isProjectLifecycleState,
  isProjectTransitionEffect,
  isDeeplyFrozen,
  transitionProject,
  transitionTarget,
  type Mutable,
} from './index';

const projectId = (s: string) => s as ProjectId;
const criteriaId = (s: string) => s as AcceptanceCriteriaId;
const orgRef = (s: string) => s as OrganizationRef;

const CRITERIA = criteriaId('ac:["goal_alpha",1,"cs_alpha",2]');
const ORG = orgRef('org_compiled_1');
const ID = projectId('prj_alpha');

/** A fully-bound state (the shape every operating status requires). */
function boundState(status: ProjectLifecycleStatus): ProjectLifecycleState {
  return { projectId: ID, status, acceptanceCriteriaId: CRITERIA, organizationRef: ORG };
}

/** A draft state with nothing bound yet. */
function bareDraft(): ProjectLifecycleState {
  return { projectId: ID, status: 'draft', acceptanceCriteriaId: null, organizationRef: null };
}

function expectTypedError(
  code: string,
  run: () => void,
): void {
  try {
    run();
    expect.unreachable(`expected a typed error with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ControlDomainError);
    expect((error as ControlDomainError).code).toBe(code);
  }
}

// ---------------------------------------------------------------------------
// The transition table (single source of truth)
// ---------------------------------------------------------------------------

describe('transition table', () => {
  it('is exactly the Work Order machine: draft->active->paused->archived + terminal completed/abandoned', () => {
    expect(PROJECT_LIFECYCLE_TRANSITIONS).toEqual({
      draft: ['activate', 'abandon', 'archive'],
      active: ['pause', 'complete', 'abandon'],
      paused: ['resume', 'complete', 'abandon', 'archive'],
      completed: [],
      abandoned: [],
      archived: [],
    });
  });

  it('canTransitionProjectLifecycle and transitionTarget agree with the table for the full matrix', () => {
    for (const status of PROJECT_LIFECYCLE_STATUSES) {
      for (const event of PROJECT_LIFECYCLE_EVENTS) {
        const legal = PROJECT_LIFECYCLE_TRANSITIONS[status].includes(event);
        expect(canTransitionProjectLifecycle(status, event)).toBe(legal);
        expect(transitionTarget(status, event) !== null).toBe(legal);
      }
    }
  });

  it('canTransitionProjectLifecycle is total over garbage input', () => {
    expect(canTransitionProjectLifecycle('zombie', 'activate')).toBe(false);
    expect(canTransitionProjectLifecycle('draft', 'resurrect')).toBe(false);
    expect(canTransitionProjectLifecycle(null, 'pause')).toBe(false);
    expect(canTransitionProjectLifecycle('draft', 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Legal transitions — every edge exercised
// ---------------------------------------------------------------------------

describe('transitionProject — every LEGAL edge', () => {
  it('draft --activate--> active (fully bound)', () => {
    const result = transitionProject(boundState('draft'), 'activate');
    expect(result.state.status).toBe('active');
    expect(result.state.projectId).toBe(ID);
    expect(result.state.acceptanceCriteriaId).toBe(CRITERIA);
    expect(result.state.organizationRef).toBe(ORG);
  });

  it('active --pause--> paused', () => {
    const result = transitionProject(boundState('active'), 'pause');
    expect(result.state.status).toBe('paused');
  });

  it('paused --resume--> active', () => {
    const result = transitionProject(boundState('paused'), 'resume');
    expect(result.state.status).toBe('active');
  });

  it('active --complete--> completed and paused --complete--> completed', () => {
    expect(transitionProject(boundState('active'), 'complete').state.status).toBe('completed');
    expect(transitionProject(boundState('paused'), 'complete').state.status).toBe('completed');
  });

  it('draft/active/paused --abandon--> abandoned', () => {
    expect(transitionProject(boundState('draft'), 'abandon').state.status).toBe('abandoned');
    expect(transitionProject(boundState('active'), 'abandon').state.status).toBe('abandoned');
    expect(transitionProject(boundState('paused'), 'abandon').state.status).toBe('abandoned');
  });

  it('draft --archive--> archived and paused --archive--> archived', () => {
    expect(transitionProject(boundState('draft'), 'archive').state.status).toBe('archived');
    expect(transitionProject(boundState('paused'), 'archive').state.status).toBe('archived');
  });

  it('is pure: the input record is never mutated and outputs are deeply frozen', () => {
    const input = boundState('draft');
    const result = transitionProject(input, 'activate');
    expect(input.status).toBe('draft'); // untouched
    expect(isDeeplyFrozen(result.state)).toBe(true);
    expect(isDeeplyFrozen(result.effects)).toBe(true);
    expect(() => {
      (result as Mutable<ProjectTransitionResult>).state = boundState('paused');
    }).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Illegal transitions — the full matrix sweep + terminal escapes
// ---------------------------------------------------------------------------

describe('transitionProject — every ILLEGAL edge (typed errors)', () => {
  it('rejects every (status, event) pair outside the table with IllegalProjectTransitionError', () => {
    const LEGAL_EDGES = new Set<string>();
    for (const status of PROJECT_LIFECYCLE_STATUSES) {
      for (const event of PROJECT_LIFECYCLE_TRANSITIONS[status]) {
        LEGAL_EDGES.add(`${status}:${event}`);
      }
    }
    let illegalCount = 0;
    for (const status of PROJECT_LIFECYCLE_STATUSES) {
      for (const event of PROJECT_LIFECYCLE_EVENTS) {
        if (LEGAL_EDGES.has(`${status}:${event}`)) continue;
        illegalCount += 1;
        // Every state must be structurally valid for the reducer to even
        // look at it — use a bound state (valid for all statuses) or a bare
        // draft for statuses whose invariants allow null bindings.
        const state: ProjectLifecycleState =
          status === 'draft' || status === 'abandoned' || status === 'archived'
            ? { ...boundState(status), acceptanceCriteriaId: null, organizationRef: null }
            : boundState(status);
        try {
          transitionProject(state, event);
          expect.unreachable(`expected ${status} --${event}--> to be illegal`);
        } catch (error) {
          expect(error).toBeInstanceOf(IllegalProjectTransitionError);
          const typed = error as IllegalProjectTransitionError;
          expect(typed.code).toBe('illegal-transition');
          expect(typed.from).toBe(status);
          expect(typed.event).toBe(event);
          expect(typed.message).toContain(status);
        }
      }
    }
    // 6 statuses x 6 events = 36 pairs, 14 legal edges -> 22 illegal edges.
    expect(illegalCount).toBe(22);
  });

  it('rejects EVERY terminal-state escape (completed/abandoned/archived accept no event)', () => {
    for (const terminal of ['completed', 'abandoned', 'archived'] as const) {
      for (const event of PROJECT_LIFECYCLE_EVENTS) {
        const state: ProjectLifecycleState =
          terminal === 'completed' ? boundState(terminal) : { ...boundState(terminal), acceptanceCriteriaId: null, organizationRef: null };
        expect(() => transitionProject(state, event)).toThrow(IllegalProjectTransitionError);
      }
    }
  });

  it('rejects an unknown event with invalid-lifecycle-state (closed vocabulary)', () => {
    expectTypedError('invalid-lifecycle-state', () =>
      transitionProject(boundState('draft'), 'resurrect' as ProjectLifecycleEvent),
    );
    expectTypedError('invalid-lifecycle-state', () =>
      transitionProject(boundState('draft'), null as unknown as ProjectLifecycleEvent),
    );
  });

  it('rejects a structurally invalid state with invalid-lifecycle-state', () => {
    expectTypedError('invalid-lifecycle-state', () =>
      transitionProject(null as unknown as ProjectLifecycleState, 'activate'),
    );
    expectTypedError('invalid-lifecycle-state', () =>
      transitionProject(
        { projectId: ID, status: 'active', acceptanceCriteriaId: null, organizationRef: null },
        'pause',
      ),
    );
    expectTypedError('invalid-lifecycle-state', () =>
      transitionProject(
        { projectId: ID, status: 'active', acceptanceCriteriaId:'bad id' as AcceptanceCriteriaId, organizationRef: ORG },
        'pause',
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Preconditions — active-without-criteria is inexpressible
// ---------------------------------------------------------------------------

describe('transitionProject — preconditions', () => {
  it('rejects activate WITHOUT compiled acceptance criteria (typed missing-acceptance-criteria)', () => {
    const draftWithoutCriteria: ProjectLifecycleState = {
      projectId: ID,
      status: 'draft',
      acceptanceCriteriaId: null,
      organizationRef: ORG,
    };
    try {
      transitionProject(draftWithoutCriteria, 'activate');
      expect.unreachable('expected missing-acceptance-criteria');
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectPreconditionError);
      const typed = error as ProjectPreconditionError;
      expect(typed.code).toBe('missing-acceptance-criteria');
      expect(typed.requirement).toBe('acceptance-criteria');
      expect(typed.details.join(' ')).toContain('acceptanceCriteriaId');
    }
  });

  it('rejects activate WITHOUT a bound organization (typed missing-organization-binding)', () => {
    const draftWithoutOrg: ProjectLifecycleState = {
      projectId: ID,
      status: 'draft',
      acceptanceCriteriaId: CRITERIA,
      organizationRef: null,
    };
    try {
      transitionProject(draftWithoutOrg, 'activate');
      expect.unreachable('expected missing-organization-binding');
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectPreconditionError);
      const typed = error as ProjectPreconditionError;
      expect(typed.code).toBe('missing-organization-binding');
      expect(typed.requirement).toBe('organization-binding');
    }
  });

  it('rejects a hand-crafted paused state without bindings BEFORE the reducer (guard layering)', () => {
    // paused without bindings is not a state the machine could ever have
    // produced — the structural guard rejects it first (defense in depth).
    expectTypedError('invalid-lifecycle-state', () =>
      transitionProject(
        { projectId: ID, status: 'paused', acceptanceCriteriaId: null, organizationRef: null },
        'resume',
      ),
    );
  });

  it('a bare draft (nothing bound) can still abandon and archive — no precondition on those paths', () => {
    expect(transitionProject(bareDraft(), 'abandon').state.status).toBe('abandoned');
    expect(transitionProject(bareDraft(), 'archive').state.status).toBe('archived');
    expect(() => transitionProject(bareDraft(), 'activate')).toThrow(ProjectPreconditionError);
  });
});

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

describe('transitionProject — effects', () => {
  it('activate emits organization.activate carrying project, org and criteria (L15 addressable)', () => {
    const { effects } = transitionProject(boundState('draft'), 'activate');
    expect(effects).toEqual([
      {
        kind: 'organization.activate',
        projectId: ID,
        organizationRef: ORG,
        acceptanceCriteriaId: CRITERIA,
      },
    ]);
  });

  it('pause and resume emit organization.suspend / organization.resume', () => {
    expect(transitionProject(boundState('active'), 'pause').effects).toEqual([
      { kind: 'organization.suspend', projectId: ID, organizationRef: ORG },
    ]);
    expect(transitionProject(boundState('paused'), 'resume').effects).toEqual([
      { kind: 'organization.resume', projectId: ID, organizationRef: ORG },
    ]);
  });

  it('complete emits evaluation.finalize first, then organization.suspend', () => {
    expect(transitionProject(boundState('active'), 'complete').effects).toEqual([
      { kind: 'evaluation.finalize', projectId: ID, acceptanceCriteriaId: CRITERIA },
      { kind: 'organization.suspend', projectId: ID, organizationRef: ORG },
    ]);
    expect(transitionProject(boundState('paused'), 'complete').effects).toEqual([
      { kind: 'evaluation.finalize', projectId: ID, acceptanceCriteriaId: CRITERIA },
      { kind: 'organization.suspend', projectId: ID, organizationRef: ORG },
    ]);
  });

  it('abandon suspends the organization only when one is bound', () => {
    expect(transitionProject(boundState('active'), 'abandon').effects).toEqual([
      { kind: 'organization.suspend', projectId: ID, organizationRef: ORG },
    ]);
    expect(transitionProject(bareDraft(), 'abandon').effects).toEqual([]);
  });

  it('archive emits record.archive only', () => {
    expect(transitionProject(boundState('paused'), 'archive').effects).toEqual([
      { kind: 'record.archive', projectId: ID },
    ]);
    expect(transitionProject(bareDraft(), 'archive').effects).toEqual([
      { kind: 'record.archive', projectId: ID },
    ]);
  });

  it('isProjectTransitionEffect battery', () => {
    for (const effect of transitionProject(boundState('active'), 'complete').effects) {
      expect(isProjectTransitionEffect(effect)).toBe(true);
    }
    expect(isProjectTransitionEffect(null)).toBe(false);
    expect(isProjectTransitionEffect({ kind: 'organization.activate', projectId: '', organizationRef: 'o', acceptanceCriteriaId: 'ac:["g",1,"c",1]' })).toBe(false);
    expect(isProjectTransitionEffect({ kind: 'organization.suspend', projectId: 'p' })).toBe(false);
    expect(isProjectTransitionEffect({ kind: 'evaluation.finalize', projectId: 'p', acceptanceCriteriaId: '' })).toBe(false);
    expect(isProjectTransitionEffect({ kind: 'record.archive', projectId: 'p', extra: 1 })).toBe(true);
    expect(isProjectTransitionEffect({ kind: 'organization.resurrect', projectId: 'p' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// State guard — machine postconditions as record invariants
// ---------------------------------------------------------------------------

describe('isProjectLifecycleState — postcondition invariants', () => {
  it('accepts every machine-reachable state shape', () => {
    expect(isProjectLifecycleState(boundState('draft'))).toBe(true);
    expect(isProjectLifecycleState(boundState('active'))).toBe(true);
    expect(isProjectLifecycleState(boundState('paused'))).toBe(true);
    expect(isProjectLifecycleState(boundState('completed'))).toBe(true);
    expect(isProjectLifecycleState(boundState('abandoned'))).toBe(true);
    expect(isProjectLifecycleState(boundState('archived'))).toBe(true);
    // draft may be fully bound (criteria compiled, org bound) or bare.
    expect(isProjectLifecycleState({ ...bareDraft(), acceptanceCriteriaId: CRITERIA })).toBe(true);
    expect(isProjectLifecycleState({ ...bareDraft(), organizationRef: ORG })).toBe(true);
  });

  it('rejects active-without-criteria (the state the machine can never produce)', () => {
    expect(
      isProjectLifecycleState({ projectId: ID, status: 'active', acceptanceCriteriaId: null, organizationRef: ORG }),
    ).toBe(false);
  });

  it('rejects active/paused/completed without the organization binding', () => {
    for (const status of ['active', 'paused', 'completed'] as const) {
      expect(
        isProjectLifecycleState({ projectId: ID, status, acceptanceCriteriaId: CRITERIA, organizationRef: null }),
      ).toBe(false);
    }
  });

  it('rejects completed without criteria (complete requires a final evaluation target)', () => {
    expect(
      isProjectLifecycleState({ projectId: ID, status: 'completed', acceptanceCriteriaId: null, organizationRef: ORG }),
    ).toBe(false);
  });

  it('allows bare abandoned/archived (reachable from a bare draft)', () => {
    expect(isProjectLifecycleState({ ...bareDraft(), status: 'abandoned' })).toBe(true);
    expect(isProjectLifecycleState({ ...bareDraft(), status: 'archived' })).toBe(true);
  });

  it('rejects structural garbage', () => {
    const invalid: unknown[] = [
      null,
      'draft',
      { projectId: '', status: 'draft', acceptanceCriteriaId: null, organizationRef: null },
      { projectId: ID, status: 'zombie', acceptanceCriteriaId: null, organizationRef: null },
      { projectId: ID, status: 'draft', acceptanceCriteriaId: 42, organizationRef: null },
      { projectId: ID, status: 'draft', acceptanceCriteriaId: null, organizationRef: '' },
    ];
    for (const v of invalid) expect(isProjectLifecycleState(v)).toBe(false);
  });
});
