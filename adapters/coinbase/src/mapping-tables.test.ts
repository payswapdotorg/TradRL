/**
 * @tradrl/adapter-coinbase — the declared mapping table tests.
 *
 * Behavioral: table validation and immutability; the ANTI-SILENT-DROP law
 * driven directly through the emitter (unmapped field -> typed
 * MappingError; missing mapped field; invalid enum key; invalid decimal);
 * the honest quartet derivations per source-time policy (L4), including
 * the ISO-derived event_time and the clamp law; and the emitted payload
 * shapes for each channel.
 */

import { describe, expect, it } from 'vitest';

import {
  COINBASE_MAPPING_TABLES,
  COINBASE_MATCH_TABLE,
  COINBASE_TICKER_TABLE,
  COINBASE_LEVEL2_SNAPSHOT_TABLE,
  COINBASE_CHANNEL_TABLE_IDS,
  createCanonicalEmitter,
  validateMappingTable,
  accountedRawFields,
  type MappingTable,
  type StreamBinding,
  type InboundMessage,
} from './index';
import { COINBASE_SOURCE_DESCRIPTOR, COINBASE_ADAPTER, COINBASE_ENTITLEMENT } from './index';

const ISO_EPOCH_MS = 1_716_312_132_123;

/** The guard's NORMALIZED match form (what the emitter consumes): time as epoch ms. */
const normalizedMatch = {
  type: 'match',
  trade_id: 7,
  sequence: 6573391,
  maker_order_id: '2b6f88ef-7c21-4b1f-9a1e-1b1f4c6d1e5f',
  taker_order_id: 'f1a2b3c4-d5e6-4789-a012-3456789abcde',
  time: ISO_EPOCH_MS,
  product_id: 'BTC-USD',
  size: '0.01700000',
  price: '43125.10000000',
  side: 'buy',
};

function matchBinding(): StreamBinding {
  return {
    channel: 'match',
    venue: 'COINBASE',
    instrument: 'BTC-USD',
    asset_class: 'crypto',
    table: COINBASE_MATCH_TABLE,
  };
}

function emitterFor(tables: readonly MappingTable[], entitlement?: unknown) {
  const construction = createCanonicalEmitter({
    source: COINBASE_SOURCE_DESCRIPTOR,
    adapter: COINBASE_ADAPTER,
    mapping_tables: tables,
    entitlement: entitlement === undefined ? COINBASE_ENTITLEMENT : entitlement,
  });
  if (!construction.ok) throw new Error(`emitter must construct: ${JSON.stringify(construction.errors)}`);
  return construction.emitter;
}

function message(payload: Record<string, unknown>, at: number): InboundMessage {
  return { at: at as InboundMessage['at'], channel: 'match', payload: payload as InboundMessage['payload'] };
}

describe('table declarations', () => {
  it('every declared table validates and is deep-frozen', () => {
    for (const table of COINBASE_MAPPING_TABLES) {
      expect(table.table_id.length).toBeGreaterThan(0);
      expect(Object.isFrozen(table)).toBe(true);
      const roundTrip = validateMappingTable(table);
      expect(roundTrip.ok).toBe(true);
    }
  });

  it('declares one table per channel with unique ids and emittable event types', () => {
    const ids = COINBASE_MAPPING_TABLES.map((table) => table.table_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const table of COINBASE_MAPPING_TABLES) {
      expect(COINBASE_SOURCE_DESCRIPTOR.capabilities.event_types).toContain(table.event_type);
    }
    expect(COINBASE_CHANNEL_TABLE_IDS.level2_batch).toBe('coinbase-level2-snapshot');
    expect(COINBASE_CHANNEL_TABLE_IDS.ticker).toBe('coinbase-ticker');
    expect(COINBASE_CHANNEL_TABLE_IDS.match).toBe('coinbase-match');
  });

  it('the match table accounts for every normalized documented field (mapped, time-policy or tolerated)', () => {
    const accounted = accountedRawFields(COINBASE_MATCH_TABLE);
    for (const field of ['price', 'size', 'side', 'trade_id', 'time', 'type', 'sequence', 'maker_order_id', 'taker_order_id', 'product_id']) {
      expect(accounted).toContain(field);
    }
  });

  it('the ticker table declares its documented tolerated fields (auditable drops)', () => {
    expect([...COINBASE_TICKER_TABLE.tolerated]).toEqual([
      'type',
      'trade_id',
      'sequence',
      'product_id',
      'price',
      'last_size',
      'open_24h',
      'volume_24h',
      'low_24h',
      'high_24h',
      'volume_30d',
    ]);
  });
});

