/**
 * @tradrl/benchmarks-platform — the CAPABILITY-PROVIDER VERIFICATION-SEAM
 * MIRROR (Work Order T049; canonical owner: packages/capability-provider,
 * T045).
 *
 * THE SEAM THIS MIRROR CLOSES: T045's verification contract says "the
 * verdict is the pure fold over the outcomes THE PLATFORM'S VERIFICATION
 * MACHINERY supplies" — T045 deliberately owns the CONTRACT and the fold,
 * never the measurement runners. This lane (benchmarks/platform) IS that
 * machinery for the BENCHMARK requirement kind: it measures a delivered
 * capability artifact against a named suite and supplies the outcome the
 * REAL `verifyDeliverable` folds. The requirement/outcome shapes below are
 * STRUCTURAL MIRRORS of T045's `VerificationRequirement` (the benchmark
 * member) and `VerificationOutcome` (field-for-field; the interop
 * trip-wire proves a REAL T045 exchange accepts this lane's outcomes
 * byte-for-byte through the REAL fold).
 *
 * The benchmark requirement's `benchmarkId` names a SUITE (this lane's
 * `SuiteDefinition.name` — the stable suite identity; the content-addressed
 * suite id changes with the axes, the name does not). The discharge seam
 * (discharge.ts) maps measurement records to outcomes; the exact-coverage
 * law (every requirement answered once, none invented) stays with T045.
 */

import { isFiniteNumber, isMemberOf, isNonEmptyString, isRecord } from './primitives';
import { MEASUREMENT_METRICS_MIRROR } from './metrics';

// ---------------------------------------------------------------------------
// The structured-metric vocabulary (T017/T045 mirror — L16a measured evidence)
// ---------------------------------------------------------------------------

/**
 * The closed structured-metric vocabulary — MIRROR of the skills lane's
 * `MEASUREMENT_METRICS` (T017), re-declared by T045's mirrors: benchmark
 * scores and measurements are STRUCTURED metrics, never profession labels
 * (L16a).
 */
export { MEASUREMENT_METRICS_MIRROR };

/** One structured measurement metric (mirror). */
export type MeasurementMetricMirror = (typeof MEASUREMENT_METRICS_MIRROR)[number];

/** Guard: `MeasurementMetricMirror`. */
export function isMeasurementMetricMirror(v: unknown): v is MeasurementMetricMirror {
  return isMemberOf(MEASUREMENT_METRICS_MIRROR, v);
}

// ---------------------------------------------------------------------------
// The benchmark verification requirement (T045 mirror)
// ---------------------------------------------------------------------------

/**
 * One benchmark verification requirement — STRUCTURAL MIRROR of T045's
 * benchmark-member `VerificationRequirement` (field-for-field): the
 * deliverable's evidence must cite this suite, and the platform's
 * machinery discharges it by MEASURING the deliverable against the suite's
 * declared attainment criteria.
 */
export interface BenchmarkRequirementMirror {
  readonly kind: 'benchmark';
  readonly requirementRef: string;
  /** The benchmark suite the deliverable's evidence must cite (this lane's suite NAME). */
  readonly benchmarkId: string;
}

/** Guard: `BenchmarkRequirementMirror`. */
export function isBenchmarkRequirementMirror(v: unknown): v is BenchmarkRequirementMirror {
  if (!isRecord(v)) return false;
  if (v.kind !== 'benchmark') return false;
  if (!isNonEmptyString(v.requirementRef) || !isNonEmptyString(v.benchmarkId)) return false;
  return true;
}

/**
 * One requirement of any kind — the FULL T045 verification-contract member
 * (structural mirror; only the benchmark member is this lane's to
 * discharge — the measurement and local-evaluation members belong to their
 * own machinery).
 */
export type VerificationRequirementMirror =
  | BenchmarkRequirementMirror
  | {
      readonly kind: 'measurement';
      readonly requirementRef: string;
      readonly metric: MeasurementMetricMirror;
      readonly min?: number;
      readonly max?: number;
    }
  | {
      readonly kind: 'local-evaluation';
      readonly requirementRef: string;
      readonly evaluationRef: string;
    };

/** Guard: `VerificationRequirementMirror` (the full union). */
export function isVerificationRequirementMirror(v: unknown): v is VerificationRequirementMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.requirementRef)) return false;
  switch (v.kind) {
    case 'benchmark':
      return isNonEmptyString(v.benchmarkId);
    case 'measurement': {
      if (!isMeasurementMetricMirror(v.metric)) return false;
      const hasMin = v.min !== undefined;
      const hasMax = v.max !== undefined;
      if (hasMin && !isFiniteNumber(v.min)) return false;
      if (hasMax && !isFiniteNumber(v.max)) return false;
      if (!hasMin && !hasMax) return false;
      if (hasMin && hasMax && (v.min as number) > (v.max as number)) return false;
      return true;
    }
    case 'local-evaluation':
      return isNonEmptyString(v.evaluationRef);
    default:
      return false;
  }
}

/** Guard: a whole verification contract (a finite, requirementRef-unique list). */
export function isVerificationContractMirror(v: unknown): v is readonly VerificationRequirementMirror[] {
  if (!Array.isArray(v)) return false;
  const refs = new Set<string>();
  for (const requirement of v as readonly unknown[]) {
    if (!isVerificationRequirementMirror(requirement)) return false;
    const ref = (requirement as VerificationRequirementMirror).requirementRef;
    if (refs.has(ref)) return false;
    refs.add(ref);
  }
  return true;
}

// ---------------------------------------------------------------------------
// The verification outcome (T045 mirror — what this lane SUPPLIES)
// ---------------------------------------------------------------------------

/**
 * One requirement's checked outcome — STRUCTURAL MIRROR of T045's
 * `VerificationOutcome` (field-for-field): "as the platform's verification
 * machinery measured it". This lane mints these for BENCHMARK requirements
 * (discharge.ts); T045's `verifyDeliverable` folds them.
 */
export interface VerificationOutcomeMirror {
  /** The requirement this outcome answers (must exist in the engagement's contract). */
  readonly requirementRef: string;
  /** Whether the requirement was met. */
  readonly passed: boolean;
  /** The structured explanation (non-empty; what was measured and where the record lives). */
  readonly detail: string;
}

/** Guard: `VerificationOutcomeMirror`. */
export function isVerificationOutcomeMirror(v: unknown): v is VerificationOutcomeMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.requirementRef)) return false;
  if (typeof v.passed !== 'boolean') return false;
  return isNonEmptyString(v.detail);
}
