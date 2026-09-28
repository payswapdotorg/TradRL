// The reference firewall port behavioral suite: the T026 decision rule
// mirrored — check order is the law (tenant boundary FIRST disclosing
// nothing, then the INCLUSIVE point-in-time boundary, then the filter),
// total guards, replayable audit shape, purity.

import { describe, expect, it } from 'vitest';
import { createReferenceFirewallPort, isReferenceFirewallPort, referenceFirewallProject } from './index';
import { admittedFixture } from './interop.fixture';
import { requireTenantId } from './ids';
import type { FirewallClock, KnowledgeBaseView, TimeMachineRecord, TimestampMs } from './index';
import type { KnowledgeRecordId } from './index';

describe('the reference port decision rule (T026 mirror)', () => {
  it('includes a tenant record at the inclusive boundary and withholds one millisecond earlier', () => {
    const record = admittedFixture(); // available at 2_000, tenant acme
    const base = baseOf(record);
    const tenant = requireTenantId('acme');

    const atBoundary = project(base, 2_000, tenant, {});
    expect(atBoundary.records.map((r) => r.record_id)).toEqual(['kr-admitted']);

    const before = project(base, 1_999, tenant, {});
    expect(before.records).toHaveLength(0);
    expect(before.audit.decisions[0]?.reason).toBe('not_yet_available');
  });

  it('tenant boundary FIRST: another tenant\'s records are excluded with NULL availability (L12 — no timing disclosure)', () => {
    const record = admittedFixture();
    const base = baseOf(record);
    const foreign = requireTenantId('globex');

    const result = project(base, 1_000_000, foreign, {});
    expect(result.records).toHaveLength(0);
    const decision = result.audit.decisions[0];
    expect(decision?.decision).toBe('excluded');
    expect(decision?.reason).toBe('tenant_boundary');
    expect(decision?.available_time).toBeNull(); // never disclose another tenant's timing
  });

  it('the filter narrows AFTER visibility (ids, availableFrom, availableTo)', () => {
    const early = admittedFixture(); // 2_000
    const late = { ...early, record_id: 'kr-late', available_time: 5_000 as TimestampMs, arrival_sequence: 1 };
    const base = baseOf([early, late]);
    const tenant = requireTenantId('acme');

    expect(project(base, 10_000, tenant, { ids: ['kr-late'] }).records.map((r) => r.record_id)).toEqual(['kr-late']);
    expect(project(base, 10_000, tenant, { availableFrom: 3_000 }).records.map((r) => r.record_id)).toEqual(['kr-late']);
    expect(project(base, 10_000, tenant, { availableTo: 3_000 }).records.map((r) => r.record_id)).toEqual(['kr-admitted']);
    // filtered_out is a DISTINCT reason from not_yet_available.
    const filtered = project(base, 10_000, tenant, { ids: ['kr-late'] });
    expect(filtered.audit.decisions[0]?.reason).toBe('filtered_out');
  });

  it('total guards: invalid base, clock, tenant and filter are typed rejections', () => {
    const record = admittedFixture();
    const tenant = requireTenantId('acme');
    expect(referenceFirewallProject(null as never, { now: 1 as never }, tenant, {}).ok).toBe(false);
    expect(referenceFirewallProject(baseOf(record), { now: -1 as never }, tenant, {}).ok).toBe(false);
    expect(referenceFirewallProject(baseOf(record), { now: 1 as never }, '' as never, {}).ok).toBe(false);
    expect(referenceFirewallProject(baseOf(record), { now: 1 as never }, tenant, { ids: ['' as KnowledgeRecordId] }).ok).toBe(false);
    expect(referenceFirewallProject(baseOf(record), { now: 1 as never }, tenant, { availableFrom: 5 as never, availableTo: 1 as never }).ok).toBe(false);
  });

  it('the port object is frozen, valid, and wraps the pure function', () => {
    const port = createReferenceFirewallPort();
    expect(isReferenceFirewallPort(port)).toBe(true);
    expect(isReferenceFirewallPort({ project: () => null })).toBe(false);
    expect(Object.isFrozen(port)).toBe(true);
    expect(() => {
      (port as Record<string, unknown>).project = () => null;
    }).toThrow();
  });

  it('decisions are pure: the same query over the same base reproduces the identical audit', () => {
    const record = admittedFixture();
    const base = baseOf(record);
    const tenant = requireTenantId('acme');
    const first = project(base, 2_000, tenant, {});
    const second = project(base, 2_000, tenant, {});
    expect(second).toEqual(first);
    expect(second.audit).toEqual(first.audit);
  });
});

// ---------------------------------------------------------------------------
// Local helpers.
// ---------------------------------------------------------------------------

function baseOf(records: readonly TimeMachineRecord[]): KnowledgeBaseView {
  return Object.freeze({ records: Object.freeze([...records]), size: records.length }) as KnowledgeBaseView;
}

function project(
  base: KnowledgeBaseView,
  at: number,
  tenant: ReturnType<typeof requireTenantId>,
  filter: { ids?: readonly string[]; availableFrom?: number; availableTo?: number },
): { records: readonly TimeMachineRecord[]; audit: { decisions: readonly { reason: string }[] } } {
  const result = referenceFirewallProject(
    base,
    { now: at as TimestampMs } satisfies FirewallClock,
    tenant,
    {
      ...(filter.ids === undefined ? {} : { ids: filter.ids as readonly never[] }),
      ...(filter.availableFrom === undefined ? {} : { availableFrom: filter.availableFrom as TimestampMs }),
      ...(filter.availableTo === undefined ? {} : { availableTo: filter.availableTo as TimestampMs }),
    },
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
