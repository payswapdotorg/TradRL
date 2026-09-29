/**
 * @tradrl/adapter-oms-ems — deterministic documented time conversion tests.
 *
 * Behavioral: the documented UTCTimestamp and RFC 3339 conversions —
 * valid forms, malformed forms, the truncation policy, leap-year
 * calendars, explicit offsets, the representable range, round-trip
 * exactness, and CROSS-FORM determinism (no Date.parse anywhere — the
 * same input always produces the same output, on every host).
 */

import { describe, expect, it } from 'vitest';

import { isoUtcToMs, rfc3339ToMs, msToIsoUtc } from './time';
import { T0, ISO_T0, RFC_T0 } from './test-fixtures';
import { isTimestampMs } from './contract/timestamp';

describe('isoUtcToMs (the documented ISO-8601 UTC form)', () => {
  it('converts the documented form exactly (millisecond precision)', () => {
    expect(isoUtcToMs('2024-06-04T00:00:00.000Z')).toEqual({ ok: true, value: T0 });
    expect(isoUtcToMs(ISO_T0)).toEqual({ ok: true, value: T0 });
  });

  it('truncates fractional digits beyond milliseconds (the documented policy)', () => {
    expect(isoUtcToMs('2024-06-04T00:00:00.123456Z')).toEqual({ ok: true, value: T0 + 123 });
    expect(isoUtcToMs('2024-06-04T00:00:00.999999999Z')).toEqual({ ok: true, value: T0 + 999 });
    expect(isoUtcToMs('2024-06-04T00:00:00.1Z')).toEqual({ ok: true, value: T0 + 100 });
  });

  it('accepts the documented form without fractional digits', () => {
    expect(isoUtcToMs('2024-06-04T00:00:00Z')).toEqual({ ok: true, value: T0 });
  });

  it('handles leap years and month lengths exactly (hand-rolled calendar)', () => {
    expect(isoUtcToMs('2024-02-29T12:00:00.000Z').ok).toBe(true); // 2024 is a leap year
    expect(isoUtcToMs('2023-02-28T23:59:59.999Z').ok).toBe(true);
    const malformed = isoUtcToMs('2023-02-29T00:00:00.000Z'); // 2023 is NOT a leap year
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.code).toBe('invalid_time_field');
    expect(isoUtcToMs('2024-04-31T00:00:00.000Z').ok).toBe(false); // April has 30 days
  });

  it('rejects malformed shapes with typed failures', () => {
    for (const bad of [
      '20240604-00:00:00.000', // the FIX form, not the documented ISO form
      '2024-06-04 00:00:00.000',
      '2024-06-04T24:00:00.000Z',
      '2024-06-04T00:60:00.000Z',
      '2024-06-04T00:00:60.000Z',
      '2024-06-04T00:00:00.000+02:00', // a non-UTC designator (the gateway documents UTC)
      '',
      '2024-06-04',
      '2024-06-04T00:00:00.1234567890Z', // ten fractional digits (documented: 1..9)
    ]) {
      const result = isoUtcToMs(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('protocol');
    }
  });

  it('rejects instants outside the representable range (pre-epoch years)', () => {
    expect(isoUtcToMs('1969-06-04T00:00:00.000Z').ok).toBe(false);
    expect(isoUtcToMs('1000-06-04T00:00:00.000Z').ok).toBe(false);
    // The 4-digit-year form cannot exceed the range on the high side: the
    // last representable 4-digit year is valid.
    expect(isoUtcToMs('9999-12-31T23:59:59.999Z').ok).toBe(true);
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
      '20240604-00:00:00.000',
      '',
    ]) {
      expect(rfc3339ToMs(bad).ok).toBe(false);
    }
  });
});

describe('msToIsoUtc (the documented outbound form)', () => {
  it('formats epoch milliseconds exactly, zero-padded', () => {
    expect(msToIsoUtc(T0 as never)).toEqual({ ok: true, value: ISO_T0 });
    expect(msToIsoUtc(Date.UTC(2024, 5, 4, 12, 34, 56, 789) as never)).toEqual({ ok: true, value: '2024-06-04T12:34:56.789Z' });
    expect(msToIsoUtc(0 as never)).toEqual({ ok: true, value: '1970-01-01T00:00:00.000Z' });
  });

  it('round-trips exactly with the parser (the truncation policy makes it lossless)', () => {
    for (const value of [T0, T0 + 1, T0 + 999, 253_402_300_799_999, 1]) {
      const formatted = msToIsoUtc(value as never);
      expect(formatted.ok).toBe(true);
      if (formatted.ok) {
        const parsed = isoUtcToMs(formatted.value);
        expect(parsed).toEqual({ ok: true, value });
        expect(isTimestampMs(parsed.ok ? parsed.value : 0)).toBe(true);
      }
    }
  });

  it('rejects invalid timestamps with typed failures', () => {
    expect(msToIsoUtc(-1 as never).ok).toBe(false);
    expect(msToIsoUtc(8_640_000_000_000_000 as never).ok).toBe(false);
    expect(msToIsoUtc(0.5 as never).ok).toBe(false);
  });
});

describe('determinism (no Date.parse — identical on every host)', () => {
  it('the same inputs always produce the same outputs (100 samples)', () => {
    for (let index = 0; index < 100; index += 1) {
      const value = T0 + index * 86_400_007;
      const first = msToIsoUtc(value as never);
      const second = msToIsoUtc(value as never);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      if (first.ok) {
        const parsedFirst = isoUtcToMs(first.value);
        const parsedSecond = isoUtcToMs(first.value);
        expect(JSON.stringify(parsedFirst)).toBe(JSON.stringify(parsedSecond));
      }
    }
  });
});
