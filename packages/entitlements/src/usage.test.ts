// @tradrl/entitlements — the R41 usage enforcement tests: the mirrored
// fact surface, the window count, and the closed-world allowance fold.

import { describe, expect, it } from 'vitest';
import {
  PRIVATE_ROUTE_FAMILIES_MIRROR,
  PUBLIC_ROUTE_FAMILIES_MIRROR,
  ROUTE_FAMILIES_MIRROR,
  SDK_ERROR_FAMILIES_MIRROR,
  USAGE_ID_PATTERN_MIRROR,
  isPrivateRouteFamilyMirror,
  isPublicRouteFamilyMirror,
  isRouteFamilyMirror,
  isSdkErrorFamilyMirror,
  isUsageRecordMirror,
  usageQuotaDecision,
  usageWindowCount,
} from './index';
import type { QuotaGrantView, TenantId, TimestampMs, UsageRecordMirror } from './index';

const TENANT = 'tenant-entitlement-fixture';
const T0 = 1_735_600_000_000;

function record(route: string, at: number, tenant = TENANT, status = 200): UsageRecordMirror {
  return {
    usageId: `usu:${((at + route.length * 7919) % 0xffff_ffff).toString(16).padStart(8, '0')}`,
    tenant: tenant as TenantId,
    credentialId: 'dev:test',
    route,
    method: 'POST',
    path: '/v1/jobs/research',
    status,
    at: at as TimestampMs,
  };
}

const GRANTS: readonly QuotaGrantView[] = [
  { grantId: 'eg:0000000000000101', routeFamilies: ['jobs:write'], maxRequests: 3, windowMs: 1000 },
  { grantId: 'eg:0000000000000102', routeFamilies: ['jobs:read', 'knowledge:read'], maxRequests: 10, windowMs: 60_000 },
];

describe('the T041 mirrors', () => {
  it('the route-family vocabulary matches the boundary\'s route table (public + private)', () => {
    expect([...PUBLIC_ROUTE_FAMILIES_MIRROR]).toEqual([
      'meta:read',
      'projects:read',
      'projects:write',
      'knowledge:read',
      'outcomes:read',
      'jobs:read',
      'jobs:write',
      'execution:write',
      'organizations:read',
    ]);
    expect([...PRIVATE_ROUTE_FAMILIES_MIRROR]).toEqual([
      'internal:organizations:write',
      'internal:jobs:write',
      'internal:usage:read',
    ]);
    expect(ROUTE_FAMILIES_MIRROR).toHaveLength(12);
  });

  it('the usage-record guard accepts the boundary\'s shape and rejects corruptions', () => {
    expect(isUsageRecordMirror(record('jobs:write', T0))).toBe(true);
    expect(isUsageRecordMirror({ ...record('jobs:write', T0), usageId: 'usu:xyz' })).toBe(false);
    expect(isUsageRecordMirror({ ...record('jobs:write', T0), status: 200.5 })).toBe(false);
    expect(isUsageRecordMirror({ ...record('jobs:write', T0), at: T0 + 0.5 })).toBe(false);
    expect(USAGE_ID_PATTERN_MIRROR.test('usu:0123abcd')).toBe(true);
    expect(USAGE_ID_PATTERN_MIRROR.test('usu:012abc')).toBe(false);
  });

  it('the SDK error-family mirror is the REAL vocabulary', () => {
    expect([...SDK_ERROR_FAMILIES_MIRROR]).toEqual([
      'auth',
      'permission',
      'tenant',
      'rate-limit',
      'validation',
      'conflict',
      'unavailable',
      'not-found',
      'version',
    ]);
    expect(isSdkErrorFamilyMirror('rate-limit')).toBe(true);
    expect(isSdkErrorFamilyMirror('retry')).toBe(false);
    expect(isPublicRouteFamilyMirror('jobs:write')).toBe(true);
    expect(isPrivateRouteFamilyMirror('internal:usage:read')).toBe(true);
    expect(isRouteFamilyMirror('internal:other')).toBe(false);
  });
});

