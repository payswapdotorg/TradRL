/**
 * @tradrl/adapter-oms-ems — deterministic timestamp conversion.
 *
 * The OMS/EMS gateway's documented time fields follow the ISO-8601 UTC
 * form ("2024-06-04T12:00:00.123456Z" — UTC, with up to nanosecond
 * fractional digits), and the execution-lane's mirrored order intents
 * carry their instants as RFC 3339 strings with a MANDATORY explicit
 * offset ("2024-06-04T12:00:00.123Z" or "...+02:00"). The contract's
 * time-policy conversion accepts safe-integer epoch milliseconds or digit
 * strings — never calendar strings — so the guard layer converts
 * documented calendar fields to epoch milliseconds HERE, BEFORE emission,
 * and the routing layer converts injected RFC 3339 instants to the
 * documented ISO-8601 UTC form on the way OUT.
 *
 * DETERMINISM LAW (byte-determinism): `Date.parse` is NOT used. The
 * ECMAScript specification defines exact parsing only for a narrow form;
 * longer fractions and timezone offsets fall back to
 * implementation-defined behavior. Both parsers below are fully
 * hand-rolled: strict regular shapes, explicit calendar validation (leap
 * years included), explicit offset arithmetic and the days-from-civil
 * algorithm for the epoch conversion — pure integer arithmetic,
 * identical on every host.
 *
 * Documented precision policy: fractional digits beyond milliseconds are
 * TRUNCATED (floor) — a deterministic, lossless-to-the-millisecond
 * policy, recorded here rather than hidden in a parser's rounding mode.
 * Only the `Z` (UTC) designator is accepted for the gateway's own
 * documented fields (the gateway documents UTC instants; a non-UTC
 * designator there is a typed error, not a silent reinterpretation);
 * RFC 3339 inputs accept the full explicit-offset grammar (the
 * execution-lane mirror's documented form).
 */

import { failure, success, type SdkResult } from './contract/errors';
import { isTimestampMs, type TimestampMs } from './contract/timestamp';
import { omsEmsProtocolError } from './protocol';

/** The strict documented ISO-8601 UTC shape: YYYY-MM-DDTHH:MM:SS[.f{1..9}]Z. */
const ISO_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

/** The strict RFC 3339 shape with a MANDATORY explicit offset (the execution-lane mirror's discipline). */
const RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

/** Days in a month, leap years included (proleptic Gregorian). */
function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths: readonly number[] = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
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

/** Validate a civil date; true iff the calendar date exists. */
function isCivilDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/** Validate a wall-clock time (seconds 00..59 — the execution-lane mirror's discipline; leap-second forms are rejected identically by the lane's own timestamp guard). */
function isWallClock(hour: number, minute: number, second: number): boolean {
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;
  return true;
}

/** Milliseconds from the fractional digits, truncated beyond millisecond precision (documented policy). */
function fractionMs(fraction: string | undefined): number {
  if (fraction === undefined) return 0;
  return Number.parseInt(fraction.padEnd(3, '0').slice(0, 3), 10);
}

/** Assemble epoch milliseconds from the calendar parts (pure integer arithmetic). */
function assembleEpochMs(year: number, month: number, day: number, hour: number, minute: number, second: number, ms: number, offsetMinutes: number): TimestampMs {
  const days = daysFromCivil(year, month, day);
  const totalSeconds = days * 86_400 + hour * 3_600 + minute * 60 + second;
  const epochMs = totalSeconds * 1_000 + ms - offsetMinutes * 60_000;
  return epochMs as TimestampMs;
}

function invalidTime(detail: string): SdkResult<never> {
  return failure(omsEmsProtocolError('invalid_time_field', detail));
}

/**
 * Convert one documented ISO-8601 UTC timestamp string
 * ("2024-06-04T12:00:00.123456Z" — the gateway's documented instant form)
 * to epoch milliseconds. Total: every malformed input is a typed failure;
 * the result always satisfies {@link isTimestampMs}. Fractional digits
 * beyond milliseconds are truncated (documented policy — see the module
 * header).
 */
