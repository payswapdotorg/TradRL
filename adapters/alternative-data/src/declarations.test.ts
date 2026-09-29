/**
 * @tradrl/adapter-alternative-data — entitlement tiers, the window->
 * release law, rate quota and health tests.
 *
 * Behavioral: the public + vendor-licensed entitlement tiers and the
 * refusal law; the DECLARED window->release law (validation, frozen,
 * pure predicates — criterion 9's "alt-data window->release law"); the
 * declarative rate quotas and schedule enforcement (positive AND
 * negative paths — criterion 8); the health threshold declaration and
 * the pure assessment.
 */

import { describe, expect, it } from 'vitest';

import {
  ALTDATA_PUBLIC_ENTITLEMENT,
  ALTDATA_VENDOR_ENTITLEMENT,
  ALTDATA_ENTITLEMENT,
  ALTDATA_WINDOW_RELEASE_LAW,
  validateWindowReleaseLaw,
  isMidWindowRelease,
  windowsOverlap,
  ALTDATA_RATE_QUOTA,
  ALTDATA_RATE_QUOTA_SET,
  enforceAltDataRateQuota,
  ALTDATA_HEALTH_THRESHOLDS,
  isEntitlementEnvelope,
  isRateQuotaEnvelope,
  validateEntitlementEnvelope,
  validateHealthThresholds,
  assessHealth,
  assessScheduleFeasibility,
  entitlementRefOf,
  altDataProtocolCodeOf,
  type TimestampMs,
} from './index';

const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = 1_717_423_200_000;

describe('the entitlement tiers (public + vendor-licensed, as opaque refs)', () => {
  it('the PUBLIC tier is a valid, frozen public envelope (open alt series)', () => {
    expect(isEntitlementEnvelope(ALTDATA_PUBLIC_ENTITLEMENT)).toBe(true);
    expect(validateEntitlementEnvelope(ALTDATA_PUBLIC_ENTITLEMENT)).toEqual([]);
    expect(ALTDATA_PUBLIC_ENTITLEMENT.access_class).toBe('public');
    expect(ALTDATA_PUBLIC_ENTITLEMENT.entitlement_id).toBe('ent-altdata-open-series');
    expect([...ALTDATA_PUBLIC_ENTITLEMENT.constraints]).toContain('attribution-required');
    expect(ALTDATA_PUBLIC_ENTITLEMENT.terms_ref).toBe('alt-vendor-a-open-terms');
    expect(Object.isFrozen(ALTDATA_PUBLIC_ENTITLEMENT)).toBe(true);
  });

  it('the VENDOR-LICENSED tier is a valid, frozen RESTRICTED envelope (licensed series, terms ref)', () => {
    expect(validateEntitlementEnvelope(ALTDATA_VENDOR_ENTITLEMENT)).toEqual([]);
    expect(ALTDATA_VENDOR_ENTITLEMENT.access_class).toBe('restricted');
    expect([...ALTDATA_VENDOR_ENTITLEMENT.constraints]).toContain('vendor-licensed-data');
    expect([...ALTDATA_VENDOR_ENTITLEMENT.constraints]).toContain('tier-professional');
    expect([...ALTDATA_VENDOR_ENTITLEMENT.constraints]).toContain('no-redistribution');
    expect(ALTDATA_VENDOR_ENTITLEMENT.terms_ref).toBe('alt-vendor-a-licensed-terms');
    expect(Object.isFrozen(ALTDATA_VENDOR_ENTITLEMENT)).toBe(true);
  });

  it('the default declaration is the vendor-licensed tier (the primary product)', () => {
    expect(ALTDATA_ENTITLEMENT).toBe(ALTDATA_VENDOR_ENTITLEMENT);
    const ref = entitlementRefOf(ALTDATA_ENTITLEMENT);
    expect(ref.entitlement_id).toBe('ent-altdata-vendor-licensed');
    expect([...ref.constraints]).toEqual([...ALTDATA_VENDOR_ENTITLEMENT.constraints]);
  });

  it('collect-all rejects malformed envelopes', () => {
    expect(validateEntitlementEnvelope({ entitlement_id: '', access_class: 'public', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'freemium', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'restricted', constraints: ['a', 'a'], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'restricted', constraints: [], terms_ref: 5 }).length).toBeGreaterThan(0);
  });
});

