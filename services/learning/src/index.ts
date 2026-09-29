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

/** Package identity and ownership (Work Order T013). */
export const packageInfo = {
  name: '@tradrl/learning',
  owner: 'T013',
  status: 'implemented',
} as const;
