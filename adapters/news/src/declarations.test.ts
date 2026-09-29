/**
 * @tradrl/adapter-news — entitlement tiers, the embargo quartet policy,
 * rate quota and health tests.
 *
 * Behavioral: the public + wire-service entitlement tiers and the refusal
 * law; the DECLARED embargo policy (validation, frozen, pure predicates —
 * criterion 9's "news embargo quartet policies"); the declarative rate
 * quotas and schedule enforcement (positive AND negative paths —
 * criterion 8); the health threshold declaration and the pure assessment.
 */

import { describe, expect, it } from 'vitest';

import {
  NEWS_PUBLIC_ENTITLEMENT,
  NEWS_WIRE_SERVICE_ENTITLEMENT,
  NEWS_ENTITLEMENT,
  NEWS_EMBARGO_POLICY,
  validateEmbargoPolicy,
  embargoLiftAt,
  isEmbargoedAt,
  NEWS_RATE_QUOTA,
  NEWS_RATE_QUOTA_SET,
  enforceNewsRateQuota,
  NEWS_HEALTH_THRESHOLDS,
  isEntitlementEnvelope,
  isRateQuotaEnvelope,
  validateEntitlementEnvelope,
  validateHealthThresholds,
  assessHealth,
  assessScheduleFeasibility,
  entitlementRefOf,
  newsProtocolCodeOf,
  type TimestampMs,
} from './index';

const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = 1_717_423_200_000;

describe('the entitlement tiers (public + wire service, as opaque refs)', () => {
  it('the PUBLIC tier is a valid, frozen public envelope', () => {
    expect(isEntitlementEnvelope(NEWS_PUBLIC_ENTITLEMENT)).toBe(true);
    expect(validateEntitlementEnvelope(NEWS_PUBLIC_ENTITLEMENT)).toEqual([]);
    expect(NEWS_PUBLIC_ENTITLEMENT.access_class).toBe('public');
    expect(NEWS_PUBLIC_ENTITLEMENT.entitlement_id).toBe('ent-news-public-headlines');
    expect(NEWS_PUBLIC_ENTITLEMENT.terms_ref).toBe('news-wire-a-public-terms');
    expect(Object.isFrozen(NEWS_PUBLIC_ENTITLEMENT)).toBe(true);
  });

  it('the WIRE SERVICE tier is a valid, frozen RESTRICTED envelope (licensed, terms ref)', () => {
    expect(validateEntitlementEnvelope(NEWS_WIRE_SERVICE_ENTITLEMENT)).toEqual([]);
    expect(NEWS_WIRE_SERVICE_ENTITLEMENT.access_class).toBe('restricted');
    expect([...NEWS_WIRE_SERVICE_ENTITLEMENT.constraints]).toContain('licensed-wire-service');
    expect([...NEWS_WIRE_SERVICE_ENTITLEMENT.constraints]).toContain('wire-tier-1');
    expect(NEWS_WIRE_SERVICE_ENTITLEMENT.terms_ref).toBe('news-wire-a-wire-terms');
    expect(Object.isFrozen(NEWS_WIRE_SERVICE_ENTITLEMENT)).toBe(true);
  });

  it('the default declaration is the licensed wire-service tier (the primary product)', () => {
    expect(NEWS_ENTITLEMENT).toBe(NEWS_WIRE_SERVICE_ENTITLEMENT);
    const ref = entitlementRefOf(NEWS_ENTITLEMENT);
    expect(ref.entitlement_id).toBe('ent-news-licensed-wire');
    expect([...ref.constraints]).toEqual([...NEWS_WIRE_SERVICE_ENTITLEMENT.constraints]);
  });

  it('collect-all rejects malformed envelopes', () => {
    expect(validateEntitlementEnvelope({ entitlement_id: '', access_class: 'public', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'maybe', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'restricted', constraints: ['a', 'a'], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'restricted', constraints: [] }).length).toBeGreaterThan(0);
  });
});

