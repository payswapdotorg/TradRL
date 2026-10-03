/**
 * @tradrl/evaluation-splits — the SPLIT PLAN MATERIALIZER (Work Order T032):
 * the total interpreter of a {@link SplitDriverPolicy} over a
 * {@link DatasetAxis}.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md ("Generalization: Use unseen
 * periods, regimes, assets, venues or combinations not optimized against";
 * "Selection integrity: ... Use walk-forward and purged/embargoed designs
 * where appropriate"), R21 (walk-forward/unseen evaluation), ARCHITECTURE-LOCK
 * L4 (point-in-time boundaries), L9 (reproducible lineage — content
 * addressing), L12 (tenant scoping lives on the ledger, T031 precedent:
 * derived definitions are tenant-free content; ledgers bind scope).
 *
 * THE MATERIALIZATION LAWS (each fail-closed and typed):
 * 1. THE HOLDOUT RESERVATION runs FIRST, over the FULL axis: reserved
 *    segments are removed from the search material before any window is
 *    considered. Trailing-count reservations must be EMBARGO-SEPARATED from
 *    the search material (`first_holdout.start - last_search.end >=
 *    embargo_ms`, exact decimal arithmetic — `embargo_violation`); a
 *    reservation that would reserve everything or nothing fails
 *    `degenerate_reservation`. Regime-set reservations are categorical
 *    (they may sit anywhere on the axis) and must select at least one
 *    segment (`degenerate_reservation`).
 * 2. THE REGIME FILTER partitions the REMAINING search material by regime
 *    label; a filter that selects no segment fails `empty_regime_partition`.
 * 3. THE WINDOW LADDER: test indices advance from `min_train_segments` by
 *    `step_segments` while a test segment exists. Train sets are the
 *    material prefix (anchored) or the trailing span (rolling) before the
 *    test index, PURGED by the exact-decimal gap law
 *    (`segment.end + gap_ms <= test.start`). A window starved to an empty
 *    train set fails `embargo_violation` (never a silent window without
 *    training material); no complete window fails `window_exhaustion`.
 * 4. THE LEAKAGE VERIFICATION (fail-closed, post-construction): no reserved
 *    (unseen) segment may appear inside ANY window's train or test material
 *    — `holdout_leakage`. Construction already excludes the reservation,
 *    but the materialized plan is verified again before it is returned (and
 *    {@link verifySplitPlan} re-verifies any untrusted plan the same way).
 * 5. CONTENT ADDRESSING (L9): the plan id is `splan:<digest>` over the
 *    canonical plan content; content and address cannot disagree. Same axis
 *    + same policy -> byte-identical canonical plan and identical id (the
 *    Work Order's determinism law — pinned by tests).
 * 6. LINEAGE (L9): every plan carries its lineage block — the axis digest,
 *    the policy digest, the policy ref, the material counts.
 */

import { canonicalJson, deepFreeze, isDigest, isRecord, stableDigestJson } from './primitives';
import type { JsonObject, JsonValue } from './primitives';
import { isSplitPlanId, isSplitPolicyRef } from './ids';
import type { SplitPlanId, SplitPolicyRef } from './ids';
import { addDecimals, compareDecimals } from './decimals';
import type { DecimalString } from './decimals';
import { fail, invalidField, invalidType, missingField, ok, type SplitDriverError, type SplitDriverResult } from './errors';
import { isDatasetAxis, isDatasetSegment, validateDatasetAxis, axisDigest } from './axis';
import type { DatasetAxis, DatasetSegment } from './axis';
import { policyDigest, validateSplitDriverPolicy } from './policy';
import type { HoldoutReservation, SplitDriverPolicy } from './policy';

// ---------------------------------------------------------------------------
// The materialized plan shapes
// ---------------------------------------------------------------------------

