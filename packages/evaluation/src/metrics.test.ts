/**
 * Behavioral tests for @tradrl/evaluation metrics: registry validation
 * (collect-all, duplicates, unknown ids, kind mismatches), the
 * constraint-aggregate vocabulary (domain-core mirrored semantics), and the
 * L7 "PnL solicitude" structural law over the metric record surface.
 */

import { describe, expect, it } from 'vitest';

import {
  CONSTRAINT_AGGREGATES,
  constraintAggregateValue,
  createMetricRegistry,
  isConstraintAggregate,
  isConstraintSatisfactionCounts,
  isMetricDefinition,
  isMetricRegistry,
  isMetricResult,
  isMetricValue,
  lookupMetric,
  metricRegistryId,
  satisfiedRatioOf,
  validateMetricResult,
  type ConstraintSatisfactionCounts,
  type MetricDefinition,
  type MetricResult,
} from './index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function counts(overrides: Partial<ConstraintSatisfactionCounts> = {}): ConstraintSatisfactionCounts {
  return { satisfied: 0, violated: 0, errors: 0, notApplicable: 0, blockingViolations: 0, advisoryViolations: 0, ...overrides };
}

const DEFINITIONS: MetricDefinition[] = [
  { kind: 'constraint-aggregate', metricId: 'metric.gate-ratio', aggregate: 'satisfiedRatio' },
  { kind: 'constraint-aggregate', metricId: 'metric.blocking', aggregate: 'blockingViolations' },
  { kind: 'risk-adjusted-ref', metricId: 'metric.figure.sharpe', figureRef: 'figure:sharpe@2' },
];

// ---------------------------------------------------------------------------
// Constraint-satisfaction aggregates (domain-core mirror semantics)
// ---------------------------------------------------------------------------

