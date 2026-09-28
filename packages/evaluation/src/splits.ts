/**
 * @tradrl/evaluation — split policies: pure functions over opaque dataset refs.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md ("Generalization: Use unseen
 * periods, regimes, assets, venues or combinations not optimized against";
 * "Selection integrity: ... Use walk-forward and purged/embargoed designs
 * where appropriate"), spec/ARCHITECTURE.md "Evaluation" (blind/unseen,
 * walk-forward, regime tests), ARCHITECTURE-LOCK L4 (point-in-time truth —
 * every axis boundary is a TimestampMs), L11 (in-search vs holdout must
 * always be decidable — the policies below ARE the discriminator).
 *
 * Design laws:
 * - Datasets are OPAQUE refs (`DataRef`, the T011 trajectory-package brand
 *   mirror). A split never sees payloads, sizes or contents — only the
 *   ordered, non-overlapping segment axis with its time boundaries and
 *   regime labels. Purity follows: the same (axis, policy) pair ALWAYS
 *   produces the deeply-equal, deeply-frozen split.
 * - Boundary behavior is fail-closed and typed, never silent:
 *   * walk-forward over an axis too short for one complete window ->
 *     `window_exhaustion`;
 *   * a blind-holdout mask that would blind everything or nothing ->
 *     `degenerate_mask`;
 *   * a regime partition that selects no segment -> `empty_regime`
 *     (an empty regime cannot support a verdict).
 * - Every policy carries a `SplitPolicyRef` id — the opaque handle the
 *   T011 experiment design's `splits` array and the T007 evaluation policy
 *   (blind/walk-forward/regime refs) reference. Policies are DATA; the
 *   split functions below are the total interpreters of that data.
 */

import { deepFreeze, isNonEmptyString, isNonNegativeInteger, isPositiveInteger, isRecord, isTimestampMs, type TimestampMs } from './primitives';
import { isDataRef, isSplitPolicyRef, type DataRef, type SplitPolicyRef } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type EvalError, type EvalErrorCode, type EvalResult } from './errors';

// ---------------------------------------------------------------------------
// The dataset axis
// ---------------------------------------------------------------------------

/**
 * One segment of the evaluation axis: an opaque dataset ref covering the
 * half-open interval [start, end) under a regime label. `regime` is a
 * non-empty opaque string (e.g. "bull", "high-vol", "crisis") owned by the
 * regime taxonomy, never interpreted here.
 */
export interface DatasetSegment {
  readonly ref: DataRef;
  readonly start: TimestampMs;
  /** Exclusive end of the segment's coverage window. */
  readonly end: TimestampMs;
  readonly regime: string;
}

/**
 * The ordered, non-overlapping evaluation axis: a non-empty sequence of
 * dataset segments in ascending time order (each segment's `start` >= the
 * previous segment's `end`; no zero-length segments; unique refs).
 */
export interface DatasetAxis {
  readonly segments: readonly DatasetSegment[];
}

/** Guard: `DatasetSegment`. */
export function isDatasetSegment(v: unknown): v is DatasetSegment {
  if (!isRecord(v)) return false;
  if (!isDataRef(v.ref)) return false;
  if (!isTimestampMs(v.start) || !isTimestampMs(v.end)) return false;
  if (v.end <= v.start) return false;
  return isNonEmptyString(v.regime);
}

/** Guard: `DatasetAxis` (includes the ordering/non-overlap laws). */
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
 * Collect-all validation of an untrusted dataset axis. Enforces: non-empty
 * segment list, half-open non-empty windows, unique refs, ascending
 * non-overlapping order, non-empty regime labels. On success the axis is
 * returned deeply frozen.
 */
export function validateDatasetAxis(value: unknown, path = 'axis'): EvalResult<DatasetAxis> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: EvalError[] = [];
  if (value.segments === undefined) {
    errors.push(missingField(`${path}.segments`));
    return { ok: false, errors };
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
  return ok(deepFreeze({ segments: value.segments.slice() } satisfies DatasetAxis));
}

// ---------------------------------------------------------------------------
// Split policies (DATA — the total interpreters live below)
// ---------------------------------------------------------------------------

