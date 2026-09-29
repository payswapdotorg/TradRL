/**
 * @tradrl/organization — the objective model: DECLARED, not implicit.
 *
 * Spec anchor — spec/ARCHITECTURE.md, "Organization compiler", VERBATIM:
 * "Optimize objective attainment, risk, compute, coordination cost,
 * latency, robustness and redundancy."
 *
 * THE LAW THIS MODULE ENFORCES: the compiler's objective model is an
 * EXPLICIT record — the seven measured components plus a DECLARED,
 * VERSIONED aggregation strategy (a pure function) with no hidden
 * weights. The seven components map one-for-one onto the optimization
 * sentence above:
 *
 *   attainment      <- "objective attainment" (an opaque evidence reference
 *                      + a measured score; evidence is T012's verdict
 *                      bridge, never PnL — L7: raw PnL is never the sole
 *                      acceptance criterion)
 *   risk            <- "risk" (a penalty in [0,1] + opaque risk-policy
 *                      gate refs — the independent gates, L8/L20)
 *   compute         <- "compute" (units, normalized by a declared cap)
 *   coordinationCost<- "coordination cost" (topology wires, declared cap)
 *   latency         <- "latency" (milliseconds, declared cap)
 *   robustness      <- "robustness" (a measured score in [0,1])
 *   redundancy      <- "redundancy" (a measured score in [0,1])
 *
 * Ties are broken by a DECLARED deterministic rule, never by search order.
 * The aggregation is a pure function of (measurements, strategy) — same
 * inputs, byte-identical score (the determinism law).
 */

import {
  type AttainmentEvidenceRef,
  type JsonValue,
  deepFreeze,
  isAttainmentEvidenceRef,
  isFiniteNumber,
  isMemberOf,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  isUnitInterval,
  stableDigestJson,
} from './primitives';
import { type OrgResult, invalidField, invalidType } from './errors';

// ---------------------------------------------------------------------------
// The seven components (ARCHITECTURE.md, verbatim nouns)
// ---------------------------------------------------------------------------

/** The closed seven-component objective vocabulary (the optimization sentence). */
export const OBJECTIVE_COMPONENTS = [
  'attainment',
  'risk',
  'compute',
  'coordinationCost',
  'latency',
  'robustness',
  'redundancy',
] as const;

/** One objective component. */
export type ObjectiveComponent = (typeof OBJECTIVE_COMPONENTS)[number];

/** Guard: `ObjectiveComponent`. */
export function isObjectiveComponent(v: unknown): v is ObjectiveComponent {
  return isMemberOf(OBJECTIVE_COMPONENTS, v);
}

// ---------------------------------------------------------------------------
// The measured components (per candidate)
// ---------------------------------------------------------------------------

/**
 * The per-candidate objective measurements — the seven components as
 * MEASURED data (each component's derivation is declared by the compiler
 * strategy that produced it; this record carries the measurements, never
 * the derivations). Attainment is evidence-REFERENCED (L7: an opaque
 * reference to the attainment evidence — never a bare PnL figure, never
 * the sole criterion); risk carries the opaque references to the
 * independent risk-policy gates.
 */
export interface ObjectiveMeasurements {
  /** AXIS attainment — measured score in [0, 1]. */
  readonly attainmentScore: number;
  /** Opaque reference to the attainment evidence backing the score (L7/L9). */
  readonly attainmentEvidenceRef: AttainmentEvidenceRef;
  /** AXIS risk — measured penalty in [0, 1] (0 = no measured risk penalty). */
  readonly riskPenalty: number;
  /** Opaque references to the independent risk-policy gates (L8/L20). */
  readonly riskPolicyRefs: readonly string[];
  /** AXIS compute — measured compute units, >= 0. */
  readonly computeUnits: number;
  /** AXIS coordination cost — measured topology wires, integer >= 0. */
  readonly coordinationCostWires: number;
  /** AXIS latency — measured p95 latency estimate in milliseconds, >= 0. */
  readonly latencyMs: number;
  /** AXIS robustness — measured score in [0, 1]. */
  readonly robustness: number;
  /** AXIS redundancy — measured score in [0, 1]. */
  readonly redundancy: number;
}

