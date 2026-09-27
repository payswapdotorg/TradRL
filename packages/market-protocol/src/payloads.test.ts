import { describe, expect, it } from 'vitest';

import {
  compareDecimal,
  isJsonObject,
  isJsonValue,
  isPositiveDecimal,
  isSignedDecimal,
  isUnsignedDecimal,
  payloadRegistry,
  validateBookDeltaPayload,
  validateNewsPayload,
  validateOhlcvPayload,
  validateOptionChainMarkPayload,
  validateOtherPayload,
  validateQuotePayload,
  validateSocialSignalPayload,
  validateTradePayload,
  type EventType,
  type TimestampMs,
} from './index';
import { requireTimestampMs } from '../../time-engine/src/index';

function ts(n: number): TimestampMs {
  return requireTimestampMs(n);
}

function errorStrings(errors: readonly { code: string; path: string }[]): string[] {
  return errors.map((error) => `${error.code}@${error.path}`);
}

describe('decimal string numerics', () => {
  it('compares exactly, beyond float precision', () => {
    expect(compareDecimal('0.0000001', '0.00000001')).toBe(1); // both inexact as floats
    expect(compareDecimal('0.1', '0.1')).toBe(0);
    expect(compareDecimal('10', '9.99')).toBe(1); // length-aware, not lexical
    expect(compareDecimal('1.45', '1.5')).toBe(-1);
    expect(compareDecimal('-1', '1')).toBe(-1);
    expect(compareDecimal('-2', '-1')).toBe(-1);
    expect(compareDecimal('0', '-0')).toBe(0);
    expect(compareDecimal('+3.14', '3.14')).toBe(0);
  });

  it('validates decimal forms', () => {
    expect(isUnsignedDecimal('43125.10')).toBe(true);
    expect(isUnsignedDecimal('0')).toBe(true);
    expect(isUnsignedDecimal('-1')).toBe(false);
    expect(isUnsignedDecimal('1.')).toBe(false);
    expect(isUnsignedDecimal('.5')).toBe(false);
    expect(isUnsignedDecimal('1e5')).toBe(false);
    expect(isSignedDecimal('-0.21')).toBe(true);
    expect(isPositiveDecimal('0')).toBe(false);
    expect(isPositiveDecimal('0.0000')).toBe(false);
    expect(isPositiveDecimal('0.0001')).toBe(true);
  });
});

describe('JSON value model', () => {
  it('accepts well-formed JSON values and rejects non-JSON', () => {
    expect(isJsonValue('a')).toBe(true);
    expect(isJsonValue(1.5)).toBe(true);
    expect(isJsonValue(null)).toBe(true);
    expect(isJsonValue([1, { a: [true, null] }])).toBe(true);
    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJsonValue({ a: undefined })).toBe(false);
    expect(isJsonValue(() => 1)).toBe(false);
    expect(isJsonObject({ a: 1 })).toBe(true);
    expect(isJsonObject([1])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject({ a: { b: Number.NaN } })).toBe(false);
  });
});

describe('trade payload guard', () => {
  it('accepts a valid trade and rejects malformed ones', () => {
    expect(validateTradePayload({ price: '100.5', size: '0.1', side: 'sell' })).toEqual([]);
    expect(errorStrings(validateTradePayload({ price: '0', size: '0.1', side: 'sell' }))).toContain('invalid_field@price');
    expect(errorStrings(validateTradePayload({ price: '-1', size: '0.1', side: 'buy' }))).toContain('invalid_field@price');
    expect(errorStrings(validateTradePayload({ price: '100', size: 'lots', side: 'buy' }))).toContain('invalid_field@size');
    expect(errorStrings(validateTradePayload({ price: '100', size: '0.1', side: 'BUY' }))).toContain('invalid_field@side');
    expect(errorStrings(validateTradePayload({ size: '0.1', side: 'buy' }))).toContain('missing_field@price');
    expect(errorStrings(validateTradePayload({ price: '100', size: '0.1', side: 'buy', trade_id: '' }))).toContain(
      'invalid_field@trade_id',
    );
  });
});

describe('quote payload guard', () => {
  it('requires four positive decimal fields', () => {
    const valid = { bid_price: '100.0', bid_size: '1', ask_price: '100.2', ask_size: '2' };
    expect(validateQuotePayload(valid)).toEqual([]);
    expect(errorStrings(validateQuotePayload({ ...valid, bid_price: '0.0' }))).toContain('invalid_field@bid_price');
    expect(errorStrings(validateQuotePayload({ ...valid, ask_size: 'x' }))).toContain('invalid_field@ask_size');
    expect(errorStrings(validateQuotePayload({ bid_price: '1', bid_size: '1', ask_price: '1' }))).toContain(
      'missing_field@ask_size',
    );
  });
});

