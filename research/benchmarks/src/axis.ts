/**
 * @tradrl/research-benchmarks — the dataset axis (Work Order T032).
 *
 * STRUCTURAL MIRROR of @tradrl/evaluation's `DatasetSegment`/`DatasetAxis`
 * (T012; identically re-declared by @tradrl/evaluation-integrity T031 and
 * @tradrl/evaluation-splits T032; law D-003/D-004): the ordered,
 * non-overlapping evaluation axis of opaque dataset refs covering half-open
 * windows under regime labels. The benchmark suite consumes axes through
 * its split-plan mirror (the plans' window and holdout segments ARE axis
 * segments), so the axis shape must not diverge from the evaluation lane's
 * — the interop trip-wire tests prove mutual assignability and guard
 * parity against the REAL packages in this tree.
 */

import { deepFreeze, isNonEmptyString, isRecord, isTimestampMs } from './primitives';
import type { TimestampMs } from './primitives';
import { isDataRef } from './ids';
import type { DataRef } from './ids';

/**
 * One segment of the evaluation axis: an opaque dataset ref covering the
 * half-open interval [start, end) under a regime label. MIRROR of T012's
 * `DatasetSegment` (field-for-field).
 */
export interface DatasetSegment {
  readonly ref: DataRef;
  readonly start: TimestampMs;
  /** Exclusive end of the segment's coverage window. */
  readonly end: TimestampMs;
  readonly regime: string;
}

/**
 * The ordered, non-overlapping evaluation axis. MIRROR of T012's
 * `DatasetAxis`.
 */
export interface DatasetAxis {
  readonly segments: readonly DatasetSegment[];
}

/** Guard: `DatasetSegment` (the mirrored structural law). */
export function isDatasetSegment(v: unknown): v is DatasetSegment {
  if (!isRecord(v)) return false;
  if (!isDataRef(v.ref)) return false;
  if (!isTimestampMs(v.start) || !isTimestampMs(v.end)) return false;
  if (v.end <= v.start) return false;
  return isNonEmptyString(v.regime);
}

/** Guard: `DatasetAxis` (the mirrored ordering/non-overlap laws). */
export function isDatasetAxis(v: unknown): v is DatasetAxis {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.segments) || v.segments.length === 0) return false;
  const seenRefs = new Set<string>();
  let previousEnd: number | undefined;
  for (const segment of v.segments) {
    if (!isDatasetSegment(segment)) return false;
    if (seenRefs.has(segment.ref)) return false;
    seenRefs.add(segment.ref);
    if (previousEnd !== undefined && segment.start < previousEnd) return false;
    previousEnd = segment.end;
  }
  return true;
}
