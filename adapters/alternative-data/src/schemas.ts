/**
 * @tradrl/adapter-alternative-data — documented raw observation schemas
 * (the guard layer).
 *
 * PUBLIC DOCUMENTED SHAPES ONLY (Work Order T038 law: "schemas for
 * representative PUBLIC alt-data shapes (sentiment scores, blockchain
 * on-chain metrics, satellite/economic series — as documented public
 * field schemas)"). The field names and forms below are the documented
 * public observation shapes of the alternative-data vendor; every VALUE
 * in this package's fixtures is synthetic (opaque TEST-* identifiers,
 * synthetic scores and observations) — vendor-licensed series content
 * is never copied (spec/ADAPTERS.md Licensing).
 *
 *   - Sentiment observation (channel "sentiment"):
 *     `{ recordType: "SENTIMENT_OBSERVATION", seriesId, windowStartMs,
 *     windowEndMs, releaseTimeMs, sentimentScore }` — the score is a
 *     signed decimal string (sentiment scales are frequently negative).
 *   - On-chain metric (channel "onChain"):
 *     `{ recordType: "ON_CHAIN_METRIC", chainId, metricCode,
 *     metricValue, windowStartMs, windowEndMs, releaseTimeMs }` — the
 *     metric value is a signed decimal string; the metric code is one of
 *     the documented set (translated by the mapping table's enum).
 *   - Economic series observation (channel "economicSeries"):
 *     `{ recordType: "ECONOMIC_SERIES_OBSERVATION", seriesId,
 *     regionCode, period, actualValue, forecastValue, priorValue,
 *     unitCode, windowStartMs, windowEndMs, releaseTimeMs }` — the
 *     forecast, prior and unit are documented OPTIONAL fields (series
 *     differ in what they carry).
 *   - Satellite observation (channel "satelliteSeries"):
 *     `{ recordType: "SATELLITE_OBSERVATION", seriesId,
 *     observationType, observationPeriod, observationValue, unitCode,
 *     windowStartMs, windowEndMs, releaseTimeMs }` — the unit is a
 *     documented optional field.
 *
 * EVERY observation record declares its observation window
 * (windowStartMs..windowEndMs) and its release instant (releaseTimeMs):
 * the window is what the observation COVERS; the release is when the
 * vendor makes it available. The stateless window laws live in the
 * schema guards (enforced through the declared law's predicates,
 * ../window-release.ts): windowStart <= windowEnd (else malformed) and
 * releaseTime >= windowEnd (else a typed mid-window release error — the
 * "never mid-window" law). The stateful per-series window-overlap law
 * lives in the guard transport.
 *
 * Every guard is hand-rolled and total; no `any`. The guard layer's
 * dispositions (exactly the T037 discipline):
 *
 *   - an extra field the schema does not document  -> typed MappingError
 *     `unmapped_raw_field` (the anti-silent-drop law — never a silent drop);
 *   - a documented field of the wrong shape        -> typed protocol error
 *     `malformed_payload`;
 *   - a documented record-type discriminator with an
 *     undocumented value                          -> typed protocol error
 *     `unknown_message_type`.
 *
 * DERIVATION (deterministic, provider layer — L2): the guard translates
 * the documented forms into the representation the mapping tables
 * declare. The window fields and the series key (seriesId / chainId,
 * where the mapping does not consume it) are guard-consumed — accounted
 * for by the schema checks, the window laws and the per-series
 * sequencing — and never reach the emitter; the release instant is kept
 * (it is the mapping tables' declared event-time field); the metric
 * fields pass through with their NAMES preserved.
 */

import { failure, mappingError, success, type AdapterError, type SdkResult } from './contract/errors';
import { isNonEmptyString, isPositiveSafeInteger, isRecord } from './contract/fields';
import { isSignedDecimal } from './contract/decimals';
import type { JsonObject, JsonValue } from './contract/json';
import { isTimestampMs, type TimestampMs } from './contract/timestamp';
import { altDataProtocolError } from './protocol';
import { isMidWindowRelease } from './window-release';

/**
 * The documented raw field names across the consumed observation
 * channels — the provider vocabulary. It lives ONLY in the adapter's
 * declaration layers (schemas, mapping tables, descriptors); the
 * inverse-neutrality trip-wire test asserts none of these names ever
 * appears as a field of an emitted CANONICAL event (L2: "a canonical
 * event carrying a provider-specific field name is a violation").
 */
