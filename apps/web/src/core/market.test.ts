// Tests for THE MARKET VIEW'S PURE FOLDS (core/market.ts — FW-46, the S2
// market-facing surface).
//
// Laws pinned here (the market.ts header):
//   1. THE CHART NEVER FABRICATES DATA — the price series is EXACTLY the
//      fill prices the blotter's rows carry (fill.price at its own
//      filledAt, per order.instrumentId); a routed row WITHOUT fill
//      economics contributes NOTHING; a refused row contributes NOTHING;
//      a malformed fill is skipped honestly (R46 — never a crash, never
//      a fabricated point). Order prices (the order form echo) are
//      DECLARED prices, never observations — they never enter the series.
//   2. THE ALERT FIRES ONLY ON OBSERVATIONS ON RECORD — an alert
//      (market + direction + level, declared at its own instant) fires
//      at the EARLIEST recorded fill price AT OR AFTER its declaredAt
//      that crosses the level ('above': price >= level; 'below':
//      price <= level) — exact-decimal comparison, never a float; an
//      alert with no crossing observation on record stays WAITING
//      (never a fabricated firing).
//   3. THE COMPARISON LAW — compareExactDecimals (core/decimals.ts, the
//      discipline's own home) compares two exact-decimal strings by
//      value with NO float anywhere; a malformed operand is the typed
//      error (the renderDecimal/sumExactDecimals law).
//
// Spec anchors: L4 (the caller projects the rows at the view instant —
// the fold itself takes the already-projected records, like the blotter
// totals), L9/L20 (exact decimals, verbatim records), R46 (every
// malformed row skipped honestly), UX-DESIGN §7 (anti-deception: a
// sparse series stays sparse and says so).

import { describe, expect, it } from 'vitest';
import type { GatewaySubmissionRecord, PriceAlertRecord } from '../api/contracts';
import { compareExactDecimals } from './decimals';
import { alertFiringOf, fillPriceObservationsOf, priceSeriesOf } from './market';

const T0 = 1_700_000_000_000;

/** One routed blotter row (the demo backing's own shape — the additive order leg + fill economics). */
function filledRow(overrides: {
  readonly submissionId: string;
  readonly instrument: string;
  readonly price: string;
  readonly filledAt: number;
  readonly routedAt?: number;
  readonly quantity?: string;
  readonly side?: 'buy' | 'sell';
  readonly fill?: Record<string, unknown> | null;
}): GatewaySubmissionRecord {
  return {
    kind: 'routed',
    submissionId: overrides.submissionId,
    decisionId: `xd:${overrides.submissionId}`,
    auditId: `xga:${overrides.submissionId}`,
    requestRef: `gor:${overrides.submissionId}`,
    venue: 'BROKER-FIX',
    adapterRef: 'adapter:demo-broker',
    channelRef: 'chan:demo-main',
    routedAt: overrides.routedAt ?? overrides.filledAt,
    order: {
      clientOrderId: `ord-${overrides.submissionId}`,
      instrumentId: overrides.instrument,
      venueId: 'BROKER-FIX',
      side: overrides.side ?? 'buy',
      kind: 'limit',
      quantity: overrides.quantity ?? '0.75',
      price: overrides.price,
      timeInForce: 'gtc',
      createdAt: new Date(overrides.routedAt ?? overrides.filledAt).toISOString(),
    },
    ...(overrides.fill === null ? {} : { fill: overrides.fill ?? { state: 'filled', quantity: overrides.quantity ?? '0.75', price: overrides.price, notional: '1', fee: '0.01', filledAt: overrides.filledAt } }),
  } as GatewaySubmissionRecord;
}

/** One declared price alert (the host route's minted record). */
function alert(overrides: Partial<PriceAlertRecord> = {}): PriceAlertRecord {
  return {
    alertId: 'alert:aaaa1111',
    tenant: 'tenant-a',
    project: 'proj-a',
    declaredAt: T0,
    market: 'BTC-USD',
    direction: 'above',
    level: '60000',
    ...overrides,
  };
}