describe('book payload guards', () => {
  it('book_snapshot accepts levels with positive sizes (empty sides allowed)', () => {
    expect(
      payloadRegistry.book_snapshot.validate({ bids: [], asks: [{ price: '1.5', size: '2' }] }),
    ).toEqual([]);
    expect(
      errorStrings(
        payloadRegistry.book_snapshot.validate({ bids: [{ price: '1', size: '0' }], asks: [] }),
      ),
    ).toContain('invalid_field@bids[0].size');
    expect(
      errorStrings(payloadRegistry.book_snapshot.validate({ bids: [{ price: '1' }], asks: [] })),
    ).toContain('missing_field@bids[0].size');
    expect(
      errorStrings(payloadRegistry.book_snapshot.validate({ bids: [], asks: [], depth: -1 })),
    ).toContain('invalid_field@depth');
  });

  it('book_delta enforces action-specific level rules', () => {
    expect(validateBookDeltaPayload({ action: 'add', levels: [{ price: '1', size: '1' }] })).toEqual([]);
    expect(validateBookDeltaPayload({ action: 'remove', levels: [{ price: '1', size: '0' }] })).toEqual([]); // remove-by-price
    expect(validateBookDeltaPayload({ action: 'clear', levels: [] })).toEqual([]);
    expect(errorStrings(validateBookDeltaPayload({ action: 'clear', levels: [{ price: '1', size: '1' }] }))).toContain(
      'invalid_field@levels',
    );
    expect(errorStrings(validateBookDeltaPayload({ action: 'add', levels: [] }))).toContain('invalid_field@levels');
    expect(errorStrings(validateBookDeltaPayload({ action: 'add', levels: [{ price: '1', size: '0' }] }))).toContain(
      'invalid_field@levels[0].size',
    );
    expect(errorStrings(validateBookDeltaPayload({ action: 'upsert', levels: [] }))).toContain('invalid_field@action');
  });
});

describe('ohlcv payload guard', () => {
  const valid = { interval: '1m', open: '100.1', high: '101.5', low: '99.9', close: '101.0', volume: '1234.56' };

  it('accepts a consistent bar (zero volume allowed)', () => {
    expect(validateOhlcvPayload({ ...valid, volume: '0', closed: true, trade_count: 42 })).toEqual([]);
  });

  it('rejects inconsistent bars with exact decimal cross-checks', () => {
    expect(errorStrings(validateOhlcvPayload({ ...valid, high: '100.0' }))).toContain('invalid_field@high');
    expect(errorStrings(validateOhlcvPayload({ ...valid, low: '100.2' }))).toContain('invalid_field@low');
    expect(
      errorStrings(validateOhlcvPayload({ ...valid, open: '0.000000001', high: '0.0000000005' })),
    ).toContain('invalid_field@high');
  });

  it('validates interval form and optional fields', () => {
    expect(errorStrings(validateOhlcvPayload({ ...valid, interval: '1min' }))).toContain('invalid_field@interval');
    expect(errorStrings(validateOhlcvPayload({ ...valid, interval: 'm' }))).toContain('invalid_field@interval');
    expect(validateOhlcvPayload({ ...valid, interval: '60s' })).toEqual([]);
    expect(errorStrings(validateOhlcvPayload({ ...valid, closed: 'yes' }))).toContain('invalid_field@closed');
    expect(errorStrings(validateOhlcvPayload({ ...valid, trade_count: 1.5 }))).toContain('invalid_field@trade_count');
  });
});

describe('news payload guard', () => {
  it('accepts news with empty symbols and validates structure', () => {
    expect(validateNewsPayload({ headline: 'Fed holds rates', symbols: [] })).toEqual([]);
    expect(errorStrings(validateNewsPayload({ symbols: [] }))).toContain('missing_field@headline');
    expect(errorStrings(validateNewsPayload({ headline: 'X', symbols: [''] }))).toContain('invalid_field@symbols[0]');
    expect(errorStrings(validateNewsPayload({ headline: 'X', symbols: [], url: 'ftp://example.com' }))).toContain(
      'invalid_field@url',
    );
    expect(errorStrings(validateNewsPayload({ headline: 'X', symbols: [], tags: ['ok', ''] }))).toContain(
      'invalid_field@tags[1]',
    );
  });
});

describe('macro release payload guard', () => {
  it('requires indicator/region/period/actual; optional fields must be non-empty when present', () => {
    const valid = { indicator: 'US_CPI_YOY', region: 'US', period: '2024-05', actual: '3.3' };
    expect(payloadRegistry.macro_release.validate(valid)).toEqual([]);
    expect(errorStrings(payloadRegistry.macro_release.validate({ ...valid, actual: '' }))).toContain(
      'invalid_field@actual',
    );
    expect(errorStrings(payloadRegistry.macro_release.validate({ indicator: 'X', region: 'US', period: 'P' }))).toContain(
      'missing_field@actual',
    );
  });
});

