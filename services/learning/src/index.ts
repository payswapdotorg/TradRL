/**
 * @tradrl/learning — the reference learning service (Work Order T013).
 *
 * Public API (implementation lives in src/rl/ — the nested-service
 * precedent of services/market-world with src/replay + src/exchange;
 * T014 joins under src/compute and T015 under src/curriculum /
 * src/populations):
 *   - `createReferenceTrainer` — the deterministic reference trainer over
 *     the EpisodeDriver (drive -> record -> reward -> bind lineage ->
 *     emit trial), plus `episodeTrajectory` / `annotateEpisode` (post-hoc
 *     reward models, L7) and the append-only trial log (L11).
 *   - `createScriptedPolicy` — the deterministic policy port (action
 *     choice from observation refs only — L4).
 *   - `createScriptedEnvironment` — the fixture world (structurally an
 *     environment-protocol Environment; no world implementation imported).
 *   - Reward models — `createObservationCostRewardModel`,
 *     `createActionEngagementRewardModel` (pure, versioned, declared
 *     inputs) and `createRogueRewardModel` (the undeclared-input trip
 *     wire's test instrument).
 *   - Run-state serialization — `serializeTrainingRunState` /
 *     `resumeTrainingRunState` (canonical bytes, chain verification on
 *     resume).
 *   - Replay adapter — the thin ReplayWorldService STRUCTURAL mirror:
 *     `driveReplayEpisodeWithTrainer` (loadAll -> five operations ->
 *     runRecord -> L9 lineage), the services/market-world README T013
 *     consumption contract.
 *
 * Zero runtime dependencies. The service consumes its contract package,
 * `@tradrl/rl-protocol`, via a relative source import (the frozen write
 * surface permits no lockfile-touching workspace edge — the same
 * discipline services/market-world documents; the Lead may convert to
 * `workspace:*` at the next serialized lockfile change). No ambient clock
 * (`Date.now()` never appears) — every instant is an explicit parameter.
 */

export type { ReferenceTrainer, ReferenceTrainerOptions } from './rl/trainer';
export { createReferenceTrainer, isReferenceTrainerOptions } from './rl/trainer';

export type { ScriptedWorldOptions } from './rl/fixtures';
export {
  createScriptedEnvironment,
  scriptedEpisodeId,
  scriptedWorldOptions,
  unwrapScripted,
  type ScriptedEnvironment,
  type ScriptedEpisodeView,
  type ScriptedObservation,
  type ScriptedResult,
  type ScriptedRewardSignal,
} from './rl/fixtures';

export { createScriptedPolicy, scriptedPolicyKind, SCRIPTED_POLICY_KINDS } from './rl/policy';

export {
  createActionEngagementRewardModel,
  createObservationCostRewardModel,
  createRogueRewardModel,
} from './rl/reward-models';

export { serializeTrainingRunState, resumeTrainingRunState, TRAINING_RUN_STATE_SCHEMA } from './rl/run-state';

export type { ReplayBridgeOutcome, ReplayEpisodeViewShape, ReplayFinishShape, ReplayResultMirror, ReplayWorldServiceShape } from './rl/replay-adapter';
export {
  driveReplayEpisodeWithTrainer,
  isReplayWorldServiceShape,
  replayServiceAsEnvironmentPort,
} from './rl/replay-adapter';

// --- T014 (distributed episode generation) — additive re-exports ------------
// The reference compute layer beside src/rl: the fake episode generator
// (drives the REAL T013 trainer per episode — distributed generation
// DRIVES the T013 contracts, it does not replace them), the scripted fake
// ComputePort (deterministic duplication/failure/reordering injection),
// the resumable reference runner (start/pump/complete/serialize/resume/
// aggregate with chain verification), and the golden fixtures.
export type { EpisodeGenerator } from './compute/generator';
export {
  createDriverEpisodeGenerator,
  scriptComputeSpec,
  scriptEpisodeDigest,
  SCRIPT_COMPUTE_BASE_TIME,
  SCRIPT_COMPUTE_POLICY_REF,
  SCRIPT_COMPUTE_TICKS,
} from './compute/generator';

export type { ScriptedComputePortOptions, ScriptedFailurePlan, ScriptedPortReply } from './compute/port';
export { createScriptedComputePort } from './compute/port';

