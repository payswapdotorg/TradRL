/**
 * @tradrl/event-store — sequence discipline.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol/src/sequence.ts (law D-004:
 * never imports; trip-wired by `packages/provenance/src/interop.test.ts`
 * against the same fixture shapes). Within one event stream — identified
 * by (venue, instrument, event stream, where the stream is the event type
 * and for `other` events the free-form payload `kind`) — the `sequence`
 * field must be STRICTLY INCREASING in arrival order. Equal sequences are
 * duplicates; lower sequences are regressions. Different streams have
 * INDEPENDENT sequences.
 *
 * The store enforces the discipline INCREMENTALLY at commit: each event is
 * checked against the store's per-stream high-water mark AND the
 * high-water marks accumulated within the batch being committed (a batch
 * is atomic — on any violation nothing is appended).
 *
 * One narrow payload interpretation is required and documented: `other`
 * events scope their stream by `payload.kind` (exactly T004's
 * `sequenceStream` semantics — the store's envelope validation rejects
 * `other` events without a kind before sequencing ever sees them; the
 * defensive fallback `other:` keeps this function total).
 */

import { isNonEmptyString, isRecord } from './fields';
import type { EventType } from './taxonomy';

/** The stream identifier of an event: its event type, qualified for `other`. */
export type SequenceStream = string;

/** The full sequence scope key: `venue|instrument|stream`. */
export type SequenceKey = string;

/** Minimal structural shape the sequence discipline needs from an event. */
export interface SequencedEvent {
  readonly event_id: string;
  readonly venue: string;
  readonly instrument: string;
  readonly event_type: EventType;
  readonly sequence: number;
  readonly payload: object;
}

/** Narrow payload peek: the free-form `kind` of an `other` event (null otherwise). */
export function payloadKindOf(payload: object): string | null {
  if (isRecord(payload) && isNonEmptyString(payload.kind) && typeof payload.kind === 'string') {
    return payload.kind;
  }
  return null;
}

/** Resolve the stream of an event (`other` events are scoped by their kind). Mirror of T004's sequenceStream. */
export function sequenceStreamOf(eventType: EventType, payload: object): SequenceStream {
  return eventType === 'other' ? `other:${payloadKindOf(payload) ?? ''}` : eventType;
}

/** The per-stream scope key of an event: venue + instrument + stream. Mirror of T004's sequenceKey. */
export function sequenceKeyOf(event: SequencedEvent): SequenceKey {
  return `${event.venue}|${event.instrument}|${sequenceStreamOf(event.event_type, event.payload)}`;
}

/** A stream-discipline violation. Mirror of T004's SequenceViolation shapes. */
export type SequenceViolation =
  | {
      readonly kind: 'regressed_sequence';
      readonly key: SequenceKey;
      /** Index (in the validated array) of the offending event. */
      readonly index: number;
      readonly previousIndex: number;
      readonly previousSequence: number;
      readonly sequence: number;
      readonly eventId: string;
    }
  | {
      readonly kind: 'duplicate_sequence';
      readonly key: SequenceKey;
      readonly index: number;
      readonly previousIndex: number;
      readonly sequence: number;
      readonly eventId: string;
    };

/** Outcome of {@link validateBatchSequences}. */
export interface SequenceValidation {
  readonly ok: boolean;
  readonly violations: readonly SequenceViolation[];
}

/**
 * Validate that sequences are strictly increasing per stream, in the GIVEN
 * array order (the arrival order). Returns every violation. Mirror of
 * T004's `validateSequenceMonotonicity` — identical semantics on identical
 * fixture shapes.
 */
export function validateBatchSequences(events: readonly SequencedEvent[]): SequenceValidation {
  const violations: SequenceViolation[] = [];
  const lastSeen = new Map<SequenceKey, { sequence: number; index: number }>();

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event === undefined) continue;
    const key = sequenceKeyOf(event);
    const previous = lastSeen.get(key);
    if (previous !== undefined) {
      if (event.sequence === previous.sequence) {
        violations.push({
          kind: 'duplicate_sequence',
          key,
          index,
          previousIndex: previous.index,
          sequence: event.sequence,
          eventId: event.event_id,
        });
      } else if (event.sequence < previous.sequence) {
        violations.push({
          kind: 'regressed_sequence',
          key,
          index,
          previousIndex: previous.index,
          previousSequence: previous.sequence,
          sequence: event.sequence,
          eventId: event.event_id,
        });
      }
    }
    if (previous === undefined || event.sequence > previous.sequence) {
      lastSeen.set(key, { sequence: event.sequence, index });
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * A stateful per-stream high-water tracker. STRUCTURAL MIRROR of T004's
 * `SequenceTracker` (identical next/observe/peek semantics) — the store
 * keeps one per stream and folds committed sequences into it so future
 * commits are checked against the committed high-water mark.
 */
export interface StreamSequencer {
  /** Reserve and return the next sequence for a stream. */
  next(key: SequenceKey): number;
  /** Fold an externally-assigned sequence into the high-water mark. */
  observe(key: SequenceKey, sequence: number): void;
  /** Current high-water mark for a stream (0 when unseen). */
  peek(key: SequenceKey): number;
}

export function createStreamSequencer(): StreamSequencer {
  const highWater = new Map<SequenceKey, number>();
  return {
    next(key: SequenceKey): number {
      const next = (highWater.get(key) ?? 0) + 1;
      highWater.set(key, next);
      return next;
    },
    observe(key: SequenceKey, sequence: number): void {
      const current = highWater.get(key) ?? 0;
      if (sequence > current) highWater.set(key, sequence);
    },
    peek(key: SequenceKey): number {
      return highWater.get(key) ?? 0;
    },
  };
}

/**
 * Check one event against a high-water tracker WITHOUT folding it in.
 * Returns the violation (duplicate/regressed) or null. The caller folds
 * with `observe` after deciding to accept.
 */
export function checkSequence(
  sequencer: StreamSequencer,
  event: SequencedEvent,
  index: number,
): SequenceViolation | null {
  const key = sequenceKeyOf(event);
  const high = sequencer.peek(key);
  if (high === 0) return null; // unseen stream — any non-negative sequence starts it
  if (event.sequence === high) {
    return {
      kind: 'duplicate_sequence',
      key,
      index,
      previousIndex: -1, // previous is the store high-water mark, not a batch position
      sequence: event.sequence,
      eventId: event.event_id,
    };
  }
  if (event.sequence < high) {
    return {
      kind: 'regressed_sequence',
      key,
      index,
      previousIndex: -1,
      previousSequence: high,
      sequence: event.sequence,
      eventId: event.event_id,
    };
  }
  return null;
}
