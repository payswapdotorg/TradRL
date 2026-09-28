/**
 * Behavioral tests for @tradrl/evaluation verdict compilation:
 * - L7: attainment responds ONLY to constraint-satisfaction counts; a
 *   PnL-only success field is UNREPRESENTABLE in an AttainmentVerdict
 *   (compile-time guard + runtime recursive-key solicitude scan);
 * - the worst-split multi-split semantics (blocking > error > below-required
 *   > vacuous > missing);
 * - COMPUTED limitations (never caller-supplied) and the deterministic
 *   confidence block;
 * - determinism: same inputs -> byte-identical verdict twice; mutation of
 *   ANY input changes the verdict hash (inputDigest law);
 * - the T007 bridge: toAttainmentEvidence projects guard-valid evidence;
 * - fail-closed typed errors (invalid inputs, lineage mismatch, policy
 *   coverage).
 */

import { describe, expect, it } from 'vitest';
import { expectTypeOf } from 'vitest';

import {
  compileAttainmentVerdict,
  isAcceptanceCriteria,
  isAttainmentEvidence,
  isAttainmentVerdict,
  isCriterionBinding,
  isCriterionEvaluationSummary,
  isEvaluationConfig,
  isSplitConstraintReport,
  policyCoverageProblems,
  splitConstraintReport,
  toAttainmentEvidence,
  verdictIdOf,
  type AcceptanceCriteria,
  type AttainmentVerdict,
  type ConfidenceThresholds,
  type ConstraintCheckMirror,
  type CriterionBinding,
  type EvaluationConfig,
  type EvaluationSuite,
  type SplitConstraintReport,
  type VerdictCompilationInput,
  type Mutable,
  type SuiteId,
  type MetricId,
  type EvaluatorVersionRef,
  type SplitPolicyRef,
} from './index';

/** Trusted-literal id constructors (test-local, mirrors the ids module). */
const suiteId = (id: string): SuiteId => id as SuiteId;
const metricId = (id: string): MetricId => id as MetricId;
const evaluatorVersionRef = (id: string): EvaluatorVersionRef => id as EvaluatorVersionRef;
const splitPolicyRef = (id: string): SplitPolicyRef => id as SplitPolicyRef;
import { createEvaluationSuite } from './index';
import { requireTimestampMs } from './primitives';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const THRESHOLDS: ConfidenceThresholds = {
  highEvidenceVolume: 12,
  moderateEvidenceVolume: 4,
  maxVacuousShareForHigh: 0,
  maxVacuousShareForModerate: 0.25,
};

function criteriaFixture(overrides: { requiredSatisfaction?: number } = {}): AcceptanceCriteria {
  const bindings: CriterionBinding[] = [
    {
      criterionId: 'hard-limits',
      requiredSatisfaction: overrides.requiredSatisfaction ?? 1,
      gatingConstraintIds: ['max-exposure', 'asset-allowlist'],
      blockingConstraintIds: ['max-exposure', 'asset-allowlist'],
    },
    {
      criterionId: 'ops-hygiene',
      requiredSatisfaction: 0.5,
      gatingConstraintIds: ['max-exposure', 'asset-allowlist', 'kill-switch-armed'],
      blockingConstraintIds: ['max-exposure', 'asset-allowlist'],
    },
  ];
  return {
    id: 'ac:5:goal-1:1:3:set-1:4' as AcceptanceCriteria['id'],
    goal: { goalId: 'goal-1', version: 1 },
    constraintSet: { id: 'set-1' as never, version: 4 },
    criteria: bindings,
    evaluationPolicy: {
      blindEvaluationRef: 'split.blind-2024q4',
      walkForwardRef: 'split.wf-anchored',
      regimeRef: 'split.regime-crisis',
    },
  };
}