export const ALTDATA_RAW_FIELD_NAMES: readonly string[] = [
  'recordType',
  'seriesId',
  'chainId',
  'metricCode',
  'metricValue',
  'sentimentScore',
  'regionCode',
  'period',
  'actualValue',
  'forecastValue',
  'priorValue',
  'unitCode',
  'observationType',
  'observationPeriod',
  'observationValue',
  'windowStartMs',
  'windowEndMs',
  'releaseTimeMs',
];

/** The documented record-type discriminators, per channel. */
const SENTIMENT_RECORD_TYPE = 'SENTIMENT_OBSERVATION';
const ON_CHAIN_RECORD_TYPE = 'ON_CHAIN_METRIC';
const ECONOMIC_RECORD_TYPE = 'ECONOMIC_SERIES_OBSERVATION';
const SATELLITE_RECORD_TYPE = 'SATELLITE_OBSERVATION';

/** The validated observation window + release instant (every channel carries them). */
export interface ObservationWindow {
  readonly windowStartMs: TimestampMs;
  readonly windowEndMs: TimestampMs;
  readonly releaseTimeMs: TimestampMs;
}

/** The validated sentiment observation record. */
export interface NormalizedSentimentObservation extends ObservationWindow {
  readonly recordType: 'SENTIMENT_OBSERVATION';
  readonly seriesId: string;
  readonly sentimentScore: string;
}

/** The validated on-chain metric record. */
export interface NormalizedOnChainMetric extends ObservationWindow {
  readonly recordType: 'ON_CHAIN_METRIC';
  readonly chainId: string;
  readonly metricCode: string;
  readonly metricValue: string;
}

/** The validated economic series observation record. */
export interface NormalizedEconomicObservation extends ObservationWindow {
  readonly recordType: 'ECONOMIC_SERIES_OBSERVATION';
  readonly seriesId: string;
  readonly regionCode: string;
  readonly period: string;
  readonly actualValue: string;
  readonly forecastValue?: string;
  readonly priorValue?: string;
  readonly unitCode?: string;
}

/** The validated satellite observation record. */
export interface NormalizedSatelliteObservation extends ObservationWindow {
  readonly recordType: 'SATELLITE_OBSERVATION';
  readonly seriesId: string;
  readonly observationType: string;
  readonly observationPeriod: string;
  readonly observationValue: string;
  readonly unitCode?: string;
}

function malformed(channel: string, detail: string): AdapterError {
  return altDataProtocolError('malformed_payload', `channel "${channel}": ${detail}`);
}

function unknownMessageType(channel: string, documented: readonly string[], actual: string): AdapterError {
  return altDataProtocolError(
    'unknown_message_type',
    `channel "${channel}": record type "${actual}" is not one of the documented types (${documented.join(' | ')}) — the adapter refuses undocumented record shapes`,
  );
}

function unmappedField(channel: string, field: string): AdapterError {
  return mappingError(
    'unmapped_raw_field',
    `raw field "${field}" on channel "${channel}" is not accounted for by the documented schema or the mapping table — map it, tolerate it explicitly, or fix the feed; silent drops are unrepresentable`,
  );
}

/** Assert the payload's keys are exactly a subset of the documented set (extras are unmapped fields). */
function rejectUndocumentedKeys(channel: string, payload: Record<string, unknown>, documented: readonly string[]): AdapterError | null {
  for (const key of Object.keys(payload).sort()) {
    if (!documented.includes(key)) {
      return unmappedField(channel, key);
    }
  }
  return null;
}

/** Require a documented field to be present. */
function requireField(channel: string, payload: Record<string, unknown>, field: string): AdapterError | null {
  if (payload[field] === undefined) {
    return malformed(channel, `the documented field "${field}" is missing`);
  }
  return null;
}

/** Validate a documented epoch-millisecond timestamp field. */
function guardTimestamp(channel: string, field: string, value: unknown): SdkResult<TimestampMs> {
  if (!isTimestampMs(value) || !isPositiveSafeInteger(value)) {
    return failure(malformed(channel, `field "${field}" must be a positive epoch-millisecond integer (got ${String(value)})`));
  }
  return success(value);
}

/** Validate a documented signed-decimal-string field. */
function guardSignedDecimal(channel: string, field: string, value: unknown): SdkResult<string> {
  if (typeof value !== 'string' || !isSignedDecimal(value)) {
    return failure(malformed(channel, `field "${field}" must be a signed decimal string (got ${typeof value === 'string' ? `"${value}"` : String(value)})`));
  }
  return success(value);
}

