/**
 * @tradrl/adapter-coinbase — deterministic ISO-8601 timestamp conversion.
 *
 * Coinbase Exchange messages carry their times as ISO-8601 strings
 * ("2024-05-21T17:22:12.123456Z" — UTC, with up to microsecond fractional
 * digits). The contract's time-policy conversion accepts safe-integer
 * epoch milliseconds or digit strings — never calendar strings — so the
 * guard layer converts documented ISO fields to epoch milliseconds HERE,
 * BEFORE emission.
 *
 * DETERMINISM LAW (byte-determinism): `Date.parse` is NOT used. The
 * ECMAScript specification defines exact parsing only for the 3-digit
 * fractional form; longer fractions fall back to implementation-defined
 * behavior, and timezone offsets vary by host. This parser is fully
 * hand-rolled: a strict regular shape, explicit calendar validation
 * (leap years included), and the days-from-civil algorithm for the
 * epoch conversion — pure integer arithmetic, identical on every host.
 *
 * Documented precision policy: fractional digits beyond milliseconds are
 * TRUNCATED (floor) — a deterministic, lossless-to-the-millisecond
 * policy, recorded here rather than hidden in a parser's rounding mode.
 * Only the `Z` (UTC) designator is accepted: the documented Coinbase
 * message times are UTC; a non-UTC designator is a typed error, not a
 * silent reinterpretation.
 */

import { failure, success, type SdkResult } from './contract/errors';
import { isTimestampMs, type TimestampMs } from './contract/timestamp';

/** The strict documented shape: YYYY-MM-DDTHH:mm:ss[.f{1..9}]Z. */
const ISO_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

/** Days in a month, leap years included (proleptic Gregorian). */
function daysInMonth(year: number, month: number): number {
  const LEAP = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const LENGTHS: readonly number[] = [31, LEAP ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return LENGTHS[month - 1];
}

/**
 * Days from 1970-01-01 to the given civil date (Howard Hinnant's
 * days_from_civil — pure integer arithmetic, no Date object).
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400; // [0, 399]
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/**
 * Convert one documented ISO-8601 UTC timestamp string to epoch
 * milliseconds. Total: every malformed input is a typed failure; the
 * result always satisfies {@link isTimestampMs}. Fractional digits beyond
 * milliseconds are truncated (documented policy — see the module header).
 */
export function isoToTimestampMs(value: string): SdkResult<TimestampMs> {
  const match = ISO_UTC_RE.exec(value);
  if (match === null) {
    return failure({
      kind: 'mapping',
      code: 'invalid_time_field',
      message: `the documented ISO-8601 UTC time "${value}" does not match the shape YYYY-MM-DDTHH:mm:ss[.f]Z`,
    });
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = Number(match[6]);

  if (month < 1 || month > 12) {
    return calendarFailure(value, 'month', month);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return calendarFailure(value, 'day', day);
  }
  if (hours > 23) return calendarFailure(value, 'hour', hours);
  if (minutes > 59) return calendarFailure(value, 'minute', minutes);
  if (seconds > 59) return calendarFailure(value, 'second', seconds);

  const fraction = match[7] ?? '';
  // Truncate to milliseconds: pad to 3 digits, ignore the rest.
  const millis = Number((fraction + '000').slice(0, 3));

  const epoch = daysFromCivil(year, month, day) * 86_400_000 + hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + millis;
  if (!isTimestampMs(epoch)) {
    return failure({
      kind: 'mapping',
      code: 'invalid_time_field',
      message: `the documented ISO-8601 UTC time "${value}" converts outside the representable epoch-millisecond range`,
    });
  }
  return success(epoch);
}

function calendarFailure(value: string, field: string, observed: number): SdkResult<TimestampMs> {
  return failure({
    kind: 'mapping',
    code: 'invalid_time_field',
    message: `the documented ISO-8601 UTC time "${value}" has an out-of-range ${field} (${observed})`,
  });
}
