/**
 * @tradrl/adapter-binance — entitlement, rate quota and health tests.
 *
 * Behavioral: the public-data entitlement declaration and the refusal
 * law; the declarative rate quotas and schedule enforcement (positive AND
 * negative paths — criterion 8); the health threshold declarations and
 * the pure assessment.
 */

import { describe, expect, it } from 'vitest';

import {
  BINANCE_ENTITLEMENT,
  BINANCE_RATE_QUOTA,
  BINANCE_RATE_QUOTA_SET,
  enforceBinanceRateQuota,
  BINANCE_HEALTH_THRESHOLDS,
  isEntitlementEnvelope,
  isRateQuotaEnvelope,
  validateEntitlementEnvelope,
  validateHealthThresholds,
  assessHealth,
  assessScheduleFeasibility,
  entitlementRefOf,
  binanceProtocolCodeOf,
  type TimestampMs,
} from './index';

describe('BINANCE_ENTITLEMENT (the public market-data declaration)', () => {
  it('is a valid, frozen public-data envelope', () => {
    expect(isEntitlementEnvelope(BINANCE_ENTITLEMENT)).toBe(true);
    expect(validateEntitlementEnvelope(BINANCE_ENTITLEMENT)).toEqual([]);
    expect(BINANCE_ENTITLEMENT.access_class).toBe('public');
    expect(Object.isFrozen(BINANCE_ENTITLEMENT)).toBe(true);
  });

  it('the derived ref carries the id and constraints verbatim (L9 self-describing)', () => {
    const ref = entitlementRefOf(BINANCE_ENTITLEMENT);
    expect(ref.entitlement_id).toBe('ent-binance-spot-public');
    expect([...ref.constraints]).toEqual([...BINANCE_ENTITLEMENT.constraints]);
  });

  it('collect-all rejects malformed envelopes', () => {
    expect(validateEntitlementEnvelope({ entitlement_id: '', access_class: 'public', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'secret', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'public', constraints: ['a', 'a'], terms_ref: null }).length).toBeGreaterThan(0);
  });
});

describe('declarative rate quotas (criterion 8)', () => {
  it('declares the documented limits as validated, frozen envelopes', () => {
    for (const quota of BINANCE_RATE_QUOTA_SET) {
      expect(isRateQuotaEnvelope(quota)).toBe(true);
      expect(Object.isFrozen(quota)).toBe(true);
    }
    expect(BINANCE_RATE_QUOTA.limit).toBe(5);
    expect(BINANCE_RATE_QUOTA.window_ms).toBe(1_000);
    expect(BINANCE_RATE_QUOTA.policy).toBe('rolling-window');
    expect(BINANCE_RATE_QUOTA.scope).toBe('connection-inbound-messages');
    expect(BINANCE_RATE_QUOTA_SET.length).toBe(3);
  });

  it('a feasible schedule passes (the positive path)', () => {
    // Six subscribe frames, but never more than five within any rolling second.
    const timeline = [0, 250, 500, 750, 1_000, 1_250];
    const result = enforceBinanceRateQuota(BINANCE_RATE_QUOTA, timeline);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feasible).toBe(true);
      expect(result.value.violations).toEqual([]);
      expect(result.value.assessed).toBe(6);
    }
  });

  it('an infeasible schedule is a typed protocol error (the negative path)', () => {
    // Six frames inside one rolling second exceed the declared limit of 5.
    const timeline = [0, 100, 200, 300, 400, 500];
    const result = enforceBinanceRateQuota(BINANCE_RATE_QUOTA, timeline);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(binanceProtocolCodeOf(result.error)).toBe('rate_quota_exceeded');
      expect(result.error.message).toContain('connection-inbound-messages');
    }
  });

  it('exactly at the limit passes; one over fails (boundary exactness)', () => {
    const atLimit = enforceBinanceRateQuota(BINANCE_RATE_QUOTA, [0, 1, 2, 3, 4]);
    expect(atLimit.ok).toBe(true);
    if (atLimit.ok) expect(atLimit.value.feasible).toBe(true);

    const overLimit = enforceBinanceRateQuota(BINANCE_RATE_QUOTA, [0, 1, 2, 3, 4, 5]);
    expect(overLimit.ok).toBe(false);
  });

  it('a fixed-window envelope resets at the epoch-aligned boundary', () => {
    const quota = { limit: 2, window_ms: 1_000, policy: 'fixed-window' as const, scope: 'test' };
    const straddling = [999, 1_000, 1_001]; // two buckets, not three-in-one
    const result = enforceBinanceRateQuota(quota, straddling);
    expect(result.ok).toBe(true);
    const inside = enforceBinanceRateQuota(quota, [100, 200, 300]);
    expect(inside.ok).toBe(false);
  });

  it('an invalid timeline is a typed protocol error (not a crash)', () => {
    const decreasing = enforceBinanceRateQuota(BINANCE_RATE_QUOTA, [2_000, 1_000]);
    expect(decreasing.ok).toBe(false);
    if (!decreasing.ok) expect(decreasing.error.code).toBe('invalid_configuration');

    const negative = enforceBinanceRateQuota(BINANCE_RATE_QUOTA, [-5]);
    expect(negative.ok).toBe(false);
  });

  it('an undeclared envelope is a typed protocol error', () => {
    const result = enforceBinanceRateQuota({ limit: 0 }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });

  it('the feasibility report is frozen (immutable evidence)', () => {
    const result = enforceBinanceRateQuota(BINANCE_RATE_QUOTA, [0]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });
});

