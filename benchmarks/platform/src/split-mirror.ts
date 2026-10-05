/**
 * @tradrl/benchmarks-platform — the SPLIT-PLAN STRUCTURAL MIRROR (Work
 * Order T049; canonical owner: @tradrl/evaluation-splits, T032).
 *
 * Law D-003/D-004 and the Work Order's composition law: "the T032
 * walk-forward suite's split discipline" — the benchmark machinery COMPOSES
 * the split driver's REAL merged shapes; it does not import them. Every
 * shape it consumes is re-declared here as a STRUCTURAL MIRROR —
 * field-for-field — and the mirrored VERIFIER re-implements the driver
 * package's content-address law over the same program-wide digest, so a
 * plan materialized by the REAL @tradrl/evaluation-splits verifies here
 * byte-for-byte with the IDENTICAL `splan:` id. The interop trip-wire
 * tests prove exactly that; drift between the two lanes' shapes fails
 * this lane's typecheck loudly.
 *
 * Mirrored shapes (canonical owner: packages/evaluation-splits, T032):
 * - `SplitDriverPolicyMirror` — the data-axis definition (window scheme,
 *   ladders, exact-decimal gap/embargo widths, regime filter, holdout
 *   reservation).
 * - `SplitPlanMirror` — the materialized, content-addressed,
 *   lineage-carrying plan (windows with purged trains, holdout
 *   reservation, lineage block).
 * - The content-address law: plan_id = `splan:<digest over the canonical
 *   plan content { policy_ref, kind, windows, holdout, lineage }>`.
 */

import { deepFreeze, isDigest, isNonEmptyString, isPositiveInteger, isRecord, stableDigestJson } from './primitives';
import type { JsonObject, JsonValue } from './primitives';
import { isDatasetSegment } from './axis';
import type { DatasetSegment } from './axis';
import { isSplitPlanId, isSplitPolicyRef } from './ids';
import type { SplitPlanId, SplitPolicyRef } from './ids';
import { isUnsignedDecimal } from './decimals';
import type { DecimalString } from './decimals';
import { fail, invalidField, invalidType, missingField, ok, type PlatformError, type PlatformResult } from './errors';

// ---------------------------------------------------------------------------
// The driver-policy mirror
// ---------------------------------------------------------------------------

/** The window-ladder schemes — mirror of the driver lane's vocabulary. */
export const WINDOW_SCHEMES_MIRROR = ['anchored', 'rolling'] as const;
export type WindowSchemeMirror = (typeof WINDOW_SCHEMES_MIRROR)[number];

/** Guard: a window scheme (mirror). */
export function isWindowSchemeMirror(value: unknown): value is WindowSchemeMirror {
  return typeof value === 'string' && (WINDOW_SCHEMES_MIRROR as readonly string[]).includes(value);
}

/** The regime filter — mirror of the driver lane's regime segmentation. */
export type RegimeFilterMirror =
  | { readonly mode: 'include'; readonly regimes: readonly string[] }
  | { readonly mode: 'exclude'; readonly regimes: readonly string[] };

/** Guard: `RegimeFilterMirror`. */
export function isRegimeFilterMirror(value: unknown): value is RegimeFilterMirror {
  if (!isRecord(value)) return false;
  if (value.mode !== 'include' && value.mode !== 'exclude') return false;
  if (!Array.isArray(value.regimes) || value.regimes.length === 0) return false;
  if (!(value.regimes as readonly unknown[]).every((label) => isNonEmptyString(label))) return false;
  return new Set(value.regimes as readonly string[]).size === (value.regimes as readonly unknown[]).length;
}

/** The holdout reservation — mirror of the driver lane's reservation modes. */
export type HoldoutReservationMirror =
  | { readonly mode: 'trailing-count'; readonly count: number }
  | { readonly mode: 'regime-set'; readonly regimes: readonly string[] };

