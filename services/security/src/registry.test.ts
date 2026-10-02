/**
 * @tradrl/security-service — registry unit tests (the L12 plane).
 *
 * Pins: registration-first writes; append-only; the trip-wire write
 * gate; scope-pure listing; the typed cross_tenant_access on foreign
 * reads (including same-record-id collisions across tenants);
 * unknown_record; the JSON-safe snapshot.
 */
import { describe, expect, it } from 'vitest';

import type { ProjectId, Scope, TenantId, TimestampMs } from '../../../packages/security/src/index';
import {
  createTenantIsolationRegistry,
  getScopedRecord,
  ISOLATION_SURFACES,
  isScopeRegistered,
  listScopedRecords,
  putScopedRecord,
  registerProject,
  registerTenant,
  registrySnapshot,
} from './index';

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT_A = 'tenant-alpha' as TenantId;
const TENANT_B = 'tenant-beta' as TenantId;
const PROJECT_1 = 'project-one' as ProjectId;
const PROJECT_2 = 'project-two' as ProjectId;

const SCOPE_A: Scope = { tenant: TENANT_A, project: PROJECT_1 };
const SCOPE_B: Scope = { tenant: TENANT_B, project: PROJECT_1 };

function setupTwoTenants() {
  const registry = createTenantIsolationRegistry();
  expect(registerTenant(registry, TENANT_A, T0).ok).toBe(true);
  expect(registerTenant(registry, TENANT_B, (T0 + 1) as TimestampMs).ok).toBe(true);
  expect(registerProject(registry, SCOPE_A, (T0 + 2) as TimestampMs).ok).toBe(true);
  expect(registerProject(registry, SCOPE_B, (T0 + 3) as TimestampMs).ok).toBe(true);
  return registry;
}

describe('registration', () => {
  it('registers tenants and projects; re-registration is the typed tenant_already_registered', () => {
    const registry = createTenantIsolationRegistry();
    expect(registerTenant(registry, TENANT_A, T0).ok).toBe(true);
    const again = registerTenant(registry, TENANT_A, (T0 + 1) as TimestampMs);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors[0]!.code).toBe('tenant_already_registered');
    expect(registerProject(registry, SCOPE_A, (T0 + 2) as TimestampMs).ok).toBe(true);
    const againProject = registerProject(registry, SCOPE_A, (T0 + 3) as TimestampMs);
    expect(againProject.ok).toBe(false);
    if (!againProject.ok) expect(againProject.errors[0]!.code).toBe('tenant_already_registered');
  });

  it('a project under an UNREGISTERED tenant is the typed tenant_missing', () => {
    const registry = createTenantIsolationRegistry();
    const result = registerProject(registry, SCOPE_A, T0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('tenant_missing');
  });

  it('the same project id under DIFFERENT tenants is legal (the namespace is per-tenant)', () => {
    const registry = setupTwoTenants();
    expect(isScopeRegistered(registry, SCOPE_A)).toBe(true);
    expect(isScopeRegistered(registry, SCOPE_B)).toBe(true);
    const scopeA2: Scope = { tenant: TENANT_A, project: PROJECT_2 };
    expect(registerProject(registry, scopeA2, (T0 + 4) as TimestampMs).ok).toBe(true);
  });
});

