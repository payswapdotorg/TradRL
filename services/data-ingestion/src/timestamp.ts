/**
 * @tradrl/data-ingestion — timestamp mirror of @tradrl/time-engine.
 *
 * STRUCTURAL MIRROR — DO NOT DIVERGE.
 *
 * The canonical `TimestampMs` definition lives in `@tradrl/time-engine`
 * (packages/time-engine/src/timestamp.ts); `@tradrl/market-protocol` and
 * `@tradrl/provenance` declare identical mirrors. The frozen workspace
 * lockfile forbids package dependencies between contract owners and their
 * consumers, so this service re-declares the IDENTICAL structural type
 * (the brand string is the compile-time compatibility key).
 * `packages/provenance/src/interop.test.ts` fails to compile (and fails at
 * runtime on constant/guard parity) if any declaration drifts.
 *
 * Any change here MUST be mirrored in time-engine, market-protocol and
 * provenance, and vice versa.
 */

/**
 * A validated epoch-millisecond timestamp (brand is compile-time only).
 * Construct through `@tradrl/time-engine` or validate untrusted values
 * with {@link isTimestampMs}.
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
