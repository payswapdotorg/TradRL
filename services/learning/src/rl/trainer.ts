/**
 * @tradrl/learning (service) — the reference deterministic trainer.
 *
 * Implements {@link TrainerContract} over the protocol's EpisodeDriver —
 * the GENERIC deterministic episode loop of the LEARNING-LOOP's training
 * half (spec/LEARNING-LOOP.md: "training -> trajectory -> evaluation ->
 * verification"):
 *
 *     drive  -> the five environment operations under the injected policy
 *               port, recording the canonical step log into the run;
 *     record -> the append-only run state (episodes + digest step chain);
 *     reward -> POST-HOC through the protocol's attachRewardSignals (the
 *               reward models apply to the RECORDED trajectory; the world
 *               channel is never touched — L7);
 *     bind   -> the L9 lineage block at trial collection (the world's run
 *               record mirror included);
 *     emit   -> the experiments-lane TrialRecord + lineage, appended into
 *               the trainer's append-only trial log (L11 — a duplicate or
 *               rewrite is a typed `trial_rewrite` refusal).
 *
 * This is a PROTOCOL BRIDGE trainer: it performs NO method-specific
 * gradient/math optimization (concrete algorithms belong to external
 * engines behind the ports; T014/T015 specialize). There is no ambient
 * clock and no hidden randomness: `started_at`/`ended_at` are explicit
 * evidence parameters, and every derived value is a pure function of
 * (declaration, environment behavior, policy behavior).
 */

import {
  appendRunEpisode,
  appendTrajectoryStep,
  appendTrainerTrial,
  createEpisodeDriver,
  createTrajectory,
  deepFreeze,
  driverAct,
  driverAdvance,
  driverFinish,
  driverObserve,
  driverStart,
  fail,
  isTrainingRunState,
  ok,
  prepareTrainingRun,
  validateTrainingRunLineage,
  validateTrialRecord,
  type AgentInstanceId,
  type BodyVersionRef,
  type DataRef,
  type EpisodeId,
  type EnvironmentPort,
  type PolicyPort,
  type RLResult,
  type RewardAnnotatedTrajectory,
  type RewardModel,
  type RewardModelRef,
  type RuntimeRef,
  type SubstrateRef,
  type TimestampMs,
  type TrainerContract,
  type TrainerTrial,
  type Trajectory,
  type TrialEvidence,
  type TrialLog,
  type TrainingRunState,
} from '../../../../packages/rl-protocol/src/index';
import {
  attachRewardSignals,
  deriveEnvironmentConfigRef,
  deriveTrajectoryId,
  requirePorts,
  validateProposals,
  type DriverState,
  type PolicyProposal,
} from '../../../../packages/rl-protocol/src/index';

// ---------------------------------------------------------------------------
// The trainer configuration
// ---------------------------------------------------------------------------

/**
 * The reference trainer's configuration: the acting agent instance, the
 * step cadence (epoch-ms per driving step), and the L9 lineage context the
 * assembled trajectories bind (runtime ref, body versions, substrates —
 * the producer sets the trajectory metadata law requires — and datasets).
 */
export interface ReferenceTrainerOptions {
  readonly actor: AgentInstanceId;
  /** Positive safe integer of epoch milliseconds per driving step. */
  readonly step_ms: number;
  readonly runtime: RuntimeRef;
  /** Non-empty: an experience stream has producers (the trajectory law). */
  readonly body_versions: readonly BodyVersionRef[];
  /** Non-empty: bodies run on substrates (the trajectory law). */
  readonly substrates: readonly SubstrateRef[];
  /** Dataset refs the runs consume (may be empty). */
  readonly data?: readonly DataRef[];
}

