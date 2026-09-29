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

/** Package identity and ownership (Work Order T013). */
export const packageInfo = {
  name: '@tradrl/learning',
  owner: 'T013',
  status: 'implemented',
} as const;
