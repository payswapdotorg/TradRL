/**
 * @tradrl/evaluation — metric definitions and the metric registry.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md ("Acceptance: Every release
 * candidate defines objective success criteria ..."), spec/ARCHITECTURE.md
 * "Evaluation", ARCHITECTURE-LOCK L7 ("Constraint-aware evaluation: raw PnL
 * is insufficient").
 *
 * L7 by construction, in THIS module: the metric vocabulary has exactly two
 * kinds —
 *   - `constraint-aggregate`: FIRST-CLASS aggregate constraint statistics
 *     (satisfied / violated / errors / notApplicable / blockingViolations /
 *     advisoryViolations / satisfiedRatio) — the only values that can gate
 *     anything downstream (verdict.ts compiles attainment from these
 *     aggregates ONLY, structurally);
 *   - `risk-adjusted-ref`: an OPAQUE reference to a risk-adjusted figure
 *     (e.g. "figure:sharpe@2"). The figure's numeric value NEVER enters an
 *     evaluation record — only its reference does — and risk-adjusted refs
 *     can never be the sole criterion (verdict inputs are per-split
 *     constraint reports; a risk-adjusted ref cannot even be stated there).
 *
 * The structural test in metrics.test.ts ("PnL solicitude") asserts the
 * absence of performance-figure fields over the recursive key set of every
 * record this module defines and produces, and documents why (mirroring
 * T007's acceptance.test.ts discipline).
 *
 * `ConstraintSatisfactionCounts` is the SEMANTIC MIRROR of the aggregate
 * fields of @tradrl/domain-core's `ConstraintEvaluationReport` (never
 * imported — D-004): satisfiedRatio is satisfied / (satisfied + violated +
 * errors), `not_applicable` excluded; a wholly inapplicable set satisfies
 * NOTHING (fail-closed: no vacuous pass). interop.test.ts proves the mirror
 * against domain-core directly.
 */

import { deepFreeze, isNonEmptyString, isNonNegativeInteger, isPositiveInteger, isRecord, isUnitInterval, stableDigestJson, type JsonObject } from './primitives';
import type { JsonValue } from './primitives';
import { isMetricId, type MetricId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type EvalError, type EvalResult } from './errors';

// ---------------------------------------------------------------------------
// The constraint-satisfaction aggregate vocabulary (L7 first-class)
// ---------------------------------------------------------------------------

/**
 * The aggregate constraint statistics a metric can measure — the closed
 * vocabulary of domain-core's `ConstraintEvaluationReport` aggregates.
 */
export type ConstraintAggregate =
  | 'satisfied'
  | 'violated'
  | 'errors'
  | 'notApplicable'
  | 'blockingViolations'
  | 'advisoryViolations'
  | 'satisfiedRatio';

/** Runtime-checkable list of constraint aggregates. */
export const CONSTRAINT_AGGREGATES: readonly ConstraintAggregate[] = [
  'satisfied',
  'violated',
  'errors',
  'notApplicable',
  'blockingViolations',
  'advisoryViolations',
  'satisfiedRatio',
] as const;

/** Guard: a constraint-aggregate name. */
export function isConstraintAggregate(v: unknown): v is ConstraintAggregate {
  return typeof v === 'string' && (CONSTRAINT_AGGREGATES as readonly string[]).includes(v);
}

/**
 * Constraint-satisfaction counts — the SEMANTIC MIRROR of the aggregate
 * fields of domain-core's `ConstraintEvaluationReport` (L7: these counts are
 * the only attainment inputs anywhere in the evaluation lane).
 */
export interface ConstraintSatisfactionCounts {
  readonly satisfied: number;
  readonly violated: number;
  readonly errors: number;
  readonly notApplicable: number;
  readonly blockingViolations: number;
  readonly advisoryViolations: number;
}

/** Guard: `ConstraintSatisfactionCounts` (all counts non-negative integers). */
export function isConstraintSatisfactionCounts(v: unknown): v is ConstraintSatisfactionCounts {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.satisfied) &&
    isNonNegativeInteger(v.violated) &&
    isNonNegativeInteger(v.errors) &&
    isNonNegativeInteger(v.notApplicable) &&
    isNonNegativeInteger(v.blockingViolations) &&
    isNonNegativeInteger(v.advisoryViolations)
  );
}

/**
 * The satisfied ratio under the MIRRORED semantics of domain-core's
 * `ConstraintEvaluationReport.satisfiedRatio`:
 * satisfied / (satisfied + violated + errors) — `not_applicable` excluded;
 * ZERO when nothing was applicable (a wholly inapplicable set satisfies
 * nothing — fail-closed: no vacuous pass).
 */
export function satisfiedRatioOf(counts: ConstraintSatisfactionCounts): number {
  const applicable = counts.satisfied + counts.violated + counts.errors;
  if (applicable === 0) return 0;
  return counts.satisfied / applicable;
}

