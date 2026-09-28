/**
 * @tradrl/provider-sdk — TimestampMs structural mirror.
 *
 * STRUCTURAL MIRROR — DO NOT DIVERGE (law D-004).
 *
 * The canonical `TimestampMs` definition lives in `@tradrl/time-engine`
 * (packages/time-engine/src/timestamp.ts); `@tradrl/market-protocol`,
 * `@tradrl/provenance` (T008), the ingestion plane (T008) and this package
 * all re-declare the IDENTICAL structural type. TypeScript's structural
 * typing makes the declarations mutually assignable; the cross-package
 * interop test (`src/interop.test.ts`) fails `pnpm typecheck` and
 * `pnpm test` if any declaration drifts.
 *
 * Any change here MUST be mirrored in time-engine (and every mirror) and
 * vice versa.
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
