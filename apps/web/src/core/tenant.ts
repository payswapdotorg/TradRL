// @tradrl/web-console — the tenant context (L12 at the interface).
//
// THE LAW (Work Order T042): "Tenant/project scoping on every record
// (L12)" and "the console carries the tenant context on every read;
// a cross-tenant render is a typed error". The workspace is opened
// for exactly one tenant scope; every API read the loaders issue is
// scoped to it, and every record entering the workspace state passes
// `assertTenantScope` — a record from another tenant is the typed
// CrossTenantRenderError BEFORE it can reach a render path.
//
// Spec anchors: L12, SECURITY.md "Isolate data, projects,
// trajectories, memory, artifacts, credentials and usage".

import { CrossTenantRenderError } from './errors';

/** The workspace's scope: one tenant, one project (the console is project-centric — R36). */
export interface WorkspaceScope {
  readonly tenantId: string;
  readonly projectId: string;
}

/** Guard: a well-formed scope. */
export function isWorkspaceScope(v: unknown): v is WorkspaceScope {
  if (typeof v !== 'object' || v === null) return false;
  const candidate = v as Record<string, unknown>;
  return typeof candidate.tenantId === 'string' && candidate.tenantId.length > 0
    && typeof candidate.projectId === 'string' && candidate.projectId.length > 0;
}

/** The tenant field every API record carries (the mirrored records name it `tenantId` or `tenant`). */
export function tenantOfRecord(record: { readonly tenantId?: unknown; readonly tenant?: unknown }): string {
  if (typeof record.tenantId === 'string') return record.tenantId;
  if (typeof record.tenant === 'string') return record.tenant;
  return '';
}

/** The project field every project-scoped API record carries. */
export function projectOfRecord(record: { readonly projectId?: unknown; readonly project?: unknown; readonly lifecycle?: { readonly projectId?: unknown } }): string {
  if (typeof record.projectId === 'string') return record.projectId;
  if (typeof record.project === 'string') return record.project;
  if (typeof record.lifecycle === 'object' && record.lifecycle !== null && typeof record.lifecycle.projectId === 'string') return record.lifecycle.projectId;
  return '';
}

/**
 * THE TENANT GATE: assert that a record entering the workspace (or a
 * render path) belongs to the workspace's tenant scope. A violation
 * is the typed CrossTenantRenderError — cross-tenant data can never
 * render, not even once, not even degraded.
 */
export function assertTenantScope(scope: WorkspaceScope, record: { readonly tenantId?: unknown; readonly tenant?: unknown }): void {
  const tenant = tenantOfRecord(record);
  if (tenant !== scope.tenantId) {
    throw new CrossTenantRenderError(
      `a record of tenant ${JSON.stringify(tenant)} entered the workspace of tenant ${JSON.stringify(scope.tenantId)} — cross-tenant renders are a typed error (L12)`,
      scope.tenantId,
      tenant,
    );
  }
}

/**
 * The full scope gate (tenant + project): project-scoped records
 * must additionally match the workspace's project. A foreign
 * project's record is as much a cross-tenant render as a foreign
 * tenant's.
 */
export function assertProjectScope(scope: WorkspaceScope, record: { readonly tenantId?: unknown; readonly tenant?: unknown; readonly projectId?: unknown; readonly project?: unknown; readonly lifecycle?: { readonly projectId?: unknown } }): void {
  assertTenantScope(scope, record);
  const project = projectOfRecord(record);
  if (project !== '' && project !== scope.projectId) {
    throw new CrossTenantRenderError(
      `a record of project ${JSON.stringify(project)} entered the workspace of project ${JSON.stringify(scope.projectId)} (tenant ${JSON.stringify(scope.tenantId)}) — cross-scope renders are a typed error (L12)`,
      scope.tenantId,
      tenantOfRecord(record),
    );
  }
}