/**
 * Validate the documented observation window + release instant of a
 * record, enforcing the stateless window laws (the declared
 * window->release law, ../window-release.ts):
 *   - windowStart <= windowEnd (else malformed — a reversed window is
 *     not a window);
 *   - releaseTime >= windowEnd (else a typed mid-window release — the
 *     "never mid-window" law: an observation covering window W becomes
 *     available at its declared release time).
 */
function guardObservationWindow(
  channel: string,
  record: Record<string, unknown>,
): SdkResult<ObservationWindow> {
  const windowStartMs = guardTimestamp(channel, 'windowStartMs', record.windowStartMs);
  if (!windowStartMs.ok) return windowStartMs;
  const windowEndMs = guardTimestamp(channel, 'windowEndMs', record.windowEndMs);
  if (!windowEndMs.ok) return windowEndMs;
  const releaseTimeMs = guardTimestamp(channel, 'releaseTimeMs', record.releaseTimeMs);
  if (!releaseTimeMs.ok) return releaseTimeMs;

  if (windowEndMs.value < windowStartMs.value) {
    return failure(malformed(channel, `field "windowEndMs" (${windowEndMs.value}) precedes "windowStartMs" (${windowStartMs.value}) — an observation window cannot be reversed`));
  }
  if (isMidWindowRelease(windowEndMs.value, releaseTimeMs.value)) {
    return failure(
      altDataProtocolError(
        'release_before_window_close',
        `channel "${channel}": the declared release instant ${releaseTimeMs.value} precedes the observation window's end ${windowEndMs.value} — an observation covering window W becomes available at its declared release time, never mid-window`,
      ),
    );
  }
  return success({
    windowStartMs: windowStartMs.value,
    windowEndMs: windowEndMs.value,
    releaseTimeMs: releaseTimeMs.value,
  });
}

// ---------------------------------------------------------------------------
// Channel schemas: documented raw record -> validated, normalized record.
// ---------------------------------------------------------------------------

/** The documented sentiment observation fields (channel "sentiment"). */
const SENTIMENT_FIELDS: readonly string[] = [
  'recordType',
  'seriesId',
  'windowStartMs',
  'windowEndMs',
  'releaseTimeMs',
  'sentimentScore',
];

/**
 * Channel "sentiment" — the documented sentiment observation record.
 * Validated shape: the discriminator must be SENTIMENT_OBSERVATION; the
 * score must be a signed decimal string; the window and release instants
 * obey the stateless window laws.
 */
export function guardSentimentObservationPayload(payload: JsonObject): SdkResult<NormalizedSentimentObservation> {
  const channel = 'sentiment';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, SENTIMENT_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of SENTIMENT_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  if (record.recordType !== SENTIMENT_RECORD_TYPE) {
    return failure(unknownMessageType(channel, [SENTIMENT_RECORD_TYPE], String(record.recordType)));
  }
  if (!isNonEmptyString(record.seriesId)) {
    return failure(malformed(channel, 'field "seriesId" must be a non-empty series identifier'));
  }
  const window = guardObservationWindow(channel, record);
  if (!window.ok) return window;
  const sentimentScore = guardSignedDecimal(channel, 'sentimentScore', record.sentimentScore);
  if (!sentimentScore.ok) return sentimentScore;

  return success({
    recordType: SENTIMENT_RECORD_TYPE,
    seriesId: record.seriesId,
    windowStartMs: window.value.windowStartMs,
    windowEndMs: window.value.windowEndMs,
    releaseTimeMs: window.value.releaseTimeMs,
    sentimentScore: sentimentScore.value,
  });
}

/** The documented on-chain metric fields (channel "onChain"). */
const ON_CHAIN_FIELDS: readonly string[] = [
  'recordType',
  'chainId',
  'metricCode',
  'metricValue',
  'windowStartMs',
  'windowEndMs',
  'releaseTimeMs',
];

/**
 * Channel "onChain" — the documented blockchain on-chain metric record.
 * The metric code's documented domain is enforced by the mapping table's
 * declared enum (an undocumented code is a typed enum-mapping failure);
 * the schema validates its string shape.
 */
