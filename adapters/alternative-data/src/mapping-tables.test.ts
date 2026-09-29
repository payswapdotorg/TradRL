/**
 * @tradrl/adapter-alternative-data — the declared mapping table tests.
 *
 * Behavioral: table validation and immutability; the ANTI-SILENT-DROP law
 * driven directly through the emitter (unmapped field -> typed
 * MappingError; missing mapped field; bad enum keys; invalid decimal
 * value; absent optional field tolerated); THE WINDOW->RELEASE QUARTET
 * POLICY (L4): available_time == the declared release instant ALWAYS —
 * even when the host polls LATE (a late poll does not move the
 * availability instant); and the emitted payload shapes per channel.
 */

import { describe, expect, it } from 'vitest';

import {
  ALTDATA_MAPPING_TABLES,
  ALTDATA_SENTIMENT_TABLE,
  ALTDATA_ON_CHAIN_TABLE,
  ALTDATA_ECONOMIC_SERIES_TABLE,
  ALTDATA_SATELLITE_TABLE,
  ALTDATA_CHANNEL_TABLE_IDS,
  ALTDATA_SOURCE_DESCRIPTOR,
  ALTDATA_ADAPTER,
  ALTDATA_VENDOR_ENTITLEMENT,
  createCanonicalEmitter,
  validateMappingTable,
  accountedRawFields,
  validateEmittedFloor,
  type MappingTable,
  type StreamBinding,
  type InboundMessage,
  type EmittedEvent,
} from './index';

const AT0 = 1_717_423_200_000;
const WINDOW = { windowStartMs: AT0 - 3_600_000, windowEndMs: AT0 - 1_800_000, releaseTimeMs: AT0 };

/** The guard's DERIVED emitter-facing payloads per channel. */
const derivedSentiment = { sentimentScore: '-0.21', releaseTimeMs: AT0 };
const derivedOnChain = { chainId: 'CHAIN-A', metricCode: 'ACTIVE_ADDRESSES', metricValue: '1520', releaseTimeMs: AT0 };
const derivedEconomic = {
  seriesId: 'TEST-ECON-GDP', regionCode: 'US', period: '2024-Q2', actualValue: '215.2',
  forecastValue: '214.8', priorValue: '214.0', unitCode: 'K persons', releaseTimeMs: AT0,
};
const derivedSatellite = {
  observationType: 'OIL_STORAGE_ESTIMATE', observationPeriod: '2024-06-02', observationValue: '512.3',
  unitCode: 'MMbbl', releaseTimeMs: AT0,
};

function binding(channel: string, table: MappingTable, instrument: string, assetClass: 'equity' | 'crypto' | 'macro' | 'commodity'): StreamBinding {
  return {
    channel,
    venue: 'ALT-VENDOR-A',
    instrument,
    asset_class: assetClass,
    table,
  };
}

function emitterFor(tables: readonly MappingTable[], entitlement?: unknown) {
  const construction = createCanonicalEmitter({
    source: ALTDATA_SOURCE_DESCRIPTOR,
    adapter: ALTDATA_ADAPTER,
    mapping_tables: tables,
    entitlement: entitlement === undefined ? ALTDATA_VENDOR_ENTITLEMENT : entitlement,
  });
  if (!construction.ok) throw new Error(`emitter must construct: ${JSON.stringify(construction.errors)}`);
  return construction.emitter;
}

function message(payload: Record<string, unknown>, at: number, channel = 'sentiment'): InboundMessage {
  return { at: at as InboundMessage['at'], channel, payload: payload as InboundMessage['payload'] };
}

