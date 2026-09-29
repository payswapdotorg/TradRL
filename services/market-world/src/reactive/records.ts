/**
 * @tradrl/market-world (reactive service) — the LINEAGE RECORDS (work
 * order T027): fills with FULL PHYSICS LINEAGE, observations, action
 * receipts, the ReactiveRunRecord (L9) and the resumable
 * ReactiveRunState.
 *
 * THE PHYSICS LINEAGE LAW (the work order's existential law): "every
 * engine-driven fill carries its full physics lineage (engine record
 * refs, fee/latency/slippage/impact config refs — exchange-sim mirrors);
 * a fill without physics lineage is a typed error." A
 * {@link ReactiveFillRecord} therefore carries the ENGINE's own fill
 * record verbatim PLUS the lineage block: the engine config hash, the
 * four physics policy refs, the run ref, the taker/maker order refs, and
 * the tenant/project scope. {@link requireReactiveFill} fails
 * `physics_lineage_missing` / `lineage_gap` / `tenant_missing` — negative
 * tests prove each failure mode.
 *
 * THE L4 GATE (defense in depth): {@link admitObservations} is the total
 * delivery gate every observation passes through — an observation whose
 * `available_time` exceeds the query instant fails
 * `l4_boundary_violation` (never a leak, never silently filtered here;
 * the filter and the gate are two independent layers).
 *
 * THE RUN RECORD (L9, extending T009's discipline with engine state
 * hashes): config hash, ingest-chain head, spec hash, the ENGINE STATE
 * HASH, the complete fill log (with physics), the receipt log, the
 * scripted-action log, the clock timeline, the observation bookkeeping,
 * and the record's own digest. A run record claiming any fidelity other
 * than `'reactive_replay'` fails its guard with
 * `fidelity_claim_dishonest` (the L5 trip-wire — inexpressible by
 * construction, provable by the guard).
 *
 * RESUMABILITY (mirroring T009): the run state serializes -> parses ->
 * resumes with ingest-chain AND scripted-feed verification (tamper =
 * `chain_mismatch`), and a resumed run finishes with the IDENTICAL run
 * record.
 *
 * ZERO NON-DETERMINISM: no wall clock, no Math.random, no process data —
 * every field derives from the config, the stream, the feeds and the
 * driver's operations.
 */

import { canonicalJson, deepFreeze, isNonEmptyString, isNonNegativeSafeInteger, isRecord } from './primitives';
import { fnv1a32Hex } from './primitives';
import type { JsonValue } from './primitives';
import { isJsonValue } from './primitives';
import { fail, ok, type ReactiveResult } from './errors';
import type { ProjectId, TenantId, TimestampMs } from './ids';
import type { ActionEnvelope, EpisodeStateMirror, EnvironmentSpec, TerminationReason } from './env-mirror';
import { canonicalSpecJson, deriveEpisodeId, isTerminationReason } from './env-mirror';
import type { FillMirror } from './exchange-mirror';
import { engineStateHash, isFillMirror, physicsHash, type EngineStateMirror } from './exchange-mirror';
import type { ReactiveWorldConfig } from './config';
import { configHash as worldConfigHash } from './config';

// ---------------------------------------------------------------------------
// The physics lineage block (carried by every fill and receipt)
// ---------------------------------------------------------------------------

/**
 * The full physics lineage of one engine-driven outcome: the engine
 * config digest (the venue grids + physics models, byte-bound), the four
 * physics policy refs, the run ref and the tenant/project scope. A fill
 * or receipt without a complete lineage block fails its guard.
 */
