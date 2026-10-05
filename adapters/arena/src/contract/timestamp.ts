/**
 * @tradrl/adapter-arena — the epoch-millisecond instant.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/timestamp.ts (canonical
 * owner: @tradrl/time-engine; law D-004: structural mirrors, never
 * imports). No ambient clock anywhere: every instant the adapter
 * consumes is an explicit parameter (L4).
 */

/** An epoch-millisecond instant — STRUCTURAL MIRROR of @tradrl/time-engine (the SDK's brand, verbatim). */
export type TimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };

/** The representable instant floor (1970-01-01T00:00:00Z). */
export const MIN_TIMESTAMP_MS = 0 as TimestampMs;

/** The representable instant ceiling (the program-wide mirror constant, ~year 275760). */
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999 as TimestampMs;

/** Guard: `TimestampMs` (integer epoch ms within the representable window). */
export function isTimestampMs(value: unknown): value is TimestampMs {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= (MIN_TIMESTAMP_MS as number) &&
    value <= (MAX_TIMESTAMP_MS as number)
  );
}
