/**
 * @tradrl/rl-protocol — the TrainingRunProtocol (L9/L12).
 *
 * A training run is the LEARNING-LOOP's "training" half made auditable
 * (spec/LEARNING-LOOP.md: "training -> trajectory -> evaluation ->
 * verification"):
 *
 *   - {@link TrainingRunDeclaration} — the run declaration: the closed
 *     LEARNING-LOOP method, the environment spec mirror the run drives, the
 *     reward-model refs whose models attach post-hoc (L7), the step budget,
 *     the deterministic seed, and the tenant/project lineage (L12/L15 —
 *     every record carries TenantId + ProjectId).
 *   - {@link TrainingRunState} — the append-only run state: the declaration
 *     plus, per driven episode, the closed step log (the T011 mirror) and
 *     the RUN STEP CHAIN — an FNV-1a digest chain seeded from the
 *     declaration's canonical JSON and folded over every recorded step in
 *     order (the market-world ingest-chain discipline). The chain binds
 *     declaration + every step; a run resumed from bytes provably consumed
 *     the same experience (`chain_mismatch` is typed).
 *   - {@link TrainingRunLineage} — the L9 lineage block bound at trial
 *     emission: the trajectory ref, the environment config ref, the
 *     reward-model refs, the method — plus the WORLD's run record mirror
 *     (config hash, chain head, spec hash, digest — the fields of T009's
 *     `ReplayRunRecord` that T011/T012 bind too, per
 *     services/market-world/README.md's T013 consumption contract).
 *
 * There is no wall-clock anywhere: the run's time axis is the episodes'
 * simulated clocks; `started_at`/`ended_at` on trial evidence are EXPLICIT
 * parameters (byte-determinism of serialization).
 */

import { canonicalJson, deepFreeze, isNonEmptyString, isPositiveSafeInteger, isRecord } from './primitives';
import type { JsonValue } from './primitives';
import { fnv1a32Hex } from './primitives';
import { fail, invalidField, invalidType, missingField, ok, type RLError, type RLResult } from './errors';
import { isLearningMethod, type LearningMethod } from './method';
import type {
  EnvironmentConfigRef,
  EpisodeId,
  ProjectId,
  RewardModelRef,
  Seed,
  TenantId,
  TrainingRunId,
  TrajectoryId,
} from './ids';
import {
  isEnvironmentConfigRef,
  isEpisodeId,
  isProjectId,
  isRewardModelRef,
  isSeed,
  isTenantId,
  isTrainingRunId,
  isTrajectoryId,
} from './ids';
import type { EnvironmentSpec } from './env-mirror';
import { canonicalSpecJson, specTree, validateEnvironmentSpec } from './env-mirror';
import type { TerminationReason } from './env-mirror';
import { isTerminationReason } from './env-mirror';
import type { TrajectoryStep } from './traj-mirror';
import { isTrajectoryStep, validateTrajectoryStep } from './traj-mirror';
import { stepDigest } from './driver';

// ---------------------------------------------------------------------------
// The run declaration
// ---------------------------------------------------------------------------

/**
 * The training run declaration (see module header). Every field is
 * guard-checked; the method must be a member of the closed LEARNING-LOOP
 * taxonomy (`method_unknown` otherwise); tenant and project are REQUIRED
 * (L12/L15 — a run without an isolation scope and continuity root is a
 * lineage hole, negative-tested).
 */
export interface TrainingRunDeclaration {
  readonly run_id: TrainingRunId;
  /** The closed LEARNING-LOOP method taxonomy member (spec/LEARNING-LOOP.md). */
  readonly method: LearningMethod;
  /** The environment spec mirror the run's episodes drive (exact T005 shape). */
  readonly environment_spec: EnvironmentSpec;
  /** The reward models whose transforms attach post-hoc (L7; may be empty for non-reward methods). */
  readonly reward_models: readonly RewardModelRef[];
  /** The total step budget across all episodes (positive safe integer). */
  readonly step_budget: number;
  /** The deterministic seed (id minting derives from it — L9). */
  readonly seed: Seed;
  /** Tenant scope (L12). */
  readonly tenant: TenantId;
  /** Project continuity root (L15). */
  readonly project: ProjectId;
}