/** Runtime guard for the reference trainer options. */
export function isReferenceTrainerOptions(value: unknown): value is ReferenceTrainerOptions {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.actor !== 'string' || candidate.actor.length === 0) return false;
  if (typeof candidate.step_ms !== 'number' || !Number.isSafeInteger(candidate.step_ms) || candidate.step_ms < 1) return false;
  if (typeof candidate.runtime !== 'string' || candidate.runtime.length === 0) return false;
  if (!Array.isArray(candidate.body_versions) || candidate.body_versions.length === 0) return false;
  if (!(candidate.body_versions as readonly unknown[]).every((ref) => typeof ref === 'string' && ref.length > 0)) return false;
  if (!Array.isArray(candidate.substrates) || candidate.substrates.length === 0) return false;
  if (!(candidate.substrates as readonly unknown[]).every((ref) => typeof ref === 'string' && ref.length > 0)) return false;
  if (candidate.data !== undefined && !Array.isArray(candidate.data)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The reference trainer
// ---------------------------------------------------------------------------

/** The reference trainer: the TrainerContract plus the record/annotate/emit surface. */
export interface ReferenceTrainer extends TrainerContract {
  /** Assemble the canonical trajectory of one driven episode of the run. */
  episodeTrajectory(run: TrainingRunState, episode: EpisodeId): RLResult<Trajectory>;
  /** Apply the run's declared reward models POST-HOC to one episode's trajectory (L7). */
  annotateEpisode(run: TrainingRunState, episode: EpisodeId, models: readonly RewardModel[]): RLResult<RewardAnnotatedTrajectory>;
  /** The trainer's append-only trial log (L11 — nothing is ever removed). */
  readonly trialLog: () => TrialLog;
}

/**
 * Create the reference deterministic trainer from untrusted options
 * (collect-all validation; the producer sets must be non-empty — the
 * trajectory metadata lineage law).
 */
export function createReferenceTrainer(options: unknown): RLResult<ReferenceTrainer> {
  if (!isReferenceTrainerOptions(options)) {
    return fail('invalid_type', 'the reference trainer requires { actor, step_ms, runtime, body_versions (non-empty), substrates (non-empty), data? }');
  }
  const context: ReferenceTrainerOptions = options;
  const data: readonly DataRef[] = context.data ?? [];
  let log: TrialLog = deepFreeze({ entries: [] });

  const buildTrajectory = (run: TrainingRunState, episode: EpisodeId): RLResult<Trajectory> => {
    const line = run.episodes.find((candidate) => candidate.episode === episode);
    if (line === undefined) {
      return fail('invalid_lineage', `episode ${episode} is not recorded in run ${run.declaration.run_id} — the trajectory binds RECORDED experience (L9)`);
    }
    const trajectoryId = deriveTrajectoryId(run.declaration.run_id, episode);
    let record = createTrajectory(
      {
        trajectory_id: trajectoryId,
        tenant: run.declaration.tenant,
        project: run.declaration.project,
        episode,
        environment_config: deriveEnvironmentConfigRef(run.declaration.environment_spec),
        runtime: context.runtime,
        data: [...data],
        body_versions: [...context.body_versions],
        substrates: [...context.substrates],
      },
      [],
    );
    if (!record.ok) return record;
    for (const step of line.steps) {
      const appended = appendTrajectoryStep(record.value, step);
      if (!appended.ok) return appended;
      record = appended;
    }
    return record;
  };

  const trainer: ReferenceTrainer = {
    prepareRun(declaration: unknown): RLResult<TrainingRunState> {
      // Delegates to the protocol: validation (method taxonomy, L12 tenant/
      // project, budget/seed laws) plus the fresh declared state.
      return prepareTrainingRun(declaration);
    },

    driveEpisode(run: TrainingRunState, environment: EnvironmentPort, policy: PolicyPort): RLResult<TrainingRunState> {
      if (!isTrainingRunState(run)) {
        return fail('invalid_run_state', 'driveEpisode requires a valid training run state');
      }
      const ports = requirePorts(environment, policy);
      if (!ports.ok) return ports;
      if (run.status === 'finished') {
        return fail('run_finished', `run ${run.declaration.run_id} is finished; start a new run (the log is frozen)`);
      }
      const remaining = run.declaration.step_budget - run.steps_used;
      if (remaining === 0) {
        return fail('budget_exhausted', `run ${run.declaration.run_id} exhausted its step budget of ${run.declaration.step_budget}; finish it and emit the trial evidence`);
      }

      // One driver per episode: deterministic id minting derives from the
      // run's seed, so the same (world script, seed) logs identically.
      const driverInit = createEpisodeDriver({ seed: run.declaration.seed, step_budget: remaining, actor: context.actor });
      if (!driverInit.ok) return driverInit;
      let state: DriverState = driverInit.value;
      const started = driverStart(state, environment, run.declaration.environment_spec);
      if (!started.ok) return started;
      state = started.value;

      // The generic deterministic loop: observe -> propose -> act -> advance
      // until the clock reaches asOf, the budget runs out, or the world
      // finishes the episode itself (the driver adopts terminal worlds).
      while (state.status === 'running') {
        const now = (state.clock as { readonly now: TimestampMs }).now;
        const asOf = (state.clock as { readonly asOf: TimestampMs }).asOf;
        if ((now as number) >= (asOf as number)) break;
        if (state.budget === 0) break;

        const observed = driverObserve(state, environment, now);
        if (!observed.ok) return observed;
        state = observed.value;

        const proposalsResult = policy.propose({
          episode_id: state.episode as EpisodeId,
          step: state.steps.length + 1,
          now,
          observations: state.delivered,
        });
        const proposals = validateProposals(proposalsResult);
        if (!proposals.ok) return proposals;
        const acted = driverAct(state, environment, proposals.value as readonly PolicyProposal[]);
        if (!acted.ok) return acted;
        state = acted.value;

        const target = (Math.min((now as number) + context.step_ms, asOf as number)) as TimestampMs;
        const advanced = driverAdvance(state, environment, target);
        if (!advanced.ok) return advanced;
        state = advanced.value;
      }

      if (state.status === 'running') {
        const code = state.budget === 0 ? 'step_limit' : 'completed';
        const detail =
          code === 'step_limit'
            ? `step budget of ${remaining} exhausted at now=${(state.clock as { readonly now: number }).now}`
            : `clock reached asOf=${(state.clock as { readonly asOf: number }).asOf} after ${state.steps.length} recorded step${state.steps.length === 1 ? '' : 's'}`;
        const finished = driverFinish(state, environment, { code, detail });
        if (!finished.ok) return finished;
        state = finished.value;
      }

      // Record: the episode's closed steps append to the run (chain folded).
      return appendRunEpisode(run, state.episode as EpisodeId, state.steps);
    },

    collectTrial(run: TrainingRunState, evidence: TrialEvidence): RLResult<TrainerTrial> {
      if (!isTrainingRunState(run)) {
        return fail('invalid_run_state', 'collectTrial requires a valid training run state');
      }
      if (run.status !== 'finished') {
        return fail('run_not_finished', `run ${run.declaration.run_id} is ${run.status}; terminal evidence binds a FINISHED run`);
      }
      if (typeof evidence !== 'object' || evidence === null) {
        return fail('invalid_trial', 'collectTrial requires trial evidence');
      }
      const episode = evidence.episode;
      const line = run.episodes.find((candidate) => candidate.episode === episode);
      if (line === undefined) {
        return fail('invalid_lineage', `the trial names episode ${String(episode)} which run ${run.declaration.run_id} never drove (L9 — evidence binds recorded experience)`);
      }
      const expectedTrajectory = deriveTrajectoryId(run.declaration.run_id, episode);
      if (evidence.trajectory !== expectedTrajectory) {
        return fail(
          'invalid_lineage',
          `the trial's trajectory ref "${String(evidence.trajectory)}" does not resolve to the run's derived ref "${expectedTrajectory}" (L9)`,
        );
      }

      // The trial record: failures are RECORDS, not exceptions.
      const status = evidence.failure_reason !== null ? 'failed' : 'succeeded';
      const trial = validateTrialRecord({
        trial_id: evidence.trial_id,
        arm: evidence.arm,
        status,
        trajectory: evidence.trajectory,
        outcome: evidence.outcome,
        started_at: evidence.started_at,
        ended_at: evidence.ended_at,
        failure_reason: status === 'failed' ? evidence.failure_reason : null,
      });
      if (!trial.ok) return trial;

      // The L9 lineage: run + method + scope + trajectory + env config +
      // reward-model refs + the WORLD's run record (config hash, chain
      // head, spec hash, digest — extracted from the untrusted record).
      const lineage = validateTrainingRunLineage({
        run_id: run.declaration.run_id,
        method: run.declaration.method,
        tenant: run.declaration.tenant,
        project: run.declaration.project,
        trajectory: expectedTrajectory,
        environment_config: deriveEnvironmentConfigRef(run.declaration.environment_spec),
        reward_models: run.declaration.reward_models,
        world: evidence.world_record,
      });
      if (!lineage.ok) return lineage;

      // Emit: append into the trainer's log — the L11 gate (duplicate or
      // rewrite refuses with trial_rewrite; the emission is atomic).
      const appended = appendTrainerTrial(log, { trial: trial.value, lineage: lineage.value });
      if (!appended.ok) return appended;
      log = appended.value;
      return ok(appended.value.entries[appended.value.entries.length - 1] as TrainerTrial);
    },

    episodeTrajectory(run: TrainingRunState, episode: EpisodeId): RLResult<Trajectory> {
      if (!isTrainingRunState(run)) {
        return fail('invalid_run_state', 'episodeTrajectory requires a valid training run state');
      }
      return buildTrajectory(run, episode);
    },

    annotateEpisode(run: TrainingRunState, episode: EpisodeId, models: readonly RewardModel[]): RLResult<RewardAnnotatedTrajectory> {
      const record = buildTrajectory(run, episode);
      if (!record.ok) return record;
      // The declaration is the reward-model contract: applying a model the
      // run did not declare is a lineage incoherence (reward_model_mismatch).
      for (const model of models) {
        if (!run.declaration.reward_models.includes(model.model_ref as RewardModelRef)) {
          return fail(
            'reward_model_mismatch',
            `reward model "${String(model.model_ref)}" is not declared by run ${run.declaration.run_id} — the declaration is the L9/L7 contract`,
          );
        }
      }
      return attachRewardSignals(record.value, models);
    },

    trialLog: () => log,
  };

  return ok(trainer);
}
