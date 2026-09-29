/**
 * @tradrl/adapter-equities — entitlement, trading calendar, rate quota
 * and health tests.
 *
 * Behavioral: the licensed-data entitlement declaration (FULL strictness)
 * and the refusal law; the declared UTC trading calendar (pure calendar
 * math over known dates, criterion 9) and the calendar validator's
 * negative paths; the declarative rate quotas and schedule enforcement
 * (positive AND negative paths — criterion 8); the health threshold
 * declaration and the pure assessment.
 */

import { describe, expect, it } from 'vitest';

import {
  EQUITIES_ENTITLEMENT,
  EQUITIES_SESSION_CALENDAR,
  validateTradingCalendar,
  isSessionDay,
  isSessionInstantDay,
  tradingSessionOf,
  isTradingInstant,
  tradeDateDayIndex,
  utcDayIndexAt,
  EQUITIES_RATE_QUOTA,
  EQUITIES_RATE_QUOTA_SET,
  enforceEquitiesRateQuota,
  EQUITIES_HEALTH_THRESHOLDS,
  isEntitlementEnvelope,
  isRateQuotaEnvelope,
  validateEntitlementEnvelope,
  validateHealthThresholds,
  assessHealth,
  assessScheduleFeasibility,
  entitlementRefOf,
  equitiesProtocolCodeOf,
  type TimestampMs,
} from './index';

const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = 1_717_423_200_000; // 2024-06-03T14:00:00Z — Monday, inside the declared US regular session.

describe('EQUITIES_ENTITLEMENT (the licensed-data declaration, full strictness)', () => {
  it('is a valid, frozen RESTRICTED envelope (licensed index data is access-controlled)', () => {
    expect(isEntitlementEnvelope(EQUITIES_ENTITLEMENT)).toBe(true);
    expect(validateEntitlementEnvelope(EQUITIES_ENTITLEMENT)).toEqual([]);
    expect(EQUITIES_ENTITLEMENT.access_class).toBe('restricted');
    expect([...EQUITIES_ENTITLEMENT.constraints]).toContain('licensed-index-data');
    expect([...EQUITIES_ENTITLEMENT.constraints]).toContain('licensed-redistribution-controls');
    expect(EQUITIES_ENTITLEMENT.terms_ref).toBe('licensed-index-a-terms');
    expect(Object.isFrozen(EQUITIES_ENTITLEMENT)).toBe(true);
  });

  it('the derived ref carries the id and constraints verbatim (L9 self-describing)', () => {
    const ref = entitlementRefOf(EQUITIES_ENTITLEMENT);
    expect(ref.entitlement_id).toBe('ent-equities-index-licensed');
    expect([...ref.constraints]).toEqual([...EQUITIES_ENTITLEMENT.constraints]);
  });

  it('collect-all rejects malformed envelopes', () => {
    expect(validateEntitlementEnvelope({ entitlement_id: '', access_class: 'public', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'secret', constraints: [], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'restricted', constraints: ['a', 'a'], terms_ref: null }).length).toBeGreaterThan(0);
    expect(validateEntitlementEnvelope({ entitlement_id: 'x', access_class: 'restricted', constraints: [], terms_ref: '' }).length).toBeGreaterThan(0);
  });
});

