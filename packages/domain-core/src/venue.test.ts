import { describe, expect, it } from 'vitest';
import { Venue, isVenue, isVenueCapabilities } from './venue';
import { isOrderKind, isCoreOrderKind } from './order';
import { isInstrument } from './instrument';
import { VenueId } from './ids';

const binance = 'venue_binance' as VenueId;

function validVenue(): Venue {
  return {
    id: binance,
    name: 'Binance (reference venue record)',
    description: 'Crypto spot venue record for canonical reference.',
    assetClasses: ['crypto'],
    capabilities: {
      orderKinds: ['market', 'limit', 'stop-limit'],
      timeInForce: ['gtc', 'ioc', 'fok'],
      supportsShort: false,
      supportsMargin: true,
    },
  };
}

describe('isVenue — acceptance and rejection', () => {
  it('accepts a fully valid venue', () => {
    expect(isVenue(validVenue())).toBe(true);
  });

  const invalid: unknown[] = [
    { ...validVenue(), id: '' },
    { ...validVenue(), name: '' },
    { ...validVenue(), assetClasses: [] }, // at least one asset class
    { ...validVenue(), assetClasses: ['crypto', 'crypto'] }, // duplicates
    { ...validVenue(), assetClasses: ['cRYPTO'] },
    { ...validVenue(), capabilities: { orderKinds: [], timeInForce: ['gtc'] } }, // empty kinds
    { ...validVenue(), capabilities: { orderKinds: ['market'], timeInForce: [] } }, // empty tif
    { ...validVenue(), capabilities: { orderKinds: ['market', 'market'], timeInForce: ['gtc'] } },
    { ...validVenue(), capabilities: { orderKinds: ['market'], timeInForce: ['gtc'], supportsShort: 'no' } },
    { ...validVenue(), description: '' },
    {},
    null,
  ];
  for (const v of invalid) expect(isVenue(v)).toBe(false);

  it('isVenueCapabilities accepts extension order kinds', () => {
    expect(
      isVenueCapabilities({ orderKinds: ['market', 'iceberg'], timeInForce: ['gtt'] }),
    ).toBe(true);
    expect(isVenueCapabilities({ orderKinds: 'market', timeInForce: ['gtc'] })).toBe(false);
  });
});

describe('order kind vocabulary integration (venue ↔ order)', () => {
  it('core kinds are a subset of the open order-kind vocabulary', () => {
    expect(isOrderKind('market')).toBe(true);
    expect(isOrderKind('iceberg')).toBe(true); // registered extension
    expect(isCoreOrderKind('market')).toBe(true);
    expect(isCoreOrderKind('iceberg')).toBe(false); // extension is not core
    expect(isOrderKind('')).toBe(false);
  });

  it('an instrument references venues by opaque id', () => {
    const instrument = {
      id: 'instr_btc_usdt',
      symbol: 'BTC-USDT',
      assetClass: 'crypto',
      venueIds: ['venue_binance', 'venue_coinbase'],
      tickSize: '0.01',
      lotSize: '0.00001',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
    };
    expect(isInstrument(instrument)).toBe(true);
  });
});
