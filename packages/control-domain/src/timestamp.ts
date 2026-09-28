/**
 * @tradrl/control-domain — timestamp mirror of @tradrl/time-engine.
 *
 * STRUCTURAL MIRROR — DO NOT DIVERGE.
 *
 * The canonical `TimestampMs` definition lives in `@tradrl/time-engine`
 * (packages/time-engine/src/timestamp.ts). The frozen workspace lockfile
 * forbids a package dependency between the two contract packages, so this
 * package re-declares the IDENTICAL structural type (the same discipline as
 * `@tradrl/market-protocol`'s mirror). TypeScript's structural typing makes
 * the declarations mutually assignable; the cross-package test
 * `packages/control-domain/src/interop.test.ts` fails to compile (and fails
 * at runtime on constant and guard parity) if the declarations ever drift.
 *
 * Any change here MUST be mirrored in time-engine (and market-protocol)
 * and vice versa.
 */

/**
 * A validated epoch-millisecond timestamp (brand is compile-time only).
 * All control-plane audit fields (`createdAt`, `updatedAt`) and horizons use
 * this scalar — one time representation across the whole control plane.
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

/**
 * Total order over timestamps: -1 if `a < b`, 0 if equal, 1 if `a > b`.
 * Precondition: both arguments are valid `TimestampMs` values.
 */
export function compareTimestampMs(a: TimestampMs, b: TimestampMs): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}
