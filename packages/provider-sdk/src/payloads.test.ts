/**
 * @tradrl/provider-sdk — payload mirrors: behavioral validation battery.
 *
 * Every canonical payload validator is exercised on valid and invalid
 * fixtures; the registry is exhaustive over the taxonomy; the field spec
 * (which powers mapping-table validation) is consistent with the
 * validators' required/optional reality.
 */

import { describe, expect, it } from 'vitest';

import {
  payloadRegistry,
  payloadFieldSpec,
  validatePayloadFor,
  isTradePayload,
  isQuotePayload,
  isBookSnapshotPayload,
  isBookDeltaPayload,
  isOhlcvPayload,
  isNewsPayload,
  isMacroReleasePayload,
  isSocialSignalPayload,
  isFundamentalPayload,
  isOptionChainMarkPayload,
  isOtherPayload,
  EVENT_TYPES,
} from './index';

describe('payload registry', () => {
  it('covers every canonical event type (compile- and runtime-exhaustive)', () => {
    expect(Object.keys(payloadRegistry).sort()).toEqual([...EVENT_TYPES].sort());
    for (const eventType of EVENT_TYPES) {
      const spec = payloadFieldSpec[eventType];
      expect(spec.required.length).toBeGreaterThan(0);
      const overlap = spec.required.filter((field) => spec.optional.includes(field));
      expect(overlap).toEqual([]);
    }
  });

  it('validatePayloadFor validates through the registry', () => {
    expect(validatePayloadFor('trade', { price: '1', size: '1', side: 'buy' })).toEqual([]);
    expect(validatePayloadFor('trade', { price: '1' }).length).toBeGreaterThan(0);
    expect(validatePayloadFor('trade', 'not an object').length).toBeGreaterThan(0);
  });
});

describe('trade payload', () => {
  const valid = { price: '43125.10', size: '0.017', side: 'buy' as const };

  it('accepts a valid trade', () => {
    expect(isTradePayload(valid)).toBe(true);
    expect(isTradePayload({ ...valid, trade_id: 't-1' })).toBe(true);
  });

  it('rejects invalid trades with collect-all errors', () => {
    const errors = payloadRegistry.trade.validate({ price: '0', size: '-1', side: 'aggressive' });
    expect(errors.length).toBe(3);
    expect(isTradePayload({ price: '0', size: '0.1', side: 'sell' })).toBe(false);
    expect(isTradePayload({ price: 43125.1, size: '0.017', side: 'buy' })).toBe(false); // numbers are not decimal strings
    expect(isTradePayload({ price: '1', size: '0', side: 'buy' })).toBe(false); // zero size is not positive
    expect(isTradePayload({ trade_id: 'x' })).toBe(false);
  });
});

describe('quote payload', () => {
  it('accepts a valid quote and rejects invalid ones', () => {
    expect(isQuotePayload({ bid_price: '1.1', bid_size: '2', ask_price: '1.2', ask_size: '3' })).toBe(true);
    // crossed quotes are market facts, not protocol violations
    expect(isQuotePayload({ bid_price: '2', bid_size: '1', ask_price: '1', ask_size: '1' })).toBe(true);
    expect(isQuotePayload({ bid_price: '0', bid_size: '1', ask_price: '1', ask_size: '1' })).toBe(false);
    expect(isQuotePayload({ bid_price: '1.1', bid_size: '1' })).toBe(false);
  });
});

describe('book snapshot payload', () => {
  it('accepts valid snapshots including empty sides', () => {
    expect(isBookSnapshotPayload({ bids: [], asks: [] })).toBe(true);
    expect(
      isBookSnapshotPayload({
        bids: [{ price: '100.5', size: '1.25' }],
        asks: [{ price: '100.75', size: '0.5' }],
        depth: 20,
        last_update_id: 'u-7',
      }),
    ).toBe(true);
  });

  it('rejects invalid levels and metadata', () => {
    expect(isBookSnapshotPayload({ bids: [{ price: '0', size: '1' }], asks: [] })).toBe(false);
    expect(isBookSnapshotPayload({ bids: [{ price: '1', size: '-2' }], asks: [] })).toBe(false);
    expect(isBookSnapshotPayload({ bids: [{ price: '1' }], asks: [] })).toBe(false);
    expect(isBookSnapshotPayload({ bids: [], asks: [], depth: -1 })).toBe(false);
    expect(isBookSnapshotPayload({ bids: [], asks: [], last_update_id: '' })).toBe(false);
    expect(isBookSnapshotPayload({ bids: 'x', asks: [] })).toBe(false);
  });
});

