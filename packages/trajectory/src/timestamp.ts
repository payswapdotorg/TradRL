/**
 * @tradrl/trajectory — the `TimestampMs` structural mirror.
 *
 * `@tradrl/time-engine` (T004, merged) is the CANONICAL owner of `TimestampMs`.
 * The workspace lockfile forbids a package dependency between contract
 * packages, so this package declares a structurally identical MIRROR — same
 * brand literal, same bounds, same guard behavior — exactly as
 * `@tradrl/market-protocol` does (see its `src/timestamp.ts` and the
 * trip-wire `src/interop.test.ts`). The interop test in THIS package asserts
 * that the two declarations remain mutually assignable. Any change to the
 * canonical type MUST be mirrored here in the same change.
 *
 * Representation contract (identical to the canonical one):
 * - Epoch milliseconds as a JavaScript number (JSON-safe).
 * - Integer, finite, within [MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS].
 * - Sub-millisecond ordering is not representable here; per-stream sequence
 *   fields (owned by the market/environment lanes) carry it.
 */

import { fail, ok, type TrajectoryResult } from './errors';

/**
 * A validated epoch-millisecond timestamp — structural mirror of the
 * canonical `@tradrl/time-engine` `TimestampMs`. The brand literal
 * `'TradRL.TimestampMs'` is deliberately IDENTICAL so the two types are
 * mutually assignable (verified by the interop trip-wire test).
 */
export type TimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };

/** Mirror of the canonical lower bound: the Unix epoch (no pre-1970 data). */
export const MIN_TIMESTAMP_MS = 0;

/** Mirror of the canonical upper bound: the ECMAScript `Date` representable limit. */
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999;

/** Runtime type guard — behaviorally identical to the canonical guard. */
export function isTimestampMs(value: unknown): value is TimestampMs {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_TIMESTAMP_MS &&
    value <= MAX_TIMESTAMP_MS
  );
}

/** Validating constructor for untrusted numeric input. Returns a typed error. */
export function timestampMs(value: number): TrajectoryResult<TimestampMs> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('invalid_timestamp', 'timestamp must be a finite number of epoch milliseconds');
  }
  if (!Number.isInteger(value)) {
    return fail('invalid_timestamp', `timestamp must be an integer number of epoch milliseconds, got ${value}`);
  }
  if (value < MIN_TIMESTAMP_MS || value > MAX_TIMESTAMP_MS) {
    return fail(
      'invalid_timestamp',
      `timestamp ${value} is outside the representable range [${MIN_TIMESTAMP_MS}, ${MAX_TIMESTAMP_MS}] epoch ms`,
    );
  }
  return ok(value as TimestampMs);
}

/** Throwing constructor for trusted literals (tests, fixtures). */
export function requireTimestampMs(value: number): TimestampMs {
  const result = timestampMs(value);
  if (result.ok) return result.value;
  throw new RangeError(`requireTimestampMs: ${result.error.message}`);
}
