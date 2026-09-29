/**
 * @tradrl/market-world (reactive service) — the ReactiveWorldService (work
 * order T027): the reactive replay world with ENDOGENOUS participants.
 *
 * THE REACTIVE DIFFERENCE (the existential law): "endogenous participant
 * actions ARE matched against the engine (with declared physics configs),
 * while the exogenous recorded stream still flows in as events; every
 * engine-driven fill carries its full physics lineage". In exact replay
 * (T009) an order drifts past the book without consequence — a receipt,
 * never a match. HERE the candidate organization's and its adversaries'
 * intents are SUBMITTED to a real matching engine (the injected
 * {@link EngineDriver} — the REAL exchange-sim reducer, never
 * reimplemented): they move the book, pay fees, eat latency and slippage,
 * and cause impact through the book's own consumption. The market fights
 * back.
 *
 * THE LAYERING:
 *
 *     RecordedEventSource (pure async iterator — the EXOGENOUS stream IN)
 *             │ batches (validated, anti-poisoned, digest-chained)
 *             ▼
 *     load-then-bind (T009's discipline: the stream loads fully before an
 *             episode binds — safe by design, the L4 boundary withholds
 *             every future-dated event)
 *             ▼
 *     startEpisode ──► engine SEEDED (latest recorded book_snapshot
 *             │          available at the episode's start instant), stream
 *             │          ARMED (applied through the start instant)
 *             ▼
 *     submitAction ──► EngineDriver.submitOrder / cancelOrder (THE MATCH)
 *             │          → typed receipts + fills with physics lineage
 *             ▼
 *     advanceEpisode ─► the BOUNDARY STEP MACHINE: clock + ONE stream
 *             │          step + engine advance per the DECLARED
 *             │          interleaving policy (deterministic order)
 *             ▼
 *     emitObservations ─► the inclusive L4 boundary over recorded events
 *                          AND engine outcomes (admitObservations gates)
 *             ▼
 *     ReactiveRunRecord (L9: config hash, chain head, spec hash, ENGINE
 *                        STATE HASH, digest) + resumable ReactiveRunState
 *
 * THE INTERLEAVING LAW (determinism): "Participant action ORDER matters
 * and is part of the deterministic function (declared interleaving with
 * the recorded stream)". An `advance` moves the clock to the target and
 * processes EXACTLY ONE boundary — the earliest of (the next recorded
 * event's availability, the next scripted action's instant, the target
 * itself). Within a boundary the declared policy orders the stream step
 * against the scripted actions; strict policies additionally require the
 * world SETTLED before a driver submit (acting mid-stream-step is the
 * typed `interleaving_violation`). Loop `advance` until the view reports
 * `settled` to absorb a whole window.
 *
 * RESUMABILITY (mirroring T009): exportRunState serializes; resume
 * fast-forwards a FRESH source past the consumed batches VERIFYING each
 * digest against the recorded chain, and a fresh set of feeds past the
 * consumed actions VERIFYING each action id against the scripted log
 * (tamper = `chain_mismatch`), then continues — a resumed run finishes
 * with the IDENTICAL run record.
 *
 * NO AMBIENT ANYTHING: no wall clock, no Math.random, no I/O beyond the
 * declared source iterator; every identity is derived (FNV-1a over
 * canonical JSON). Same (recorded stream, seed, participant action
 * script, physics configs, clock config, interleaving) -> byte-identical
 * world evolution — engine state, fills, observations — proven by the
 * fixture tests.
 */

import { deepFreeze, fnv1a32Hex, isNonEmptyString, isRecord } from './primitives';
import type { JsonValue } from './primitives';
import { fail, ok, type ReactiveResult } from './errors';
import { deriveReceiptId, deriveRunId, isTimestampMs, type EpisodeId, type TimestampMs } from './ids';
import type {
  ActionEnvelope,
  ClockState,
  EpisodeFinishMirror,
  EpisodeStateMirror,
  EnvironmentSpec,
  TerminationReason,
} from './env-mirror';
import {
  deriveEpisodeId,
  isActionEnvelope,
  isTerminationReason,
  validateEnvironmentSpec,
} from './env-mirror';
import type {
  AdvanceOutcomeMirror,
  CancelOutcomeMirror,
  EngineDriver,
  EngineStateMirror,
  FillMirror,
  OrderCancelMirror,
  SubmitOutcomeMirror,
} from './exchange-mirror';
import {
  bookTopKey,
  bookTopView,
  engineStateHash,
  isEngineDriver,
  isOrderAckMirror,
  physicsHash,
} from './exchange-mirror';
import type { RecordedEvent, RecordedEventSource } from './stream';
import {
  chainDigest,
  isRecordedEventSource,
  untrustedBatchDigest,
  validateRecordedEvent,
} from './stream';
import type { ParticipantActionFeed } from './action-feed';
import { isParticipantActionFeed } from './action-feed';
import type { InterleavingPolicy, PhysicsRefs, ReactiveWorldConfig } from './config';
import { configHash, policyRequiresSettled, validateReactiveWorldConfig } from './config';
import type {
  ActionReceipt,
  ClockAdvance,
  ReactiveFillRecord,
  ReactiveObservation,
  ReactiveRunLog,
  ReactiveRunRecord,
  ReactiveRunState,
  ScriptedLogEntry,
} from './records';
import {
  admitObservations,
  buildRunRecord,
  deserializeReactiveRunState,
  emptyRunLog,
  isReactiveRunLog,
  requireReactiveFill,
  serializeReactiveRunState,
} from './records';

// ---------------------------------------------------------------------------
// The declared inputs (everything the world consumes — no ambient state)
// ---------------------------------------------------------------------------

/**
 * The declared inputs of a reactive world: the recorded-stream source, the
 * injected matching-engine driver, and the scripted action feeds bound to
 * the roster's declared feed refs. Everything is a DECLARED input (the
 * work order's no-network law); nothing is ambient.
 */
export interface ReactiveWorldInputs {
  /** The recorded stream IN (pure async iterator of untrusted batches). */
  readonly source: RecordedEventSource;
  /** The matching engine (the REAL exchange-sim reducer, injected — never imported). */
  readonly engine: EngineDriver;
  /** The scripted action feeds, bound to the roster's declared feed refs. */
  readonly feeds: readonly { readonly ref: string; readonly feed: ParticipantActionFeed }[];
}

/** Validate the declared inputs against a validated config (total). */
function validateInputs(config: ReactiveWorldConfig, inputs: ReactiveWorldInputs): ReactiveResult<Map<string, ParticipantActionFeed>> {
  if (!isRecordedEventSource(inputs.source)) {
    return fail('invalid_source', 'the recorded event source must be an async iterable of event batches');
  }
  if (!isEngineDriver(inputs.engine)) {
    return fail('invalid_engine_driver', 'the engine driver must carry createEngine/submitOrder/cancelOrder/advanceEngine (the injected exchange-sim reducer)');
  }
  if (!Array.isArray(inputs.feeds)) {
    return fail('invalid_source', 'feeds must be an array of { ref, feed } bindings');
  }
  const bound = new Map<string, ParticipantActionFeed>();
  for (let index = 0; index < inputs.feeds.length; index++) {
    const binding = inputs.feeds[index];
    if (binding === undefined || binding === null || !isRecord(binding) || !isNonEmptyString(binding.ref) || !isParticipantActionFeed(binding.feed)) {
      return fail('invalid_source', `feeds[${index}] must be { ref: non-empty string, feed: { peek, take } }`);
    }
    if (bound.has(binding.ref)) {
      return fail('invalid_source', `feed ref "${binding.ref}" is bound twice — one binding per declared feed`);
    }
    bound.set(binding.ref, binding.feed);
  }
  // Every declared feed ref must be bound; every binding must be declared.
  for (const participant of config.participants) {
    if (participant.feed !== null && !bound.has(participant.feed)) {
      return fail('feed_not_bound', `participant "${participant.instance}" declares feed ref "${participant.feed}" but no such binding was supplied`);
    }
  }
  for (const ref of bound.keys()) {
    const declared = config.participants.some((participant) => participant.feed === ref);
    if (!declared) {
      return fail('invalid_source', `feed ref "${ref}" is bound but not declared by any roster participant`);
    }
  }
  return ok(bound);
}

// ---------------------------------------------------------------------------
// The load + episode outcomes
// ---------------------------------------------------------------------------

