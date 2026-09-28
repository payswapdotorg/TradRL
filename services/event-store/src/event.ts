/**
 * @tradrl/event-store — the storable event envelope.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's `MarketEvent` envelope
 * (law D-004: never imports; a compile-time trip wire in
 * `packages/provenance/src/interop.test.ts` proves a validated
 * `MarketEvent` is assignable to `StorableEvent`, so the store accepts
 * canonical events as-is).
 *
 * THE AVAILABILITY QUARTET (all four REQUIRED on input):
 *
 *   - `event_time`      — when it happened in the world.
 *   - `source_time`     — when the source says it happened (null when the
 *                          source does not say). ADVISORY; no ordering
 *                          enforced (mirror of the envelope contract).
 *   - `available_time`  — the earliest an agent may legitimately observe
 *                          it. THE information-boundary input (L4).
 *                          Enforced: `available_time >= event_time` — the
 *                          ONE enforced ordering (T004's ratified D-003:
 *                          no other quartet order is policed here).
 *   - `ingestion_time`  — ADVISORY on input (when the adapter/normalizer
 *                          locally saw the record). The STORE re-stamps it
 *                          at commit — the definitive ingestion time is
 *                          the commit stamp, never earlier (L4: ingestion
 *                          NEVER rewrites `available_time`; the quartet
 *                          stays complete and honest).
 *
 * Payloads are OPAQUE to the store (typed `object`, guarded as records):
 * payload SEMANTICS are owned by @tradrl/market-protocol; the store
 * enforces the envelope floor — quartet, ids, taxonomy membership,
 * sequence, provenance — plus the one structural payload rule the sequence
 * discipline requires (`other` events carry a payload `kind`).
 *
 * Derived-availability rule (mirror of @tradrl/time-engine's
 * `validateDerivedAvailability`): a derived event's `available_time` must
 * be >= every in-store parent's `available_time` — checked at commit by
 * the store (see checkDerivedAvailability below).
 */

import {
  invalidField,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isRecord,
  missingField,
  type EventId,
  type InstrumentId,
  type LineageId,
  type ProviderId,
  type VenueId,
} from './fields';
import type { StoreError } from './fields';
import { isTimestampMs, type TimestampMs } from './timestamp';
import { isAssetClass, isEventType, type AssetClass, type EventType } from './taxonomy';
import { payloadKindOf, type SequencedEvent } from './sequence';
import { validateStorableProvenance, type StorableProvenance } from './provenance';

/** The event as it is SUBMITTED for commit (ingestion_time advisory — re-stamped at commit). */
export interface StorableEvent {
  readonly event_id: EventId;
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  readonly asset_class: AssetClass;
  readonly event_type: EventType;
  readonly event_time: TimestampMs;
  readonly source_time: TimestampMs | null;
  readonly available_time: TimestampMs;
  readonly ingestion_time: TimestampMs;
  readonly sequence: number;
  readonly provider: ProviderId;
  readonly provenance: StorableProvenance;
  /** Opaque payload record — semantics owned by @tradrl/market-protocol. */
  readonly payload: object;
}

/** The event as STORED: quartet with the commit-stamped ingestion_time + custody-stamped provenance. */
export interface StoredEvent extends Omit<StorableEvent, 'ingestion_time' | 'provenance'> {
  /** Stamped by the store at commit — the definitive ingestion time. */
  readonly ingestion_time: TimestampMs;
  readonly provenance: import('./provenance').StoredProvenance;
}

/**
 * Validate an untrusted value as a StorableEvent. Collects EVERY violation
 * (typed errors, dotted paths). Never throws. Mirrors
 * market-protocol's `validateMarketEvent` discipline for the fields the
 * store owns (quartet, ids, taxonomy, sequence shape, provenance,
 * payload-record floor, other-kind rule); payload semantics are
 * market-protocol's contract, deliberately not duplicated here.
 */
