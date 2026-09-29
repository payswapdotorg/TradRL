/**
 * @tradrl/market-world (reactive service) — the RECORDED EVENT STREAM: the
 * structural mirror of the market-protocol/T009 `WorldEvent` envelope (the
 * stream IN), the pure event-source port, and the digest-chained ingestion
 * discipline (work order T027).
 *
 * THE STREAM'S ROLE IN THE REACTIVE WORLD (the work order's law): "the
 * exogenous recorded stream still flows in as events" — the recorded
 * history is the EXOGENOUS truth: it flows in, becomes L4-gated
 * observations, and seeds the engine's book; it never matches against
 * anyone. Matching endogenous intents against THIS stream is inexpressible
 * in this lane's types (that would be historical falsification — the
 * anti-poisoning law below).
 *
 * ANTI-POISONING (L5, mirroring T009's origin rule): the recorded stream
 * is RECORDED HISTORY — every accepted event must declare
 * `provenance.origin === 'historical'`. Events claiming `simulated` or
 * `generated` origins are rejected with `synthetic_event_rejected` at
 * ingestion: synthetic origins are THIS lane's outputs (engine-driven
 * fills carry `simulated` origin) and the generative lane's (T028), never
 * the recorded stream's.
 *
 * THE INGEST CHAIN (L9, mirroring T009's run-state discipline): every
 * applied batch is digested (FNV-1a 32 over the canonical JSON of its
 * validated events — key-order-insensitive) and chained onto the previous
 * digest, seeded from the config hash. The chain head binds
 * config + stream + order; resume re-pulls the source, verifies each
 * historical batch's digest against the chain (a mismatched stream fails
 * `resume_stream_mismatch`) and only then continues.
 *
 * NO NETWORK (the work order's law): the stream arrives as a declared
 * input — a pure async iterator. Fixture streams in tests; real recorded
 * history enters through T008's ingestion adapters under the same law.
 */

import { canonicalJson, deepFreeze, isNonEmptyString, isNonNegativeSafeInteger, isRecord } from './primitives';
import { fnv1a32Hex } from './primitives';
import type { JsonValue } from './primitives';
import { isJsonValue } from './primitives';
import { invalidField, invalidType, missingField, ok, type ReactiveError, type ReactiveResult } from './errors';
import { isTimestampMs, type TimestampMs } from './ids';

// ---------------------------------------------------------------------------
// Taxonomies (mirrors of market-protocol's envelope taxonomies)
// ---------------------------------------------------------------------------

/** Canonical asset classes. Mirror of market-protocol's ASSET_CLASSES. */
export const ASSET_CLASSES = ['crypto', 'equity', 'index', 'future', 'option', 'forex', 'commodity', 'macro', 'other'] as const;

/** Canonical asset class type. Mirror of market-protocol's AssetClass. */
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Runtime guard for a canonical asset class. */
export function isAssetClass(value: unknown): value is AssetClass {
  return typeof value === 'string' && (ASSET_CLASSES as readonly string[]).includes(value);
}

/** The canonical event types. Mirror of market-protocol's EventType list. */
export const EVENT_TYPES = ['trade', 'quote', 'book_snapshot', 'book_delta', 'ohlcv', 'news', 'macro_release', 'social_signal', 'fundamental', 'option_chain_mark', 'other'] as const;

/** Canonical event type. Mirror of market-protocol's EventType. */
export type EventType = (typeof EVENT_TYPES)[number];

/** Runtime guard for a canonical event type. */
export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

/** Where an event came from — the syntheticity discriminator (L5). */
export type EventOrigin = 'historical' | 'simulated' | 'generated';

/** Runtime guard for the origin discriminator. */
export function isEventOrigin(value: unknown): value is EventOrigin {
  return typeof value === 'string' && (['historical', 'simulated', 'generated'] as readonly string[]).includes(value);
}

/** Reference to the producing component. Mirror of market-protocol's AdapterRef. */
export interface AdapterRefMirror {
  readonly id: string;
  readonly version: string;
}

