/**
 * @tradrl/market-world (generative service) — the GenerativeWorldService
 * (work order T028): the counterfactual/generative world — the THIRD L5
 * fidelity class.
 *
 * THE GENERATIVE DIFFERENCE (the existential law): there IS no recorded
 * stream — "entire market POPULATIONS are generated from declared
 * stochastic processes, for stress/exploration regimes history never
 * provided." The recorded-stream machinery of the replay (T009) and
 * reactive (T027) lanes has NO counterpart here: the config's process
 * declarations + population spec ARE the complete data declaration, and
 * the world's five Environment operations evolve a real matching engine
 * (the injected {@link EngineDriver} — the REAL exchange-sim reducer,
 * never reimplemented) through the generated population's actions.
 * Endogenous candidate-organization actions are matched by the engine
 * with full physics lineage (T027's discipline, verbatim).
 *
 * THE LAYERING:
 *
 *     GenerativeWorldConfig (the DECLARATION: population spec + seeded
 *             │            versioned stochastic processes + physics)
 *             ▼
 *     startEpisode ──► engine SEEDED (the declared initial book), every
 *             │          process ARMED (its serializable seeded runtime),
 *             │          the opening book-top observation emitted
 *             ▼
 *     advanceEpisode ─► the BOUNDARY STEP MACHINE: ONE boundary per
 *             │          advance — the earliest of (the next due process
 *             │          step instant, the target). At the boundary:
 *             │          the L4-honest anchor cursor advances, the engine
 *             │          advances (expirations), every due process STEPS
 *             │          (pure generation over the honest context), the
 *             │          emissions apply per the DECLARED interleaving
 *             │          policy (quote logging vs population submission
 *             │          order), the book-top view refreshes.
 *             ▼
 *     submitAction ──► EngineDriver.submitOrder / cancelOrder (THE MATCH)
 *             │          → typed receipts + fills with physics lineage.
 *             │          The candidate alone acts here — a submission in a
 *             │          population participant's name is `actor_not_candidate`
 *             │          (it would inject ambient, unlineaged actions).
 *             ▼
 *     emitObservations ─► the inclusive L4 boundary over generated events
 *                          AND engine outcomes (admitObservations gates);
 *                          every observation carries synthetic provenance.
 *             ▼
 *     GenerativeRunRecord (L9: config hash, generation-chain head, spec
 *                          hash, ENGINE STATE HASH, PROCESS STATE HASH —
 *                          the stochastic state byte-bound — digest) +
 *                          resumable GenerativeRunState.
 *
 * THE INTERLEAVING LAW (determinism): "Participant action ORDER matters
 * and is part of the deterministic function (declared interleaving)."
 * Process stepping order is the ARMED order (the world walk, then each
 * cohort's participants in ordinal order — the config's own order, a
 * pure function of the declaration); the declared policy orders the
 * quote-event delivery against the population's submissions; strict
 * policies additionally require the world SETTLED before a driver submit
 * (acting mid-process-step is the typed `interleaving_violation`). Loop
 * `advance` until the view reports `settled` to absorb a whole window.
 *
 * RESUMABILITY (the hard part — the stochastic processes mid-stream):
 * exportRunState serializes the episode line INCLUDING every process's
 * runtime state (the xorshift32 state IS the process's randomness).
 * Resume re-validates the config, restores the line, and VERIFIES three
 * independent integrity anchors — the generation chain (re-folded event
 * by event), the PROCESS STATE hash (the restored randomness is the
 * recorded randomness) and the ENGINE STATE hash — each tamper = typed
 * `chain_mismatch`; then the resumed run continues and finishes with the
 * IDENTICAL run record.
 *
 * NO AMBIENT ANYTHING: no wall clock, no Math.random, no I/O; every
 * identity is derived (FNV-1a over canonical JSON). Same (config,
 * candidate action script, injected engine) -> byte-identical world
 * evolution — engine state, fills, generated events, observations —
 * proven by the fixture tests, twice.
 */

import { deepFreeze, isRecord } from './primitives';
import type { JsonValue } from './primitives';
import { fail, ok, type GenerativeResult } from './errors';
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
import type { GenerativeWorldConfig, InterleavingPolicy, PhysicsRefs } from './config';
import { configHash, policyRequiresSettled, validateGenerativeWorldConfig } from './config';
import type { ProcessDeclaration, ProcessEmission, ProcessRuntimeState } from './process';
import { armProcess, isProcessRuntimeState, processStateHash, stepProcess, WORLD_PROCESS_INSTANCE } from './process';
import { cohortInstances } from './population';
import type {
  ActionReceipt,
  ClockAdvance,
  GenerativeFillRecord,
  GenerativeObservation,
  GenerativeRunRecord,
  GenerativeRunState,
  GeneratedEventRecord,
} from './records';
import {
  SYNTHETIC_PROVENANCE_DECLARATION,
  admitObservations,
  buildRunRecord,
  chainDigest,
  deserializeGenerativeRunState,
  isGenerativeRunLog,
  requireGeneratedEvent,
  requireGenerativeFill,
  serializeGenerativeRunState,
} from './records';

// ---------------------------------------------------------------------------
// The declared inputs (everything the world consumes — no ambient state)
// ---------------------------------------------------------------------------

/**
 * The declared inputs of a generative world: the injected matching-engine
 * driver — and NOTHING else. THE GENERATIVE DIFFERENCE vs the replay/
 * reactive lanes: there is no recorded-stream source and no scripted
 * action feeds; the population's actions are GENERATED by the config's
 * declared processes, and the candidate's actions arrive through the
 * driver-facing `submit` operation. Everything is DECLARED (the
 * no-network law); nothing is ambient.
 */
export interface GenerativeWorldInputs {
  /** The matching engine (the REAL exchange-sim reducer, injected — never imported). */
  readonly engine: EngineDriver;
}

// ---------------------------------------------------------------------------
// The episode view (structurally an EpisodeState + the step dashboard)
// ---------------------------------------------------------------------------

/**
 * The generative episode view: structurally environment-protocol's
 * `EpisodeState` (the five-operation surface returns these) PLUS the step
 * machine's dashboard — `settled`, `pending_process_steps`,
 * `applied_through` — so drivers can see the interleaving state and loop
 * advances until settled.
 */
