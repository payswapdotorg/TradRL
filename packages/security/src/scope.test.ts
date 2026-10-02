/**
 * @tradrl/security — the L12 scope-substrate tests.
 *
 * Pins: the scope guards; the scoped-record wrapper law (every record
 * carries tenant+project); the pure/total scope comparison (no wildcard,
 * no hierarchy); the TYPED `cross_tenant_access` error (never a filter);
 * `requireSameScope` both ways.
 */
import { describe, expect, it } from 'vitest';

import {
  crossTenantAccess,
  isScope,
  isScopedRecord,
  requireSameScope,
  sameScope,
  scopeKey,
  scopeOf,
  validateScope,
  type Scope,
} from './index';

const TENANT_A = 'tenant-alpha' as Scope['tenant'];
const TENANT_B = 'tenant-beta' as Scope['tenant'];
const PROJECT_1 = 'project-one' as Scope['project'];

describe('scope guards', () => {
  it('accepts a structurally valid scope', () => {
    const scope = { tenant: TENANT_A, project: PROJECT_1 };
    expect(isScope(scope)).toBe(true);
    expect(isScopedRecord(scope)).toBe(true);
  });

  it('rejects malformed scopes (missing/malformed components)', () => {
    expect(isScope(null)).toBe(false);
    expect(isScope({ tenant: '', project: PROJECT_1 })).toBe(false);
    expect(isScope({ tenant: TENANT_A })).toBe(false);
    expect(isScope({ tenant: TENANT_A, project: 7 })).toBe(false);
    expect(isScope([{ tenant: TENANT_A, project: PROJECT_1 }])).toBe(false);
  });

  it('validateScope is collect-all and narrows + freezes', () => {
    const bad = validateScope({ tenant: '', project: undefined });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.map((e) => e.code).sort()).toEqual(['invalid_field', 'missing_field']);
    }
    const good = validateScope({ tenant: TENANT_A, project: PROJECT_1 });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(Object.isFrozen(good.value)).toBe(true);
    }
  });
});

describe('scope comparison (pure and total — no escape hatch)', () => {
  it('same scope iff both components match exactly', () => {
    expect(sameScope({ tenant: TENANT_A, project: PROJECT_1 }, { tenant: TENANT_A, project: PROJECT_1 })).toBe(true);
    expect(sameScope({ tenant: TENANT_A, project: PROJECT_1 }, { tenant: TENANT_B, project: PROJECT_1 })).toBe(false);
    expect(sameScope({ tenant: TENANT_A, project: PROJECT_1 }, { tenant: TENANT_A, project: 'project-two' as Scope['project'] })).toBe(false);
  });

  it('scopeKey is the deterministic tenant/project index form', () => {
    expect(scopeKey({ tenant: TENANT_A, project: PROJECT_1 })).toBe('tenant-alpha/project-one');
  });

  it('scopeOf projects any scoped record onto its scope', () => {
    const record = { tenant: TENANT_B, project: PROJECT_1, payload: { x: 1 } };
    expect(scopeOf(record)).toEqual({ tenant: TENANT_B, project: PROJECT_1 });
  });
});

describe('the typed cross-tenant error (L12 — an error, never a filter)', () => {
  it('names the acting scope and the record scope (ids only, never payload)', () => {
    const error = crossTenantAccess('get', { tenant: TENANT_B, project: PROJECT_1 }, { tenant: TENANT_A, project: PROJECT_1 });
    expect(error.code).toBe('cross_tenant_access');
    expect(error.message).toContain('tenant-beta/project-one');
    expect(error.message).toContain('tenant-alpha/project-one');
    expect(error.message).toContain('L12');
  });

  it('requireSameScope: ok for the owning scope, the typed error for any other', () => {
    const record = { tenant: TENANT_A, project: PROJECT_1, record_id: 'r1', payload: { secretFree: true } };
    const own = requireSameScope('get', { tenant: TENANT_A, project: PROJECT_1 }, record);
    expect(own.ok).toBe(true);
    const foreign = requireSameScope('get', { tenant: TENANT_B, project: PROJECT_1 }, record);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(foreign.errors).toHaveLength(1);
      expect(foreign.errors[0]!.code).toBe('cross_tenant_access');
    }
  });

  it('there is no wildcard scope: every other tenant is refused, including near-miss ids', () => {
    const record = { tenant: 'tenant-alpha' as Scope['tenant'], project: PROJECT_1 };
    for (const actor of [{ tenant: TENANT_B, project: PROJECT_1 }, { tenant: 'tenant-alpha-2' as Scope['tenant'], project: PROJECT_1 }, { tenant: '' as Scope['tenant'], project: PROJECT_1 }]) {
      if (!isScope(actor)) continue;
      expect(requireSameScope('get', actor, record).ok).toBe(actor.tenant === 'tenant-alpha' ? true : false);
    }
  });
});
