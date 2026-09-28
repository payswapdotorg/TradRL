/**
 * @tradrl/evaluation — the acceptance machinery of TradRL (T012).
 *
 * Public API:
 *   - Structural primitives — the shared contract vocabulary (branding,
 *     guards, deep-freeze discipline, JSON model, canonical JSON, stable
 *     digests) and the `TimestampMs` mirror of @tradrl/time-engine.
 *   - Ids — the identity spaces this lane owns (`MetricId`, `SuiteId`,
 *     `EvaluationRunId`, `VerdictId`, `SearchIntegrityReportId`,
 *     `CriteriaRef` — the success-criteria reference space T011 points at)
 *     plus the opaque cross-lane mirrors (`TrajectoryId`, `DataRef`,
 *     `ExperimentId`, `TrialId`, `ArmId`, `SplitPolicyRef`,
 *     `EvaluatorVersionRef`, `AcceptanceCriteriaId`, `ConstraintSetId`).
 *   - Metrics — `MetricDefinition`/`MetricResult` (constraint-aggregate
 *     statistics first-class; risk-adjusted figures as opaque refs, never
 *     the sole criterion — L7) and `MetricRegistry` with validation.
 *   - Split policies — `DatasetAxis`/`DatasetSegment`, walk-forward
 *     windows, blind holdout masks, regime partitions: pure functions over
 *     opaque dataset refs with typed boundary laws.
 *   - Suites — `EvaluationSuite` composition with the mandatory-adversarial
 *     law for release grade (L10) and evaluator-version lineage (L9).
 *   - Verdicts — `compileAttainmentVerdict`: (criteria + per-split
 *     constraint reports + suite + config) -> `AttainmentVerdict` with
 *     per-criterion evidence, computed limitations and confidence; the
 *     T007 bridge `toAttainmentEvidence` for the control plane.
 *   - Search integrity — `computeSearchIntegrityReport` over an
 *     experiment's FULL trial log (T011 mirror): failures retained,
 *     best-of-N selection effect quantified, hiding trials a typed error.
 *
 * Zero runtime dependencies; types, schemas and pure functions only. No
 * ambient clock anywhere (`Date.now()` never appears) — every instant is an
 * explicit parameter, so every derived record is replayable and
 * byte-deterministic. Shared shapes live in STRUCTURAL MIRRORS of their
 * canonical owners (@tradrl/time-engine, @tradrl/domain-core,
 * @tradrl/control-domain, @tradrl/experiments) — never imports (D-003/D-004);
 * src/interop.test.ts is the drift trip wire.
 */

// Errors and results
export type { EvalErrorCode, EvalError, EvalResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

// Structural primitives (deepFreeze discipline, branding, JSON model, digests)
export type { Brand, Mutable, JsonValue, JsonObject } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isUnitInterval,
  isNonNegativeInteger,
  isPositiveInteger,
  deepFreeze,
  isDeeplyFrozen,
  isJsonValue,
  isJsonObject,
  canonicalJson,
  stableDigest,
  stableDigestJson,
  isDigest,
} from './primitives';

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './primitives';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs, timestampMs, requireTimestampMs } from './primitives';

// Branded ids and opaque cross-lane references
export type {
  MetricId,
  SuiteId,
  AdversarialSuiteRef,
  EvaluationRunId,
  VerdictId,
  SearchIntegrityReportId,
  CriteriaRef,
  DataRef,
  TrajectoryId,
  ExperimentId,
  TrialId,
  ArmId,
  SplitPolicyRef,
  EvaluatorVersionRef,
  AcceptanceCriteriaId,
  ConstraintSetId,
} from './ids';
export {
  isMetricId,
  isSuiteId,
  isAdversarialSuiteRef,
  isEvaluationRunId,
  isVerdictId,
  isSearchIntegrityReportId,
  isCriteriaRef,
  isDataRef,
  isTrajectoryId,
  isExperimentId,
  isTrialId,
  isArmId,
  isSplitPolicyRef,
  isEvaluatorVersionRef,
  isAcceptanceCriteriaId,
  isConstraintSetId,
} from './ids';

