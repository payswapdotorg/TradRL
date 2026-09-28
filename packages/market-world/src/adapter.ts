/**
 * @tradrl/market-world — the WorldAdapter: the structural implementation of
 * @tradrl/environment-protocol's Environment five-operation surface
 * (start / observe / submit / advance / finish) over a ReplayWorldState.
 *
 * WHAT "STRUCTURAL IMPLEMENTATION" MEANS HERE (work order T009, D-003/D-004):
 * this package never imports the environment protocol; the adapter's
 * outputs SATISFY its shapes — `ReplayEpisodeView` is assignable to
 * environment-protocol's `EpisodeState`, `WorldObservation` to its
 * `Observation`, `ReplayEpisodeFinish` to its `EpisodeFinish` — and the
 * adapter itself passes its runtime guard `isEnvironment` (five function
 * properties). Proven by src/interop.test.ts: type-level witnesses compile
 * here on every branch, and the REAL package's guards run whenever it is
 * present (the Lead's integration tree).
 *
 * THE FIVE OPERATIONS (mirroring the protocol's failure modes):
 *
 *   - `start(spec)`        — validate the spec (mirrored collect-all), bind
 *                            it to this world (world_id), enforce the L5
 *                            mode discipline and the `as_of` anchor, derive
 *                            the episode id deterministically (mirrored
 *                            derivation — same spec, same id), and create
 *                            the episode's state over the loaded history.
 *   - `observe(ep, at)`    — PURE point-in-time query: the episode's
 *                            scope-filtered observations visible at `at`
 *                            (INCLUSIVE L4 boundary; `at > now` rejected).
 *   - `submit(ep, action)` — record an action as an INTENT with a typed
 *                            receipt; NEVER match it (L6/L8). Causal law:
 *                            `submitted_at <= now` (inclusive); per-actor
 *                            `client_sequence` strictly increasing; action
 *                            ids unique per episode.
 *   - `advance(ep, to)`    — monotonic, `<= episode asOf` (mirrored law).
 *   - `finish(ep, reason)` — terminal state + immutable result record.
 *
 * The adapter may serve MULTIPLE episodes over one loaded world: each
 * `start` binds a fresh episode state (clock/intents reset) over the shared
 * immutable history. `restoreEpisode` re-registers a serialized episode
 * state (the resume path).
 */

import { deepFreeze } from './primitives';
import { fail, ok, type WorldResult } from './errors';
import type { TimestampMs } from './timestamp';
import type { ClockState } from './clock';
import type { ReplayWorldState } from './state';
import { replayBaseStateFrom } from './state';
import { advanceWorld, finishWorld, ingestWorld, observeWorld } from './transition';
import type { WorldEvent } from './event';
import type { JsonValue } from './json';
import { isJsonValue } from './json';
import type { ReplayWorldConfig } from './config';
import type { IntentReceipt } from './state';
import {
  deriveEpisodeId,
  validateActionMirror,
  validateEnvironmentSpec,
  validateTerminationReason,
  type ActionMirror,
  type EpisodeFinishMirror,
  type EpisodeResultMirror,
  type EpisodeStateMirror,
  type EnvironmentSpec,
  type ObservationProvenance,
  type RewardSignalMirror,
  type TerminationReason,
} from './env-mirror';
import { canonicalConfigJson } from './config';
import type { EnvironmentId } from './ids';
import type {
  EpisodeId,
  IntentReceiptId,
  InstrumentId,
  ObservationId,
  VenueId,
} from './ids';
import { requireInstrumentId, requireObservationId, requireVenueId } from './ids';

// ---------------------------------------------------------------------------
// The observation the world hands consumers (structurally an Observation)
// ---------------------------------------------------------------------------

/**
 * A replay observation: the delivery envelope of one recorded event. The
 * payload IS the full WorldEvent envelope (forensic completeness: the
 * consumer sees exactly what was recorded — quartet, sequence, provenance
 * and payload); `observation_id` is the event id (unique within the world,
 * therefore within the episode); `available_time` is the event's
 * availability — THE L4 input, untransformed.
 */
