// @tradrl/body-regime-researcher — the market-event observation intake.
//
// Owning Work Order: T022.
//
// STRUCTURAL MIRRORS (law D-003/D-004 — never imports; the trip wires
// live in src/interop.test.ts against the REAL packages on this branch):
// - The observation envelope mirrors the canonical market-event envelope
//   (market-protocol envelope.ts / the T037 Coinbase adapter's
//   `EmittedEventCommon` / the T009 market-world `WorldEvent`): canonical
//   event id, venue, instrument, asset class, the AVAILABILITY QUARTET,
//   sequence, provider, the T008 provenance block, and the typed payload.
//   The adapters' extra fields (entitlement, mapping) ride as tolerated
//   extras — the canonical contract is a floor.
// - The provenance block mirrors the canonical `IngestionProvenance`
//   (market-protocol / data-ingestion / provenance lanes):
//   { origin, adapter, derived_from, transform } with the same four
//   validation invariants.
// - The payloads mirror the canonical quote, trade and book-snapshot
//   payloads (market-protocol payloads): top-of-book bid/ask decimals;
//   executed price/size/side prints; full visible book levels.
//
// THE L4 GATE (spec/ARCHITECTURE-LOCK.md L4 — point-in-time truth; the
// Time Machine section of spec/ARCHITECTURE.md: "Track event time, source
// time when known, availability time and ingestion time"): the research
// pipeline NEVER consumes an observation whose `available_time` exceeds
// the declared as-of instant. The gate is a pure function; a future
// observation is DEFERRED with a typed record — never silently dropped,
// never consumed.
//
// The quartet laws mirrored exactly from the canonical owners:
//   event_time      — when it happened in the world;
//   source_time     — the vendor's claim (advisory; NO ordering enforced);
//   available_time  — the earliest legitimate observation (L4);
//   ingestion_time  — advisory on input; the store re-stamps at commit.
// The ONE enforced ordering: available_time >= event_time.

import { type TimestampMs, isTimestampMs, isNonEmptyString, isNonNegativeInteger, isRecord, isMemberOf, isArrayOf, deepFreeze } from './primitives';
import { type MarketObservationId, isMarketObservationId } from './ids';
import { type RegimeError, type RegimeResult, invalidField, invalidType } from './errors';
import { isPositiveDecimal } from './decimals';

// ---------------------------------------------------------------------------
// The canonical taxonomy mirrors
// ---------------------------------------------------------------------------

/** The canonical event-type taxonomy (mirror of the market-protocol lane). */
export const EVENT_TYPES = [
  'trade', 'quote', 'book_snapshot', 'book_delta', 'ohlcv',
  'news', 'macro_release', 'social_signal', 'fundamental',
  'option_chain_mark', 'other',
] as const;

/** A canonical event type. */
export type EventType = (typeof EVENT_TYPES)[number];

/** Guard: a canonical event type. */
export const isEventType = (v: unknown): v is EventType => isMemberOf(EVENT_TYPES, v);

/** The canonical asset classes (mirror of the market-protocol lane). */
export const ASSET_CLASSES = [
  'crypto', 'equity', 'index', 'future', 'option',
  'forex', 'commodity', 'macro', 'other',
] as const;

/** A canonical asset class. */
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Guard: a canonical asset class. */
export const isAssetClass = (v: unknown): v is AssetClass => isMemberOf(ASSET_CLASSES, v);

/** The observation kinds the regime researcher consumes (closed). */
export const REGIME_OBSERVATION_KINDS = ['quote', 'trade', 'book_snapshot'] as const;

/** An observation kind this body's ports accept. */
export type RegimeObservationKind = (typeof REGIME_OBSERVATION_KINDS)[number];

/** Guard: an observation kind. */
export const isRegimeObservationKind = (v: unknown): v is RegimeObservationKind =>
  isMemberOf(REGIME_OBSERVATION_KINDS, v);

// ---------------------------------------------------------------------------
// The provenance block (T008 mirror)
// ---------------------------------------------------------------------------

/** How an observation came to exist (the canonical trichotomy). */
export type EventOrigin = 'historical' | 'simulated' | 'generated';