// Metrics: definitions, results, registry
export type { ConstraintAggregate, MetricDefinition, MetricValue, MetricResult, MetricRegistry, ConstraintSatisfactionCounts } from './metrics';
export {
  CONSTRAINT_AGGREGATES,
  isConstraintAggregate,
  isConstraintSatisfactionCounts,
  satisfiedRatioOf,
  constraintAggregateValue,
  isMetricDefinition,
  isMetricValue,
  isMetricResult,
  isMetricRegistry,
  createMetricRegistry,
  lookupMetric,
  validateMetricResult,
  metricRegistryId,
} from './metrics';

// Split policies: axis, policies, pure interpreters
export type {
  DatasetSegment,
  DatasetAxis,
  WalkForwardPolicy,
  BlindHoldoutPolicy,
  RegimePartitionPolicy,
  SplitPolicy,
  WalkForwardWindow,
  BlindHoldoutSplit,
  RegimePartition,
} from './splits';
export {
  isDatasetSegment,
  isDatasetAxis,
  validateDatasetAxis,
  SPLIT_POLICY_KINDS,
  isWalkForwardPolicy,
  isBlindHoldoutPolicy,
  isRegimePartitionPolicy,
  isSplitPolicy,
  validateSplitPolicy,
  walkForwardWindows,
  blindHoldoutMask,
  regimePartition,
  policySegmentRefs,
} from './splits';

// Evaluation suites and composition rules
export type { SuiteMemberKind, SuiteGrade, SuiteMember, EvaluationSuite } from './suite';
export {
  SUITE_MEMBER_KINDS,
  isSuiteMemberKind,
  SUITE_GRADES,
  isSuiteGrade,
  isSuiteMember,
  isEvaluationSuite,
  createEvaluationSuite,
  isReleaseGradeSuite,
  suiteSplitPolicyRefs,
} from './suite';

// Attainment verdict compilation (L7) + the T007 bridge
export type {
  CriterionBinding,
  AcceptanceCriteria,
  ConstraintCheckStatusMirror,
  ConstraintSeverityMirror,
  ConstraintCheckMirror,
  SplitConstraintReport,
  ConfidenceThresholds,
  EvaluationConfig,
  CriterionSplitEvidence,
  CriterionVerdict,
  CriterionVerdictStatus,
  VerdictLimitationCode,
  VerdictConfidence,
  VerdictConfidenceBlock,
  AttainmentVerdict,
  VerdictCompilationInput,
  CriterionEvaluationSummary,
  AttainmentEvidence,
} from './verdict';
export {
  isCriterionBinding,
  isAcceptanceCriteria,
  CONSTRAINT_CHECK_STATUSES,
  isConstraintCheckStatusMirror,
  CONSTRAINT_SEVERITIES_MIRROR,
  isConstraintSeverityMirror,
  isConstraintCheckMirror,
  isSplitConstraintReport,
  splitConstraintReport,
  isConfidenceThresholds,
  isEvaluationConfig,
  CRITERION_VERDICT_STATUSES,
  isCriterionVerdictStatus,
  isCriterionSplitEvidence,
  isCriterionVerdict,
  VERDICT_LIMITATION_CODES,
  isVerdictLimitationCode,
  VERDICT_CONFIDENCE_LEVELS,
  isVerdictConfidence,
  isAttainmentVerdict,
  compileAttainmentVerdict,
  policyCoverageProblems,
  verdictIdOf,
  isCriterionEvaluationSummary,
  isAttainmentEvidence,
  toAttainmentEvidence,
} from './verdict';

// Search integrity (L11)
export type { TrialStatusMirror, TrialLogEntry, TrialStatistic, SelectionClaim, BestOfNEffect, SearchIntegrityReport } from './integrity';
export {
  TRIAL_STATUSES_MIRROR,
  isTrialStatusMirror,
  isTrialLogEntry,
  isTrialStatistic,
  isSelectionClaim,
  isBestOfNEffect,
  isSearchIntegrityReport,
  computeSearchIntegrityReport,
} from './integrity';

/** Package identity and ownership (Work Order T012). */
export const packageInfo = {
  name: '@tradrl/evaluation',
  owner: 'T012',
  status: 'implemented',
} as const;
