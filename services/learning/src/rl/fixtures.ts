/**
 * @tradrl/learning (service) — the scripted fixture World.
 *
 * A tiny in-memory reference environment for the trainer's tests and demos:
 * it satisfies @tradrl/environment-protocol's `Environment` FIVE-OPERATION
 * surface STRUCTURALLY (full observation envelopes with provenance, full
 * episode views, world-emitted reward signals with `episode_id` — the REAL
 * package's `isEnvironment` guard accepts it, proven in trainer.test.ts),
 * WITHOUT importing any world implementation (the work order's fixture
 * law). Everything is deterministic given (options, operation order).
 *
 * The scripted universe: `ticks` observations, tick i available exactly at
 * `baseTime + (i+1) * stepMs` (origin `simulated` — a TradRL world, never
 * real-world truth, L5); one `scripted-tick` reward per advance when
 * `emitRewards` (the WORLD channel — explicit, never fabricated); submitted
 * actions are validated and recorded (requests, never authority, L8).
 */

import {
  deepFreeze,
  fnv1a32Hex,
  isNonEmptyString,
  isRecord,
  isTerminationCode,
  isTimestampMs as protocolIsTimestampMs,
  ok,
  validateEnvironmentSpec,
  type ActionRecord,
  type AgentInstanceId,
  type ClockConfig,
  type EnvironmentSpec,
  type EpisodeId,
  type EpisodeResultView,
  type JsonValue,
  type ObservationId,
  type RewardId,
  type TerminationReason,
  type TimestampMs,
} from '../../../../packages/rl-protocol/src/index';

// ---------------------------------------------------------------------------
// The scripted shapes (structurally the environment-protocol envelopes)
// ---------------------------------------------------------------------------

/** A full observation envelope (the real Observation shape, origin 'simulated'). */
export interface ScriptedObservation {
  readonly observation_id: ObservationId;
  readonly available_time: TimestampMs;
  readonly venue: null;
  readonly instrument: null;
  readonly payload: JsonValue;
  readonly provenance: { readonly origin: 'simulated'; readonly source: string; readonly derived_from: readonly string[] };
}

/** A world-emitted reward signal (the real RewardSignal shape, episode-bound). */
export interface ScriptedRewardSignal {
  readonly reward_id: RewardId;
  readonly episode_id: EpisodeId;
  readonly at: TimestampMs;
  readonly available_time: TimestampMs;
  readonly value: number;
  readonly metric: string;
  readonly source: string;
  readonly detail: null;
}

/** The scripted episode view (structurally the real EpisodeState). */
export interface ScriptedEpisodeView {
  readonly episode_id: EpisodeId;
  readonly spec: EnvironmentSpec;
  readonly clock: ClockConfig;
  readonly status: 'running' | 'finished';
  readonly termination: TerminationReason | null;
  readonly pending: readonly ScriptedObservation[];
  readonly accepted_actions: readonly ActionRecord[];
  readonly rewards: readonly ScriptedRewardSignal[];
}

/** The world's operation result (structurally EnvResult). */
export type ScriptedResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly path: string; readonly message: string }[] };

/** The scripted environment: the five operations (structurally an Environment). */
export interface ScriptedEnvironment {
  start(spec: unknown): ScriptedResult<ScriptedEpisodeView>;
  observe(episode: EpisodeId, at: TimestampMs): ScriptedResult<readonly ScriptedObservation[]>;
  submit(episode: EpisodeId, action: unknown): ScriptedResult<ScriptedEpisodeView>;
  advance(episode: EpisodeId, to: TimestampMs): ScriptedResult<ScriptedEpisodeView>;
  finish(episode: EpisodeId, reason: unknown): ScriptedResult<{ readonly episode: ScriptedEpisodeView; readonly result: EpisodeResultView }>;
}

/** Options of the scripted universe (every choice derives from them). */
export interface ScriptedWorldOptions {
  /** The world seed — the episode id and every draw derive from it. */
  readonly seed: string;
  /** Epoch-ms instant of the first tick's availability window start. */
  readonly baseTime: number;
  /** The information anchor (`asOf` of every spec this world serves). */
  readonly asOf: number;
  /** Milliseconds between consecutive tick availabilities. */
  readonly stepMs: number;
  /** Number of scripted observations. */
  readonly ticks: number;
  /** Whether each advance emits one world reward signal (the world channel). */
  readonly emitRewards: boolean;
}

