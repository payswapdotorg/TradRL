/**
 * @tradrl/adapter-binance — the documented raw payload schema tests.
 *
 * Behavioral: every documented channel's happy path, every negative path
 * (unknown fields, unknown message types, malformed fields, malformed
 * levels), the normalization laws (level arrays -> records, boolean m ->
 * 'true'|'false') and the two-sided diff split (action homogeneity,
 * deterministic order, empty diff -> no sub-messages).
 */

import { describe, expect, it } from 'vitest';

import {
  guardDepthPayload,
  guardDepthDiffPayload,
  guardBookTickerPayload,
  guardTradePayload,
  guardBinancePayload,
  splitDepthDiff,
  isZeroSize,
  BINANCE_RAW_FIELD_NAMES,
  type NormalizedLevel,
} from './index';
import { isMappingError } from './index';

const validDepth = {
  lastUpdateId: 160,
  bids: [
    ['43125.20000000', '1.10000000'],
    ['43125.10000000', '2.00000000'],
  ],
  asks: [['43126.30000000', '0.50000000']],
};

const validDepthDiff = {
  e: 'depthUpdate',
  E: 1_717_423_200_000,
  s: 'BTCUSDT',
  U: 157,
  u: 160,
  b: [
    ['43125.20000000', '1.10000000'],
    ['43124.10000000', '0.00000000'],
  ],
  a: [['43126.30000000', '0.50000000']],
};

const validBookTicker = {
  u: 400900217,
  s: 'BTCUSDT',
  b: '43125.10000000',
  B: '31.21000000',
  a: '43125.36520000',
  A: '40.66000000',
};

const validTrade = {
  e: 'trade',
  E: 1_717_423_200_000,
  s: 'BTCUSDT',
  t: 100234,
  p: '43125.10000000',
  q: '0.01700000',
  T: 1_717_423_200_000,
  m: false,
};

describe('channel "depth" (documented partial book depth)', () => {
  it('accepts the documented payload and normalizes level arrays into level records', () => {
    const result = guardDepthPayload(validDepth);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lastUpdateId).toBe(160);
      const bids = result.value.bids as unknown as NormalizedLevel[];
      const asks = result.value.asks as unknown as NormalizedLevel[];
      expect(bids).toEqual([
        { price: '43125.20000000', size: '1.10000000' },
        { price: '43125.10000000', size: '2.00000000' },
      ]);
      expect(asks).toEqual([{ price: '43126.30000000', size: '0.50000000' }]);
    }
  });

  it('rejects an unknown field as a typed unmapped_raw_field MappingError (never silent)', () => {
    const result = guardDepthPayload({ ...validDepth, vendor_extra: 'surprise' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isMappingError(result.error)).toBe(true);
      expect(result.error.code).toBe('unmapped_raw_field');
      expect(result.error.message).toContain('vendor_extra');
    }
  });

  it('rejects a missing documented field as a malformed payload', () => {
    const { lastUpdateId: _omitted, ...withoutUpdateId } = validDepth;
    const result = guardDepthPayload(withoutUpdateId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('malformed_payload');
  });

  it('rejects malformed levels (wrong arity, non-string, non-decimal)', () => {
    for (const badLevels of [
      [['43125.2']],
      [['43125.2', '1.0', 'extra']],
      [[43125.2, '1.0']],
      [['price', 1]],
      [['not-a-decimal', '1.0']],
      'not-an-array',
    ]) {
      const result = guardDepthPayload({ ...validDepth, bids: badLevels } as unknown as Parameters<typeof guardDepthPayload>[0]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('malformed_payload');
        expect(result.error.message).toContain('bids');
      }
    }
  });

  it('rejects a non-integer or missing lastUpdateId', () => {
    for (const bad of [0, -1, 1.5, '160', null]) {
      const result = guardDepthPayload({ ...validDepth, lastUpdateId: bad });
      expect(result.ok).toBe(false);
    }
  });
});

describe('channel "depthDiff" (documented order book depth diff)', () => {
  it('accepts the documented payload, validates the shape and normalizes levels', () => {
    const result = guardDepthDiffPayload(validDepthDiff);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.e).toBe('depthUpdate');
      expect(result.value.U).toBe(157);
      expect(result.value.u).toBe(160);
      expect(result.value.s).toBe('BTCUSDT');
      expect(result.value.b).toEqual([
        { price: '43125.20000000', size: '1.10000000' },
        { price: '43124.10000000', size: '0.00000000' },
      ]);
    }
  });

  it('rejects an undocumented message type discriminator as unknown_message_type', () => {
    const result = guardDepthDiffPayload({ ...validDepthDiff, e: 'kline' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unknown_message_type');
      expect(result.error.message).toContain('kline');
    }
  });

  it('enforces the documented range invariant U <= u', () => {
    const result = guardDepthDiffPayload({ ...validDepthDiff, U: 161, u: 160 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('malformed_payload');
      expect(result.error.message).toContain('"U" (161) exceeds "u" (160)');
    }
  });

  it('rejects unknown extra fields as unmapped_raw_field', () => {
    const result = guardDepthDiffPayload({ ...validDepthDiff, pu: 156 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isMappingError(result.error)).toBe(true);
      expect(result.error.code).toBe('unmapped_raw_field');
      expect(result.error.message).toContain('pu');
    }
  });
});