/** Guard: `ObjectiveMeasurements` (total). */
export function isObjectiveMeasurements(v: unknown): v is ObjectiveMeasurements {
  if (!isRecord(v)) return false;
  return (
    isUnitInterval(v.attainmentScore) &&
    isAttainmentEvidenceRef(v.attainmentEvidenceRef) &&
    isUnitInterval(v.riskPenalty) &&
    Array.isArray(v.riskPolicyRefs) &&
    v.riskPolicyRefs.every((ref) => isNonEmptyString(ref)) &&
    isNonNegativeInteger(v.computeUnits) &&
    isNonNegativeInteger(v.coordinationCostWires) &&
    isNonNegativeInteger(v.latencyMs) &&
    isUnitInterval(v.robustness) &&
    isUnitInterval(v.redundancy)
  );
}

// ---------------------------------------------------------------------------
// The declared, versioned aggregation strategy
// ---------------------------------------------------------------------------

/** The closed aggregation-strategy version vocabulary. */
export const AGGREGATION_STRATEGY_VERSIONS = ['weighted-sum-v1'] as const;

/** One aggregation-strategy version. */
export type AggregationStrategyVersion = (typeof AGGREGATION_STRATEGY_VERSIONS)[number];

/** Guard: `AggregationStrategyVersion`. */
export function isAggregationStrategyVersion(v: unknown): v is AggregationStrategyVersion {
  return isMemberOf(AGGREGATION_STRATEGY_VERSIONS, v);
}

/** The closed tie-break rule vocabulary (declared deterministic rules). */
export const TIE_BREAK_RULES = ['attainment-then-compute-then-id-v1'] as const;

/** One declared tie-break rule. */
export type TieBreakRule = (typeof TIE_BREAK_RULES)[number];

/** Guard: `TieBreakRule`. */
export function isTieBreakRule(v: unknown): v is TieBreakRule {
  return isMemberOf(TIE_BREAK_RULES, v);
}

/**
 * The declared objective weights — one per component, each in [0, 1], at
 * least one positive. NO HIDDEN WEIGHTS: the aggregate is a pure function
 * of these numbers and the measurements; nothing else influences the
 * score. Weights are normalized by their sum inside the aggregation
 * (declared), so callers may declare relative weights without float
 * equality laws.
 */
export interface ObjectiveWeights {
  readonly attainment: number;
  readonly riskPenalty: number;
  readonly compute: number;
  readonly coordinationCost: number;
  readonly latency: number;
  readonly robustness: number;
  readonly redundancy: number;
}

/** Guard: `ObjectiveWeights` (seven unit-interval weights, positive sum). */
export function isObjectiveWeights(v: unknown): v is ObjectiveWeights {
  if (!isRecord(v)) return false;
  return (
    isUnitInterval(v.attainment) &&
    isUnitInterval(v.riskPenalty) &&
    isUnitInterval(v.compute) &&
    isUnitInterval(v.coordinationCost) &&
    isUnitInterval(v.latency) &&
    isUnitInterval(v.robustness) &&
    isUnitInterval(v.redundancy) &&
    isFiniteNumber(v.attainment + v.riskPenalty + v.compute + v.coordinationCost + v.latency + v.robustness + v.redundancy) &&
    v.attainment + v.riskPenalty + v.compute + v.coordinationCost + v.latency + v.robustness + v.redundancy > 0
  );
}

/**
 * The declared normalization caps: costs are clamped to their cap before
 * inversion (a cost at or above its cap contributes ZERO benefit). All
 * caps are positive; they are the declared rulers that make heterogeneous
 * costs comparable — nothing implicit.
 */
export interface NormalizationCaps {
  readonly maxComputeUnits: number;
  readonly maxCoordinationWires: number;
  readonly maxLatencyMs: number;
}

