/**
 * @tradrl/adapter-alternative-data — the INVERSE-neutrality trip-wire.
 *
 * Acceptance criterion 4: "a test asserts the CANONICAL emitted events
 * contain no provider-specific field names (Binance/Coinbase vocabulary
 * lives only in descriptor/mapping/session layers)."
 *
 * Law L2/L13 read inversely: the SDK must contain no provider name; THIS
 * adapter is where the alternative-data vendor vocabulary lives — but
 * ONLY in the declaration layers (descriptor, schemas, mapping tables,
 * guard). The emitted CANONICAL events must be provider-neutral
 * market-protocol shapes: no vendor raw field name may appear as a field
 * of an emitted event (beyond the names the canonical payload contracts
 * themselves share), and the documented raw payload forms (chain ids,
 * metric codes) must not leak into the canonical values.
 *
 * The test walks every emitted event RECURSIVELY, collecting every field
 * name, and asserts the intersection with the adapter's exported
 * provider vocabulary ({@link ALTDATA_RAW_FIELD_NAMES}) is empty; it
 * also proves the positive direction — the vocabulary DOES live in the
 * declaration layers.
 */

import { describe, expect, it } from 'vitest';

import {
  createAltDataAdapterSession,
  altDataSubscription,
  ALTDATA_VENDOR_ENTITLEMENT,
  ALTDATA_RAW_FIELD_NAMES,
  ALTDATA_SOURCE_DESCRIPTOR,
  ALTDATA_MAPPING_TABLES,
  accountedRawFields,
  deriveSentimentPayload,
  deriveOnChainPayload,
  deriveEconomicPayload,
  deriveSatellitePayload,
  guardSentimentObservationPayload,
  guardOnChainMetricPayload,
  guardEconomicObservationPayload,
  guardSatelliteObservationPayload,
  type AdapterSession,
  type EmittedEvent,
  type JsonObject,
} from './index';
import { createFakeTransport, type TransportScript, type TimestampMs } from '../../../packages/provider-sdk/src/index';

const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = 1_717_423_200_000;
const W1 = { windowStartMs: AT0 - 3_600_000, windowEndMs: AT0 - 1_800_000, releaseTimeMs: AT0 };

/** Emit a stream covering EVERY documented channel, with canonical identity values only. */
function emitAll(): EmittedEvent[] {
  const transportScript: TransportScript = {
    inbound: [
      {
        at: ms(AT0),
        channel: 'sentiment',
        payload: {
          recordType: 'SENTIMENT_OBSERVATION',
          seriesId: 'TEST-SENTIMENT-A',
          windowStartMs: W1.windowStartMs,
          windowEndMs: W1.windowEndMs,
          releaseTimeMs: W1.releaseTimeMs,
          sentimentScore: '-0.21',
        },
      },
      {
        at: ms(AT0 + 10),
        channel: 'onChain',
        payload: {
          recordType: 'ON_CHAIN_METRIC',
          chainId: 'CHAIN-A',
          metricCode: 'TX_COUNT',
          metricValue: '301250',
          windowStartMs: W1.windowStartMs,
          windowEndMs: W1.windowEndMs,
          releaseTimeMs: W1.releaseTimeMs,
        },
      },
      {
        at: ms(AT0 + 20),
        channel: 'economicSeries',
        payload: {
          recordType: 'ECONOMIC_SERIES_OBSERVATION',
          seriesId: 'TEST-ECON-GDP',
          regionCode: 'US',
          period: '2024-Q2',
          actualValue: '215.2',
          forecastValue: '214.8',
          windowStartMs: W1.windowStartMs,
          windowEndMs: W1.windowEndMs,
          releaseTimeMs: W1.releaseTimeMs,
        },
      },
      {
        at: ms(AT0 + 30),
        channel: 'satelliteSeries',
        payload: {
          recordType: 'SATELLITE_OBSERVATION',
          seriesId: 'TEST-SAT-OIL',
          observationType: 'OIL_STORAGE_ESTIMATE',
          observationPeriod: '2024-06-02',
          observationValue: '512.3',
          unitCode: 'MMbbl',
          windowStartMs: W1.windowStartMs,
          windowEndMs: W1.windowEndMs,
          releaseTimeMs: W1.releaseTimeMs,
        },
      },
    ],
    recv_failures: [],
    send_failures: [],
    receive_timeout_ms: null,
  };
  const construction = createFakeTransport(transportScript);
  if (!construction.ok) throw new Error('script must validate');
  const sessionConstruction = createAltDataAdapterSession({
    transport: construction.transport,
    entitlement: ALTDATA_VENDOR_ENTITLEMENT,
  });
  if (!sessionConstruction.ok) throw new Error('session must construct');
  const session: AdapterSession = sessionConstruction.session;
  session.open();
  for (const [channel, instrument] of [
    ['sentiment', 'TEST-AAA'],
    ['onChain', 'TEST-CHAIN-A'],
    ['economicSeries', 'TEST-ECON-GDP'],
    ['satelliteSeries', 'TEST-SAT-OIL'],
  ] as const) {
    const spec = altDataSubscription({ channel, instrument });
    if (!spec.ok) throw new Error(`subscription must build: ${spec.error.message}`);
    const sent = session.subscribe(spec.value);
    if (!sent.ok) throw new Error(`subscribe must succeed: ${sent.error.message}`);
  }
  const events: EmittedEvent[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok) throw new Error(`unexpected failure: ${next.error.code}`);
    if (next.value === null) break;
    events.push(next.value);
  }
  return events;
}