export function guardOnChainMetricPayload(payload: JsonObject): SdkResult<NormalizedOnChainMetric> {
  const channel = 'onChain';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, ON_CHAIN_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of ON_CHAIN_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  if (record.recordType !== ON_CHAIN_RECORD_TYPE) {
    return failure(unknownMessageType(channel, [ON_CHAIN_RECORD_TYPE], String(record.recordType)));
  }
  if (!isNonEmptyString(record.chainId)) {
    return failure(malformed(channel, 'field "chainId" must be a non-empty chain identifier'));
  }
  if (!isNonEmptyString(record.metricCode)) {
    return failure(malformed(channel, 'field "metricCode" must be a non-empty metric code'));
  }
  const metricValue = guardSignedDecimal(channel, 'metricValue', record.metricValue);
  if (!metricValue.ok) return metricValue;
  const window = guardObservationWindow(channel, record);
  if (!window.ok) return window;

  return success({
    recordType: ON_CHAIN_RECORD_TYPE,
    chainId: record.chainId,
    metricCode: record.metricCode,
    metricValue: metricValue.value,
    windowStartMs: window.value.windowStartMs,
    windowEndMs: window.value.windowEndMs,
    releaseTimeMs: window.value.releaseTimeMs,
  });
}

/** The documented economic series observation fields (channel "economicSeries"). */
const ECONOMIC_FIELDS: readonly string[] = [
  'recordType',
  'seriesId',
  'regionCode',
  'period',
  'actualValue',
  'forecastValue',
  'priorValue',
  'unitCode',
  'windowStartMs',
  'windowEndMs',
  'releaseTimeMs',
];

/** The documented optional economic series fields. */
const ECONOMIC_OPTIONAL_FIELDS: readonly string[] = ['forecastValue', 'priorValue', 'unitCode'];

/**
 * Channel "economicSeries" — the documented economic series observation
 * record. The forecast, prior and unit are documented OPTIONAL fields:
 * present -> validated shape; absent -> the series simply does not carry
 * them.
 */
export function guardEconomicObservationPayload(payload: JsonObject): SdkResult<NormalizedEconomicObservation> {
  const channel = 'economicSeries';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, ECONOMIC_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of ECONOMIC_FIELDS) {
    if (ECONOMIC_OPTIONAL_FIELDS.includes(field)) continue; // optional: validated below when present
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  if (record.recordType !== ECONOMIC_RECORD_TYPE) {
    return failure(unknownMessageType(channel, [ECONOMIC_RECORD_TYPE], String(record.recordType)));
  }
  if (!isNonEmptyString(record.seriesId)) {
    return failure(malformed(channel, 'field "seriesId" must be a non-empty series identifier'));
  }
  if (!isNonEmptyString(record.regionCode)) {
    return failure(malformed(channel, 'field "regionCode" must be a non-empty region code'));
  }
  if (!isNonEmptyString(record.period)) {
    return failure(malformed(channel, 'field "period" must be a non-empty reference period'));
  }
  if (!isNonEmptyString(record.actualValue)) {
    return failure(malformed(channel, 'field "actualValue" must be a non-empty released value'));
  }
  let forecastValue: string | undefined;
  if (record.forecastValue !== undefined) {
    if (!isNonEmptyString(record.forecastValue)) {
      return failure(malformed(channel, `field "forecastValue" must be a non-empty string when present (got ${String(record.forecastValue)})`));
    }
    forecastValue = record.forecastValue;
  }
  let priorValue: string | undefined;
  if (record.priorValue !== undefined) {
    if (!isNonEmptyString(record.priorValue)) {
      return failure(malformed(channel, `field "priorValue" must be a non-empty string when present (got ${String(record.priorValue)})`));
    }
    priorValue = record.priorValue;
  }
  let unitCode: string | undefined;
  if (record.unitCode !== undefined) {
    if (!isNonEmptyString(record.unitCode)) {
      return failure(malformed(channel, `field "unitCode" must be a non-empty string when present (got ${String(record.unitCode)})`));
    }
    unitCode = record.unitCode;
  }
  const window = guardObservationWindow(channel, record);
  if (!window.ok) return window;

  return success({
    recordType: ECONOMIC_RECORD_TYPE,
    seriesId: record.seriesId,
    regionCode: record.regionCode,
    period: record.period,
    actualValue: record.actualValue,
    forecastValue,
    priorValue,
    unitCode,
    windowStartMs: window.value.windowStartMs,
    windowEndMs: window.value.windowEndMs,
    releaseTimeMs: window.value.releaseTimeMs,
  });
}

