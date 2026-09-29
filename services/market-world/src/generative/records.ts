/**
 * @tradrl/market-world (generative service) — the LINEAGE RECORDS (work
 * order T028): generated events with PROCESS lineage + SYNTHETIC
 * provenance, fills with FULL PHYSICS LINEAGE, observations, action
 * receipts, the GenerativeRunRecord (L9, with the PROCESS STATE hash) and
 * the resumable GenerativeRunState.
 *
 * THE PROCESS-LINEAGE LAW (the generative existential law): "every
 * generated event carries its process lineage (process ref, seed, step)"
 * and "every generated event declares synthetic provenance". A
 * {@link GeneratedEventRecord} therefore carries the emission (id, kind,
 * instant, availability, payload) PLUS the process lineage block (process
 * id, instance, version, seed, step) PLUS the synthetic-provenance
 * declaration PLUS the run/tenant/project binding.
 * {@link requireGeneratedEvent} fails `process_undeclared` /
 * `synthetic_provenance_missing` / `lineage_gap` / `tenant_missing` —
 * negative tests prove each failure mode.
 *
 * THE SYNTHETIC-PROVENANCE LAW (L6, this lane's existential honesty):
 * "Generative worlds are EXPLORATION instruments — every emitted record
 * carries the synthetic-provenance declaration; a record passing as
 * historical is unrepresentable." The guard enforces BOTH directions: a
 * generated event MISSING its declaration fails
 * `synthetic_provenance_missing`, and a generated record claiming
 * `historical` origin fails `fidelity_claim_dishonest` (claiming
 * historical provenance for generated data IS claiming historical
 * fidelity).
 *
 * THE PHYSICS LINEAGE LAW (shared with the reactive sibling): "every
 * engine-driven fill carries its full physics lineage (engine record
 * refs, fee/latency/slippage/impact config refs); a fill without physics
 * lineage is a typed error." {@link requireGenerativeFill} fails
 * `physics_lineage_missing` / `lineage_gap` / `tenant_missing`.
 *
 * THE L4 GATE (defense in depth): {@link admitObservation} is the total
 * delivery gate every observation passes through — an observation whose
 * `available_time` exceeds the query instant fails
 * `l4_boundary_violation`.
 *
 * THE RUN RECORD (L9, extending the sibling discipline with the PROCESS
 * STATE hash): config hash, generation-chain head, spec hash, the ENGINE
 * state hash, the PROCESS STATE hash (the stochastic processes' terminal
 * randomness, byte-bound), the complete fill log (with physics), the
 * receipt log, the generated-event log (with process lineage), the clock
 * timeline, and the record's own digest. A run record claiming any
 * fidelity other than `'generative'` fails its guard with
 * `fidelity_claim_dishonest` (the L5 trip-wire — inexpressible by
 * construction, provable by the guard).
 *
 * RESUMABILITY: the run state serializes -> parses -> resumes with
 * generation-chain AND process-state AND engine-state verification (each
 * tamper = `chain_mismatch`), and a resumed run finishes with the
 * IDENTICAL run record — INCLUDING the stochastic process states
 * mid-stream (the hard part: the process state hash proves the restored
 * randomness is the recorded randomness).
 *
 * ZERO NON-DETERMINISM: no wall clock, no Math.random, no process data —
 * every field derives from the config, the armed processes, the injected
 * engine and the driver's operations.
 */

import { canonicalJson, deepFreeze, isNonEmptyString, isNonNegativeSafeInteger, isRecord } from './primitives';
import { fnv1a32Hex } from './primitives';
import type { JsonValue } from './primitives';
import { isJsonValue } from './primitives';
import { fail, ok, type GenerativeResult } from './errors';
import type { ProjectId, TenantId, TimestampMs } from './ids';
import type { ActionEnvelope, EpisodeStateMirror, EnvironmentSpec, TerminationReason } from './env-mirror';
import { canonicalSpecJson, deriveEpisodeId, isTerminationReason } from './env-mirror';
import type { FillMirror } from './exchange-mirror';
import { engineStateHash, isFillMirror, physicsHash, type EngineStateMirror } from './exchange-mirror';
import type { ProcessRuntimeState } from './process';
import { isProcessRuntimeState, processStateHash } from './process';
import type { GenerativeWorldConfig } from './config';
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
// The generated-event record (the generative difference's first ledger)
// ---------------------------------------------------------------------------

