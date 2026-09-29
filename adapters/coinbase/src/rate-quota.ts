/**
 * @tradrl/adapter-coinbase — declarative rate quotas + schedule enforcement.
 *
 * Work Order T037: "the same contract shape ... rate quota", and the law:
 * "Rate quota enforcement: adapters compute their request/subscribe
 * schedule feasibility against the documented exchange limits using the
 * SDK's RateQuotaEnvelope helpers — a schedule exceeding declared limits
 * is a typed error (deterministic, tested)."
 *
 * The declared envelopes carry the provider's documented public limits
 * (figures as documented by the Coinbase Exchange API docs at declaration
 * time; re-verify against the current docs when limits change — the
 * envelope records are data, not law):
 *
 *   - ip-rest-requests: 10 per second (rolling) — the documented public
 *     REST request rate per IP;
 *   - connection-inbound-messages: 10 per second (rolling) — the
 *     documented WebSocket inbound message rate per connection;
 *   - ip-connection-attempts: 15 per 10 seconds (fixed window) — the
 *     documented WebSocket connection attempt rate per IP.
 *
 * ENFORCEMENT: {@link enforceCoinbaseRateQuota} runs the mirrored schedule
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
import { coinbaseProtocolError } from './protocol';

/** Declare (validate + deep-freeze) one quota envelope — our own declarations fail loudly. */
function declareQuota(value: RateQuotaEnvelope): RateQuotaEnvelope {
  const validation = validateRateQuotaEnvelope(value);
  if (!validation.ok) {
    throw new Error(`the Coinbase rate quota declaration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return validation.value;
}

/** The documented public REST request rate per IP (rolling window). */
export const COINBASE_RATE_QUOTA: RateQuotaEnvelope = declareQuota({
  limit: 10,
  window_ms: 1_000,
  policy: 'rolling-window',
  scope: 'ip-rest-requests',
});

/** The full declared quota set: the documented REST and WebSocket limits. */
export const COINBASE_RATE_QUOTA_SET: readonly RateQuotaEnvelope[] = [
  COINBASE_RATE_QUOTA,
  declareQuota({
    limit: 10,
    window_ms: 1_000,
    policy: 'rolling-window',
    scope: 'connection-inbound-messages',
  }),
  declareQuota({
    limit: 15,
    window_ms: 10_000,
    policy: 'fixed-window',
    scope: 'ip-connection-attempts',
  }),
];

/**
 * Enforce a declared quota over a scripted request timeline (arrival
 * order, non-decreasing). A schedule exceeding the declared limit is a
 * TYPED protocol error (`rate_quota_exceeded`) naming every violated
 * window; a feasible schedule returns the frozen feasibility report.
 * Deterministic and pure — no clock, no randomness.
 */
export function enforceCoinbaseRateQuota(quota: unknown, timeline: readonly number[]): SdkResult<FeasibilityReport> {
  if (!isRateQuotaEnvelope(quota)) {
    return failure(
      protocolError('invalid_configuration', 'the rate quota envelope is not a declared RateQuotaEnvelope (limit/window_ms/policy/scope)'),
    );
  }
  const report = assessScheduleFeasibility(quota, timeline);
  if (!report.ok) return report;
  if (!report.value.feasible) {
    const summary = report.value.violations
      .map((violation) => `${violation.observed} requests in the ${violation.policy} [${violation.window_start}, ${violation.window_end}) exceed the declared limit ${violation.limit} (scope "${(quota as RateQuotaEnvelope).scope}")`)
      .join('; ');
    return failure(
      coinbaseProtocolError(
        'rate_quota_exceeded',
        `the scripted schedule exceeds the declared Coinbase rate quota — ${summary}`,
      ),
    );
  }
  return success(report.value);
}
