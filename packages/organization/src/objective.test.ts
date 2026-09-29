// @tradrl/organization — objective-model behavioral tests (T016).
//
// Laws under test:
// - The objective model is DECLARED, not implicit (ARCHITECTURE.md
//   "Optimize objective attainment, risk, compute, coordination cost,
//   latency, robustness and redundancy"): seven measured components,
//   weighted-sum-v1 aggregation, no hidden weights.
// - Aggregation determinism: same (measurements, strategy) -> identical
//   score, components and input digest.
// - The declared tie-break rule orders deterministically.
// - Guards: weights, caps, measurements.

import { describe, expect, it } from 'vitest';
import {
  attainmentEvidenceRef,
  type ObjectiveMeasurements,
  OBJECTIVE_COMPONENTS,
  aggregateOrganizationObjective,
  compareByTieBreakRule,
  isAggregationStrategy,
  isObjectiveAggregate,
  isObjectiveMeasurements,
  isObjectiveWeights,
} from './index';
import { fixtureStrategy } from './fixtures';

const measurements: ObjectiveMeasurements = {
  attainmentScore: 0.8,
  attainmentEvidenceRef: attainmentEvidenceRef('evidence/attainment/atlas-run-42'),
  riskPenalty: 0.25,
  riskPolicyRefs: ['policy/risk/atlas/researcher-gate'],
  computeUnits: 10,
  coordinationCostWires: 4,
  latencyMs: 1200,
  robustness: 0.7,
  redundancy: 0.5,
};

describe('the declared objective model (seven components, weighted-sum-v1)', () => {
  it('the component vocabulary is the ARCHITECTURE.md optimization sentence', () => {
    expect([...OBJECTIVE_COMPONENTS]).toEqual([
      'attainment',
      'risk',
      'compute',
      'coordinationCost',
      'latency',
      'robustness',
      'redundancy',
    ]);
  });

  it('the fixture strategy is a valid declared strategy', () => {
    expect(isAggregationStrategy(fixtureStrategy)).toBe(true);
    expect(isObjectiveWeights(fixtureStrategy.weights)).toBe(true);
  });

  it('aggregates deterministically: same inputs -> identical aggregate', () => {
    const a = aggregateOrganizationObjective(measurements, fixtureStrategy);
    const b = aggregateOrganizationObjective(measurements, fixtureStrategy);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value).toEqual(b.value);
      expect(a.value.inputDigest).toBe(b.value.inputDigest);
      expect(isObjectiveAggregate(a.value)).toBe(true);
    }
  });

  it('the score is the declared weighted sum of the normalized components', () => {
    const result = aggregateOrganizationObjective(measurements, fixtureStrategy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { score, components } = result.value;
    // weighted-sum-v1 over unit weights sum 1.0 — recompute by hand:
    expect(components.attainment).toBe(0.8);
    expect(components.risk).toBeCloseTo(0.75, 12);
    expect(components.compute).toBeCloseTo(1 - 10 / 40, 12);
    expect(components.coordinationCost).toBeCloseTo(1 - 4 / 12, 12);
    expect(components.latency).toBeCloseTo(1 - 1200 / 3000, 12);
    expect(components.robustness).toBe(0.7);
    expect(components.redundancy).toBe(0.5);
    const w = fixtureStrategy.weights;
    const total = Object.values(w).reduce((sum, weight) => sum + weight, 0);
    const expected =
      (w.attainment * components.attainment +
        w.riskPenalty * components.risk +
        w.compute * components.compute +
        w.coordinationCost * components.coordinationCost +
        w.latency * components.latency +
        w.robustness * components.robustness +
        w.redundancy * components.redundancy) /
      total;
    expect(score).toBeCloseTo(expected, 12);
  });

  it('costs at or above their caps contribute ZERO (clamped, declared)', () => {
    const overBudget: ObjectiveMeasurements = {
      ...measurements,
      computeUnits: 1000,
      coordinationCostWires: 12,
      latencyMs: 3000,
    };
    const result = aggregateOrganizationObjective(overBudget, fixtureStrategy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.components.compute).toBe(0);
      expect(result.value.components.coordinationCost).toBe(0);
      expect(result.value.components.latency).toBe(0);
    }
  });

  it('weights are normalized by their sum (relative weights are legal)', () => {
    const doubled = {
      ...fixtureStrategy,
      weights: {
        attainment: 0.8,
        riskPenalty: 0.2,
        compute: 0.2,
        coordinationCost: 0.2,
        latency: 0.2,
        robustness: 0.2,
        redundancy: 0.2,
      },
    };
    const a = aggregateOrganizationObjective(measurements, fixtureStrategy);
    const b = aggregateOrganizationObjective(measurements, doubled);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.value.score).toBeCloseTo(a.value.score, 12); // same relative weights
      expect(b.value.inputDigest).not.toBe(a.value.inputDigest); // but different declared strategy
    }
  });

  it('the aggregate is deeply frozen and JSON-round-trippable', () => {
    const result = aggregateOrganizationObjective(measurements, fixtureStrategy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    const roundTrip: unknown = JSON.parse(JSON.stringify(result.value));
    expect(isObjectiveAggregate(roundTrip)).toBe(true);
    expect(roundTrip).toEqual(result.value);
  });
});

