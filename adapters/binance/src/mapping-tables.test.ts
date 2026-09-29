/**
 * @tradrl/adapter-binance — the declared mapping table tests.
 *
 * Behavioral: table validation and immutability; the ANTI-SILENT-DROP law
 * driven directly through the emitter (unmapped field -> typed
 * MappingError; missing mapped field; invalid enum key; invalid decimal);
 * the honest quartet derivations per source-time policy (L4), including
 * the clamp law; and the emitted payload shapes for each channel.
 */

import { describe, expect, it } from 'vitest';

import {
  BINANCE_MAPPING_TABLES,
  BINANCE_TRADE_TABLE,
  BINANCE_BOOK_TICKER_TABLE,
  BINANCE_DEPTH_SNAPSHOT_TABLE,
  BINANCE_DEPTH_DIFF_TABLE,
  BINANCE_CHANNEL_TABLE_IDS,
  createCanonicalEmitter,
  validateMappingTable,
  accountedRawFields,
  type MappingTable,
  type StreamBinding,
  type InboundMessage,
} from './index';
import { BINANCE_SOURCE_DESCRIPTOR, BINANCE_ADAPTER, BINANCE_ENTITLEMENT } from './index';

/** The guard's NORMALIZED trade form (what the emitter consumes): m is 'true'|'false'. */
const normalizedTrade = {
  e: 'trade',
  E: 1_717_423_200_000,
  s: 'BTCUSDT',
  t: 100234,
  p: '43125.10000000',
  q: '0.01700000',
  T: 1_717_423_200_000,
  m: 'false',
};

function tradeBinding(): StreamBinding {
  return {
    channel: 'trade',
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    table: BINANCE_TRADE_TABLE,
  };
}

function emitterFor(tables: readonly MappingTable[], entitlement?: unknown) {
  const construction = createCanonicalEmitter({
    source: BINANCE_SOURCE_DESCRIPTOR,
    adapter: BINANCE_ADAPTER,
    mapping_tables: tables,
    entitlement: entitlement === undefined ? BINANCE_ENTITLEMENT : entitlement,
  });
  if (!construction.ok) throw new Error(`emitter must construct: ${JSON.stringify(construction.errors)}`);
  return construction.emitter;
}

function message(payload: Record<string, unknown>, at: number): InboundMessage {
  return { at: at as InboundMessage['at'], channel: 'trade', payload: payload as InboundMessage['payload'] };
}

describe('table declarations', () => {
  it('every declared table validates and is deep-frozen', () => {
    for (const table of BINANCE_MAPPING_TABLES) {
      expect(table.table_id.length).toBeGreaterThan(0);
      expect(Object.isFrozen(table)).toBe(true);
      // Re-validation round-trips (the declarations are already normalized).
      const roundTrip = validateMappingTable(table);
      expect(roundTrip.ok).toBe(true);
    }
  });

  it('declares one table per channel with unique ids and emittable event types', () => {
    const ids = BINANCE_MAPPING_TABLES.map((table) => table.table_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const table of BINANCE_MAPPING_TABLES) {
      expect(BINANCE_SOURCE_DESCRIPTOR.capabilities.event_types).toContain(table.event_type);
    }
    expect(BINANCE_CHANNEL_TABLE_IDS.trade).toBe('binance-trade');
    expect(BINANCE_CHANNEL_TABLE_IDS.depth).toBe('binance-depth-snapshot');
    expect(BINANCE_CHANNEL_TABLE_IDS.depthDiff).toBe('binance-depth-diff');
    expect(BINANCE_CHANNEL_TABLE_IDS.bookTicker).toBe('binance-book-ticker');
  });

  it('the trade table accounts for every normalized documented field (mapped, time-policy or tolerated)', () => {
    const accounted = accountedRawFields(BINANCE_TRADE_TABLE);
    for (const field of ['p', 'q', 't', 'm', 'T', 'E', 'e', 's']) {
      expect(accounted).toContain(field);
    }
  });

  it('the bookTicker table declares its documented tolerated fields (auditable drops)', () => {
    expect(BINANCE_BOOK_TICKER_TABLE.tolerated).toEqual(['u', 's']);
  });
});

