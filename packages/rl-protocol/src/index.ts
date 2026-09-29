/**
 * @tradrl/rl-protocol — the RL interface/trainer bridge contract package
 * (Work Order T013).
 *
 * Public API:
 *   - Errors and results — the closed typed taxonomy (`RLErrorCode`)
 *     including the law trip-wires: `undeclared_reward_input`,
 *     `reward_model_mismatch`, `lineage_gap`, `trial_rewrite`,
 *     `l4_boundary_violation`, `method_unknown`, `environment_error`.
 *   - Structural primitives — the shared contract vocabulary (branding,
 *     guards, deep-freeze discipline, JSON model, canonical JSON, FNV-1a
 *     digests) and the `TimestampMs` mirror of @tradrl/time-engine.
 *   - Ids — `TrainingRunId` and the `RewardModelRef` space (owned by T013)
 *     plus the opaque cross-lane mirrors (T005 environment identities,
 *     T011 trajectory/experiments identities, T002/T006 references).
 *   - Method taxonomy — the closed LEARNING-LOOP `LearningMethod` union
 *     (rl, offline_rl, supervised, imitation, preference_optimization,
 *     bandits, self_play, adversarial, population_search).
 *   - Environment mirrors — the exact `EnvironmentSpec`/`ClockConfig`/
 *     `EnvironmentProfile` mirrors, the L4-minimal `ObservationView`, the
 *     `EpisodeView`/`EpisodeResultView`/`EpisodeFinishView` consumer views,
 *     the reward envelope, and the `EnvironmentPort` (the injected world —
 *     structurally satisfied by every T005-shaped environment).
 *   - Trajectory mirrors — the canonical experience record (TrajectoryStep,
 *     TrajectoryMetadata, Trajectory) re-declared field-for-field; the
 *     bridge's step logs ARE trajectories.
 *   - RewardModel — the L7 discipline: declared inputs, pure transforms,
 *     self-reporting claims, and `attachRewardSignals` (post-hoc
 *     annotation; every signal carries its RewardModelRef).
 *   - EpisodeDriver — the deterministic five-operation loop
 *     (start/observe/act/advance/finish) as a pure reducer over an
 *     immutable driver state, with the L4 gate, budget law and lifecycle
 *     trip-wires.
 *   - TrainingRunProtocol — the run declaration, the append-only run state
 *     with the digest step chain, the run lineage (the ReplayRunRecord
 *     mirror: config hash, chain head, spec hash, digest) and the L9
 *     derivations.
 *   - Trial emission — the experiments-lane `TrialRecord` mirror, the
 *     `TrainerTrial` (record + lineage) and the append-only `TrialLog`
 *     (`trial_rewrite` on duplicates — L11).
 *   - TrainerContract — `prepareRun` / `driveEpisode` / `collectTrial` over
 *     the injected Environment/Policy ports (the package ships NO world
 *     and NO policy).
 *
 * Zero runtime dependencies; types, schemas and pure functions only. No
 * ambient clock anywhere (`Date.now()` never appears) — every instant is an
 * explicit parameter, so every derived record is replayable and
 * byte-deterministic. Cross-lane shapes are STRUCTURAL MIRRORS (D-003/D-004
 * — never imports); src/interop.test.ts is the drift trip wire against the
 * REAL packages present on this branch.
 */

// Errors and results
export type { RLErrorCode, RLError, RLResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

// Structural primitives (deepFreeze discipline, branding, JSON model, digests)
export type { Brand, Mutable, JsonValue, JsonObject } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  deepFreeze,
  isDeeplyFrozen,
  isJsonValue,
  isJsonObject,
  canonicalJson,
  fnv1a32Hex,
} from './primitives';

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './timestamp';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs, timestampMs, requireTimestampMs } from './timestamp';

// Branded ids and opaque cross-lane references
export type {
  TrainingRunId,
  RewardModelRef,
  EpisodeId,
  ObservationId,
  ActionId,
  RewardId,
  EnvironmentId,
  Seed,
  AgentInstanceId,
  WorldId,
  VenueId,
  InstrumentId,
  LatencyPolicyId,
  FeePolicyId,
  TrajectoryId,
  StepId,
  CausalityId,
  EnvironmentConfigRef,
  RuntimeRef,
  DataRef,
  ToolOutcomeRef,
  EnvironmentResultRef,
  ExperimentId,
  TrialId,
  ArmId,
  TenantId,
  ProjectId,
  OrganizationId,
  BodyVersionRef,
  SubstrateRef,
} from './ids';
export {
  isTrainingRunId,
  isRewardModelRef,
  isEpisodeId,
  isObservationId,
  isActionId,
  isRewardId,
  isEnvironmentId,
  isSeed,
  isAgentInstanceId,
  isWorldId,
  isVenueId,
  isInstrumentId,
  isLatencyPolicyId,
  isFeePolicyId,
  isTrajectoryId,
  isStepId,
  isCausalityId,
  isEnvironmentConfigRef,
  isRuntimeRef,
  isDataRef,
  isToolOutcomeRef,
  isEnvironmentResultRef,
  isExperimentId,
  isTrialId,
  isArmId,
  isTenantId,
  isProjectId,
  isOrganizationId,
  isBodyVersionRef,
  isSubstrateRef,
} from './ids';