/** The documented satellite observation fields (channel "satelliteSeries"). */
const SATELLITE_FIELDS: readonly string[] = [
  'recordType',
  'seriesId',
  'observationType',
  'observationPeriod',
  'observationValue',
  'unitCode',
  'windowStartMs',
  'windowEndMs',
  'releaseTimeMs',
];

/** The documented optional satellite fields. */
const SATELLITE_OPTIONAL_FIELDS: readonly string[] = ['unitCode'];

/**
 * Channel "satelliteSeries" — the documented satellite-derived series
 * observation record. The unit is a documented OPTIONAL field.
 */
export function guardSatelliteObservationPayload(payload: JsonObject): SdkResult<NormalizedSatelliteObservation> {
  const channel = 'satelliteSeries';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, SATELLITE_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of SATELLITE_FIELDS) {
    if (SATELLITE_OPTIONAL_FIELDS.includes(field)) continue; // optional: validated below when present
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  if (record.recordType !== SATELLITE_RECORD_TYPE) {
    return failure(unknownMessageType(channel, [SATELLITE_RECORD_TYPE], String(record.recordType)));
  }
  if (!isNonEmptyString(record.seriesId)) {
    return failure(malformed(channel, 'field "seriesId" must be a non-empty series identifier'));
  }
  if (!isNonEmptyString(record.observationType)) {
    return failure(malformed(channel, 'field "observationType" must be a non-empty observation type'));
  }
  if (!isNonEmptyString(record.observationPeriod)) {
    return failure(malformed(channel, 'field "observationPeriod" must be a non-empty observation period'));
  }
  if (!isNonEmptyString(record.observationValue)) {
    return failure(malformed(channel, 'field "observationValue" must be a non-empty observation value'));
  }
  let unitCode: string | undefined;
  if (record.unitCode !== undefined) {
    if (!isNonEmptyString(record.unitCode)) {
      return failure(malformed(channel, `field "unitCode" must be a non-empty string when present (got ${String(record.unitCode)})`));
    }
    unitCode = record.unitCode;
  }
  const window = guardObservationWindow(channel, record);
  if (!window.ok) return window;

  return success({
    recordType: SATELLITE_RECORD_TYPE,
    seriesId: record.seriesId,
    observationType: record.observationType,
    observationPeriod: record.observationPeriod,
    observationValue: record.observationValue,
    unitCode,
    windowStartMs: window.value.windowStartMs,
    windowEndMs: window.value.windowEndMs,
    releaseTimeMs: window.value.releaseTimeMs,
  });
}

// ---------------------------------------------------------------------------
// Derivations: validated records -> emitter-facing payloads (the mapping
// tables' declared representation). Deterministic; FIXED key order;
// optional fields are OMITTED when absent (never undefined-valued — the
// payload is a closed JSON object).
// ---------------------------------------------------------------------------

/**
 * Derive the emitter-facing payload of a sentiment observation: the
 * score and the release instant (the mapping table's declared
 * event-time field). The guard-consumed fields (recordType, seriesId,
 * the window fields) never reach the emitter — accounted for by the
 * schema checks, the window laws and the per-series sequencing.
 */
export function deriveSentimentPayload(observation: NormalizedSentimentObservation): JsonObject {
  return {
    sentimentScore: observation.sentimentScore,
    releaseTimeMs: observation.releaseTimeMs,
  };
}

/**
 * Derive the emitter-facing payload of an on-chain metric: the chain id
 * (the mapping table's enum source for the canonical platform label),
 * the metric code (the enum source for the canonical metric name), the
 * value and the release instant. The window fields and the record
 * discriminator are guard-consumed.
 */
export function deriveOnChainPayload(metric: NormalizedOnChainMetric): JsonObject {
  return {
    chainId: metric.chainId,
    metricCode: metric.metricCode,
    metricValue: metric.metricValue,
    releaseTimeMs: metric.releaseTimeMs,
  };
}

/**
 * Derive the emitter-facing payload of an economic series observation:
 * the series id, region, period, actual value (and the optional
 * forecast, prior and unit) plus the release instant. The window fields
 * and the record discriminator are guard-consumed.
 */