/** Guard: `NormalizationCaps`. */
export function isNormalizationCaps(v: unknown): v is NormalizationCaps {
  if (!isRecord(v)) return false;
  return (
    isPositiveInteger(v.maxComputeUnits) &&
    isPositiveInteger(v.maxCoordinationWires) &&
    isPositiveInteger(v.maxLatencyMs)
  );
}

/**
 * The DECLARED, VERSIONED aggregation strategy — a pure-function
 * specification carried as data: which strategy version, the seven
 * weights, the normalization caps, and the tie-break rule. Identical
 * strategies aggregate identically; any change is a NEW VERSION (the
 * version string participates in lineage, L9).
 */
export interface AggregationStrategy {
  /** Strategy version (closed vocabulary). */
  readonly strategyVersion: AggregationStrategyVersion;
  /** The seven declared weights (normalized internally). */
  readonly weights: ObjectiveWeights;
  /** The declared normalization caps for the cost components. */
  readonly normalization: NormalizationCaps;
  /** The declared deterministic tie-break rule. */
  readonly tieBreak: TieBreakRule;
}

/** Guard: `AggregationStrategy`. */
export function isAggregationStrategy(v: unknown): v is AggregationStrategy {
  if (!isRecord(v)) return false;
  return (
    isAggregationStrategyVersion(v.strategyVersion) &&
    isObjectiveWeights(v.weights) &&
    isNormalizationCaps(v.normalization) &&
    isTieBreakRule(v.tieBreak)
  );
}

// ---------------------------------------------------------------------------
// The aggregate
// ---------------------------------------------------------------------------

/** The per-component normalized contributions (each in [0, 1]). */
export interface ObjectiveComponents {
  readonly attainment: number;
  readonly risk: number;
  readonly compute: number;
  readonly coordinationCost: number;
  readonly latency: number;
  readonly robustness: number;
  readonly redundancy: number;
}

/** Guard: `ObjectiveComponents`. */
export function isObjectiveComponents(v: unknown): v is ObjectiveComponents {
  if (!isRecord(v)) return false;
  return (
    isUnitInterval(v.attainment) &&
    isUnitInterval(v.risk) &&
    isUnitInterval(v.compute) &&
    isUnitInterval(v.coordinationCost) &&
    isUnitInterval(v.latency) &&
    isUnitInterval(v.robustness) &&
    isUnitInterval(v.redundancy)
  );
}

/**
 * The aggregated objective — the score the strategy computes and the
 * per-component contributions that produced it (all facts, no narrative:
 * the contribution block makes the aggregation auditable — "no hidden
 * weights" is checkable by recomputation).
 */
export interface ObjectiveAggregate {
  /** The aggregate score in [0, 1] (higher is better). */
  readonly score: number;
  /** The normalized per-component contributions. */
  readonly components: ObjectiveComponents;
  /** Digest over (measurements, strategy) — the deterministic proof input. */
  readonly inputDigest: string;
}

/** Guard: `ObjectiveAggregate`. */
export function isObjectiveAggregate(v: unknown): v is ObjectiveAggregate {
  if (!isRecord(v)) return false;
  return (
    isUnitInterval(v.score) &&
    isObjectiveComponents(v.components) &&
    typeof v.inputDigest === 'string' &&
    /^[0-9a-f]{16}$/.test(v.inputDigest)
  );
}

/**
 * `weighted-sum-v1` — the DECLARED aggregation (pure):
 *
 *   component(attainment)      = attainmentScore            (benefit)
 *   component(risk)            = 1 − riskPenalty            (cost inverted)
 *   component(compute)         = 1 − min(1, computeUnits / maxComputeUnits)
 *   component(coordinationCost)= 1 − min(1, wires / maxCoordinationWires)
 *   component(latency)         = 1 − min(1, latencyMs / maxLatencyMs)
 *   component(robustness)      = robustness                 (benefit)
 *   component(redundancy)      = redundancy                 (benefit)
 *
 *   score = Σ_i  w_i / Σw  ×  component_i
 *
 * Deterministic: a pure function of (measurements, strategy); the input
 * digest binds the exact inputs (L9). `null` strategy/measurements are
 * typed failures.
 */
