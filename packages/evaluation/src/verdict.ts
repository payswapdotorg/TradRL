/**
 * @tradrl/evaluation — attainment verdict compilation.
 *
 * Spec anchors: spec/ARCHITECTURE.md "Evaluation" ("Acceptance is
 * objective-and-constraint based"), spec/EVALUATION-PROTOCOL.md
 * ("Acceptance"), ARCHITECTURE-LOCK L7 ("Constraint-aware evaluation: raw
 * PnL is insufficient"), L9 (reproducible lineage — the verdict binds
 * criteria, suite and evaluator version), L10/L11 (the pinned evaluation
 * policy cannot be shopped; the suite must cover it).
 *
 * THE COMPILATION (pure, deterministic, fail-closed):
 *
 *   (criteria + per-split constraint reports + suite + config)
 *       -> {@link compileAttainmentVerdict} -> {@link AttainmentVerdict}
 *
 * - Inputs mirror, never import: `AcceptanceCriteria`/`CriterionBinding`
 *   are STRUCTURAL MIRRORS of T007 control-domain's compiled shapes;
 *   `SplitConstraintReport`/`ConstraintCheckMirror` mirror the aggregate
 *   fields and check records of domain-core's `ConstraintEvaluationReport`.
 *   interop.test.ts is the trip wire against both canonical owners.
 * - L7 BY CONSTRUCTION: the ONLY attainment inputs are constraint-
 *   satisfaction counts. No record on the compilation path — criteria,
 *   reports, evidence, verdict — carries a field that can hold a PnL, a
 *   return, or any raw performance figure. The structural test
 *   ("PnL solicitude") asserts the absence over the recursive key set of
 *   every record, mirroring T007's discipline.
 * - MULTI-SPLIT SEMANTICS: a criterion ATTAINS iff, in EVERY split of the
 *   suite, its gate attains — worst-split law (a criterion that only holds
 *   on friendly splits does not attain; walk-forward windows are exactly
 *   the splits where this bites). Per split, the mirrored domain-core
 *   semantics apply: ratio = satisfied / (satisfied + violated + errors)
 *   over the criterion's GATING constraints, `not_applicable` excluded; a
 *   wholly inapplicable gate satisfies NOTHING (fail-closed: no vacuous
 *   pass); any blocking violation or evaluation error forces that split to
 *   not-attained.
 * - LIMITATIONS are COMPUTED from the inputs, never caller-supplied
 *   (mirroring T011's honest-limitations discipline): incomplete split
 *   coverage, unknown split reports, vacuous splits, evaluation errors all
 *   surface as machine-checkable codes. A verdict with ANY limitation
 *   cannot attain (holes are holes).
 * - CONFIDENCE is computed from evidence volume and vacuity under the
 *   config's deterministic thresholds — low/moderate/high, never a score.
 * - DETERMINISM: the verdict is a pure function of its inputs; the record
 *   carries `inputDigest` (a digest over the canonical JSON of ALL inputs)
 *   and `verdictHash` (a digest over the canonical JSON of the verdict
 *   itself minus the hash). Same inputs -> byte-identical verdict twice;
 *   mutation of ANY input changes `inputDigest` and therefore the hash
 *   (L9: the verdict is derived data, its identity derived with it).
 */

import {
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
  isUnitInterval,
  stableDigest,
  stableDigestJson,
  type JsonValue,
  type TimestampMs,
} from './primitives';
import {
  isAcceptanceCriteriaId,
  isConstraintSetId,
  isEvaluatorVersionRef,
  isSplitPolicyRef,
  isSuiteId,
  isVerdictId,
  type AcceptanceCriteriaId,
  type ConstraintSetId,
  type EvaluatorVersionRef,
  type SplitPolicyRef,
  type SuiteId,
  type VerdictId,
} from './ids';
import {
  isEvaluationSuite,
  isReleaseGradeSuite,
  type EvaluationSuite,
  type SuiteMemberKind,
} from './suite';
import { invalidField, invalidType, fail, missingField, ok, type EvalError, type EvalResult } from './errors';

// ---------------------------------------------------------------------------
// AcceptanceCriteria — structural mirror of T007 control-domain (DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/**
 * One compiled success criterion — STRUCTURAL MIRROR of T007 control-domain's
 * `CriterionBinding`: paired with the resolved constraint ids that gate it
 * (canonical set order, non-empty — a criterion gated by nothing cannot
 * define attainment) and the blocking-severity subset.
 */
export interface CriterionBinding {
  readonly criterionId: string;
  /** Required share of applicable gating constraints satisfied, [0,1]. */
  readonly requiredSatisfaction: number;
  /** Resolved constraint ids gating this criterion (canonical set order, non-empty, unique). */
  readonly gatingConstraintIds: readonly string[];
  /** Blocking-severity subset of the gating ids (canonical set order, subset). */
  readonly blockingConstraintIds: readonly string[];
}

/** Guard: `CriterionBinding` (the mirror of T007's guard semantics). */
export function isCriterionBinding(v: unknown): v is CriterionBinding {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.criterionId)) return false;
  if (!isUnitInterval(v.requiredSatisfaction)) return false;
  if (!Array.isArray(v.gatingConstraintIds) || v.gatingConstraintIds.length === 0) return false;
  if (!v.gatingConstraintIds.every((id) => isNonEmptyString(id))) return false;
  if (new Set(v.gatingConstraintIds).size !== v.gatingConstraintIds.length) return false;
  if (!Array.isArray(v.blockingConstraintIds)) return false;
  if (!v.blockingConstraintIds.every((id) => isNonEmptyString(id))) return false;
  if (new Set(v.blockingConstraintIds).size !== v.blockingConstraintIds.length) return false;
  const gating = new Set<string>(v.gatingConstraintIds);
  if (!v.blockingConstraintIds.every((id) => gating.has(id))) return false; // blocking ⊆ gating
  return true;
}

