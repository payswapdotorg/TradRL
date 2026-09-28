/**
 * @tradrl/market-world (service) — the ReplayWorldService: the reference
 * driver that loads a recorded event stream into a replay world and drives
 * episodes through the environment-runner shapes.
 *
 * LAYERING (work order T009): the service composes the CONTRACT package —
 * it pulls batches from a pure {@link ReplayEventSource} (NO I/O in this WO;
 * fixture streams only — real sources are T008), applies the pure
 * `ingestWorld` transition per batch (transactional, digest-chained), and
 * then drives episodes through the {@link WorldAdapter} — the structural
 * Environment implementation (start/observe/submit/advance/finish).
 *
 * THE LOAD-THEN-BIND DISCIPLINE: the recorded stream loads FULLY before an
 * episode binds (ingestion closes at the first `start`). This is safe BY
 * DESIGN, not by caution: the L4 boundary withholds every future-dated
 * event, so holding the full history in the world state leaks nothing — and
 * it makes every episode a closed, fully-auditable run over the complete
 * recorded world. (Streaming ingestion mid-episode, for memory-bounded
 * histories at scale, is T008/T029 territory.)
 *
 * IMPORT NOTE: this service imports its contract package by RELATIVE path
 * (not a workspace dependency) because this Work Order's frozen write
 * surface permits only the prelude's lockfile regeneration — adding a
 * workspace edge would touch pnpm-lock.yaml beyond the prelude. The Lead
 * may convert this to `workspace:*` at the next serialized lockfile change.
 */

import {
  canonicalSpecJson,
  configHash,
  createWorldAdapter,
  fnv1a32Hex,
  initReplayWorld,
  ingestWorld,
  isTimestampMs,
  replayBaseStateFrom,
  type EpisodeId,
  type ReplayEpisodeFinish,
  type ReplayEpisodeView,
  type ReplaySubmission,
  type ReplayWorldConfig,
  type ReplayWorldState,
  type TimestampMs,
  type WorldAdapter,
  type WorldObservation,
  type WorldResult,
  fail,
  ok,
} from '../../../../packages/market-world/src/index';
import type { ReplayEventSource } from './event-source';
import { isReplayEventSource } from './event-source';
import {
  buildRunRecord,
  chainDigest,
  deserializeReplayRunState,
  emptyRunLog,
  untrustedBatchDigest,
  type ClockAdvance,
  type ReplayRunLog,
  type ReplayRunRecord,
  type ReplayRunState,
} from './run-state';

/** The outcome of one `loadNextBatch` call (full counters, always). */
export interface LoadOutcome {
  /** True when the source is exhausted (idempotent on further calls). */
  readonly done: boolean;
  readonly batches_consumed: number;
  readonly events_applied: number;
  readonly chain_head: string;
}

/** The summary of a completed load (`loadAll`). */
export interface LoadSummary {
  readonly batches: number;
  readonly events: number;
  readonly chain_head: string;
}

/**
 * The replay world service: loads the recorded stream, then drives episodes
 * through the five Environment operations (structural), and emits the L9
 * lineage record for every finished episode.
 */
export interface ReplayWorldService {
  /** The validated, fully-determining world config. */
  readonly config: ReplayWorldConfig;
  /** The config's deterministic digest (bound into every run record). */
  readonly config_hash: string;
  /** All registered episode ids, in registration order. */
  readonly episodes: readonly EpisodeId[];

  // --- Phase 1: load the recorded stream ----------------------------------
  /** Pull and apply ONE batch (transactional). Idempotent once done. */
  loadNextBatch(): Promise<WorldResult<LoadOutcome>>;
  /** Pull until the source is exhausted. */
  loadAll(): Promise<WorldResult<LoadSummary>>;

  // --- Phase 2: the episode protocol (Environment-shaped) ------------------
  /** Bind an episode spec to the loaded world (requires a fully loaded stream). */
  start(spec: unknown): WorldResult<ReplayEpisodeView>;
  /** PURE point-in-time query (L4, inclusive): observations visible at `at`. */
  observe(episode: EpisodeId, at: TimestampMs): WorldResult<readonly WorldObservation[]>;
  /** Record an action as an intent with a typed receipt (never a match). */
  submit(episode: EpisodeId, action: unknown): WorldResult<ReplaySubmission>;
  /** Advance the episode clock (monotonic, `<= episode asOf`). */
  advance(episode: EpisodeId, to: TimestampMs): WorldResult<ReplayEpisodeView>;
  /** Finish the episode: terminal state plus the immutable result. */
  finish(episode: EpisodeId, reason: unknown): WorldResult<ReplayEpisodeFinish>;

