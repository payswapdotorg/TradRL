/**
 * @tradrl/trajectory — the atomic step record.
 *
 * A {@link TrajectoryStep} is the atomic unit of the experience stream
 * (spec/DOMAIN-MODEL.md: Trajectory = "Ordered observations, actions, events,
 * rewards and tool outcomes with lineage"). One step bundles everything that
 * happened at one driving instant of the episode:
 *
 *   - `observations` — REFS to the observations DELIVERED this step, each
 *     carrying its own `available_time` (the L4 forensic input). Future-dated
 *     availability is LEGAL here: the recorded fact "this observation was in
 *     the delivered set while the clock stood at `now`" is precisely what
 *     leakage forensics flags (see leakage.ts) — validity is timeless,
 *     exactly as in T005's observation validator.
 *   - `actions` — the action requests ACCEPTED this step, in submission
 *     order (opaque payloads + actor ids; requests, never authority — L8).
 *   - `rejections` — the requests the environment REJECTED this step, with
 *     the typed errors. The full request history — successes AND failures —
 *     is experience; dropping rejections would make the record lossy and
 *     would violate the search-integrity discipline on the trajectory side
 *     (L11's spirit: history is never pruned).
 *   - `rewards` — the reward signals the world emitted this step. OPTIONAL,
 *     EXPLICIT, NEVER FABRICATED (mirror of T005's RewardSignal law): an
 *     empty array means the world said nothing.
 *   - `tool_outcomes` — opaque refs to tool outcomes recorded this step.
 *   - `environment_result` — opaque ref to the environment result record of
 *     this step's effects (null when the producing runtime recorded none —
 *     T005 delivers results as observations, so the common case is null).
 *   - `clock` — the clock sample the step observed under (now/asOf mirror of
 *     time-engine's SimulationClock, full shape).
 *   - `causality_id` — the opaque causal linkage id of this step.
 *
 * The work order names the atomic essentials ("observation refs with
 * available_time, action record, environment result ref, reward signal, tool
 * outcome refs, clock sample, causality id"); arrays generalize the singular
 * "action record"/"reward signal" because a T005 step may legally carry
 * multiple accepted actions and multiple reward signals — the atomic-record
 * property is preserved by the step ordinal plus within-step order, and
 * replay yields the identical sequence either way.
 */

import { deepFreeze, isFiniteNumber, isJsonObject, isJsonValue, isNonEmptyString, isRecord } from './primitives';
import type { JsonValue, JsonObject } from './primitives';
import {
  invalidField,
  invalidType,
  missingField,
  ok,
  type TrajError,
  type TrajResult,
} from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type {
  ActionId,
  AgentInstanceId,
  CausalityId,
  EnvironmentResultRef,
  ObservationId,
  RewardId,
  StepId,
  ToolOutcomeRef,
} from './ids';
import {
  isActionId,
  isAgentInstanceId,
  isCausalityId,
  isEnvironmentResultRef,
  isObservationId,
  isRewardId,
  isStepId,
  isToolOutcomeRef,
} from './ids';

// ---------------------------------------------------------------------------
// Clock sample (structural mirror of time-engine's SimulationClock)
// ---------------------------------------------------------------------------

/** The three distinct world-fidelity modes (L5). Mirror of time-engine/T005. */
export type FidelityMode = 'exact_replay' | 'reactive_replay' | 'generative';

/** Runtime-checkable list of fidelity modes, for guards and diagnostics. */
export const FIDELITY_MODES: readonly FidelityMode[] = ['exact_replay', 'reactive_replay', 'generative'];

/**
 * The information policy governing what the step's `now` admits.
 * `point-in-time`: an observation is visible iff `available_time <= now`
 * (inclusive). Mirror of time-engine/T005.
 */
export type InformationPolicy = 'point-in-time';

/**
 * The clock sample of one step — a STRUCTURAL MIRROR of time-engine's
 * `SimulationClock` (and T005's `ClockConfig`). The work order calls this the
 * "now/asOf mirror"; the FULL clock shape is mirrored so that
 * {@link toTrajectorySamples} (leakage.ts) can hand time-engine's
 * `leakageCheck` structurally identical clocks without adaptation, and so the
 * step is self-contained forensic evidence. `now <= asOf` is enforced.
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

/** Runtime guard for a fidelity mode. Mirror of time-engine's `isFidelityMode`. */
export function isFidelityMode(value: unknown): value is FidelityMode {
  return typeof value === 'string' && (FIDELITY_MODES as readonly string[]).includes(value);
}

/** Runtime guard for the (currently single) information policy. */
export function isInformationPolicy(value: unknown): value is InformationPolicy {
  return value === 'point-in-time';
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
// Observation reference
// ---------------------------------------------------------------------------

/**
 * A delivered observation, recorded by reference. Carries the L4 forensic
 * input (`available_time`) so a trajectory supports leakage forensics without
 * dragging opaque payloads along: T012/T013 consumers resolve the payload
 * through the episode/trace the trajectory was built from (bound in
 * metadata), never through the trajectory itself.
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

// ---------------------------------------------------------------------------
// Action record
// ---------------------------------------------------------------------------

/**
 * An accepted action request, recorded in full-but-opaque form (mirror of
 * T005's Action envelope: requests, never authority — L8). The payload is
 * JSON-safe by contract; semantics belong to the world and the actor's lane.
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

// ---------------------------------------------------------------------------
// Rejection record
// ---------------------------------------------------------------------------

/** One typed rejection error (mirror of T005's EnvError: code/path/message). */
export interface RejectionError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/**
 * A rejected action request, with the environment's typed errors — the
 * request history is experience; nothing is pruned (L11 discipline).
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
// Reward signal record
// ---------------------------------------------------------------------------

/**
 * An explicit reward signal emitted by the world (mirror of T005's
 * RewardSignal minus the `episode_id` — the trajectory's metadata owns the
 * episode binding, so the field would be redundant duplication). OPTIONAL,
 * EXPLICIT, NEVER FABRICATED: signals exist only because the world emitted
 * them; the value is never interpreted as PnL here (L7).
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
  if (value.available_time < value.at) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/** One atomic step of the experience stream (see module header). */
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
  /** Reward signals emitted during this step. */
  readonly rewards: readonly RewardSignalRecord[];
  /** Opaque tool outcome refs recorded this step. */
  readonly tool_outcomes: readonly ToolOutcomeRef[];
  /** Opaque environment result ref (null when the runtime recorded none). */
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
 * Collect-all validation of an untrusted trajectory step. Every violation is
 * reported with a dotted path; on success the value is returned narrowed,
 * deeply frozen. Timeless: no comparison against other steps happens here
 * (ordering and monotonicity are append-time laws — see trajectory.ts).
 */
export function validateTrajectoryStep(value: unknown, path = 'step'): TrajResult<TrajectoryStep> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: TrajError[] = [];

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