describe('NEWS_EMBARGO_POLICY (criterion 9 — the declared embargo quartet policy)', () => {
  it('is a valid, frozen declaration of the hold-and-release discipline', () => {
    expect(NEWS_EMBARGO_POLICY.basis).toBe('embargo-field');
    expect(NEWS_EMBARGO_POLICY.release_at).toBe('embargo-instant');
    expect(NEWS_EMBARGO_POLICY.undelivered).toBe('typed-error');
    expect(Object.isFrozen(NEWS_EMBARGO_POLICY)).toBe(true);
    const validation = validateEmbargoPolicy(NEWS_EMBARGO_POLICY);
    expect(validation.ok).toBe(true);
  });

  it('validateEmbargoPolicy negative paths (collect-all)', () => {
    expect(validateEmbargoPolicy(null).ok).toBe(false);
    expect(validateEmbargoPolicy({ basis: 'vendor-portal', release_at: 'embargo-instant', undelivered: 'typed-error' }).ok).toBe(false);
    expect(validateEmbargoPolicy({ basis: 'embargo-field', release_at: 'receive-instant', undelivered: 'typed-error' }).ok).toBe(false);
    expect(validateEmbargoPolicy({ basis: 'embargo-field', release_at: 'embargo-instant', undelivered: 'silent-drop' }).ok).toBe(false);
    expect(validateEmbargoPolicy({ release_at: 'embargo-instant', undelivered: 'typed-error' }).ok).toBe(false);
    expect(validateEmbargoPolicy({ basis: 'embargo-field', release_at: 'embargo-instant' }).ok).toBe(false);
  });

  it('embargoLiftAt reads the declared lift instant (null when unembargoed)', () => {
    expect(embargoLiftAt({ embargoTimeMs: ms(AT0 + 5_000) })).toBe(AT0 + 5_000);
    expect(embargoLiftAt({})).toBeNull();
  });

  it('isEmbargoedAt: held iff the lift instant lies strictly after the receive instant (no clock)', () => {
    expect(isEmbargoedAt({ embargoTimeMs: ms(AT0 + 5_000) }, ms(AT0))).toBe(true);
    expect(isEmbargoedAt({ embargoTimeMs: ms(AT0) }, ms(AT0))).toBe(false); // lift == receipt: already lifted
    expect(isEmbargoedAt({ embargoTimeMs: ms(AT0 - 1) }, ms(AT0))).toBe(false); // past-dated: already lifted
    expect(isEmbargoedAt({}, ms(AT0))).toBe(false); // unembargoed
    expect(isEmbargoedAt({ embargoTimeMs: ms(AT0 + 5_000) }, ms(-1))).toBe(false); // invalid instant: not embargoed
  });
});