/**
 * Walk-forward policy: anchored expanding-window walk-forward. Windows are
 * generated for test indices `minTrainSegments, minTrainSegments +
 * stepSegments, ...` while a test segment exists; the train set of window i
 * is the PREFIX of the axis (segments [0, i)) — anchored (expanding), never
 * sliding, so later windows never forget earlier history.
 */
export interface WalkForwardPolicy {
  readonly kind: 'walk-forward';
  readonly policyId: SplitPolicyRef;
  /** Number of leading segments the first train set must contain (>= 1). */
  readonly minTrainSegments: number;
  /** How many segments the test boundary advances per window (>= 1). */
  readonly stepSegments: number;
}

/**
 * Blind holdout policy: the LAST `holdoutCount` segments of the axis are
 * masked blind (unseen); the leading prefix stays visible. `holdoutCount`
 * must leave BOTH parts non-empty (>= 1 and <= segments - 1) — a mask that
 * blinds everything or nothing is degenerate and fails typed.
 */
export interface BlindHoldoutPolicy {
  readonly kind: 'blind-holdout';
  readonly policyId: SplitPolicyRef;
  /** Number of trailing segments masked blind (>= 1, <= segments - 1). */
  readonly holdoutCount: number;
}

/**
 * Regime partition policy: selects every segment labeled with `regime`.
 * Selecting no segment is a typed failure (`empty_regime`) — an empty
 * regime cannot support a verdict.
 */
export interface RegimePartitionPolicy {
  readonly kind: 'regime-partition';
  readonly policyId: SplitPolicyRef;
  readonly regime: string;
}

/** The closed split-policy vocabulary (discriminated by `kind`). */
export type SplitPolicy = WalkForwardPolicy | BlindHoldoutPolicy | RegimePartitionPolicy;

/** Runtime-checkable list of split-policy kinds. */
export const SPLIT_POLICY_KINDS: readonly SplitPolicy['kind'][] = ['walk-forward', 'blind-holdout', 'regime-partition'] as const;

/** Guard: `WalkForwardPolicy`. */
export function isWalkForwardPolicy(v: unknown): v is WalkForwardPolicy {
  if (!isRecord(v)) return false;
  if (v.kind !== 'walk-forward') return false;
  if (!isSplitPolicyRef(v.policyId)) return false;
  if (!isPositiveInteger(v.minTrainSegments)) return false;
  return isPositiveInteger(v.stepSegments);
}

/** Guard: `BlindHoldoutPolicy`. */
export function isBlindHoldoutPolicy(v: unknown): v is BlindHoldoutPolicy {
  if (!isRecord(v)) return false;
  if (v.kind !== 'blind-holdout') return false;
  if (!isSplitPolicyRef(v.policyId)) return false;
  return isPositiveInteger(v.holdoutCount);
}

/** Guard: `RegimePartitionPolicy`. */
export function isRegimePartitionPolicy(v: unknown): v is RegimePartitionPolicy {
  if (!isRecord(v)) return false;
  if (v.kind !== 'regime-partition') return false;
  if (!isSplitPolicyRef(v.policyId)) return false;
  return isNonEmptyString(v.regime);
}

/** Guard: `SplitPolicy` (any kind). */
export function isSplitPolicy(v: unknown): v is SplitPolicy {
  return isWalkForwardPolicy(v) || isBlindHoldoutPolicy(v) || isRegimePartitionPolicy(v);
}

