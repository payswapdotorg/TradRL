/**
 * @tradrl/market-world — the WorldEvent envelope: structural mirror of
 * @tradrl/market-protocol's canonical `MarketEvent` (T004).
 *
 * THE STREAM IN, THE FIREWALL OUT (work order T009): every event record
 * entering a replay world is validated by THIS package's own mirrored guards
 * — the world never imports the market lane. A canonical `MarketEvent` is
 * assignable to a `WorldEvent` without casts (proven in src/interop.test.ts).
 *
 * Mirrored semantics (see packages/market-protocol/src/envelope.ts — the
 * authority is contracts/market/01-market-event-envelope.md):
 *
 * THE AVAILABILITY QUARTET (all four REQUIRED):
 *   - `event_time`     — when it happened in the world.
 *   - `source_time`    — when the source says it happened (null allowed).
 *                        ADVISORY; no ordering enforced.
 *   - `available_time` — the earliest a consumer may legitimately observe
 *                        it. THE information-boundary input (L4). Enforced:
 *                        `available_time >= event_time` (D-003 ratification).
 *   - `ingestion_time` — when TradRL received it. INFORMATIONAL, deliberately
 *                        UNORDERED against `available_time` (embargo and
 *                        backfill are both legitimate).
 *
 * DELIBERATE DIVERGENCE from market-protocol (one, documented): this mirror
 * additionally requires the WHOLE envelope to be a JSON value
 * (`isJsonValue`). Exact replay PERSISTS history — world states serialize
 * for resume (L9) and run records serialize for lineage — so a recorded
 * event carrying non-JSON excess fields (functions, symbols, cycles) would
 * corrupt the persistence contract. Known fields are identical; only
 * non-JSON excess fields are rejected.
 *
 * Payload opacity: market-protocol types payloads per taxonomy entry; the
 * replay world does NOT interpret payload semantics, so the mirror carries
 * the payload as an opaque {@link JsonValue}. Exactly ONE payload probe is
 * mirrored because the sequence discipline needs it: an `other` event MUST
 * carry a non-empty `kind` and a JSON-object `data` (the escape hatch names
 * itself — market-protocol's OtherPayload rule).
 */

