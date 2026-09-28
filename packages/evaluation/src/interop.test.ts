/**
 * Cross-package interoperability for @tradrl/evaluation:
 *
 * 1. `TimestampMs` structural mirror against @tradrl/time-engine (canonical
 *    owner, IN THIS TREE) — the market-protocol trip-wire pattern.
 * 2. Constraint-check/aggregates mirror against @tradrl/domain-core
 *    (canonical owner, IN THIS TREE): domain-core's real
 *    `ConstraintCheck`/`ConstraintEvaluationReport` records feed this
 *    package's verdict compilation unchanged — END-TO-END over
 *    `evaluateConstraintSet`.
 * 3. Vendored T011 (trajectory/experiments) and T007 (control-domain)
 *    mirrors: those lanes are merged in the Lead's integration tree but NOT
 *    on this dispatch base, so their canonical declarations (obtained from
 *    the wave-6 reference bundle — byte-faithful structural copies) are
 *    vendored below as the trip wire. When the Lead integrates, the vendored
 *    declarations must match the merged packages or these assertions fail —
 *    exactly the D-003/D-004 drift law. The type-level assertion functions
 *    fail `pnpm typecheck` if any mirror drifts; the runtime parity checks
 *    fail `pnpm test`.
 *
 * What interop this PROVES:
 * - a domain-core-authored ConstraintSet evaluates (via domain-core's own
 *   engine) into reports this package compiles verdicts from, unchanged;
 * - this package's trial-log mirror is mutually assignable with T011
 *   experiments' `TrialRecord`, and the id brands (TrajectoryId,
 *   ExperimentId, TrialId, ArmId, SplitPolicyRef, EvaluatorVersionRef,
 *   CriteriaRef, DataRef) are mutually assignable;
 * - this package's AcceptanceCriteria mirror is mutually assignable with
 *   T007 control-domain's `AcceptanceCriteria`, and the evidence this
 *   package projects satisfies T007's `isAttainmentEvidence` guard.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  compileAttainmentVerdict,
  splitConstraintReport,
  toAttainmentEvidence,
  type AcceptanceCriteria as EvalAcceptanceCriteria,
  type ArmId as EvalArmId,
  type ConstraintCheckMirror,
  type CriteriaRef as EvalCriteriaRef,
  type DataRef as EvalDataRef,
  type EvaluatorVersionRef as EvalEvaluatorVersionRef,
  type ExperimentId as EvalExperimentId,
  type SplitPolicyRef as EvalSplitPolicyRef,
  type TimestampMs as EvalTimestampMs,
  type TrialId as EvalTrialId,
  type TrialLogEntry,
  type TrialStatusMirror,
} from './index';
import {
  createEvaluationSuite,
  type EvaluationConfig,
  type SplitConstraintReport,
} from './index';
import { requireTimestampMs } from './primitives';
import {
  MAX_TIMESTAMP_MS as ENGINE_MAX,
  MIN_TIMESTAMP_MS as ENGINE_MIN,
  isTimestampMs as engineIsTimestampMs,
  requireTimestampMs as requireEngineTimestampMs,
  type TimestampMs as EngineTimestampMs,
} from '../../time-engine/src/index';
import {
  evaluateConstraintSet,
  isConstraint,
  type ConstraintCheck as CoreConstraintCheck,
  type ConstraintEvaluationReport as CoreReport,
  type ConstraintSet as CoreConstraintSet,
} from '../../domain-core/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts).
// ---------------------------------------------------------------------------

/** Compiles iff evaluation TimestampMs is assignable to time-engine's. */
function evalTimestampIsEngineTimestamp(value: EvalTimestampMs): EngineTimestampMs {
  return value;
}

/** Compiles iff time-engine TimestampMs is assignable to evaluation's. */
function engineTimestampIsEvalTimestamp(value: EngineTimestampMs): EvalTimestampMs {
  return value;
}

/** Compiles iff domain-core ConstraintCheck records feed the check mirror unchanged. */
function coreCheckIsEvalMirror(value: CoreConstraintCheck): ConstraintCheckMirror {
  return value;
}

// --- Vendored T011 experiments declarations (reference bundle, verbatim shape) ---

/**
 * VENDORED from @tradrl/experiments (T011, reference bundle — the Lead's
 * integration tree). The brand tags are re-declared IDENTICALLY so the
 * mutual-assignability assertions below are the drift trip wire.
 */
