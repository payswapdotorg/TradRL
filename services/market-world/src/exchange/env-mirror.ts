/**
 * @tradrl/market-world (exchange service) — STRUCTURAL MIRRORS of
 * @tradrl/environment-protocol (T005, the environment/episode protocol).
 *
 * SELF-CONTAINED BY NECESSITY (work order T010): the frozen write surface
 * permits only services/market-world/src/exchange/** — the T009 contract
 * package (packages/market-world) is merged in the Lead's integration
 * tree but NOT on this branch's GitHub main, so this module re-declares
 * the episode shapes it needs instead of importing T009's mirrors. The
 * discipline is unchanged (D-003/D-004): everything T005 declares that an
 * exchange episode must satisfy — the environment spec/profile, the
 * observation and action envelopes, the termination taxonomy, the episode
 * state/result shapes, the canonical spec JSON and the deterministic
 * episode-id derivation — is re-declared here with identical structure.
 * Any change in @tradrl/environment-protocol MUST be mirrored here and
 * vice versa.
 *
 * THE FIREWALL LAW THESE MIRRORS CARRY (L4):
 *
 *     An observation is visible at instant `at` iff
 *     `observation.available_time <= at`    (INCLUSIVE).
 *
 * The ExchangeService's outputs satisfy these shapes STRUCTURALLY: an
 * `ExchangeEpisodeView` is assignable to `EpisodeStateMirror`, an
 * `ExchangeObservation` to `ObservationMirror` (compile-time witnesses in
 * this module's tests), and environment-protocol's own runtime guards
 * accept the service's values — proven by interop.test.ts, which loads
 * the REAL package when present (T005 is merged in the Lead's tree).
 */

import { deepFreeze, isFiniteNumber, isNonEmptyString, isNonNegativeSafeInteger, isRecord } from '../../../../packages/exchange-sim/src/index';
import { isTimestampMs, type TimestampMs } from '../../../../packages/exchange-sim/src/index';

// ---------------------------------------------------------------------------
// Termination taxonomy (mirror of environment-protocol episode.ts)
// ---------------------------------------------------------------------------

/**
 * Why an episode ended:
 * - `completed` — natural end (the clock reached `asOf` or the world's
 *   declared horizon).
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
// Clock mirror (canonical owner: @tradrl/time-engine)
// ---------------------------------------------------------------------------

/** The three distinct world-fidelity modes (L5). Mirror of time-engine. */
export type FidelityMode = 'exact_replay' | 'reactive_replay' | 'generative';

/** Runtime-checkable list of fidelity modes. */
export const FIDELITY_MODES: readonly FidelityMode[] = ['exact_replay', 'reactive_replay', 'generative'];

/** The information policy in force (single variant: the boundary IS the law, L4). */
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
  if (value.now > value.asOf) return false;
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

/** The environment profile (mirror of T005's EnvironmentProfile). */
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

/** A single typed validation error (field-shape mirror of the sibling lanes). */
export interface EnvMirrorError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** A mirror-flavored validation result. */
export type EnvMirrorResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly EnvMirrorError[] };

/**
 * Validate an untrusted environment spec (collect-all, mirroring T005's
 * `validateEnvironmentSpec` field-for-field). On success the value is
 * returned narrowed, deeply frozen.
 */
