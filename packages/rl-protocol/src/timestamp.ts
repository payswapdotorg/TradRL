/**
 * @tradrl/rl-protocol — timestamp mirror of @tradrl/time-engine.
 *
 * STRUCTURAL MIRROR — DO NOT DIVERGE.
 *
 * The canonical `TimestampMs` definition lives in `@tradrl/time-engine`
 * (packages/time-engine/src/timestamp.ts); `@tradrl/environment-protocol`,
 * `@tradrl/trajectory` and `@tradrl/experiments` all re-declare the IDENTICAL
 * structural type (program decision D-004). This package joins that mirror
 * family: the frozen workspace lockfile forbids package dependencies between
 * contract lanes, so the identical type is re-declared here. TypeScript's
 * structural typing keeps the declarations mutually assignable;
 * src/interop.test.ts is the drift trip wire (it fails `pnpm typecheck` and
 * `pnpm test` against the REAL packages present on this branch).
 *
 * Any change here MUST be mirrored in time-engine (and the sibling mirrors)
 * and vice versa.
 */

/**
 * A validated epoch-millisecond timestamp (brand is compile-time only).
 * Construct through `@tradrl/time-engine` (`timestampMs`, `fromIso`, ...)
 * or validate untrusted values with {@link isTimestampMs}. Every instant in
 * this package is an explicit parameter — there is no ambient clock
 * anywhere (`Date.now()` never appears).
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
 * Validating constructor for untrusted numeric input (typed error, never
 * throws). Mirrors the semantics of time-engine's `timestampMs`.
 */
export function timestampMs(value: number): { ok: true; value: TimestampMs } | { ok: false; message: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, message: 'timestamp must be a finite number of epoch milliseconds' };
  }
  if (!Number.isInteger(value)) {
    return { ok: false, message: `timestamp must be an integer number of epoch milliseconds, got ${value}` };
  }
  if (value < MIN_TIMESTAMP_MS || value > MAX_TIMESTAMP_MS) {
    return {
      ok: false,
      message: `timestamp ${value} is outside the representable range [${MIN_TIMESTAMP_MS}, ${MAX_TIMESTAMP_MS}] epoch ms`,
    };
  }
  return { ok: true, value: value as TimestampMs };
}

/**
 * Throwing constructor for trusted literals (tests, fixtures, configuration).
 * NOT for untrusted input — use {@link isTimestampMs} there.
 */
export function requireTimestampMs(value: number): TimestampMs {
  const result = timestampMs(value);
  if (result.ok) return result.value;
  throw new RangeError(`requireTimestampMs: ${result.message}`);
}