/**
 * The compiled acceptance criteria — STRUCTURAL MIRROR of T007 control-
 * domain's `AcceptanceCriteria` (identity encodes goal + constraint-set
 * lineage, L15; the evaluation protocol is pinned at compile time so
 * evaluation cannot be shopped, L10/L11).
 */
export interface AcceptanceCriteria {
  /** Canonical deterministic id (encodes goal + set lineage — mirror of T007). */
  readonly id: AcceptanceCriteriaId;
  /** Lineage: the goal version this was compiled from. */
  readonly goal: { readonly goalId: string; readonly version: number };
  /** Lineage: the constraint set version compiled against. */
  readonly constraintSet: { readonly id: ConstraintSetId; readonly version: number };
  /** One compiled binding per success criterion (non-empty; ids unique). */
  readonly criteria: readonly CriterionBinding[];
  /** Evaluation protocol pinned at compile time (opaque refs owned by this lane). */
  readonly evaluationPolicy: {
    readonly blindEvaluationRef: string;
    readonly walkForwardRef: string;
    readonly regimeRef: string;
  };
}

/** Guard: `AcceptanceCriteria` (mirror of T007's guard semantics). */
export function isAcceptanceCriteria(v: unknown): v is AcceptanceCriteria {
  if (!isRecord(v)) return false;
  if (!isAcceptanceCriteriaId(v.id)) return false;
  if (!isRecord(v.goal) || !isNonEmptyString(v.goal.goalId) || !isPositiveInteger(v.goal.version)) return false;
  if (!isRecord(v.constraintSet) || !isConstraintSetId(v.constraintSet.id) || !isPositiveInteger(v.constraintSet.version)) {
    return false;
  }
  if (!Array.isArray(v.criteria) || v.criteria.length === 0) return false;
  if (!v.criteria.every((c) => isCriterionBinding(c))) return false;
  const ids = v.criteria.map((c) => (c as CriterionBinding).criterionId);
  if (new Set(ids).size !== ids.length) return false;
  if (!isRecord(v.evaluationPolicy)) return false;
  return (
    isNonEmptyString(v.evaluationPolicy.blindEvaluationRef) &&
    isNonEmptyString(v.evaluationPolicy.walkForwardRef) &&
    isNonEmptyString(v.evaluationPolicy.regimeRef)
  );
}

// ---------------------------------------------------------------------------
// Per-split constraint reports — mirror of domain-core's evaluation output
// ---------------------------------------------------------------------------

/** Constraint check status — mirror of domain-core's `ConstraintCheckStatus`. */
export type ConstraintCheckStatusMirror = 'satisfied' | 'violated' | 'not_applicable' | 'error';

/** Runtime-checkable list of check statuses. */
export const CONSTRAINT_CHECK_STATUSES: readonly ConstraintCheckStatusMirror[] = [
  'satisfied',
  'violated',
  'not_applicable',
  'error',
] as const;

/** Guard: a check status (mirror of domain-core's vocabulary). */
export function isConstraintCheckStatusMirror(v: unknown): v is ConstraintCheckStatusMirror {
  return typeof v === 'string' && (CONSTRAINT_CHECK_STATUSES as readonly string[]).includes(v);
}

/** Constraint severity — mirror of domain-core's `ConstraintSeverity`. */
export type ConstraintSeverityMirror = 'advisory' | 'blocking';

/** Runtime-checkable list of severities. */
export const CONSTRAINT_SEVERITIES_MIRROR: readonly ConstraintSeverityMirror[] = ['advisory', 'blocking'] as const;

/** Guard: a constraint severity (mirror of domain-core's vocabulary). */
export function isConstraintSeverityMirror(v: unknown): v is ConstraintSeverityMirror {
  return typeof v === 'string' && (CONSTRAINT_SEVERITIES_MIRROR as readonly string[]).includes(v);
}

/**
 * One constraint check outcome — STRUCTURAL SUBSET-MIRROR of domain-core's
 * `ConstraintCheck`: exactly the fields verdict compilation consumes
 * (constraint id, severity, status). domain-core's full record (domain,
 * subject, observed, reason) is structurally assignable to this mirror —
 * interop.test.ts proves it.
 */
export interface ConstraintCheckMirror {
  readonly constraintId: string;
  readonly severity: ConstraintSeverityMirror;
  readonly status: ConstraintCheckStatusMirror;
}

/** Guard: `ConstraintCheckMirror`. */
export function isConstraintCheckMirror(v: unknown): v is ConstraintCheckMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.constraintId)) return false;
  if (!isConstraintSeverityMirror(v.severity)) return false;
  return isConstraintCheckStatusMirror(v.status);
}

/**
 * One split's constraint-evaluation report — STRUCTURAL MIRROR of the
 * aggregate fields of domain-core's `ConstraintEvaluationReport` plus the
 * per-constraint check outcomes (subset mirror above), bound to the opaque
 * split policy ref that produced it.
 */
