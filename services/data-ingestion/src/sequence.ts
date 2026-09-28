/**
 * @tradrl/data-ingestion — sequence pre-check discipline.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's `sequence.ts` (law D-004:
 * never imports; trip-wired against the same fixture shapes). Within one
 * event stream — (venue, instrument, event type, `other` events scoped by
 * payload `kind`) — the `sequence` field must be STRICTLY INCREASING in
 * arrival order. The pipeline pre-checks batches before committing; the
 * store re-checks against its own high-water marks (defense in depth).
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

/** The per-stream scope key of an event. Mirror of T004's sequenceKey. */
export function sequenceKeyOf(event: SequencedEvent): SequenceKey {
  return `${event.venue}|${event.instrument}|${sequenceStreamOf(event.event_type, event.payload)}`;
}

/** A stream-discipline violation found by the batch pre-check. Mirror of T004's SequenceViolation shapes. */
export type SequenceViolation =
  | {
      readonly kind: 'regressed_sequence';
      readonly key: SequenceKey;
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
 * T004's `validateSequenceMonotonicity` — identical semantics on
 * identical fixture shapes.
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
