/**
 * @tradrl/market-protocol — sequence discipline.
 *
 * Within one event stream — identified by (venue, instrument, event stream,
 * where the stream is the event type, and for `other` events the free-form
 * `kind`) — the `sequence` field must be STRICTLY INCREASING in arrival
 * order. Equal sequences are duplicates; lower sequences are regressions.
 * Sub-millisecond ordering that timestamps cannot express is resolved here.
 *
 * Different streams (different venue, instrument, event type, or other-kind)
 * have INDEPENDENT sequences — they never interfere.
 */

import type { MarketEvent } from './envelope';

/** The stream identifier of an event: its event type, qualified for `other`. */
export type SequenceStream = string;

/** The full sequence scope key: `venue|instrument|stream`. */
export type SequenceKey = string;

/** Resolve the stream of an event (`other` events are scoped by their kind). */
export function sequenceStream(event: MarketEvent): SequenceStream {
  return event.event_type === 'other' ? `other:${event.payload.kind}` : event.event_type;
}

/** The per-stream scope key: venue + instrument + stream. */
export function sequenceKey(event: MarketEvent): SequenceKey {
  return `${event.venue}|${event.instrument}|${sequenceStream(event)}`;
}

/** A stream-discipline violation found by {@link validateSequenceMonotonicity}. */
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

export interface SequenceValidation {
  readonly ok: boolean;
  readonly violations: readonly SequenceViolation[];
}

/**
 * Validate that sequences are strictly increasing per stream, in the GIVEN
 * array order (the arrival order). Returns every violation.
 */
export function validateSequenceMonotonicity(events: readonly MarketEvent[]): SequenceValidation {
  const violations: SequenceViolation[] = [];
  const lastSeen = new Map<SequenceKey, { sequence: number; index: number }>();

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event === undefined) continue;
    const key = sequenceKey(event);
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
 * A small stateful helper for CONSTRUCTING events: it hands out the next
 * sequence per stream and folds in externally-assigned sequences so issued
 * numbers never collide. Pure with respect to the outside world (no I/O).
 */
export interface SequenceTracker {
  /** Reserve and return the next sequence for a stream. */
  next(key: SequenceKey): number;
  /** Fold an externally-assigned sequence into the tracker's high-water mark. */
  observe(key: SequenceKey, sequence: number): void;
  /** Current high-water mark for a stream (0 when unseen). */
  peek(key: SequenceKey): number;
}

export function createSequenceTracker(): SequenceTracker {
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