/** Provenance block carried by every recorded event (mirror of market-protocol's Provenance). */
export interface EventProvenanceMirror {
  readonly origin: EventOrigin;
  readonly adapter: AdapterRefMirror | null;
  readonly derived_from: readonly string[];
  readonly transform: string | null;
}

// ---------------------------------------------------------------------------
// The recorded event envelope (STRUCTURAL MIRROR of the WorldEvent)
// ---------------------------------------------------------------------------

/**
 * One recorded event of the exogenous stream — STRUCTURAL MIRROR of
 * market-protocol's `MarketEvent` / T009's `WorldEvent` (identical field
 * names, plain strings): the availability quartet, the per-stream
 * sequence, the provenance block and the opaque payload. The payload
 * taxonomies (trade/quote/book_snapshot shapes) stay opaque here; the
 * engine validates the book seed it consumes (T010's law), and the
 * reactive world never interprets payload semantics beyond that.
 */
export interface RecordedEvent {
  readonly event_id: string;
  readonly venue: string;
  readonly instrument: string;
  readonly asset_class: AssetClass;
  readonly event_type: EventType;
  /** When it happened (the recorded instant). */
  readonly event_time: TimestampMs;
  /** When the source says it happened — may be null. */
  readonly source_time: TimestampMs | null;
  /** The earliest a participant may legitimately observe it — THE L4 input, untransformed. */
  readonly available_time: TimestampMs;
  /** When the recording ingested it. */
  readonly ingestion_time: TimestampMs;
  /** Per-stream ordinal; strictly increasing per stream. */
  readonly sequence: number;
  readonly provider: string;
  readonly provenance: EventProvenanceMirror;
  /** Opaque JSON payload (taxonomy-shaped by the recording source). */
  readonly payload: JsonValue;
}

// ---------------------------------------------------------------------------
// Envelope validation (collect-all, hand-rolled, total — mirrors T009)
// ---------------------------------------------------------------------------

/**
 * Validate an untrusted value as a {@link RecordedEvent} (collect-all).
 * Enforces the envelope laws: the availability ordering
 * (`available_time >= event_time` — information about an event cannot be
 * observable before the event occurred), the per-record JSON law, the
 * `other`-payload floor (`kind` + `data`), and the ANTI-POISONING origin
 * rule when `requireHistorical` is set (the reactive stream IN accepts
 * recorded history only — `synthetic_event_rejected` otherwise). Never
 * throws.
 */
