import { describe, expect, it } from 'vitest';

import {
  durationDays,
  durationHours,
  durationMilliseconds,
  durationMinutes,
  durationSeconds,
  durationToMs,
  isDuration,
  type TimeResult,
} from './index';

function unwrap<T>(result: TimeResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${result.error.code}: ${result.error.message}`);
}

describe('duration validation and normalization', () => {
  it('normalizes each unit to milliseconds', () => {
    expect(unwrap(durationToMs(durationMilliseconds(250)))).toBe(250);
    expect(unwrap(durationToMs(durationSeconds(30)))).toBe(30_000);
    expect(unwrap(durationToMs(durationMinutes(1)))).toBe(60_000);
    expect(unwrap(durationToMs(durationHours(1)))).toBe(3_600_000);
    expect(unwrap(durationToMs(durationDays(1)))).toBe(86_400_000);
  });

  it('sums mixed components and accepts fractions', () => {
    const mixed = durationToMs({ hours: 1, minutes: 30 });
    expect(mixed.ok && mixed.value).toBe(5_400_000);
    const half = durationToMs({ minutes: 0.5 });
    expect(half.ok && half.value).toBe(30_000);
    const empty = durationToMs({});
    expect(empty.ok && empty.value).toBe(0);
  });

  it('rejects negative, non-finite and overflowing durations', () => {
    for (const bad of [{ minutes: -1 }, { seconds: Number.NaN }, { days: Number.POSITIVE_INFINITY }, { days: 1e12 }]) {
      const result = durationToMs(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid_duration');
    }
  });

  it('isDuration guards structure, including explicit-undefined components', () => {
    expect(isDuration({})).toBe(true);
    expect(isDuration({ minutes: 2 })).toBe(true);
    expect(isDuration({ minutes: -2 })).toBe(false);
    expect(isDuration({ minutes: undefined })).toBe(false); // explicit undefined is not a component
    expect(isDuration(null)).toBe(false);
    expect(isDuration(5)).toBe(false);
    expect(isDuration({ weeks: 1 })).toBe(true); // unknown components are ignored by the guard (open record)
  });
});
