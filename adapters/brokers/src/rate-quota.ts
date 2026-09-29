/**
 * @tradrl/adapter-brokers — declarative rate quotas + schedule enforcement.
 *
 * Work Order law: "Rate quota enforcement: adapters compute their
 * request/subscribe schedule feasibility against the documented limits
 * using the SDK's RateQuotaEnvelope helpers — a schedule exceeding
 * declared limits is a typed error (deterministic, tested)."
 *
 * The declared envelopes carry the broker gateway's documented public
 * order-session limits (figures as documented by the gateway's public
 * integration API at declaration time; re-verify against the current
 * docs when limits change — the envelope records are data, not law):
 *
 *   - session-order-placement: 10 orders per second (rolling) — the
 *     documented order-placement rate per session;
 *   - session-gateway-messages: 50 messages per second (rolling) — the
 *     documented inbound-message rate per session (orders, cancels,
 *     session frames);
 *   - session-report-requests: 20 requests per 10 seconds (fixed) — the
 *     documented report-stream registration rate per session.
 *
 * ENFORCEMENT: {@link enforceBrokerRateQuota} runs the mirrored schedule
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
import { brokerProtocolError } from './protocol';

/** Declare (validate + deep-freeze) one quota envelope — our own declarations fail loudly. */
function declareQuota(value: RateQuotaEnvelope): RateQuotaEnvelope {
  const validation = validateRateQuotaEnvelope(value);
  if (!validation.ok) {
    throw new Error(`the broker rate quota declaration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return validation.value;
}

/** The documented order-placement rate per session (rolling window). */
export const BROKER_RATE_QUOTA: RateQuotaEnvelope = declareQuota({
  limit: 10,
  window_ms: 1_000,
  policy: 'rolling-window',
  scope: 'session-order-placement',
});

/** The full declared quota set: the documented session limits of the broker gateway. */
export const BROKER_RATE_QUOTA_SET: readonly RateQuotaEnvelope[] = [
  BROKER_RATE_QUOTA,
  declareQuota({
    limit: 50,
    window_ms: 1_000,
    policy: 'rolling-window',
    scope: 'session-gateway-messages',
  }),
  declareQuota({
    limit: 20,
    window_ms: 10_000,
    policy: 'fixed-window',
    scope: 'session-report-requests',
  }),
];

/**
 * Enforce a declared quota over a scripted request timeline (arrival
 * order, non-decreasing). A schedule exceeding the declared limit is a
 * TYPED protocol error (`rate_quota_exceeded`) naming every violated
 * window; a feasible schedule returns the frozen feasibility report.
 * Deterministic and pure — no clock, no randomness.
 */
export function enforceBrokerRateQuota(quota: unknown, timeline: readonly number[]): SdkResult<FeasibilityReport> {
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
      brokerProtocolError(
        'rate_quota_exceeded',
        `the scripted schedule exceeds the declared broker rate quota — ${summary}`,
      ),
    );
  }
  return success(report.value);
}
