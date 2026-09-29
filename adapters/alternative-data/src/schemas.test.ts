/**
 * @tradrl/adapter-alternative-data — the documented observation schema
 * tests.
 *
 * Behavioral: every channel's documented shape validated; the negative
 * dispositions (unmapped raw field -> MappingError, malformed documented
 * field -> protocol error, unknown record type -> protocol error); THE
 * STATELESS WINDOW LAWS (a reversed window is malformed; a mid-window
 * release is a typed release_before_window_close — the "never
 * mid-window" law); the documented optional-field semantics; and the
 * derivations into the emitter-facing representation (window fields and
 * series keys dropped where guard-consumed).
 */

import { describe, expect, it } from 'vitest';

import {
  guardSentimentObservationPayload,
  guardOnChainMetricPayload,
  guardEconomicObservationPayload,
  guardSatelliteObservationPayload,
  guardAltDataPayload,
  deriveSentimentPayload,
  deriveOnChainPayload,
  deriveEconomicPayload,
  deriveSatellitePayload,
  isNormalizedSentimentObservation,
  isNormalizedOnChainMetric,
  isNormalizedEconomicObservation,
  isNormalizedSatelliteObservation,
  altDataProtocolCodeOf,
  type JsonObject,
  type SdkResult,
} from './index';

const AT0 = 1_717_423_200_000;
const WINDOW = { windowStartMs: AT0 - 3_600_000, windowEndMs: AT0 - 1_800_000, releaseTimeMs: AT0 };

const sentimentObservation = (overrides: Record<string, unknown> = {}): JsonObject =>
  ({
    recordType: 'SENTIMENT_OBSERVATION',
    seriesId: 'TEST-SENTIMENT-A',
    ...WINDOW,
    sentimentScore: '-0.21',
    ...overrides,
  }) as JsonObject;

const onChainMetric = (overrides: Record<string, unknown> = {}): JsonObject =>
  ({
    recordType: 'ON_CHAIN_METRIC',
    chainId: 'CHAIN-A',
    metricCode: 'ACTIVE_ADDRESSES',
    metricValue: '1520',
    ...WINDOW,
    ...overrides,
  }) as JsonObject;

const economicObservation = (overrides: Record<string, unknown> = {}): JsonObject =>
  ({
    recordType: 'ECONOMIC_SERIES_OBSERVATION',
    seriesId: 'TEST-ECON-GDP',
    regionCode: 'US',
    period: '2024-Q2',
    actualValue: '215.2',
    forecastValue: '214.8',
    priorValue: '214.0',
    unitCode: 'K persons',
    ...WINDOW,
    ...overrides,
  }) as JsonObject;

const satelliteObservation = (overrides: Record<string, unknown> = {}): JsonObject =>
  ({
    recordType: 'SATELLITE_OBSERVATION',
    seriesId: 'TEST-SAT-OIL',
    observationType: 'OIL_STORAGE_ESTIMATE',
    observationPeriod: '2024-06-02',
    observationValue: '512.3',
    unitCode: 'MMbbl',
    ...WINDOW,
    ...overrides,
  }) as JsonObject;

function expectFailure(result: SdkResult<unknown>, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
}

describe('the stateless window laws (every channel carries the window + release fields)', () => {
  it('a reversed window (windowEnd before windowStart) is a typed malformed_payload', () => {
    expectFailure(
      guardSentimentObservationPayload(sentimentObservation({ windowEndMs: AT0 - 3_600_001 })),
      'malformed_payload',
    );
    expectFailure(
      guardSatelliteObservationPayload(satelliteObservation({ windowEndMs: AT0 - 3_600_001 })),
      'malformed_payload',
    );
  });

  it('a release before the window end is a typed release_before_window_close (the never-mid-window law)', () => {
    const midWindow = guardSentimentObservationPayload(sentimentObservation({ releaseTimeMs: AT0 - 1_800_001 }));
    expectFailure(midWindow, 'release_before_window_close');
    if (!midWindow.ok) {
      expect(altDataProtocolCodeOf(midWindow.error)).toBe('release_before_window_close');
      expect(midWindow.error.message).toContain('never mid-window');
    }
    expectFailure(
      guardOnChainMetricPayload(onChainMetric({ releaseTimeMs: AT0 - 1_800_001 })),
      'release_before_window_close',
    );
    expectFailure(
      guardEconomicObservationPayload(economicObservation({ releaseTimeMs: AT0 - 1_800_001 })),
      'release_before_window_close',
    );
  });

  it('a release exactly at the window end is legitimate (available the instant the window closes)', () => {
    expect(guardSentimentObservationPayload(sentimentObservation({ releaseTimeMs: AT0 - 1_800_000 })).ok).toBe(true);
  });

  it('timestamp shape laws: positive epoch-millisecond integers', () => {
    expectFailure(guardSentimentObservationPayload(sentimentObservation({ windowStartMs: 0 })), 'malformed_payload');
    expectFailure(guardSentimentObservationPayload(sentimentObservation({ windowStartMs: -1 })), 'malformed_payload');
    expectFailure(guardSentimentObservationPayload(sentimentObservation({ releaseTimeMs: 'soon' })), 'malformed_payload');
    expectFailure(guardSentimentObservationPayload(sentimentObservation({ windowEndMs: 1.5 })), 'malformed_payload');
  });
});

