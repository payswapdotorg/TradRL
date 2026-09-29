// @tradrl/body-sentiment-researcher — the observation intake contracts.
//
// Owning Work Order: T021.
//
// STRUCTURAL MIRRORS (law D-003/D-004 — never imports; the trip wires
// live in src/interop.test.ts against the REAL packages on this branch):
// - The observation envelope mirrors the T038 adapter emitter shapes
//   (`adapters/news` + `adapters/alternative-data`
//   `EmittedEventCommon`): canonical event id, venue, instrument, asset
//   class, the AVAILABILITY QUARTET, sequence, provider, the T008
//   provenance block, and the typed payload. The adapters' extra fields
//   (entitlement, mapping) ride as tolerated extras — the canonical
//   contract is a floor.
// - The provenance block mirrors the canonical `IngestionProvenance`
//   (market-protocol / data-ingestion / provenance lanes):
//   { origin, adapter, derived_from, transform } with the same four
//   validation invariants.
// - The payloads mirror the canonical news and social-signal payloads
//   (headline + symbols; platform + metric + signed-decimal value).
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
import { type ObservationId, isObservationId } from './ids';
import { type ResearchError, type ResearchResult, invalidField, invalidType } from './errors';

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

/** The observation kinds the sentiment researcher consumes (closed). */
export const OBSERVATION_KINDS = ['news', 'social_signal'] as const;

/** An observation kind this body's ports accept. */
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/** Guard: an observation kind. */
export const isObservationKind = (v: unknown): v is ObservationKind => isMemberOf(OBSERVATION_KINDS, v);

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
  /** Adapter id (e.g. "news-adapter", "altdata-adapter"). */
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
export function validateObservationProvenance(v: unknown, eventId: string, path = 'provenance'): readonly ResearchError[] {
  const errors: ResearchError[] = [];
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
// The typed payloads (canonical news / social-signal payload mirrors)
// ---------------------------------------------------------------------------

const URL_RE = /^https?:\/\//;

/**
 * The news payload — mirror of the canonical `NewsPayload`
 * (market-protocol / provider-sdk / adapters/news).
 */
export interface NewsPayloadMirror {
  /** Headline. Required, non-empty. */
  readonly headline: string;
  /** Body text, when carried. */
  readonly body?: string;
  /** Editorial source label (opaque, e.g. "publisher-a"). */
  readonly source?: string;
  /** Related instrument ids. May be empty. */
  readonly symbols: readonly string[];
  /** Canonical article URL, when available. */
  readonly url?: string;
  /** Free-form topical tags. */
  readonly tags?: readonly string[];
}

/**
 * The sentiment-score (social-signal) payload — mirror of the canonical
 * `SocialSignalPayload` (market-protocol / provider-sdk /
 * adapters/alternative-data). The score rides as a SIGNED DECIMAL STRING
 * (`"-0.21"`); polarity is the sign, never a separate field.
 */
export interface SocialSignalPayloadMirror {
  /** Platform identifier (opaque, e.g. "sentiment-vendor-a"). */
  readonly platform: string;
  /** Metric name (e.g. "sentiment_score"). */
  readonly metric: string;
  /** Metric value, signed decimal string. */
  readonly value: string;
  /** Author/account, when the signal is account-scoped. */
  readonly author?: string;
  /** Canonical content URL, when available. */
  readonly url?: string;
}

/** Guard: `NewsPayloadMirror`. */
export function isNewsPayloadMirror(v: unknown): v is NewsPayloadMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.headline)) return false;
  if (v.body !== undefined && !isNonEmptyString(v.body)) return false;
  if (v.source !== undefined && !isNonEmptyString(v.source)) return false;
  if (!isArrayOf(v.symbols, isNonEmptyString)) return false;
  if (v.url !== undefined && (typeof v.url !== 'string' || !URL_RE.test(v.url))) return false;
  if (v.tags !== undefined && !isArrayOf(v.tags, isNonEmptyString)) return false;
  return true;
}

