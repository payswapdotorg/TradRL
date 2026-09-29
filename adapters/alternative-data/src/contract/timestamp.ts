/**
 * @tradrl/adapter-alternative-data — TimestampMs structural mirror.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/timestamp.ts (law D-004:
 * structural mirrors, never imports — the frozen workspace lockfile
 * forbids package dependencies). DO NOT DIVERGE (law D-004). The canonical `TimestampMs` definition
 * lives in `@tradrl/time-engine`; `@tradrl/market-protocol`,
 * `@tradrl/provenance` (T008), `@tradrl/provider-sdk` (T036) and this
 * adapter (T038) all re-declare the IDENTICAL structural type — same
 * brand, so TypeScript's structural typing keeps the declarations
 * mutually assignable; the interop test fails typecheck if any
 * declaration drifts. The adapter never reads a wall clock.
 */

/**
 * A validated epoch-millisecond timestamp (brand is compile-time only).
 * Construct through `@tradrl/time-engine` or validate untrusted values with
 * {@link isTimestampMs}. The adapter SDK never reads a wall clock: every
 * timestamp in the SDK is injected (scripted timelines, declared fields) —
 * determinism (Work Order T036: behavior is a pure function of the scripted
 * transport).
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