export function aggregateOrganizationObjective(
  measurements: unknown,
  strategy: unknown,
): OrgResult<ObjectiveAggregate> {
  if (!isRecord(measurements)) {
    return { ok: false, errors: [invalidType('measurements must be an object')] };
  }
  if (!isRecord(strategy)) {
    return { ok: false, errors: [invalidType('strategy must be an AggregationStrategy')] };
  }
  const errors: ReturnType<typeof invalidField>[] = [];
  if (!isObjectiveMeasurements(measurements)) {
    errors.push(invalidField('measurements', 'invalid ObjectiveMeasurements (the seven measured components)'));
  }
  if (!isAggregationStrategy(strategy)) {
    errors.push(invalidField('strategy', 'invalid AggregationStrategy (declared, versioned — no hidden weights)'));
  }
  if (errors.length > 0) return { ok: false, errors };
  const m = measurements as unknown as ObjectiveMeasurements;
  const s = strategy as unknown as AggregationStrategy;
  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
  const components: ObjectiveComponents = {
    attainment: clamp01(m.attainmentScore),
    risk: clamp01(1 - m.riskPenalty),
    compute: clamp01(1 - Math.min(1, m.computeUnits / s.normalization.maxComputeUnits)),
    coordinationCost: clamp01(1 - Math.min(1, m.coordinationCostWires / s.normalization.maxCoordinationWires)),
    latency: clamp01(1 - Math.min(1, m.latencyMs / s.normalization.maxLatencyMs)),
    robustness: clamp01(m.robustness),
    redundancy: clamp01(m.redundancy),
  };
  const w = s.weights;
  const total =
    w.attainment + w.riskPenalty + w.compute + w.coordinationCost + w.latency + w.robustness + w.redundancy;
  const score = clamp01(
    (w.attainment * components.attainment +
      w.riskPenalty * components.risk +
      w.compute * components.compute +
      w.coordinationCost * components.coordinationCost +
      w.latency * components.latency +
      w.robustness * components.robustness +
      w.redundancy * components.redundancy) /
      total,
  );
  const inputDigest = stableDigestJson({
    measurements: m as unknown as JsonValue,
    strategy: s as unknown as JsonValue,
  });
  return {
    ok: true,
    value: deepFreeze({ score, components, inputDigest } satisfies ObjectiveAggregate),
  };
}

// ---------------------------------------------------------------------------
// The declared tie-break rule
// ---------------------------------------------------------------------------

/**
 * The declared tie-break rule `attainment-then-compute-then-id-v1`:
 * when two candidates' aggregate scores are equal, prefer (1) the higher
 * attainment score, then (2) the LOWER compute units, then (3) the
 * lexicographically smaller candidate id (code-unit order). Returns
 * `-1` when `a` sorts before `b`, `1` when after, `0` when the declared
 * rule cannot separate them (identical on all three keys).
 *
 * Ties are broken by THIS declared rule, never by search order — the
 * determinism law: same inputs, same winner, regardless of enumeration.
 */
export function compareByTieBreakRule(
  a: { readonly score: number; readonly measurements: ObjectiveMeasurements; readonly candidateId: string },
  b: { readonly score: number; readonly measurements: ObjectiveMeasurements; readonly candidateId: string },
): -1 | 0 | 1 {
  if (a.score !== b.score) return a.score > b.score ? -1 : 1;
  if (a.measurements.attainmentScore !== b.measurements.attainmentScore) {
    return a.measurements.attainmentScore > b.measurements.attainmentScore ? -1 : 1;
  }
  if (a.measurements.computeUnits !== b.measurements.computeUnits) {
    return a.measurements.computeUnits < b.measurements.computeUnits ? -1 : 1;
  }
  if (a.candidateId !== b.candidateId) return a.candidateId < b.candidateId ? -1 : 1;
  return 0;
}