describe('ALTDATA_WINDOW_RELEASE_LAW (criterion 9 — the window->release law)', () => {
  it('is a valid, frozen declaration of the observation availability policy', () => {
    expect(ALTDATA_WINDOW_RELEASE_LAW.observation_basis).toBe('window-fields');
    expect(ALTDATA_WINDOW_RELEASE_LAW.availability).toBe('release-instant');
    expect(ALTDATA_WINDOW_RELEASE_LAW.mid_window_release).toBe('refuse');
    expect(ALTDATA_WINDOW_RELEASE_LAW.window_overlap).toBe('refuse');
    expect(Object.isFrozen(ALTDATA_WINDOW_RELEASE_LAW)).toBe(true);
    const validation = validateWindowReleaseLaw(ALTDATA_WINDOW_RELEASE_LAW);
    expect(validation.ok).toBe(true);
  });

  it('validateWindowReleaseLaw negative paths (collect-all)', () => {
    expect(validateWindowReleaseLaw(null).ok).toBe(false);
    expect(validateWindowReleaseLaw({ observation_basis: 'vendor-portal', availability: 'release-instant', mid_window_release: 'refuse', window_overlap: 'refuse' }).ok).toBe(false);
    expect(validateWindowReleaseLaw({ observation_basis: 'window-fields', availability: 'receive-instant', mid_window_release: 'refuse', window_overlap: 'refuse' }).ok).toBe(false);
    expect(validateWindowReleaseLaw({ observation_basis: 'window-fields', availability: 'release-instant', mid_window_release: 'accept', window_overlap: 'refuse' }).ok).toBe(false);
    expect(validateWindowReleaseLaw({ observation_basis: 'window-fields', availability: 'release-instant', mid_window_release: 'refuse', window_overlap: 'accept' }).ok).toBe(false);
    expect(validateWindowReleaseLaw({ availability: 'release-instant', mid_window_release: 'refuse', window_overlap: 'refuse' }).ok).toBe(false);
    expect(validateWindowReleaseLaw({ observation_basis: 'window-fields', mid_window_release: 'refuse', window_overlap: 'refuse' }).ok).toBe(false);
  });

  it('isMidWindowRelease: the never-mid-window predicate (pure)', () => {
    expect(isMidWindowRelease(ms(AT0), ms(AT0 - 1))).toBe(true);   // released before the window closed
    expect(isMidWindowRelease(ms(AT0), ms(AT0))).toBe(false);      // released exactly at the close
    expect(isMidWindowRelease(ms(AT0), ms(AT0 + 1))).toBe(false);  // released after the close
    expect(isMidWindowRelease(ms(-1), ms(AT0))).toBe(false);       // invalid instant: not mid-window
  });

  it('windowsOverlap: windows tile, never overlap (pure)', () => {
    expect(windowsOverlap(ms(AT0), ms(AT0))).toBe(false);            // abutting: the next window starts at the previous end
    expect(windowsOverlap(ms(AT0), ms(AT0 - 1))).toBe(true);         // the next window starts before the previous ended
    expect(windowsOverlap(ms(AT0), ms(AT0 + 1))).toBe(false);
    expect(windowsOverlap(ms(-1), ms(AT0))).toBe(false);             // invalid instant: no overlap verdict
  });
});

