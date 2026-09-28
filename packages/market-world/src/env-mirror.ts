/**
 * @tradrl/market-world — STRUCTURAL MIRRORS of @tradrl/environment-protocol
 * (T005, the environment/episode protocol).
 *
 * THE FIREWALL LAW THESE MIRRORS CARRY (L4):
 *
 *     An observation is visible at instant `at` iff
 *     `observation.available_time <= at`    (INCLUSIVE).
 *
 * The WorldAdapter's outputs satisfy these shapes STRUCTURALLY: TypeScript's
 * structural typing makes a `ReplayEpisodeView` assignable to
 * {@link EpisodeStateMirror} and a `WorldObservation` assignable to
 * {@link ObservationMirror} (compile-time witnesses live in this package's
 * tests), and environment-protocol's own runtime guards (`isEnvironment`,
 * `isObservation`, `isEpisodeState`, `isEpisodeFinish`) accept the adapter's
 * values — proven by `src/interop.test.ts`, which loads the REAL package
 * when it is present on the integration tree (T005 is merged in the Lead's
 * tree; at this branch's base SHA it is not yet on GitHub main).
 *
 * Mirror discipline (D-003/D-004): contract packages never import each
 * other. Everything T005 declares that a replay world must satisfy — the
 * environment spec/profile, the observation and action envelopes, the
 * termination taxonomy, the episode state/result shapes, the canonical spec
 * JSON and the deterministic episode-id derivation — is re-declared here
 * with identical structure. Any change in @tradrl/environment-protocol MUST
 * be mirrored here and vice versa.
 */

