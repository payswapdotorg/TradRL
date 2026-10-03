/**
 * @tradrl/research-benchmarks — the STRESS VARIATIONS (Work Order T032).
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md "Stress: Perturb fees,
 * slippage, latency, fill probability, impact, spread and liquidity" —
 * this module owns the first four axes of that law (the suite's declared
 * perturbation vocabulary; impact/spread/liquidity perturbation belongs to
 * the execution-sim/venue lanes and is consumed through their physics
 * lineage, not re-declared here). spec/EVALUATION-PROTOCOL.md layer 4
 * ("Execution stress"); ARCHITECTURE-LOCK L7 (constraint-aware evaluation
 * — a strategy is judged under stress, not only on friendly replay).
 *
 * THE STRESS LAWS (each typed, fail-closed, exact):
 * - The axis vocabulary is CLOSED: 'fees' | 'slippage' | 'latency' |
 *   'fill-probability' (`invalid_stress` for anything else).
 * - Magnitudes are EXACT DECIMALS; the fill-probability magnitude is
 *   additionally bounded to [0, 1] (`invalid_stress`).
 * - A benchmark declares AT MOST ONE variation per axis (`invalid_stress`
 *   on repeats — a declared perturbation is closed, never a bag).
 * - APPLICATION is pure, deterministic and exact (scaled-bigint lane):
 *   * 'fees'         — an added fee burden of `magnitude` basis points on
 *     the segment's traded notional: pnl -= notional * bps / 10^4.
 *   * 'slippage'     — an added slippage burden of `magnitude` basis
 *     points on notional: pnl -= notional * bps / 10^4.
 *   * 'latency'      — a declared per-trade latency penalty of
 *     `magnitude` currency units per trade: pnl -= trades * magnitude.
 *   * 'fill-probability' — the probability that an order fills; the value
 *     missed by unfilled orders is the segment's declared fill value:
 *     pnl -= fill_value * (1 - p).
 *   Variations compose ADDITIVELY in declaration order; every
 *   intermediate is an exact decimal; the single rendering to the
 *   benchmark's declared score scale rounds ONCE, half-even (decimals.ts).
 */

import { compareDecimals, divByPowerOfTen, mulDecimals, subtractDecimals } from './decimals';
import type { DecimalString } from './decimals';
import { isUnsignedDecimal } from './decimals';
import { invalidField, invalidType, ok, type BenchmarkError, type BenchmarkResult } from './errors';
import { isRecord } from './primitives';

// ---------------------------------------------------------------------------
// The stress vocabulary (EVALUATION-PROTOCOL's execution axes)
// ---------------------------------------------------------------------------

/** The closed stress-axis vocabulary — the EVALUATION-PROTOCOL stress law. */
export const STRESS_AXES = ['fees', 'slippage', 'latency', 'fill-probability'] as const;
export type StressAxis = (typeof STRESS_AXES)[number];

/** Runtime-checkable list of the stress axes. */
export const STRESS_AXIS_LIST: readonly StressAxis[] = STRESS_AXES;

/** Guard: a stress axis. */
export function isStressAxis(value: unknown): value is StressAxis {
  return typeof value === 'string' && (STRESS_AXES as readonly string[]).includes(value);
}

/**
 * One declared stress variation: the axis perturbed plus its EXACT DECIMAL
 * magnitude (basis points for fees/slippage; currency units per trade for
 * latency; a probability in [0,1] for fill-probability).
 */
export interface StressVariation {
  readonly axis: StressAxis;
  readonly magnitude: DecimalString;
}

/** Guard: `StressVariation` (structural). */
export function isStressVariation(value: unknown): value is StressVariation {
  if (!isRecord(value)) return false;
  if (!isStressAxis(value.axis)) return false;
  if (!isUnsignedDecimal(value.magnitude)) return false;
  if (value.axis === 'fill-probability') {
    return compareDecimals(value.magnitude, '0') >= 0 && compareDecimals(value.magnitude, '1') <= 0;
  }
  return true;
}

/**
 * Collect-all validation of an untrusted list of stress variations: every
 * variation's axis and magnitude law, and the closed-list law (at most one
 * variation per axis). On success the list is returned narrowed, deeply
 * frozen.
 */