export function isoUtcToMs(value: string): SdkResult<TimestampMs> {
  const match = ISO_UTC_RE.exec(value);
  if (match === null) {
    return invalidTime(`"${value}" is not the documented ISO-8601 UTC form (YYYY-MM-DDTHH:MM:SS[.sss]Z)`);
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);
  const second = Number.parseInt(match[6], 10);
  if (!isCivilDate(year, month, day)) {
    return invalidTime(`"${value}" names a date that does not exist on the calendar`);
  }
  if (!isWallClock(hour, minute, second)) {
    return invalidTime(`"${value}" names a wall-clock time outside 00:00:00..23:59:59`);
  }
  const ms = fractionMs(match[7]);
  const epochMs = assembleEpochMs(year, month, day, hour, minute, second, ms, 0);
  if (!isTimestampMs(epochMs)) {
    return invalidTime(`"${value}" converts outside the representable epoch-millisecond range`);
  }
  return success(epochMs);
}

/**
 * Convert one RFC 3339 timestamp string with a MANDATORY explicit offset
 * (the execution-lane mirror's documented form) to epoch milliseconds.
 * Total: every malformed input is a typed failure. Fractional digits
 * beyond milliseconds are truncated (documented policy). A `Z` designator
 * is UTC; an explicit ±HH:MM offset is applied exactly (pure integer
 * arithmetic).
 */
export function rfc3339ToMs(value: string): SdkResult<TimestampMs> {
  const match = RFC3339_RE.exec(value);
  if (match === null) {
    return invalidTime(`"${value}" is not the RFC 3339 form with a mandatory explicit offset (YYYY-MM-DDTHH:MM:SS[.sss](Z|±HH:MM))`);
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);
  const second = Number.parseInt(match[6], 10);
  if (!isCivilDate(year, month, day)) {
    return invalidTime(`"${value}" names a date that does not exist on the calendar`);
  }
  if (!isWallClock(hour, minute, second)) {
    return invalidTime(`"${value}" names a wall-clock time outside 00:00:00..23:59:59`);
  }
  const offsetDesignator = match[8];
  let offsetMinutes = 0;
  if (offsetDesignator !== 'Z') {
    const offsetMatch = /^([+-])(\d{2}):(\d{2})$/.exec(offsetDesignator);
    if (offsetMatch === null) {
      return invalidTime(`"${value}" carries a malformed UTC offset`);
    }
    const offsetHours = Number.parseInt(offsetMatch[2], 10);
    const offsetMinutesPart = Number.parseInt(offsetMatch[3], 10);
    if (offsetHours > 23 || offsetMinutesPart > 59) {
      return invalidTime(`"${value}" carries a UTC offset outside ±23:59`);
    }
    offsetMinutes = offsetHours * 60 + offsetMinutesPart;
    if (offsetMatch[1] === '-') offsetMinutes = -offsetMinutes;
  }
  const ms = fractionMs(match[7]);
  const epochMs = assembleEpochMs(year, month, day, hour, minute, second, ms, offsetMinutes);
  if (!isTimestampMs(epochMs)) {
    return invalidTime(`"${value}" converts outside the representable epoch-millisecond range`);
  }
  return success(epochMs);
}

/** Zero-pad a non-negative integer to the given width (pure string arithmetic). */
function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Format epoch milliseconds as the documented ISO-8601 UTC form
 * ("YYYY-MM-DDTHH:MM:SS.mssZ"). The INVERSE of {@link isoUtcToMs} (at
 * millisecond precision — the documented truncation policy makes the
 * round trip exact). Total: the input must be a valid epoch-millisecond
 * timestamp.
 */
export function msToIsoUtc(value: TimestampMs): SdkResult<string> {
  if (!isTimestampMs(value)) {
    return invalidTime(`${String(value)} is not a valid epoch-millisecond timestamp`);
  }
  const totalSeconds = Math.floor(value / 1_000);
  const ms = value - totalSeconds * 1_000;
  const days = Math.floor(totalSeconds / 86_400);
  const secondsOfDay = totalSeconds - days * 86_400;
  const hour = Math.floor(secondsOfDay / 3_600);
  const minute = Math.floor((secondsOfDay - hour * 3_600) / 60);
  const second = secondsOfDay - hour * 3_600 - minute * 60;
  // Civil date from days since the epoch (Howard Hinnant's civil_from_days).
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1_460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365); // [0, 399]
  const year = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const dayOfMonth = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp + (mp < 10 ? 3 : -9); // [1, 12]
  const finalYear = month <= 2 ? year + 1 : year;
  return success(
    `${pad(finalYear, 4)}-${pad(month, 2)}-${pad(dayOfMonth, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(ms, 3)}Z`,
  );
}
