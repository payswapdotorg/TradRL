/**
 * @tradrl/evaluation-integrity — the dataset axis (Work Order T031).
 *
 * STRUCTURAL MIRROR of @tradrl/evaluation's `DatasetSegment`/`DatasetAxis`
 * (T012, packages/evaluation/src/splits.ts — law D-003/D-004): the ordered,
 * non-overlapping evaluation axis of opaque dataset refs covering half-open
 * windows under regime labels. The integrity service consumes axes to
 * CONSTRUCT splits (walk-forward, purged/embargoed) and to REGISTER
 * quarantines, so the axis shape must not diverge from the evaluation
 * lane's — the interop trip-wire tests prove mutual assignability and
 * guard parity against the REAL @tradrl/evaluation package.
 */

import { deepFreeze, isNonEmptyString, isRecord, isTimestampMs } from './primitives';
import type { TimestampMs } from './primitives';
import { isDataRef } from './ids';
import type { DataRef } from './ids';
import { invalidField, invalidType, missingField, ok, type IntegrityError, type IntegrityResult } from './errors';

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
 * `DatasetAxis`: non-empty, ascending time order, each segment's start >=
 * the previous segment's end, unique refs, non-empty windows.
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

/**
 * Collect-all validation of an untrusted dataset axis (the mirrored T012
 * law, enforced identically here so an axis authored in the evaluation
 * lane validates unchanged in the integrity service). On success the axis
 * is returned narrowed, deeply frozen.
 */
export function validateDatasetAxis(value: unknown, path = 'axis'): IntegrityResult<DatasetAxis> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: IntegrityError[] = [];
  if (value.segments === undefined) {
    return { ok: false, errors: [missingField(`${path}.segments`)] };
  }
  if (!Array.isArray(value.segments)) {
    return { ok: false, errors: [invalidField(`${path}.segments`, 'must be an array of dataset segments')] };
  }
  if (value.segments.length === 0) {
    errors.push(invalidField(`${path}.segments`, 'must be non-empty — an evaluation axis covers at least one segment'));
  }

  const seenRefs = new Set<string>();
  let previousEnd: number | undefined;
  value.segments.forEach((candidate, index) => {
    const segmentPath = `${path}.segments[${index}]`;
    if (!isRecord(candidate)) {
      errors.push(invalidType(`${segmentPath} must be an object`));
      return;
    }
    if (candidate.ref === undefined) {
      errors.push(missingField(`${segmentPath}.ref`));
    } else if (!isDataRef(candidate.ref)) {
      errors.push(invalidField(`${segmentPath}.ref`, 'must be a non-empty dataset ref'));
    } else if (seenRefs.has(candidate.ref)) {
      errors.push(invalidField(`${segmentPath}.ref`, `duplicate dataset ref "${candidate.ref}" — a ref appears once on the axis`));
    } else {
      seenRefs.add(candidate.ref);
    }
    if (candidate.start === undefined) {
      errors.push(missingField(`${segmentPath}.start`));
    } else if (!isTimestampMs(candidate.start)) {
      errors.push(invalidField(`${segmentPath}.start`, 'must be a valid TimestampMs'));
    }
    if (candidate.end === undefined) {
      errors.push(missingField(`${segmentPath}.end`));
    } else if (!isTimestampMs(candidate.end)) {
      errors.push(invalidField(`${segmentPath}.end`, 'must be a valid TimestampMs'));
    }
    if (isTimestampMs(candidate.start) && isTimestampMs(candidate.end) && candidate.end <= candidate.start) {
      errors.push(invalidField(`${segmentPath}.end`, 'must exceed start — segments cover non-empty half-open windows'));
    }
    if (candidate.regime === undefined) {
      errors.push(missingField(`${segmentPath}.regime`));
    } else if (!isNonEmptyString(candidate.regime)) {
      errors.push(invalidField(`${segmentPath}.regime`, 'must be a non-empty regime label'));
    }
    if (isTimestampMs(candidate.start) && previousEnd !== undefined && candidate.start < previousEnd) {
      errors.push(
        invalidField(
          `${segmentPath}.start`,
          `segment ${index} starts at ${candidate.start} before the previous segment ends at ${previousEnd} — the axis is ordered and non-overlapping`,
        ),
      );
    }
    if (isTimestampMs(candidate.end)) previousEnd = candidate.end;
  });

  if (errors.length > 0) return { ok: false, errors };
  return ok(deepFreeze({ segments: (value.segments as readonly DatasetSegment[]).slice() } satisfies DatasetAxis));
}