/** Runtime guard for a training run declaration. */
export function isTrainingRunDeclaration(value: unknown): value is TrainingRunDeclaration {
  if (!isRecord(value)) return false;
  if (!isTrainingRunId(value.run_id)) return false;
  if (!isLearningMethod(value.method)) return false;
  if (typeof (value as Record<string, unknown>).environment_spec !== 'object' || value.environment_spec === null) return false;
  if (!Array.isArray(value.reward_models)) return false;
  if (!(value.reward_models as readonly unknown[]).every((ref) => isRewardModelRef(ref))) return false;
  if ((value.reward_models as readonly unknown[]).some((ref, index, all) => all.indexOf(ref) !== index)) return false;
  if (!isPositiveSafeInteger(value.step_budget)) return false;
  if (!isSeed(value.seed)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted run declaration. On success the
 * value is returned narrowed, deeply frozen.
 */
export function validateTrainingRunDeclaration(value: unknown, path = 'declaration'): RLResult<TrainingRunDeclaration> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: RLError[] = [];

  if (value.run_id === undefined) {
    errors.push(missingField(`${path}.run_id`));
  } else if (!isTrainingRunId(value.run_id)) {
    errors.push(invalidField(`${path}.run_id`, 'must be a non-empty training run id'));
  }

  if (value.method === undefined) {
    errors.push(missingField(`${path}.method`));
  } else if (!isLearningMethod(value.method)) {
    errors.push({
      code: 'method_unknown',
      path: `${path}.method`,
      message: `"${String(value.method)}" is not a member of the closed LEARNING-LOOP method taxonomy (rl | offline_rl | supervised | imitation | preference_optimization | bandits | self_play | adversarial | population_search)`,
    });
  }

  let spec: EnvironmentSpec | undefined;
  if (value.environment_spec === undefined) {
    errors.push(missingField(`${path}.environment_spec`));
  } else {
    const specResult = validateEnvironmentSpec(value.environment_spec, `${path}.environment_spec`);
    if (specResult.ok) {
      spec = specResult.value;
    } else {
      errors.push(...specResult.errors);
    }
  }

  if (value.reward_models === undefined) {
    errors.push(missingField(`${path}.reward_models`));
  } else if (!Array.isArray(value.reward_models)) {
    errors.push(invalidField(`${path}.reward_models`, 'must be an array of versioned reward model refs (may be empty — L7)'));
  } else {
    const refs = value.reward_models as readonly unknown[];
    refs.forEach((ref, index) => {
      if (!isRewardModelRef(ref)) {
        errors.push(invalidField(`${path}.reward_models[${index}]`, 'must be a non-empty versioned reward model ref'));
      }
    });
    if (refs.some((ref, index) => refs.indexOf(ref) !== index)) {
      errors.push(invalidField(`${path}.reward_models`, 'must be duplicate-free — one model, one ref'));
    }
  }

  if (value.step_budget === undefined) {
    errors.push(missingField(`${path}.step_budget`));
  } else if (!isPositiveSafeInteger(value.step_budget)) {
    errors.push(invalidField(`${path}.step_budget`, 'must be a positive safe integer (the run-wide step budget)'));
  }

  if (value.seed === undefined) {
    errors.push(missingField(`${path}.seed`));
  } else if (!isSeed(value.seed)) {
    errors.push(invalidField(`${path}.seed`, 'must be a non-empty deterministic seed'));
  }

  if (value.tenant === undefined) {
    errors.push(missingField(`${path}.tenant`));
  } else if (!isTenantId(value.tenant)) {
    errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12 — tenant isolation)'));
  }

  if (value.project === undefined) {
    errors.push(missingField(`${path}.project`));
  } else if (!isProjectId(value.project)) {
    errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15 — project continuity)'));
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      run_id: value.run_id as TrainingRunId,
      method: value.method as LearningMethod,
      environment_spec: spec as EnvironmentSpec,
      reward_models: (value.reward_models as readonly RewardModelRef[]).slice(),
      step_budget: value.step_budget as number,
      seed: value.seed as Seed,
      tenant: value.tenant as TenantId,
      project: value.project as ProjectId,
    }),
  );
}

// ---------------------------------------------------------------------------
// The run state (append-only across episodes)
// ---------------------------------------------------------------------------