/**
 * Extract one {@link ConstraintAggregate} from constraint-satisfaction
 * counts. Total and pure: every aggregate of every valid counts record is
 * computable, counts are non-negative integers and the ratio is a unit
 * interval (the mirror semantics above).
 */
export function constraintAggregateValue(
  aggregate: ConstraintAggregate,
  counts: ConstraintSatisfactionCounts,
): number {
  switch (aggregate) {
    case 'satisfied':
      return counts.satisfied;
    case 'violated':
      return counts.violated;
    case 'errors':
      return counts.errors;
    case 'notApplicable':
      return counts.notApplicable;
    case 'blockingViolations':
      return counts.blockingViolations;
    case 'advisoryViolations':
      return counts.advisoryViolations;
    case 'satisfiedRatio':
      return satisfiedRatioOf(counts);
  }
}

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

/**
 * One registered metric definition — DATA, never a lambda. Discriminated by
 * `kind`:
 * - `constraint-aggregate` metrics measure aggregate constraint statistics
 *   (first-class; the only gateable kind).
 * - `risk-adjusted-ref` metrics REFERENCE a risk-adjusted figure by opaque
 *   string; the figure itself never enters an evaluation record (L7: never
 *   the sole criterion, structurally never ANY criterion of a verdict).
 */
export type MetricDefinition =
  | {
      readonly kind: 'constraint-aggregate';
      readonly metricId: MetricId;
      readonly aggregate: ConstraintAggregate;
      /** Human-readable context. NEVER interpreted. */
      readonly description?: string;
    }
  | {
      readonly kind: 'risk-adjusted-ref';
      readonly metricId: MetricId;
      /** Opaque reference to the risk-adjusted figure (e.g. "figure:sharpe@2"). */
      readonly figureRef: string;
      /** Human-readable context. NEVER interpreted. */
      readonly description?: string;
    };

/** Guard: `MetricDefinition`. */
export function isMetricDefinition(v: unknown): v is MetricDefinition {
  if (!isRecord(v)) return false;
  if (!isMetricId(v.metricId)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  if (v.kind === 'constraint-aggregate') return isConstraintAggregate(v.aggregate);
  if (v.kind === 'risk-adjusted-ref') return isNonEmptyString(v.figureRef);
  return false;
}

// ---------------------------------------------------------------------------
// Metric results
// ---------------------------------------------------------------------------

/**
 * The measured value of one metric. Discriminated by `kind` and structurally
 * tied to the definition's kind:
 * - `constraint-aggregate`: a count (non-negative integer) or, for the
 *   `satisfiedRatio` aggregate, a unit-interval number.
 * - `risk-adjusted-ref`: an OPAQUE reference to the computed figure record —
 *   never the numeric figure (L7).
 */
export type MetricValue =
  | { readonly kind: 'constraint-aggregate'; readonly aggregate: ConstraintAggregate; readonly value: number }
  | { readonly kind: 'risk-adjusted-ref'; readonly figureResultRef: string };

/** One measured metric: the metric's id plus its value. */
export interface MetricResult {
  readonly metricId: MetricId;
  readonly value: MetricValue;
}

/** Guard: `MetricValue`. */
export function isMetricValue(v: unknown): v is MetricValue {
  if (!isRecord(v)) return false;
  if (v.kind === 'constraint-aggregate') {
    if (!isConstraintAggregate(v.aggregate)) return false;
    if (typeof v.value !== 'number' || !Number.isFinite(v.value)) return false;
    if (v.aggregate === 'satisfiedRatio') return v.value >= 0 && v.value <= 1;
    return Number.isInteger(v.value) && v.value >= 0;
  }
  if (v.kind === 'risk-adjusted-ref') return isNonEmptyString(v.figureResultRef);
  return false;
}

/** Guard: `MetricResult`. */
export function isMetricResult(v: unknown): v is MetricResult {
  if (!isRecord(v)) return false;
  return isMetricId(v.metricId) && isMetricValue(v.value);
}

// ---------------------------------------------------------------------------
// The metric registry
// ---------------------------------------------------------------------------

/**
 * A validated, immutable collection of metric definitions. Metric ids are
 * unique within the registry (a duplicate is a typed error at construction);
 * the registry is the ONLY authority for interpreting a `MetricId`.
 */
export interface MetricRegistry {
  readonly metrics: readonly MetricDefinition[];
}

/** Guard: `MetricRegistry` (delegates to the definition guard + uniqueness). */
export function isMetricRegistry(v: unknown): v is MetricRegistry {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.metrics)) return false;
  const seen = new Set<string>();
  for (const definition of v.metrics) {
    if (!isMetricDefinition(definition)) return false;
    if (seen.has(definition.metricId)) return false;
    seen.add(definition.metricId);
  }
  return true;
}

