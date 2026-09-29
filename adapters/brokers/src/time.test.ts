/**
 * @tradrl/adapter-brokers — deterministic documented time conversion tests.
 *
 * Behavioral: the documented UTCTimestamp and RFC 3339 conversions —
 * valid forms, malformed forms, the truncation policy, leap-year
 * calendars, explicit offsets, the representable range, round-trip
 * exactness, and CROSS-FORM determinism (no Date.parse anywhere — the
 * same input always produces the same output, on every host).
 */

import { describe, expect, it } from 'vitest';

import { fixUtcTimestampToMs, rfc3339ToMs, msToFixUtcTimestamp } from './time';
import { T0, FIX_T0, RFC_T0 } from './test-fixtures';
import { isTimestampMs } from './contract/timestamp';

describe('fixUtcTimestampToMs (the documented UTCTimestamp form)', () => {
  it('converts the documented form exactly (millisecond precision)', () => {
    expect(fixUtcTimestampToMs('20240604-00:00:00.000')).toEqual({ ok: true, value: T0 });
    expect(fixUtcTimestampToMs(FIX_T0)).toEqual({ ok: true, value: T0 });
  });

  it('truncates fractional digits beyond milliseconds (the documented policy)', () => {
    expect(fixUtcTimestampToMs('20240604-00:00:00.123456')).toEqual({ ok: true, value: T0 + 123 });
    expect(fixUtcTimestampToMs('20240604-00:00:00.999999999')).toEqual({ ok: true, value: T0 + 999 });
    expect(fixUtcTimestampToMs('20240604-00:00:00.1')).toEqual({ ok: true, value: T0 + 100 });
  });

  it('accepts the documented form without fractional digits', () => {
    expect(fixUtcTimestampToMs('20240604-00:00:00')).toEqual({ ok: true, value: T0 });
  });

  it('handles leap years and month lengths exactly (hand-rolled calendar)', () => {
    expect(fixUtcTimestampToMs('20240229-12:00:00.000').ok).toBe(true); // 2024 is a leap year
    expect(fixUtcTimestampToMs('20230228-23:59:59.999').ok).toBe(true);
    const malformed = fixUtcTimestampToMs('20230229-00:00:00.000'); // 2023 is NOT a leap year
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.code).toBe('invalid_time_field');
    expect(fixUtcTimestampToMs('20240431-00:00:00.000').ok).toBe(false); // April has 30 days
  });

  it('rejects malformed shapes with typed failures', () => {
    for (const bad of [
      '2024-06-04T00:00:00.000Z', // RFC 3339 form, not the FIX form
      '20240604 00:00:00.000',
      '20240604-24:00:00.000',
      '20240604-00:60:00.000',
      '20240604-00:00:60.000',
      '2024-0604-00:00:00',
      '',
      '20240604',
      '20240604-00:00:00.1234567890', // ten fractional digits (documented: 1..9)
    ]) {
      const result = fixUtcTimestampToMs(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('protocol');
    }
  });

  it('rejects instants outside the representable range (pre-epoch years)', () => {
    expect(fixUtcTimestampToMs('19690101-00:00:00.000').ok).toBe(false);
    expect(fixUtcTimestampToMs('10000101-00:00:00.000').ok).toBe(false);
    // The 4-digit-year form cannot exceed the range on the high side: the
    // last representable 4-digit year is valid.
    expect(fixUtcTimestampToMs('99991231-23:59:59.999').ok).toBe(true);
  });
});

describe('rfc3339ToMs (the execution lane\'s mirrored instant form)', () => {
  it('converts the Z designator exactly', () => {
    expect(rfc3339ToMs(RFC_T0)).toEqual({ ok: true, value: T0 });
    expect(rfc3339ToMs('2024-06-04T12:34:56.789Z')).toEqual({ ok: true, value: Date.UTC(2024, 5, 4, 12, 34, 56, 789) });
  });

  it('applies explicit offsets exactly (pure integer arithmetic)', () => {
    // 12:00 at +02:00 is 10:00 UTC.
    expect(rfc3339ToMs('2024-06-04T12:00:00.000+02:00')).toEqual({ ok: true, value: Date.UTC(2024, 5, 4, 10, 0, 0, 0) });
    // 12:00 at -05:30 is 17:30 UTC.
    expect(rfc3339ToMs('2024-06-04T12:00:00.000-05:30')).toEqual({ ok: true, value: Date.UTC(2024, 5, 4, 17, 30, 0, 0) });
  });

  it('truncates fractional digits beyond milliseconds (the documented policy)', () => {
    expect(rfc3339ToMs('2024-06-04T00:00:00.123456789Z')).toEqual({ ok: true, value: T0 + 123 });
  });

  it('rejects malformed shapes with typed failures', () => {
    for (const bad of [
      '2024-06-04T00:00:00.000', // missing offset (mandatory)
      '2024-06-04 00:00:00Z',
      '2024-06-04T00:00:00+0200', // offset must be ±HH:MM
      '2024-13-04T00:00:00Z',
      '2024-06-31T00:00:00Z',
      '2024-06-04T24:00:00Z',
      '2024-06-04T00:00:00.Z',
      FIX_T0,
      '',
    ]) {
      expect(rfc3339ToMs(bad).ok).toBe(false);
    }
  });
});

describe('msToFixUtcTimestamp (the documented outbound form)', () => {
  it('formats epoch milliseconds exactly, zero-padded', () => {
    expect(msToFixUtcTimestamp(T0 as never)).toEqual({ ok: true, value: FIX_T0 });
    expect(msToFixUtcTimestamp(Date.UTC(2024, 5, 4, 12, 34, 56, 789) as never)).toEqual({ ok: true, value: '20240604-12:34:56.789' });
    expect(msToFixUtcTimestamp(0 as never)).toEqual({ ok: true, value: '19700101-00:00:00.000' });
  });

  it('round-trips exactly with the parser (the truncation policy makes it lossless)', () => {
    for (const value of [T0, T0 + 1, T0 + 999, 253_402_300_799_999, 1]) {
      const formatted = msToFixUtcTimestamp(value as never);
      expect(formatted.ok).toBe(true);
      if (formatted.ok) {
        const parsed = fixUtcTimestampToMs(formatted.value);
        expect(parsed).toEqual({ ok: true, value });
        expect(isTimestampMs(parsed.ok ? parsed.value : 0)).toBe(true);
      }
    }
  });

  it('rejects invalid timestamps with typed failures', () => {
    expect(msToFixUtcTimestamp(-1 as never).ok).toBe(false);
    expect(msToFixUtcTimestamp(8_640_000_000_000_000 as never).ok).toBe(false);
    expect(msToFixUtcTimestamp(0.5 as never).ok).toBe(false);
  });
});

describe('determinism (no Date.parse — identical on every host)', () => {
  it('the same inputs always produce the same outputs (100 samples)', () => {
    for (let index = 0; index < 100; index += 1) {
      const value = T0 + index * 86_400_007;
      const first = msToFixUtcTimestamp(value as never);
      const second = msToFixUtcTimestamp(value as never);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      if (first.ok) {
        const parsedFirst = fixUtcTimestampToMs(first.value);
        const parsedSecond = fixUtcTimestampToMs(first.value);
        expect(JSON.stringify(parsedFirst)).toBe(JSON.stringify(parsedSecond));
      }
    }
  });
});