/** The run lifecycle: declared (fresh), driving (episodes driven), finished. */
export type TrainingRunStatus = 'declared' | 'driving' | 'finished';

/** One driven episode's line in the run state: the episode id and its closed step log. */
export interface RunEpisode {
  readonly episode: EpisodeId;
  /** The episode's step log — ordinals strictly sequential from 1 WITHIN the episode. */
  readonly steps: readonly TrajectoryStep[];
}

/** Runtime guard for a run episode line. */
export function isRunEpisode(value: unknown): value is RunEpisode {
  if (!isRecord(value)) return false;
  if (!isEpisodeId(value.episode)) return false;
  if (!Array.isArray(value.steps)) return false;
  if (!(value.steps as readonly unknown[]).every((step) => isTrajectoryStep(step))) return false;
  return true;
}

/**
 * The append-only training run state (see module header). `step_chain` holds
 * one digest head per RECORDED step across all episodes, in record order —
 * seeded from the declaration chain seed, folded per step
 * (`fnv1a32(prev + ':' + digest)`), the market-world ingest-chain
 * discipline. `steps_used` is the total recorded steps; `termination` is
 * non-null iff finished.
 */
export interface TrainingRunState {
  readonly declaration: TrainingRunDeclaration;
  readonly status: TrainingRunStatus;
  /** Driven episodes, in drive order (unique ids — one line per episode). */
  readonly episodes: readonly RunEpisode[];
  /** Digest head after each recorded step, across all episodes, in order. */
  readonly step_chain: readonly string[];
  /** Total recorded steps across all episodes. */
  readonly steps_used: number;
  readonly termination: TerminationReason | null;
}

/** Runtime guard for a training run state (shape-level; chain content is verifyRunChain's). */
export function isTrainingRunState(value: unknown): value is TrainingRunState {
  if (!isRecord(value)) return false;
  if (!isTrainingRunDeclaration(value.declaration)) return false;
  if (value.status !== 'declared' && value.status !== 'driving' && value.status !== 'finished') return false;
  if (!Array.isArray(value.episodes)) return false;
  if (!(value.episodes as readonly unknown[]).every((line) => isRunEpisode(line))) return false;
  if ((value.episodes as readonly RunEpisode[]).some((line, index, all) => all.findIndex((other) => other.episode === line.episode) !== index))
    return false;
  if (!Array.isArray(value.step_chain)) return false;
  if (!(value.step_chain as readonly unknown[]).every((head) => typeof head === 'string' && head.length === 8)) return false;
  if (typeof value.steps_used !== 'number' || !Number.isSafeInteger(value.steps_used) || value.steps_used < 0) return false;
  if (value.termination !== null && !isTerminationReason(value.termination)) return false;
  if (value.status === 'finished' && value.termination === null) return false;
  if (value.status !== 'finished' && value.termination !== null) return false;
  const total = (value.episodes as readonly RunEpisode[]).reduce((sum, line) => sum + line.steps.length, 0);
  if (total !== value.steps_used) return false;
  if ((value.step_chain as readonly unknown[]).length !== total) return false;
  return true;
}

/** The declaration chain seed: folds the canonical declaration JSON (binds the whole declaration — L9). */
export function declarationChainSeed(declaration: TrainingRunDeclaration): string {
  return fnv1a32Hex(canonicalJson(declarationTree(declaration)));
}

/** JSON-tree projection of a run declaration (compile-proven JSON safety, no casts). */
export function declarationTree(declaration: TrainingRunDeclaration): JsonValue {
  return {
    run_id: declaration.run_id,
    method: declaration.method,
    environment_spec: specTree(declaration.environment_spec),
    reward_models: [...declaration.reward_models],
    step_budget: declaration.step_budget,
    seed: declaration.seed,
    tenant: declaration.tenant,
    project: declaration.project,
  };
}

/**
 * Prepare a fresh run from an untrusted declaration: validate (collect-all),
 * derive the chain seed, return the `declared` state with an empty log. The
 * ONLY way to grow the log is {@link appendRunEpisode}; the only way to
 * close the run is {@link finishTrainingRun} (append-only discipline — L11).
 */
export function prepareTrainingRun(declaration: unknown): RLResult<TrainingRunState> {
  const declarationResult = validateTrainingRunDeclaration(declaration);
  if (!declarationResult.ok) return declarationResult;
  return ok(
    deepFreeze({
      declaration: declarationResult.value,
      status: 'declared',
      episodes: [],
      step_chain: [],
      steps_used: 0,
      termination: null,
    }),
  );
}

