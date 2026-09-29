/**
 * @tradrl/rl-protocol — the environment-lane structural mirrors (D-003/D-004).
 *
 * The bridge drives TradRL environments (T009's replay worlds, T010's
 * exchange simulation — anything satisfying @tradrl/environment-protocol's
 * `Environment` five-operation surface) WITHOUT importing that package: the
 * shapes the bridge exchanges with a world are re-declared here as identical
 * structural mirrors, and src/interop.test.ts is the drift trip wire against
 * the REAL package present on this branch.
 *
 * THE L4 LAW SHAPES THE MIRRORS (spec/ARCHITECTURE-LOCK.md L4: "observations
 * and derived features obey information availability time"):
 *
 *   - {@link ObservationView} — the ONLY observation shape the bridge ever
 *     sees: `observation_id` + `available_time`. The real `Observation`
 *     envelope's payload, venue, instrument and provenance are structurally
 *     assignable TO this view, but the bridge can never read AROUND the
 *     availability boundary — the type enforces "observations are only ever
 *     seen through available_time". Worlds hand richer values; the port
 *     narrows them to the view.
 *   - {@link EpisodeView} — the minimal episode-state view the driver
 *     consumes (episode id, clock, status, termination, reward envelopes).
 *     The real `EpisodeState` (spec, pending set, accepted-action log) is
 *     assignable TO this view; the reverse is deliberately NOT claimed — the
 *     bridge is a consumer of worlds, never a producer of episode state.
 *   - {@link EnvironmentSpec} / {@link ClockConfig} / {@link
 *     EnvironmentProfile} — FULL exact mirrors (field-for-field equal to the
 *     canonical T005 declarations): the run DECLARATION carries a spec the
 *     bridge validates and hands to a real world's `start`, so both
 *     assignability directions are required and trip-wired.
 *   - {@link ActionRecord} lives in traj-mirror.ts: it is field-identical to
 *     T005's `Action` (the trajectory package models the same identity — a
 *     request, never authority, L8), and the bridge MINTS actions of exactly
 *     that shape.
 *
 * The reward envelope {@link RewardSignalEnvelope} mirrors T005's
 * `RewardSignal` minus `episode_id` (the trajectory metadata owns the episode
 * binding — @tradrl/trajectory's `RewardSignalRecord` discipline). Worlds
 * that emit reward signals (the environment-protocol law: optional,
 * explicit, never fabricated) remain assignable to this view; the L7 law for
 * BRIDGE-emitted rewards is reward.ts's RewardModel discipline.
 */