describe('declarative rate quotas (criterion 8)', () => {
  it('declares the documented limits as validated, frozen envelopes', () => {
    for (const quota of NEWS_RATE_QUOTA_SET) {
      expect(isRateQuotaEnvelope(quota)).toBe(true);
      expect(Object.isFrozen(quota)).toBe(true);
    }
    expect(NEWS_RATE_QUOTA.limit).toBe(5);
    expect(NEWS_RATE_QUOTA.window_ms).toBe(1_000);
    expect(NEWS_RATE_QUOTA.policy).toBe('rolling-window');
    expect(NEWS_RATE_QUOTA.scope).toBe('stream-subscribe-requests');
    expect(NEWS_RATE_QUOTA_SET.length).toBe(3);
  });

  it('a feasible schedule passes (the positive path)', () => {
    const timeline = [0, 250, 500, 750, 1_000, 1_250];
    const result = enforceNewsRateQuota(NEWS_RATE_QUOTA, timeline);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feasible).toBe(true);
      expect(result.value.violations).toEqual([]);
      expect(result.value.assessed).toBe(6);
    }
  });

  it('an infeasible schedule is a typed protocol error (the negative path)', () => {
    const timeline = [0, 100, 200, 300, 400, 500];
    const result = enforceNewsRateQuota(NEWS_RATE_QUOTA, timeline);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(newsProtocolCodeOf(result.error)).toBe('rate_quota_exceeded');
      expect(result.error.message).toContain('stream-subscribe-requests');
    }
  });

  it('exactly at the limit passes; one over fails (boundary exactness)', () => {
    const atLimit = enforceNewsRateQuota(NEWS_RATE_QUOTA, [0, 1, 2, 3, 4]);
    expect(atLimit.ok).toBe(true);
    if (atLimit.ok) expect(atLimit.value.feasible).toBe(true);

    const overLimit = enforceNewsRateQuota(NEWS_RATE_QUOTA, [0, 1, 2, 3, 4, 5]);
    expect(overLimit.ok).toBe(false);
  });

  it('a fixed-window envelope resets at the epoch-aligned boundary (the daily item budget)', () => {
    const quota = { limit: 2, window_ms: 86_400_000, policy: 'fixed-window' as const, scope: 'test-daily' };
    const straddling = enforceNewsRateQuota(quota, [86_399_999, 86_400_000, 86_400_001]);
    expect(straddling.ok).toBe(true);
    const inside = enforceNewsRateQuota(quota, [100, 200, 300]);
    expect(inside.ok).toBe(false);
  });

  it('an invalid timeline is a typed protocol error (not a crash)', () => {
    const decreasing = enforceNewsRateQuota(NEWS_RATE_QUOTA, [2_000, 1_000]);
    expect(decreasing.ok).toBe(false);
    if (!decreasing.ok) expect(decreasing.error.code).toBe('invalid_configuration');

    const negative = enforceNewsRateQuota(NEWS_RATE_QUOTA, [-5]);
    expect(negative.ok).toBe(false);
  });

  it('an undeclared envelope is a typed protocol error', () => {
    const result = enforceNewsRateQuota({ limit: 5 }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });

  it('the feasibility report is frozen (immutable evidence)', () => {
    const result = enforceNewsRateQuota(NEWS_RATE_QUOTA, [0]);
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
      expect(report.value.feasible).toBe(false);
      expect(report.value.violations.length).toBeGreaterThan(0);
    }
  });
});

describe('health thresholds (the liveness declaration)', () => {
  it('declares a valid, frozen heartbeat envelope for the bursty wire cadence', () => {
    const validation = validateHealthThresholds(NEWS_HEALTH_THRESHOLDS);
    expect(validation.ok).toBe(true);
    expect(NEWS_HEALTH_THRESHOLDS.heartbeat_interval_ms).toBe(30_000);
    expect(NEWS_HEALTH_THRESHOLDS.staleness_limit_ms).toBe(120_000);
    expect(Object.isFrozen(NEWS_HEALTH_THRESHOLDS)).toBe(true);
  });

  it('assesses liveness at an injected instant (fresh, missed beats, stale)', () => {
    const at = (value: number): TimestampMs => value as TimestampMs;
    const fresh = assessHealth(NEWS_HEALTH_THRESHOLDS, at(AT0), at(AT0 + 10_000));
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.value.stale).toBe(false);
      expect(fresh.value.missed_beats).toBe(0);
    }
    const stale = assessHealth(NEWS_HEALTH_THRESHOLDS, at(AT0), at(AT0 + 150_000));
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect(stale.value.stale).toBe(true);
      expect(stale.value.missed_beats).toBe(5);
      expect(stale.value.elapsed_since_last_ms).toBe(150_000);
    }
    const noMessage = assessHealth(NEWS_HEALTH_THRESHOLDS, null, at(AT0));
    expect(noMessage.ok).toBe(true);
    if (noMessage.ok) {
      expect(noMessage.value.stale).toBe(false);
      expect(noMessage.value.last_message_at).toBeNull();
    }
  });

  it('assessing the past is a typed error (health is forward-only)', () => {
    const result = assessHealth(NEWS_HEALTH_THRESHOLDS, ms(AT0), ms(AT0 - 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });
});
