/**
 * @tradrl/adapter-coinbase — the deterministic ISO-8601 conversion tests.
 *
 * Behavioral: the exact hand-rolled calendar math (verified against
 * known UTC instants), the documented truncation-to-milliseconds policy,
 * leap-year validation, and every negative path (malformed shapes,
 * out-of-range calendar fields, non-UTC designators, out-of-range
 * epochs). No Date.parse anywhere — determinism by construction.
 */

import { describe, expect, it } from 'vitest';

import { isoToTimestampMs } from './index';
import { isMappingError } from './index';

describe('isoToTimestampMs (the documented Coinbase time form)', () => {
  it('converts a known UTC instant exactly (second precision)', () => {
    const result = isoToTimestampMs('2024-05-21T17:22:12Z');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1_716_312_132_000);
  });

  it('converts millisecond precision exactly', () => {
    const result = isoToTimestampMs('2024-05-21T17:22:12.123Z');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1_716_312_132_123);
  });

  it('TRUNCATES microseconds to milliseconds (the documented deterministic policy)', () => {
    const result = isoToTimestampMs('2024-05-21T17:22:12.123456Z');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1_716_312_132_123);
    const nine = isoToTimestampMs('2024-05-21T17:22:12.123456789Z');
    expect(nine.ok).toBe(true);
    if (nine.ok) expect(nine.value).toBe(1_716_312_132_123);
    const one = isoToTimestampMs('2024-05-21T17:22:12.1Z');
    expect(one.ok).toBe(true);
    if (one.ok) expect(one.value).toBe(1_716_312_132_100);
  });

  it('handles the epoch instant and leap-day instants exactly', () => {
    const epoch = isoToTimestampMs('1970-01-01T00:00:00Z');
    expect(epoch.ok).toBe(true);
    if (epoch.ok) expect(epoch.value).toBe(0);

    const leapDay = isoToTimestampMs('2024-02-29T00:00:00Z');
    expect(leapDay.ok).toBe(true);
    if (leapDay.ok) expect(leapDay.value).toBe(1_709_164_800_000);

    const nonLeapFeb29 = isoToTimestampMs('2023-02-29T00:00:00Z');
    expect(nonLeapFeb29.ok).toBe(false);

    const centuryNonLeap = isoToTimestampMs('2100-02-29T00:00:00Z');
    expect(centuryNonLeap.ok).toBe(false);

    const centuryLeap = isoToTimestampMs('2000-02-29T00:00:00Z');
    expect(centuryLeap.ok).toBe(true);
  });

  it('rejects malformed shapes with typed MappingErrors', () => {
    for (const bad of [
      '2024-05-21 17:22:12Z', // space separator
      '2024-5-21T17:22:12Z', // unpadded month
      '2024-05-21T17:22Z', // missing seconds
      '2024-05-21T17:22:12', // missing Z
      '2024-05-21T17:22:12+00:00', // offset designator (only Z is documented)
      '2024-05-21T24:00:00Z', // hour 24
      '2024-13-01T00:00:00Z', // month 13
      '2024-05-32T00:00:00Z', // day 32
      '2024-05-21T17:22:12.Z', // empty fraction
      '20240521T172212Z', // basic format
      'not-a-time',
      '',
    ]) {
      const result = isoToTimestampMs(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isMappingError(result.error)).toBe(true);
        expect(result.error.code).toBe('invalid_time_field');
      }
    }
  });

  it('rejects epochs outside the representable range (typed)', () => {
    const result = isoToTimestampMs('999999-01-01T00:00:00Z');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_time_field');
  });

  it('is pure: the same input always converts identically (twice)', () => {
    const first = isoToTimestampMs('2024-05-21T17:22:12.123456Z');
    const second = isoToTimestampMs('2024-05-21T17:22:12.123456Z');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