import { deepFreeze, isNonEmptyString, isNonNegativeSafeInteger, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type WorldError, type WorldResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import { isJsonObject, isJsonValue, type JsonValue } from './json';

// ---------------------------------------------------------------------------
// Taxonomies (mirrors of market-protocol fields.ts / event-types.ts)
// ---------------------------------------------------------------------------

/** Canonical asset classes. Mirror of market-protocol's ASSET_CLASSES. */
export const ASSET_CLASSES = [
  'crypto',
  'equity',
  'index',
  'future',
  'option',
  'forex',
  'commodity',
  'macro',
  'other',
] as const;

/** Canonical asset class type. Mirror of market-protocol's AssetClass. */
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Runtime guard for a canonical asset class. */
export function isAssetClass(value: unknown): value is AssetClass {
  return typeof value === 'string' && (ASSET_CLASSES as readonly string[]).includes(value);
}

/**
 * The canonical event-type discriminants. Mirror of market-protocol's
 * EVENT_TYPES (the payload taxonomy is owned by the market lane; the replay
 * world treats payloads as opaque JSON).
 */
export const EVENT_TYPES = [
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

/** The canonical event type. Mirror of market-protocol's EventType. */
export type EventType = (typeof EVENT_TYPES)[number];

/** Runtime guard for a canonical event type. */
export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Provenance (mirror of market-protocol provenance.ts)
// ---------------------------------------------------------------------------

/** Where an event came from. The syntheticity discriminator. Mirror of T004. */
export type EventOrigin = 'historical' | 'simulated' | 'generated';

/** Runtime list of event origins, for guards and diagnostics. */
export const EVENT_ORIGINS: readonly EventOrigin[] = ['historical', 'simulated', 'generated'];

/** Runtime guard for the origin discriminator. */
export function isEventOrigin(value: unknown): value is EventOrigin {
  return typeof value === 'string' && (EVENT_ORIGINS as readonly string[]).includes(value);
}

/** Reference to the producing adapter. Mirror of market-protocol's AdapterRef. */
export interface AdapterRef {
  /** Adapter id (e.g. "binance-adapter", "replay-fixture-adapter"). */
  readonly id: string;
  /** Adapter version (e.g. "1.4.0"). */
  readonly version: string;
}

/**
 * Provenance block carried by every event (mirror of market-protocol's
 * Provenance): the origin trichotomy (the anti-poisoning foundation, L5),
 * the adapter reference (REQUIRED for historical origin — no orphan
 * history), lineage (`derived_from`) and the transform that produced a
 * derivation (REQUIRED non-empty iff lineage is non-empty).
 */
export interface EventProvenance {
  readonly origin: EventOrigin;
  readonly adapter: AdapterRef | null;
  readonly derived_from: readonly string[];
  readonly transform: string | null;
}

/** Runtime guard for an adapter reference. */
export function isAdapterRef(value: unknown): value is AdapterRef {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id) && isNonEmptyString(value.version);
}

/** Runtime guard for a provenance block (structural, no self-reference context). */
export function isEventProvenance(value: unknown): value is EventProvenance {
  if (!isRecord(value)) return false;
  if (!isEventOrigin(value.origin)) return false;
  if (value.adapter !== null && !isAdapterRef(value.adapter)) return false;
  if (!Array.isArray(value.derived_from)) return false;
  if (!value.derived_from.every((parent) => isNonEmptyString(parent))) return false;
  if (typeof value.transform !== 'string' || value.transform.length === 0) {
    if (value.transform !== null) return false;
  }
  if (value.origin === 'historical' && value.adapter === null) return false;
  const derived = value.derived_from.length > 0;
  if (derived && (typeof value.transform !== 'string' || value.transform.length === 0)) return false;
  if (!derived && value.transform !== null) return false;
  return true;
}

/**
 * Collect-all validation of a provenance block. `eventId` is the enclosing
 * event's id, needed for the self-reference rule. Mirrors market-protocol's
 * `validateProvenance` rule-for-rule.
 */
export function validateEventProvenance(value: unknown, eventId: string, path = 'provenance'): WorldError[] {
  const errors: WorldError[] = [];
  if (!isRecord(value)) {
    return [invalidField(path, 'must be an object')];
  }

  if (value.origin === undefined) {
    errors.push(missingField(`${path}.origin`));
  } else if (!isEventOrigin(value.origin)) {
    errors.push(invalidField(`${path}.origin`, `must be one of ${EVENT_ORIGINS.join(' | ')}`));
  }

  const origin = value.origin;
  if (value.adapter === undefined) {
    errors.push(missingField(`${path}.adapter`));
  } else if (value.adapter !== null) {
    if (!isRecord(value.adapter)) {
      errors.push(invalidField(`${path}.adapter`, 'must be an object with id and version'));
    } else {
      if (!isNonEmptyString(value.adapter.id)) errors.push(invalidField(`${path}.adapter.id`, 'must be a non-empty string'));
      if (!isNonEmptyString(value.adapter.version))
        errors.push(invalidField(`${path}.adapter.version`, 'must be a non-empty string'));
    }
  } else if (origin === 'historical') {
    errors.push({
      code: 'invalid_field',
      path: `${path}.adapter`,
      message: 'historical events must reference the adapter that delivered them (id and version)',
    });
  }

  if (value.derived_from === undefined) {
    errors.push(missingField(`${path}.derived_from`));
  } else if (!Array.isArray(value.derived_from)) {
    errors.push(invalidField(`${path}.derived_from`, 'must be an array of parent event ids'));
  } else {
    const seen = new Set<string>();
    for (const parent of value.derived_from) {
      if (!isNonEmptyString(parent)) {
        errors.push(invalidField(`${path}.derived_from`, 'every parent id must be a non-empty string'));
        break;
      }
      if (parent === eventId) {
        errors.push({
          code: 'invalid_field',
          path: `${path}.derived_from`,
          message: 'an event may not list itself in its own lineage',
        });
        break;
      }
      if (seen.has(parent)) {
        errors.push({
          code: 'invalid_field',
          path: `${path}.derived_from`,
          message: `duplicate parent id "${parent}" in lineage`,
        });
        break;
      }
      seen.add(parent);
    }
  }

  const isDerived = Array.isArray(value.derived_from) && value.derived_from.length > 0;
  if (value.transform === undefined) {
    errors.push(missingField(`${path}.transform`));
  } else if (value.transform !== null) {
    if (!isNonEmptyString(value.transform))
      errors.push(invalidField(`${path}.transform`, 'must be a non-empty string or null'));
    if (!isDerived)
      errors.push({
        code: 'invalid_field',
        path: `${path}.transform`,
        message: 'a transform is only meaningful for derived events (non-empty derived_from)',
      });
  } else if (isDerived) {
    errors.push({
      code: 'invalid_field',
      path: `${path}.transform`,
      message: 'derived events must declare the transform that produced them',
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// The WorldEvent envelope (mirror of market-protocol's MarketEvent)
// ---------------------------------------------------------------------------

/**
 * The event record a replay world accepts. Structurally identical to
 * market-protocol's `MarketEvent` (identifiers deliberately PLAIN strings so
 * a canonical MarketEvent assigns without casts); the payload is opaque JSON
 * (market semantics belong to the market lane) and the WHOLE envelope must
 * be a JSON value (the replay world persists history — see module header).
 */
export interface WorldEvent {
  /** Opaque event identifier (unique within the world). */
  readonly event_id: string;
  /** Opaque venue identifier (e.g. 'BINANCE', 'XNAS'). */
  readonly venue: string;
  /** Opaque instrument identifier, venue-canonical (e.g. 'BTC-USDT', 'AAPL'). */
  readonly instrument: string;
  readonly asset_class: AssetClass;
  readonly event_type: EventType;
  /** When it happened in the world. */
  readonly event_time: TimestampMs;
  /** When the source says it happened (null when the source does not say). */
  readonly source_time: TimestampMs | null;
  /** The earliest a consumer may legitimately observe it — THE L4 input. */
  readonly available_time: TimestampMs;
  /** When TradRL received it. Informational; unordered vs available_time. */
  readonly ingestion_time: TimestampMs;
  /** Per-stream ordinal; strictly increasing per stream in arrival order. */
  readonly sequence: number;
  /** Opaque data provider identifier. */
  readonly provider: string;
  readonly provenance: EventProvenance;
  /** Opaque JSON payload. For `other` events: an object with `kind` and `data`. */
  readonly payload: JsonValue;
}

// ---------------------------------------------------------------------------
// Sequence discipline (mirror of market-protocol sequence.ts)
// ---------------------------------------------------------------------------

/**
 * The stream identifier of an event: its event type, qualified for `other`
 * (scoped by the free-form `kind`). Mirror of market-protocol's
 * `sequenceStream`.
 */
export function sequenceStream(event: WorldEvent): string {
  return event.event_type === 'other' ? `other:${otherEventKind(event.payload) ?? ''}` : event.event_type;
}

/**
 * The per-stream sequence scope key: `venue|instrument|stream`. Mirror of
 * market-protocol's `sequenceKey`. Sequences are STRICTLY INCREASING per key
 * in arrival order: equal = duplicate, lower = regression. Different keys
 * never interfere.
 */
export function sequenceKeyOf(event: WorldEvent): string {
  return `${event.venue}|${event.instrument}|${sequenceStream(event)}`;
}

/**
 * The `kind` of an `other` event's payload, or `null` when the payload does
 * not carry one (validated events always do — see {@link validateWorldEvent}).
 */
export function otherEventKind(payload: JsonValue): string | null {
  if (!isJsonObject(payload)) return null;
  const kind: JsonValue | undefined = payload.kind;
  return typeof kind === 'string' && kind.length > 0 ? kind : null;
}

// ---------------------------------------------------------------------------
// Envelope validation (collect-all, hand-rolled, total)
// ---------------------------------------------------------------------------

/**
 * Validate an untrusted value as a {@link WorldEvent}. Collects EVERY
 * violation (typed errors, dotted paths rooted at the caller-supplied
 * prefix). Never throws. Timeless: no comparison against "now" — withholding
 * future-dated events is the firewall's job, never the validator's
 * (mirrored law: a future-dated `available_time` is a VALID embargoed
 * event).
 */
export function validateWorldEvent(value: unknown, path = 'event'): WorldResult<WorldEvent> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: WorldError[] = [];

  // Whole-envelope JSON law (the deliberate replay divergence — see header).
  if (!isJsonValue(value)) {
    errors.push({
      code: 'invalid_field',
      path,
      message: 'the whole event envelope must be a JSON value (recorded history is persisted and serialized)',
    });
  }

  // Opaque string identifiers.
  for (const field of ['event_id', 'venue', 'instrument', 'provider'] as const) {
    const fieldValue = value[field];
    if (fieldValue === undefined) errors.push(missingField(`${path}.${field}`));
    else if (!isNonEmptyString(fieldValue)) errors.push(invalidField(`${path}.${field}`, 'must be a non-empty string'));
  }

  // Asset class.
  if (value.asset_class === undefined) errors.push(missingField(`${path}.asset_class`));
  else if (!isAssetClass(value.asset_class))
    errors.push(invalidField(`${path}.asset_class`, 'must be a canonical asset class'));

  // Event type (the discriminant).
  if (value.event_type === undefined) {
    errors.push(missingField(`${path}.event_type`));
  } else if (!isEventType(value.event_type)) {
    errors.push({
      code: 'invalid_field',
      path: `${path}.event_type`,
      message: `"${String(value.event_type)}" is not a canonical event type (${EVENT_TYPES.join(' | ')})`,
    });
  }

  // The availability quartet.
  if (value.event_time === undefined) errors.push(missingField(`${path}.event_time`));
  else if (!isTimestampMs(value.event_time))
    errors.push(invalidField(`${path}.event_time`, 'must be a valid epoch-millisecond timestamp'));

  if (value.source_time === undefined) errors.push(missingField(`${path}.source_time`));
  else if (value.source_time !== null && !isTimestampMs(value.source_time))
    errors.push(invalidField(`${path}.source_time`, 'must be a valid epoch-millisecond timestamp or null'));

  if (value.available_time === undefined) errors.push(missingField(`${path}.available_time`));
  else if (!isTimestampMs(value.available_time))
    errors.push(invalidField(`${path}.available_time`, 'must be a valid epoch-millisecond timestamp'));

  if (value.ingestion_time === undefined) errors.push(missingField(`${path}.ingestion_time`));
  else if (!isTimestampMs(value.ingestion_time))
    errors.push(invalidField(`${path}.ingestion_time`, 'must be a valid epoch-millisecond timestamp'));

  // The one enforced timestamp ordering (D-003): availability cannot precede occurrence.
  if (isTimestampMs(value.event_time) && isTimestampMs(value.available_time) && value.available_time < value.event_time) {
    errors.push({
      code: 'invalid_field',
      path: `${path}.available_time`,
      message: `available_time (${String(value.available_time)}) precedes event_time (${String(value.event_time)}) — information about an event cannot be observable before the event occurred`,
    });
  }

  // Sequence: a per-stream ordinal (stream-level monotonicity is a WORLD-level law,
  // enforced by the ingest transition against the per-stream trackers).
  if (value.sequence === undefined) errors.push(missingField(`${path}.sequence`));
  else if (!isNonNegativeSafeInteger(value.sequence))
    errors.push(invalidField(`${path}.sequence`, 'must be a non-negative safe integer'));

  // Provenance (needs event_id for the self-reference rule).
  if (value.provenance === undefined) {
    errors.push(missingField(`${path}.provenance`));
  } else {
    errors.push(...validateEventProvenance(value.provenance, typeof value.event_id === 'string' ? value.event_id : '', `${path}.provenance`));
  }

  // Payload: opaque JSON, plus the mirrored `other`-payload floor.
  if (value.payload === undefined) {
    errors.push(missingField(`${path}.payload`));
  } else if (!isJsonValue(value.payload)) {
    errors.push(invalidField(`${path}.payload`, 'must be a JSON value (finite numbers only)'));
  } else if (value.event_type === 'other') {
    if (!isJsonObject(value.payload)) {
      errors.push(invalidField(`${path}.payload`, 'an "other" payload must be a JSON object'));
    } else {
      const kind = value.payload.kind;
      if (kind === undefined) {
        errors.push(missingField(`${path}.payload.kind`));
      } else if (typeof kind !== 'string' || kind.length === 0) {
        errors.push(invalidField(`${path}.payload.kind`, 'must be a non-empty string — the escape hatch must name its kind'));
      }
      if (value.payload.data === undefined) {
        errors.push(missingField(`${path}.payload.data`));
      } else if (!isJsonObject(value.payload.data)) {
        errors.push(invalidField(`${path}.payload.data`, 'must be a JSON object'));
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  // Safe: every required field has been validated above (excess JSON fields
  // are a tolerated forward-compatible floor); the cast only refines the type.
  return ok(deepFreeze(value as unknown as WorldEvent));
}

/** Narrowing guard for untrusted input. */
export function isWorldEvent(value: unknown): value is WorldEvent {
  return validateWorldEvent(value).ok;
}

/**
 * Validate a batch of untrusted event records; results are position-aligned
 * with the input. (The ingest transition uses this for streaming
 * diagnostics; application is transactional per batch — see transition.ts.)
 */
export function validateWorldEvents(values: readonly unknown[], path = 'event'): WorldResult<WorldEvent>[] {
  return values.map((value, index) => validateWorldEvent(value, `${path}[${index}]`));
}
