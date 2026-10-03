/**
 * @tradrl/research-benchmarks — the SEGMENT OBSERVATIONS (Work Order T032).
 *
 * The benchmark drivers score DECLARED per-segment observations: each
 * dataset segment of the split plan's material carries the evaluator's
 * execution-sensitive observation record — exact-decimal PnL, traded
 * notional, trade count and fill value — the sensitivities the stress
 * variations perturb (stress.ts) and the exact-decimal score lane
 * aggregates (driver.ts). Observations are DATA: pure, JSON-serializable,
 * deeply frozen on validation; the driver never invents a number.
 *
 * THE OBSERVATION LAWS (typed, fail-closed):
 * - unique segment refs (an observation is one segment's record);
 * - every ref must be material of the split plan being scored (windows'
 *   train/test segments or reserved holdout segments) — `unknown_segment`
 *   for anything else (the suite never scores material the plan did not
 *   bind);
 * - pnl is a SIGNED exact decimal; notional and fill_value are UNSIGNED
 *   exact decimals; trades is a non-negative integer.
 */

import { deepFreeze, isNonNegativeInteger, isRecord } from './primitives';
import { isDataRef } from './ids';
import type { DataRef } from './ids';
import { isSignedDecimal, isUnsignedDecimal } from './decimals';
import type { DecimalString } from './decimals';
import { invalidField, invalidType, ok, fail, type BenchmarkError, type BenchmarkResult } from './errors';
import type { SplitPlanMirror } from './split-mirror';

/** One segment's execution-sensitive observation (the scoring input). */
export interface SegmentObservation {
  readonly segment: DataRef;
  /** The segment's declared PnL (signed exact decimal). */
  readonly pnl: DecimalString;
  /** The segment's traded notional (unsigned exact decimal — the fee/slippage base). */
  readonly notional: DecimalString;
  /** The segment's trade count (non-negative integer — the latency base). */
  readonly trades: number;
  /** The segment's declared fill value (unsigned exact decimal — the fill-probability base). */
  readonly fill_value: DecimalString;
}

/** Guard: `SegmentObservation`. */
export function isSegmentObservation(value: unknown): value is SegmentObservation {
  if (!isRecord(value)) return false;
  if (!isDataRef(value.segment)) return false;
  if (!isSignedDecimal(value.pnl)) return false;
  if (!isUnsignedDecimal(value.notional)) return false;
  if (!isNonNegativeInteger(value.trades)) return false;
  return isUnsignedDecimal(value.fill_value);
}

/** The observation set: the per-segment observations of one benchmark run. */
export interface ObservationSet {
  readonly observations: readonly SegmentObservation[];
}

/** The segment refs of a plan's full material (window trains + tests + holdout). */
export function planMaterialRefs(plan: SplitPlanMirror): ReadonlySet<string> {
  const refs = new Set<string>();
  for (const window of plan.windows) {
    for (const segment of window.train) refs.add(segment.ref);
    refs.add(window.test.ref);
  }
  for (const segment of plan.holdout?.segments ?? []) refs.add(segment.ref);
  return refs;
}

/**
 * Collect-all validation of an untrusted observation set against the split
 * plan being scored: unique segment refs, every observation's numeric law,
 * and every ref being plan material (`unknown_segment`). On success the
 * set is returned narrowed, deeply frozen.
 */
export function validateObservationSet(value: unknown, plan: SplitPlanMirror, path = 'observations'): BenchmarkResult<ObservationSet> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  if (value.observations === undefined) {
    return { ok: false, errors: [invalidField(`${path}.observations`, 'must be an array of segment observations')] };
  }
  if (!Array.isArray(value.observations)) {
    return { ok: false, errors: [invalidField(`${path}.observations`, 'must be an array of segment observations')] };
  }
  const errors: BenchmarkError[] = [];
  const material = planMaterialRefs(plan);
  const seen = new Set<string>();
  const observations: SegmentObservation[] = [];
  (value.observations as readonly unknown[]).forEach((candidate, index) => {
    const observationPath = `${path}.observations[${index}]`;
    if (!isRecord(candidate)) {
      errors.push(invalidField(observationPath, 'must be { segment, pnl, notional, trades, fill_value }'));
      return;
    }
    if (candidate.segment === undefined) {
      errors.push(invalidField(observationPath, 'segment is required'));
    } else if (!isDataRef(candidate.segment)) {
      errors.push(invalidField(`${observationPath}.segment`, 'must be a non-empty dataset ref'));
    } else if (seen.has(candidate.segment as string)) {
      errors.push(invalidField(`${observationPath}.segment`, `duplicate observation for segment "${candidate.segment as string}" — one segment, one observation`));
    } else {
      seen.add(candidate.segment as string);
      if (!material.has(candidate.segment as string)) {
        errors.push({
          code: 'unknown_segment',
          path: `${observationPath}.segment`,
          message: `segment "${candidate.segment as string}" is not material of split plan "${plan.plan_id}" — the suite scores only what the plan bound`,
        });
      }
    }
    if (candidate.pnl === undefined) {
      errors.push(invalidField(`${observationPath}.pnl`, 'pnl is required'));
    } else if (!isSignedDecimal(candidate.pnl)) {
      errors.push(invalidField(`${observationPath}.pnl`, 'must be a well-formed signed exact decimal'));
    }
    if (candidate.notional === undefined) {
      errors.push(invalidField(`${observationPath}.notional`, 'notional is required'));
    } else if (!isUnsignedDecimal(candidate.notional)) {
      errors.push(invalidField(`${observationPath}.notional`, 'must be a well-formed unsigned exact decimal'));
    }
    if (candidate.trades === undefined) {
      errors.push(invalidField(`${observationPath}.trades`, 'trades is required'));
    } else if (!isNonNegativeInteger(candidate.trades)) {
      errors.push(invalidField(`${observationPath}.trades`, 'must be a non-negative integer'));
    }
    if (candidate.fill_value === undefined) {
      errors.push(invalidField(`${observationPath}.fill_value`, 'fill_value is required'));
    } else if (!isUnsignedDecimal(candidate.fill_value)) {
      errors.push(invalidField(`${observationPath}.fill_value`, 'must be a well-formed unsigned exact decimal'));
    }
    if (
      errors.length === 0 &&
      isDataRef(candidate.segment) &&
      isSignedDecimal(candidate.pnl) &&
      isUnsignedDecimal(candidate.notional) &&
      isNonNegativeInteger(candidate.trades) &&
      isUnsignedDecimal(candidate.fill_value)
    ) {
      observations.push({
        segment: candidate.segment as DataRef,
        pnl: candidate.pnl as string,
        notional: candidate.notional as string,
        trades: candidate.trades as number,
        fill_value: candidate.fill_value as string,
      });
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  return ok(deepFreeze({ observations } satisfies ObservationSet));
}
