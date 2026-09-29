/**
 * @tradrl/adapter-equities — the INVERSE-neutrality trip-wire.
 *
 * Acceptance criterion 4: "a test asserts the CANONICAL emitted events
 * contain no provider-specific field names (Binance/Coinbase vocabulary
 * lives only in descriptor/mapping/session layers)."
 *
 * Law L2/L13 read inversely: the SDK must contain no provider name; THIS
 * adapter is where the licensed feed vocabulary lives — but ONLY in the
 * declaration layers (descriptor, schemas, mapping tables, guard). The
 * emitted CANONICAL events must be provider-neutral market-protocol
 * shapes: no feed raw field name may appear as a field of an emitted
 * event, and the documented raw payload forms must not leak into the
 * canonical values.
 *
 * The test walks every emitted event RECURSIVELY, collecting every field
 * name, and asserts the intersection with the adapter's exported
 * provider vocabulary ({@link EQUITIES_RAW_FIELD_NAMES}) is empty; it
 * also proves the positive direction — the vocabulary DOES live in the
 * declaration layers (the mapping tables declare/derive the documented
 * raw fields, the descriptor carries the provider id and channel
 * names).
 */

import { describe, expect, it } from 'vitest';

import {
  createEquitiesAdapterSession,
  equitiesSubscription,
  EQUITIES_ENTITLEMENT,
  EQUITIES_RAW_FIELD_NAMES,
  EQUITIES_SOURCE_DESCRIPTOR,
  EQUITIES_MAPPING_TABLES,
  accountedRawFields,
  deriveIndexLevelPayload,
  type JsonObject,
  deriveConstituentWeightPayload,
  deriveCorporateActionPayload,
  guardIndexLevelPayload,
  guardConstituentWeightsPayload,
  guardCorporateActionsPayload,
  type AdapterSession,
  type EmittedEvent,
} from './index';
import { createFakeTransport, type TransportScript, type TimestampMs } from '../../../packages/provider-sdk/src/index';

const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = 1_717_423_200_000; // 2024-06-03T14:00:00Z — Monday, in-session.