/** One materialized window: the (purged) train material and its held-out test segment. */
export interface SplitWindowPlan {
  /** The window's ordinal on the ladder (0-based, dense). */
  readonly index: number;
  /** Train segments (purged by the exact-decimal gap law; non-empty). */
  readonly train: readonly DatasetSegment[];
  /** The held-out test segment (never in this window's train set). */
  readonly test: DatasetSegment;
  /** How many pre-test material segments the purge law removed. */
  readonly purged: number;
}

/** The materialized unseen/holdout reservation. */
export interface HoldoutReservationPlan {
  /** The reservation mode (echo of the policy's). */
  readonly mode: 'trailing-count' | 'regime-set';
  /** The reserved unseen segments (never inside any window's material). */
  readonly segments: readonly DatasetSegment[];
  /** The embargo the reservation enforces (echo of the policy's, exact decimal). */
  readonly embargo_ms: DecimalString;
  /**
   * The ACTUAL temporal separation between search material end and the
   * first reserved segment start (exact decimal; null for the categorical
   * regime-set mode, whose separation is categorical, not temporal).
   */
  readonly separation_ms: DecimalString | null;
}

/** The L9 lineage block every materialized plan carries. */
export interface SplitPlanLineage {
  /** Content digest of the input axis. */
  readonly axis_digest: string;
  /** The split policy ref the plan implements. */
  readonly policy_ref: SplitPolicyRef;
  /** Content digest of the driver policy. */
  readonly policy_digest: string;
  /** Count of segments on the input axis. */
  readonly segment_count: number;
  /** Count of materialized windows. */
  readonly window_count: number;
  /** Count of reserved unseen segments. */
  readonly holdout_count: number;
}

/** A materialized, content-addressed, benchmark-ready split plan. */
export interface SplitPlan {
  /** Derived identity: `splan:<digest over the canonical plan content>`. */
  readonly plan_id: SplitPlanId;
  readonly policy_ref: SplitPolicyRef;
  readonly kind: 'walk-forward-plan';
  readonly windows: readonly SplitWindowPlan[];
  readonly holdout: HoldoutReservationPlan | null;
  readonly lineage: SplitPlanLineage;
}

// ---------------------------------------------------------------------------
// Content addressing (L9)
// ---------------------------------------------------------------------------

/** The canonical plan JSON (the content-addressing input; no `plan_id`). */
export function planContentJson(plan: Omit<SplitPlan, 'plan_id'>): JsonObject {
  return {
    policy_ref: plan.policy_ref,
    kind: plan.kind,
    windows: plan.windows as unknown as readonly JsonValue[],
    holdout: plan.holdout as unknown as JsonObject | null,
    lineage: plan.lineage as unknown as JsonObject,
  };
}

/** Compute the content address of a split plan: `splan:<digest>`. */
export function splitPlanId(content: Omit<SplitPlan, 'plan_id'>): SplitPlanId {
  return `splan:${stableDigestJson(planContentJson(content))}` as SplitPlanId;
}

/** The canonical JSON bytes of a plan (the determinism anchor). */
export function canonicalSplitPlan(plan: SplitPlan): string {
  return canonicalJson(plan as unknown as JsonObject);
}

// ---------------------------------------------------------------------------
// The materializer (pure, total, fail-closed)
// ---------------------------------------------------------------------------

/**
 * Materialize the benchmark-ready split plan of a driver policy over a
 * dataset axis. Deterministic and pure: the same (axis, policy) pair always
 * yields the byte-identical, deeply-frozen plan with the identical
 * content-addressed id (L9 + the Work Order's determinism law).
 *
 * Typed failures (each negative-tested):
 * - `invalid_axis` / `invalid_policy` — malformed inputs (collect-all).
 * - `degenerate_reservation` — a holdout reservation of everything/nothing.
 * - `embargo_violation` — the trailing reservation is not embargo-separated
 *   from the search material, or the purge gap starves a window's train set.
 * - `empty_regime_partition` — the regime filter selects no segment.
 * - `window_exhaustion` — the ladder admits no complete window.
 * - `holdout_leakage` — a reserved segment appears inside window material.
 */
