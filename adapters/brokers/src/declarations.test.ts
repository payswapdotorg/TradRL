/**
 * @tradrl/adapter-brokers — entitlement, rate quota and health tests.
 *
 * Behavioral: the restricted execution-data entitlement declaration and
 * the refusal law; the declarative rate quotas and schedule enforcement
 * (positive AND negative paths — criterion 8); the health threshold
 * declarations and the pure assessment.
 */

import { describe, expect, it } from 'vitest';

import {
  BROKER_ENTITLEMENT,
  BROKER_RATE_QUOTA,
  BROKER_RATE_QUOTA_SET,
  enforceBrokerRateQuota,
  BROKER_HEALTH_THRESHOLDS,
  isEntitlementEnvelope,
  isRateQuotaEnvelope,
  validateEntitlementEnvelope,
  validateHealthThresholds,
  assessHealth,
  entitlementRefOf,
  brokerProtocolCodeOf,
  type TimestampMs,
} from './index';

describe('BROKER_ENTITLEMENT (the restricted execution-data declaration)', () => {
  it('is a valid, frozen restricted-access envelope', () => {
    expect(isEntitlementEnvelope(BROKER_ENTITLEMENT)).toBe(true);
    expect(validateEntitlementEnvelope(BROKER_ENTITLEMENT)).toEqual([]);
    expect(BROKER_ENTITLEMENT.access_class).toBe('restricted');
    expect(Object.isFrozen(BROKER_ENTITLEMENT)).toBe(true);
  });

  it('the derived ref carries the id and constraints verbatim (L9 self-describing)', () => {
    const ref = entitlementRefOf(BROKER_ENTITLEMENT);
    expect(ref.entitlement_id).toBe('ent-broker-execution-restricted');
    expect([...ref.constraints]).toEqual([...BROKER_ENTITLEMENT.constraints]);
  });

  it('collect-all rejects malformed envelopes', () => {
    expect(validateEntitlementEnvelope({ entitlement_id: '', access_class: 'restricted', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'secret', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'restricted', constraints: ['a', 'a'], terms_ref: null }).length).toBeGreaterThan(0);
  });
});

describe('declarative rate quotas (criterion 8)', () => {
  it('declares the documented limits as validated, frozen envelopes', () => {
    for (const quota of BROKER_RATE_QUOTA_SET) {
      expect(isRateQuotaEnvelope(quota)).toBe(true);
      expect(Object.isFrozen(quota)).toBe(true);
    }
    expect(BROKER_RATE_QUOTA.limit).toBe(10);
    expect(BROKER_RATE_QUOTA.window_ms).toBe(1_000);
    expect(BROKER_RATE_QUOTA.policy).toBe('rolling-window');
    expect(BROKER_RATE_QUOTA.scope).toBe('session-order-placement');
    expect(BROKER_RATE_QUOTA_SET.length).toBe(3);
  });

  it('a feasible schedule passes (the positive path)', () => {
    // Eleven order placements, but never more than ten within any rolling second.
    const timeline = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000];
    const result = enforceBrokerRateQuota(BROKER_RATE_QUOTA, timeline);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feasible).toBe(true);
      expect(result.value.violations).toEqual([]);
      expect(result.value.assessed).toBe(11);
    }
  });

  it('an infeasible schedule is a typed protocol error (the negative path)', () => {
    // Eleven placements inside one rolling second exceed the declared limit of 10.
    const timeline = [0, 90, 180, 270, 360, 450, 540, 630, 720, 810, 900];
    const result = enforceBrokerRateQuota(BROKER_RATE_QUOTA, timeline);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(brokerProtocolCodeOf(result.error)).toBe('rate_quota_exceeded');
      expect(result.error.message).toContain('session-order-placement');
    }
  });

  it('the fixed-window quota enforces its epoch-aligned windows', () => {
    const reportQuota = BROKER_RATE_QUOTA_SET[2]; // 20 per 10s, fixed
    // Twenty-one registrations inside one 10-second window.
    const infeasible = Array.from({ length: 21 }, (_, index) => 1_000 + index * 100);
    const result = enforceBrokerRateQuota(reportQuota, infeasible);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(brokerProtocolCodeOf(result.error)).toBe('rate_quota_exceeded');

    // The same twenty-one registrations spread across two windows are feasible.
    const feasible = Array.from({ length: 21 }, (_, index) => (index < 11 ? 1_000 + index * 100 : 10_500 + (index - 11) * 100));
    const spread = enforceBrokerRateQuota(reportQuota, feasible);
    expect(spread.ok).toBe(true);
  });

  it('a non-envelope argument is a typed neutral configuration error', () => {
    const result = enforceBrokerRateQuota({ limit: 1 }, [0, 1]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(result.error.code).toBe('invalid_configuration');
    }
  });

  it('a decreasing timeline is a typed neutral configuration error', () => {
    const result = enforceBrokerRateQuota(BROKER_RATE_QUOTA, [1_000, 999]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });
});

describe('BROKER_HEALTH_THRESHOLDS (the declared liveness envelope)', () => {
  it('declares validated, frozen thresholds', () => {
    expect(validateHealthThresholds(BROKER_HEALTH_THRESHOLDS).ok).toBe(true);
    expect(Object.isFrozen(BROKER_HEALTH_THRESHOLDS)).toBe(true);
    expect(BROKER_HEALTH_THRESHOLDS.heartbeat_interval_ms).toBe(5_000);
    expect(BROKER_HEALTH_THRESHOLDS.staleness_limit_ms).toBe(30_000);
  });

  it('the assessment is pure over the injected instant (no wall clock)', () => {
    const last = 1_000 as TimestampMs;
    const fresh = assessHealth(BROKER_HEALTH_THRESHOLDS, last, 4_000 as TimestampMs);
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(fresh.value.stale).toBe(false);
    const stale = assessHealth(BROKER_HEALTH_THRESHOLDS, last, 40_000 as TimestampMs);
    expect(stale.ok).toBe(true);
    if (stale.ok) expect(stale.value.stale).toBe(true);
  });
});
