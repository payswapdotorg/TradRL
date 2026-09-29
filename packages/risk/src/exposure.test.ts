/**
 * @tradrl/risk — the ExposureComputation tests: exact decimals (no float
 * tolerance anywhere), determinism (byte-identical, twice), the
 * declared-inputs law (market-state gaps), the exact-decimal trip wire
 * and the measure semantics (position/cash folds, the high-water mark).
 */

import { describe, expect, it } from 'vitest';

import { computeExposure, isExposureRecord, canonicalExposureJson } from './exposure';
import { deriveMarketState } from './market-mirror';
import { isDeeplyFrozen } from './primitives';
import { SEED, T0, fixtureFill, fixtureMarketEvents, fixturePortfolio, unwrap } from './test-fixtures';

/** The golden market state (BTC 50000 / ETH 3000). */
function goldenMarket() {
  return unwrap(deriveMarketState(fixtureMarketEvents(), T0 as never, 8));
}

describe('computeExposure — the exact-decimal measures (the golden scenario)', () => {
  it('computes every measure exactly (no float tolerance — literal strings)', () => {
    const exposure = unwrap(
      computeExposure({ portfolio: fixturePortfolio(), marketState: goldenMarket(), fills: [fixtureFill()], priorPeakEquity: null, seed: SEED }),
    );
    // The order measure: the T019 gate-notional math (quantity x reference).
    expect(exposure.orders).toHaveLength(1);
    expect(exposure.orders[0]?.quantity).toBe('0.2');
    expect(exposure.orders[0]?.referencePrice).toBe('50000');
    expect(exposure.orders[0]?.notional).toBe('10000');
    expect(exposure.orders[0]?.fillRef).toBe('xsf-00000001');
    // The position measures (portfolio + fill effects).
    expect(exposure.positions).toHaveLength(2);
    const btc = exposure.positions.find((position) => position.instrument === 'BTC-USD');
    const eth = exposure.positions.find((position) => position.instrument === 'ETH-USD');
    expect(btc?.quantity).toBe('1');
    expect(btc?.notional).toBe('50000');
    expect(eth?.quantity).toBe('2');
    expect(eth?.notional).toBe('6000');
    // The aggregates.
    expect(exposure.grossNotional).toBe('56000');
    expect(exposure.netNotional).toBe('56000');
    expect(exposure.cash).toBe('89978');
    expect(exposure.equity).toBe('145978');
    expect(exposure.peakEquity).toBe('145978');
    expect(exposure.drawdown).toBe('0');
    expect(exposure.fillRefs).toEqual(['xsf-00000001']);
    expect(exposure.asOf).toBe(T0);
    expect(exposure.exposureId.startsWith('exp:')).toBe(true);
    expect(isExposureRecord(exposure)).toBe(true);
    expect(isDeeplyFrozen(exposure)).toBe(true);
  });

  it('threads the high-water mark: a falling equity grows the drawdown exactly', () => {
    // Prior peak above the current equity: drawdown = peak - equity.
    const exposure = unwrap(
      computeExposure({ portfolio: fixturePortfolio(), marketState: goldenMarket(), fills: [fixtureFill()], priorPeakEquity: '150000', seed: SEED }),
    );
    expect(exposure.equity).toBe('145978');
    expect(exposure.peakEquity).toBe('150000');
    expect(exposure.drawdown).toBe('4022');
  });

  it('a rising equity lifts the peak (the drawdown resets to 0)', () => {
    const exposure = unwrap(
      computeExposure({ portfolio: fixturePortfolio(), marketState: goldenMarket(), fills: [fixtureFill()], priorPeakEquity: '100000', seed: SEED }),
    );
    expect(exposure.peakEquity).toBe('145978');
    expect(exposure.drawdown).toBe('0');
  });

  it('a margin buy drives cash negative while equity stays exact (the signed extension)', () => {
    const exposure = unwrap(
      computeExposure({
        portfolio: fixturePortfolio({ cash: '100000', positions: [] }),
        marketState: goldenMarket(),
        fills: [fixtureFill({ quantity: '4', aggressor_price: '50000.00', taker_fee: '0' })],
        priorPeakEquity: null,
        seed: SEED,
      }),
    );
    // 4 BTC bought at 50000 with zero cash consumed: cash -100000, gross 200000.
    expect(exposure.cash).toBe('-100000');
    expect(exposure.grossNotional).toBe('200000');
    expect(exposure.equity).toBe('100000');
  });

  it('a sell beyond the holding folds to magnitude (the unsigned discipline — T019 mirrored)', () => {
    const exposure = unwrap(
      computeExposure({
        portfolio: fixturePortfolio({ positions: [{ instrumentId: 'BTC-USD', venueId: 'REFSIM', quantity: '0.8', costBasis: '40000', openedAt: T0 - 100_000 }] }),
        marketState: goldenMarket(),
        fills: [fixtureFill({ quantity: '1.1', aggressor_side: 'sell', aggressor_price: '50000.00', taker_fee: '0' })],
        priorPeakEquity: null,
        seed: SEED,
      }),
    );
    const btc = exposure.positions.find((position) => position.instrument === 'BTC-USD');
    expect(btc?.quantity).toBe('0.3'); // |0.8 - 1.1| — the magnitude fold
    expect(exposure.cash).toBe('155000'); // 100000 + 1.1 x 50000
  });
});