import { deepFreeze, isFiniteNumber, isNonEmptyString, isRecord } from './primitives';
import type { JsonObject, JsonValue } from './primitives';
import { canonicalJson } from './primitives';
import { fail, invalidField, invalidType, missingField, ok, type RLError, type RLResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { ActionRecord } from './traj-mirror';
import type {
  EnvironmentId,
  EpisodeId,
  FeePolicyId,
  InstrumentId,
  LatencyPolicyId,
  ObservationId,
  RewardId,
  Seed,
  VenueId,
  WorldId,
} from './ids';
import {
  isEnvironmentId,
  isFeePolicyId,
  isInstrumentId,
  isLatencyPolicyId,
  isObservationId,
  isRewardId,
  isSeed,
  isVenueId,
  isWorldId,
} from './ids';

// ---------------------------------------------------------------------------
// Clock config (structural mirror of T005's clock.ts, itself a mirror of
// time-engine's SimulationClock — DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/** The three distinct world-fidelity modes (L5). Mirror of time-engine/T005. */
export type FidelityMode = 'exact_replay' | 'reactive_replay' | 'generative';

/** Runtime-checkable list of fidelity modes, for guards and diagnostics. */
export const FIDELITY_MODES: readonly FidelityMode[] = ['exact_replay', 'reactive_replay', 'generative'];

/**
 * The information policy governing what the episode's `now` admits.
 * `point-in-time`: an observation is visible iff `available_time <= now`
 * (inclusive). Mirror of time-engine/T005 — the boundary is the law (L4),
 * not a dial.
 */
export type InformationPolicy = 'point-in-time';

/** The clock configuration of an environment profile — exact mirror of T005's `ClockConfig`. */
export interface ClockConfig {
  /** Initial/current simulated instant. Monotonic within an episode; never past `asOf`. */
  readonly now: TimestampMs;
  /** Historical anchor: the latest instant this episode's information set covers. */
  readonly asOf: TimestampMs;
  /** Positive finite playback-speed multiplier. 1 = real time. */
  readonly playbackSpeed: number;
  /** Whether automatic progression was suspended. */
  readonly paused: boolean;
  /** World fidelity mode — one of the three distinct L5 modes. */
  readonly fidelity: FidelityMode;
  /** Information policy in force. */
  readonly informationPolicy: InformationPolicy;
}

/** Runtime guard for a fidelity mode. Mirror of T005's `isFidelityMode`. */
export function isFidelityMode(value: unknown): value is FidelityMode {
  return typeof value === 'string' && (FIDELITY_MODES as readonly string[]).includes(value);
}

/** Runtime guard for the (currently single) information policy. */
export function isInformationPolicy(value: unknown): value is InformationPolicy {
  return value === 'point-in-time';
}

/** Runtime guard for a structurally valid, invariant-abiding clock config. */
export function isClockConfig(value: unknown): value is ClockConfig {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.now) || !isTimestampMs(value.asOf)) return false;
  if (value.now > value.asOf) return false;
  if (!isFiniteNumber(value.playbackSpeed) || value.playbackSpeed <= 0) return false;
  if (typeof value.paused !== 'boolean') return false;
  if (!isFidelityMode(value.fidelity)) return false;
  if (value.informationPolicy !== 'point-in-time') return false;
  return true;
}

// ---------------------------------------------------------------------------
// World reference + environment profile + spec (FULL exact mirrors)
// ---------------------------------------------------------------------------

/**
 * Reference to the MarketWorld an environment spec binds to. `world_id` is
 * an opaque id; `kind` is an opaque implementation hint — exact mirror of
 * T005's `WorldRef`.
 */
export interface WorldRef {
  readonly world_id: WorldId;
  readonly kind: string;
}

/** The environment profile — exact mirror of T005's `EnvironmentProfile`. */
export interface EnvironmentProfile {
  readonly environment_id: EnvironmentId;
  readonly fidelity: FidelityMode;
  readonly clock: ClockConfig;
  readonly seed: Seed;
  readonly venue_scope: readonly VenueId[];
  readonly instrument_scope: readonly InstrumentId[];
  readonly latency_policy: LatencyPolicyId | null;
  readonly fee_policy: FeePolicyId | null;
}

/** The fully-determining environment specification — exact mirror of T005's `EnvironmentSpec`. */
export interface EnvironmentSpec {
  readonly profile: EnvironmentProfile;
  readonly world: WorldRef;
  readonly information_policy: InformationPolicy;
}

/** Runtime guard for a world reference. */
export function isWorldRef(value: unknown): value is WorldRef {
  if (!isRecord(value)) return false;
  return isWorldId(value.world_id) && isNonEmptyString(value.kind);
}

