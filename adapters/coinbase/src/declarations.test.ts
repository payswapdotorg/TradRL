/**
 * @tradrl/adapter-coinbase — entitlement, rate quota and health tests.
 *
 * Behavioral: the public-data entitlement declaration and the refusal
 * law; the declarative rate quotas and schedule enforcement (positive AND
 * negative paths — criterion 8); the health threshold declarations and
 * the pure assessment.
 */

import { describe, expect, it } from 'vitest';

import {
  COINBASE_ENTITLEMENT,
  COINBASE_RATE_QUOTA,
  COINBASE_RATE_QUOTA_SET,
  enforceCoinbaseRateQuota,
  COINBASE_HEALTH_THRESHOLDS,
  isEntitlementEnvelope,
  isRateQuotaEnvelope,
  validateEntitlementEnvelope,
  validateHealthThresholds,
  assessHealth,
  assessScheduleFeasibility,
  entitlementRefOf,
  coinbaseProtocolCodeOf,
  type TimestampMs,
} from './index';

describe('COINBASE_ENTITLEMENT (the public market-data declaration)', () => {
  it('is a valid, frozen public-data envelope', () => {
    expect(isEntitlementEnvelope(COINBASE_ENTITLEMENT)).toBe(true);
    expect(validateEntitlementEnvelope(COINBASE_ENTITLEMENT)).toEqual([]);
    expect(COINBASE_ENTITLEMENT.access_class).toBe('public');
    expect(Object.isFrozen(COINBASE_ENTITLEMENT)).toBe(true);
  });

  it('the derived ref carries the id and constraints verbatim (L9 self-describing)', () => {
    const ref = entitlementRefOf(COINBASE_ENTITLEMENT);
    expect(ref.entitlement_id).toBe('ent-coinbase-spot-public');
    expect([...ref.constraints]).toEqual([...COINBASE_ENTITLEMENT.constraints]);
  });

  it('collect-all rejects malformed envelopes', () => {
    expect(validateEntitlementEnvelope({ entitlement_id: '', access_class: 'public', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'vip', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'restricted', constraints: [1], terms_ref: null }).length).toBeGreaterThan(0);
  });
});

describe('declarative rate quotas (criterion 8)', () => {
  it('declares the documented limits as validated, frozen envelopes', () => {
    for (const quota of COINBASE_RATE_QUOTA_SET) {
      expect(isRateQuotaEnvelope(quota)).toBe(true);
      expect(Object.isFrozen(quota)).toBe(true);
    }
    expect(COINBASE_RATE_QUOTA.limit).toBe(10);
    expect(COINBASE_RATE_QUOTA.window_ms).toBe(1_000);
    expect(COINBASE_RATE_QUOTA.policy).toBe('rolling-window');
    expect(COINBASE_RATE_QUOTA.scope).toBe('ip-rest-requests');
    expect(COINBASE_RATE_QUOTA_SET.length).toBe(3);
  });

  it('a feasible schedule passes (the positive path)', () => {
    // Ten requests, but never more than ten within any rolling second... spread out.
    const timeline = [0, 120, 240, 360, 480, 600, 720, 840, 960, 1_050];
    const result = enforceCoinbaseRateQuota(COINBASE_RATE_QUOTA, timeline);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feasible).toBe(true);
      expect(result.value.violations).toEqual([]);
      expect(result.value.assessed).toBe(10);
    }
  });

  it('an infeasible schedule is a typed protocol error (the negative path)', () => {
    // Eleven requests inside one rolling second exceed the declared limit of 10.
    const timeline = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
    const result = enforceCoinbaseRateQuota(COINBASE_RATE_QUOTA, timeline);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(coinbaseProtocolCodeOf(result.error)).toBe('rate_quota_exceeded');
      expect(result.error.message).toContain('ip-rest-requests');
    }
  });

  it('exactly at the limit passes; one over fails (boundary exactness)', () => {
    const atLimit = enforceCoinbaseRateQuota(COINBASE_RATE_QUOTA, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(atLimit.ok).toBe(true);
    if (atLimit.ok) expect(atLimit.value.feasible).toBe(true);

    const overLimit = enforceCoinbaseRateQuota(COINBASE_RATE_QUOTA, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(overLimit.ok).toBe(false);
  });

  it('a fixed-window envelope resets at the epoch-aligned boundary', () => {
    const quota = { limit: 2, window_ms: 10_000, policy: 'fixed-window' as const, scope: 'test' };
    const straddling = enforceCoinbaseRateQuota(quota, [9_999, 10_000, 10_001]);
    expect(straddling.ok).toBe(true);
    const inside = enforceCoinbaseRateQuota(quota, [100, 200, 300]);
    expect(inside.ok).toBe(false);
  });

  it('an invalid timeline is a typed protocol error (not a crash)', () => {
    const decreasing = enforceCoinbaseRateQuota(COINBASE_RATE_QUOTA, [2_000, 1_000]);
    expect(decreasing.ok).toBe(false);
    if (!decreasing.ok) expect(decreasing.error.code).toBe('invalid_configuration');
  });

  it('an undeclared envelope is a typed protocol error', () => {
    const result = enforceCoinbaseRateQuota({ limit: -1 }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });

  it('the feasibility report is frozen (immutable evidence)', () => {
    const result = enforceCoinbaseRateQuota(COINBASE_RATE_QUOTA, [0]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('the pure feasibility assessment mirror behaves identically (rolling windows)', () => {
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
  it('declares a valid, frozen heartbeat envelope', () => {
    const validation = validateHealthThresholds(COINBASE_HEALTH_THRESHOLDS);
    expect(validation.ok).toBe(true);
    expect(COINBASE_HEALTH_THRESHOLDS.heartbeat_interval_ms).toBe(1_000);
    expect(COINBASE_HEALTH_THRESHOLDS.staleness_limit_ms).toBe(3_000);
    expect(Object.isFrozen(COINBASE_HEALTH_THRESHOLDS)).toBe(true);
  });

  it('assesses liveness at an injected instant (fresh, missed beats, stale)', () => {
    const at = (value: number): TimestampMs => value as TimestampMs;
    const fresh = assessHealth(COINBASE_HEALTH_THRESHOLDS, at(10_000), at(10_500));
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.value.stale).toBe(false);
      expect(fresh.value.missed_beats).toBe(0);
    }
    const stale = assessHealth(COINBASE_HEALTH_THRESHOLDS, at(10_000), at(20_000));
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect(stale.value.stale).toBe(true);
      expect(stale.value.missed_beats).toBe(10);
    }
    const noMessage = assessHealth(COINBASE_HEALTH_THRESHOLDS, null, at(10_000));
    expect(noMessage.ok).toBe(true);
    if (noMessage.ok) expect(noMessage.value.last_message_at).toBeNull();
  });

  it('assessing the past is a typed error (health is forward-only)', () => {
    const result = assessHealth(COINBASE_HEALTH_THRESHOLDS, 10_000 as TimestampMs, 9_000 as TimestampMs);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });
});
