/**
 * @tradrl/adapter-coinbase — health heartbeats.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/health.ts (law D-004:
 * structural mirrors, never imports). Liveness/staleness records over
 * DECLARED thresholds (the Coinbase declarations live in ../health.ts).
 * The adapter never reads a wall clock: {@link assessHealth} is a pure
 * function of (thresholds, last message time, assessment time) — the
 * caller injects "now" (a simulated clock, a scripted timeline instant,
 * or a real clock in a runtime host). Deterministic by construction.
 *
 * Semantics (exact integer arithmetic):
 *   - `elapsed_since_last_ms` — time since the last message (null when none).
 *   - `missed_beats` — how many whole heartbeat intervals elapsed without a
 *     message (floor(elapsed / interval)); zero while the feed keeps pace.
 *   - `stale` — the feed is stale once elapsed exceeds the declared
 *     staleness limit (the liveness verdict).
 */

import { invalidField, isPositiveSafeInteger, isRecord, missingField } from './fields';
import { failure, protocolError, success, type SdkFieldError, type SdkResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import { deepFreeze } from './freeze';

/** The declared liveness thresholds of a feed. */
export interface HealthThresholds {
  /** Expected heartbeat interval in milliseconds (positive). */
  readonly heartbeat_interval_ms: number;
  /** The feed is stale once this many milliseconds pass without a message (positive, >= interval). */
  readonly staleness_limit_ms: number;
}

/** A health record: the liveness/staleness assessment of one instant. */
export interface HealthRecord {
  /** The injected assessment instant. */
  readonly assessed_at: TimestampMs;
  /** Receive time of the last delivered message, or null when none. */
  readonly last_message_at: TimestampMs | null;
  /** Milliseconds since the last message, or null when none. */
  readonly elapsed_since_last_ms: number | null;
  /** Whole heartbeat intervals elapsed without a message. */
  readonly missed_beats: number;
  /** The liveness verdict: true once elapsed exceeds the staleness limit. */
  readonly stale: boolean;
}

/** Structural guard for health thresholds. */
export function isHealthThresholds(value: unknown): value is HealthThresholds {
  if (!isRecord(value)) return false;
  return (
    isPositiveSafeInteger(value.heartbeat_interval_ms) &&
    isPositiveSafeInteger(value.staleness_limit_ms) &&
    value.staleness_limit_ms >= value.heartbeat_interval_ms
  );
}

/** Validate untrusted health thresholds (collect-all; frozen). */
export function validateHealthThresholds(value: unknown): { readonly ok: true; readonly value: HealthThresholds } | { readonly ok: false; readonly errors: readonly SdkFieldError[] } {
  const errors: SdkFieldError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidField('health_thresholds', 'must be an object')] };
  }
  if (value.heartbeat_interval_ms === undefined) errors.push(missingField('heartbeat_interval_ms'));
  else if (!isPositiveSafeInteger(value.heartbeat_interval_ms))
    errors.push(invalidField('heartbeat_interval_ms', 'must be a positive safe integer of milliseconds'));

  if (value.staleness_limit_ms === undefined) errors.push(missingField('staleness_limit_ms'));
  else if (!isPositiveSafeInteger(value.staleness_limit_ms))
    errors.push(invalidField('staleness_limit_ms', 'must be a positive safe integer of milliseconds'));

  if (
    isPositiveSafeInteger(value.heartbeat_interval_ms) &&
    isPositiveSafeInteger(value.staleness_limit_ms) &&
    value.staleness_limit_ms < value.heartbeat_interval_ms
  ) {
    errors.push(
      invalidField('staleness_limit_ms', 'must be >= heartbeat_interval_ms — a feed cannot go stale before one beat is missed'),
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(value as unknown as HealthThresholds) as unknown as HealthThresholds };
}

/**
 * Assess feed health at an injected instant. Pure: no wall clock. The
 * assessment instant must not precede the last message (a typed error —
 * assessing the past is a caller bug, not a health fact).
 */
export function assessHealth(
  thresholds: HealthThresholds,
  lastMessageAt: TimestampMs | null,
  assessedAt: TimestampMs,
): SdkResult<HealthRecord> {
  if (!isTimestampMs(assessedAt)) {
    return failure(protocolError('invalid_configuration', 'the assessment instant is not a valid timestamp'));
  }
  if (lastMessageAt !== null && !isTimestampMs(lastMessageAt)) {
    return failure(protocolError('invalid_configuration', 'the last message time is not a valid timestamp'));
  }
  if (lastMessageAt !== null && assessedAt < lastMessageAt) {
    return failure(
      protocolError('invalid_configuration', 'the assessment instant precedes the last message — health is assessed forward in time only'),
    );
  }

  const elapsed = lastMessageAt === null ? null : assessedAt - lastMessageAt;
  const missedBeats = elapsed === null ? 0 : Math.floor(elapsed / thresholds.heartbeat_interval_ms);
  const stale = elapsed !== null && elapsed > thresholds.staleness_limit_ms;

  const record: HealthRecord = {
    assessed_at: assessedAt,
    last_message_at: lastMessageAt,
    elapsed_since_last_ms: elapsed,
    missed_beats: missedBeats,
    stale,
  };
  return success(deepFreeze(record) as HealthRecord);
}