/**
 * Append one driven episode's closed steps to the run (the ONLY log-growing
 * operation). Laws:
 *   1. the run is not finished (`run_finished`);
 *   2. the episode id is new (`duplicate_episode`);
 *   3. every step passes the canonical step validator (collect-all detail);
 *   4. the episode's ordinals are strictly sequential from 1
 *      (`step_out_of_order`) and its clock is monotonic
 *      (`clock_regression`) — the trajectory cross-step laws, per episode;
 *   5. step/causality/observation/action/reward ids are unique WITHIN the
 *      episode line (the env-protocol identity discipline: ids name
 *      experience events of ONE episode; across episodes the identity
 *      scope resets with the world's own minting);
 *   6. the appended steps may not exceed the run's step budget
 *      (`budget_exhausted`).
 * Returns a NEW state with the episode line appended and the step chain
 * folded over the new steps (seeded from the declaration seed at run start).
 */
export function appendRunEpisode(state: TrainingRunState, episode: unknown, steps: readonly unknown[]): RLResult<TrainingRunState> {
  if (!isTrainingRunState(state)) {
    return fail('invalid_run_state', 'appendRunEpisode requires a valid training run state');
  }
  if (state.status === 'finished') {
    return fail('run_finished', `run ${state.declaration.run_id} is finished (${state.termination?.code ?? 'unknown'}); the log is frozen`);
  }
  if (!isEpisodeId(episode)) {
    return fail('invalid_field', 'appendRunEpisode requires a non-empty episode id', 'episode');
  }
  if (state.episodes.some((line) => line.episode === episode)) {
    return fail('duplicate_episode', `episode ${episode} is already recorded in run ${state.declaration.run_id}`);
  }
  if (!Array.isArray(steps)) {
    return fail('invalid_field', 'appendRunEpisode requires an array of closed steps', 'steps');
  }
  if (state.steps_used + steps.length > state.declaration.step_budget) {
    return fail(
      'budget_exhausted',
      `appending ${steps.length} steps would exceed the run's step budget of ${state.declaration.step_budget} (${state.steps_used} already recorded)`,
    );
  }

  const validated: TrajectoryStep[] = [];
  // Identity scope: PER EPISODE (the env-protocol law — ids name experience
  // events of one episode; a second episode's world mints its own ids).
  const seenStepIds = new Set<string>();
  const seenCausalityIds = new Set<string>();
  const seenObservationIds = new Set<string>();
  const seenActionIds = new Set<string>();
  const seenRewardIds = new Set<string>();

  let previousNow: number | undefined;
  for (let index = 0; index < steps.length; index++) {
    const stepResult = validateTrajectoryStep(steps[index], `steps[${index}]`);
    if (!stepResult.ok) return stepResult;
    const step = stepResult.value;

    if (step.step !== index + 1) {
      return fail(
        'step_out_of_order',
        `episode ${episode}: step at index ${index} carries ordinal ${step.step}; expected ${index + 1} (episode ordinals are strictly sequential from 1)`,
        `steps[${index}].step`,
      );
    }
    if (seenStepIds.has(step.step_id)) {
      return fail('duplicate_step', `step id "${step.step_id}" is already recorded in episode ${episode}`, `steps[${index}].step_id`);
    }
    if (seenCausalityIds.has(step.causality_id)) {
      return fail('duplicate_step', `causality id "${step.causality_id}" is already recorded in episode ${episode}`, `steps[${index}].causality_id`);
    }
    if (previousNow !== undefined && step.clock.now < previousNow) {
      return fail(
        'clock_regression',
        `episode ${episode}: step ${step.step} clock.now (${step.clock.now}) precedes the previous step's now (${previousNow})`,
        `steps[${index}].clock.now`,
      );
    }
    previousNow = step.clock.now;
    for (const observation of step.observations) {
      if (seenObservationIds.has(observation.observation_id)) {
        return fail('duplicate_observation', `observation id "${observation.observation_id}" is already recorded in episode ${episode}`, `steps[${index}].observations`);
      }
      seenObservationIds.add(observation.observation_id);
    }
    for (const action of step.actions) {
      if (seenActionIds.has(action.action_id)) {
        return fail('duplicate_action', `action id "${action.action_id}" is already recorded in episode ${episode}`, `steps[${index}].actions`);
      }
      seenActionIds.add(action.action_id);
    }
    for (const rejection of step.rejections) {
      if (seenActionIds.has(rejection.action.action_id)) {
        return fail('duplicate_action', `action id "${rejection.action.action_id}" is already recorded in run ${state.declaration.run_id}`, `steps[${index}].rejections`);
      }
      seenActionIds.add(rejection.action.action_id);
    }
    for (const reward of step.rewards) {
      if (seenRewardIds.has(reward.reward_id)) {
        return fail('duplicate_reward', `reward id "${reward.reward_id}" is already recorded in episode ${episode}`, `steps[${index}].rewards`);
      }
      seenRewardIds.add(reward.reward_id);
    }
    seenStepIds.add(step.step_id);
    seenCausalityIds.add(step.causality_id);
    validated.push(step);
  }

  // Fold the chain over the new steps (seeded at the run's current head).
  let head = state.step_chain.length === 0 ? declarationChainSeed(state.declaration) : (state.step_chain[state.step_chain.length - 1] as string);
  const chain = [...state.step_chain];
  for (const step of validated) {
    head = fnv1a32Hex(`${head}:${stepDigest(step)}`);
    chain.push(head);
  }

  return ok(
    deepFreeze({
      ...state,
      status: 'driving',
      episodes: [...state.episodes, deepFreeze({ episode, steps: validated })],
      step_chain: chain,
      steps_used: state.steps_used + validated.length,
    }),
  );
}