describe('channel "sentiment" — the documented sentiment observation', () => {
  it('validates the documented shape into a normalized record (negative scores are legitimate)', () => {
    const result = guardSentimentObservationPayload(sentimentObservation());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.seriesId).toBe('TEST-SENTIMENT-A');
      expect(result.value.sentimentScore).toBe('-0.21');
      expect(result.value.windowStartMs).toBe(AT0 - 3_600_000);
      expect(result.value.windowEndMs).toBe(AT0 - 1_800_000);
      expect(result.value.releaseTimeMs).toBe(AT0);
      expect(isNormalizedSentimentObservation(result.value)).toBe(true);
    }
  });

  it('the score must be a signed decimal string', () => {
    expectFailure(guardSentimentObservationPayload(sentimentObservation({ sentimentScore: 'meh' })), 'malformed_payload');
    expectFailure(guardSentimentObservationPayload(sentimentObservation({ sentimentScore: 0.21 })), 'malformed_payload');
    expect(guardSentimentObservationPayload(sentimentObservation({ sentimentScore: '0.21' })).ok).toBe(true);
    expect(guardSentimentObservationPayload(sentimentObservation({ sentimentScore: '1520' })).ok).toBe(true);
  });

  it('an extra field is a typed unmapped_raw_field; an unknown record type is typed', () => {
    expectFailure(guardSentimentObservationPayload(sentimentObservation({ vendor_extra: 1 })), 'unmapped_raw_field');
    expectFailure(guardSentimentObservationPayload(sentimentObservation({ recordType: 'MOOD_OBSERVATION' })), 'unknown_message_type');
  });
});

describe('channel "onChain" — the documented on-chain metric', () => {
  it('validates the documented shape into a normalized record', () => {
    const result = guardOnChainMetricPayload(onChainMetric());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.chainId).toBe('CHAIN-A');
      expect(result.value.metricCode).toBe('ACTIVE_ADDRESSES');
      expect(result.value.metricValue).toBe('1520');
      expect(isNormalizedOnChainMetric(result.value)).toBe(true);
    }
  });

  it('the metric code domain is validated by the mapping enum (the schema validates the string shape)', () => {
    // An undocumented metric code passes the schema (non-empty string) but
    // fails the mapping table's declared enum at emission — typed and
    // tested in mapping-tables.test.ts.
    expect(guardOnChainMetricPayload(onChainMetric({ metricCode: 'MEMPOOL_SIZE' })).ok).toBe(true);
    expectFailure(guardOnChainMetricPayload(onChainMetric({ metricCode: '' })), 'malformed_payload');
  });

  it('the metric value must be a signed decimal string', () => {
    expectFailure(guardOnChainMetricPayload(onChainMetric({ metricValue: 'many' })), 'malformed_payload');
    expectFailure(guardOnChainMetricPayload(onChainMetric({ metricValue: -5 })), 'malformed_payload');
  });

  it('an extra field is a typed unmapped_raw_field; an unknown record type is typed', () => {
    expectFailure(guardOnChainMetricPayload(onChainMetric({ vendor_extra: true })), 'unmapped_raw_field');
    expectFailure(guardOnChainMetricPayload(onChainMetric({ recordType: 'ON_CHAIN_EVENT' })), 'unknown_message_type');
  });
});

describe('channel "economicSeries" — the documented economic series observation', () => {
  it('validates the full documented shape into a normalized record', () => {
    const result = guardEconomicObservationPayload(economicObservation());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.seriesId).toBe('TEST-ECON-GDP');
      expect(result.value.regionCode).toBe('US');
      expect(result.value.period).toBe('2024-Q2');
      expect(result.value.actualValue).toBe('215.2');
      expect(result.value.forecastValue).toBe('214.8');
      expect(result.value.priorValue).toBe('214.0');
      expect(result.value.unitCode).toBe('K persons');
      expect(isNormalizedEconomicObservation(result.value)).toBe(true);
    }
  });

  it('the forecast, prior and unit are optional: a bare observation validates', () => {
    const bare = {
      recordType: 'ECONOMIC_SERIES_OBSERVATION',
      seriesId: 'TEST-ECON-CPI',
      regionCode: 'US',
      period: '2024-05',
      actualValue: '3.3',
      ...WINDOW,
    };
    const result = guardEconomicObservationPayload(bare);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.forecastValue).toBeUndefined();
      expect(result.value.priorValue).toBeUndefined();
      expect(result.value.unitCode).toBeUndefined();
    }
  });

  it('an optional field present with a bad shape is a typed malformed_payload', () => {
    expectFailure(guardEconomicObservationPayload(economicObservation({ forecastValue: '' })), 'malformed_payload');
    expectFailure(guardEconomicObservationPayload(economicObservation({ priorValue: 5 })), 'malformed_payload');
    expectFailure(guardEconomicObservationPayload(economicObservation({ unitCode: '' })), 'malformed_payload');
  });

  it('required field shape laws and the record-type discriminator', () => {
    expectFailure(guardEconomicObservationPayload(economicObservation({ regionCode: '' })), 'malformed_payload');
    expectFailure(guardEconomicObservationPayload(economicObservation({ period: 5 })), 'malformed_payload');
    expectFailure(guardEconomicObservationPayload(economicObservation({ actualValue: null })), 'malformed_payload');
    expectFailure(guardEconomicObservationPayload(economicObservation({ recordType: 'ECON_FORECAST' })), 'unknown_message_type');
    expectFailure(guardEconomicObservationPayload(economicObservation({ vendor_extra: 'x' })), 'unmapped_raw_field');
  });
});