export type { ComputeRunState, ComputeRunStatus, CompletionOptions } from './compute/runner';
export {
  aggregateComputeRun,
  COMPUTE_RUN_STATE_SCHEMA,
  computeRunComplete,
  isComputeRunState,
  pendingSubmissions,
  pumpComputeCollect,
  resumeComputeRunState,
  runComputeToCompletion,
  serializeComputeRunState,
  startComputeRun,
  verifyComputeRunChain,
} from './compute/runner';

export { GOLDEN_EXPERIMENT, GOLDEN_PROJECT, GOLDEN_TENANT, goldenAggregate, goldenComputeRunId, goldenJobLiterals, goldenJobSet, goldenRun, goldenSchedule, goldenWorkers } from './compute/fixtures';

// --- T015 (curriculum / self-play / adversarial populations) — additive re-exports ---
// The curriculum scheduler and the adversarial arsenal beside src/rl and
// src/compute: the frozen nine-stage ladder (LEARNING-LOOP.md verbatim)
// with the L6 fidelity-claim table, the typed CapabilityGap mirrors +
// gap-driven selection (failure-driven learning), the commission records
// (the T011 ExperimentDesign / TrialRecord mirrors + the T014 EpisodeJob
// mirror — stages SPAWN experiments, they never run them), the declared
// versioned curriculum record, the deterministic CurriculumPlan (with the
// stage-9 gate and the typed live-refusal record), the evidence-gated
// append-only CurriculumTrail (L11, chain-verified), the immutable
// PopulationRecord, the pure seeded PopulationEvolution (declared
// selection functions and mutation operators — no hidden fitness), the
// SelfPlayMatchup (fieldability-law pairings for stage 5 / L10), the
// population succession integrity laws (retired adversaries are retained
// records; hiding one is a typed error), and both golden fixture sets.
export type { CurriculumErrorCode, CurriculumError, CurriculumResult } from './curriculum/primitives';
export {
  deepFreeze as curriculumDeepFreeze,
  isDeeplyFrozen as curriculumIsDeeplyFrozen,
  canonicalJson as curriculumCanonicalJson,
  fnv1a32Hex as curriculumFnv1a32Hex,
  isTimestampMs as curriculumIsTimestampMs,
} from './curriculum/primitives';

export type { CurriculumStageKind, WorldMode } from './curriculum/ladder';
export {
  CURRICULUM_STAGES,
  ENTRY_STAGE,
  REQUIRED_WORLD_MODES,
  WORLD_MODES,
  advanceTarget,
  checkFidelityHonesty,
  coerceStageKind,
  isCurriculumStageKind,
  isLiveGatedStage,
  isWorldMode,
  stagePosition,
  worldModeHonest,
} from './curriculum/ladder';

export type { CapabilityGapKind, CapabilityGapMirror, GapRemediation, LearningMethodMirror } from './curriculum/gaps';
export {
  CAPABILITY_GAP_KINDS,
  LEARNING_METHODS_MIRROR,
  isCapabilityGapKind,
  isCapabilityGapMirror,
  isGapRemediation,
  isLearningMethodMirror,
  selectRemediation,
  validateGapTable,
} from './curriculum/gaps';

export type {
  ArmDescriptorMirror,
  ArmRoleMirror,
  CommissionedBatch,
  DriverConfigMirror,
  EpisodeJobSpecMirror,
  ExperimentDesignMirror,
  InterventionDescriptorMirror,
  JobLineageMirror,
  SeedRangeMirror,
  StageCommissionConfig,
  TrialRecordMirror,
  TrialStatusMirror,
} from './curriculum/commission';
export {
  ARM_ROLES_MIRROR,
  TRIAL_STATUSES_MIRROR,
  commissionStageBatch,
  commissionedTrialId,
  commissionedTrials,
  deriveJobId,
  deriveJobSeedBase,
  deriveStageExperimentId,
  isArmDescriptorMirror,
  isArmRoleMirror,
  isCommissionedBatch,
  isDriverConfigMirror,
  isEpisodeJobSpecMirror,
  isExperimentDesignMirror,
  isInterventionDescriptorMirror,
  isJobLineageMirror,
  isStageCommissionConfig,
  isTrialRecordMirror,
  isTrialStatusMirror,
  validateCommissionedBatch,
} from './curriculum/commission';

export type { CurriculumVersion, StageRule } from './curriculum/version';
export { isCurriculumVersion, isStageRule, stageRuleOf, validateCurriculumVersion } from './curriculum/version';

