/**
 * @tradrl/adapter-oms-ems — TimestampMs structural mirror.
 *
 * STRUCTURAL MIRROR — DO NOT DIVERGE (law D-004). The canonical
 * `TimestampMs` definition lives in `@tradrl/time-engine`
 * (packages/time-engine/src/timestamp.ts); `@tradrl/market-protocol`,
 * `@tradrl/provenance` (T008), `@tradrl/provider-sdk` (T036) and this
 * adapter (T039) all re-declare the IDENTICAL structural type — same
 * brand, so TypeScript's structural typing keeps the declarations
 * mutually assignable; the interop test fails `pnpm typecheck` (package
 * tsconfig) and the package test run if any declaration drifts.
 *
 * The adapter never reads a wall clock: every timestamp is injected
 * (scripted transport timelines, documented raw time fields converted
 * deterministically) — determinism (Work Order T039: same scripted
 * transport -> byte-identical canonical emission stream).
 */

/**
 * A validated epoch-millisecond timestamp (brand is compile-time only).
 * Validate untrusted values with {@link isTimestampMs}.
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
