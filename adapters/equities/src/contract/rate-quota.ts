/**
 * @tradrl/adapter-equities — declarative rate/quota envelopes.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/rate-quota.ts (law D-004:
 * structural mirrors, never imports — the frozen workspace lockfile
 * forbids package dependencies). Declarative envelopes + schedule feasibility over a scripted timeline
 * (pure, exact integer arithmetic). ENFORCEMENT is THIS adapter's duty
 * (the adapter-namespace `rate_quota_exceeded` typed error, see
 * ../rate-quota.ts and ../protocol.ts) — the SDK computes feasibility,
 * the adapter enforces it.
 */

import { invalidField, isPositiveSafeInteger, isRecord, isNonEmptyString, missingField } from './fields';
import { failure, protocolError, success, type SdkFieldError, type SdkResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import { deepFreeze } from './freeze';

/** The window semantics of the envelope. */
export type QuotaPolicy = 'fixed-window' | 'rolling-window';

/** Runtime list of quota policies. */
export const QUOTA_POLICIES: readonly QuotaPolicy[] = ['fixed-window', 'rolling-window'];

/** Runtime guard for a quota policy. */
export function isQuotaPolicy(value: unknown): value is QuotaPolicy {
  return typeof value === 'string' && (QUOTA_POLICIES as readonly string[]).includes(value);
}

/**
 * The declared rate/quota record: at most `limit` requests per `window_ms`
 * under `policy`, scoped to an opaque label (e.g. per-connection,
 * per-key — the SDK does not interpret the scope).
 */
export interface RateQuotaEnvelope {
  /** Maximum requests within one window (positive). */
  readonly limit: number;
  /** Window length in milliseconds (positive). */
  readonly window_ms: number;
  /** The window semantics. */
  readonly policy: QuotaPolicy;
  /** Opaque scope label carried for the enforcing adapter. */
  readonly scope: string;
}

/** One feasibility violation: a concrete window that exceeds the limit. */
export interface QuotaViolation {
  readonly window_start: number;
  readonly window_end: number;
  readonly observed: number;
  readonly limit: number;
  readonly policy: QuotaPolicy;
}

/** The outcome of a feasibility assessment over a scripted timeline. */
export interface FeasibilityReport {
  /** True iff the timeline violates no window of the envelope. */
  readonly feasible: boolean;
  readonly violations: readonly QuotaViolation[];
  /** Number of assessed requests. */
  readonly assessed: number;
}

/** Structural guard for a rate/quota envelope. */
export function isRateQuotaEnvelope(value: unknown): value is RateQuotaEnvelope {
  if (!isRecord(value)) return false;
  return (
    isPositiveSafeInteger(value.limit) &&
    isPositiveSafeInteger(value.window_ms) &&
    isQuotaPolicy(value.policy) &&
    isNonEmptyString(value.scope)
  );
}

/** Validate an untrusted value as a RateQuotaEnvelope (collect-all; frozen). */
export function validateRateQuotaEnvelope(value: unknown): { readonly ok: true; readonly value: RateQuotaEnvelope } | { readonly ok: false; readonly errors: readonly SdkFieldError[] } {
  const errors: SdkFieldError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidField('rate_quota', 'must be an object')] };
  }
  if (value.limit === undefined) errors.push(missingField('limit'));
  else if (!isPositiveSafeInteger(value.limit)) errors.push(invalidField('limit', 'must be a positive safe integer'));

  if (value.window_ms === undefined) errors.push(missingField('window_ms'));
  else if (!isPositiveSafeInteger(value.window_ms))
    errors.push(invalidField('window_ms', 'must be a positive safe integer of milliseconds'));

  if (value.policy === undefined) errors.push(missingField('policy'));
  else if (!isQuotaPolicy(value.policy))
    errors.push(invalidField('policy', `must be one of ${QUOTA_POLICIES.join(' | ')}`));

  if (value.scope === undefined) errors.push(missingField('scope'));
  else if (!isNonEmptyString(value.scope)) errors.push(invalidField('scope', 'must be a non-empty string'));

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(value as unknown as RateQuotaEnvelope) as unknown as RateQuotaEnvelope };
}

/**
 * Assess whether a scripted timeline of request times is feasible under a
 * declared envelope. Pure, exact, deterministic. The timeline must be a
 * non-decreasing sequence of valid timestamps (arrival order); an invalid
 * timeline is a typed ProtocolError.
 */
export function assessScheduleFeasibility(
  envelope: RateQuotaEnvelope,
  timeline: readonly number[],
): SdkResult<FeasibilityReport> {
  const observed: TimestampMs[] = [];
  for (const time of timeline) {
    if (!isTimestampMs(time)) {
      return failure(
        protocolError('invalid_configuration', `timeline entry ${String(time)} is not a valid epoch-millisecond timestamp`),
      );
    }
    const previous = observed.length > 0 ? observed[observed.length - 1] : null;
    if (previous !== null && time < previous) {
      return failure(
        protocolError('invalid_configuration', 'the timeline must be non-decreasing (arrival order)'),
      );
    }
    observed.push(time);
  }

  const violations: QuotaViolation[] = [];
  if (envelope.policy === 'fixed-window') {
    // Epoch-aligned consecutive buckets.
    const counts = new Map<number, number>();
    for (const time of observed) {
      const bucket = Math.floor(time / envelope.window_ms) * envelope.window_ms;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    const buckets = [...counts.entries()].sort((a, b) => a[0] - b[0]);
    for (const [start, count] of buckets) {
      if (count > envelope.limit) {
        violations.push({
          window_start: start,
          window_end: start + envelope.window_ms,
          observed: count,
          limit: envelope.limit,
          policy: envelope.policy,
        });
      }
    }
  } else {
    // Rolling windows anchored at each request (exact for discrete points).
    for (let anchor = 0; anchor < observed.length; anchor += 1) {
      const start = observed[anchor];
      const end = start + envelope.window_ms;
      let count = 0;
      for (let probe = anchor; probe < observed.length; probe += 1) {
        if (observed[probe] < end) count += 1;
        else break;
      }
      if (count > envelope.limit) {
        violations.push({
          window_start: start,
          window_end: end,
          observed: count,
          limit: envelope.limit,
          policy: envelope.policy,
        });
      }
    }
  }

  const report: FeasibilityReport = {
    feasible: violations.length === 0,
    violations,
    assessed: observed.length,
  };
  return success(deepFreeze(report) as FeasibilityReport);
}