export function validateEnvironmentSpec(value: unknown): EnvMirrorResult<EnvironmentSpec> {
  if (!isRecord(value)) {
    return { ok: false, errors: [{ code: 'invalid_type', path: 'spec', message: 'spec must be an object' }] };
  }
  const errors: EnvMirrorError[] = [];

  let profile: EnvironmentProfile | undefined;
  if (value.profile === undefined) {
    errors.push({ code: 'missing_field', path: 'spec.profile', message: 'required field "spec.profile" is missing' });
  } else if (!isEnvironmentProfile(value.profile)) {
    if (!isRecord(value.profile)) {
      errors.push({ code: 'invalid_type', path: 'spec.profile', message: 'spec.profile must be an object' });
    } else {
      const candidate = value.profile;
      if (candidate.environment_id === undefined) errors.push({ code: 'missing_field', path: 'spec.profile.environment_id', message: 'required field is missing' });
      else if (!isNonEmptyString(candidate.environment_id)) errors.push({ code: 'invalid_field', path: 'spec.profile.environment_id', message: 'must be a non-empty string' });
      if (candidate.fidelity === undefined) errors.push({ code: 'missing_field', path: 'spec.profile.fidelity', message: 'required field is missing' });
      else if (!isFidelityMode(candidate.fidelity)) errors.push({ code: 'invalid_field', path: 'spec.profile.fidelity', message: `must be one of ${FIDELITY_MODES.join(' | ')}` });
      if (candidate.clock === undefined) errors.push({ code: 'missing_field', path: 'spec.profile.clock', message: 'required field is missing' });
      else if (!isClockState(candidate.clock)) errors.push({ code: 'invalid_field', path: 'spec.profile.clock', message: 'must be a structurally valid clock (now <= asOf, positive speed, fidelity, point-in-time policy)' });
      if (candidate.seed === undefined) errors.push({ code: 'missing_field', path: 'spec.profile.seed', message: 'required field is missing' });
      else if (!isNonEmptyString(candidate.seed)) errors.push({ code: 'invalid_field', path: 'spec.profile.seed', message: 'must be a non-empty string' });
      if (candidate.venue_scope !== undefined && !Array.isArray(candidate.venue_scope)) {
        errors.push({ code: 'invalid_field', path: 'spec.profile.venue_scope', message: 'must be an array of venue ids' });
      }
      if (candidate.instrument_scope !== undefined && !Array.isArray(candidate.instrument_scope)) {
        errors.push({ code: 'invalid_field', path: 'spec.profile.instrument_scope', message: 'must be an array of instrument ids' });
      }
    }
  } else {
    profile = value.profile;
  }

  let world: WorldRef | undefined;
  if (value.world === undefined) {
    errors.push({ code: 'missing_field', path: 'spec.world', message: 'required field "spec.world" is missing' });
  } else if (!isWorldRef(value.world)) {
    errors.push({ code: 'invalid_field', path: 'spec.world', message: 'must be an object with world_id and kind' });
  } else {
    world = value.world;
  }

  if (value.information_policy === undefined) {
    errors.push({ code: 'missing_field', path: 'spec.information_policy', message: 'required field "spec.information_policy" is missing' });
  } else if (!isInformationPolicy(value.information_policy)) {
    errors.push({ code: 'invalid_field', path: 'spec.information_policy', message: "must be 'point-in-time'" });
  }

  // Coherence: the spec's policy IS the clock's policy (checked inside
  // isEnvironmentProfile for fidelity; re-stated here for a precise error).
  if (
    errors.length === 0 &&
    profile !== undefined &&
    isInformationPolicy(value.information_policy) &&
    value.information_policy !== profile.clock.informationPolicy
  ) {
    errors.push({
      code: 'invalid_field',
      path: 'spec.information_policy',
      message: 'spec.information_policy must equal profile.clock.informationPolicy',
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: deepFreeze({
      profile: profile as EnvironmentProfile,
      world: deepFreeze({ world_id: (world as WorldRef).world_id, kind: (world as WorldRef).kind }),
      information_policy: value.information_policy as InformationPolicy,
    }),
  };
}

// ---------------------------------------------------------------------------
// Canonical serialization + deterministic episode ids (mirror of T005)
// ---------------------------------------------------------------------------

/** Recursive JSON value model (mirror). */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Canonical JSON serialization: object keys recursively sorted. Mirror of T005. */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  const record = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** FNV-1a 32-bit hash of a string, as zero-padded lowercase hex. Mirror of T005. */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

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
  return canonicalJson(tree);
}

/**
 * Derive the episode id of a spec deterministically:
 * `ep-<fnv1a32(canonicalSpecJson(spec))>`. MIRRORS environment-protocol's
 * derivation exactly — the same spec yields the same episode id in both
 * lanes, so trajectories (T011) and workers (T014) can join on it.
 */
export function deriveEpisodeId(spec: EnvironmentSpec): string {
  return `ep-${fnv1a32Hex(canonicalSpecJson(spec))}`;
}

// ---------------------------------------------------------------------------
// Observation envelope + provenance (mirror of T005)
// ---------------------------------------------------------------------------

/** Where an observation came from. The syntheticity discriminator (L5). */
export type ObservationOrigin = 'historical' | 'simulated' | 'generated';

/** Provenance summary carried by every observation (mirror of T005's ObservationProvenance). */
export interface ObservationProvenance {
  readonly origin: ObservationOrigin;
  readonly source: string | null;
  readonly derived_from: readonly string[];
}

/** Runtime guard for the observation origin discriminator. */
export function isObservationOrigin(value: unknown): value is ObservationOrigin {
  return typeof value === 'string' && (['historical', 'simulated', 'generated'] as readonly string[]).includes(value);
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

/** The observation envelope (mirror of T005's Observation). */
export interface ObservationMirror {
  readonly observation_id: string;
  readonly available_time: TimestampMs;
  readonly venue: string | null;
  readonly instrument: string | null;
  readonly payload: JsonValue;
  readonly provenance: ObservationProvenance;
}

/** Runtime guard for a structurally valid observation envelope. */
export function isObservationMirror(value: unknown): value is ObservationMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.observation_id)) return false;
  if (!isTimestampMs(value.available_time)) return false;
  if (value.venue !== null && !isNonEmptyString(value.venue)) return false;
  if (value.instrument !== null && !isNonEmptyString(value.instrument)) return false;
  if (!isJsonValue(value.payload)) return false;
  if (!isObservationProvenance(value.provenance)) return false;
  return true;
}

