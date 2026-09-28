/**
 * @tradrl/market-world — the ReplayTransition protocol: the PURE functions
 * that move a replay world forward.
 *
 *     ingestWorld(state, batch)  -> state'   (the stream IN — validated,
 *                                            transactional per batch)
 *     observeWorld(state, at)    -> events   (the firewall OUT — the
 *                                            inclusive L4 boundary)
 *     advanceWorld(state, to)    -> state'   (monotonic, <= asOf)
 *
 * L4 — THE WORLD IS THE ENFORCEMENT POINT, DELEGATING NOTHING:
 * `observeWorld` delivers an event iff `available_time <= at` (INCLUSIVE —
 * an event becomes visible EXACTLY at its availability instant, never one
 * millisecond earlier), and `at` may not exceed the clock's `now` (Time
 * Machine semantics: `at == now` is the live step, `at < now` is a
 * historical query). Derived events (non-empty `derived_from`) obey the SAME
 * law as primitive ones — the boundary never consults provenance.
 *
 * L5/L6 — THE STREAM IN IS RECORDED HISTORY ONLY:
 * `ingestWorld` validates every event envelope (mirrored guards), then
 * enforces the world-level laws — quartet ordering, per-stream sequence
 * discipline (strictly increasing per stream: equal = duplicate, lower =
 * regression), event-id uniqueness, stream selection, the `as_of` anchor,
 * and the anti-poisoning rule: provenance origin MUST be `historical`.
 * Synthetic origins are rejected with `synthetic_event_rejected` — they
 * belong to the reactive (T027) and generative (T028) lanes. Fixture
 * streams declare recorded-historical provenance EXPLICITLY (an adapter
 * reference names the fixture source); see services/market-world fixtures.
 *
 * Determinism (L9): all three functions are pure over their inputs; the
 * same event stream + world config yields the identical world state
 * timeline and observation stream. Application is TRANSACTIONAL per batch:
 * a batch applies entirely or not at all (fail-fast on the first invalid
 * event, order-dependent checks against a working tracker).
 */