describe('social signal payload guard', () => {
  it('accepts signed decimal values (sentiment can be negative)', () => {
    expect(validateSocialSignalPayload({ platform: 'x', metric: 'sentiment_score', value: '-0.21' })).toEqual([]);
    expect(validateSocialSignalPayload({ platform: 'x', metric: 'mention_count', value: '1520' })).toEqual([]);
    expect(
      errorStrings(validateSocialSignalPayload({ platform: 'x', metric: 'sentiment_score', value: 'meh' })),
    ).toContain('invalid_field@value');
    expect(
      errorStrings(validateSocialSignalPayload({ metric: 'sentiment_score', value: '1' })),
    ).toContain('missing_field@platform');
  });
});

describe('fundamental payload guard', () => {
  it('requires field/period/value', () => {
    expect(payloadRegistry.fundamental.validate({ field: 'EPS', period: '2024-Q2', value: '1.23' })).toEqual([]);
    expect(
      errorStrings(payloadRegistry.fundamental.validate({ field: 'EPS', period: '2024-Q2', value: 'N/A' })),
    ).toEqual([]); // free-form values are legitimate
    expect(
      errorStrings(payloadRegistry.fundamental.validate({ field: 'EPS', period: '2024-Q2' })),
    ).toContain('missing_field@value');
  });
});

describe('option chain mark payload guard', () => {
  const valid = {
    underlying: 'SPX',
    expiry: ts(1_750_000_000_000),
    strike: '5500',
    right: 'call',
    mark_price: '42.10',
  };

  it('accepts a mark with greeks and iv', () => {
    expect(
      validateOptionChainMarkPayload({
        ...valid,
        implied_vol: '0.13',
        greeks: { delta: '0.51', theta: '-1.2' },
      }),
    ).toEqual([]);
  });

  it('rejects malformed numerics, rights and expiries', () => {
    expect(errorStrings(validateOptionChainMarkPayload({ ...valid, strike: '0' }))).toContain('invalid_field@strike');
    expect(errorStrings(validateOptionChainMarkPayload({ ...valid, right: 'CALL' }))).toContain('invalid_field@right');
    expect(errorStrings(validateOptionChainMarkPayload({ ...valid, expiry: 1.5 }))).toContain('invalid_field@expiry');
    expect(errorStrings(validateOptionChainMarkPayload({ ...valid, implied_vol: '-0.1' }))).toContain(
      'invalid_field@implied_vol',
    );
    expect(
      errorStrings(validateOptionChainMarkPayload({ ...valid, greeks: { delta: 'butterfly' } })),
    ).toContain('invalid_field@greeks.delta');
    expect(errorStrings(validateOptionChainMarkPayload({ ...valid, mark_price: 'abc' }))).toContain(
      'invalid_field@mark_price',
    );
  });
});

describe('other payload guard (escape hatch)', () => {
  it('REQUIRES a free-form kind and a JSON object body', () => {
    expect(validateOtherPayload({ kind: 'funding_rate', data: { rate: '0.0001' } })).toEqual([]);
    expect(validateOtherPayload({ kind: 'empty', data: {} })).toEqual([]);
    expect(errorStrings(validateOtherPayload({ data: {} }))).toContain('missing_field@kind');
    expect(errorStrings(validateOtherPayload({ kind: '', data: {} }))).toContain('invalid_field@kind');
    expect(errorStrings(validateOtherPayload({ kind: 'x' }))).toContain('missing_field@data');
    expect(errorStrings(validateOtherPayload({ kind: 'x', data: [1, 2] }))).toContain('invalid_field@data');
    expect(errorStrings(validateOtherPayload({ kind: 'x', data: { bad: Number.NaN } }))).toContain('invalid_field@data');
  });
});

describe('payload registry', () => {
  it('covers the full taxonomy with is-guards', () => {
    const eventTypes: EventType[] = [
      'trade',
      'quote',
      'book_snapshot',
      'book_delta',
      'ohlcv',
      'news',
      'macro_release',
      'social_signal',
      'fundamental',
      'option_chain_mark',
      'other',
    ];
    for (const eventType of eventTypes) {
      expect(payloadRegistry[eventType], `registry entry for ${eventType}`).toBeDefined();
      expect(typeof payloadRegistry[eventType].validate).toBe('function');
      expect(typeof payloadRegistry[eventType].is).toBe('function');
    }
    // Spot-check the is-guards.
    expect(payloadRegistry.trade.is({ price: '1', size: '1', side: 'buy' })).toBe(true);
    expect(payloadRegistry.trade.is({ price: '1', size: '1' })).toBe(false);
    expect(payloadRegistry.other.is({ kind: 'k', data: {} })).toBe(true);
  });
});