export interface GenerativeEpisodeView extends EpisodeStateMirror {
  readonly episode_id: string;
  readonly spec: EnvironmentSpec;
  readonly clock: ClockState;
  readonly status: 'running' | 'finished';
  readonly termination: TerminationReason | null;
  readonly pending: readonly GenerativeObservation[];
  readonly accepted_actions: readonly ActionEnvelope[];
  readonly rewards: readonly [];
  /** True when no process step is due at or before now (the interleaving rest state). */
  readonly settled: boolean;
  /** Process steps with next_at <= now that have not fired yet (the mid-process-step measure). */
  readonly pending_process_steps: number;
  /** The boundary instant the step machine last processed through. */
  readonly applied_through: TimestampMs;
}

/** The submit product: the new episode view PLUS the typed receipt (a forward-compatible extra field). */
export interface GenerativeSubmission extends GenerativeEpisodeView {
  readonly receipt: ActionReceipt;
}

/** The finish product: terminal state + immutable result (structurally EpisodeFinish). */
export interface GenerativeEpisodeFinish extends EpisodeFinishMirror {
  readonly episode: GenerativeEpisodeView;
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
 * The generative world service: drive episodes through the five
 * Environment operations (structural), with the population generated by
 * the declared processes, the engine matched (full physics lineage), the
 * L4 boundary enforced, the declared interleaving honored, and the L9
 * lineage recorded (config hash, generation-chain head, engine state
 * hash, PROCESS STATE hash, digest).
 *
 * The five operations carry BOTH namings: the canonical
 * environment-protocol names (`start`/`observe`/`submit`/`advance`/
 * `finish` — the service passes `isEnvironment`-shaped guards directly)
 * and the Work Order's descriptive aliases (`startEpisode`/
 * `emitObservations`/`submitAction`/`advanceEpisode`/`finishEpisode` —
 * identical behavior).
 */
export interface GenerativeWorldService {
  /** The validated, fully-determining world config. */
  readonly config: GenerativeWorldConfig;
  /** The config's deterministic digest (binds the ENTIRE data declaration — L9). */
  readonly config_hash: string;
  /** The engine physics digest (the REAL engine's configHash — interop-tested). */
  readonly engine_config_hash: string;
  /** The deterministic world id episodes bind to. */
  readonly world_id: string;
  /** The run id (`run-<fnv1a32(config_hash)>` — the config alone binds the data declaration). */
  readonly run_id: string;
  /** All registered episode ids, in registration order. */
  readonly episodes: readonly EpisodeId[];

  // --- The episode protocol (Environment-shaped) --------------------
  start(spec: unknown): GenerativeResult<GenerativeEpisodeView>;
  observe(episode: string, at: TimestampMs): GenerativeResult<readonly GenerativeObservation[]>;
  submit(episode: string, action: unknown): GenerativeResult<GenerativeSubmission>;
  advance(episode: string, to: TimestampMs): GenerativeResult<GenerativeEpisodeView>;
  finish(episode: string, reason: unknown): GenerativeResult<GenerativeEpisodeFinish>;

  // --- The Work Order's descriptive aliases (identical behavior) -------------
  startEpisode(spec: unknown): GenerativeResult<GenerativeEpisodeView>;
  emitObservations(episode: string, at: TimestampMs): GenerativeResult<readonly GenerativeObservation[]>;
  submitAction(episode: string, action: unknown): GenerativeResult<GenerativeSubmission>;
  advanceEpisode(episode: string, to: TimestampMs): GenerativeResult<GenerativeEpisodeView>;
  finishEpisode(episode: string, reason: unknown): GenerativeResult<GenerativeEpisodeFinish>;

  // --- Lineage + resume --------------------------------------------------------
  /** The L9 lineage record of a FINISHED episode (identical runs -> identical records). */
  runRecord(episode: string): GenerativeResult<GenerativeRunRecord>;
  /** The serializable run state (the resume artifact — process runtimes included). */
  exportRunState(episode: string): GenerativeResult<GenerativeRunState>;
  /** The full fill log (each record with its physics lineage). */
  fills(episode: string): GenerativeResult<readonly GenerativeFillRecord[]>;
  /** The full generated-event log (each record with process lineage + synthetic provenance). */
  generatedEvents(episode: string): GenerativeResult<readonly GeneratedEventRecord[]>;
  /** The process runtime states (the armed stochastic processes, read-only). */
  processStates(episode: string): GenerativeResult<readonly ProcessRuntimeState[]>;
  /** The current engine state (the injected reducer's own state, read-only). */
  engineState(episode: string): GenerativeResult<EngineStateMirror>;
  /** The current engine state hash (byte-identity anchor). */
  engineStateHash(episode: string): GenerativeResult<string>;
  /** The current process state hash (the stochastic-state byte-identity anchor). */
  processStateHash(episode: string): GenerativeResult<string>;
}

// ---------------------------------------------------------------------------
// The episode line (the service's per-episode bookkeeping)
// ---------------------------------------------------------------------------

