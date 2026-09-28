import { describe, expect, it } from 'vitest';
import {
  type AcceptanceCriteriaId,
  type OrganizationRef,
  type ProjectId,
  type ProjectRecord,
  type TimestampMs,
  ControlDomainError,
  advanceProject,
  bindOrganizationToProject,
  createProjectRecord,
  isProjectLineage,
  isProjectRecord,
  isDeeplyFrozen,
  type Mutable,
} from './index';
import { exampleAcceptanceCriteria, exampleProjectRecordDraft } from './examples';

const ts = (n: number) => n as TimestampMs;
const projectId = (s: string) => s as ProjectId;
const orgRef = (s: string) => s as OrganizationRef;
const criteriaId = (s: string) => s as AcceptanceCriteriaId;

const CRITERIA = exampleAcceptanceCriteria.id as AcceptanceCriteriaId;
const ORG = orgRef('org_compiled_1');

function validDraft() {
  return JSON.parse(JSON.stringify(exampleProjectRecordDraft)) as typeof exampleProjectRecordDraft;
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe('createProjectRecord', () => {
  it('creates a deeply frozen DRAFT record with the criteria bound and no organization', () => {
    const record = createProjectRecord(validDraft());
    expect(record.lifecycle.status).toBe('draft');
    expect(record.lifecycle.projectId).toBe(record.id);
    expect(record.lifecycle.acceptanceCriteriaId).toBe(CRITERIA);
    expect(record.lifecycle.organizationRef).toBeNull();
    expect(record.updatedAt).toBe(record.createdAt);
    expect(isProjectRecord(record)).toBe(true);
    expect(isDeeplyFrozen(record)).toBe(true);
    expect(() => {
      (record as Mutable<ProjectRecord>).name = 'mutated';
    }).toThrow(TypeError);
  });

  it('accepts a draft WITHOUT criteria (pre-compilation draft — activation will refuse it)', () => {
    const draft = validDraft();
    const record = createProjectRecord({ ...draft, acceptanceCriteriaId: undefined });
    expect(record.lifecycle.acceptanceCriteriaId).toBeNull();
    expect(isProjectRecord(record)).toBe(true);
  });

  it('rejects invalid drafts with field-prefixed problems', () => {
    const draft = validDraft();
    const cases: Array<[string, unknown]> = [
      ['id', { ...draft, id: '' }],
      ['tenantId', { ...draft, tenantId: '' }],
      ['name', { ...draft, name: '  ' }],
      ['executionMode', { ...draft, executionMode: 'paper' }],
      ['lineage', { ...draft, lineage: null }],
      ['lineage', { ...draft, lineage: { ...draft.lineage, projectId: projectId('prj_OTHER') } }],
      ['lineage', { ...draft, lineage: { ...draft.lineage, goal: { goalId: 'g', version: 0 } } }],
      ['lineage', { ...draft, lineage: { ...draft.lineage, constraintSet: { id: '', version: 1 } } }],
      ['acceptanceCriteriaId', { ...draft, acceptanceCriteriaId: criteriaId('not-an-ac-id') }],
      ['createdAt', { ...draft, createdAt: ts(Number.NaN) }],
      ['createdAt', { ...draft, createdAt: ts(-1) }],
    ];
    // A null root is outside the input domain entirely: the accessor throws
    // a TypeError before the typed field guards run (the typed-error law
    // governs malformed FIELDS of a record-shaped input).
    expect(() => createProjectRecord(null as unknown as typeof draft)).toThrow();
    for (const [field, input] of cases) {
      try {
        createProjectRecord(input as typeof draft);
        expect.unreachable(`expected createProjectRecord to reject invalid ${field}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ControlDomainError);
        const typed = error as ControlDomainError;
        expect(typed.code).toBe('invalid-project-record');
        expect(typed.details.join(' ')).toContain(field);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Record guard
// ---------------------------------------------------------------------------

describe('isProjectRecord', () => {
  it('accepts factory output across the lifecycle', () => {
    const record = createProjectRecord(validDraft());
    expect(isProjectRecord(record)).toBe(true);
    const bound = bindOrganizationToProject(record, ORG, ts(record.createdAt + 1));
    const activated = advanceProject(bound, 'activate', ts(record.createdAt + 2));
    expect(isProjectRecord(activated.record)).toBe(true);
  });

  it('rejects records whose guard invariants are broken', () => {
    const record = createProjectRecord(validDraft());
    const invalid: unknown[] = [
      null,
      'record',
      { ...record, id: projectId('prj_OTHER') }, // lifecycle/lineage no longer match
      { ...record, lineage: { ...record.lineage, projectId: projectId('prj_OTHER') } },
      { ...record, lifecycle: { ...record.lifecycle, projectId: projectId('prj_OTHER') } },
      { ...record, updatedAt: ts(record.createdAt - 1) }, // updatedAt < createdAt
      { ...record, createdAt: '2027-01-01T00:00:00Z' },
      { ...record, executionMode: 'paper' },
      { ...record, tenantId: '' },
      // active-without-organization: not a state the machine can produce.
      {
        ...record,
        lifecycle: { ...record.lifecycle, status: 'active' },
      },
      // completed without the organization binding: unreachable.
      {
        ...record,
        lifecycle: { ...record.lifecycle, status: 'completed' },
      },
    ];
    for (const v of invalid) expect(isProjectRecord(v)).toBe(false);
  });

  it('isProjectLineage — L15: every record’s lineage block is non-empty ids + versioned refs', () => {
    expect(isProjectLineage(exampleProjectRecordDraft.lineage)).toBe(true);
    const invalid: unknown[] = [
      null,
      {},
      { projectId: '', goal: { goalId: 'g', version: 1 }, constraintSet: { id: 'c', version: 1 } },
      { projectId: 'p', goal: { goalId: '', version: 1 }, constraintSet: { id: 'c', version: 1 } },
      { projectId: 'p', goal: { goalId: 'g' }, constraintSet: { id: 'c', version: 1 } },
      { projectId: 'p', goal: { goalId: 'g', version: 0 }, constraintSet: { id: 'c', version: 1 } },
      { projectId: 'p', goal: { goalId: 'g', version: 1.5 }, constraintSet: { id: 'c', version: 1 } },
      { projectId: 'p', goal: { goalId: 'g', version: 1 }, constraintSet: { id: 'c', version: 0 } },
      { projectId: 'p', goal: { goalId: 'g', version: 1 } },
    ];
    for (const v of invalid) expect(isProjectLineage(v)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Organization binding
// ---------------------------------------------------------------------------

describe('bindOrganizationToProject', () => {
  it('binds in draft and advances updatedAt monotonically', () => {
    const record = createProjectRecord(validDraft());
    const bound = bindOrganizationToProject(record, ORG, ts(record.createdAt + 10));
    expect(bound.lifecycle.organizationRef).toBe(ORG);
    expect(bound.lifecycle.status).toBe('draft');
    expect(bound.updatedAt).toBe(record.createdAt + 10);
    expect(isProjectRecord(bound)).toBe(true);
    expect(isDeeplyFrozen(bound)).toBe(true);
    // Purity: the input record is untouched.
    expect(record.lifecycle.organizationRef).toBeNull();
    expect(record.updatedAt).toBe(record.createdAt);
  });

  it('re-binds in paused (the reorganization window)', () => {
    const record = createProjectRecord(validDraft());
    const bound = bindOrganizationToProject(record, ORG, ts(record.createdAt + 1));
    const active = advanceProject(bound, 'activate', ts(record.createdAt + 2)).record;
    const paused = advanceProject(active, 'pause', ts(record.createdAt + 3)).record;
    const rebound = bindOrganizationToProject(
      paused,
      orgRef('org_compiled_2'),
      ts(record.createdAt + 4),
    );
    expect(rebound.lifecycle.organizationRef).toBe(orgRef('org_compiled_2'));
    expect(rebound.lifecycle.status).toBe('paused');
  });

  it('rejects binding while active, completed, abandoned and archived (typed invalid-binding-state)', () => {
    const record = createProjectRecord(validDraft());
    const bound = bindOrganizationToProject(record, ORG, ts(record.createdAt + 1));
    const active = advanceProject(bound, 'activate', ts(record.createdAt + 2)).record;
    expectTypedError('invalid-binding-state', () =>
      bindOrganizationToProject(active, orgRef('org_x'), ts(record.createdAt + 3)),
    );
    const completed = advanceProject(active, 'complete', ts(record.createdAt + 3)).record;
    expectTypedError('invalid-binding-state', () =>
      bindOrganizationToProject(completed, orgRef('org_x'), ts(record.createdAt + 4)),
    );
    const draftAbandoned = advanceProject(record, 'abandon', ts(record.createdAt + 1)).record;
    expectTypedError('invalid-binding-state', () =>
      bindOrganizationToProject(draftAbandoned, orgRef('org_x'), ts(record.createdAt + 2)),
    );
    const archived = advanceProject(record, 'archive', ts(record.createdAt + 2)).record;
    expectTypedError('invalid-binding-state', () =>
      bindOrganizationToProject(archived, orgRef('org_x'), ts(record.createdAt + 3)),
    );
  });

  it('rejects invalid refs and non-monotonic instants (typed invalid-project-record)', () => {
    const record = createProjectRecord(validDraft());
    expectTypedError('invalid-project-record', () =>
      bindOrganizationToProject(record, '' as OrganizationRef, ts(record.createdAt + 1)),
    );
    expectTypedError('invalid-project-record', () =>
      bindOrganizationToProject(record, ORG, ts(record.createdAt - 1)),
    );
    expectTypedError('invalid-project-record', () =>
      bindOrganizationToProject(record, ORG, ts(Number.NaN)),
    );
    expectTypedError('invalid-project-record', () =>
      bindOrganizationToProject(null as unknown as ProjectRecord, ORG, ts(1)),
    );
  });
});

// ---------------------------------------------------------------------------
// Record-level transitions
// ---------------------------------------------------------------------------

describe('advanceProject', () => {
  it('advances the record through the machine and stamps updatedAt', () => {
    const record = createProjectRecord(validDraft());
    const bound = bindOrganizationToProject(record, ORG, ts(record.createdAt + 1));
    const { record: active, effects } = advanceProject(bound, 'activate', ts(record.createdAt + 2));
    expect(active.lifecycle.status).toBe('active');
    expect(active.updatedAt).toBe(record.createdAt + 2);
    expect(effects.map((e) => e.kind)).toEqual(['organization.activate']);
    expect(isDeeplyFrozen(active)).toBe(true);
    // Purity: the input record is untouched.
    expect(bound.lifecycle.status).toBe('draft');
  });

  it('returns the reducer effects and propagates its typed errors', () => {
    const record = createProjectRecord(validDraft());
    // Activation without an organization binding.
    expectTypedError('missing-organization-binding', () =>
      advanceProject(record, 'activate', ts(record.createdAt + 1)),
    );
    // Illegal edge.
    let thrown: unknown;
    try {
      advanceProject(record, 'pause', ts(record.createdAt + 1));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ControlDomainError);
    expect((thrown as ControlDomainError).code).toBe('illegal-transition');
  });

  it('rejects non-monotonic instants (audit fields never go backwards)', () => {
    const record = createProjectRecord(validDraft());
    const bound = bindOrganizationToProject(record, ORG, ts(record.createdAt + 5));
    expectTypedError('invalid-project-record', () =>
      advanceProject(bound, 'activate', ts(record.createdAt + 4)),
    );
    expectTypedError('invalid-project-record', () =>
      advanceProject(bound, 'activate', ts(Number.NaN)),
    );
  });
});