export function deriveEconomicPayload(observation: NormalizedEconomicObservation): JsonObject {
  const payload: Record<string, JsonValue> = {
    seriesId: observation.seriesId,
    regionCode: observation.regionCode,
    period: observation.period,
    actualValue: observation.actualValue,
    releaseTimeMs: observation.releaseTimeMs,
  };
  if (observation.forecastValue !== undefined) payload.forecastValue = observation.forecastValue;
  if (observation.priorValue !== undefined) payload.priorValue = observation.priorValue;
  if (observation.unitCode !== undefined) payload.unitCode = observation.unitCode;
  return payload as JsonObject;
}

/**
 * Derive the emitter-facing payload of a satellite observation: the
 * observation type, period, value (and the optional unit) plus the
 * release instant. The series id, the window fields and the record
 * discriminator are guard-consumed.
 */
export function deriveSatellitePayload(observation: NormalizedSatelliteObservation): JsonObject {
  const payload: Record<string, JsonValue> = {
    observationType: observation.observationType,
    observationPeriod: observation.observationPeriod,
    observationValue: observation.observationValue,
    releaseTimeMs: observation.releaseTimeMs,
  };
  if (observation.unitCode !== undefined) payload.unitCode = observation.unitCode;
  return payload as JsonObject;
}

/**
 * Guard and validate the payload of a message on one of the adapter's
 * documented channels. Channels WITHOUT a documented schema pass through
 * verbatim — the session's routing (unknown_channel) owns unsubscribed
 * channels.
 */
export function guardAltDataPayload(channel: string, payload: JsonObject): SdkResult<JsonObject> {
  if (channel === 'sentiment') {
    const observation = guardSentimentObservationPayload(payload);
    if (!observation.ok) return observation;
    return success(deriveSentimentPayload(observation.value));
  }
  if (channel === 'onChain') {
    const metric = guardOnChainMetricPayload(payload);
    if (!metric.ok) return metric;
    return success(deriveOnChainPayload(metric.value));
  }
  if (channel === 'economicSeries') {
    const observation = guardEconomicObservationPayload(payload);
    if (!observation.ok) return observation;
    return success(deriveEconomicPayload(observation.value));
  }
  if (channel === 'satelliteSeries') {
    const observation = guardSatelliteObservationPayload(payload);
    if (!observation.ok) return observation;
    return success(deriveSatellitePayload(observation.value));
  }
  return success(payload);
}

/** Structural guard for the validated sentiment observation (introspection). */
export function isNormalizedSentimentObservation(value: unknown): value is NormalizedSentimentObservation {
  return (
    isRecord(value) &&
    value.recordType === SENTIMENT_RECORD_TYPE &&
    isNonEmptyString(value.seriesId) &&
    isTimestampMs(value.windowStartMs) &&
    isTimestampMs(value.windowEndMs) &&
    isTimestampMs(value.releaseTimeMs) &&
    isSignedDecimal(value.sentimentScore)
  );
}

/** Structural guard for the validated on-chain metric (introspection). */
export function isNormalizedOnChainMetric(value: unknown): value is NormalizedOnChainMetric {
  return (
    isRecord(value) &&
    value.recordType === ON_CHAIN_RECORD_TYPE &&
    isNonEmptyString(value.chainId) &&
    isNonEmptyString(value.metricCode) &&
    isTimestampMs(value.windowStartMs) &&
    isTimestampMs(value.windowEndMs) &&
    isTimestampMs(value.releaseTimeMs)
  );
}

/** Structural guard for the validated economic observation (introspection). */
export function isNormalizedEconomicObservation(value: unknown): value is NormalizedEconomicObservation {
  return (
    isRecord(value) &&
    value.recordType === ECONOMIC_RECORD_TYPE &&
    isNonEmptyString(value.seriesId) &&
    isNonEmptyString(value.regionCode) &&
    isNonEmptyString(value.period) &&
    isNonEmptyString(value.actualValue) &&
    isTimestampMs(value.releaseTimeMs)
  );
}

/** Structural guard for the validated satellite observation (introspection). */
export function isNormalizedSatelliteObservation(value: unknown): value is NormalizedSatelliteObservation {
  return (
    isRecord(value) &&
    value.recordType === SATELLITE_RECORD_TYPE &&
    isNonEmptyString(value.seriesId) &&
    isNonEmptyString(value.observationType) &&
    isNonEmptyString(value.observationPeriod) &&
    isNonEmptyString(value.observationValue) &&
    isTimestampMs(value.releaseTimeMs)
  );
}