export function materializeSplitPlan(axis: unknown, policy: unknown): SplitDriverResult<SplitPlan> {
  const axisResult = validateDatasetAxis(axis);
  if (!axisResult.ok) return axisResult;
  const validatedAxis = axisResult.value;

  const policyResult = validateSplitDriverPolicy(policy);
  if (!policyResult.ok) return policyResult;
  const validatedPolicy = policyResult.value;

  const segments = validatedAxis.segments;

  // --- Law 1: the holdout reservation (over the FULL axis) -------------------
  let searchMaterial: readonly DatasetSegment[] = segments;
  let holdoutPlan: HoldoutReservationPlan | null = null;
  const reservation = validatedPolicy.holdout;
  if (reservation !== null) {
    if (reservation.mode === 'trailing-count') {
      if (reservation.count >= segments.length) {
        return fail(
          'degenerate_reservation',
          `trailing-count reservation of ${reservation.count} segment(s) reserves all ${segments.length} — the search material would be empty (count must be < segments.length)`,
          'policy.holdout.count',
        );
      }
      const holdoutSegments = segments.slice(segments.length - reservation.count);
      searchMaterial = segments.slice(0, segments.length - reservation.count);
      if (searchMaterial.length === 0) {
        return fail('degenerate_reservation', 'the trailing reservation leaves no search material', 'policy.holdout');
      }
      const lastSearchEnd = searchMaterial[searchMaterial.length - 1]?.end;
      const firstHoldoutStart = holdoutSegments[0]?.start;
      if (lastSearchEnd === undefined || firstHoldoutStart === undefined) {
        return fail('degenerate_reservation', 'the trailing reservation is missing its boundary segments', 'policy.holdout');
      }
      const separation = String(firstHoldoutStart - lastSearchEnd); // axis law: ordered, non-overlapping -> >= 0
      if (compareDecimals(separation, validatedPolicy.embargo_ms) < 0) {
        return fail(
          'embargo_violation',
          `reserved holdout starts at ${firstHoldoutStart} but search material ends at ${lastSearchEnd} (separation ${separation} ms) — the declared embargo of ${validatedPolicy.embargo_ms} ms is not satisfied`,
          'policy.embargo_ms',
        );
      }
      holdoutPlan = deepFreeze({
        mode: reservation.mode,
        segments: holdoutSegments,
        embargo_ms: validatedPolicy.embargo_ms,
        separation_ms: separation,
      } satisfies HoldoutReservationPlan);
    } else {
      const holdoutSegments = segments.filter((segment) => (reservation.regimes as readonly string[]).includes(segment.regime));
      if (holdoutSegments.length === 0) {
        return fail(
          'degenerate_reservation',
          `regime-set reservation of [${reservation.regimes.join(', ')}] selects no segment — a reservation of nothing reserves nothing`,
          'policy.holdout.regimes',
        );
      }
      searchMaterial = segments.filter((segment) => !(reservation.regimes as readonly string[]).includes(segment.regime));
      holdoutPlan = deepFreeze({
        mode: reservation.mode,
        segments: holdoutSegments,
        embargo_ms: validatedPolicy.embargo_ms,
        separation_ms: null,
      } satisfies HoldoutReservationPlan);
    }
  }

  // --- Law 2: the regime filter (over the remaining search material) ---------
  const filter = validatedPolicy.regime_filter;
  let windowed: readonly DatasetSegment[];
  if (filter !== null) {
    windowed =
      filter.mode === 'include'
        ? searchMaterial.filter((segment) => (filter.regimes as readonly string[]).includes(segment.regime))
        : searchMaterial.filter((segment) => !(filter.regimes as readonly string[]).includes(segment.regime));
    if (windowed.length === 0) {
      return fail(
        'empty_regime_partition',
        `regime filter (${filter.mode} [${filter.regimes.join(', ')}]) selects no search segment — an empty regime partition cannot support a ladder`,
        'policy.regime_filter',
      );
    }
  } else {
    windowed = searchMaterial;
  }

  // --- Law 3: the window ladder (anchored or rolling, purged by the gap) -----
  const windows: SplitWindowPlan[] = [];
  for (let testIndex = validatedPolicy.min_train_segments; testIndex < windowed.length; testIndex += validatedPolicy.step_segments) {
    const test = windowed[testIndex];
    if (test === undefined) continue; // unreachable under the loop bound; kept fail-closed
    const prefix = windowed.slice(0, testIndex);
    const span =
      validatedPolicy.window === 'rolling' && validatedPolicy.train_span_segments !== null
        ? prefix.slice(Math.max(0, testIndex - validatedPolicy.train_span_segments))
        : prefix;
    const train = span.filter((segment) => compareDecimals(addDecimals(String(segment.end), validatedPolicy.gap_ms), String(test.start)) <= 0);
    if (train.length === 0) {
      return fail(
        'embargo_violation',
        `purge gap of ${validatedPolicy.gap_ms} ms starves the ENTIRE train set of the window testing segment "${test.ref}" (start ${test.start}) — the material cannot support this purged/embargoed design`,
        `windows[${windows.length}]`,
      );
    }
    windows.push({ index: windows.length, train, test, purged: span.length - train.length });
  }
  if (windows.length === 0) {
    return fail(
      'window_exhaustion',
      `material has ${windowed.length} windowable segment(s); the policy requires at least ${validatedPolicy.min_train_segments + 1} for one complete window — no window exists`,
    );
  }

  // --- Law 4: the leakage verification (fail-closed, post-construction) ------
  const holdoutRefs = new Set<string>((holdoutPlan?.segments ?? []).map((segment) => segment.ref));
  if (holdoutRefs.size > 0) {
    for (let index = 0; index < windows.length; index++) {
      const window = windows[index] as SplitWindowPlan;
      if (holdoutRefs.has(window.test.ref)) {
        return fail(
          'holdout_leakage',
          `reserved unseen segment "${window.test.ref}" appears as window ${window.index}'s TEST material — holdout windows must never leak into search windows`,
          `windows[${index}].test`,
        );
      }
      for (const trainSegment of window.train) {
        if (holdoutRefs.has(trainSegment.ref)) {
          return fail(
            'holdout_leakage',
            `reserved unseen segment "${trainSegment.ref}" appears in window ${window.index}'s TRAIN material — holdout windows must never leak into search windows`,
            `windows[${index}].train`,
          );
        }
      }
    }
  }

  // --- Laws 5 + 6: lineage + content addressing -------------------------------
  const content: Omit<SplitPlan, 'plan_id'> = {
    policy_ref: validatedPolicy.policy_ref,
    kind: 'walk-forward-plan' as const,
    windows,
    holdout: holdoutPlan,
    lineage: {
      axis_digest: axisDigest(validatedAxis),
      policy_ref: validatedPolicy.policy_ref,
      policy_digest: policyDigest(validatedPolicy),
      segment_count: segments.length,
      window_count: windows.length,
      holdout_count: holdoutPlan?.segments.length ?? 0,
    },
  };
  const planId = splitPlanId(content);
  return ok(deepFreeze({ plan_id: planId, ...content } satisfies SplitPlan));
}