import { deepFreeze, isFiniteNumber, isNonEmptyString, isNonNegativeSafeInteger, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type WorldError, type WorldResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { JsonObject, JsonValue } from './json';
import type {
  ActionId,
  AgentInstanceId,
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
import { isEnvironmentId, isEpisodeId, isFeePolicyId, isInstrumentId, isLatencyPolicyId, isSeed, isVenueId, isWorldId } from './ids';
import type { ClockState, FidelityMode, InformationPolicy } from './clock';
import { isClockState, isFidelityMode, isInformationPolicy, validateClockState } from './clock';
import { isJsonObject } from './json';

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

/** Validate an untrusted termination reason. */
export function validateTerminationReason(value: unknown, path = 'termination'): WorldResult<TerminationReason> {
  if (!isTerminationReason(value)) {
    return {
      ok: false,
      errors: [
        invalidField(path, `must be one of ${TERMINATION_CODES.join(' | ')} with a non-empty detail`),
      ],
    };
  }
  return ok(deepFreeze({ code: value.code, detail: value.detail }));
}

// ---------------------------------------------------------------------------
// World reference + environment profile + environment spec (mirror of T005)
// ---------------------------------------------------------------------------

/**
 * Reference to the MarketWorld an environment spec binds to. `world_id` is
 * an opaque id (world registry/dataset identity — owned by THIS lane);
 * `kind` is an opaque implementation hint (e.g. 'replay', 'exchange-sim').
 * Mirror of environment-protocol's WorldRef.
 */
export interface WorldRef {
  readonly world_id: WorldId;
  readonly kind: string;
}

/** Runtime guard for a world reference. */
export function isWorldRef(value: unknown): value is WorldRef {
  if (!isRecord(value)) return false;
  return isWorldId(value.world_id) && isNonEmptyString(value.kind);
}

/**
 * The environment profile (mirror of environment-protocol's
 * EnvironmentProfile — the shape a Possession references by opaque id):
 * fidelity (L5), initial clock, seed, observation universe (opaque venue /
 * instrument scopes; empty scope = no filtering), and opaque exchange-policy
 * references owned by T010 (`null` for pure replay worlds).
 */
export interface EnvironmentProfile {
  readonly environment_id: EnvironmentId;
  readonly fidelity: FidelityMode;
  readonly clock: ClockState;
  readonly seed: Seed;
  readonly venue_scope: readonly VenueId[];
  readonly instrument_scope: readonly InstrumentId[];
  readonly latency_policy: LatencyPolicyId | null;
  readonly fee_policy: FeePolicyId | null;
}

/** Runtime guard for a structurally valid environment profile. */
export function isEnvironmentProfile(value: unknown): value is EnvironmentProfile {
  if (!isRecord(value)) return false;
  if (!isEnvironmentId(value.environment_id)) return false;
  if (!isFidelityMode(value.fidelity)) return false;
  if (!isClockState(value.clock)) return false;
  if (!isSeed(value.seed)) return false;
  if (!Array.isArray(value.venue_scope)) return false;
  const venueScope = value.venue_scope as readonly unknown[];
  if (!venueScope.every((venue) => isVenueId(venue))) return false;
  if (!Array.isArray(value.instrument_scope)) return false;
  const instrumentScope = value.instrument_scope as readonly unknown[];
  if (!instrumentScope.every((instrument) => isInstrumentId(instrument))) return false;
  if (value.latency_policy !== null && !isLatencyPolicyId(value.latency_policy)) return false;
  if (value.fee_policy !== null && !isFeePolicyId(value.fee_policy)) return false;
  if (value.clock.fidelity !== value.fidelity) return false;
  if (venueScope.some((venue, index) => venueScope.indexOf(venue) !== index)) return false;
  if (instrumentScope.some((instrument, index) => instrumentScope.indexOf(instrument) !== index)) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted environment profile. Enforces the
 * fidelity coherence rule (`profile.fidelity === profile.clock.fidelity`)
 * and scope uniqueness. Mirrors environment-protocol's
 * `validateEnvironmentProfile` field-for-field.
 */
export function validateEnvironmentProfile(value: unknown, path = 'profile'): WorldResult<EnvironmentProfile> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: WorldError[] = [];

  if (value.environment_id === undefined) {
    errors.push(missingField(`${path}.environment_id`));
  } else if (!isNonEmptyString(value.environment_id)) {
    errors.push(invalidField(`${path}.environment_id`, 'must be a non-empty string'));
  }

  if (value.fidelity === undefined) {
    errors.push(missingField(`${path}.fidelity`));
  } else if (!isFidelityMode(value.fidelity)) {
    errors.push(invalidField(`${path}.fidelity`, `must be one of ${'exact_replay | reactive_replay | generative'}`));
  }

  let clock: ClockState | undefined;
  if (value.clock === undefined) {
    errors.push(missingField(`${path}.clock`));
  } else {
    const clockResult = validateClockState(value.clock, `${path}.clock`);
    if (clockResult.ok) {
      clock = clockResult.value;
    } else {
      errors.push(...clockResult.errors);
    }
  }

  if (value.seed === undefined) {
    errors.push(missingField(`${path}.seed`));
  } else if (!isNonEmptyString(value.seed)) {
    errors.push(invalidField(`${path}.seed`, 'must be a non-empty string'));
  }

  if (value.venue_scope === undefined) {
    errors.push(missingField(`${path}.venue_scope`));
  } else if (!Array.isArray(value.venue_scope)) {
    errors.push(invalidField(`${path}.venue_scope`, 'must be an array of venue ids'));
  } else {
    const venueScope = value.venue_scope as readonly unknown[];
    if (!venueScope.every((venue) => isNonEmptyString(venue))) {
      errors.push(invalidField(`${path}.venue_scope`, 'every venue id must be a non-empty string'));
    } else if (venueScope.some((venue, index) => venueScope.indexOf(venue) !== index)) {
      errors.push(
        invalidField(
          `${path}.venue_scope`,
          `duplicate venue id "${String(venueScope.find((v, i) => venueScope.indexOf(v) !== i))}" in scope`,
        ),
      );
    }
  }

  if (value.instrument_scope === undefined) {
    errors.push(missingField(`${path}.instrument_scope`));
  } else if (!Array.isArray(value.instrument_scope)) {
    errors.push(invalidField(`${path}.instrument_scope`, 'must be an array of instrument ids'));
  } else {
    const instrumentScope = value.instrument_scope as readonly unknown[];
    if (!instrumentScope.every((instrument) => isNonEmptyString(instrument))) {
      errors.push(invalidField(`${path}.instrument_scope`, 'every instrument id must be a non-empty string'));
    } else if (instrumentScope.some((instrument, index) => instrumentScope.indexOf(instrument) !== index)) {
      errors.push(
        invalidField(
          `${path}.instrument_scope`,
          `duplicate instrument id "${String(instrumentScope.find((v, i) => instrumentScope.indexOf(v) !== i))}" in scope`,
        ),
      );
    }
  }

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
      code: 'fidelity_mismatch',
      path: `${path}.fidelity`,
      message: `profile.fidelity (${String(value.fidelity)}) must equal profile.clock.fidelity (${clock.fidelity})`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      environment_id: value.environment_id as EnvironmentId,
      fidelity: value.fidelity as FidelityMode,
      clock: clock as ClockState,
      seed: value.seed as Seed,
      venue_scope: (value.venue_scope as readonly VenueId[]).slice(),
      instrument_scope: (value.instrument_scope as readonly InstrumentId[]).slice(),
      latency_policy: value.latency_policy as LatencyPolicyId | null,
      fee_policy: value.fee_policy as FeePolicyId | null,
    }),
  );
}

