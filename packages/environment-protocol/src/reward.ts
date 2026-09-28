/**
 * @tradrl/environment-protocol — the reward signal.
 *
 * OPTIONAL, EXPLICIT, NEVER FABRICATED.
 *
 * A RewardSignal is an environment-emitted scalar about an episode. It is
 * optional: environments that define no reward metric emit none, and the
 * absence of a signal carries no meaning beyond "the world said nothing".
 * It is explicit: every signal names its metric and its producing source —
 * the environment never hardcodes PnL semantics (L7: raw PnL is never the
 * sole acceptance criterion). It is never fabricated: the protocol provides
 * no reward computation whatsoever; signals exist only because a world
 * implementation emitted them.
 *
 * RL consumers (T013) attach their OWN reward functions to the recorded
 * trajectory (observations + actions + results). This type exists so a
 * world CAN publish named metrics (mark-to-market, penalty terms, task
 * scores) through the same auditable channel, and so consumers can combine
 * both sources without ambiguity.
 *
 * Like observations, rewards are policed by the inclusive point-in-time
 * boundary (L4): a signal carries its own `available_time`, and
 * {@link isRewardVisible} is the predicate. A reward about instant `at` can
 * never be available before `at` (enforced: `available_time >= at`).
 */

import { deepFreeze, isFiniteNumber, isNonEmptyString, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type EnvError, type EnvResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { EpisodeId, RewardId } from './ids';
import { isJsonObject, type JsonObject } from './json';

/**
 * An explicit reward signal emitted by an environment during an episode.
 */
export interface RewardSignal {
  /** Opaque unique identifier within the episode. */
  readonly reward_id: RewardId;
  /** The episode the signal belongs to (must match the episode it is emitted into). */
  readonly episode_id: EpisodeId;
  /** The instant the reward pertains to (the effect instant). */
  readonly at: TimestampMs;
  /** The earliest instant the signal may legitimately be observed (L4, inclusive; MUST be `>= at`). */
  readonly available_time: TimestampMs;
  /** The scalar reward value. Finite; may be negative or zero. NEVER interpreted as PnL by this protocol. */
  readonly value: number;
  /** Opaque metric label (e.g. 'stub-tick', 'fill-quality'). Consumers attach semantics; the protocol does not. */
  readonly metric: string;
  /** The world component that produced the signal (no orphan rewards). */
  readonly source: string;
  /** Optional structured detail (JSON object). */
  readonly detail: JsonObject | null;
}

/** Runtime type guard for a structurally valid reward signal. */
export function isRewardSignal(value: unknown): value is RewardSignal {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.reward_id)) return false;
  if (!isNonEmptyString(value.episode_id)) return false;
  if (!isTimestampMs(value.at)) return false;
  if (!isTimestampMs(value.available_time)) return false;
  if (!isFiniteNumber(value.value)) return false;
  if (!isNonEmptyString(value.metric)) return false;
  if (!isNonEmptyString(value.source)) return false;
  if (value.detail !== null && !isJsonObject(value.detail)) return false;
  if ((value.available_time as number) < (value.at as number)) return false;
  return true;
}

/**
 * The reward visibility predicate (L4, inclusive): a signal is legitimately
 * observable at instant `at` iff `signal.available_time <= at`.
 */
export function isRewardVisible(signal: RewardSignal, at: TimestampMs): boolean {
  return (signal.available_time as number) <= (at as number);
}

/**
 * Collect-all validation of an untrusted reward signal. Enforces the time
 * rule `available_time >= at` (a reward about an instant cannot be observed
 * before that instant — the reward-side twin of market-protocol's
 * `timestamp_order`). On success the value is returned narrowed, deeply
 * frozen.
 */
export function validateRewardSignal(value: unknown, path = 'reward'): EnvResult<RewardSignal> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: EnvError[] = [];

  if (value.reward_id === undefined) {
    errors.push(missingField(`${path}.reward_id`));
  } else if (!isNonEmptyString(value.reward_id)) {
    errors.push(invalidField(`${path}.reward_id`, 'must be a non-empty string'));
  }

  if (value.episode_id === undefined) {
    errors.push(missingField(`${path}.episode_id`));
  } else if (!isNonEmptyString(value.episode_id)) {
    errors.push(invalidField(`${path}.episode_id`, 'must be a non-empty string'));
  }

  if (value.at === undefined) {
    errors.push(missingField(`${path}.at`));
  } else if (!isTimestampMs(value.at)) {
    errors.push(invalidField(`${path}.at`, 'must be an integer epoch-ms number within the representable range'));
  }

  if (value.available_time === undefined) {
    errors.push(missingField(`${path}.available_time`));
  } else if (!isTimestampMs(value.available_time)) {
    errors.push(
      invalidField(`${path}.available_time`, 'must be an integer epoch-ms number within the representable range'),
    );
  }

  if (value.value === undefined) {
    errors.push(missingField(`${path}.value`));
  } else if (!isFiniteNumber(value.value)) {
    errors.push(invalidField(`${path}.value`, 'must be a finite number'));
  }

  if (value.metric === undefined) {
    errors.push(missingField(`${path}.metric`));
  } else if (!isNonEmptyString(value.metric)) {
    errors.push(invalidField(`${path}.metric`, 'must be a non-empty string'));
  }

  if (value.source === undefined) {
    errors.push(missingField(`${path}.source`));
  } else if (!isNonEmptyString(value.source)) {
    errors.push(invalidField(`${path}.source`, 'must be a non-empty string'));
  }

  if (value.detail === undefined) {
    errors.push(missingField(`${path}.detail`));
  } else if (value.detail !== null && !isJsonObject(value.detail)) {
    errors.push(invalidField(`${path}.detail`, 'must be a JSON object or null'));
  }

  if (
    errors.length === 0 &&
    isTimestampMs(value.at) &&
    isTimestampMs(value.available_time) &&
    (value.available_time as number) < (value.at as number)
  ) {
    errors.push({
      code: 'invalid_field',
      path: `${path}.available_time`,
      message: `available_time (${String(value.available_time)}) may not precede at (${String(value.at)}) — a reward about an instant cannot be observed before that instant`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      reward_id: value.reward_id as RewardId,
      episode_id: value.episode_id as EpisodeId,
      at: value.at as TimestampMs,
      available_time: value.available_time as TimestampMs,
      value: value.value as number,
      metric: value.metric as string,
      source: value.source as string,
      detail: value.detail as JsonObject | null,
    }),
  );
}
