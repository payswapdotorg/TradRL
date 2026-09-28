/**
 * @tradrl/time-machine — timestamp mirror of @tradrl/time-engine.
 *
 * STRUCTURAL MIRROR — DO NOT DIVERGE (law D-004, decision D-003).
 *
 * The canonical `TimestampMs` definition lives in `@tradrl/time-engine`
 * (packages/time-engine/src/timestamp.ts); @tradrl/market-protocol,
 * @tradrl/data-ingestion (T008), @tradrl/knowledge-firewall (T026) and this
 * service all re-declare the IDENTICAL structural type. The frozen workspace
 * lockfile forbids a package dependency between contract owners and
 * consumers, so TypeScript structural typing is the sharing mechanism; the
 * vendored T026 reference copy (`src/t026-reference/mirrors.ts`) plus
 * `src/interop.test.ts` are the drift trip wires.
 *
 * Any change here MUST be mirrored in time-engine (and every mirror) and
 * vice versa.
 */

/**
 * A validated epoch-millisecond timestamp (brand is compile-time only).
 * Construct through a validating guard/constructor or validate untrusted
 * values with {@link isTimestampMs}.
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
