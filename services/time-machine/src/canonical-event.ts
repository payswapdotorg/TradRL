/**
 * @tradrl/time-machine — the canonical event (T008 ingestion contract mirror).
 *
 * STRUCTURAL MIRROR of @tradrl/data-ingestion's `CanonicalEvent` — which is
 * itself the structural mirror of @tradrl/market-protocol's `MarketEvent`
 * envelope (law D-004: never imports; the vendored T026 reference shapes and
 * `src/interop.test.ts` are the drift trip wires). The rolling time machine
 * ingests canonical events EXACTLY as the T008 ingestion plane produces
 * them.
 *
 * THE AVAILABILITY QUARTET (all four REQUIRED):
 *
 *   - `event_time`      — when it happened in the world.
 *   - `source_time`     — when the source says it happened (null when the
 *                         source does not say). ADVISORY; unordered.
 *   - `available_time`  — the earliest an agent may legitimately observe it
 *                         (L4). Enforced: `available_time >= event_time` —
 *                         the ONE enforced ordering (T004's ratified D-003).
 *   - `ingestion_time`  — ADVISORY here (when the adapter/normalizer saw
 *                         the record). The TIME MACHINE re-stamps it at
 *                         admission from the injected ingest clock — the
 *                         definitive ingestion time is the admission stamp,
 *                         never earlier; admission NEVER rewrites
 *                         `available_time`; the quartet stays complete and
 *                         honest (mirrors the T008 store commit stamping).
 *
 * Payloads are OPAQUE records: payload SEMANTICS are market-protocol's
 * contract; this module enforces the envelope floor plus the one structural
 * payload rule the sequence discipline requires (`other` events carry a
 * non-empty payload `kind`).
 */

import { isTimestampMs, type TimestampMs } from './timestamp';
import { validateIngestionProvenance, type IngestionProvenance } from './provenance';

/** The canonical event-type discriminator (mirror of market-protocol / data-ingestion). */
export type EventType =
  | 'trade'
  | 'quote'
  | 'book_snapshot'
  | 'book_delta'
  | 'ohlcv'
  | 'news'
  | 'macro_release'
  | 'social_signal'
  | 'fundamental'
  | 'option_chain_mark'
  | 'other';

/** The canonical asset-class discriminator (mirror of market-protocol / data-ingestion). */
export type AssetClass =
  | 'equity'
  | 'crypto'
  | 'fx'
  | 'commodity'
  | 'future'
  | 'option'
  | 'bond'
  | 'index';

/** The canonical event-type taxonomy (mirror of market-protocol / data-ingestion). */
export const EVENT_TYPES: readonly EventType[] = [
  'trade',
  'quote',
  'book_snapshot',
  'book_delta',
  'ohlcv',
  'news',
  'macro_release',
  'social_signal',
  'fundamental',
  'option_chain_mark',
  'other',
] as const;

/** The canonical asset-class taxonomy (mirror of market-protocol / data-ingestion). */
export const ASSET_CLASSES: readonly AssetClass[] = [
  'equity',
  'crypto',
  'fx',
  'commodity',
  'future',
  'option',
  'bond',
  'index',
] as const;

/** Runtime guard for the event-type discriminator. */
export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

/** Runtime guard for the asset-class discriminator. */
export function isAssetClass(value: unknown): value is AssetClass {
  return typeof value === 'string' && (ASSET_CLASSES as readonly string[]).includes(value);
}

/** Minimal non-null object guard (mirror of the lanes' isRecord). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Non-empty string guard. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Non-negative safe integer guard (sequence numbers, counters). */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** A field-level validation failure (mirror of the lanes' ValidationFailure). */
export interface ValidationFailure {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** Build a missing-field failure. */
export function missingField(path: string): ValidationFailure {
  return { code: 'missing_field', path, message: `${path} is required` };
}

/** Build an invalid-field failure. */
export function invalidField(path: string, message: string): ValidationFailure {
  return { code: 'invalid_field', path, message };
}

/** Build an invalid-type failure. */
export function invalidType(message: string): ValidationFailure {
  return { code: 'invalid_type', path: '', message };
}

/** Narrow payload peek: the free-form `kind` of an `other` event (null otherwise). Mirror of T008's payloadKindOf. */
export function payloadKindOf(payload: object): string | null {
  if (isRecord(payload) && isNonEmptyString(payload.kind)) return payload.kind;
  return null;
}

/** A canonical, provider-neutral, event-shaped record as produced by the T008 ingestion plane. */
export interface CanonicalEvent {
  readonly event_id: string;
  readonly venue: string;
  readonly instrument: string;
  readonly asset_class: AssetClass;
  readonly event_type: EventType;
  readonly event_time: TimestampMs;
  readonly source_time: TimestampMs | null;
  readonly available_time: TimestampMs;
  /** ADVISORY on input — the time machine re-stamps it at admission. */
  readonly ingestion_time: TimestampMs;
  readonly sequence: number;
  readonly provider: string;
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
 * Validate an untrusted value as a CanonicalEvent. Collects EVERY violation
 * (typed errors, dotted paths). Never throws. Mirrors the
 * data-ingestion/market-protocol validation discipline for the fields this
 * plane owns: quartet, ids, taxonomy membership, sequence shape,
 * provenance, payload-record floor and the other-kind rule.
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

  if (value.asset_class === undefined) {
    errors.push(missingField('asset_class'));
  } else if (!isAssetClass(value.asset_class)) {
    errors.push({
      code: 'unknown_asset_class',
      path: 'asset_class',
      message: `"${String(value.asset_class)}" is not a canonical asset class`,
    });
  }

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
    errors.push(invalidField('ingestion_time', 'must be a valid epoch-millisecond timestamp (advisory on input; stamped at admission)'));

  // The ONE enforced ordering (T004's ratified D-003).
  if (isTimestampMs(eventTime) && isTimestampMs(availableTime) && availableTime < eventTime) {
    errors.push({
      code: 'timestamp_order',
      path: 'available_time',
      message: `available_time (${availableTime}) precedes event_time (${eventTime}) — information about an event cannot be observable before the event occurred; adapters must clamp vendor clock skew`,
    });
  }

  // Sequence: per-stream ordinal; STREAM-level monotonicity is the T008
  // store's law (this service sits downstream of the store and consumes its
  // committed canonical events), so only the shape is enforced here.
  if (value.sequence === undefined) {
    errors.push(missingField('sequence'));
  } else if (!isNonNegativeSafeInteger(value.sequence)) {
    errors.push(invalidField('sequence', 'must be a non-negative safe integer'));
  }

  // Provenance (needs event_id for the self-reference rule).
  if (value.provenance === undefined) {
    errors.push(missingField('provenance'));
  } else {
    errors.push(
      ...validateIngestionProvenance(value.provenance, typeof value.event_id === 'string' ? value.event_id : ''),
    );
  }

  // Payload floor + the other-kind rule.
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
