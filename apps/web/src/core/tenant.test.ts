// Tests for the tenant/project scope gates (L12 at the interface).
//
// Laws pinned here (tenant.ts header):
//   - the workspace is opened for exactly one (tenant, project) scope;
//   - every record entering the workspace passes the tenant gate — a record
//     from another tenant is the typed CrossTenantRenderError BEFORE it can render;
//   - project-scoped records must match the workspace project too;
//   - mirrored records name the tenant `tenantId` OR `tenant` (and the project
//     `projectId`, `project`, or `lifecycle.projectId`).

import { describe, expect, it } from 'vitest';
import {
  assertProjectScope,
  assertTenantScope,
  isWorkspaceScope,
  projectOfRecord,
  tenantOfRecord,
  type WorkspaceScope,
} from './tenant';
import { ConsoleLawError, CrossTenantRenderError } from './errors';

const scope: WorkspaceScope = { tenantId: 'tenant-a', projectId: 'proj-a' };

describe('tenant: the record field mirrors', () => {
  it('tenantOfRecord reads tenantId, then tenant, else empty', () => {
    expect(tenantOfRecord({ tenantId: 'tenant-a' })).toBe('tenant-a');
    expect(tenantOfRecord({ tenant: 'tenant-b' })).toBe('tenant-b');
    expect(tenantOfRecord({ tenantId: 'tenant-a', tenant: 'tenant-b' })).toBe('tenant-a');
    expect(tenantOfRecord({})).toBe('');
  });

  it('projectOfRecord reads projectId, then project, then lifecycle.projectId, else empty', () => {
    expect(projectOfRecord({ projectId: 'proj-a' })).toBe('proj-a');
    expect(projectOfRecord({ project: 'proj-b' })).toBe('proj-b');
    expect(projectOfRecord({ lifecycle: { projectId: 'proj-c' } })).toBe('proj-c');
    expect(projectOfRecord({ projectId: 'proj-a', project: 'proj-b' })).toBe('proj-a');
    expect(projectOfRecord({})).toBe('');
  });

  it('isWorkspaceScope guards the scope shape', () => {
    expect(isWorkspaceScope(scope)).toBe(true);
    expect(isWorkspaceScope({ tenantId: '', projectId: 'p' })).toBe(false);
    expect(isWorkspaceScope({ tenantId: 't' })).toBe(false);
    expect(isWorkspaceScope(null)).toBe(false);
    expect(isWorkspaceScope('tenant-a')).toBe(false);
  });
});

describe('tenant: the tenant gate (typed CrossTenantRenderError)', () => {
  it('a record of the workspace tenant passes', () => {
    expect(() => assertTenantScope(scope, { tenantId: 'tenant-a' })).not.toThrow();
    expect(() => assertTenantScope(scope, { tenant: 'tenant-a' })).not.toThrow();
  });

  it('a foreign tenant is the typed CrossTenantRenderError — never a silent wrong render', () => {
    let caught: unknown;
    try {
      assertTenantScope(scope, { tenantId: 'tenant-b' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CrossTenantRenderError);
    expect(caught).toBeInstanceOf(ConsoleLawError);
    const violation = caught as CrossTenantRenderError;
    expect(violation.name).toBe('CrossTenantRenderError');
    expect(violation.code).toBe('cross_tenant_render');
    expect(violation.expectedTenant).toBe('tenant-a');
    expect(violation.actualTenant).toBe('tenant-b');
    expect(violation.message).toContain('tenant-b');
    expect(violation.message).toContain('L12');
  });

  it('a record carrying NO tenant is refused too (unknown scope is not workspace scope)', () => {
    expect(() => assertTenantScope(scope, {})).toThrow(CrossTenantRenderError);
  });
});

describe('tenant: the project gate', () => {
  it('a project-scoped record of the workspace project passes', () => {
    expect(() => assertProjectScope(scope, { tenantId: 'tenant-a', projectId: 'proj-a' })).not.toThrow();
    expect(() => assertProjectScope(scope, { tenant: 'tenant-a', lifecycle: { projectId: 'proj-a' } })).not.toThrow();
  });

  it('an unscoped record passes the project test (tenant-only records are allowed)', () => {
    expect(() => assertProjectScope(scope, { tenantId: 'tenant-a' })).not.toThrow();
  });

  it('a foreign project is the typed CrossTenantRenderError', () => {
    let caught: unknown;
    try {
      assertProjectScope(scope, { tenantId: 'tenant-a', projectId: 'proj-z' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CrossTenantRenderError);
    expect((caught as CrossTenantRenderError).expectedTenant).toBe('tenant-a');
    expect(caught).not.toBeNull();
  });

  it('a foreign tenant fails the project gate at the tenant check first', () => {
    expect(() => assertProjectScope(scope, { tenantId: 'tenant-z', projectId: 'proj-z' })).toThrow(
      /cross-tenant renders are a typed error/,
    );
  });
});
