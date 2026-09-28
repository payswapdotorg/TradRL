/**
 * @tradrl/environment-runner — the step trace.
 *
 * The trace is the durable, JSON-serializable record of one driven episode
 * (the shape T011 trajectories persist and T013 RL consumes; T014 ships it
 * across processes). Every constituent is a plain JSON value: the
 * observation/action/reward envelopes are JSON-safe by protocol contract,
 * and the trace is deeply frozen on construction.
 *
 * Semantics per step:
 *   - `at`: the instant the step observed at (the clock's `now` at step
 *     start — observations were policed by the inclusive L4 boundary).
 *   - `observations`: the observations DELIVERED by this step — the visible
 *     set at `at` minus everything already delivered by earlier steps
 *     (delta by observation id). Backfilled data (an observation that
 *     became visible late because the world emitted it late) appears in the
 *     step where it first became visible.
 *   - `actions`: the action requests ACCEPTED this step, in submission order.
 *   - `rejections`: the requests the environment rejected, with the typed
 *     errors — the full request history, successes AND failures.
 *   - `advanced_to`: the clock's `now` after the step's advance.
 *   - `rewards`: the reward signals the world emitted DURING this step.
 *     Each signal carries its own `available_time`; consumers apply the
 *     same inclusive boundary to rewards (L4 polices them identically).
 */

import { deepFreeze, isRecord } from '../../../packages/environment-protocol/src/index';
import type {
  Action,
  EnvError,
  EpisodeId,
  EpisodeResult,
  EnvironmentSpec,
  Observation,
  RewardSignal,
  TimestampMs,
} from '../../../packages/environment-protocol/src/index';
import { isAction, isEpisodeResult, isObservation, isRewardSignal, isTimestampMs } from '../../../packages/environment-protocol/src/index';

/** A rejected action request, with the environment's typed errors. */
export interface Rejection {
  readonly action: Action;
  readonly errors: readonly EnvError[];
}

/** One step of a driven episode (see module header for field semantics). */
export interface StepRecord {
  readonly step: number;
  readonly at: TimestampMs;
  readonly observations: readonly Observation[];
  readonly actions: readonly Action[];
  readonly rejections: readonly Rejection[];
  readonly advanced_to: TimestampMs;
  readonly rewards: readonly RewardSignal[];
}

/** The full trace of one driven episode: spec, per-step records, result. */
export interface EpisodeTrace {
  readonly spec: EnvironmentSpec;
  readonly episode_id: EpisodeId;
  readonly steps: readonly StepRecord[];
  readonly result: EpisodeResult;
}

/** Runtime guard for a rejection record. */
export function isRejection(value: unknown): value is Rejection {
  if (!isRecord(value)) return false;
  if (!isAction(value.action)) return false;
  if (!Array.isArray(value.errors) || value.errors.length === 0) return false;
  return value.errors.every((error) => isRecord(error) && typeof (error as Record<string, unknown>).code === 'string');
}

/** Runtime guard for a step record. */
export function isStepRecord(value: unknown): value is StepRecord {
  if (!isRecord(value)) return false;
  if (typeof value.step !== 'number' || !Number.isSafeInteger(value.step) || value.step < 1) return false;
  if (!isTimestampMs(value.at) || !isTimestampMs(value.advanced_to)) return false;
  if (!Array.isArray(value.observations) || !value.observations.every((observation) => isObservation(observation))) return false;
  if (!Array.isArray(value.actions) || !value.actions.every((action) => isAction(action))) return false;
  if (!Array.isArray(value.rejections) || !value.rejections.every((rejection) => isRejection(rejection))) return false;
  if (!Array.isArray(value.rewards) || !value.rewards.every((reward) => isRewardSignal(reward))) return false;
  return true;
}

/** Runtime guard for an episode trace. */
export function isEpisodeTrace(value: unknown): value is EpisodeTrace {
  if (!isRecord(value)) return false;
  if (!isRecord(value.spec)) return false;
  if (typeof value.episode_id !== 'string' || value.episode_id.length === 0) return false;
  if (!Array.isArray(value.steps) || !value.steps.every((step) => isStepRecord(step))) return false;
  return isEpisodeResult(value.result);
}

/** Construct a frozen step record (runner-internal, exported for tests/T011). */
export function makeStepRecord(record: StepRecord): StepRecord {
  return deepFreeze({
    step: record.step,
    at: record.at,
    observations: [...record.observations],
    actions: [...record.actions],
    rejections: [...record.rejections],
    advanced_to: record.advanced_to,
    rewards: [...record.rewards],
  });
}

/** Construct a frozen episode trace (runner-internal, exported for tests/T011). */
export function makeEpisodeTrace(trace: EpisodeTrace): EpisodeTrace {
  return deepFreeze({
    spec: trace.spec,
    episode_id: trace.episode_id,
    steps: trace.steps.map((step) => makeStepRecord(step)),
    result: trace.result,
  });
}

/**
 * Serialize a trace as JSON. Construction is deterministic, so equal traces
 * serialize to identical bytes (the determinism proof compares these).
 */
export function serializeTrace(trace: EpisodeTrace): string {
  return JSON.stringify(trace);
}
