/**
 * @tradrl/time-engine — canonical timestamp type and arithmetic.
 *
 * This module is the CANONICAL definition of `TimestampMs` for the whole
 * program. `@tradrl/market-protocol` declares a structurally identical mirror
 * (the workspace lockfile forbids a package dependency between the two
 * contract packages); `packages/market-protocol/src/interop.test.ts` asserts
 * that the two declarations remain mutually assignable. Any change here MUST
 * be mirrored there.
 *
 * Representation contract (see contracts/market/04-time-machine-visibility.md):
 * - Epoch milliseconds as a JavaScript number (JSON-safe).
 * - Integer, finite, within [MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS]. The upper
 *   bound is the ECMAScript Date representable range (±8.64e15 ms), so every
 *   valid timestamp can be rendered by `toIso` without overflow.
 * - Sub-millisecond ordering is NOT representable in the timestamp quartet;
 *   it is the job of the per-stream `sequence` field of the market event
 *   envelope.
 * - `TimestampMs` is a branded type: the only way to obtain one is through
 *   the validating constructors in this module. Comparisons must go through
 *   the helpers below (`compareTimestamps`, `isBefore`, ...) so consumer code
 *   never sprinkles raw relational operators over unvalidated numbers.
 */

import { fail, ok, type TimeResult } from './errors';

/**
 * A validated epoch-millisecond timestamp.
 *
 * The brand exists only at compile time; at runtime this is a plain number.
 * Construct via `timestampMs()` / `requireTimestampMs()` / `fromIso()`.
 */
export type TimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };

/** Lower bound of the representable range: the Unix epoch (no pre-1970 data). */
export const MIN_TIMESTAMP_MS = 0;

/** Upper bound of the representable range: the last instant ECMAScript `Date` can represent. */
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999;

/** Runtime type guard for a validated epoch-millisecond timestamp. */
export function isTimestampMs(value: unknown): value is TimestampMs {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_TIMESTAMP_MS &&
    value <= MAX_TIMESTAMP_MS
  );
}

/**
 * Validating constructor for untrusted numeric input.
 * Returns a typed error instead of throwing.
 */
export function timestampMs(value: number): TimeResult<TimestampMs> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('invalid_timestamp', 'timestamp must be a finite number of epoch milliseconds');
  }
  if (!Number.isInteger(value)) {
    return fail('invalid_timestamp', `timestamp must be an integer number of epoch milliseconds, got ${value}`);
  }
  if (value < MIN_TIMESTAMP_MS || value > MAX_TIMESTAMP_MS) {
    return fail(
      'out_of_range',
      `timestamp ${value} is outside the representable range [${MIN_TIMESTAMP_MS}, ${MAX_TIMESTAMP_MS}] epoch ms`,
    );
  }
  return ok(value as TimestampMs);
}

/**
 * Throwing constructor for trusted literals (tests, fixtures, configuration).
 * NOT for untrusted input — use {@link timestampMs} there.
 */
export function requireTimestampMs(value: number): TimestampMs {
  const result = timestampMs(value);
  if (result.ok) return result.value;
  throw new RangeError(`requireTimestampMs: ${result.error.message}`);
}

/** Strict ISO-8601 date-only form: interpreted as UTC midnight per ECMAScript. */
const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict ISO-8601 date-time form with a REQUIRED timezone (`Z` or `±HH:MM`).
 * Naive date-times are rejected: an ambiguous instant is a correctness hazard
 * for the information boundary.
 */
const ISO_ZONED_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Parse a strict ISO-8601 timestamp into a `TimestampMs`. */
export function fromIso(value: string): TimeResult<TimestampMs> {
  if (typeof value !== 'string') {
    return fail('invalid_iso', 'ISO timestamp must be a string');
  }
  let parsed: number;
  if (ISO_DATE_ONLY_RE.test(value)) {
    parsed = Date.parse(value); // date-only forms are UTC midnight in ECMAScript
  } else if (ISO_ZONED_RE.test(value)) {
    parsed = Date.parse(value.includes(' ') ? value.replace(' ', 'T') : value);
  } else {
    return fail(
      'invalid_iso',
      `not a strict ISO-8601 timestamp (zoned date-time or date-only): ${JSON.stringify(value)}`,
    );
  }
  if (!Number.isFinite(parsed)) {
    return fail('invalid_iso', `ISO-8601 string did not parse to a finite instant: ${JSON.stringify(value)}`);
  }
  return timestampMs(parsed);
}

/** Render a timestamp as a UTC ISO-8601 string (millisecond precision). */
export function toIso(value: TimestampMs): string {
  return new Date(value).toISOString();
}

/** Total order over timestamps: -1 if a < b, 0 if equal, 1 if a > b. */
export function compareTimestamps(a: TimestampMs, b: TimestampMs): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Strictly-before comparison. */
export function isBefore(a: TimestampMs, b: TimestampMs): boolean {
  return a < b;
}

/** Strictly-after comparison. */
export function isAfter(a: TimestampMs, b: TimestampMs): boolean {
  return a > b;
}

/** Inclusive at-or-before comparison — the visibility predicate uses this. */
export function isBeforeOrEqual(a: TimestampMs, b: TimestampMs): boolean {
  return a <= b;
}

/** Inclusive at-or-after comparison. */
export function isAfterOrEqual(a: TimestampMs, b: TimestampMs): boolean {
  return a >= b;
}

/** Latest (maximum) of a non-empty list of timestamps. */
export function maxTimestamps(values: readonly TimestampMs[]): TimeResult<TimestampMs> {
  if (values.length === 0) {
    return fail('no_inputs', 'maxTimestamps requires at least one timestamp');
  }
  let max = values[0];
  for (const value of values) {
    if (value > max) max = value;
  }
  return ok(max);
}

/** Earliest (minimum) of a non-empty list of timestamps. */
export function minTimestamps(values: readonly TimestampMs[]): TimeResult<TimestampMs> {
  if (values.length === 0) {
    return fail('no_inputs', 'minTimestamps requires at least one timestamp');
  }
  let min = values[0];
  for (const value of values) {
    if (value < min) min = value;
  }
  return ok(min);
}

/**
 * Explicitly anchor a historical timestamp from validated numeric epoch ms.
 * Intent-revealing alias of {@link timestampMs}.
 */
export function anchorAt(value: number): TimeResult<TimestampMs> {
  return timestampMs(value);
}

/**
 * Explicitly anchor a historical timestamp from a strict ISO-8601 string.
 * Intent-revealing alias of {@link fromIso}.
 */
export function anchorFromIso(value: string): TimeResult<TimestampMs> {
  return fromIso(value);
}
