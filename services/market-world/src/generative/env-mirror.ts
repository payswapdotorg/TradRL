/**
 * @tradrl/market-world (generative service) — STRUCTURAL MIRRORS of
 * @tradrl/environment-protocol (T005) and @tradrl/time-engine's clock (work
 * order T028).
 *
 * D-003/D-004 (the law this Work Order operates under): the frozen write
 * surface (`services/market-world/src/generative/**` only) forbids imports
 * across lanes, so every T005 shape the generative world exchanges with its
 * drivers — the environment spec/profile, the observation and action
 * envelopes, the termination taxonomy, the episode state/result/finish
 * shapes, the canonical spec JSON and the deterministic episode-id
 * derivation — is re-declared here field-for-field. Any change in
 * @tradrl/environment-protocol MUST be mirrored here and vice versa;
 * src/interop.test.ts is the trip wire against the REAL package (present
 * on this branch).
 *
 * THE FIREWALL LAW THESE MIRRORS CARRY (L4, ARCHITECTURE-LOCK):
 *
 *     An observation is visible at instant `at` iff
 *     `observation.available_time <= at`    (INCLUSIVE).
 *
 * THE FIDELITY LAW THIS LANE ADDS (L5, the generative existential law):
 * the third distinct fidelity class. A generative world's spec MUST
 * declare `fidelity === 'generative'` — the service rejects any other
 * claim with `fidelity_claim_dishonest` (exact != reactive != generative,
 * never conflated). The observation-origin trichotomy is honored the
 * generative way: this lane's outputs are `generated` (declared processes)
 * or `simulated` (engine outcomes) — a `historical` origin is
 * inexpressible in this lane's outputs (records.ts enforces it as a typed
 * error; there is no recorded stream to be historical ABOUT).
 */

import { deepFreeze, isFiniteNumber, isNonEmptyString, isNonNegativeSafeInteger, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type GenerativeError, type GenerativeResult } from './errors';
import { isTimestampMs, type TimestampMs } from './ids';
import type { JsonValue } from './primitives';
import { isJsonValue } from './primitives';
import { fnv1a32Hex } from './primitives';

// ---------------------------------------------------------------------------
// Termination taxonomy (mirror of environment-protocol episode.ts)
// ---------------------------------------------------------------------------

/**
 * Why an episode ended:
 * - `completed` — natural end (the clock reached `asOf` or the horizon).
 * - `terminal` — the world reached a terminal state.
 * - `step_limit` — the driving runtime exhausted its step budget.
 * - `aborted` — an external operator/runtime abort.
 */
export type TerminationCode = 'completed' | 'terminal' | 'step_limit' | 'aborted';

/** Runtime-checkable list of termination codes. Mirror of environment-protocol. */
export const TERMINATION_CODES: readonly TerminationCode[] = ['completed', 'terminal', 'step_limit', 'aborted'];

/** The recorded reason an episode ended. Mirror of environment-protocol. */
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

// ---------------------------------------------------------------------------
// Clock mirror (canonical owner: @tradrl/time-engine; shape owner: T005)
// ---------------------------------------------------------------------------

/** The three distinct world-fidelity modes (L5 — never conflated). */
export type FidelityMode = 'exact_replay' | 'reactive_replay' | 'generative';

/** Runtime-checkable list of fidelity modes. */
export const FIDELITY_MODES: readonly FidelityMode[] = ['exact_replay', 'reactive_replay', 'generative'];

/**
 * The information policy in force. Single variant by design: the boundary
 * IS the law (L4), not a dial.
 */
export type InformationPolicy = 'point-in-time';

/** Runtime guard for a fidelity mode. */
export function isFidelityMode(value: unknown): value is FidelityMode {
  return typeof value === 'string' && (FIDELITY_MODES as readonly string[]).includes(value);
}

/** Runtime guard for the information policy. */
export function isInformationPolicy(value: unknown): value is InformationPolicy {
  return value === 'point-in-time';
}