describe('table declarations', () => {
  it('every declared table validates and is deep-frozen', () => {
    for (const table of ALTDATA_MAPPING_TABLES) {
      expect(table.table_id.length).toBeGreaterThan(0);
      expect(Object.isFrozen(table)).toBe(true);
      const roundTrip = validateMappingTable(table);
      expect(roundTrip.ok).toBe(true);
    }
  });

  it('declares one table per channel with unique ids and emittable event types', () => {
    const ids = ALTDATA_MAPPING_TABLES.map((table) => table.table_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const table of ALTDATA_MAPPING_TABLES) {
      expect(ALTDATA_SOURCE_DESCRIPTOR.capabilities.event_types).toContain(table.event_type);
    }
    expect(ALTDATA_CHANNEL_TABLE_IDS.sentiment).toBe('altdata-sentiment-observation');
    expect(ALTDATA_CHANNEL_TABLE_IDS.onChain).toBe('altdata-on-chain-metric');
    expect(ALTDATA_CHANNEL_TABLE_IDS.economicSeries).toBe('altdata-economic-series');
    expect(ALTDATA_CHANNEL_TABLE_IDS.satelliteSeries).toBe('altdata-satellite-observation');
  });

  it('every table declares the window->release policy (event-time basis on the release field)', () => {
    for (const table of ALTDATA_MAPPING_TABLES) {
      expect(table.source_time_policy.event_time_basis).toBe('raw-field');
      expect(table.source_time_policy.event_time_field).toBe('releaseTimeMs');
      expect(table.source_time_policy.availability_basis).toBe('event-time');
      expect(table.source_time_policy.source_time_field).toBeNull();
      expect(accountedRawFields(table)).toContain('releaseTimeMs');
    }
    // The guard-consumed documented fields never reach the emitter.
    expect(accountedRawFields(ALTDATA_SENTIMENT_TABLE)).not.toContain('seriesId');
    expect(accountedRawFields(ALTDATA_SENTIMENT_TABLE)).not.toContain('windowStartMs');
    expect(accountedRawFields(ALTDATA_ON_CHAIN_TABLE)).not.toContain('windowEndMs');
    // ...except where the mapping CONSUMES the series key (economicSeries -> indicator).
    expect(accountedRawFields(ALTDATA_ECONOMIC_SERIES_TABLE)).toContain('seriesId');
  });

  it('the sentiment table declares the platform and metric constants', () => {
    const platform = ALTDATA_SENTIMENT_TABLE.constants.find((constant) => constant.canonical_field === 'platform');
    const metric = ALTDATA_SENTIMENT_TABLE.constants.find((constant) => constant.canonical_field === 'metric');
    if (platform === undefined || metric === undefined) throw new Error('the constants must be declared');
    expect(platform.value).toBe('sentiment-vendor-a');
    expect(metric.value).toBe('sentiment_score');
  });

  it('the economic table declares its optional field mappings as optional', () => {
    for (const field of ['forecastValue', 'priorValue', 'unitCode']) {
      const mapping = ALTDATA_ECONOMIC_SERIES_TABLE.fields.find((entry) => entry.raw_field === field);
      if (mapping === undefined) throw new Error(`the ${field} mapping must exist`);
      expect(mapping.required).toBe(false);
    }
  });
});