/**
 * The fully-determining environment specification (mirror of
 * environment-protocol's EnvironmentSpec): profile + world reference +
 * information policy. Given the same spec, the same world config and the
 * same recorded stream, the observation/action stream of an episode is
 * deterministic (L9).
 */
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
 * Collect-all validation of an untrusted environment spec. Enforces the
 * policy coherence rule (`spec.information_policy ===
 * profile.clock.informationPolicy`). Mirrors environment-protocol's
 * `validateEnvironmentSpec` field-for-field.
 */
export function validateEnvironmentSpec(value: unknown, path = 'spec'): WorldResult<EnvironmentSpec> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: WorldError[] = [];

  let profile: EnvironmentProfile | undefined;
  if (value.profile === undefined) {
    errors.push(missingField(`${path}.profile`));
  } else {
    const profileResult = validateEnvironmentProfile(value.profile, `${path}.profile`);
    if (profileResult.ok) {
      profile = profileResult.value;
    } else {
      errors.push(...profileResult.errors);
    }
  }

  let world: WorldRef | undefined;
  if (value.world === undefined) {
    errors.push(missingField(`${path}.world`));
  } else if (!isWorldRef(value.world)) {
    if (!isRecord(value.world)) {
      errors.push(invalidField(`${path}.world`, 'must be an object with world_id and kind'));
    } else if (!isNonEmptyString((value.world as Record<string, unknown>).world_id)) {
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

  // Policy coherence: the spec's policy IS the clock's policy.
  if (
    errors.length === 0 &&
    profile !== undefined &&
    isInformationPolicy(value.information_policy) &&
    value.information_policy !== profile.clock.informationPolicy
  ) {
    errors.push({
      code: 'policy_mismatch',
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

// ---------------------------------------------------------------------------
// Canonical serialization + deterministic episode ids (mirror of T005 spec.ts)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization of any JSON value: object keys recursively
 * sorted (code-unit order), arrays in order, strings via `JSON.stringify`,
 * finite numbers via `String`. Equal JSON values always serialize
 * byte-identically. Mirror of environment-protocol's `canonicalJson`.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value); // finite by the JSON model
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  const object = value as JsonObject;
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
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

/**
 * Canonical JSON of a validated environment spec — the lineage anchor for
 * L9. Field order at construction is irrelevant: equal specs produce
 * identical bytes. Mirrors environment-protocol's `canonicalSpecJson`
 * field-for-field (the tree below is the T005 tree).
 */
export function canonicalSpecJson(spec: EnvironmentSpec): string {
  // A validated spec is entirely JSON-shaped data; the canonical tree is
  // built field-by-field (no casts) so the compiler proves JSON-safety.
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
 * `deriveEpisodeId` exactly — the same spec always yields the same episode
 * id in both packages, so trajectories (T011) and distributed workers (T014)
 * can join on episode ids across the lane boundary. Interop-tested for
 * parity in src/interop.test.ts.
 */
export function deriveEpisodeId(spec: EnvironmentSpec): EpisodeId {
  return `ep-${fnv1a32Hex(canonicalSpecJson(spec))}` as EpisodeId;
}

// ---------------------------------------------------------------------------
// Observation envelope + provenance summary (mirror of T005)
// ---------------------------------------------------------------------------

/** Where an observation came from. The syntheticity discriminator (L5). */
export type ObservationOrigin = 'historical' | 'simulated' | 'generated';

/** Runtime list of observation origins, for guards and diagnostics. */
export const OBSERVATION_ORIGINS: readonly ObservationOrigin[] = ['historical', 'simulated', 'generated'];

/**
 * Provenance summary carried by every observation (mirror of
 * environment-protocol's ObservationProvenance — itself a summary mirror of
 * market-protocol's provenance):
 * - `origin`: the historical/simulated/generated discriminator.
 * - `source`: REQUIRED non-null when origin is `historical` (no orphan
 *   history); may name the producing world component otherwise.
 * - `derived_from`: lineage; non-empty marks a DERIVED observation, which
 *   obeys the SAME visibility law as a primitive one (L4).
 */
export interface ObservationProvenance {
  readonly origin: ObservationOrigin;
  readonly source: string | null;
  readonly derived_from: readonly string[];
}

/** Runtime guard for the observation origin discriminator. */
export function isObservationOrigin(value: unknown): value is ObservationOrigin {
  return typeof value === 'string' && (OBSERVATION_ORIGINS as readonly string[]).includes(value);
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
 * The minimal structural contract for anything the world's boundary can
 * police (mirror of environment-protocol's `Available` and time-engine's
 * `Observable`).
 */
export interface Available {
  readonly available_time: TimestampMs;
}

/**
 * The observation envelope (mirror of environment-protocol's Observation):
 * the ONLY thing the replay world ever hands a consumer, carrying the L4
 * boundary input `available_time`. The payload is opaque — market semantics
 * belong to this lane's WorldEvent (the payload of a replay observation IS
 * the full recorded event envelope).
 */
export interface ObservationMirror {
  /** Opaque unique identifier within the episode. */
  readonly observation_id: ObservationId;
  /** The earliest instant a consumer may legitimately observe this payload (L4). */
  readonly available_time: TimestampMs;
  /** Venue the observation is about, or `null` for non-venue observations. */
  readonly venue: VenueId | null;
  /** Instrument the observation is about, or `null` for non-instrument observations. */
  readonly instrument: InstrumentId | null;
  /** The opaque payload. JSON-safe by contract. */
  readonly payload: JsonValue;
  /** Provenance summary: origin trichotomy, producing source, lineage. */
  readonly provenance: ObservationProvenance;
}

/** Runtime guard for a structurally valid observation envelope. */
export function isObservationMirror(value: unknown): value is ObservationMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.observation_id)) return false;
  if (!isTimestampMs(value.available_time)) return false;
  if (value.venue !== null && !(typeof value.venue === 'string' && value.venue.length > 0)) return false;
  if (value.instrument !== null && !(typeof value.instrument === 'string' && value.instrument.length > 0)) return false;
  if (!isJsonValueMirror(value.payload)) return false;
  if (!isObservationProvenance(value.provenance)) return false;
  return true;
}

/** Local alias so the observation guard needs no json.ts import cycle. */
function isJsonValueMirror(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((element) => isJsonValueMirror(element));
  if (typeof value === 'object') {
    return Object.values(value).every((element) => isJsonValueMirror(element));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Action envelope (mirror of T005)
// ---------------------------------------------------------------------------

/**
 * The action request envelope (mirror of environment-protocol's Action). An
 * Action is a REQUEST, never a command (L8): in exact replay the world
 * records the request as an INTENT with a typed receipt and NEVER matches it
 * — matching is T010/T027 territory (L6).
 */
export interface ActionMirror {
  /** Opaque unique identifier within the episode. */
  readonly action_id: ActionId;
  /** The acting agent instance (opaque cross-lane reference). */
  readonly actor: AgentInstanceId;
  /** The instant the action claims submission at. MUST be `<= episode.now` at accept time. */
  readonly submitted_at: TimestampMs;
  /** Per-actor request ordinal; strictly increasing across the actor's accepted actions. */
  readonly client_sequence: number;
  /** The opaque request payload. JSON-safe by contract. */
  readonly payload: JsonValue;
}

/** Runtime guard for a structurally valid action envelope. */
export function isActionMirror(value: unknown): value is ActionMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.action_id)) return false;
  if (!isNonEmptyString(value.actor)) return false;
  if (!isTimestampMs(value.submitted_at)) return false;
  if (!isNonNegativeSafeInteger(value.client_sequence)) return false;
  if (!isJsonValueMirror(value.payload)) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted action envelope (mirror of
 * environment-protocol's `validateAction`). Timeless: no comparison against
 * "now" happens here — the causal law lives in the submit transition.
 */
export function validateActionMirror(value: unknown, path = 'action'): WorldResult<ActionMirror> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: WorldError[] = [];

  if (value.action_id === undefined) {
    errors.push(missingField(`${path}.action_id`));
  } else if (!isNonEmptyString(value.action_id)) {
    errors.push(invalidField(`${path}.action_id`, 'must be a non-empty string'));
  }

  if (value.actor === undefined) {
    errors.push(missingField(`${path}.actor`));
  } else if (!isNonEmptyString(value.actor)) {
    errors.push(invalidField(`${path}.actor`, 'must be a non-empty string'));
  }

  if (value.submitted_at === undefined) {
    errors.push(missingField(`${path}.submitted_at`));
  } else if (!isTimestampMs(value.submitted_at)) {
    errors.push(
      invalidField(`${path}.submitted_at`, 'must be an integer epoch-ms number within the representable range'),
    );
  }

  if (value.client_sequence === undefined) {
    errors.push(missingField(`${path}.client_sequence`));
  } else if (!isNonNegativeSafeInteger(value.client_sequence)) {
    errors.push(invalidField(`${path}.client_sequence`, 'must be a non-negative safe integer'));
  }

  if (value.payload === undefined) {
    errors.push(missingField(`${path}.payload`));
  } else if (!isJsonValueMirror(value.payload)) {
    errors.push(invalidField(`${path}.payload`, 'must be a JSON value (finite numbers only, no undefined/functions)'));
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      action_id: value.action_id as ActionId,
      actor: value.actor as AgentInstanceId,
      submitted_at: value.submitted_at as TimestampMs,
      client_sequence: value.client_sequence as number,
      payload: value.payload as JsonValue,
    }),
  );
}

// ---------------------------------------------------------------------------
// Reward signal (mirror of T005 — replay worlds emit NONE)
// ---------------------------------------------------------------------------

/**
 * An explicit reward signal (mirror of environment-protocol's RewardSignal).
 * OPTIONAL, EXPLICIT, NEVER FABRICATED — and the exact-replay world emits
 * exactly ZERO of them: reward functions attach to the recorded trajectory
 * at T013 (L7: raw PnL is never the sole acceptance criterion). The type is
 * mirrored so episode views carry the protocol's shape faithfully.
 */
export interface RewardSignalMirror {
  readonly reward_id: RewardId;
  readonly episode_id: EpisodeId;
  readonly at: TimestampMs;
  readonly available_time: TimestampMs;
  readonly value: number;
  readonly metric: string;
  readonly source: string;
  readonly detail: JsonObject | null;
}

/** Runtime guard for a structurally valid reward signal. */
export function isRewardSignalMirror(value: unknown): value is RewardSignalMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.reward_id)) return false;
  if (!isNonEmptyString(value.episode_id)) return false;
  if (!isTimestampMs(value.at)) return false;
  if (!isTimestampMs(value.available_time)) return false;
  if (!isFiniteNumber(value.value)) return false;
  if (!isNonEmptyString(value.metric)) return false;
  if (!isNonEmptyString(value.source)) return false;
  if (value.detail !== null && !isJsonObject(value.detail)) return false;
  if (value.available_time < value.at) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Episode state / result / finish shapes (mirror of T005)
