// Tests for pure instant/duration formatting.
//
// Laws pinned here (format.ts header): "Deterministic, locale-free,
// timezone-fixed (UTC) formatting ... No Date object, no Intl, no locale —
// identical inputs -> identical bytes on every machine, forever." The
// expectations below are PINNED literals (computed once, outside the suite)
// across leap years (2000, 2024), the Feb-29 boundary, a century boundary
// (2100 — not a leap year) and the end-of-year rollover.

import { describe, expect, it } from 'vitest';
import { formatDurationMs, formatInstantUtc } from './format';

describe('format: formatInstantUtc (fixed UTC, pinned literals)', () => {
  it('the epoch', () => {
    expect(formatInstantUtc(0)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('day rollover', () => {
    expect(formatInstantUtc(86_400_000)).toBe('1970-01-02T00:00:00.000Z');
  });

  it('leap years: 2024-02-29 and 2000-02-29 (the 400-year rule)', () => {
    expect(formatInstantUtc(1_709_164_800_000)).toBe('2024-02-29T00:00:00.000Z');
    expect(formatInstantUtc(951_782_400_000)).toBe('2000-02-29T00:00:00.000Z');
  });

  it('a full timestamp with time-of-day', () => {
    expect(formatInstantUtc(1_710_198_000_000)).toBe('2024-03-11T23:00:00.000Z');
  });

  it('the year-end rollover down to the millisecond', () => {
    expect(formatInstantUtc(1_735_689_599_999)).toBe('2024-12-31T23:59:59.999Z');
  });

  it('the 2100 century boundary (2100 is NOT a leap year)', () => {
    expect(formatInstantUtc(4_102_444_800_000)).toBe('2100-01-01T00:00:00.000Z');
  });

  it('is pure: identical inputs -> identical bytes, every call', () => {
    const at = 1_735_689_599_999;
    const first = formatInstantUtc(at);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(formatInstantUtc(at)).toBe(first);
    }
  });

  it('refuses non-instant inputs loudly', () => {
    expect(() => formatInstantUtc(-1)).toThrow(/not a non-negative integer/);
    expect(() => formatInstantUtc(1.5)).toThrow(/not a non-negative integer/);
    expect(() => formatInstantUtc(Number.NaN)).toThrow(/not a non-negative integer/);
    expect(() => formatInstantUtc(Number.POSITIVE_INFINITY)).toThrow(/not a non-negative integer/);
  });
});

describe('format: formatDurationMs (compact, pinned literals)', () => {
  it('sub-second durations render as plain ms', () => {
    expect(formatDurationMs(0)).toBe('0ms');
    expect(formatDurationMs(45)).toBe('45ms');
    expect(formatDurationMs(999)).toBe('999ms');
  });

  it('seconds, minutes, hours compose (zero-padded, space-joined)', () => {
    expect(formatDurationMs(1_000)).toBe('01s');
    expect(formatDurationMs(4_503)).toBe('04s');
    expect(formatDurationMs(61_203)).toBe('01m 01s');
    expect(formatDurationMs(3_661_000)).toBe('1h 01m 01s');
    expect(formatDurationMs(36_000_000_00)).toBe('1000h 00m 00s');
  });

  it('is pure: identical inputs -> identical bytes', () => {
    expect(formatDurationMs(3_661_000)).toBe(formatDurationMs(3_661_000));
  });

  it('refuses non-integer and negative durations loudly', () => {
    expect(() => formatDurationMs(-1)).toThrow(/not a non-negative integer/);
    expect(() => formatDurationMs(0.5)).toThrow(/not a non-negative integer/);
    expect(() => formatDurationMs(Number.NaN)).toThrow(/not a non-negative integer/);
  });
});
