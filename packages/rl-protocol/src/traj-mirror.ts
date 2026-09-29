/**
 * @tradrl/rl-protocol — the trajectory-lane structural mirrors (D-003/D-004).
 *
 * The bridge records experience into the CANONICAL record shape of
 * `@tradrl/trajectory` (T011) without importing it: every shape here is
 * field-for-field identical to its canonical owner's declaration, so the
 * bridge's step logs ARE trajectories in the canonical sense (the REAL
 * package's guards accept them — proven by src/interop.test.ts), and the
 * mirrors can never drift silently (type-level `toEqualTypeOf` witnesses
 * fail `pnpm typecheck` on divergence).
 *
 * What the mirrors mean for T013 (spec/DOMAIN-MODEL.md: Trajectory =
 * "Ordered observations, actions, events, rewards and tool outcomes with
 * lineage"; contracts/learning/02-experiment.md: "the RL bridge (T013)
 * consumes trial trajectories"):
 *
 *   - The episode driver's step log is a `readonly TrajectoryStep[]` — the
 *     atomic experience record, exactly as T011 defines it (observation refs
 *     with `available_time` as the L4 forensic input, accepted actions AND
 *     rejections — the full request history is experience — rewards the
 *     WORLD emitted, tool outcome refs, environment result ref, the clock
 *     sample, the causality id).
 *   - `appendTrajectoryStep` mirrors T011's append laws (ordinal
 *     continuity, id uniqueness, clock monotonicity) so a bridge-assembled
 *     trajectory satisfies the REAL `validateTrajectory` end-to-end.
 *   - The reward-annotated stream (reward.ts) EXTENDS
 *     {@link RewardSignalRecord} with `model_ref` — extension only, never
 *     mutation: annotated steps still satisfy the canonical step guard.
 */

import { deepFreeze, isFiniteNumber, isJsonObject, isJsonValue, isNonEmptyString, isRecord } from './primitives';
import type { JsonObject, JsonValue } from './primitives';
import { invalidField, invalidType, missingField, ok, type RLError, type RLResult } from './errors';
import { fail } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { FidelityMode, InformationPolicy } from './env-mirror';
import { isFidelityMode, isInformationPolicy } from './env-mirror';
import type {
  ActionId,
  AgentInstanceId,
  BodyVersionRef,
  CausalityId,
  DataRef,
  EnvironmentConfigRef,
  EnvironmentResultRef,
  EpisodeId,
  ObservationId,
  ProjectId,
  RewardId,
  RuntimeRef,
  StepId,
  SubstrateRef,
  TenantId,
  ToolOutcomeRef,
  TrajectoryId,
} from './ids';
import {
  isActionId,
  isAgentInstanceId,
  isBodyVersionRef,
  isCausalityId,
  isDataRef,
  isEnvironmentConfigRef,
  isEnvironmentResultRef,
  isEpisodeId,
  isObservationId,
  isProjectId,
  isRewardId,
  isRuntimeRef,
  isStepId,
  isSubstrateRef,
  isTenantId,
  isToolOutcomeRef,
  isTrajectoryId,
} from './ids';

// ---------------------------------------------------------------------------
// Clock sample (structural mirror of trajectory's step.ts, itself the mirror
// of time-engine's SimulationClock — DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/**
 * The clock sample of one step — exact mirror of `@tradrl/trajectory`'s
 * `ClockSample` (field-identical to T005's `ClockConfig`: the step is
 * self-contained forensic evidence). `now <= asOf` is enforced.
 */
export interface ClockSample {
  /** The simulated instant the step observed at (monotonic across steps). */
  readonly now: TimestampMs;
  /** Historical anchor: the latest instant the episode's information set covers. */
  readonly asOf: TimestampMs;
  /** Positive finite playback-speed multiplier in force (1 = real time). */
  readonly playbackSpeed: number;
  /** Whether automatic progression was suspended at this step. */
  readonly paused: boolean;
  /** World fidelity mode — one of the three distinct L5 modes. */
  readonly fidelity: FidelityMode;
  /** Information policy in force. */
  readonly informationPolicy: InformationPolicy;
}