export interface SplitConstraintReport {
  /** The split policy this report was produced under. */
  readonly split: SplitPolicyRef;
  readonly checks: readonly ConstraintCheckMirror[];
  readonly satisfied: number;
  readonly violated: number;
  readonly errors: number;
  readonly notApplicable: number;
  readonly blockingViolations: number;
  readonly advisoryViolations: number;
  /** Present when the underlying evaluation failed structurally (mirror of invalidReason). */
  readonly invalidReason?: string;
}

/** Guard: `SplitConstraintReport`. */
export function isSplitConstraintReport(v: unknown): v is SplitConstraintReport {
  if (!isRecord(v)) return false;
  if (!isSplitPolicyRef(v.split)) return false;
  if (!Array.isArray(v.checks)) return false;
  if (!v.checks.every((check) => isConstraintCheckMirror(check))) return false;
  const counts = countChecks(v.checks);
  return (
    v.satisfied === counts.satisfied &&
    v.violated === counts.violated &&
    v.errors === counts.errors &&
    v.notApplicable === counts.notApplicable &&
    v.blockingViolations === counts.blockingViolations &&
    v.advisoryViolations === counts.advisoryViolations &&
    (v.invalidReason === undefined || isNonEmptyString(v.invalidReason))
  );
}

/** Recount a check list into aggregate counts (mirror of domain-core's countChecks). */
function countChecks(checks: readonly ConstraintCheckMirror[]): {
  satisfied: number;
  violated: number;
  errors: number;
  notApplicable: number;
  blockingViolations: number;
  advisoryViolations: number;
} {
  let satisfied = 0;
  let advisoryViolations = 0;
  let blockingViolations = 0;
  let notApplicable = 0;
  let errors = 0;
  for (const check of checks) {
    if (check.status === 'satisfied') satisfied += 1;
    else if (check.status === 'violated') {
      if (check.severity === 'blocking') blockingViolations += 1;
      else advisoryViolations += 1;
    } else if (check.status === 'not_applicable') notApplicable += 1;
    else errors += 1;
  }
  return { satisfied, violated: advisoryViolations + blockingViolations, errors, notApplicable, blockingViolations, advisoryViolations };
}

/**
 * Build a report from raw checks — the adapter domain-core's
 * `evaluateConstraintSet` output flows through: the report's aggregates are
 * RECOMPUTED from the checks (never trusted from the caller), the split ref
 * is validated, and the result is deeply frozen.
 */
export function splitConstraintReport(split: SplitPolicyRef, checks: readonly ConstraintCheckMirror[], invalidReason?: string): EvalResult<SplitConstraintReport> {
  if (!isSplitPolicyRef(split)) {
    return fail('invalid_report', 'splitConstraintReport requires a valid split policy ref', 'split');
  }
  if (!Array.isArray(checks) || !checks.every((check) => isConstraintCheckMirror(check))) {
    return fail('invalid_report', 'splitConstraintReport requires a list of valid constraint checks', 'checks');
  }
  if (invalidReason !== undefined && !isNonEmptyString(invalidReason)) {
    return fail('invalid_report', 'invalidReason must be a non-empty string when present', 'invalidReason');
  }
  const counts = countChecks(checks);
  const report: SplitConstraintReport = {
    split,
    checks: checks.slice(),
    ...counts,
    ...(invalidReason !== undefined ? { invalidReason } : {}),
  };
  return ok(deepFreeze(report));
}

// ---------------------------------------------------------------------------
// Evaluation config (lineage + deterministic confidence thresholds)
// ---------------------------------------------------------------------------

/**
 * Deterministic confidence thresholds — the ONLY tuning inputs of the
 * confidence block, carried in the config so the same inputs always yield
 * the same confidence (never ambient heuristics).
 */
export interface ConfidenceThresholds {
  /** Minimum TOTAL applicable gating constraints across splits for `high`. */
  readonly highEvidenceVolume: number;
  /** Minimum total applicable gating constraints for `moderate` (<= high). */
  readonly moderateEvidenceVolume: number;
  /** Maximum vacuous-split share for `high` (a share in [0,1]). */
  readonly maxVacuousShareForHigh: number;
  /** Maximum vacuous-split share for `moderate`. */
  readonly maxVacuousShareForModerate: number;
}

/** Guard: `ConfidenceThresholds`. */
export function isConfidenceThresholds(v: unknown): v is ConfidenceThresholds {
  if (!isRecord(v)) return false;
  if (!isPositiveInteger(v.highEvidenceVolume)) return false;
  if (!isPositiveInteger(v.moderateEvidenceVolume)) return false;
  if (v.moderateEvidenceVolume > v.highEvidenceVolume) return false;
  if (!isUnitInterval(v.maxVacuousShareForHigh)) return false;
  if (!isUnitInterval(v.maxVacuousShareForModerate)) return false;
  if (v.maxVacuousShareForModerate < v.maxVacuousShareForHigh) return false;
  return true;
}

/**
 * The evaluation config: WHICH evaluator, WHICH suite, WHICH compiled
 * criteria, under WHICH deterministic thresholds. The config is pure input
 * to verdict computation — the verdict is a pure function of
 * (criteria, reports, suite, config) (L9 lineage + determinism).
 */
