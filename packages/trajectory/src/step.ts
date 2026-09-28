/**
 * @tradrl/trajectory — the atomic step record.
 *
 * A `TrajectoryStep` is the atomic unit of recorded experience: the
 * observations available to the actor, the action the actor took, the
 * environment's response, the reward signal (explicit, never defaulted),
 * the tool outcomes produced, the clock sample at which all this happened
 * and the causality chain the step belongs to.
 *
 * Laws honored here (spec/ARCHITECTURE-LOCK.md):
 * - L4 point-in-time truth: every observation reference carries its own
 *   `availableTime`. The GUARD does not reject `availableTime > clock.now`
 *   — an honest record of a leaky run must be expressible; the leak itself
 *   is DETECTED by the forensics (sample.ts, mirroring time-engine's
 *   `leakageCheck`). Guards validate structure; forensics judge behavior.
 * - L9 reproducible lineage: the action payload is opaque JSON (bounded,
 *   deterministic-serializable), the actor is an opaque id.
 */

import { isFiniteNumber, isJsonObject, isNonEmptyString, isRecord } from './primitives';
import { isTimestampMs, type TimestampMs } from './timestamp';
import { isClockSample, type ClockSample } from './clock';
import {
  isAgentInstanceRef,
  isCausalityId,
  isStepId,
  type AgentInstanceRef,
  type CausalityId,
  type StepId,
} from './ids';

/**
 * A reference to one observation the actor saw at this step, together with
 * the earliest instant at which that observation legitimately became
 * available. The referent (market event, derived feature, tool output, ...)
 * is owned by its producing lane and is referenced opaquely — the trajectory
 * never embeds observation payloads.
 */
export interface ObservationRef {
  /** Opaque observation/event/feature id (referent owned by its producer lane). */
  readonly ref: string;
  /** Earliest legitimate observation instant (L4). */
  readonly availableTime: TimestampMs;
}

/** Guard: a valid observation reference. */
export function isObservationRef(value: unknown): value is ObservationRef {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.ref)) return false;
  return isTimestampMs(value.availableTime);
}

/**
 * The action the actor took: an opaque JSON payload plus the opaque id of
 * the acting agent instance. The trajectory never interprets action
 * semantics — execution authority lives outside records (L8/L20) — it only
 * preserves what was done, by whom, for replay and forensics.
 */
export interface ActionRecord {
  /** Opaque id of the acting agent instance (T003/T006 lanes). */
  readonly actorId: AgentInstanceRef;
  /** Opaque JSON payload describing the action. Must be a plain JSON object. */
  readonly payload: { readonly [key: string]: unknown };
}

/** Guard: a valid action record (actor id + JSON-object payload). */
export function isActionRecord(value: unknown): value is ActionRecord {
  if (!isRecord(value)) return false;
  if (!isAgentInstanceRef(value.actorId)) return false;
  return isJsonObject(value.payload);
}

/**
 * An explicit reward signal attached to a step. Presence is meaningful:
 * `reward: undefined` means NO reward was awarded for this step — it is
 * never implicitly zero. `value` may be any finite number (negative rewards
 * are legitimate); `dimension` optionally names what was rewarded
 * (e.g. `'pnl'`, `'risk-adjusted'`).
 */
export interface RewardSignal {
  /** The reward value. Finite; sign unconstrained. */
  readonly value: number;
  /** Optional name of the rewarded dimension. */
  readonly dimension?: string;
}

/** Guard: a valid reward signal. */
export function isRewardSignal(value: unknown): value is RewardSignal {
  if (!isRecord(value)) return false;
  if (!isFiniteNumber(value.value)) return false;
  if (value.dimension !== undefined && !isNonEmptyString(value.dimension)) return false;
  return true;
}

/**
 * One atomic step of a trajectory. Field discipline:
 * - `observations` may be empty (a step can be pure action) but every entry
 *   must be a valid, non-duplicated observation reference.
 * - `action` is required: a step IS an act (the observation-only prefix of
 *   an episode belongs to the first acting step's `observations`).
 * - `environmentResultRef` is a required opaque reference to the
 *   environment's response record (T005 environment-protocol owns the
 *   referent).
 * - `reward` is optional and explicit (see {@link RewardSignal}).
 * - `toolOutcomeRefs` may be empty; duplicate ids within a step are rejected
 *   (recording the same tool outcome twice in one step is corruption).
 * - `clock` is the validated per-step time record.
 * - `causalityId` groups the steps of one causal chain (deliberation ->
 *   action -> response).
 */
export interface TrajectoryStep {
  /** Opaque identity of this step, unique within its trajectory. */
  readonly id: StepId;
  /** Observations available to the actor at this step (with availability instants). */
  readonly observations: readonly ObservationRef[];
  /** The action taken. */
  readonly action: ActionRecord;
  /** Opaque reference to the environment's response record (T005 lane). */
  readonly environmentResultRef: string;
  /** Explicit reward signal, when one was awarded for this step. */
  readonly reward?: RewardSignal;
  /** Opaque references to tool outcomes produced at this step. */
  readonly toolOutcomeRefs: readonly string[];
  /** The clock sample at which the step was taken. */
  readonly clock: ClockSample;
  /** The causal chain this step belongs to. */
  readonly causalityId: CausalityId;
}

/** Guard: a structurally valid trajectory step (all invariants above). */
export function isTrajectoryStep(value: unknown): value is TrajectoryStep {
  if (!isRecord(value)) return false;
  if (!isStepId(value.id)) return false;
  if (!Array.isArray(value.observations)) return false;
  if (!value.observations.every(isObservationRef)) return false;
  if (new Set(value.observations.map((o) => o.ref)).size !== value.observations.length) return false;
  if (!isActionRecord(value.action)) return false;
  if (!isNonEmptyString(value.environmentResultRef)) return false;
  if (value.reward !== undefined && !isRewardSignal(value.reward)) return false;
  if (!Array.isArray(value.toolOutcomeRefs)) return false;
  if (!value.toolOutcomeRefs.every(isNonEmptyString)) return false;
  if (new Set(value.toolOutcomeRefs).size !== value.toolOutcomeRefs.length) return false;
  if (!isClockSample(value.clock)) return false;
  return isCausalityId(value.causalityId);
}