describe('the anti-silent-drop law through the emitter', () => {
  it('an unmapped raw field is a typed MappingError naming the field', () => {
    const emitter = emitterFor([COINBASE_MATCH_TABLE]);
    const result = emitter.emit(message({ ...normalizedMatch, vendor_extra: 'surprise' }, 1_000), matchBinding());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('unmapped_raw_field');
      expect(result.error.message).toContain('vendor_extra');
    }
  });

  it('a missing required mapped field is a typed MappingError', () => {
    const { price: _omitted, ...withoutPrice } = normalizedMatch;
    const emitter = emitterFor([COINBASE_MATCH_TABLE]);
    const result = emitter.emit(message(withoutPrice, 1_000), matchBinding());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('mapped_field_missing');
      expect(result.error.message).toContain('price');
    }
  });

  it('an enum value outside the declared map is a typed MappingError', () => {
    const emitter = emitterFor([COINBASE_MATCH_TABLE]);
    const result = emitter.emit(message({ ...normalizedMatch, side: 'both' }, 1_000), matchBinding());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('invalid_mapped_value');
      expect(result.error.message).toContain('both');
    }
  });

  it('a malformed level record is a typed MappingError (malformed levels law)', () => {
    const emitter = emitterFor([COINBASE_LEVEL2_SNAPSHOT_TABLE]);
    const binding: StreamBinding = {
      channel: 'level2_batch',
      venue: 'COINBASE',
      instrument: 'BTC-USD',
      asset_class: 'crypto',
      table: COINBASE_LEVEL2_SNAPSHOT_TABLE,
    };
    const result = emitter.emit(
      message({ type: 'snapshot', product_id: 'BTC-USD', bids: [{ price: 'bad', size: '1.0' }], asks: [] }, 1_000),
      binding,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('invalid_mapped_value');
    }
  });
});

describe('the honest quartet (L4) per source-time policy', () => {
  it('the match table: event_time from the (converted) documented time, availability at the receive time', () => {
    const emitter = emitterFor([COINBASE_MATCH_TABLE]);
    const result = emitter.emit(message(normalizedMatch, ISO_EPOCH_MS + 50), matchBinding());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.value;
    expect(event.event_time).toBe(ISO_EPOCH_MS); // the documented ISO time, converted
    expect(event.source_time).toBeNull();
    expect(event.available_time).toBe(ISO_EPOCH_MS + 50); // receive time
    expect(event.ingestion_time).toBe(ISO_EPOCH_MS + 50);
    expect(event.available_time).toBeGreaterThanOrEqual(event.event_time);
  });

  it('the clamp law: clock skew is clamped, never trusted (available_time >= event_time)', () => {
    const emitter = emitterFor([COINBASE_MATCH_TABLE]);
    // The documented time is AFTER the receive time: availability clamps up.
    const result = emitter.emit(message(normalizedMatch, ISO_EPOCH_MS - 500), matchBinding());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.available_time).toBe(ISO_EPOCH_MS);
    expect(result.value.available_time).toBeGreaterThanOrEqual(result.value.event_time);
  });

  it('the snapshot table: receive-time quartet (the documented snapshot carries no time field)', () => {
    const emitter = emitterFor([COINBASE_LEVEL2_SNAPSHOT_TABLE]);
    const binding: StreamBinding = {
      channel: 'level2_batch',
      venue: 'COINBASE',
      instrument: 'BTC-USD',
      asset_class: 'crypto',
      table: COINBASE_LEVEL2_SNAPSHOT_TABLE,
    };
    const result = emitter.emit(
      message({ type: 'snapshot', product_id: 'BTC-USD', bids: [{ price: '43125.20', size: '1.1' }], asks: [{ price: '43126.30', size: '0.5' }] }, 5_000),
      binding,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.value;
    expect(event.event_time).toBe(5_000);
    expect(event.source_time).toBeNull();
    expect(event.available_time).toBe(5_000);
    expect(event.ingestion_time).toBe(5_000);
    expect(event.event_type).toBe('book_snapshot');
  });

  it('an invalid declared time field is a typed MappingError (invalid_time_field)', () => {
    const emitter = emitterFor([COINBASE_MATCH_TABLE]);
    const result = emitter.emit(message({ ...normalizedMatch, time: 'not-converted' }, 1_000), matchBinding());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('invalid_time_field');
      expect(result.error.message).toContain('time');
    }
  });
});

