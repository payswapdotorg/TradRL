/**
 * @tradrl/environment-protocol — the Environment interface.
 *
 * THIS is the contract T009 (historical replay World) and T010 (exchange
 * simulation) implement, and the one `services/environment-runner` drives.
 * It is the five-operation step protocol of episode.ts keyed by episode id
 * — an environment is free to add world dynamics around it (observation
 * generation, action application, latency, fees) but the FIVE operations
 * and their failure modes are frozen here:
 *
 *   - `start(spec)` — begin an episode (validates the spec; derives the id).
 *   - `observe(episode, at)` — point-in-time delivery (L4, inclusive).
 *   - `submit(episode, action)` — REQUEST intake; validation only, NEVER
 *     authority (L8). Results return later as observations.
 *   - `advance(episode, to)` — monotonic, `<= asOf`.
 *   - `finish(episode, reason)` — terminal state + immutable result.
 *
 * An Environment may internally compose {@link createEpisodeStore} for its
 * bookkeeping (the reference StubEnvironment does exactly that), or reimplement
 * the invariants — `isEnvironment` checks only the operation surface.
 */

import type { EpisodeId } from './ids';
import type { TimestampMs } from './timestamp';
import type { Action } from './action';
import type { Observation } from './observation';
import type { EpisodeFinish, EpisodeState } from './episode';
import type { EnvironmentSpec } from './spec';
import type { EnvResult } from './errors';

/**
 * The mediating contract between an agent runtime and a MarketWorld under a
 * simulation clock. See module header. Implementations MUST:
 *   - police observation delivery with the inclusive L4 boundary;
 *   - reject clock regressions and advances past `asOf`;
 *   - never grant execution authority through `submit`;
 *   - keep episode state deterministic given the same spec and inputs (L9).
 */
export interface Environment {
  /** Begin an episode for a fully-validated spec; registers it under the derived id. */
  start(spec: EnvironmentSpec): EnvResult<EpisodeState>;
  /** PURE point-in-time query: the observations visible at `at` (inclusive boundary). */
  observe(episode: EpisodeId, at: TimestampMs): EnvResult<readonly Observation[]>;
  /** Submit an action request; accepted iff valid (envelope, causality, sequence). */
  submit(episode: EpisodeId, action: Action): EnvResult<EpisodeState>;
  /** Advance the episode clock (monotonic, `<= asOf`). */
  advance(episode: EpisodeId, to: TimestampMs): EnvResult<EpisodeState>;
  /** Finish the episode; returns the terminal state and the immutable result. */
  finish(episode: EpisodeId, reason: unknown): EnvResult<EpisodeFinish>;
}

/**
 * Structural runtime guard for the Environment operation surface: an object
 * carrying the five operations with function type. World implementers may
 * guard their own richer surfaces; this checks only the frozen contract.
 */
export function isEnvironment(value: unknown): value is Environment {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.start === 'function' &&
    typeof candidate.observe === 'function' &&
    typeof candidate.submit === 'function' &&
    typeof candidate.advance === 'function' &&
    typeof candidate.finish === 'function'
  );
}