describe('channel "satelliteSeries" — the documented satellite observation', () => {
  it('validates the full documented shape into a normalized record', () => {
    const result = guardSatelliteObservationPayload(satelliteObservation());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.observationType).toBe('OIL_STORAGE_ESTIMATE');
      expect(result.value.observationPeriod).toBe('2024-06-02');
      expect(result.value.observationValue).toBe('512.3');
      expect(result.value.unitCode).toBe('MMbbl');
      expect(isNormalizedSatelliteObservation(result.value)).toBe(true);
    }
  });

  it('the unit is optional; an extra field and an unknown record type are typed', () => {
    const bare = {
      recordType: 'SATELLITE_OBSERVATION',
      seriesId: 'TEST-SAT-OIL',
      observationType: 'OIL_STORAGE_ESTIMATE',
      observationPeriod: '2024-06-02',
      observationValue: '512.3',
      ...WINDOW,
    };
    expect(guardSatelliteObservationPayload(bare).ok).toBe(true);
    expectFailure(guardSatelliteObservationPayload(satelliteObservation({ unitCode: '' })), 'malformed_payload');
    expectFailure(guardSatelliteObservationPayload(satelliteObservation({ vendor_extra: 1 })), 'unmapped_raw_field');
    expectFailure(guardSatelliteObservationPayload(satelliteObservation({ recordType: 'SATELLITE_IMAGE' })), 'unknown_message_type');
  });
});

describe('the derivations into the emitter-facing representation', () => {
  it('deriveSentimentPayload keeps only the score and the release instant', () => {
    const guarded = guardSentimentObservationPayload(sentimentObservation());
    if (!guarded.ok) throw new Error('must guard');
    const payload = deriveSentimentPayload(guarded.value) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['releaseTimeMs', 'sentimentScore']);
  });

  it('deriveOnChainPayload keeps the chain, metric code, value and release instant', () => {
    const guarded = guardOnChainMetricPayload(onChainMetric());
    if (!guarded.ok) throw new Error('must guard');
    const payload = deriveOnChainPayload(guarded.value) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['chainId', 'metricCode', 'metricValue', 'releaseTimeMs']);
  });

  it('deriveEconomicPayload keeps the series fields and omits absent optionals', () => {
    const guarded = guardEconomicObservationPayload(economicObservation());
    if (!guarded.ok) throw new Error('must guard');
    const payload = deriveEconomicPayload(guarded.value) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'actualValue', 'forecastValue', 'period', 'priorValue', 'regionCode', 'releaseTimeMs', 'seriesId', 'unitCode',
    ]);
    const bare = {
      recordType: 'ECONOMIC_SERIES_OBSERVATION',
      seriesId: 'TEST-ECON-CPI',
      regionCode: 'US',
      period: '2024-05',
      actualValue: '3.3',
      ...WINDOW,
    };
    const bareGuarded = guardEconomicObservationPayload(bare);
    if (!bareGuarded.ok) throw new Error('must guard');
    const barePayload = deriveEconomicPayload(bareGuarded.value) as Record<string, unknown>;
    expect(Object.keys(barePayload).sort()).toEqual(['actualValue', 'period', 'regionCode', 'releaseTimeMs', 'seriesId']);
  });

  it('deriveSatellitePayload keeps the observation fields and omits the absent unit', () => {
    const guarded = guardSatelliteObservationPayload(satelliteObservation());
    if (!guarded.ok) throw new Error('must guard');
    const payload = deriveSatellitePayload(guarded.value) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'observationPeriod', 'observationType', 'observationValue', 'releaseTimeMs', 'unitCode',
    ]);
  });
});

describe('guardAltDataPayload routing', () => {
  it('routes each documented channel to its schema guard and derivation', () => {
    expect(guardAltDataPayload('sentiment', sentimentObservation()).ok).toBe(true);
    expect(guardAltDataPayload('onChain', onChainMetric()).ok).toBe(true);
    expect(guardAltDataPayload('economicSeries', economicObservation()).ok).toBe(true);
    expect(guardAltDataPayload('satelliteSeries', satelliteObservation()).ok).toBe(true);
    expectFailure(guardAltDataPayload('sentiment', sentimentObservation({ recordType: 'NOPE' })), 'unknown_message_type');
  });

  it('channels without a documented schema pass through verbatim (the session owns routing)', () => {
    const payload: JsonObject = { anything: 'goes' } as JsonObject;
    const result = guardAltDataPayload('someOtherChannel', payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(payload);
  });
});
