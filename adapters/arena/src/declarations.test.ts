/**
 * @tradrl/adapter-arena — entitlement tiers, rate quota and health
 * tests (behavioral: the declared tiers and the refusal law; the
 * declarative rate quotas and schedule enforcement — positive AND
 * negative paths; the health threshold declaration and the pure
 * assessment).
 */

import { describe, expect, it } from 'vitest';

import {
  ARENA_ENGAGEMENT_ENTITLEMENT,
  ARENA_CATALOG_ENTITLEMENT,
  ARENA_ENTITLEMENT,
  ARENA_RATE_QUOTA,
  ARENA_RATE_QUOTA_SET,
  enforceArenaRateQuota,
  ARENA_HEALTH_THRESHOLDS,
  isEntitlementEnvelope,
  validateEntitlementEnvelope,
  validateHealthThresholds,
  assessHealth,
  assessScheduleFeasibility,
  entitlementRefOf,
  arenaProtocolCodeOf,
  isRateQuotaEnvelope,
  type TimestampMs,
} from './index';

const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = 1_731_000_000_000;

describe('the entitlement tiers (the licensing law)', () => {
  it('the ENGAGEMENT tier is a valid, frozen RESTRICTED envelope (contracted expertise, terms ref)', () => {
    expect(isEntitlementEnvelope(ARENA_ENGAGEMENT_ENTITLEMENT)).toBe(true);
    expect(validateEntitlementEnvelope(ARENA_ENGAGEMENT_ENTITLEMENT)).toEqual([]);
    expect(ARENA_ENGAGEMENT_ENTITLEMENT.access_class).toBe('restricted');
    expect([...ARENA_ENGAGEMENT_ENTITLEMENT.constraints]).toContain('arena-engagement-terms');
    expect(ARENA_ENGAGEMENT_ENTITLEMENT.terms_ref).toBe('arena-engagement-terms-v1');
    expect(Object.isFrozen(ARENA_ENGAGEMENT_ENTITLEMENT)).toBe(true);
  });

  it('the CATALOG tier is a valid, frozen PUBLIC envelope (the published catalog carries no licensed content)', () => {
    expect(validateEntitlementEnvelope(ARENA_CATALOG_ENTITLEMENT)).toEqual([]);
    expect(ARENA_CATALOG_ENTITLEMENT.access_class).toBe('public');
    expect(ARENA_CATALOG_ENTITLEMENT.terms_ref).toBeNull();
    expect(Object.isFrozen(ARENA_CATALOG_ENTITLEMENT)).toBe(true);
  });

  it('the default declaration is the engagement tier (the primary product)', () => {
    expect(ARENA_ENTITLEMENT).toBe(ARENA_ENGAGEMENT_ENTITLEMENT);
    const ref = entitlementRefOf(ARENA_ENTITLEMENT);
    expect(ref.entitlement_id).toBe('ent-arena-engagement');
    expect([...ref.constraints]).toEqual([...ARENA_ENGAGEMENT_ENTITLEMENT.constraints]);
  });

  it('collect-all rejects malformed envelopes', () => {
    expect(validateEntitlementEnvelope({ entitlement_id: '', access_class: 'public', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'maybe', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'restricted', constraints: ['a', 'a'], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'restricted', constraints: [] }).length).toBeGreaterThan(0);
  });
});