/** Runtime guard for a structurally valid, invariant-abiding clock sample. */
export function isClockSample(value: unknown): value is ClockSample {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.now) || !isTimestampMs(value.asOf)) return false;
  if (value.now > value.asOf) return false;
  if (!isFiniteNumber(value.playbackSpeed) || value.playbackSpeed <= 0) return false;
  if (typeof value.paused !== 'boolean') return false;
  if (!isFidelityMode(value.fidelity)) return false;
  if (value.informationPolicy !== 'point-in-time') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Observation reference / action record / rejection record
// ---------------------------------------------------------------------------

/**
 * A delivered observation, recorded by reference — exact mirror of
 * `@tradrl/trajectory`'s `ObservationRef`. Carries the L4 forensic input
 * (`available_time`) so the trajectory supports leakage forensics without
 * dragging opaque payloads along (the bridge cannot read payloads — the
 * ObservationView law of env-mirror.ts).
 */
export interface ObservationRef {
  readonly observation_id: ObservationId;
  /** Earliest instant the observation may legitimately be seen (L4, inclusive). */
  readonly available_time: TimestampMs;
}

/** Runtime guard for an observation reference. */
export function isObservationRef(value: unknown): value is ObservationRef {
  if (!isRecord(value)) return false;
  return isObservationId(value.observation_id) && isTimestampMs(value.available_time);
}

/**
 * An accepted action request, recorded in full-but-opaque form — exact
 * mirror of `@tradrl/trajectory`'s `ActionRecord` (field-identical to T005's
 * `Action` envelope: requests, never authority — L8). The bridge MINTS
 * actions of exactly this shape when submitting policy proposals.
 */
export interface ActionRecord {
  readonly action_id: ActionId;
  /** The acting agent instance (opaque cross-lane reference). */
  readonly actor: AgentInstanceId;
  /** The instant the action claims submission at (`<= clock.now` at accept time). */
  readonly submitted_at: TimestampMs;
  /** Per-actor request ordinal; strictly increasing across the actor's accepted actions. */
  readonly client_sequence: number;
  /** The opaque request payload. */
  readonly payload: JsonValue;
}

/** Runtime guard for an action record. */
export function isActionRecord(value: unknown): value is ActionRecord {
  if (!isRecord(value)) return false;
  if (!isActionId(value.action_id)) return false;
  if (!isAgentInstanceId(value.actor)) return false;
  if (!isTimestampMs(value.submitted_at)) return false;
  if (typeof value.client_sequence !== 'number' || !Number.isSafeInteger(value.client_sequence) || value.client_sequence < 0)
    return false;
  if (!isJsonValue(value.payload)) return false;
  return true;
}

/** One typed rejection error — mirror of trajectory's `RejectionError` (foreign codes are plain strings). */
export interface RejectionError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/**
 * A rejected action request, with the environment's typed errors — mirror of
 * trajectory's `RejectionRecord`. The request history is experience;
 * nothing is pruned (L11's spirit: history is never lossy).
 */
export interface RejectionRecord {
  readonly action: ActionRecord;
  readonly errors: readonly RejectionError[];
}

/** Runtime guard for a rejection error. */
export function isRejectionError(value: unknown): value is RejectionError {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.code) && typeof value.path === 'string' && isNonEmptyString(value.message);
}

/** Runtime guard for a rejection record. */
export function isRejectionRecord(value: unknown): value is RejectionRecord {
  if (!isRecord(value)) return false;
  if (!isActionRecord(value.action)) return false;
  if (!Array.isArray(value.errors) || value.errors.length === 0) return false;
  return value.errors.every((error) => isRejectionError(error));
}

// ---------------------------------------------------------------------------
// Reward signal record (world-emitted channel — L7's "never fabricated" floor)
// ---------------------------------------------------------------------------