describe('channel "bookTicker" (documented individual symbol book ticker)', () => {
  it('accepts the documented payload verbatim (no normalization needed)', () => {
    const result = guardBookTickerPayload(validBookTicker);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect({ ...result.value }).toEqual(validBookTicker);
    }
  });

  it('rejects malformed best bid/ask decimals and unknown fields', () => {
    const badPrice = guardBookTickerPayload({ ...validBookTicker, b: 'not-decimal' });
    expect(badPrice.ok).toBe(false);
    if (!badPrice.ok) expect(badPrice.error.code).toBe('malformed_payload');

    const extra = guardBookTickerPayload({ ...validBookTicker, T: 123 });
    expect(extra.ok).toBe(false);
    if (!extra.ok) {
      expect(isMappingError(extra.error)).toBe(true);
      expect(extra.error.code).toBe('unmapped_raw_field');
    }
  });
});

describe('channel "trade" (documented trade stream)', () => {
  it('accepts the documented payload and normalizes the boolean m to its enum form', () => {
    const result = guardTradePayload(validTrade);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.m).toBe('false');
      expect(result.value.p).toBe('43125.10000000');
      expect(result.value.t).toBe(100234);
    }
    const makerBuyer = guardTradePayload({ ...validTrade, m: true });
    expect(makerBuyer.ok).toBe(true);
    if (makerBuyer.ok) expect(makerBuyer.value.m).toBe('true');
  });

  it('rejects an undocumented message type discriminator as unknown_message_type', () => {
    const result = guardTradePayload({ ...validTrade, e: 'aggTrade' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unknown_message_type');
      expect(result.error.message).toContain('aggTrade');
    }
  });

  it('rejects a non-boolean m (the enum transform cannot carry it)', () => {
    const result = guardTradePayload({ ...validTrade, m: 'false' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('malformed_payload');
  });
});

describe('guardBinancePayload dispatch', () => {
  it('routes each documented channel to its schema', () => {
    expect(guardBinancePayload('trade', validTrade).ok).toBe(true);
    expect(guardBinancePayload('bookTicker', validBookTicker).ok).toBe(true);
    expect(guardBinancePayload('depth', validDepth).ok).toBe(true);
    expect(guardBinancePayload('depthDiff', validDepthDiff).ok).toBe(true);
  });

  it('passes unknown channels through verbatim (the session owns routing)', () => {
    const payload = { anything: 'goes' };
    const result = guardBinancePayload('mystery', payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(payload);
  });
});

describe('splitDepthDiff (the two-sided diff -> canonical action-homogeneous deltas)', () => {
  it('partitions mixed sizes into update (size > 0) then remove (size 0), both sides merged', () => {
    const diff = guardDepthDiffPayload(validDepthDiff);
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    const subMessages = splitDepthDiff(diff.value);
    expect(subMessages.length).toBe(2);

    const update = subMessages[0];
    expect(update.action).toBe('update');
    expect(update.levels).toEqual([
      { price: '43125.20000000', size: '1.10000000' },
      { price: '43126.30000000', size: '0.50000000' },
    ]);
    expect(update.u).toBe(160);
    expect(update.E).toBe(1_717_423_200_000);

    const remove = subMessages[1];
    expect(remove.action).toBe('remove');
    expect(remove.levels).toEqual([{ price: '43124.10000000', size: '0.00000000' }]);
    expect(remove.u).toBe(160);
    expect(remove.E).toBe(1_717_423_200_000);
  });

  it('emits a single update sub-message when every changed level is live', () => {
    const diff = guardDepthDiffPayload({
      ...validDepthDiff,
      b: [['43125.20', '1.1']],
      a: [['43126.30', '0.5']],
    });
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    const subMessages = splitDepthDiff(diff.value);
    expect(subMessages.length).toBe(1);
    expect(subMessages[0].action).toBe('update');
  });

  it('emits a single remove sub-message when every changed level is zero', () => {
    const diff = guardDepthDiffPayload({
      ...validDepthDiff,
      b: [['43125.20', '0']],
      a: [['43126.30', '0.00000000']],
    });
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    const subMessages = splitDepthDiff(diff.value);
    expect(subMessages.length).toBe(1);
    expect(subMessages[0].action).toBe('remove');
  });

  it('emits nothing for an empty diff (a heartbeat-style update)', () => {
    const diff = guardDepthDiffPayload({ ...validDepthDiff, b: [], a: [] });
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(splitDepthDiff(diff.value)).toEqual([]);
  });

  it('isZeroSize is exact for every documented zero form', () => {
    expect(isZeroSize({ price: '1', size: '0' })).toBe(true);
    expect(isZeroSize({ price: '1', size: '0.00000000' })).toBe(true);
    expect(isZeroSize({ price: '1', size: '0.0001' })).toBe(false);
  });
});

describe('the provider vocabulary export (the neutrality trip-wire input)', () => {
  it('lists the documented raw field names (and only those)', () => {
    expect(BINANCE_RAW_FIELD_NAMES).toContain('lastUpdateId');
    expect(BINANCE_RAW_FIELD_NAMES).toContain('p');
    expect(BINANCE_RAW_FIELD_NAMES).toContain('m');
    expect(BINANCE_RAW_FIELD_NAMES.length).toBe(17);
  });
});