export function validateRecordedEvent(value: unknown, path = 'event', requireHistorical = true): ReactiveResult<RecordedEvent> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path}`, `${path} must be an object`)] };
  }
  const errors: ReactiveError[] = [];

  if (!isJsonValue(value)) {
    errors.push(invalidField(`${path}`, 'the whole event envelope must be a JSON value (events are persisted for lineage)'));
  }

  for (const field of ['event_id', 'venue', 'instrument', 'provider'] as const) {
    if (value[field] === undefined) {
      errors.push(missingField(`${path}.${field}`));
    } else if (!isNonEmptyString(value[field])) {
      errors.push(invalidField(`${path}.${field}`, 'must be a non-empty string'));
    }
  }

  if (value.asset_class === undefined) {
    errors.push(missingField(`${path}.asset_class`));
  } else if (!isAssetClass(value.asset_class)) {
    errors.push(invalidField(`${path}.asset_class`, 'must be a canonical asset class'));
  }

  if (value.event_type === undefined) {
    errors.push(missingField(`${path}.event_type`));
  } else if (!isEventType(value.event_type)) {
    errors.push(invalidField(`${path}.event_type`, `must be a canonical event type (${EVENT_TYPES.join(' | ')})`));
  }

  for (const field of ['event_time', 'available_time', 'ingestion_time'] as const) {
    if (value[field] === undefined) {
      errors.push(missingField(`${path}.${field}`));
    } else if (!isTimestampMs(value[field])) {
      errors.push(invalidField(`${path}.${field}`, 'must be a valid epoch-millisecond timestamp'));
    }
  }

  if (value.source_time !== undefined && value.source_time !== null && !isTimestampMs(value.source_time)) {
    errors.push(invalidField(`${path}.source_time`, 'must be a valid epoch-millisecond timestamp or null'));
  }

  // The availability ordering (the envelope law): availability cannot
  // precede occurrence — THE point-in-time input (L4).
  if (isTimestampMs(value.event_time) && isTimestampMs(value.available_time) && (value.available_time as number) < (value.event_time as number)) {
    errors.push(invalidField(`${path}.available_time`, 'available_time precedes event_time — information about an event cannot be observable before the event occurred'));
  }

  if (value.sequence === undefined) {
    errors.push(missingField(`${path}.sequence`));
  } else if (!isNonNegativeSafeInteger(value.sequence)) {
    errors.push(invalidField(`${path}.sequence`, 'must be a non-negative safe integer'));
  }

  if (value.provenance === undefined) {
    errors.push(missingField(`${path}.provenance`));
  } else if (!isRecord(value.provenance)) {
    errors.push(invalidField(`${path}.provenance`, 'must be an object'));
  } else {
    const provenance = value.provenance;
    if (!isEventOrigin(provenance.origin)) {
      errors.push(invalidField(`${path}.provenance.origin`, "must be one of 'historical' | 'simulated' | 'generated'"));
    } else if (requireHistorical && provenance.origin !== 'historical') {
      // ANTI-POISONING (L5): the recorded stream is recorded history.
      // Synthetic origins belong to this lane's OUTPUTS and to T028.
      errors.push({
        code: 'synthetic_event_rejected',
        path: `${path}.provenance.origin`,
        message: `the reactive world's recorded stream accepts historical provenance only — origin '${provenance.origin}' is the reactive/generative lane's own output vocabulary, never recorded history`,
      });
    }
    if (provenance.adapter !== undefined && provenance.adapter !== null) {
      if (!isRecord(provenance.adapter)) {
        errors.push(invalidField(`${path}.provenance.adapter`, 'must be an object with id and version'));
      } else if (!isNonEmptyString(provenance.adapter.id) || !isNonEmptyString(provenance.adapter.version)) {
        errors.push(invalidField(`${path}.provenance.adapter`, 'must be an object with non-empty id and version'));
      }
    }
    if (provenance.adapter === null && provenance.origin === 'historical') {
      errors.push(invalidField(`${path}.provenance.adapter`, 'a historical event must name its recording adapter (no orphan history)'));
    }
    if (provenance.derived_from !== undefined && !Array.isArray(provenance.derived_from)) {
      errors.push(invalidField(`${path}.provenance.derived_from`, 'must be an array of parent event ids'));
    } else if (Array.isArray(provenance.derived_from) && !provenance.derived_from.every((parent) => isNonEmptyString(parent))) {
      errors.push(invalidField(`${path}.provenance.derived_from`, 'every parent event id must be a non-empty string'));
    }
    if (provenance.transform !== undefined && provenance.transform !== null && !isNonEmptyString(provenance.transform)) {
      errors.push(invalidField(`${path}.provenance.transform`, 'must be a non-empty string or null'));
    }
  }

  if (value.payload === undefined) {
    errors.push(missingField(`${path}.payload`));
  } else if (!isJsonValue(value.payload)) {
    errors.push(invalidField(`${path}.payload`, 'must be a JSON value'));
  } else if (value.event_type === 'other') {
    if (typeof value.payload !== 'object' || value.payload === null || Array.isArray(value.payload)) {
      errors.push(invalidField(`${path}.payload`, 'an "other" payload must be a JSON object'));
    } else {
      const payload = value.payload as { readonly [key: string]: JsonValue };
      const kind = payload.kind;
      if (kind === undefined) {
        errors.push(missingField(`${path}.payload.kind`));
      } else if (typeof kind !== 'string' || kind.length === 0) {
        errors.push(invalidField(`${path}.payload.kind`, 'must be a non-empty string — the escape hatch must name its kind'));
      }
      if (payload.data === undefined) {
        errors.push(missingField(`${path}.payload.data`));
      } else if (typeof payload.data !== 'object' || payload.data === null || Array.isArray(payload.data)) {
        errors.push(invalidField(`${path}.payload.data`, 'must be a JSON object'));
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const provenance = value.provenance as EventProvenanceMirror;
  return ok(
    deepFreeze({
      event_id: value.event_id as string,
      venue: value.venue as string,
      instrument: value.instrument as string,
      asset_class: value.asset_class as AssetClass,
      event_type: value.event_type as EventType,
      event_time: value.event_time as TimestampMs,
      source_time: (value.source_time ?? null) as TimestampMs | null,
      available_time: value.available_time as TimestampMs,
      ingestion_time: value.ingestion_time as TimestampMs,
      sequence: value.sequence as number,
      provider: value.provider as string,
      provenance: {
        origin: provenance.origin,
        adapter: provenance.adapter === null ? null : { id: (provenance.adapter as AdapterRefMirror).id, version: (provenance.adapter as AdapterRefMirror).version },
        derived_from: [...provenance.derived_from],
        transform: provenance.transform ?? null,
      },
      payload: value.payload as JsonValue,
    }),
  );
}

/** Narrowing guard for untrusted recorded events. */
export function isRecordedEvent(value: unknown): value is RecordedEvent {
  return validateRecordedEvent(value).ok;
}

// ---------------------------------------------------------------------------
// The pure event-source port (mirror of T009's ReplayEventSource)
// ---------------------------------------------------------------------------

/**
 * The recorded-stream source: a PURE async iterator of event batches (NO
 * I/O in this Work Order; fixture streams only — real sources are T008).
 * Each `next()` yields one batch (an array of untrusted records) or
 * signals exhaustion; the world validates, filters and digests every batch
 * through its own guards.
 */
export interface RecordedEventSource {
  [Symbol.asyncIterator](): AsyncIterator<readonly unknown[], void, undefined>;
}

/** Structural runtime guard for the event-source port. */
export function isRecordedEventSource(value: unknown): value is RecordedEventSource {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { [Symbol.asyncIterator]?: unknown };
  return typeof candidate[Symbol.asyncIterator] === 'function';
}

/** Wrap a literal batch list as a fresh {@link RecordedEventSource} (call again for a second, identical source). */
export function asRecordedEventSource(batches: readonly (readonly unknown[])[]): RecordedEventSource {
  async function* generate(): AsyncGenerator<readonly unknown[], void, undefined> {
    for (const batch of batches) {
      yield [...batch];
    }
  }
  return generate() as RecordedEventSource;
}

// ---------------------------------------------------------------------------
// The ingest digest chain (L9 — mirrors T009's run-state discipline)
// ---------------------------------------------------------------------------

/** Canonical JSON of one validated event (key-order-insensitive). */
function canonicalEventJson(event: RecordedEvent): string {
  const json: unknown = event;
  if (!isJsonValue(json)) {
    throw new Error('digest: a validated event is not JSON (impossible by validation)');
  }
  return canonicalJson(json);
}

/** The digest of one applied batch (over its validated events, joined in order). */
export function batchDigest(batch: readonly RecordedEvent[]): string {
  return fnv1a32Hex(batch.map(canonicalEventJson).join('\n'));
}

/** Fold a batch digest onto the chain (seeded from the config hash by the caller). */
export function chainDigest(previousHead: string, batch: readonly RecordedEvent[]): string {
  return fnv1a32Hex(`${previousHead}:${batchDigest(batch)}`);
}

/**
 * Digest an UNTRUSTED batch for resume verification: every record must
 * pass the envelope validation (anti-poisoning included), then digest
 * identically to the recorded chain entry. Returns `null` when any record
 * is invalid (the caller maps that to `resume_stream_mismatch`).
 */
export function untrustedBatchDigest(batch: readonly unknown[]): string | null {
  const validated: RecordedEvent[] = [];
  for (const record of batch) {
    const result = validateRecordedEvent(record);
    if (!result.ok) return null;
    validated.push(result.value);
  }
  return batchDigest(validated);
}