/**
 * A reward signal emitted by the WORLD during the recorded episode — exact
 * mirror of `@tradrl/trajectory`'s `RewardSignalRecord` (T005's RewardSignal
 * minus `episode_id`: the metadata owns the episode binding). OPTIONAL,
 * EXPLICIT, NEVER FABRICATED: this channel exists only because a world
 * emitted signals into it; the bridge's OWN rewards are RewardModelSignals
 * (reward.ts), a strictly EXTENDING shape.
 */
export interface RewardSignalRecord {
  readonly reward_id: RewardId;
  /** The instant the reward pertains to (the effect instant). */
  readonly at: TimestampMs;
  /** Earliest instant the signal may legitimately be observed (L4, inclusive; `>= at`). */
  readonly available_time: TimestampMs;
  /** Finite scalar; may be negative or zero. */
  readonly value: number;
  /** Opaque metric label (consumers attach semantics). */
  readonly metric: string;
  /** The world component that produced the signal (no orphan rewards). */
  readonly source: string;
  /** Optional structured detail. */
  readonly detail: JsonObject | null;
}

/** Runtime guard for a reward signal record. */
export function isRewardSignalRecord(value: unknown): value is RewardSignalRecord {
  if (!isRecord(value)) return false;
  if (!isRewardId(value.reward_id)) return false;
  if (!isTimestampMs(value.at) || !isTimestampMs(value.available_time)) return false;
  if (!isFiniteNumber(value.value)) return false;
  if (!isNonEmptyString(value.metric)) return false;
  if (!isNonEmptyString(value.source)) return false;
  if (value.detail !== null && !isJsonObject(value.detail)) return false;
  if ((value.available_time as number) < (value.at as number)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/** One atomic step of the experience stream — exact mirror of trajectory's `TrajectoryStep`. */
export interface TrajectoryStep {
  /** 1-based ordinal; steps append strictly in order. */
  readonly step: number;
  /** Trajectory-local opaque step identity (unique within the trajectory). */
  readonly step_id: StepId;
  /** Observation refs DELIVERED this step (the visible delta), in delivery order. */
  readonly observations: readonly ObservationRef[];
  /** Action requests ACCEPTED this step, in submission order. */
  readonly actions: readonly ActionRecord[];
  /** Action requests REJECTED this step, with the environment's typed errors. */
  readonly rejections: readonly RejectionRecord[];
  /** Reward signals the world emitted during this step. */
  readonly rewards: readonly RewardSignalRecord[];
  /** Opaque tool outcome refs recorded this step. */
  readonly tool_outcomes: readonly ToolOutcomeRef[];
  /** Opaque environment result ref (null when the producing runtime recorded none). */
  readonly environment_result: EnvironmentResultRef | null;
  /** The clock sample the step observed under. */
  readonly clock: ClockSample;
  /** The step's causal linkage id (unique within the trajectory). */
  readonly causality_id: CausalityId;
}

/** Runtime guard for a structurally valid trajectory step. */
export function isTrajectoryStep(value: unknown): value is TrajectoryStep {
  if (!isRecord(value)) return false;
  if (typeof value.step !== 'number' || !Number.isSafeInteger(value.step) || value.step < 1) return false;
  if (!isStepId(value.step_id)) return false;
  if (!Array.isArray(value.observations) || !value.observations.every((observation) => isObservationRef(observation)))
    return false;
  if (!Array.isArray(value.actions) || !value.actions.every((action) => isActionRecord(action))) return false;
  if (!Array.isArray(value.rejections) || !value.rejections.every((rejection) => isRejectionRecord(rejection)))
    return false;
  if (!Array.isArray(value.rewards) || !value.rewards.every((reward) => isRewardSignalRecord(reward))) return false;
  if (!Array.isArray(value.tool_outcomes) || !value.tool_outcomes.every((ref) => isToolOutcomeRef(ref))) return false;
  if (value.environment_result !== null && !isEnvironmentResultRef(value.environment_result)) return false;
  if (!isClockSample(value.clock)) return false;
  if (!isCausalityId(value.causality_id)) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted trajectory step — mirror of
 * trajectory's `validateTrajectoryStep` (every violation reported with a
 * dotted path; timeless — ordering laws live in the trajectory-level
 * validators). On success the value is returned narrowed, deeply frozen.
 */
export function validateTrajectoryStep(value: unknown, path = 'step'): RLResult<TrajectoryStep> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: RLError[] = [];

  if (value.step === undefined) {
    errors.push(missingField(`${path}.step`));
  } else if (typeof value.step !== 'number' || !Number.isSafeInteger(value.step) || value.step < 1) {
    errors.push(invalidField(`${path}.step`, 'must be a safe integer >= 1 (steps are 1-based ordinals)'));
  }

  if (value.step_id === undefined) {
    errors.push(missingField(`${path}.step_id`));
  } else if (!isStepId(value.step_id)) {
    errors.push(invalidField(`${path}.step_id`, 'must be a non-empty step id'));
  }

  if (value.observations === undefined) {
    errors.push(missingField(`${path}.observations`));
  } else if (!Array.isArray(value.observations)) {
    errors.push(invalidField(`${path}.observations`, 'must be an array of observation refs (may be empty)'));
  } else {
    (value.observations as readonly unknown[]).forEach((observation, index) => {
      if (!isObservationRef(observation)) {
        errors.push(invalidField(`${path}.observations[${index}]`, 'must be an observation ref (observation_id + available_time)'));
      }
    });
  }

  if (value.actions === undefined) {
    errors.push(missingField(`${path}.actions`));
  } else if (!Array.isArray(value.actions)) {
    errors.push(invalidField(`${path}.actions`, 'must be an array of accepted action records (may be empty)'));
  } else {
    (value.actions as readonly unknown[]).forEach((action, index) => {
      if (!isActionRecord(action)) {
        errors.push(invalidField(`${path}.actions[${index}]`, 'must be an accepted action record'));
      }
    });
  }

  if (value.rejections === undefined) {
    errors.push(missingField(`${path}.rejections`));
  } else if (!Array.isArray(value.rejections)) {
    errors.push(invalidField(`${path}.rejections`, 'must be an array of rejection records (may be empty)'));
  } else {
    (value.rejections as readonly unknown[]).forEach((rejection, index) => {
      if (!isRejectionRecord(rejection)) {
        errors.push(invalidField(`${path}.rejections[${index}]`, 'must be a rejection record (rejected action + typed errors)'));
      }
    });
  }

  if (value.rewards === undefined) {
    errors.push(missingField(`${path}.rewards`));
  } else if (!Array.isArray(value.rewards)) {
    errors.push(invalidField(`${path}.rewards`, 'must be an array of reward signal records (may be empty — never fabricated)'));
  } else {
    (value.rewards as readonly unknown[]).forEach((reward, index) => {
      if (!isRewardSignalRecord(reward)) {
        errors.push(invalidField(`${path}.rewards[${index}]`, 'must be a reward signal record'));
      }
    });
  }

  if (value.tool_outcomes === undefined) {
    errors.push(missingField(`${path}.tool_outcomes`));
  } else if (!Array.isArray(value.tool_outcomes)) {
    errors.push(invalidField(`${path}.tool_outcomes`, 'must be an array of tool outcome refs (may be empty)'));
  } else {
    (value.tool_outcomes as readonly unknown[]).forEach((ref, index) => {
      if (!isToolOutcomeRef(ref)) {
        errors.push(invalidField(`${path}.tool_outcomes[${index}]`, 'must be a non-empty tool outcome ref'));
      }
    });
  }

  if (value.environment_result === undefined) {
    errors.push(missingField(`${path}.environment_result`));
  } else if (value.environment_result !== null && !isEnvironmentResultRef(value.environment_result)) {
    errors.push(invalidField(`${path}.environment_result`, 'must be a non-empty environment result ref or null'));
  }

  if (value.clock === undefined) {
    errors.push(missingField(`${path}.clock`));
  } else if (!isClockSample(value.clock)) {
    errors.push(invalidField(`${path}.clock`, 'must be a valid clock sample (now <= asOf, positive playbackSpeed)'));
  }

  if (value.causality_id === undefined) {
    errors.push(missingField(`${path}.causality_id`));
  } else if (!isCausalityId(value.causality_id)) {
    errors.push(invalidField(`${path}.causality_id`, 'must be a non-empty causality id'));
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      step: value.step as number,
      step_id: value.step_id as StepId,
      observations: (value.observations as readonly ObservationRef[]).slice(),
      actions: (value.actions as readonly ActionRecord[]).slice(),
      rejections: (value.rejections as readonly RejectionRecord[]).slice(),
      rewards: (value.rewards as readonly RewardSignalRecord[]).slice(),
      tool_outcomes: (value.tool_outcomes as readonly ToolOutcomeRef[]).slice(),
      environment_result: value.environment_result as EnvironmentResultRef | null,
      clock: value.clock as ClockSample,
      causality_id: value.causality_id as CausalityId,
    }),
  );
}