describe('ConstraintSatisfactionCounts (domain-core aggregate mirror)', () => {
  it('accepts non-negative integer counts only', () => {
    expect(isConstraintSatisfactionCounts(counts({ satisfied: 3 }))).toBe(true);
    expect(isConstraintSatisfactionCounts(counts({ satisfied: -1 }))).toBe(false);
    expect(isConstraintSatisfactionCounts(counts({ violated: 1.5 }))).toBe(false);
    expect(isConstraintSatisfactionCounts({ satisfied: 1 })).toBe(false); // missing fields
    expect(isConstraintSatisfactionCounts(null)).toBe(false);
  });

  it('satisfiedRatioOf mirrors domain-core: applicable excludes not_applicable; vacuous is 0', () => {
    expect(satisfiedRatioOf(counts({ satisfied: 3, violated: 1 }))).toBe(0.75);
    expect(satisfiedRatioOf(counts({ satisfied: 3, violated: 1, errors: 0, notApplicable: 100 }))).toBe(0.75); // excluded
    expect(satisfiedRatioOf(counts({ notApplicable: 5 }))).toBe(0); // wholly inapplicable satisfies nothing
    expect(satisfiedRatioOf(counts())).toBe(0);
  });

  it('constraintAggregateValue is total over the closed vocabulary', () => {
    const c = counts({ satisfied: 4, violated: 3, errors: 1, notApplicable: 2, blockingViolations: 2, advisoryViolations: 1 });
    expect(CONSTRAINT_AGGREGATES).toHaveLength(7);
    expect(constraintAggregateValue('satisfied', c)).toBe(4);
    expect(constraintAggregateValue('violated', c)).toBe(3);
    expect(constraintAggregateValue('errors', c)).toBe(1);
    expect(constraintAggregateValue('notApplicable', c)).toBe(2);
    expect(constraintAggregateValue('blockingViolations', c)).toBe(2);
    expect(constraintAggregateValue('advisoryViolations', c)).toBe(1);
    expect(constraintAggregateValue('satisfiedRatio', c)).toBe(4 / 8);
    expect(isConstraintAggregate('satisfied')).toBe(true);
    expect(isConstraintAggregate('profit')).toBe(false);
    expect(isConstraintAggregate(7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Metric definitions and values
// ---------------------------------------------------------------------------

describe('MetricDefinition guards', () => {
  it('accepts both kinds and rejects malformed ones', () => {
    expect(isMetricDefinition(DEFINITIONS[0])).toBe(true);
    expect(isMetricDefinition(DEFINITIONS[2])).toBe(true);
    expect(isMetricDefinition({ kind: 'constraint-aggregate', metricId: 'm', aggregate: 'pnl' })).toBe(false);
    expect(isMetricDefinition({ kind: 'constraint-aggregate', metricId: '', aggregate: 'satisfied' })).toBe(false);
    expect(isMetricDefinition({ kind: 'risk-adjusted-ref', metricId: 'm', figureRef: '' })).toBe(false);
    expect(isMetricDefinition({ kind: 'risk-adjusted-ref', metricId: 'm', figureRef: 'f', description: '' })).toBe(false);
    expect(isMetricDefinition({ kind: 'other', metricId: 'm' })).toBe(false);
    expect(isMetricDefinition('x')).toBe(false);
    expect(isMetricDefinition(null)).toBe(false);
  });

  it('MetricValue: counts are non-negative integers; ratio is unit interval; refs opaque', () => {
    expect(isMetricValue({ kind: 'constraint-aggregate', aggregate: 'satisfied', value: 3 })).toBe(true);
    expect(isMetricValue({ kind: 'constraint-aggregate', aggregate: 'satisfied', value: -1 })).toBe(false);
    expect(isMetricValue({ kind: 'constraint-aggregate', aggregate: 'satisfied', value: 1.5 })).toBe(false);
    expect(isMetricValue({ kind: 'constraint-aggregate', aggregate: 'satisfiedRatio', value: 0.5 })).toBe(true);
    expect(isMetricValue({ kind: 'constraint-aggregate', aggregate: 'satisfiedRatio', value: 1.5 })).toBe(false);
    expect(isMetricValue({ kind: 'risk-adjusted-ref', figureResultRef: 'figure-result:xyz' })).toBe(true);
    expect(isMetricValue({ kind: 'risk-adjusted-ref', figureResultRef: '' })).toBe(false);
    expect(isMetricValue({ kind: 'risk-adjusted-ref', value: 1.9 })).toBe(false); // numeric figure refused
    expect(isMetricResult({ metricId: 'm', value: { kind: 'risk-adjusted-ref', figureResultRef: 'r' } })).toBe(true);
    expect(isMetricResult({ metricId: '', value: { kind: 'risk-adjusted-ref', figureResultRef: 'r' } })).toBe(false);
    expect(isMetricResult(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

describe('MetricRegistry', () => {
  it('createMetricRegistry validates, freezes and looks up', () => {
    const result = createMetricRegistry(DEFINITIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('fixture must be valid');
    expect(isMetricRegistry(result.value)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(lookupMetric(result.value, 'metric.gate-ratio')?.aggregate).toBe('satisfiedRatio');
    expect(lookupMetric(result.value, 'metric.absent')).toBeUndefined();
  });

  it('rejects duplicate metric ids (typed duplicate_metric)', () => {
    const result = createMetricRegistry([
      { kind: 'constraint-aggregate', metricId: 'metric.dup', aggregate: 'satisfied' },
      { kind: 'constraint-aggregate', metricId: 'metric.dup', aggregate: 'violated' },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors.some((e) => e.code === 'invalid_field' && e.path === 'definitions[1].metricId')).toBe(true);
  });

  it('collects every violation with indexed paths', () => {
    const result = createMetricRegistry([
      'not-an-object',
      { kind: 'constraint-aggregate' },
      { kind: 'constraint-aggregate', metricId: 'm', aggregate: 'bogus' },
      { kind: 'risk-adjusted-ref', metricId: 'n' },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    const paths = result.errors.map((e) => e.path);
    expect(paths).toContain('definitions[0]');
    expect(paths).toContain('definitions[1].metricId');
    expect(paths).toContain('definitions[2].aggregate');
    expect(paths).toContain('definitions[3].figureRef');
  });

  it('rejects a non-array input without throwing', () => {
    const result = createMetricRegistry({ metrics: [] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_type');
  });

  it('validateMetricResult binds results to the registry', () => {
    const registry = createMetricRegistry(DEFINITIONS);
    if (!registry.ok) throw new Error('fixture must be valid');
    const good = validateMetricResult(registry.value, {
      metricId: 'metric.gate-ratio',
      value: { kind: 'constraint-aggregate', aggregate: 'satisfiedRatio', value: 0.9 },
    });
    expect(good.ok).toBe(true);

    const unknown = validateMetricResult(registry.value, {
      metricId: 'metric.absent',
      value: { kind: 'constraint-aggregate', aggregate: 'satisfied', value: 1 },
    });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error('must fail');
    expect(unknown.errors[0]?.code).toBe('unknown_metric');

    const mismatch = validateMetricResult(registry.value, {
      metricId: 'metric.figure.sharpe',
      value: { kind: 'constraint-aggregate', aggregate: 'satisfied', value: 1 },
    });
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) throw new Error('must fail');
    expect(mismatch.errors[0]?.code).toBe('invalid_metric');

    const malformed = validateMetricResult(registry.value, { metricId: 'm' });
    expect(malformed.ok).toBe(false);
  });

  it('metricRegistryId is deterministic and order-sensitive (L9 lineage)', () => {
    const a = createMetricRegistry(DEFINITIONS);
    const b = createMetricRegistry([...DEFINITIONS].reverse());
    if (!a.ok || !b.ok) throw new Error('fixtures must be valid');
    expect(metricRegistryId(a.value)).toBe(metricRegistryId(a.value));
    expect(metricRegistryId(a.value)).not.toBe(metricRegistryId(b.value)); // order is meaning
  });
});

// ---------------------------------------------------------------------------
// L7 — PnL solicitude over the metric record surface
// ---------------------------------------------------------------------------

describe('PnL solicitude (L7): metric records cannot express performance figures', () => {
  /**
   * WHY (ARCHITECTURE-LOCK L7 "raw PnL is insufficient"; the work order's
   * acceptance #3): metrics feed verdicts; if a metric record could carry a
   * raw performance figure, an implementation could gate attainment on it.
   * The metric vocabulary is therefore counts, unit-interval ratios and
   * opaque refs ONLY. Adding a performance-figure field fails this test —
   * which forces a contract-version discussion instead of a silent L7
   * violation (mirroring T007's discipline).
   */
  const PERFORMANCE_KEY_PATTERN = /pnl|profit|loss|return|gain|sharpe|sortino|calmar|drawdown|alpha|beta|benchmark|performance|money|earn/i;

  function collectKeys(value: unknown, keys: Set<string>): void {
    if (Array.isArray(value)) {
      for (const item of value) collectKeys(item, keys);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        keys.add(key);
        collectKeys(child, keys);
      }
    }
  }

  it('no key of any metric record can name a performance figure; risk-adjusted figures exist only as opaque refs', () => {
    const registry = createMetricRegistry(DEFINITIONS);
    if (!registry.ok) throw new Error('fixture must be valid');
    const result = validateMetricResult(registry.value, {
      metricId: 'metric.figure.sharpe',
      value: { kind: 'risk-adjusted-ref', figureResultRef: 'figure-result:opaque-1' },
    });
    if (!result.ok) throw new Error('fixture must be valid');
    const keys = new Set<string>();
    for (const definition of DEFINITIONS) collectKeys(definition, keys);
    collectKeys(registry.value, keys);
    collectKeys(result.value, keys);
    const offenders = [...keys].filter((key) => PERFORMANCE_KEY_PATTERN.test(key));
    expect(offenders).toEqual([]);
    // The figure VALUE is an opaque ref string — never a number.
    expect(typeof result.value.value.kind === 'risk-adjusted-ref' ? (result.value.value as { figureResultRef: string }).figureResultRef : '').toBe('string');
  });

  it('a risk-adjusted metric result structurally cannot carry a numeric figure', () => {
    expect(isMetricValue({ kind: 'risk-adjusted-ref', value: 2.31 })).toBe(false);
    expect(isMetricValue({ kind: 'risk-adjusted-ref', figureResultRef: 'figure-result:x' })).toBe(true);
  });
});
