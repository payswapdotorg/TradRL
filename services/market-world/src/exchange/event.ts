/**
 * @tradrl/market-world (exchange service) — the ExchangeEvent envelope:
 * STRUCTURAL MIRROR of @tradrl/market-protocol's canonical `MarketEvent`
 * (T004), in the same discipline T009's WorldEvent mirror uses.
 *
 * THE OUTPUTS OUT: every record the exchange service emits — fills (as
 * `trade` events), top-of-book quotes (as `quote` events) and
 * acks/rejects/cancels/expirations (as `other` events with named kinds) —
 * rides EXACTLY this envelope, so a consumer (T027 reactive world, T013
 * RL bridge, T019 execution policy) can validate it with the CANONICAL
 * market-protocol validator itself: `validateMarketEvent(event)` accepts
 * every event this module constructs (proven in session.test.ts against
 * the REAL market-protocol package, present on this branch).
 *
 * THE AVAILABILITY QUARTET (all four REQUIRED — mirrors envelope.ts):
 *   - `event_time`     — when it happened (the engine instant).
 *   - `source_time`    — ALWAYS `null` for exchange-sim events: the
 *                        simulator IS the source and has no independent
 *                        source clock (declared, never fabricated).
 *   - `available_time` — the earliest a consumer may legitimately observe
 *                        it. THE information-boundary input (L4). For
 *                        order outcomes: event_time + the latency model's
 *                        delay (honest: a fill is NOT observable before
 *                        the participant's report would arrive). For
 *                        market-data events (quotes): == event_time (the
 *                        public feed carries no modeled feed latency —
 *                        declared limitation, see latency.ts).
 *   - `ingestion_time` — when the service emitted it (== event_time).
 *
 * PROVENANCE: exchange-sim events are `simulated` origin with the
 * producing component named in the adapter reference — the
 * anti-poisoning discipline (L5): synthetic events are ALWAYS
 * distinguishable from historical ones.
 */

import { deepFreeze, isNonEmptyString, isNonNegativeSafeInteger, isRecord } from '../../../../packages/exchange-sim/src/index';
import { isTimestampMs, type TimestampMs } from '../../../../packages/exchange-sim/src/index';
import type { Fill, OrderCancelRecord, OrderAck, OrderReject, TopOfBook } from '../../../../packages/exchange-sim/src/index';
import type { JsonValue } from './env-mirror';
import { isJsonObject, isJsonValue } from './env-mirror';

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
 * The event types the exchange service emits (a subset of the canonical
 * taxonomy): `trade` (fills), `quote` (top-of-book), `other` (named
 * exchange outcomes). The FULL canonical list is mirrored for the
 * envelope guard so canonical events stay assignable.
 */