describe('the emitted shapes', () => {
  it('the match event: canonical trade payload with the documented taker side as aggressor', () => {
    const emitter = emitterFor([COINBASE_MATCH_TABLE]);
    const result = emitter.emit(message(normalizedMatch, 1_000), matchBinding());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.value;
    expect(event.event_type).toBe('trade');
    if (event.event_type !== 'trade') return;
    expect({ ...event.payload }).toEqual({
      price: '43125.10000000',
      size: '0.01700000',
      side: 'buy',
      trade_id: '7',
    });
    expect(event.mapping.table_id).toBe('coinbase-match');
    expect(event.mapping.source_time_policy.event_time_field).toBe('time');
  });

  it('sell taker side maps to sell', () => {
    const emitter = emitterFor([COINBASE_MATCH_TABLE]);
    const result = emitter.emit(message({ ...normalizedMatch, side: 'sell' }, 1_000), matchBinding());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.event_type !== 'trade') return;
    expect(result.value.payload.side).toBe('sell');
  });

  it('the ticker event: canonical quote payload from the documented best bid/ask', () => {
    const emitter = emitterFor([COINBASE_TICKER_TABLE]);
    const binding: StreamBinding = {
      channel: 'ticker',
      venue: 'COINBASE',
      instrument: 'BTC-USD',
      asset_class: 'crypto',
      table: COINBASE_TICKER_TABLE,
    };
    const result = emitter.emit(
      message(
        {
          type: 'ticker',
          trade_id: 7,
          sequence: 6573391,
          time: ISO_EPOCH_MS,
          product_id: 'BTC-USD',
          price: '43125.10',
          last_size: '0.017',
          best_bid: '43125.09',
          best_bid_size: '0.5',
          best_ask: '43125.11',
          best_ask_size: '0.73',
          open_24h: '-26.59',
          volume_24h: '12345.67',
          low_24h: '42500',
          high_24h: '43200',
          volume_30d: '450000',
        },
        ISO_EPOCH_MS + 100,
      ),
      binding,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.value;
    expect(event.event_type).toBe('quote');
    if (event.event_type !== 'quote') return;
    expect({ ...event.payload }).toEqual({
      bid_price: '43125.09',
      bid_size: '0.5',
      ask_price: '43125.11',
      ask_size: '0.73',
    });
    expect(event.event_time).toBe(ISO_EPOCH_MS);
  });

  it('sequences are per canonical stream and consumed only on success', () => {
    const emitter = emitterFor([COINBASE_MATCH_TABLE]);
    const first = emitter.emit(message(normalizedMatch, 1_000), matchBinding());
    const failed = emitter.emit(message({ ...normalizedMatch, vendor_extra: 'x' }, 1_100), matchBinding());
    const second = emitter.emit(message({ ...normalizedMatch, trade_id: 8, price: '43125.20' }, 1_200), matchBinding());
    expect(first.ok && second.ok && !failed.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.sequence).toBe(1);
    expect(second.value.sequence).toBe(2);
    expect(emitter.sequenceState()['COINBASE|BTC-USD|trade']).toBe(2);
  });

  it('the event id embeds adapter, table, stream and sequence (deterministic identity)', () => {
    const emitter = emitterFor([COINBASE_MATCH_TABLE]);
    const result = emitter.emit(message(normalizedMatch, 1_000), matchBinding());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.event_id).toBe('adapter-coinbase:coinbase-match:COINBASE|BTC-USD|trade:1');
  });
});