/** Guard: `SocialSignalPayloadMirror`. */
export function isSocialSignalPayloadMirror(v: unknown): v is SocialSignalPayloadMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.platform)) return false;
  if (!isNonEmptyString(v.metric)) return false;
  if (typeof v.value !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(v.value)) return false;
  if (v.author !== undefined && !isNonEmptyString(v.author)) return false;
  if (v.url !== undefined && (typeof v.url !== 'string' || !URL_RE.test(v.url))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The observation records (emitter envelope mirrors)
// ---------------------------------------------------------------------------

/**
 * Fields shared by every research observation regardless of kind — the
 * canonical emitter envelope core (event id, venue, instrument, asset
 * class, the availability quartet, sequence, provider, provenance).
 */
export interface ObservationCommon {
  readonly event_id: ObservationId;
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

/** A news observation: the T038 news emitter's canonical output. */
export interface NewsObservation extends ObservationCommon {
  readonly event_type: 'news';
  readonly payload: NewsPayloadMirror;
}

/**
 * A sentiment-score observation: the T038 alternative-data emitter's
 * `social_signal` output whose declared metric is a sentiment score.
 */
export interface SentimentScoreObservation extends ObservationCommon {
  readonly event_type: 'social_signal';
  readonly payload: SocialSignalPayloadMirror;
}

/** The observation union the sentiment researcher consumes. */
export type ResearchObservation = NewsObservation | SentimentScoreObservation;

/** Guard: `NewsObservation`. */
export function isNewsObservation(v: unknown): v is NewsObservation {
  if (!isRecord(v)) return false;
  if (v.event_type !== 'news') return false;
  return observationCommonOk(v) && isNewsPayloadMirror(v.payload);
}

/** Guard: `SentimentScoreObservation`. */
export function isSentimentScoreObservation(v: unknown): v is SentimentScoreObservation {
  if (!isRecord(v)) return false;
  if (v.event_type !== 'social_signal') return false;
  return observationCommonOk(v) && isSocialSignalPayloadMirror(v.payload);
}

/** Guard: `ResearchObservation`. */
export function isResearchObservation(v: unknown): v is ResearchObservation {
  return isNewsObservation(v) || isSentimentScoreObservation(v);
}

function observationCommonOk(v: Record<string, unknown>): boolean {
  return (
    isObservationId(v.event_id) &&
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
 * COLLECT-ALL validation of a research observation: the discriminant
 * first (unknown_event_type — mirrored from the canonical owners), then
 * the envelope core, the ONE enforced quartet ordering
 * (`available_time >= event_time`, code `timestamp_order`), and the
 * provenance block invariants.
 */
export function validateResearchObservation(v: unknown): readonly ResearchError[] {
  const errors: ResearchError[] = [];
  if (!isRecord(v)) return [invalidType('observation', 'a research observation object')];
  const kind = v.event_type;
  if (kind !== 'news' && kind !== 'social_signal') {
    return [
      {
        code: 'unknown_event_type',
        path: 'event_type',
        message: `the sentiment researcher consumes news and social_signal observations, not ${JSON.stringify(kind)}`,
      },
    ];
  }
  if (!isObservationId(v.event_id)) errors.push(invalidField('event_id', 'must be a non-empty event id'));
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
  if (kind === 'news') {
    if (!isNewsPayloadMirror(v.payload)) {
      errors.push(invalidField('payload', 'must be a canonical news payload { headline, symbols, ... }'));
    }
  } else {
    if (!isSocialSignalPayloadMirror(v.payload)) {
      errors.push(invalidField('payload', 'must be a canonical social-signal payload { platform, metric, value, ... }'));
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
export interface DeferredObservation {
  readonly observationId: ObservationId;
  readonly availableTime: TimestampMs;
  readonly reason: 'future_observation';
}

/**
 * An observation the researcher cannot use, recorded with its typed
 * reason (unsupported kind / invalid shape). Intake never drops anything.
 */
export interface UnsupportedObservation {
  readonly observationId: ObservationId | null;
  readonly eventType: string | null;
  readonly reason: 'unsupported_observation_type' | 'invalid_observation';
  /** The first violation code, when the record failed validation. */
  readonly detail: string | null;
}

/**
 * THE L4 GATE: `true` iff the observation is legitimately knowable at the
 * declared as-of instant (`available_time <= asOf`). Pure; total.
 */
export function admitObservation(observation: ResearchObservation, asOf: TimestampMs): boolean {
  return observation.available_time <= asOf;
}

/**
 * Gates a batch of observations under the as-of instant. Order is
 * preserved (the pipeline canonicalizes order separately); every offered
 * observation lands in exactly one bucket.
 */
export function gateObservations(
  observations: readonly ResearchObservation[],
  asOf: TimestampMs,
): { readonly admitted: readonly ResearchObservation[]; readonly deferred: readonly DeferredObservation[] } {
  const admitted: ResearchObservation[] = [];
  const deferred: DeferredObservation[] = [];
  for (const observation of observations) {
    if (admitObservation(observation, asOf)) {
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
export function canonicalObservationOrder(
  observations: readonly ResearchObservation[],
): readonly ResearchObservation[] {
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
export interface ObservationSourceDescriptor {
  /** Source adapter id (e.g. "news-adapter", "altdata-adapter"). */
  readonly id: string;
  /** Source adapter version. */
  readonly version: string;
  /** Provider identity of the source. */
  readonly provider: string;
}

/**
 * The injected observation port: a PULL-based source of canonical
 * observations (the adapter session's `nextEvent` discipline — the
 * research body never touches a network; sources arrive through this
 * seam). `next()` returns `null` at end-of-stream.
 */
export interface ObservationSource {
  /** The declared source descriptor. */
  readonly descriptor: ObservationSourceDescriptor;
  /** Pulls the next observation, or `null` when the stream is drained. */
  next(): ResearchObservation | null;
}

/** Guard: `ObservationSource` (structural — the port seam is honest). */
export function isObservationSource(value: unknown): value is ObservationSource {
  if (!isRecord(value)) return false;
  const descriptor: unknown = value.descriptor;
  if (!isRecord(descriptor)) return false;
  if (!isNonEmptyString(descriptor.id)) return false;
  if (!isNonEmptyString(descriptor.version)) return false;
  if (!isNonEmptyString(descriptor.provider)) return false;
  return typeof value.next === 'function';
}

/** Builds a scripted observation source over a fixed record list (tests/fixtures). */
export function createScriptedObservationSource(
  descriptor: ObservationSourceDescriptor,
  observations: readonly ResearchObservation[],
): ObservationSource {
  let index = 0;
  return deepFreeze({
    descriptor: deepFreeze({ ...descriptor }),
    next(): ResearchObservation | null {
      if (index >= observations.length) return null;
      const observation = observations[index] as ResearchObservation;
      index += 1;
      return observation;
    },
  });
}

/** Validates a run of pulled records into the intake buckets. */
export function classifyPulledRecord(record: unknown): ResearchResult<
  { readonly kind: 'admitted'; readonly observation: ResearchObservation } | { readonly kind: 'noted'; readonly note: UnsupportedObservation }
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
  if (isResearchObservation(record)) {
    const errors = validateResearchObservation(record);
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