export type {
  CurriculumPlan,
  CurriculumPlanInput,
  LiveGateRefusal,
  PlanLineage,
  PlannedStage,
  StageMotivation,
} from './curriculum/plan';
export {
  derivePlanDigest,
  derivePlanId,
  gapDrivenSelections,
  isCurriculumPlan,
  isCurriculumPlanInput,
  isLiveGateRefusal,
  isPlanLineage,
  isPlannedStage,
  isStageMotivation,
  planCurriculum,
} from './curriculum/plan';

export type {
  CurriculumTrail,
  EvidenceCitation,
  StageTransition,
  StageTransitionKind,
  TransitionLineage,
  TransitionReason,
} from './curriculum/trail';
export {
  CURRICULUM_TRAIL_SCHEMA,
  STAGE_TRANSITION_KINDS,
  TRANSITION_REASONS,
  appendTransition,
  enterCurriculum,
  evidencedAdvance,
  isCurriculumTrail,
  isEvidenceCitation,
  isStageTransition,
  isStageTransitionKind,
  isTransitionLineage,
  isTransitionReason,
  openCurriculumTrail,
  recordedRefusal,
  recordedRegression,
  resumeCurriculumTrail,
  serializeCurriculumTrail,
  trailPosition,
  verifyTrailChain,
} from './curriculum/trail';

export {
  GOLDEN_CANDIDATE,
  GOLDEN_CONSTRAINTS,
  GOLDEN_CRITERIA_SET,
  GOLDEN_CURRICULUM_VERSION,
  GOLDEN_EVALUATOR,
  GOLDEN_GOAL,
  GOLDEN_LIVE_PERMISSION,
  GOLDEN_PROJECT as GOLDEN_CURRICULUM_PROJECT,
  GOLDEN_SEED,
  GOLDEN_TENANT as GOLDEN_CURRICULUM_TENANT,
  goldenAdvancementTrail,
  goldenCitation,
  goldenCurriculumVersion,
  goldenCurriculumVersionLiteral,
  goldenEntry,
  goldenGaps,
  goldenPlan,
  goldenPlanInput,
  goldenRefusalTrail,
  goldenRegressionTrail,
  goldenStageCriteria,
  goldenTrailBytes,
} from './curriculum/fixtures';

export type {
  AdversaryDescriptor,
  AdversaryLineage,
  PopulationGenerationKind,
  PopulationLineage,
  PopulationRecord,
} from './populations/population';
export {
  fieldableAdversaries,
  generationKind,
  isAdversaryDescriptor,
  isAdversaryLineage,
  isFieldable,
  isPopulationLineage,
  isPopulationRecord,
  retiredAdversaries,
  validatePopulationRecord,
} from './populations/population';

export type { EvolutionOutcome, FitnessDerivation, MutationOperator, MutationOperatorKind, SelectionFunction } from './populations/evolution';
export {
  FITNESS_DERIVATIONS,
  MUTATION_OPERATOR_KINDS,
  deriveMutantAdversaryId,
  deriveMutantStrategyRef,
  deriveRecombinedBlueprintRef,
  evolvePopulation,
  isEvolutionOutcome,
  isFitnessDerivation,
  isMutationOperator,
  isMutationOperatorKind,
  isSelectionFunction,
  seededDigestFitness,
} from './populations/evolution';

export type { MatchupCommissionConfig, MatchupLineage, SelfPlayMatchup } from './populations/matchup';
export {
  commissionMatchupBatch,
  deriveMatchupExperimentId,
  deriveMatchupId,
  fieldMatchup,
  isMatchupCommissionConfig,
  isMatchupLineage,
  isSelfPlayMatchup,
} from './populations/matchup';

export { fullHistory, populationHistoryDigest, validatePopulationSuccession } from './populations/integrity';

export {
  GOLDEN_POPULATION,
  GOLDEN_POPULATION_SEED,
  goldenEvolution,
  goldenEvolvedPopulation,
  goldenMatchup,
  goldenMatchupConfig,
  goldenMatchupId,
  goldenMatchupLineage,
  goldenMutationOperator,
  goldenPopulation,
  goldenPopulationLiteral,
  goldenSelectionFunction,
} from './populations/fixtures';

/** Package identity and ownership (Work Order T013). */
export const packageInfo = {
  name: '@tradrl/learning',
  owner: 'T013',
  status: 'implemented',
} as const;
