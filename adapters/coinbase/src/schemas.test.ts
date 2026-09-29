/**
 * @tradrl/adapter-coinbase — the documented raw payload schema tests.
 *
 * Behavioral: every documented channel's happy path (with the ISO-8601
 * normalization), every negative path (unknown fields, unknown message
 * types — an l2update arriving on the snapshot-only level2_batch channel
 * — malformed fields, malformed levels), and the guard dispatch.
 */

import { describe, expect, it } from 'vitest';

import {
  guardLevel2BatchPayload,
  guardTickerPayload,
  guardMatchPayload,
  guardCoinbasePayload,
  COINBASE_RAW_FIELD_NAMES,
} from './index';
import { isMappingError } from './index';

const ISO_TIME = '2024-05-21T17:22:12.123456Z';
const ISO_EPOCH_MS = 1_716_312_132_123;

const validSnapshot = {
  type: 'snapshot',
  product_id: 'BTC-USD',
  bids: [
    ['43125.20000000', '1.10000000'],
    ['43125.10000000', '2.00000000'],
  ],
  asks: [['43126.30000000', '0.50000000']],
};

const validTicker = {
  type: 'ticker',
  trade_id: 7,
  sequence: 6573391,
  time: ISO_TIME,
  product_id: 'BTC-USD',
  price: '43125.10000000',
  last_size: '0.01700000',
  best_bid: '43125.09000000',
  best_bid_size: '0.50000000',
  best_ask: '43125.11000000',
  best_ask_size: '0.73000000',
  open_24h: '-26.59000000',
  volume_24h: '12345.67000000',
  low_24h: '42500.00000000',
  high_24h: '43200.00000000',
  volume_30d: '450000.00000000',
};

const validMatch = {
  type: 'match',
  trade_id: 7,
  sequence: 6573391,
  maker_order_id: '2b6f88ef-7c21-4b1f-9a1e-1b1f4c6d1e5f',
  taker_order_id: 'f1a2b3c4-d5e6-4789-a012-3456789abcde',
  time: ISO_TIME,
  product_id: 'BTC-USD',
  size: '0.01700000',
  price: '43125.10000000',
  side: 'buy',
};

describe('channel "level2_batch" (documented book snapshots)', () => {
  it('accepts the documented snapshot and normalizes level arrays into level records', () => {
    const result = guardLevel2BatchPayload(validSnapshot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('snapshot');
      expect(result.value.product_id).toBe('BTC-USD');
      expect(result.value.bids).toEqual([
        { price: '43125.20000000', size: '1.10000000' },
        { price: '43125.10000000', size: '2.00000000' },
      ]);
      expect(result.value.asks).toEqual([{ price: '43126.30000000', size: '0.50000000' }]);
    }
  });

  it('rejects an l2update message as a typed unknown_message_type (snapshots only on this channel)', () => {
    const result = guardLevel2BatchPayload({ ...validSnapshot, type: 'l2update' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unknown_message_type');
      expect(result.error.message).toContain('l2update');
    }
  });

  it('rejects an unknown field as a typed unmapped_raw_field MappingError (never silent)', () => {
    const result = guardLevel2BatchPayload({ ...validSnapshot, vendor_extra: 'surprise' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isMappingError(result.error)).toBe(true);
      expect(result.error.code).toBe('unmapped_raw_field');
      expect(result.error.message).toContain('vendor_extra');
    }
  });

  it('rejects malformed levels and missing documented fields', () => {
    const badLevel = guardLevel2BatchPayload({ ...validSnapshot, bids: [['price']] } as unknown as Parameters<typeof guardLevel2BatchPayload>[0]);
    expect(badLevel.ok).toBe(false);
    if (!badLevel.ok) expect(badLevel.error.code).toBe('malformed_payload');

    const missing = guardLevel2BatchPayload({ type: 'snapshot', product_id: 'BTC-USD', bids: [] } as unknown as Parameters<typeof guardLevel2BatchPayload>[0]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('malformed_payload');
  });
});

describe('channel "ticker" (documented ticker)', () => {
  it('accepts the documented payload and converts the ISO time to epoch milliseconds', () => {
    const result = guardTickerPayload(validTicker);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.time).toBe(ISO_EPOCH_MS);
      expect(result.value.sequence).toBe(6573391);
      expect(result.value.best_bid).toBe('43125.09000000');
      expect(result.value.open_24h).toBe('-26.59000000'); // signed statistics survive
    }
  });

  it('rejects a malformed ISO time deterministically', () => {
    const result = guardTickerPayload({ ...validTicker, time: '2024-05-21 17:22:12Z' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('malformed_payload');
      expect(result.error.message).toContain('ISO-8601');
    }
  });

  it('rejects undocumented message types and unknown fields', () => {
    const wrongType = guardTickerPayload({ ...validTicker, type: 'heartbeat' });
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) {
      expect(wrongType.error.code).toBe('unknown_message_type');
      expect(wrongType.error.message).toContain('heartbeat');
    }
    const extra = guardTickerPayload({ ...validTicker, best_bid_usd: '1' });
    expect(extra.ok).toBe(false);
    if (!extra.ok) {
      expect(isMappingError(extra.error)).toBe(true);
      expect(extra.error.code).toBe('unmapped_raw_field');
      expect(extra.error.message).toContain('best_bid_usd');
    }
  });
});

describe('channel "match" (documented match prints)', () => {
  it('accepts the documented payload and converts the ISO time to epoch milliseconds', () => {
    const result = guardMatchPayload(validMatch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.time).toBe(ISO_EPOCH_MS);
      expect(result.value.side).toBe('buy');
      expect(result.value.trade_id).toBe(7);
      expect(result.value.maker_order_id).toBe(validMatch.maker_order_id);
    }
  });

  it('rejects an undocumented side value (the enum cannot carry it)', () => {
    const result = guardMatchPayload({ ...validMatch, side: 'both' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('malformed_payload');
      expect(result.error.message).toContain('"side"');
    }
  });

  it('rejects undocumented message types (e.g. a last_match)', () => {
    const result = guardMatchPayload({ ...validMatch, type: 'last_match' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unknown_message_type');
      expect(result.error.message).toContain('last_match');
    }
  });

  it('rejects unknown extra fields as unmapped_raw_field', () => {
    const result = guardMatchPayload({ ...validMatch, liquidity: 'taker' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isMappingError(result.error)).toBe(true);
      expect(result.error.code).toBe('unmapped_raw_field');
      expect(result.error.message).toContain('liquidity');
    }
  });
});

describe('guardCoinbasePayload dispatch', () => {
  it('routes each documented channel to its schema', () => {
    expect(guardCoinbasePayload('level2_batch', validSnapshot).ok).toBe(true);
    expect(guardCoinbasePayload('ticker', validTicker).ok).toBe(true);
    expect(guardCoinbasePayload('match', validMatch).ok).toBe(true);
  });

  it('passes unknown channels through verbatim (the session owns routing)', () => {
    const payload = { anything: 'goes' };
    const result = guardCoinbasePayload('mystery', payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(payload);
  });
});

describe('the provider vocabulary export (the neutrality trip-wire input)', () => {
  it('lists the documented raw field names (and only those)', () => {
    expect(COINBASE_RAW_FIELD_NAMES).toContain('product_id');
    expect(COINBASE_RAW_FIELD_NAMES).toContain('best_bid');
    expect(COINBASE_RAW_FIELD_NAMES).toContain('maker_order_id');
    expect(COINBASE_RAW_FIELD_NAMES.length).toBe(22);
  });
});