describe('computeExposure — determinism (the golden law)', () => {
  it('the same inputs produce the byte-identical record (deep-equal, twice)', () => {
    const run = () =>
      unwrap(computeExposure({ portfolio: fixturePortfolio(), marketState: goldenMarket(), fills: [fixtureFill()], priorPeakEquity: null, seed: SEED }));
    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(first.exposureId).toBe(second.exposureId);
    expect(canonicalExposureJson(first)).toBe(canonicalExposureJson(second));
  });

  it('different inputs produce different identities (the anchor is real)', () => {
    const base = unwrap(computeExposure({ portfolio: fixturePortfolio(), marketState: goldenMarket(), fills: [fixtureFill()], priorPeakEquity: null, seed: SEED }));
    const drifted = unwrap(computeExposure({ portfolio: fixturePortfolio(), marketState: goldenMarket(), fills: [fixtureFill({ quantity: '0.21' })], priorPeakEquity: null, seed: SEED }));
    expect(base.exposureId).not.toBe(drifted.exposureId);
  });
});

describe('computeExposure — the declared-inputs law (no network, no gaps)', () => {
  it('a fill whose instrument the market state does not cover fails with market_state_gap', () => {
    const result = computeExposure({
      portfolio: fixturePortfolio(),
      marketState: goldenMarket(),
      fills: [fixtureFill({ instrument: 'SOL-USD' })],
      priorPeakEquity: null,
      seed: SEED,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('market_state_gap');
      expect(result.errors[0]?.message).toContain('SOL-USD');
    }
  });

  it('a portfolio position the market state does not cover fails with market_state_gap', () => {
    const result = computeExposure({
      portfolio: fixturePortfolio({
        positions: [
          { instrumentId: 'BTC-USD', venueId: 'REFSIM', quantity: '0.8', costBasis: '40000', openedAt: T0 - 100_000 },
          { instrumentId: 'SOL-USD', venueId: 'REFSIM', quantity: '1', costBasis: '100', openedAt: T0 - 100_000 },
        ],
      }),
      marketState: goldenMarket(),
      fills: [],
      priorPeakEquity: null,
      seed: SEED,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('market_state_gap');
  });
});

describe('computeExposure — the exact-decimal trip wire', () => {
  it('a JS number in a money path fails with decimal_imprecision (never coerced)', () => {
    const crimes: readonly [string, unknown][] = [
      ['portfolio cash', { portfolio: fixturePortfolio({ cash: 100000 }) }],
      ['market reference price', { marketState: { ...goldenMarket(), instruments: [{ ...goldenMarket().instruments[0] as unknown as Record<string, unknown>, referencePrice: 50000 }] } }],
      ['fill price', { fills: [fixtureFill({ price: 50000 })] }],
      ['fill quantity', { fills: [fixtureFill({ quantity: 0.2 })] }],
      ['fill fee', { fills: [fixtureFill({ taker_fee: 20 })] }],
    ];
    for (const [name, overrides] of crimes) {
      const result = computeExposure({
        portfolio: (overrides as { portfolio?: unknown }).portfolio ?? fixturePortfolio(),
        marketState: (overrides as { marketState?: unknown }).marketState ?? goldenMarket(),
        fills: (overrides as { fills?: unknown }).fills ?? [fixtureFill()],
        priorPeakEquity: null,
        seed: SEED,
      } as never);
      expect(result.ok, name).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((error) => error.code === 'decimal_imprecision'), name).toBe(true);
      }
    }
  });

  it('a structurally invalid portfolio mirror is rejected (the T018 guard)', () => {
    const result = computeExposure({ portfolio: { nonsense: true }, marketState: goldenMarket(), fills: [], priorPeakEquity: null, seed: SEED });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_field');
  });

  it('a structurally invalid fill mirror is rejected (the T010 guard)', () => {
    const result = computeExposure({ portfolio: fixturePortfolio(), marketState: goldenMarket(), fills: [{ nonsense: true }], priorPeakEquity: null, seed: SEED });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_field');
  });
});

describe('deriveMarketState — the market fold (the pricing facts)', () => {
  it('derives reference prices from the last trade prints (input order irrelevant — the total order decides)', () => {
    const events = [...fixtureMarketEvents()].reverse();
    const state = unwrap(deriveMarketState(events, T0 as never, 8));
    const btc = state.instruments.find((entry) => entry.instrument === 'BTC-USD');
    const eth = state.instruments.find((entry) => entry.instrument === 'ETH-USD');
    expect(btc?.referencePrice).toBe('50000.00');
    expect(btc?.priceSource).toBe('last_trade');
    expect(eth?.referencePrice).toBe('3000.00');
  });

  it('falls back to the mid quote when no trade print exists (exact half-up division)', () => {
    const quote = {
      event_id: 'ev-q-1',
      venue: 'REFSIM',
      instrument: 'SOL-USD',
      asset_class: 'crypto',
      event_type: 'quote',
      event_time: T0 - 400,
      source_time: null,
      available_time: T0 - 400,
      ingestion_time: T0 - 400,
      sequence: 1,
      provider: 'refsim-feed',
      provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
      payload: { bid_price: '99.90', bid_size: '5', ask_price: '100.10', ask_size: '5' },
    };
    const state = unwrap(deriveMarketState([quote], T0 as never, 2));
    const sol = state.instruments.find((entry) => entry.instrument === 'SOL-USD');
    expect(sol?.referencePrice).toBe('100');
    expect(sol?.priceSource).toBe('mid_quote');
  });

  it('enforces the L4 boundary: an event not yet available at asOf fails', () => {
    const future = { ...fixtureMarketEvents()[0] as Record<string, unknown>, available_time: T0 + 1000 };
    const result = deriveMarketState([future], T0 as never, 8);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_state');
  });

  it('rejects a structurally invalid event (collect-all, located)', () => {
    const result = deriveMarketState([{ nonsense: true }], T0 as never, 8);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toBe('events[0]');
  });

  it('is deterministic: the same events yield the same content-addressed state', () => {
    const first = goldenMarket();
    const second = goldenMarket();
    expect(first.stateId).toBe(second.stateId);
  });
});