/** The outcome of one `loadNextBatch` call (full counters, always). */
export interface LoadOutcome {
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

// ---------------------------------------------------------------------------
// The episode view (structurally an EpisodeState, with the step machine's
// dashboard as forward-compatible extra fields)
// ---------------------------------------------------------------------------

/**
 * The reactive episode view: structurally environment-protocol's
 * `EpisodeState` (the five-operation surface returns these) PLUS the step
 * machine's dashboard — `settled`, `pending_stream_events`,
 * `pending_scripted_actions`, `applied_through` — so drivers can see the
 * interleaving state and loop advances until settled.
 */
export interface ReactiveEpisodeView extends EpisodeStateMirror {
  readonly episode_id: string;
  readonly spec: EnvironmentSpec;
  readonly clock: ClockState;
  readonly status: 'running' | 'finished';
  readonly termination: TerminationReason | null;
  readonly pending: readonly ReactiveObservation[];
  readonly accepted_actions: readonly ActionEnvelope[];
  readonly rewards: readonly [];
  /** True when the stream and the feeds are fully caught up with `now` (the interleaving rest state). */
  readonly settled: boolean;
  /** Unapplied recorded events with available_time <= now (the mid-stream-step measure). */
  readonly pending_stream_events: number;
  /** Scripted actions with at <= now that have not fired yet. */
  readonly pending_scripted_actions: number;
  /** The stream cursor instant (events available at or before it are applied). */
  readonly applied_through: TimestampMs;
}

/** The submit product: the new episode view PLUS the typed receipt (a forward-compatible extra field). */
export interface ReactiveSubmission extends ReactiveEpisodeView {
  readonly receipt: ActionReceipt;
}

/** The finish product: terminal state + immutable result (structurally EpisodeFinish). */
export interface ReactiveEpisodeFinish extends EpisodeFinishMirror {
  readonly episode: ReactiveEpisodeView;
  readonly result: {
    readonly episode_id: string;
    readonly environment_id: string;
    readonly spec: EnvironmentSpec;
    readonly termination: TerminationReason;
    readonly final_now: TimestampMs;
    readonly accepted_action_count: number;
    readonly pending_observation_count: number;
    readonly rewards: readonly [];
  };
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/**
 * The reactive world service: load the recorded stream, then drive
 * episodes through the five Environment operations (structural), with the
 * engine matched, the L4 boundary enforced, the declared interleaving
 * honored, and the L9 lineage recorded.
 *
 * The five operations carry BOTH namings: the canonical environment-
 * protocol names (`start`/`observe`/`submit`/`advance`/`finish` — the
 * service passes `isEnvironment`-shaped guards directly) and the Work
 * Order's descriptive aliases (`startEpisode`/`emitObservations`/
 * `submitAction`/`advanceEpisode`/`finishEpisode` — identical behavior).
 */
export interface ReactiveWorldService {
  /** The validated, fully-determining world config. */
  readonly config: ReactiveWorldConfig;
  /** The config's deterministic digest (bound into every run record). */
  readonly config_hash: string;
  /** The engine physics digest (the REAL engine's configHash — interop-tested). */
  readonly engine_config_hash: string;
  /** The deterministic world id episodes bind to. */
  readonly world_id: string;
  /** The run id (`run-<fnv1a32(config_hash:chain_head)>` — binds config + stream). */
  readonly run_id: string;
  /** All registered episode ids, in registration order. */
  readonly episodes: readonly EpisodeId[];

  // --- Phase 1: load the recorded stream (load-then-bind) -------------------
  loadNextBatch(): Promise<ReactiveResult<LoadOutcome>>;
  loadAll(): Promise<ReactiveResult<LoadSummary>>;

  // --- Phase 2: the episode protocol (Environment-shaped) --------------------
  start(spec: unknown): ReactiveResult<ReactiveEpisodeView>;
  observe(episode: string, at: TimestampMs): ReactiveResult<readonly ReactiveObservation[]>;
  submit(episode: string, action: unknown): ReactiveResult<ReactiveSubmission>;
  advance(episode: string, to: TimestampMs): ReactiveResult<ReactiveEpisodeView>;
  finish(episode: string, reason: unknown): ReactiveResult<ReactiveEpisodeFinish>;

  // --- The Work Order's descriptive aliases (identical behavior) -------------
  startEpisode(spec: unknown): ReactiveResult<ReactiveEpisodeView>;
  emitObservations(episode: string, at: TimestampMs): ReactiveResult<readonly ReactiveObservation[]>;
  submitAction(episode: string, action: unknown): ReactiveResult<ReactiveSubmission>;
  advanceEpisode(episode: string, to: TimestampMs): ReactiveResult<ReactiveEpisodeView>;
  finishEpisode(episode: string, reason: unknown): ReactiveResult<ReactiveEpisodeFinish>;

