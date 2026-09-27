/**
 * @tradrl/market-protocol — timestamp mirror of @tradrl/time-engine.
 *
 * STRUCTURAL MIRROR — DO NOT DIVERGE.
 *
 * The canonical `TimestampMs` definition lives in `@tradrl/time-engine`
 * (packages/time-engine/src/timestamp.ts). The frozen workspace lockfile
 * forbids a package dependency between the two contract packages, so this
 * package re-declares the IDENTICAL structural type. TypeScript's structural
 * typing makes the two declarations mutually assignable; the cross-package
 * test `packages/market-protocol/src/interop.test.ts` fails to compile (and
 * fails at runtime on constant parity) if the declarations ever diverge.
 *
 * Any change here MUST be mirrored in time-engine and vice versa.
 */

/**
 * A validated epoch-millisecond timestamp (brand is compile-time only).
 * Construct through `@tradrl/time-engine` (`timestampMs`, `requireTimestampMs`,
 * `fromIso`) or validate untrusted values with {@link isTimestampMs}.
 */
export type TimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };

/** Lower bound of the representable range (the Unix epoch). Mirror of time-engine. */
export const MIN_TIMESTAMP_MS = 0;

/** Upper bound of the representable range (last ECMAScript Date instant). Mirror of time-engine. */
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999;

/** Runtime guard — mirrors `isTimestampMs` from @tradrl/time-engine. */
export function isTimestampMs(value: unknown): value is TimestampMs {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_TIMESTAMP_MS &&
    value <= MAX_TIMESTAMP_MS
  );
}
