/**
 * @tradrl/environment-runner — the StubEnvironment.
 *
 * A tiny in-memory reference World used by the runner tests and meant as a
 * READ-ME-FIRST TEMPLATE for T009 (historical replay) and T010 (exchange
 * simulation) implementers. The composition recipe it demonstrates:
 *
 *   1. Keep an `EpisodeStore` (the protocol's id-keyed mediation shell) —
 *      it owns ALL protocol bookkeeping: episode lifecycle, the inclusive
 *      visibility boundary, action validation, clock monotonicity.
 *   2. Add world dynamics around the store's transitions: generate
 *      observations and rewards deterministically from the spec's SEED
 *      (`seededDraw`), and turn accepted actions into RESULT observations
 *      that ride the observation channel with their own `available_time`
 *      (here: a fixed 1 ms latency).
 *   3. Never grant authority: `submit` forwards to the store's
 *      validation-only intake (L8). The stub's action results are REPORTS,
 *      not executions.
 *
 * The stub's synthetic stream, per advance to `to`:
 *   - one `tick` observation (available exactly at `to`, value drawn from
 *     (seed, episode, tick-index) — stateless, order-independent);
 *   - every second tick, a DERIVED `mean` observation over the last two
 *     ticks (available at `to` + 1 ms — a computation delay, so its
 *     visibility demonstrably lags its inputs);
 *   - one `stub-tick` reward signal per tick (explicit metric, value drawn
 *     from the same seed stream — never interpreted by the protocol);
 *   - per accepted action, a derived `action-result` observation available
 *     at `submitted_at + 1` (the stub's latency model).
 *
 * Everything is deterministic given (spec, seed, operation order): two
 * fresh stub instances driven by the same spec and policy produce identical
 * streams (proven byte-for-byte by the runner tests).
 */

import { deepFreeze } from '../../../packages/environment-protocol/src/index';
import type {
  Action,
  EnvResult,
  Environment,
  EpisodeFinish,
  EpisodeId,
  EpisodeState,
  EnvironmentSpec,
  Observation,
  TimestampMs,
} from '../../../packages/environment-protocol/src/index';
import { createEpisodeStore } from '../../../packages/environment-protocol/src/index';
import { seededDraw } from './seeded';

/** The stub's action-result latency in epoch milliseconds. */
export const STUB_RESULT_LATENCY_MS = 1;

/** Round a draw to 6 decimals — keeps JSON byte-comparisons stable. */
function roundedDraw(seed: string, scope: string, index: number): number {
  return Math.round(seededDraw(seed, scope, index) * 1e6) / 1e6;
}

/** The runner's documented action-payload convention: `{ kind, body }`. */
function actionKindOf(action: Action): string | null {
  const payload: unknown = action.payload;
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const kind: unknown = (payload as Record<string, unknown>).kind;
    if (typeof kind === 'string' && kind.length > 0) return kind;
  }
  return null;
}

/**
 * Create a fresh StubEnvironment. One instance may mediate many episodes;
 * per-episode state (tick counters) is keyed by episode id and derived from
 * the episode's own spec seed, so episode streams never interfere.
 */
export function createStubEnvironment(): Environment {
  const store = createEpisodeStore();
  const tickCounts = new Map<string, number>();

  const nextTickIndex = (episodeId: EpisodeId): number => {
    const next = (tickCounts.get(episodeId) ?? 0) + 1;
    tickCounts.set(episodeId, next);
    return next;
  };

  /** The synthetic observations the world publishes for one advance. */
  const tickObservations = (
    episodeId: EpisodeId,
    seed: string,
    tickIndex: number,
    availableAt: TimestampMs,
    priorValue: number | null,
  ): readonly Record<string, unknown>[] => {
    const value = roundedDraw(seed, `${episodeId}:tick`, tickIndex);
    const observations: Record<string, unknown>[] = [
      {
        observation_id: `tick-${tickIndex}`,
        available_time: availableAt,
        venue: 'STUB',
        instrument: 'STUB-1',
        payload: { tick: tickIndex, value },
        provenance: { origin: 'simulated', source: 'stub-world', derived_from: [] },
      },
    ];
    if (priorValue !== null) {
      // Every second tick also publishes a derived mean over the last two
      // ticks, one millisecond later (computation delay).
      observations.push({
        observation_id: `mean-${tickIndex}`,
        available_time: (availableAt as number) + STUB_RESULT_LATENCY_MS,
        venue: 'STUB',
        instrument: 'STUB-1',
        payload: { mean: (priorValue + value) / 2 },
        provenance: { origin: 'simulated', source: 'stub-mean-agg', derived_from: [`tick-${tickIndex - 1}`, `tick-${tickIndex}`] },
      });
    }
    return observations;
  };

  return {
    start(spec: EnvironmentSpec): EnvResult<EpisodeState> {
      const started = store.start(spec);
      if (started.ok) tickCounts.set(started.value.episode_id, 0);
      return started;
    },

    observe(episode: EpisodeId, at: TimestampMs): EnvResult<readonly Observation[]> {
      return store.observe(episode, at);
    },

    submit(episode: EpisodeId, action: Action): EnvResult<EpisodeState> {
      const submitted = store.submit(episode, action);
      if (!submitted.ok) return submitted;
      // The action's RESULT rides the observation channel: a derived
      // observation, available after the stub's latency. The environment
      // REPORTS results; it never executes or authorizes (L8).
      const resultObservation = deepFreeze({
        observation_id: `${action.action_id}:result`,
        available_time: (action.submitted_at as number) + STUB_RESULT_LATENCY_MS,
        venue: 'STUB',
        instrument: 'STUB-1',
        payload: { accepted: true, kind: actionKindOf(action) },
        provenance: {
          origin: 'simulated',
          source: 'stub-world',
          derived_from: [action.action_id],
        },
      });
      return store.emit(episode, [resultObservation]);
    },

    advance(episode: EpisodeId, to: TimestampMs): EnvResult<EpisodeState> {
      const before = store.get(episode);
      if (before === undefined) {
        return { ok: false, errors: [{ code: 'unknown_episode', path: '', message: `episode ${episode} is not known to this environment` }] };
      }
      const advanced = store.advance(episode, to);
      if (!advanced.ok) return advanced;

      // Generate the world's synthetic stream for the interval (old_now, to].
      const seed = before.spec.profile.seed;
      const priorTickIndex = tickCounts.get(episode) ?? 0;
      const priorValue = priorTickIndex > 0 ? roundedDraw(seed, `${episode}:tick`, priorTickIndex) : null;
      const tickIndex = nextTickIndex(episode);
      const emissions = tickObservations(episode, seed, tickIndex, to, priorValue);

      const emitted = store.emit(episode, emissions);
      if (!emitted.ok) return emitted;

      // One explicit reward signal per tick (metric named, value seeded;
      // the protocol never interprets it).
      const rewarded = store.emitRewards(episode, [
        {
          reward_id: `rw-${tickIndex}`,
          episode_id: episode,
          at: to,
          available_time: to,
          value: roundedDraw(seed, `${episode}:reward`, tickIndex),
          metric: 'stub-tick',
          source: 'stub-world',
          detail: null,
        },
      ]);
      return rewarded;
    },

    finish(episode: EpisodeId, reason: unknown): EnvResult<EpisodeFinish> {
      return store.finish(episode, reason);
    },
  };
}