export interface WorldObservation {
  readonly observation_id: ObservationId;
  readonly available_time: TimestampMs;
  readonly venue: VenueId | null;
  readonly instrument: InstrumentId | null;
  readonly payload: JsonValue;
  readonly provenance: ObservationProvenance;
}

/** Map a validated event onto its delivery envelope (pure, deterministic). */
export function observationOf(event: WorldEvent): WorldObservation {
  return deepFreeze({
    observation_id: requireObservationId(event.event_id),
    available_time: event.available_time,
    venue: requireVenueId(event.venue),
    instrument: requireInstrumentId(event.instrument),
    payload: eventPayloadJson(event),
    provenance: deepFreeze({
      origin: event.provenance.origin,
      source: event.provenance.adapter === null ? null : `${event.provenance.adapter.id}@${event.provenance.adapter.version}`,
      derived_from: event.provenance.derived_from,
    }),
  });
}

/**
 * The observation payload: the FULL recorded event envelope (forensic
 * completeness — the consumer sees exactly what was recorded: the quartet,
 * sequence, provenance and payload, including any vendor excess fields).
 * The envelope is JSON by validation (`validateWorldEvent` enforces the
 * whole-root JSON law); the round-trip below yields a fresh, extras-
 * preserving JSON value the compiler accepts without casts. Deterministic:
 * identical streams construct identical events, hence identical payloads.
 */
function eventPayloadJson(event: WorldEvent): JsonValue {
  const roundTrip: unknown = JSON.parse(JSON.stringify(event));
  if (!isJsonValue(roundTrip)) {
    throw new Error('observationOf: a validated event failed the JSON round-trip (impossible by validation)');
  }
  return roundTrip;
}

// ---------------------------------------------------------------------------
// Episode views (structurally EpisodeState / EpisodeResult / EpisodeFinish)
// ---------------------------------------------------------------------------

/**
 * The episode view: structurally environment-protocol's `EpisodeState`
 * (compile-time witness in interop.test.ts; runtime proof via
 * `isEpisodeState` whenever the real package is present).
 *
 * - `pending` — the episode's scope-filtered observations, INCLUDING
 *   future-dated ones (embargoed until their availability instant; the L4
 *   boundary polices delivery, not emission).
 * - `accepted_actions` — the recorded intent log (requests, in acceptance
 *   order).
 * - `rewards` — ALWAYS empty: the exact-replay world emits no reward
 *   signals, ever (reward functions attach to trajectories at T013; L7).
 */
export interface ReplayEpisodeView extends EpisodeStateMirror {
  readonly episode_id: EpisodeId;
  readonly spec: EnvironmentSpec;
  readonly clock: ClockState;
  readonly status: 'running' | 'finished';
  readonly termination: TerminationReason | null;
  readonly pending: readonly WorldObservation[];
  readonly accepted_actions: readonly ActionMirror[];
  readonly rewards: readonly RewardSignalMirror[];
}

/**
 * The submit product: the new episode state PLUS the typed intent receipt.
 * Structurally an `EpisodeState` (the receipt is an additional field — the
 * protocol tolerates forward-compatible extras); the receipt can never
 * express a fill (see {@link IntentReceipt} in state.ts, L6).
 */
export interface ReplaySubmission extends ReplayEpisodeView {
  readonly receipt: IntentReceipt;
}

/** The finish product: terminal state + immutable result (structurally EpisodeFinish). */
export interface ReplayEpisodeFinish extends EpisodeFinishMirror {
  readonly episode: ReplayEpisodeView;
  readonly result: ReplayEpisodeResult;
}

/** The result record (structurally EpisodeResult). */
export interface ReplayEpisodeResult extends EpisodeResultMirror {
  readonly episode_id: EpisodeId;
  readonly environment_id: EnvironmentId;
  readonly spec: EnvironmentSpec;
  readonly termination: TerminationReason;
  readonly final_now: TimestampMs;
  readonly accepted_action_count: number;
  readonly pending_observation_count: number;
  readonly rewards: readonly RewardSignalMirror[];
}

