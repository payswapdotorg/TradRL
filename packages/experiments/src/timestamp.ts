/**
 * @tradrl/experiments — timestamp mirror of @tradrl/time-engine.
 *
 * STRUCTURAL MIRROR — DO NOT DIVERGE.
 *
 * The canonical `TimestampMs` definition lives in `@tradrl/time-engine`
 * (packages/time-engine/src/timestamp.ts). The frozen workspace lockfile
 * forbids a package dependency between contract packages, so this package
 * re-declares the IDENTICAL structural type (the same discipline as
 * `@tradrl/market-protocol`, `@tradrl/environment-protocol` and
 * `@tradrl/agent-os`; program decision D-003/D-004). TypeScript's structural
 * typing makes the declarations mutually assignable; the cross-package test
 * `packages/experiments/src/interop.test.ts` fails to compile (and fails at
 * runtime on constant parity) if the declarations ever diverge.
 *
 * Any change here MUST be mirrored in time-engine (and the sibling contract
 * packages) and vice versa.
 */

/**
 * A validated epoch-millisecond timestamp (brand is compile-time only).
 * Construct through `@tradrl/time-engine` (`timestampMs`, `fromIso`, ...) or
 * validate untrusted values with {@link isTimestampMs}.
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
