/**
 * @tradrl/adapter-oms-ems — entitlement, rate quota and health tests.
 *
 * Behavioral: the restricted order-state entitlement declaration and
 * the refusal law; the declarative rate quotas and schedule enforcement
 * (positive AND negative paths — criterion 8); the health threshold
 * declarations and the pure assessment.
 */

import { describe, expect, it } from 'vitest';

import {
  OMS_EMS_ENTITLEMENT,
  OMS_EMS_RATE_QUOTA,
  OMS_EMS_RATE_QUOTA_SET,
  enforceOmsEmsRateQuota,
  OMS_EMS_HEALTH_THRESHOLDS,
  isEntitlementEnvelope,
  isRateQuotaEnvelope,
  validateEntitlementEnvelope,
  validateHealthThresholds,
  assessHealth,
  entitlementRefOf,
  omsEmsProtocolCodeOf,
  type TimestampMs,
} from './index';

describe('OMS_EMS_ENTITLEMENT (the restricted execution-data declaration)', () => {
  it('is a valid, frozen restricted-access envelope', () => {
    expect(isEntitlementEnvelope(OMS_EMS_ENTITLEMENT)).toBe(true);
    expect(validateEntitlementEnvelope(OMS_EMS_ENTITLEMENT)).toEqual([]);
    expect(OMS_EMS_ENTITLEMENT.access_class).toBe('restricted');
    expect(Object.isFrozen(OMS_EMS_ENTITLEMENT)).toBe(true);
  });

  it('the derived ref carries the id and constraints verbatim (L9 self-describing)', () => {
    const ref = entitlementRefOf(OMS_EMS_ENTITLEMENT);
    expect(ref.entitlement_id).toBe('ent-oms-ems-order-state-restricted');
    expect([...ref.constraints]).toEqual([...OMS_EMS_ENTITLEMENT.constraints]);
  });

  it('collect-all rejects malformed envelopes', () => {
    expect(validateEntitlementEnvelope({ entitlement_id: '', access_class: 'restricted', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'secret', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'restricted', constraints: ['a', 'a'], terms_ref: null }).length).toBeGreaterThan(0);
  });
});

describe('declarative rate quotas (criterion 8)', () => {
  it('declares the documented limits as validated, frozen envelopes', () => {
    for (const quota of OMS_EMS_RATE_QUOTA_SET) {
      expect(isRateQuotaEnvelope(quota)).toBe(true);
      expect(Object.isFrozen(quota)).toBe(true);
    }
    expect(OMS_EMS_RATE_QUOTA.limit).toBe(20);
    expect(OMS_EMS_RATE_QUOTA.window_ms).toBe(1_000);
    expect(OMS_EMS_RATE_QUOTA.policy).toBe('rolling-window');
    expect(OMS_EMS_RATE_QUOTA.scope).toBe('session-routing-instructions');
    expect(OMS_EMS_RATE_QUOTA_SET.length).toBe(3);
  });

  it('a feasible schedule passes (the positive path)', () => {
    // Twenty-one routing instructions, but never more than twenty within any rolling second.
    const timeline = Array.from({ length: 21 }, (_, index) => index * 50);
    const result = enforceOmsEmsRateQuota(OMS_EMS_RATE_QUOTA, timeline);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feasible).toBe(true);
      expect(result.value.violations).toEqual([]);
      expect(result.value.assessed).toBe(21);
    }
  });

  it('an infeasible schedule is a typed protocol error (the negative path)', () => {
    // Twenty-one instructions inside one rolling second exceed the declared limit of 20.
    const timeline = Array.from({ length: 21 }, (_, index) => index * 45);
    const result = enforceOmsEmsRateQuota(OMS_EMS_RATE_QUOTA, timeline);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(omsEmsProtocolCodeOf(result.error)).toBe('rate_quota_exceeded');
      expect(result.error.message).toContain('session-routing-instructions');
    }
  });

  it('the fixed-window quota enforces its epoch-aligned windows', () => {
    const stateQuota = OMS_EMS_RATE_QUOTA_SET[2]; // 10 per 10s, fixed
    // Eleven registrations inside one 10-second window.
    const infeasible = Array.from({ length: 11 }, (_, index) => 1_000 + index * 100);
    const result = enforceOmsEmsRateQuota(stateQuota, infeasible);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(omsEmsProtocolCodeOf(result.error)).toBe('rate_quota_exceeded');

    // The same eleven registrations spread across two windows are feasible.
    const feasible = Array.from({ length: 11 }, (_, index) => (index < 6 ? 1_000 + index * 100 : 10_500 + (index - 6) * 100));
    const spread = enforceOmsEmsRateQuota(stateQuota, feasible);
    expect(spread.ok).toBe(true);
  });

  it('a non-envelope argument is a typed neutral configuration error', () => {
    const result = enforceOmsEmsRateQuota({ limit: 1 }, [0, 1]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(result.error.code).toBe('invalid_configuration');
    }
  });

  it('a decreasing timeline is a typed neutral configuration error', () => {
    const result = enforceOmsEmsRateQuota(OMS_EMS_RATE_QUOTA, [1_000, 999]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });
});

describe('OMS_EMS_HEALTH_THRESHOLDS (the declared liveness envelope)', () => {
  it('declares validated, frozen thresholds', () => {
    expect(validateHealthThresholds(OMS_EMS_HEALTH_THRESHOLDS).ok).toBe(true);
    expect(Object.isFrozen(OMS_EMS_HEALTH_THRESHOLDS)).toBe(true);
    expect(OMS_EMS_HEALTH_THRESHOLDS.heartbeat_interval_ms).toBe(5_000);
    expect(OMS_EMS_HEALTH_THRESHOLDS.staleness_limit_ms).toBe(30_000);
  });

  it('the assessment is pure over the injected instant (no wall clock)', () => {
    const last = 1_000 as TimestampMs;
    const fresh = assessHealth(OMS_EMS_HEALTH_THRESHOLDS, last, 4_000 as TimestampMs);
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(fresh.value.stale).toBe(false);
    const stale = assessHealth(OMS_EMS_HEALTH_THRESHOLDS, last, 40_000 as TimestampMs);
    expect(stale.ok).toBe(true);
    if (stale.ok) expect(stale.value.stale).toBe(true);
  });
});
