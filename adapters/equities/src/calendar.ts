/**
 * @tradrl/adapter-equities — the declared trading calendar (session semantics).
 *
 * Work Order T038 (scope): "mapping table with the source-time policy
 * (index dissemination time vs receive session, calendar/session
 * semantics declared)"; acceptance criterion 9: "sequencing/calendar laws
 * honored (equities session calendars declared ...)". THIS module is the
 * declaration: a UTC trading calendar — which ISO weekdays carry a
 * session, and the session windows (UTC milliseconds-of-day) — plus PURE
 * assessment functions. The guard transport ENFORCES the declared
 * calendar:
 *
 *   - channel "indexLevel" (intraday dissemination, declared
 *     near-realtime): every dissemination instant must fall within a
 *     declared session window on a declared session day — an out-of-
 *     calendar intraday dissemination is a typed session_calendar_violation;
 *   - channel "constituentWeights": every trade date must be a declared
 *     session day (reconstitution data is valued on trading days);
 *   - channel "corporateActions": NOT calendar-bound by declaration —
 *     corporate actions are announced around the clock (the declaration
 *     says which channels the calendar governs; it is data, not ambient
 *     law).
 *
 * DETERMINISM: no Date object, no locale, no timezone database — the
 * calendar math is hand-rolled pure integer arithmetic over the epoch
 * (the epoch is UTC-aligned by ECMAScript definition, so UTC
 * milliseconds-of-day and day-of-week are exact):
 *   - ms-of-day  = t mod 86_400_000;
 *   - day index  = floor(t / 86_400_000)  (day 0 = 1970-01-01, a Thursday);
 *   - ISO dow    = ((day index + 3) mod 7) + 1  (1 = Monday .. 7 = Sunday);
 *   - civil dates use the days-from-civil algorithm (proleptic
 *     Gregorian, pure integer arithmetic — the same discipline as the
 *     coinbase adapter's ISO parser, law: byte-determinism).
 *
 * The declaration is validated (collect-all) and deep-frozen; runtime
 * hosts may redeclare tighter calendars — the assessment stays pure.
 */

import { invalidField, isNonEmptyString, isPositiveSafeInteger, isRecord, missingField } from './contract/fields';
import type { SdkFieldError } from './contract/errors';
import { isTimestampMs, type TimestampMs } from './contract/timestamp';
import { deepFreeze } from './contract/freeze';

/** One declared trading session window (UTC milliseconds-of-day). */
export interface SessionWindow {
  /** Opaque session identifier (e.g. "us-regular"). */
  readonly session_id: string;
  /** Window open, UTC milliseconds-of-day (0..86_399_999). */
  readonly opens_utc_ms: number;
  /** Window close, UTC milliseconds-of-day (0..86_399_999, > open). */
  readonly closes_utc_ms: number;
}

/** A declared UTC trading calendar: session days + session windows. */
export interface TradingCalendar {
  /** The calendar's declared timezone. UTC only — determinism law. */
  readonly timezone: 'UTC';
  /** ISO weekdays that carry a session (1 = Monday .. 7 = Sunday). Unique, non-empty. */
  readonly session_days: readonly number[];
  /** The declared session windows. Non-empty, unique ids. */
  readonly sessions: readonly SessionWindow[];
}

/** The strict documented trade-date shape: YYYY-MM-DD. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

/** The ISO day-of-week (1 = Monday .. 7 = Sunday) of an epoch day index. */
function isoDowOfDayIndex(dayIndex: number): number {
  return (((dayIndex % 7) + 3) % 7) + 1;
}

/** Parse a strict YYYY-MM-DD date to its epoch day index, or null when malformed. */
function dayIndexOfDate(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const LENGTHS: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const LEAP = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (month < 1 || month > 12) return null;
  const maxDay = month === 2 && LEAP ? 29 : LENGTHS[month - 1];
  if (day < 1 || day > maxDay) return null;
  return daysFromCivil(year, month, day);
}

