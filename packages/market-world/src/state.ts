/**
 * @tradrl/market-world — the ReplayWorldState: the immutable value object a
 * replay world IS (spec/DOMAIN-MODEL.md, "MarketWorld").
 *
 * In EXACT REPLAY the world is its recorded history: the state carries the
 * applied-event log (`history`), the per-stream sequence trackers
 * (`sequences`, mirroring market-protocol's discipline), the recorded
 * world-state snapshot refs (`snapshot_refs` — the event ids of applied
 * `book_snapshot` events: the replay world never synthesizes snapshots, L6),
 * the clock (a structural mirror of time-engine's SimulationClock), the
 * recorded intent log (`intents` — actions in replay mode are recorded as
 * intents with typed receipts, NEVER matched), and the fully-determining
 * config (L9).
 *
 * Every transition returns a NEW deeply frozen state (structural sharing of
 * the immutable history makes this cheap); nothing mutates in place. The
 * state is entirely JSON-serializable, so a run can be serialized mid-flight
 * and resumed identically ({@link serializeReplayWorldState} /
 * {@link deserializeReplayWorldState}).
 */

import { deepFreeze, isNonEmptyString, isNonNegativeSafeInteger, isRecord } from './primitives';
import { fail, ok, type WorldError, type WorldResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { ClockState } from './clock';
import { isClockState } from './clock';
import type { ReplayWorldConfig } from './config';
import { validateWorldConfig } from './config';
import type { EnvironmentSpec, TerminationReason } from './env-mirror';
import { isEnvironmentSpec, isTerminationReason, validateEnvironmentSpec } from './env-mirror';
import type { WorldEvent } from './event';
import { isWorldEvent, sequenceKeyOf, sequenceStream } from './event';
import type {
  ActionId,
  AgentInstanceId,
  EpisodeId,
  IntentReceiptId,
  VenueId,
  WorldId,
  WorldSnapshotRef,
} from './ids';
import { isIntentReceiptId, isWorldSnapshotRef } from './ids';
import type { JsonValue } from './json';

// ---------------------------------------------------------------------------
// Per-stream sequence trackers (mirror of market-protocol's discipline)
// ---------------------------------------------------------------------------

/**
 * The applied high-water mark of one event stream, identified by
 * (venue, instrument, stream) where the stream is the event type (or
 * `other:<kind>`). Sequences must be STRICTLY INCREASING per stream in
 * arrival order: equal = `duplicate_sequence`, lower = `sequence_regression`
 * — enforced by the ingest transition.
 */
export interface StreamSequenceState {
  readonly venue: VenueId;
  readonly instrument: VenueId extends never ? never : import('./ids').InstrumentId;
  /** The event-type stream name (`trade`, `quote`, ..., `other:<kind>`). */
  readonly stream: string;
  /** The highest sequence applied to this stream so far. */
  readonly last_sequence: number;
  /** How many events this stream has applied. */
  readonly event_count: number;
}

/** Runtime guard for a per-stream sequence tracker. */
export function isStreamSequenceState(value: unknown): value is StreamSequenceState {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.venue)) return false;
  if (!isNonEmptyString(value.instrument)) return false;
  if (!isNonEmptyString(value.stream)) return false;
  if (!isNonNegativeSafeInteger(value.last_sequence)) return false;
  if (!isNonNegativeSafeInteger(value.event_count)) return false;
  return true;
}

/** The lookup key of a stream tracker: `venue|instrument|stream`. */
export function streamSequenceKey(state: StreamSequenceState): string {
  return `${state.venue}|${state.instrument}|${state.stream}`;
}

// ---------------------------------------------------------------------------
// Intent receipts (L6: recorded, never matched)
// ---------------------------------------------------------------------------

/**
 * The disposition of a submitted action in exact replay. The union has
 * EXACTLY ONE member by construction — the type itself makes a fill
 * inexpressible. Matching is T010 (exchange simulation) / T027 (reactive
 * participants) territory; the world records the intent and stops there.
 */
export type IntentDisposition = 'recorded_as_intent';

/**
 * The typed receipt returned when an action is recorded as an intent.
 * Carries the full identification of the request plus the recording clock
 * instant — never a fill, never an execution report.
 */
export interface IntentReceipt {
  /** Deterministic: `intent:<episode_id>:<action_id>` (action ids are unique per episode). */
  readonly receipt_id: IntentReceiptId;
  readonly episode_id: EpisodeId;
  readonly action_id: ActionId;
  readonly actor: AgentInstanceId;
  readonly client_sequence: number;
  /** The episode clock's `now` at recording time. */
  readonly recorded_at: TimestampMs;
  /** Always `'recorded_as_intent'` — see {@link IntentDisposition}. */
  readonly disposition: IntentDisposition;
}