/** Emit a stream covering EVERY documented channel, with canonical identity values only. */
function emitAll(): EmittedEvent[] {
  const transportScript: TransportScript = {
    inbound: [
      {
        at: ms(AT0),
        channel: 'indexLevel',
        payload: {
          recordType: 'INDEX_LEVEL',
          indexId: 'TEST-LARGECAP',
          tradeDate: '2024-06-03',
          disseminationTimeMs: AT0,
          indexLevel: '104.5000',
          indexDivisor: '1234.5678',
          sequenceNumber: 41,
        },
      },
      {
        at: ms(AT0 + 10),
        channel: 'constituentWeights',
        payload: {
          recordType: 'CONSTITUENT_WEIGHT',
          indexId: 'TEST-LARGECAP',
          tradeDate: '2024-06-03',
          disseminationTimeMs: AT0 + 10,
          constituentSymbol: 'TEST-AAA',
          constituentWeight: '0.06940',
          shareClassCode: 'COMMON',
          sequenceNumber: 7,
        },
      },
      {
        at: ms(AT0 + 20),
        channel: 'corporateActions',
        payload: {
          recordType: 'CORPORATE_ACTION',
          actionId: 'ACT-2024-0001',
          corporateSymbol: 'TEST-AAA',
          actionTypeCode: 'CASH_DIVIDEND',
          effectiveDate: '2024-06-10',
          announcementTimeMs: AT0 + 20,
          actionRatio: '1:4',
          currencyCode: 'USD',
        },
      },
    ],
    recv_failures: [],
    send_failures: [],
    receive_timeout_ms: null,
  };
  const construction = createFakeTransport(transportScript);
  if (!construction.ok) throw new Error('script must validate');
  const sessionConstruction = createEquitiesAdapterSession({
    transport: construction.transport,
    entitlement: EQUITIES_ENTITLEMENT,
  });
  if (!sessionConstruction.ok) throw new Error('session must construct');
  const session: AdapterSession = sessionConstruction.session;
  session.open();
  for (const [channel, instrument] of [
    ['indexLevel', 'TEST-LARGECAP'],
    ['constituentWeights', 'TEST-LARGECAP'],
    ['corporateActions', 'TEST-AAA'],
  ] as const) {
    const spec = equitiesSubscription({ channel, instrument });
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
    expect(events.length).toBe(3);
    const types = events.map((event) => event.event_type).sort();
    expect(types).toEqual(['fundamental', 'other', 'other']);
    const kinds = events
      .filter((event) => event.event_type === 'other')
      .map((event) => (event.event_type === 'other' ? event.payload.kind : ''));
    expect(kinds.sort()).toEqual(['corporate_action', 'index_constituent_weight']);
  });

  it('NO provider-specific field name appears anywhere in the emitted canonical events (L2)', () => {
    const keys = new Set<string>();
    for (const event of events) collectKeys(event, keys);
    expect(keys.size).toBeGreaterThan(20); // the walk must actually cover the records
    const violations = [...keys].filter((key) => (EQUITIES_RAW_FIELD_NAMES as readonly string[]).includes(key));
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
      'field', 'period', 'value', 'unit', 'source', 'kind', 'data',
      'symbol', 'weight', 'share_class', 'action', 'effective_date', 'ratio', 'currency',
    ];
    for (const key of keys) {
      expect(canonicalFields).toContain(key);
    }
  });

  it('the documented raw payload FORMS do not leak into the canonical values', () => {
    const serialized = JSON.stringify(events);
    // The canonical instrument id form is carried; the record-type
    // discriminators with no canonical counterpart and the raw
    // action/share-class codes never appear anywhere.
    expect(serialized).toContain('"instrument":"TEST-LARGECAP"');
    expect(serialized).not.toContain('CONSTITUENT_WEIGHT');
    expect(serialized).not.toContain('CORPORATE_ACTION');
    expect(serialized).not.toContain('CASH_DIVIDEND');
    expect(serialized).not.toContain('COMMON');
    expect(serialized).not.toContain('"recordType"');
    // NOTE: the DECLARED time-policy field names ("disseminationTimeMs",
    // "announcementTimeMs") legitimately appear as VALUES inside the
    // mapping provenance block (mapping.source_time_policy.event_time_field)
    // — the SDK's L4/L9 design: every record is self-describing about its
    // own translation. They are mapping metadata values, never payload
    // field names (the key walk above proves that).
    // The action and share class appear only in their neutral translated forms.
    expect(serialized).toContain('"action":"cash_dividend"');
    expect(serialized).toContain('"share_class":"common"');
    // "INDEX_LEVEL" appears ONLY as the declared canonical datum-name
    // constant of the fundamental field (the mapping table's constant),
    // never as the raw recordType discriminator (which is guard-consumed).
    expect(serialized.match(/INDEX_LEVEL/g)?.length).toBe(1);
    expect(serialized).toContain('"field":"INDEX_LEVEL"');
  });

  it('the provider vocabulary DOES live in the declaration layers (the L2 inverse: HERE)', () => {
    // The descriptor carries the provider id and the channel vocabulary.
    expect(EQUITIES_SOURCE_DESCRIPTOR.provider).toBe('licensed-index-a');
    expect(EQUITIES_SOURCE_DESCRIPTOR.capabilities.channels).toContain('constituentWeights');
    // The mapping tables declare the derived emitter-facing fields.
    const indexLevelTable = EQUITIES_MAPPING_TABLES.find((table) => table.table_id === 'equities-index-level');
    if (indexLevelTable === undefined) throw new Error('the index-level table must exist');
    const accounted = accountedRawFields(indexLevelTable);
    expect(accounted).toContain('indexLevel');
    expect(accounted).toContain('indexDivisor');
    expect(accounted).toContain('disseminationTimeMs');
    // The schema layer exports the documented vocabulary.
    expect(EQUITIES_RAW_FIELD_NAMES).toContain('recordType');
    expect(EQUITIES_RAW_FIELD_NAMES).toContain('constituentSymbol');
    expect(EQUITIES_RAW_FIELD_NAMES.length).toBeGreaterThan(10);
    // The derivations keep the documented names on the guard side (never the emitter side).
    const guarded = guardIndexLevelPayload({
      recordType: 'INDEX_LEVEL', indexId: 'TEST-LARGECAP', tradeDate: '2024-06-03',
      disseminationTimeMs: AT0, indexLevel: '104.5000', indexDivisor: '1234.5678', sequenceNumber: 1,
    } as JsonObject);
    if (!guarded.ok) throw new Error('must guard');
    expect(deriveIndexLevelPayload(guarded.value)).toHaveProperty('indexDivisor');
    const guardedWeight = guardConstituentWeightsPayload({
      recordType: 'CONSTITUENT_WEIGHT', indexId: 'TEST-LARGECAP', tradeDate: '2024-06-03',
      disseminationTimeMs: AT0 + 10, constituentSymbol: 'TEST-AAA', constituentWeight: '0.0694',
      shareClassCode: 'COMMON', sequenceNumber: 7,
    } as JsonObject);
    if (!guardedWeight.ok) throw new Error('must guard');
    expect((deriveConstituentWeightPayload(guardedWeight.value) as Record<string, unknown>).data).toBeDefined();
    const guardedAction = guardCorporateActionsPayload({
      recordType: 'CORPORATE_ACTION', actionId: 'A', corporateSymbol: 'TEST-AAA', actionTypeCode: 'MERGER',
      effectiveDate: '2024-06-10', announcementTimeMs: AT0, actionRatio: '1:2', currencyCode: 'USD',
    } as JsonObject);
    if (!guardedAction.ok) throw new Error('must guard');
    expect((deriveCorporateActionPayload(guardedAction.value) as Record<string, unknown>).data).toBeDefined();
  });
});