export interface EvaluationConfig {
  /** Lineage: the compiled evaluator that produced the reports. */
  readonly evaluatorVersion: EvaluatorVersionRef;
  /** Lineage: the suite the run executed. */
  readonly suite: SuiteId;
  /** Lineage: the compiled acceptance criteria the verdict decides. */
  readonly criteria: AcceptanceCriteriaId;
  readonly confidence: ConfidenceThresholds;
}

/** Guard: `EvaluationConfig`. */
export function isEvaluationConfig(v: unknown): v is EvaluationConfig {
  if (!isRecord(v)) return false;
  if (!isEvaluatorVersionRef(v.evaluatorVersion)) return false;
  if (!isSuiteId(v.suite)) return false;
  if (!isAcceptanceCriteriaId(v.criteria)) return false;
  return isConfidenceThresholds(v.confidence);
}

// ---------------------------------------------------------------------------
// The verdict record
// ---------------------------------------------------------------------------

/** Why one criterion did (or did not) attain — worst status across splits. */
export const CRITERION_VERDICT_STATUSES = [
  'attained',
  'below-required-satisfaction',
  'blocking-violation',
  'evaluation-error',
  'missing-evidence',
  'vacuous-evaluation',
] as const;

/** Why one criterion did (or did not) attain — worst status across splits. */
export type CriterionVerdictStatus = (typeof CRITERION_VERDICT_STATUSES)[number];

/** Guard: a criterion verdict status. */
export function isCriterionVerdictStatus(v: unknown): v is CriterionVerdictStatus {
  return typeof v === 'string' && (CRITERION_VERDICT_STATUSES as readonly string[]).includes(v);
}

/** One criterion's evidence in one split (mirrored ratio semantics). */
export interface CriterionSplitEvidence {
  readonly split: SplitPolicyRef;
  readonly satisfied: number;
  readonly violated: number;
  readonly errors: number;
  readonly notApplicable: number;
  readonly blockingViolations: number;
  /** satisfied / (satisfied + violated + errors) over the GATING constraints; 0 when vacuous. */
  readonly satisfiedRatio: number;
}

/** Verdict for one criterion: worst-split attainment with per-split evidence. */
export interface CriterionVerdict {
  readonly criterionId: string;
  /** True iff EVERY split of the suite attains the criterion (worst-split law). */
  readonly attained: boolean;
  readonly status: CriterionVerdictStatus;
  /** Aggregate ratio across all splits (reporting; attainment is per-split). */
  readonly satisfiedRatio: number;
  readonly requiredSatisfaction: number;
  readonly perSplit: readonly CriterionSplitEvidence[];
}

/** Machine-checkable limitation codes — COMPUTED from the inputs, never caller-supplied. */
export const VERDICT_LIMITATION_CODES = [
  /** A suite member's split policy has no matching report. */
  'incomplete-split-coverage',
  /** A report names a split policy the suite does not contain. */
  'unknown-split-report',
  /** A split's gate is wholly inapplicable for some criterion (satisfies nothing). */
  'vacuous-split',
  /** Some split reported evaluation errors. */
  'evaluation-errors-present',
  /** Some split's underlying evaluation failed structurally (invalidReason present). */
  'invalid-split-report',
] as const;

/** Machine-checkable limitation code. */
export type VerdictLimitationCode = (typeof VERDICT_LIMITATION_CODES)[number];

/** Guard: a verdict limitation code. */
export function isVerdictLimitationCode(v: unknown): v is VerdictLimitationCode {
  return typeof v === 'string' && (VERDICT_LIMITATION_CODES as readonly string[]).includes(v);
}

/** Confidence level — a category, never a score. */
export type VerdictConfidence = 'low' | 'moderate' | 'high';

/** Runtime-checkable list of confidence levels. */
export const VERDICT_CONFIDENCE_LEVELS: readonly VerdictConfidence[] = ['low', 'moderate', 'high'] as const;

/** Guard: a confidence level. */
export function isVerdictConfidence(v: unknown): v is VerdictConfidence {
  return typeof v === 'string' && (VERDICT_CONFIDENCE_LEVELS as readonly string[]).includes(v);
}

/** The computed confidence block (evidence volume + vacuity, deterministic). */
export interface VerdictConfidenceBlock {
  readonly level: VerdictConfidence;
  /** Total applicable gating constraint evaluations across all splits and criteria. */
  readonly totalApplicableConstraints: number;
  readonly splitsEvaluated: number;
  readonly vacuousSplits: number;
  /** vacuousSplits / splitsEvaluated (0 when no splits). */
  readonly vacuousShare: number;
}

/**
 * The attainment verdict. L7 BY CONSTRUCTION: no field on this record — or
 * on any record it recursively contains — can express attainment by raw
 * PnL; the attainment inputs are constraint-satisfaction counts ONLY
 * (machine-checked by the "PnL solicitude" structural test).
 */
export interface AttainmentVerdict {
  /** Deterministic derived id (see {@link verdictIdOf}). */
  readonly verdictId: VerdictId;
  /** True iff EVERY criterion attains in EVERY split AND no limitations were found. */
  readonly attained: boolean;
  /** Lineage: the compiled criteria this verdict decides. */
  readonly criteriaId: AcceptanceCriteriaId;
  /** Lineage: the suite that produced the reports. */
  readonly suite: SuiteId;
  /** Lineage: the evaluator that scored the splits. */
  readonly evaluatorVersion: EvaluatorVersionRef;
  readonly perCriterion: readonly CriterionVerdict[];
  /** COMPUTED limitations (machine-checkable codes; any limitation forces attained=false). */
  readonly limitations: readonly VerdictLimitationCode[];
  readonly confidence: VerdictConfidenceBlock;
  /** Digest over the canonical JSON of ALL compilation inputs (any input mutation changes it). */
  readonly inputDigest: string;
  /** Digest over the canonical JSON of this verdict minus itself (byte-determinism witness). */
  readonly verdictHash: string;
}