/** Guard: `HoldoutReservationMirror`. */
export function isHoldoutReservationMirror(value: unknown): value is HoldoutReservationMirror {
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

/**
 * The split driver policy — STRUCTURAL MIRROR of
 * @tradrl/evaluation-splits's `SplitDriverPolicy` (DO NOT DIVERGE).
 */
export interface SplitDriverPolicyMirror {
  readonly policy_ref: SplitPolicyRef;
  readonly window: WindowSchemeMirror;
  readonly min_train_segments: number;
  readonly step_segments: number;
  readonly train_span_segments: number | null;
  readonly gap_ms: DecimalString;
  readonly embargo_ms: DecimalString;
  readonly regime_filter: RegimeFilterMirror | null;
  readonly holdout: HoldoutReservationMirror | null;
}

/** Guard: `SplitDriverPolicyMirror` (structural). */
export function isSplitDriverPolicyMirror(value: unknown): value is SplitDriverPolicyMirror {
  if (!isRecord(value)) return false;
  if (!isSplitPolicyRef(value.policy_ref)) return false;
  if (!isWindowSchemeMirror(value.window)) return false;
  if (!isPositiveInteger(value.min_train_segments)) return false;
  if (!isPositiveInteger(value.step_segments)) return false;
  if (value.train_span_segments !== null && !isPositiveInteger(value.train_span_segments)) return false;
  if (!isUnsignedDecimal(value.gap_ms)) return false;
  if (!isUnsignedDecimal(value.embargo_ms)) return false;
  if (value.regime_filter !== null && !isRegimeFilterMirror(value.regime_filter)) return false;
  if (value.holdout !== null && !isHoldoutReservationMirror(value.holdout)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The plan mirror
// ---------------------------------------------------------------------------

/** One materialized window — MIRROR of the driver lane's `SplitWindowPlan`. */
export interface SplitWindowPlanMirror {
  readonly index: number;
  readonly train: readonly DatasetSegment[];
  readonly test: DatasetSegment;
  readonly purged: number;
}

/** Guard: `SplitWindowPlanMirror`. */
export function isSplitWindowPlanMirror(value: unknown): value is SplitWindowPlanMirror {
  if (!isRecord(value)) return false;
  if (typeof value.index !== 'number' || !Number.isInteger(value.index) || value.index < 0) return false;
  if (!Array.isArray(value.train) || value.train.length === 0) return false;
  if (!(value.train as readonly unknown[]).every((segment) => isDatasetSegment(segment))) return false;
  const test: unknown = value.test;
  if (!isDatasetSegment(test)) return false;
  if ((value.train as readonly DatasetSegment[]).some((segment) => segment.ref === (test as DatasetSegment).ref)) return false;
  if (typeof value.purged !== 'number' || !Number.isInteger(value.purged) || value.purged < 0) return false;
  return true;
}

/** The materialized holdout reservation — MIRROR of the driver lane's `HoldoutReservationPlan`. */
export interface HoldoutReservationPlanMirror {
  readonly mode: 'trailing-count' | 'regime-set';
  readonly segments: readonly DatasetSegment[];
  readonly embargo_ms: DecimalString;
  readonly separation_ms: DecimalString | null;
}

/** Guard: `HoldoutReservationPlanMirror`. */
export function isHoldoutReservationPlanMirror(value: unknown): value is HoldoutReservationPlanMirror {
  if (!isRecord(value)) return false;
  if (value.mode !== 'trailing-count' && value.mode !== 'regime-set') return false;
  if (!Array.isArray(value.segments) || value.segments.length === 0) return false;
  if (!(value.segments as readonly unknown[]).every((segment) => isDatasetSegment(segment))) return false;
  if (typeof value.embargo_ms !== 'string' || !isUnsignedDecimal(value.embargo_ms)) return false;
  if (value.separation_ms !== null && typeof value.separation_ms !== 'string') return false;
  return true;
}

/** The L9 lineage block — MIRROR of the driver lane's `SplitPlanLineage`. */
export interface SplitPlanLineageMirror {
  readonly axis_digest: string;
  readonly policy_ref: SplitPolicyRef;
  readonly policy_digest: string;
  readonly segment_count: number;
  readonly window_count: number;
  readonly holdout_count: number;
}

/** Guard: `SplitPlanLineageMirror`. */
export function isSplitPlanLineageMirror(value: unknown): value is SplitPlanLineageMirror {
  if (!isRecord(value)) return false;
  if (!isDigest(value.axis_digest) || !isDigest(value.policy_digest)) return false;
  if (!isSplitPolicyRef(value.policy_ref)) return false;
  if (typeof value.segment_count !== 'number' || !Number.isInteger(value.segment_count) || value.segment_count < 1) return false;
  if (typeof value.window_count !== 'number' || !Number.isInteger(value.window_count) || value.window_count < 1) return false;
  if (typeof value.holdout_count !== 'number' || !Number.isInteger(value.holdout_count) || value.holdout_count < 0) return false;
  return true;
}

/**
 * The materialized split plan — STRUCTURAL MIRROR of
 * @tradrl/evaluation-splits's `SplitPlan` (DO NOT DIVERGE): the
 * benchmark-ready plan the platform machinery's phase laws intersect
 * against.
 */
export interface SplitPlanMirror {
  readonly plan_id: SplitPlanId;
  readonly policy_ref: SplitPolicyRef;
  readonly kind: 'walk-forward-plan';
  readonly windows: readonly SplitWindowPlanMirror[];
  readonly holdout: HoldoutReservationPlanMirror | null;
  readonly lineage: SplitPlanLineageMirror;
}

/** Guard: `SplitPlanMirror` (structural; the content-address law is enforced by {@link verifySplitPlanMirror}). */
export function isSplitPlanMirror(value: unknown): value is SplitPlanMirror {
  if (!isRecord(value)) return false;
  if (typeof value.plan_id !== 'string' || !isSplitPlanId(value.plan_id)) return false;
  if (!isSplitPolicyRef(value.policy_ref)) return false;
  if (value.kind !== 'walk-forward-plan') return false;
  if (!Array.isArray(value.windows) || value.windows.length === 0) return false;
  if (!(value.windows as readonly unknown[]).every((window) => isSplitWindowPlanMirror(window))) return false;
  if (value.holdout !== null && !isHoldoutReservationPlanMirror(value.holdout)) return false;
  return isSplitPlanLineageMirror(value.lineage);
}

// ---------------------------------------------------------------------------
// The mirrored content-address law (identical derivation; DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/** The canonical plan JSON (the content-addressing input; no `plan_id`). MIRROR of the driver lane's `planContentJson`. */
export function planContentJsonMirror(plan: Omit<SplitPlanMirror, 'plan_id'>): JsonObject {
  return {
    policy_ref: plan.policy_ref,
    kind: plan.kind,
    windows: plan.windows as unknown as readonly JsonValue[],
    holdout: plan.holdout as unknown as JsonObject | null,
    lineage: plan.lineage as unknown as JsonObject,
  };
}

/** Compute the content address of a split plan through the mirror: `splan:<digest>`. */
export function splitPlanIdMirror(content: Omit<SplitPlanMirror, 'plan_id'>): SplitPlanId {
  return `splan:${stableDigestJson(planContentJsonMirror(content))}` as SplitPlanId;
}

/** The content digest of a plan (measurement lineage binding). */
export function splitPlanDigest(plan: SplitPlanMirror): string {
  return stableDigestJson(planContentJsonMirror(plan));
}

// ---------------------------------------------------------------------------
// The mirrored verifier (the plan laws, fail-closed)
// ---------------------------------------------------------------------------

/**
 * Collect-all verification of an untrusted split plan — the mirrored law
 * of @tradrl/evaluation-splits's `verifySplitPlan`: the structural laws,
 * the dense-ordinal law, the LEAKAGE law (no holdout segment inside any
 * window's material), the lineage-count coherence and the CONTENT-ADDRESS
 * law (the recorded `plan_id` must equal the digest of the canonical plan
 * content). On success the plan is returned narrowed, deeply frozen.
 */
export function verifySplitPlanMirror(value: unknown, path = 'split_plan'): PlatformResult<SplitPlanMirror> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: PlatformError[] = [];
  if (value.plan_id === undefined) errors.push(missingField(`${path}.plan_id`));
  else if (!isSplitPlanId(value.plan_id)) errors.push(invalidField(`${path}.plan_id`, 'must be a split plan id ("splan:<digest>")'));
  if (value.policy_ref === undefined) errors.push(missingField(`${path}.policy_ref`));
  else if (!isSplitPolicyRef(value.policy_ref)) errors.push(invalidField(`${path}.policy_ref`, 'must be a non-empty split policy ref'));
  if (value.kind === undefined) errors.push(missingField(`${path}.kind`));
  else if (value.kind !== 'walk-forward-plan') errors.push(invalidField(`${path}.kind`, "must be 'walk-forward-plan'"));
  if (value.windows === undefined) errors.push(missingField(`${path}.windows`));
  else if (!Array.isArray(value.windows) || value.windows.length === 0) {
    errors.push(invalidField(`${path}.windows`, 'must be a non-empty array of split windows'));
  } else if (!(value.windows as readonly unknown[]).every((window) => isSplitWindowPlanMirror(window))) {
    errors.push(invalidField(`${path}.windows`, 'every window must be a structurally valid split window (non-empty train, valid test, test not in train)'));
  }
  if (value.holdout === undefined) errors.push(missingField(`${path}.holdout`));
  else if (value.holdout !== null && !isHoldoutReservationPlanMirror(value.holdout)) {
    errors.push(invalidField(`${path}.holdout`, 'must be a holdout reservation plan or null'));
  }
  if (value.lineage === undefined) errors.push(missingField(`${path}.lineage`));
  else if (!isSplitPlanLineageMirror(value.lineage)) {
    errors.push(invalidField(`${path}.lineage`, 'must be a valid plan lineage block'));
  }
  if (errors.length > 0) return { ok: false, errors };

  const windows = value.windows as readonly SplitWindowPlanMirror[];
  for (let index = 0; index < windows.length; index++) {
    const window = windows[index] as SplitWindowPlanMirror;
    if (window.index !== index) {
      errors.push(invalidField(`${path}.windows[${index}].index`, `window ordinals are dense from 0 — expected ${index}, found ${window.index}`));
    }
  }

  // The leakage law (fail-closed over the plan AS STORED).
  const holdout = value.holdout as HoldoutReservationPlanMirror | null;
  const holdoutRefs = new Set<string>((holdout?.segments ?? []).map((segment) => segment.ref));
  for (let index = 0; index < windows.length; index++) {
    const window = windows[index] as SplitWindowPlanMirror;
    if (holdoutRefs.has(window.test.ref)) {
      return fail(
        'holdout_in_search',
        `reserved unseen segment "${window.test.ref}" appears as window ${window.index}'s TEST material — holdout windows must never leak into search windows`,
        `${path}.windows[${index}].test`,
      );
    }
    for (const trainSegment of window.train) {
      if (holdoutRefs.has(trainSegment.ref)) {
        return fail(
          'holdout_in_search',
          `reserved unseen segment "${trainSegment.ref}" appears in window ${window.index}'s TRAIN material — holdout windows must never leak into search windows`,
          `${path}.windows[${index}].train`,
        );
      }
    }
  }

  // Lineage-count coherence + the content-address law (L9).
  const lineage = value.lineage as SplitPlanLineageMirror;
  if (lineage.window_count !== windows.length) {
    errors.push(invalidField(`${path}.lineage.window_count`, `must equal the materialized window count (${windows.length})`));
  }
  const holdoutCount = holdout?.segments.length ?? 0;
  if (lineage.holdout_count !== holdoutCount) {
    errors.push(invalidField(`${path}.lineage.holdout_count`, `must equal the reserved segment count (${holdoutCount})`));
  }
  if (errors.length > 0) return { ok: false, errors };

  const content: Omit<SplitPlanMirror, 'plan_id'> = {
    policy_ref: value.policy_ref as SplitPolicyRef,
    kind: 'walk-forward-plan',
    windows,
    holdout,
    lineage,
  };
  const derivedId = splitPlanIdMirror(content);
  if (value.plan_id !== derivedId) {
    return fail(
      'invalid_field',
      `plan id "${value.plan_id}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`,
      `${path}.plan_id`,
    );
  }

  return ok(deepFreeze({ plan_id: derivedId, ...content } satisfies SplitPlanMirror));
}
