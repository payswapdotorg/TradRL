import { describe, expect, it } from 'vitest';
import { Position, isPosition } from './position';
import { Portfolio, isPortfolio, isPortfolioSummaryMetrics } from './portfolio';
import { DecimalString, Timestamp } from './primitives';
import { InstrumentId, ProjectId, VenueId } from './ids';

const dec = (s: string) => s as DecimalString;
const ts = (s: string) => s as Timestamp;

const prj1 = 'prj_1' as ProjectId;
const btcUsdt = 'instr_btc_usdt' as InstrumentId;
const ethUsdt = 'instr_eth_usdt' as InstrumentId;
const binance = 'venue_binance' as VenueId;

function longPosition(): Position {
  return {
    instrumentId: btcUsdt,
    venueId: binance,
    quantity: dec('1.25'),
    averageEntryPrice: dec('41850.10'),
    realizedPnl: dec('-12.40'),
    unrealizedPnl: dec('318.75'),
    openedAt: ts('2027-01-10T09:00:00Z'),
    asOf: ts('2027-01-20T17:00:00Z'),
  };
}

function shortPosition(): Position {
  return {
    instrumentId: ethUsdt,
    quantity: dec('-30'),
    averageEntryPrice: dec('2510.55'),
    asOf: ts('2027-01-20T17:00:00Z'),
  };
}

describe('isPosition', () => {
  it('accepts long, short and flat snapshots (data only, no PnL math here)', () => {
    expect(isPosition(longPosition())).toBe(true);
    expect(isPosition(shortPosition())).toBe(true);
    expect(
      isPosition({ ...longPosition(), quantity: '0', averageEntryPrice: '0' }),
    ).toBe(true);
  });

  it('accepts venue-aggregated positions (venueId absent)', () => {
    expect(isPosition({ ...longPosition(), venueId: undefined })).toBe(true);
  });

  it('rejects malformed positions', () => {
    const invalid: unknown[] = [
      { ...longPosition(), instrumentId: '' },
      { ...longPosition(), venueId: '' },
      { ...longPosition(), quantity: 'free' },
      { ...longPosition(), quantity: '' },
      { ...longPosition(), averageEntryPrice: '-1' }, // negative entry price is invalid
      { ...longPosition(), averageEntryPrice: 'NaN' },
      { ...longPosition(), realizedPnl: 'unknown' },
      { ...longPosition(), unrealizedPnl: 100 }, // number, not decimal string
      { ...longPosition(), asOf: '2027-01-20' }, // point-in-time stamp required
      { ...longPosition(), asOf: undefined },
      { ...longPosition(), openedAt: '2027-01-10T09:00:00' },
      null,
    ];
    for (const p of invalid) expect(isPosition(p)).toBe(false);
  });

  it('PnL split is optional data (absent = not yet available)', () => {
    expect(isPosition({ ...longPosition(), realizedPnl: undefined, unrealizedPnl: undefined })).toBe(true);
  });
});

describe('isPortfolio', () => {
  function validPortfolio(): Portfolio {
    return {
      projectId: prj1,
      name: 'Crypto Majors book',
      baseCurrency: 'USD',
      positions: [longPosition(), shortPosition()],
      summary: {
        grossExposure: dec('100871.65'),
        netExposure: dec('100586.35'),
        marketValue: dec('100871.65'),
        realizedPnl: dec('-12.40'),
        unrealizedPnl: dec('318.75'),
        totalPnl: dec('306.35'),
      },
      asOf: ts('2027-01-20T17:00:00Z'),
    };
  }

  it('accepts a valid portfolio snapshot with recorded summary metrics', () => {
    expect(isPortfolio(validPortfolio())).toBe(true);
  });

  it('accepts an empty portfolio with an empty summary (no computation here)', () => {
    const empty: Portfolio = { ...validPortfolio(), positions: [], summary: {} };
    expect(isPortfolio(empty)).toBe(true);
  });

  it('rejects malformed portfolios', () => {
    const invalid: unknown[] = [
      { ...validPortfolio(), projectId: '' },
      { ...validPortfolio(), name: '' },
      { ...validPortfolio(), baseCurrency: '' },
      { ...validPortfolio(), positions: 'none' },
      { ...validPortfolio(), positions: [longPosition(), longPosition()] }, // duplicate (instrument, venue) key
      { ...validPortfolio(), summary: { grossExposure: 100871.65 } }, // summary is decimal data
      { ...validPortfolio(), summary: { totalPnl: '1e5' } },
      { ...validPortfolio(), asOf: 'not-a-time' },
      { ...validPortfolio(), positions: [null] },
      null,
    ];
    for (const p of invalid) expect(isPortfolio(p)).toBe(false);
  });

  it('venue-scoped and aggregated positions are distinct keys (netting discipline)', () => {
    const scoped: Position = { ...longPosition(), venueId: binance };
    const aggregated: Position = { ...longPosition(), venueId: undefined };
    const portfolio: Portfolio = {
      ...validPortfolio(),
      positions: [scoped, aggregated], // same instrument, distinct keys -> valid
    };
    expect(isPortfolio(portfolio)).toBe(true);
  });
});

describe('isPortfolioSummaryMetrics', () => {
  it('accepts any subset of decimal metrics (recorded data, any sign)', () => {
    expect(isPortfolioSummaryMetrics({})).toBe(true);
    expect(isPortfolioSummaryMetrics({ netExposure: '-5000.25' })).toBe(true);
    expect(isPortfolioSummaryMetrics({ totalPnl: '0' })).toBe(true);
  });

  it('rejects non-decimal values', () => {
    expect(isPortfolioSummaryMetrics({ netExposure: 100 })).toBe(false);
    expect(isPortfolioSummaryMetrics({ netExposure: '1.2.3' })).toBe(false);
    expect(isPortfolioSummaryMetrics('summary')).toBe(false);
  });
});