  // --- Lineage + resume --------------------------------------------------------
  /** The L9 lineage record of a FINISHED episode (identical runs -> identical records). */
  runRecord(episode: string): ReactiveResult<ReactiveRunRecord>;
  /** The serializable run state (resume artifact). With an episode id: that episode's line; without: the loading state. */
  exportRunState(episode?: string): ReactiveResult<ReactiveRunState>;
  /** The full fill log (each record with its physics lineage). */
  fills(episode: string): ReactiveResult<readonly ReactiveFillRecord[]>;
  /** The current engine state (the injected reducer's own state, read-only). */
  engineState(episode: string): ReactiveResult<EngineStateMirror>;
  /** The current engine state hash (byte-identity anchor). */
  engineStateHash(episode: string): ReactiveResult<string>;
}

// ---------------------------------------------------------------------------
// The episode line (the service's per-episode bookkeeping)
// ---------------------------------------------------------------------------

/** One bound episode's run line. */
interface EpisodeLine {
  readonly spec: EnvironmentSpec;
  readonly episodeId: string;
  clock: ClockState;
  /**
   * The ids of APPLIED recorded events (application is BY AVAILABILITY, in
   * loaded order within each boundary — a derived aggregate can become
   * available before a later-loaded primitive, so a plain cursor would
   * block due events behind not-yet-due ones). Event ids are unique for
   * the world's lifetime (ingestion rejects duplicates), so the set is a
   * faithful once-only application marker.
   */
  appliedIds: Set<string>;
  /** The applied-through instant (== the last boundary's stream step, or the start settlement). */
  appliedThrough: TimestampMs;
  engine: EngineStateMirror;
  observations: ReactiveObservation[];
  acceptedActions: ActionEnvelope[];
  receipts: ActionReceipt[];
  fills: ReactiveFillRecord[];
  scriptedLog: ScriptedLogEntry[];
  advances: ClockAdvance[];
  observationQueries: number;
  observationsServed: number;
  status: 'running' | 'finished';
  termination: TerminationReason | null;
  eventCounter: number;
  lastBookTopKey: string | null;
  seedSnapshotRef: string | null;
  /** Per-actor last accepted client_sequence (both channels: driver + feeds). */
  sequences: Map<string, number>;
  /** Per-episode action-id set (uniqueness across both channels). */
  actionIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Create a reactive world service from an untrusted config and the
 * declared inputs. The config is validated (collect-all — the L5 mode
 * honesty and the L12 scope included); the inputs are validated against
 * the roster (every declared feed bound, every binding declared); the
 * engine driver is probed ONCE with the physics config so a broken driver
 * fails at construction, not mid-episode.
 */
export function createReactiveWorldService(config: unknown, inputs: ReactiveWorldInputs): ReactiveResult<ReactiveWorldService> {
  const configResult = validateReactiveWorldConfig(config);
  if (!configResult.ok) return configResult;
  const validConfig = configResult.value;
  const feedsResult = validateInputs(validConfig, inputs);
  if (!feedsResult.ok) return feedsResult;
  const feeds = feedsResult.value;

  // Probe the engine driver once: the REAL engine validates the physics
  // config (grid rules, fee tiers, latency, slippage, the impact
  // fail-close) at createEngine — a config the engine rejects fails HERE.
  const probe = inputs.engine.createEngine(validConfig.exchange, { start_at: 0 });
  if (!probe.ok) return liftEngineError(probe);

  const configHashValue = configHash(validConfig);
  const engineHash = physicsHash(validConfig.exchange);

  const core: ServiceCore = {
    config: validConfig,
    configHashValue,
    engineHash,
    batchesConsumed: 0,
    ingestChain: [],
    batchSizes: [],
    sourceDone: false,
    stream: [],
    streamSequences: new Map<string, number>(),
    eventIds: new Set<string>(),
    lines: new Map<string, EpisodeLine>(),
    order: [],
    feeds,
    engine: inputs.engine,
    iterator: inputs.source[Symbol.asyncIterator](),
  };
  return ok(buildService(core));
}

/**
 * Resume a service from a serialized run state. The inputs must be FRESH:
 * a source over the SAME recorded stream (every consumed batch is re-pulled
 * and its digest VERIFIED against the recorded chain — a mismatched stream
 * fails `resume_stream_mismatch`/`chain_mismatch`) and feeds over the SAME
 * scripts (every consumed action is re-pulled and its action id VERIFIED
 * against the scripted log — a diverging feed fails `chain_mismatch`).
 * The resumed run continues identically.
 */
export async function resumeReactiveWorldService(state: unknown, inputs: ReactiveWorldInputs): Promise<ReactiveResult<ReactiveWorldService>> {
  const restored = deserializeReactiveRunState(state);
  if (!restored.ok) return restored;
  const runState = restored.value;

  const configResult = validateReactiveWorldConfig(runState.config);
  if (!configResult.ok) return configResult;
  const validConfig = configResult.value;
  const feedsResult = validateInputs(validConfig, inputs);
  if (!feedsResult.ok) return feedsResult;
  const feeds = feedsResult.value;

  // Verify the engine driver accepts the physics (fail early, as at create).
  const probe = inputs.engine.createEngine(validConfig.exchange, { start_at: 0 });
  if (!probe.ok) return liftEngineError(probe);

  const iterator = inputs.source[Symbol.asyncIterator]();

  // Fast-forward the source with digest verification: re-pull every
  // consumed batch, validate + digest it, fold onto the running head
  // (seeded from the config hash) and compare against the chain entry.
  let runningHead = configHash(validConfig);
  for (let index = 0; index < runState.batches_consumed; index++) {
    const pulled = await iterator.next();
    if (pulled.done === true) {
      return fail('resume_stream_mismatch', `the resumed source ended before batch ${index} but the run state consumed ${runState.batches_consumed}`);
    }
    const batch = pulled.value;
    if (!Array.isArray(batch)) {
      return fail('resume_stream_mismatch', `resumed batch ${index} is not an array`);
    }
    const digest = untrustedBatchDigest(batch);
    const folded = digest === null ? null : fnv1a32Hex(`${runningHead}:${digest}`);
    const expected = runState.ingest_chain[index];
    if (folded === null || folded !== expected) {
      return fail('chain_mismatch', `resumed batch ${index} does not match the recorded ingest chain (expected ${String(expected)}, got ${String(folded)}) — the resumed run provably consumed a different stream`);
    }
    runningHead = folded;
  }
  if (runState.source_done) {
    const tail = await iterator.next();
    if (tail.done !== true) {
      return fail('resume_stream_mismatch', 'the run state recorded an exhausted source but the resumed source has more batches');
    }
  }

  // Rebuild the core over the VERIFIED stream.
  const core: ServiceCore = {
    config: validConfig,
    configHashValue: configHash(validConfig),
    engineHash: physicsHash(validConfig.exchange),
    batchesConsumed: runState.batches_consumed,
    ingestChain: [...runState.ingest_chain],
    batchSizes: [...runState.batch_sizes],
    sourceDone: runState.source_done,
    stream: [],
    streamSequences: new Map<string, number>(),
    eventIds: new Set<string>(),
    lines: new Map<string, EpisodeLine>(),
    order: [],
    feeds,
    engine: inputs.engine,
    iterator,
  };
  // Re-validate + re-apply the loaded stream, then VERIFY it against the
  // recorded chain: the serialized events are regrouped by the recorded
  // batch sizes, re-digested and re-folded — the fold MUST reproduce the
  // recorded chain head (a tampered serialized stream fails chain_mismatch;
  // the source verification above proved the SOURCE, this proves the STATE).
  const revalidated: RecordedEvent[] = [];
  for (const record of runState.stream) {
    const validated = validateRecordedEvent(record, 'stream', true);
    if (!validated.ok) {
      return fail('chain_mismatch', `the serialized stream failed re-validation at event ${revalidated.length} — tampered run state`);
    }
    const event = validated.value;
    const key = `${event.venue}|${event.instrument}|${event.event_type === 'other' ? otherStreamOf(event) : event.event_type}`;
    const last = core.streamSequences.get(key) ?? 0;
    if (event.sequence <= last) {
      return fail('chain_mismatch', `the serialized stream violates the per-stream sequence discipline at event ${event.event_id} — tampered run state`);
    }
    if (core.eventIds.has(event.event_id)) {
      return fail('chain_mismatch', `the serialized stream carries duplicate event id ${event.event_id} — tampered run state`);
    }
    core.streamSequences.set(key, event.sequence);
    core.eventIds.add(event.event_id);
    revalidated.push(event);
  }
  let expectedCount = 0;
  for (const size of runState.batch_sizes) expectedCount += size;
  if (expectedCount !== revalidated.length) {
    return fail('chain_mismatch', `the serialized stream carries ${revalidated.length} events but the recorded batch sizes sum to ${expectedCount} — tampered run state`);
  }
  let stateHead = configHash(validConfig);
  let cursor = 0;
  for (let index = 0; index < runState.batch_sizes.length; index++) {
    const size = runState.batch_sizes[index] as number;
    const group = revalidated.slice(cursor, cursor + size);
    cursor += size;
    stateHead = chainDigest(stateHead, group);
  }
  if (stateHead !== runState.ingest_chain[runState.ingest_chain.length - 1]) {
    return fail('chain_mismatch', 'the serialized stream does not digest to the recorded chain head — tampered run state');
  }
  core.stream = revalidated;

  if (runState.phase === 'episode' && runState.episode_line !== null) {
    const line = restoreEpisodeLine(core, runState.episode_line, runState.run_log);
    if (!line.ok) return line;
  }
  return ok(buildService(core));
}

/** Restore an episode line from the serialized run state (total validation). */
function restoreEpisodeLine(core: ServiceCore, lineState: unknown, runLog: ReactiveRunLog): ReactiveResult<undefined> {
  if (!isRecord(lineState)) return fail('invalid_state', 'the episode line must be an object');
  const specResult = validateEnvironmentSpec(lineState.spec, 'episode_line.spec');
  if (!specResult.ok) return specResult;
  const spec = specResult.value;

  const engineState = lineState.engine_state;
  if (!isRecord(engineState)) return fail('invalid_state', 'the episode line carries no engine state');
  // The engine state is the injected driver's own value; validate it
  // structurally (config echo, counters, book, logs).
  if (typeof engineState.now !== 'number' || !isTimestampMs(engineState.now)) return fail('invalid_state', 'the engine state clock is malformed');
  if (!Array.isArray(engineState.fills) || !Array.isArray(engineState.orders)) return fail('invalid_state', 'the engine state logs are malformed');

  const clockNow = lineState.clock_now;
  const clockAsOf = lineState.clock_as_of;
  if (!isTimestampMs(clockNow) || !isTimestampMs(clockAsOf)) return fail('invalid_state', 'the episode clock is malformed');
  if (!Array.isArray(lineState.applied_event_ids) || !lineState.applied_event_ids.every((id) => isNonEmptyString(id))) {
    return fail('invalid_state', 'the applied-event-ids log is malformed');
  }

  const observations: ReactiveObservation[] = [];
  if (!Array.isArray(lineState.observations)) return fail('invalid_state', 'the observations log is malformed');
  for (const observation of lineState.observations) {
    if (!isRecord(observation)) return fail('invalid_state', 'an observation in the log is malformed');
    observations.push(observation as unknown as ReactiveObservation);
  }
  const acceptedActions: ActionEnvelope[] = [];
  if (!Array.isArray(lineState.accepted_actions)) return fail('invalid_state', 'the accepted-actions log is malformed');
  for (const action of lineState.accepted_actions) {
    if (!isActionEnvelope(action)) return fail('invalid_state', 'an accepted action in the log is malformed');
    acceptedActions.push(action);
  }
  const receipts: ActionReceipt[] = [];
  if (!Array.isArray(lineState.receipts)) return fail('invalid_state', 'the receipt log is malformed');
  for (const receipt of lineState.receipts) {
    if (!isRecord(receipt)) return fail('invalid_state', 'a receipt in the log is malformed');
    receipts.push(receipt as unknown as ActionReceipt);
  }
  const fills: ReactiveFillRecord[] = [];
  if (!Array.isArray(lineState.fills)) return fail('invalid_state', 'the fill log is malformed');
  for (const fill of lineState.fills) {
    const guarded = requireReactiveFill(fill);
    if (!guarded.ok) return guarded;
    fills.push(guarded.value);
  }
  const scriptedLog: ScriptedLogEntry[] = [];
  if (!Array.isArray(lineState.scripted_log)) return fail('invalid_state', 'the scripted log is malformed');
  for (const entry of lineState.scripted_log) {
    if (!isRecord(entry) || !isNonEmptyString(entry.participant) || !isNonEmptyString(entry.action_id)) {
      return fail('invalid_state', 'a scripted log entry is malformed');
    }
    scriptedLog.push(entry as unknown as ScriptedLogEntry);
  }
  if (!isReactiveRunLog(runLog)) return fail('invalid_state', 'the run log is malformed');

  const termination = lineState.termination === null || lineState.termination === undefined ? null : lineState.termination;
  const status = lineState.status === 'finished' ? 'finished' : 'running';
  if (status === 'finished' && !isTerminationReason(termination)) return fail('invalid_state', 'a finished episode line carries no termination reason');

  // Fast-forward every declared feed past the CONSUMED scripted actions,
  // VERIFYING each action id against the recorded log IN FIRING ORDER (the
  // log's order is the interleaved firing order; a participant's feed is
  // strictly ordered, so iterating the log and matching each entry's feed
  // consumes exactly the recorded prefix — a diverging feed is a chain
  // mismatch: the resumed run provably consumes the identical scripts).
  const feedOf = (participant: string): ParticipantActionFeed | undefined => {
    for (const declaration of core.config.participants) {
      if (declaration.instance === participant && declaration.feed !== null) {
        return core.feeds.get(declaration.feed);
      }
    }
    return undefined;
  };
  for (const entry of scriptedLog) {
    const feed = feedOf(entry.participant);
    if (feed === undefined) {
      return fail('chain_mismatch', `the scripted log names participant "${entry.participant}" whose feed is not declared/bound — tampered run state`);
    }
    const next = feed.peek();
    if (next === null || next.action.action_id !== entry.action_id) {
      return fail('chain_mismatch', `the scripted feed of participant "${entry.participant}" diverges from the recorded run at action ${entry.action_id} (feed offers ${next === null ? 'nothing' : String(next.action.action_id)}) — a resumed run provably consumes the same scripts`);
    }
    feed.take();
  }

  const appliedIds = new Set<string>(lineState.applied_event_ids as readonly string[]);
  // Every applied id must name a stream event (a tampered id set is a chain mismatch).
  for (const id of appliedIds) {
    if (!core.eventIds.has(id)) {
      return fail('chain_mismatch', `the episode line claims applied event id ${id} which the verified stream does not carry — tampered run state`);
    }
  }
  const line: EpisodeLine = {
    spec,
    episodeId: deriveEpisodeId(spec),
    clock: deepFreeze({ ...spec.profile.clock, now: clockNow, asOf: clockAsOf }),
    appliedIds,
    appliedThrough: lineState.applied_through as TimestampMs,
    engine: engineState as unknown as EngineStateMirror,
    observations,
    acceptedActions,
    receipts,
    fills,
    scriptedLog,
    advances: Array.isArray(lineState.advances) ? [...(lineState.advances as ClockAdvance[])] : [],
    observationQueries: typeof lineState.observation_queries === 'number' ? lineState.observation_queries : 0,
    observationsServed: typeof lineState.observations_served === 'number' ? lineState.observations_served : 0,
    status,
    termination: status === 'finished' ? (termination as TerminationReason) : null,
    eventCounter: typeof lineState.event_counter === 'number' ? lineState.event_counter : 0,
    lastBookTopKey: typeof lineState.last_book_top_key === 'string' ? lineState.last_book_top_key : null,
    seedSnapshotRef: typeof lineState.seed_snapshot_ref === 'string' ? lineState.seed_snapshot_ref : null,
    sequences: new Map<string, number>(),
    actionIds: new Set<string>(),
  };
  // Rebuild the per-actor sequence cursors and the action-id set from the
  // restored logs (the sequence law is enforced forward from the maxima).
  for (const action of acceptedActions) {
    line.sequences.set(action.actor, Math.max(line.sequences.get(action.actor) ?? -1, action.client_sequence));
    line.actionIds.add(action.action_id);
  }
  core.lines.set(line.episodeId, line);
  core.order.push(line.episodeId);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// The shared implementation core
// ---------------------------------------------------------------------------

interface ServiceCore {
  readonly config: ReactiveWorldConfig;
  readonly configHashValue: string;
  readonly engineHash: string;
  batchesConsumed: number;
  ingestChain: string[];
  batchSizes: number[];
  sourceDone: boolean;
  stream: RecordedEvent[];
  /** Per-stream last sequence (the sequence discipline tracker). */
  streamSequences: Map<string, number>;
  /** Every ingested event id (duplicate detection). */
  eventIds: Set<string>;
  lines: Map<string, EpisodeLine>;
  order: string[];
  feeds: Map<string, ParticipantActionFeed>;
  engine: EngineDriver;
  iterator: AsyncIterator<readonly unknown[], void, undefined>;
}

/** Lift an engine-driver failure onto the reactive taxonomy (codes preserved verbatim). */
function liftEngineError<T>(failure: { readonly ok: false; readonly errors: readonly { readonly code: string; readonly path: string; readonly message: string }[] }): ReactiveResult<T> {
  return {
    ok: false,
    errors: failure.errors.map((error) => ({
      code: 'engine_error' as const,
      path: `engine.${error.path}`,
      message: `[${error.code}] ${error.message}`,
    })),
  };
}

// ---------------------------------------------------------------------------
// The service implementation
// ---------------------------------------------------------------------------

function buildService(core: ServiceCore): ReactiveWorldService {
  const chainHead = (): string => (core.ingestChain.length > 0 ? (core.ingestChain[core.ingestChain.length - 1] as string) : core.configHashValue);
  const runId = (): string => deriveRunId(core.configHashValue, chainHead());
  const physicsRefs = core.config.physics_refs;

  const lineageOf = (runRef: string) =>
    deepFreeze({
      engine_config_hash: core.engineHash,
      fee_policy: physicsRefs.fee_policy,
      latency_policy: physicsRefs.latency_policy,
      slippage_policy: physicsRefs.slippage_policy,
      impact_policy: physicsRefs.impact_policy,
      run_ref: runRef,
      tenant: core.config.tenant,
      project: core.config.project,
    });

  const lookup = (episode: string): ReactiveResult<EpisodeLine> => {
    const line = core.lines.get(episode);
    if (line === undefined) {
      return fail('unknown_episode', `episode ${episode} is not known to this service`);
    }
    return ok(line);
  };

  // --- The stream-step helpers ---------------------------------------------

  /** Is the recorded event at `index` selected by the config's stream selection? */
  const isSelected = (event: RecordedEvent): boolean =>
    core.config.streams.some((selection) => selection.venue === event.venue && selection.instrument === event.instrument);

  /**
   * The earliest availability instant among ALL unapplied selected events,
   * or null when none remain. The recorded stream's AVAILABILITY order is
   * not its LOADED order (a derived aggregate can become available before a
   * later-loaded primitive — the T009 fixture discipline), so the boundary
   * scheduler scans every unapplied event. Within one boundary the
   * application order stays LOADED order (the recorded arrival order —
   * deterministic).
   */
  const nextStreamInstant = (line: EpisodeLine): number | null => {
    let earliest: number | null = null;
    for (const event of core.stream) {
      if (line.appliedIds.has(event.event_id)) continue;
      if (!isSelected(event)) continue;
      if (earliest === null || (event.available_time as number) < earliest) earliest = event.available_time as number;
    }
    return earliest;
  };

  /** Unapplied, selected events with available_time <= now (the pending count). */
  const pendingStreamEvents = (line: EpisodeLine): number => {
    let count = 0;
    for (const event of core.stream) {
      if (line.appliedIds.has(event.event_id)) continue;
      if (isSelected(event) && (event.available_time as number) <= (line.clock.now as number)) count += 1;
    }
    return count;
  };

  /** The next scripted-action instant across all declared feeds (the scheduler's peek), or null. */
  const nextScriptedInstant = (): number | null => {
    let earliest: number | null = null;
    for (const participant of core.config.participants) {
      if (participant.feed === null) continue;
      const feed = core.feeds.get(participant.feed);
      if (feed === undefined) continue;
      const next = feed.peek();
      if (next !== null && (earliest === null || (next.at as number) < earliest)) earliest = next.at as number;
    }
    return earliest;
  };

  /** Scripted actions with at <= now that have not fired (the pending count). */
  const pendingScriptedActions = (line: EpisodeLine): number => {
    let count = 0;
    for (const participant of core.config.participants) {
      if (participant.feed === null) continue;
      const feed = core.feeds.get(participant.feed);
      if (feed === undefined) continue;
      const next = feed.peek();
      if (next !== null && (next.at as number) <= (line.clock.now as number)) count += 1;
    }
    return count;
  };

  /** Is the world settled (stream + feeds caught up with now)? */
  const isSettled = (line: EpisodeLine): boolean =>
    pendingStreamEvents(line) === 0 && pendingScriptedActions(line) === 0;

  // --- The observation minting (engine outcomes) ----------------------------

  /** Mint the next observation identity (deterministic: emission order). */
  const nextObservationId = (line: EpisodeLine): string => {
    line.eventCounter += 1;
    return `rmo-${String(line.eventCounter).padStart(8, '0')}`;
  };

  /** Emit one engine outcome as an observation (the payload IS the outcome, forensic completeness). */
  const emitOutcome = (
    line: EpisodeLine,
    kind: 'fill' | 'order_ack' | 'order_reject' | 'order_cancel' | 'order_expired' | 'book_top',
    availableTime: TimestampMs,
    payload: JsonValue,
    source: string,
  ): void => {
    const observation: ReactiveObservation = deepFreeze({
      observation_id: nextObservationId(line),
      available_time: availableTime,
      venue: core.config.exchange.venue,
      instrument: core.config.exchange.instrument,
      payload,
      provenance: { origin: 'simulated', source, derived_from: [] },
      run_ref: runId(),
      tenant: core.config.tenant,
      project: core.config.project,
    });
    line.observations.push(observation);
  };

  /** Emit every outcome of one engine submission (AFTER the engine state is committed). */
  const emitSubmission = (line: EpisodeLine, outcome: SubmitOutcomeMirror): void => {
    if (isOrderAckMirror(outcome.ack)) {
      emitOutcome(line, 'order_ack', outcome.ack.quartet.available_time, deepFreeze({ kind: 'order_ack', data: outcome.ack as unknown as JsonValue }), 'reactive-market-engine');
    } else {
      emitOutcome(line, 'order_reject', outcome.ack.quartet.available_time, deepFreeze({ kind: 'order_reject', data: outcome.ack as unknown as JsonValue }), 'reactive-market-engine');
    }
    for (const fill of outcome.fills) {
      emitOutcome(line, 'fill', fill.quartet.available_time, deepFreeze({ kind: 'fill', data: fill as unknown as JsonValue }), 'reactive-market-engine');
    }
    for (const cancel of outcome.cancels) {
      emitOutcome(line, 'order_cancel', cancel.quartet.available_time, deepFreeze({ kind: 'order_cancel', data: cancel as unknown as JsonValue }), 'reactive-market-engine');
    }
  };

  /** Emit the book-top view when it changed (raw levels, verbatim — no arithmetic). */
  const maybeEmitBookTop = (line: EpisodeLine, at: TimestampMs): void => {
    const view = bookTopView(line.engine.book);
    const key = bookTopKey(view);
    if (key === line.lastBookTopKey) return;
    line.lastBookTopKey = key;
    emitOutcome(line, 'book_top', at, deepFreeze({ kind: 'book_top', data: { at, view: view as unknown as JsonValue } }), 'reactive-market-engine');
  };

  // --- The engine submission path (shared by driver + scripted actions) -----

  /** Submit one action envelope to the engine at its instant (THE reactive act). */
  const submitToEngine = (
    line: EpisodeLine,
    action: ActionEnvelope,
    payload: EngineActionPayload,
  ): ReactiveResult<{ readonly outcome: SubmitOutcomeMirror | CancelOutcomeMirror; readonly receipt: ActionReceipt }> => {
    // Causal law (inclusive): an action may not claim submission after now.
    if ((action.submitted_at as number) > (line.clock.now as number)) {
      return fail('action_from_future', `action ${action.action_id} claims submission at ${String(action.submitted_at)}, after the episode's now ${String(line.clock.now)}`);
    }
    // Engine arrival law (the T010 service law, mirrored): the engine
    // matches in ARRIVAL order — a driver that advanced the engine past the
    // action's instant cannot retro-match; submit at the current instant.
    if ((action.submitted_at as number) < (line.engine.now as number)) {
      return fail('arrival_before_engine', `action ${action.action_id} claims submission at ${String(action.submitted_at)}, before the engine's clock ${String(line.engine.now)} — the exchange matches in arrival order; submit at the current instant or advance later`);
    }
    // Engine arrival law: the engine matches in arrival order; if the
    // engine clock lags the action instant (possible while stream steps
    // are pending), advance it first so expirations at or before the
    // instant have fired — deterministic and declared.
    if ((action.submitted_at as number) > (line.engine.now as number)) {
      const advanced = core.engine.advanceEngine(line.engine, action.submitted_at);
      if (!advanced.ok) return liftEngineError(advanced);
      const advanceOutcome: AdvanceOutcomeMirror = advanced.value;
      line.engine = advanceOutcome.state;
      for (const expiration of advanceOutcome.expirations) {
        emitOutcome(line, 'order_expired', expiration.quartet.available_time, deepFreeze({ kind: 'order_expired', data: expiration as unknown as JsonValue }), 'reactive-market-engine');
      }
    }

    let outcome: SubmitOutcomeMirror | CancelOutcomeMirror;
    if (payload.type === 'submit_order') {
      const submitted = core.engine.submitOrder(line.engine, payload.intent, action.submitted_at);
      if (!submitted.ok) return liftEngineError(submitted);
      outcome = submitted.value;
    } else if (payload.type === 'cancel_order') {
      const canceled = core.engine.cancelOrder(line.engine, { order_id: payload.order_id }, action.submitted_at);
      if (!canceled.ok) return liftEngineError(canceled);
      outcome = canceled.value;
    } else {
      const canceled = core.engine.cancelOrder(line.engine, { client_order_id: payload.client_order_id }, action.submitted_at);
      if (!canceled.ok) return liftEngineError(canceled);
      outcome = canceled.value;
    }

    // Commit the engine state FIRST, then emit (emission reads the new book).
    line.engine = outcome.state;
    if ('ack' in outcome) {
      emitSubmission(line, outcome);
      // The fills: append the physics-lineage records (the reactive difference's ledger).
      const intakeAck = outcome.ack;
      for (const fill of outcome.fills) {
        line.fills.push(
          deepFreeze({
            fill,
            fill_id: fill.fill_id,
            episode_id: line.episodeId,
            run_ref: runId(),
            taker_participant: action.actor,
            taker_order_id: intakeAck.order_id,
            maker_order_id: fill.maker_order_id,
            physics: lineageOf(runId()),
          }),
        );
      }
    } else {
      const cancel: OrderCancelMirror = outcome.cancel;
      emitOutcome(line, 'order_cancel', cancel.quartet.available_time, deepFreeze({ kind: 'order_cancel', data: cancel as unknown as JsonValue }), 'reactive-market-engine');
    }
    maybeEmitBookTop(line, action.submitted_at);
    line.acceptedActions.push(action);

    const intakeSummary: ActionReceipt['engine'] =
      'ack' in outcome
        ? {
            kind: isOrderAckMirror(outcome.ack) ? 'ack' : 'reject',
            order_id: outcome.ack.order_id,
            status: isOrderAckMirror(outcome.ack) ? outcome.ack.status : `rejected:${outcome.ack.reason}`,
            reject_reason: isOrderAckMirror(outcome.ack) ? null : outcome.ack.reason,
            fill_ids: outcome.fills.map((fill) => fill.fill_id),
          }
        : {
            kind: 'cancel',
            order_id: outcome.cancel.order_id,
            status: `canceled:${outcome.cancel.reason}`,
            reject_reason: null,
            fill_ids: [],
          };

    const receipt: ActionReceipt = deepFreeze({
      receipt_id: deriveReceiptId(line.episodeId, action.action_id),
      episode_id: line.episodeId,
      action_id: action.action_id,
      actor: action.actor,
      client_sequence: action.client_sequence,
      recorded_at: line.clock.now,
      disposition: 'engine_matched',
      engine: intakeSummary,
      physics: lineageOf(runId()),
    });
    line.receipts.push(receipt);
    return ok({ outcome, receipt });
  };

  // --- The boundary step machine (the declared interleaving) ----------------

  /** What an action payload may ask the engine to do (the T010 vocabulary). */
  type EngineActionPayload =
    | { readonly type: 'submit_order'; readonly intent: Record<string, unknown> }
    | { readonly type: 'cancel_order'; readonly order_id: string }
    | { readonly type: 'cancel_client_order'; readonly client_order_id: string };

  /** Validate an action payload (the engine validates the intent itself — the T010 pattern). */
  function validateActionPayload(payload: JsonValue): ReactiveResult<EngineActionPayload> {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return fail('invalid_action', 'the action payload must be an object');
    }
    const candidate = payload as Record<string, unknown>;
    if (candidate.type === 'submit_order') {
      if (typeof candidate.intent !== 'object' || candidate.intent === null || Array.isArray(candidate.intent)) {
        return fail('invalid_action', 'submit_order requires an order intent object', 'payload.intent');
      }
      return ok({ type: 'submit_order', intent: candidate.intent as Record<string, unknown> });
    }
    if (candidate.type === 'cancel_order') {
      if (typeof candidate.order_id !== 'string' || candidate.order_id.length === 0) {
        return fail('invalid_action', 'cancel_order requires a non-empty order_id', 'payload.order_id');
      }
      return ok({ type: 'cancel_order', order_id: candidate.order_id });
    }
    if (candidate.type === 'cancel_client_order') {
      if (typeof candidate.client_order_id !== 'string' || candidate.client_order_id.length === 0) {
        return fail('invalid_action', 'cancel_client_order requires a non-empty client_order_id', 'payload.client_order_id');
      }
      return ok({ type: 'cancel_client_order', client_order_id: candidate.client_order_id });
    }
    return fail('invalid_action', "the action payload type must be 'submit_order' | 'cancel_order' | 'cancel_client_order'", 'payload.type');
  }

  /**
   * Apply one stream step: every selected UNAPPLIED event with
   * `available_time <= boundary`, in LOADED order. Application is BY
   * AVAILABILITY (a due event loaded behind a not-yet-due one is applied
   * at its own boundary — never blocked); within one boundary the loaded
   * order rules (the recorded arrival order — deterministic).
   */
  const applyStreamStep = (line: EpisodeLine, boundary: TimestampMs): number => {
    let applied = 0;
    for (const event of core.stream) {
      if (line.appliedIds.has(event.event_id)) continue;
      if (!isSelected(event)) continue;
      if ((event.available_time as number) > (boundary as number)) continue;
      const observation: ReactiveObservation = deepFreeze({
        observation_id: event.event_id, // recorded event ids are unique for the world's lifetime
        available_time: event.available_time,
        venue: event.venue,
        instrument: event.instrument,
        payload: event as unknown as JsonValue, // the FULL recorded envelope — forensic completeness
        provenance: {
          origin: 'historical',
          source: event.provenance.adapter === null ? null : `${event.provenance.adapter.id}@${event.provenance.adapter.version}`,
          derived_from: [...event.provenance.derived_from],
        },
        run_ref: runId(),
        tenant: core.config.tenant,
        project: core.config.project,
      });
      line.observations.push(observation);
      line.appliedIds.add(event.event_id);
      applied += 1;
    }
    line.appliedThrough = boundary;
    return applied;
  };

  /** Fire every scripted action due at or before the boundary (roster order — deterministic). */
  const fireScriptedActions = (line: EpisodeLine, boundary: TimestampMs): ReactiveResult<number> => {
    let fired = 0;
    for (const participant of core.config.participants) {
      if (participant.feed === null) continue;
      const feed = core.feeds.get(participant.feed);
      if (feed === undefined) continue;
      for (;;) {
        const next = feed.peek();
        if (next === null) break;
        if ((next.at as number) > (boundary as number)) break;
        // The feed contract: nondecreasing instants, envelope valid, actor
        // is the owner (validated at construction for literal scripts;
        // arbitrary ports are validated HERE — fail-closed).
        if (!isActionEnvelope(next.action)) {
          return fail('invalid_action', `participant "${participant.instance}" fed a malformed action envelope`);
        }
        if (next.action.actor !== participant.instance) {
          return fail('interleaving_violation', `the feed of participant "${participant.instance}" acted as "${String(next.action.actor)}" — feeds act as their owner only`);
        }
        if ((next.at as number) < (line.engine.now as number)) {
          return fail('interleaving_violation', `participant "${participant.instance}" fed action ${next.action.action_id} at instant ${String(next.at)}, before the engine's clock ${String(line.engine.now)} — scripted actions must be nondecreasing in 'at'`);
        }
        // Per-actor client_sequence ordering + action-id uniqueness (both channels).
        const lastSequence = line.sequences.get(next.action.actor);
        if (lastSequence !== undefined && next.action.client_sequence <= lastSequence) {
          return fail('stale_sequence', `participant "${participant.instance}" fed action ${next.action.action_id} with client_sequence ${String(next.action.client_sequence)}, not greater than the actor's last accepted ${String(lastSequence)}`);
        }
        if (line.actionIds.has(next.action.action_id)) {
          return fail('duplicate_action', `action id "${next.action.action_id}" is already recorded in episode ${line.episodeId}`);
        }
        const payloadResult = validateActionPayload(next.action.payload);
        if (!payloadResult.ok) return payloadResult;

        const consumed = feed.take();
        if (consumed === null) break;
        const submitted = submitToEngine(line, consumed.action, payloadResult.value);
        if (!submitted.ok) return submitted;
        line.sequences.set(consumed.action.actor, consumed.action.client_sequence);
        line.actionIds.add(consumed.action.action_id);
        line.scriptedLog.push(deepFreeze({ participant: participant.instance, at: consumed.at, action_id: consumed.action.action_id }));
        fired += 1;
      }
    }
    return ok(fired);
  };

  /**
   * Process ONE boundary (the interleaving order): the stream step and the
   * scripted actions at `boundary`, ordered by the declared policy, with
   * the engine advanced to the boundary between them (expirations fire at
   * their instants, before any action at the same instant matches).
   */
  const processBoundary = (line: EpisodeLine, boundary: TimestampMs): ReactiveResult<void> => {
    const streamDue = (() => {
      const next = nextStreamInstant(line);
      return next !== null && next <= (boundary as number);
    })();
    const policy = core.config.interleaving;

    // 1. The stream step first, when the policy orders it so.
    if (streamDue && (policy.kind === 'stream_first' || policy.kind === 'unrestricted')) {
      applyStreamStep(line, boundary);
    }

    // 2. The engine advance to the boundary (gtt expirations, engine clock).
    if ((boundary as number) > (line.engine.now as number)) {
      const advanced = core.engine.advanceEngine(line.engine, boundary);
      if (!advanced.ok) return liftEngineError(advanced);
      line.engine = advanced.value.state;
      for (const expiration of advanced.value.expirations) {
        emitOutcome(line, 'order_expired', expiration.quartet.available_time, deepFreeze({ kind: 'order_expired', data: expiration as unknown as JsonValue }), 'reactive-market-engine');
      }
    }

    // 3. The scripted actions due at or before the boundary.
    const fired = fireScriptedActions(line, boundary);
    if (!fired.ok) return fired;

    // 4. The stream step last, when the policy orders actions first.
    if (streamDue && policy.kind === 'actions_first') {
      applyStreamStep(line, boundary);
    }

    // 5. The book-top view (change-detected).
    maybeEmitBookTop(line, boundary);
    return ok(undefined);
  };

  /** The episode view (structurally an EpisodeState + the step dashboard). */
  const viewOf = (line: EpisodeLine): ReactiveEpisodeView =>
    deepFreeze({
      episode_id: line.episodeId,
      spec: line.spec,
      clock: line.clock,
      status: line.status,
      termination: line.termination,
      pending: [...line.observations],
      accepted_actions: [...line.acceptedActions],
      rewards: [],
      settled: isSettled(line),
      pending_stream_events: pendingStreamEvents(line),
      pending_scripted_actions: pendingScriptedActions(line),
      applied_through: line.appliedThrough,
    });

  // -------------------------------------------------------------------------
  // The service object
  // -------------------------------------------------------------------------

  const service: ReactiveWorldService = {
    get config(): ReactiveWorldConfig {
      return core.config;
    },
    get config_hash(): string {
      return core.configHashValue;
    },
    get engine_config_hash(): string {
      return core.engineHash;
    },
    get world_id(): string {
      return core.config.world_id;
    },
    get run_id(): string {
      return runId();
    },
    get episodes(): readonly EpisodeId[] {
      return core.order.slice() as unknown as readonly EpisodeId[];
    },

    async loadNextBatch(): Promise<ReactiveResult<LoadOutcome>> {
      if (core.order.length > 0) {
        return fail('invalid_state', 'episodes have bound to this world; the stream is closed (load fully before start — the load-then-bind discipline)');
      }
      if (core.sourceDone) {
        return ok({ done: true, batches_consumed: core.batchesConsumed, events_applied: core.stream.length, chain_head: chainHead() });
      }
      const pulled = await core.iterator.next();
      if (pulled.done === true) {
        core.sourceDone = true;
        return ok({ done: true, batches_consumed: core.batchesConsumed, events_applied: core.stream.length, chain_head: chainHead() });
      }
      const batch = pulled.value;
      if (!Array.isArray(batch)) {
        return fail('invalid_source', 'the event source yielded a non-array batch');
      }
      // Validate every record (collect-all), enforce the stream selection,
      // the as_of anchor, per-stream sequence discipline and duplicate ids.
      // TRANSACTIONAL: the trackers commit only when the whole batch passes.
      const validated: RecordedEvent[] = [];
      const batchErrors: { code: 'stream_not_selected' | 'event_beyond_as_of' | 'sequence_regression' | 'duplicate_event_id'; path: string; message: string }[] = [];
      const batchSequences = new Map<string, number>();
      const batchIds = new Set<string>();
      for (let index = 0; index < batch.length; index++) {
        const record = batch[index];
        const result = validateRecordedEvent(record, `batch[${index}]`, true);
        if (!result.ok) return { ok: false, errors: result.errors };
        const event = result.value;
        const key = `${event.venue}|${event.instrument}|${event.event_type === 'other' ? otherStreamOf(event) : event.event_type}`;
        if (!isSelected(event)) {
          batchErrors.push({ code: 'stream_not_selected', path: `batch[${index}]`, message: `event ${event.event_id} belongs to stream (${event.venue}, ${event.instrument}) which this world does not select` });
          continue;
        }
        if ((event.available_time as number) > (core.config.as_of as number)) {
          batchErrors.push({ code: 'event_beyond_as_of', path: `batch[${index}]`, message: `event ${event.event_id} becomes available at ${String(event.available_time)}, beyond the world's as_of anchor ${String(core.config.as_of)}` });
          continue;
        }
        const lastSequence = batchSequences.get(key) ?? core.streamSequences.get(key) ?? 0;
        if (event.sequence <= lastSequence) {
          batchErrors.push({ code: 'sequence_regression', path: `batch[${index}].sequence`, message: `event ${event.event_id} carries sequence ${String(event.sequence)} for stream ${key}, not greater than the stream's last ${String(lastSequence)} — the per-stream sequence discipline` });
          continue;
        }
        if (batchIds.has(event.event_id) || core.eventIds.has(event.event_id)) {
          batchErrors.push({ code: 'duplicate_event_id', path: `batch[${index}].event_id`, message: `event id "${event.event_id}" was already ingested — recorded event ids are unique for the world's lifetime` });
          continue;
        }
        batchSequences.set(key, event.sequence);
        batchIds.add(event.event_id);
        validated.push(event);
      }
      if (batchErrors.length > 0) return { ok: false, errors: batchErrors };

      // Commit (transactional): stream, trackers, chain.
      for (const event of validated) {
        core.stream.push(event);
        core.eventIds.add(event.event_id);
      }
      for (const [key, sequence] of batchSequences) {
        core.streamSequences.set(key, sequence);
      }
      core.batchesConsumed += 1;
      core.batchSizes.push(validated.length);
      const head = chainDigest(chainHead(), validated);
      core.ingestChain.push(head);
      return ok({ done: false, batches_consumed: core.batchesConsumed, events_applied: core.stream.length, chain_head: head });
    },

    async loadAll(): Promise<ReactiveResult<LoadSummary>> {
      for (;;) {
        const outcome = await service.loadNextBatch();
        if (!outcome.ok) return outcome;
        if (outcome.value.done) {
          return ok({ batches: core.batchesConsumed, events: core.stream.length, chain_head: chainHead() });
        }
      }
    },

    start(spec: unknown): ReactiveResult<ReactiveEpisodeView> {
      if (!core.sourceDone) {
        return fail('invalid_state', 'the recorded stream is not fully loaded yet — call loadAll() before starting an episode (the load-then-bind discipline)');
      }
      const specResult = validateEnvironmentSpec(spec);
      if (!specResult.ok) {
        return { ok: false, errors: specResult.errors.map((error) => ({ code: 'invalid_spec' as const, path: error.path, message: error.message })) };
      }
      const validSpec = specResult.value;

      // Bind to THIS world.
      if (validSpec.world.world_id !== core.config.world_id) {
        return fail('world_binding_mismatch', `spec.world.world_id "${validSpec.world.world_id}" does not name this world ("${core.config.world_id}")`, 'spec.world.world_id');
      }
      if (validSpec.world.kind !== 'reactive') {
        return fail('world_binding_mismatch', `spec.world.kind "${validSpec.world.kind}" is not 'reactive'`, 'spec.world.kind');
      }

      // L5 mode honesty: the spec's fidelity must be 'reactive_replay' —
      // an exact-replay claim about a world that MATCHES is a lie.
      if (validSpec.profile.fidelity !== 'reactive_replay') {
        return fail(
          'fidelity_claim_dishonest',
          `spec.profile.fidelity '${validSpec.profile.fidelity}' is dishonest for a reactive world — this world MATCHES endogenous intents against the engine and must be declared 'reactive_replay' (L5: the modes are distinct, never conflated)`,
          'spec.profile.fidelity',
        );
      }
      if (validSpec.profile.clock.fidelity !== 'reactive_replay') {
        return fail(
          'fidelity_claim_dishonest',
          `spec.profile.clock.fidelity '${validSpec.profile.clock.fidelity}' must be 'reactive_replay' — the clock's mode must agree with the world's (L5)`,
          'spec.profile.clock.fidelity',
        );
      }

      // The as_of anchor: no episode clock may anchor beyond the world's.
      if ((validSpec.profile.clock.asOf as number) > (core.config.as_of as number)) {
        return fail('beyond_as_of', `the episode's asOf ${String(validSpec.profile.clock.asOf)} exceeds the world's as_of anchor ${String(core.config.as_of)}`, 'spec.profile.clock.asOf');
      }

      const episodeId = deriveEpisodeId(validSpec);
      if (core.lines.has(episodeId)) {
        return fail('duplicate_episode', `episode ${episodeId} is already registered — an episode id is a unique run; re-running a spec requires a fresh service or a distinct seed`);
      }

      // Seed the engine: the LATEST recorded book_snapshot AVAILABLE at or
      // before the episode's start instant (the L4-honest seed — the world
      // never seeds from future information).
      const startAt = validSpec.profile.clock.now;
      let seedSnapshot: RecordedEvent | null = null;
      for (const event of core.stream) {
        if (event.event_type !== 'book_snapshot') continue;
        if (!isSelected(event)) continue;
        if ((event.available_time as number) <= (startAt as number)) {
          seedSnapshot = event; // loaded order — the LATEST available wins
        }
      }
      const engineResult = core.engine.createEngine(core.config.exchange, {
        book_seed: seedSnapshot === null ? undefined : seedSnapshot.payload,
        start_at: startAt,
      });
      if (!engineResult.ok) return liftEngineError(engineResult);

      const line: EpisodeLine = {
        spec: validSpec,
        episodeId,
        clock: validSpec.profile.clock,
        appliedIds: new Set<string>(),
        appliedThrough: 0 as TimestampMs,
        engine: engineResult.value,
        observations: [],
        acceptedActions: [],
        receipts: [],
        fills: [],
        scriptedLog: [],
        advances: [],
        observationQueries: 0,
        observationsServed: 0,
        status: 'running',
        termination: null,
        eventCounter: 0,
        lastBookTopKey: null,
        seedSnapshotRef: seedSnapshot === null ? null : seedSnapshot.event_id,
        sequences: new Map<string, number>(),
        actionIds: new Set<string>(),
      };

      // Arm the stream: apply the opening settlement — every selected
      // event available at or before the start instant (the episode opens
      // on the recorded world as it stood).
      applyStreamStep(line, startAt);
      maybeEmitBookTop(line, startAt);

      core.lines.set(episodeId, line);
      core.order.push(episodeId);
      return ok(viewOf(line));
    },

    observe(episode: string, at: TimestampMs): ReactiveResult<readonly ReactiveObservation[]> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const line = found.value;
      if (!isTimestampMs(at)) {
        return fail('invalid_timestamp', 'observe requires a valid TimestampMs instant');
      }
      if ((at as number) > (line.clock.now as number)) {
        return fail('observation_beyond_now', `cannot observe at ${String(at)}: the episode's current now is ${String(line.clock.now)} (L4 — the declared information boundary)`);
      }
      // The inclusive L4 boundary: available_time <= at, gated.
      const visible = line.observations.filter((observation) => (observation.available_time as number) <= (at as number));
      const admitted = admitObservations(visible, at); // defense in depth — the typed gate
      if (!admitted.ok) return admitted;
      line.observationQueries += 1;
      line.observationsServed += visible.length;
      return ok(deepFreeze([...visible]));
    },

    submit(episode: string, action: unknown): ReactiveResult<ReactiveSubmission> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const line = found.value;
      if (line.status === 'finished') {
        return fail('episode_finished', `episode ${episode} is finished; actions are rejected`);
      }
      if (!isActionEnvelope(action)) {
        return fail('invalid_action', 'the action envelope must carry action_id, actor, submitted_at, client_sequence and a JSON payload');
      }
      const validAction = action;

      // The roster law: only DECLARED participants may act.
      const declared = core.config.participants.some((participant) => participant.instance === validAction.actor);
      if (!declared) {
        return fail('unknown_participant', `actor "${validAction.actor}" is not a declared participant of this world — endogenous actors are declared, never ambient`);
      }

      // The interleaving law: strict policies require the world settled at
      // the submit instant (no unabsorbed recorded events at/before now).
      if (policyRequiresSettled(core.config.interleaving)) {
        const pending = pendingStreamEvents(line);
        if (pending > 0) {
          return fail(
            'interleaving_violation',
            `actor "${validAction.actor}" submitted while ${pending} recorded event(s) at or before now are unabsorbed — the declared '${core.config.interleaving.kind}' policy forbids acting mid-stream-step (advance until settled, then act)`,
          );
        }
      }

      // Per-actor request ordering + action-id uniqueness.
      const lastSequence = line.sequences.get(validAction.actor);
      if (lastSequence !== undefined && validAction.client_sequence <= lastSequence) {
        return fail('stale_sequence', `action ${validAction.action_id} carries client_sequence ${String(validAction.client_sequence)}, not greater than the actor's last accepted ${String(lastSequence)}`);
      }
      if (line.actionIds.has(validAction.action_id)) {
        return fail('duplicate_action', `action id "${validAction.action_id}" is already recorded in episode ${episode}`);
      }

      const payloadResult = validateActionPayload(validAction.payload);
      if (!payloadResult.ok) return payloadResult;

      const submitted = submitToEngine(line, validAction, payloadResult.value);
      if (!submitted.ok) return submitted;
      line.sequences.set(validAction.actor, validAction.client_sequence);
      line.actionIds.add(validAction.action_id);
      return ok(deepFreeze({ ...viewOf(line), receipt: submitted.value.receipt }));
    },

