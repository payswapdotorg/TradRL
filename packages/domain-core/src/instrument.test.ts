import { describe, expect, it } from 'vitest';
import { Instrument, isInstrument } from './instrument';
import { DecimalString, Timestamp } from './primitives';
import { InstrumentId, VenueId } from './ids';

const dec = (s: string) => s as DecimalString;
const ts = (s: string) => s as Timestamp;

const btcUsdt = 'instr_btc_usdt' as InstrumentId;
const esMar27 = 'instr_es_mar27' as InstrumentId;
const spx = 'instr_spx' as InstrumentId;
const binance = 'venue_binance' as VenueId;
const coinbase = 'venue_coinbase' as VenueId;
const cboe = 'venue_cboe' as VenueId;
const cme = 'venue_cme' as VenueId;

function validInstrument(): Instrument {
  return {
    id: btcUsdt,
    symbol: 'BTC-USDT',
    name: 'Bitcoin / Tether',
    assetClass: 'crypto',
    venueIds: [binance, coinbase],
    tickSize: dec('0.01'),
    lotSize: dec('0.00001'),
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
  };
}

describe('isInstrument — acceptance', () => {
  it('accepts a fully valid pair instrument', () => {
    expect(isInstrument(validInstrument())).toBe(true);
  });

  it('accepts a derivative instrument with contract size and expiry', () => {
    const future: Instrument = {
      id: esMar27,
      symbol: 'ES-MAR27',
      assetClass: 'future',
      venueIds: [cme],
      contractSize: dec('50'),
      expiresAt: ts('2027-03-19T16:00:00Z'),
    };
    expect(isInstrument(future)).toBe(true);
  });

  it('accepts an instrument without tick/lot conventions (where not applicable)', () => {
    const index: Instrument = {
      id: spx,
      symbol: 'SPX',
      assetClass: 'index',
      venueIds: [cboe],
    };
    expect(isInstrument(index)).toBe(true);
  });
});

describe('isInstrument — rejection', () => {
  const invalid: unknown[] = [
    { ...validInstrument(), id: '' },
    { ...validInstrument(), symbol: '' },
    { ...validInstrument(), assetClass: 'metals' },
    { ...validInstrument(), venueIds: [] }, // must reference at least one venue
    { ...validInstrument(), venueIds: ['venue_binance', 'venue_binance'] }, // duplicates
    { ...validInstrument(), venueIds: [''] },
    { ...validInstrument(), tickSize: '0' }, // must be strictly positive
    { ...validInstrument(), tickSize: '-0.01' },
    { ...validInstrument(), lotSize: '0' },
    { ...validInstrument(), contractSize: '0' },
    { ...validInstrument(), baseAsset: '' },
    { ...validInstrument(), quoteAsset: '' },
    { ...validInstrument(), expiresAt: '2027-03-19' },
    null,
  ];
  for (const i of invalid) expect(isInstrument(i)).toBe(false);

  it('trailing-zero decimals are canonical and accepted', () => {
    expect(isInstrument({ ...validInstrument(), tickSize: '0.010' })).toBe(true);
  });
});