describe('declarative rate quotas (the documented wire limits)', () => {
  it('declares the documented limits as validated, frozen envelopes', () => {
    for (const quota of ARENA_RATE_QUOTA_SET) {
      expect(isRateQuotaEnvelope(quota)).toBe(true);
      expect(Object.isFrozen(quota)).toBe(true);
    }
    expect(ARENA_RATE_QUOTA.limit).toBe(10);
    expect(ARENA_RATE_QUOTA.window_ms).toBe(60_000);
    expect(ARENA_RATE_QUOTA.policy).toBe('rolling-window');
    expect(ARENA_RATE_QUOTA.scope).toBe('request-frames-per-connection');
    expect(ARENA_RATE_QUOTA_SET.length).toBe(3);
  });

  it('a feasible schedule passes (the positive path)', () => {
    const timeline = [0, 6_000, 12_000, 18_000, 24_000, 30_000, 36_000, 42_000, 48_000, 54_000, 60_000];
    const result = enforceArenaRateQuota(ARENA_RATE_QUOTA, timeline);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feasible).toBe(true);
      expect(result.value.violations).toEqual([]);
      expect(result.value.assessed).toBe(11);
    }
  });

  it('an infeasible schedule is a typed protocol error (the negative path)', () => {
    const timeline = [0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 10_000];
    const result = enforceArenaRateQuota(ARENA_RATE_QUOTA, timeline);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(arenaProtocolCodeOf(result.error)).toBe('rate_quota_exceeded');
      expect(result.error.message).toContain('request-frames-per-connection');
    }
  });

  it('exactly at the limit passes; one over fails (boundary exactness)', () => {
    const atLimit = enforceArenaRateQuota(ARENA_RATE_QUOTA, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(atLimit.ok).toBe(true);
    if (atLimit.ok) expect(atLimit.value.feasible).toBe(true);

    const overLimit = enforceArenaRateQuota(ARENA_RATE_QUOTA, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(overLimit.ok).toBe(false);
  });

  it('a fixed-window envelope resets at the epoch-aligned boundary (the daily catalog budget)', () => {
    const quota = { limit: 2, window_ms: 86_400_000, policy: 'fixed-window' as const, scope: 'test-daily' };
    const straddling = enforceArenaRateQuota(quota, [86_399_999, 86_400_000, 86_400_001]);
    expect(straddling.ok).toBe(true);
    const inside = enforceArenaRateQuota(quota, [100, 200, 300]);
    expect(inside.ok).toBe(false);
  });

  it('an invalid timeline is a typed protocol error (not a crash)', () => {
    const decreasing = enforceArenaRateQuota(ARENA_RATE_QUOTA, [2_000, 1_000]);
    expect(decreasing.ok).toBe(false);
    if (!decreasing.ok) expect(decreasing.error.code).toBe('invalid_configuration');

    const negative = enforceArenaRateQuota(ARENA_RATE_QUOTA, [-5]);
    expect(negative.ok).toBe(false);
  });

  it('an undeclared envelope is a typed protocol error', () => {
    const result = enforceArenaRateQuota({ limit: 5 }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });

  it('the feasibility report is frozen (immutable evidence)', () => {
    const result = enforceArenaRateQuota(ARENA_RATE_QUOTA, [0]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it('the pure feasibility assessment (mirror behavior)', () => {
    const quota = { limit: 2, window_ms: 1_000, policy: 'rolling-window' as const, scope: 't' };
    const report = assessScheduleFeasibility(quota, [0, 999, 1_000, 1_998]);
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.feasible).toBe(false);
      expect(report.value.violations.length).toBeGreaterThan(0);
    }
  });
});

describe('health thresholds (the liveness declaration)', () => {
  it('declares a valid, frozen envelope for the delayed human-expertise cadence', () => {
    const validation = validateHealthThresholds(ARENA_HEALTH_THRESHOLDS);
    expect(validation.ok).toBe(true);
    expect(ARENA_HEALTH_THRESHOLDS.heartbeat_interval_ms).toBe(600_000);
    expect(ARENA_HEALTH_THRESHOLDS.staleness_limit_ms).toBe(14_400_000);
    expect(Object.isFrozen(ARENA_HEALTH_THRESHOLDS)).toBe(true);
  });

  it('assesses liveness at an injected instant (fresh, missed beats, stale)', () => {
    const at = (value: number): TimestampMs => value as TimestampMs;
    const fresh = assessHealth(ARENA_HEALTH_THRESHOLDS, at(AT0), at(AT0 + 100_000));
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.value.stale).toBe(false);
      expect(fresh.value.missed_beats).toBe(0);
    }
    const stale = assessHealth(ARENA_HEALTH_THRESHOLDS, at(AT0), at(AT0 + 15_000_000));
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect(stale.value.stale).toBe(true);
      expect(stale.value.missed_beats).toBe(25);
      expect(stale.value.elapsed_since_last_ms).toBe(15_000_000);
    }
    const noMessage = assessHealth(ARENA_HEALTH_THRESHOLDS, null, at(AT0));
    expect(noMessage.ok).toBe(true);
    if (noMessage.ok) {
      expect(noMessage.value.stale).toBe(false);
      expect(noMessage.value.last_message_at).toBeNull();
    }
  });

  it('assessing the past is a typed error (health is forward-only)', () => {
    const result = assessHealth(ARENA_HEALTH_THRESHOLDS, ms(AT0), ms(AT0 - 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });
});
