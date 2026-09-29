/**
 * @tradrl/adapter-equities — the declared mapping table tests.
 *
 * Behavioral: table validation and immutability; the ANTI-SILENT-DROP law
 * driven directly through the emitter (unmapped field -> typed
 * MappingError; missing mapped field; invalid decimal value); the honest
 * quartet derivations per source-time policy (L4) — the declared
 * "dissemination time vs receive session" policy, including the clamp
 * law; and the emitted payload shapes for each channel.
 */

import { describe, expect, it } from 'vitest';

import {
  EQUITIES_MAPPING_TABLES,
  EQUITIES_INDEX_LEVEL_TABLE,
  EQUITIES_CONSTITUENT_WEIGHT_TABLE,
  EQUITIES_CORPORATE_ACTION_TABLE,
  EQUITIES_CHANNEL_TABLE_IDS,
  EQUITIES_SOURCE_DESCRIPTOR,
  EQUITIES_ADAPTER,
  EQUITIES_ENTITLEMENT,
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

/** The guard's DERIVED emitter-facing index-level payload. */
const derivedIndexLevel = {
  tradeDate: '2024-06-03',
  disseminationTimeMs: AT0,
  indexLevel: '104.5000',
  indexDivisor: '1234.5678',
};

/** The guard's DERIVED emitter-facing constituent-weight payload. */
const derivedConstituentWeight = {
  data: { symbol: 'TEST-AAA', weight: '0.06940', share_class: 'common' },
  disseminationTimeMs: AT0 + 10,
};

/** The guard's DERIVED emitter-facing corporate-action payload. */
const derivedCorporateAction = {
  data: { symbol: 'TEST-AAA', action: 'split', effective_date: '2024-06-10', ratio: '4:1', currency: 'USD' },
  announcementTimeMs: AT0 + 20,
};

function binding(channel: string, table: MappingTable, instrument: string, assetClass: 'index' | 'equity'): StreamBinding {
  return {
    channel,
    venue: 'LICENSED-INDEX-A',
    instrument,
    asset_class: assetClass,
    table,
  };
}

function emitterFor(tables: readonly MappingTable[], entitlement?: unknown) {
  const construction = createCanonicalEmitter({
    source: EQUITIES_SOURCE_DESCRIPTOR,
    adapter: EQUITIES_ADAPTER,
    mapping_tables: tables,
    entitlement: entitlement === undefined ? EQUITIES_ENTITLEMENT : entitlement,
  });
  if (!construction.ok) throw new Error(`emitter must construct: ${JSON.stringify(construction.errors)}`);
  return construction.emitter;
}

function message(payload: Record<string, unknown>, at: number, channel = 'indexLevel'): InboundMessage {
  return { at: at as InboundMessage['at'], channel, payload: payload as InboundMessage['payload'] };
}

describe('table declarations', () => {
  it('every declared table validates and is deep-frozen', () => {
    for (const table of EQUITIES_MAPPING_TABLES) {
      expect(table.table_id.length).toBeGreaterThan(0);
      expect(Object.isFrozen(table)).toBe(true);
      // Re-validation round-trips (the declarations are already normalized).
      const roundTrip = validateMappingTable(table);
      expect(roundTrip.ok).toBe(true);
    }
  });

  it('declares one table per channel with unique ids and emittable event types', () => {
    const ids = EQUITIES_MAPPING_TABLES.map((table) => table.table_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const table of EQUITIES_MAPPING_TABLES) {
      expect(EQUITIES_SOURCE_DESCRIPTOR.capabilities.event_types).toContain(table.event_type);
    }
    expect(EQUITIES_CHANNEL_TABLE_IDS.indexLevel).toBe('equities-index-level');
    expect(EQUITIES_CHANNEL_TABLE_IDS.constituentWeights).toBe('equities-constituent-weight');
    expect(EQUITIES_CHANNEL_TABLE_IDS.corporateActions).toBe('equities-corporate-action');
  });

  it('the index-level table accounts for every derived field (mapped, time-policy or tolerated)', () => {
    const accounted = accountedRawFields(EQUITIES_INDEX_LEVEL_TABLE);
    for (const field of ['tradeDate', 'indexLevel', 'indexDivisor', 'disseminationTimeMs']) {
      expect(accounted).toContain(field);
    }
    // The guard-consumed documented fields never reach the emitter.
    expect(accounted).not.toContain('recordType');
    expect(accounted).not.toContain('indexId');
    expect(accounted).not.toContain('sequenceNumber');
  });

  it('the escape-hatch tables declare the kind constants and account for data + the time field', () => {
    for (const table of [EQUITIES_CONSTITUENT_WEIGHT_TABLE, EQUITIES_CORPORATE_ACTION_TABLE]) {
      const accounted = accountedRawFields(table);
      expect(accounted).toContain('data');
      const kindConstant = table.constants.find((constant) => constant.canonical_field === 'kind');
      if (kindConstant === undefined) throw new Error('the kind constant must be declared');
      expect(typeof kindConstant.value).toBe('string');
    }
    expect(accountedRawFields(EQUITIES_CONSTITUENT_WEIGHT_TABLE)).toContain('disseminationTimeMs');
    expect(accountedRawFields(EQUITIES_CORPORATE_ACTION_TABLE)).toContain('announcementTimeMs');
  });
});

describe('the anti-silent-drop law through the emitter', () => {
  it('an unmapped derived field is a typed MappingError naming the field', () => {
    const emitter = emitterFor([EQUITIES_INDEX_LEVEL_TABLE]);
    const result = emitter.emit(message({ ...derivedIndexLevel, vendor_extra: 'surprise' }, AT0), binding('indexLevel', EQUITIES_INDEX_LEVEL_TABLE, 'TEST-LARGECAP', 'index'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('unmapped_raw_field');
      expect(result.error.message).toContain('vendor_extra');
    }
  });

  it('a missing required mapped field is a typed MappingError', () => {
    const { indexLevel: _omitted, ...withoutLevel } = derivedIndexLevel;
    const emitter = emitterFor([EQUITIES_INDEX_LEVEL_TABLE]);
    const result = emitter.emit(message(withoutLevel, AT0), binding('indexLevel', EQUITIES_INDEX_LEVEL_TABLE, 'TEST-LARGECAP', 'index'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('mapped_field_missing');
      expect(result.error.message).toContain('indexLevel');
    }
  });

  it('a mapped value that violates the decimal-string transform is a typed MappingError', () => {
    const emitter = emitterFor([EQUITIES_INDEX_LEVEL_TABLE]);
    const result = emitter.emit(message({ ...derivedIndexLevel, indexLevel: 'not-a-decimal' }, AT0), binding('indexLevel', EQUITIES_INDEX_LEVEL_TABLE, 'TEST-LARGECAP', 'index'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('invalid_mapped_value');
    }
  });

  it('a declared tolerated field (the index divisor) is NOT an unmapped field — the drop is auditable', () => {
    const emitter = emitterFor([EQUITIES_INDEX_LEVEL_TABLE]);
    const result = emitter.emit(message(derivedIndexLevel, AT0), binding('indexLevel', EQUITIES_INDEX_LEVEL_TABLE, 'TEST-LARGECAP', 'index'));
    expect(result.ok).toBe(true);
  });

  it('emission without the declared entitlement is a typed EntitlementError (defense in depth at the emitter too)', () => {
    const emitter = emitterFor([EQUITIES_INDEX_LEVEL_TABLE], undefined);
    // Deliberately undefined: the refusal path.
    const construction = createCanonicalEmitter({
      source: EQUITIES_SOURCE_DESCRIPTOR,
      adapter: EQUITIES_ADAPTER,
      mapping_tables: [EQUITIES_INDEX_LEVEL_TABLE],
      entitlement: undefined,
    });
    if (!construction.ok) throw new Error('must construct');
    const result = construction.emitter.emit(message(derivedIndexLevel, AT0), binding('indexLevel', EQUITIES_INDEX_LEVEL_TABLE, 'TEST-LARGECAP', 'index'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('entitlement');
      expect(result.error.code).toBe('entitlement_undeclared');
    }
    void emitter;
  });
});

describe('the honest quartet (L4) — the declared "dissemination time vs receive session" policy', () => {
  it('indexLevel: event_time = the dissemination instant; availability = the receive instant; ingestion = the receive instant', () => {
    const emitter = emitterFor([EQUITIES_INDEX_LEVEL_TABLE]);
    const receive = AT0 + 250;
    const result = emitter.emit(message(derivedIndexLevel, receive), binding('indexLevel', EQUITIES_INDEX_LEVEL_TABLE, 'TEST-LARGECAP', 'index'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const event: EmittedEvent = result.value;
      expect(event.event_time).toBe(AT0);
      expect(event.source_time).toBeNull();
      expect(event.available_time).toBe(receive);
      expect(event.ingestion_time).toBe(receive);
    }
  });

  it('the clamp law: a receive instant before the dissemination instant is clamped up (vendor clock skew is never trusted)', () => {
    const emitter = emitterFor([EQUITIES_INDEX_LEVEL_TABLE]);
    const receive = AT0 - 5_000; // received "before" the vendor claims it disseminated
    const result = emitter.emit(message(derivedIndexLevel, receive), binding('indexLevel', EQUITIES_INDEX_LEVEL_TABLE, 'TEST-LARGECAP', 'index'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.available_time).toBe(AT0);
      expect(result.value.available_time).toBeGreaterThanOrEqual(result.value.event_time);
    }
  });

  it('corporateActions: event_time = the announcement instant (the announcement is the event)', () => {
    const emitter = emitterFor([EQUITIES_CORPORATE_ACTION_TABLE]);
    const receive = AT0 + 120;
    const result = emitter.emit(message(derivedCorporateAction, receive, 'corporateActions'), binding('corporateActions', EQUITIES_CORPORATE_ACTION_TABLE, 'TEST-AAA', 'equity'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.event_time).toBe(AT0 + 20);
      expect(result.value.available_time).toBe(receive);
    }
  });
});

describe('the emitted payload shapes per channel', () => {
  it('indexLevel emits a canonical fundamental with the declared constants', () => {
    const emitter = emitterFor([EQUITIES_INDEX_LEVEL_TABLE]);
    const result = emitter.emit(message(derivedIndexLevel, AT0), binding('indexLevel', EQUITIES_INDEX_LEVEL_TABLE, 'TEST-LARGECAP', 'index'));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.event_type === 'fundamental') {
      expect(result.value.payload.field).toBe('INDEX_LEVEL');
      expect(result.value.payload.period).toBe('2024-06-03');
      expect(result.value.payload.value).toBe('104.5000');
      expect(result.value.payload.unit).toBe('index-points');
      expect(result.value.payload.source).toBe('index-dissemination');
    } else {
      throw new Error('must be a fundamental event');
    }
  });

  it('constituentWeights emits a canonical other with the declared kind and the data object', () => {
    const emitter = emitterFor([EQUITIES_CONSTITUENT_WEIGHT_TABLE]);
    const result = emitter.emit(message(derivedConstituentWeight, AT0 + 10, 'constituentWeights'), binding('constituentWeights', EQUITIES_CONSTITUENT_WEIGHT_TABLE, 'TEST-LARGECAP', 'index'));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.event_type === 'other') {
      expect(result.value.payload.kind).toBe('index_constituent_weight');
      const data = result.value.payload.data as Record<string, unknown>;
      expect(data.symbol).toBe('TEST-AAA');
      expect(data.weight).toBe('0.06940');
      expect(data.share_class).toBe('common');
    } else {
      throw new Error('must be an other event');
    }
  });

  it('every emitted event satisfies the canonical envelope floor (defense in depth)', () => {
    const emitter = emitterFor(EQUITIES_MAPPING_TABLES);
    const first = emitter.emit(message(derivedIndexLevel, AT0), binding('indexLevel', EQUITIES_INDEX_LEVEL_TABLE, 'TEST-LARGECAP', 'index'));
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(validateEmittedFloor(first.value)).toEqual([]);
    }
  });
});