describe('core/market — compareExactDecimals (the comparison law, core/decimals.ts)', () => {
  it('compares by value across scales — never a float, never a string compare', () => {
    expect(compareExactDecimals('61000.50', '61000.5')).toBe(0);   // equal by value, different scale
    expect(compareExactDecimals('60999.9', '61000')).toBe(-1);     // the fraction crosses the integer
    expect(compareExactDecimals('61001', '61000.99')).toBe(1);
    expect(compareExactDecimals('0', '0.000')).toBe(0);
    expect(compareExactDecimals('-1.5', '1.5')).toBe(-1);
    expect(compareExactDecimals('2', '10')).toBe(-1);              // value order, not lexicographic
  });

  it('a malformed operand is the typed error (the decimal discipline\'s own law — never a coerced compare)', () => {
    expect(() => compareExactDecimals('6.1e4', '61000')).toThrow();
    expect(() => compareExactDecimals('61000', '61,000')).toThrow();
    expect(() => compareExactDecimals('', '1')).toThrow();
  });
});

describe('core/market — fillPriceObservationsOf (the honest series: fills only, never fabricated)', () => {
  it('derives one observation per routed row WITH fill economics — the fill\'s own price at its own filledAt, the order\'s own market/side/quantity', () => {
    const rows = [
      filledRow({ submissionId: 'sub-1', instrument: 'BTC-USD', price: '61000.50', filledAt: T0 + 250, routedAt: T0 }),
      filledRow({ submissionId: 'sub-2', instrument: 'ETH-USD', price: '3412.10', filledAt: T0 + 60_250, routedAt: T0 + 60_000, side: 'sell', quantity: '6.0' }),
    ];
    const observations = fillPriceObservationsOf(rows);
    expect(observations).toHaveLength(2);
    expect(observations[0]).toEqual({ market: 'BTC-USD', at: T0 + 250, price: '61000.50', quantity: '0.75', side: 'buy' });
    expect(observations[1]).toEqual({ market: 'ETH-USD', at: T0 + 60_250, price: '3412.10', quantity: '6.0', side: 'sell' });
  });

  it('a routed row WITHOUT fill economics contributes NOTHING (routed-without-fill is an honest absence — never a fabricated price from the order leg)', () => {
    const rows = [
      filledRow({ submissionId: 'sub-live', instrument: 'BTC-USD', price: '61000.50', filledAt: T0 + 250, fill: null }), // the live gateway's own shape: no fill economics
      filledRow({ submissionId: 'sub-filled', instrument: 'BTC-USD', price: '60000', filledAt: T0 + 300 }),
    ];
    const observations = fillPriceObservationsOf(rows);
    expect(observations).toHaveLength(1); // only the row that carries a fill
    expect(observations[0]?.price).toBe('60000'); // the FILL's price, never the order's 61000.50
  });

  it('a refused row contributes NOTHING (a refusal is a stopped decision — never a price observation)', () => {
    const refused = {
      kind: 'refused',
      submissionId: 'sub-refused',
      decisionId: null,
      auditId: 'xga:refused',
      refusal: { stage: 'risk_limits' },
      refusedAt: T0 + 120,
      order: { clientOrderId: 'ord-3', instrumentId: 'BTC-USD', venueId: 'BROKER-FIX', side: 'buy', kind: 'limit', quantity: '0.9', price: '61000.50', timeInForce: 'gtc', createdAt: new Date(T0).toISOString() },
    } as GatewaySubmissionRecord;
    const observations = fillPriceObservationsOf([refused]);
    expect(observations).toHaveLength(0);
  });

  it('a malformed fill is skipped honestly (R46 — never a crash, never a half-record): a non-decimal price, a non-finite instant, an empty market', () => {
    const rows = [
      filledRow({ submissionId: 'sub-bad-price', instrument: 'BTC-USD', price: 'not-a-price', filledAt: T0 + 10 }),
      filledRow({ submissionId: 'sub-bad-at', instrument: 'BTC-USD', price: '61000.50', filledAt: Number.NaN }),
      filledRow({ submissionId: 'sub-good', instrument: 'BTC-USD', price: '61000.50', filledAt: T0 + 20 }),
    ];
    const observations = fillPriceObservationsOf(rows);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.at).toBe(T0 + 20);
  });
});

