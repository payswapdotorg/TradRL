/**
 * @tradrl/environment-protocol — the episode state and the step protocol.
 *
 * The step protocol is the mediating contract between an AgentInstance
 * runtime and a MarketWorld under a simulation clock (T005's problem
 * statement). An episode is one run of one {@link EnvironmentSpec}; the
 * protocol owns episode lifecycle, observation delivery (point-in-time
 * policed), action intake (validation only — NO authority, L8), reward
 * signalling and termination.
 *
 *     start(spec)          -> EpisodeState            (deterministic id)
 *     emitObservations(ep) -> EpisodeState            (world offers data)
 *     emitRewardSignals(ep)-> EpisodeState            (world offers rewards)
 *     observe(ep, at)      -> visible observations    (PURE query, L4)
 *     submit(ep, action)   -> accepted | rejected     (validation only)
 *     advance(ep, to)      -> EpisodeState            (monotonic, <= asOf)
 *     finish(ep, reason)   -> EpisodeFinish           (terminal state + result)
 *
 * Purity: every value is an immutable, deeply frozen, JSON-serializable
 * value object; every transition returns a NEW state (L3 discipline).
 * There is no wall-clock coupling anywhere — runtimes drive progression, so
 * runs are reproducible (L9).
 *
 * `observe` is deliberately a pure QUERY over the episode's pending
 * observation set: an agent may re-observe at any instant `at <= now`
 * (Time-Machine semantics — `at == now` is the live step, `at < now` is a
 * historical query), and observing never mutates state. Delivery bookkeeping
 * (what was handed to whom, when) belongs to the runtime's step trace (see
 * services/environment-runner), not to the state itself.
 *
 * `pending` holds the world's currently-offered observations, including
 * FUTURE-dated ones (embargoed until their availability instant). Worlds
 * that need bounded memory replace the pending set through their own
 * transitions; the protocol never silently drops data.
 */