// ---------------------------------------------------------------------------
// Verification of untrusted plans (the L9 + structural laws, fail-closed)
// ---------------------------------------------------------------------------

/** Guard: `SplitWindowPlan`. */
export function isSplitWindowPlan(value: unknown): value is SplitWindowPlan {
  if (!isRecord(value)) return false;
  if (typeof value.index !== 'number' || !Number.isInteger(value.index) || value.index < 0) return false;
  if (!Array.isArray(value.train) || value.train.length === 0) return false;
  if (!(value.train as readonly unknown[]).every((segment) => isDatasetSegment(segment))) return false;
  const test: unknown = value.test;
  if (!isDatasetSegment(test)) return false;
  if ((value.train as readonly DatasetSegment[]).some((segment) => segment.ref === test.ref)) return false;
  if (typeof value.purged !== 'number' || !Number.isInteger(value.purged) || value.purged < 0) return false;
  return true;
}

/** Guard: `HoldoutReservationPlan`. */
export function isHoldoutReservationPlan(value: unknown): value is HoldoutReservationPlan {
  if (!isRecord(value)) return false;
  if (value.mode !== 'trailing-count' && value.mode !== 'regime-set') return false;
  if (!Array.isArray(value.segments) || value.segments.length === 0) return false;
  if (!(value.segments as readonly unknown[]).every((segment) => isDatasetSegment(segment))) return false;
  if (typeof value.embargo_ms !== 'string' || value.embargo_ms.length === 0) return false;
  if (value.separation_ms !== null && typeof value.separation_ms !== 'string') return false;
  return true;
}