// ---------------------------------------------------------------------------

/** Episode lifecycle status. Mirror of environment-protocol. */
export type EpisodeStatus = 'running' | 'finished';

/** Runtime-checkable list of episode statuses. */
export const EPISODE_STATUSES: readonly EpisodeStatus[] = ['running', 'finished'];

/** Runtime guard for an episode status. */
export function isEpisodeStatus(value: unknown): value is EpisodeStatus {
  return typeof value === 'string' && (EPISODE_STATUSES as readonly string[]).includes(value);
}

/**
 * The episode state shape (mirror of environment-protocol's EpisodeState).
 * The WorldAdapter's `ReplayEpisodeView` satisfies this structurally:
 * `pending` holds the world's offered observations (future-dated ones are
 * EMBARGOED until their availability instant — the inclusive L4 boundary
 * polices delivery), `accepted_actions` is the recorded intent log, and
 * `rewards` is always empty in exact replay.
 */
export interface EpisodeStateMirror {
  readonly episode_id: EpisodeId;
  readonly spec: EnvironmentSpec;
  readonly clock: ClockState;
  readonly status: EpisodeStatus;
  readonly termination: TerminationReason | null;
  readonly pending: readonly ObservationMirror[];
  readonly accepted_actions: readonly ActionMirror[];
  readonly rewards: readonly RewardSignalMirror[];
}