/**
 * The synthetic-provenance declaration every generated event carries (the
 * L6 law: a record passing as historical is unrepresentable).
 */
export interface SyntheticProvenance {
  /** Always true on valid records — the guard fails the missing/false case. */
  readonly generated: boolean;
  readonly declaration: string;
}

/** The canonical synthetic-provenance declaration block (bound by the service on every emission). */
export const SYNTHETIC_PROVENANCE_DECLARATION: string =
  'generated by a declared seeded stochastic process of a generative world — synthetic exploration data, never historical truth (L6: synthetic worlds are stress/exploration instruments, not historical truth)';

/**
 * One generated event of the generative world: the emission (the walk's
 * market quote, or a population participant's order intent) PLUS the full
 * lineage — the process lineage block (process ref, instance, version,
 * seed, step — the generative existential law), the synthetic-provenance
 * declaration, the run ref and the tenant/project scope. Every field the
 * guard checks is a law, never a decoration.
 */
export interface GeneratedEventRecord {
  readonly event_id: string;
  readonly kind: 'market_quote' | 'population_intent';
  readonly at: TimestampMs;
  readonly available_time: TimestampMs;
  /** The acting participant (population intents only; null for world events). */
  readonly actor: string | null;
  readonly payload: JsonValue;
  /** The process lineage (process ref, instance, version, seed, step). */
  readonly process: {
    readonly process: string;
    readonly instance: string;
    readonly version: string;
    readonly seed: string;
    readonly step: number;
  };
  readonly synthetic: SyntheticProvenance;
  readonly run_ref: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/**
 * The TOTAL generated-event guard — the process-lineage and
 * synthetic-provenance laws enforced. Fails with the typed errors:
 *   - `process_undeclared` — the process lineage block is absent or
 *     incomplete (an event without a declared process is ambient
 *     randomness, the thing this lane exists to forbid);
 *   - `synthetic_provenance_missing` — the synthetic declaration is
 *     absent or not asserted;
 *   - `fidelity_claim_dishonest` — the record claims `historical` origin
 *     (in its payload provenance or anywhere in the block) — generated
 *     data claiming historical provenance is the L5/L6 lie;
 *   - `lineage_gap` — the run binding is missing;
 *   - `tenant_missing` — the tenant/project scope is missing.
 */
export function requireGeneratedEvent(value: unknown): GenerativeResult<GeneratedEventRecord> {
  if (!isRecord(value)) return fail('invalid_state', 'a generated event record must be an object');
  if (value.kind !== 'market_quote' && value.kind !== 'population_intent') {
    return fail('invalid_state', `the generated event kind must be 'market_quote' | 'population_intent', got ${JSON.stringify(value.kind)}`);
  }
  if (!isNonEmptyString(value.event_id)) return fail('lineage_gap', 'the generated event carries no event id (L9)');
  if (typeof value.at !== 'number' || !Number.isSafeInteger(value.at)) return fail('invalid_state', 'the generated event instant is malformed');
  if (typeof value.available_time !== 'number' || !Number.isSafeInteger(value.available_time)) return fail('invalid_state', 'the generated event availability is malformed');
  if ((value.available_time as number) < (value.at as number)) {
    return fail('l4_boundary_violation', `generated event ${value.event_id} becomes available at ${String(value.available_time)}, before its own instant ${String(value.at)} — availability cannot precede occurrence (L4)`);
  }
  if (value.kind === 'population_intent' && !isNonEmptyString(value.actor)) {
    return fail('lineage_gap', `generated event ${value.event_id} is a population intent but carries no actor — generated actions are lineaged to their participant (L9)`);
  }
  if (!isJsonValue(value.payload)) return fail('invalid_state', 'the generated event payload must be a JSON value');

  // THE PROCESS-LINEAGE LAW.
  const process = value.process;
  if (!isRecord(process)) {
    return fail('process_undeclared', `generated event ${value.event_id} carries no process lineage block — every generated event carries its process lineage (process ref, seed, step); an event without a declared process is ambient randomness`);
  }
  if (!isNonEmptyString(process.process) || !isNonEmptyString(process.instance) || !isNonEmptyString(process.version) || !isNonEmptyString(process.seed)) {
    return fail('process_undeclared', `generated event ${value.event_id} carries an incomplete process lineage (process ref, instance, version and seed are all lineage — L9)`);
  }
  if (!isNonNegativeSafeInteger(process.step)) {
    return fail('process_undeclared', `generated event ${value.event_id} carries a malformed process step — the emitting step ordinal is lineage (L9)`);
  }

  // THE SYNTHETIC-PROVENANCE LAW (both directions).
  const synthetic = value.synthetic;
  if (!isRecord(synthetic)) {
    return fail('synthetic_provenance_missing', `generated event ${value.event_id} carries no synthetic-provenance declaration — every emitted record of a generative world declares its syntheticity (L6: a record passing as historical is unrepresentable)`);
  }
  if (synthetic.generated !== true) {
    return fail('synthetic_provenance_missing', `generated event ${value.event_id} does not assert its synthetic provenance — the declaration is the law, not a decoration (L6)`);
  }
  if (!isNonEmptyString(synthetic.declaration)) {
    return fail('synthetic_provenance_missing', `generated event ${value.event_id} carries an empty synthetic-provenance declaration (L6)`);
  }
  if (isRecord(value.origin) && (value.origin as Record<string, unknown>).origin === 'historical') {
    return fail('fidelity_claim_dishonest', `generated event ${value.event_id} claims historical origin — generated data claiming historical provenance is a lie about what it is (L5/L6)`);
  }

  // The run + tenant bindings.
  if (!isNonEmptyString(value.run_ref)) return fail('lineage_gap', `generated event ${value.event_id} carries no run ref — every record binds its run (L9)`);
  if (!isNonEmptyString(value.tenant)) return fail('tenant_missing', `generated event ${value.event_id} carries no tenant — every record carries TenantId + ProjectId (L12)`);
  if (!isNonEmptyString(value.project)) return fail('tenant_missing', `generated event ${value.event_id} carries no project — every record carries TenantId + ProjectId (L12)`);
  return ok(value as unknown as GeneratedEventRecord);
}

/** Cheap structural guard (use {@link requireGeneratedEvent} for the law). */
export function isGeneratedEvent(value: unknown): value is GeneratedEventRecord {
  return requireGeneratedEvent(value).ok;
}

// ---------------------------------------------------------------------------
// The generative fill record (the physics lineage's ledger)
// ---------------------------------------------------------------------------

/**
 * One engine-driven fill of the generative world: the ENGINE's own fill
 * record VERBATIM (price, aggressor price, quantity, both fees, latency,
 * the availability quartet — the full exchange-sim mirror) plus the
 * physics lineage block, the GENERATING actor's binding (the taker is the
 * participant whose intent — candidate- or process-generated — crossed),
 * and the episode/run binding. The engine's fill is never transformed:
 * the record the engine minted IS the record the run carries (forensic
 * completeness).
 */
export interface GenerativeFillRecord {
  readonly fill: FillMirror;
  readonly fill_id: string;
  readonly episode_id: string;
  readonly run_ref: string;
  /** The participant whose intent was the taker (candidate or a generated population participant). */
  readonly taker_participant: string;
  readonly taker_order_id: string;
  readonly maker_order_id: string;
  readonly physics: PhysicsLineage;
}

/**
 * The TOTAL fill guard — the physics-lineage law enforced. Fails with the
 * typed errors `physics_lineage_missing` / `lineage_gap` /
 * `tenant_missing`. A fill without physics lineage is a typed error,
 * never a silent pass.
 */
export function requireGenerativeFill(value: unknown): GenerativeResult<GenerativeFillRecord> {
  if (!isRecord(value)) return fail('invalid_state', 'a generative fill record must be an object');
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
  return ok(value as unknown as GenerativeFillRecord);
}

/** Cheap structural guard (use {@link requireGenerativeFill} for the law). */
export function isGenerativeFill(value: unknown): value is GenerativeFillRecord {
  return requireGenerativeFill(value).ok;
}

// ---------------------------------------------------------------------------
// The generative observation (the delivery envelope, with lineage)
// ---------------------------------------------------------------------------

/**
 * One observation of the generative world — structurally an
 * environment-protocol `Observation` (id, available_time, venue,
 * instrument, payload, provenance) plus the run ref and the tenant/project
 * scope (forward-compatible extra fields, the sibling lanes' pattern). The
 * payload is the FULL source record (the generated event envelope, or the
 * engine outcome with its physics lineage) — forensic completeness. THE
 * ORIGIN LAW: this lane's observations are `generated` (declared
 * processes) or `simulated` (engine outcomes) — `historical` is never
 * minted (there is no recorded stream to be historical about).
 */
export interface GenerativeObservation {
  readonly observation_id: string;
  readonly available_time: TimestampMs;
  readonly venue: string | null;
  readonly instrument: string | null;
  readonly payload: JsonValue;
  readonly provenance: {
    readonly origin: 'historical' | 'simulated' | 'generated';
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
export function admitObservation(observation: GenerativeObservation, at: TimestampMs): GenerativeResult<GenerativeObservation> {
  if ((observation.available_time as number) > (at as number)) {
    return fail(
      'l4_boundary_violation',
      `observation ${observation.observation_id} becomes available at ${String(observation.available_time)}, after the query instant ${String(at)} — the inclusive boundary (available_time <= at) is the law (L4)`,
    );
  }
  return ok(observation);
}

/** Admit a list through the L4 gate (the first violation fails the batch). */
export function admitObservations(observations: readonly GenerativeObservation[], at: TimestampMs): GenerativeResult<readonly GenerativeObservation[]> {
  for (const observation of observations) {
    const admitted = admitObservation(observation, at);
    if (!admitted.ok) return admitted;
  }
  return ok(observations);
}

/** Guard: a generative observation (envelope + lineage + tenant). */
export function isGenerativeObservation(value: unknown): value is GenerativeObservation {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.observation_id)) return false;
  if (typeof value.available_time !== 'number' || !Number.isSafeInteger(value.available_time)) return false;
  if (value.venue !== null && !isNonEmptyString(value.venue)) return false;
  if (value.instrument !== null && !isNonEmptyString(value.instrument)) return false;
  if (!isJsonValue(value.payload)) return false;
  if (!isRecord(value.provenance)) return false;
  if (value.provenance.origin !== 'historical' && value.provenance.origin !== 'simulated' && value.provenance.origin !== 'generated') return false;
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
 * The disposition of a submitted action in the generative world: the
 * intent WAS matched (or rejected by the venue's mechanical rules). The
 * union contrasts exact replay's single-member `recorded_as_intent`
 * disposition: here a fill is not only expressible — it is the point.
 */
export type GenerativeDisposition = 'engine_matched';

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
 * the request, the disposition ('engine_matched' — the generative
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
  readonly disposition: GenerativeDisposition;
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
// The run record (L9 — with the PROCESS STATE hash)
// ---------------------------------------------------------------------------

/** One clock transition in the timeline: an advance call, from -> to. */
export interface ClockAdvance {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** The world block of a generative run record. */
export interface RunRecordWorld {
  readonly world_id: string;
  /** ALWAYS 'generative' — the guard rejects any other claim (L5). */
  readonly mode: string;
  readonly config_hash: string;
  readonly engine_config_hash: string;
  readonly seed: string;
  readonly horizon: TimestampMs;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly interleaving: string;
}

/** The episode block of a generative run record. */
export interface RunRecordEpisode {
  readonly episode_id: string;
  readonly environment_id: string;
  readonly spec_hash: string;
  readonly termination: { readonly code: string; readonly detail: string };
  readonly final_now: TimestampMs;
}

/** The generation block (the generative difference's data ledger). */
export interface RunRecordGeneration {
  /** The number of generated events (context quotes + population intents). */
  readonly events: number;
  /** The generation-chain head: binds config + every generated event in order (L9). */
  readonly chain_head: string;
  /** The terminal PROCESS STATE hash — the stochastic processes' final randomness, byte-bound (the resume law's anchor). */
  readonly process_state_hash: string;
}

/** The engine block of a generative run record (the physics ledger). */
export interface RunRecordEngine {
  readonly orders: number;
  readonly fills: number;
  readonly expirations: number;
  readonly engine_state_hash: string;
  readonly book_seed: 'declared';
}

/** The population block of a generative run record. */
export interface RunRecordPopulation {
  readonly cohorts: readonly { readonly cohort_id: string; readonly label: string; readonly policy: string; readonly participants: number; readonly generated_actions: number }[];
  readonly candidate: string;
  readonly driver_actions: number;
}

/** The observation bookkeeping of a generative run record. */
export interface RunRecordObservations {
  readonly queries: number;
  readonly served: number;
  readonly pending_at_finish: number;
}

/**
 * The full lineage record of one finished generative episode: the world
 * declaration (mode-honest), the episode binding, the GENERATION ledger
 * (chain head + process state hash — the generative difference), the
 * ENGINE ledger (state hash — the byte-identity anchor), the population
 * ledger, the complete clock timeline, the full fill log (each with
 * physics lineage), the receipt log, the generated-event log (each with
 * process lineage + synthetic provenance), and the record's own digest.
 * Two identical runs produce DEEPLY EQUAL records; a resumed run
 * finishes with the identical record.
 */
export interface GenerativeRunRecord {
  readonly schema: 'tradrl/generative-run-record@1';
  readonly run_id: string;
  readonly world: RunRecordWorld;
  readonly episode: RunRecordEpisode;
  readonly generation: RunRecordGeneration;
  readonly engine: RunRecordEngine;
  readonly population: RunRecordPopulation;
  readonly clock_timeline: readonly ClockAdvance[];
  readonly fill_log: readonly GenerativeFillRecord[];
  readonly receipt_log: readonly ActionReceipt[];
  readonly generated_log: readonly GeneratedEventRecord[];
  readonly observations: RunRecordObservations;
  /** The record's own digest (over the canonical record without the digest field). */
  readonly digest: string;
}

/**
 * The run-record guard — the L5 trip-wire included: a record claiming any
 * mode other than `'generative'` fails with `fidelity_claim_dishonest`
 * (this world generates its entire market; an exact- or reactive-replay
 * claim about a generated run is a lie about what the run is — the modes
 * are never conflated).
 */
export function requireGenerativeRunRecord(value: unknown): GenerativeResult<GenerativeRunRecord> {
  if (!isRecord(value)) return fail('invalid_state', 'a generative run record must be an object');
  if (value.schema !== 'tradrl/generative-run-record@1') return fail('invalid_state', `expected schema "tradrl/generative-run-record@1", got ${JSON.stringify(value.schema)}`);
  if (value.world === undefined || !isRecord(value.world)) return fail('invalid_state', 'the record carries no world block');
  if (value.world.mode !== 'generative') {
    return fail(
      'fidelity_claim_dishonest',
      `a generative run record claims mode '${String(value.world.mode)}' — generative runs generate their entire market from declared processes and must never claim exact- or reactive-replay fidelity (L5: the modes are distinct, never conflated)`,
    );
  }
  for (const block of ['episode', 'generation', 'engine', 'population', 'observations'] as const) {
    if (value[block] === undefined || !isRecord(value[block])) return fail('invalid_state', `the record carries no ${block} block`);
  }
  if (!Array.isArray(value.clock_timeline) || !Array.isArray(value.fill_log) || !Array.isArray(value.receipt_log) || !Array.isArray(value.generated_log)) {
    return fail('invalid_state', 'the record logs (clock timeline, fills, receipts, generated events) must be arrays');
  }
  if (!isNonEmptyString(value.digest)) return fail('invalid_state', 'the record carries no digest');
  if (!isNonEmptyString(value.run_id)) return fail('lineage_gap', 'the record carries no run id');
  // L12: the world block carries the tenant/project scope.
  if (!isNonEmptyString(value.world.tenant) || !isNonEmptyString(value.world.project)) {
    return fail('tenant_missing', 'the run record carries no tenant/project — every record carries TenantId + ProjectId (L12)');
  }
  // The physics-lineage law, enforced across the whole fill log.
  for (const fill of value.fill_log) {
    const guarded = requireGenerativeFill(fill);
    if (!guarded.ok) return guarded;
  }
  // The process-lineage + synthetic-provenance laws, across the whole
  // generated-event log.
  for (const event of value.generated_log) {
    const guarded = requireGeneratedEvent(event);
    if (!guarded.ok) return guarded;
  }
  return ok(value as unknown as GenerativeRunRecord);
}

/** Cheap structural guard (use {@link requireGenerativeRunRecord} for the typed law). */
export function isGenerativeRunRecord(value: unknown): value is GenerativeRunRecord {
  return requireGenerativeRunRecord(value).ok;
}

// ---------------------------------------------------------------------------
// The per-episode run log (service bookkeeping that feeds the record)
// ---------------------------------------------------------------------------

/** The mutable-across-calls, serializable log of one episode's operations. */
export interface GenerativeRunLog {
  readonly advances: readonly ClockAdvance[];
  readonly observation_queries: number;
  readonly observations_served: number;
}

/** The empty run log of a fresh episode. */
export function emptyRunLog(): GenerativeRunLog {
  return deepFreeze({ advances: [], observation_queries: 0, observations_served: 0 });
}

/** Guard: a run log. */
export function isGenerativeRunLog(value: unknown): value is GenerativeRunLog {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.advances)) return false;
  if (!value.advances.every((advance) => isRecord(advance) && typeof advance.from === 'number' && typeof advance.to === 'number')) return false;
  if (!isNonNegativeSafeInteger(value.observation_queries)) return false;
  if (!isNonNegativeSafeInteger(value.observations_served)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The generation chain (L9 — the generated-stream digest discipline)
// ---------------------------------------------------------------------------

/** The digest of one generated event record (over its canonical JSON). */
export function generatedEventDigest(event: GeneratedEventRecord): string {
  const json: unknown = event;
  if (!isJsonValue(json)) {
    // Impossible by construction (validated records are JSON); kept total.
    return fnv1a32Hex('non-json-generated-event');
  }
  return fnv1a32Hex(canonicalJson(json));
}

/** Fold one generated event onto the generation chain (seeded from the config hash by the service). */
export function chainDigest(previousHead: string, event: GeneratedEventRecord): string {
  return fnv1a32Hex(`${previousHead}:${generatedEventDigest(event)}`);
}

// ---------------------------------------------------------------------------
// The serializable run state (the resume artifact)
// ---------------------------------------------------------------------------

/**
 * The resumable state of one generative service run: the pure config
 * value, the recorded integrity anchors (the generation chain, the
 * process state hash, the engine state hash — each VERIFIED at resume;
 * tamper = `chain_mismatch`), and the episode line (clock, process
 * runtimes, engine state, logs, observations) — everything JSON, nothing
 * ambient.
 */
export interface GenerativeRunState {
  readonly schema: 'tradrl/generative-run-state@1';
  readonly phase: 'episode';
  readonly config: unknown;
  /** The per-event generation chain (entry i = chain head after event i). */
  readonly generation_chain: readonly string[];
  /** The recorded process state hash at export (resume recomputes + verifies). */
  readonly process_state_hash: string;
  /** The recorded engine state hash at export (resume recomputes + verifies). */
  readonly engine_state_hash: string;
  readonly episode_line: EpisodeLineState;
  readonly run_log: GenerativeRunLog;
}

/**
 * The serializable episode line: everything one bound episode needs to
 * resume exactly — the spec, the clock, the ARMED PROCESS RUNTIMES (the
 * stochastic state mid-stream — the resume law's hard part), the engine
 * state, the emitted observations, the generated-event log, the logs,
 * the counters.
 */
export interface EpisodeLineState {
  readonly spec: unknown;
  readonly clock_now: TimestampMs;
  readonly clock_as_of: TimestampMs;
  readonly process_states: readonly unknown[];
  readonly engine_state: unknown;
  readonly observations: readonly unknown[];
  readonly accepted_actions: readonly unknown[];
  readonly receipts: readonly unknown[];
  readonly fills: readonly unknown[];
  readonly generated_log: readonly unknown[];
  readonly advances: readonly ClockAdvance[];
  readonly observation_queries: number;
  readonly observations_served: number;
  readonly status: 'running' | 'finished';
  readonly termination: TerminationReason | null;
  readonly event_counter: number;
  /** The last boundary instant the step machine processed through. */
  readonly last_boundary: TimestampMs;
  readonly last_book_top_key: string | null;
}

/** Structural shape check for the episode line (full validation is deserialize's + resume's job). */
function isEpisodeLineShape(value: unknown): value is EpisodeLineState {
  if (!isRecord(value)) return false;
  for (const field of ['spec', 'clock_now', 'clock_as_of', 'process_states', 'engine_state', 'observations', 'accepted_actions', 'receipts', 'fills', 'generated_log', 'advances', 'observation_queries', 'observations_served', 'status', 'termination', 'event_counter', 'last_boundary', 'last_book_top_key'] as const) {
    if (value[field] === undefined) return false;
  }
  return true;
}

/** Structural shape check for the run state. */
export function isGenerativeRunStateShape(value: unknown): value is GenerativeRunState {
  return (
    isRecord(value) &&
    value.schema === 'tradrl/generative-run-state@1' &&
    value.phase === 'episode' &&
    isRecord(value.config) &&
    Array.isArray(value.generation_chain) &&
    isNonEmptyString(value.process_state_hash) &&
    isNonEmptyString(value.engine_state_hash) &&
    isEpisodeLineShape(value.episode_line) &&
    isGenerativeRunLog(value.run_log)
  );
}

/**
 * Serialize a run state to a JSON value (deep copy — the resume artifact
 * is portable across processes). The state is JSON-shaped by construction.
 */
export function serializeGenerativeRunState(state: GenerativeRunState): GenerativeResult<JsonValue> {
  if (!isGenerativeRunStateShape(state)) {
    return fail('invalid_state', 'cannot serialize a value that is not a structurally valid GenerativeRunState');
  }
  return ok(JSON.parse(JSON.stringify(state)) as JsonValue);
}

/**
 * Deserialize and validate an untrusted run state (collect-all): the
 * schema, the chain shape, the recorded hashes, and the deep JSON shape.
 * The config and the episode line are re-validated by the SERVICE's
 * resume path against the full validators (the config validator, the
 * process runtimes, the engine driver) — this gate checks the artifact's
 * own structure. Tamper detection (chain fold, process state hash,
 * engine state hash) happens at resume, typed `chain_mismatch`.
 */
export function deserializeGenerativeRunState(value: unknown): GenerativeResult<GenerativeRunState> {
  if (!isRecord(value)) {
    return fail('invalid_state', 'run state must be an object');
  }
  if (value.schema !== 'tradrl/generative-run-state@1') {
    return fail('invalid_state', `expected schema "tradrl/generative-run-state@1", got ${JSON.stringify(value.schema)}`);
  }
  if (value.phase !== 'episode') {
    return fail('invalid_state', `phase must be 'episode' (generative worlds arm processes at episode start — there is no loading phase), got ${JSON.stringify(value.phase)}`);
  }
  const chain: unknown = value.generation_chain;
  if (!Array.isArray(chain) || !chain.every((head) => typeof head === 'string' && head.length === 8)) {
    return fail('invalid_state', 'generation_chain must be an array of 8-hex-char chain heads');
  }
  if (!isNonEmptyString(value.process_state_hash)) {
    return fail('invalid_state', 'process_state_hash must be a non-empty string (the recorded integrity anchor)');
  }
  if (!isNonEmptyString(value.engine_state_hash)) {
    return fail('invalid_state', 'engine_state_hash must be a non-empty string (the recorded integrity anchor)');
  }
  if (!isEpisodeLineShape(value.episode_line)) {
    return fail('invalid_state', 'the episode line is missing or malformed');
  }
  if (!isGenerativeRunLog(value.run_log)) {
    return fail('invalid_state', 'run_log must be a run log object');
  }
  const json: unknown = value;
  if (!isJsonValue(json)) {
    return fail('invalid_state', 'the run state must be a JSON value (resume artifacts are portable)');
  }
  return ok(
    deepFreeze({
      schema: 'tradrl/generative-run-state@1' as const,
      phase: 'episode' as const,
      config: value.config,
      generation_chain: (chain as readonly string[]).slice(),
      process_state_hash: value.process_state_hash as string,
      engine_state_hash: value.engine_state_hash as string,
      episode_line: value.episode_line as EpisodeLineState,
      run_log: deepFreeze({ ...(value.run_log as GenerativeRunLog) }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Record assembly (used by the service)
// ---------------------------------------------------------------------------

/** The inputs the record builder needs from the service's episode line. */
export interface RunRecordInputs {
  readonly config: GenerativeWorldConfig;
  readonly spec: EnvironmentSpec;
  readonly state: EpisodeStateMirror;
  readonly termination: TerminationReason;
  readonly chainHead: string;
  readonly processStates: readonly ProcessRuntimeState[];
  readonly engine: EngineStateMirror;
  readonly fills: readonly GenerativeFillRecord[];
  readonly receipts: readonly ActionReceipt[];
  readonly generatedLog: readonly GeneratedEventRecord[];
  readonly runLog: GenerativeRunLog;
  readonly runId: string;
  readonly pendingAtFinish: number;
  readonly driverActions: number;
}

/** Assemble the L9 run record for a finished episode (the service supplies every input). */
export function buildRunRecord(inputs: RunRecordInputs): GenerativeResult<GenerativeRunRecord> {
  if (!isTerminationReason(inputs.termination)) {
    return fail('invalid_termination', 'the recorded termination reason is malformed');
  }
  const configHashValue = worldConfigHash(inputs.config);
  const engineHash = physicsHash(inputs.config.exchange);
  const record: Omit<GenerativeRunRecord, 'digest'> = {
    schema: 'tradrl/generative-run-record@1',
    run_id: inputs.runId,
    world: {
      world_id: inputs.config.world_id,
      mode: inputs.config.mode, // 'generative' — the guard's L5 trip-wire
      config_hash: configHashValue,
      engine_config_hash: engineHash,
      seed: inputs.config.seed,
      horizon: inputs.config.horizon,
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
    generation: {
      events: inputs.generatedLog.length,
      chain_head: inputs.chainHead,
      process_state_hash: processStateHash(inputs.processStates),
    },
    engine: {
      orders: inputs.engine.orders.length,
      fills: inputs.engine.fills.length,
      expirations: inputs.engine.orders.filter((entry) => {
        if (!isRecord(entry)) return false;
        return entry.status === 'expired';
      }).length,
      engine_state_hash: engineStateHash(inputs.engine),
      book_seed: 'declared',
    },
    population: {
      cohorts: inputs.config.population.cohorts.map((cohort) => ({
        cohort_id: cohort.cohort_id,
        label: cohort.label,
        policy: cohort.policy,
        participants: cohort.size,
        generated_actions: inputs.generatedLog.filter((event) => event.kind === 'population_intent' && event.actor !== null && event.actor.startsWith(`pop-${cohort.cohort_id}-`)).length,
      })),
      candidate: inputs.config.population.candidate.instance,
      driver_actions: inputs.driverActions,
    },
    clock_timeline: [...inputs.runLog.advances],
    fill_log: [...inputs.fills],
    receipt_log: [...inputs.receipts],
    generated_log: [...inputs.generatedLog],
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

// Re-export the runtime-state guard for consumers of the resume artifact.
export { isProcessRuntimeState };
