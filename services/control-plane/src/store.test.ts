import { describe, expect, it } from 'vitest';
import {
  ControlDomainError,
  type ProjectId,
  type ProjectRecord,
  type TenantId,
  createProjectRecord,
  deepFreeze,
} from '../../../packages/control-domain/src/index';
import { exampleProjectRecordDraft } from '../../../packages/control-domain/src/examples';
import { ProjectStore } from './store';

const tenantA = 'tenant_acme' as TenantId;
const tenantB = 'tenant_beta' as TenantId;

function draftFor(tenant: TenantId, id: string): ReturnType<typeof createProjectRecord> {
  const draft = JSON.parse(JSON.stringify(exampleProjectRecordDraft));
  return createProjectRecord({
    ...draft,
    id: id as ProjectId,
    tenantId: tenant,
    lineage: { ...draft.lineage, projectId: id as ProjectId },
  });
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

describe('ProjectStore', () => {
  it('creates, reads, lists and updates within one tenant', () => {
    const store = new ProjectStore();
    const record = draftFor(tenantA, 'prj_a1');
    store.create(record);
    expect(store.get(tenantA, record.id)).toEqual(record);
    expect(store.has(tenantA, record.id)).toBe(true);
    expect(store.list(tenantA).map((r) => r.id)).toEqual([record.id]);

    const updated = { ...record, name: 'Renamed' } as ProjectRecord;
    store.update(deepFreeze(updated));
    expect(store.get(tenantA, record.id)?.name).toBe('Renamed');
    expect(store.list(tenantA)).toHaveLength(1);
  });

  it('preserves creation order across updates (deterministic listing for replay parity)', () => {
    const store = new ProjectStore();
    store.create(draftFor(tenantA, 'prj_a1'));
    store.create(draftFor(tenantA, 'prj_a2'));
    store.create(draftFor(tenantA, 'prj_a3'));
    store.update(draftFor(tenantA, 'prj_a2')); // update does not reorder
    expect(store.list(tenantA).map((r) => r.id)).toEqual(['prj_a1', 'prj_a2', 'prj_a3']);
  });

  it('rejects duplicate ids within the tenant (typed duplicate-project)', () => {
    const store = new ProjectStore();
    store.create(draftFor(tenantA, 'prj_dup'));
    expectTypedError('duplicate-project', () => store.create(draftFor(tenantA, 'prj_dup')));
  });

  it('rejects structurally invalid records (fail-closed against casts)', () => {
    const store = new ProjectStore();
    expectTypedError('invalid-project-record', () => store.create(null as unknown as ProjectRecord));
    expectTypedError('invalid-project-record', () =>
      store.create({ ...draftFor(tenantA, 'prj_x'), tenantId: '' } as unknown as ProjectRecord),
    );
    expectTypedError('invalid-project-record', () =>
      store.update('record' as unknown as ProjectRecord),
    );
  });

  it('rejects updates for records that do not exist in the tenant', () => {
    const store = new ProjectStore();
    expectTypedError('project-not-found', () => store.update(draftFor(tenantA, 'prj_ghost')));
  });

  it('the same project id MAY exist under two tenants (isolation, not global uniqueness)', () => {
    const store = new ProjectStore();
    store.create(draftFor(tenantA, 'prj_shared'));
    store.create(draftFor(tenantB, 'prj_shared'));
    expect(store.list(tenantA).map((r) => r.tenantId)).toEqual([tenantA]);
    expect(store.list(tenantB).map((r) => r.tenantId)).toEqual([tenantB]);
  });
});

describe('ProjectStore — tenant isolation (L12)', () => {
  it('cross-tenant get returns undefined: INDISTINGUISHABLE from an unknown id', () => {
    const store = new ProjectStore();
    const record = draftFor(tenantA, 'prj_secret');
    store.create(record);
    expect(store.get(tenantB, record.id)).toBeUndefined(); // no leak
    expect(store.get(tenantB, 'prj_unknown' as ProjectId)).toBeUndefined(); // identical answer
    expect(store.has(tenantB, record.id)).toBe(false);
  });

  it('list() never discloses another tenant projects', () => {
    const store = new ProjectStore();
    store.create(draftFor(tenantA, 'prj_a1'));
    store.create(draftFor(tenantA, 'prj_a2'));
    expect(store.list(tenantB)).toEqual([]);
    expect(store.list(tenantA)).toHaveLength(2);
  });

  it('cross-tenant update is impossible: update resolves within the record own tenant bucket only', () => {
    const store = new ProjectStore();
    const recordA = draftFor(tenantA, 'prj_a1');
    store.create(recordA);
    // A record structurally belongs to tenant A; an update attempt scoped
    // to tenant B never touches A's bucket because there is no API that
    // takes (caller tenant, foreign record): update() addresses the
    // record's OWN bucket, and cross-bucket reads return undefined first.
    const updated = { ...recordA, name: 'Hijacked' } as ProjectRecord;
    store.update(deepFreeze(updated)); // legitimate owner path
    expect(store.get(tenantB, recordA.id)).toBeUndefined();
    expect(store.get(tenantA, recordA.id)?.name).toBe('Hijacked');
  });
});

describe('ProjectStore — immutability discipline', () => {
  it('stored records are deeply frozen and listings are frozen arrays', () => {
    const store = new ProjectStore();
    store.create(draftFor(tenantA, 'prj_frozen'));
    const stored = store.get(tenantA, 'prj_frozen' as ProjectId);
    expect(stored).toBeDefined();
    expect(() => {
      (stored as { name: string }).name = 'mutated';
    }).toThrow(TypeError);
    const listing = store.list(tenantA);
    expect(Object.isFrozen(listing)).toBe(true);
    expect(() => {
      (listing as unknown as unknown[]).push(stored as ProjectRecord);
    }).toThrow(TypeError);
  });
});
