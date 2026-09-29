/**
 * @tradrl/adapter-alternative-data — the declared mapping tables.
 *
 * Work Order T038: "mapping (observation window -> available time
 * policy: an alt-datum covering window W becomes available at its
 * declared release time — never mid-window)". One table per channel;
 * the family is exported as {@link ALTDATA_MAPPING_TABLES}.
 *
 * THE WINDOW->RELEASE QUARTET POLICY (identical on every table — the
 * declared law, ../window-release.ts): event_time_basis 'raw-field'
 * with event_time_field "releaseTimeMs" and availability_basis
 * 'event-time' — the release instant IS the event (the release is the
 * occurrence that makes the windowed observation a fact), and the
 * observation becomes available EXACTLY at its declared release
 * instant: available_time == releaseTimeMs ALWAYS, even when the host
 * polls late (L4 point-in-time truth for backtests — a late poll does
 * not move the availability instant). The "never mid-window" half of
 * the law is enforced by the guard (release >= windowEnd, typed error)
 * and the window itself is guard-consumed (it never reaches the
 * emitter).
 *
 * RAW FIELD PROVENANCE, per table:
 *   - "altdata-sentiment-observation" (channel "sentiment" ->
 *     social_signal): the guard derives { sentimentScore, releaseTimeMs }.
 *     `sentimentScore` maps to the canonical value (decimal-string); the
 *     platform and metric are declared CONSTANTS (the vendor's sentiment
 *     platform id and the metric name). The guard-consumed documented
 *     fields (recordType, seriesId, the window fields) never reach the
 *     emitter.
 *   - "altdata-on-chain-metric" (channel "onChain" -> social_signal):
 *     the guard derives { chainId, metricCode, metricValue,
 *     releaseTimeMs }. `chainId` maps to the canonical platform label
 *     through the declared ENUM; `metricCode` maps to the canonical
 *     metric name through the declared ENUM; `metricValue` maps to the
 *     value (decimal-string).
 *   - "altdata-economic-series" (channel "economicSeries" ->
 *     macro_release): the guard derives { seriesId, regionCode, period,
 *     actualValue, forecastValue?, priorValue?, unitCode?,
 *     releaseTimeMs }. The series id, region code, period and actual
 *     value map directly (indicator, region, period, actual); the
 *     forecast, prior and unit are optional field mappings.
 *   - "altdata-satellite-observation" (channel "satelliteSeries" ->
 *     fundamental): the guard derives { observationType,
 *     observationPeriod, observationValue, unitCode?, releaseTimeMs }.
 *     The observation type, period and value map directly (field,
 *     period, value); the unit is an optional mapping; the source
 *     statement label is a declared constant.
 *
 * Every table is validated (collect-all) and deep-frozen; the
 * unmapped-field law is enforced BOTH here (the guard's documented-schema
 * check) and in the emitter (raw accounting over the derived payload).
 */

import { validateMappingTable, type MappingTable, type MappingTableValidation } from './contract/mapping';

/** The channel -> table binding (the session's subscription targets). */
export const ALTDATA_CHANNEL_TABLE_IDS: Readonly<Record<string, string>> = {
  sentiment: 'altdata-sentiment-observation',
  onChain: 'altdata-on-chain-metric',
  economicSeries: 'altdata-economic-series',
  satelliteSeries: 'altdata-satellite-observation',
};