/** Collect-all validation of one untrusted split policy. */
export function validateSplitPolicy(value: unknown, path = 'policy'): EvalResult<SplitPolicy> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: EvalError[] = [];
  if (value.kind === undefined) {
    errors.push(missingField(`${path}.kind`));
  } else if (!SPLIT_POLICY_KINDS.includes(value.kind as SplitPolicy['kind'])) {
    errors.push(invalidField(`${path}.kind`, `must be one of ${SPLIT_POLICY_KINDS.join(' | ')}`));
  }
  if (value.policyId === undefined) {
    errors.push(missingField(`${path}.policyId`));
  } else if (!isSplitPolicyRef(value.policyId)) {
    errors.push(invalidField(`${path}.policyId`, 'must be a non-empty split policy ref'));
  }

  if (isRecord(value) && typeof value.kind === 'string') {
    switch (value.kind as SplitPolicy['kind']) {
      case 'walk-forward': {
        if (value.minTrainSegments === undefined) errors.push(missingField(`${path}.minTrainSegments`));
        else if (!isPositiveInteger(value.minTrainSegments)) errors.push(invalidField(`${path}.minTrainSegments`, 'must be an integer >= 1'));
        if (value.stepSegments === undefined) errors.push(missingField(`${path}.stepSegments`));
        else if (!isPositiveInteger(value.stepSegments)) errors.push(invalidField(`${path}.stepSegments`, 'must be an integer >= 1'));
        break;
      }
      case 'blind-holdout': {
        if (value.holdoutCount === undefined) errors.push(missingField(`${path}.holdoutCount`));
        else if (!isPositiveInteger(value.holdoutCount)) errors.push(invalidField(`${path}.holdoutCount`, 'must be an integer >= 1'));
        break;
      }
      case 'regime-partition': {
        if (value.regime === undefined) errors.push(missingField(`${path}.regime`));
        else if (!isNonEmptyString(value.regime)) errors.push(invalidField(`${path}.regime`, 'must be a non-empty regime label'));
        break;
      }
      default:
        break;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return ok(deepFreeze(value as unknown as SplitPolicy));
}

// ---------------------------------------------------------------------------
// The split interpreters (pure, total, fail-closed)
// ---------------------------------------------------------------------------

/** One walk-forward window: the anchored train prefix and its held-out test segment. */
export interface WalkForwardWindow {
  /** Train segments: the axis prefix before the test segment (non-empty). */
  readonly train: readonly DatasetSegment[];
  /** The held-out test segment (never in any train set of this policy). */
  readonly test: DatasetSegment;
}

/**
 * Compute the anchored expanding-window walk-forward split of an axis.
 *
 * Windows are generated for test index i = minTrainSegments,
 * minTrainSegments + stepSegments, ... while i < segments.length; window i's
 * train set is segments[0, i) and its test segment is segments[i]. The first
 * train set therefore has EXACTLY minTrainSegments segments.
 *
 * Boundary law (fail-closed): when `minTrainSegments + 1 > segments.length`
 * — no complete window exists — the result is the typed error
 * `window_exhaustion`, never an empty split. Deterministic and pure: the
 * same (axis, policy) always yields the deeply-equal window list.
 */
export function walkForwardWindows(axis: DatasetAxis, policy: WalkForwardPolicy): EvalResult<readonly WalkForwardWindow[]> {
  if (!isDatasetAxis(axis)) {
    return fail('invalid_axis', 'walkForwardWindows requires a valid dataset axis');
  }
  if (!isWalkForwardPolicy(policy)) {
    return fail('invalid_split_policy', 'walkForwardWindows requires a valid walk-forward policy');
  }
  const windows: WalkForwardWindow[] = [];
  for (let testIndex = policy.minTrainSegments; testIndex < axis.segments.length; testIndex += policy.stepSegments) {
    const test = axis.segments[testIndex];
    if (test === undefined) continue; // unreachable under the loop bound; kept fail-closed
    windows.push({ train: axis.segments.slice(0, testIndex), test });
  }
  if (windows.length === 0) {
    return fail(
      'window_exhaustion',
      `axis has ${axis.segments.length} segment(s); walk-forward policy "${policy.policyId}" requires at least ${policy.minTrainSegments + 1} for one complete window — no window exists`,
    );
  }
  return ok(deepFreeze(windows));
}

/** The blind holdout split: the visible prefix and the masked blind suffix. */
export interface BlindHoldoutSplit {
  /** Visible segments (the leading prefix — in-search material). */
  readonly visible: readonly DatasetSegment[];
  /** Blind segments (the masked suffix — unseen, never optimized against). */
  readonly blind: readonly DatasetSegment[];
}

/**
 * Compute the blind holdout mask of an axis: the last `holdoutCount`
 * segments are blind, the leading prefix stays visible.
 *
 * Boundary law (fail-closed, `degenerate_mask`): a mask that would blind
 * EVERYTHING (holdoutCount >= segments.length) or NOTHING (holdoutCount
 * < 1) is degenerate — a blind evaluation with no blind material proves
 * nothing, and one with no visible material cannot be prepared. Both are
 * typed errors, never silent empty splits.
 */
export function blindHoldoutMask(axis: DatasetAxis, policy: BlindHoldoutPolicy): EvalResult<BlindHoldoutSplit> {
  if (!isDatasetAxis(axis)) {
    return fail('invalid_axis', 'blindHoldoutMask requires a valid dataset axis');
  }
  if (!isBlindHoldoutPolicy(policy)) {
    return fail('invalid_split_policy', 'blindHoldoutMask requires a valid blind-holdout policy');
  }
  const total = axis.segments.length;
  if (policy.holdoutCount >= total) {
    return fail(
      'degenerate_mask',
      `blind-holdout policy "${policy.policyId}" masks all ${total} segment(s) — the visible part would be empty (holdoutCount must be < segments.length)`,
    );
  }
  if (policy.holdoutCount < 1) {
    return fail(
      'degenerate_mask',
      `blind-holdout policy "${policy.policyId}" masks nothing (holdoutCount must be >= 1)`,
    );
  }
  const splitAt = total - policy.holdoutCount;
  return ok(
    deepFreeze({
      visible: axis.segments.slice(0, splitAt),
      blind: axis.segments.slice(splitAt),
    } satisfies BlindHoldoutSplit),
  );
}

/** The regime partition: every segment carrying the policy's regime label. */
export interface RegimePartition {
  readonly regime: string;
  readonly segments: readonly DatasetSegment[];
}

/**
 * Compute the regime partition of an axis: the segments labeled with the
 * policy's regime, in axis order.
 *
 * Boundary law (fail-closed, `empty_regime`): a regime that selects no
 * segment is a typed failure — an empty regime partition cannot support a
 * verdict (spec/ARCHITECTURE.md "Evaluation": regime tests are part of the
 * acceptance machinery; a vacuous one attests nothing).
 */
export function regimePartition(axis: DatasetAxis, policy: RegimePartitionPolicy): EvalResult<RegimePartition> {
  if (!isDatasetAxis(axis)) {
    return fail('invalid_axis', 'regimePartition requires a valid dataset axis');
  }
  if (!isRegimePartitionPolicy(policy)) {
    return fail('invalid_split_policy', 'regimePartition requires a valid regime-partition policy');
  }
  const segments = axis.segments.filter((segment) => segment.regime === policy.regime);
  if (segments.length === 0) {
    return fail(
      'empty_regime',
      `regime "${policy.regime}" selects no segment of the axis — an empty regime partition cannot support a verdict`,
    );
  }
  return ok(deepFreeze({ regime: policy.regime, segments } satisfies RegimePartition));
}

/**
 * The segment refs a policy evaluates over, as the opaque split material
 * for suite members: walk-forward -> every test segment (in window order);
 * blind-holdout -> the blind segments; regime-partition -> the selected
 * segments. Pure projection for reporting and lineage.
 */
export function policySegmentRefs(axis: DatasetAxis, policy: SplitPolicy): EvalResult<readonly DataRef[]> {
  const asError = (code: EvalErrorCode, message: string): EvalResult<readonly DataRef[]> => fail(code, message);
  switch (policy.kind) {
    case 'walk-forward': {
      const windows = walkForwardWindows(axis, policy);
      if (!windows.ok) return asError(windows.errors[0]?.code ?? 'invalid_split_policy', windows.errors[0]?.message ?? 'walk-forward split failed');
      const refs: DataRef[] = [];
      const seen = new Set<string>();
      for (const window of windows.value) {
        if (!seen.has(window.test.ref)) {
          seen.add(window.test.ref);
          refs.push(window.test.ref);
        }
      }
      return ok(deepFreeze(refs));
    }
    case 'blind-holdout': {
      const split = blindHoldoutMask(axis, policy);
      if (!split.ok) return asError(split.errors[0]?.code ?? 'invalid_split_policy', split.errors[0]?.message ?? 'blind-holdout split failed');
      return ok(deepFreeze(split.value.blind.map((segment) => segment.ref)));
    }
    case 'regime-partition': {
      const partition = regimePartition(axis, policy);
      if (!partition.ok) return asError(partition.errors[0]?.code ?? 'invalid_split_policy', partition.errors[0]?.message ?? 'regime partition failed');
      return ok(deepFreeze(partition.value.segments.map((segment) => segment.ref)));
    }
  }
}

/** Re-exported for consumers reasoning about axis boundaries. */
export { isNonNegativeInteger };