// ---------------------------------------------------------------------------
// Scope filtering
// ---------------------------------------------------------------------------

/** True iff the event falls within the episode's observation universe. */
function inScope(event: WorldEvent, spec: EnvironmentSpec): boolean {
  const venueScope = spec.profile.venue_scope;
  if (venueScope.length > 0 && !venueScope.some((venue) => venue === event.venue)) return false;
  const instrumentScope = spec.profile.instrument_scope;
  if (instrumentScope.length > 0 && !instrumentScope.some((instrument) => instrument === event.instrument)) return false;
  return true;
}

/** The episode's pending observations: scope-filtered history, as envelopes. */
export function pendingObservations(state: ReplayWorldState): readonly WorldObservation[] {
  if (state.spec === null) return [];
  const spec = state.spec;
  return state.history.filter((event) => inScope(event, spec)).map((event) => observationOf(event));
}

// ---------------------------------------------------------------------------
// The WorldAdapter
// ---------------------------------------------------------------------------

/** The WorldAdapter: five Environment operations over a loaded ReplayWorldState. */
export interface WorldAdapter {
  /** The world config this adapter serves (the loaded base derives from it). */
  readonly config: ReplayWorldConfig;
  /** All registered episode ids, in registration order. */
  readonly episodes: readonly EpisodeId[];
  /** Begin an episode for a validated spec bound to this world. */
  start(spec: unknown): WorldResult<ReplayEpisodeView>;
  /** PURE point-in-time query (L4, inclusive): observations visible at `at`. */
  observe(episode: EpisodeId, at: TimestampMs): WorldResult<readonly WorldObservation[]>;
  /** Record an action as an intent; returns the new state plus the typed receipt. */
  submit(episode: EpisodeId, action: unknown): WorldResult<ReplaySubmission>;
  /** Advance the episode clock (monotonic, `<= episode asOf`). */
  advance(episode: EpisodeId, to: TimestampMs): WorldResult<ReplayEpisodeView>;
  /** Finish the episode: terminal state plus the immutable result. */
  finish(episode: EpisodeId, reason: unknown): WorldResult<ReplayEpisodeFinish>;
  /** Snapshot lookup: the current view of a registered episode. */
  episode(episode: EpisodeId): ReplayEpisodeView | undefined;
  /** The full world state of a registered episode (serialization source). */
  episodeState(episode: EpisodeId): ReplayWorldState | undefined;
  /** Ingest event batches into the underlying world (delegates to the pure transition). */
  ingest(batch: readonly unknown[]): WorldResult<ReplayWorldState>;
  /** Re-register a serialized episode state (the resume path). */
  restoreEpisode(state: ReplayWorldState): WorldResult<EpisodeId>;
}

/**
 * Create a WorldAdapter over a loaded (or loading) world state. The adapter
 * serves episodes over the state's recorded history; each `start` binds a
 * fresh episode (clock re-anchored to the spec, intents cleared) over the
 * shared immutable history.
 */
