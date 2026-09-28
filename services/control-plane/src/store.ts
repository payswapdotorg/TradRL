// @tradrl/control-plane — the in-memory, tenant-scoped ProjectStore.
//
// The reference persistence for the control plane (Work Order T007
// non-scope boundary: no persistence beyond this in-memory store).
//
// Tenant isolation (L12) is STRUCTURAL: the store is a map of per-tenant
// buckets — there is no lookup that crosses tenants, and a `get` from the
// wrong tenant returns `undefined`, INDISTINGUISHABLE from an unknown id
// (the caller learns nothing about other tenants' projects). The service
// layer maps that to a `project-not-found` typed error.
//
// Records are immutable `ProjectRecord`s (deeply frozen by the domain
// factories); the store re-freezes defensively (deepFreeze is idempotent).
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L12; spec/DOMAIN-MODEL.md
// (Project).

import {
  ControlDomainError,
  ProjectId,
  ProjectRecord,
  TenantId,
  deepFreeze,
  isProjectRecord,
} from '../../../packages/control-domain/src/index';

/**
 * In-memory project store, tenant-scoped by construction. Insertion order
 * per tenant bucket is preserved (deterministic listing — the audit
 * replay's insertion order matches exactly).
 */
export class ProjectStore {
  // TenantId -> (ProjectId -> record). Cross-tenant access is inexpressible:
  // every read path goes through exactly one bucket.
  readonly #byTenant = new Map<TenantId, Map<ProjectId, ProjectRecord>>();

  /**
   * Inserts a new project record. Throws
   * `ControlDomainError('duplicate-project')` when the id already exists
   * within the tenant, and `invalid-project-record` for a record that fails
   * the structural guard (fail-closed against garbage pushed through casts).
   */
  create(record: ProjectRecord): void {
    if (!isProjectRecord(record)) {
      throw new ControlDomainError(
        'invalid-project-record',
        'ProjectStore.create: record failed structural validation',
        ['record: expected a valid ProjectRecord'],
      );
    }
    const bucket = this.#bucketFor(record.tenantId);
    if (bucket.has(record.id)) {
      throw new ControlDomainError(
        'duplicate-project',
        `ProjectStore.create: project id already exists for this tenant`,
        [`id: ${JSON.stringify(record.id)} is already taken within the tenant scope`],
      );
    }
    bucket.set(record.id, deepFreeze(record));
  }

  /**
   * Tenant-scoped read. Returns `undefined` for unknown ids AND for ids
   * that exist under a different tenant — the two cases are deliberately
   * indistinguishable (no cross-tenant existence leak, L12).
   */
  get(tenantId: TenantId, projectId: ProjectId): ProjectRecord | undefined {
    return this.#byTenant.get(tenantId)?.get(projectId);
  }

  /** `true` iff the project exists within the given tenant scope. */
  has(tenantId: TenantId, projectId: ProjectId): boolean {
    return this.get(tenantId, projectId) !== undefined;
  }

  /**
   * Replaces an existing record (same tenant, same id). Throws
   * `project-not-found` when the record does not exist in that tenant —
   * cross-tenant updates are impossible by construction.
   */
  update(record: ProjectRecord): void {
    if (!isProjectRecord(record)) {
      throw new ControlDomainError(
        'invalid-project-record',
        'ProjectStore.update: record failed structural validation',
        ['record: expected a valid ProjectRecord'],
      );
    }
    const bucket = this.#byTenant.get(record.tenantId);
    if (bucket === undefined || !bucket.has(record.id)) {
      throw new ControlDomainError(
        'project-not-found',
        'ProjectStore.update: project does not exist within the tenant scope',
        [`id: ${JSON.stringify(record.id)}`],
      );
    }
    bucket.set(record.id, deepFreeze(record));
  }

  /**
   * All projects of one tenant, in creation order, as a frozen array.
   * Never discloses other tenants' data.
   */
  list(tenantId: TenantId): readonly ProjectRecord[] {
    const bucket = this.#byTenant.get(tenantId);
    return deepFreeze([...(bucket?.values() ?? [])]);
  }

  #bucketFor(tenantId: TenantId): Map<ProjectId, ProjectRecord> {
    let bucket = this.#byTenant.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map<ProjectId, ProjectRecord>();
      this.#byTenant.set(tenantId, bucket);
    }
    return bucket;
  }
}
