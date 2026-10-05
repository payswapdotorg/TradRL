/**
 * @tradrl/adapter-arena — declarative rate quotas + schedule enforcement.
 *
 * The declared envelopes carry the Arena wire's documented limits
 * (figures as documented by the provider's public API documentation at
 * declaration time; re-verify against the current docs when limits
 * change — the envelope records are data, not law):
 *
 *   - request-frames-per-connection: 10 per minute (rolling) — the
 *     documented routed-request rate per connection (human-expertise
 *     engagements are sparse by nature);
 *   - catalog-revisions-per-day: 24 per UTC day (fixed window) — the
 *     documented catalog publication budget;
 *   - message-deliveries-per-day: 1_000 per UTC day (fixed window) —
 *     the documented inbound delivery budget per connection.
 *
 * ENFORCEMENT: {@link enforceArenaRateQuota} runs the mirrored schedule
 * feasibility assessment and turns an infeasible schedule into a typed
 * protocol error (adapter-namespace code `rate_quota_exceeded`) listing
 * every violated window — deterministic, exact integer arithmetic.
 */

import {
  assessScheduleFeasibility,
  isRateQuotaEnvelope,
  validateRateQuotaEnvelope,
  type FeasibilityReport,
  type RateQuotaEnvelope,
} from './contract/rate-quota';
import { failure, protocolError, success, type SdkResult } from './contract/errors';
import { arenaProtocolError } from './protocol';

/** Declare (validate + deep-freeze) one quota envelope — our own declarations fail loudly. */
function declareQuota(value: RateQuotaEnvelope): RateQuotaEnvelope {
  const validation = validateRateQuotaEnvelope(value);
  if (!validation.ok) {
    throw new Error(`the arena rate quota declaration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return validation.value;
}

/** The documented routed-request rate per connection (rolling window). */
export const ARENA_RATE_QUOTA: RateQuotaEnvelope = declareQuota({
  limit: 10,
  window_ms: 60_000,
  policy: 'rolling-window',
  scope: 'request-frames-per-connection',
});

/** The full declared quota set: the documented wire limits. */
export const ARENA_RATE_QUOTA_SET: readonly RateQuotaEnvelope[] = [
  ARENA_RATE_QUOTA,
  declareQuota({
    limit: 24,
    window_ms: 86_400_000,
    policy: 'fixed-window',
    scope: 'catalog-revisions-per-day',
  }),
  declareQuota({
    limit: 1_000,
    window_ms: 86_400_000,
    policy: 'fixed-window',
    scope: 'message-deliveries-per-day',
  }),
];

/**
 * Enforce a declared quota over a scripted request timeline (arrival
 * order, non-decreasing). A schedule exceeding the declared limit is a
 * TYPED protocol error (`rate_quota_exceeded`) naming every violated
 * window; a feasible schedule returns the frozen feasibility report.
 * Deterministic and pure — no clock, no randomness.
 */
export function enforceArenaRateQuota(quota: unknown, timeline: readonly number[]): SdkResult<FeasibilityReport> {
  if (!isRateQuotaEnvelope(quota)) {
    return failure(
      protocolError('invalid_configuration', 'the rate quota envelope is not a declared RateQuotaEnvelope (limit/window_ms/policy/scope)'),
    );
  }
  const report = assessScheduleFeasibility(quota, timeline);
  if (!report.ok) return report;
  if (!report.value.feasible) {
    const summary = report.value.violations
      .map((violation) => `${violation.observed} requests in the ${violation.policy} [${violation.window_start}, ${violation.window_end}) exceed the declared limit ${violation.limit} (scope "${quota.scope}")`)
      .join('; ');
    return failure(
      arenaProtocolError(
        'rate_quota_exceeded',
        `the scripted schedule exceeds the declared Arena wire rate quota — ${summary}`,
      ),
    );
  }
  return success(report.value);
}