/**
 * The clock state of an episode — a structural mirror of time-engine's
 * `SimulationClock` (and environment-protocol's `ClockConfig`).
 */
export interface ClockState {
  readonly now: TimestampMs;
  readonly asOf: TimestampMs;
  readonly playbackSpeed: number;
  readonly paused: boolean;
  readonly fidelity: FidelityMode;
  readonly informationPolicy: InformationPolicy;
}

/** Runtime guard for a structurally valid clock state. */
export function isClockState(value: unknown): value is ClockState {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.now) || !isTimestampMs(value.asOf)) return false;
  if ((value.now as number) > (value.asOf as number)) return false;
  if (!isFiniteNumber(value.playbackSpeed) || value.playbackSpeed <= 0) return false;
  if (typeof value.paused !== 'boolean') return false;
  if (!isFidelityMode(value.fidelity)) return false;
  if (value.informationPolicy !== 'point-in-time') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Environment spec / profile (mirror of T005 spec.ts + profile.ts)
// ---------------------------------------------------------------------------

/** Reference to the MarketWorld an environment spec binds to. Mirror of T005's WorldRef. */
export interface WorldRef {
  readonly world_id: string;
  readonly kind: string;
}

/** Runtime guard for a world reference. */
export function isWorldRef(value: unknown): value is WorldRef {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.world_id) && isNonEmptyString(value.kind);
}

/**
 * The environment profile (mirror of T005's EnvironmentProfile). The
 * generative world additionally REQUIRES `fidelity === 'generative'`
 * (the L5 mode honesty — enforced at start, not in the shape).
 */
export interface EnvironmentProfile {
  readonly environment_id: string;
  readonly fidelity: FidelityMode;
  readonly clock: ClockState;
  readonly seed: string;
  readonly venue_scope: readonly string[];
  readonly instrument_scope: readonly string[];
  readonly latency_policy: string | null;
  readonly fee_policy: string | null;
}

/** Runtime guard for a structurally valid environment profile. */
export function isEnvironmentProfile(value: unknown): value is EnvironmentProfile {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.environment_id)) return false;
  if (!isFidelityMode(value.fidelity)) return false;
  if (!isClockState(value.clock)) return false;
  if (!isNonEmptyString(value.seed)) return false;
  if (!Array.isArray(value.venue_scope)) return false;
  if (!(value.venue_scope as readonly unknown[]).every((venue) => isNonEmptyString(venue))) return false;
  if (!Array.isArray(value.instrument_scope)) return false;
  if (!(value.instrument_scope as readonly unknown[]).every((instrument) => isNonEmptyString(instrument))) return false;
  if (value.latency_policy !== null && !isNonEmptyString(value.latency_policy)) return false;
  if (value.fee_policy !== null && !isNonEmptyString(value.fee_policy)) return false;
  if (value.clock.fidelity !== value.fidelity) return false;
  const venueScope = value.venue_scope as readonly string[];
  if (venueScope.some((venue, index) => venueScope.indexOf(venue) !== index)) return false;
  const instrumentScope = value.instrument_scope as readonly string[];
  if (instrumentScope.some((instrument, index) => instrumentScope.indexOf(instrument) !== index)) return false;
  return true;
}

