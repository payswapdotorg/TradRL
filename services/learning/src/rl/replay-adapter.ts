/**
 * @tradrl/learning (service) — the thin ReplayWorldService adapter.
 *
 * THE README CONTRACT (services/market-world/README.md, T013 row):
 * "T013 drives episodes through the five operations (the `WorldAdapter`
 * and the `ReplayWorldService` both satisfy `isEnvironment`
 * structurally), attaches ITS OWN reward functions to the recorded
 * trajectory (this world emits zero reward signals by design — L7), and
 * binds `ReplayRunRecord` (config hash, chain head, spec hash, digest)
 * into its experiment lineage."
 *
 * This module demonstrates exactly that, WITHOUT importing the
 * market-world service (D-003/D-004 — the replay lane is referenced only
 * through STRUCTURAL MIRRORS here):
 *
 *   - {@link ReplayWorldServiceShape} — the structural mirror of the five
 *     operations plus `loadAll` (the load-then-bind discipline) and
 *     `runRecord` (the L9 lineage source). Guarded by
 *     {@link isReplayWorldServiceShape} against untrusted values.
 *   - {@link replayServiceAsEnvironmentPort} — wraps a guarded service
 *     into the bridge's {@link EnvironmentPort}: the five operations pass
 *     straight through (the shapes are structurally compatible), failures
 *     keep their world-lane codes in the message.
 *   - {@link driveReplayEpisodeWithTrainer} — the full consumption flow:
 *     loadAll -> driveEpisode (the trainer's deterministic loop over the
 *     five operations) -> runRecord(episode) -> the raw world record the
 *     trial evidence binds.
 *
 * The replay adapter test (replay-adapter.test.ts) passes the REAL
 * `createReplayWorldService` from services/market-world into this flow —
 * the structural proof the README contract names.
 */

import {
  environmentFailure,
  extractWorldLineage,
  fail,
  isEnvironmentPort,
  isEpisodeResultView,
  isEpisodeView,
  ok,
  type ClockConfig,
  type EpisodeFinishView,
  type EpisodeId,
  type EpisodeResultView,
  type EpisodeView,
  type EnvironmentPort,
  type ObservationView,
  type PolicyPort,
  type RewardSignalEnvelope,
  type RLResult,
  type TerminationReason,
  type TimestampMs,
  type TrainerContract,
  type TrainingRunState,
  type WorldLineage,
} from '../../../../packages/rl-protocol/src/index';

// ---------------------------------------------------------------------------
// The structural mirror of the ReplayWorldService (NO import)
// ---------------------------------------------------------------------------

/** The replay lane's operation result shape (world-lane error codes preserved). */
export type ReplayResultMirror<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly path: string; readonly message: string }[] };

/**
 * The episode view the replay service hands its consumers (the bridge's
 * minimal view: episode id, clock, status, termination, reward envelopes —
 * the replay world's fuller views are structurally assignable TO this).
 */
export interface ReplayEpisodeViewShape {
  readonly episode_id: EpisodeId;
  readonly clock: ClockConfig;
  readonly status: 'running' | 'finished';
  readonly termination: TerminationReason | null;
  readonly rewards: readonly RewardSignalEnvelope[];
}

/** The finish product the replay service hands its consumers (the full result record). */
export interface ReplayFinishShape {
  readonly episode: ReplayEpisodeViewShape;
  readonly result: EpisodeResultView;
}

/**
 * The ReplayWorldService STRUCTURAL MIRROR: the five Environment operations
 * plus the load-then-bind source (`loadAll`) and the L9 lineage source
 * (`runRecord`). Everything the bridge consumes; nothing the replay lane
 * does not already expose.
 */
export interface ReplayWorldServiceShape {
  loadAll(): Promise<ReplayResultMirror<unknown>>;
  start(spec: unknown): ReplayResultMirror<ReplayEpisodeViewShape>;
  observe(episode: EpisodeId, at: TimestampMs): ReplayResultMirror<readonly ObservationView[]>;
  submit(episode: EpisodeId, action: unknown): ReplayResultMirror<ReplayEpisodeViewShape>;
  advance(episode: EpisodeId, to: TimestampMs): ReplayResultMirror<ReplayEpisodeViewShape>;
  finish(episode: EpisodeId, reason: unknown): ReplayResultMirror<ReplayFinishShape>;
  runRecord(episode: EpisodeId): ReplayResultMirror<unknown>;
}

/**
 * Structural guard for the ReplayWorldService mirror: an object carrying
 * the five operations plus `loadAll`/`runRecord` with function type. The
 * REAL service passes this guard (proven by the adapter test) — the
 * mirror never imports the real thing.
 */