    advance(episode: string, to: TimestampMs): ReactiveResult<ReactiveEpisodeView> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const line = found.value;
      if (line.status === 'finished') {
        return fail('episode_finished', `episode ${episode} is finished; the clock is frozen`);
      }
      if (!isTimestampMs(to)) {
        return fail('invalid_timestamp', 'advance requires a valid TimestampMs target');
      }
      if ((to as number) < (line.clock.now as number)) {
        return fail('clock_regression', `the episode clock may not move backwards: now=${String(line.clock.now)}, target=${String(to)}`);
      }
      if ((to as number) > (line.clock.asOf as number)) {
        return fail('beyond_as_of', `the episode clock may not advance past asOf: asOf=${String(line.clock.asOf)}, target=${String(to)}`);
      }

      // The clock moves to the target FIRST (the driver's declaration);
      // the boundary machine then processes exactly ONE boundary.
      const from = line.clock.now;
      line.clock = deepFreeze({ ...line.clock, now: to });
      line.advances.push({ from, to });

      // The next boundary: the earliest of the next stream availability,
      // the next scripted-action instant, and the target itself.
      let boundary: number = to as number;
      const nextEventAt = nextStreamInstant(line);
      if (nextEventAt !== null && nextEventAt <= (to as number) && nextEventAt < boundary) {
        boundary = nextEventAt;
      }
      const nextActionAt = nextScriptedInstant();
      if (nextActionAt !== null && nextActionAt <= (to as number) && nextActionAt < boundary) {
        boundary = nextActionAt;
      }