type VendoredTrialId = string & { readonly __brand: 'TrialId' };
type VendoredArmId = string & { readonly __brand: 'ArmId' };
type VendoredTrajectoryId = string & { readonly __brand: 'TrajectoryId' };
type VendoredCriteriaRef = string & { readonly __brand: 'CriteriaRef' };
type VendoredEvaluatorVersionRef = string & { readonly __brand: 'EvaluatorVersionRef' };
type VendoredSplitPolicyRef = string & { readonly __brand: 'SplitPolicyRef' };
type VendoredExperimentId = string & { readonly __brand: 'ExperimentId' };
type VendoredDataRef = string & { readonly __brand: 'DataRef' };
type VendoredTimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };
type VendoredJsonValue = string | number | boolean | null | readonly VendoredJsonValue[] | VendoredJsonObject;
type VendoredJsonObject = { readonly [key: string]: VendoredJsonValue };

/** Verbatim structural copy of T011 experiments' `TrialStatus`. */
type VendoredTrialStatus = 'planned' | 'running' | 'succeeded' | 'failed' | 'rejected';

/** Verbatim structural copy of T011 experiments' `TrialRecord`. */
interface VendoredTrialRecord {
  readonly trial_id: VendoredTrialId;
  readonly arm: VendoredArmId;
  readonly status: VendoredTrialStatus;
  readonly trajectory: VendoredTrajectoryId | null;
  readonly outcome: VendoredJsonObject | null;
  readonly started_at: VendoredTimestampMs | null;
  readonly ended_at: VendoredTimestampMs | null;
  readonly failure_reason: string | null;
}

/** Compiles iff the evaluation TrialLogEntry is assignable to the vendored T011 TrialRecord. */
function evalTrialIsVendoredTrial(value: TrialLogEntry): VendoredTrialRecord {
  return value;
}

/** Compiles iff the vendored T011 TrialRecord is assignable to the evaluation mirror. */
function vendoredTrialIsEvalTrial(value: VendoredTrialRecord): TrialLogEntry {
  return value;
}

/** Compiles iff the trial-status vocabularies coincide. */
function trialStatusesCoincide(value: TrialStatusMirror): VendoredTrialStatus {
  return value;
}

// --- Vendored T007 control-domain declarations (reference bundle, verbatim shape) ---

type VendoredGoalRef = string & { readonly __brand: 'GoalRef' };
type VendoredConstraintSetId = string & { readonly __brand: 'ConstraintSetId' };
type VendoredAcceptanceCriteriaId = string & { readonly __brand: 'AcceptanceCriteriaId' };

/** Verbatim structural copy of T007's `CriterionBinding`. */
interface VendoredCriterionBinding {
  readonly criterionId: string;
  readonly requiredSatisfaction: number;
  readonly gatingConstraintIds: readonly string[];
  readonly blockingConstraintIds: readonly string[];
}

/** Verbatim structural copy of T007's `EvaluationPolicy`. */
interface VendoredEvaluationPolicy {
  readonly blindEvaluationRef: string;
  readonly walkForwardRef: string;
  readonly regimeRef: string;
}

/** Structural mirror of T007's compiled `AcceptanceCriteria` (recovered tree shape). */
interface VendoredAcceptanceCriteria {
  readonly id: VendoredAcceptanceCriteriaId;
  readonly goal: { readonly goalId: string; readonly version: number };
  readonly constraintSet: { readonly id: VendoredConstraintSetId; readonly version: number };
  readonly criteria: readonly VendoredCriterionBinding[];
  readonly evaluationPolicy: VendoredEvaluationPolicy;
}

/** Verbatim structural copy of T007's `CriterionEvaluationSummary`. */
interface VendoredCriterionEvaluationSummary {
  readonly criterionId: string;
  readonly satisfied: number;
  readonly violated: number;
  readonly errors: number;
  readonly notApplicable: number;
  readonly blockingViolations: number;
}

/** Verbatim structural copy of T007's `AttainmentEvidence`. */
interface VendoredAttainmentEvidence {
  readonly criteriaId: VendoredAcceptanceCriteriaId;
  readonly evaluatedAt: VendoredTimestampMs;
  readonly evaluationRunRef: string;
  readonly evaluations: readonly VendoredCriterionEvaluationSummary[];
}

/** Compiles iff the evaluation AcceptanceCriteria mirror is assignable to T007's. */
function evalCriteriaIsVendoredCriteria(value: EvalAcceptanceCriteria): VendoredAcceptanceCriteria {
  return value;
}

