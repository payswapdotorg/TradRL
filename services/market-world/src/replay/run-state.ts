/**
 * @tradrl/market-world (service) — the ReplayRunRecord (L9 lineage) and the
 * resumable ReplayRunState.
 *
 * THE RUN RECORD binds the full lineage of one replay episode: the world
 * config digest, the stream identity (per-stream keys + ingest-chain head),
 * the event count, the clock timeline (every advance, in order), the
 * complete ordered intent log, and the observation bookkeeping — closed by
 * the record's own digest. Two runs from identical config + stream + driver
 * behavior produce DEEPLY EQUAL records (JSON.stringify comparison —
 * acceptance criterion 3); a run resumed from a serialized state finishes
 * with the identical record (criterion 9).
 *
 * THE INGEST CHAIN: every applied batch is digested (FNV-1a 32 over the
 * canonical JSON of its validated events — key-order-insensitive) and
 * chained onto the previous digest, seeded from the config hash. The chain
 * head therefore binds config + stream + order. Resume re-pulls the source,
 * verifies each historical batch's digest against the chain and only then
 * continues — a resumed run PROVABLY consumed the same stream.
 *
 * ZERO non-determinism: no wall clock, no Math.random, no process data —
 * every field derives from the config, the stream, and the driver's
 * operations.
 */

import {
  canonicalJson,
  deepFreeze,
  deriveEpisodeId,
  deserializeReplayWorldState,
  fnv1a32Hex,
  isJsonValue,
  isNonNegativeSafeInteger,
  isRecord,
  isTerminationReason,
  isWorldEvent,
  validateWorldConfig,
  validateWorldEvent,
  type EpisodeId,
  type IntentReceipt,
  type JsonValue,
  type ReplayWorldConfig,
  type ReplayWorldState,
  type TimestampMs,
  type WorldEvent,
  type WorldResult,
  fail,
  ok,
} from '../../../../packages/market-world/src/index';

// ---------------------------------------------------------------------------
// The ingest digest chain
// ---------------------------------------------------------------------------

/** Canonical JSON of one validated event (key-order-insensitive). */
function canonicalEventJson(event: WorldEvent): string {
  const json: unknown = event;
  if (!isJsonValue(json)) {
    throw new Error('digest: a validated event is not JSON (impossible by validation)');
  }
  return canonicalJson(json);
}

/** The digest of one applied batch (over its validated events). */
export function batchDigest(batch: readonly WorldEvent[]): string {
  return fnv1a32Hex(batch.map(canonicalEventJson).join('\n'));
}

/**
 * Fold a batch digest onto the chain. The chain is seeded from the config
 * hash, so the head binds config + every batch, in order.
 */
export function chainDigest(previousHead: string, batch: readonly WorldEvent[]): string {
  return fnv1a32Hex(`${previousHead}:${batchDigest(batch)}`);
}

/**
 * Digest an UNTRUSTED batch for resume verification: every record must pass
 * the world's envelope validation, then digest identically to the recorded
 * chain entry. Returns `null` when any record is invalid (the caller maps
 * that to `resume_stream_mismatch`).
 */
export function untrustedBatchDigest(batch: readonly unknown[]): string | null {
  const validated: WorldEvent[] = [];
  for (const record of batch) {
    const result = validateWorldEvent(record);
    if (!result.ok) return null;
    validated.push(result.value);
  }
  return batchDigest(validated);
}

// ---------------------------------------------------------------------------
// The run record (L9)
// ---------------------------------------------------------------------------