/** Runtime guard for a structurally valid environment profile. */
export function isEnvironmentProfile(value: unknown): value is EnvironmentProfile {
  if (!isRecord(value)) return false;
  if (!isEnvironmentId(value.environment_id)) return false;
  if (!isFidelityMode(value.fidelity)) return false;
  if (!isClockConfig(value.clock)) return false;
  if (!isSeed(value.seed)) return false;
  if (!Array.isArray(value.venue_scope)) return false;
  if (!(value.venue_scope as readonly unknown[]).every((venue) => isVenueId(venue))) return false;
  if (!Array.isArray(value.instrument_scope)) return false;
  if (!(value.instrument_scope as readonly unknown[]).every((instrument) => isInstrumentId(instrument))) return false;
  if (value.latency_policy !== null && !isLatencyPolicyId(value.latency_policy)) return false;
  if (value.fee_policy !== null && !isFeePolicyId(value.fee_policy)) return false;
  if (value.clock.fidelity !== value.fidelity) return false;
  if ((value.venue_scope as readonly unknown[]).some((venue, index, all) => all.indexOf(venue) !== index)) return false;
  if ((value.instrument_scope as readonly unknown[]).some((instrument, index, all) => all.indexOf(instrument) !== index))
    return false;
  return true;
}

/** Runtime guard for a structurally valid environment spec. */
export function isEnvironmentSpec(value: unknown): value is EnvironmentSpec {
  if (!isRecord(value)) return false;
  if (!isEnvironmentProfile(value.profile)) return false;
  if (!isWorldRef(value.world)) return false;
  if (!isInformationPolicy(value.information_policy)) return false;
  if (value.profile.clock.informationPolicy !== value.information_policy) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted environment spec (mirror of T005's
 * `validateEnvironmentSpec`: every field violation reported with a dotted
 * path; fidelity coherence `profile.fidelity === clock.fidelity`; policy
 * coherence `spec.information_policy === clock.informationPolicy`; scope
 * uniqueness). On success the value is returned narrowed, deeply frozen.
 */
export function validateEnvironmentSpec(value: unknown, path = 'spec'): RLResult<EnvironmentSpec> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: RLError[] = [];

  let profile: EnvironmentProfile | undefined;
  if (value.profile === undefined) {
    errors.push(missingField(`${path}.profile`));
  } else {
    profile = collectProfile(value.profile, `${path}.profile`, errors);
  }

  let world: WorldRef | undefined;
  if (value.world === undefined) {
    errors.push(missingField(`${path}.world`));
  } else if (!isWorldRef(value.world)) {
    if (!isRecord(value.world)) {
      errors.push(invalidField(`${path}.world`, 'must be an object with world_id and kind'));
    } else if (!isNonEmptyString(value.world.world_id)) {
      errors.push(invalidField(`${path}.world.world_id`, 'must be a non-empty string'));
    } else {
      errors.push(invalidField(`${path}.world.kind`, 'must be a non-empty string'));
    }
  } else {
    world = value.world;
  }

  if (value.information_policy === undefined) {
    errors.push(missingField(`${path}.information_policy`));
  } else if (!isInformationPolicy(value.information_policy)) {
    errors.push(invalidField(`${path}.information_policy`, "must be 'point-in-time'"));
  }

  if (
    errors.length === 0 &&
    profile !== undefined &&
    isInformationPolicy(value.information_policy) &&
    value.information_policy !== profile.clock.informationPolicy
  ) {
    errors.push({
      code: 'invalid_field',
      path: `${path}.information_policy`,
      message: `spec.information_policy (${String(value.information_policy)}) must equal profile.clock.informationPolicy (${profile.clock.informationPolicy})`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      profile: profile as EnvironmentProfile,
      world: deepFreeze({ world_id: (world as WorldRef).world_id, kind: (world as WorldRef).kind }),
      information_policy: value.information_policy as InformationPolicy,
    }),
  );
}

