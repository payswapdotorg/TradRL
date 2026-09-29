// @tradrl/body-fundamental-researcher — the observation intake contracts.
//
// Owning Work Order: T023.
//
// STRUCTURAL MIRRORS (law D-003/D-004 — never imports; the trip wires
// live in src/interop.test.ts against the REAL packages on this branch):
// - The observation envelope mirrors the T038 adapter emitter shapes
//   (`adapters/equities` + `adapters/alternative-data`
//   `EmittedEventCommon`): canonical event id, venue, instrument, asset
//   class, the AVAILABILITY QUARTET, sequence, provider, the T008
//   provenance block, and the typed payload. The adapters' extra fields
//   (entitlement, mapping) ride as tolerated extras — the canonical
//   contract is a floor.
// - The provenance block mirrors the canonical `IngestionProvenance`
//   (market-protocol / data-ingestion / provenance lanes):
//   { origin, adapter, derived_from, transform } with the same four
//   validation invariants.
// - The payloads mirror the canonical emitted shapes this lane computes
//   over: reported fundamental data (field/period/value — the equities
//   index-level channel and the alt-data satellite channel), economic
//   series macro releases (indicator/region/period/actual/forecast — the
//   alt-data economicSeries channel), and corporate actions (the equities
//   `other` escape-hatch records with kind 'corporate_action'). The lane's
//   mirrors require the numeric values to be DECIMAL STRINGS (the declared
//   methods compute exact decimal arithmetic over them); a canonical event
//   whose reported value is not a decimal string is noted by intake as
//   invalid-for-this-lane — never silently dropped.
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
import { type FundamentalError, type FundamentalResult, invalidField, invalidType } from './errors';
import { isSignedDecimal } from './decimals';

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

/** The observation kinds the fundamental researcher consumes (closed). */
export const FUNDAMENTAL_OBSERVATION_KINDS = ['fundamental', 'macro_release', 'other'] as const;

/** An observation kind this body's ports accept. */
export type FundamentalObservationKind = (typeof FUNDAMENTAL_OBSERVATION_KINDS)[number];

/** Guard: an observation kind. */
export const isFundamentalObservationKind = (v: unknown): v is FundamentalObservationKind =>
  isMemberOf(FUNDAMENTAL_OBSERVATION_KINDS, v);

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
  /** Adapter id (e.g. "adapter-equities", "adapter-altdata"). */
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
export function validateObservationProvenance(v: unknown, eventId: string, path = 'provenance'): readonly FundamentalError[] {
  const errors: FundamentalError[] = [];
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
// The typed payloads (canonical reported-fundamental / macro-release /
// corporate-action emitter payload mirrors)
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RATIO_RE = /^\d+:\d+$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * The reported-fundamental payload — mirror of the canonical
 * `FundamentalPayload` (market-protocol / provider-sdk / the equities
 * index-level + satellite mapping tables): a reported datum for an
 * instrument, named by its field, valued for a period. THIS LANE requires
 * `value` to be a DECIMAL STRING (the declared assessment methods
 * compute exact decimal arithmetic over reported values).
 */
export interface FundamentalPayloadMirror {
  /** Field name (e.g. "INDEX_LEVEL", "ACTIVE_RIG_COUNT"). */
  readonly field: string;
  /** Reporting period (e.g. "2024-06-03", "2024-Q2"). */
  readonly period: string;
  /** Reported value — a DECIMAL STRING under this lane's mirror. */
  readonly value: string;
  /** Unit label (e.g. "index-points"). */
  readonly unit?: string;
  /** Source statement label (e.g. "index-dissemination"). */
  readonly source?: string;
}

/**
 * The economic-series macro-release payload — mirror of the canonical
 * `MacroReleasePayload` (market-protocol / provider-sdk / the alt-data
 * economicSeries mapping table). THIS LANE requires the numeric fields to
 * be DECIMAL STRINGS.
 */
export interface MacroReleasePayloadMirror {
  /** Indicator identifier (e.g. "TEST-ECON-CPI"). */
  readonly indicator: string;
  /** Region/geography (e.g. "US"). */
  readonly region: string;
  /** Reference period (e.g. "2024-05"). */
  readonly period: string;
  /** Released value — a DECIMAL STRING under this lane's mirror. */
  readonly actual: string;
  /** Consensus forecast — a DECIMAL STRING, when known. */
  readonly forecast?: string;
  /** Prior (possibly revised) value — a DECIMAL STRING, when known. */
  readonly prior?: string;
  /** Unit label (e.g. "%"). */
  readonly unit?: string;
}

/**
 * The structured corporate-action data — mirror of the equities adapter's
 * derived `other`-payload `data` object (the neutral, provider-free
 * vocabulary: symbol, action, effective_date, ratio, currency — the
 * adapter's schema layer has already performed the provider translation,
 * so no provider field name can leak here).
 */
export interface CorporateActionDataMirror {
  /** The affected instrument (the corporate symbol, canonical form). */
  readonly symbol: string;
  /** The action kind (the closed neutral translation). */
  readonly action: 'split' | 'cash_dividend' | 'merger';
  /** The effective date (strict YYYY-MM-DD). */
  readonly effective_date: string;
  /** The action ratio in the documented "N:M" form. */
  readonly ratio: string;
  /** ISO-4217-style currency code. */
  readonly currency: string;
}

/**
 * The corporate-action payload — mirror of the canonical `OtherPayload`
 * escape hatch as the equities adapter shapes it for corporate actions:
 * kind 'corporate_action' with the structured neutral data. THIS LANE
 * accepts ONLY this kind of `other` observation.
 */
export interface CorporateActionPayloadMirror {
  readonly kind: 'corporate_action';
  readonly data: CorporateActionDataMirror;
}

/** Guard: `FundamentalPayloadMirror`. */
export function isFundamentalPayloadMirror(v: unknown): v is FundamentalPayloadMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.field)) return false;
  if (!isNonEmptyString(v.period)) return false;
  if (!isSignedDecimal(v.value)) return false;
  if (v.unit !== undefined && !isNonEmptyString(v.unit)) return false;
  if (v.source !== undefined && !isNonEmptyString(v.source)) return false;
  return true;
}