describe('the anti-silent-drop law through the emitter', () => {
  it('an unmapped raw field is a typed MappingError naming the field', () => {
    const emitter = emitterFor([BINANCE_TRADE_TABLE]);
    const result = emitter.emit(message({ ...normalizedTrade, vendor_extra: 'surprise' }, 1_000), tradeBinding());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('unmapped_raw_field');
      expect(result.error.message).toContain('vendor_extra');
    }
  });

  it('a missing required mapped field is a typed MappingError', () => {
    const { p: _omitted, ...withoutPrice } = normalizedTrade;
    const emitter = emitterFor([BINANCE_TRADE_TABLE]);
    const result = emitter.emit(message(withoutPrice, 1_000), tradeBinding());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('mapped_field_missing');
      expect(result.error.message).toContain('p');
    }
  });

  it('an enum value outside the declared map is a typed MappingError', () => {
    const emitter = emitterFor([BINANCE_TRADE_TABLE]);
    // m normalized to 'true'/'false'; 'maybe' is an undeclared enum key.
    const result = emitter.emit(message({ ...normalizedTrade, m: 'maybe' }, 1_000), tradeBinding());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('invalid_mapped_value');
      expect(result.error.message).toContain('maybe');
    }
  });

  it('a malformed level record is a typed MappingError (malformed levels law)', () => {
    const emitter = emitterFor([BINANCE_DEPTH_SNAPSHOT_TABLE]);
    const binding: StreamBinding = {
      channel: 'depth',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      table: BINANCE_DEPTH_SNAPSHOT_TABLE,
    };
    const result = emitter.emit(
      message({ lastUpdateId: 160, bids: [{ price: '43125.2', size: '1.0' }, { price: 'bad', size: '1.0' }], asks: [] }, 1_000),
      binding,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('invalid_mapped_value');
    }
  });

  it('a zero-size snapshot level violates the canonical payload contract (typed MappingError)', () => {
    const emitter = emitterFor([BINANCE_DEPTH_SNAPSHOT_TABLE]);
    const binding: StreamBinding = {
      channel: 'depth',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      table: BINANCE_DEPTH_SNAPSHOT_TABLE,
    };
    const result = emitter.emit(
      message({ lastUpdateId: 160, bids: [{ price: '43125.2', size: '0' }], asks: [] }, 1_000),
      binding,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('invalid_mapped_value');
      expect(result.error.message).toContain('greater than zero');
    }
  });
});

describe('the honest quartet (L4) per source-time policy', () => {
  it('the trade table: event_time from T, source_time from E, available_time at the receive time', () => {
    const emitter = emitterFor([BINANCE_TRADE_TABLE]);
    const result = emitter.emit(message({ ...normalizedTrade, T: 1_717_423_199_900, E: 1_717_423_199_950 }, 1_717_423_200_100), tradeBinding());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.value;
    expect(event.event_time).toBe(1_717_423_199_900); // T: the documented trade time
    expect(event.source_time).toBe(1_717_423_199_950); // E: the vendor-claimed event time
    expect(event.available_time).toBe(1_717_423_200_100); // receive time
    expect(event.ingestion_time).toBe(1_717_423_200_100);
    expect(event.available_time).toBeGreaterThanOrEqual(event.event_time);
  });

  it('the clamp law: vendor clock skew is clamped, never trusted (available_time >= event_time)', () => {
    const emitter = emitterFor([BINANCE_TRADE_TABLE]);
    // T (event_time) is AFTER the receive time: the availability basis
    // clamps available_time up to event_time — information may not be
    // observable before it occurred.
    const result = emitter.emit(message({ ...normalizedTrade, T: 1_717_423_200_500 }, 1_717_423_200_100), tradeBinding());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.available_time).toBe(1_717_423_200_500);
    expect(result.value.available_time).toBeGreaterThanOrEqual(result.value.event_time);
  });

  it('the receive-time tables: event_time = available_time = ingestion_time = the receive instant', () => {
    const emitter = emitterFor([BINANCE_BOOK_TICKER_TABLE]);
    const binding: StreamBinding = {
      channel: 'bookTicker',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      table: BINANCE_BOOK_TICKER_TABLE,
    };
    const result = emitter.emit(
      message({ u: 1, s: 'BTCUSDT', b: '25.35', B: '31.21', a: '25.36', A: '40.66' }, 5_000),
      binding,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.value;
    expect(event.event_time).toBe(5_000);
    expect(event.source_time).toBeNull();
    expect(event.available_time).toBe(5_000);
    expect(event.ingestion_time).toBe(5_000);
    expect(event.event_type).toBe('quote');
    expect({ ...event.payload }).toEqual({ bid_price: '25.35', bid_size: '31.21', ask_price: '25.36', ask_size: '40.66' });
  });

  it('an invalid declared time field is a typed MappingError (invalid_time_field)', () => {
    const emitter = emitterFor([BINANCE_TRADE_TABLE]);
    const result = emitter.emit(message({ ...normalizedTrade, T: 'not-a-time' }, 1_000), tradeBinding());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('mapping');
      expect(result.error.code).toBe('invalid_time_field');
      expect(result.error.message).toContain('T');
    }
  });
});