/** Field-by-field profile validation (collect-all into `errors`). */
function collectProfile(value: unknown, path: string, errors: RLError[]): EnvironmentProfile | undefined {
  if (!isRecord(value)) {
    errors.push(invalidType(`${path} must be an object`));
    return undefined;
  }
  if (value.environment_id === undefined) {
    errors.push(missingField(`${path}.environment_id`));
  } else if (!isNonEmptyString(value.environment_id)) {
    errors.push(invalidField(`${path}.environment_id`, 'must be a non-empty string'));
  }
  if (value.fidelity === undefined) {
    errors.push(missingField(`${path}.fidelity`));
  } else if (!isFidelityMode(value.fidelity)) {
    errors.push(invalidField(`${path}.fidelity`, `must be one of ${FIDELITY_MODES.join(' | ')}`));
  }

  let clock: ClockConfig | undefined;
  if (value.clock === undefined) {
    errors.push(missingField(`${path}.clock`));
  } else if (!isClockConfig(value.clock)) {
    if (!isRecord(value.clock)) {
      errors.push(invalidField(`${path}.clock`, 'must be an object'));
    } else if (!isTimestampMs(value.clock.now) || !isTimestampMs(value.clock.asOf)) {
      errors.push(invalidField(`${path}.clock`, 'now and asOf must be valid TimestampMs values'));
    } else if ((value.clock.now as number) > (value.clock.asOf as number)) {
      errors.push(invalidField(`${path}.clock.now`, `now (${String(value.clock.now)}) may not exceed asOf (${String(value.clock.asOf)})`));
    } else if (!isFiniteNumber(value.clock.playbackSpeed) || value.clock.playbackSpeed <= 0) {
      errors.push(invalidField(`${path}.clock.playbackSpeed`, 'must be a positive finite number'));
    } else if (typeof value.clock.paused !== 'boolean') {
      errors.push(invalidField(`${path}.clock.paused`, 'must be a boolean'));
    } else if (!isFidelityMode(value.clock.fidelity)) {
      errors.push(invalidField(`${path}.clock.fidelity`, `must be one of ${FIDELITY_MODES.join(' | ')}`));
    } else {
      errors.push(invalidField(`${path}.clock.informationPolicy`, "must be 'point-in-time'"));
    }
  } else {
    clock = value.clock;
  }

  if (value.seed === undefined) {
    errors.push(missingField(`${path}.seed`));
  } else if (!isNonEmptyString(value.seed)) {
    errors.push(invalidField(`${path}.seed`, 'must be a non-empty string'));
  }
  collectIdScope(value.venue_scope, `${path}.venue_scope`, 'venue', errors);
  collectIdScope(value.instrument_scope, `${path}.instrument_scope`, 'instrument', errors);
  if (value.latency_policy === undefined) {
    errors.push(missingField(`${path}.latency_policy`));
  } else if (value.latency_policy !== null && !isNonEmptyString(value.latency_policy)) {
    errors.push(invalidField(`${path}.latency_policy`, 'must be a non-empty string or null'));
  }
  if (value.fee_policy === undefined) {
    errors.push(missingField(`${path}.fee_policy`));
  } else if (value.fee_policy !== null && !isNonEmptyString(value.fee_policy)) {
    errors.push(invalidField(`${path}.fee_policy`, 'must be a non-empty string or null'));
  }

  // Fidelity coherence: the profile's fidelity mode IS the clock's fidelity mode.
  if (
    errors.length === 0 &&
    clock !== undefined &&
    isFidelityMode(value.fidelity) &&
    value.fidelity !== clock.fidelity
  ) {
    errors.push({
      code: 'invalid_field',
      path: `${path}.fidelity`,
      message: `profile.fidelity (${String(value.fidelity)}) must equal profile.clock.fidelity (${clock.fidelity})`,
    });
  }

  if (errors.length > 0 || !isEnvironmentProfile(value)) return undefined;
  return value;
}

/** Collect-all validation of a venue/instrument scope array. */
function collectIdScope(value: unknown, path: string, label: string, errors: RLError[]): readonly string[] | undefined {
  if (value === undefined) {
    errors.push(missingField(path));
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push(invalidField(path, `must be an array of ${label} ids`));
    return undefined;
  }
  const scope = value as readonly unknown[];
  if (!scope.every((id) => isNonEmptyString(id))) {
    errors.push(invalidField(path, `every ${label} id must be a non-empty string`));
    return undefined;
  }
  if (scope.some((id, index) => scope.indexOf(id) !== index)) {
    errors.push(invalidField(path, `duplicate ${label} id in scope`));
    return undefined;
  }
  return scope as readonly string[];
}