/** Guard: `SplitPlan` (structural; the content-address law is enforced by {@link verifySplitPlan}). */
export function isSplitPlan(value: unknown): value is SplitPlan {
  if (!isRecord(value)) return false;
  if (typeof value.plan_id !== 'string' || !isSplitPlanId(value.plan_id)) return false;
  if (!isSplitPolicyRef(value.policy_ref)) return false;
  if (value.kind !== 'walk-forward-plan') return false;
  if (!Array.isArray(value.windows) || value.windows.length === 0) return false;
  if (!(value.windows as readonly unknown[]).every((window) => isSplitWindowPlan(window))) return false;
  if (value.holdout !== null && !isHoldoutReservationPlan(value.holdout)) return false;
  const lineage = value.lineage;
  if (!isRecord(lineage)) return false;
  if (!isDigest(lineage.axis_digest) || !isDigest(lineage.policy_digest)) return false;
  if (!isSplitPolicyRef(lineage.policy_ref)) return false;
  if (typeof lineage.segment_count !== 'number' || !Number.isInteger(lineage.segment_count) || lineage.segment_count < 1) return false;
  if (typeof lineage.window_count !== 'number' || !Number.isInteger(lineage.window_count) || lineage.window_count < 1) return false;
  if (typeof lineage.holdout_count !== 'number' || !Number.isInteger(lineage.holdout_count) || lineage.holdout_count < 0) return false;
  return true;
}

/**
 * Collect-all verification of an untrusted split plan: the structural laws,
 * the window-ladder laws (dense ordinals, ordered trains), the LEAKAGE law
 * (no holdout segment inside any window's material) and the CONTENT-ADDRESS
 * law (the recorded `plan_id` must equal the digest of the canonical plan
 * content — `plan_mismatch` otherwise; content and address cannot
 * disagree, L9). On success the plan is returned narrowed, deeply frozen.
 */
