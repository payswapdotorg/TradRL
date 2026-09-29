/**
 * @tradrl/adapter-news — declarative rate quotas + schedule enforcement.
 *
 * Work Order T038: "rate quota" and the law: "Rate quota enforcement:
 * adapters compute their request/subscribe schedule feasibility against
 * the documented exchange limits using the SDK's RateQuotaEnvelope
 * helpers — a schedule exceeding declared limits is a typed error
 * (deterministic, tested)."
 *
 * The declared envelopes carry the news wire's documented public limits
 * (figures as documented by the wire's public API documentation at
 * declaration time; re-verify against the current docs when limits
 * change — the envelope records are data, not law):
 *
 *   - stream-subscribe-requests: 5 per second (rolling) — the documented
 *     stream subscription-request rate per connection;
 *   - api-requests-per-key: 60 per minute (fixed window) — the documented
 *     REST item-pull budget per access key;
 *   - item-deliveries-per-day: 10_000 per UTC day (fixed window) — the
 *     documented daily item delivery budget per access key.
 *
 * ENFORCEMENT: {@link enforceNewsRateQuota} runs the mirrored schedule
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
import { newsProtocolError } from './protocol';

/** Declare (validate + deep-freeze) one quota envelope — our own declarations fail loudly. */
function declareQuota(value: RateQuotaEnvelope): RateQuotaEnvelope {
  const validation = validateRateQuotaEnvelope(value);
  if (!validation.ok) {
    throw new Error(`the news rate quota declaration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return validation.value;
}

/** The documented stream subscription-request rate per connection (rolling window). */
export const NEWS_RATE_QUOTA: RateQuotaEnvelope = declareQuota({
  limit: 5,
  window_ms: 1_000,
  policy: 'rolling-window',
  scope: 'stream-subscribe-requests',
});

/** The full declared quota set: the documented stream and REST limits. */
export const NEWS_RATE_QUOTA_SET: readonly RateQuotaEnvelope[] = [
  NEWS_RATE_QUOTA,
  declareQuota({
    limit: 60,
    window_ms: 60_000,
    policy: 'fixed-window',
    scope: 'api-requests-per-key',
  }),
  declareQuota({
    limit: 10_000,
    window_ms: 86_400_000,
    policy: 'fixed-window',
    scope: 'item-deliveries-per-day',
  }),
];

/**
 * Enforce a declared quota over a scripted request timeline (arrival
 * order, non-decreasing). A schedule exceeding the declared limit is a
 * TYPED protocol error (`rate_quota_exceeded`) naming every violated
 * window; a feasible schedule returns the frozen feasibility report.
 * Deterministic and pure — no clock, no randomness.
 */
export function enforceNewsRateQuota(quota: unknown, timeline: readonly number[]): SdkResult<FeasibilityReport> {
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
      newsProtocolError(
        'rate_quota_exceeded',
        `the scripted schedule exceeds the declared news wire rate quota — ${summary}`,
      ),
    );
  }
  return success(report.value);
}