export const CANONICAL_EVENT_TYPES = [
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
export type EventType = (typeof CANONICAL_EVENT_TYPES)[number];

/** Runtime guard for a canonical event type. */
export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (CANONICAL_EVENT_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Provenance (mirror of market-protocol provenance.ts)
// ---------------------------------------------------------------------------

/** Where an event came from. The syntheticity discriminator. Mirror of T004. */
export type EventOrigin = 'historical' | 'simulated' | 'generated';

/** Runtime list of event origins, for guards and diagnostics. */
export const EVENT_ORIGINS: readonly ['historical', 'simulated', 'generated'] = ['historical', 'simulated', 'generated'];

/** Runtime guard for the origin discriminator. */
export function isEventOrigin(value: unknown): value is EventOrigin {
  return typeof value === 'string' && (EVENT_ORIGINS as readonly string[]).includes(value);
}

/** Reference to the producing component. Mirror of market-protocol's AdapterRef. */
export interface AdapterRef {
  readonly id: string;
  readonly version: string;
}

/** Provenance block carried by every event (mirror of market-protocol's Provenance). */
export interface EventProvenance {
  readonly origin: EventOrigin;
  readonly adapter: AdapterRef | null;
  readonly derived_from: readonly string[];
  readonly transform: string | null;
}

/** The producing component of every exchange-sim event. */
export const EXCHANGE_SIM_COMPONENT: AdapterRef = deepFreeze({ id: 'exchange-sim-engine', version: '1.0.0' });

/** The `other` kinds the exchange service emits (the escape hatch names itself). */
export const EXCHANGE_OTHER_KINDS = [
  'order_ack',
  'order_reject',
  'order_cancel',
  'order_expired',
] as const;

export type ExchangeOtherKind = (typeof EXCHANGE_OTHER_KINDS)[number];

// ---------------------------------------------------------------------------
// The ExchangeEvent envelope (mirror of market-protocol's MarketEvent)
// ---------------------------------------------------------------------------

/**
 * An event record the exchange service emits. Structurally identical to
 * market-protocol's `MarketEvent` (identifiers deliberately PLAIN strings
 * so a canonical MarketEvent assigns without casts); the payload is
 * opaque JSON shaped per the taxonomy (trade/quote/other payload
 * taxonomies are mirrored by the constructors below).
 */
export interface ExchangeEvent {
  /** Opaque event identifier (unique within the episode). */
  readonly event_id: string;
  readonly venue: string;
  readonly instrument: string;
  readonly asset_class: AssetClass;
  readonly event_type: EventType;
  /** When it happened (the engine instant). */
  readonly event_time: TimestampMs;
  /** When the source says it happened — always null for the simulator (declared). */
  readonly source_time: null;
  /** The earliest a consumer may legitimately observe it — THE L4 input. */
  readonly available_time: TimestampMs;
  /** When the service emitted it (informational). */
  readonly ingestion_time: TimestampMs;
  /** Per-stream ordinal; strictly increasing per stream in emission order. */
  readonly sequence: number;
  readonly provider: string;
  readonly provenance: EventProvenance;
  /** Opaque JSON payload (trade / quote / other-shaped by the constructors). */
  readonly payload: JsonValue;
}

/** The stream identifier of an event: its type, scoped for `other` by kind (mirror of market-protocol's sequenceStream). */
export function sequenceStream(event: Pick<ExchangeEvent, 'event_type' | 'payload'>): string {
  if (event.event_type !== 'other') return event.event_type;
  const kind = otherEventKind(event.payload);
  return kind === null ? 'other' : `other:${kind}`;
}

/** The per-stream sequence scope key: `venue|instrument|stream`. Mirror of market-protocol's sequenceKey. */
export function sequenceKeyOf(event: Pick<ExchangeEvent, 'venue' | 'instrument' | 'event_type' | 'payload'>): string {
  return `${event.venue}|${event.instrument}|${sequenceStream(event)}`;
}

/** The `kind` of an `other` payload, or null when absent. */
export function otherEventKind(payload: JsonValue): string | null {
  if (!isJsonObject(payload)) return null;
  const kind: JsonValue | undefined = payload.kind;
  return typeof kind === 'string' && kind.length > 0 ? kind : null;
}

// ---------------------------------------------------------------------------
// Envelope validation (collect-all, hand-rolled, total)
// ---------------------------------------------------------------------------

/** A single typed validation failure (field-shape mirror of the sibling lanes). */
export interface ExchangeEventError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/**
 * Validate an untrusted value as an {@link ExchangeEvent} (collect-all;
 * mirrors the market-protocol envelope rules, including the whole-root
 * JSON law and the `other`-payload floor). Never throws.
 */
export function validateExchangeEvent(value: unknown): { readonly ok: true; readonly value: ExchangeEvent } | { readonly ok: false; readonly errors: readonly ExchangeEventError[] } {
  if (!isRecord(value)) {
    return { ok: false, errors: [{ code: 'invalid_type', path: 'event', message: 'event must be an object' }] };
  }
  const errors: ExchangeEventError[] = [];

  if (!isJsonValue(value)) {
    errors.push({ code: 'invalid_field', path: 'event', message: 'the whole event envelope must be a JSON value (events are persisted for lineage)' });
  }

  for (const field of ['event_id', 'venue', 'instrument', 'provider'] as const) {
    if (value[field] === undefined) {
      errors.push({ code: 'missing_field', path: `event.${field}`, message: `required field "event.${field}" is missing` });
    } else if (!isNonEmptyString(value[field])) {
      errors.push({ code: 'invalid_field', path: `event.${field}`, message: 'must be a non-empty string' });
    }
  }

  if (value.asset_class === undefined) {
    errors.push({ code: 'missing_field', path: 'event.asset_class', message: 'required field "event.asset_class" is missing' });
  } else if (!isAssetClass(value.asset_class)) {
    errors.push({ code: 'invalid_field', path: 'event.asset_class', message: 'must be a canonical asset class' });
  }

  if (value.event_type === undefined) {
    errors.push({ code: 'missing_field', path: 'event.event_type', message: 'required field "event.event_type" is missing' });
  } else if (!isEventType(value.event_type)) {
    errors.push({ code: 'invalid_field', path: 'event.event_type', message: `must be a canonical event type (${CANONICAL_EVENT_TYPES.join(' | ')})` });
  }

  for (const field of ['event_time', 'available_time', 'ingestion_time'] as const) {
    if (value[field] === undefined) {
      errors.push({ code: 'missing_field', path: `event.${field}`, message: `required field "event.${field}" is missing` });
    } else if (!isTimestampMs(value[field])) {
      errors.push({ code: 'invalid_field', path: `event.${field}`, message: 'must be a valid epoch-millisecond timestamp' });
    }
  }

  if (value.source_time !== undefined && value.source_time !== null && !isTimestampMs(value.source_time)) {
    errors.push({ code: 'invalid_field', path: 'event.source_time', message: 'must be a valid epoch-millisecond timestamp or null' });
  }

  // The enforced ordering (mirror of the envelope law): availability
  // cannot precede occurrence.
  if (isTimestampMs(value.event_time) && isTimestampMs(value.available_time) && value.available_time < value.event_time) {
    errors.push({
      code: 'invalid_field',
      path: 'event.available_time',
      message: 'available_time precedes event_time — information about an event cannot be observable before the event occurred',
    });
  }

  if (value.sequence === undefined) {
    errors.push({ code: 'missing_field', path: 'event.sequence', message: 'required field "event.sequence" is missing' });
  } else if (!isNonNegativeSafeInteger(value.sequence)) {
    errors.push({ code: 'invalid_field', path: 'event.sequence', message: 'must be a non-negative safe integer' });
  }

  if (value.provenance === undefined) {
    errors.push({ code: 'missing_field', path: 'event.provenance', message: 'required field "event.provenance" is missing' });
  } else if (!isRecord(value.provenance)) {
    errors.push({ code: 'invalid_field', path: 'event.provenance', message: 'must be an object' });
  } else {
    const provenance = value.provenance;
    if (!isEventOrigin(provenance.origin)) {
      errors.push({ code: 'invalid_field', path: 'event.provenance.origin', message: `must be one of ${EVENT_ORIGINS.join(' | ')}` });
    }
    if (provenance.adapter !== undefined && provenance.adapter !== null) {
      if (!isRecord(provenance.adapter)) {
        errors.push({ code: 'invalid_field', path: 'event.provenance.adapter', message: 'must be an object with id and version' });
      } else if (!isNonEmptyString(provenance.adapter.id) || !isNonEmptyString(provenance.adapter.version)) {
        errors.push({ code: 'invalid_field', path: 'event.provenance.adapter', message: 'must be an object with non-empty id and version' });
      }
    }
    if (provenance.derived_from !== undefined && !Array.isArray(provenance.derived_from)) {
      errors.push({ code: 'invalid_field', path: 'event.provenance.derived_from', message: 'must be an array of parent event ids' });
    }
  }

  if (value.payload === undefined) {
    errors.push({ code: 'missing_field', path: 'event.payload', message: 'required field "event.payload" is missing' });
  } else if (!isJsonValue(value.payload)) {
    errors.push({ code: 'invalid_field', path: 'event.payload', message: 'must be a JSON value' });
  } else if (value.event_type === 'other') {
    if (!isJsonObject(value.payload)) {
      errors.push({ code: 'invalid_field', path: 'event.payload', message: 'an "other" payload must be a JSON object' });
    } else {
      const kind = value.payload.kind;
      if (kind === undefined) {
        errors.push({ code: 'missing_field', path: 'event.payload.kind', message: 'required field "event.payload.kind" is missing' });
      } else if (typeof kind !== 'string' || kind.length === 0) {
        errors.push({ code: 'invalid_field', path: 'event.payload.kind', message: 'must be a non-empty string — the escape hatch must name its kind' });
      }
      if (value.payload.data === undefined) {
        errors.push({ code: 'missing_field', path: 'event.payload.data', message: 'required field "event.payload.data" is missing' });
      } else if (!isJsonObject(value.payload.data)) {
        errors.push({ code: 'invalid_field', path: 'event.payload.data', message: 'must be a JSON object' });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(value as unknown as ExchangeEvent) };
}

/** Narrowing guard for untrusted input. */
export function isExchangeEvent(value: unknown): value is ExchangeEvent {
  return validateExchangeEvent(value).ok;
}

// ---------------------------------------------------------------------------
// Event constructors (from engine outcomes — the service's emission path)
// ---------------------------------------------------------------------------

/** Common envelope fields the service supplies (identity and sequence minted by the session). */
export interface EventEnvelopeContext {
  readonly event_id: string;
  readonly sequence: number;
  readonly venue: string;
  readonly instrument: string;
  readonly asset_class: AssetClass;
}

/** Build the `trade` event of one fill (the trade print + fees ride the payload). */
export function tradeEventOf(fill: Fill, context: EventEnvelopeContext): ExchangeEvent {
  return deepFreeze({
    event_id: context.event_id,
    venue: context.venue,
    instrument: context.instrument,
    asset_class: context.asset_class,
    event_type: 'trade',
    event_time: fill.quartet.event_time,
    source_time: null,
    available_time: fill.quartet.available_time,
    ingestion_time: fill.quartet.ingestion_time,
    sequence: context.sequence,
    provider: 'exchange-sim',
    provenance: { origin: 'simulated', adapter: { ...EXCHANGE_SIM_COMPONENT }, derived_from: [], transform: null },
    payload: {
      price: fill.price,
      size: fill.quantity,
      side: fill.aggressor_side,
      trade_id: fill.trade_id,
    },
  });
}

/** Build the `quote` event of a top-of-book view (available AT the event instant — no feed latency modeled, declared). */
export function quoteEventOf(top: TopOfBook, at: TimestampMs, context: EventEnvelopeContext): ExchangeEvent {
  return deepFreeze({
    event_id: context.event_id,
    venue: context.venue,
    instrument: context.instrument,
    asset_class: context.asset_class,
    event_type: 'quote',
    event_time: at,
    source_time: null,
    available_time: at,
    ingestion_time: at,
    sequence: context.sequence,
    provider: 'exchange-sim',
    provenance: { origin: 'simulated', adapter: { ...EXCHANGE_SIM_COMPONENT }, derived_from: [], transform: null },
    payload: {
      bid_price: top.bid_price,
      bid_size: top.bid_size,
      ask_price: top.ask_price,
      ask_size: top.ask_size,
    },
  });
}

/** Build the `other:order_ack` event of an order ack. */
export function orderAckEventOf(ack: OrderAck, context: EventEnvelopeContext): ExchangeEvent {
  return otherOutcomeEvent('order_ack', ack.quartet, context, {
    order_id: ack.order_id,
    client_order_id: ack.client_order_id,
    status: ack.status,
    filled_quantity: ack.filled_quantity,
  });
}

/** Build the `other:order_reject` event of an order reject. */
export function orderRejectEventOf(reject: OrderReject, context: EventEnvelopeContext): ExchangeEvent {
  return otherOutcomeEvent('order_reject', reject.quartet, context, {
    order_id: reject.order_id,
    client_order_id: reject.client_order_id,
    reason: reject.reason,
    detail: reject.detail,
  });
}

/** Build the `other:order_cancel` event of a cancel/expiry record. */
export function orderCancelEventOf(cancel: OrderCancelRecord, context: EventEnvelopeContext): ExchangeEvent {
  return otherOutcomeEvent('order_cancel', cancel.quartet, context, {
    order_id: cancel.order_id,
    client_order_id: cancel.client_order_id,
    reason: cancel.reason,
    remaining_quantity: cancel.remaining_quantity,
  });
}

/** Build the `other:order_expired` event of an expiry record. */
export function orderExpiredEventOf(expiration: OrderCancelRecord, context: EventEnvelopeContext): ExchangeEvent {
  return otherOutcomeEvent('order_expired', expiration.quartet, context, {
    order_id: expiration.order_id,
    client_order_id: expiration.client_order_id,
    reason: expiration.reason,
    remaining_quantity: expiration.remaining_quantity,
  });
}

/** The shared `other`-event constructor (named kind + data object). */
function otherOutcomeEvent(
  kind: ExchangeOtherKind,
  quartet: { readonly event_time: TimestampMs; readonly available_time: TimestampMs; readonly ingestion_time: TimestampMs },
  context: EventEnvelopeContext,
  data: Record<string, JsonValue>,
): ExchangeEvent {
  return deepFreeze({
    event_id: context.event_id,
    venue: context.venue,
    instrument: context.instrument,
    asset_class: context.asset_class,
    event_type: 'other',
    event_time: quartet.event_time,
    source_time: null,
    available_time: quartet.available_time,
    ingestion_time: quartet.ingestion_time,
    sequence: context.sequence,
    provider: 'exchange-sim',
    provenance: { origin: 'simulated', adapter: { ...EXCHANGE_SIM_COMPONENT }, derived_from: [], transform: null },
    payload: { kind, data },
  });
}