export function verifySplitPlan(value: unknown, path = 'plan'): SplitDriverResult<SplitPlan> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: SplitDriverError[] = [];
  if (value.plan_id === undefined) {
    errors.push(missingField(`${path}.plan_id`));
  } else if (!isSplitPlanId(value.plan_id)) {
    errors.push(invalidField(`${path}.plan_id`, 'must be a split plan id ("splan:<digest>")'));
  }
  if (value.policy_ref === undefined) {
    errors.push(missingField(`${path}.policy_ref`));
  } else if (!isSplitPolicyRef(value.policy_ref)) {
    errors.push(invalidField(`${path}.policy_ref`, 'must be a non-empty split policy ref'));
  }
  if (value.kind === undefined) {
    errors.push(missingField(`${path}.kind`));
  } else if (value.kind !== 'walk-forward-plan') {
    errors.push(invalidField(`${path}.kind`, `must be 'walk-forward-plan'`));
  }
  if (value.windows === undefined) {
    errors.push(missingField(`${path}.windows`));
  } else if (!Array.isArray(value.windows) || value.windows.length === 0) {
    errors.push(invalidField(`${path}.windows`, 'must be a non-empty array of split windows'));
  } else if (!(value.windows as readonly unknown[]).every((window) => isSplitWindowPlan(window))) {
    errors.push(invalidField(`${path}.windows`, 'every window must be a structurally valid split window (non-empty train, valid test, test not in train)'));
  }
  if (value.holdout === undefined) {
    errors.push(missingField(`${path}.holdout`));
  } else if (value.holdout !== null && !isHoldoutReservationPlan(value.holdout)) {
    errors.push(invalidField(`${path}.holdout`, 'must be a holdout reservation plan or null'));
  }
  if (value.lineage === undefined) {
    errors.push(missingField(`${path}.lineage`));
  } else if (!isRecord(value.lineage)) {
    errors.push(invalidField(`${path}.lineage`, 'must be a lineage block'));
  }
  if (errors.length > 0) return { ok: false, errors };

  // Window-ladder laws: dense ordinals, ordered non-overlapping train spans.
  const windows = value.windows as readonly SplitWindowPlan[];
  for (let index = 0; index < windows.length; index++) {
    const window = windows[index] as SplitWindowPlan;
    if (window.index !== index) {
      errors.push(invalidField(`${path}.windows[${index}].index`, `window ordinals are dense from 0 — expected ${index}, found ${window.index}`));
    }
  }

  // The leakage law (fail-closed over the plan AS STORED).
  const holdout = value.holdout as HoldoutReservationPlan | null;
  const holdoutRefs = new Set<string>((holdout?.segments ?? []).map((segment) => segment.ref));
  for (let index = 0; index < windows.length; index++) {
    const window = windows[index] as SplitWindowPlan;
    if (holdoutRefs.has(window.test.ref)) {
      return fail(
        'holdout_leakage',
        `reserved unseen segment "${window.test.ref}" appears as window ${window.index}'s TEST material — holdout windows must never leak into search windows`,
        `${path}.windows[${index}].test`,
      );
    }
    for (const trainSegment of window.train) {
      if (holdoutRefs.has(trainSegment.ref)) {
        return fail(
          'holdout_leakage',
          `reserved unseen segment "${trainSegment.ref}" appears in window ${window.index}'s TRAIN material — holdout windows must never leak into search windows`,
          `${path}.windows[${index}].train`,
        );
      }
    }
  }

  // Lineage-count coherence + the content-address law (L9).
  const lineage = value.lineage as unknown as SplitPlanLineage;
  if (!isDigest(lineage.axis_digest)) errors.push(invalidField(`${path}.lineage.axis_digest`, 'must be a 16-hex digest'));
  if (!isDigest(lineage.policy_digest)) errors.push(invalidField(`${path}.lineage.policy_digest`, 'must be a 16-hex digest'));
  if (!isSplitPolicyRef(lineage.policy_ref)) errors.push(invalidField(`${path}.lineage.policy_ref`, 'must be a non-empty split policy ref'));
  if (lineage.window_count !== windows.length) {
    errors.push(invalidField(`${path}.lineage.window_count`, `must equal the materialized window count (${windows.length})`));
  }
  const holdoutCount = holdout?.segments.length ?? 0;
  if (lineage.holdout_count !== holdoutCount) {
    errors.push(invalidField(`${path}.lineage.holdout_count`, `must equal the reserved segment count (${holdoutCount})`));
  }
  if (errors.length > 0) return { ok: false, errors };

  const content: Omit<SplitPlan, 'plan_id'> = {
    policy_ref: value.policy_ref as SplitPolicyRef,
    kind: 'walk-forward-plan',
    windows,
    holdout,
    lineage,
  };
  const derivedId = splitPlanId(content);
  if (value.plan_id !== derivedId) {
    return fail(
      'plan_mismatch',
      `plan id "${value.plan_id}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`,
      `${path}.plan_id`,
    );
  }

  return ok(deepFreeze({ plan_id: derivedId, ...content } satisfies SplitPlan));
}
