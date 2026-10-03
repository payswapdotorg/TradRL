/**
 * @tradrl/evaluation-splits — the SPLIT DRIVER POLICY (Work Order T032):
 * the data-axis definition a materialized split plan derives from.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md ("Generalization: Use unseen
 * periods, regimes, assets, venues or combinations not optimized against";
 * "Selection integrity: ... Use walk-forward and purged/embargoed designs
 * where appropriate"), spec/LEARNING-LOOP.md (the regime ladder), R21,
 * ARCHITECTURE-LOCK L4 (every boundary is a TimestampMs), L9 (the policy is
 * DATA; the materializer below is its total interpreter), L12 (the ledger
 * the policy's plans append into is tenant/project scoped).
 *
 * THE POLICY VOCABULARY (each fail-closed and typed):
 * - WINDOW LADDER: 'anchored' (the classic expanding-window walk-forward:
 *   window i's train set is the material prefix [0, i), so later windows
 *   never forget earlier history) or 'rolling' (window i's train set is the
 *   SLIDING span [max(0, i - train_span), i) of fixed declared width).
 *   Test boundaries advance by `step_segments` from `min_train_segments`.
 * - PURGED/EMBARGOED BOUNDARIES: the purge gap `gap_ms` and the embargo
 *   `embargo_ms` are EXACT DECIMAL widths (Work Order law). The PURGE LAW:
 *   a train segment survives only when it ends at least `gap_ms` before the
 *   test window starts (`segment.end + gap_ms <= test.start`, exact decimal
 *   arithmetic — train material too close in time to the evaluation
 *   boundary carries information about it). The EMBARGO LAW: a reserved
 *   (unseen) holdout must start at least `embargo_ms` after the search
 *   material ends (see plan.ts).
 * - REGIME-SEGMENTED AXES: the axis may be partitioned by REGIME LABEL, not
 *   just time — an `include` list (only these regimes window) or an
 *   `exclude` list (these regimes drop out). Spec: "Use unseen periods,
 *   regimes, assets, venues or combinations not optimized against" — the
 *   regime axis is the regime dimension of that law.
 * - UNSEEN/HOLDOUT RESERVATION: 'trailing-count' (the LAST N segments are
 *   reserved unseen, embargo-separated from the search material) or
 *   'regime-set' (every segment carrying a reserved regime label is
 *   reserved unseen — the categorical unseen-regime law; LEARNING-LOOP
 *   curriculum step 6, "Unseen multi-regime tests").
 *
 * Policies are DATA: pure, JSON-serializable, deeply frozen on validation,
 * digested canonically (L9). The same (axis, policy) pair ALWAYS
 * materializes the byte-identical plan.
 */

import { deepFreeze, isNonEmptyString, isPositiveInteger, isRecord, stableDigestJson } from './primitives';
import type { JsonObject } from './primitives';
import { isSplitPolicyRef } from './ids';
import type { SplitPolicyRef } from './ids';
import { isUnsignedDecimal } from './decimals';
import type { DecimalString } from './decimals';
import { fail, invalidField, invalidType, missingField, ok, type SplitDriverError, type SplitDriverResult } from './errors';

// ---------------------------------------------------------------------------
// The window ladder vocabulary
// ---------------------------------------------------------------------------

/** The window-ladder schemes: anchored (expanding prefix) or rolling (sliding span). */
export const WINDOW_SCHEMES = ['anchored', 'rolling'] as const;
export type WindowScheme = (typeof WINDOW_SCHEMES)[number];

