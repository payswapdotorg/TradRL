/**
 * @tradrl/adapter-news — the declared mapping table tests.
 *
 * Behavioral: table validation and immutability; the ANTI-SILENT-DROP law
 * driven directly through the emitter (unmapped field -> typed
 * MappingError; missing mapped field; bad publisher enum key; absent
 * optional field tolerated); the honest quartet derivations per
 * source-time policy (L4) — the declared "publication time -> available
 * time" policy, including the clamp law; and the emitted news payload
 * shapes for each channel.
 */

import { describe, expect, it } from 'vitest';

import {
  NEWS_MAPPING_TABLES,
  NEWS_PUBLIC_HEADLINE_TABLE,
  NEWS_LICENSED_WIRE_TABLE,
  NEWS_CHANNEL_TABLE_IDS,
  NEWS_SOURCE_DESCRIPTOR,
  NEWS_ADAPTER,
  NEWS_WIRE_SERVICE_ENTITLEMENT,
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

/** The guard's DERIVED emitter-facing public-headline payload. */
const derivedPublicHeadline = {
  publisherCode: 'PUB-A',
  publishedTimeMs: AT0,
  headline: 'Synthetic test headline one',
  tickers: ['TEST-AAA'],
};

/** The guard's DERIVED emitter-facing licensed wire payload (no embargo field). */
const derivedWireItem = {
  publisherCode: 'PUB-B',
  publishedTimeMs: AT0,
  headline: 'Synthetic test headline two',
  body: 'Synthetic wire body.',
  tickers: ['TEST-AAA', 'TEST-BBB'],
  tags: ['TEST-TAG-EARNINGS'],
  url: 'https://example.invalid/item/2',
};

function binding(channel: string, table: MappingTable): StreamBinding {
  return {
    channel,
    venue: 'NEWS-WIRE-A',
    instrument: 'TEST-AAA',
    asset_class: 'equity',
    table,
  };
}

function emitterFor(tables: readonly MappingTable[], entitlement?: unknown) {
  const construction = createCanonicalEmitter({
    source: NEWS_SOURCE_DESCRIPTOR,
    adapter: NEWS_ADAPTER,
    mapping_tables: tables,
    entitlement: entitlement === undefined ? NEWS_WIRE_SERVICE_ENTITLEMENT : entitlement,
  });
  if (!construction.ok) throw new Error(`emitter must construct: ${JSON.stringify(construction.errors)}`);
  return construction.emitter;
}

function message(payload: Record<string, unknown>, at: number, channel = 'licensedWire'): InboundMessage {
  return { at: at as InboundMessage['at'], channel, payload: payload as InboundMessage['payload'] };
}

describe('table declarations', () => {
  it('every declared table validates and is deep-frozen', () => {
    for (const table of NEWS_MAPPING_TABLES) {
      expect(table.table_id.length).toBeGreaterThan(0);
      expect(Object.isFrozen(table)).toBe(true);
      const roundTrip = validateMappingTable(table);
      expect(roundTrip.ok).toBe(true);
    }
  });

  it('declares one table per channel with unique ids and the declared event type', () => {
    const ids = NEWS_MAPPING_TABLES.map((table) => table.table_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const table of NEWS_MAPPING_TABLES) {
      expect(NEWS_SOURCE_DESCRIPTOR.capabilities.event_types).toContain(table.event_type);
      expect(table.event_type).toBe('news');
    }
    expect(NEWS_CHANNEL_TABLE_IDS.publicHeadlines).toBe('news-public-headline');
    expect(NEWS_CHANNEL_TABLE_IDS.licensedWire).toBe('news-licensed-wire-item');
  });

  it('the wire table accounts for every derived field; the optional fields are declared optional', () => {
    const accounted = accountedRawFields(NEWS_LICENSED_WIRE_TABLE);
    for (const field of ['headline', 'tickers', 'publisherCode', 'body', 'tags', 'url', 'publishedTimeMs']) {
      expect(accounted).toContain(field);
    }
    for (const field of ['body', 'tags', 'url']) {
      const mapping = NEWS_LICENSED_WIRE_TABLE.fields.find((entry) => entry.raw_field === field);
      if (mapping === undefined) throw new Error(`the ${field} mapping must exist`);
      expect(mapping.required).toBe(false);
    }
    // The guard-consumed documented fields never reach the emitter.
    expect(accounted).not.toContain('recordType');
    expect(accounted).not.toContain('itemId');
    expect(accounted).not.toContain('embargoTimeMs');
  });

  it('the public headline table accounts for its (smaller) derived field set', () => {
    const accounted = accountedRawFields(NEWS_PUBLIC_HEADLINE_TABLE);
    expect(accounted).toEqual(expect.arrayContaining(['headline', 'tickers', 'publisherCode', 'publishedTimeMs']));
    expect(accounted).not.toContain('body');
    expect(accounted).not.toContain('url');
  });
});

describe('the anti-silent-drop law through the emitter', () => {
  it('an unmapped derived field is a typed MappingError naming the field', () => {
    const emitter = emitterFor([NEWS_LICENSED_WIRE_TABLE]);
    const result = emitter.emit(message({ ...derivedWireItem, vendor_extra: 'surprise' }, AT0), binding('licensedWire', NEWS_LICENSED_WIRE_TABLE));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('unmapped_raw_field');
      expect(result.error.message).toContain('vendor_extra');
    }
  });

  it('a missing required mapped field is a typed MappingError', () => {
    const { headline: _omitted, ...withoutHeadline } = derivedWireItem;
    const emitter = emitterFor([NEWS_LICENSED_WIRE_TABLE]);
    const result = emitter.emit(message(withoutHeadline, AT0), binding('licensedWire', NEWS_LICENSED_WIRE_TABLE));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('mapped_field_missing');
      expect(result.error.message).toContain('headline');
    }
  });

  it('an absent optional mapped field is tolerated (the canonical field is simply omitted)', () => {
    const { body: _b, tags: _t, url: _u, ...bareItem } = derivedWireItem;
    const emitter = emitterFor([NEWS_LICENSED_WIRE_TABLE]);
    const result = emitter.emit(message(bareItem, AT0), binding('licensedWire', NEWS_LICENSED_WIRE_TABLE));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.event_type === 'news') {
      expect(result.value.payload.body).toBeUndefined();
      expect(result.value.payload.tags).toBeUndefined();
      expect(result.value.payload.url).toBeUndefined();
    }
  });

  it('a bad publisher enum key is a typed MappingError (the enum owns the publisher code domain)', () => {
    const emitter = emitterFor([NEWS_LICENSED_WIRE_TABLE]);
    const result = emitter.emit(message({ ...derivedWireItem, publisherCode: 'PUB-Z' }, AT0), binding('licensedWire', NEWS_LICENSED_WIRE_TABLE));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('invalid_mapped_value');
      expect(result.error.message).toContain('PUB-Z');
    }
  });

  it('emission without the declared entitlement is a typed EntitlementError', () => {
    const construction = createCanonicalEmitter({
      source: NEWS_SOURCE_DESCRIPTOR,
      adapter: NEWS_ADAPTER,
      mapping_tables: [NEWS_LICENSED_WIRE_TABLE],
      entitlement: undefined,
    });
    if (!construction.ok) throw new Error('must construct');
    const result = construction.emitter.emit(message(derivedWireItem, AT0), binding('licensedWire', NEWS_LICENSED_WIRE_TABLE));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('entitlement');
      expect(result.error.code).toBe('entitlement_undeclared');
    }
  });
});