/** The canonical origin trichotomy. */
export const EVENT_ORIGINS: readonly EventOrigin[] = ['historical', 'simulated', 'generated'];

/** Guard: an event origin. */
export const isEventOrigin = (v: unknown): v is EventOrigin => isMemberOf(EVENT_ORIGINS, v);

/** An adapter reference (mirror of the canonical `AdapterRef`). */
export interface AdapterRefMirror {
  /** Adapter id (e.g. "market-adapter", "coinbase"). */
  readonly id: string;
  /** Adapter version (e.g. "1.4.0"). */
  readonly version: string;
}

/**
 * The observation provenance block — STRUCTURAL MIRROR of the canonical
 * `IngestionProvenance` (market-protocol / data-ingestion / adapters).
 * Validation invariants (mirrored): origin in the trichotomy; `adapter`
 * REQUIRED for historical origin; `derived_from` non-empty strings, no
 * self-reference, no duplicates; `transform` REQUIRED non-empty iff
 * `derived_from` is non-empty.
 */
export interface ObservationProvenance {
  readonly origin: EventOrigin;
  readonly adapter: AdapterRefMirror | null;
  readonly derived_from: readonly string[];
  readonly transform: string | null;
}

/** Guard: `AdapterRefMirror`. */
export function isAdapterRefMirror(v: unknown): v is AdapterRefMirror {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.id) && isNonEmptyString(v.version);
}

/** Guard: `ObservationProvenance` (total). */
export function isObservationProvenance(v: unknown): v is ObservationProvenance {
  if (!isRecord(v)) return false;
  return (
    isEventOrigin(v.origin) &&
    (v.adapter === null || isAdapterRefMirror(v.adapter)) &&
    isArrayOf(v.derived_from, isNonEmptyString) &&
    (v.transform === null || isNonEmptyString(v.transform))
  );
}

/**
 * COLLECT-ALL validation of a provenance block against the mirrored
 * invariants (error codes match the canonical owners').
 */
