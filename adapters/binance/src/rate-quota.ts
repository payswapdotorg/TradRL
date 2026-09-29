/**
 * @tradrl/adapter-binance — declarative rate quotas + schedule enforcement.
 *
 * Work Order T037: "BINANCE_RATE_QUOTA — the documented spot stream/REST
 * limits as declarative envelopes + schedule feasibility check", and the
 * law: "Rate quota enforcement: adapters compute their request/subscribe
 * schedule feasibility against the documented exchange limits using the
 * SDK's RateQuotaEnvelope helpers — a schedule exceeding declared limits
 * is a typed error (deterministic, tested)."
 *
 * The declared envelopes carry the provider's documented public limits
 * (figures as documented by the Binance spot API docs at declaration
 * time; re-verify against the current docs when limits change — the
 * envelope records are data, not law):
 *
 *   - connection-inbound-messages: 5 per second (rolling) — the
 *     documented WebSocket inbound message rate per connection
 *     (SUBSCRIBE/PING/PONG frames);
 *   - ip-connection-attempts: 300 per 5 minutes (fixed window) — the
 *     documented WebSocket connection attempt limit per IP;
 *   - ip-request-weight: 6000 per minute (fixed window) — the documented
 *     REST request-weight budget per IP.
 *
 * ENFORCEMENT: {@link enforceBinanceRateQuota} runs the mirrored schedule
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
import { binanceProtocolError } from './protocol';

/** Declare (validate + deep-freeze) one quota envelope — our own declarations fail loudly. */
function declareQuota(value: RateQuotaEnvelope): RateQuotaEnvelope {
  const validation = validateRateQuotaEnvelope(value);
  if (!validation.ok) {
    throw new Error(`the Binance rate quota declaration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return validation.value;
}

/** The documented WebSocket inbound-message rate per connection (rolling window). */
export const BINANCE_RATE_QUOTA: RateQuotaEnvelope = declareQuota({
  limit: 5,
  window_ms: 1_000,
  policy: 'rolling-window',
  scope: 'connection-inbound-messages',
});

/** The full declared quota set: the documented connection and REST limits. */
export const BINANCE_RATE_QUOTA_SET: readonly RateQuotaEnvelope[] = [
  BINANCE_RATE_QUOTA,
  declareQuota({
    limit: 300,
    window_ms: 300_000,
    policy: 'fixed-window',
    scope: 'ip-connection-attempts',
  }),
  declareQuota({
    limit: 6_000,
    window_ms: 60_000,
    policy: 'fixed-window',
    scope: 'ip-request-weight',
  }),
];

/**
 * Enforce a declared quota over a scripted request timeline (arrival
 * order, non-decreasing). A schedule exceeding the declared limit is a
 * TYPED protocol error (`rate_quota_exceeded`) naming every violated
 * window; a feasible schedule returns the frozen feasibility report.
 * Deterministic and pure — no clock, no randomness.
 */
export function enforceBinanceRateQuota(quota: unknown, timeline: readonly number[]): SdkResult<FeasibilityReport> {
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
      binanceProtocolError(
        'rate_quota_exceeded',
        `the scripted schedule exceeds the declared Binance rate quota — ${summary}`,
      ),
    );
  }
  return success(report.value);
}