/** Guard: `AttainmentVerdict`. */
export function isAttainmentVerdict(v: unknown): v is AttainmentVerdict {
  if (!isRecord(v)) return false;
  if (!isVerdictId(v.verdictId)) return false;
  if (typeof v.attained !== 'boolean') return false;
  if (!isAcceptanceCriteriaId(v.criteriaId)) return false;
  if (!isSuiteId(v.suite)) return false;
  if (!isEvaluatorVersionRef(v.evaluatorVersion)) return false;
  if (!Array.isArray(v.perCriterion)) return false;
  if (!v.perCriterion.every((c) => isCriterionVerdict(c))) return false;
  if (!Array.isArray(v.limitations)) return false;
  if (!v.limitations.every((code) => isVerdictLimitationCode(code))) return false;
  if (!isRecord(v.confidence) || !isVerdictConfidence(v.confidence.level)) return false;
  if (!isNonEmptyString(v.inputDigest) || !isNonEmptyString(v.verdictHash)) return false;
  return true;
}

/** Guard: `CriterionVerdict`. */
export function isCriterionVerdict(v: unknown): v is CriterionVerdict {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.criterionId)) return false;
  if (typeof v.attained !== 'boolean') return false;
  if (!isCriterionVerdictStatus(v.status)) return false;
  if (!isUnitInterval(v.satisfiedRatio)) return false;
  if (!isUnitInterval(v.requiredSatisfaction)) return false;
  if (!Array.isArray(v.perSplit)) return false;
  return v.perSplit.every((e) => isCriterionSplitEvidence(e));
}

/** Guard: `CriterionSplitEvidence`. */
export function isCriterionSplitEvidence(v: unknown): v is CriterionSplitEvidence {
  if (!isRecord(v)) return false;
  if (!isSplitPolicyRef(v.split)) return false;
  const counts = Number.isInteger(v.satisfied) && Number.isInteger(v.violated) && Number.isInteger(v.errors) && Number.isInteger(v.notApplicable) && Number.isInteger(v.blockingViolations);
  if (!counts) return false;
  if ((v.satisfied as number) < 0 || (v.violated as number) < 0 || (v.errors as number) < 0 || (v.notApplicable as number) < 0 || (v.blockingViolations as number) < 0) {
    return false;
  }
  return isUnitInterval(v.satisfiedRatio);
}

// ---------------------------------------------------------------------------
// The compilation
// ---------------------------------------------------------------------------

/** The complete, pure input set of one verdict compilation. */
export interface VerdictCompilationInput {
  readonly criteria: AcceptanceCriteria;
  readonly config: EvaluationConfig;
  readonly suite: EvaluationSuite;
  readonly reports: readonly SplitConstraintReport[];
}

/**
 * Compile the attainment verdict. THE acceptance computation of the
 * evaluation lane (L7): attainment is a pure function of constraint-
 * satisfaction counts over the criterion gates, evaluated per split under
 * the worst-split law.
 *
 * Fail-closed typed errors:
 * - `invalid_criteria` / `invalid_config` / `invalid_suite` /
 *   `invalid_report` — structural failures of the inputs (L7: never
 *   silently succeed);
 * - `criteria_mismatch` — the config's criteria/suite/evaluator lineage
 *   does not agree with the criteria record or the suite;
 * - `policy_coverage_missing` — the suite does not cover an evaluation
 *   policy ref the criteria pinned at compile time (L10/L11: evaluation
 *   cannot be shopped after the fact).
 *
 * Determinism: same (criteria, config, suite, reports) -> deeply-equal,
 * byte-identical verdict (canonical JSON), identical `verdictHash` and
 * `inputDigest`.
 */