// ---------------------------------------------------------------------------
// Canonical spec form (mirror of T005's canonicalSpecJson — the L9 anchor)
// ---------------------------------------------------------------------------

/** JSON-tree projection of a validated spec (compile-proven JSON safety, no casts). */
export function specTree(spec: EnvironmentSpec): JsonValue {
  return {
    profile: {
      environment_id: spec.profile.environment_id,
      fidelity: spec.profile.fidelity,
      clock: {
        now: spec.profile.clock.now,
        asOf: spec.profile.clock.asOf,
        playbackSpeed: spec.profile.clock.playbackSpeed,
        paused: spec.profile.clock.paused,
        fidelity: spec.profile.clock.fidelity,
        informationPolicy: spec.profile.clock.informationPolicy,
      },
      seed: spec.profile.seed,
      venue_scope: [...spec.profile.venue_scope],
      instrument_scope: [...spec.profile.instrument_scope],
      latency_policy: spec.profile.latency_policy,
      fee_policy: spec.profile.fee_policy,
    },
    world: { world_id: spec.world.world_id, kind: spec.world.kind },
    information_policy: spec.information_policy,
  };
}

/**
 * Canonical JSON of a validated environment spec — mirror of T005's
 * `canonicalSpecJson` (field order at construction is irrelevant; equal specs
 * produce identical bytes). The lineage anchor the environment-config ref
 * derives from (L9).
 */
export function canonicalSpecJson(spec: EnvironmentSpec): string {
  return canonicalJson(specTree(spec));
}

// ---------------------------------------------------------------------------
// The observation view (L4: the bridge sees observations ONLY through
// available_time — never around the envelope)
// ---------------------------------------------------------------------------

/**
 * The ONLY observation shape the bridge consumes. Structurally satisfied by
 * any environment-protocol-shaped observation (payload, venue, instrument
 * and provenance remain the world's business). The driver polices the
 * inclusive boundary `available_time <= at` against this view and records
 * observation refs of exactly this shape into the trajectory step log.
 */
export interface ObservationView {
  readonly observation_id: ObservationId;
  /** Earliest instant the observation may legitimately be seen (L4, inclusive). */
  readonly available_time: TimestampMs;
}

/** Runtime guard for an observation view. */
export function isObservationView(value: unknown): value is ObservationView {
  if (!isRecord(value)) return false;
  return isObservationId(value.observation_id) && isTimestampMs(value.available_time);
}

// ---------------------------------------------------------------------------
// Termination, reward envelope, episode views
// ---------------------------------------------------------------------------

/** Why an episode ended — mirror of T005's `TerminationCode` union. */
export type TerminationCode = 'completed' | 'terminal' | 'step_limit' | 'aborted';

/** Runtime-checkable list of termination codes. */
export const TERMINATION_CODES: readonly TerminationCode[] = ['completed', 'terminal', 'step_limit', 'aborted'];

/** The recorded reason an episode ended — mirror of T005's `TerminationReason`. */
export interface TerminationReason {
  readonly code: TerminationCode;
  readonly detail: string;
}

/** Runtime guard for a termination code. */
export function isTerminationCode(value: unknown): value is TerminationCode {
  return typeof value === 'string' && (TERMINATION_CODES as readonly string[]).includes(value);
}

/** Runtime guard for a termination reason. */
export function isTerminationReason(value: unknown): value is TerminationReason {
  if (!isRecord(value)) return false;
  return isTerminationCode(value.code) && isNonEmptyString(value.detail);
}