describe('objective guards (negative paths)', () => {
  it('measurements violations are typed failures (collect-all)', () => {
    const result = aggregateOrganizationObjective({ ...measurements, attainmentScore: 1.5 }, fixtureStrategy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'measurements')).toBe(true);
    }
    expect(aggregateOrganizationObjective(null, fixtureStrategy).ok).toBe(false);
    expect(aggregateOrganizationObjective(measurements, null).ok).toBe(false);
    expect(
      aggregateOrganizationObjective(measurements, { ...fixtureStrategy, strategyVersion: 'vibes-v9' as never }).ok,
    ).toBe(false);
    expect(
      aggregateOrganizationObjective(measurements, {
        ...fixtureStrategy,
        weights: { ...fixtureStrategy.weights, attainment: 2 },
      }).ok,
    ).toBe(false);
    expect(
      aggregateOrganizationObjective(measurements, {
        ...fixtureStrategy,
        normalization: { ...fixtureStrategy.normalization, maxLatencyMs: 0 },
      }).ok,
    ).toBe(false);
  });

  it('an all-zero weight vector is invalid (nothing would be optimized)', () => {
    expect(
      isObjectiveWeights({
        attainment: 0,
        riskPenalty: 0,
        compute: 0,
        coordinationCost: 0,
        latency: 0,
        robustness: 0,
        redundancy: 0,
      }),
    ).toBe(false);
  });

  it('NaN and Infinity are never valid measurements', () => {
    expect(isObjectiveMeasurements({ ...measurements, computeUnits: Number.NaN })).toBe(false);
    expect(isObjectiveMeasurements({ ...measurements, latencyMs: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

describe('the declared tie-break rule (attainment-then-compute-then-id-v1)', () => {
  const base = { score: 0.5, measurements, candidateId: 'candidate-a' };

  it('prefers the higher score', () => {
    expect(compareByTieBreakRule(base, { ...base, score: 0.6, candidateId: 'candidate-b' })).toBe(1);
    expect(compareByTieBreakRule({ ...base, score: 0.7 }, base)).toBe(-1);
  });

  it('score ties break on attainment (higher wins)', () => {
    expect(
      compareByTieBreakRule(base, {
        ...base,
        measurements: { ...measurements, attainmentScore: 0.9 },
        candidateId: 'candidate-b',
      }),
    ).toBe(1);
  });

  it('score+attainment ties break on compute (lower wins)', () => {
    expect(
      compareByTieBreakRule(base, {
        ...base,
        measurements: { ...measurements, computeUnits: 2 },
        candidateId: 'candidate-b',
      }),
    ).toBe(1);
  });

  it('full ties break on candidate id (code-unit order)', () => {
    expect(compareByTieBreakRule(base, { ...base, candidateId: 'candidate-b' })).toBe(-1);
    expect(compareByTieBreakRule({ ...base, candidateId: 'candidate-z' }, base)).toBe(1);
    expect(compareByTieBreakRule(base, { ...base })).toBe(0);
  });

  it('the rule is total: no input ordering dependence', () => {
    const a = { score: 0.5, measurements, candidateId: 'candidate-a' };
    const b = { score: 0.5, measurements: { ...measurements, attainmentScore: 0.6 }, candidateId: 'candidate-b' };
    expect(compareByTieBreakRule(a, b)).toBe(-1); // a's attainment (0.8) beats b's (0.6)
    expect(compareByTieBreakRule(b, a)).toBe(1);
  });
});