describe('the emitted shapes', () => {
  it('the trade event: canonical payload with the documented aggressor semantics', () => {
    const emitter = emitterFor([BINANCE_TRADE_TABLE]);
    const result = emitter.emit(message(normalizedTrade, 1_000), tradeBinding());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.value;
    expect(event.event_type).toBe('trade');
    expect({ ...event.payload }).toEqual({
      price: '43125.10000000',
      size: '0.01700000',
      side: 'buy',
      trade_id: '100234',
    });
    expect(event.mapping.table_id).toBe('binance-trade');
    expect(event.mapping.source_time_policy.event_time_field).toBe('T');
  });

  it('m=true maps to sell (the buyer is the market maker, so the aggressor sold)', () => {
    const emitter = emitterFor([BINANCE_TRADE_TABLE]);
    const result = emitter.emit(message({ ...normalizedTrade, m: 'true' }, 1_000), tradeBinding());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.event_type !== 'trade') throw new Error('must be a trade event');
    expect(result.value.payload.side).toBe('sell');
  });

  it('the depth-diff table: the split sub-message maps to a canonical book_delta', () => {
    const emitter = emitterFor([BINANCE_DEPTH_DIFF_TABLE]);
    const binding: StreamBinding = {
      channel: 'depthDiff',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      table: BINANCE_DEPTH_DIFF_TABLE,
    };
    const result = emitter.emit(
      message({ action: 'update', levels: [{ price: '43125.20', size: '1.10000000' }], u: 160, E: 1_000 }, 1_100),
      binding,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.value;
    expect(event.event_type).toBe('book_delta');
    expect({ ...event.payload }).toEqual({
      action: 'update',
      levels: [{ price: '43125.20', size: '1.10000000' }],
      last_update_id: '160',
    });
    expect(event.event_time).toBe(1_000); // E: the documented event time
    expect(event.available_time).toBe(1_100);
  });

  it('sequences are per canonical stream and consumed only on success', () => {
    const emitter = emitterFor([BINANCE_TRADE_TABLE]);
    const first = emitter.emit(message(normalizedTrade, 1_000), tradeBinding());
    const failed = emitter.emit(message({ ...normalizedTrade, vendor_extra: 'x' }, 1_100), tradeBinding());
    const second = emitter.emit(message({ ...normalizedTrade, t: 100235, p: '43125.20' }, 1_200), tradeBinding());
    expect(first.ok && second.ok && !failed.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.sequence).toBe(1);
    expect(second.value.sequence).toBe(2); // the failed emission did not burn a sequence
    expect(emitter.sequenceState()['BINANCE|BTC-USDT|trade']).toBe(2);
  });
});

describe('sequences and stream keys', () => {
  it('the event id embeds adapter, table, stream and sequence (deterministic identity)', () => {
    const emitter = emitterFor([BINANCE_TRADE_TABLE]);
    const result = emitter.emit(message(normalizedTrade, 1_000), tradeBinding());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.event_id).toBe('adapter-binance:binance-trade:BINANCE|BTC-USDT|trade:1');
  });
});
