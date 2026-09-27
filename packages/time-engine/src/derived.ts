/**
 * @tradrl/time-engine — the derived-state availability contract.
 *
 * ARCHITECTURE-LOCK L4 polices observations AND derived state identically:
 * features, aggregates, labels and cached data are {@link Observable}s and
 * must carry their own `available_time`. This module defines the timestamp
 * contract every derived artifact must carry and the rule for computing it:
 *
 *     artifact.available_time = latest(input.available_time) + policy.delay
 *
 * The delay is the computation/publication latency of the transform — e.g. a
 * 1-minute VWAP feature over trades has available_time = last trade's
 * available_time + aggregation delay; a forward-return label for horizon h
 * over an event at T is available no earlier than T + h. A derived artifact
 * whose `available_time` precedes any of its inputs is a boundary violation
 * and is rejected by {@link validateDerivedAvailability}.
 *
 * Input and artifact identifiers are opaque strings (cross-lane rule:
 * trading-domain and agent-domain entities are referenced by id only).
 */

import { isDuration, durationToMs, type Duration } from './duration';
import { fail, ok, type TimeResult } from './errors';
import { maxTimestamps, timestampMs, isTimestampMs, MAX_TIMESTAMP_MS, type TimestampMs } from './timestamp';
import type { Observable } from './boundary';

/**
 * How a derived artifact was computed: the transform identity plus the
 * non-negative computation/publication delay imposed on availability.
 */
export interface ComputationPolicy {
  /** Stable identifier of the transform (e.g. 'vwap-1m-aggregator'). */
  readonly transform_id: string;
  /** Non-negative delay added to the latest input availability. */
  readonly delay: Duration;
}

/**
 * The timestamp contract every derived artifact (feature, aggregate, label,
 * cached datum) must carry so the firewall can police it uniformly.
 */
export interface DerivedAvailability {
  /** Earliest legitimate observation — must be >= every input's available_time. */
  readonly available_time: TimestampMs;
  /** Lineage: ids of the input events/artifacts this value was computed from. */
  readonly derived_from: readonly string[];
  /** How it was computed and at what latency. */
  readonly computation: ComputationPolicy;
}

/** Runtime type guard for a ComputationPolicy. */
export function isComputationPolicy(value: unknown): value is ComputationPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.transform_id === 'string' &&
    candidate.transform_id.length > 0 &&
    isDuration(candidate.delay)
  );
}

/** Runtime type guard for a DerivedAvailability contract. */
export function isDerivedAvailability(value: unknown): value is DerivedAvailability {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isTimestampMs(candidate.available_time) &&
    Array.isArray(candidate.derived_from) &&
    candidate.derived_from.length > 0 &&
    candidate.derived_from.every((id) => typeof id === 'string' && id.length > 0) &&
    isComputationPolicy(candidate.computation)
  );
}

/** Validate a policy: transform id first, then the delay's own duration rules. */
function validatePolicy(policy: ComputationPolicy): TimeResult<ComputationPolicy> {
  if (
    typeof policy !== 'object' ||
    policy === null ||
    typeof policy.transform_id !== 'string' ||
    policy.transform_id.length === 0
  ) {
    return fail('invalid_policy', 'computation policy requires a non-empty transform_id');
  }
  const delay = durationToMs(policy.delay);
  if (!delay.ok) return delay; // surfaces 'invalid_duration' with the precise cause
  return ok(policy);
}

/**
 * Compute the correct `available_time` for a derived artifact:
 * max(input available_time) + policy.delay. Inputs must be non-empty.
 */
export function derivedAvailableTime(
  inputs: readonly Observable[],
  policy: ComputationPolicy,
): TimeResult<TimestampMs> {
  const policyResult = validatePolicy(policy);
  if (!policyResult.ok) return policyResult;
  if (inputs.length === 0) {
    return fail('no_inputs', 'derivedAvailableTime requires at least one input observation');
  }
  const latestInput = maxTimestamps(inputs.map((input) => input.available_time));
  if (!latestInput.ok) return latestInput;
  const delay = durationToMs(policy.delay);
  if (!delay.ok) return delay;
  const target = latestInput.value + delay.value;
  if (target > MAX_TIMESTAMP_MS) {
    return fail('out_of_range', 'derived available_time overflows the representable timestamp range');
  }
  return timestampMs(target);
}

/**
 * Police a derived artifact against its inputs: the artifact must carry
 * non-empty lineage, a valid computation policy, and an `available_time` at
 * or after every input's `available_time`. Success returns `true`.
 */
export function validateDerivedAvailability(
  inputs: readonly Observable[],
  artifact: DerivedAvailability,
): TimeResult<true> {
  if (inputs.length === 0) {
    return fail('no_inputs', 'validateDerivedAvailability requires at least one input observation');
  }
  if (artifact.derived_from.length === 0) {
    return fail('derived_without_lineage', 'a derived artifact must list the ids of its inputs');
  }
  const policyResult = validatePolicy(artifact.computation);
  if (!policyResult.ok) return policyResult;
  const latestInput = maxTimestamps(inputs.map((input) => input.available_time));
  if (!latestInput.ok) return latestInput;
  if (artifact.available_time < latestInput.value) {
    return fail(
      'derived_before_inputs',
      `derived artifact available_time (${artifact.available_time}) precedes its latest input (${latestInput.value})`,
    );
  }
  return ok(true);
}