describe('EQUITIES_SESSION_CALENDAR (criterion 9 — the declared session semantics)', () => {
  it('is a valid, frozen UTC calendar declaring the US regular session', () => {
    expect(EQUITIES_SESSION_CALENDAR.timezone).toBe('UTC');
    expect([...EQUITIES_SESSION_CALENDAR.session_days]).toEqual([1, 2, 3, 4, 5]);
    expect(EQUITIES_SESSION_CALENDAR.sessions.length).toBe(1);
    expect(EQUITIES_SESSION_CALENDAR.sessions[0].session_id).toBe('us-regular');
    expect(EQUITIES_SESSION_CALENDAR.sessions[0].opens_utc_ms).toBe(48_600_000); // 13:30 UTC
    expect(EQUITIES_SESSION_CALENDAR.sessions[0].closes_utc_ms).toBe(72_000_000); // 20:00 UTC
    expect(Object.isFrozen(EQUITIES_SESSION_CALENDAR)).toBe(true);
  });

  it('isSessionDay over known dates (hand-rolled proleptic Gregorian math, no Date object)', () => {
    expect(isSessionDay(EQUITIES_SESSION_CALENDAR, '2024-06-03')).toBe(true); // Monday
    expect(isSessionDay(EQUITIES_SESSION_CALENDAR, '2024-06-07')).toBe(true); // Friday
    expect(isSessionDay(EQUITIES_SESSION_CALENDAR, '2024-06-08')).toBe(false); // Saturday
    expect(isSessionDay(EQUITIES_SESSION_CALENDAR, '2024-06-09')).toBe(false); // Sunday
    expect(isSessionDay(EQUITIES_SESSION_CALENDAR, '2024-02-29')).toBe(true); // leap Thursday (leap-year math)
    expect(isSessionDay(EQUITIES_SESSION_CALENDAR, '2023-02-29')).toBe(false); // not a real civil date
    expect(isSessionDay(EQUITIES_SESSION_CALENDAR, '2024-6-3')).toBe(false); // malformed form
    expect(isSessionDay(EQUITIES_SESSION_CALENDAR, 'not-a-date')).toBe(false);
  });

  it('tradingSessionOf / isTradingInstant over known instants (open-closed window semantics)', () => {
    expect(tradingSessionOf(EQUITIES_SESSION_CALENDAR, ms(AT0))).toBe('us-regular'); // Monday 14:00 UTC
    expect(tradingSessionOf(EQUITIES_SESSION_CALENDAR, ms(1_717_421_400_000))).toBe('us-regular'); // Monday 13:30:00 UTC — the open boundary is included
    expect(tradingSessionOf(EQUITIES_SESSION_CALENDAR, ms(1_717_444_800_000))).toBeNull(); // Monday 20:00:00 UTC — the close boundary is excluded
    expect(tradingSessionOf(EQUITIES_SESSION_CALENDAR, ms(1_717_412_400_000))).toBeNull(); // Monday 11:00 UTC — pre-open
    expect(tradingSessionOf(EQUITIES_SESSION_CALENDAR, ms(1_717_423_200_000 + 86_400_000))).toBe('us-regular'); // Tuesday 14:00 UTC — in-session
    expect(tradingSessionOf(EQUITIES_SESSION_CALENDAR, ms(AT0 + 5 * 86_400_000))).toBeNull(); // Saturday 14:00 UTC
    expect(isTradingInstant(EQUITIES_SESSION_CALENDAR, ms(AT0))).toBe(true);
    expect(isTradingInstant(EQUITIES_SESSION_CALENDAR, ms(AT0 - 6 * 3_600_000))).toBe(false); // Monday 08:00 UTC
    expect(isSessionInstantDay(EQUITIES_SESSION_CALENDAR, ms(AT0 + 5 * 86_400_000))).toBe(false); // Saturday
    expect(isSessionInstantDay(EQUITIES_SESSION_CALENDAR, ms(AT0))).toBe(true);
  });

  it('the day-index helpers agree with each other (the dissemination-on-trade-date law is consistent)', () => {
    expect(utcDayIndexAt(ms(AT0))).toBe(tradeDateDayIndex('2024-06-03'));
    expect(utcDayIndexAt(ms(AT0 + 86_400_000))).toBe(tradeDateDayIndex('2024-06-04'));
    expect(utcDayIndexAt(ms(AT0))).not.toBe(tradeDateDayIndex('2024-06-04'));
    expect(tradeDateDayIndex('2024-06-31')).toBeNull(); // not a real civil date
  });

  it('validateTradingCalendar negative paths (collect-all)', () => {
    expect(validateTradingCalendar(null).ok).toBe(false);
    expect(validateTradingCalendar({ timezone: 'America/New_York', session_days: [1], sessions: [{ session_id: 'x', opens_utc_ms: 1, closes_utc_ms: 2 }] }).ok).toBe(false);
    expect(validateTradingCalendar({ timezone: 'UTC', session_days: [], sessions: [{ session_id: 'x', opens_utc_ms: 1, closes_utc_ms: 2 }] }).ok).toBe(false);
    expect(validateTradingCalendar({ timezone: 'UTC', session_days: [0], sessions: [{ session_id: 'x', opens_utc_ms: 1, closes_utc_ms: 2 }] }).ok).toBe(false);
    expect(validateTradingCalendar({ timezone: 'UTC', session_days: [1, 1], sessions: [{ session_id: 'x', opens_utc_ms: 1, closes_utc_ms: 2 }] }).ok).toBe(false);
    expect(validateTradingCalendar({ timezone: 'UTC', session_days: [1], sessions: [] }).ok).toBe(false);
    expect(validateTradingCalendar({ timezone: 'UTC', session_days: [1], sessions: [{ session_id: 'x', opens_utc_ms: 5, closes_utc_ms: 2 }] }).ok).toBe(false);
    expect(validateTradingCalendar({ timezone: 'UTC', session_days: [1], sessions: [{ session_id: 'x', opens_utc_ms: 86_400_000, closes_utc_ms: 86_400_100 }] }).ok).toBe(false);
    expect(validateTradingCalendar({ timezone: 'UTC', session_days: [1], sessions: [{ session_id: 'a', opens_utc_ms: 1, closes_utc_ms: 2 }, { session_id: 'a', opens_utc_ms: 3, closes_utc_ms: 4 }] }).ok).toBe(false);
    // A full valid declaration round-trips frozen.
    const valid = validateTradingCalendar({ timezone: 'UTC', session_days: [2], sessions: [{ session_id: 'half-day', opens_utc_ms: 48_600_000, closes_utc_ms: 61_200_000 }] });
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(Object.isFrozen(valid.value)).toBe(true);
  });
});