/**
 * Finish the run (once-only — `run_finished` on repetition). The termination
 * reason must be valid; the log is frozen from here on.
 */
export function finishTrainingRun(state: TrainingRunState, reason: unknown): RLResult<TrainingRunState> {
  if (!isTrainingRunState(state)) {
    return fail('invalid_run_state', 'finishTrainingRun requires a valid training run state');
  }
  if (state.status === 'finished') {
    return fail('run_finished', `run ${state.declaration.run_id} is already finished (double-finish is a typed error)`);
  }
  if (!isTerminationReason(reason)) {
    return fail('invalid_termination', 'finish requires { code: completed|terminal|step_limit|aborted, detail: non-empty string }');
  }
  return ok(deepFreeze({ ...state, status: 'finished', termination: reason }));
}

/**
 * Verify the run's step chain: recompute the declaration seed and fold every
 * recorded step in order, comparing heads. A tampered or partial serialized
 * state fails with `chain_mismatch` — a resumed run PROVABLY consumed the
 * same experience (the resume gate of the run-state serializer).
 */
export function verifyRunChain(state: TrainingRunState): RLResult<true> {
  if (!isTrainingRunState(state)) {
    return fail('invalid_run_state', 'verifyRunChain requires a valid training run state');
  }
  let head = declarationChainSeed(state.declaration);
  let count = 0;
  for (const line of state.episodes) {
    for (const step of line.steps) {
      head = fnv1a32Hex(`${head}:${stepDigest(step)}`);
      const expected = state.step_chain[count];
      if (expected !== head) {
        return fail(
          'chain_mismatch',
          `run ${state.declaration.run_id}: step chain head ${count} is "${String(expected)}" but the recorded steps fold to "${head}" — the log was tampered with or truncated`,
        );
      }
      count += 1;
    }
  }
  if (count !== state.step_chain.length) {
    return fail(
      'chain_mismatch',
      `run ${state.declaration.run_id}: the chain records ${state.step_chain.length} heads but the episodes carry ${count} steps`,
    );
  }
  return ok(true);
}

// ---------------------------------------------------------------------------
// The L9 lineage block (the ReplayRunRecord mirror)
// ---------------------------------------------------------------------------

/**
 * The WORLD's run record mirror — the four L9 fields the replay world (and,
 * structurally, every world with a run record) binds and T011/T012/T013 all
 * consume (services/market-world/README.md, T013 row): the world config
 * hash, the ingest-chain head, the episode spec hash, and the record's own
 * digest. Extracted from a ReplayRunRecord-SHAPED value (untrusted — never
 * imported).
 */