import { deepFreeze } from './primitives';
import { fail, ok, type WorldResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { ClockState } from './clock';
import { advanceClockStateTo } from './clock';
import type { ReplayWorldState, StreamSequenceState } from './state';
import { isReplayWorldState } from './state';
import type { WorldEvent } from './event';
import { sequenceKeyOf, sequenceStream, validateWorldEvent } from './event';
import type { VenueId, InstrumentId, WorldSnapshotRef } from './ids';
import { streamSelectionKey } from './config';
import type { TerminationReason } from './env-mirror';

// ---------------------------------------------------------------------------
// ingest — the stream IN
// ---------------------------------------------------------------------------

/**
 * Ingest a batch of untrusted event records. Transactional: the batch
 * applies entirely (returning the new state) or fails on the first
 * violation (the input state is unchanged). World-level laws enforced per
 * event, in order:
 *
 *   1. envelope validation (mirrored collect-all guards) — `invalid_event`;
 *   2. event-id uniqueness against applied history — `duplicate_event`;
 *   3. stream selection: `(venue, instrument)` must be a selected stream —
 *      `stream_not_selected`;
 *   4. the `as_of` anchor: `available_time <= config.as_of` —
 *      `event_beyond_as_of` (the recorded information set ends at the
 *      anchor; events available later do not belong to this world);
 *   5. anti-poisoning: `provenance.origin === 'historical'` —
 *      `synthetic_event_rejected` (L5);
 *   6. per-stream sequence discipline: strictly increasing per
 *      `venue|instrument|stream` — `duplicate_sequence` / `sequence_regression`.
 *
 * Applying a `book_snapshot` event records its event id as a world-state
 * snapshot ref (the recorded book IS the snapshot — L6).
 */
export function ingestWorld(state: ReplayWorldState, batch: readonly unknown[]): WorldResult<ReplayWorldState> {
  if (state.status === 'finished') {
    return fail('world_finished', 'a finished world accepts no further events');
  }

  // Working copies (validated against, applied only on full success).
  const appliedIds = new Set<string>(state.history.map((event) => event.event_id));
  const selectedStreams = new Set<string>(state.config.streams.map((selection) => streamSelectionKey(selection)));
  const trackers = new Map<string, StreamSequenceState>();
  for (const tracker of state.sequences) trackers.set(`${tracker.venue}|${tracker.instrument}|${tracker.stream}`, tracker);
  const accepted: WorldEvent[] = [];

  for (let index = 0; index < batch.length; index++) {
    const candidate = batch[index];

    // 1. Envelope validation (mirrored guards, collect-all within the event).
    const eventResult = validateWorldEvent(candidate);
    if (!eventResult.ok) {
      return {
        ok: false,
        errors: eventResult.errors.map((error) => ({
          ...error,
          path: error.path === '' ? `batch[${index}]` : `batch[${index}].${error.path.replace(/^event\.?/, '')}`,
          message: `batch[${index}]: ${error.message}`,
        })),
      };
    }
    const event = eventResult.value;

    // 2. Event-id uniqueness.
    if (appliedIds.has(event.event_id)) {
      return fail('duplicate_event', `event id "${event.event_id}" (batch[${index}]) has already been applied to this world`, `batch[${index}].event_id`);
    }

    // 3. Stream selection.
    if (!selectedStreams.has(`${event.venue}|${event.instrument}`)) {
      return fail(
        'stream_not_selected',
        `event "${event.event_id}" (batch[${index}]) is from stream "${event.venue}|${event.instrument}" which is not part of the world's stream selection`,
        `batch[${index}].venue`,
      );
    }

    // 4. The as_of anchor (the WORLD anchor; the episode anchor polices advancement).
    if (event.available_time > state.config.as_of) {
      return fail(
        'event_beyond_as_of',
        `event "${event.event_id}" (batch[${index}]) becomes available at ${event.available_time}, after the world's as_of anchor ${state.config.as_of} — the recorded information set ends at the anchor`,
        `batch[${index}].available_time`,
      );
    }

    // 5. Anti-poisoning: recorded history only (L5).
    if (event.provenance.origin !== 'historical') {
      return fail(
        'synthetic_event_rejected',
        `event "${event.event_id}" (batch[${index}]) declares origin '${event.provenance.origin}' — the exact-replay world accepts recorded history only (simulated participants are T027, generative worlds are T028)`,
        `batch[${index}].provenance.origin`,
      );
    }

    // 6. Per-stream sequence discipline (strictly increasing in arrival order).
    const key = sequenceKeyOf(event);
    const tracker = trackers.get(key);
    if (tracker !== undefined) {
      if (event.sequence === tracker.last_sequence) {
        return fail(
          'duplicate_sequence',
          `event "${event.event_id}" (batch[${index}]) carries sequence ${event.sequence} for stream "${key}", equal to the applied high-water mark (duplicate)`,
          `batch[${index}].sequence`,
        );
      }
      if (event.sequence < tracker.last_sequence) {
        return fail(
          'sequence_regression',
          `event "${event.event_id}" (batch[${index}]) carries sequence ${event.sequence} for stream "${key}", below the applied high-water mark ${tracker.last_sequence} (regression)`,
          `batch[${index}].sequence`,
        );
      }
    }

    // Accept: evolve the working state.
    appliedIds.add(event.event_id);
    const venue = event.venue as VenueId;
    const instrument = event.instrument as InstrumentId;
    const stream = sequenceStream(event);
    trackers.set(
      key,
      tracker === undefined
        ? deepFreeze({ venue, instrument, stream, last_sequence: event.sequence, event_count: 1 })
        : deepFreeze({ venue, instrument, stream, last_sequence: event.sequence, event_count: tracker.event_count + 1 }),
    );
    accepted.push(event);
  }

  const sequences = [...trackers.values()].sort((a, b) =>
    `${a.venue}|${a.instrument}|${a.stream}` < `${b.venue}|${b.instrument}|${b.stream}`
      ? -1
      : `${a.venue}|${a.instrument}|${a.stream}` > `${b.venue}|${b.instrument}|${b.stream}`
        ? 1
        : 0,
  );

  const snapshotRefs = [...state.snapshot_refs];
  for (const event of accepted) {
    if (event.event_type === 'book_snapshot') {
      snapshotRefs.push(event.event_id as WorldSnapshotRef);
    }
  }

  return ok(
    deepFreeze({
      ...state,
      history: [...state.history, ...accepted],
      sequences,
      snapshot_refs: deepFreeze(snapshotRefs),
    }),
  );
}

// ---------------------------------------------------------------------------
// observe — the firewall OUT (L4)
// ---------------------------------------------------------------------------

/**
 * PURE QUERY — the point-in-time observation delivery (L4). Returns the
 * applied events visible at instant `at` under the INCLUSIVE boundary
 * `available_time <= at`. `at` may be any instant `<= clock.now` (`at == now`
 * is the live step; `at < now` is a Time-Machine query); `at > now` fails
 * with `observation_beyond_now`. Order: arrival order (the recorded stream
 * order) — deterministic. Derived events obey the same law: the filter
 * never consults provenance.
 */
export function observeWorld(state: ReplayWorldState, at: TimestampMs): WorldResult<readonly WorldEvent[]> {
  if (!isTimestampMs(at)) {
    return fail('invalid_timestamp', 'observe requires a valid TimestampMs instant');
  }
  if (at > state.clock.now) {
    return fail(
      'observation_beyond_now',
      `cannot observe at ${at}: the world's current now is ${state.clock.now}`,
    );
  }
  return ok(state.history.filter((event) => event.available_time <= at));
}

// ---------------------------------------------------------------------------
// advance — monotonic, anchored
// ---------------------------------------------------------------------------

/**
 * Advance the world clock to `to`. Monotonic (`to >= now`, else
 * `clock_regression`) and anchored (`to <= clock.asOf`, else `beyond_as_of`)
 * — the exact law of time-engine's `advanceClockTo`, mirrored. `to == now`
 * is a legal no-op advance. Advancing a finished world fails with
 * `world_finished`.
 */
export function advanceWorld(state: ReplayWorldState, to: TimestampMs): WorldResult<ReplayWorldState> {
  if (state.status === 'finished') {
    return fail('world_finished', `the world is finished; the clock is frozen at ${state.clock.now}`);
  }
  const clockResult = advanceClockStateTo(state.clock, to);
  if (!clockResult.ok) return clockResult;
  const clock: ClockState = clockResult.value;
  return ok(deepFreeze({ ...state, clock }));
}

// ---------------------------------------------------------------------------
// finish
// ---------------------------------------------------------------------------

/**
 * Finish the world with an explicit termination reason: terminal state
 * (further ingest/advance fail with `world_finished`; observation queries
 * remain legal — they are audit-side and side-effect-free).
 */
export function finishWorld(state: ReplayWorldState, reason: TerminationReason): WorldResult<ReplayWorldState> {
  if (state.status === 'finished') {
    return fail('world_finished', 'the world is already finished');
  }
  return ok(
    deepFreeze({
      ...state,
      status: 'finished',
      termination: deepFreeze({ code: reason.code, detail: reason.detail }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Structural precondition helper (transitions reject foreign values loudly)
// ---------------------------------------------------------------------------

/** Assert (via the total guard) that a transition input is a valid world state. */
export function requireWorldState(state: ReplayWorldState): WorldResult<ReplayWorldState> {
  if (!isReplayWorldState(state)) {
    return fail('invalid_state', 'transitions operate on structurally valid ReplayWorldState values only');
  }
  return ok(state);
}