describe('declarative rate quotas (criterion 8)', () => {
  it('declares the documented limits as validated, frozen envelopes', () => {
    for (const quota of EQUITIES_RATE_QUOTA_SET) {
      expect(isRateQuotaEnvelope(quota)).toBe(true);
      expect(Object.isFrozen(quota)).toBe(true);
    }
    expect(EQUITIES_RATE_QUOTA.limit).toBe(5);
    expect(EQUITIES_RATE_QUOTA.window_ms).toBe(1_000);
    expect(EQUITIES_RATE_QUOTA.policy).toBe('rolling-window');
    expect(EQUITIES_RATE_QUOTA.scope).toBe('stream-subscribe-requests');
    expect(EQUITIES_RATE_QUOTA_SET.length).toBe(3);
  });

  it('a feasible schedule passes (the positive path)', () => {
    // Six subscribe frames, but never more than five within any rolling second.
    const timeline = [0, 250, 500, 750, 1_000, 1_250];
    const result = enforceEquitiesRateQuota(EQUITIES_RATE_QUOTA, timeline);
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
    const result = enforceEquitiesRateQuota(EQUITIES_RATE_QUOTA, timeline);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('protocol');
      expect(equitiesProtocolCodeOf(result.error)).toBe('rate_quota_exceeded');
      expect(result.error.message).toContain('stream-subscribe-requests');
    }
  });

  it('exactly at the limit passes; one over fails (boundary exactness)', () => {
    const atLimit = enforceEquitiesRateQuota(EQUITIES_RATE_QUOTA, [0, 1, 2, 3, 4]);
    expect(atLimit.ok).toBe(true);
    if (atLimit.ok) expect(atLimit.value.feasible).toBe(true);

    const overLimit = enforceEquitiesRateQuota(EQUITIES_RATE_QUOTA, [0, 1, 2, 3, 4, 5]);
    expect(overLimit.ok).toBe(false);
  });

  it('a fixed-window envelope resets at the epoch-aligned boundary', () => {
    const quota = { limit: 2, window_ms: 1_000, policy: 'fixed-window' as const, scope: 'test' };
    const straddling = enforceEquitiesRateQuota(quota, [999, 1_000, 1_001]); // two buckets, not three-in-one
    expect(straddling.ok).toBe(true);
    const inside = enforceEquitiesRateQuota(quota, [100, 200, 300]);
    expect(inside.ok).toBe(false);
  });

  it('an invalid timeline is a typed protocol error (not a crash)', () => {
    const decreasing = enforceEquitiesRateQuota(EQUITIES_RATE_QUOTA, [2_000, 1_000]);
    expect(decreasing.ok).toBe(false);
    if (!decreasing.ok) expect(decreasing.error.code).toBe('invalid_configuration');

    const negative = enforceEquitiesRateQuota(EQUITIES_RATE_QUOTA, [-5]);
    expect(negative.ok).toBe(false);
  });

  it('an undeclared envelope is a typed protocol error', () => {
    const result = enforceEquitiesRateQuota({ limit: 0 }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });

  it('the feasibility report is frozen (immutable evidence)', () => {
    const result = enforceEquitiesRateQuota(EQUITIES_RATE_QUOTA, [0]);
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
  it('declares a valid, frozen heartbeat envelope for the dissemination cadence', () => {
    const validation = validateHealthThresholds(EQUITIES_HEALTH_THRESHOLDS);
    expect(validation.ok).toBe(true);
    expect(EQUITIES_HEALTH_THRESHOLDS.heartbeat_interval_ms).toBe(15_000);
    expect(EQUITIES_HEALTH_THRESHOLDS.staleness_limit_ms).toBe(60_000);
    expect(Object.isFrozen(EQUITIES_HEALTH_THRESHOLDS)).toBe(true);
  });

  it('assesses liveness at an injected instant (fresh, missed beats, stale)', () => {
    const fresh = assessHealth(EQUITIES_HEALTH_THRESHOLDS, ms(AT0), ms(AT0 + 5_000));
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.value.stale).toBe(false);
      expect(fresh.value.missed_beats).toBe(0);
    }
    const stale = assessHealth(EQUITIES_HEALTH_THRESHOLDS, ms(AT0), ms(AT0 + 90_000));
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect(stale.value.stale).toBe(true);
      expect(stale.value.missed_beats).toBe(6);
      expect(stale.value.elapsed_since_last_ms).toBe(90_000);
    }
    const noMessage = assessHealth(EQUITIES_HEALTH_THRESHOLDS, null, ms(AT0));
    expect(noMessage.ok).toBe(true);
    if (noMessage.ok) {
      expect(noMessage.value.stale).toBe(false);
      expect(noMessage.value.last_message_at).toBeNull();
    }
  });

  it('assessing the past is a typed error (health is forward-only)', () => {
    const result = assessHealth(EQUITIES_HEALTH_THRESHOLDS, ms(AT0), ms(AT0 - 1_000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });
});