/** Validate an untrusted value as a TradingCalendar (collect-all; frozen). */
export function validateTradingCalendar(value: unknown): { readonly ok: true; readonly value: TradingCalendar } | { readonly ok: false; readonly errors: readonly SdkFieldError[] } {
  const errors: SdkFieldError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidField('trading_calendar', 'must be an object')] };
  }

  if (value.timezone !== 'UTC') {
    errors.push(invalidField('timezone', 'must be "UTC" — the calendar math is deterministic UTC (no timezone database)'));
  }

  if (value.session_days === undefined) {
    errors.push(missingField('session_days'));
  } else if (!Array.isArray(value.session_days) || value.session_days.length === 0) {
    errors.push(invalidField('session_days', 'must be a non-empty array of ISO weekdays (1 = Monday .. 7 = Sunday)'));
  } else {
    const seen = new Set<number>();
    for (const day of value.session_days) {
      if (typeof day !== 'number' || !Number.isSafeInteger(day) || day < 1 || day > 7) {
        errors.push(invalidField('session_days', 'every session day must be an ISO weekday (1 = Monday .. 7 = Sunday)'));
        break;
      }
      if (seen.has(day)) {
        errors.push(invalidField('session_days', `duplicate session day ${day}`));
        break;
      }
      seen.add(day);
    }
  }

  if (value.sessions === undefined) {
    errors.push(missingField('sessions'));
  } else if (!Array.isArray(value.sessions) || value.sessions.length === 0) {
    errors.push(invalidField('sessions', 'must be a non-empty array of session windows'));
  } else {
    const seenIds = new Set<string>();
    value.sessions.forEach((session, index) => {
      const path = `sessions[${index}]`;
      if (!isRecord(session)) {
        errors.push(invalidField(path, 'must be an object with session_id, opens_utc_ms and closes_utc_ms'));
        return;
      }
      if (!isNonEmptyString(session.session_id)) {
        errors.push(invalidField(`${path}.session_id`, 'must be a non-empty string'));
      } else if (seenIds.has(session.session_id)) {
        errors.push(invalidField(`${path}.session_id`, `duplicate session id "${session.session_id}"`));
      } else {
        seenIds.add(session.session_id);
      }
      if (!isPositiveSafeInteger(session.opens_utc_ms) || session.opens_utc_ms >= 86_400_000) {
        errors.push(invalidField(`${path}.opens_utc_ms`, 'must be a UTC millisecond-of-day (0..86_399_999)'));
      }
      if (!isPositiveSafeInteger(session.closes_utc_ms) || session.closes_utc_ms >= 86_400_000) {
        errors.push(invalidField(`${path}.closes_utc_ms`, 'must be a UTC millisecond-of-day (0..86_399_999)'));
      }
      if (
        isPositiveSafeInteger(session.opens_utc_ms) && isPositiveSafeInteger(session.closes_utc_ms) &&
        session.opens_utc_ms >= session.closes_utc_ms
      ) {
        errors.push(invalidField(`${path}.closes_utc_ms`, 'must be greater than opens_utc_ms'));
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(value as unknown as TradingCalendar) as unknown as TradingCalendar };
}

const calendarConstruction = validateTradingCalendar({
  timezone: 'UTC',
  session_days: [1, 2, 3, 4, 5], // Monday..Friday
  sessions: [
    {
      // The US regular trading session expressed in UTC: 13:30..20:00.
      session_id: 'us-regular',
      opens_utc_ms: 48_600_000,
      closes_utc_ms: 72_000_000,
    },
  ],
});

if (!calendarConstruction.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`EQUITIES_SESSION_CALENDAR is invalid: ${calendarConstruction.errors.map((error) => error.message).join('; ')}`);
}

/**
 * The declared, validated, deep-frozen UTC trading calendar of the
 * licensed index feed (session days Monday..Friday, US regular session
 * 13:30..20:00 UTC).
 */
export const EQUITIES_SESSION_CALENDAR: TradingCalendar = calendarConstruction.value;

/** True iff the strict YYYY-MM-DD date is a declared session day of the calendar. */
export function isSessionDay(calendar: TradingCalendar, date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const dayIndex = dayIndexOfDate(date);
  if (dayIndex === null) return false;
  return (calendar.session_days as readonly number[]).includes(isoDowOfDayIndex(dayIndex));
}

/**
 * The epoch day index of a strict YYYY-MM-DD date, or null when the date
 * is malformed or not a real civil date (pure integer arithmetic — the
 * guard compares a record's trade date against its dissemination
 * instant's UTC day).
 */
export function tradeDateDayIndex(date: string): number | null {
  if (!DATE_RE.test(date)) return null;
  return dayIndexOfDate(date);
}

/** The epoch UTC day index of an instant (day 0 = 1970-01-01). */
export function utcDayIndexAt(at: TimestampMs): number {
  return Math.floor(at / 86_400_000);
}

/** True iff the instant is a valid timestamp on a declared session day. */
export function isSessionInstantDay(calendar: TradingCalendar, at: TimestampMs): boolean {
  if (!isTimestampMs(at)) return false;
  const dayIndex = Math.floor(at / 86_400_000);
  return (calendar.session_days as readonly number[]).includes(isoDowOfDayIndex(dayIndex));
}

/**
 * The declared session window an instant falls within, or null. Pure:
 * hand-rolled UTC milliseconds-of-day + day-of-week (determinism law —
 * no Date object, no locale).
 */
export function tradingSessionOf(calendar: TradingCalendar, at: TimestampMs): string | null {
  if (!isTimestampMs(at)) return null;
  const dayIndex = Math.floor(at / 86_400_000);
  if (!(calendar.session_days as readonly number[]).includes(isoDowOfDayIndex(dayIndex))) return null;
  const msOfDay = at % 86_400_000;
  for (const window of calendar.sessions) {
    if (msOfDay >= window.opens_utc_ms && msOfDay < window.closes_utc_ms) {
      return window.session_id;
    }
  }
  return null;
}

/** True iff the instant falls within a declared session on a declared session day. */
export function isTradingInstant(calendar: TradingCalendar, at: TimestampMs): boolean {
  return tradingSessionOf(calendar, at) !== null;
}
