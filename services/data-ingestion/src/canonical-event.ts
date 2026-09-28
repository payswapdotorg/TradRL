/**
 * @tradrl/data-ingestion — the canonical event (envelope mirror).
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's `MarketEvent` envelope
 * (law D-004: never imports; trip-wires in
 * `packages/provenance/src/interop.test.ts` prove that a validated
 * `MarketEvent` is assignable to `CanonicalEvent` — the pipeline accepts
 * canonical events as-is — and that the synthetic adapters' output passes
 * market-protocol's own `validateMarketEvent`).
 *
 * THE AVAILABILITY QUARTET (all four REQUIRED):
 *
 *   - `event_time`     — when it happened in the world.
 *   - `source_time`    — when the source says it happened (null when the
 *                        source does not say). ADVISORY; unordered.
 *   - `available_time` — the earliest an agent may legitimately observe it
 *                        (L4). Enforced: `available_time >= event_time` —
 *                        the ONE enforced ordering (T004's ratified D-003).
 *   - `ingestion_time` — ADVISORY here (when the normalizer locally saw
 *                        the record). The STORE re-stamps it at commit;
 *                        ingestion NEVER rewrites `available_time`.
 *
 * Payloads are OPAQUE records (typed `object`): payload SEMANTICS are
 * market-protocol's contract; the ingestion plane enforces the envelope
 * floor plus the `other:kind` rule the sequence discipline requires.
 */

import {
  invalidField,
  invalidType,
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
import type { ValidationFailure } from './fields';
import { isTimestampMs, type TimestampMs } from './timestamp';
import { isAssetClass, isEventType, type AssetClass, type EventType } from './taxonomy';
import { payloadKindOf } from './sequence';
import { validateIngestionProvenance, type IngestionProvenance } from './provenance';

/** A canonical, provider-neutral, event-shaped record produced by an adapter. */
export interface CanonicalEvent {
  readonly event_id: EventId;
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  readonly asset_class: AssetClass;
  readonly event_type: EventType;
  readonly event_time: TimestampMs;
  readonly source_time: TimestampMs | null;
  readonly available_time: TimestampMs;
  /** ADVISORY on input — the store stamps the definitive ingestion time at commit. */
  readonly ingestion_time: TimestampMs;
  readonly sequence: number;
  readonly provider: ProviderId;
  readonly provenance: IngestionProvenance;
  /** Opaque payload record — semantics owned by @tradrl/market-protocol. */
  readonly payload: object;
}

/** Validation outcome for one candidate event. */
export interface CanonicalEventValidation {
  readonly ok: boolean;
  readonly errors: readonly ValidationFailure[];
}

/**
 * Validate an untrusted value as a CanonicalEvent. Collects EVERY
 * violation (typed errors, dotted paths). Never throws. Mirrors
 * market-protocol's `validateMarketEvent` discipline for the fields the
 * ingestion plane owns.
 */
export function validateCanonicalEvent(value: unknown): CanonicalEventValidation {
  const errors: ValidationFailure[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('a canonical event must be an object')] };
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

  for (const field of ['event_id', 'venue', 'instrument', 'provider'] as const) {
    const fieldValue = value[field];
    if (fieldValue === undefined) errors.push(missingField(field));
    else if (!isNonEmptyString(fieldValue)) errors.push(invalidField(field, 'must be a non-empty string'));
  }

  if (value.asset_class === undefined) errors.push(missingField('asset_class'));
  else if (!isAssetClass(value.asset_class))
    errors.push({
      code: 'unknown_asset_class',
      path: 'asset_class',
      message: `"${String(value.asset_class)}" is not a canonical asset class`,
    });

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
    errors.push(
      invalidField('ingestion_time', 'must be a valid epoch-millisecond timestamp (advisory; stamped at commit)'),
    );

  // The ONE enforced ordering (T004's ratified D-003).
  if (isTimestampMs(eventTime) && isTimestampMs(availableTime) && availableTime < eventTime) {
    errors.push({
      code: 'timestamp_order',
      path: 'available_time',
      message: `available_time (${availableTime}) precedes event_time (${eventTime}) — information about an event cannot be observable before the event occurred; adapters must clamp vendor clock skew`,
    });
  }

  if (value.sequence === undefined) errors.push(missingField('sequence'));
  else if (!isNonNegativeSafeInteger(value.sequence))
    errors.push(invalidField('sequence', 'must be a non-negative safe integer'));

  if (value.provenance === undefined) {
    errors.push(missingField('provenance'));
  } else {
    errors.push(
      ...validateIngestionProvenance(value.provenance, typeof value.event_id === 'string' ? value.event_id : ''),
    );
  }

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
export function isCanonicalEvent(value: unknown): value is CanonicalEvent {
  return validateCanonicalEvent(value).ok;
}

/** Lineage list of an event (its derived_from parent ids). */
export function lineageOf(event: CanonicalEvent): readonly LineageId[] {
  return event.provenance.derived_from;
}