describe('the honest quartet (L4) — the declared "publication time -> available time" policy', () => {
  it('event_time = the publication instant; availability = the receive instant; ingestion = the receive instant', () => {
    const emitter = emitterFor([NEWS_LICENSED_WIRE_TABLE]);
    const receive = AT0 + 120;
    const result = emitter.emit(message(derivedWireItem, receive), binding('licensedWire', NEWS_LICENSED_WIRE_TABLE));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const event: EmittedEvent = result.value;
      expect(event.event_time).toBe(AT0);
      expect(event.source_time).toBeNull();
      expect(event.available_time).toBe(receive);
      expect(event.ingestion_time).toBe(receive);
    }
  });

  it('the clamp law: a receive instant before the publication instant is clamped up', () => {
    const emitter = emitterFor([NEWS_PUBLIC_HEADLINE_TABLE]);
    const receive = AT0 - 1_000; // received "before" the wire claims it published
    const result = emitter.emit(message(derivedPublicHeadline, receive, 'publicHeadlines'), binding('publicHeadlines', NEWS_PUBLIC_HEADLINE_TABLE));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.available_time).toBe(AT0);
      expect(result.value.available_time).toBeGreaterThanOrEqual(result.value.event_time);
    }
  });
});

describe('the emitted payload shapes per channel', () => {
  it('the wire item emits a canonical news payload with the enum-translated source label', () => {
    const emitter = emitterFor([NEWS_LICENSED_WIRE_TABLE]);
    const result = emitter.emit(message(derivedWireItem, AT0), binding('licensedWire', NEWS_LICENSED_WIRE_TABLE));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.event_type === 'news') {
      expect(result.value.payload.headline).toBe('Synthetic test headline two');
      expect([...result.value.payload.symbols]).toEqual(['TEST-AAA', 'TEST-BBB']);
      expect(result.value.payload.source).toBe('publisher-b'); // the enum translation, never the raw code
      expect(result.value.payload.body).toBe('Synthetic wire body.');
      expect(result.value.payload.url).toBe('https://example.invalid/item/2');
      expect([...result.value.payload.tags ?? []]).toEqual(['TEST-TAG-EARNINGS']);
    } else {
      throw new Error('must be a news event');
    }
  });

  it('the public headline emits a canonical news payload (headline metadata only)', () => {
    const emitter = emitterFor([NEWS_PUBLIC_HEADLINE_TABLE]);
    const result = emitter.emit(message(derivedPublicHeadline, AT0, 'publicHeadlines'), binding('publicHeadlines', NEWS_PUBLIC_HEADLINE_TABLE));
    expect(result.ok).toBe(true);
    if (result.ok && result.value.event_type === 'news') {
      expect(result.value.payload.headline).toBe('Synthetic test headline one');
      expect([...result.value.payload.symbols]).toEqual(['TEST-AAA']);
      expect(result.value.payload.source).toBe('publisher-a');
      expect(result.value.payload.body).toBeUndefined();
    } else {
      throw new Error('must be a news event');
    }
  });

  it('every emitted event satisfies the canonical envelope floor (defense in depth)', () => {
    const emitter = emitterFor(NEWS_MAPPING_TABLES);
    const first = emitter.emit(message(derivedWireItem, AT0), binding('licensedWire', NEWS_LICENSED_WIRE_TABLE));
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(validateEmittedFloor(first.value)).toEqual([]);
    }
  });
});