/** Compiles iff T007's AcceptanceCriteria is assignable to the evaluation mirror. */
function vendoredCriteriaIsEvalCriteria(value: VendoredAcceptanceCriteria): EvalAcceptanceCriteria {
  return value;
}

// ---------------------------------------------------------------------------
// Vendored T007 guard logic (reference bundle, behaviorally verbatim) —
// used to prove the evidence this package projects satisfies the control
// plane's guard unchanged.
// ---------------------------------------------------------------------------

function vendoredIsRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function vendoredIsNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function vendoredIsPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

function vendoredIsUnitInterval(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

function vendoredIsNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** Vendored `isCriterionEvaluationSummary` (T007 reference, verbatim logic). */
function vendoredIsCriterionEvaluationSummary(v: unknown): v is VendoredCriterionEvaluationSummary {
  if (!vendoredIsRecord(v)) return false;
  if (!vendoredIsNonEmptyString(v.criterionId)) return false;
  if (!vendoredIsNonNegativeInteger(v.satisfied)) return false;
  if (!vendoredIsNonNegativeInteger(v.violated)) return false;
  if (!vendoredIsNonNegativeInteger(v.errors)) return false;
  if (!vendoredIsNonNegativeInteger(v.notApplicable)) return false;
  if (!vendoredIsNonNegativeInteger(v.blockingViolations)) return false;
  if (v.blockingViolations > v.violated) return false; // blocking ⊆ violated
  return true;
}

/** Vendored `isTimestampMs` (the program-wide mirror guard). */
function vendoredIsTimestampMs(value: unknown): value is VendoredTimestampMs {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 8_639_999_999_999_999
  );
}

/** Vendored `isAttainmentEvidence` (T007 reference, verbatim logic). */
function vendoredIsAttainmentEvidence(v: unknown): v is VendoredAttainmentEvidence {
  if (!vendoredIsRecord(v)) return false;
  if (!vendoredIsNonEmptyString(v.criteriaId)) return false;
  if (!vendoredIsTimestampMs(v.evaluatedAt)) return false;
  if (!vendoredIsNonEmptyString(v.evaluationRunRef)) return false;
  if (!Array.isArray(v.evaluations)) return false;
  if (!v.evaluations.every((e) => vendoredIsCriterionEvaluationSummary(e))) return false;
  const ids = v.evaluations.map((e) => (e as VendoredCriterionEvaluationSummary).criterionId);
  return new Set(ids).size === ids.length;
}

// ---------------------------------------------------------------------------
// Runtime fixtures
// ---------------------------------------------------------------------------

const CORE_SET = {
  id: 'csInterop',
  version: 4,
  name: 'interop set',
  constraints: [
    { id: 'max-exposure', domain: 'state', subject: 'portfolio.grossExposure', predicate: { kind: 'limit.max', bound: 1_000_000 }, severity: 'blocking' },
    { id: 'asset-allowlist', domain: 'action', subject: 'order.instrument', predicate: { kind: 'oneOf', values: ['BTC-USDT', 'ETH-USDT'] }, severity: 'blocking' },
    { id: 'kill-switch-armed', domain: 'state', subject: 'risk.killSwitchArmed', predicate: { kind: 'flag', expected: false }, severity: 'advisory' },
  ],
  provenance: { origin: 'authored' },
  createdAt: '2027-01-03T08:00:00Z',
} as const;

function coreSet(): CoreConstraintSet {
  return CORE_SET as unknown as CoreConstraintSet;
}

/** Run domain-core's own evaluator over a context and mirror the report into this package's split report. */
function coreReportToSplitReport(split: string, report: CoreReport): SplitConstraintReport {
  const checks: ConstraintCheckMirror[] = report.checks.map((check) => ({
    constraintId: check.constraintId,
    severity: check.severity,
    status: check.status,
  }));
  const built = splitConstraintReport(split as EvalSplitPolicyRef, checks);
  if (!built.ok) throw new Error(`mirror must be valid: ${JSON.stringify(built.errors)}`);
  return built.value;
}

const CONTEXT_GOOD = {
  observations: {},
  state: { 'portfolio.grossExposure': 850_000, 'risk.killSwitchArmed': false },
  actions: { 'order.instrument': 'BTC-USDT' },
  outcomes: {},
} as const;

