/**
 * @tradrl/environment-protocol — the episode store: the id-keyed mediator.
 *
 * The pure transitions in episode.ts operate on {@link EpisodeState} values.
 * Real runtimes (and the reference `EpisodeRunner`) mediate BY ID: an agent
 * runtime holds an episode id, the environment holds the states. The store
 * is that mediation shell: it keys episodes by {@link EpisodeId} and
 * forwards every step-protocol operation, adding exactly ONE new failure
 * mode — `unknown_episode` (the id is not registered).
 *
 * The store is deliberately THIN: it owns no world dynamics. World
 * implementers (T009 replay, T010 exchange sim) compose it exactly the way
 * `services/environment-runner/src/stub.ts` does: keep a store, generate
 * observations/rewards from world state, and forward the protocol
 * operations. The store's internal registry is runtime state (a Map), never
 * serialized — the durable artifacts are the states and the step traces.
 */

import { fail, ok, type EnvResult } from './errors';
import type { EpisodeId } from './ids';
import type { TimestampMs } from './timestamp';
import type { Observation } from './observation';
import type { EpisodeFinish, EpisodeState } from './episode';
import {
  advanceEpisode,
  emitObservations,
  emitRewardSignals,
  finishEpisode,
  observeEpisode,
  startEpisode,
  submitAction,
} from './episode';

/**
 * The id-keyed episode mediator (see module header). All operations return
 * {@link EnvResult}; all states it hands out are deeply frozen values.
 */
export interface EpisodeStore {
  /** Start an episode from a spec and register it under its derived id. */
  start(spec: unknown): EnvResult<EpisodeState>;
  /** The world offers observations to a registered episode. */
  emit(episode: EpisodeId, observations: readonly unknown[]): EnvResult<EpisodeState>;
  /** The world emits reward signals into a registered episode. */
  emitRewards(episode: EpisodeId, signals: readonly unknown[]): EnvResult<EpisodeState>;
  /** PURE point-in-time query (L4): the observations visible at `at`. */
  observe(episode: EpisodeId, at: TimestampMs): EnvResult<readonly Observation[]>;
  /** Submit an action REQUEST (validation only, no authority — L8). */
  submit(episode: EpisodeId, action: unknown): EnvResult<EpisodeState>;
  /** Advance the episode clock (monotonic, `<= asOf`). */
  advance(episode: EpisodeId, to: TimestampMs): EnvResult<EpisodeState>;
  /** Finish the episode: terminal state plus the immutable result. */
  finish(episode: EpisodeId, reason: unknown): EnvResult<EpisodeFinish>;
  /** Snapshot lookup: the current state of a registered episode. */
  get(episode: EpisodeId): EpisodeState | undefined;
  /** All registered episode ids, in registration (start) order. */
  readonly episodes: readonly EpisodeId[];
}

/**
 * Create an empty episode store. One store mediates many episodes; each
 * `start` registers a new one under its deterministically derived id.
 */
export function createEpisodeStore(): EpisodeStore {
  const states = new Map<string, EpisodeState>();

  const lookup = (episode: EpisodeId): EnvResult<EpisodeState> => {
    const state = states.get(episode);
    if (state === undefined) {
      return fail('unknown_episode', `episode ${episode} is not known to this store`);
    }
    return ok(state);
  };

  return {
    start(spec: unknown): EnvResult<EpisodeState> {
      const startResult = startEpisode(spec);
      if (!startResult.ok) return startResult;
      const state = startResult.value;
      states.set(state.episode_id, state);
      return ok(state);
    },
    emit(episode: EpisodeId, observations: readonly unknown[]): EnvResult<EpisodeState> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const emitted = emitObservations(found.value, observations);
      if (emitted.ok) states.set(episode, emitted.value);
      return emitted;
    },
    emitRewards(episode: EpisodeId, signals: readonly unknown[]): EnvResult<EpisodeState> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const emitted = emitRewardSignals(found.value, signals);
      if (emitted.ok) states.set(episode, emitted.value);
      return emitted;
    },
    observe(episode: EpisodeId, at: TimestampMs): EnvResult<readonly Observation[]> {
      const found = lookup(episode);
      if (!found.ok) return found;
      return observeEpisode(found.value, at);
    },
    submit(episode: EpisodeId, action: unknown): EnvResult<EpisodeState> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const submitted = submitAction(found.value, action);
      if (submitted.ok) states.set(episode, submitted.value);
      return submitted;
    },
    advance(episode: EpisodeId, to: TimestampMs): EnvResult<EpisodeState> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const advanced = advanceEpisode(found.value, to);
      if (advanced.ok) states.set(episode, advanced.value);
      return advanced;
    },
    finish(episode: EpisodeId, reason: unknown): EnvResult<EpisodeFinish> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const finished = finishEpisode(found.value, reason);
      if (finished.ok) states.set(episode, finished.value.episode);
      return finished;
    },
    get(episode: EpisodeId): EpisodeState | undefined {
      return states.get(episode);
    },
    get episodes(): readonly EpisodeId[] {
      return [...states.keys()] as EpisodeId[];
    },
  };
}