/** Runtime guard for an intent receipt. */
export function isIntentReceipt(value: unknown): value is IntentReceipt {
  if (!isRecord(value)) return false;
  if (!isIntentReceiptId(value.receipt_id)) return false;
  if (!isNonEmptyString(value.episode_id)) return false;
  if (!isNonEmptyString(value.action_id)) return false;
  if (!isNonEmptyString(value.actor)) return false;
  if (!isNonNegativeSafeInteger(value.client_sequence)) return false;
  if (!isTimestampMs(value.recorded_at)) return false;
  if (value.disposition !== 'recorded_as_intent') return false;
  return true;
}

/** One entry of the world's intent log: the accepted request plus its receipt. */
export interface IntentRecord {
  readonly action: import('./env-mirror').ActionMirror;
  readonly receipt: IntentReceipt;
}

/** Runtime guard for an intent log entry. */
export function isIntentRecord(value: unknown): value is IntentRecord {
  if (!isRecord(value)) return false;
  const actionMirrorGuard = (candidate: unknown): boolean =>
    isRecord(candidate) &&
    isNonEmptyString(candidate.action_id) &&
    isNonEmptyString(candidate.actor) &&
    isTimestampMs(candidate.submitted_at) &&
    isNonNegativeSafeInteger(candidate.client_sequence);
  return actionMirrorGuard(value.action) && isIntentReceipt(value.receipt);
}

// ---------------------------------------------------------------------------
// The world state
// ---------------------------------------------------------------------------

/** Lifecycle of a world state: `running` until finished; loading states are running. */
export type WorldRunStatus = 'running' | 'finished';

/** Runtime guard for a world run status. */
export function isWorldRunStatus(value: unknown): value is WorldRunStatus {
  return value === 'running' || value === 'finished';
}

/**
 * The replay world state (see module header). One state object is one
 * world-run lineage: loading (spec null) until an episode binds, then the
 * episode's clock/intents evolve over the shared immutable history.
 */
export interface ReplayWorldState {
  /** The world's identity (episodes bind to it via their spec). */
  readonly world_id: WorldId;
  /** The fully-determining world config (L9). */
  readonly config: ReplayWorldConfig;
  /** The bound episode spec; `null` while the world is still loading its stream. */
  readonly spec: EnvironmentSpec | null;
  /** The clock: a structural mirror of time-engine's SimulationClock. */
  readonly clock: ClockState;
  /** The applied events, in arrival order. THE recorded world. */
  readonly history: readonly WorldEvent[];
  /** Per-stream sequence trackers, canonically sorted by `venue|instrument|stream`. */
  readonly sequences: readonly StreamSequenceState[];
  /** Recorded world-state snapshot refs: event ids of applied `book_snapshot` events (L6). */
  readonly snapshot_refs: readonly WorldSnapshotRef[];
  /** The intent log, in acceptance order (actions recorded, never matched — L6/L8). */
  readonly intents: readonly IntentRecord[];
  readonly status: WorldRunStatus;
  readonly termination: TerminationReason | null;
}

// ---------------------------------------------------------------------------
// Initialization (the L5 mode gate)
// ---------------------------------------------------------------------------

/**
 * Initialize a replay world from an untrusted config.
 *
 * L5 GATE: this package implements EXACT HISTORICAL REPLAY ONLY — a config
 * declaring `reactive_replay` or `generative` fails with
 * `unsupported_fidelity` (those modes are T027/T028; the contract TYPE
 * admits all three, the implementation does not).
 *
 * The initial clock stands at the config's information anchor
 * (`now = asOf`, time-engine's default standing position); binding an
 * episode re-anchors the clock to the episode spec's clock.
 */
