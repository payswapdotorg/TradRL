// @tradrl/evaluation — branded identity references (T012 id discipline).
//
// Id discipline (mirroring @tradrl/domain-core, @tradrl/trajectory and
// @tradrl/experiments):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T012, the evaluation lane) are listed first:
//   the metric, suite, evaluation-run, verdict and search-integrity-report
//   identity spaces, plus the adversarial-suite reference space (adversarial
//   suites are referenced BY OPAQUE ID — L10 first-class protocol member).
// - `CriteriaRef` is the reference space @tradrl/experiments (T011) already
//   declared as "opaque reference to a success-criteria definition
//   (evaluation lane, T012)" — the referents are owned HERE; the brand tag
//   is re-declared identically so the two declarations stay mutually
//   assignable (D-003/D-004).
// - The remaining OPAQUE cross-lane references mirror their owners' exact
//   brand tags the same way: `TrajectoryId`/`DataRef` mirror
//   @tradrl/trajectory (T011); `ExperimentId`/`TrialId`/`ArmId`/
//   `SplitPolicyRef`/`EvaluatorVersionRef` mirror @tradrl/experiments (T011);
//   `AcceptanceCriteriaId` mirrors @tradrl/control-domain (T007);
//   `ConstraintSetId` mirrors @tradrl/domain-core (T002). This package never
//   imports those packages — it only reserves the reference types here
//   (same structural-mirror law as TimestampMs, see interop.test.ts).

import { Brand, isNonEmptyString } from './primitives';

// --- Ids owned by the evaluation lane (T012) ----------------------------------

/** Identity of one registered metric definition. */
export type MetricId = Brand<string, 'MetricId'>;

/** Identity of one evaluation suite (composition of members over split policies). */
export type SuiteId = Brand<string, 'SuiteId'>;

/**
 * Opaque reference to an adversarial suite — a SuiteId by brand, kept as its
 * own alias because adversarial suites are referenced BY OPAQUE ID and are
 * mandatory before release-grade verdicts (L10).
 */
export type AdversarialSuiteRef = SuiteId;

/** Identity of one evaluation run (one execution of a suite against a substrate). */
export type EvaluationRunId = Brand<string, 'EvaluationRunId'>;

/** Identity of one compiled attainment verdict (deterministic derived id — see verdict.ts). */
export type VerdictId = Brand<string, 'VerdictId'>;

/** Identity of one search-integrity report (deterministic derived id — see integrity.ts). */
export type SearchIntegrityReportId = Brand<string, 'SearchIntegrityReportId'>;

/** Opaque reference to a success-criteria definition — referent space owned by T012. */
export type CriteriaRef = Brand<string, 'CriteriaRef'>;

// --- Opaque cross-lane references (referents owned by other lanes) ------------

/** Dataset reference — structural mirror of @tradrl/trajectory (T011). */
export type DataRef = Brand<string, 'DataRef'>;

/** Trajectory identity — structural mirror of @tradrl/trajectory (T011). */
export type TrajectoryId = Brand<string, 'TrajectoryId'>;

/** Experiment identity — structural mirror of @tradrl/experiments (T011). */
export type ExperimentId = Brand<string, 'ExperimentId'>;

/** Trial identity — structural mirror of @tradrl/experiments (T011). */
export type TrialId = Brand<string, 'TrialId'>;

/** Comparison-arm identity — structural mirror of @tradrl/experiments (T011). */
export type ArmId = Brand<string, 'ArmId'>;

/** Split policy reference — mirror of @tradrl/experiments (T011); referents owned by T012/T032. */
export type SplitPolicyRef = Brand<string, 'SplitPolicyRef'>;

/** Versioned evaluator reference — mirror of @tradrl/experiments (T011); referents owned by T012. */
export type EvaluatorVersionRef = Brand<string, 'EvaluatorVersionRef'>;

/** Compiled acceptance criteria identity — structural mirror of @tradrl/control-domain (T007). */
export type AcceptanceCriteriaId = Brand<string, 'AcceptanceCriteriaId'>;

/** Constraint set identity — structural mirror of @tradrl/domain-core (T002). */
export type ConstraintSetId = Brand<string, 'ConstraintSetId'>;

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time (see ids.test.ts and interop.test.ts).

export const isMetricId = (v: unknown): v is MetricId => isNonEmptyString(v);
export const isSuiteId = (v: unknown): v is SuiteId => isNonEmptyString(v);
export const isAdversarialSuiteRef = (v: unknown): v is AdversarialSuiteRef => isNonEmptyString(v);
export const isEvaluationRunId = (v: unknown): v is EvaluationRunId => isNonEmptyString(v);
export const isVerdictId = (v: unknown): v is VerdictId => isNonEmptyString(v);
export const isSearchIntegrityReportId = (v: unknown): v is SearchIntegrityReportId => isNonEmptyString(v);
export const isCriteriaRef = (v: unknown): v is CriteriaRef => isNonEmptyString(v);
export const isDataRef = (v: unknown): v is DataRef => isNonEmptyString(v);
export const isTrajectoryId = (v: unknown): v is TrajectoryId => isNonEmptyString(v);
export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);
export const isSplitPolicyRef = (v: unknown): v is SplitPolicyRef => isNonEmptyString(v);
export const isEvaluatorVersionRef = (v: unknown): v is EvaluatorVersionRef => isNonEmptyString(v);
export const isAcceptanceCriteriaId = (v: unknown): v is AcceptanceCriteriaId => isNonEmptyString(v);
export const isConstraintSetId = (v: unknown): v is ConstraintSetId => isNonEmptyString(v);