describe('the anti-silent-drop law through the emitter', () => {
  it('an unmapped derived field is a typed MappingError naming the field', () => {
    const emitter = emitterFor([ALTDATA_SENTIMENT_TABLE]);
    const result = emitter.emit(message({ ...derivedSentiment, vendor_extra: 'surprise' }, AT0), binding('sentiment', ALTDATA_SENTIMENT_TABLE, 'TEST-AAA', 'equity'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('unmapped_raw_field');
      expect(result.error.message).toContain('vendor_extra');
    }
  });

  it('a missing required mapped field is a typed MappingError', () => {
    const { sentimentScore: _omitted, ...withoutScore } = derivedSentiment;
    const emitter = emitterFor([ALTDATA_SENTIMENT_TABLE]);
    const result = emitter.emit(message(withoutScore, AT0), binding('sentiment', ALTDATA_SENTIMENT_TABLE, 'TEST-AAA', 'equity'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('mapped_field_missing');
    }
  });

  it('an undocumented chain id is a typed enum MappingError (the enum owns the chain domain)', () => {
    const emitter = emitterFor([ALTDATA_ON_CHAIN_TABLE]);
    const result = emitter.emit(message({ ...derivedOnChain, chainId: 'CHAIN-Z' }, AT0, 'onChain'), binding('onChain', ALTDATA_ON_CHAIN_TABLE, 'TEST-CHAIN-A', 'crypto'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('invalid_mapped_value');
      expect(result.error.message).toContain('CHAIN-Z');
    }
  });

  it('an undocumented metric code is a typed enum MappingError', () => {
    const emitter = emitterFor([ALTDATA_ON_CHAIN_TABLE]);
    const result = emitter.emit(message({ ...derivedOnChain, metricCode: 'MEMPOOL_SIZE' }, AT0, 'onChain'), binding('onChain', ALTDATA_ON_CHAIN_TABLE, 'TEST-CHAIN-A', 'crypto'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('invalid_mapped_value');
      expect(result.error.message).toContain('MEMPOOL_SIZE');
    }
  });

  it('a mapped value that violates the decimal-string transform is a typed MappingError', () => {
    const emitter = emitterFor([ALTDATA_SENTIMENT_TABLE]);
    const result = emitter.emit(message({ ...derivedSentiment, sentimentScore: 'moodish' }, AT0), binding('sentiment', ALTDATA_SENTIMENT_TABLE, 'TEST-AAA', 'equity'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('invalid_mapped_value');
    }
  });

  it('an absent optional mapped field is tolerated (economic series without forecast/prior/unit)', () => {
    const { forecastValue: _f, priorValue: _p, unitCode: _u, ...bare } = derivedEconomic;
    const emitter = emitterFor([ALTDATA_ECONOMIC_SERIES_TABLE]);
    const result = emitter.emit(message(bare, AT0, 'economicSeries'), binding('economicSeries', ALTDATA_ECONOMIC_SERIES_TABLE, 'TEST-ECON-GDP', 'macro'));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.event_type === 'macro_release') {
      expect(result.value.payload.forecast).toBeUndefined();
      expect(result.value.payload.prior).toBeUndefined();
      expect(result.value.payload.unit).toBeUndefined();
    }
  });

  it('emission without the declared entitlement is a typed EntitlementError', () => {
    const construction = createCanonicalEmitter({
      source: ALTDATA_SOURCE_DESCRIPTOR,
      adapter: ALTDATA_ADAPTER,
      mapping_tables: [ALTDATA_SENTIMENT_TABLE],
      entitlement: undefined,
    });
    if (!construction.ok) throw new Error('must construct');
    const result = construction.emitter.emit(message(derivedSentiment, AT0), binding('sentiment', ALTDATA_SENTIMENT_TABLE, 'TEST-AAA', 'equity'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('entitlement');
      expect(result.error.code).toBe('entitlement_undeclared');
    }
  });
});

describe('THE WINDOW->RELEASE QUARTET POLICY (L4 — available at the declared release instant)', () => {
  it('event_time == available_time == the declared release instant (even when received exactly at release)', () => {
    const emitter = emitterFor([ALTDATA_SENTIMENT_TABLE]);
    const result = emitter.emit(message(derivedSentiment, AT0), binding('sentiment', ALTDATA_SENTIMENT_TABLE, 'TEST-AAA', 'equity'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const event: EmittedEvent = result.value;
      expect(event.event_time).toBe(AT0);
      expect(event.available_time).toBe(AT0);
      expect(event.ingestion_time).toBe(AT0);
      expect(event.source_time).toBeNull();
    }
  });

  it('a LATE poll does not move the availability instant (available stays at the release instant — L4 point-in-time truth)', () => {
    const emitter = emitterFor([ALTDATA_ON_CHAIN_TABLE]);
    const latePoll = AT0 + 7_200_000; // the host polled two hours after the release
    const result = emitter.emit(message(derivedOnChain, latePoll, 'onChain'), binding('onChain', ALTDATA_ON_CHAIN_TABLE, 'TEST-CHAIN-A', 'crypto'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.event_time).toBe(AT0);      // the release instant (the declared basis)
      expect(result.value.available_time).toBe(AT0);  // NOT the late poll — the declared law
      expect(result.value.ingestion_time).toBe(latePoll); // when the host actually ingested it
    }
  });

  it('every channel obeys the same declared law (economic + satellite)', () => {
    const latePoll = AT0 + 3_600_000;
    const economic = emitterFor([ALTDATA_ECONOMIC_SERIES_TABLE]).emit(
      message(derivedEconomic, latePoll, 'economicSeries'),
      binding('economicSeries', ALTDATA_ECONOMIC_SERIES_TABLE, 'TEST-ECON-GDP', 'macro'),
    );
    expect(economic.ok).toBe(true);
    if (economic.ok) {
      expect(economic.value.available_time).toBe(AT0);
      expect(economic.value.ingestion_time).toBe(latePoll);
    }
    const satellite = emitterFor([ALTDATA_SATELLITE_TABLE]).emit(
      message(derivedSatellite, latePoll, 'satelliteSeries'),
      binding('satelliteSeries', ALTDATA_SATELLITE_TABLE, 'TEST-SAT-OIL', 'commodity'),
    );
    expect(satellite.ok).toBe(true);
    if (satellite.ok) {
      expect(satellite.value.available_time).toBe(AT0);
    }
  });
});

describe('the emitted payload shapes per channel', () => {
  it('sentiment emits a canonical social_signal with the declared platform/metric constants', () => {
    const emitter = emitterFor([ALTDATA_SENTIMENT_TABLE]);
    const result = emitter.emit(message(derivedSentiment, AT0), binding('sentiment', ALTDATA_SENTIMENT_TABLE, 'TEST-AAA', 'equity'));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.event_type === 'social_signal') {
      expect(result.value.payload.platform).toBe('sentiment-vendor-a');
      expect(result.value.payload.metric).toBe('sentiment_score');
      expect(result.value.payload.value).toBe('-0.21');
    } else {
      throw new Error('must be a social_signal event');
    }
  });

  it('onChain emits a canonical social_signal with the enum-translated platform and metric', () => {
    const emitter = emitterFor([ALTDATA_ON_CHAIN_TABLE]);
    const result = emitter.emit(message(derivedOnChain, AT0, 'onChain'), binding('onChain', ALTDATA_ON_CHAIN_TABLE, 'TEST-CHAIN-A', 'crypto'));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.event_type === 'social_signal') {
      expect(result.value.payload.platform).toBe('chain-a'); // the enum translation, never the raw chain id
      expect(result.value.payload.metric).toBe('active_addresses');
      expect(result.value.payload.value).toBe('1520');
    } else {
      throw new Error('must be a social_signal event');
    }
  });

  it('economicSeries emits a canonical macro_release with the series fields', () => {
    const emitter = emitterFor([ALTDATA_ECONOMIC_SERIES_TABLE]);
    const result = emitter.emit(message(derivedEconomic, AT0, 'economicSeries'), binding('economicSeries', ALTDATA_ECONOMIC_SERIES_TABLE, 'TEST-ECON-GDP', 'macro'));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.event_type === 'macro_release') {
      expect(result.value.payload.indicator).toBe('TEST-ECON-GDP');
      expect(result.value.payload.region).toBe('US');
      expect(result.value.payload.period).toBe('2024-Q2');
      expect(result.value.payload.actual).toBe('215.2');
      expect(result.value.payload.forecast).toBe('214.8');
      expect(result.value.payload.prior).toBe('214.0');
      expect(result.value.payload.unit).toBe('K persons');
    } else {
      throw new Error('must be a macro_release event');
    }
  });

  it('satelliteSeries emits a canonical fundamental with the declared source constant', () => {
    const emitter = emitterFor([ALTDATA_SATELLITE_TABLE]);
    const result = emitter.emit(message(derivedSatellite, AT0, 'satelliteSeries'), binding('satelliteSeries', ALTDATA_SATELLITE_TABLE, 'TEST-SAT-OIL', 'commodity'));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.event_type === 'fundamental') {
      expect(result.value.payload.field).toBe('OIL_STORAGE_ESTIMATE');
      expect(result.value.payload.period).toBe('2024-06-02');
      expect(result.value.payload.value).toBe('512.3');
      expect(result.value.payload.unit).toBe('MMbbl');
      expect(result.value.payload.source).toBe('satellite-observation');
    } else {
      throw new Error('must be a fundamental event');
    }
  });

  it('every emitted event satisfies the canonical envelope floor (defense in depth)', () => {
    const emitter = emitterFor(ALTDATA_MAPPING_TABLES);
    const first = emitter.emit(message(derivedSentiment, AT0), binding('sentiment', ALTDATA_SENTIMENT_TABLE, 'TEST-AAA', 'equity'));
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(validateEmittedFloor(first.value)).toEqual([]);
    }
  });
});