/**
 * The immutable summary of a finished episode (mirror of
 * environment-protocol's EpisodeResult). Binds the full spec (L9) and
 * carries counts + the (empty in replay) reward signals.
 */
export interface EpisodeResultMirror {
  readonly episode_id: EpisodeId;
  readonly environment_id: EnvironmentId;
  readonly spec: EnvironmentSpec;
  readonly termination: TerminationReason;
  readonly final_now: TimestampMs;
  readonly accepted_action_count: number;
  readonly pending_observation_count: number;
  readonly rewards: readonly RewardSignalMirror[];
}

/**
 * The terminal transition product (mirror of environment-protocol's
 * EpisodeFinish): the FINISHED state plus the immutable result record.
 */
export interface EpisodeFinishMirror {
  readonly episode: EpisodeStateMirror;
  readonly result: EpisodeResultMirror;
}

/** Runtime guard for a structurally valid episode-state-shaped value. */
export function isEpisodeStateMirror(value: unknown): value is EpisodeStateMirror {
  if (!isRecord(value)) return false;
  if (!isEpisodeId(value.episode_id)) return false;
  if (!isEnvironmentSpec(value.spec)) return false;
  if (!isClockState(value.clock)) return false;
  if (!isEpisodeStatus(value.status)) return false;
  if (value.status === 'finished' && !isTerminationReason(value.termination)) return false;
  if (value.status === 'running' && value.termination !== null) return false;
  if (!Array.isArray(value.pending) || !value.pending.every((observation) => isObservationMirror(observation))) return false;
  if (!Array.isArray(value.accepted_actions) || !value.accepted_actions.every((action) => isActionMirror(action))) return false;
  if (!Array.isArray(value.rewards) || !value.rewards.every((reward) => isRewardSignalMirror(reward))) return false;
  return true;
}

/** Runtime guard for a structurally valid episode-result-shaped value. */
export function isEpisodeResultMirror(value: unknown): value is EpisodeResultMirror {
  if (!isRecord(value)) return false;
  if (!isEpisodeId(value.episode_id)) return false;
  if (!isEnvironmentId(value.environment_id)) return false;
  if (!isEnvironmentSpec(value.spec)) return false;
  if (!isTerminationReason(value.termination)) return false;
  if (!isTimestampMs(value.final_now)) return false;
  if (typeof value.accepted_action_count !== 'number') return false;
  if (typeof value.pending_observation_count !== 'number') return false;
  if (!Array.isArray(value.rewards) || !value.rewards.every((reward) => isRewardSignalMirror(reward))) return false;
  return true;
}

/** Runtime guard for a structurally valid episode-finish-shaped value. */
export function isEpisodeFinishMirror(value: unknown): value is EpisodeFinishMirror {
  if (!isRecord(value)) return false;
  return isEpisodeStateMirror(value.episode) && isEpisodeResultMirror(value.result);
}