// ---------------------------------------------------------------------------
// The L9 lineage block (metadata) — exact mirror of trajectory's metadata
// ---------------------------------------------------------------------------

/**
 * The full L9 lineage block of a trajectory — exact mirror of
 * `@tradrl/trajectory`'s `TrajectoryMetadata`: tenant (L12), project (L15),
 * episode, environment config ref, runtime ref, dataset refs, body versions
 * and substrates (producer sets NON-EMPTY — lineage completeness). No
 * wall-clock stamp anywhere: the time axis is the simulated clock, and
 * byte-determinism of serialization is a construction law.
 */
export interface TrajectoryMetadata {
  readonly trajectory_id: TrajectoryId;
  /** Tenant scope (L12). */
  readonly tenant: TenantId;
  /** Project continuity root (L15). */
  readonly project: ProjectId;
  /** The episode this stream records (T005). */
  readonly episode: EpisodeId;
  /** Versioned environment configuration reference (L9). */
  readonly environment_config: EnvironmentConfigRef;
  /** Versioned runtime reference (L9). */
  readonly runtime: RuntimeRef;
  /** Dataset references the episode consumed (may be empty for generative worlds). */
  readonly data: readonly DataRef[];
  /** Body versions of the producing organization (non-empty — the stream's producers). */
  readonly body_versions: readonly BodyVersionRef[];
  /** Cognitive substrates those bodies ran on (non-empty). */
  readonly substrates: readonly SubstrateRef[];
}