export function isReplayWorldServiceShape(value: unknown): value is ReplayWorldServiceShape {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.loadAll === 'function' &&
    typeof candidate.start === 'function' &&
    typeof candidate.observe === 'function' &&
    typeof candidate.submit === 'function' &&
    typeof candidate.advance === 'function' &&
    typeof candidate.finish === 'function' &&
    typeof candidate.runRecord === 'function'
  );
}

// ---------------------------------------------------------------------------
// The port bridge
// ---------------------------------------------------------------------------

/**
 * Wrap a guarded ReplayWorldService-shaped value into the bridge's
 * EnvironmentPort. The five operations pass through structurally: the
 * replay lane's outputs are (checked, view-compatible) richer values; the
 * bridge's driver consumes only the view fields. Every world failure maps
 * onto the closed taxonomy's `environment_error` with the world's code
 * preserved in the message.
 */
export function replayServiceAsEnvironmentPort(service: ReplayWorldServiceShape): EnvironmentPort {
  const requireView = (result: ReplayResultMirror<ReplayEpisodeViewShape>): RLResult<EpisodeView> => {
    if (!result.ok) return environmentFailure(result.errors);
    if (!isEpisodeView(result.value)) {
      return fail('invalid_environment', 'the replay service returned a value that does not satisfy the episode view mirror');
    }
    return ok(result.value);
  };

  const port: EnvironmentPort = {
    start: (spec) => requireView(service.start(spec)),
    observe: (episode, at) => {
      const result = service.observe(episode, at);
      if (!result.ok) return environmentFailure(result.errors);
      return ok(result.value);
    },
    submit: (episode, action) => requireView(service.submit(episode, action)),
    advance: (episode, to) => requireView(service.advance(episode, to)),
    finish: (episode, reason): RLResult<EpisodeFinishView> => {
      const result = service.finish(episode, reason);
      if (!result.ok) return environmentFailure(result.errors);
      if (!isEpisodeView(result.value.episode) || !isEpisodeResultView(result.value.result)) {
        return fail('invalid_environment', 'the replay service finish product does not satisfy the view mirrors');
      }
      return ok(result.value);
    },
  };
  return port;
}

// ---------------------------------------------------------------------------
// The consumption flow (the README contract demo)
// ---------------------------------------------------------------------------

/** The outcome of one bridged replay episode: the recorded run + the world's L9 record. */
export interface ReplayBridgeOutcome {
  /** The run after the episode was driven and recorded. */
  readonly run: TrainingRunState;
  /** The driven episode (the run's last recorded line). */
  readonly episode: EpisodeId;
  /** The RAW ReplayRunRecord-shaped value (untrusted — bind through extractWorldLineage). */
  readonly world_record: unknown;
  /** The extracted L9 lineage: config hash, chain head, spec hash, digest. */
  readonly world_lineage: WorldLineage;
}

/**
 * Drive ONE episode of a run through a ReplayWorldService-shaped
 * environment (the README contract): guard the service structurally,
 * complete the load-then-bind phase (`loadAll`), drive through the
 * trainer's deterministic loop over the five operations, then pull the
 * episode's run record and extract the L9 lineage. The caller attaches
 * ITS OWN reward models to the recorded trajectory post-hoc (L7) and
 * collects the trial with this lineage bound.
 */
export async function driveReplayEpisodeWithTrainer(input: {
  readonly service: unknown;
  readonly trainer: TrainerContract;
  readonly run: TrainingRunState;
  readonly policy: PolicyPort;
}): Promise<RLResult<ReplayBridgeOutcome>> {
  if (!isReplayWorldServiceShape(input.service)) {
    return fail('invalid_environment', 'the replay service must structurally satisfy the ReplayWorldService mirror (five operations + loadAll + runRecord)');
  }
  const service = input.service;

  // Phase 1: the load-then-bind discipline (the stream loads fully first).
  const loaded = await service.loadAll();
  if (!loaded.ok) return environmentFailure(loaded.errors);

  // Phase 2: the five operations through the trainer's deterministic loop.
  const port = replayServiceAsEnvironmentPort(service);
  if (!isEnvironmentPort(port)) {
    return fail('invalid_environment', 'the wrapped replay service does not satisfy the EnvironmentPort (impossible by construction)');
  }
  const driven = input.trainer.driveEpisode(input.run, port, input.policy);
  if (!driven.ok) return driven;
  const run = driven.value;
  const episode = run.episodes[run.episodes.length - 1]?.episode;
  if (episode === undefined) {
    return fail('invalid_run_state', 'the driven run recorded no episode (impossible when driveEpisode succeeds)');
  }

  // Phase 3: the L9 lineage source — the episode's run record.
  const record = service.runRecord(episode);
  if (!record.ok) return environmentFailure(record.errors);
  const lineage = extractWorldLineage(record.value);
  if (!lineage.ok) return lineage;

  return ok({ run, episode, world_record: record.value, world_lineage: lineage.value });
}