function declareTable(value: unknown): MappingTable {
  const validation: MappingTableValidation = validateMappingTable(value);
  if (!validation.ok) {
    // Our own declaration — a validation failure is a programming error.
    throw new Error(`the alternative-data mapping table declaration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return validation.value;
}

/** The window->release source-time policy (identical on every table — the declared law). */
const WINDOW_RELEASE_POLICY = {
  event_time_basis: 'raw-field',
  event_time_field: 'releaseTimeMs',
  source_time_field: null,
  availability_basis: 'event-time',
} as const;

/**
 * The declared chain id -> neutral platform label enum (the documented
 * on-chain chain identifiers; the values are opaque neutral labels —
 * provider vocabulary lives in THIS map, never in the canonical event
 * fields).
 */
const CHAIN_ENUM: Readonly<Record<string, string>> = {
  'CHAIN-A': 'chain-a',
  'CHAIN-B': 'chain-b',
};

/**
 * The declared metric code -> canonical metric name enum (the
 * documented on-chain metric codes).
 */
const METRIC_ENUM: Readonly<Record<string, string>> = {
  ACTIVE_ADDRESSES: 'active_addresses',
  TX_COUNT: 'tx_count',
  AVG_TX_VALUE: 'avg_tx_value',
};

/** Channel "sentiment" (documented sentiment observation) -> canonical social_signal. */
export const ALTDATA_SENTIMENT_TABLE: MappingTable = declareTable({
  table_id: 'altdata-sentiment-observation',
  event_type: 'social_signal',
  fields: [
    { raw_field: 'sentimentScore', canonical_field: 'value', transform: { kind: 'decimal-string' } },
  ],
  constants: [
    { canonical_field: 'platform', value: 'sentiment-vendor-a' },
    { canonical_field: 'metric', value: 'sentiment_score' },
  ],
  tolerated: [],
  source_time_policy: WINDOW_RELEASE_POLICY,
});

/** Channel "onChain" (documented on-chain metric) -> canonical social_signal. */
export const ALTDATA_ON_CHAIN_TABLE: MappingTable = declareTable({
  table_id: 'altdata-on-chain-metric',
  event_type: 'social_signal',
  fields: [
    { raw_field: 'chainId', canonical_field: 'platform', transform: { kind: 'enum', map: CHAIN_ENUM } },
    { raw_field: 'metricCode', canonical_field: 'metric', transform: { kind: 'enum', map: METRIC_ENUM } },
    { raw_field: 'metricValue', canonical_field: 'value', transform: { kind: 'decimal-string' } },
  ],
  constants: [],
  tolerated: [],
  source_time_policy: WINDOW_RELEASE_POLICY,
});

/** Channel "economicSeries" (documented economic series observation) -> canonical macro_release. */
export const ALTDATA_ECONOMIC_SERIES_TABLE: MappingTable = declareTable({
  table_id: 'altdata-economic-series',
  event_type: 'macro_release',
  fields: [
    { raw_field: 'seriesId', canonical_field: 'indicator', transform: { kind: 'identity' } },
    { raw_field: 'regionCode', canonical_field: 'region', transform: { kind: 'identity' } },
    { raw_field: 'period', canonical_field: 'period', transform: { kind: 'identity' } },
    { raw_field: 'actualValue', canonical_field: 'actual', transform: { kind: 'identity' } },
    { raw_field: 'forecastValue', canonical_field: 'forecast', transform: { kind: 'identity' }, required: false },
    { raw_field: 'priorValue', canonical_field: 'prior', transform: { kind: 'identity' }, required: false },
    { raw_field: 'unitCode', canonical_field: 'unit', transform: { kind: 'identity' }, required: false },
  ],
  constants: [],
  tolerated: [],
  source_time_policy: WINDOW_RELEASE_POLICY,
});

/** Channel "satelliteSeries" (documented satellite observation) -> canonical fundamental. */
export const ALTDATA_SATELLITE_TABLE: MappingTable = declareTable({
  table_id: 'altdata-satellite-observation',
  event_type: 'fundamental',
  fields: [
    { raw_field: 'observationType', canonical_field: 'field', transform: { kind: 'identity' } },
    { raw_field: 'observationPeriod', canonical_field: 'period', transform: { kind: 'identity' } },
    { raw_field: 'observationValue', canonical_field: 'value', transform: { kind: 'identity' } },
    { raw_field: 'unitCode', canonical_field: 'unit', transform: { kind: 'identity' }, required: false },
  ],
  constants: [
    { canonical_field: 'source', value: 'satellite-observation' },
  ],
  tolerated: [],
  source_time_policy: WINDOW_RELEASE_POLICY,
});

/** The declared mapping table family (one per documented channel). */
export const ALTDATA_MAPPING_TABLES: readonly MappingTable[] = [
  ALTDATA_SENTIMENT_TABLE,
  ALTDATA_ON_CHAIN_TABLE,
  ALTDATA_ECONOMIC_SERIES_TABLE,
  ALTDATA_SATELLITE_TABLE,
];
