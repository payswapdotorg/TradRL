import { describe, expect, it } from 'vitest';
import {
  Order,
  isOrder,
  isOrderSide,
  isCoreOrderKind,
  isOrderKind,
  isCoreTimeInForce,
  isTimeInForce,
} from './order';
import { DecimalString, Timestamp } from './primitives';
import { InstrumentId, VenueId } from './ids';

const dec = (s: string) => s as DecimalString;
const ts = (s: string) => s as Timestamp;

const btcUsdt = 'instr_btc_usdt' as InstrumentId;
const binance = 'venue_binance' as VenueId;

function validOrder(): Order {
  return {
    clientOrderId: 'prj_1-co-0001',
    instrumentId: btcUsdt,
    venueId: binance,
    side: 'buy',
    kind: 'limit',
    quantity: dec('0.5'),
    price: dec('42000.01'),
    timeInForce: 'gtc',
    createdAt: ts('2027-01-15T09:30:00.250Z'),
    notes: 'Entry tranche 1 of 3.',
  };
}

describe('isOrder — acceptance', () => {
  it('accepts a valid limit order', () => {
    expect(isOrder(validOrder())).toBe(true);
  });

  it('accepts a market order without prices', () => {
    const market: Order = {
      ...validOrder(),
      kind: 'market',
      price: undefined,
    };
    expect(isOrder(market)).toBe(true);
  });

  it('accepts a stop order with only a stop price', () => {
    const stop: Order = {
      ...validOrder(),
      kind: 'stop',
      price: undefined,
      stopPrice: dec('38000'),
    };
    expect(isOrder(stop)).toBe(true);
  });

  it('accepts a stop-limit order with both prices', () => {
    const stopLimit: Order = {
      ...validOrder(),
      kind: 'stop-limit',
      stopPrice: dec('38000'),
    };
    expect(isOrder(stopLimit)).toBe(true);
  });

  it('accepts a good-till-time order with expiry', () => {
    const gtt: Order = {
      ...validOrder(),
      timeInForce: 'gtt',
      expiresAt: ts('2027-01-16T09:30:00Z'),
    };
    expect(isOrder(gtt)).toBe(true);
  });

  it('accepts a registered extension kind without enforcing the price matrix', () => {
    const iceberg: Order = {
      ...validOrder(),
      kind: 'iceberg',
      price: dec('42000.01'),
      stopPrice: dec('38000'),
    };
    expect(isOrder(iceberg)).toBe(true);
  });
});

describe('isOrder — core kind price matrix', () => {
  it('a market order must not carry price or stopPrice', () => {
    expect(isOrder({ ...validOrder(), kind: 'market', price: dec('42000') })).toBe(false);
    expect(isOrder({ ...validOrder(), kind: 'market', stopPrice: dec('42000') })).toBe(false);
    expect(
      isOrder({ ...validOrder(), kind: 'market', price: dec('42000'), stopPrice: dec('41000') }),
    ).toBe(false);
  });

  it('a limit order requires a price and must not carry a stop price', () => {
    expect(isOrder({ ...validOrder(), price: undefined })).toBe(false);
    expect(isOrder({ ...validOrder(), stopPrice: dec('38000') })).toBe(false);
  });

  it('a stop order requires a stop price and must not carry a limit price', () => {
    expect(isOrder({ ...validOrder(), kind: 'stop', price: undefined, stopPrice: undefined })).toBe(false);
    expect(isOrder({ ...validOrder(), kind: 'stop', stopPrice: dec('38000') })).toBe(false); // price present
  });

  it('a stop-limit order requires both prices', () => {
    expect(isOrder({ ...validOrder(), kind: 'stop-limit', stopPrice: undefined })).toBe(false);
    expect(
      isOrder({ ...validOrder(), kind: 'stop-limit', price: undefined, stopPrice: dec('38000') }),
    ).toBe(false);
  });
});

describe('isOrder — time-in-force and expiry', () => {
  it('gtt requires an expiry; other core values reject it', () => {
    expect(isOrder({ ...validOrder(), timeInForce: 'gtt' })).toBe(false); // no expiry
    expect(isOrder({ ...validOrder(), timeInForce: 'ioc', expiresAt: ts('2027-01-16T09:30:00Z') })).toBe(false);
    expect(isOrder({ ...validOrder(), timeInForce: 'day', expiresAt: ts('2027-01-16T09:30:00Z') })).toBe(false);
    expect(isOrder({ ...validOrder(), timeInForce: 'gtc', expiresAt: ts('2027-01-16T09:30:00Z') })).toBe(false);
    // Non-core time-in-force values may use expiry freely (extension semantics).
    expect(
      isOrder({ ...validOrder(), timeInForce: 'gt-date', expiresAt: ts('2027-01-16T09:30:00Z') }),
    ).toBe(true);
  });
});

describe('isOrder — field rejections', () => {
  it('rejects malformed orders', () => {
    const invalid: unknown[] = [
    { ...validOrder(), clientOrderId: '' }, // idempotency key required
    { ...validOrder(), instrumentId: '' },
    { ...validOrder(), venueId: 5 },
    { ...validOrder(), side: 'purchase' },
    { ...validOrder(), side: '' },
    { ...validOrder(), kind: '' },
    { ...validOrder(), quantity: '0' }, // strictly positive
    { ...validOrder(), quantity: '-0.5' },
    { ...validOrder(), quantity: '0.5.2' },
    { ...validOrder(), quantity: 0.5 }, // numbers are not decimals
    { ...validOrder(), price: '0' },
    { ...validOrder(), price: 'free' },
    { ...validOrder(), stopPrice: '-1' },
    { ...validOrder(), timeInForce: '' },
    { ...validOrder(), createdAt: '2027-01-15T09:30:00' }, // no offset
    { ...validOrder(), notes: '' },
    null,
    'order',
  ];
    for (const o of invalid) expect(isOrder(o)).toBe(false);
  });
});

describe('order vocabularies', () => {
  it('sides are buy/sell only', () => {
    expect(isOrderSide('buy')).toBe(true);
    expect(isOrderSide('sell')).toBe(true);
    expect(isOrderSide('short')).toBe(false);
  });

  it('order kinds and TIF distinguish core from extension', () => {
    expect(isCoreOrderKind('market')).toBe(true);
    expect(isCoreOrderKind('stop-limit')).toBe(true);
    expect(isCoreOrderKind('iceberg')).toBe(false);
    expect(isOrderKind('iceberg')).toBe(true);
    expect(isCoreTimeInForce('gtt')).toBe(true);
    expect(isCoreTimeInForce('gt-date')).toBe(false);
    expect(isTimeInForce('gt-date')).toBe(true);
  });
});
