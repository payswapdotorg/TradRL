/**
 * @tradrl/time-engine — durations.
 *
 * A {@link Duration} is a non-negative, finite span of time used by clock
 * arithmetic (`advanceBy`), computation policies (derived-artifact delay) and
 * the `T - x minutes` helpers. Components are fractional-friendly: half a
 * minute is `{ minutes: 0.5 }`.
 */

import { fail, ok, type TimeResult } from './errors';

/** A non-negative span of time. Absent components are zero. */
export interface Duration {
  readonly milliseconds?: number;
  readonly seconds?: number;
  readonly minutes?: number;
  readonly hours?: number;
  readonly days?: number;
}

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function componentIsValid(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Runtime type guard for a structurally valid Duration. */
export function isDuration(value: unknown): value is Duration {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  for (const key of ['milliseconds', 'seconds', 'minutes', 'hours', 'days'] as const) {
    const component = candidate[key];
    if (component !== undefined && !componentIsValid(component)) return false;
    if (component === undefined && key in candidate) return false; // explicit undefined is not a component
  }
  return true;
}

/** Normalize a Duration to a non-negative integer-safe total of milliseconds. */
export function durationToMs(duration: Duration): TimeResult<number> {
  if (!isDuration(duration)) {
    return fail('invalid_duration', 'duration must have non-negative finite numeric components');
  }
  const total =
    (duration.milliseconds ?? 0) +
    (duration.seconds ?? 0) * MS_PER_SECOND +
    (duration.minutes ?? 0) * MS_PER_MINUTE +
    (duration.hours ?? 0) * MS_PER_HOUR +
    (duration.days ?? 0) * MS_PER_DAY;
  if (!Number.isFinite(total)) {
    return fail('invalid_duration', 'duration components overflow to a non-finite total');
  }
  if (total > Number.MAX_SAFE_INTEGER) {
    return fail('invalid_duration', `duration of ${total} ms exceeds the safe integer range`);
  }
  return ok(total);
}

/** Convenience constructor: milliseconds. */
export function durationMilliseconds(milliseconds: number): Duration {
  return { milliseconds };
}

/** Convenience constructor: seconds. */
export function durationSeconds(seconds: number): Duration {
  return { seconds };
}

/** Convenience constructor: minutes. */
export function durationMinutes(minutes: number): Duration {
  return { minutes };
}

/** Convenience constructor: hours. */
export function durationHours(hours: number): Duration {
  return { hours };
}

/** Convenience constructor: days. */
export function durationDays(days: number): Duration {
  return { days };
}