export interface PhysicsLineage {
  /** FNV-1a of the canonical exchange-physics JSON (equals the REAL engine's configHash — interop-tested). */
  readonly engine_config_hash: string;
  readonly fee_policy: string;
  readonly latency_policy: string;
  readonly slippage_policy: string;
  readonly impact_policy: string;
  readonly run_ref: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Guard: a complete physics lineage block (L6/L9/L12 — every field present and non-empty). */
export function isPhysicsLineage(value: unknown): value is PhysicsLineage {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.engine_config_hash) &&
    isNonEmptyString(value.fee_policy) &&
    isNonEmptyString(value.latency_policy) &&
    isNonEmptyString(value.slippage_policy) &&
    isNonEmptyString(value.impact_policy) &&
    isNonEmptyString(value.run_ref) &&
    isNonEmptyString(value.tenant) &&
    isNonEmptyString(value.project)
  );
}

// ---------------------------------------------------------------------------
// The reactive fill record (the reactive difference, with full lineage)
// ---------------------------------------------------------------------------

/**
 * One engine-driven fill of the reactive world: the ENGINE's own fill
 * record VERBATIM (price, aggressor price, quantity, both fees, latency,
 * the availability quartet — the full exchange-sim mirror) plus the
 * physics lineage block and the episode/run binding. The engine's fill is
 * never transformed: the record the engine minted IS the record the run
 * carries (forensic completeness).
 */
export interface ReactiveFillRecord {
  readonly fill: FillMirror;
  readonly fill_id: string;
  readonly episode_id: string;
  readonly run_ref: string;
  /** The participant whose intent was the taker (the actor of the submitted action). */
  readonly taker_participant: string;
  readonly taker_order_id: string;
  readonly maker_order_id: string;
  readonly physics: PhysicsLineage;
}

/**
 * The TOTAL fill guard — the physics-lineage law enforced. Fails with the
 * typed errors:
 *   - `physics_lineage_missing` — the lineage block is absent/incomplete,
 *   - `lineage_gap` — the run/episode binding is missing,
 *   - `tenant_missing` — the tenant/project scope is missing.
 * A fill without physics lineage is a typed error, never a silent pass.
 */
export function requireReactiveFill(value: unknown): ReactiveResult<ReactiveFillRecord> {
  if (!isRecord(value)) return fail('invalid_state', 'a reactive fill record must be an object');
  if (!isFillMirror(value.fill)) return fail('physics_lineage_missing', 'the record must carry the engine fill verbatim (the engine record ref IS the lineage anchor)');
  const physics = value.physics;
  if (!isRecord(physics)) return fail('physics_lineage_missing', 'the fill carries no physics lineage block — every engine-driven fill carries its full physics lineage');
  if (!isNonEmptyString(physics.engine_config_hash)) return fail('physics_lineage_missing', 'the physics lineage lacks the engine config hash');
  for (const field of ['fee_policy', 'latency_policy', 'slippage_policy', 'impact_policy'] as const) {
    if (!isNonEmptyString(physics[field])) {
      return fail('physics_lineage_missing', `the physics lineage lacks the ${field.replace('_', ' ')} ref (config refs are lineage — L6/L9)`);
    }
  }
  if (!isNonEmptyString(value.run_ref)) return fail('lineage_gap', 'the fill carries no run ref — every fill binds its run (L9)');
  if (!isNonEmptyString(value.episode_id)) return fail('lineage_gap', 'the fill carries no episode id — every fill binds its episode (L9)');
  if (!isNonEmptyString(value.taker_participant) || !isNonEmptyString(value.taker_order_id) || !isNonEmptyString(value.maker_order_id)) {
    return fail('lineage_gap', 'the fill lacks its taker/maker order refs — engine record refs are lineage (L9)');
  }
  if (!isNonEmptyString(physics.run_ref)) return fail('lineage_gap', 'the physics lineage lacks the run ref');
  if (!isNonEmptyString(physics.tenant)) return fail('tenant_missing', 'the fill carries no tenant — every record carries TenantId + ProjectId (L12)');
  if (!isNonEmptyString(physics.project)) return fail('tenant_missing', 'the fill carries no project — every record carries TenantId + ProjectId (L12)');
  if (physics.run_ref !== value.run_ref) return fail('lineage_gap', 'the physics lineage run ref disagrees with the record run ref');
  return ok(value as unknown as ReactiveFillRecord);
}