export function createWorldAdapter(base: ReplayWorldState): WorldAdapter {
  const registry = new Map<string, ReplayWorldState>();
  const order: string[] = [];

  const lookup = (episode: EpisodeId): WorldResult<ReplayWorldState> => {
    const state = registry.get(episode);
    if (state === undefined) {
      return fail('unknown_episode', `episode ${episode} is not known to this world adapter`);
    }
    return ok(state);
  };

  const viewOf = (state: ReplayWorldState): ReplayEpisodeView => {
    const spec = state.spec;
    if (spec === null) {
      // Unreachable through the adapter (episodes always bind a spec); kept
      // total for direct state users.
      throw new Error('viewOf: episode state carries no bound spec');
    }
    return deepFreeze({
      episode_id: deriveEpisodeId(spec),
      spec,
      clock: state.clock,
      status: state.status,
      termination: state.termination,
      pending: pendingObservations(state),
      accepted_actions: state.intents.map((intent) => intent.action),
      rewards: [],
    });
  };

  return {
    get config(): ReplayWorldConfig {
      return base.config;
    },
    get episodes(): readonly EpisodeId[] {
      return order.slice() as EpisodeId[];
    },

    start(spec: unknown): WorldResult<ReplayEpisodeView> {
      // 1. Validate the spec (mirrored collect-all).
      const specResult = validateEnvironmentSpec(spec);
      if (!specResult.ok) return specResult;
      const validSpec = specResult.value;

      // 2. Bind to THIS world.
      if (validSpec.world.world_id !== base.config.world_id) {
        return fail(
          'world_binding_mismatch',
          `spec.world.world_id "${validSpec.world.world_id}" does not name this world ("${base.config.world_id}")`,
          'spec.world.world_id',
        );
      }

      // 3. L5 mode discipline: this world is exact replay, exactly.
      if (validSpec.profile.fidelity !== 'exact_replay') {
        return fail(
          'unsupported_fidelity',
          `spec.profile.fidelity '${validSpec.profile.fidelity}' is not implemented by the historical replay world (L5: reactive is T027, generative is T028)`,
          'spec.profile.fidelity',
        );
      }
      if (validSpec.profile.fidelity !== base.config.fidelity) {
        return fail(
          'fidelity_mismatch',
          `spec.profile.fidelity '${validSpec.profile.fidelity}' disagrees with the world config's '${base.config.fidelity}'`,
          'spec.profile.fidelity',
        );
      }

      // 4. The anchor: an episode may cover a sub-window of the world's
      //    information set, never exceed it.
      if (validSpec.profile.clock.asOf > base.config.as_of) {
        return fail(
          'beyond_world_as_of',
          `spec.profile.clock.asOf (${validSpec.profile.clock.asOf}) exceeds the world's as_of anchor (${base.config.as_of}) — the recorded information set ends at the anchor`,
          'spec.profile.clock.asOf',
        );
      }

      // 5. Deterministic episode id (mirrored derivation) and uniqueness.
      const episodeId = deriveEpisodeId(validSpec);
      if (registry.has(episodeId)) {
        return fail(
          'duplicate_episode',
          `episode ${episodeId} is already registered — an episode id is a unique run; re-running a spec requires a fresh adapter or a distinct seed`,
        );
      }

      // 6. Bind: fresh episode state over the loaded history, clock from the spec.
      const episodeState = deepFreeze({
        ...replayBaseStateFrom(base),
        spec: validSpec,
        clock: validSpec.profile.clock,
      });
      registry.set(episodeId, episodeState);
      order.push(episodeId);
      return ok(viewOf(episodeState));
    },

    observe(episode: EpisodeId, at: TimestampMs): WorldResult<readonly WorldObservation[]> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const state = found.value;
      // Delegate the L4 enforcement to the canonical transition: timestamp
      // validity, `at <= now` (Time Machine), and the INCLUSIVE boundary.
      const visible = observeWorld(state, at);
      if (!visible.ok) return visible;
      const spec = state.spec;
      if (spec === null) return fail('invalid_state', 'episode state carries no bound spec');
      return ok(visible.value.filter((event) => inScope(event, spec)).map((event) => observationOf(event)));
    },

    submit(episode: EpisodeId, action: unknown): WorldResult<ReplaySubmission> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const state = found.value;
      if (state.status === 'finished') {
        return fail('episode_finished', `episode ${episode} is finished; actions are rejected`);
      }

      // Envelope validation (mirrored collect-all).
      const actionResult = validateActionMirror(action);
      if (!actionResult.ok) return actionResult;
      const validAction = actionResult.value;

      // Causal law (inclusive): an action may not claim submission after now.
      if (validAction.submitted_at > state.clock.now) {
        return fail(
          'action_from_future',
          `action ${validAction.action_id} claims submission at ${validAction.submitted_at}, after the episode's now ${state.clock.now}`,
        );
      }

      // Per-actor request ordering: strictly increasing client_sequence.
      let lastSequence: number | null = null;
      for (const intent of state.intents) {
        if (intent.action.actor === validAction.actor && (lastSequence === null || intent.action.client_sequence > lastSequence)) {
          lastSequence = intent.action.client_sequence;
        }
      }
      if (lastSequence !== null && validAction.client_sequence <= lastSequence) {
        return fail(
          'stale_sequence',
          `action ${validAction.action_id} carries client_sequence ${validAction.client_sequence}, not greater than the actor's last accepted ${lastSequence}`,
        );
      }

      // World-stricter law: action ids are unique per episode (receipt ids derive from them).
      if (state.intents.some((intent) => intent.action.action_id === validAction.action_id)) {
        return fail('duplicate_action', `action id "${validAction.action_id}" is already recorded in episode ${episode}`);
      }

      const receiptId = `intent:${episode}:${validAction.action_id}` as IntentReceiptId;
      const receipt = deepFreeze({
        receipt_id: receiptId,
        episode_id: episode,
        action_id: validAction.action_id,
        actor: validAction.actor,
        client_sequence: validAction.client_sequence,
        recorded_at: state.clock.now,
        disposition: 'recorded_as_intent' as const,
      });
      const nextState = deepFreeze({
        ...state,
        intents: [...state.intents, deepFreeze({ action: validAction, receipt })],
      });
      registry.set(episode, nextState);
      return ok(deepFreeze({ ...viewOf(nextState), receipt }));
    },

    advance(episode: EpisodeId, to: TimestampMs): WorldResult<ReplayEpisodeView> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const advanced = advanceWorld(found.value, to);
      if (!advanced.ok) return advanced;
      registry.set(episode, advanced.value);
      return ok(viewOf(advanced.value));
    },

    finish(episode: EpisodeId, reason: unknown): WorldResult<ReplayEpisodeFinish> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const state = found.value;
      if (state.status === 'finished') {
        return fail('episode_finished', `episode ${episode} is already finished`);
      }
      const reasonResult = validateTerminationReason(reason);
      if (!reasonResult.ok) return reasonResult;
      const finished = finishWorld(state, reasonResult.value);
      if (!finished.ok) return finished;
      registry.set(episode, finished.value);
      const view = viewOf(finished.value);
      const spec = finished.value.spec;
      if (spec === null) return fail('invalid_state', 'episode state carries no bound spec');
      const result: ReplayEpisodeResult = deepFreeze({
        episode_id: view.episode_id,
        environment_id: spec.profile.environment_id,
        spec,
        termination: reasonResult.value,
        final_now: finished.value.clock.now,
        accepted_action_count: finished.value.intents.length,
        pending_observation_count: view.pending.length,
        rewards: [],
      });
      return ok(deepFreeze({ episode: view, result }));
    },

    episode(episode: EpisodeId): ReplayEpisodeView | undefined {
      const state = registry.get(episode);
      return state === undefined ? undefined : viewOf(state);
    },

    episodeState(episode: EpisodeId): ReplayWorldState | undefined {
      return registry.get(episode);
    },

    ingest(batch: readonly unknown[]): WorldResult<ReplayWorldState> {
      // The adapter exposes ingestion for runtimes that stream directly;
      // ingested events apply to the BASE world (episodes keep their own
      // state lineages — see the service for the load-then-bind discipline).
      const ingested = ingestWorld(base, batch);
      if (!ingested.ok) return ingested;
      // Note: the base is captured in this closure; a new adapter is needed
      // after external ingestion. The reference service never does this.
      return ingested;
    },

    restoreEpisode(state: ReplayWorldState): WorldResult<EpisodeId> {
      const spec = state.spec;
      if (spec === null) {
        return fail('invalid_state', 'a resumed episode state must carry its bound spec');
      }
      if (canonicalConfigJson(state.config) !== canonicalConfigJson(base.config)) {
        return fail('invalid_state', 'the resumed episode belongs to a different world config');
      }
      const episodeId = deriveEpisodeId(spec);
      if (registry.has(episodeId)) {
        return fail('duplicate_episode', `episode ${episodeId} is already registered`);
      }
      registry.set(episodeId, state);
      order.push(episodeId);
      return ok(episodeId);
    },
  };
}