describe('book delta payload', () => {
  it('accepts valid deltas per action', () => {
    expect(isBookDeltaPayload({ action: 'add', levels: [{ price: '1', size: '2' }] })).toBe(true);
    expect(isBookDeltaPayload({ action: 'update', levels: [{ price: '1', size: '2' }] })).toBe(true);
    // remove allows zero size (delete-by-price)
    expect(isBookDeltaPayload({ action: 'remove', levels: [{ price: '1', size: '0' }] })).toBe(true);
    expect(isBookDeltaPayload({ action: 'clear', levels: [] })).toBe(true);
  });

  it('rejects invalid deltas', () => {
    expect(isBookDeltaPayload({ action: 'clear', levels: [{ price: '1', size: '1' }] })).toBe(false);
    expect(isBookDeltaPayload({ action: 'add', levels: [] })).toBe(false);
    expect(isBookDeltaPayload({ action: 'add', levels: [{ price: '1', size: '0' }] })).toBe(false);
    expect(isBookDeltaPayload({ action: 'explode', levels: [{ price: '1', size: '1' }] })).toBe(false);
    expect(isBookDeltaPayload({ action: 'add' })).toBe(false);
  });
});

describe('ohlcv payload', () => {
  const valid = { interval: '1m', open: '1', high: '2', low: '0.5', close: '1.5', volume: '0' };

  it('accepts a consistent bar (zero volume included)', () => {
    expect(isOhlcvPayload(valid)).toBe(true);
    expect(isOhlcvPayload({ ...valid, closed: true, trade_count: 12 })).toBe(true);
  });

  it('rejects inconsistent bars (exact decimal cross-checks)', () => {
    expect(isOhlcvPayload({ ...valid, high: '0.9' })).toBe(false); // high < open
    expect(isOhlcvPayload({ ...valid, low: '1.6' })).toBe(false); // low > close
    expect(isOhlcvPayload({ ...valid, high: '0.6', low: '0.7' })).toBe(false); // high < low
    expect(isOhlcvPayload({ ...valid, interval: '1x' })).toBe(false);
    expect(isOhlcvPayload({ ...valid, volume: '-1' })).toBe(false);
    expect(isOhlcvPayload({ ...valid, trade_count: -1 })).toBe(false);
    expect(isOhlcvPayload({ ...valid, closed: 'yes' })).toBe(false);
  });

  it('enforces consistency beyond float precision', () => {
    // 0.0000001 vs 0.00000001 — exact lexical comparison, not float-mediated
    expect(
      isOhlcvPayload({ interval: '1s', open: '0.00000001', high: '0.0000001', low: '0.00000001', close: '0.00000001', volume: '1' }),
    ).toBe(true);
    expect(
      isOhlcvPayload({ interval: '1s', open: '0.0000001', high: '0.00000001', low: '0.00000001', close: '0.00000001', volume: '1' }),
    ).toBe(false);
  });
});

describe('news payload', () => {
  it('accepts valid news with and without optional fields', () => {
    expect(isNewsPayload({ headline: 'h', symbols: [] })).toBe(true);
    expect(
      isNewsPayload({ headline: 'h', symbols: ['PAIR-1'], body: 'b', source: 'newswire-a', url: 'https://example.test/a', tags: ['t'] }),
    ).toBe(true);
  });

  it('rejects invalid news', () => {
    expect(isNewsPayload({ headline: '', symbols: [] })).toBe(false);
    expect(isNewsPayload({ symbols: [] })).toBe(false);
    expect(isNewsPayload({ headline: 'h', symbols: 'PAIR-1' })).toBe(false);
    expect(isNewsPayload({ headline: 'h', symbols: [''] })).toBe(false);
    expect(isNewsPayload({ headline: 'h', symbols: [], url: 'ftp://example.test/a' })).toBe(false);
  });
});