/**
 * Collect-all validation of an untrusted list of metric definitions. Every
 * violation is reported with an indexed dotted path; duplicate metric ids
 * are rejected (`duplicate_metric`). On success the registry is returned
 * deeply frozen.
 */
export function createMetricRegistry(definitions: unknown): EvalResult<MetricRegistry> {
  if (!Array.isArray(definitions)) {
    return { ok: false, errors: [invalidType('createMetricRegistry expects an array of metric definitions')] };
  }
  const errors: EvalError[] = [];
  const validated: MetricDefinition[] = [];
  const seen = new Set<string>();

  definitions.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      errors.push(invalidType(`definitions[${index}] must be an object`));
      return;
    }
    if (candidate.kind !== 'constraint-aggregate' && candidate.kind !== 'risk-adjusted-ref') {
      errors.push(invalidField(`definitions[${index}].kind`, `must be 'constraint-aggregate' or 'risk-adjusted-ref'`));
      return;
    }
    if (candidate.metricId === undefined) {
      errors.push(missingField(`definitions[${index}].metricId`));
      return;
    }
    if (!isMetricId(candidate.metricId)) {
      errors.push(invalidField(`definitions[${index}].metricId`, 'must be a non-empty metric id'));
      return;
    }
    if (seen.has(candidate.metricId)) {
      errors.push(invalidField(`definitions[${index}].metricId`, `duplicate metric id "${candidate.metricId}" — registry ids are unique`));
      return;
    }
    if (!isMetricDefinition(candidate)) {
      if (candidate.kind === 'constraint-aggregate') {
        errors.push(invalidField(`definitions[${index}].aggregate`, `must be one of ${CONSTRAINT_AGGREGATES.join(' | ')}`));
      } else {
        errors.push(invalidField(`definitions[${index}].figureRef`, 'must be a non-empty opaque figure reference'));
      }
      if (candidate.description !== undefined && !isNonEmptyString(candidate.description)) {
        errors.push(invalidField(`definitions[${index}].description`, 'must be a non-empty string when present'));
      }
      return;
    }
    seen.add(candidate.metricId);
    validated.push(candidate);
  });

  if (errors.length > 0) return { ok: false, errors };
  return ok(deepFreeze({ metrics: validated }));
}

/** The metric definition registered under `metricId`, or `undefined`. */
export function lookupMetric(registry: MetricRegistry, metricId: MetricId): MetricDefinition | undefined {
  return registry.metrics.find((definition) => definition.metricId === metricId);
}

/**
 * Validate one untrusted metric result against a registry: the metric must
 * exist (`unknown_metric`) and the value's kind must match the definition's
 * kind (`invalid_metric`). Returns the narrowed result deeply frozen.
 */
export function validateMetricResult(registry: MetricRegistry, result: unknown): EvalResult<MetricResult> {
  if (!isRecord(result)) {
    return { ok: false, errors: [invalidType('metric result must be an object')] };
  }
  if (result.metricId === undefined) {
    return { ok: false, errors: [missingField('metricId')] };
  }
  if (!isMetricId(result.metricId)) {
    return { ok: false, errors: [invalidField('metricId', 'must be a non-empty metric id')] };
  }
  const definition = lookupMetric(registry, result.metricId);
  if (definition === undefined) {
    return fail('unknown_metric', `metric "${result.metricId}" is not registered`, 'metricId');
  }
  if (!isMetricValue(result.value)) {
    return { ok: false, errors: [invalidField('value', 'must be a metric value matching the metric kind')] };
  }
  if (result.value.kind !== definition.kind) {
    return fail(
      'invalid_metric',
      `metric "${result.metricId}" is registered as kind "${definition.kind}" but the result carries kind "${result.value.kind}"`,
      'value.kind',
    );
  }
  return ok(
    deepFreeze({
      metricId: result.metricId,
      value: result.value,
    } satisfies MetricResult),
  );
}

/**
 * Deterministic registry identity: a digest over the canonical JSON of the
 * definitions in registry order. Equal registries always share the id
 * (L9 lineage binding for evaluation configs).
 */
export function metricRegistryId(registry: MetricRegistry): string {
  const tree: JsonValue = {
    metrics: registry.metrics.map((definition): JsonValue => {
      const base: JsonObject =
        definition.kind === 'constraint-aggregate'
          ? { kind: definition.kind, metricId: definition.metricId, aggregate: definition.aggregate }
          : { kind: definition.kind, metricId: definition.metricId, figureRef: definition.figureRef };
      return definition.description !== undefined ? { ...base, description: definition.description } : base;
    }),
  };
  return stableDigestJson(tree);
}

/** Guard re-export for doc tests: a positive integer (evidence-volume thresholds). */
export { isPositiveInteger };