/** One bound episode's run line. */
interface EpisodeLine {
  readonly spec: EnvironmentSpec;
  readonly episodeId: string;
  clock: ClockState;
  /** The armed process runtimes, in ARMED ORDER (walk, then cohorts' participants). */
  runtimes: ProcessRuntimeState[];
  /** The parallel armed bindings (runtimes[i] executes bindings[i]). */
  readonly bindings: readonly ProcessDeclaration[];
  /** The walk's emission cursor: generatedLog indices already folded into the anchor. */
  anchorCursor: number;
  /** The L4-honest anchor (the last walk quote price whose availability has passed). */
  availableAnchor: string;
  engine: EngineStateMirror;
  observations: GenerativeObservation[];
  acceptedActions: ActionEnvelope[];
  receipts: ActionReceipt[];
  fills: GenerativeFillRecord[];
  generatedLog: GeneratedEventRecord[];
  /** The per-event generation chain (entry i = head after generatedLog[i]). */
  generationChain: string[];
  advances: ClockAdvance[];
  observationQueries: number;
  observationsServed: number;
  status: 'running' | 'finished';
  termination: TerminationReason | null;
  eventCounter: number;
  lastBoundary: TimestampMs;
  lastBookTopKey: string | null;
  /** Per-actor last accepted client_sequence (driver + generated channels). */
  sequences: Map<string, number>;
  /** Per-episode action-id set (uniqueness across both channels). */
  actionIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Create a generative world service from an untrusted config and the
 * declared inputs. The config is validated (collect-all — the L5 mode
 * honesty, the process/population coherence laws and the L12 scope
 * included); the engine driver is probed ONCE with the physics config AND
 * the declared initial book so a broken driver or an engine-rejected seed
 * fails at construction, not mid-episode.
 */
export function createGenerativeWorldService(config: unknown, inputs: GenerativeWorldInputs): GenerativeResult<GenerativeWorldService> {
  const configResult = validateGenerativeWorldConfig(config);
  if (!configResult.ok) return configResult;
  const validConfig = configResult.value;

  if (!isEngineDriver(inputs.engine)) {
    return fail('invalid_engine_driver', 'the engine driver must carry createEngine/submitOrder/cancelOrder/advanceEngine (the injected exchange-sim reducer)');
  }

  // Probe the engine driver once: the REAL engine validates the physics
  // config AND the declared book seed at createEngine — anything the
  // engine would reject fails HERE (grid rules, no-crossing, depth).
  const probe = inputs.engine.createEngine(validConfig.exchange, {
    book_seed: validConfig.population.initial_book,
    start_at: 0,
  });
  if (!probe.ok) return liftEngineError(probe);

  const core: ServiceCore = {
    config: validConfig,
    configHashValue: configHash(validConfig),
    engineHash: physicsHash(validConfig.exchange),
    engine: inputs.engine,
    lines: new Map<string, EpisodeLine>(),
    order: [],
  };
  return ok(buildService(core));
}

/**
 * Resume a service from a serialized run state. The inputs must carry the
 * SAME engine driver. The restored state is verified against THREE
 * independent integrity anchors — the generation chain (re-folded event
 * by event over the restored generated log), the PROCESS STATE hash (the
 * restored stochastic randomness is the recorded randomness) and the
 * ENGINE STATE hash — each tamper fails the typed `chain_mismatch`. A
 * resumed run continues identically and finishes with the IDENTICAL run
 * record.
 */
export function resumeGenerativeWorldService(state: unknown, inputs: GenerativeWorldInputs): GenerativeResult<GenerativeWorldService> {
  const restored = deserializeGenerativeRunState(state);
  if (!restored.ok) return restored;
  const runState = restored.value;

  const configResult = validateGenerativeWorldConfig(runState.config);
  if (!configResult.ok) return configResult;
  const validConfig = configResult.value;

  if (!isEngineDriver(inputs.engine)) {
    return fail('invalid_engine_driver', 'the engine driver must carry createEngine/submitOrder/cancelOrder/advanceEngine (the injected exchange-sim reducer)');
  }
  const probe = inputs.engine.createEngine(validConfig.exchange, {
    book_seed: validConfig.population.initial_book,
    start_at: 0,
  });
  if (!probe.ok) return liftEngineError(probe);

  const line = restoreEpisodeLine(validConfig, runState);
  if (!line.ok) return line;

  const core: ServiceCore = {
    config: validConfig,
    configHashValue: configHash(validConfig),
    engineHash: physicsHash(validConfig.exchange),
    engine: inputs.engine,
    lines: new Map<string, EpisodeLine>([[line.value.episodeId, line.value]]),
    order: [line.value.episodeId],
  };
  return ok(buildService(core));
}

/** The armed roster: (declaration, instance) pairs in ARMED ORDER (a pure function of the config). */
function armedRoster(config: GenerativeWorldConfig): readonly { readonly declaration: ProcessDeclaration; readonly instance: string }[] {
  const roster: { declaration: ProcessDeclaration; instance: string }[] = [];
  const byId = new Map<string, ProcessDeclaration>();
  for (const declaration of config.processes) byId.set(declaration.process_id, declaration);
  const walk = config.processes.find((declaration) => declaration.kind === 'reference_price_walk');
  if (walk !== undefined) {
    roster.push({ declaration: walk, instance: WORLD_PROCESS_INSTANCE });
  }
  for (const cohort of config.population.cohorts) {
    const declaration = byId.get(cohort.policy);
    if (declaration === undefined) continue; // unreachable: validated at config
    for (const instance of cohortInstances(cohort)) {
      roster.push({ declaration, instance });
    }
  }
  return roster;
}

/** Restore an episode line from the serialized run state (total validation + the three tamper proofs). */
function restoreEpisodeLine(config: GenerativeWorldConfig, runState: GenerativeRunState): GenerativeResult<EpisodeLine> {
  const lineState = runState.episode_line;
  if (!isRecord(lineState)) return fail('invalid_state', 'the episode line must be an object');

  const specResult = validateEnvironmentSpec(lineState.spec, 'episode_line.spec');
  if (!specResult.ok) return specResult;
  const spec = specResult.value;

  const engineState = lineState.engine_state;
  if (!isRecord(engineState)) return fail('invalid_state', 'the episode line carries no engine state');
  if (typeof engineState.now !== 'number' || !isTimestampMs(engineState.now)) return fail('invalid_state', 'the engine state clock is malformed');
  if (!Array.isArray(engineState.fills) || !Array.isArray(engineState.orders)) return fail('invalid_state', 'the engine state logs are malformed');

  const clockNow = lineState.clock_now;
  const clockAsOf = lineState.clock_as_of;
  if (!isTimestampMs(clockNow) || !isTimestampMs(clockAsOf)) return fail('invalid_state', 'the episode clock is malformed');

  // THE PROCESS RUNTIMES (the resume law's hard part): every state must be
  // structurally valid AND bound to the config's armed roster — the
  // process ids and instances must match the armed (declaration, instance)
  // pairs exactly (a runtime executing an undeclared process is ambient
  // randomness, the thing this lane forbids).
  if (!Array.isArray(lineState.process_states)) return fail('invalid_state', 'the process runtime states are malformed');
  const roster = armedRoster(config);
  const processStates: ProcessRuntimeState[] = [];
  for (let index = 0; index < (lineState.process_states as readonly unknown[]).length; index++) {
    const candidate = (lineState.process_states as readonly unknown[])[index];
    if (!isProcessRuntimeState(candidate)) {
      return fail('invalid_state', `process runtime state ${index} is malformed`);
    }
    const expected = roster[index];
    if (expected === undefined || candidate.process !== expected.declaration.process_id || candidate.instance !== expected.instance) {
      return fail(
        'chain_mismatch',
        `process runtime state ${index} executes (${candidate.process}, ${candidate.instance}) which the config's armed roster does not carry — the resumed run provably executes the DECLARED processes only`,
      );
    }
    processStates.push(candidate);
  }
  if (processStates.length !== roster.length) {
    return fail('chain_mismatch', `the episode line carries ${processStates.length} process runtimes but the config arms ${roster.length} — a resumed run provably executes the full declared population`);
  }

  // TAMPER PROOF 1 — the PROCESS STATE hash: the restored randomness must
  // byte-match the recorded anchor.
  if (processStateHash(processStates) !== runState.process_state_hash) {
    return fail('chain_mismatch', `the restored process runtime states hash to ${processStateHash(processStates)} but the run state recorded ${runState.process_state_hash} — the stochastic processes must resume mid-stream deterministically; tampered randomness is a chain mismatch`);
  }

  // TAMPER PROOF 2 — the ENGINE STATE hash.
  const restoredEngine = engineState as unknown as EngineStateMirror;
  if (engineStateHash(restoredEngine) !== runState.engine_state_hash) {
    return fail('chain_mismatch', `the restored engine state hashes to ${engineStateHash(restoredEngine)} but the run state recorded ${runState.engine_state_hash} — tampered run state`);
  }

  // The observations / actions / receipts / fills logs.
  const observations: GenerativeObservation[] = [];
  if (!Array.isArray(lineState.observations)) return fail('invalid_state', 'the observations log is malformed');
  for (const observation of lineState.observations as readonly unknown[]) {
    if (!isRecord(observation)) return fail('invalid_state', 'an observation in the log is malformed');
    observations.push(observation as unknown as GenerativeObservation);
  }
  const acceptedActions: ActionEnvelope[] = [];
  if (!Array.isArray(lineState.accepted_actions)) return fail('invalid_state', 'the accepted-actions log is malformed');
  for (const action of lineState.accepted_actions as readonly unknown[]) {
    if (!isActionEnvelope(action)) return fail('invalid_state', 'an accepted action in the log is malformed');
    acceptedActions.push(action);
  }
  const receipts: ActionReceipt[] = [];
  if (!Array.isArray(lineState.receipts)) return fail('invalid_state', 'the receipt log is malformed');
  for (const receipt of lineState.receipts as readonly unknown[]) {
    if (!isRecord(receipt)) return fail('invalid_state', 'a receipt in the log is malformed');
    receipts.push(receipt as unknown as ActionReceipt);
  }
  const fills: GenerativeFillRecord[] = [];
  if (!Array.isArray(lineState.fills)) return fail('invalid_state', 'the fill log is malformed');
  for (const fill of lineState.fills as readonly unknown[]) {
    const guarded = requireGenerativeFill(fill);
    if (!guarded.ok) return guarded;
    fills.push(guarded.value);
  }

  // The generated-event log — every record through the total guard, then
  // TAMPER PROOF 3 — the generation chain re-folded event by event.
  const generatedLog: GeneratedEventRecord[] = [];
  if (!Array.isArray(lineState.generated_log)) return fail('invalid_state', 'the generated-event log is malformed');
  for (const event of lineState.generated_log as readonly unknown[]) {
    const guarded = requireGeneratedEvent(event);
    if (!guarded.ok) {
      return fail('chain_mismatch', `the serialized generated log failed its lineage guard at event ${generatedLog.length} — tampered run state (${guarded.errors[0]?.message ?? 'unreachable'})`);
    }
    generatedLog.push(guarded.value);
  }
  const configHashValue = configHash(config);
  let head = configHashValue;
  if (generatedLog.length !== runState.generation_chain.length) {
    return fail('chain_mismatch', `the serialized generated log carries ${generatedLog.length} events but the recorded generation chain has ${runState.generation_chain.length} entries — tampered run state`);
  }
  for (let index = 0; index < generatedLog.length; index++) {
    head = chainDigest(head, generatedLog[index] as GeneratedEventRecord);
    const expected = runState.generation_chain[index];
    if (head !== expected) {
      return fail('chain_mismatch', `the serialized generated log does not digest to the recorded chain at event ${index} (expected ${String(expected)}, got ${head}) — tampered run state`);
    }
  }

  if (!isGenerativeRunLog(runState.run_log)) return fail('invalid_state', 'the run log is malformed');

  const termination = lineState.termination === null || lineState.termination === undefined ? null : lineState.termination;
  const status = lineState.status === 'finished' ? 'finished' : 'running';
  if (status === 'finished' && !isTerminationReason(termination)) return fail('invalid_state', 'a finished episode line carries no termination reason');

  // Recompute the L4-honest anchor cursor from the restored log (a pure
  // function of the generated quotes and the clock — no serialization
  // needed, and the recomputation IS the proof of coherence).
  const walk = config.processes.find((declaration) => declaration.kind === 'reference_price_walk');
  const startAnchor = walk === undefined ? '0' : (walk.params.start_price as string);
  let availableAnchor = startAnchor;
  let anchorCursor = 0;
  for (let index = 0; index < generatedLog.length; index++) {
    const event = generatedLog[index] as GeneratedEventRecord;
    if (event.kind !== 'market_quote') continue;
    if ((event.available_time as number) > (clockNow as number)) continue;
    anchorCursor = index + 1;
    const payload = event.payload as { readonly [key: string]: JsonValue };
    if (typeof payload.anchor_price === 'string') {
      availableAnchor = payload.anchor_price;
    }
  }

  const line: EpisodeLine = {
    spec,
    episodeId: deriveEpisodeId(spec),
    clock: deepFreeze({ ...spec.profile.clock, now: clockNow, asOf: clockAsOf }),
    runtimes: processStates,
    bindings: roster.map((entry) => entry.declaration),
    anchorCursor,
    availableAnchor,
    engine: restoredEngine,
    observations,
    acceptedActions,
    receipts,
    fills,
    generatedLog,
    generationChain: [...runState.generation_chain],
    advances: Array.isArray(lineState.advances) ? [...(lineState.advances as ClockAdvance[])] : [],
    observationQueries: typeof lineState.observation_queries === 'number' ? lineState.observation_queries : 0,
    observationsServed: typeof lineState.observations_served === 'number' ? lineState.observations_served : 0,
    status,
    termination: status === 'finished' ? (termination as TerminationReason) : null,
    eventCounter: typeof lineState.event_counter === 'number' ? lineState.event_counter : 0,
    lastBoundary: typeof lineState.last_boundary === 'number' ? (lineState.last_boundary as TimestampMs) : (clockNow as TimestampMs),
    lastBookTopKey: typeof lineState.last_book_top_key === 'string' ? lineState.last_book_top_key : null,
    sequences: new Map<string, number>(),
    actionIds: new Set<string>(),
  };
  for (const action of acceptedActions) {
    line.sequences.set(action.actor, Math.max(line.sequences.get(action.actor) ?? -1, action.client_sequence));
    line.actionIds.add(action.action_id);
  }
  return ok(line);
}

// ---------------------------------------------------------------------------
// The shared implementation core
// ---------------------------------------------------------------------------

interface ServiceCore {
  readonly config: GenerativeWorldConfig;
  readonly configHashValue: string;
  readonly engineHash: string;
  readonly engine: EngineDriver;
  readonly lines: Map<string, EpisodeLine>;
  readonly order: string[];
}

/** Lift an engine-driver failure onto the generative taxonomy (codes preserved verbatim). */
function liftEngineError<T>(failure: { readonly ok: false; readonly errors: readonly { readonly code: string; readonly path: string; readonly message: string }[] }): GenerativeResult<T> {
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

function buildService(core: ServiceCore): GenerativeWorldService {
  const runId = (): string => deriveRunId(core.configHashValue);
  const physicsRefs: PhysicsRefs = core.config.physics_refs;
  const roster = armedRoster(core.config);
  const walkDeclaration = core.config.processes.find((declaration) => declaration.kind === 'reference_price_walk');

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

  const lookup = (episode: string): GenerativeResult<EpisodeLine> => {
    const line = core.lines.get(episode);
    if (line === undefined) {
      return fail('unknown_episode', `episode ${episode} is not known to this service`);
    }
    return ok(line);
  };

  // --- The process-step scheduler helpers -----------------------------------

  /** The earliest next_at among all armed runtimes, or null when none remain. */
  const nextProcessInstant = (line: EpisodeLine): number | null => {
    let earliest: number | null = null;
    for (const runtime of line.runtimes) {
      if (earliest === null || (runtime.next_at as number) < earliest) earliest = runtime.next_at as number;
    }
    return earliest;
  };

  /** Process steps with next_at <= now that have not fired yet (the pending count). */
  const pendingProcessSteps = (line: EpisodeLine): number => {
    let count = 0;
    for (const runtime of line.runtimes) {
      if ((runtime.next_at as number) <= (line.clock.now as number)) count += 1;
    }
    return count;
  };

  /** Is the world settled (no process step due at or before now)? */
  const isSettled = (line: EpisodeLine): boolean => pendingProcessSteps(line) === 0;

  /**
   * Advance the L4-honest anchor cursor over the walk's logged quotes:
   * fold every quote whose availability instant has passed into the
   * anchor. THE GENERATOR'S OWN FIREWALL: the anchor a policy reads at a
   * boundary is always the last AVAILABLE walk price — never the
   * boundary's own (embargoed) draw.
   */
  const advanceAnchorCursor = (line: EpisodeLine, boundary: TimestampMs): void => {
    for (let index = line.anchorCursor; index < line.generatedLog.length; index++) {
      const event = line.generatedLog[index];
      if (event === undefined || event.kind !== 'market_quote') continue;
      if ((event.available_time as number) > (boundary as number)) break;
      const payload = event.payload as { readonly [key: string]: JsonValue };
      if (typeof payload.anchor_price === 'string') {
        line.availableAnchor = payload.anchor_price;
      }
      line.anchorCursor = index + 1;
    }
  };

  // --- The observation minting ------------------------------------------------

  /** Mint the next observation identity (deterministic: emission order). */
  const nextObservationId = (line: EpisodeLine): string => {
    line.eventCounter += 1;
    return `gmo-${String(line.eventCounter).padStart(8, '0')}`;
  };

  /** Emit one engine outcome as an observation (the payload IS the outcome, forensic completeness). */
  const emitOutcome = (
    line: EpisodeLine,
    availableTime: TimestampMs,
    payload: JsonValue,
    source: string,
  ): void => {
    const observation: GenerativeObservation = deepFreeze({
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
      emitOutcome(line, outcome.ack.quartet.available_time, deepFreeze({ kind: 'order_ack', data: outcome.ack as unknown as JsonValue }), 'generative-market-engine');
    } else {
      emitOutcome(line, outcome.ack.quartet.available_time, deepFreeze({ kind: 'order_reject', data: outcome.ack as unknown as JsonValue }), 'generative-market-engine');
    }
    for (const fill of outcome.fills) {
      emitOutcome(line, fill.quartet.available_time, deepFreeze({ kind: 'fill', data: fill as unknown as JsonValue }), 'generative-market-engine');
    }
    for (const cancel of outcome.cancels) {
      emitOutcome(line, cancel.quartet.available_time, deepFreeze({ kind: 'order_cancel', data: cancel as unknown as JsonValue }), 'generative-market-engine');
    }
  };

  /** Emit the book-top view when it changed (raw levels, verbatim — no arithmetic). */
  const maybeEmitBookTop = (line: EpisodeLine, at: TimestampMs): void => {
    const view = bookTopView(line.engine.book);
    const key = bookTopKey(view);
    if (key === line.lastBookTopKey) return;
    line.lastBookTopKey = key;
    emitOutcome(line, at, deepFreeze({ kind: 'book_top', data: { at, view: view as unknown as JsonValue } }), 'generative-market-engine');
  };

  /** Append one generated event to the log + fold the generation chain (L9). */
  const recordGeneratedEvent = (line: EpisodeLine, event: ProcessEmission): GeneratedEventRecord => {
    const record: GeneratedEventRecord = deepFreeze({
      event_id: event.event_id,
      kind: event.kind,
      at: event.at,
      available_time: event.available_time,
      actor: event.actor,
      payload: event.payload,
      process: {
        process: event.process.process,
        instance: event.process.instance,
        version: event.process.version,
        seed: event.process.seed,
        step: event.process.step,
      },
      synthetic: { generated: true, declaration: SYNTHETIC_PROVENANCE_DECLARATION },
      run_ref: runId(),
      tenant: core.config.tenant,
      project: core.config.project,
    });
    line.generatedLog.push(record);
    const previous = line.generationChain.length === 0 ? core.configHashValue : (line.generationChain[line.generationChain.length - 1] as string);
    line.generationChain.push(chainDigest(previous, record));
    return record;
  };

  /** Log one walk quote as a generated observation (the L4 input is the embargoed availability). */
  const logQuoteEvent = (line: EpisodeLine, event: ProcessEmission): void => {
    recordGeneratedEvent(line, event);
    const observation: GenerativeObservation = deepFreeze({
      observation_id: event.event_id, // generated event ids are unique for the world's lifetime
      available_time: event.available_time,
      venue: core.config.exchange.venue,
      instrument: core.config.exchange.instrument,
      payload: event.payload,
      provenance: { origin: 'generated', source: `generative-process:${event.process.process}`, derived_from: [] },
      run_ref: runId(),
      tenant: core.config.tenant,
      project: core.config.project,
    });
    line.observations.push(observation);
  };

  // --- The engine submission path (shared by driver + generated actions) ----

  /** What an action payload may ask the engine to do (the T010 vocabulary). */
  type EngineActionPayload =
    | { readonly type: 'submit_order'; readonly intent: Record<string, unknown> }
    | { readonly type: 'cancel_order'; readonly order_id: string }
    | { readonly type: 'cancel_client_order'; readonly client_order_id: string };

  /** Validate an action payload (the engine validates the intent itself — the T010 pattern). */
  function validateActionPayload(payload: JsonValue): GenerativeResult<EngineActionPayload> {
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

  /** Submit one action envelope to the engine at its instant (THE generative act). */
  const submitToEngine = (
    line: EpisodeLine,
    action: ActionEnvelope,
    payload: EngineActionPayload,
  ): GenerativeResult<{ readonly outcome: SubmitOutcomeMirror | CancelOutcomeMirror; readonly receipt: ActionReceipt }> => {
    // Causal law (inclusive): an action may not claim submission after now.
    if ((action.submitted_at as number) > (line.clock.now as number)) {
      return fail('action_from_future', `action ${action.action_id} claims submission at ${String(action.submitted_at)}, after the episode's now ${String(line.clock.now)}`);
    }
    // Engine arrival law (the T010 service law, mirrored): the engine
    // matches in ARRIVAL order — a driver that advanced the engine past
    // the action's instant cannot retro-match; submit at the current instant.
    if ((action.submitted_at as number) < (line.engine.now as number)) {
      return fail('arrival_before_engine', `action ${action.action_id} claims submission at ${String(action.submitted_at)}, before the engine's clock ${String(line.engine.now)} — the exchange matches in arrival order; submit at the current instant or advance later`);
    }
    // If the engine clock lags the action instant, advance it first so
    // expirations at or before the instant have fired — deterministic.
    if ((action.submitted_at as number) > (line.engine.now as number)) {
      const advanced = core.engine.advanceEngine(line.engine, action.submitted_at);
      if (!advanced.ok) return liftEngineError(advanced);
      const advanceOutcome: AdvanceOutcomeMirror = advanced.value;
      line.engine = advanceOutcome.state;
      for (const expiration of advanceOutcome.expirations) {
        emitOutcome(line, expiration.quartet.available_time, deepFreeze({ kind: 'order_expired', data: expiration as unknown as JsonValue }), 'generative-market-engine');
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
      emitOutcome(line, cancel.quartet.available_time, deepFreeze({ kind: 'order_cancel', data: cancel as unknown as JsonValue }), 'generative-market-engine');
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

  /** Validate a generated intent emission's payload (the engine vocabulary by construction). */
  const validateGeneratedPayload = (payload: JsonValue): GenerativeResult<EngineActionPayload> => {
    const validated = validateActionPayload(payload);
    if (!validated.ok) return validated;
    if (validated.value.type !== 'submit_order') {
      return fail('process_undeclared', 'a generated population intent must be a submit_order emission (the processes emit order intents only)', 'payload.type');
    }
    return validated;
  };

  // --- The boundary step machine (the declared interleaving) ----------------

  /**
   * Process ONE boundary: advance the L4-honest anchor cursor, advance the
   * engine (expirations fire at their instants, before any action at the
   * same instant matches), step EVERY due process over the honest context
   * (pure generation), then apply the emissions per the DECLARED
   * interleaving policy — the walk's quote logging ordered against the
   * population's intent submissions.
   */
  const processBoundary = (line: EpisodeLine, boundary: TimestampMs): GenerativeResult<void> => {
    // 1. The L4-honest anchor: fold every walk quote whose availability
    //    has passed (policies never see the boundary's own embargoed draw).
    advanceAnchorCursor(line, boundary);

    // 2. The engine advance to the boundary (gtt expirations, engine clock).
    if ((boundary as number) > (line.engine.now as number)) {
      const advanced = core.engine.advanceEngine(line.engine, boundary);
      if (!advanced.ok) return liftEngineError(advanced);
      line.engine = advanced.value.state;
      for (const expiration of advanced.value.expirations) {
        emitOutcome(line, expiration.quartet.available_time, deepFreeze({ kind: 'order_expired', data: expiration as unknown as JsonValue }), 'generative-market-engine');
      }
    }

    // 3. Step every due process over the honest context (pure generation).
    //    ARMED ORDER: the walk first, then each cohort's participants.
    const context = {
      now: boundary,
      anchor: line.availableAnchor,
      book: bookTopView(line.engine.book),
    };
    const emissions: { readonly index: number; readonly events: readonly ProcessEmission[] }[] = [];
    for (let index = 0; index < line.runtimes.length; index++) {
      const runtime = line.runtimes[index];
      if (runtime === undefined) continue;
      if ((runtime.next_at as number) !== (boundary as number)) continue;
      const stepped = stepProcess(line.bindings[index] as ProcessDeclaration, runtime, context, core.config.exchange);
      if (!stepped.ok) return stepped;
      emissions.push({ index, events: stepped.value.events });
      line.runtimes[index] = stepped.value.state; // commit each step (deterministic partial state on later failure)
    }

    const quoteEvents: ProcessEmission[] = [];
    const intentEvents: ProcessEmission[] = [];
    for (const emission of emissions) {
      for (const event of emission.events) {
        if (event.kind === 'market_quote') quoteEvents.push(event);
        else intentEvents.push(event);
      }
    }

    // 4. Apply per the declared interleaving policy.
    const policy: InterleavingPolicy = core.config.interleaving;
    if (policy.kind === 'processes_first' || policy.kind === 'unrestricted') {
      for (const quote of quoteEvents) logQuoteEvent(line, quote);
    }

    // 5. The population's generated intents submit to the engine (in armed
    //    order — the deterministic submission order).
    for (const intent of intentEvents) {
      if (intent.actor === null) continue; // unreachable by construction
      const payloadResult = validateGeneratedPayload(intent.payload);
      if (!payloadResult.ok) return payloadResult;
      const sequence = (line.sequences.get(intent.actor) ?? 0) + 1;
      const action: ActionEnvelope = deepFreeze({
        action_id: intent.event_id,
        actor: intent.actor,
        submitted_at: intent.at,
        client_sequence: sequence,
        payload: intent.payload,
      });
      if (line.actionIds.has(action.action_id)) {
        return fail('duplicate_action', `generated action id "${action.action_id}" is already recorded in episode ${line.episodeId}`);
      }
      const submitted = submitToEngine(line, action, payloadResult.value);
      if (!submitted.ok) return submitted;
      recordGeneratedEvent(line, intent);
      line.sequences.set(intent.actor, sequence);
      line.actionIds.add(action.action_id);
    }

    if (policy.kind === 'population_first') {
      for (const quote of quoteEvents) logQuoteEvent(line, quote);
    }

    // 6. The book-top view (change-detected) + the boundary cursor.
    maybeEmitBookTop(line, boundary);
    line.lastBoundary = boundary;
    return ok(undefined);
  };

  /** The episode view (structurally an EpisodeState + the step dashboard). */
  const viewOf = (line: EpisodeLine): GenerativeEpisodeView =>
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
      pending_process_steps: pendingProcessSteps(line),
      applied_through: line.lastBoundary,
    });

  // -------------------------------------------------------------------------
  // The service object
  // -------------------------------------------------------------------------

  const service: GenerativeWorldService = {
    get config(): GenerativeWorldConfig {
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

    start(spec: unknown): GenerativeResult<GenerativeEpisodeView> {
      const specResult = validateEnvironmentSpec(spec);
      if (!specResult.ok) {
        return { ok: false, errors: specResult.errors.map((error) => ({ code: 'invalid_spec' as const, path: error.path, message: error.message })) };
      }
      const validSpec = specResult.value;

      // Bind to THIS world.
      if (validSpec.world.world_id !== core.config.world_id) {
        return fail('world_binding_mismatch', `spec.world.world_id "${validSpec.world.world_id}" does not name this world ("${core.config.world_id}")`, 'spec.world.world_id');
      }
      if (validSpec.world.kind !== 'generative') {
        return fail('world_binding_mismatch', `spec.world.kind "${validSpec.world.kind}" is not 'generative'`, 'spec.world.kind');
      }

      // L5 mode honesty: the spec's fidelity must be 'generative' — an
      // exact- or reactive-replay claim about a GENERATED world is a lie.
      if (validSpec.profile.fidelity !== 'generative') {
        return fail(
          'fidelity_claim_dishonest',
          `spec.profile.fidelity '${validSpec.profile.fidelity}' is dishonest for a generative world — this world GENERATES its entire market from declared processes and must be declared 'generative' (L5: the modes are distinct, never conflated)`,
          'spec.profile.fidelity',
        );
      }
      if (validSpec.profile.clock.fidelity !== 'generative') {
        return fail(
          'fidelity_claim_dishonest',
          `spec.profile.clock.fidelity '${validSpec.profile.clock.fidelity}' must be 'generative' — the clock's mode must agree with the world's (L5)`,
          'spec.profile.clock.fidelity',
        );
      }

      // The horizon anchor: no episode clock may anchor beyond the world's.
      if ((validSpec.profile.clock.asOf as number) > (core.config.horizon as number)) {
        return fail('beyond_as_of', `the episode's asOf ${String(validSpec.profile.clock.asOf)} exceeds the world's declared horizon ${String(core.config.horizon)}`, 'spec.profile.clock.asOf');
      }

      const episodeId = deriveEpisodeId(validSpec);
      if (core.lines.has(episodeId)) {
        return fail('duplicate_episode', `episode ${episodeId} is already registered — an episode id is a unique run; re-running a spec requires a fresh service or a distinct seed`);
      }

      // Seed the engine from the DECLARED initial book at the start instant.
      const startAt = validSpec.profile.clock.now;
      const engineResult = core.engine.createEngine(core.config.exchange, {
        book_seed: core.config.population.initial_book,
        start_at: startAt,
      });
      if (!engineResult.ok) return liftEngineError(engineResult);

      // Arm every process (the world walk + each cohort's participants).
      const runtimes: ProcessRuntimeState[] = [];
      for (const entry of roster) {
        runtimes.push(armProcess(entry.declaration, entry.instance, startAt));
      }

      const line: EpisodeLine = {
        spec: validSpec,
        episodeId,
        clock: validSpec.profile.clock,
        runtimes,
        bindings: roster.map((entry) => entry.declaration),
        anchorCursor: 0,
        availableAnchor: walkDeclaration === undefined ? '0' : (walkDeclaration.params.start_price as string),
        engine: engineResult.value,
        observations: [],
        acceptedActions: [],
        receipts: [],
        fills: [],
        generatedLog: [],
        generationChain: [],
        advances: [],
        observationQueries: 0,
        observationsServed: 0,
        status: 'running',
        termination: null,
        eventCounter: 0,
        lastBoundary: startAt,
        lastBookTopKey: null,
        sequences: new Map<string, number>(),
        actionIds: new Set<string>(),
      };

      // The opening view: the declared book's top (observation #1 — the
      // world's honest opening state, origin 'simulated').
      maybeEmitBookTop(line, startAt);

      core.lines.set(episodeId, line);
      core.order.push(episodeId);
      return ok(viewOf(line));
    },

    observe(episode: string, at: TimestampMs): GenerativeResult<readonly GenerativeObservation[]> {
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

    submit(episode: string, action: unknown): GenerativeResult<GenerativeSubmission> {
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

      // THE CANDIDATE LAW: only the candidate organization may act through
      // the driver-facing port. A population participant's actions are
      // GENERATED by its declared process — a driver submission in its
      // name would inject ambient, unlineaged randomness.
      const candidateInstance = core.config.population.candidate.instance;
      if (validAction.actor !== candidateInstance) {
        if (roster.some((entry) => entry.instance === validAction.actor)) {
          return fail(
            'actor_not_candidate',
            `actor "${validAction.actor}" is a GENERATED population participant — its actions are generated by its declared process; only the candidate "${candidateInstance}" acts through the driver port (ambient participant actions are the thing this lane exists to forbid)`,
          );
        }
        return fail('unknown_participant', `actor "${validAction.actor}" is not a declared participant of this world (the candidate or a generated population participant)`);
      }

      // The interleaving law: strict policies require the world settled at
      // the submit instant (no due process step at/before now).
      if (policyRequiresSettled(core.config.interleaving)) {
        const pending = pendingProcessSteps(line);
        if (pending > 0) {
          return fail(
            'interleaving_violation',
            `actor "${validAction.actor}" submitted while ${pending} process step(s) at or before now are unabsorbed — the declared '${core.config.interleaving.kind}' policy forbids acting mid-process-step (advance until settled, then act)`,
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

    advance(episode: string, to: TimestampMs): GenerativeResult<GenerativeEpisodeView> {
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

      // The next boundary: the earliest due process instant not exceeding
      // the target, or the target itself.
      let boundary: number = to as number;
      const nextStepAt = nextProcessInstant(line);
      if (nextStepAt !== null && nextStepAt <= (to as number) && nextStepAt < boundary) {
        boundary = nextStepAt;
      }

      const processed = processBoundary(line, boundary as TimestampMs);
      if (!processed.ok) {
        // The clock has moved and the boundary failed mid-processing: every
        // sub-step committed BEFORE the failure (process steps, engine
        // transitions, already-submitted actions) stays committed — each is
        // individually complete and recorded, so the episode state remains
        // consistent and auditable; the typed error names the violated law
        // and the driver may finish/abort the episode.
        return processed;
      }
      return ok(viewOf(line));
    },

    finish(episode: string, reason: unknown): GenerativeResult<GenerativeEpisodeFinish> {
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

    startEpisode(spec: unknown): GenerativeResult<GenerativeEpisodeView> {
      return service.start(spec);
    },
    emitObservations(episode: string, at: TimestampMs): GenerativeResult<readonly GenerativeObservation[]> {
      return service.observe(episode, at);
    },
    submitAction(episode: string, action: unknown): GenerativeResult<GenerativeSubmission> {
      return service.submit(episode, action);
    },
    advanceEpisode(episode: string, to: TimestampMs): GenerativeResult<GenerativeEpisodeView> {
      return service.advance(episode, to);
    },
    finishEpisode(episode: string, reason: unknown): GenerativeResult<GenerativeEpisodeFinish> {
      return service.finish(episode, reason);
    },

    runRecord(episode: string): GenerativeResult<GenerativeRunRecord> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const line = found.value;
      if (line.status !== 'finished' || line.termination === null) {
        return fail('episode_not_finished', 'the run record is only available for a finished episode');
      }
      const candidateInstance = core.config.population.candidate.instance;
      return buildRunRecord({
        config: core.config,
        spec: line.spec,
        state: viewOf(line),
        termination: line.termination,
        chainHead: line.generationChain.length === 0 ? core.configHashValue : (line.generationChain[line.generationChain.length - 1] as string),
        processStates: line.runtimes,
        engine: line.engine,
        fills: line.fills,
        receipts: line.receipts,
        generatedLog: line.generatedLog,
        runLog: { advances: line.advances, observation_queries: line.observationQueries, observations_served: line.observationsServed },
        runId: runId(),
        pendingAtFinish: viewOf(line).pending_process_steps,
        driverActions: line.receipts.filter((receipt) => receipt.actor === candidateInstance).length,
      });
    },

    exportRunState(episode: string): GenerativeResult<GenerativeRunState> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const line = found.value;
      return ok(
        deepFreeze({
          schema: 'tradrl/generative-run-state@1' as const,
          phase: 'episode' as const,
          config: core.config,
          generation_chain: [...line.generationChain],
          process_state_hash: processStateHash(line.runtimes),
          engine_state_hash: engineStateHash(line.engine),
          episode_line: deepFreeze({
            spec: line.spec,
            clock_now: line.clock.now,
            clock_as_of: line.clock.asOf,
            process_states: [...line.runtimes],
            engine_state: line.engine,
            observations: [...line.observations],
            accepted_actions: [...line.acceptedActions],
            receipts: [...line.receipts],
            fills: [...line.fills],
            generated_log: [...line.generatedLog],
            advances: [...line.advances],
            observation_queries: line.observationQueries,
            observations_served: line.observationsServed,
            status: line.status,
            termination: line.termination,
            event_counter: line.eventCounter,
            last_boundary: line.lastBoundary,
            last_book_top_key: line.lastBookTopKey,
          }),
          run_log: deepFreeze({
            advances: [...line.advances],
            observation_queries: line.observationQueries,
            observations_served: line.observationsServed,
          }),
        }),
      );
    },

    fills(episode: string): GenerativeResult<readonly GenerativeFillRecord[]> {
      const found = lookup(episode);
      if (!found.ok) return found;
      return ok(deepFreeze([...found.value.fills]));
    },

    generatedEvents(episode: string): GenerativeResult<readonly GeneratedEventRecord[]> {
      const found = lookup(episode);
      if (!found.ok) return found;
      return ok(deepFreeze([...found.value.generatedLog]));
    },

    processStates(episode: string): GenerativeResult<readonly ProcessRuntimeState[]> {
      const found = lookup(episode);
      if (!found.ok) return found;
      return ok(deepFreeze([...found.value.runtimes]));
    },

    engineState(episode: string): GenerativeResult<EngineStateMirror> {
      const found = lookup(episode);
      if (!found.ok) return found;
      return ok(found.value.engine);
    },

    engineStateHash(episode: string): GenerativeResult<string> {
      const found = lookup(episode);
      if (!found.ok) return found;
      return ok(engineStateHash(found.value.engine));
    },

    processStateHash(episode: string): GenerativeResult<string> {
      const found = lookup(episode);
      if (!found.ok) return found;
      return ok(processStateHash(found.value.runtimes));
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// Serialization re-exports (the resume artifact currency)
// ---------------------------------------------------------------------------

export { serializeGenerativeRunState, deserializeGenerativeRunState };