      const processed = processBoundary(line, boundary as TimestampMs);
      if (!processed.ok) {
        // The clock has moved and the boundary failed mid-processing: every
        // sub-step committed BEFORE the failure (stream observations, engine
        // transitions, already-fired actions) stays committed — each is
        // individually complete and recorded, so the episode state remains
        // consistent and auditable; the typed error names the violated law
        // and the driver may finish/abort the episode. (Full boundary
        // staging is deliberately NOT attempted: a half-processed boundary
        // is still a deterministic, explainable world state, and the failure
        // modes here are driver/feed contract violations, not physics.)
        return processed;
      }
      return ok(viewOf(line));
    },

    finish(episode: string, reason: unknown): ReactiveResult<ReactiveEpisodeFinish> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const line = found.value;
      if (line.status === 'finished') {
        return fail('episode_finished', `episode ${episode} is already finished`);
      }
      if (!isTerminationReason(reason)) {
        return fail('invalid_termination', 'the termination reason must be one of completed | terminal | step_limit | aborted with a non-empty detail');
      }
      line.status = 'finished';
      line.termination = reason;
      const view = viewOf(line);
      const result = deepFreeze({
        episode_id: line.episodeId,
        environment_id: line.spec.profile.environment_id,
        spec: line.spec,
        termination: reason,
        final_now: line.clock.now,
        accepted_action_count: line.acceptedActions.length,
        pending_observation_count: view.pending.length,
        rewards: [] as const,
      });
      return ok(deepFreeze({ episode: view, result }));
    },

