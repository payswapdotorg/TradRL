import { describe, expect, it } from 'vitest';

import {
  MAX_TIMESTAMP_MS,
  MIN_TIMESTAMP_MS,
  anchorFromIso,
  compareTimestamps,
  fromIso,
  isAfter,
  isAfterOrEqual,
  isBefore,
  isBeforeOrEqual,
  isTimestampMs,
  maxTimestamps,
  minTimestamps,
  requireTimestampMs,
  timestampMs,
  toIso,
  type TimeResult,
  type TimestampMs,
} from './index';

function unwrap<T>(result: TimeResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${result.error.code}: ${result.error.message}`);
}

describe('timestampMs construction', () => {
  it('accepts the boundary values of the representable range', () => {
    expect(unwrap(timestampMs(MIN_TIMESTAMP_MS))).toBe(0);
    expect(unwrap(timestampMs(MAX_TIMESTAMP_MS))).toBe(MAX_TIMESTAMP_MS);
  });

  it('accepts an ordinary epoch-millisecond instant', () => {
    const value = unwrap(timestampMs(1_700_000_000_000));
    expect(value).toBe(1_700_000_000_000);
    expect(typeof value).toBe('number');
  });

  it('rejects fractional, negative, non-finite and out-of-range values', () => {
    for (const bad of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_TIMESTAMP_MS + 1]) {
      const result = timestampMs(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(['invalid_timestamp', 'out_of_range']).toContain(result.error.code);
      }
    }
  });

  it('requireTimestampMs returns the value for valid input and throws for invalid', () => {
    expect(requireTimestampMs(42)).toBe(42);
    expect(() => requireTimestampMs(1.5)).toThrow(RangeError);
    expect(() => requireTimestampMs(-1)).toThrow(RangeError);
  });
});

describe('isTimestampMs guard', () => {
  it('accepts validated numbers', () => {
    expect(isTimestampMs(0)).toBe(true);
    expect(isTimestampMs(123456)).toBe(true);
  });

  it('rejects non-numbers and malformed numbers', () => {
    for (const bad of ['123', null, undefined, true, {}, 1.25, -5, Number.POSITIVE_INFINITY]) {
      expect(isTimestampMs(bad)).toBe(false);
    }
  });
});

describe('fromIso / toIso', () => {
  it('parses a zoned date-time as UTC', () => {
    expect(unwrap(fromIso('2024-01-01T00:00:00Z'))).toBe(Date.UTC(2024, 0, 1));
  });

  it('parses a date-only form as UTC midnight', () => {
    expect(unwrap(fromIso('2024-01-01'))).toBe(Date.UTC(2024, 0, 1));
  });

  it('parses explicit UTC offsets equivalently', () => {
    const utc = unwrap(fromIso('2024-06-01T12:00:00Z'));
    const offset = unwrap(fromIso('2024-06-01T14:00:00+02:00'));
    expect(offset).toBe(utc);
  });

  it('parses millisecond precision and a space separator with zone', () => {
    expect(unwrap(fromIso('2024-06-01T12:00:00.500Z'))).toBe(Date.UTC(2024, 5, 1, 12, 0, 0, 500));
    expect(unwrap(fromIso('2024-06-01 12:00:00Z'))).toBe(Date.UTC(2024, 5, 1, 12));
  });

  it('rejects naive date-times (no timezone), garbage, and impossible dates', () => {
    for (const bad of [
      '2024-06-01T12:00:00', // naive — ambiguous instant
      'not a date',
      '2024-13-01', // impossible month
      '2024-06-01T25:00:00Z',
      '06/01/2024',
    ]) {
      const result = fromIso(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid_iso');
    }
  });

  it('round-trips toIso over fromIso', () => {
    const iso = '2024-06-01T12:34:56.789Z';
    expect(toIso(unwrap(fromIso(iso)))).toBe(iso);
  });

  it('anchors historical timestamps via the intent-revealing aliases', () => {
    expect(unwrap(anchorFromIso('2024-01-01T00:00:00Z'))).toBe(Date.UTC(2024, 0, 1));
    expect(unwrap(anchorFromIso('2024-01-01T00:00:00Z'))).toBe(Date.UTC(2024, 0, 1));
  });
});

describe('monotonic timestamp comparisons', () => {
  const early = requireTimestampMs(1_000);
  const late = requireTimestampMs(2_000);

  it('orders timestamps totally', () => {
    expect(compareTimestamps(early, late)).toBe(-1);
    expect(compareTimestamps(late, early)).toBe(1);
    expect(compareTimestamps(early, early)).toBe(0);
  });

  it('exposes strict and inclusive comparisons', () => {
    expect(isBefore(early, late)).toBe(true);
    expect(isBefore(late, early)).toBe(false);
    expect(isBefore(early, early)).toBe(false);
    expect(isAfter(late, early)).toBe(true);
    expect(isAfter(early, early)).toBe(false);
    expect(isBeforeOrEqual(early, early)).toBe(true);
    expect(isAfterOrEqual(late, late)).toBe(true);
    expect(isBeforeOrEqual(early, late)).toBe(true);
  });
});

describe('min/max over timestamp lists', () => {
  const a = requireTimestampMs(5);
  const b = requireTimestampMs(9);
  const c = requireTimestampMs(7);

  it('finds the latest and earliest', () => {
    expect(unwrap(maxTimestamps([a, b, c]))).toBe(9);
    expect(unwrap(minTimestamps([a, b, c]))).toBe(5);
    expect(unwrap(maxTimestamps([b]))).toBe(9);
  });

  it('refuses empty input with a typed error', () => {
    expect(maxTimestamps([]).ok).toBe(false);
    const result = minTimestamps([]);
    if (!result.ok) expect(result.error.code).toBe('no_inputs');
    else throw new Error('expected failure');
  });
});