describe('core/market — priceSeriesOf (per market, first-appearance order, observations by their own instant)', () => {
  it('groups the observations per market, first-appearance order, each market\'s observations ordered by instant (ties keep fold order)', () => {
    const rows = [
      filledRow({ submissionId: 'sub-1', instrument: 'BTC-USD', price: '61000.50', filledAt: T0 + 250 }),
      filledRow({ submissionId: 'sub-2', instrument: 'ETH-USD', price: '3412.10', filledAt: T0 + 60_250 }),
      filledRow({ submissionId: 'sub-3', instrument: 'BTC-USD', price: '60500.25', filledAt: T0 + 500 }),
      filledRow({ submissionId: 'sub-4', instrument: 'BTC-USD', price: '60800.00', filledAt: T0 + 100 }), // earlier instant, later row — the series orders by instant
    ];
    const series = priceSeriesOf(rows);
    expect(series.map((market) => market.market)).toEqual(['BTC-USD', 'ETH-USD']); // first appearance
    expect(series[0]?.observations.map((observation) => observation.price)).toEqual(['60800.00', '61000.50', '60500.25']); // by instant
    expect(series[1]?.observations).toHaveLength(1);
  });

  it('an empty blotter derives NO series (never a fabricated market)', () => {
    expect(priceSeriesOf([])).toEqual([]);
  });
});

describe('core/market — alertFiringOf (the alert fires ONLY on observations on record)', () => {
  it('an above alert fires at the EARLIEST recorded price at-or-after its declaredAt that crosses the level — the firing carries the observation\'s own instant + verbatim price', () => {
    const rows = [
      filledRow({ submissionId: 'sub-1', instrument: 'BTC-USD', price: '61000.50', filledAt: T0 + 250 }),
      filledRow({ submissionId: 'sub-2', instrument: 'BTC-USD', price: '62000.00', filledAt: T0 + 500 }),
    ];
    const observations = fillPriceObservationsOf(rows);
    const firing = alertFiringOf(alert({ level: '61500', declaredAt: T0 }), observations);
    expect(firing).toEqual({ alertId: 'alert:aaaa1111', fired: true, at: T0 + 500, observedPrice: '62000.00' });
  });

  it('a fill BEFORE the declared instant never fires the alert (L4 — the alert watches from its own declaration forward)', () => {
    const rows = [
      filledRow({ submissionId: 'sub-early', instrument: 'BTC-USD', price: '61000.50', filledAt: T0 + 100 }),
      filledRow({ submissionId: 'sub-later', instrument: 'BTC-USD', price: '59000.00', filledAt: T0 + 900 }),
    ];
    const observations = fillPriceObservationsOf(rows);
    const firing = alertFiringOf(alert({ level: '60000', declaredAt: T0 + 200 }), observations);
    expect(firing.fired).toBe(false); // the early 61000.50 fill predates the declaration; the later 59000.00 does not cross above
    expect(firing.at).toBeNull();
    expect(firing.observedPrice).toBeNull();
  });

  it('a below alert fires on the first price at-or-below its level; the comparison is exact-decimal across scales (never a float)', () => {
    const rows = [
      filledRow({ submissionId: 'sub-1', instrument: 'ETH-USD', price: '3412.10', filledAt: T0 + 250 }),
      filledRow({ submissionId: 'sub-2', instrument: 'ETH-USD', price: '3199.95', filledAt: T0 + 60_250 }),
    ];
    const observations = fillPriceObservationsOf(rows);
    const firing = alertFiringOf(alert({ market: 'ETH-USD', direction: 'below', level: '3200', declaredAt: T0 + 100 }), observations);
    expect(firing.fired).toBe(true);
    expect(firing.at).toBe(T0 + 60_250);
    expect(firing.observedPrice).toBe('3199.95'); // 3199.95 < 3200 — by value, across scales
  });

  it('an alert on a market with NO observations stays WAITING (never a fabricated firing); an equal price fires (above: >=, below: <=)', () => {
    const rows = [filledRow({ submissionId: 'sub-1', instrument: 'ETH-USD', price: '3412.10', filledAt: T0 + 250 })];
    const observations = fillPriceObservationsOf(rows);
    expect(alertFiringOf(alert({ market: 'SOL-USD', level: '100' }), observations).fired).toBe(false); // no SOL-USD observation exists
    expect(alertFiringOf(alert({ market: 'ETH-USD', level: '3412.100', declaredAt: T0 }), observations).fired).toBe(true); // equal by value (3412.100 == 3412.10)
    expect(alertFiringOf(alert({ market: 'ETH-USD', direction: 'below', level: '3412.1', declaredAt: T0 }), observations).fired).toBe(true);
  });
});