/**
 * A world-emitted reward signal envelope — mirror of T005's `RewardSignal`
 * minus `episode_id` (the trajectory metadata owns the episode binding, the
 * @tradrl/trajectory `RewardSignalRecord` discipline). The bridge READS these
 * from episode views; it never WRITES one — bridge-emitted rewards are
 * RewardModelSignals (reward.ts, L7).
 */
export interface RewardSignalEnvelope {
  readonly reward_id: RewardId;
  /** The instant the reward pertains to. */
  readonly at: TimestampMs;
  /** Earliest instant the signal may legitimately be observed (L4, inclusive; `>= at`). */
  readonly available_time: TimestampMs;
  /** Finite scalar; may be negative or zero. Never interpreted as PnL here (L7). */
  readonly value: number;
  /** Opaque metric label. */
  readonly metric: string;
  /** The world component that produced the signal (no orphan rewards). */
  readonly source: string;
  /** Optional structured detail. */
  readonly detail: JsonObject | null;
}

/** Runtime guard for a reward signal envelope. */
export function isRewardSignalEnvelope(value: unknown): value is RewardSignalEnvelope {
  if (!isRecord(value)) return false;
  if (!isRewardId(value.reward_id)) return false;
  if (!isTimestampMs(value.at) || !isTimestampMs(value.available_time)) return false;
  if (!isFiniteNumber(value.value)) return false;
  if (!isNonEmptyString(value.metric)) return false;
  if (!isNonEmptyString(value.source)) return false;
  if (value.detail !== null && !isRecord(value.detail)) return false;
  if ((value.available_time as number) < (value.at as number)) return false;
  return true;
}

/**
 * The minimal episode-state view the driver consumes (see module header).
 * The real `EpisodeState` — with its bound spec, pending set and accepted
 * action log — is structurally assignable TO this view; the bridge consumes
 * worlds, it never produces episode state. Invariants mirrored from T005's
 * `isEpisodeState`: `status === 'finished'` requires a termination reason;
 * `status === 'running'` requires none.
 */
export interface EpisodeView {
  readonly episode_id: EpisodeId;
  readonly clock: ClockConfig;
  readonly status: 'running' | 'finished';
  readonly termination: TerminationReason | null;
  /** The reward signals the world has emitted so far (optional, explicit, never fabricated). */
  readonly rewards: readonly RewardSignalEnvelope[];
}

/** Runtime guard for an episode view. */
export function isEpisodeView(value: unknown): value is EpisodeView {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.episode_id)) return false;
  if (!isClockConfig(value.clock)) return false;
  if (value.status !== 'running' && value.status !== 'finished') return false;
  if (value.status === 'finished' && !isTerminationReason(value.termination)) return false;
  if (value.status === 'running' && value.termination !== null) return false;
  if (!Array.isArray(value.rewards)) return false;
  if (!(value.rewards as readonly unknown[]).every((reward) => isRewardSignalEnvelope(reward))) return false;
  return true;
}

/**
 * The immutable result record of a finished episode — full mirror of T005's
 * `EpisodeResult` (the driver's finish product carries it so trial evidence
 * binds termination and final instants).
 */
export interface EpisodeResultView {
  readonly episode_id: EpisodeId;
  readonly environment_id: EnvironmentId;
  readonly spec: EnvironmentSpec;
  readonly termination: TerminationReason;
  readonly final_now: TimestampMs;
  readonly accepted_action_count: number;
  readonly pending_observation_count: number;
  readonly rewards: readonly RewardSignalEnvelope[];
}

/** Runtime guard for an episode result view. */
export function isEpisodeResultView(value: unknown): value is EpisodeResultView {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.episode_id)) return false;
  if (!isEnvironmentId(value.environment_id)) return false;
  if (!isEnvironmentSpec(value.spec)) return false;
  if (!isTerminationReason(value.termination)) return false;
  if (!isTimestampMs(value.final_now)) return false;
  if (typeof value.accepted_action_count !== 'number') return false;
  if (typeof value.pending_observation_count !== 'number') return false;
  if (!Array.isArray(value.rewards)) return false;
  if (!(value.rewards as readonly unknown[]).every((reward) => isRewardSignalEnvelope(reward))) return false;
  return true;
}