export function validateStressVariations(value: unknown, path = 'stress'): BenchmarkResult<readonly StressVariation[]> {
  if (value === undefined) {
    return { ok: false, errors: [invalidType(`${path} must be an array of stress variations`)] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, errors: [invalidField(path, 'must be an array of stress variations')] };
  }
  const errors: BenchmarkError[] = [];
  const seenAxes = new Set<string>();
  const variations: StressVariation[] = [];
  (value as readonly unknown[]).forEach((candidate, index) => {
    const variationPath = `${path}[${index}]`;
    if (!isRecord(candidate)) {
      errors.push(invalidField(variationPath, 'must be { axis, magnitude }'));
      return;
    }
    if (candidate.axis === undefined) {
      errors.push({ code: 'invalid_stress', path: variationPath, message: 'axis is required' });
    } else if (!isStressAxis(candidate.axis)) {
      errors.push({ code: 'invalid_stress', path: `${variationPath}.axis`, message: `must be one of ${STRESS_AXES.join(' | ')}` });
    }
    if (candidate.magnitude === undefined) {
      errors.push({ code: 'invalid_stress', path: `${variationPath}.magnitude`, message: 'magnitude is required' });
    } else if (!isUnsignedDecimal(candidate.magnitude)) {
      errors.push({ code: 'invalid_stress', path: `${variationPath}.magnitude`, message: 'must be a well-formed unsigned exact decimal' });
    } else if (candidate.axis === 'fill-probability' && (compareDecimals(candidate.magnitude as string, '0') < 0 || compareDecimals(candidate.magnitude as string, '1') > 0)) {
      errors.push({ code: 'invalid_stress', path: `${variationPath}.magnitude`, message: 'a fill probability must be an exact decimal in [0, 1]' });
    }
    if (errors.length === 0 && typeof candidate.axis === 'string') {
      if (seenAxes.has(candidate.axis)) {
        errors.push({ code: 'invalid_stress', path: `${variationPath}.axis`, message: `axis "${candidate.axis}" is already perturbed — at most one variation per axis` });
      }
      seenAxes.add(candidate.axis);
      variations.push({ axis: candidate.axis as StressAxis, magnitude: candidate.magnitude as string });
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  return ok(Object.isFrozen(value) ? (value as readonly StressVariation[]) : Object.freeze(variations));
}

// ---------------------------------------------------------------------------
// The stress application (pure, deterministic, exact)
// ---------------------------------------------------------------------------

/** The execution-sensitive observation fields the stress axes perturb. */
export interface StressSensitivity {
  /** The segment's declared PnL (exact decimal, signed). */
  readonly pnl: DecimalString;
  /** The segment's traded notional (exact decimal, unsigned — the fee/slippage base). */
  readonly notional: DecimalString;
  /** The segment's trade count (the latency base). */
  readonly trades: number;
  /** The segment's declared fill value (exact decimal, unsigned — the fill-probability base). */
  readonly fill_value: DecimalString;
}

/**
 * Apply a list of validated stress variations to one observation's
 * sensitivities, in declaration order, EXACTLY (scaled-bigint lane; no
 * float is ever constructed). Returns the adjusted PnL. Pure and
 * deterministic: the same sensitivities and variations always produce the
 * identical decimal string.
 */
export function applyStressVariations(sensitivity: StressSensitivity, variations: readonly StressVariation[]): DecimalString {
  let pnl = sensitivity.pnl;
  for (const variation of variations) {
    switch (variation.axis) {
      case 'fees':
      case 'slippage': {
        // pnl -= notional * bps / 10^4 — exact multiply, exact power-of-ten division.
        const burden = divByPowerOfTen(mulDecimals(sensitivity.notional, variation.magnitude), 4);
        pnl = subtractDecimals(pnl, burden);
        break;
      }
      case 'latency': {
        // pnl -= trades * per-trade penalty — exact.
        const burden = mulDecimals(String(sensitivity.trades), variation.magnitude);
        pnl = subtractDecimals(pnl, burden);
        break;
      }
      case 'fill-probability': {
        // pnl -= fill_value * (1 - p) — the value missed by unfilled orders.
        const retained = mulDecimals(sensitivity.fill_value, variation.magnitude);
        const lost = subtractDecimals(sensitivity.fill_value, retained);
        pnl = subtractDecimals(pnl, lost);
        break;
      }
    }
  }
  return pnl;
}