/** One clock transition in the timeline: an advance call, from → to. */
export interface ClockAdvance {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** The world block of a run record. */
export interface RunRecordWorld {
  readonly world_id: string;
  readonly config_hash: string;
  readonly fidelity: string;
  readonly seed: string;
  readonly as_of: TimestampMs;
  readonly streams: readonly string[];
  readonly playback_speed: number;
}

/** The episode block of a run record. */
export interface RunRecordEpisode {
  readonly episode_id: EpisodeId;
  readonly environment_id: string;
  readonly spec_hash: string;
  readonly termination: { readonly code: string; readonly detail: string };
  readonly final_now: TimestampMs;
}

/** The ingestion block of a run record. */
export interface RunRecordIngestion {
  readonly batches: number;
  readonly events: number;
  readonly snapshot_count: number;
  readonly streams_seen: readonly string[];
  readonly chain_head: string;
}

/** The observation bookkeeping of a run record. */
export interface RunRecordObservations {
  readonly queries: number;
  readonly served: number;
}

/** The full lineage record of one finished replay episode (see module header). */
export interface ReplayRunRecord {
  readonly schema: 'tradrl/replay-run-record@1';
  readonly world: RunRecordWorld;
  readonly episode: RunRecordEpisode;
  readonly ingestion: RunRecordIngestion;
  readonly clock_timeline: readonly ClockAdvance[];
  readonly intent_log: readonly IntentReceipt[];
  readonly observations: RunRecordObservations;
  /** The record's own digest (over the canonical record without the digest field). */
  readonly digest: string;
}

/** Runtime guard for a run record. */
export function isReplayRunRecord(value: unknown): value is ReplayRunRecord {
  if (!isRecord(value)) return false;
  if (value.schema !== 'tradrl/replay-run-record@1') return false;
  for (const block of ['world', 'episode', 'ingestion', 'observations'] as const) {
    if (!isRecord(value[block])) return false;
  }
  if (!Array.isArray(value.clock_timeline) || !Array.isArray(value.intent_log)) return false;
  if (typeof value.digest !== 'string' || value.digest.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The per-episode run log (service bookkeeping that feeds the record)
// ---------------------------------------------------------------------------

/** The mutable-across-calls, serializable log of one episode's operations. */
export interface ReplayRunLog {
  readonly advances: readonly ClockAdvance[];
  readonly observation_queries: number;
  readonly observations_served: number;
}

/** The empty run log of a fresh episode. */
export function emptyRunLog(): ReplayRunLog {
  return deepFreeze({ advances: [], observation_queries: 0, observations_served: 0 });
}

/** Runtime guard for a run log. */
export function isReplayRunLog(value: unknown): value is ReplayRunLog {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.advances)) return false;
  if (!value.advances.every((advance) => isRecord(advance) && typeof advance.from === 'number' && typeof advance.to === 'number')) return false;
  if (!isNonNegativeSafeInteger(value.observation_queries)) return false;
  if (!isNonNegativeSafeInteger(value.observations_served)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The serializable run state (the resume artifact)
// ---------------------------------------------------------------------------

/** The resumable state of one service run: the world + ONE episode's line. */
export interface ReplayRunState {
  readonly schema: 'tradrl/replay-run-state@1';
  /** `loading` (no episode bound yet) or `episode` (an episode run line). */
  readonly phase: 'loading' | 'episode';
  readonly config: ReplayWorldConfig;
  readonly batches_consumed: number;
  /** The per-batch ingest chain (entry i = chain head after batch i). */
  readonly ingest_chain: readonly string[];
  /** Whether the source was exhausted at export time. */
  readonly source_done: boolean;
  /** The episode's world state (spec null while loading). */
  readonly world_state: ReplayWorldState;
  /** The episode's run log (empty while loading). */
  readonly run_log: ReplayRunLog;
}

/**
 * Serialize a run state to a JSON value (deep copy — the resume artifact is
 * portable across processes). The state is JSON-shaped by construction.
 */
export function serializeReplayRunState(state: ReplayRunState): WorldResult<JsonValue> {
  if (!isReplayRunStateShape(state)) {
    return fail('invalid_state', 'cannot serialize a value that is not a structurally valid ReplayRunState');
  }
  return ok(JSON.parse(JSON.stringify(state)) as JsonValue);
}

/**
 * Deserialize and validate an untrusted run state (collect-all). The gate a
 * resumed run passes through: tampered or partial states fail with typed
 * errors, never silently.
 */
export function deserializeReplayRunState(value: unknown): WorldResult<ReplayRunState> {
  if (!isRecord(value)) {
    return { ok: false, errors: [{ code: 'invalid_type', path: 'runState', message: 'run state must be an object' }] };
  }
  const errors: { code: 'invalid_state'; path: string; message: string }[] = [];
  if (value.schema !== 'tradrl/replay-run-state@1') {
    errors.push({ code: 'invalid_state', path: 'runState.schema', message: `expected schema "tradrl/replay-run-state@1", got ${JSON.stringify(value.schema)}` });
  }
  if (value.phase !== 'loading' && value.phase !== 'episode') {
    errors.push({ code: 'invalid_state', path: 'runState.phase', message: `phase must be 'loading' or 'episode', got ${JSON.stringify(value.phase)}` });
  }
  if (!isNonNegativeSafeInteger(value.batches_consumed)) {
    errors.push({ code: 'invalid_state', path: 'runState.batches_consumed', message: 'must be a non-negative safe integer' });
  }
  if (!Array.isArray(value.ingest_chain) || !value.ingest_chain.every((head) => typeof head === 'string' && head.length === 8)) {
    errors.push({ code: 'invalid_state', path: 'runState.ingest_chain', message: 'must be an array of 8-hex-char chain heads' });
  }
  if (typeof value.source_done !== 'boolean') {
    errors.push({ code: 'invalid_state', path: 'runState.source_done', message: 'must be a boolean' });
  }
  if (!isRecord(value.world_state)) {
    errors.push({ code: 'invalid_state', path: 'runState.world_state', message: 'must be a ReplayWorldState object' });
  }
  if (!isReplayRunLog(value.run_log)) {
    errors.push({ code: 'invalid_state', path: 'runState.run_log', message: 'must be a run log object' });
  }
  if (errors.length > 0) return { ok: false, errors };

  // The world state and config go through the CONTRACT's total validators.
  const configResult = validateWorldConfig(value.config, 'runState.config');
  if (!configResult.ok) return { ok: false, errors: configResult.errors.map((error) => ({ code: 'invalid_state' as const, path: `runState.${error.path}`, message: error.message })) };
  const stateResult = deserializeReplayWorldState(value.world_state);
  if (!stateResult.ok) return { ok: false, errors: stateResult.errors.map((error) => ({ code: 'invalid_state' as const, path: `runState.${error.path.replace(/^state\./, 'world_state.')}`, message: error.message })) };

  const worldState = stateResult.value;
  // Coherence: the run state's phase agrees with the world state's spec binding.
  if (value.phase === 'episode' && worldState.spec === null) {
    return fail('invalid_state', "phase is 'episode' but the world state carries no bound spec", 'runState.phase');
  }
  if (value.phase === 'loading' && worldState.spec !== null) {
    return fail('invalid_state', "phase is 'loading' but the world state carries a bound spec", 'runState.phase');
  }
  if (value.ingest_chain.length !== value.batches_consumed) {
    return fail('invalid_state', `ingest_chain length (${value.ingest_chain.length}) must equal batches_consumed (${String(value.batches_consumed)})`, 'runState.ingest_chain');
  }

  return ok(
    deepFreeze({
      schema: 'tradrl/replay-run-state@1',
      phase: value.phase,
      config: configResult.value,
      batches_consumed: value.batches_consumed as number,
      ingest_chain: (value.ingest_chain as readonly string[]).slice(),
      source_done: value.source_done as boolean,
      world_state: worldState,
      run_log: deepFreeze({ ...value.run_log }),
    }),
  );
}

/** Internal structural check for the serialize gate. */
function isReplayRunStateShape(value: unknown): value is ReplayRunState {
  return (
    isRecord(value) &&
    value.schema === 'tradrl/replay-run-state@1' &&
    (value.phase === 'loading' || value.phase === 'episode') &&
    isRecord(value.config) &&
    isNonNegativeSafeInteger(value.batches_consumed) &&
    Array.isArray(value.ingest_chain) &&
    typeof value.source_done === 'boolean' &&
    isRecord(value.world_state) &&
    isReplayRunLog(value.run_log)
  );
}

// ---------------------------------------------------------------------------
// Record assembly helpers (used by the service)
// ---------------------------------------------------------------------------

/** The stream keys seen in a world state's sequence trackers (canonical order). */
export function streamsSeenOf(state: ReplayWorldState): readonly string[] {
  return state.sequences.map((tracker) => `${tracker.venue}|${tracker.instrument}|${tracker.stream}`);
}

/** Assemble the run record for a finished episode (the service supplies the config and run log). */
export function buildRunRecord(
  config: ReplayWorldConfig,
  configHashValue: string,
  state: ReplayWorldState,
  chainHead: string,
  batchesConsumed: number,
  runLog: ReplayRunLog,
  specHash: string,
): WorldResult<ReplayRunRecord> {
  const spec = state.spec;
  if (spec === null) {
    return fail('invalid_state', 'a run record requires an episode-bound world state');
  }
  if (state.status !== 'finished' || state.termination === null) {
    return fail('episode_not_finished', 'the run record is only available for a finished episode');
  }
  if (!isTerminationReason(state.termination)) {
    return fail('invalid_termination', 'the recorded termination reason is malformed');
  }

  const record: Omit<ReplayRunRecord, 'digest'> = {
    schema: 'tradrl/replay-run-record@1',
    world: {
      world_id: config.world_id,
      config_hash: configHashValue,
      fidelity: config.fidelity,
      seed: config.seed,
      as_of: config.as_of,
      streams: config.streams.map((selection) => `${selection.venue}|${selection.instrument}`),
      playback_speed: config.playback_speed,
    },
    episode: {
      episode_id: deriveEpisodeId(spec),
      environment_id: spec.profile.environment_id,
      spec_hash: specHash,
      termination: { code: state.termination.code, detail: state.termination.detail },
      final_now: state.clock.now,
    },
    ingestion: {
      batches: batchesConsumed,
      events: state.history.length,
      snapshot_count: state.snapshot_refs.length,
      streams_seen: streamsSeenOf(state),
      chain_head: chainHead,
    },
    clock_timeline: runLog.advances,
    intent_log: state.intents.map((intent) => intent.receipt),
    observations: {
      queries: runLog.observation_queries,
      served: runLog.observations_served,
    },
  };

  // The record's own digest — over the canonical record WITHOUT the digest
  // field, so the digest is a pure function of the record content.
  const json: unknown = record;
  if (!isJsonValue(json)) {
    return fail('invalid_state', 'the assembled record is not JSON (impossible by construction)');
  }
  const digest = fnv1a32Hex(canonicalJson(json));
  return ok(deepFreeze({ ...record, digest }));
}

/** Guard re-exported for consumers (isWorldEvent used by resume verification). */
export { isWorldEvent };
