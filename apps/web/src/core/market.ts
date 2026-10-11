// @tradrl/web-console — THE MARKET VIEW'S PURE FOLDS (FW-46, the S2
// market surface — S2's top friction: "zero charts, live data feeds, or
// price alerts anywhere in the console, so I keep paying for and living
// in TradingView for prices while TradRL holds the governance").
//
// THE LAW (the E-6/FW-45 precedent — build what the deployment can
// honestly carry, teach every boundary): the series is EXACTLY the
// desk's OWN FILL PRICES at their own instants, per instrument — never
// fabricated: only routed rows WITH fill economics contribute (no-fill
// routed and refusals are honest absences); the order price is a
// DECLARED price, never an observation; a malformed fill (non-decimal
// price, non-finite instant, empty market) is skipped honestly (R46);
// NO quote/candle series exists on record here — a sparse series stays
// sparse.
//
// L4: the CALLER projects the rows at the view instant (the same
// availabilityOfSubmission projection the Execution section rides).
// Pure: no DOM, no clock, never a throw.
//
// THE ALERT FIRING LAW: an alert fires ONLY on observations ON RECORD —
// the EARLIEST fill at-or-after its declaredAt whose price crosses the
// level by VALUE ('above': >=; 'below': <= — compareExactDecimals,
// never a float); no crossing observation stays WAITING, never a
// fabricated firing, never a live-feed claim (none exists).
//
// Spec anchors: L4, L9 (exact decimals, verbatim), L20, R46, UX-DESIGN §7.

import type { GatewaySubmissionRecord, PriceAlertRecord } from '../api/contracts';
import { compareExactDecimals, isExactDecimal } from './decimals';

/** One observed price on record: a fill's own price at its own instant, with the order's own market/side/quantity. */
export interface PriceObservation {
  /** The instrument the filled order named. */
  readonly market: string;
  /** The fill's OWN instant (filledAt, L4 by the record). */
  readonly at: number;
  /** The fill's own price, verbatim (an exact decimal string). */
  readonly price: string;
  /** The filled quantity, verbatim. */
  readonly quantity: string;
  /** The order's own side, verbatim. */
  readonly side: string;
}

/** The structural read of one submission's fill observation (null when the row carries none — R46). */
function fillObservationOf(submission: GatewaySubmissionRecord): PriceObservation | null {
  if (submission.kind !== 'routed') return null; // a refusal is a stopped decision, never an observation
  const order = submission.order;
  const fill = submission.fill;
  if (order === undefined || fill === undefined) return null; // routed without fill economics — the honest absence
  const market = order.instrumentId;
  if (typeof market !== 'string' || market.length === 0) return null;
  if (typeof fill.price !== 'string' || !isExactDecimal(fill.price)) return null; // a malformed price — skipped honestly
  if (typeof fill.filledAt !== 'number' || !Number.isFinite(fill.filledAt)) return null;
  const quantity = typeof fill.quantity === 'string' ? fill.quantity : '';
  const side = typeof order.side === 'string' ? order.side : '';
  return { market, at: fill.filledAt, price: fill.price, quantity, side };
}

/**
 * THE HONEST SERIES: every fill observation the (already-projected)
 * submissions carry, in fold order — the chart's ONLY data source.
 */
export function fillPriceObservationsOf(submissions: readonly GatewaySubmissionRecord[]): readonly PriceObservation[] {
  const observations: PriceObservation[] = [];
  for (const submission of submissions) {
    const observation = fillObservationOf(submission);
    if (observation !== null) observations.push(observation);
  }
  return Object.freeze(observations);
}

/** One market's own price series: the market id + its observations ordered by their own instant (ties keep fold order). */
export interface MarketPriceSeries {
  readonly market: string;
  readonly observations: readonly PriceObservation[];
}

/** The per-market grouping (first-appearance order, each market's observations by own instant). Pure over the observations. */
export function priceSeriesOf(observations: readonly PriceObservation[]): readonly MarketPriceSeries[] {
  // The erasable-subset law (the palette.ts precedent): constructor type
  // arguments (new Map<...>) are not in the published subset — the
  // annotation rides the declaration, the constructor infers.
  const byMarket: Map<string, PriceObservation[]> = new Map();
  for (const observation of observations) {
    const existing = byMarket.get(observation.market);
    if (existing === undefined) byMarket.set(observation.market, [observation]);
    else existing.push(observation);
  }
  const series: MarketPriceSeries[] = [];
  for (const [market, rows] of byMarket) {
    const ordered = [...rows].sort((a, b) => a.at - b.at); // Array.prototype.sort is stable — ties keep fold order
    series.push({ market, observations: Object.freeze(ordered) });
  }
  return Object.freeze(series);
}

/** One alert's firing state: WAITING, or fired AT THE OBSERVED INSTANT against the recorded price. */
export interface AlertFiring {
  readonly alertId: string;
  /** True exactly when a recorded observation crossed the level at-or-after the declaration. */
  readonly fired: boolean;
  /** The firing observation's OWN instant (null while waiting) — the record's own instant, never the reader's clock. */
  readonly at: number | null;
  /** The observed price that fired (verbatim; null while waiting). */
  readonly observedPrice: string | null;
}

/**
 * THE FIRING FOLD: evaluate ONE alert against the observations ON RECORD
 * — the earliest fill of the alert's OWN market, at-or-after its
 * declaredAt, whose price crosses the level BY VALUE. Pure, never a
 * throw (a malformed level or price keeps it waiting, R46).
 */
export function alertFiringOf(alert: PriceAlertRecord, observations: readonly PriceObservation[]): AlertFiring {
  const waiting: AlertFiring = { alertId: alert.alertId, fired: false, at: null, observedPrice: null };
  if (!isExactDecimal(alert.level)) return waiting; // a malformed stored level — stays waiting, never a crash (R46)
  let firing: AlertFiring = waiting;
  for (const observation of observations) {
    if (observation.market !== alert.market) continue;
    if (observation.at < alert.declaredAt) continue; // L4: watches from its own declaration forward
    if (!isExactDecimal(observation.price)) continue;
    const compared = compareExactDecimals(observation.price, alert.level);
    const crossed = alert.direction === 'above' ? compared >= 0 : compared <= 0;
    if (!crossed) continue;
    if (firing.at === null || observation.at < firing.at) {
      firing = { alertId: alert.alertId, fired: true, at: observation.at, observedPrice: observation.price };
    }
  }
  return firing;
}