export function validateStorableEvent(value: unknown): { readonly ok: boolean; readonly errors: readonly StoreError[] } {
  const errors: StoreError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [{ code: 'invalid_type', path: '', message: 'a storable event must be an object' }] };
  }

  // Discriminant first (an unknown type still leaves the rest diagnosable).
  if (value.event_type === undefined) {
    errors.push(missingField('event_type'));
  } else if (!isEventType(value.event_type)) {
    errors.push({
      code: 'unknown_event_type',
      path: 'event_type',
      message: `"${String(value.event_type)}" is not a canonical event type`,
    });
  }

  // Opaque string identifiers.
  for (const field of ['event_id', 'venue', 'instrument', 'provider'] as const) {
    const fieldValue = value[field];
    if (fieldValue === undefined) errors.push(missingField(field));
    else if (!isNonEmptyString(fieldValue)) errors.push(invalidField(field, 'must be a non-empty string'));
  }

  // Asset class.
  if (value.asset_class === undefined) errors.push(missingField('asset_class'));
  else if (!isAssetClass(value.asset_class))
    errors.push({ code: 'unknown_asset_class', path: 'asset_class', message: `"${String(value.asset_class)}" is not a canonical asset class` });

  // The availability quartet.
  const eventTime = value.event_time;
  if (eventTime === undefined) errors.push(missingField('event_time'));
  else if (!isTimestampMs(eventTime))
    errors.push(invalidField('event_time', 'must be a valid epoch-millisecond timestamp'));

  if (value.source_time === undefined) errors.push(missingField('source_time'));
  else if (value.source_time !== null && !isTimestampMs(value.source_time))
    errors.push(invalidField('source_time', 'must be a valid epoch-millisecond timestamp or null'));

  const availableTime = value.available_time;
  if (availableTime === undefined) errors.push(missingField('available_time'));
  else if (!isTimestampMs(availableTime))
    errors.push(invalidField('available_time', 'must be a valid epoch-millisecond timestamp'));

  if (value.ingestion_time === undefined) errors.push(missingField('ingestion_time'));
  else if (!isTimestampMs(value.ingestion_time))
    errors.push(invalidField('ingestion_time', 'must be a valid epoch-millisecond timestamp (advisory on input; stamped at commit)'));

  // The ONE enforced ordering (T004's ratified D-003).
  if (isTimestampMs(eventTime) && isTimestampMs(availableTime) && availableTime < eventTime) {
    errors.push({
      code: 'timestamp_order',
      path: 'available_time',
      message: `available_time (${availableTime}) precedes event_time (${eventTime}) — information about an event cannot be observable before the event occurred; adapters must clamp vendor clock skew`,
    });
  }

  // Sequence: a per-stream ordinal; stream-level monotonicity is a property
  // of a stream (checked at commit against store + batch state).
  if (value.sequence === undefined) errors.push(missingField('sequence'));
  else if (!isNonNegativeSafeInteger(value.sequence))
    errors.push(invalidField('sequence', 'must be a non-negative safe integer'));

  // Provenance (needs event_id for the self-reference rule).
  if (value.provenance === undefined) {
    errors.push(missingField('provenance'));
  } else {
    errors.push(...validateStorableProvenance(value.provenance, typeof value.event_id === 'string' ? value.event_id : ''));
  }

  // Payload: opaque record floor (+ the other-kind rule the sequence
  // discipline requires).
  if (value.payload === undefined) {
    errors.push(missingField('payload'));
  } else if (!isRecord(value.payload)) {
    errors.push(invalidField('payload', 'must be an object (payload semantics are owned by @tradrl/market-protocol)'));
  } else if (value.event_type === 'other' && payloadKindOf(value.payload) === null) {
    errors.push({
      code: 'other_kind_required',
      path: 'payload.kind',
      message: 'other events must carry a non-empty string kind — the sequence discipline scopes their stream by it',
    });
  }

  return { ok: errors.length === 0, errors };
}

/** Narrowing guard for untrusted input. */
export function isStorableEvent(value: unknown): value is StorableEvent {
  return validateStorableEvent(value).ok;
}

/**
 * Derived-availability rule — STRUCTURAL MIRROR of
 * @tradrl/time-engine's `validateDerivedAvailability` (law D-004), enforced
 * by the store at commit: a derived event (non-empty `derived_from`) may
 * not be available before its LATEST in-store parent. `parentTimes` are
 * the `available_time` values of the parents the store knows; external
 * parents (not in the store) contribute nothing (they cannot be checked).
 * Returns the typed violation or null.
 */
export function checkDerivedAvailability(
  event: StorableEvent,
  parentTimes: readonly TimestampMs[],
): StoreError | null {
  if (event.provenance.derived_from.length === 0) return null;
  if (parentTimes.length === 0) return null;
  let latest = parentTimes[0] as TimestampMs;
  for (const time of parentTimes) {
    if (time > latest) latest = time;
  }
  if (event.available_time < latest) {
    return {
      code: 'derived_before_inputs',
      path: 'available_time',
      message: `derived event available_time (${event.available_time}) precedes its latest in-store parent (${latest}) — mirrors @tradrl/time-engine derived_before_inputs`,
    };
  }
  return null;
}

/** Type re-export used by the sequence module consumers. */
export type { SequencedEvent };

/** Structural: a storable event is a sequenced event. */
export function asSequencedEvent(event: StorableEvent): SequencedEvent {
  return event;
}

/** Lineage list of an event (its derived_from parent ids). */
export function lineageOf(event: StorableEvent): readonly LineageId[] {
  return event.provenance.derived_from;
}