export function initReplayWorld(config: unknown): WorldResult<ReplayWorldState> {
  const configResult = validateWorldConfig(config);
  if (!configResult.ok) return configResult;
  const validConfig = configResult.value;

  if (validConfig.fidelity !== 'exact_replay') {
    return fail(
      'unsupported_fidelity',
      `the historical replay world implements fidelity 'exact_replay' only (L5); '${validConfig.fidelity}' is the reactive (T027) / generative (T028) lane`,
      'config.fidelity',
    );
  }

  return ok(
    deepFreeze({
      world_id: validConfig.world_id,
      config: validConfig,
      spec: null,
      clock: deepFreeze({
        now: validConfig.as_of,
        asOf: validConfig.as_of,
        playbackSpeed: validConfig.playback_speed,
        paused: false,
        fidelity: validConfig.fidelity,
        informationPolicy: 'point-in-time',
      }),
      history: [],
      sequences: [],
      snapshot_refs: [],
      intents: [],
      status: 'running',
      termination: null,
    }),
  );
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Runtime guard for a structurally valid world state (deep, total). */
export function isReplayWorldState(value: unknown): value is ReplayWorldState {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.world_id)) return false;
  if (!isRecord(value.config)) return false;
  if (value.spec !== null && !isEnvironmentSpec(value.spec)) return false;
  if (!isClockState(value.clock)) return false;
  if (value.world_id !== value.config.world_id) return false;
  if (value.clock.fidelity !== value.config.fidelity) return false;
  if (value.clock.informationPolicy !== value.config.information_policy) return false;
  if (!Array.isArray(value.history) || !value.history.every((event) => isWorldEvent(event))) return false;
  if (!Array.isArray(value.sequences) || !value.sequences.every((tracker) => isStreamSequenceState(tracker))) return false;
  if (!Array.isArray(value.snapshot_refs) || !value.snapshot_refs.every((ref) => isWorldSnapshotRef(ref))) return false;
  if (!Array.isArray(value.intents) || !value.intents.every((intent) => isIntentRecord(intent))) return false;
  if (!isWorldRunStatus(value.status)) return false;
  if (value.status === 'finished' && !isTerminationReason(value.termination)) return false;
  if (value.status === 'running' && value.termination !== null) return false;
  if (value.spec === null && value.intents.length > 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Serialization (the resume contract)
// ---------------------------------------------------------------------------

/**
 * Serialize a world state to a JSON value (deep copy, canonical for
 * transport). The state is JSON-shaped by construction; this is the explicit
 * resume boundary.
 */
export function serializeReplayWorldState(state: ReplayWorldState): WorldResult<JsonValue> {
  if (!isReplayWorldState(state)) {
    return fail('invalid_state', 'cannot serialize a value that is not a structurally valid ReplayWorldState');
  }
  return ok(JSON.parse(JSON.stringify(state)) as JsonValue);
}

/**
 * Deserialize and validate an untrusted serialized world state (collect-all
 * across the config, spec, clock, history, trackers and intent log). The
 * result is deeply frozen. This is the gate a resumed run passes through —
 * partial or tampered states fail with typed errors, never silently.
 */
export function deserializeReplayWorldState(value: unknown): WorldResult<ReplayWorldState> {
  if (!isRecord(value)) {
    return { ok: false, errors: [{ code: 'invalid_type', path: 'state', message: 'state must be an object' }] };
  }
  const errors: WorldError[] = [];

  if (typeof value.world_id !== 'string' || value.world_id.length === 0) {
    errors.push({ code: 'invalid_field', path: 'state.world_id', message: 'must be a non-empty string' });
  }

  const configResult = validateWorldConfig(value.config, 'state.config');
  if (!configResult.ok) errors.push(...configResult.errors);

  let spec: EnvironmentSpec | null = null;
  if (value.spec === undefined) {
    errors.push({ code: 'missing_field', path: 'state.spec', message: 'required field "state.spec" is missing (null while loading)' });
  } else if (value.spec !== null) {
    const specResult = validateEnvironmentSpec(value.spec, 'state.spec');
    if (specResult.ok) {
      spec = specResult.value;
    } else {
      errors.push(...specResult.errors);
    }
  }

  if (!isClockState(value.clock)) {
    errors.push({ code: 'invalid_field', path: 'state.clock', message: 'must be a structurally valid ClockState' });
  }

  if (!Array.isArray(value.history)) {
    errors.push({ code: 'invalid_field', path: 'state.history', message: 'must be an array of WorldEvent records' });
  } else {
    for (let index = 0; index < value.history.length; index++) {
      const eventResult = isWorldEvent(value.history[index]);
      if (!eventResult) {
        errors.push({ code: 'invalid_event', path: `state.history[${index}]`, message: 'is not a structurally valid WorldEvent' });
      }
    }
  }

  if (!Array.isArray(value.sequences)) {
    errors.push({ code: 'invalid_field', path: 'state.sequences', message: 'must be an array of stream trackers' });
  } else {
    for (let index = 0; index < value.sequences.length; index++) {
      if (!isStreamSequenceState(value.sequences[index])) {
        errors.push({ code: 'invalid_field', path: `state.sequences[${index}]`, message: 'is not a structurally valid stream tracker' });
      }
    }
  }

  if (!Array.isArray(value.snapshot_refs)) {
    errors.push({ code: 'invalid_field', path: 'state.snapshot_refs', message: 'must be an array of snapshot refs' });
  } else {
    for (let index = 0; index < value.snapshot_refs.length; index++) {
      if (!isWorldSnapshotRef(value.snapshot_refs[index])) {
        errors.push({ code: 'invalid_field', path: `state.snapshot_refs[${index}]`, message: 'must be a non-empty string ref' });
      }
    }
  }

  if (!Array.isArray(value.intents)) {
    errors.push({ code: 'invalid_field', path: 'state.intents', message: 'must be an array of intent records' });
  } else {
    for (let index = 0; index < value.intents.length; index++) {
      if (!isIntentRecord(value.intents[index])) {
        errors.push({ code: 'invalid_field', path: `state.intents[${index}]`, message: 'is not a structurally valid intent record' });
      }
    }
  }

  if (!isWorldRunStatus(value.status)) {
    errors.push({ code: 'invalid_field', path: 'state.status', message: "must be 'running' or 'finished'" });
  }

  if (value.termination === undefined) {
    errors.push({ code: 'missing_field', path: 'state.termination', message: 'required field "state.termination" is missing (null while running)' });
  } else if (value.termination !== null && !isTerminationReason(value.termination)) {
    errors.push({ code: 'invalid_termination', path: 'state.termination', message: 'must be a termination reason or null' });
  }

  if (errors.length > 0) return { ok: false, errors };

  const config = configResult.ok ? configResult.value : undefined;
  if (config === undefined) {
    return fail('invalid_state', 'config validation failed unexpectedly');
  }

  return ok(
    deepFreeze({
      world_id: value.world_id as WorldId,
      config,
      spec,
      clock: deepFreeze(value.clock as ClockState),
      history: (value.history as readonly WorldEvent[]).slice(),
      sequences: (value.sequences as readonly StreamSequenceState[]).slice(),
      snapshot_refs: (value.snapshot_refs as readonly WorldSnapshotRef[]).slice(),
      intents: (value.intents as readonly IntentRecord[]).slice(),
      status: value.status as WorldRunStatus,
      termination: (value.termination as TerminationReason | null) === null ? null : deepFreeze(value.termination as TerminationReason),
    }),
  );
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

/**
 * Derive the pristine LOADING state underlying any world state: history,
 * trackers and snapshot refs carried; clock re-anchored at the config's
 * information anchor; spec, intents and termination cleared. Used by the
 * WorldAdapter to serve FRESH episodes over an already-loaded (or resumed)
 * world without inheriting a prior episode's run line.
 */
export function replayBaseStateFrom(state: ReplayWorldState): ReplayWorldState {
  return deepFreeze({
    world_id: state.world_id,
    config: state.config,
    spec: null,
    clock: deepFreeze({
      now: state.config.as_of,
      asOf: state.config.as_of,
      playbackSpeed: state.config.playback_speed,
      paused: false,
      fidelity: state.config.fidelity,
      informationPolicy: 'point-in-time',
    }),
    history: state.history,
    sequences: state.sequences,
    snapshot_refs: state.snapshot_refs,
    intents: [],
    status: 'running',
    termination: null,
  });
}

/**
 * Rebuild the per-stream sequence trackers from a history (the deterministic
 * fold the ingest transition performs). Exposed for resume verification and
 * forensics: `sequenceTrackersOf(history)` must deep-equal `state.sequences`
 * for any honestly-constructed state.
 */
export function sequenceTrackersOf(history: readonly WorldEvent[]): readonly StreamSequenceState[] {
  const trackers = new Map<string, StreamSequenceState>();
  for (const event of history) {
    const key = sequenceKeyOf(event);
    const previous = trackers.get(key);
    const venue = event.venue as VenueId;
    const instrument = event.instrument as StreamSequenceState['instrument'];
    const stream = sequenceStream(event);
    if (previous === undefined) {
      trackers.set(key, deepFreeze({ venue, instrument, stream, last_sequence: event.sequence, event_count: 1 }));
    } else {
      trackers.set(key, deepFreeze({ ...previous, last_sequence: event.sequence, event_count: previous.event_count + 1 }));
    }
  }
  return [...trackers.values()].sort((a, b) => (streamSequenceKey(a) < streamSequenceKey(b) ? -1 : streamSequenceKey(a) > streamSequenceKey(b) ? 1 : 0));
}