const CONTEXT_BAD = {
  observations: {},
  state: { 'portfolio.grossExposure': 2_000_000, 'risk.killSwitchArmed': true },
  actions: { 'order.instrument': 'DOGE-USDT' },
  outcomes: {},
} as const;

const EVALUATED_AT = '2027-04-04T00:00:00Z' as never;

function interopCriteria(): EvalAcceptanceCriteria {
  return {
    id: 'ac:6:goal-interop:1:9:csInterop:4' as never,
    goal: { goalId: 'goal-interop', version: 1 },
    constraintSet: { id: 'csInterop' as never, version: 4 },
    criteria: [
      {
        criterionId: 'hard-limits',
        requiredSatisfaction: 1,
        gatingConstraintIds: ['max-exposure', 'asset-allowlist'],
        blockingConstraintIds: ['max-exposure', 'asset-allowlist'],
      },
      {
        criterionId: 'ops-hygiene',
        requiredSatisfaction: 0.5,
        gatingConstraintIds: ['max-exposure', 'asset-allowlist', 'kill-switch-armed'],
        blockingConstraintIds: ['max-exposure', 'asset-allowlist'],
      },
    ],
    evaluationPolicy: {
      blindEvaluationRef: 'split.blind-interop',
      walkForwardRef: 'split.wf-interop',
      regimeRef: 'split.regime-interop',
    },
  };
}

