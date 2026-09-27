/**
 * @tradrl/market-protocol — the canonical MarketEvent envelope.
 *
 * Every external market observation enters TradRL as exactly this shape
 * (spec/DOMAIN-MODEL.md, "MarketEvent"). The envelope is provider-neutral:
 * vendor specifics are translated by adapters (L13) and never leak past this
 * boundary.
 *
 * THE AVAILABILITY QUARTET (all four REQUIRED):
 *
 *   - `event_time`      — when it happened in the world.
 *   - `source_time`     — when the source says it happened (null when the
 *                          source does not say). ADVISORY: source clocks
 *                          disagree with ours; that disagreement is exactly
 *                          why this field exists. No ordering is enforced.
 *   - `available_time`  — the earliest an agent may legitimately observe it.
 *                          THE information-boundary input (L4). Enforced:
 *                          `available_time >= event_time` — information about
 *                          an event cannot be observable before the event
 *                          occurred; adapters must clamp vendor clock skew.
 *   - `ingestion_time`  — when TradRL actually received it. INFORMATIONAL.
 *                          Deliberately UNORDERED against `available_time`:
 *                          embargoed data is ingested before it may be
 *                          observed (ingestion < available) and backfilled
 *                          data is ingested long after it was publicly
 *                          available (ingestion > available). The visibility
 *                          predicate never consults ingestion_time.
 *
 * Envelope validation is deliberately TIMELESS: it never compares timestamps
 * against "now" (a pure contract has no now) — withholding future-dated
 * events is the firewall's job in @tradrl/time-engine.
 *
 * Unknown/extra fields are TOLERATED (the contract is a floor; vendors add
 * fields) — required fields must still be present and valid.
 */

import { isAssetClass, isNonEmptyString, isNonNegativeSafeInteger, isRecord, invalidField, invalidType, missingField, type AssetClass, type EventId, type InstrumentId, type ProviderId, type VenueId } from './fields';
import type { MarketProtocolError, ValidationResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import { isEventType, EVENT_TYPES, type EventType, type PayloadOf } from './event-types';
import { payloadRegistry } from './payloads/registry';
import { validateProvenance, type Provenance } from './provenance';

/** Fields shared by every event regardless of type. */
interface EnvelopeCommon {
  readonly event_id: EventId;
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  readonly asset_class: AssetClass;
  readonly event_time: TimestampMs;
  readonly source_time: TimestampMs | null;
  readonly available_time: TimestampMs;
  readonly ingestion_time: TimestampMs;
  readonly sequence: number;
  readonly provider: ProviderId;
  readonly provenance: Provenance;
}

/** A market event of a specific type — the discriminant narrows the payload. */
export type MarketEventFor<K extends EventType> = EnvelopeCommon & {
  readonly event_type: K;
  readonly payload: PayloadOf<K>;
};

/** The canonical provider-neutral market event: a discriminated union over the taxonomy. */
export type MarketEvent = { [K in EventType]: MarketEventFor<K> }[EventType];

export type TradeEvent = MarketEventFor<'trade'>;
export type QuoteEvent = MarketEventFor<'quote'>;
export type BookSnapshotEvent = MarketEventFor<'book_snapshot'>;
export type BookDeltaEvent = MarketEventFor<'book_delta'>;
export type OhlcvEvent = MarketEventFor<'ohlcv'>;
export type NewsEvent = MarketEventFor<'news'>;
export type MacroReleaseEvent = MarketEventFor<'macro_release'>;
export type SocialSignalEvent = MarketEventFor<'social_signal'>;
export type FundamentalEvent = MarketEventFor<'fundamental'>;
export type OptionChainMarkEvent = MarketEventFor<'option_chain_mark'>;
export type OtherEvent = MarketEventFor<'other'>;

/** Prefix payload-relative error paths with `payload.`. */
function prefixPayloadPath(errors: readonly MarketProtocolError[]): MarketProtocolError[] {
  return errors.map((error) => ({
    ...error,
    path: error.path === '' ? 'payload' : `payload.${error.path}`,
  }));
}

/**
 * Validate an untrusted value as a MarketEvent. Collects EVERY violation
 * (typed errors, dotted paths). Never throws.
 */
export function validateMarketEvent(value: unknown): ValidationResult<MarketEvent> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('a market event must be an object')] };
  }

  const errors: MarketProtocolError[] = [];

  // Discriminant first: an unknown event type means we cannot pick a payload
  // validator, but the remaining fields are still validated for diagnostics.
  const eventType = value.event_type;
  if (eventType === undefined) {
    errors.push(missingField('event_type'));
  } else if (!isEventType(eventType)) {
    errors.push({
      code: 'unknown_event_type',
      path: 'event_type',
      message: `"${String(eventType)}" is not a canonical event type (${EVENT_TYPES.join(' | ')})`,
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
    errors.push(invalidField('asset_class', 'must be a canonical asset class'));

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
    errors.push(invalidField('ingestion_time', 'must be a valid epoch-millisecond timestamp'));

  // The one enforced timestamp ordering: availability cannot precede occurrence.
  if (isTimestampMs(eventTime) && isTimestampMs(availableTime) && availableTime < eventTime) {
    errors.push({
      code: 'timestamp_order',
      path: 'available_time',
      message: `available_time (${availableTime}) precedes event_time (${eventTime}) — information about an event cannot be observable before the event occurred; adapters must clamp vendor clock skew`,
    });
  }

  // Sequence: a per-stream ordinal; stream-level monotonicity is validated by
  // the sequence module (it is a property of a stream, not of one event).
  if (value.sequence === undefined) errors.push(missingField('sequence'));
  else if (!isNonNegativeSafeInteger(value.sequence))
    errors.push(invalidField('sequence', 'must be a non-negative safe integer'));

  // Provenance (needs event_id for the self-reference rule).
  if (value.provenance === undefined) {
    errors.push(missingField('provenance'));
  } else {
    errors.push(...validateProvenance(value.provenance, typeof value.event_id === 'string' ? value.event_id : ''));
  }

  // Payload, through the registry keyed by event type.
  if (value.payload === undefined) {
    errors.push(missingField('payload'));
  } else if (isEventType(eventType)) {
    errors.push(...prefixPayloadPath(payloadRegistry[eventType].validate(value.payload)));
  }

  if (errors.length > 0) return { ok: false, errors };
  // Safe: every required field has been validated above (excess fields are a
  // tolerated forward-compatible floor); the cast only refines the static type.
  return { ok: true, value: value as unknown as MarketEvent };
}

/** Narrowing guard for untrusted input. */
export function isMarketEvent(value: unknown): value is MarketEvent {
  return validateMarketEvent(value).ok;
}

/** Validate a batch; results are position-aligned with the input. */
export function validateMarketEvents(values: readonly unknown[]): ValidationResult<MarketEvent>[] {
  return values.map((value) => validateMarketEvent(value));
}