export function compileAttainmentVerdict(input: VerdictCompilationInput): EvalResult<AttainmentVerdict> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('verdict compilation input must be an object')] };
  }
  const structural: EvalError[] = [];
  if (input.criteria === undefined) structural.push(missingField('criteria'));
  else if (!isAcceptanceCriteria(input.criteria)) structural.push(invalidField('criteria', 'acceptance criteria failed structural validation (mirror of T007)'));

  if (input.config === undefined) structural.push(missingField('config'));
  else if (!isEvaluationConfig(input.config)) structural.push(invalidField('config', 'evaluation config failed structural validation'));

  if (input.suite === undefined) structural.push(missingField('suite'));
  else if (!isEvaluationSuite(input.suite)) structural.push(invalidField('suite', 'evaluation suite failed structural validation'));

  if (input.reports === undefined) structural.push(missingField('reports'));
  else if (!Array.isArray(input.reports)) structural.push(invalidField('reports', 'must be an array of per-split constraint reports'));
  else if (!input.reports.every((report) => isSplitConstraintReport(report))) {
    structural.push(invalidField('reports', 'every entry must be a valid split constraint report (aggregates must match its checks)'));
  }
  if (structural.length > 0) return { ok: false, errors: structural };

  const criteria = input.criteria;
  const config = input.config;
  const suite = input.suite;
  const reports = input.reports;

  // Lineage agreement (L9): config binds criteria, suite and evaluator.
  if (config.criteria !== criteria.id) {
    return fail('criteria_mismatch', `config pins criteria "${config.criteria}" but the criteria record is "${criteria.id}"`, 'config.criteria');
  }
  if (config.suite !== suite.suiteId) {
    return fail('criteria_mismatch', `config pins suite "${config.suite}" but the suite record is "${suite.suiteId}"`, 'config.suite');
  }
  if (config.evaluatorVersion !== suite.evaluatorVersion) {
    return fail(
      'criteria_mismatch',
      `config pins evaluator "${config.evaluatorVersion}" but the suite binds "${suite.evaluatorVersion}"`,
      'config.evaluatorVersion',
    );
  }

  // L10/L11: the suite must cover the evaluation policy pinned at compile
  // time — the evaluator cannot choose a friendlier protocol after the fact.
  const coverage = policyCoverageProblems(criteria, suite);
  if (coverage.length > 0) {
    return { ok: false, errors: coverage };
  }

  // Split report binding: every report's split must be a composed member
  // policy; every member policy must have a report (else limitation below).
  const memberPolicyRefs = new Set<string>(suite.members.map((member) => member.splitPolicy));
  const reportBySplit = new Map<string, SplitConstraintReport>();
  const limitations: VerdictLimitationCode[] = [];
  for (const report of reports) {
    if (!memberPolicyRefs.has(report.split)) {
      limitations.push('unknown-split-report');
      continue;
    }
    if (reportBySplit.has(report.split)) {
      return fail('invalid_report', `two reports claim split policy "${report.split}"`, 'reports');
    }
    reportBySplit.set(report.split, report);
    if (report.invalidReason !== undefined) limitations.push('invalid-split-report');
    if (report.errors > 0) limitations.push('evaluation-errors-present');
  }
  const missingSplits: string[] = [];
  for (const ref of memberPolicyRefs) {
    if (!reportBySplit.has(ref)) missingSplits.push(ref);
  }
  if (missingSplits.length > 0) limitations.push('incomplete-split-coverage');
  // Deduplicate limitation codes, preserving first-seen order (determinism).
  const uniqueLimitations = [...new Set(limitations)];

  // Per-criterion compilation under the worst-split law.
  const perCriterion: CriterionVerdict[] = criteria.criteria.map((binding): CriterionVerdict => {
    const gating = new Set<string>(binding.gatingConstraintIds);
    const blocking = new Set<string>(binding.blockingConstraintIds);
    const perSplit: CriterionSplitEvidence[] = [];
    let vacuousSplitsForCriterion = 0;
    let totalSatisfied = 0;
    let totalViolated = 0;
    let totalErrors = 0;

    for (const member of suite.members) {
      const report = reportBySplit.get(member.splitPolicy);
      if (report === undefined) {
        // Missing evidence for this split: fail-closed vacuous evidence.
        perSplit.push({
          split: member.splitPolicy,
          satisfied: 0,
          violated: 0,
          errors: 0,
          notApplicable: 0,
          blockingViolations: 0,
          satisfiedRatio: 0,
        });
        vacuousSplitsForCriterion += 1;
        continue;
      }
      let satisfied = 0;
      let violated = 0;
      let errors = 0;
      let notApplicable = 0;
      let blockingViolations = 0;
      for (const check of report.checks) {
        if (!gating.has(check.constraintId)) continue;
        if (check.status === 'satisfied') satisfied += 1;
        else if (check.status === 'violated') {
          violated += 1;
          if (blocking.has(check.constraintId)) blockingViolations += 1;
        } else if (check.status === 'not_applicable') notApplicable += 1;
        else errors += 1;
      }
      const applicable = satisfied + violated + errors;
      const ratio = applicable === 0 ? 0 : satisfied / applicable;
      perSplit.push({ split: member.splitPolicy, satisfied, violated, errors, notApplicable, blockingViolations, satisfiedRatio: ratio });
      totalSatisfied += satisfied;
      totalViolated += violated;
      totalErrors += errors;
      if (applicable === 0) vacuousSplitsForCriterion += 1;
    }

    // Worst-split attainment.
    let attained = perSplit.length > 0;
    let status: CriterionVerdictStatus = 'attained';
    for (const evidence of perSplit) {
      const applicable = evidence.satisfied + evidence.violated + evidence.errors;
      if (applicable === 0) {
        attained = false;
        status = worstStatus(status, 'vacuous-evaluation');
      } else if (evidence.blockingViolations > 0) {
        attained = false;
        status = worstStatus(status, 'blocking-violation');
      } else if (evidence.errors > 0) {
        attained = false;
        status = worstStatus(status, 'evaluation-error');
      } else if (evidence.satisfiedRatio < binding.requiredSatisfaction) {
        attained = false;
        status = worstStatus(status, 'below-required-satisfaction');
      }
    }
    if (perSplit.length === 0) {
      attained = false;
      status = 'missing-evidence';
    }
    if (vacuousSplitsForCriterion > 0) limitations.push('vacuous-split');

    const totalApplicable = totalSatisfied + totalViolated + totalErrors;
    return {
      criterionId: binding.criterionId,
      attained,
      status,
      satisfiedRatio: totalApplicable === 0 ? 0 : totalSatisfied / totalApplicable,
      requiredSatisfaction: binding.requiredSatisfaction,
      perSplit,
    };
  });

  const uniqueLimitationsFinal = [...new Set(limitations)];

  // Confidence block (deterministic from the config thresholds).
  const splitsEvaluated = reportBySplit.size;
  let vacuousSplits = 0;
  for (const criterion of perCriterion) {
    for (const evidence of criterion.perSplit) {
      if (evidence.satisfied + evidence.violated + evidence.errors === 0) vacuousSplits += 1;
    }
  }
  let totalApplicableConstraints = 0;
  for (const criterion of perCriterion) {
    for (const evidence of criterion.perSplit) {
      totalApplicableConstraints += evidence.satisfied + evidence.violated + evidence.errors;
    }
  }
  const vacuousShare = splitsEvaluated === 0 ? 0 : vacuousSplits / (splitsEvaluated * Math.max(perCriterion.length, 1));
  const confidence = confidenceOf(config.confidence, totalApplicableConstraints, splitsEvaluated, vacuousSplits, vacuousShare);

  const attained = uniqueLimitationsFinal.length === 0 && perCriterion.every((c) => c.attained);

  const draft: Omit<AttainmentVerdict, 'verdictHash'> = {
    verdictId: verdictIdOf(criteria.id, suite.suiteId, suite.evaluatorVersion),
    attained,
    criteriaId: criteria.id,
    suite: suite.suiteId,
    evaluatorVersion: suite.evaluatorVersion,
    perCriterion,
    limitations: uniqueLimitationsFinal,
    confidence,
    inputDigest: inputDigestOf(criteria, config, suite, reports),
  };
  const verdictHash = verdictHashOf(draft);
  return ok(deepFreeze({ ...draft, verdictHash } satisfies AttainmentVerdict));
}