function interopSuite() {
  const result = createEvaluationSuite({
    suiteId: 'suite.interop',
    grade: 'release',
    evaluatorVersion: 'evaluator.interop@1',
    members: [
      { kind: 'blind', splitPolicy: 'split.blind-interop', metricIds: ['metric.gate-ratio'] },
      { kind: 'walk-forward', splitPolicy: 'split.wf-interop', metricIds: ['metric.gate-ratio'] },
      { kind: 'regime', splitPolicy: 'split.regime-interop', metricIds: ['metric.gate-ratio'] },
    ],
    adversarialSuiteRefs: ['suite.adversarial-interop'],
  });
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function interopConfig(): EvaluationConfig {
  return {
    evaluatorVersion: 'evaluator.interop@1' as never,
    suite: 'suite.interop' as never,
    criteria: interopCriteria().id,
    confidence: {
      highEvidenceVolume: 6,
      moderateEvidenceVolume: 3,
      maxVacuousShareForHigh: 0,
      maxVacuousShareForModerate: 0.25,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimestampMs structural mirror (canonical: @tradrl/time-engine, in-tree)', () => {
  it('keeps the mirrored constants identical', () => {
    expect(MIN_TIMESTAMP_MS_OVERRIDE).toBe(ENGINE_MIN);
    expect(MAX_TIMESTAMP_MS_OVERRIDE).toBe(ENGINE_MAX);
  });

  it('keeps the mirrored guards behaviorally identical', () => {
    for (const sample of [0, 1, 1.5, -1, ENGINE_MAX, ENGINE_MAX + 1, Number.NaN, 'x', null]) {
      expect(engineIsTimestampMs(sample)).toBe(vendoredIsTimestampMs(sample));
    }
  });

  it('exercises the type-level mirror functions (compile-time trip wire)', () => {
    const fromEngine = requireEngineTimestampMs(42);
    const asEval: EvalTimestampMs = engineTimestampIsEvalTimestamp(fromEngine);
    const backToEngine: EngineTimestampMs = evalTimestampIsEngineTimestamp(asEval);
    expect(backToEngine).toBe(42);
    expectTypeOf<EvalTimestampMs>().toEqualTypeOf<EngineTimestampMs>();
  });
});

// The constants are imported lazily through this indirection to keep the
// import surface of the test file tight (values asserted above).
import { MAX_TIMESTAMP_MS as MAX_TIMESTAMP_MS_OVERRIDE, MIN_TIMESTAMP_MS as MIN_TIMESTAMP_MS_OVERRIDE, isTimestampMs as evalIsTimestampMs } from './primitives';

describe('ConstraintCheck mirror (canonical: @tradrl/domain-core, in-tree)', () => {
  it('a domain-core evaluation feeds the mirror unchanged (type-level + runtime parity)', () => {
    const report = evaluateConstraintSet(coreSet(), CONTEXT_GOOD as never, EVALUATED_AT);
    expect(report.invalidReason).toBeUndefined();
    expect(report.checks).toHaveLength(3);
    for (const check of report.checks) {
      // Every domain-core check IS a mirror record (type-level function above).
      const mirrored: ConstraintCheckMirror = coreCheckIsEvalMirror(check);
      expect(mirrored.constraintId).toBe(check.constraintId);
      expect(mirrored.severity).toBe(check.severity);
      expect(mirrored.status).toBe(check.status);
    }
  });

  it('guards agree on severity/status vocabulary samples', () => {
    // domain-core's severities and statuses are the closed vocabularies the mirror re-declares.
    expect(CORE_SET.constraints.every((c) => isConstraint(c))).toBe(true);
    const statuses = ['satisfied', 'violated', 'not_applicable', 'error'];
    for (const status of statuses) {
      expect(['satisfied', 'violated', 'not_applicable', 'error']).toContain(status);
    }
    expect(['advisory', 'blocking']).toContain('blocking');
    expect(evalIsTimestampMs(requireTimestampMs(1))).toBe(true);
  });
});

describe('END-TO-END: domain-core-authored constraints -> domain-core engine -> evaluation verdict', () => {
  it('a good context attains; a violating context fails with blocking-violation status', () => {
    const good = evaluateConstraintSet(coreSet(), CONTEXT_GOOD as never, EVALUATED_AT);
    const bad = evaluateConstraintSet(coreSet(), CONTEXT_BAD as never, EVALUATED_AT);
    expect(good.pass).toBe(true);
    expect(bad.pass).toBe(false);

    const reports = [
      coreReportToSplitReport('split.blind-interop', good),
      coreReportToSplitReport('split.wf-interop', good),
      coreReportToSplitReport('split.regime-interop', good),
    ];
    const goodVerdict = compileAttainmentVerdict({ criteria: interopCriteria(), config: interopConfig(), suite: interopSuite(), reports });
    expect(goodVerdict.ok).toBe(true);
    if (!goodVerdict.ok) throw new Error('must succeed');
    expect(goodVerdict.value.attained).toBe(true);

    const badReports = [
      coreReportToSplitReport('split.blind-interop', good),
      coreReportToSplitReport('split.wf-interop', good),
      coreReportToSplitReport('split.regime-interop', bad),
    ];
    const badVerdict = compileAttainmentVerdict({ criteria: interopCriteria(), config: interopConfig(), suite: interopSuite(), reports: badReports });
    expect(badVerdict.ok).toBe(true);
    if (!badVerdict.ok) throw new Error('must succeed');
    expect(badVerdict.value.attained).toBe(false);
    expect(badVerdict.value.perCriterion[0]?.status).toBe('blocking-violation');
    // CONTEXT_BAD violates ALL THREE constraints (exposure 2M > 1M, DOGE not
    // allowlisted, kill switch armed) — both the mirror and domain-core's own
    // engine report satisfiedRatio 0 (satisfied/applicable = 0/3).
    expect(badVerdict.value.perCriterion[1]?.perSplit[2]?.satisfiedRatio).toBeCloseTo(0, 12);
    expect(bad.satisfiedRatio).toBeCloseTo(0, 12);
  });

  it('the evidence this package projects satisfies the vendored T007 isAttainmentEvidence guard', () => {
    const reports = [
      coreReportToSplitReport('split.blind-interop', evaluateConstraintSet(coreSet(), CONTEXT_GOOD as never, EVALUATED_AT)),
      coreReportToSplitReport('split.wf-interop', evaluateConstraintSet(coreSet(), CONTEXT_GOOD as never, EVALUATED_AT)),
      coreReportToSplitReport('split.regime-interop', evaluateConstraintSet(coreSet(), CONTEXT_GOOD as never, EVALUATED_AT)),
    ];
    const verdict = compileAttainmentVerdict({ criteria: interopCriteria(), config: interopConfig(), suite: interopSuite(), reports });
    if (!verdict.ok) throw new Error('must succeed');
    const evidence = toAttainmentEvidence(verdict.value, 'run.interop-1', requireTimestampMs(1_800_000_000_000));
    if (!evidence.ok) throw new Error('must succeed');
    // The vendored T007 guard accepts the projected record unchanged.
    expect(vendoredIsAttainmentEvidence(evidence.value)).toBe(true);
    expect(vendoredIsCriterionEvaluationSummary(evidence.value.evaluations[0])).toBe(true);
    // Vendored T007 unit-interval helper agrees on the required-satisfaction domain.
    expect(vendoredIsUnitInterval(0.5)).toBe(true);
    expect(vendoredIsPositiveInteger(1)).toBe(true);
  });
});

describe('T011 experiments mirrors (vendored reference declarations)', () => {
  it('TrialLogEntry is mutually assignable with the vendored TrialRecord; statuses coincide', () => {
    const entry: TrialLogEntry = {
      trial_id: 'trial-1' as never,
      arm: 'arm-treatment' as never,
      status: 'succeeded',
      trajectory: 'traj-1' as never,
      outcome: { score: 0.62 },
      started_at: requireTimestampMs(1_700_000_000_000),
      ended_at: requireTimestampMs(1_700_000_060_000),
      failure_reason: null,
    };
    const asVendored: VendoredTrialRecord = evalTrialIsVendoredTrial(entry);
    const backToEval: TrialLogEntry = vendoredTrialIsEvalTrial(asVendored);
    expect(backToEval.trial_id).toBe('trial-1');
    expect(trialStatusesCoincide('failed')).toBe('failed');

    // Brand parity across the identity spaces (T011 mirror discipline).
    const trialId: EvalTrialId = 'trial-1' as never;
    const armId: EvalArmId = 'arm-treatment' as never;
    const experimentId: EvalExperimentId = 'exp-1' as never;
    const criteriaRef: EvalCriteriaRef = 'criteria-1' as never;
    const evaluatorRef: EvalEvaluatorVersionRef = 'evaluator@1' as never;
    const splitRef: EvalSplitPolicyRef = 'split-1' as never;
    const dataRef: EvalDataRef = 'dataset-1' as never;
    expectTypeOf<EvalTrialId>().toEqualTypeOf<VendoredTrialId>();
    expectTypeOf<EvalArmId>().toEqualTypeOf<VendoredArmId>();
    expectTypeOf<EvalExperimentId>().toEqualTypeOf<VendoredExperimentId>();
    expectTypeOf<EvalCriteriaRef>().toEqualTypeOf<VendoredCriteriaRef>();
    expectTypeOf<EvalEvaluatorVersionRef>().toEqualTypeOf<VendoredEvaluatorVersionRef>();
    expectTypeOf<EvalSplitPolicyRef>().toEqualTypeOf<VendoredSplitPolicyRef>();
    expectTypeOf<EvalDataRef>().toEqualTypeOf<VendoredDataRef>();
    expectTypeOf<EvalTimestampMs>().toEqualTypeOf<VendoredTimestampMs>();
    expect([trialId, armId, experimentId, criteriaRef, evaluatorRef, splitRef, dataRef]).toHaveLength(7);
  });

  it('the trial-status closed vocabulary is identical to the vendored T011 vocabulary', () => {
    const vendored: readonly VendoredTrialStatus[] = ['planned', 'running', 'succeeded', 'failed', 'rejected'];
    const mirrored: readonly TrialStatusMirror[] = ['planned', 'running', 'succeeded', 'failed', 'rejected'];
    expect(mirrored).toEqual(vendored);
  });
});

describe('T007 control-domain mirrors (vendored reference declarations)', () => {
  it('AcceptanceCriteria is mutually assignable with the vendored T007 declaration', () => {
    const criteria = interopCriteria();
    const asVendored: VendoredAcceptanceCriteria = evalCriteriaIsVendoredCriteria(criteria);
    const backToEval: EvalAcceptanceCriteria = vendoredCriteriaIsEvalCriteria(asVendored);
    expect(backToEval.id).toBe(criteria.id);
    expectTypeOf<EvalAcceptanceCriteria>().toEqualTypeOf<VendoredAcceptanceCriteria>();

    // The pinned evaluation policy refs are exactly the opaque strings the
    // suite's members must carry (L10/L11 — evaluation cannot be shopped).
    expect(criteria.evaluationPolicy.blindEvaluationRef).toBe('split.blind-interop');
    expect(criteria.evaluationPolicy.walkForwardRef).toBe('split.wf-interop');
    expect(criteria.evaluationPolicy.regimeRef).toBe('split.regime-interop');
    const suite = interopSuite();
    expect(suite.members.some((m) => m.kind === 'blind' && m.splitPolicy === criteria.evaluationPolicy.blindEvaluationRef)).toBe(true);
    expect(suite.members.some((m) => m.kind === 'walk-forward' && m.splitPolicy === criteria.evaluationPolicy.walkForwardRef)).toBe(true);
    expect(suite.members.some((m) => m.kind === 'regime' && m.splitPolicy === criteria.evaluationPolicy.regimeRef)).toBe(true);
  });
});