describe('writes (registration-first, trip-wired, append-only)', () => {
  it('a write into an unregistered scope is the typed tenant_missing', () => {
    const registry = createTenantIsolationRegistry();
    const result = putScopedRecord(registry, 'data', { tenant: TENANT_A, project: PROJECT_1, record_id: 'r1', payload: { x: 1 }, asOf: T0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('tenant_missing');
  });

  it('a payload carrying credential MATERIAL is the typed credential_value_present (the committed-secret law)', () => {
    const registry = setupTwoTenants();
    for (const payload of [{ apiKey: 'AKIA-1' }, { nested: { password: 'x' } }, [{ token: 'y' }]]) {
      const result = putScopedRecord(registry, 'data', { tenant: TENANT_A, project: PROJECT_1, record_id: 'r1', payload: payload as never, asOf: T0 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]!.code).toBe('credential_value_present');
    }
  });

  it('duplicate record ids per scope+surface are refused; different surfaces accept the same id', () => {
    const registry = setupTwoTenants();
    expect(putScopedRecord(registry, 'data', { tenant: TENANT_A, project: PROJECT_1, record_id: 'r1', payload: { x: 1 }, asOf: T0 }).ok).toBe(true);
    const dup = putScopedRecord(registry, 'data', { tenant: TENANT_A, project: PROJECT_1, record_id: 'r1', payload: { x: 2 }, asOf: (T0 + 1) as TimestampMs });
    expect(dup.ok).toBe(false);
    expect(putScopedRecord(registry, 'memory', { tenant: TENANT_A, project: PROJECT_1, record_id: 'r1', payload: { x: 3 }, asOf: (T0 + 2) as TimestampMs }).ok).toBe(true);
  });

  it('every surface on the closed list accepts writes; unknown surfaces are refused', () => {
    const registry = setupTwoTenants();
    for (const surface of ISOLATION_SURFACES) {
      expect(putScopedRecord(registry, surface, { tenant: TENANT_A, project: PROJECT_1, record_id: `r-${surface}`, payload: 1, asOf: T0 }).ok).toBe(true);
    }
    const bad = putScopedRecord(registry, 'vibes' as never, { tenant: TENANT_A, project: PROJECT_1, record_id: 'r-v', payload: 1, asOf: T0 });
    expect(bad.ok).toBe(false);
  });
});

describe('reads (the typed cross-tenant error; scope-pure listing)', () => {
  it('a foreign read is the typed cross_tenant_access naming both scopes', () => {
    const registry = setupTwoTenants();
    expect(putScopedRecord(registry, 'data', { tenant: TENANT_A, project: PROJECT_1, record_id: 'alpha-data-1', payload: { sensitive: 'tenant-a-fact' }, asOf: T0 }).ok).toBe(true);
    const foreign = getScopedRecord(registry, 'data', SCOPE_B, 'alpha-data-1');
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(foreign.errors[0]!.code).toBe('cross_tenant_access');
      expect(foreign.errors[0]!.message).toContain('tenant-alpha');
      expect(foreign.errors[0]!.message).toContain('tenant-beta');
    }
    const own = getScopedRecord(registry, 'data', SCOPE_A, 'alpha-data-1');
    expect(own.ok).toBe(true);
  });

  it('SAME record ids under different tenants do not collide (own read wins, foreign read refused)', () => {
    const registry = setupTwoTenants();
    expect(putScopedRecord(registry, 'memory', { tenant: TENANT_A, project: PROJECT_1, record_id: 'shared-id', payload: { owner: 'A' }, asOf: T0 }).ok).toBe(true);
    expect(putScopedRecord(registry, 'memory', { tenant: TENANT_B, project: PROJECT_1, record_id: 'shared-id', payload: { owner: 'B' }, asOf: (T0 + 1) as TimestampMs }).ok).toBe(true);
    const readA = getScopedRecord(registry, 'memory', SCOPE_A, 'shared-id');
    expect(readA.ok && (readA.value.payload as { owner: string }).owner).toBe('A');
    const readB = getScopedRecord(registry, 'memory', SCOPE_B, 'shared-id');
    expect(readB.ok && (readB.value.payload as { owner: string }).owner).toBe('B');
    // A foreign id that exists ONLY under the other tenant:
    expect(putScopedRecord(registry, 'artifacts', { tenant: TENANT_B, project: PROJECT_1, record_id: 'b-only', payload: { owner: 'B' }, asOf: (T0 + 2) as TimestampMs }).ok).toBe(true);
    const foreign = getScopedRecord(registry, 'artifacts', SCOPE_A, 'b-only');
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors[0]!.code).toBe('cross_tenant_access');
  });

  it('an unknown record is unknown_record (distinct from cross-tenant)', () => {
    const registry = setupTwoTenants();
    const result = getScopedRecord(registry, 'data', SCOPE_A, 'never-written');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('unknown_record');
  });

  it("listing walks ONLY the scope own index (insertion order)", () => {
    const registry = setupTwoTenants();
    for (let i = 0; i < 3; i++) {
      expect(putScopedRecord(registry, 'trajectories', { tenant: TENANT_A, project: PROJECT_1, record_id: `a-${i}`, payload: { i }, asOf: (T0 + i) as TimestampMs }).ok).toBe(true);
    }
    expect(putScopedRecord(registry, 'trajectories', { tenant: TENANT_B, project: PROJECT_1, record_id: 'b-0', payload: { i: 99 }, asOf: T0 }).ok).toBe(true);
    const listed = listScopedRecords(registry, 'trajectories', SCOPE_A);
    expect(listed.map((r) => r.record_id)).toEqual(['a-0', 'a-1', 'a-2']);
    expect(listed.every((r) => r.tenant === TENANT_A)).toBe(true);
  });
});

describe('the snapshot (the JSON-safe view)', () => {
  it("is deeply frozen and contains every tenant records", () => {
    const registry = setupTwoTenants();
    expect(putScopedRecord(registry, 'data', { tenant: TENANT_A, project: PROJECT_1, record_id: 'a1', payload: { v: 1 }, asOf: T0 }).ok).toBe(true);
    expect(putScopedRecord(registry, 'data', { tenant: TENANT_B, project: PROJECT_1, record_id: 'b1', payload: { v: 2 }, asOf: T0 }).ok).toBe(true);
    const snapshot = registrySnapshot(registry);
    expect(snapshot.tenants.map((t) => t.tenant)).toEqual([TENANT_A, TENANT_B]);
    expect(snapshot.records.map((r) => r.record_id).sort()).toEqual(['a1', 'b1']);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });
});