/** Cheap structural guard (no typed error detail — use {@link requireReactiveFill} for the law). */
export function isReactiveFill(value: unknown): value is ReactiveFillRecord {
  return requireReactiveFill(value).ok;
}

// ---------------------------------------------------------------------------
// The reactive observation (the delivery envelope, with lineage)
// ---------------------------------------------------------------------------

/**
 * One observation of the reactive world — structurally an
 * environment-protocol `Observation` (id, available_time, venue,
 * instrument, payload, provenance) plus the run ref and the tenant/project
 * scope (forward-compatible extra fields, the T010 pattern). The payload
 * is the FULL source record (the recorded event envelope, or the engine
 * outcome with its physics lineage) — forensic completeness.
 */
export interface ReactiveObservation {
  readonly observation_id: string;
  readonly available_time: TimestampMs;
  readonly venue: string | null;
  readonly instrument: string | null;
  readonly payload: JsonValue;
  readonly provenance: {
    readonly origin: 'historical' | 'simulated';
    readonly source: string | null;
    readonly derived_from: readonly string[];
  };
  readonly run_ref: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/**
 * THE L4 DELIVERY GATE (defense in depth — the typed trip-wire). Every
 * observation the world delivers passes through here: an observation
 * whose `available_time` exceeds the query instant `at` fails
 * `l4_boundary_violation` — the observation gate never leaks past the
 * boundary, and the violation is a typed error, never a silent filter.
 */
export function admitObservation(observation: ReactiveObservation, at: TimestampMs): ReactiveResult<ReactiveObservation> {
  if ((observation.available_time as number) > (at as number)) {
    return fail(
      'l4_boundary_violation',
      `observation ${observation.observation_id} becomes available at ${String(observation.available_time)}, after the query instant ${String(at)} — the inclusive boundary (available_time <= at) is the law (L4)`,
    );
  }
  return ok(observation);
}

/** Admit a list through the L4 gate (the first violation fails the batch). */
export function admitObservations(observations: readonly ReactiveObservation[], at: TimestampMs): ReactiveResult<readonly ReactiveObservation[]> {
  for (const observation of observations) {
    const admitted = admitObservation(observation, at);
    if (!admitted.ok) return admitted;
  }
  return ok(observations);
}

/** Guard: a reactive observation (envelope + lineage + tenant). */
export function isReactiveObservation(value: unknown): value is ReactiveObservation {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.observation_id)) return false;
  if (typeof value.available_time !== 'number' || !Number.isSafeInteger(value.available_time)) return false;
  if (value.venue !== null && !isNonEmptyString(value.venue)) return false;
  if (value.instrument !== null && !isNonEmptyString(value.instrument)) return false;
  if (!isJsonValue(value.payload)) return false;
  if (!isRecord(value.provenance)) return false;
  if (value.provenance.origin !== 'historical' && value.provenance.origin !== 'simulated') return false;
  if (value.provenance.source !== null && !isNonEmptyString(value.provenance.source)) return false;
  if (!Array.isArray(value.provenance.derived_from)) return false;
  if (!isNonEmptyString(value.run_ref)) return false;
  if (!isNonEmptyString(value.tenant) || !isNonEmptyString(value.project)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The action receipt (the typed product of submitAction)
// ---------------------------------------------------------------------------

/**
 * The disposition of a submitted action in the reactive world: the intent
 * WAS matched (or rejected by the venue's mechanical rules). The union
 * contrasts T009's single-member `recorded_as_intent` disposition: here a
 * fill is not only expressible — it is the point.
 */
export type ReactiveDisposition = 'engine_matched';

/** The engine intake outcome summary riding the receipt (never a fill itself — fills ride observations and the fill log). */
export interface ReceiptEngineOutcome {
  readonly kind: 'ack' | 'reject' | 'cancel';
  readonly order_id: string;
  readonly status: string;
  readonly reject_reason: string | null;
  readonly fill_ids: readonly string[];
}

/**
 * The typed receipt of one processed action: the full identification of
 * the request, the disposition ('engine_matched' — the reactive
 * difference), the engine intake outcome summary, the physics lineage and
 * the run binding.
 */
export interface ActionReceipt {
  readonly receipt_id: string;
  readonly episode_id: string;
  readonly action_id: string;
  readonly actor: string;
  readonly client_sequence: number;
  readonly recorded_at: TimestampMs;
  readonly disposition: ReactiveDisposition;
  readonly engine: ReceiptEngineOutcome;
  readonly physics: PhysicsLineage;
}

/** Guard: an action receipt (envelope + engine outcome + lineage + tenant). */
export function isActionReceipt(value: unknown): value is ActionReceipt {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.receipt_id) || !isNonEmptyString(value.episode_id) || !isNonEmptyString(value.action_id)) return false;
  if (!isNonEmptyString(value.actor)) return false;
  if (!isNonNegativeSafeInteger(value.client_sequence)) return false;
  if (typeof value.recorded_at !== 'number' || !Number.isSafeInteger(value.recorded_at)) return false;
  if (value.disposition !== 'engine_matched') return false;
  if (!isRecord(value.engine)) return false;
  if (value.engine.kind !== 'ack' && value.engine.kind !== 'reject' && value.engine.kind !== 'cancel') return false;
  if (!isNonEmptyString(value.engine.order_id) || !isNonEmptyString(value.engine.status)) return false;
  if (!Array.isArray(value.engine.fill_ids)) return false;
  if (!isPhysicsLineage(value.physics)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The scripted-action log entry (resume verification currency)
// ---------------------------------------------------------------------------

/** One consumed scripted action, as recorded for resume verification (L9). */
export interface ScriptedLogEntry {
  readonly participant: string;
  readonly at: TimestampMs;
  readonly action_id: string;
}

/** Guard: a scripted log entry. */
export function isScriptedLogEntry(value: unknown): value is ScriptedLogEntry {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.participant) && typeof value.at === 'number' && Number.isSafeInteger(value.at) && isNonEmptyString(value.action_id);
}