describe('usageWindowCount (the L4 window fold)', () => {
  it('counts only the tenant\'s, only the route\'s, only the window\'s facts', () => {
    const usage: readonly UsageRecordMirror[] = [
      record('jobs:write', T0),
      record('jobs:write', T0 + 100),
      record('jobs:write', T0 + 1000), // outside the 1000ms window at T0+1000
      record('jobs:read', T0 + 100),
      record('jobs:write', T0 + 100, 'tenant-other'), // another tenant's facts never count
      record('jobs:write', T0 + 2001), // the future never counts
    ];
    expect(usageWindowCount(usage, TENANT as TenantId, 'jobs:write', ['jobs:write'], (T0 + 1000) as TimestampMs, 1000)).toBe(2);
    expect(usageWindowCount(usage, TENANT as TenantId, 'jobs:read', ['jobs:read'], (T0 + 1000) as TimestampMs, 1000)).toBe(1);
    expect(usageWindowCount(usage, TENANT as TenantId, 'jobs:write', ['jobs:write'], (T0 + 2001) as TimestampMs, 1000)).toBe(1);
  });

  it('a route outside the scope is not counted even when the route string matches', () => {
    const usage: readonly UsageRecordMirror[] = [record('jobs:write', T0)];
    expect(usageWindowCount(usage, TENANT as TenantId, 'jobs:write', ['jobs:read'], T0 as TimestampMs, 1000)).toBe(0);
  });
});

describe('usageQuotaDecision (the R41 enforcement fold)', () => {
  it('allows while headroom exists and grounds the verdict in the covering grant', () => {
    const usage: readonly UsageRecordMirror[] = [
      record('jobs:write', T0),
      record('jobs:write', T0 + 100),
    ];
    const verdict = usageQuotaDecision(usage, GRANTS, { tenant: TENANT as TenantId, route: 'jobs:write', at: (T0 + 200) as TimestampMs });
    expect(verdict.allowed).toBe(true);
    expect(verdict.grantId).toBe('eg:0000000000000101');
    expect(verdict.counted).toBe(2);
    expect(verdict.maxRequests).toBe(3);
    expect(verdict.code).toBeNull();
  });

  it('denies at the exact boundary (counted == maxRequests) with the typed usage_denied', () => {
    const usage: readonly UsageRecordMirror[] = [
      record('jobs:write', T0),
      record('jobs:write', T0 + 100),
      record('jobs:write', T0 + 200),
    ];
    const verdict = usageQuotaDecision(usage, GRANTS, { tenant: TENANT as TenantId, route: 'jobs:write', at: (T0 + 300) as TimestampMs });
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe('usage_denied');
    expect(verdict.counted).toBe(3);
    expect(verdict.maxRequests).toBe(3);
  });

  it('old facts outside the window free the allowance (the window is the gate, not the history)', () => {
    const usage: readonly UsageRecordMirror[] = [
      record('jobs:write', T0),
      record('jobs:write', T0 + 100),
      record('jobs:write', T0 + 200),
    ];
    const verdict = usageQuotaDecision(usage, GRANTS, { tenant: TENANT as TenantId, route: 'jobs:write', at: (T0 + 1500) as TimestampMs });
    expect(verdict.allowed).toBe(true);
    expect(verdict.counted).toBe(0);
  });

  it('a route covered by NO grant is DENIED (closed world — nothing is consumable without an entitlement)', () => {
    const verdict = usageQuotaDecision([], GRANTS, { tenant: TENANT as TenantId, route: 'execution:write', at: T0 as TimestampMs });
    expect(verdict.allowed).toBe(false);
    expect(verdict.grantId).toBeNull();
    expect(verdict.maxRequests).toBeNull();
    expect(verdict.code).toBe('usage_denied');
  });

  it('another tenant\'s accumulated usage never denies this tenant', () => {
    const usage: readonly UsageRecordMirror[] = [
      record('jobs:write', T0, 'tenant-other'),
      record('jobs:write', T0 + 100, 'tenant-other'),
      record('jobs:write', T0 + 200, 'tenant-other'),
    ];
    const verdict = usageQuotaDecision(usage, GRANTS, { tenant: TENANT as TenantId, route: 'jobs:write', at: (T0 + 300) as TimestampMs });
    expect(verdict.allowed).toBe(true);
    expect(verdict.counted).toBe(0);
  });
});