describe('macro release payload', () => {
  it('accepts free-form values', () => {
    expect(
      isMacroReleasePayload({ indicator: 'US_CPI_YOY', region: 'US', period: '2024-05', actual: '3.2%', forecast: '+0.4%', prior: 'N/A' }),
    ).toBe(true);
    expect(isMacroReleasePayload({ indicator: 'I', region: 'R', period: 'P', actual: 'N/A' })).toBe(true);
  });

  it('rejects missing required strings', () => {
    expect(isMacroReleasePayload({ region: 'R', period: 'P', actual: 'A' })).toBe(false);
    expect(isMacroReleasePayload({ indicator: '', region: 'R', period: 'P', actual: 'A' })).toBe(false);
    expect(isMacroReleasePayload({ indicator: 'I', region: 'R', period: 'P', actual: 'A', unit: '' })).toBe(false);
  });
});

describe('social signal payload', () => {
  it('accepts signed decimal values', () => {
    expect(isSocialSignalPayload({ platform: 'platform-x', metric: 'sentiment_score', value: '-0.21' })).toBe(true);
    expect(isSocialSignalPayload({ platform: 'platform-x', metric: 'mention_count', value: '1520' })).toBe(true);
  });

  it('rejects non-decimal values', () => {
    expect(isSocialSignalPayload({ platform: 'p', metric: 'm', value: 'lots' })).toBe(false);
    expect(isSocialSignalPayload({ platform: 'p', metric: 'm', value: '-.5' })).toBe(false);
    expect(isSocialSignalPayload({ platform: '', metric: 'm', value: '1' })).toBe(false);
    expect(isSocialSignalPayload({ platform: 'p', metric: 'm', value: '1', author: '' })).toBe(false);
  });
});

describe('fundamental payload', () => {
  it('accepts free-form reported values', () => {
    expect(isFundamentalPayload({ field: 'EPS_DILUTED', period: '2024-Q2', value: '6.7B', unit: 'USD', source: 'quarterly-report' })).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(isFundamentalPayload({ period: '2024-Q2', value: '1' })).toBe(false);
    expect(isFundamentalPayload({ field: 'F', period: 'P', value: '' })).toBe(false);
  });
});

describe('option chain mark payload', () => {
  const valid = { underlying: 'IDX-A', expiry: 1_800_000_000_000, strike: '4200.5', right: 'call' as const, mark_price: '12.25' };

  it('accepts valid marks with optional greeks/iv', () => {
    expect(isOptionChainMarkPayload(valid)).toBe(true);
    expect(
      isOptionChainMarkPayload({ ...valid, implied_vol: '0.18', greeks: { delta: '0.51', theta: '-1.2' } }),
    ).toBe(true);
  });

  it('rejects invalid marks', () => {
    expect(isOptionChainMarkPayload({ ...valid, expiry: -1 })).toBe(false);
    expect(isOptionChainMarkPayload({ ...valid, strike: '0' })).toBe(false);
    expect(isOptionChainMarkPayload({ ...valid, right: 'CALL' })).toBe(false);
    expect(isOptionChainMarkPayload({ ...valid, mark_price: '0' })).toBe(false);
    expect(isOptionChainMarkPayload({ ...valid, greeks: { delta: 'big' } })).toBe(false);
    expect(isOptionChainMarkPayload({ ...valid, greeks: 'none' })).toBe(false);
  });
});

describe('other payload (escape hatch)', () => {
  it('requires a named kind and a JSON object data', () => {
    expect(isOtherPayload({ kind: 'funding_rate', data: { rate: '0.01' } })).toBe(true);
    expect(isOtherPayload({ kind: 'x', data: {} })).toBe(true);
    expect(isOtherPayload({ data: {} })).toBe(false);
    expect(isOtherPayload({ kind: '', data: {} })).toBe(false);
    expect(isOtherPayload({ kind: 'x' })).toBe(false);
    expect(isOtherPayload({ kind: 'x', data: { bad: NaN } })).toBe(false); // NaN is not a JSON value
    expect(isOtherPayload({ kind: 'x', data: { nested: [1, 'a', null, true] } })).toBe(true);
  });
});
