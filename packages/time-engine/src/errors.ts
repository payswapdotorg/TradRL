/**
 * @tradrl/time-engine — typed errors and results.
 *
 * Contract packages never throw for untrusted input: every operation that can
 * fail on data returns an explicit {@link TimeResult}. Throwing is reserved for
 * programming errors internal to a caller.
 */

/** Machine-readable failure codes for time-domain operations. */
export type TimeErrorCode =
  /** A value is not a valid epoch-millisecond timestamp (non-number, non-integer, non-finite). */
  | 'invalid_timestamp'
  /** A value is outside the representable timestamp range [0, 2^53 - 1] epoch ms. */
  | 'out_of_range'
  /** A string is not a strict ISO-8601 timestamp with an explicit timezone. */
  | 'invalid_iso'
  /** A duration object is malformed (negative component, non-finite, overflow). */
  | 'invalid_duration'
  /** An empty input set was supplied where at least one element is required. */
  | 'no_inputs'
  /** A clock was moved backwards (time within a run is monotonic). */
  | 'clock_regression'
  /** A clock was advanced beyond its `asOf` information anchor. */
  | 'beyond_as_of'
  /** A playback speed is not a positive finite number. */
  | 'invalid_playback_speed'
  /** A value is not a structurally valid SimulationClock. */
  | 'invalid_clock'
  /** A computation policy is malformed (empty transform id, invalid delay). */
  | 'invalid_policy'
  /** A derived artifact claims availability before its latest input. */
  | 'derived_before_inputs'
  /** A derived artifact carries an empty lineage (no input ids). */
  | 'derived_without_lineage';

/** A single typed time-domain failure. */
export interface TimeError {
  readonly code: TimeErrorCode;
  readonly message: string;
}

/** Explicit success/failure result. No exceptions for data-driven failures. */
export type TimeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TimeError };

/** Construct a failure result. */
export function fail<T = never>(code: TimeErrorCode, message: string): TimeResult<T> {
  return { ok: false, error: { code, message } };
}

/** Construct a success result. */
export function ok<T>(value: T): TimeResult<T> {
  return { ok: true, value };
}