/** JSON value guard (local mirror). */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((element) => isJsonValue(element));
  if (typeof value === 'object') {
    return Object.values(value).every((element) => isJsonValue(element));
  }
  return false;
}

/** JSON object guard (local mirror): narrows to the object branch of {@link JsonValue}. */
export function isJsonObject(value: unknown): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Action envelope (mirror of T005)
// ---------------------------------------------------------------------------

/** The action request envelope (mirror of T005's Action). A REQUEST, never a command (L8). */
export interface ActionMirror {
  readonly action_id: string;
  readonly actor: string;
  readonly submitted_at: TimestampMs;
  readonly client_sequence: number;
  readonly payload: JsonValue;
}

/** Runtime guard for a structurally valid action envelope. */
export function isActionMirror(value: unknown): value is ActionMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.action_id)) return false;
  if (!isNonEmptyString(value.actor)) return false;
  if (!isTimestampMs(value.submitted_at)) return false;
  if (!isNonNegativeSafeInteger(value.client_sequence)) return false;
  if (!isJsonValue(value.payload)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Reward signal (mirror of T005 — the exchange world emits NONE)
// ---------------------------------------------------------------------------

/** An explicit reward signal (mirror of T005's RewardSignal). The exchange emits exactly zero (L7). */
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
  readonly pending: readonly ObservationMirror[];
  readonly accepted_actions: readonly ActionMirror[];
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
  if (!Array.isArray(value.pending) || !value.pending.every((observation) => isObservationMirror(observation))) return false;
  if (!Array.isArray(value.accepted_actions) || !value.accepted_actions.every((action) => isActionMirror(action))) return false;
  if (!Array.isArray(value.rewards) || !value.rewards.every(isRewardSignalShape)) return false;
  return true;
}

/** Structural reward-signal check (the exchange emits none; the shape stays mirrored). */
function isRewardSignalShape(value: unknown): value is RewardSignalMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.reward_id)) return false;
  if (!isNonEmptyString(value.episode_id)) return false;
  if (!isTimestampMs(value.at) || !isTimestampMs(value.available_time)) return false;
  if (!isFiniteNumber(value.value)) return false;
  if (!isNonEmptyString(value.metric) || !isNonEmptyString(value.source)) return false;
  return true;
}