/** Recursively collect every field name of a JSON-shaped value. */
function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const element of value) collectKeys(element, keys);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
}

describe('the inverse-neutrality trip-wire (criterion 4)', () => {
  const events = emitAll();

  it('every documented channel emits (the walk is not vacuous)', () => {
    expect(events.length).toBe(4);
    const types = events.map((event) => event.event_type).sort();
    expect(types).toEqual(['fundamental', 'macro_release', 'social_signal', 'social_signal']);
  });

  it('NO provider-specific field name appears anywhere in the emitted canonical events (L2)', () => {
    const keys = new Set<string>();
    for (const event of events) collectKeys(event, keys);
    expect(keys.size).toBeGreaterThan(20); // the walk must actually cover the records
    // "period" is shared by the canonical macro_release payload contract
    // itself; every OTHER documented vendor field name is provider-only
    // and banned.
    const canonicalOverlap = ['period'];
    const banned = (ALTDATA_RAW_FIELD_NAMES as readonly string[]).filter((name) => !canonicalOverlap.includes(name));
    expect(banned.length).toBeGreaterThan(10); // the banned list is substantial
    const violations = [...keys].filter((key) => banned.includes(key));
    expect(violations).toEqual([]);
  });

  it('the emitted field names are the canonical contract vocabulary only', () => {
    const keys = new Set<string>();
    for (const event of events) collectKeys(event, keys);
    const canonicalFields = [
      'event_id', 'venue', 'instrument', 'asset_class', 'event_type',
      'event_time', 'source_time', 'available_time', 'ingestion_time',
      'sequence', 'provider', 'provenance', 'entitlement', 'mapping', 'payload',
      'origin', 'adapter', 'id', 'version', 'derived_from', 'transform',
      'entitlement_id', 'constraints', 'table_id', 'source_time_policy',
      'event_time_basis', 'event_time_field', 'source_time_field', 'availability_basis',
      'platform', 'metric', 'value', 'indicator', 'region', 'period', 'actual', 'forecast',
      'field', 'unit', 'source',
    ];
    for (const key of keys) {
      expect(canonicalFields).toContain(key);
    }
  });

  it('the documented raw payload FORMS do not leak into the canonical values', () => {
    const serialized = JSON.stringify(events);
    // The chain and metric codes never appear; the enum-translated neutral
    // labels do.
    // The bans are on the raw forms as JSON VALUES: the canonical
    // instrument id "TEST-CHAIN-A" legitimately contains the "CHAIN-A"
    // substring — the emitted chain value is the enum-translated label.
    expect(serialized).not.toContain('"CHAIN-A"');
    expect(serialized).not.toContain('"TX_COUNT"');
    expect(serialized).not.toContain('"ACTIVE_ADDRESSES"');
    expect(serialized).toContain('"platform":"chain-a"');
    expect(serialized).toContain('"metric":"tx_count"');
    // The record-type discriminators and the guard-consumed names never appear.
    expect(serialized).not.toContain('SENTIMENT_OBSERVATION');
    expect(serialized).not.toContain('ON_CHAIN_METRIC');
    expect(serialized).not.toContain('ECONOMIC_SERIES_OBSERVATION');
    expect(serialized).not.toContain('SATELLITE_OBSERVATION');
    expect(serialized).not.toContain('"windowStartMs"');
    // NOTE: the DECLARED time-policy field name ("releaseTimeMs") appears
    // as a VALUE inside the mapping provenance block
    // (mapping.source_time_policy.event_time_field) — the SDK's L4/L9
    // design: every record is self-describing about its own translation.
  });

  it('the provider vocabulary DOES live in the declaration layers (the L2 inverse: HERE)', () => {
    // The descriptor carries the provider id and the channel vocabulary.
    expect(ALTDATA_SOURCE_DESCRIPTOR.provider).toBe('alt-vendor-a');
    expect(ALTDATA_SOURCE_DESCRIPTOR.capabilities.channels).toContain('economicSeries');
    // The mapping tables declare the derived emitter-facing fields.
    const onChainTable = ALTDATA_MAPPING_TABLES.find((table) => table.table_id === 'altdata-on-chain-metric');
    if (onChainTable === undefined) throw new Error('the on-chain table must exist');
    const accounted = accountedRawFields(onChainTable);
    expect(accounted).toContain('chainId');
    expect(accounted).toContain('metricCode');
    // The schema layer exports the documented vocabulary.
    expect(ALTDATA_RAW_FIELD_NAMES).toContain('recordType');
    expect(ALTDATA_RAW_FIELD_NAMES).toContain('sentimentScore');
    expect(ALTDATA_RAW_FIELD_NAMES).toContain('observationValue');
    expect(ALTDATA_RAW_FIELD_NAMES.length).toBeGreaterThan(10);
    // The derivations keep the documented names on the guard side (never
    // the emitter side).
    const guarded = guardSentimentObservationPayload({
      recordType: 'SENTIMENT_OBSERVATION', seriesId: 'S', windowStartMs: W1.windowStartMs,
      windowEndMs: W1.windowEndMs, releaseTimeMs: W1.releaseTimeMs, sentimentScore: '-0.21',
    } as JsonObject);
    if (!guarded.ok) throw new Error('must guard');
    expect(deriveSentimentPayload(guarded.value)).toHaveProperty('sentimentScore');
    const metricGuarded = guardOnChainMetricPayload({
      recordType: 'ON_CHAIN_METRIC', chainId: 'CHAIN-A', metricCode: 'TX_COUNT', metricValue: '1',
      windowStartMs: W1.windowStartMs, windowEndMs: W1.windowEndMs, releaseTimeMs: W1.releaseTimeMs,
    } as JsonObject);
    if (!metricGuarded.ok) throw new Error('must guard');
    expect(deriveOnChainPayload(metricGuarded.value)).toHaveProperty('metricCode');
    const economicGuarded = guardEconomicObservationPayload({
      recordType: 'ECONOMIC_SERIES_OBSERVATION', seriesId: 'TEST-ECON-GDP', regionCode: 'US',
      period: 'p', actualValue: 'a', windowStartMs: W1.windowStartMs, windowEndMs: W1.windowEndMs,
      releaseTimeMs: W1.releaseTimeMs,
    } as JsonObject);
    if (!economicGuarded.ok) throw new Error('must guard');
    expect(deriveEconomicPayload(economicGuarded.value)).toHaveProperty('seriesId');
    const satelliteGuarded = guardSatelliteObservationPayload({
      recordType: 'SATELLITE_OBSERVATION', seriesId: 'TEST-SAT-OIL', observationType: 't',
      observationPeriod: 'p', observationValue: 'v', windowStartMs: W1.windowStartMs,
      windowEndMs: W1.windowEndMs, releaseTimeMs: W1.releaseTimeMs,
    } as JsonObject);
    if (!satelliteGuarded.ok) throw new Error('must guard');
    expect(deriveSatellitePayload(satelliteGuarded.value)).toHaveProperty('observationType');
  });
});