  // --- Lineage + resume ------------------------------------------------------
  /** The L9 lineage record of a FINISHED episode. */
  runRecord(episode: EpisodeId): WorldResult<ReplayRunRecord>;
  /** The serializable run state (resume artifact). With an episode id: that episode's line; without: the loading state. */
  exportRunState(episode?: EpisodeId): WorldResult<ReplayRunState>;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** Shared implementation core for create + resume. */
interface ServiceCore {
  readonly config: ReplayWorldConfig;
  readonly configHashValue: string;
  batchesConsumed: number;
  eventsApplied: number;
  ingestChain: string[];
  sourceDone: boolean;
  baseState: ReplayWorldState;
  adapter: WorldAdapter | null;
  runLogs: Map<string, ReplayRunLog>;
}

/** Create a replay world service from an untrusted config and a pure source. */
export function createReplayWorldService(config: unknown, source: ReplayEventSource): WorldResult<ReplayWorldService> {
  if (!isReplayEventSource(source)) {
    return fail('invalid_source', 'the event source must be an async iterable of event batches');
  }
  const world = initReplayWorld(config);
  if (!world.ok) return world;
  const core: ServiceCore = {
    config: world.value.config,
    configHashValue: configHash(world.value.config),
    batchesConsumed: 0,
    eventsApplied: 0,
    ingestChain: [],
    sourceDone: false,
    baseState: world.value,
    adapter: null,
    runLogs: new Map<string, ReplayRunLog>(),
  };
  return ok(buildService(core, source[Symbol.asyncIterator]()));
}

/**
 * Resume a service from a serialized run state. The source MUST be a fresh
 * iterable over the SAME recorded stream: the resumption fast-forwards past
 * `batches_consumed` batches, VERIFYING each one's digest against the
 * recorded ingest chain (a mismatched stream fails with
 * `resume_stream_mismatch` — a resumed run provably consumed the same
 * stream), then continues.
 */
export async function resumeReplayWorldService(state: unknown, source: ReplayEventSource): Promise<WorldResult<ReplayWorldService>> {
  if (!isReplayEventSource(source)) {
    return fail('invalid_source', 'the event source must be an async iterable of event batches');
  }
  const restored = deserializeReplayRunState(state);
  if (!restored.ok) return restored;
  const runState = restored.value;

  const iterator = source[Symbol.asyncIterator]();

  // Fast-forward with digest verification: re-pull every already-consumed
  // batch, envelope-validate and digest it, fold it onto the running chain
  // head (seeded from the config hash — the same fold the loader performs),
  // and compare against the recorded chain entry.
  let runningHead = configHash(runState.config);
  for (let index = 0; index < runState.batches_consumed; index++) {
    const pulled = await iterator.next();
    if (pulled.done) {
      return fail('resume_stream_mismatch', `the resumed source ended after ${index} batches but the run state consumed ${runState.batches_consumed}`);
    }
    const batch = pulled.value;
    if (!Array.isArray(batch)) {
      return fail('invalid_source', `resumed batch ${index} is not an array`);
    }
    const digest = untrustedBatchDigest(batch);
    const folded = digest === null ? null : fnv1a32Hex(`${runningHead}:${digest}`);
    const expected = runState.ingest_chain[index];
    if (folded === null || folded !== expected) {
      return fail('resume_stream_mismatch', `resumed batch ${index} does not match the recorded ingest chain (expected ${String(expected)}, got ${String(folded)})`);
    }
    runningHead = folded;
  }
  // If the run had exhausted its source, the resumed one must too.
  if (runState.source_done) {
    const tail = await iterator.next();
    if (!tail.done) {
      return fail('resume_stream_mismatch', 'the run state recorded an exhausted source but the resumed source has more batches');
    }
  }

  // Rebuild the core. Episodes re-register through the adapter (restore).
  const world = initReplayWorld(runState.config);
  if (!world.ok) return world;
  const core: ServiceCore = {
    config: runState.config,
    configHashValue: configHash(runState.config),
    batchesConsumed: runState.batches_consumed,
    eventsApplied: runState.world_state.history.length,
    ingestChain: [...runState.ingest_chain],
    sourceDone: runState.source_done,
    baseState: replayBaseStateFrom(runState.world_state),
    adapter: null,
    runLogs: new Map<string, ReplayRunLog>(),
  };
  if (runState.phase === 'episode') {
    const adapter = ensureAdapter(core);
    const restoredEpisode = adapter.restoreEpisode(runState.world_state);
    if (!restoredEpisode.ok) return restoredEpisode;
    core.runLogs.set(restoredEpisode.value, runState.run_log);
  }
  return ok(buildService(core, iterator));
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** The adapter is created lazily at first use, over the current base state. */
function ensureAdapter(core: ServiceCore): WorldAdapter {
  if (core.adapter === null) {
    core.adapter = createWorldAdapter(core.baseState);
  }
  return core.adapter;
}

function buildService(core: ServiceCore, iterator: AsyncIterator<readonly unknown[], void, undefined>): ReplayWorldService {
  const chainHead = (): string => (core.ingestChain.length > 0 ? core.ingestChain[core.ingestChain.length - 1] as string : core.configHashValue);

  const applyBatch = (batch: readonly unknown[]): WorldResult<{ events: number; head: string }> => {
    const ingested = ingestWorld(core.baseState, batch);
    if (!ingested.ok) return ingested;
    core.baseState = ingested.value;
    const validatedCount = batch.length;
    core.eventsApplied += validatedCount;
    core.batchesConsumed += 1;
    const head = chainDigest(chainHead(), ingested.value.history.slice(ingested.value.history.length - batch.length));
    core.ingestChain.push(head);
    return ok({ events: validatedCount, head });
  };

  const service: ReplayWorldService = {
    get config(): ReplayWorldConfig {
      return core.config;
    },
    get config_hash(): string {
      return core.configHashValue;
    },
    get episodes(): readonly EpisodeId[] {
      return core.adapter === null ? [] : core.adapter.episodes;
    },

    async loadNextBatch(): Promise<WorldResult<LoadOutcome>> {
      if (core.adapter !== null) {
        return fail('ingestion_closed', 'episodes have bound to this world; the stream is closed (load fully before start — see the load-then-bind discipline)');
      }
      if (core.sourceDone) {
        return ok({ done: true, batches_consumed: core.batchesConsumed, events_applied: core.eventsApplied, chain_head: chainHead() });
      }
      const pulled = await iterator.next();
      if (pulled.done) {
        core.sourceDone = true;
        return ok({ done: true, batches_consumed: core.batchesConsumed, events_applied: core.eventsApplied, chain_head: chainHead() });
      }
      const batch = pulled.value;
      if (!Array.isArray(batch)) {
        return fail('invalid_source', 'the event source yielded a non-array batch');
      }
      const applied = applyBatch(batch);
      if (!applied.ok) return applied;
      return ok({ done: false, batches_consumed: core.batchesConsumed, events_applied: core.eventsApplied, chain_head: applied.value.head });
    },

    async loadAll(): Promise<WorldResult<LoadSummary>> {
      for (;;) {
        const outcome = await service.loadNextBatch();
        if (!outcome.ok) return outcome;
        if (outcome.value.done) {
          return ok({ batches: core.batchesConsumed, events: core.eventsApplied, chain_head: chainHead() });
        }
      }
    },

    start(spec: unknown): WorldResult<ReplayEpisodeView> {
      if (!core.sourceDone) {
        return fail('ingestion_pending', 'the recorded stream is not fully loaded yet — call loadAll() before starting an episode (the load-then-bind discipline)');
      }
      const adapter = ensureAdapter(core);
      const started = adapter.start(spec);
      if (!started.ok) return started;
      core.runLogs.set(started.value.episode_id, emptyRunLog());
      return started;
    },

    observe(episode: EpisodeId, at: TimestampMs): WorldResult<readonly WorldObservation[]> {
      const adapter = core.adapter;
      if (adapter === null) return fail('unknown_episode', `episode ${episode} is not known to this service (no episode has started)`);
      if (!isTimestampMs(at)) {
        return fail('invalid_timestamp', 'observe requires a valid TimestampMs instant');
      }
      const visible = adapter.observe(episode, at);
      if (!visible.ok) return visible;
      const log = core.runLogs.get(episode);
      if (log !== undefined) {
        core.runLogs.set(episode, {
          advances: log.advances,
          observation_queries: log.observation_queries + 1,
          observations_served: log.observations_served + visible.value.length,
        });
      }
      return visible;
    },

    submit(episode: EpisodeId, action: unknown): WorldResult<ReplaySubmission> {
      const adapter = core.adapter;
      if (adapter === null) return fail('unknown_episode', `episode ${episode} is not known to this service (no episode has started)`);
      return adapter.submit(episode, action);
    },

    advance(episode: EpisodeId, to: TimestampMs): WorldResult<ReplayEpisodeView> {
      const adapter = core.adapter;
      if (adapter === null) return fail('unknown_episode', `episode ${episode} is not known to this service (no episode has started)`);
      if (!isTimestampMs(to)) {
        return fail('invalid_timestamp', 'advance requires a valid TimestampMs target');
      }
      const state = adapter.episodeState(episode);
      if (state === undefined) return fail('unknown_episode', `episode ${episode} is not known to this service`);
      const from = state.clock.now;
      const advanced = adapter.advance(episode, to);
      if (!advanced.ok) return advanced;
      const log = core.runLogs.get(episode);
      if (log !== undefined) {
        const entry: ClockAdvance = { from, to };
        core.runLogs.set(episode, { advances: [...log.advances, entry], observation_queries: log.observation_queries, observations_served: log.observations_served });
      }
      return advanced;
    },

    finish(episode: EpisodeId, reason: unknown): WorldResult<ReplayEpisodeFinish> {
      const adapter = core.adapter;
      if (adapter === null) return fail('unknown_episode', `episode ${episode} is not known to this service (no episode has started)`);
      return adapter.finish(episode, reason);
    },

    runRecord(episode: EpisodeId): WorldResult<ReplayRunRecord> {
      const adapter = core.adapter;
      if (adapter === null) return fail('unknown_episode', `episode ${episode} is not known to this service (no episode has started)`);
      const state = adapter.episodeState(episode);
      if (state === undefined) return fail('unknown_episode', `episode ${episode} is not known to this service`);
      const log = core.runLogs.get(episode) ?? emptyRunLog();
      const spec = state.spec;
      if (spec === null) return fail('invalid_state', 'episode state carries no bound spec');
      return buildRunRecord(core.config, core.configHashValue, state, chainHead(), core.batchesConsumed, log, fnv1a32Hex(canonicalSpecJson(spec)));
    },

    exportRunState(episode?: EpisodeId): WorldResult<ReplayRunState> {
      if (episode === undefined) {
        // The loading state (phase 1 artifact — mid-ingest resume).
        if (core.adapter !== null) {
          return fail('ingestion_closed', 'episodes have bound; export the run state OF an episode instead');
        }
        return ok({
          schema: 'tradrl/replay-run-state@1',
          phase: 'loading',
          config: core.config,
          batches_consumed: core.batchesConsumed,
          ingest_chain: [...core.ingestChain],
          source_done: core.sourceDone,
          world_state: core.baseState,
          run_log: emptyRunLog(),
        });
      }
      const adapter = core.adapter;
      if (adapter === null) return fail('unknown_episode', `episode ${episode} is not known to this service (no episode has started)`);
      const state = adapter.episodeState(episode);
      if (state === undefined) return fail('unknown_episode', `episode ${episode} is not known to this service`);
      const log = core.runLogs.get(episode) ?? emptyRunLog();
      return ok({
        schema: 'tradrl/replay-run-state@1',
        phase: 'episode',
        config: core.config,
        batches_consumed: core.batchesConsumed,
        ingest_chain: [...core.ingestChain],
        source_done: core.sourceDone,
        world_state: state,
        run_log: log,
      });
    },
  };
  return service;
}