/** Runtime guard for a window scheme. */
export function isWindowScheme(value: unknown): value is WindowScheme {
  return typeof value === 'string' && (WINDOW_SCHEMES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The regime filter (partition an axis by regime label, not just time)
// ---------------------------------------------------------------------------

/**
 * The regime segmentation of the axis: `include` (only segments whose regime
 * label is listed participate in the windowed search material) or `exclude`
 * (listed regimes drop out of the windowed search material). Exactly one
 * mode; lists are non-empty and duplicate-free.
 */
export type RegimeFilter =
  | { readonly mode: 'include'; readonly regimes: readonly string[] }
  | { readonly mode: 'exclude'; readonly regimes: readonly string[] };

/** Guard: `RegimeFilter`. */
export function isRegimeFilter(value: unknown): value is RegimeFilter {
  if (!isRecord(value)) return false;
  if (value.mode !== 'include' && value.mode !== 'exclude') return false;
  if (!Array.isArray(value.regimes) || value.regimes.length === 0) return false;
  if (!(value.regimes as readonly unknown[]).every((label) => isNonEmptyString(label))) return false;
  return new Set(value.regimes as readonly string[]).size === (value.regimes as readonly unknown[]).length;
}

// ---------------------------------------------------------------------------
// The unseen/holdout reservation
// ---------------------------------------------------------------------------

/**
 * The unseen/holdout reservation: material declared NEVER optimized against
 * — the unseen reservoir blind and holdout evaluations must draw from.
 * Exactly one mode:
 * - `trailing-count` — the LAST `count` segments of the axis are reserved;
 *   the reservation must be EMBARGO-SEPARATED from the search material
 *   (`embargo_violation` otherwise, see plan.ts).
 * - `regime-set` — every segment carrying one of the `regimes` labels is
 *   reserved (the categorical unseen-regime law; the segments may sit
 *   anywhere on the axis — separation is categorical, not temporal).
 */
export type HoldoutReservation =
  | { readonly mode: 'trailing-count'; readonly count: number }
  | { readonly mode: 'regime-set'; readonly regimes: readonly string[] };

/** Guard: `HoldoutReservation`. */
export function isHoldoutReservation(value: unknown): value is HoldoutReservation {
  if (!isRecord(value)) return false;
  if (value.mode === 'trailing-count') {
    return isPositiveInteger(value.count);
  }
  if (value.mode === 'regime-set') {
    if (!Array.isArray(value.regimes) || value.regimes.length === 0) return false;
    if (!(value.regimes as readonly unknown[]).every((label) => isNonEmptyString(label))) return false;
    return new Set(value.regimes as readonly string[]).size === (value.regimes as readonly unknown[]).length;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The split driver policy
// ---------------------------------------------------------------------------

/**
 * The SPLIT DRIVER POLICY: the data-axis definition a split plan
 * materializes from. Same axis + same policy -> byte-identical plan (the
 * Work Order's determinism law, pinned by tests).
 */
export interface SplitDriverPolicy {
  /** The split policy this driver policy implements (T011/T012 identity space). */
  readonly policy_ref: SplitPolicyRef;
  /** The window ladder scheme: 'anchored' (expanding) or 'rolling' (sliding). */
  readonly window: WindowScheme;
  /** Leading segments the first train set must contain (>= 1). */
  readonly min_train_segments: number;
  /** Test-boundary advance per window (>= 1). */
  readonly step_segments: number;
  /** Rolling scheme only: the fixed train span (>= 1); anchored carries null. */
  readonly train_span_segments: number | null;
  /**
   * The PURGE GAP as an exact decimal (epoch-ms widths, e.g. "259200000.5"):
   * a train segment survives only when `end + gap_ms <= test.start`.
   */
  readonly gap_ms: DecimalString;
  /**
   * The EMBARGO as an exact decimal (epoch-ms widths): a reserved unseen
   * holdout must start at least `embargo_ms` after the search material ends.
   */
  readonly embargo_ms: DecimalString;
  /** Regime segmentation of the axis (null = the full axis windows). */
  readonly regime_filter: RegimeFilter | null;
  /** The unseen/holdout reservation (null = nothing reserved). */
  readonly holdout: HoldoutReservation | null;
}

/** Guard: `SplitDriverPolicy` (structural law only; collect-all validation below). */
export function isSplitDriverPolicy(value: unknown): value is SplitDriverPolicy {
  if (!isRecord(value)) return false;
  if (!isSplitPolicyRef(value.policy_ref)) return false;
  if (!isWindowScheme(value.window)) return false;
  if (!isPositiveInteger(value.min_train_segments)) return false;
  if (!isPositiveInteger(value.step_segments)) return false;
  if (value.train_span_segments !== null && !isPositiveInteger(value.train_span_segments)) return false;
  if (!isUnsignedDecimal(value.gap_ms)) return false;
  if (!isUnsignedDecimal(value.embargo_ms)) return false;
  if (value.regime_filter !== null && !isRegimeFilter(value.regime_filter)) return false;
  if (value.holdout !== null && !isHoldoutReservation(value.holdout)) return false;
  return true;
}

/** The canonical policy JSON (the content-addressing + lineage digest input). */
export function policyJson(value: Omit<SplitDriverPolicy, never>): JsonObject {
  return {
    policy_ref: value.policy_ref,
    window: value.window,
    min_train_segments: value.min_train_segments,
    step_segments: value.step_segments,
    train_span_segments: value.train_span_segments,
    gap_ms: value.gap_ms,
    embargo_ms: value.embargo_ms,
    regime_filter: value.regime_filter as unknown as JsonObject | null,
    holdout: value.holdout as unknown as JsonObject | null,
  };
}

/** The content digest of a validated policy (L9 lineage input binding). */
export function policyDigest(policy: SplitDriverPolicy): string {
  return stableDigestJson(policyJson(policy));
}

/**
 * Collect-all validation of an untrusted split driver policy. The caller may
 * omit nothing (all fields are required data — a policy is closed, never a
 * bag); kind coherence is enforced:
 * - 'anchored' requires `train_span_segments === null`; 'rolling' requires
 *   a positive integer span (a rolling ladder without a declared span is
 *   an anchored ladder mislabeled);
 * - `gap_ms`/`embargo_ms` must be well-formed unsigned EXACT DECIMALS;
 * - regime-filter lists and holdout regime lists must be non-empty and
 *   duplicate-free (a closed vocabulary, not a bag of labels).
 * On success the policy is returned narrowed, deeply frozen.
 */
export function validateSplitDriverPolicy(value: unknown, path = 'policy'): SplitDriverResult<SplitDriverPolicy> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: SplitDriverError[] = [];

  if (value.policy_ref === undefined) {
    errors.push(missingField(`${path}.policy_ref`));
  } else if (!isSplitPolicyRef(value.policy_ref)) {
    errors.push(invalidField(`${path}.policy_ref`, 'must be a non-empty split policy ref'));
  }

  if (value.window === undefined) {
    errors.push(missingField(`${path}.window`));
  } else if (!isWindowScheme(value.window)) {
    errors.push(invalidField(`${path}.window`, `must be one of ${WINDOW_SCHEMES.join(' | ')}`));
  }

  if (value.min_train_segments === undefined) {
    errors.push(missingField(`${path}.min_train_segments`));
  } else if (!isPositiveInteger(value.min_train_segments)) {
    errors.push(invalidField(`${path}.min_train_segments`, 'must be an integer >= 1'));
  }

  if (value.step_segments === undefined) {
    errors.push(missingField(`${path}.step_segments`));
  } else if (!isPositiveInteger(value.step_segments)) {
    errors.push(invalidField(`${path}.step_segments`, 'must be an integer >= 1'));
  }

  if (value.train_span_segments === undefined) {
    errors.push(missingField(`${path}.train_span_segments`));
  } else if (value.train_span_segments !== null && !isPositiveInteger(value.train_span_segments)) {
    errors.push(invalidField(`${path}.train_span_segments`, 'must be an integer >= 1 or null'));
  }

  if (value.gap_ms === undefined) {
    errors.push(missingField(`${path}.gap_ms`));
  } else if (!isUnsignedDecimal(value.gap_ms)) {
    errors.push(invalidField(`${path}.gap_ms`, 'must be a well-formed unsigned exact decimal of epoch milliseconds (e.g. "259200000" or "259200000.5")'));
  }

  if (value.embargo_ms === undefined) {
    errors.push(missingField(`${path}.embargo_ms`));
  } else if (!isUnsignedDecimal(value.embargo_ms)) {
    errors.push(invalidField(`${path}.embargo_ms`, 'must be a well-formed unsigned exact decimal of epoch milliseconds'));
  }

  if (value.regime_filter === undefined) {
    errors.push(missingField(`${path}.regime_filter`));
  } else if (value.regime_filter !== null && !isRegimeFilter(value.regime_filter)) {
    errors.push(invalidField(`${path}.regime_filter`, 'must be { mode: "include"|"exclude", regimes: [non-empty unique labels] } or null'));
  }

  if (value.holdout === undefined) {
    errors.push(missingField(`${path}.holdout`));
  } else if (value.holdout !== null && !isHoldoutReservation(value.holdout)) {
    errors.push(invalidField(`${path}.holdout`, 'must be { mode: "trailing-count", count >= 1 } or { mode: "regime-set", regimes: [non-empty unique labels] } or null'));
  }

  if (errors.length > 0) return { ok: false, errors };

  const policy: SplitDriverPolicy = {
    policy_ref: value.policy_ref as SplitPolicyRef,
    window: value.window as WindowScheme,
    min_train_segments: value.min_train_segments as number,
    step_segments: value.step_segments as number,
    train_span_segments: value.train_span_segments as number | null,
    gap_ms: value.gap_ms as DecimalString,
    embargo_ms: value.embargo_ms as DecimalString,
    regime_filter: value.regime_filter as RegimeFilter | null,
    holdout: value.holdout as HoldoutReservation | null,
  };

  if (policy.window === 'anchored' && policy.train_span_segments !== null) {
    return fail(
      'invalid_policy',
      `anchored policy "${policy.policy_ref}" declares train_span_segments ${policy.train_span_segments} — an anchored ladder takes the full prefix by construction; the span belongs to the rolling scheme`,
      `${path}.train_span_segments`,
    );
  }
  if (policy.window === 'rolling' && policy.train_span_segments === null) {
    return fail(
      'invalid_policy',
      `rolling policy "${policy.policy_ref}" declares no train_span_segments — a rolling ladder without a declared span is an anchored ladder mislabeled`,
      `${path}.train_span_segments`,
    );
  }

  return ok(deepFreeze(policy));
}