// Method taxonomy (spec/LEARNING-LOOP.md)
export type { LearningMethod } from './method';
export { LEARNING_METHODS, isLearningMethod } from './method';

// Environment-lane structural mirrors (D-003/D-004) + the EnvironmentPort
export type {
  FidelityMode,
  InformationPolicy,
  ClockConfig,
  WorldRef,
  EnvironmentProfile,
  EnvironmentSpec,
  ObservationView,
  TerminationCode,
  TerminationReason,
  RewardSignalEnvelope,
  EpisodeView,
  EpisodeResultView,
  EpisodeFinishView,
  EnvironmentError,
  EnvironmentResult,
  EnvironmentPort,
} from './env-mirror';
export {
  FIDELITY_MODES,
  isFidelityMode,
  isInformationPolicy,
  isClockConfig,
  isWorldRef,
  isEnvironmentProfile,
  isEnvironmentSpec,
  validateEnvironmentSpec,
  specTree,
  canonicalSpecJson,
  isObservationView,
  TERMINATION_CODES,
  isTerminationCode,
  isTerminationReason,
  isRewardSignalEnvelope,
  isEpisodeView,
  isEpisodeResultView,
  isEpisodeFinishView,
  isEnvironmentPort,
  environmentFailure,
} from './env-mirror';

// Trajectory-lane structural mirrors (the canonical experience record)
export type {
  ClockSample,
  ObservationRef,
  ActionRecord,
  RejectionError,
  RejectionRecord,
  RewardSignalRecord,
  TrajectoryStep,
  TrajectoryMetadata,
  Trajectory,
} from './traj-mirror';
export {
  isClockSample,
  isObservationRef,
  isActionRecord,
  isRejectionError,
  isRejectionRecord,
  isRewardSignalRecord,
  isTrajectoryStep,
  validateTrajectoryStep,
  isTrajectoryMetadata,
  validateTrajectoryMetadata,
  isTrajectory,
  validateTrajectory,
  createTrajectory,
  appendTrajectoryStep,
  replayTrajectory,
} from './traj-mirror';

// RewardModel discipline (L7)
export type {
  RewardInputKey,
  RewardScope,
  RewardClaim,
  RewardTransform,
  RewardModel,
  RewardModelSignal,
  RewardAnnotatedStep,
  RewardAnnotatedTrajectory,
} from './reward';
export {
  REWARD_INPUT_KEYS,
  isRewardInputKey,
  isRewardScope,
  isRewardClaim,
  validateRewardClaim,
  isRewardModel,
  validateRewardModel,
  isRewardModelSignal,
  validateRewardModelSignal,
  isRewardAnnotatedStep,
  isRewardAnnotatedTrajectory,
  everySignalCarriesModelRef,
  attachRewardSignals,
} from './reward';

// The EpisodeDriver (the deterministic five-operation loop)
export type { DriverStatus, PendingStep, DriverState, DriverOptions, PolicyProposal } from './driver';
export {
  isPolicyProposal,
  isDriverState,
  createEpisodeDriver,
  driverStart,
  driverObserve,
  driverAct,
  driverAdvance,
  driverFinish,
  driverSteps,
  driverFinishResult,
  serializeDriverSteps,
  stepDigest,
  DRIVER_PROTOCOL,
} from './driver';

// The TrainingRunProtocol (L9/L12)
export type {
  TrainingRunDeclaration,
  TrainingRunStatus,
  RunEpisode,
  TrainingRunState,
  WorldLineage,
  TrainingRunLineage,
} from './run';
export {
  isTrainingRunDeclaration,
  validateTrainingRunDeclaration,
  isRunEpisode,
  isTrainingRunState,
  declarationChainSeed,
  declarationTree,
  prepareTrainingRun,
  appendRunEpisode,
  finishTrainingRun,
  verifyRunChain,
  isWorldLineage,
  extractWorldLineage,
  isTrainingRunLineage,
  validateTrainingRunLineage,
  deriveEnvironmentConfigRef,
  deriveTrajectoryId,
} from './run';

// Trial emission (L11)
export type { TrialStatus, TrialRecord, TrainerTrial, TrialLog } from './trial';
export {
  TRIAL_STATUSES,
  TERMINAL_TRIAL_STATUSES,
  isTrialStatus,
  isTrialRecord,
  validateTrialRecord,
  isTrainerTrial,
  validateTrainerTrial,
  isTrialLog,
  createTrialLog,
  appendTrainerTrial,
  trialLogEntries,
} from './trial';

// The TrainerContract + the injected ports
export type { PolicyInput, PolicyPort, TrialEvidence, TrainerContract } from './trainer';
export { isPolicyInput, isPolicyPort, validateProposals, isTrialEvidence, isTrainerContract, requirePorts } from './trainer';

/** Package identity and ownership (Work Order T013). */
export const packageInfo = {
  name: '@tradrl/rl-protocol',
  owner: 'T013',
  status: 'implemented',
} as const;
