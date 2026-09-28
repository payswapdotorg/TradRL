/**
 * @tradrl/time-machine — duration mirror of @tradrl/time-engine.
 *
 * STRUCTURAL MIRROR — DO NOT DIVERGE (law D-004).
 *
 * `Duration` is the canonical non-negative time-span value object of
 * `@tradrl/time-engine` (packages/time-engine/src/duration.ts); the frozen
 * lockfile forbids the package edge, so this service re-declares the
 * identical structural type and to-milliseconds semantics. The rolling
 * window horizon is expressed as a Duration (spec/ARCHITECTURE.md "Time
 * Machine"; spec/ARCHITECTURE-LOCK.md L9 — no wall-clock anywhere).
 */

/** A non-negative span of time (fractional components allowed). Mirror of time-engine Duration. */
export interface Duration {
  readonly milliseconds?: number;
  readonly seconds?: number;
  readonly minutes?: number;
  readonly hours?: number;
  readonly days?: number;
}

/** Runtime guard for a structurally valid Duration (all present components non-negative finite). */
export function isDuration(value: unknown): value is Duration {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  for (const key of ['milliseconds', 'seconds', 'minutes', 'hours', 'days'] as const) {
    const component = candidate[key];
    if (component !== undefined) {
      if (typeof component !== 'number' || !Number.isFinite(component) || component < 0) return false;
    } else if (key in candidate) {
      // Present-but-undefined components (e.g. explicit undefined) are invalid.
      return false;
    }
  }
  return true;
}

/**
 * Resolve a Duration to whole milliseconds. The sum must be a finite
 * non-negative number (fractional components are summed before flooring —
 * the rolling horizon is a whole-millisecond boundary like every TimestampMs).
 * Returns null when the resolution overflows finite arithmetic.
 */
export function durationToMillis(value: Duration): number | null {
  const ms =
    (value.milliseconds ?? 0) +
    (value.seconds ?? 0) * 1_000 +
    (value.minutes ?? 0) * 60_000 +
    (value.hours ?? 0) * 3_600_000 +
    (value.days ?? 0) * 86_400_000;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms);
}