function suiteFixture(): EvaluationSuite {
  const result = createEvaluationSuite({
    suiteId: 'suite.friction-2024q4',
    grade: 'release',
    evaluatorVersion: 'evaluator.friction-suite@3',
    members: [
      { kind: 'blind', splitPolicy: splitPolicyRef('split.blind-2024q4'), metricIds: [metricId('metric.gate-ratio')] },
      { kind: 'walk-forward', splitPolicy: splitPolicyRef('split.wf-anchored'), metricIds: [metricId('metric.gate-ratio')] },
      { kind: 'regime', splitPolicy: splitPolicyRef('split.regime-crisis'), metricIds: [metricId('metric.gate-ratio')] },
    ],
    adversarialSuiteRefs: ['suite.adversarial-pop-1'],
  });
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function configFixture(): EvaluationConfig {
  return {
    evaluatorVersion: 'evaluator.friction-suite@3' as EvaluatorVersionRef,
    suite: 'suite.friction-2024q4' as SuiteId,
    criteria: criteriaFixture().id,
    confidence: THRESHOLDS,
  };
}

function check(constraintId: string, status: ConstraintCheckMirror['status'], severity: ConstraintCheckMirror['severity'] = 'blocking'): ConstraintCheckMirror {
  return { constraintId, severity, status };
}

function report(split: string, checks: readonly ConstraintCheckMirror[]): SplitConstraintReport {
  const result = splitConstraintReport(split as never, checks);
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function strongReports(): readonly SplitConstraintReport[] {
  return [
    report('split.blind-2024q4', [check('max-exposure', 'satisfied'), check('asset-allowlist', 'satisfied'), check('kill-switch-armed', 'satisfied', 'advisory')]),
    report('split.wf-anchored', [check('max-exposure', 'satisfied'), check('asset-allowlist', 'satisfied'), check('kill-switch-armed', 'satisfied', 'advisory')]),
    report('split.regime-crisis', [check('max-exposure', 'satisfied'), check('asset-allowlist', 'satisfied'), check('kill-switch-armed', 'violated', 'advisory')]),
  ];
}

function compilationFixture(overrides: Partial<VerdictCompilationInput> = {}): VerdictCompilationInput {
  return {
    criteria: criteriaFixture(),
    config: configFixture(),
    suite: suiteFixture(),
    reports: strongReports(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Input guards
// ---------------------------------------------------------------------------

describe('verdict input guards (T007/domain-core mirrors)', () => {
  it('isCriterionBinding enforces non-empty gates and blocking ⊆ gating', () => {
    expect(isCriterionBinding(criteriaFixture().criteria[0])).toBe(true);
    expect(isCriterionBinding({ ...criteriaFixture().criteria[0] as CriterionBinding, gatingConstraintIds: [] })).toBe(false);
    expect(isCriterionBinding({ ...criteriaFixture().criteria[0] as CriterionBinding, gatingConstraintIds: ['a', 'a'] })).toBe(false);
    expect(isCriterionBinding({ ...criteriaFixture().criteria[0] as CriterionBinding, blockingConstraintIds: ['not-in-gate'] })).toBe(false);
    expect(isCriterionBinding({ ...criteriaFixture().criteria[0] as CriterionBinding, requiredSatisfaction: 1.5 })).toBe(false);
  });

  it('isAcceptanceCriteria enforces lineage and unique criterion ids', () => {
    expect(isAcceptanceCriteria(criteriaFixture())).toBe(true);
    expect(isAcceptanceCriteria({ ...criteriaFixture(), criteria: [] })).toBe(false);
    const duplicated = criteriaFixture();
    expect(isAcceptanceCriteria({ ...duplicated, criteria: [...duplicated.criteria, duplicated.criteria[0] as CriterionBinding] })).toBe(false);
    expect(isAcceptanceCriteria({ ...criteriaFixture(), evaluationPolicy: { blindEvaluationRef: '', walkForwardRef: 'w', regimeRef: 'r' } })).toBe(false);
    expect(isAcceptanceCriteria(null)).toBe(false);
  });

  it('splitConstraintReport recomputes aggregates from checks (never trusts the caller)', () => {
    const built = report('split.x', [check('a', 'satisfied'), check('b', 'violated'), check('c', 'not_applicable', 'advisory'), check('d', 'error', 'advisory')]);
    expect(built.satisfied).toBe(1);
    expect(built.violated).toBe(1);
    expect(built.errors).toBe(1);
    expect(built.notApplicable).toBe(1);
    expect(built.blockingViolations).toBe(1);
    expect(built.advisoryViolations).toBe(0);
    expect(isSplitConstraintReport(built)).toBe(true);
    // Forged aggregates fail the guard.
    expect(isSplitConstraintReport({ ...built, satisfied: 99 })).toBe(false);
    // A non-empty string IS a structurally valid ref; the empty string is not.
    expect(splitConstraintReport('' as never, []).ok).toBe(false);
    expect(splitConstraintReport('split.x' as never, [{ constraintId: 'a', severity: 'weird' as never, status: 'satisfied' }]).ok).toBe(false);
  });

  it('isEvaluationConfig enforces threshold ordering', () => {
    expect(isEvaluationConfig(configFixture())).toBe(true);
    expect(isEvaluationConfig({ ...configFixture(), confidence: { ...THRESHOLDS, moderateEvidenceVolume: 99 } })).toBe(false);
    // Contract law: maxVacuousShareForModerate >= maxVacuousShareForHigh
    // (0.1 >= 0 is LEGAL; the invalid ordering is moderate < high).
    expect(isEvaluationConfig({ ...configFixture(), confidence: { ...THRESHOLDS, maxVacuousShareForHigh: 0.5, maxVacuousShareForModerate: 0.1 } })).toBe(false);
    expect(isEvaluationConfig(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Compilation semantics
// ---------------------------------------------------------------------------

describe('compileAttainmentVerdict (worst-split semantics)', () => {
  it('attains when every criterion attains in every split (limitations empty, high confidence)', () => {
    const result = compileAttainmentVerdict(compilationFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    const verdict = result.value;
    expect(verdict.attained).toBe(true);
    expect(verdict.limitations).toEqual([]);
    expect(verdict.perCriterion.map((c) => c.status)).toEqual(['attained', 'attained']);
    // ops-hygiene aggregate over 3 splits: 8 satisfied / 9 applicable.
    expect(verdict.perCriterion[1]?.satisfiedRatio).toBeCloseTo(8 / 9, 12);
    expect(verdict.confidence.level).toBe('high');
    // (2 gates x 3 splits) + (3 gates x 3 splits) applicable evaluations = 15.
    expect(verdict.confidence.totalApplicableConstraints).toBe(15);
    expect(isAttainmentVerdict(verdict)).toBe(true);
  });

  it('a violation in ONE split fails the criterion (worst-split law — friendly splits do not carry)', () => {
    const reports = strongReports();
    const failing = [check('max-exposure', 'violated'), check('asset-allowlist', 'satisfied'), check('kill-switch-armed', 'satisfied', 'advisory')];
    const result = compileAttainmentVerdict(compilationFixture({ reports: [...reports.slice(0, 2), report('split.regime-crisis', failing)] }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    const verdict = result.value;
    expect(verdict.attained).toBe(false);
    expect(verdict.perCriterion[0]?.status).toBe('blocking-violation');
    expect(verdict.perCriterion[0]?.perSplit[2]?.satisfiedRatio).toBe(0.5);
    // hard-limits requires 1.0; 0.5 in the regime split fails it.
    expect(verdict.perCriterion[0]?.attained).toBe(false);
  });

  it('evaluation errors force not-attained with the computed limitation', () => {
    const reports = [
      ...strongReports().slice(0, 2),
      report('split.regime-crisis', [check('max-exposure', 'error'), check('asset-allowlist', 'satisfied'), check('kill-switch-armed', 'satisfied', 'advisory')]),
    ];
    const result = compileAttainmentVerdict(compilationFixture({ reports }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.attained).toBe(false);
    expect(result.value.limitations).toContain('evaluation-errors-present');
    expect(result.value.perCriterion[0]?.status).toBe('evaluation-error');
  });

  it('a wholly inapplicable gate satisfies NOTHING (vacuous split; fail-closed)', () => {
    const reports = [
      ...strongReports().slice(0, 2),
      report('split.regime-crisis', []), // no checks at all in one split
    ];
    const result = compileAttainmentVerdict(compilationFixture({ reports }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    const verdict = result.value;
    expect(verdict.attained).toBe(false);
    expect(verdict.limitations).toContain('vacuous-split');
    expect(verdict.perCriterion[0]?.status).toBe('vacuous-evaluation');
    expect(verdict.perCriterion[0]?.perSplit[2]?.satisfiedRatio).toBe(0);
    expect(verdict.confidence.level).toBe('low');
  });

  it('missing split reports surface as computed limitations and vacuous evidence', () => {
    const result = compileAttainmentVerdict(compilationFixture({ reports: strongReports().slice(0, 2) }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    const verdict = result.value;
    expect(verdict.attained).toBe(false);
    expect(verdict.limitations).toContain('incomplete-split-coverage');
    expect(verdict.limitations).toContain('vacuous-split');
    expect(verdict.perCriterion[0]?.perSplit[2]?.satisfiedRatio).toBe(0);
  });

  it('a report naming an uncomposed split is an unknown-split-report limitation', () => {
    const extra = report('split.not-in-suite', [check('max-exposure', 'satisfied')]);
    const result = compileAttainmentVerdict(compilationFixture({ reports: [...strongReports(), extra] }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.limitations).toContain('unknown-split-report');
    expect(result.value.attained).toBe(false);
  });

  it('two reports for the same split are a typed invalid_report error', () => {
    const dup = strongReports()[0] as SplitConstraintReport;
    const result = compileAttainmentVerdict(compilationFixture({ reports: [...strongReports(), dup] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_report');
  });

  it('status priority: blocking-violation outranks evaluation-error and below-required', () => {
    const both = report('split.regime-crisis', [
      check('max-exposure', 'violated'), // blocking violation
      check('asset-allowlist', 'error'), // and an error
      check('kill-switch-armed', 'satisfied', 'advisory'),
    ]);
    const result = compileAttainmentVerdict(compilationFixture({ reports: [...strongReports().slice(0, 2), both] }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.perCriterion[0]?.status).toBe('blocking-violation');
  });

  it('confidence derives deterministically from the thresholds', () => {
    // Moderate: enough volume, but a vacuous share above the high bar and at/below the moderate bar.
    const reports = [
      report('split.blind-2024q4', [check('max-exposure', 'satisfied'), check('asset-allowlist', 'satisfied'), check('kill-switch-armed', 'satisfied', 'advisory')]),
      report('split.wf-anchored', [check('max-exposure', 'satisfied'), check('asset-allowlist', 'satisfied'), check('kill-switch-armed', 'satisfied', 'advisory')]),
      report('split.regime-crisis', [check('kill-switch-armed', 'satisfied', 'advisory')]), // gating-applicable = 0 for hard-limits -> vacuous
    ];
    const result = compileAttainmentVerdict(compilationFixture({ reports }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    // Enough volume (11 >= 4), vacuity above the HIGH bar (0.167 > 0) but at/below
    // the moderate bar (0.25) — the moderate tier, per the three-tier law.
    expect(result.value.confidence.level).toBe('moderate');
    expect(result.value.confidence.vacuousSplits).toBe(1);
    expect(result.value.confidence.vacuousShare).toBeCloseTo(1 / 6, 12);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed typed errors
// ---------------------------------------------------------------------------

describe('compileAttainmentVerdict (fail-closed)', () => {
  it('structurally invalid inputs are collected, never silently succeeded', () => {
    const result = compileAttainmentVerdict({ criteria: null, config: null, suite: null, reports: null } as unknown as VerdictCompilationInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    const paths = result.errors.map((e) => e.path);
    expect(paths).toContain('criteria');
    expect(paths).toContain('config');
    expect(paths).toContain('suite');
    expect(paths).toContain('reports');
  });

  it('lineage mismatch between config and criteria/suite/evaluator is a typed criteria_mismatch', () => {
    const wrongCriteria = compileAttainmentVerdict(compilationFixture({ config: { ...configFixture(), criteria: 'ac:5:goal-9:1:3:set-9:4' as never } }));
    expect(wrongCriteria.ok).toBe(false);
    if (wrongCriteria.ok) throw new Error('must fail');
    expect(wrongCriteria.errors[0]?.code).toBe('criteria_mismatch');

    const wrongSuite = compileAttainmentVerdict(compilationFixture({ config: { ...configFixture(), suite: 'suite.other' as never } }));
    expect(wrongSuite.ok).toBe(false);
    if (wrongSuite.ok) throw new Error('must fail');
    expect(wrongSuite.errors[0]?.code).toBe('criteria_mismatch');

    const wrongEvaluator = compileAttainmentVerdict(compilationFixture({ config: { ...configFixture(), evaluatorVersion: 'evaluator.other@1' as never } }));
    expect(wrongEvaluator.ok).toBe(false);
    if (wrongEvaluator.ok) throw new Error('must fail');
    expect(wrongEvaluator.errors[0]?.code).toBe('criteria_mismatch');
  });

  it('L10/L11: a suite that does not cover the pinned evaluation policy refuses to compile (evaluation cannot be shopped)', () => {
    const shopped = createEvaluationSuite({
      suiteId: 'suite.friendly-only',
      grade: 'release',
      evaluatorVersion: 'evaluator.friction-suite@3',
      members: [
        { kind: 'blind', splitPolicy: splitPolicyRef('split.blind-friendly'), metricIds: [metricId('metric.gate-ratio')] },
        { kind: 'walk-forward', splitPolicy: splitPolicyRef('split.wf-anchored'), metricIds: [metricId('metric.gate-ratio')] },
        { kind: 'regime', splitPolicy: splitPolicyRef('split.regime-crisis'), metricIds: [metricId('metric.gate-ratio')] },
      ],
      adversarialSuiteRefs: ['suite.adversarial-pop-1'],
    });
    if (!shopped.ok) throw new Error('fixture must be valid');
    // The config must PIN the shopped suite (lineage is checked before
    // coverage — see the criteria_mismatch law); the point of this test is
    // the coverage refusal, not the lineage refusal.
    const result = compileAttainmentVerdict(compilationFixture({
      suite: shopped.value,
      config: { ...configFixture(), suite: suiteId('suite.friendly-only') },
    }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('policy_coverage_missing');
    expect(result.errors[0]?.message).toContain('blindEvaluationRef');

    const problems = policyCoverageProblems(criteriaFixture(), shopped.value);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe('policy_coverage_missing');
  });

  it('policyCoverageProblems is empty when the suite honors every pinned ref', () => {
    expect(policyCoverageProblems(criteriaFixture(), suiteFixture())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Determinism (acceptance #4)
// ---------------------------------------------------------------------------

describe('verdict determinism', () => {
  it('same inputs -> byte-identical verdict twice (canonical JSON equality)', () => {
    const a = compileAttainmentVerdict(compilationFixture());
    const b = compileAttainmentVerdict(compilationFixture());
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error('must succeed');
    expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
    expect(a.value.verdictHash).toBe(b.value.verdictHash);
    expect(a.value.inputDigest).toBe(b.value.inputDigest);
    expect(a.value.verdictId).toBe(b.value.verdictId);
  });

  it('mutation of ANY input changes the verdict hash (inputDigest law)', () => {
    const base = compileAttainmentVerdict(compilationFixture());
    if (!base.ok) throw new Error('must succeed');

    // 1. criteria: requiredSatisfaction of one criterion
    const criteriaMutated = compileAttainmentVerdict(compilationFixture({ criteria: criteriaFixture({ requiredSatisfaction: 0.9 }) }));
    if (!criteriaMutated.ok) throw new Error('must succeed');
    expect(criteriaMutated.value.verdictHash).not.toBe(base.value.verdictHash);

    // 2. reports: one check's status
    const reports = strongReports();
    const flipped = [report('split.blind-2024q4', [check('max-exposure', 'violated'), check('asset-allowlist', 'satisfied'), check('kill-switch-armed', 'satisfied', 'advisory')]), ...reports.slice(1)];
    const reportMutated = compileAttainmentVerdict(compilationFixture({ reports: flipped }));
    if (!reportMutated.ok) throw new Error('must succeed');
    expect(reportMutated.value.verdictHash).not.toBe(base.value.verdictHash);

    // 3. config: threshold mutation (changes confidence -> hash changes)
    const configMutated = compileAttainmentVerdict(compilationFixture({ config: { ...configFixture(), confidence: { ...THRESHOLDS, highEvidenceVolume: 99 } } }));
    if (!configMutated.ok) throw new Error('must succeed');
    expect(configMutated.value.verdictHash).not.toBe(base.value.verdictHash);

    // 4. suite: evaluator version mutation
    const otherEvaluatorSuite = createEvaluationSuite({
      suiteId: 'suite.friction-2024q4',
      grade: 'release',
      evaluatorVersion: 'evaluator.friction-suite@4',
      members: suiteFixture().members.map((m) => ({ ...m })),
      adversarialSuiteRefs: ['suite.adversarial-pop-1'],
    });
    if (!otherEvaluatorSuite.ok) throw new Error('must succeed');
    const suiteMutated = compileAttainmentVerdict(
      compilationFixture({
        suite: otherEvaluatorSuite.value,
        config: { ...configFixture(), evaluatorVersion: 'evaluator.friction-suite@4' as never },
      }),
    );
    if (!suiteMutated.ok) throw new Error('must succeed');
    expect(suiteMutated.value.verdictHash).not.toBe(base.value.verdictHash);

    // 5. a NON-gating check mutation still changes the digest (nothing hides).
    const withNoise = [...strongReports()];
    const noiseChecks = [...(withNoise[0] as SplitConstraintReport).checks, { constraintId: 'not-gating-anywhere', severity: 'advisory' as const, status: 'not_applicable' as const }];
    withNoise[0] = report('split.blind-2024q4', noiseChecks);
    const noiseMutated = compileAttainmentVerdict(compilationFixture({ reports: withNoise }));
    if (!noiseMutated.ok) throw new Error('must succeed');
    expect(noiseMutated.value.inputDigest).not.toBe(base.value.inputDigest);
  });

  it('the verdict is deeply frozen; mutation attempts throw', () => {
    const result = compileAttainmentVerdict(compilationFixture());
    if (!result.ok) throw new Error('must succeed');
    const verdict = result.value;
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(() => {
      (verdict as Mutable<AttainmentVerdict>).attained = true;
    }).toThrow();
    expect(() => {
      (verdict.perCriterion[0] as Mutable<{ attained: boolean }>).attained = true;
    }).toThrow();
  });

  it('verdictIdOf is a deterministic function of the lineage triple', () => {
    const id = verdictIdOf(criteriaFixture().id, 'suite.friction-2024q4' as never, 'evaluator.friction-suite@3' as never);
    expect(id).toBe(verdictIdOf(criteriaFixture().id, 'suite.friction-2024q4' as never, 'evaluator.friction-suite@3' as never));
    expect(id.startsWith('vd:')).toBe(true);
    expect(id).not.toBe(verdictIdOf(criteriaFixture().id, 'suite.other' as never, 'evaluator.friction-suite@3' as never));
  });
});

// ---------------------------------------------------------------------------
// L7 — the PnL-solicitude structural law (acceptance #3)
// ---------------------------------------------------------------------------

describe('PnL solicitude (L7): a PnL-only success field is unrepresentable', () => {
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

  /**
   * COMPILE-TIME GUARD: the excess-property check rejects any object
   * literal carrying a PnL-shaped field where an AttainmentVerdict is
   * expected. `@ts-expect-error` makes this a pnpm-typecheck trip wire: if
   * anyone ever ADDS such a field to the record, the directive becomes
   * unused and typecheck FAILS — the violation cannot slip in silently.
   */
  it('COMPILE-TIME: an AttainmentVerdict literal carrying a pnl field does not typecheck', () => {
    const verdict = compileAttainmentVerdict(compilationFixture());
    if (!verdict.ok) throw new Error('must succeed');
    // @ts-expect-error — AttainmentVerdict has no pnl field (L7); this assignment must fail to compile.
    const bad: AttainmentVerdict = { ...verdict.value, pnl: 1_234_567.89, attained: true };
    // Runtime half: the type-level rejection above is the witness; the
    // runtime half asserts the COMPILER's own artifact never carries the
    // key (the `bad` literal is caller-side only and never survives a
    // recompile through the typed path).
    const recompiled = compileAttainmentVerdict(compilationFixture());
    if (!recompiled.ok) throw new Error('must succeed');
    expect(Object.keys(recompiled.value)).not.toContain('pnl');
    expect(bad.attained).toBe(true);
    expect(verdict.value.attained).toBe(true);
  });

  it('RUNTIME: no recursive key of the compilation path can name a performance figure', () => {
    const criteria = criteriaFixture();
    const config = configFixture();
    const suite = suiteFixture();
    const reports = strongReports();
    const result = compileAttainmentVerdict({ criteria, config, suite, reports });
    if (!result.ok) throw new Error('must succeed');
    const keys = new Set<string>();
    collectKeys(criteria, keys);
    collectKeys(config, keys);
    collectKeys(suite, keys);
    collectKeys(reports, keys);
    collectKeys(result.value, keys);
    const offenders = [...keys].filter((key) => PERFORMANCE_KEY_PATTERN.test(key));
    expect(offenders).toEqual([]);
  });

  it('BEHAVIORAL: attainment responds ONLY to constraint-satisfaction counts', () => {
    const criteria = criteriaFixture();
    const suite = suiteFixture();
    const config = configFixture();
    // A "spectacular" evaluation and a "poor" evaluation differ ONLY in counts.
    const strong = strongReports();
    const weak = [
      report('split.blind-2024q4', [check('max-exposure', 'violated'), check('asset-allowlist', 'violated'), check('kill-switch-armed', 'violated', 'advisory')]),
      report('split.wf-anchored', [check('max-exposure', 'violated'), check('asset-allowlist', 'violated'), check('kill-switch-armed', 'violated', 'advisory')]),
      report('split.regime-crisis', [check('max-exposure', 'violated'), check('asset-allowlist', 'violated'), check('kill-switch-armed', 'violated', 'advisory')]),
    ];
    const strongVerdict = compileAttainmentVerdict({ criteria, config, suite, reports: strong });
    const weakVerdict = compileAttainmentVerdict({ criteria, config, suite, reports: weak });
    if (!strongVerdict.ok || !weakVerdict.ok) throw new Error('must succeed');
    expect(strongVerdict.value.attained).toBe(true);
    expect(weakVerdict.value.attained).toBe(false);
  });

  it('TYPE-LEVEL: the AttainmentVerdict type surface excludes performance-figure fields', () => {
    // The record's field inventory, asserted at the type level: identity,
    // lineage, per-criterion evidence, limitations, confidence, digests —
    // nothing else compiles.
    expectTypeOf<AttainmentVerdict>().toEqualTypeOf<{
      readonly verdictId: AttainmentVerdict['verdictId'];
      readonly attained: boolean;
      readonly criteriaId: AttainmentVerdict['criteriaId'];
      readonly suite: AttainmentVerdict['suite'];
      readonly evaluatorVersion: AttainmentVerdict['evaluatorVersion'];
      readonly perCriterion: AttainmentVerdict['perCriterion'];
      readonly limitations: AttainmentVerdict['limitations'];
      readonly confidence: AttainmentVerdict['confidence'];
      readonly inputDigest: string;
      readonly verdictHash: string;
    }>();
  });
});

// ---------------------------------------------------------------------------
// The T007 bridge
// ---------------------------------------------------------------------------

describe('toAttainmentEvidence (T007 bridge)', () => {
  it('projects guard-valid evidence with aggregate counts per criterion', () => {
    const result = compileAttainmentVerdict(compilationFixture());
    if (!result.ok) throw new Error('must succeed');
    const evidence = toAttainmentEvidence(result.value, 'run.eval-42', requireTimestampMs(1_700_000_000_000));
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) throw new Error('must succeed');
    expect(isAttainmentEvidence(evidence.value)).toBe(true);
    expect(evidence.value.criteriaId).toBe(criteriaFixture().id);
    expect(evidence.value.evaluationRunRef).toBe('run.eval-42');
    // hard-limits: 2 gating checks x 3 splits, all satisfied.
    expect(evidence.value.evaluations[0]).toEqual({ criterionId: 'hard-limits', satisfied: 6, violated: 0, errors: 0, notApplicable: 0, blockingViolations: 0 });
    expect(isCriterionEvaluationSummary(evidence.value.evaluations[0])).toBe(true);
    expect(Object.isFrozen(evidence.value)).toBe(true);
  });

  it('fail-closed on bad verdict / run ref / timestamp', () => {
    const result = compileAttainmentVerdict(compilationFixture());
    if (!result.ok) throw new Error('must succeed');
    expect(toAttainmentEvidence(null as unknown as AttainmentVerdict, 'run', requireTimestampMs(1)).ok).toBe(false);
    expect(toAttainmentEvidence(result.value, '', requireTimestampMs(1)).ok).toBe(false);
    expect(toAttainmentEvidence(result.value, 'run', -1 as unknown as ReturnType<typeof requireTimestampMs>).ok).toBe(false);
    expect(toAttainmentEvidence(result.value, 'run', 1.5 as unknown as ReturnType<typeof requireTimestampMs>).ok).toBe(false);
  });
});