describe('declarative rate quotas (criterion 8)', () => {
  it('declares the documented limits as validated, frozen envelopes', () => {
    for (const quota of ALTDATA_RATE_QUOTA_SET) {
      expect(isRateQuotaEnvelope(quota)).toBe(true);
      expect(Object.isFrozen(quota)).toBe(true);
    }
    expect(ALTDATA_RATE_QUOTA.limit).toBe(60);
    expect(ALTDATA_RATE_QUOTA.window_ms).toBe(60_000);
    expect(ALTDATA_RATE_QUOTA.policy).toBe('fixed-window');
    expect(ALTDATA_RATE_QUOTA.scope).toBe('poll-requests-per-key');
    expect(ALTDATA_RATE_QUOTA_SET.length).toBe(3);
  });

  it('a feasible schedule passes (the positive path)', () => {
    const timeline = [0, 1_000, 2_000, 59_000, 60_000, 61_000]; // never more than 60 in any epoch-aligned minute
    const result = enforceAltDataRateQuota(ALTDATA_RATE_QUOTA, timeline);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feasible).toBe(true);
      expect(result.value.violations).toEqual([]);
      expect(result.value.assessed).toBe(6);
    }
  });

  it('an infeasible schedule is a typed protocol error (the negative path)', () => {
    const timeline = Array.from({ length: 61 }, (_, index) => index * 100); // 61 requests inside one minute
    const result = enforceAltDataRateQuota(ALTDATA_RATE_QUOTA, timeline);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(altDataProtocolCodeOf(result.error)).toBe('rate_quota_exceeded');
      expect(result.error.message).toContain('poll-requests-per-key');
    }
  });

  it('exactly at the limit passes; one over fails (boundary exactness)', () => {
    const atLimit = enforceAltDataRateQuota(ALTDATA_RATE_QUOTA, Array.from({ length: 60 }, (_, index) => index * 1_000));
    expect(atLimit.ok).toBe(true);
    if (atLimit.ok) expect(atLimit.value.feasible).toBe(true);

    // 61 requests inside ONE epoch-aligned minute bucket (spaced 100ms).
    const overLimit = enforceAltDataRateQuota(ALTDATA_RATE_QUOTA, Array.from({ length: 61 }, (_, index) => index * 100));
    expect(overLimit.ok).toBe(false);
  });

  it('a rolling-window envelope catches bursts a fixed window would straddle', () => {
    const quota = { limit: 3, window_ms: 1_000, policy: 'rolling-window' as const, scope: 'test-stream' };
    const burst = enforceAltDataRateQuota(quota, [500, 600, 700, 800, 900]); // 5 inside any rolling second
    expect(burst.ok).toBe(false);
    const spaced = enforceAltDataRateQuota(quota, [0, 400, 800, 1_200, 1_600]);
    expect(spaced.ok).toBe(true);
  });

  it('an invalid timeline is a typed protocol error (not a crash)', () => {
    const decreasing = enforceAltDataRateQuota(ALTDATA_RATE_QUOTA, [2_000, 1_000]);
    expect(decreasing.ok).toBe(false);
    if (!decreasing.ok) expect(decreasing.error.code).toBe('invalid_configuration');

    const negative = enforceAltDataRateQuota(ALTDATA_RATE_QUOTA, [-5]);
    expect(negative.ok).toBe(false);
  });

  it('an undeclared envelope is a typed protocol error', () => {
    const result = enforceAltDataRateQuota({ limit: 60 }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });

  it('the feasibility report is frozen (immutable evidence)', () => {
    const result = enforceAltDataRateQuota(ALTDATA_RATE_QUOTA, [0]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });
});

describe('the pure feasibility assessment (mirror behavior)', () => {
  it('fixed-window: epoch-aligned buckets reset at the boundary', () => {
    const quota = { limit: 2, window_ms: 60_000, policy: 'fixed-window' as const, scope: 't' };
    const report = assessScheduleFeasibility(quota, [59_999, 60_000, 60_001]);
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.feasible).toBe(true);
    }
  });
});

describe('health thresholds (the liveness declaration)', () => {
  it('declares a valid, frozen heartbeat envelope for the batch-release cadence', () => {
    const validation = validateHealthThresholds(ALTDATA_HEALTH_THRESHOLDS);
    expect(validation.ok).toBe(true);
    expect(ALTDATA_HEALTH_THRESHOLDS.heartbeat_interval_ms).toBe(3_600_000); // one hour
    expect(ALTDATA_HEALTH_THRESHOLDS.staleness_limit_ms).toBe(86_400_000);   // one day
    expect(Object.isFrozen(ALTDATA_HEALTH_THRESHOLDS)).toBe(true);
  });

  it('assesses liveness at an injected instant (fresh, missed beats, stale)', () => {
    const at = (value: number): TimestampMs => value as TimestampMs;
    const fresh = assessHealth(ALTDATA_HEALTH_THRESHOLDS, at(AT0), at(AT0 + 1_800_000));
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.value.stale).toBe(false);
      expect(fresh.value.missed_beats).toBe(0);
    }
    const stale = assessHealth(ALTDATA_HEALTH_THRESHOLDS, at(AT0), at(AT0 + 90_000_000));
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect(stale.value.stale).toBe(true);
      expect(stale.value.missed_beats).toBe(25);
      expect(stale.value.elapsed_since_last_ms).toBe(90_000_000);
    }
    const noMessage = assessHealth(ALTDATA_HEALTH_THRESHOLDS, null, at(AT0));
    expect(noMessage.ok).toBe(true);
    if (noMessage.ok) {
      expect(noMessage.value.stale).toBe(false);
      expect(noMessage.value.last_message_at).toBeNull();
    }
  });

  it('assessing the past is a typed error (health is forward-only)', () => {
    const result = assessHealth(ALTDATA_HEALTH_THRESHOLDS, ms(AT0), ms(AT0 - 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });
});