/** Guard: `MacroReleasePayloadMirror`. */
export function isMacroReleasePayloadMirror(v: unknown): v is MacroReleasePayloadMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.indicator)) return false;
  if (!isNonEmptyString(v.region)) return false;
  if (!isNonEmptyString(v.period)) return false;
  if (!isSignedDecimal(v.actual)) return false;
  if (v.forecast !== undefined && !isSignedDecimal(v.forecast)) return false;
  if (v.prior !== undefined && !isSignedDecimal(v.prior)) return false;
  if (v.unit !== undefined && !isNonEmptyString(v.unit)) return false;
  return true;
}

/** Guard: `CorporateActionDataMirror`. */
export function isCorporateActionDataMirror(v: unknown): v is CorporateActionDataMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.symbol)) return false;
  if (v.action !== 'split' && v.action !== 'cash_dividend' && v.action !== 'merger') return false;
  if (typeof v.effective_date !== 'string' || !DATE_RE.test(v.effective_date)) return false;
  if (typeof v.ratio !== 'string' || !RATIO_RE.test(v.ratio)) return false;
  if (typeof v.currency !== 'string' || !CURRENCY_RE.test(v.currency)) return false;
  return true;
}

/** Guard: `CorporateActionPayloadMirror`. */
export function isCorporateActionPayloadMirror(v: unknown): v is CorporateActionPayloadMirror {
  if (!isRecord(v)) return false;
  if (v.kind !== 'corporate_action') return false;
  return isCorporateActionDataMirror(v.data);
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

/** A reported-fundamental observation: the equities/alt-data emitters' `fundamental` output. */
export interface FundamentalDatumObservation extends ObservationCommon {
  readonly event_type: 'fundamental';
  readonly payload: FundamentalPayloadMirror;
}

/** An economic-series observation: the alt-data emitter's `macro_release` output. */
export interface MacroReleaseObservation extends ObservationCommon {
  readonly event_type: 'macro_release';
  readonly payload: MacroReleasePayloadMirror;
}

/** A corporate-action observation: the equities emitter's `other` output (kind 'corporate_action'). */
export interface CorporateActionObservation extends ObservationCommon {
  readonly event_type: 'other';
  readonly payload: CorporateActionPayloadMirror;
}

/** The observation union the fundamental researcher consumes. */
export type FundamentalObservation =
  | FundamentalDatumObservation
  | MacroReleaseObservation
  | CorporateActionObservation;

/** Guard: `FundamentalDatumObservation`. */
export function isFundamentalDatumObservation(v: unknown): v is FundamentalDatumObservation {
  if (!isRecord(v)) return false;
  if (v.event_type !== 'fundamental') return false;
  return observationCommonOk(v) && isFundamentalPayloadMirror(v.payload);
}

/** Guard: `MacroReleaseObservation`. */
export function isMacroReleaseObservation(v: unknown): v is MacroReleaseObservation {
  if (!isRecord(v)) return false;
  if (v.event_type !== 'macro_release') return false;
  return observationCommonOk(v) && isMacroReleasePayloadMirror(v.payload);
}

/** Guard: `CorporateActionObservation`. */
export function isCorporateActionObservation(v: unknown): v is CorporateActionObservation {
  if (!isRecord(v)) return false;
  if (v.event_type !== 'other') return false;
  return observationCommonOk(v) && isCorporateActionPayloadMirror(v.payload);
}

/** Guard: `FundamentalObservation`. */
export function isFundamentalObservation(v: unknown): v is FundamentalObservation {
  return (
    isFundamentalDatumObservation(v) ||
    isMacroReleaseObservation(v) ||
    isCorporateActionObservation(v)
  );
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
export function validateFundamentalObservation(v: unknown): readonly FundamentalError[] {
  const errors: FundamentalError[] = [];
  if (!isRecord(v)) return [invalidType('observation', 'a research observation object')];
  const kind = v.event_type;
  if (kind !== 'fundamental' && kind !== 'macro_release' && kind !== 'other') {
    return [
      {
        code: 'unknown_event_type',
        path: 'event_type',
        message: `the fundamental researcher consumes fundamental, macro_release and corporate-action (other) observations, not ${JSON.stringify(kind)}`,
      },
    ];
  }
  if (kind === 'other' && isRecord(v.payload) && v.payload.kind !== undefined && v.payload.kind !== 'corporate_action') {
    return [
      {
        code: 'unknown_event_type',
        path: 'event_type',
        message: `the fundamental researcher consumes only 'corporate_action' escape-hatch records, not ${JSON.stringify(v.payload.kind)}`,
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
  if (kind === 'fundamental') {
    if (!isFundamentalPayloadMirror(v.payload)) {
      errors.push(invalidField('payload', 'must be a canonical reported-fundamental payload { field, period, value(decimal), ... }'));
    }
  } else if (kind === 'macro_release') {
    if (!isMacroReleasePayloadMirror(v.payload)) {
      errors.push(invalidField('payload', 'must be a canonical macro-release payload { indicator, region, period, actual(decimal), ... }'));
    }
  } else {
    if (!isCorporateActionPayloadMirror(v.payload)) {
      errors.push(invalidField('payload', "must be a canonical corporate-action payload { kind: 'corporate_action', data: { symbol, action, effective_date, ratio, currency } }"));
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
export function admitObservation(observation: FundamentalObservation, asOf: TimestampMs): boolean {
  return observation.available_time <= asOf;
}

/**
 * Gates a batch of observations under the as-of instant. Order is
 * preserved (the pipeline canonicalizes order separately); every offered
 * observation lands in exactly one bucket.
 */
export function gateObservations(
  observations: readonly FundamentalObservation[],
  asOf: TimestampMs,
): { readonly admitted: readonly FundamentalObservation[]; readonly deferred: readonly DeferredObservation[] } {
  const admitted: FundamentalObservation[] = [];
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
  observations: readonly FundamentalObservation[],
): readonly FundamentalObservation[] {
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
  /** Source adapter id (e.g. "adapter-equities", "adapter-altdata"). */
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
export interface FundamentalObservationSource {
  /** The declared source descriptor. */
  readonly descriptor: ObservationSourceDescriptor;
  /** Pulls the next observation, or `null` when the stream is drained. */
  next(): FundamentalObservation | null;
}

/** Guard: `FundamentalObservationSource` (structural — the port seam is honest). */
export function isFundamentalObservationSource(value: unknown): value is FundamentalObservationSource {
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
  observations: readonly FundamentalObservation[],
): FundamentalObservationSource {
  let index = 0;
  return deepFreeze({
    descriptor: deepFreeze({ ...descriptor }),
    next(): FundamentalObservation | null {
      if (index >= observations.length) return null;
      const observation = observations[index] as FundamentalObservation;
      index += 1;
      return observation;
    },
  });
}

/** Validates a run of pulled records into the intake buckets. */
export function classifyPulledRecord(record: unknown): FundamentalResult<
  { readonly kind: 'admitted'; readonly observation: FundamentalObservation } | { readonly kind: 'noted'; readonly note: UnsupportedObservation }
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
  if (isFundamentalObservation(record)) {
    const errors = validateFundamentalObservation(record);
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
