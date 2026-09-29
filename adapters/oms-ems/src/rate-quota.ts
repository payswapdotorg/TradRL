/**
 * @tradrl/adapter-oms-ems — declarative rate quotas + schedule enforcement.
 *
 * Work Order law: "Rate quota enforcement: adapters compute their
 * request/subscribe schedule feasibility against the documented limits
 * using the SDK's RateQuotaEnvelope helpers — a schedule exceeding
 * declared limits is a typed error (deterministic, tested)."
 *
 * The declared envelopes carry the OMS/EMS gateway's documented public
 * order-session limits (figures as documented by the gateway's public
 * integration API at declaration time; re-verify against the current
 * docs when limits change — the envelope records are data, not law):
 *
 *   - session-routing-instructions: 20 instructions per second (rolling)
 *     — the documented routing-instruction rate per session;
 *   - session-gateway-messages: 100 messages per second (rolling) — the
 *     documented inbound-message rate per session (instructions, cancels,
 *     session frames);
 *   - session-state-requests: 10 requests per 10 seconds (fixed) — the
 *     documented order-state stream registration rate per session.
 *
 * ENFORCEMENT: {@link enforceOmsEmsRateQuota} runs the mirrored schedule
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
import { omsEmsProtocolError } from './protocol';

/** Declare (validate + deep-freeze) one quota envelope — our own declarations fail loudly. */
function declareQuota(value: RateQuotaEnvelope): RateQuotaEnvelope {
  const validation = validateRateQuotaEnvelope(value);
  if (!validation.ok) {
    throw new Error(`the OMS/EMS rate quota declaration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return validation.value;
}

/** The documented routing-instruction rate per session (rolling window). */
export const OMS_EMS_RATE_QUOTA: RateQuotaEnvelope = declareQuota({
  limit: 20,
  window_ms: 1_000,
  policy: 'rolling-window',
  scope: 'session-routing-instructions',
});

/** The full declared quota set: the documented session limits of the OMS/EMS gateway. */
export const OMS_EMS_RATE_QUOTA_SET: readonly RateQuotaEnvelope[] = [
  OMS_EMS_RATE_QUOTA,
  declareQuota({
    limit: 100,
    window_ms: 1_000,
    policy: 'rolling-window',
    scope: 'session-gateway-messages',
  }),
  declareQuota({
    limit: 10,
    window_ms: 10_000,
    policy: 'fixed-window',
    scope: 'session-state-requests',
  }),
];

/**
 * Enforce a declared quota over a scripted request timeline (arrival
 * order, non-decreasing). A schedule exceeding the declared limit is a
 * TYPED protocol error (`rate_quota_exceeded`) naming every violated
 * window; a feasible schedule returns the frozen feasibility report.
 * Deterministic and pure — no clock, no randomness.
 */
export function enforceOmsEmsRateQuota(quota: unknown, timeline: readonly number[]): SdkResult<FeasibilityReport> {
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
      omsEmsProtocolError(
        'rate_quota_exceeded',
        `the scripted schedule exceeds the declared OMS/EMS rate quota — ${summary}`,
      ),
    );
  }
  return success(report.value);
}