// ---------------------------------------------------------------------------
// The run record (L9)
// ---------------------------------------------------------------------------

/** One clock transition in the timeline: an advance call, from -> to. */
export interface ClockAdvance {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** The world block of a reactive run record. */
export interface RunRecordWorld {
  readonly world_id: string;
  /** ALWAYS 'reactive_replay' — the guard rejects any other claim (L5). */
  readonly mode: string;
  readonly config_hash: string;
  readonly engine_config_hash: string;
  readonly seed: string;
  readonly as_of: TimestampMs;
  readonly streams: readonly string[];
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly interleaving: string;
}

/** The episode block of a reactive run record. */
export interface RunRecordEpisode {
  readonly episode_id: string;
  readonly environment_id: string;
  readonly spec_hash: string;
  readonly termination: { readonly code: string; readonly detail: string };
  readonly final_now: TimestampMs;
}

/** The ingestion block of a reactive run record. */
export interface RunRecordIngestion {
  readonly batches: number;
  readonly events: number;
  readonly chain_head: string;
}

/** The engine block of a reactive run record (the reactive difference's ledger). */
export interface RunRecordEngine {
  readonly orders: number;
  readonly fills: number;
  readonly expirations: number;
  readonly engine_state_hash: string;
  readonly book_seed_ref: string | null;
}

/** The participants block of a reactive run record. */
export interface RunRecordParticipants {
  readonly roster: readonly { readonly instance: string; readonly role: string; readonly scripted_actions: number }[];
  readonly driver_actions: number;
}

/** The observation bookkeeping of a reactive run record. */
export interface RunRecordObservations {
  readonly queries: number;
  readonly served: number;
  readonly pending_at_finish: number;
}

/**
 * The full lineage record of one finished reactive episode: the world
 * declaration (mode-honest), the episode binding, the stream ingestion
 * (digest-chained), the ENGINE ledger (state hash — byte-identity anchor),
 * the participant ledger, the complete clock timeline, the full fill log
 * (each with physics lineage), the receipt log, the scripted-action log,
 * and the record's own digest. Two identical runs produce DEEPLY EQUAL
 * records; a resumed run finishes with the identical record.
 */
export interface ReactiveRunRecord {
  readonly schema: 'tradrl/reactive-run-record@1';
  readonly run_id: string;
  readonly world: RunRecordWorld;
  readonly episode: RunRecordEpisode;
  readonly ingestion: RunRecordIngestion;
  readonly engine: RunRecordEngine;
  readonly participants: RunRecordParticipants;
  readonly clock_timeline: readonly ClockAdvance[];
  readonly fill_log: readonly ReactiveFillRecord[];
  readonly receipt_log: readonly ActionReceipt[];
  readonly scripted_log: readonly ScriptedLogEntry[];
  readonly observations: RunRecordObservations;
  /** The record's own digest (over the canonical record without the digest field). */
  readonly digest: string;
}

/**
 * The run-record guard — the L5 trip-wire included: a record claiming any
 * mode other than `'reactive_replay'` fails with
 * `fidelity_claim_dishonest` (this world matches endogenous intents; an
 * exact-replay claim about a matched run is a lie about history).
 */
export function requireReactiveRunRecord(value: unknown): ReactiveResult<ReactiveRunRecord> {
  if (!isRecord(value)) return fail('invalid_state', 'a reactive run record must be an object');
  if (value.schema !== 'tradrl/reactive-run-record@1') return fail('invalid_state', `expected schema "tradrl/reactive-run-record@1", got ${JSON.stringify(value.schema)}`);
  if (value.world === undefined || !isRecord(value.world)) return fail('invalid_state', 'the record carries no world block');
  if (value.world.mode !== 'reactive_replay') {
    return fail(
      'fidelity_claim_dishonest',
      `a reactive run record claims mode '${String(value.world.mode)}' — reactive runs match endogenous intents and must never claim exact-replay fidelity (L5: the modes are distinct, never conflated)`,
    );
  }
  for (const block of ['episode', 'ingestion', 'engine', 'participants', 'observations'] as const) {
    if (value[block] === undefined || !isRecord(value[block])) return fail('invalid_state', `the record carries no ${block} block`);
  }
  if (!Array.isArray(value.clock_timeline) || !Array.isArray(value.fill_log) || !Array.isArray(value.receipt_log) || !Array.isArray(value.scripted_log)) {
    return fail('invalid_state', 'the record logs (clock timeline, fills, receipts, scripted actions) must be arrays');
  }
  if (!isNonEmptyString(value.digest)) return fail('invalid_state', 'the record carries no digest');
  if (!isNonEmptyString(value.run_id)) return fail('lineage_gap', 'the record carries no run id');
  // L12: the world block carries the tenant/project scope.
  if (!isNonEmptyString(value.world.tenant) || !isNonEmptyString(value.world.project)) {
    return fail('tenant_missing', 'the run record carries no tenant/project — every record carries TenantId + ProjectId (L12)');
  }
  // The physics-lineage law, enforced across the whole fill log.
  for (const fill of value.fill_log) {
    const guarded = requireReactiveFill(fill);
    if (!guarded.ok) return guarded;
  }
  return ok(value as unknown as ReactiveRunRecord);
}

/** Cheap structural guard (use {@link requireReactiveRunRecord} for the typed law). */
export function isReactiveRunRecord(value: unknown): value is ReactiveRunRecord {
  return requireReactiveRunRecord(value).ok;
}

// ---------------------------------------------------------------------------
// The per-episode run log (service bookkeeping that feeds the record)
// ---------------------------------------------------------------------------

/** The mutable-across-calls, serializable log of one episode's operations. */
export interface ReactiveRunLog {
  readonly advances: readonly ClockAdvance[];
  readonly observation_queries: number;
  readonly observations_served: number;
}

/** The empty run log of a fresh episode. */
export function emptyRunLog(): ReactiveRunLog {
  return deepFreeze({ advances: [], observation_queries: 0, observations_served: 0 });
}

/** Guard: a run log. */
export function isReactiveRunLog(value: unknown): value is ReactiveRunLog {
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

/**
 * The resumable state of one reactive service run: the pure config value,
 * the ingest chain, the loaded stream, the episode line (engine state,
 * clock, cursor, logs, observations) — everything JSON, nothing ambient.
 * Resume verifies the stream (chain digests) and the scripted feeds
 * (action-id logs) before continuing; a tampered artifact fails
 * `chain_mismatch`.
 */
export interface ReactiveRunState {
  readonly schema: 'tradrl/reactive-run-state@1';
  /** `loading` (no episode bound yet) or `episode` (an episode run line). */
  readonly phase: 'loading' | 'episode';
  readonly config: unknown;
  readonly batches_consumed: number;
  /** The per-batch ingest chain (entry i = chain head after batch i). */
  readonly ingest_chain: readonly string[];
  /** The per-batch event counts (entry i = batch i's size — resume regroups + re-digests the serialized stream). */
  readonly batch_sizes: readonly number[];
  /** Whether the source was exhausted at export time. */
  readonly source_done: boolean;
  /** The loaded recorded stream (validated events, loaded order). */
  readonly stream: readonly unknown[];
  /** The episode line (null while loading). */
  readonly episode_line: EpisodeLineState | null;
  /** The episode's run log (empty while loading). */
  readonly run_log: ReactiveRunLog;
}

/**
 * The serializable episode line: everything one bound episode needs to
 * resume exactly — the spec, the clock, the stream cursor, the engine
 * state, the emitted observations, the logs, the counters.
 */
export interface EpisodeLineState {
  readonly spec: unknown;
  readonly clock_now: TimestampMs;
  readonly clock_as_of: TimestampMs;
  /** The last boundary instant the stream step applied through. */
  readonly applied_through: TimestampMs;
  /** The ids of applied recorded events (application is by availability — see the service's step machine). */
  readonly applied_event_ids: readonly string[];
  readonly engine_state: unknown;
  readonly observations: readonly unknown[];
  readonly accepted_actions: readonly unknown[];
  readonly receipts: readonly unknown[];
  readonly fills: readonly unknown[];
  readonly scripted_log: readonly ScriptedLogEntry[];
  readonly advances: readonly ClockAdvance[];
  readonly observation_queries: number;
  readonly observations_served: number;
  readonly status: 'running' | 'finished';
  readonly termination: TerminationReason | null;
  readonly event_counter: number;
  readonly last_book_top_key: string | null;
  readonly seed_snapshot_ref: string | null;
}

/** Structural shape check for the serialize gate (full validation is deserialize's job). */
function isEpisodeLineShape(value: unknown): value is EpisodeLineState {
  if (!isRecord(value)) return false;
  for (const field of ['spec', 'clock_now', 'clock_as_of', 'applied_through', 'applied_event_ids', 'engine_state', 'observations', 'accepted_actions', 'receipts', 'fills', 'scripted_log', 'advances', 'observation_queries', 'observations_served', 'status', 'termination', 'event_counter'] as const) {
    if (value[field] === undefined) return false;
  }
  return true;
}

/** Structural shape check for the run state. */
export function isReactiveRunStateShape(value: unknown): value is ReactiveRunState {
  return (
    isRecord(value) &&
    value.schema === 'tradrl/reactive-run-state@1' &&
    (value.phase === 'loading' || value.phase === 'episode') &&
    isRecord(value.config) &&
    isNonNegativeSafeInteger(value.batches_consumed) &&
    Array.isArray(value.ingest_chain) &&
    Array.isArray(value.batch_sizes) &&
    typeof value.source_done === 'boolean' &&
    Array.isArray(value.stream) &&
    (value.episode_line === null || isEpisodeLineShape(value.episode_line)) &&
    isReactiveRunLog(value.run_log)
  );
}

/**
 * Serialize a run state to a JSON value (deep copy — the resume artifact
 * is portable across processes). The state is JSON-shaped by construction.
 */
export function serializeReactiveRunState(state: ReactiveRunState): ReactiveResult<JsonValue> {
  if (!isReactiveRunStateShape(state)) {
    return fail('invalid_state', 'cannot serialize a value that is not a structurally valid ReactiveRunState');
  }
  return ok(JSON.parse(JSON.stringify(state)) as JsonValue);
}

/**
 * Deserialize and validate an untrusted run state (collect-all): the
 * schema, the phase coherence, the chain length, and the deep JSON shape.
 * The config and the episode line are re-validated by the SERVICE's resume
 * path against the full validators (the config validator, the engine
 * driver) — this gate checks the artifact's own structure. Tamper
 * detection (chain digests, feed logs) happens at resume, typed
 * `chain_mismatch`.
 */
export function deserializeReactiveRunState(value: unknown): ReactiveResult<ReactiveRunState> {
  if (!isRecord(value)) {
    return fail('invalid_state', 'run state must be an object');
  }
  if (value.schema !== 'tradrl/reactive-run-state@1') {
    return fail('invalid_state', `expected schema "tradrl/reactive-run-state@1", got ${JSON.stringify(value.schema)}`);
  }
  if (value.phase !== 'loading' && value.phase !== 'episode') {
    return fail('invalid_state', `phase must be 'loading' or 'episode', got ${JSON.stringify(value.phase)}`);
  }
  if (!isNonNegativeSafeInteger(value.batches_consumed)) {
    return fail('invalid_state', 'batches_consumed must be a non-negative safe integer');
  }
  const ingestChain: unknown = value.ingest_chain;
  if (!Array.isArray(ingestChain) || !ingestChain.every((head) => typeof head === 'string' && head.length === 8)) {
    return fail('invalid_state', 'ingest_chain must be an array of 8-hex-char chain heads');
  }
  const batchSizes: unknown = value.batch_sizes;
  if (!Array.isArray(batchSizes) || !batchSizes.every((size) => isNonNegativeSafeInteger(size))) {
    return fail('invalid_state', 'batch_sizes must be an array of non-negative safe integers');
  }
  if (Array.isArray(batchSizes) && (batchSizes as readonly number[]).length !== value.batches_consumed) {
    return fail('invalid_state', `batch_sizes length (${(batchSizes as readonly number[]).length}) must equal batches_consumed (${String(value.batches_consumed)})`);
  }
  if (typeof value.source_done !== 'boolean') {
    return fail('invalid_state', 'source_done must be a boolean');
  }
  if (!Array.isArray(value.stream)) {
    return fail('invalid_state', 'stream must be an array of recorded events');
  }
  if ((ingestChain as readonly string[]).length !== value.batches_consumed) {
    return fail('invalid_state', `ingest_chain length (${(ingestChain as readonly string[]).length}) must equal batches_consumed (${String(value.batches_consumed)})`);
  }
  if (value.phase === 'episode' && !isEpisodeLineShape(value.episode_line)) {
    return fail('invalid_state', "phase is 'episode' but the episode line is missing or malformed");
  }
  if (value.phase === 'loading' && value.episode_line !== null) {
    return fail('invalid_state', "phase is 'loading' but an episode line is present");
  }
  if (!isReactiveRunLog(value.run_log)) {
    return fail('invalid_state', 'run_log must be a run log object');
  }
  const json: unknown = value;
  if (!isJsonValue(json)) {
    return fail('invalid_state', 'the run state must be a JSON value (resume artifacts are portable)');
  }
  return ok(
    deepFreeze({
      schema: 'tradrl/reactive-run-state@1' as const,
      phase: value.phase as 'loading' | 'episode',
      config: value.config,
      batches_consumed: value.batches_consumed as number,
      ingest_chain: (ingestChain as readonly string[]).slice(),
      batch_sizes: (batchSizes as readonly number[]).slice(),
      source_done: value.source_done as boolean,
      stream: [...(value.stream as readonly unknown[])],
      episode_line: value.episode_line === null || value.episode_line === undefined ? null : (value.episode_line as EpisodeLineState),
      run_log: deepFreeze({ ...(value.run_log as ReactiveRunLog) }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Record assembly (used by the service)
// ---------------------------------------------------------------------------

/** The inputs the record builder needs from the service's episode line. */
export interface RunRecordInputs {
  readonly config: ReactiveWorldConfig;
  readonly spec: EnvironmentSpec;
  readonly state: EpisodeStateMirror;
  readonly termination: TerminationReason;
  readonly chainHead: string;
  readonly batchesConsumed: number;
  readonly streamEventCount: number;
  readonly engine: EngineStateMirror;
  readonly fills: readonly ReactiveFillRecord[];
  readonly receipts: readonly ActionReceipt[];
  readonly scriptedLog: readonly ScriptedLogEntry[];
  readonly runLog: ReactiveRunLog;
  readonly runId: string;
  readonly pendingAtFinish: number;
  readonly bookSeedRef: string | null;
}

/** Assemble the L9 run record for a finished episode (the service supplies every input). */
export function buildRunRecord(inputs: RunRecordInputs): ReactiveResult<ReactiveRunRecord> {
  if (!isTerminationReason(inputs.termination)) {
    return fail('invalid_termination', 'the recorded termination reason is malformed');
  }
  const configHashValue = worldConfigHash(inputs.config);
  const engineHash = physicsHash(inputs.config.exchange);
  const record: Omit<ReactiveRunRecord, 'digest'> = {
    schema: 'tradrl/reactive-run-record@1',
    run_id: inputs.runId,
    world: {
      world_id: inputs.config.world_id,
      mode: inputs.config.mode, // 'reactive_replay' — the guard's L5 trip-wire
      config_hash: configHashValue,
      engine_config_hash: engineHash,
      seed: inputs.config.seed,
      as_of: inputs.config.as_of,
      streams: inputs.config.streams.map((selection) => `${selection.venue}|${selection.instrument}`),
      tenant: inputs.config.tenant,
      project: inputs.config.project,
      interleaving: inputs.config.interleaving.kind,
    },
    episode: {
      episode_id: deriveEpisodeId(inputs.spec),
      environment_id: inputs.spec.profile.environment_id,
      spec_hash: fnv1a32Hex(canonicalSpecJson(inputs.spec)),
      termination: { code: inputs.termination.code, detail: inputs.termination.detail },
      final_now: inputs.state.clock.now,
    },
    ingestion: {
      batches: inputs.batchesConsumed,
      events: inputs.streamEventCount,
      chain_head: inputs.chainHead,
    },
    engine: {
      orders: inputs.engine.orders.length,
      fills: inputs.engine.fills.length,
      expirations: inputs.engine.orders.filter((record) => {
        if (!isRecord(record)) return false;
        return record.status === 'expired';
      }).length,
      engine_state_hash: engineStateHash(inputs.engine),
      book_seed_ref: inputs.bookSeedRef,
    },
    participants: {
      roster: inputs.config.participants.map((participant) => ({
        instance: participant.instance,
        role: participant.role,
        scripted_actions: inputs.scriptedLog.filter((entry) => entry.participant === participant.instance).length,
      })),
      driver_actions: inputs.receipts.length,
    },
    clock_timeline: [...inputs.runLog.advances],
    fill_log: [...inputs.fills],
    receipt_log: [...inputs.receipts],
    scripted_log: [...inputs.scriptedLog],
    observations: {
      queries: inputs.runLog.observation_queries,
      served: inputs.runLog.observations_served,
      pending_at_finish: inputs.pendingAtFinish,
    },
  };
  const json: unknown = record;
  if (!isJsonValue(json)) {
    return fail('invalid_state', 'the assembled record is not JSON (impossible by construction)');
  }
  const digest = fnv1a32Hex(canonicalJson(json));
  return ok(deepFreeze({ ...record, digest }));
}