import { deepFreeze, isNonEmptyString, isRecord } from './primitives';
import { fail, ok, type EnvResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { AgentInstanceId, EnvironmentId, EpisodeId } from './ids';
import { isEpisodeId } from './ids';
import { isClockConfig, type ClockConfig } from './clock';
import type { EnvironmentSpec } from './spec';
import { deriveEpisodeId, validateEnvironmentSpec } from './spec';
import type { Observation } from './observation';
import { isObservation, validateObservation, visibleObservationsAt } from './observation';
import type { Action } from './action';
import { isAction, validateAction } from './action';
import type { RewardSignal } from './reward';
import { isRewardSignal, validateRewardSignal } from './reward';

/** Episode lifecycle status. */
export type EpisodeStatus = 'running' | 'finished';

/** Runtime-checkable list of episode statuses. */
export const EPISODE_STATUSES: readonly EpisodeStatus[] = ['running', 'finished'];

/**
 * Why an episode ended:
 * - `completed` — natural end (the clock reached `asOf` or the world's
 *   declared horizon).
 * - `terminal` — the world reached a terminal state.
 * - `step_limit` — the driving runtime exhausted its step budget.
 * - `aborted` — an external operator/runtime abort.
 */
export type TerminationCode = 'completed' | 'terminal' | 'step_limit' | 'aborted';

/** Runtime-checkable list of termination codes. */
export const TERMINATION_CODES: readonly TerminationCode[] = ['completed', 'terminal', 'step_limit', 'aborted'];

/** The recorded reason an episode ended. */
export interface TerminationReason {
  readonly code: TerminationCode;
  readonly detail: string;
}

/** The episode state — one immutable run of one spec (see module header). */
export interface EpisodeState {
  /** Deterministically derived from the spec: same spec, same id (L9). */
  readonly episode_id: EpisodeId;
  /** The fully-determining spec, bound for lineage (L9). */
  readonly spec: EnvironmentSpec;
  /** The current clock state (a `ClockConfig` mirror; `now` is monotonic, `<= asOf`). */
  readonly clock: ClockConfig;
  readonly status: EpisodeStatus;
  /** Non-null iff `status === 'finished'`. */
  readonly termination: TerminationReason | null;
  /** The world's currently-offered observations (future-dated = embargoed). */
  readonly pending: readonly Observation[];
  /** The accepted action log, in acceptance order (the request history). */
  readonly accepted_actions: readonly Action[];
  /** The reward signals emitted so far (explicit, never fabricated). */
  readonly rewards: readonly RewardSignal[];
}

/**
 * The immutable summary of a finished episode. Binds the full spec (L9) so
 * results are attributable to data + code + configuration, and carries the
 * reward signals for RL consumers (T013) without interpreting them.
 */
export interface EpisodeResult {
  readonly episode_id: EpisodeId;
  readonly environment_id: EnvironmentId;
  readonly spec: EnvironmentSpec;
  readonly termination: TerminationReason;
  readonly final_now: TimestampMs;
  readonly accepted_action_count: number;
  readonly pending_observation_count: number;
  readonly rewards: readonly RewardSignal[];
}

/**
 * The terminal transition product: the FINISHED state (so runtimes can
 * police post-finish operations: submit/advance on it fail) plus the
 * immutable {@link EpisodeResult} record.
 */
export interface EpisodeFinish {
  readonly episode: EpisodeState;
  readonly result: EpisodeResult;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Runtime guard for an episode status. */
export function isEpisodeStatus(value: unknown): value is EpisodeStatus {
  return typeof value === 'string' && (EPISODE_STATUSES as readonly string[]).includes(value);
}

/** Runtime guard for a termination code. */
export function isTerminationCode(value: unknown): value is TerminationCode {
  return typeof value === 'string' && (TERMINATION_CODES as readonly string[]).includes(value);
}

/** Runtime guard for a termination reason. */
export function isTerminationReason(value: unknown): value is TerminationReason {
  if (!isRecord(value)) return false;
  return isTerminationCode(value.code) && isNonEmptyString(value.detail);
}

/** Runtime guard for a structurally valid (invariant-abiding) episode state. */
export function isEpisodeState(value: unknown): value is EpisodeState {
  if (!isRecord(value)) return false;
  if (!isEpisodeId(value.episode_id)) return false;
  if (!isRecord(value.spec)) return false;
  if (!isClockConfig(value.clock)) return false;
  if (!isEpisodeStatus(value.status)) return false;
  if (value.status === 'finished' && !isTerminationReason(value.termination)) return false;
  if (value.status === 'running' && value.termination !== null) return false;
  if (!Array.isArray(value.pending) || !value.pending.every((observation) => isObservation(observation))) return false;
  if (!Array.isArray(value.accepted_actions) || !value.accepted_actions.every((action) => isAction(action))) return false;
  if (!Array.isArray(value.rewards) || !value.rewards.every((reward) => isRewardSignal(reward))) return false;
  return true;
}

/** Runtime guard for a structurally valid episode result. */
export function isEpisodeResult(value: unknown): value is EpisodeResult {
  if (!isRecord(value)) return false;
  if (!isEpisodeId(value.episode_id)) return false;
  if (typeof (value as Record<string, unknown>).environment_id !== 'string') return false;
  if (!isRecord(value.spec)) return false;
  if (!isTerminationReason(value.termination)) return false;
  if (!isTimestampMs(value.final_now)) return false;
  if (typeof (value as Record<string, unknown>).accepted_action_count !== 'number') return false;
  if (typeof (value as Record<string, unknown>).pending_observation_count !== 'number') return false;
  if (!Array.isArray(value.rewards) || !value.rewards.every((reward) => isRewardSignal(reward))) return false;
  return true;
}

/** Runtime guard for a structurally valid episode finish. */
export function isEpisodeFinish(value: unknown): value is EpisodeFinish {
  if (!isRecord(value)) return false;
  return isEpisodeState(value.episode) && isEpisodeResult(value.result);
}

// ---------------------------------------------------------------------------
// Step protocol (pure transitions)
// ---------------------------------------------------------------------------

/**
 * Start an episode from a spec. Validates the spec (collect-all), derives
 * the episode id deterministically, and returns the initial running state:
 * empty pending set, empty action log, empty rewards, clock as configured.
 * The world subsequently offers observations/rewards through
 * {@link emitObservations} / {@link emitRewardSignals}.
 */
export function startEpisode(spec: unknown): EnvResult<EpisodeState> {
  const specResult = validateEnvironmentSpec(spec);
  if (!specResult.ok) return specResult;
  const validSpec = specResult.value;
  return ok(
    deepFreeze({
      episode_id: deriveEpisodeId(validSpec),
      spec: validSpec,
      clock: validSpec.profile.clock,
      status: 'running',
      termination: null,
      pending: [],
      accepted_actions: [],
      rewards: [],
    }),
  );
}

/**
 * The world offers observations to the episode. Every envelope is validated
 * (collect-all, first failure reported per observation); observation ids
 * must be unique across the pending set and the new batch. FUTURE-dated
 * `available_time` is legal (embargo) and so is past-dated (backfill) —
 * validity is timeless; the boundary polices visibility, not emission.
 */
export function emitObservations(episode: EpisodeState, observations: readonly unknown[]): EnvResult<EpisodeState> {
  if (episode.status === 'finished') {
    return fail('episode_finished', 'a finished episode accepts no new observations');
  }
  const existing = new Set<string>(episode.pending.map((observation) => observation.observation_id));
  const validated: Observation[] = [];
  for (const candidate of observations) {
    const observationResult = validateObservation(candidate);
    if (!observationResult.ok) return observationResult;
    const observation = observationResult.value;
    if (existing.has(observation.observation_id)) {
      return fail(
        'duplicate_observation',
        `observation id "${observation.observation_id}" is already present in episode ${episode.episode_id}`,
      );
    }
    existing.add(observation.observation_id);
    validated.push(observation);
  }
  return ok(
    deepFreeze({
      ...episode,
      pending: [...episode.pending, ...validated],
    }),
  );
}

/**
 * The world emits reward signals. Every signal is validated; ids must be
 * unique; each signal's `episode_id` must match the episode it is emitted
 * into. The protocol computes NOTHING here — signals exist only because the
 * world emitted them (optional, explicit, never fabricated).
 */
export function emitRewardSignals(episode: EpisodeState, signals: readonly unknown[]): EnvResult<EpisodeState> {
  if (episode.status === 'finished') {
    return fail('episode_finished', 'a finished episode accepts no new reward signals');
  }
  const existing = new Set<string>(episode.rewards.map((reward) => reward.reward_id));
  const validated: RewardSignal[] = [];
  for (const candidate of signals) {
    const rewardResult = validateRewardSignal(candidate);
    if (!rewardResult.ok) return rewardResult;
    const reward = rewardResult.value;
    if (reward.episode_id !== episode.episode_id) {
      return fail(
        'reward_episode_mismatch',
        `reward ${reward.reward_id} names episode ${reward.episode_id} but was emitted into ${episode.episode_id}`,
      );
    }
    if (existing.has(reward.reward_id)) {
      return fail(
        'duplicate_reward',
        `reward id "${reward.reward_id}" is already present in episode ${episode.episode_id}`,
      );
    }
    existing.add(reward.reward_id);
    validated.push(reward);
  }
  return ok(
    deepFreeze({
      ...episode,
      rewards: [...episode.rewards, ...validated],
    }),
  );
}

/**
 * PURE QUERY — the point-in-time observation delivery (L4). Returns the
 * pending observations visible at instant `at` under the inclusive
 * boundary `available_time <= at`. `at` may be any instant `<= clock.now`
 * (`at == now` is the live step; `at < now` is a Time-Machine query).
 * Observing a FINISHED episode is legal — the query is audit-side and
 * side-effect-free; it is mutation (submit/advance/emit/finish) that a
 * finished episode rejects.
 */
export function observeEpisode(episode: EpisodeState, at: TimestampMs): EnvResult<readonly Observation[]> {
  if (!isTimestampMs(at)) {
    return fail('invalid_timestamp', 'observe requires a valid TimestampMs instant');
  }
  if ((at as number) > (episode.clock.now as number)) {
    return fail(
      'observation_beyond_now',
      `cannot observe at ${at}: the episode's current now is ${episode.clock.now}`,
    );
  }
  return ok(visibleObservationsAt(episode.pending, at));
}

/**
 * Submit an action REQUEST. Validation only — NO authority is granted or
 * exercised here (L8): the environment records the request; results come
 * back later as observations. An action is accepted iff:
 *   1. the episode is running;
 *   2. the envelope is structurally valid (`validateAction`);
 *   3. `submitted_at <= clock.now` (the causal mirror of L4 — inclusive:
 *      an action submitted exactly at `now` is legal);
 *   4. `client_sequence` is strictly greater than the actor's last accepted
 *      sequence in this episode (per-actor request ordering).
 */
export function submitAction(episode: EpisodeState, action: unknown): EnvResult<EpisodeState> {
  if (episode.status === 'finished') {
    return fail('episode_finished', `episode ${episode.episode_id} is finished; actions are rejected`);
  }
  const actionResult = validateAction(action);
  if (!actionResult.ok) return actionResult;
  const validAction = actionResult.value;
  if ((validAction.submitted_at as number) > (episode.clock.now as number)) {
    return fail(
      'action_from_future',
      `action ${validAction.action_id} claims submission at ${validAction.submitted_at}, after the episode's now ${episode.clock.now}`,
    );
  }
  const lastSequence = actorHighestSequence(episode, validAction.actor);
  if (lastSequence !== null && validAction.client_sequence <= lastSequence) {
    return fail(
      'stale_sequence',
      `action ${validAction.action_id} carries client_sequence ${validAction.client_sequence}, not greater than the actor's last accepted ${lastSequence}`,
    );
  }
  return ok(
    deepFreeze({
      ...episode,
      accepted_actions: [...episode.accepted_actions, validAction],
    }),
  );
}

/**
 * Advance the episode's clock to `to`. Monotonic (`to >= now`, else
 * `clock_regression`) and anchored (`to <= asOf`, else `beyond_as_of`) —
 * the exact law of time-engine's `advanceClockTo`, mirrored. `to == now`
 * is a legal no-op advance.
 */
export function advanceEpisode(episode: EpisodeState, to: TimestampMs): EnvResult<EpisodeState> {
  if (episode.status === 'finished') {
    return fail('episode_finished', `episode ${episode.episode_id} is finished; the clock is frozen`);
  }
  if (!isTimestampMs(to)) {
    return fail('invalid_timestamp', 'advance requires a valid TimestampMs target');
  }
  if ((to as number) < (episode.clock.now as number)) {
    return fail(
      'clock_regression',
      `the episode clock may not move backwards: now=${episode.clock.now}, target=${to}`,
    );
  }
  if ((to as number) > (episode.clock.asOf as number)) {
    return fail('beyond_as_of', `the episode clock may not advance past asOf: asOf=${episode.clock.asOf}, target=${to}`);
  }
  return ok(
    deepFreeze({
      ...episode,
      clock: deepFreeze({ ...episode.clock, now: to }),
    }),
  );
}

/**
 * Finish the episode with an explicit reason. Returns the terminal state
 * (further mutations on it fail with `episode_finished`) and the immutable
 * {@link EpisodeResult}. The reason's `detail` must be non-empty — a bare
 * code is not an auditable termination.
 */
export function finishEpisode(episode: EpisodeState, reason: unknown): EnvResult<EpisodeFinish> {
  if (episode.status === 'finished') {
    return fail('episode_finished', `episode ${episode.episode_id} is already finished`);
  }
  if (!isTerminationReason(reason)) {
    return fail(
      'invalid_termination',
      `termination reason must be one of ${TERMINATION_CODES.join(' | ')} with a non-empty detail`,
    );
  }
  const finished: EpisodeState = deepFreeze({
    ...episode,
    status: 'finished',
    termination: reason,
  });
  const result: EpisodeResult = deepFreeze({
    episode_id: episode.episode_id,
    environment_id: episode.spec.profile.environment_id,
    spec: episode.spec,
    termination: reason,
    final_now: episode.clock.now,
    accepted_action_count: episode.accepted_actions.length,
    pending_observation_count: episode.pending.length,
    rewards: episode.rewards,
  });
  return ok({ episode: finished, result });
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

/**
 * The actor's highest accepted `client_sequence` in this episode, or `null`
 * if the actor has no accepted action yet. Pure scan of the accepted log.
 */
export function actorHighestSequence(episode: EpisodeState, actor: AgentInstanceId): number | null {
  let highest: number | null = null;
  for (const action of episode.accepted_actions) {
    if (action.actor === actor && (highest === null || action.client_sequence > highest)) {
      highest = action.client_sequence;
    }
  }
  return highest;
}

/** All reward signals visible at instant `at` (inclusive L4 boundary). */
export function visibleRewardsAt(episode: EpisodeState, at: TimestampMs): readonly RewardSignal[] {
  return episode.rewards.filter((reward) => (reward.available_time as number) <= (at as number));
}