export function validateObservationProvenance(v: unknown, eventId: string, path = 'provenance'): readonly RegimeError[] {
  const errors: RegimeError[] = [];
  if (!isRecord(v)) return [invalidType(path, 'a provenance block object')];
  if (!isEventOrigin(v.origin)) {
    errors.push(invalidField(`${path}.origin`, `must be one of ${EVENT_ORIGINS.join('|')}`));
    return errors;
  }
  if (v.origin === 'historical' && (v.adapter === null || !isAdapterRefMirror(v.adapter))) {
    errors.push({
      code: 'provenance_adapter_required',
      path: `${path}.adapter`,
      message: 'historical observations must cite their adapter',
    });
  } else if (v.adapter !== null && !isAdapterRefMirror(v.adapter)) {
    errors.push(invalidField(`${path}.adapter`, 'must be { id, version } or null'));
  }
  if (!isArrayOf(v.derived_from, isNonEmptyString)) {
    errors.push(invalidField(`${path}.derived_from`, 'must be an array of non-empty lineage ids'));
  } else {
    if (v.derived_from.includes(eventId)) {
      errors.push({
        code: 'provenance_self_reference',
        path: `${path}.derived_from`,
        message: 'a record cannot derive from itself',
      });
    }
    if (new Set(v.derived_from).size !== v.derived_from.length) {
      errors.push({
        code: 'provenance_duplicate_parent',
        path: `${path}.derived_from`,
        message: 'duplicate lineage parents',
      });
    }
    if (v.derived_from.length > 0 && (v.transform === null || !isNonEmptyString(v.transform))) {
      errors.push({
        code: 'provenance_transform_required',
        path: `${path}.transform`,
        message: 'derived observations must declare their transform',
      });
    }
    if (v.derived_from.length === 0 && v.transform !== null) {
      errors.push({
        code: 'provenance_transform_without_parents',
        path: `${path}.transform`,
        message: 'a transform without parents is not a derivation',
      });
    }
  }
  if (v.transform !== null && !isNonEmptyString(v.transform)) {
    errors.push(invalidField(`${path}.transform`, 'must be a non-empty string or null'));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The typed payloads (canonical quote / trade / book-snapshot mirrors)
// ---------------------------------------------------------------------------

/**
 * The quote payload — mirror of the canonical `QuotePayload`
 * (market-protocol / provider-sdk / the Coinbase ticker mapping).
 * The contract deliberately does NOT enforce bid < ask: crossed or locked
 * quotes are market-microstructure facts, not protocol violations.
 */
export interface QuotePayloadMirror {
  readonly bid_price: string;
  readonly bid_size: string;
  readonly ask_price: string;
  readonly ask_size: string;
}

/** The trade side (mirror of the canonical `TradeSide`). */
export type TradeSideMirror = 'buy' | 'sell';

/**
 * The trade payload — mirror of the canonical `TradePayload`
 * (market-protocol / provider-sdk / the Coinbase match mapping).
 */
export interface TradePayloadMirror {
  /** Execution price per unit, unsigned decimal string (e.g. "43125.10"). */
  readonly price: string;
  /** Executed quantity, unsigned decimal string (e.g. "0.017"). */
  readonly size: string;
  /** Aggressor side of the trade. */
  readonly side: TradeSideMirror;
  /** Venue trade identifier, when the venue provides one. */
  readonly trade_id?: string;
}

/** One price level of a book — mirror of the canonical `BookLevel`. */
export interface BookLevelMirror {
  /** Level price (positive decimal string). */
  readonly price: string;
  /** Absolute quantity at the price (positive decimal string). */
  readonly size: string;
}

/**
 * The book-snapshot payload — mirror of the canonical `BookSnapshotPayload`
 * (market-protocol / provider-sdk / the Coinbase level2 mapping). Level
 * ordering (bids descending, asks ascending) is NOT enforced by the
 * contract — the price extraction declares its own best-level selection.
 */
export interface BookSnapshotPayloadMirror {
  /** Full visible bid side. May be empty (no bids). */
  readonly bids: readonly BookLevelMirror[];
  /** Full visible ask side. May be empty (no asks). */
  readonly asks: readonly BookLevelMirror[];
  /** Number of levels the venue exposes, when known. */
  readonly depth?: number;
  /** Venue book-state identifier for continuity checks, when provided. */
  readonly last_update_id?: string;
}

/** Guard: `QuotePayloadMirror`. */
export function isQuotePayloadMirror(v: unknown): v is QuotePayloadMirror {
  if (!isRecord(v)) return false;
  return (
    isPositiveDecimal(v.bid_price) &&
    isPositiveDecimal(v.bid_size) &&
    isPositiveDecimal(v.ask_price) &&
    isPositiveDecimal(v.ask_size)
  );
}

/** Guard: `TradePayloadMirror`. */
export function isTradePayloadMirror(v: unknown): v is TradePayloadMirror {
  if (!isRecord(v)) return false;
  if (!isPositiveDecimal(v.price)) return false;
  if (!isPositiveDecimal(v.size)) return false;
  if (v.side !== 'buy' && v.side !== 'sell') return false;
  if (v.trade_id !== undefined && !isNonEmptyString(v.trade_id)) return false;
  return true;
}

/** Guard: `BookLevelMirror`. */
export function isBookLevelMirror(v: unknown): v is BookLevelMirror {
  if (!isRecord(v)) return false;
  return isPositiveDecimal(v.price) && isPositiveDecimal(v.size);
}

/** Guard: `BookSnapshotPayloadMirror`. */
export function isBookSnapshotPayloadMirror(v: unknown): v is BookSnapshotPayloadMirror {
  if (!isRecord(v)) return false;
  if (!isArrayOf(v.bids, isBookLevelMirror)) return false;
  if (!isArrayOf(v.asks, isBookLevelMirror)) return false;
  if (v.depth !== undefined && !isNonNegativeInteger(v.depth)) return false;
  if (v.last_update_id !== undefined && !isNonEmptyString(v.last_update_id)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The observation records (canonical market-event envelope mirrors)
// ---------------------------------------------------------------------------

/**
 * Fields shared by every research observation regardless of kind — the
 * canonical market-event envelope core (event id, venue, instrument, asset
 * class, the availability quartet, sequence, provider, provenance).
 */
export interface ObservationCommon {
  readonly event_id: MarketObservationId;
  readonly venue: string;
  readonly instrument: string;
  readonly asset_class: AssetClass;
  readonly event_time: TimestampMs;
  readonly source_time: TimestampMs | null;
  readonly available_time: TimestampMs;
  readonly ingestion_time: TimestampMs;
  readonly sequence: number;
  readonly provider: string;
  readonly provenance: ObservationProvenance;
}

/** A top-of-book quote observation: the canonical quote event, mirrored. */
export interface QuoteObservation extends ObservationCommon {
  readonly event_type: 'quote';
  readonly payload: QuotePayloadMirror;
}

/** An executed trade print: the canonical trade event, mirrored. */
export interface TradeObservation extends ObservationCommon {
  readonly event_type: 'trade';
  readonly payload: TradePayloadMirror;
}

/** A full order-book snapshot: the canonical book_snapshot event, mirrored. */
export interface BookSnapshotObservation extends ObservationCommon {
  readonly event_type: 'book_snapshot';
  readonly payload: BookSnapshotPayloadMirror;
}

/** The observation union the regime researcher consumes. */
export type MarketObservation = QuoteObservation | TradeObservation | BookSnapshotObservation;

/** Guard: `QuoteObservation`. */
export function isQuoteObservation(v: unknown): v is QuoteObservation {
  if (!isRecord(v)) return false;
  if (v.event_type !== 'quote') return false;
  return observationCommonOk(v) && isQuotePayloadMirror(v.payload);
}

/** Guard: `TradeObservation`. */
export function isTradeObservation(v: unknown): v is TradeObservation {
  if (!isRecord(v)) return false;
  if (v.event_type !== 'trade') return false;
  return observationCommonOk(v) && isTradePayloadMirror(v.payload);
}

/** Guard: `BookSnapshotObservation`. */
export function isBookSnapshotObservation(v: unknown): v is BookSnapshotObservation {
  if (!isRecord(v)) return false;
  if (v.event_type !== 'book_snapshot') return false;
  return observationCommonOk(v) && isBookSnapshotPayloadMirror(v.payload);
}

/** Guard: `MarketObservation`. */
export function isMarketObservation(v: unknown): v is MarketObservation {
  return isQuoteObservation(v) || isTradeObservation(v) || isBookSnapshotObservation(v);
}

function observationCommonOk(v: Record<string, unknown>): boolean {
  return (
    isMarketObservationId(v.event_id) &&
    isNonEmptyString(v.venue) &&
    isNonEmptyString(v.instrument) &&
    isAssetClass(v.asset_class) &&
    isTimestampMs(v.event_time) &&
    (v.source_time === null || isTimestampMs(v.source_time)) &&
    isTimestampMs(v.available_time) &&
    isTimestampMs(v.ingestion_time) &&
    isNonNegativeInteger(v.sequence) &&
    isNonEmptyString(v.provider) &&
    isObservationProvenance(v.provenance)
  );
}

/**
 * COLLECT-ALL validation of a market observation: the discriminant first
 * (unknown_event_type — mirrored from the canonical owners), then the
 * envelope core, the ONE enforced quartet ordering (`available_time >=
 * event_time`, code `timestamp_order`), and the provenance block
 * invariants.
 */
export function validateMarketObservation(v: unknown): readonly RegimeError[] {
  const errors: RegimeError[] = [];
  if (!isRecord(v)) return [invalidType('observation', 'a market observation object')];
  const kind = v.event_type;
  if (kind !== 'quote' && kind !== 'trade' && kind !== 'book_snapshot') {
    return [
      {
        code: 'unknown_event_type',
        path: 'event_type',
        message: `the regime researcher consumes quote, trade and book_snapshot observations, not ${JSON.stringify(kind)}`,
      },
    ];
  }
  if (!isMarketObservationId(v.event_id)) errors.push(invalidField('event_id', 'must be a non-empty event id'));
  if (!isNonEmptyString(v.venue)) errors.push(invalidField('venue', 'must be a non-empty string'));
  if (!isNonEmptyString(v.instrument)) errors.push(invalidField('instrument', 'must be a non-empty string'));
  if (!isAssetClass(v.asset_class)) errors.push(invalidField('asset_class', `must be one of ${ASSET_CLASSES.join('|')}`));
  if (!isTimestampMs(v.event_time)) errors.push(invalidField('event_time', 'must be a valid epoch-millisecond instant'));
  if (v.source_time !== null && !isTimestampMs(v.source_time)) {
    errors.push(invalidField('source_time', 'must be a valid instant or null (the vendor claim is optional)'));
  }
  if (!isTimestampMs(v.available_time)) {
    errors.push(invalidField('available_time', 'must be a valid epoch-millisecond instant'));
  } else if (isTimestampMs(v.event_time) && v.available_time < v.event_time) {
    // The ONE enforced ordering of the canonical quartet law (L4).
    errors.push({
      code: 'timestamp_order',
      path: 'available_time',
      message: 'available_time must never precede event_time',
    });
  }
  if (!isTimestampMs(v.ingestion_time)) errors.push(invalidField('ingestion_time', 'must be a valid epoch-millisecond instant'));
  if (!isNonNegativeInteger(v.sequence)) errors.push(invalidField('sequence', 'must be a non-negative integer'));
  if (!isNonEmptyString(v.provider)) errors.push(invalidField('provider', 'must be a non-empty string'));
  const eventId = typeof v.event_id === 'string' ? v.event_id : '';
  errors.push(...validateObservationProvenance(v.provenance, eventId));
  if (kind === 'quote') {
    if (!isQuotePayloadMirror(v.payload)) {
      errors.push(invalidField('payload', 'must be a canonical quote payload { bid_price, bid_size, ask_price, ask_size }'));
    }
  } else if (kind === 'trade') {
    if (!isTradePayloadMirror(v.payload)) {
      errors.push(invalidField('payload', 'must be a canonical trade payload { price, size, side }'));
    }
  } else {
    if (!isBookSnapshotPayloadMirror(v.payload)) {
      errors.push(invalidField('payload', 'must be a canonical book-snapshot payload { bids, asks }'));
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The L4 as-of gate (point-in-time truth)
// ---------------------------------------------------------------------------

/**
 * A DEFERRED observation: one whose `available_time` exceeds the declared
 * as-of instant. Deferred observations are recorded — never silently
 * dropped, NEVER consumed by any downstream stage (L4).
 */
export interface DeferredMarketObservation {
  readonly observationId: MarketObservationId;
  readonly availableTime: TimestampMs;
  readonly reason: 'future_observation';
}

/**
 * An observation the researcher cannot use, recorded with its typed
 * reason (unsupported kind / invalid shape). Intake never drops anything.
 */
export interface UnsupportedMarketObservation {
  readonly observationId: MarketObservationId | null;
  readonly eventType: string | null;
  readonly reason: 'unsupported_observation_type' | 'invalid_observation';
  /** The first violation code, when the record failed validation. */
  readonly detail: string | null;
}

/**
 * THE L4 GATE: `true` iff the observation is legitimately knowable at the
 * declared as-of instant (`available_time <= asOf`). Pure; total.
 */
export function admitMarketObservation(observation: MarketObservation, asOf: TimestampMs): boolean {
  return observation.available_time <= asOf;
}

/**
 * Gates a batch of observations under the as-of instant. Order is
 * preserved (the pipeline canonicalizes order separately); every offered
 * observation lands in exactly one bucket.
 */
export function gateMarketObservations(
  observations: readonly MarketObservation[],
  asOf: TimestampMs,
): { readonly admitted: readonly MarketObservation[]; readonly deferred: readonly DeferredMarketObservation[] } {
  const admitted: MarketObservation[] = [];
  const deferred: DeferredMarketObservation[] = [];
  for (const observation of observations) {
    if (admitMarketObservation(observation, asOf)) {
      admitted.push(observation);
    } else {
      deferred.push(
        deepFreeze({
          observationId: observation.event_id,
          availableTime: observation.available_time,
          reason: 'future_observation' as const,
        }),
      );
    }
  }
  return deepFreeze({ admitted: deepFreeze(admitted), deferred: deepFreeze(deferred) });
}

/**
 * The canonical observation order: by (available_time, event_id) — the
 * knowledge-time order. Presentation order can never leak into output
 * bytes (the determinism law).
 */
export function canonicalMarketObservationOrder(
  observations: readonly MarketObservation[],
): readonly MarketObservation[] {
  return observations.slice().sort((a, b) => {
    if (a.available_time !== b.available_time) return a.available_time < b.available_time ? -1 : 1;
    if (a.event_id !== b.event_id) return a.event_id < b.event_id ? -1 : 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// The observation source port (injected; no network, no imports)
// ---------------------------------------------------------------------------

/** The descriptor of an observation source (adapter descriptor mirror). */
export interface MarketSourceDescriptor {
  /** Source adapter id (e.g. "market-adapter", "coinbase"). */
  readonly id: string;
  /** Source adapter version. */
  readonly version: string;
  /** Provider identity of the source. */
  readonly provider: string;
}

/**
 * The injected observation port: a PULL-based source of canonical
 * market-event observations (the adapter session's `nextEvent` discipline
 * — the research body never touches a network; sources arrive through
 * this seam). `next()` returns `null` at end-of-stream.
 */
export interface MarketObservationSource {
  /** The declared source descriptor. */
  readonly descriptor: MarketSourceDescriptor;
  /** Pulls the next observation, or `null` when the stream is drained. */
  next(): MarketObservation | null;
}

/** Guard: `MarketObservationSource` (structural — the port seam is honest). */
export function isMarketObservationSource(value: unknown): value is MarketObservationSource {
  if (!isRecord(value)) return false;
  const descriptor: unknown = value.descriptor;
  if (!isRecord(descriptor)) return false;
  if (!isNonEmptyString(descriptor.id)) return false;
  if (!isNonEmptyString(descriptor.version)) return false;
  if (!isNonEmptyString(descriptor.provider)) return false;
  return typeof value.next === 'function';
}

/** Builds a scripted observation source over a fixed record list (tests/fixtures). */
export function createScriptedMarketSource(
  descriptor: MarketSourceDescriptor,
  observations: readonly MarketObservation[],
): MarketObservationSource {
  let index = 0;
  return deepFreeze({
    descriptor: deepFreeze({ ...descriptor }),
    next(): MarketObservation | null {
      if (index >= observations.length) return null;
      const observation = observations[index] as MarketObservation;
      index += 1;
      return observation;
    },
  });
}

/** Validates a run of pulled records into the intake buckets. */
export function classifyPulledMarketRecord(record: unknown): RegimeResult<
  { readonly kind: 'admitted'; readonly observation: MarketObservation } | { readonly kind: 'noted'; readonly note: UnsupportedMarketObservation }
> {
  if (!isRecord(record)) {
    return {
      ok: true,
      value: {
        kind: 'noted',
        note: deepFreeze({
          observationId: null,
          eventType: null,
          reason: 'invalid_observation' as const,
          detail: 'invalid_type',
        }),
      },
    };
  }
  const eventType = typeof record.event_type === 'string' ? record.event_type : null;
  const observationId = typeof record.event_id === 'string' ? record.event_id : null;
  if (isMarketObservation(record)) {
    const errors = validateMarketObservation(record);
    if (errors.length === 0) return { ok: true, value: { kind: 'admitted', observation: record } };
    return {
      ok: true,
      value: {
        kind: 'noted',
        note: deepFreeze({
          observationId,
          eventType,
          reason: 'invalid_observation' as const,
          detail: errors[0]?.code ?? null,
        }),
      },
    };
  }
  return {
    ok: true,
    value: {
      kind: 'noted',
      note: deepFreeze({
        observationId,
        eventType,
        reason: 'unsupported_observation_type' as const,
        detail: null,
      }),
    },
  };
}