/** Status priority: blocking > error > below-required > vacuous > missing > attained. */
function worstStatus(current: CriterionVerdictStatus, candidate: CriterionVerdictStatus): CriterionVerdictStatus {
  const order: readonly CriterionVerdictStatus[] = [
    'attained',
    'missing-evidence',
    'vacuous-evaluation',
    'below-required-satisfaction',
    'evaluation-error',
    'blocking-violation',
  ];
  const rank = (status: CriterionVerdictStatus): number => order.indexOf(status);
  return rank(candidate) > rank(current) ? candidate : current;
}

/** Deterministic confidence derivation from the config thresholds. */
function confidenceOf(
  thresholds: ConfidenceThresholds,
  totalApplicable: number,
  splitsEvaluated: number,
  _vacuousSplits: number,
  vacuousShare: number,
): VerdictConfidenceBlock {
  let level: VerdictConfidence;
  if (splitsEvaluated === 0 || vacuousShare > thresholds.maxVacuousShareForModerate || totalApplicable < thresholds.moderateEvidenceVolume) {
    level = 'low';
  } else if (totalApplicable >= thresholds.highEvidenceVolume && vacuousShare <= thresholds.maxVacuousShareForHigh) {
    level = 'high';
  } else {
    level = 'moderate';
  }
  return {
    level,
    totalApplicableConstraints: totalApplicable,
    splitsEvaluated,
    vacuousSplits: _vacuousSplits,
    vacuousShare,
  };
}

/**
 * The typed L10/L11 policy-coverage problems of a (criteria, suite) pair:
 * the criteria's pinned blind/walk-forward/regime refs must each be carried
 * by a suite member of the MATCHING kind. An empty list means the suite
 * honors the pinned protocol.
 */
export function policyCoverageProblems(criteria: AcceptanceCriteria, suite: EvaluationSuite): EvalError[] {
  const problems: EvalError[] = [];
  const required: ReadonlyArray<{ readonly kind: SuiteMemberKind; readonly ref: string; readonly label: string }> = [
    { kind: 'blind', ref: criteria.evaluationPolicy.blindEvaluationRef, label: 'blindEvaluationRef' },
    { kind: 'walk-forward', ref: criteria.evaluationPolicy.walkForwardRef, label: 'walkForwardRef' },
    { kind: 'regime', ref: criteria.evaluationPolicy.regimeRef, label: 'regimeRef' },
  ];
  for (const requirement of required) {
    const covered = suite.members.some((member) => member.kind === requirement.kind && member.splitPolicy === requirement.ref);
    if (!covered) {
      problems.push({
        code: 'policy_coverage_missing',
        path: 'suite.members',
        message: `criteria pin ${requirement.label} "${requirement.ref}" but the suite "${suite.suiteId}" has no ${requirement.kind} member under that policy — evaluation cannot be shopped after compile time (L10/L11)`,
      });
    }
  }
  return problems;
}

/** Deterministic derived verdict id: digest of the (criteria, suite, evaluator) lineage. */
export function verdictIdOf(criteriaId: AcceptanceCriteriaId, suite: SuiteId, evaluatorVersion: EvaluatorVersionRef): VerdictId {
  const id = `vd:${stableDigestJson({ criteriaId, suite, evaluatorVersion } satisfies JsonValue)}`;
  return id as VerdictId;
}

/** Digest over the canonical JSON of ALL compilation inputs (mutation detector). */
function inputDigestOf(criteria: AcceptanceCriteria, config: EvaluationConfig, suite: EvaluationSuite, reports: readonly SplitConstraintReport[]): string {
  const tree: JsonValue = {
    criteria: criteria as unknown as JsonValue,
    config: config as unknown as JsonValue,
    suite: suite as unknown as JsonValue,
    reports: reports as unknown as JsonValue,
  };
  return stableDigestJson(tree);
}