export interface WorldLineage {
  readonly config_hash: string;
  readonly chain_head: string;
  readonly spec_hash: string;
  readonly digest: string;
}

/** Runtime guard for a world lineage block. */
export function isWorldLineage(value: unknown): value is WorldLineage {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.config_hash) &&
    isNonEmptyString(value.chain_head) &&
    isNonEmptyString(value.spec_hash) &&
    isNonEmptyString(value.digest)
  );
}

/**
 * Extract the world lineage from an untrusted ReplayRunRecord-shaped value
 * (`{ world: { config_hash }, episode: { spec_hash }, ingestion:
 * { chain_head }, digest }` — the structural mirror, no import). A missing
 * field is a typed `lineage_gap` (L9 — the run record is the lineage
 * anchor; a gap is a hole, not a default).
 */
export function extractWorldLineage(value: unknown, path = 'world_record'): RLResult<WorldLineage> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be a ReplayRunRecord-shaped object`)] };
  }
  const errors: RLError[] = [];
  const world = value.world;
  const episode = value.episode;
  const ingestion = value.ingestion;

  if (!isRecord(world)) {
    errors.push({ code: 'lineage_gap', path: `${path}.world`, message: 'the world block is missing (L9 — the run record binds it)' });
  } else if (!isNonEmptyString(world.config_hash)) {
    errors.push({ code: 'lineage_gap', path: `${path}.world.config_hash`, message: 'the world config hash is missing (L9)' });
  }
  if (!isRecord(episode)) {
    errors.push({ code: 'lineage_gap', path: `${path}.episode`, message: 'the episode block is missing (L9)' });
  } else if (!isNonEmptyString(episode.spec_hash)) {
    errors.push({ code: 'lineage_gap', path: `${path}.episode.spec_hash`, message: 'the episode spec hash is missing (L9)' });
  }
  if (!isRecord(ingestion)) {
    errors.push({ code: 'lineage_gap', path: `${path}.ingestion`, message: 'the ingestion block is missing (L9)' });
  } else if (!isNonEmptyString(ingestion.chain_head)) {
    errors.push({ code: 'lineage_gap', path: `${path}.ingestion.chain_head`, message: 'the ingest chain head is missing (L9)' });
  }
  if (!isNonEmptyString(value.digest)) {
    errors.push({ code: 'lineage_gap', path: `${path}.digest`, message: "the record's own digest is missing (L9)" });
  }
  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      config_hash: (world as Record<string, unknown>).config_hash as string,
      chain_head: (ingestion as Record<string, unknown>).chain_head as string,
      spec_hash: (episode as Record<string, unknown>).spec_hash as string,
      digest: value.digest as string,
    }),
  );
}

/**
 * The full L9 lineage block of a training run's emitted trial: the run id,
 * the method, the tenant/project scope (L12/L15), the trajectory ref, the
 * environment config ref, the reward-model refs, and the world's run record
 * mirror. EVERY field is required (a missing field is a typed `lineage_gap`
 * — negative-tested per field: config hash, chain head, spec hash, digest,
 * trajectory ref, reward-model refs, method, tenant, project).
 */
export interface TrainingRunLineage {
  readonly run_id: TrainingRunId;
  readonly method: LearningMethod;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly trajectory: TrajectoryId;
  readonly environment_config: EnvironmentConfigRef;
  readonly reward_models: readonly RewardModelRef[];
  readonly world: WorldLineage;
}

/** Runtime guard for a training run lineage block. */
export function isTrainingRunLineage(value: unknown): value is TrainingRunLineage {
  if (!isRecord(value)) return false;
  if (!isTrainingRunId(value.run_id)) return false;
  if (!isLearningMethod(value.method)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  if (!isTrajectoryId(value.trajectory)) return false;
  if (!isEnvironmentConfigRef(value.environment_config)) return false;
  if (!Array.isArray(value.reward_models)) return false;
  if (!(value.reward_models as readonly unknown[]).every((ref) => isRewardModelRef(ref))) return false;
  if (!isWorldLineage(value.world)) return false;
  return true;
}

/**
 * Collect-all validation of a training run lineage block. Every L9/L12/L15
 * field is enforced; the world block goes through
 * {@link extractWorldLineage}. On success the value is returned narrowed,
 * deeply frozen.
 */
export function validateTrainingRunLineage(value: unknown, path = 'lineage'): RLResult<TrainingRunLineage> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: RLError[] = [];

  if (value.run_id === undefined) {
    errors.push(missingField(`${path}.run_id`));
  } else if (!isTrainingRunId(value.run_id)) {
    errors.push(invalidField(`${path}.run_id`, 'must be a non-empty training run id (L9)'));
  }
  if (value.method === undefined) {
    errors.push(missingField(`${path}.method`));
  } else if (!isLearningMethod(value.method)) {
    errors.push({ code: 'method_unknown', path: `${path}.method`, message: 'the lineage must name a closed-taxonomy learning method' });
  }
  if (value.tenant === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.tenant`, message: 'the lineage tenant is missing (L12 — tenant isolation)' });
  } else if (!isTenantId(value.tenant)) {
    errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12)'));
  }
  if (value.project === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.project`, message: 'the lineage project is missing (L15 — project continuity)' });
  } else if (!isProjectId(value.project)) {
    errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15)'));
  }
  if (value.trajectory === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.trajectory`, message: 'the lineage trajectory ref is missing (L9 — the evidence binding)' });
  } else if (!isTrajectoryId(value.trajectory)) {
    errors.push(invalidField(`${path}.trajectory`, 'must be a non-empty trajectory ref (L9)'));
  }
  if (value.environment_config === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.environment_config`, message: 'the lineage environment config ref is missing (L9)' });
  } else if (!isEnvironmentConfigRef(value.environment_config)) {
    errors.push(invalidField(`${path}.environment_config`, 'must be a non-empty environment config ref (L9)'));
  }
  if (value.reward_models === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.reward_models`, message: 'the lineage reward-model refs are missing (L9 — the L7 declarations bound to this run)' });
  } else if (!Array.isArray(value.reward_models)) {
    errors.push(invalidField(`${path}.reward_models`, 'must be an array of reward model refs (may be empty — L7)' ));
  } else {
    (value.reward_models as readonly unknown[]).forEach((ref, index) => {
      if (!isRewardModelRef(ref)) {
        errors.push(invalidField(`${path}.reward_models[${index}]`, 'must be a non-empty reward model ref'));
      }
    });
  }
  let world: WorldLineage | undefined;
  if (value.world === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.world`, message: 'the world run record mirror is missing (L9 — config hash, chain head, spec hash, digest)' });
  } else if (isWorldLineage(value.world)) {
    // An already-extracted world lineage (a constructed record re-entering
    // validation — the emission round-trip) is accepted as-is.
    world = value.world;
  } else {
    const worldResult = extractWorldLineage(value.world, `${path}.world`);
    if (worldResult.ok) {
      world = worldResult.value;
    } else {
      errors.push(...worldResult.errors);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      run_id: value.run_id as TrainingRunId,
      method: value.method as LearningMethod,
      tenant: value.tenant as TenantId,
      project: value.project as ProjectId,
      trajectory: value.trajectory as TrajectoryId,
      environment_config: value.environment_config as EnvironmentConfigRef,
      reward_models: (value.reward_models as readonly RewardModelRef[]).slice(),
      world: world as WorldLineage,
    }),
  );
}

// ---------------------------------------------------------------------------
// Deterministic derivations (the L9 anchors)
// ---------------------------------------------------------------------------

/**
 * Derive the environment config ref from a validated spec:
 * `envcfg-<fnv1a32(canonicalSpecJson(spec))>` — the deterministic
 * content-hash discipline (the trajectory package's metadata adapter derives
 * the same identity).
 */
export function deriveEnvironmentConfigRef(spec: EnvironmentSpec): EnvironmentConfigRef {
  return `envcfg-${fnv1a32Hex(canonicalSpecJson(spec))}` as EnvironmentConfigRef;
}

/**
 * Derive the trajectory id of one driven episode of a run:
 * `traj-<fnv1a32(run_id|episode)>` — deterministic, so the trial's
 * trajectory ref and the assembled trajectory's metadata agree by
 * construction (L9).
 */
export function deriveTrajectoryId(run: TrainingRunId, episode: EpisodeId): TrajectoryId {
  return `traj-${fnv1a32Hex(`${run}|${episode}`)}` as TrajectoryId;
}