describe('the pure feasibility assessment (mirror behavior)', () => {
  it('rolling-window: every sliding window of window_ms honors the limit', () => {
    const quota = { limit: 2, window_ms: 1_000, policy: 'rolling-window' as const, scope: 't' };
    const report = assessScheduleFeasibility(quota, [0, 999, 1_000, 1_998]);
    expect(report.ok).toBe(true);
    if (report.ok) {
      // [0, 999] and [999, 1998]... 999,1000,1998: window at 999 covers [999,1999): 999,1000,1998 = 3 > 2.
      expect(report.value.feasible).toBe(false);
      expect(report.value.violations.length).toBeGreaterThan(0);
    }
  });
});

describe('health thresholds (the liveness declaration)', () => {
  it('declares a valid, frozen heartbeat envelope', () => {
    const validation = validateHealthThresholds(BINANCE_HEALTH_THRESHOLDS);
    expect(validation.ok).toBe(true);
    expect(BINANCE_HEALTH_THRESHOLDS.heartbeat_interval_ms).toBe(1_000);
    expect(BINANCE_HEALTH_THRESHOLDS.staleness_limit_ms).toBe(3_000);
    expect(Object.isFrozen(BINANCE_HEALTH_THRESHOLDS)).toBe(true);
  });

  it('assesses liveness at an injected instant (fresh, missed beats, stale)', () => {
    const at = (value: number): TimestampMs => value as TimestampMs;
    const fresh = assessHealth(BINANCE_HEALTH_THRESHOLDS, at(10_000), at(10_500));
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.value.stale).toBe(false);
      expect(fresh.value.missed_beats).toBe(0);
    }
    const stale = assessHealth(BINANCE_HEALTH_THRESHOLDS, at(10_000), at(15_000));
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect(stale.value.stale).toBe(true);
      expect(stale.value.missed_beats).toBe(5);
      expect(stale.value.elapsed_since_last_ms).toBe(5_000);
    }
    const noMessage = assessHealth(BINANCE_HEALTH_THRESHOLDS, null, at(10_000));
    expect(noMessage.ok).toBe(true);
    if (noMessage.ok) {
      expect(noMessage.value.stale).toBe(false);
      expect(noMessage.value.last_message_at).toBeNull();
    }
  });

  it('assessing the past is a typed error (health is forward-only)', () => {
    const result = assessHealth(BINANCE_HEALTH_THRESHOLDS, 10_000 as TimestampMs, 9_000 as TimestampMs);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });
});