/** Digest over the canonical JSON of the verdict minus the hash field. */
function verdictHashOf(draft: Omit<AttainmentVerdict, 'verdictHash'>): string {
  return stableDigest(canonicalJson(draft as unknown as JsonValue));
}

// ---------------------------------------------------------------------------
// The T007 bridge — attainment evidence for the control plane
// ---------------------------------------------------------------------------

/**
 * Criterion evaluation summary — STRUCTURAL MIRROR of T007 control-domain's
 * `CriterionEvaluationSummary`: constraint-satisfaction counts restricted
 * to one criterion's gate, aggregated over ALL splits (the control plane's
 * decision input). SEMANTIC MIRROR of the domain-core ratio: satisfied /
 * (satisfied + violated + errors), `not_applicable` excluded.
 */
export interface CriterionEvaluationSummary {
  readonly criterionId: string;
  readonly satisfied: number;
  readonly violated: number;
  readonly errors: number;
  readonly notApplicable: number;
  /** Violated constraints with blocking severity (subset count of `violated`). */
  readonly blockingViolations: number;
}

/** Guard: `CriterionEvaluationSummary` (mirror of T007's guard semantics). */
export function isCriterionEvaluationSummary(v: unknown): v is CriterionEvaluationSummary {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.criterionId)) return false;
  if (!Number.isInteger(v.satisfied) || (v.satisfied as number) < 0) return false;
  if (!Number.isInteger(v.violated) || (v.violated as number) < 0) return false;
  if (!Number.isInteger(v.errors) || (v.errors as number) < 0) return false;
  if (!Number.isInteger(v.notApplicable) || (v.notApplicable as number) < 0) return false;
  if (!Number.isInteger(v.blockingViolations) || (v.blockingViolations as number) < 0) return false;
  return (v.blockingViolations as number) <= (v.violated as number);
}

/**
 * Attainment evidence — STRUCTURAL MIRROR of T007 control-domain's
 * `AttainmentEvidence`: the ONLY input through which the control plane's
 * `decideAttainment` can establish "attained" (L5/L7). Constraint-
 * satisfaction counts only; no PnL field exists anywhere on this record.
 */
export interface AttainmentEvidence {
  /** The compiled criteria this evidence is for (lineage integrity, L15). */
  readonly criteriaId: AcceptanceCriteriaId;
  readonly evaluatedAt: TimestampMs;
  /** Opaque reference to the evaluation run record (this lane) — L9 lineage. */
  readonly evaluationRunRef: string;
  /** One summary per criterion of the referenced criteria (ids unique). */
  readonly evaluations: readonly CriterionEvaluationSummary[];
}

/** Guard: `AttainmentEvidence` (mirror of T007's guard semantics). */
export function isAttainmentEvidence(v: unknown): v is AttainmentEvidence {
  if (!isRecord(v)) return false;
  if (!isAcceptanceCriteriaId(v.criteriaId)) return false;
  if (!isTimestampMs(v.evaluatedAt)) return false;
  if (!isNonEmptyString(v.evaluationRunRef)) return false;
  if (!Array.isArray(v.evaluations)) return false;
  if (!v.evaluations.every((e) => isCriterionEvaluationSummary(e))) return false;
  const ids = v.evaluations.map((e) => (e as CriterionEvaluationSummary).criterionId);
  return new Set(ids).size === ids.length;
}

/**
 * Project a compiled verdict into the T007-shaped {@link AttainmentEvidence}
 * the control plane consumes: per-criterion aggregate counts (summed over
 * the verdict's per-split evidence), bound to the evaluation run and a
 * caller-supplied evaluatedAt instant (an explicit parameter — no ambient
 * clock, replayable). Pure and total.
 */
export function toAttainmentEvidence(
  verdict: AttainmentVerdict,
  evaluationRunRef: string,
  evaluatedAt: TimestampMs,
): EvalResult<AttainmentEvidence> {
  if (!isAttainmentVerdict(verdict)) {
    return fail('invalid_field', 'toAttainmentEvidence requires a valid attainment verdict', 'verdict');
  }
  if (!isNonEmptyString(evaluationRunRef)) {
    return fail('invalid_field', 'evaluationRunRef must be a non-empty opaque reference', 'evaluationRunRef');
  }
  if (!isTimestampMs(evaluatedAt)) {
    return fail('invalid_timestamp', 'evaluatedAt must be a valid TimestampMs', 'evaluatedAt');
  }
  const evaluations: CriterionEvaluationSummary[] = verdict.perCriterion.map((criterion): CriterionEvaluationSummary => {
    let satisfied = 0;
    let violated = 0;
    let errors = 0;
    let notApplicable = 0;
    let blockingViolations = 0;
    for (const evidence of criterion.perSplit) {
      satisfied += evidence.satisfied;
      violated += evidence.violated;
      errors += evidence.errors;
      notApplicable += evidence.notApplicable;
      blockingViolations += evidence.blockingViolations;
    }
    return { criterionId: criterion.criterionId, satisfied, violated, errors, notApplicable, blockingViolations };
  });
  return ok(
    deepFreeze({
      criteriaId: verdict.criteriaId,
      evaluatedAt,
      evaluationRunRef,
      evaluations,
    } satisfies AttainmentEvidence),
  );
}

/** Whether the verdict's suite satisfies the L10 release-grade law (adversarial coverage). */
export { isReleaseGradeSuite };
