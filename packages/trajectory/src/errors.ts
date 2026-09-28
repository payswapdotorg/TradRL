/**
 * @tradrl/trajectory — typed errors and results.
 *
 * Contract packages never throw for untrusted input: every operation that can
 * fail on data returns an explicit {@link TrajectoryResult}. Throwing is
 * reserved for programming errors internal to a caller. This mirrors the
 * error discipline of `@tradrl/time-engine` (the pattern this package's
 * leakage-forensics mirror extends).
 */

/** Machine-readable failure codes for trajectory-domain operations. */
export type TrajectoryErrorCode =
  /** A branded id is not a non-empty string. */
  | 'invalid_id'
  /** A value is not a valid epoch-millisecond timestamp. */
  | 'invalid_timestamp'
  /** A clock sample violates the `now <= asOf` invariant. */
  | 'invalid_clock_sample'
  /** A trajectory step is structurally invalid (observations/action/result). */
  | 'invalid_step'
  /** A trajectory metadata block is structurally invalid. */
  | 'invalid_metadata'
  /** A lineage reference list is empty or contains duplicates. */
  | 'invalid_lineage'
  /** A step id duplicates an id already present in the trajectory. */
  | 'duplicate_step'
  /** Serialized text is not parseable JSON or not a canonical trajectory. */
  | 'invalid_serialization'
  /** A value is not a JSON-safe opaque payload. */
  | 'invalid_payload';

/** A single typed trajectory-domain failure. */
export interface TrajectoryError {
  readonly code: TrajectoryErrorCode;
  readonly message: string;
}

/** Explicit success/failure result. No exceptions for data-driven failures. */
export type TrajectoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TrajectoryError };

/** Construct a failure result. */
export function fail<T = never>(code: TrajectoryErrorCode, message: string): TrajectoryResult<T> {
  return { ok: false, error: { code, message } };
}

/** Construct a success result. */
export function ok<T>(value: T): TrajectoryResult<T> {
  return { ok: true, value };
}