/** Resolve options with defaults (explicit fields win). */
export function scriptedWorldOptions(overrides: Partial<ScriptedWorldOptions> = {}): ScriptedWorldOptions {
  return {
    seed: overrides.seed ?? 'scripted-seed-alpha',
    baseTime: overrides.baseTime ?? 1_700_000_000_000,
    asOf: overrides.asOf ?? (overrides.baseTime ?? 1_700_000_000_000) + 3_000,
    stepMs: overrides.stepMs ?? 100,
    ticks: overrides.ticks ?? 12,
    emitRewards: overrides.emitRewards ?? true,
  };
}

// ---------------------------------------------------------------------------
// The scripted world
// ---------------------------------------------------------------------------

/**
 * Create a fresh scripted environment. One instance serves ONE episode
 * (the world's start refuses a second binding — the same law a real world
 * enforces); drive it through the trainer or the EpisodeDriver.
 */
export function createScriptedEnvironment(options: ScriptedWorldOptions): ScriptedEnvironment {
  let spec: EnvironmentSpec | null = null;
  let episode: EpisodeId | null = null;
  let clock: ClockConfig = deepFreeze({
    now: options.baseTime as TimestampMs,
    asOf: options.asOf as TimestampMs,
    playbackSpeed: 1,
    paused: false,
    fidelity: 'exact_replay',
    informationPolicy: 'point-in-time',
  });
  let status: 'running' | 'finished' = 'running';
  let termination: TerminationReason | null = null;
  const rewards: ScriptedRewardSignal[] = [];
  const accepted: ActionRecord[] = [];
  let lastSequence: number | null = null;

  const tickObservation = (index: number): ScriptedObservation => {
    const available = (options.baseTime + (index + 1) * options.stepMs) as TimestampMs;
    return deepFreeze({
      observation_id: `obs-scripted-${options.seed}-${index}` as ObservationId,
      available_time: available,
      venue: null,
      instrument: null,
      payload: deepFreeze({ kind: 'tick', index, seed: options.seed }) as JsonValue,
      provenance: deepFreeze({ origin: 'simulated', source: 'scripted-fixture', derived_from: [] }),
    });
  };

  const pending = (): readonly ScriptedObservation[] => {
    const all: ScriptedObservation[] = [];
    for (let index = 0; index < options.ticks; index++) all.push(tickObservation(index));
    return all;
  };

  const view = (): ScriptedEpisodeView =>
    deepFreeze({
      episode_id: episode as EpisodeId,
      spec: spec as EnvironmentSpec,
      clock,
      status,
      termination,
      pending: pending(),
      accepted_actions: [...accepted],
      rewards: [...rewards],
    });

  const lookup = (id: EpisodeId): ScriptedResult<true> => {
    if (id !== episode || episode === null) {
      return { ok: false, errors: [{ code: 'unknown_episode', path: '', message: `episode ${id} is not known to the scripted world` }] };
    }
    return { ok: true, value: true };
  };

  return {
    start(candidate: unknown): ScriptedResult<ScriptedEpisodeView> {
      if (spec !== null) {
        return { ok: false, errors: [{ code: 'duplicate_episode', path: '', message: 'the scripted world serves one episode' }] };
      }
      const specResult = validateEnvironmentSpec(candidate);
      if (!specResult.ok) return specResult as ScriptedResult<ScriptedEpisodeView>;
      spec = specResult.value;
      episode = `ep-scripted-${fnv1a32Hex(options.seed)}` as EpisodeId;
      clock = deepFreeze({ ...clock, now: spec.profile.clock.now, asOf: spec.profile.clock.asOf });
      return { ok: true, value: view() };
    },

    observe(id: EpisodeId, at: TimestampMs): ScriptedResult<readonly ScriptedObservation[]> {
      const found = lookup(id);
      if (!found.ok) return found;
      if (!protocolIsTimestampMs(at)) {
        return { ok: false, errors: [{ code: 'invalid_timestamp', path: '', message: 'observe requires a valid TimestampMs' }] };
      }
      if ((at as number) > (clock.now as number)) {
        return { ok: false, errors: [{ code: 'observation_beyond_now', path: '', message: `at ${at} exceeds now ${clock.now}` }] };
      }
      // THE INCLUSIVE L4 BOUNDARY (the world is the enforcement point).
      const visible: ScriptedObservation[] = [];
      for (let index = 0; index < options.ticks; index++) {
        const observation = tickObservation(index);
        if ((observation.available_time as number) <= (at as number)) visible.push(observation);
      }
      return { ok: true, value: visible };
    },

    submit(id: EpisodeId, action: unknown): ScriptedResult<ScriptedEpisodeView> {
      const found = lookup(id);
      if (!found.ok) return found;
      if (status === 'finished') {
        return { ok: false, errors: [{ code: 'episode_finished', path: '', message: 'the scripted episode is finished' }] };
      }
      if (!isRecord(action)) {
        return { ok: false, errors: [{ code: 'invalid_action', path: 'action', message: 'must be an object' }] };
      }
      const actionId = action.action_id;
      const actor = action.actor;
      const submittedAt = action.submitted_at;
      const sequence = action.client_sequence;
      if (typeof actionId !== 'string' || actionId.length === 0) {
        return { ok: false, errors: [{ code: 'invalid_action', path: 'action.action_id', message: 'must be a non-empty string' }] };
      }
      if (typeof actor !== 'string' || (actor as string).length === 0) {
        return { ok: false, errors: [{ code: 'invalid_action', path: 'action.actor', message: 'must be a non-empty string' }] };
      }
      if (!protocolIsTimestampMs(submittedAt)) {
        return { ok: false, errors: [{ code: 'invalid_action', path: 'action.submitted_at', message: 'must be a valid TimestampMs' }] };
      }
      if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) {
        return { ok: false, errors: [{ code: 'invalid_action', path: 'action.client_sequence', message: 'must be a non-negative safe integer' }] };
      }
      if ((submittedAt as number) > (clock.now as number)) {
        return { ok: false, errors: [{ code: 'action_from_future', path: '', message: 'submitted_at is after now' }] };
      }
      if (lastSequence !== null && sequence <= lastSequence) {
        return { ok: false, errors: [{ code: 'stale_sequence', path: '', message: 'client_sequence is not increasing' }] };
      }
      lastSequence = sequence;
      accepted.push(
        deepFreeze({
          action_id: actionId as ActionRecord['action_id'],
          actor: actor as AgentInstanceId,
          submitted_at: submittedAt as TimestampMs,
          client_sequence: sequence,
          payload: (action.payload ?? null) as JsonValue,
        }),
      );
      return { ok: true, value: view() };
    },

    advance(id: EpisodeId, to: TimestampMs): ScriptedResult<ScriptedEpisodeView> {
      const found = lookup(id);
      if (!found.ok) return found;
      if (status === 'finished') {
        return { ok: false, errors: [{ code: 'episode_finished', path: '', message: 'the scripted episode is finished' }] };
      }
      if (!protocolIsTimestampMs(to)) {
        return { ok: false, errors: [{ code: 'invalid_timestamp', path: '', message: 'advance requires a valid TimestampMs' }] };
      }
      if ((to as number) < (clock.now as number)) {
        return { ok: false, errors: [{ code: 'clock_regression', path: '', message: 'the clock may not move backwards' }] };
      }
      if ((to as number) > (clock.asOf as number)) {
        return { ok: false, errors: [{ code: 'beyond_as_of', path: '', message: 'the clock may not advance past asOf' }] };
      }
      clock = deepFreeze({ ...clock, now: to });
      if (options.emitRewards) {
        rewards.push(
          deepFreeze({
            reward_id: `rw-scripted-${rewards.length}` as RewardId,
            episode_id: episode as EpisodeId,
            at: to,
            available_time: to,
            value: -0.25,
            metric: 'scripted-tick',
            source: 'scripted-fixture',
            detail: null,
          }),
        );
      }
      return { ok: true, value: view() };
    },

    finish(id: EpisodeId, reason: unknown): ScriptedResult<{ readonly episode: ScriptedEpisodeView; readonly result: EpisodeResultView }> {
      const found = lookup(id);
      if (!found.ok) return found;
      if (status === 'finished') {
        return { ok: false, errors: [{ code: 'episode_finished', path: '', message: 'already finished' }] };
      }
      if (
        !isRecord(reason) ||
        !isTerminationCode(reason.code) ||
        !isNonEmptyString(reason.detail)
      ) {
        return { ok: false, errors: [{ code: 'invalid_termination', path: '', message: 'malformed termination reason' }] };
      }
      status = 'finished';
      termination = deepFreeze({ code: reason.code, detail: reason.detail as string });
      const finalView = view();
      const result: EpisodeResultView = deepFreeze({
        episode_id: episode as EpisodeId,
        environment_id: (spec as EnvironmentSpec).profile.environment_id,
        spec: spec as EnvironmentSpec,
        termination: termination as TerminationReason,
        final_now: clock.now,
        accepted_action_count: accepted.length,
        pending_observation_count: options.ticks,
        rewards: [...rewards],
      });
      return { ok: true, value: { episode: finalView, result } };
    },
  };
}

/** The scripted world's deterministic episode id for a seed (test oracle). */
export function scriptedEpisodeId(seed: string): EpisodeId {
  return `ep-scripted-${fnv1a32Hex(seed)}` as EpisodeId;
}

/** Convenience: unwrap a scripted result (tests only — failures are fixture bugs). */
export function unwrapScripted<T>(result: ScriptedResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`scripted fixture failure: ${JSON.stringify(result.errors)}`);
}