/** The finish product: terminal view + immutable result — mirror of T005's `EpisodeFinish`. */
export interface EpisodeFinishView {
  readonly episode: EpisodeView;
  readonly result: EpisodeResultView;
}

/** Runtime guard for an episode finish view. */
export function isEpisodeFinishView(value: unknown): value is EpisodeFinishView {
  if (!isRecord(value)) return false;
  return isEpisodeView(value.episode) && isEpisodeResultView(value.result);
}

// ---------------------------------------------------------------------------
// The Environment PORT (the injected world — the bridge ships NO world)
// ---------------------------------------------------------------------------

/**
 * A world error as the bridge sees it: the `code` vocabulary belongs to the
 * WORLD's own lane (T009/T010 name failure modes this package does not), so
 * the code is a plain string here — the same discipline
 * @tradrl/trajectory applies to rejection errors. When the driver surfaces a
 * port failure through an {@link RLResult} it maps it onto the closed
 * `environment_error` code while preserving path and message.
 */
export interface EnvironmentError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** A world operation outcome, structurally identical to T005's `EnvResult`. */
export type EnvironmentResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly EnvironmentError[] };

/**
 * The five-operation environment PORT the trainer drives (start -> observe
 * -> submit -> advance -> finish). Structurally satisfied by
 * @tradrl/environment-protocol's `Environment` (T005), T009's `WorldAdapter`
 * and `ReplayWorldService`, and T010's `ExchangeService` — proven by the
 * type-level witnesses and runtime drives in src/interop.test.ts and the
 * replay adapter tests. THE PACKAGE SHIPS NO IMPLEMENTATION: environments
 * are INJECTED (T014 distributes episode generation over them; external
 * engines own worlds).
 *
 * The port is a CONSUMER view: implementations may return richer values
 * (full episode states, full observations, receipts) — everything beyond
 * the view fields is structurally tolerated and never read by the bridge.
 */
export interface EnvironmentPort {
  /** Begin an episode for a validated spec; the world derives the episode id. */
  start(spec: EnvironmentSpec): EnvironmentResult<EpisodeView>;
  /** PURE point-in-time query: the observations visible at `at` (inclusive L4 boundary). */
  observe(episode: EpisodeId, at: TimestampMs): EnvironmentResult<readonly ObservationView[]>;
  /** Submit an action REQUEST; accepted iff valid (envelope, causality, sequence). NEVER authority (L8). */
  submit(episode: EpisodeId, action: ActionRecord): EnvironmentResult<EpisodeView>;
  /** Advance the episode clock (monotonic, `<= asOf`). */
  advance(episode: EpisodeId, to: TimestampMs): EnvironmentResult<EpisodeView>;
  /** Finish the episode; returns the terminal state and the immutable result. */
  finish(episode: EpisodeId, reason: unknown): EnvironmentResult<EpisodeFinishView>;
}

/**
 * Structural runtime guard for the EnvironmentPort surface: an object
 * carrying the five operations with function type. Worlds may guard their
 * own richer surfaces; this checks only the frozen contract.
 */
export function isEnvironmentPort(value: unknown): value is EnvironmentPort {
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

/** Map a world-port failure onto the closed bridge taxonomy (code/message preserved). */
export function environmentFailure<T>(errors: readonly EnvironmentError[]): RLResult<T> {
  if (errors.length === 0) {
    return fail('environment_error', 'the environment port failed without errors (impossible by contract)');
  }
  return {
    ok: false,
    errors: errors.map((error): RLError => ({
      code: 'environment_error',
      path: error.path,
      message: `[${error.code}] ${error.message}`,
    })),
  };
}