/** Runtime guard for a structurally valid, lineage-complete metadata block. */
export function isTrajectoryMetadata(value: unknown): value is TrajectoryMetadata {
  if (!isRecord(value)) return false;
  if (!isTrajectoryId(value.trajectory_id)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  if (!isEpisodeId(value.episode)) return false;
  if (!isEnvironmentConfigRef(value.environment_config)) return false;
  if (!isRuntimeRef(value.runtime)) return false;
  if (!Array.isArray(value.data)) return false;
  if (!(value.data as readonly unknown[]).every((ref) => isDataRef(ref))) return false;
  if (!Array.isArray(value.body_versions) || value.body_versions.length === 0) return false;
  if (!(value.body_versions as readonly unknown[]).every((ref) => isBodyVersionRef(ref))) return false;
  if (!Array.isArray(value.substrates) || value.substrates.length === 0) return false;
  if (!(value.substrates as readonly unknown[]).every((ref) => isSubstrateRef(ref))) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted metadata block — mirror of
 * trajectory's `validateTrajectoryMetadata`. Enforces lineage COMPLETENESS
 * (L9) and the L12 tenant / L15 project fields. On success the value is
 * returned narrowed, deeply frozen.
 */
export function validateTrajectoryMetadata(value: unknown, path = 'metadata'): RLResult<TrajectoryMetadata> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: RLError[] = [];

  if (value.trajectory_id === undefined) {
    errors.push(missingField(`${path}.trajectory_id`));
  } else if (!isTrajectoryId(value.trajectory_id)) {
    errors.push(invalidField(`${path}.trajectory_id`, 'must be a non-empty string'));
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

  if (value.episode === undefined) {
    errors.push(missingField(`${path}.episode`));
  } else if (!isEpisodeId(value.episode)) {
    errors.push(invalidField(`${path}.episode`, 'must be a non-empty episode id (T005)'));
  }

  if (value.environment_config === undefined) {
    errors.push(missingField(`${path}.environment_config`));
  } else if (!isEnvironmentConfigRef(value.environment_config)) {
    errors.push(invalidField(`${path}.environment_config`, 'must be a non-empty versioned environment config ref (L9)'));
  }

  if (value.runtime === undefined) {
    errors.push(missingField(`${path}.runtime`));
  } else if (!isRuntimeRef(value.runtime)) {
    errors.push(invalidField(`${path}.runtime`, 'must be a non-empty versioned runtime ref (L9)'));
  }

  if (value.data === undefined) {
    errors.push(missingField(`${path}.data`));
  } else if (!Array.isArray(value.data)) {
    errors.push(invalidField(`${path}.data`, 'must be an array of dataset refs (may be empty for generative worlds)'));
  } else {
    (value.data as readonly unknown[]).forEach((ref, index) => {
      if (!isDataRef(ref)) {
        errors.push(invalidField(`${path}.data[${index}]`, 'must be a non-empty dataset ref'));
      }
    });
  }

  if (value.body_versions === undefined) {
    errors.push(missingField(`${path}.body_versions`));
  } else if (!Array.isArray(value.body_versions)) {
    errors.push(invalidField(`${path}.body_versions`, 'must be an array of body version refs'));
  } else if (value.body_versions.length === 0) {
    errors.push(invalidField(`${path}.body_versions`, 'must be non-empty — an experience stream has producers (L9 lineage completeness)'));
  } else {
    (value.body_versions as readonly unknown[]).forEach((ref, index) => {
      if (!isBodyVersionRef(ref)) {
        errors.push(invalidField(`${path}.body_versions[${index}]`, 'must be a non-empty body version ref'));
      }
    });
  }

  if (value.substrates === undefined) {
    errors.push(missingField(`${path}.substrates`));
  } else if (!Array.isArray(value.substrates)) {
    errors.push(invalidField(`${path}.substrates`, 'must be an array of substrate refs'));
  } else if (value.substrates.length === 0) {
    errors.push(invalidField(`${path}.substrates`, 'must be non-empty — bodies run on substrates (L9 lineage completeness)'));
  } else {
    (value.substrates as readonly unknown[]).forEach((ref, index) => {
      if (!isSubstrateRef(ref)) {
        errors.push(invalidField(`${path}.substrates[${index}]`, 'must be a non-empty substrate ref'));
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      trajectory_id: value.trajectory_id as TrajectoryId,
      tenant: value.tenant as TenantId,
      project: value.project as ProjectId,
      episode: value.episode as EpisodeId,
      environment_config: value.environment_config as EnvironmentConfigRef,
      runtime: value.runtime as RuntimeRef,
      data: (value.data as readonly DataRef[]).slice(),
      body_versions: (value.body_versions as readonly BodyVersionRef[]).slice(),
      substrates: (value.substrates as readonly SubstrateRef[]).slice(),
    }),
  );
}

// ---------------------------------------------------------------------------
// The trajectory record (append-only discipline — L9/L11)
// ---------------------------------------------------------------------------

/** The trajectory record: metadata (L9 lineage block) + ordered step log — exact mirror of trajectory's `Trajectory`. */
export interface Trajectory {
  readonly metadata: TrajectoryMetadata;
  readonly steps: readonly TrajectoryStep[];
}

/** Runtime guard for a structurally valid trajectory. */
export function isTrajectory(value: unknown): value is Trajectory {
  if (!isRecord(value)) return false;
  if (!isTrajectoryMetadata(value.metadata)) return false;
  if (!Array.isArray(value.steps)) return false;
  return (value.steps as readonly unknown[]).every((step) => isTrajectoryStep(step));
}

/**
 * Collect-all validation of an untrusted trajectory — mirror of trajectory's
 * `validateTrajectory` (metadata, every step, then the cross-step laws:
 * sequential 1-based ordinals, id uniqueness across the whole record, clock
 * monotonicity). On success the value is returned narrowed, deeply frozen.
 */
export function validateTrajectory(value: unknown, path = 'trajectory'): RLResult<Trajectory> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }

  let metadata: TrajectoryMetadata | undefined;
  if (value.metadata === undefined) {
    return { ok: false, errors: [missingField(`${path}.metadata`)] };
  }
  const metadataResult = validateTrajectoryMetadata(value.metadata, `${path}.metadata`);
  if (metadataResult.ok) {
    metadata = metadataResult.value;
  } else {
    return metadataResult;
  }

  if (!Array.isArray(value.steps)) {
    return { ok: false, errors: [invalidField(`${path}.steps`, 'must be an array of steps')] };
  }

  const steps: TrajectoryStep[] = [];
  const seenStepIds = new Set<string>();
  const seenCausalityIds = new Set<string>();
  const seenObservationIds = new Set<string>();
  const seenActionIds = new Set<string>();
  const seenRewardIds = new Set<string>();
  let previousNow: number | undefined;

  for (let index = 0; index < value.steps.length; index++) {
    const stepResult = validateTrajectoryStep(value.steps[index], `${path}.steps[${index}]`);
    if (!stepResult.ok) return stepResult;
    const step = stepResult.value;

    if (step.step !== index + 1) {
      return fail(
        'step_out_of_order',
        `step at index ${index} carries ordinal ${step.step}; expected ${index + 1} (steps are strictly sequential from 1)`,
        `${path}.steps[${index}].step`,
      );
    }
    if (seenStepIds.has(step.step_id)) {
      return fail('duplicate_step', `step id "${step.step_id}" is already recorded in this trajectory`, `${path}.steps[${index}].step_id`);
    }
    if (seenCausalityIds.has(step.causality_id)) {
      return fail(
        'duplicate_step',
        `causality id "${step.causality_id}" is already recorded in this trajectory`,
        `${path}.steps[${index}].causality_id`,
      );
    }
    if (previousNow !== undefined && step.clock.now < previousNow) {
      return fail(
        'clock_regression',
        `step ${step.step} clock.now (${step.clock.now}) precedes the previous step's now (${previousNow}) — episode time is monotonic`,
        `${path}.steps[${index}].clock.now`,
      );
    }
    previousNow = step.clock.now;

    for (const observation of step.observations) {
      if (seenObservationIds.has(observation.observation_id)) {
        return fail(
          'duplicate_observation',
          `observation id "${observation.observation_id}" is already recorded in this trajectory`,
          `${path}.steps[${index}].observations`,
        );
      }
      seenObservationIds.add(observation.observation_id);
    }
    for (const action of step.actions) {
      if (seenActionIds.has(action.action_id)) {
        return fail('duplicate_action', `action id "${action.action_id}" is already recorded in this trajectory`, `${path}.steps[${index}].actions`);
      }
      seenActionIds.add(action.action_id);
    }
    for (const rejection of step.rejections) {
      if (seenActionIds.has(rejection.action.action_id)) {
        return fail(
          'duplicate_action',
          `action id "${rejection.action.action_id}" appears twice (accepted and/or rejected) — ids name experience events uniquely`,
          `${path}.steps[${index}].rejections`,
        );
      }
      seenActionIds.add(rejection.action.action_id);
    }
    for (const reward of step.rewards) {
      if (seenRewardIds.has(reward.reward_id)) {
        return fail('duplicate_reward', `reward id "${reward.reward_id}" is already recorded in this trajectory`, `${path}.steps[${index}].rewards`);
      }
      seenRewardIds.add(reward.reward_id);
    }

    seenStepIds.add(step.step_id);
    seenCausalityIds.add(step.causality_id);
    steps.push(step);
  }

  return ok(deepFreeze({ metadata: metadata as TrajectoryMetadata, steps }));
}

/**
 * Construct a trajectory from a metadata block and a (possibly empty) step
 * log — mirror of trajectory's `createTrajectory`. Both are validated; the
 * cross-step laws are enforced across the whole log.
 */
export function createTrajectory(metadata: unknown, steps: readonly unknown[]): RLResult<Trajectory> {
  const metadataResult = validateTrajectoryMetadata(metadata);
  if (!metadataResult.ok) return metadataResult;
  return validateTrajectory({ metadata: metadataResult.value, steps });
}

/**
 * Append one step to a trajectory — mirror of trajectory's
 * `appendTrajectoryStep`. Returns a NEW record (append-only discipline —
 * L11's spirit: history is never rewritten); enforces ordinal continuity,
 * clock monotonicity and id uniqueness.
 */
export function appendTrajectoryStep(trajectory: Trajectory, step: unknown): RLResult<Trajectory> {
  const stepResult = validateTrajectoryStep(step);
  if (!stepResult.ok) return stepResult;
  const validStep = stepResult.value;

  if (!isTrajectory(trajectory)) {
    return fail('invalid_trajectory', 'appendTrajectoryStep requires a valid trajectory record');
  }

  const expectedOrdinal = trajectory.steps.length + 1;
  if (validStep.step !== expectedOrdinal) {
    return fail(
      'step_out_of_order',
      `appended step carries ordinal ${validStep.step}; expected ${expectedOrdinal} (the next step ordinal)`,
      'step.step',
    );
  }

  const lastStep: TrajectoryStep | undefined = trajectory.steps[trajectory.steps.length - 1];
  if (lastStep !== undefined && validStep.clock.now < lastStep.clock.now) {
    return fail(
      'clock_regression',
      `appended step clock.now (${validStep.clock.now}) precedes the previous step's now (${lastStep.clock.now}) — episode time is monotonic`,
      'step.clock.now',
    );
  }

  const observationIds = new Set<string>(
    trajectory.steps.flatMap((existing) => existing.observations.map((observation) => observation.observation_id)),
  );
  for (const observation of validStep.observations) {
    if (observationIds.has(observation.observation_id)) {
      return fail(
        'duplicate_observation',
        `observation id "${observation.observation_id}" is already recorded in this trajectory`,
        'step.observations',
      );
    }
  }

  const actionIds = new Set<string>(
    trajectory.steps.flatMap((existing) => [
      ...existing.actions.map((action) => action.action_id),
      ...existing.rejections.map((rejection) => rejection.action.action_id),
    ]),
  );
  for (const action of validStep.actions) {
    if (actionIds.has(action.action_id)) {
      return fail('duplicate_action', `action id "${action.action_id}" is already recorded in this trajectory`, 'step.actions');
    }
  }
  for (const rejection of validStep.rejections) {
    if (actionIds.has(rejection.action.action_id)) {
      return fail(
        'duplicate_action',
        `action id "${rejection.action.action_id}" appears twice (accepted and/or rejected) — ids name experience events uniquely`,
        'step.rejections',
      );
    }
  }

  const rewardIds = new Set<string>(trajectory.steps.flatMap((existing) => existing.rewards.map((reward) => reward.reward_id)));
  for (const reward of validStep.rewards) {
    if (rewardIds.has(reward.reward_id)) {
      return fail('duplicate_reward', `reward id "${reward.reward_id}" is already recorded in this trajectory`, 'step.rewards');
    }
  }

  return ok(deepFreeze({ metadata: trajectory.metadata, steps: [...trajectory.steps, validStep] }));
}

/**
 * Replay the trajectory: the step sequence in recorded order — the identity
 * over the log, made explicit (mirror of trajectory's `replayTrajectory`) so
 * T012 evaluation and T014 hand-off have one canonical entry point.
 */
export function replayTrajectory(trajectory: Trajectory): readonly TrajectoryStep[] {
  return trajectory.steps;
}