/** The fully-determining environment specification (mirror of T005's EnvironmentSpec). */
export interface EnvironmentSpec {
  readonly profile: EnvironmentProfile;
  readonly world: WorldRef;
  readonly information_policy: InformationPolicy;
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
 * Collect-all validation of an untrusted environment spec (mirroring T005's
 * `validateEnvironmentSpec` field-for-field). On success the value is
 * returned narrowed, deeply frozen.
 */
export function validateEnvironmentSpec(value: unknown, path = 'spec'): GenerativeResult<EnvironmentSpec> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path}`, `${path} must be an object`)] };
  }
  const errors: GenerativeError[] = [];

  let profile: EnvironmentProfile | undefined;
  if (value.profile === undefined) {
    errors.push(missingField(`${path}.profile`));
  } else if (!isEnvironmentProfile(value.profile)) {
    if (!isRecord(value.profile)) {
      errors.push(invalidType(`${path}.profile`, `${path}.profile must be an object`));
    } else {
      const candidate = value.profile;
      if (candidate.environment_id === undefined) errors.push(missingField(`${path}.profile.environment_id`));
      else if (!isNonEmptyString(candidate.environment_id)) errors.push(invalidField(`${path}.profile.environment_id`, 'must be a non-empty string'));
      if (candidate.fidelity === undefined) errors.push(missingField(`${path}.profile.fidelity`));
      else if (!isFidelityMode(candidate.fidelity)) errors.push(invalidField(`${path}.profile.fidelity`, `must be one of ${FIDELITY_MODES.join(' | ')}`));
      if (candidate.clock === undefined) errors.push(missingField(`${path}.profile.clock`));
      else if (!isClockState(candidate.clock)) errors.push(invalidField(`${path}.profile.clock`, 'must be a structurally valid clock (now <= asOf, positive speed, fidelity, point-in-time policy)'));
      if (candidate.seed === undefined) errors.push(missingField(`${path}.profile.seed`));
      else if (!isNonEmptyString(candidate.seed)) errors.push(invalidField(`${path}.profile.seed`, 'must be a non-empty string'));
      if (candidate.venue_scope !== undefined && !Array.isArray(candidate.venue_scope)) {
        errors.push(invalidField(`${path}.profile.venue_scope`, 'must be an array of venue ids'));
      }
      if (candidate.instrument_scope !== undefined && !Array.isArray(candidate.instrument_scope)) {
        errors.push(invalidField(`${path}.profile.instrument_scope`, 'must be an array of instrument ids'));
      }
      if (candidate.latency_policy === undefined) errors.push(missingField(`${path}.profile.latency_policy`));
      else if (candidate.latency_policy !== null && !isNonEmptyString(candidate.latency_policy)) errors.push(invalidField(`${path}.profile.latency_policy`, 'must be a non-empty string or null'));
      if (candidate.fee_policy === undefined) errors.push(missingField(`${path}.profile.fee_policy`));
      else if (candidate.fee_policy !== null && !isNonEmptyString(candidate.fee_policy)) errors.push(invalidField(`${path}.profile.fee_policy`, 'must be a non-empty string or null'));
    }
  } else {
    profile = value.profile;
  }

  let world: WorldRef | undefined;
  if (value.world === undefined) {
    errors.push(missingField(`${path}.world`));
  } else if (!isWorldRef(value.world)) {
    errors.push(invalidField(`${path}.world`, 'must be an object with world_id and kind'));
  } else {
    world = value.world;
  }

  if (value.information_policy === undefined) {
    errors.push(missingField(`${path}.information_policy`));
  } else if (!isInformationPolicy(value.information_policy)) {
    errors.push(invalidField(`${path}.information_policy`, "must be 'point-in-time'"));
  }

  // Coherence: the spec's policy IS the clock's policy.
  if (
    errors.length === 0 &&
    profile !== undefined &&
    isInformationPolicy(value.information_policy) &&
    value.information_policy !== profile.clock.informationPolicy
  ) {
    errors.push(invalidField(`${path}.information_policy`, 'spec.information_policy must equal profile.clock.informationPolicy'));
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

// ---------------------------------------------------------------------------
// Canonical serialization + deterministic episode ids (mirror of T005)
// ---------------------------------------------------------------------------

/** Canonical JSON of a validated environment spec — the lineage anchor (L9). Mirrors T005. */
export function canonicalSpecJson(spec: EnvironmentSpec): string {
  const tree: JsonValue = {
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
  return canonicalJsonOf(tree);
}

/** Local alias so the canonical serializer stays single-sourced. */
import { canonicalJson as canonicalJsonOf } from './primitives';

/**
 * Derive the episode id of a spec deterministically:
 * `ep-<fnv1a32(canonicalSpecJson(spec))>`. MIRRORS environment-protocol's
 * derivation exactly — the same spec yields the same episode id in both
 * lanes, so trajectories (T011) and the trainer bridge (T013) join on it.
 */
export function deriveEpisodeId(spec: EnvironmentSpec): string {
  return `ep-${fnv1a32Hex(canonicalSpecJson(spec))}`;
}

// ---------------------------------------------------------------------------
// Observation envelope + provenance (mirror of T005)
// ---------------------------------------------------------------------------

/**
 * Where an observation came from. The syntheticity discriminator (L5).
 * The generative lane emits `generated` (declared processes) and
 * `simulated` (engine outcomes) — NEVER `historical` (there is no
 * recorded stream; a historical claim is a typed error in records.ts).
 */
export type ObservationOrigin = 'historical' | 'simulated' | 'generated';

/** Runtime guard for the observation origin discriminator. */
export function isObservationOrigin(value: unknown): value is ObservationOrigin {
  return typeof value === 'string' && (['historical', 'simulated', 'generated'] as readonly string[]).includes(value);
}

/** Provenance summary carried by every observation (mirror of T005's ObservationProvenance). */
export interface ObservationProvenance {
  readonly origin: ObservationOrigin;
  readonly source: string | null;
  readonly derived_from: readonly string[];
}

/** Runtime guard for an observation provenance summary. */
export function isObservationProvenance(value: unknown): value is ObservationProvenance {
  if (!isRecord(value)) return false;
  if (!isObservationOrigin(value.origin)) return false;
  if (value.source !== null && !isNonEmptyString(value.source)) return false;
  if (!Array.isArray(value.derived_from)) return false;
  if (!value.derived_from.every((parent) => isNonEmptyString(parent))) return false;
  if (value.origin === 'historical' && value.source === null) return false;
  return true;
}

/**
 * The observation envelope (mirror of T005's Observation). The generative
 * world's `GenerativeObservation` extends this with the run ref and the
 * tenant/project scope (L9/L12) — forward-compatible extra fields, exactly
 * like the sibling lanes' observations.
 */
export interface ObservationEnvelope {
  readonly observation_id: string;
  readonly available_time: TimestampMs;
  readonly venue: string | null;
  readonly instrument: string | null;
  readonly payload: JsonValue;
  readonly provenance: ObservationProvenance;
}

/** Runtime guard for a structurally valid observation envelope. */
export function isObservationEnvelope(value: unknown): value is ObservationEnvelope {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.observation_id)) return false;
  if (!isTimestampMs(value.available_time)) return false;
  if (value.venue !== null && !isNonEmptyString(value.venue)) return false;
  if (value.instrument !== null && !isNonEmptyString(value.instrument)) return false;
  if (!isJsonValue(value.payload)) return false;
  if (!isObservationProvenance(value.provenance)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Action envelope (mirror of T005 — a REQUEST, never a command, L8)
// ---------------------------------------------------------------------------

/** The action request envelope (mirror of T005's Action). */
export interface ActionEnvelope {
  readonly action_id: string;
  readonly actor: string;
  readonly submitted_at: TimestampMs;
  readonly client_sequence: number;
  readonly payload: JsonValue;
}

/** Runtime guard for a structurally valid action envelope. */
export function isActionEnvelope(value: unknown): value is ActionEnvelope {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.action_id)) return false;
  if (!isNonEmptyString(value.actor)) return false;
  if (!isTimestampMs(value.submitted_at)) return false;
  if (!isNonNegativeSafeInteger(value.client_sequence)) return false;
  if (!isJsonValue(value.payload)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Reward signal (mirror of T005 — the generative world emits NONE, L7)
// ---------------------------------------------------------------------------

/** An explicit reward signal shape (mirror of T005's RewardSignal). The generative world emits exactly zero (L7). */
export interface RewardSignalMirror {
  readonly reward_id: string;
  readonly episode_id: string;
  readonly at: TimestampMs;
  readonly available_time: TimestampMs;
  readonly value: number;
  readonly metric: string;
  readonly source: string;
  readonly detail: { readonly [key: string]: JsonValue } | null;
}

// ---------------------------------------------------------------------------
// Episode state / result / finish shapes (mirror of T005)
// ---------------------------------------------------------------------------

/** Episode lifecycle status. Mirror of environment-protocol. */
export type EpisodeStatus = 'running' | 'finished';

/** The episode state shape (mirror of T005's EpisodeState). */
export interface EpisodeStateMirror {
  readonly episode_id: string;
  readonly spec: EnvironmentSpec;
  readonly clock: ClockState;
  readonly status: EpisodeStatus;
  readonly termination: TerminationReason | null;
  readonly pending: readonly ObservationEnvelope[];
  readonly accepted_actions: readonly ActionEnvelope[];
  readonly rewards: readonly RewardSignalMirror[];
}

/** The immutable summary of a finished episode (mirror of T005's EpisodeResult). */
export interface EpisodeResultMirror {
  readonly episode_id: string;
  readonly environment_id: string;
  readonly spec: EnvironmentSpec;
  readonly termination: TerminationReason;
  readonly final_now: TimestampMs;
  readonly accepted_action_count: number;
  readonly pending_observation_count: number;
  readonly rewards: readonly RewardSignalMirror[];
}

/** The terminal transition product (mirror of T005's EpisodeFinish). */
export interface EpisodeFinishMirror {
  readonly episode: EpisodeStateMirror;
  readonly result: EpisodeResultMirror;
}

/** Runtime guard for an episode-state-shaped value. */
export function isEpisodeStateMirror(value: unknown): value is EpisodeStateMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.episode_id)) return false;
  if (!isEnvironmentSpec(value.spec)) return false;
  if (!isClockState(value.clock)) return false;
  if (value.status !== 'running' && value.status !== 'finished') return false;
  if (value.status === 'finished' && !isTerminationReason(value.termination)) return false;
  if (value.status === 'running' && value.termination !== null) return false;
  if (!Array.isArray(value.pending) || !value.pending.every((observation) => isObservationEnvelope(observation))) return false;
  if (!Array.isArray(value.accepted_actions) || !value.accepted_actions.every((action) => isActionEnvelope(action))) return false;
  if (!Array.isArray(value.rewards) || !value.rewards.every(isRewardSignalShape)) return false;
  return true;
}

/** Structural reward-signal check (the generative world emits none; the shape stays mirrored). */
function isRewardSignalShape(value: unknown): value is RewardSignalMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.reward_id)) return false;
  if (!isNonEmptyString(value.episode_id)) return false;
  if (!isTimestampMs(value.at) || !isTimestampMs(value.available_time)) return false;
  if (!isFiniteNumber(value.value)) return false;
  if (!isNonEmptyString(value.metric) || !isNonEmptyString(value.source)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The five-operation Environment surface (mirror of T005's Environment)
// ---------------------------------------------------------------------------

/**
 * The mediating contract between an agent runtime and a MarketWorld under a
 * simulation clock — structural mirror of environment-protocol's
 * `Environment` and (consumer-side) rl-protocol's `EnvironmentPort`. The
 * GenerativeWorldService satisfies this surface directly; src/adapter.ts
 * adds the trainer-facing narrowing.
 */
export interface EnvironmentSurface {
  start(spec: unknown): GenerativeResult<EpisodeStateMirror>;
  observe(episode: string, at: TimestampMs): GenerativeResult<readonly ObservationEnvelope[]>;
  submit(episode: string, action: unknown): GenerativeResult<EpisodeStateMirror>;
  advance(episode: string, to: TimestampMs): GenerativeResult<EpisodeStateMirror>;
  finish(episode: string, reason: unknown): GenerativeResult<EpisodeFinishMirror>;
}

/** Structural runtime guard for the five-operation surface (mirror of isEnvironment). */
export function isEnvironmentSurface(value: unknown): value is EnvironmentSurface {
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