    startEpisode(spec: unknown): ReactiveResult<ReactiveEpisodeView> {
      return service.start(spec);
    },
    emitObservations(episode: string, at: TimestampMs): ReactiveResult<readonly ReactiveObservation[]> {
      return service.observe(episode, at);
    },
    submitAction(episode: string, action: unknown): ReactiveResult<ReactiveSubmission> {
      return service.submit(episode, action);
    },
    advanceEpisode(episode: string, to: TimestampMs): ReactiveResult<ReactiveEpisodeView> {
      return service.advance(episode, to);
    },
    finishEpisode(episode: string, reason: unknown): ReactiveResult<ReactiveEpisodeFinish> {
      return service.finish(episode, reason);
    },

    runRecord(episode: string): ReactiveResult<ReactiveRunRecord> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const line = found.value;
      if (line.status !== 'finished' || line.termination === null) {
        return fail('episode_not_finished', 'the run record is only available for a finished episode');
      }
      return buildRunRecord({
        config: core.config,
        spec: line.spec,
        state: viewOf(line),
        termination: line.termination,
        chainHead: chainHead(),
        batchesConsumed: core.batchesConsumed,
        streamEventCount: core.stream.length,
        engine: line.engine,
        fills: line.fills,
        receipts: line.receipts,
        scriptedLog: line.scriptedLog,
        runLog: { advances: line.advances, observation_queries: line.observationQueries, observations_served: line.observationsServed },
        runId: runId(),
        pendingAtFinish: viewOf(line).pending_stream_events,
        bookSeedRef: line.seedSnapshotRef,
      });
    },

    exportRunState(episode?: string): ReactiveResult<ReactiveRunState> {
      if (episode === undefined) {
        if (core.order.length > 0) {
          return fail('invalid_state', 'episodes have bound; export the run state OF an episode instead');
        }
        return ok(
          deepFreeze({
            schema: 'tradrl/reactive-run-state@1' as const,
            phase: 'loading' as const,
            config: core.config,
            batches_consumed: core.batchesConsumed,
            ingest_chain: [...core.ingestChain],
            batch_sizes: [...core.batchSizes],
            source_done: core.sourceDone,
            stream: [...core.stream],
            episode_line: null,
            run_log: emptyRunLog(),
          }),
        );
      }
      const found = lookup(episode);
      if (!found.ok) return found;
      const line = found.value;
      return ok(
        deepFreeze({
          schema: 'tradrl/reactive-run-state@1' as const,
          phase: 'episode' as const,
          config: core.config,
          batches_consumed: core.batchesConsumed,
          ingest_chain: [...core.ingestChain],
          batch_sizes: [...core.batchSizes],
          source_done: core.sourceDone,
          stream: [...core.stream],
          episode_line: deepFreeze({
            spec: line.spec,
            clock_now: line.clock.now,
            clock_as_of: line.clock.asOf,
            applied_through: line.appliedThrough,
            applied_event_ids: [...line.appliedIds],
            engine_state: line.engine,
            observations: [...line.observations],
            accepted_actions: [...line.acceptedActions],
            receipts: [...line.receipts],
            fills: [...line.fills],
            scripted_log: [...line.scriptedLog],
            advances: [...line.advances],
            observation_queries: line.observationQueries,
            observations_served: line.observationsServed,
            status: line.status,
            termination: line.termination,
            event_counter: line.eventCounter,
            last_book_top_key: line.lastBookTopKey,
            seed_snapshot_ref: line.seedSnapshotRef,
          }),
          run_log: deepFreeze({
            advances: [...line.advances],
            observation_queries: line.observationQueries,
            observations_served: line.observationsServed,
          }),
        }),
      );
    },

    fills(episode: string): ReactiveResult<readonly ReactiveFillRecord[]> {
      const found = lookup(episode);
      if (!found.ok) return found;
      return ok(deepFreeze([...found.value.fills]));
    },

    engineState(episode: string): ReactiveResult<EngineStateMirror> {
      const found = lookup(episode);
      if (!found.ok) return found;
      return ok(found.value.engine);
    },

    engineStateHash(episode: string): ReactiveResult<string> {
      const found = lookup(episode);
      if (!found.ok) return found;
      return ok(engineStateHash(found.value.engine));
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// Local helpers (pure)
// ---------------------------------------------------------------------------

/** The per-stream key of an `other` event (mirrors market-protocol's stream scoping). */
function otherStreamOf(event: RecordedEvent): string {
  if (typeof event.payload !== 'object' || event.payload === null || Array.isArray(event.payload)) return 'other';
  const kind = (event.payload as { readonly [key: string]: JsonValue }).kind;
  return typeof kind === 'string' && kind.length > 0 ? `other:${kind}` : 'other';
}
