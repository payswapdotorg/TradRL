// @tradrl/web-console — THE MARKET-FACING SURFACE (FW-46, the S2
// market surface — S2's quote: "Market World is the persisted launch
// spec, not a market view"; "I keep paying for and living in TradingView
// for prices while TradRL holds the governance").
//
// The Market World section's market view + price-alerts cards (the
// E-6/FW-45 honest-MVP precedent):
//   - THE MARKET VIEW charts EXACTLY WHAT EXISTS ON RECORD (core/market's
//     pure folds, L4-projected) — a hand-built SVG (NO external chart
//     library; geometry coordinates are the only float, every RENDERED
//     number is the record's verbatim decimal string); a sparse series
//     stays sparse AND SAYS SO.
//   - THE LIVE SNAPSHOT is taught honestly (MARKET_LIVE_BOUNDARY,
//     VERBATIM at the point of use): no live feed exists here.
//   - THE PRICE-ALERTS CARD: the declared alerts' honest states (WAITING
//     vs FIRED — core/market alertFiringOf, ONLY against recorded
//     prices) + the declare form (the note-attach card's pattern).
//
// D-12: both cards render NOTHING on the launchpad. Pure: VNodes only.
// Spec anchors: L4, L9/L20, D-12, UX-DESIGN §7.
import type { PriceAlertRecord } from '../api/contracts';
import { alertFiringOf, fillPriceObservationsOf, priceSeriesOf, type PriceObservation } from '../core/market';
import { isExactDecimal } from '../core/decimals';
import { isLaunchpadScope } from '../core/tenant';
import { availabilityOfSubmission, projectToView } from '../core/availability';
import { readPendingAtView, type WorkspaceState } from '../core/workspace';
import { formatInstantUtc } from '../core/format';
import { labeledInput } from './flow';
import { v, type VNode } from './vtree';
import type { ShellView } from './shell';

/** THE LIVE-DATA BOUNDARY TEACHING — VERBATIM at the point of use (the seam-(a) law). */
export const MARKET_LIVE_BOUNDARY = 'SIMULATED market data: no live feed exists in this deployment — the market view charts exactly what this desk\'s own records hold (its fill prices at their own instants); external data sources are accepted as declarations only and are never fetched. "Live" is this console\'s own refreshed snapshot of the simulated records on file (Refresh re-reads).';

/** THE ALERTING BOUNDARY TEACHING — VERBATIM at the point of use (an alert fires only on recorded prices, never a live feed). */
export const PRICE_ALERT_BOUNDARY = 'SIMULATED alerting: an alert is a stored declaration (market, direction, level) — it fires ONLY on prices this desk\'s own records hold (its fill prices), evaluated as records arrive; no live feed exists in this deployment, so an alert never watches a live market.';

/** The chart's own viewBox (640x180; the plot area x in [12, 628], y in [14, 158]). */
const CHART_WIDTH = 640;
const CHART_HEIGHT = 180;
const CHART_PAD_X = 12;
const CHART_PAD_TOP = 14;
const CHART_PAD_BOTTOM = 22;

/** Format one geometry coordinate (a pixel position — the only float in the path; every RENDERED number stays a verbatim string). */
function coordinateOf(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** A price's numeric value for GEOMETRY ONLY (never rendered — the labels are the verbatim decimal strings). */
function numericValueOf(price: string): number {
  const parsed = Number(price);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** One market's chart card: the hand-built SVG of its own series + the honest sparse-series note. */
function marketChartCard(market: string, observations: readonly { readonly at: number; readonly price: string }[]): VNode {
  const count = observations.length;
  const minAt = observations[0]?.at ?? 0;
  const maxAt = observations[count - 1]?.at ?? 0;
  let minPrice = observations[0]?.price ?? '0';
  let maxPrice = observations[0]?.price ?? '0';
  for (const observation of observations) {
    if (numericValueOf(observation.price) < numericValueOf(minPrice)) minPrice = observation.price;
    if (numericValueOf(observation.price) > numericValueOf(maxPrice)) maxPrice = observation.price;
  }
  const spanAt = Math.max(maxAt - minAt, 1);
  const spanPrice = Math.max(numericValueOf(maxPrice) - numericValueOf(minPrice), 0);
  const plotWidth = CHART_WIDTH - 2 * CHART_PAD_X;
  const plotHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const points = observations.map((observation) => {
    const x = CHART_PAD_X + ((observation.at - minAt) / spanAt) * plotWidth;
    const y = CHART_PAD_TOP + (1 - (numericValueOf(observation.price) - numericValueOf(minPrice)) / (spanPrice === 0 ? 1 : spanPrice)) * plotHeight;
    return { x, y };
  });
  const children: VNode[] = [
    // THE SERIES LINE (only with 2+ observations — one point draws no line)
    ...(count >= 2 ? [v('polyline', {
      'data-market-series': market,
      points: points.map((point) => `${coordinateOf(point.x)},${coordinateOf(point.y)}`).join(' '),
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.5',
    }, [])] : []),
    // ONE MARKER PER OBSERVATION — never a smoothed-away datum
    ...points.map((point) => v('circle', { 'data-market-point': market, cx: coordinateOf(point.x), cy: coordinateOf(point.y), r: '3', fill: 'currentColor' }, [])),
    // The price bounds as text labels — the records' own verbatim decimal strings
    v('text', { x: String(CHART_PAD_X), y: '10', 'font-size': '10', fill: 'currentColor' }, [maxPrice]),
    v('text', { x: String(CHART_PAD_X), y: String(CHART_HEIGHT - 8), 'font-size': '10', fill: 'currentColor' }, [minPrice]),
  ];
  return v('div', { class: 'card market-view', 'data-market-chart': market }, [
    v('div', { class: 'card-title' }, [`Market view — ${market}`]),
    v('svg', { 'data-market-svg': market, viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`, role: 'img', 'aria-label': `the recorded fill prices of ${market}`, style: 'width:100%;height:auto;display:block' }, children),
    v('p', { class: 'card-note' }, [`${count} price observation${count === 1 ? '' : 's'} on record for ${market} — the desk's own fill prices at their own instants; the chart plots exactly what exists, never a fabricated series.`]),
  ]);
}

/** THE MARKET VIEW CARDS: one chart per market with observations + the boundary-taught live card (the declared world's no-observation markets named honestly). Empty on the launchpad (D-12). */
export function marketViewCards(state: WorkspaceState, viewAt: number): readonly VNode[] {
  if (isLaunchpadScope(state.scope.projectId)) return [];
  // L4: the series is the PROJECTED blotter's own fills — a past view charts only what was knowable then.
  const projected = projectToView(state.submissions, viewAt, availabilityOfSubmission);
  const series = priceSeriesOf(fillPriceObservationsOf(projected));
  const cards: VNode[] = series.map((market) => marketChartCard(market.market, market.observations));
  // N-1 (the read-lag class, M2's blotter shape): while the FILLS read is
  // in flight at the LIVE view, the no-prices lines teach the seek — never
  // a durable no-record claim over an unanswered read (the honest-copy
  // law; the repo's own FW-41-C vocabulary).
  const fillsPending = readPendingAtView(state, viewAt, 'submissions');
  // The declared world's markets with NO observations name themselves honestly; a world-less scope with no observations says the same of its whole view.
  const observed = new Set(series.map((market) => market.market));
  const emptyLines: VNode[] = fillsPending
    ? [v('p', { class: 'card-note', 'data-hydration-pending': 'true' }, ['Reading the world… — this desk\'s own fill prices appear here the moment the read lands.'])]
    : state.world === null
    ? (series.length === 0 ? [v('p', { class: 'card-note' }, ['No prices on record yet — this desk\'s own fill prices chart here as they exist on record.'])] : [])
    : state.world.markets.filter((market) => !observed.has(market)).map((market) => v('p', { class: 'card-note', 'data-market-empty': market }, [`No prices on record for ${market} yet — this desk's own fill prices chart here as they exist on record.`]));
  cards.push(v('div', { class: 'card market-view', 'data-market-view': 'live' }, [
    v('div', { class: 'card-title' }, ['Live market data (SIMULATED)']),
    v('p', { class: 'card-note' }, [MARKET_LIVE_BOUNDARY]),
    ...emptyLines,
  ]));
  return cards;
}

/** One alert row's own sentence: the declared envelope verbatim + its honest state (FIRED at the observed instant against the recorded price, or waiting). FW-47-B (the waiting-copy imprecision, carried since Round L): the waiting copy is TRUE in every waiting shape — a pre-declaration crossing stays waiting because no price recorded AT-OR-AFTER the alert's own declaration has crossed it (forward-only is the fold's own L4, core/market alertFiringOf), so the sentence teaches that law instead of the pre-fix false "no recorded price has crossed it yet" (false whenever an on-record price crossed the level before the declaration). N-1 (M2's pre-firing shape: the waiting copy rendered while the FIRED record stood): while the FILLS read is in flight at the LIVE view the row teaches the seek — never a verdict over an unanswered read (the honest-copy law). */
function alertRowOf(alert: PriceAlertRecord, observations: readonly PriceObservation[], fillsPending: boolean): VNode {
  const envelope = `${alert.market} ${alert.direction} ${alert.level}`;
  if (fillsPending) {
    return v('p', { class: 'card-note', 'data-alert-row': alert.alertId, 'data-hydration-pending': 'true' }, [`${envelope} — Reading the world… (the verdict appears here the moment the fills read lands; declared ${formatInstantUtc(alert.declaredAt)}).`]);
  }
  const firing = alertFiringOf(alert, observations);
  const sentence = firing.fired && firing.at !== null && firing.observedPrice !== null
    ? `${envelope} — FIRED at ${formatInstantUtc(firing.at)} against the recorded price ${firing.observedPrice} (declared ${formatInstantUtc(alert.declaredAt)}).`
    : `${envelope} — waiting (no price recorded at-or-after its declaration has crossed it yet — an alert watches forward from its own declaration, never the prices already on record; declared ${formatInstantUtc(alert.declaredAt)}).`;
  return v('p', { class: 'card-note', 'data-alert-row': alert.alertId }, [sentence]);
}

/** THE PRICE-ALERTS CARD: the declared alerts' honest states + the declare form (the note-attach card's pattern). Null on the launchpad (D-12). */
export function priceAlertsCard(state: WorkspaceState, view: ShellView, viewAt: number): VNode | null {
  if (isLaunchpadScope(state.scope.projectId)) return null;
  // L4: the list is the SCOPE'S OWN records projected at the view instant;
  // the firing fold rides the SAME projected observations the charts
  // render (one source of truth, never a future observation).
  const projectedAlerts = projectToView(state.alerts, viewAt, (alert) => alert.declaredAt);
  const projectedSubmissions = projectToView(state.submissions, viewAt, availabilityOfSubmission);
  const observations = fillPriceObservationsOf(projectedSubmissions);
  const marketsOnRecord = [...new Set([...observations.map((observation) => observation.market), ...state.world?.markets ?? []])];
  // O-1a (Round O register — the round's TOP residual, seven seats): the
  // alerts ride the GOAL-BUNDLE read (the goal-loaded event carries them
  // + readAnswers.goalBundle); while that read is in flight at the LIVE
  // view the state's empty alerts list is NOT an absence — the durable
  // empty claim renders only once the read has answered (the FW-50
  // honest-copy law, extended to the one surface its 13 missed).
  const bundlePending = readPendingAtView(state, viewAt, 'goalBundle');
  if (view.alertDeclare === null) {
    return v('div', { class: 'card price-alerts', 'data-price-alerts': 'closed' }, [
      v('div', { class: 'card-title' }, ['Price alerts']),
      v('p', { class: 'card-note' }, [PRICE_ALERT_BOUNDARY]),
      ...(projectedAlerts.length === 0
        ? [bundlePending
            ? v('p', { class: 'card-note', 'data-hydration-pending': 'true' }, ['Reading the world… — the declared alerts appear here the moment the read lands.'])
            : v('p', { class: 'card-note' }, ['No price alerts declared on this project on record yet — declare one below; it is stored on this project\'s own record and rides its export chain.'])]
        : projectedAlerts.map((alert) => alertRowOf(alert, observations, readPendingAtView(state, viewAt, 'submissions')))),
      v('div', { class: 'tm-playback' }, [
        v('button', { class: 'tm-button', 'data-action': 'alert-declare-open', type: 'button' }, ['Declare a price alert']),
      ]),
    ]);
  }
  const edits = view.alertDeclare.edits;
  const direction = typeof edits.direction === 'string' && edits.direction === 'below' ? 'below' : 'above';
  return v('div', { class: 'card price-alerts', 'data-price-alerts': 'open' }, [
    v('div', { class: 'card-title' }, ['Declare a price alert']),
    v('p', { class: 'card-note' }, [PRICE_ALERT_BOUNDARY]),
    ...labeledInput({
      label: 'Market', name: 'market', value: typeof edits.market === 'string' ? edits.market : '', required: true,
      hint: marketsOnRecord.length === 0 ? 'The instrument id the alert watches (e.g. BTC-USD — 1..64 characters).' : `The instrument id the alert watches (1..64 characters). The markets on record: ${marketsOnRecord.join(', ')}.`,
      vocabulary: 'alert',
    }),
    // THE DIRECTION SELECT — the closed vocabulary above|below; the model's value rides the ELEMENT too (the select identity law, render/dom.ts).
    v('div', { class: 'field', 'data-field': 'direction' }, [
      v('label', { class: 'field-label', for: 'alert-direction' }, ['Direction *']),
      v('select', { class: 'field-input field-select', id: 'alert-direction', name: 'direction', value: direction, 'data-alert-field': 'direction' }, [
        v('option', { value: 'above', ...(direction === 'above' ? { selected: 'selected' } : {}) }, ['above — fire when a recorded price is at or above the level']),
        v('option', { value: 'below', ...(direction === 'below' ? { selected: 'selected' } : {}) }, ['below — fire when a recorded price is at or below the level']),
      ]),
    ]),
    ...labeledInput({
      label: 'Level', name: 'level', value: typeof edits.level === 'string' ? edits.level : '', required: true,
      hint: 'The alert\'s price level — a positive exact decimal (e.g. 61000.50); stored verbatim, fetched from nowhere.',
      vocabulary: 'alert',
    }),
    ...(view.alertDeclare.error === null ? [] : [v('p', { class: 'field-error', role: 'alert', 'data-alert-error': view.alertDeclare.error }, [view.alertDeclare.error])]),
    v('div', { class: 'tm-playback' }, [
      v('button', { class: 'tm-button', 'data-action': 'alert-declare', type: 'button' }, ['Declare alert']),
      v('button', { class: 'tm-button', 'data-action': 'alert-declare-cancel', type: 'button' }, ['Cancel']),
    ]),
  ]);
}

/** The console-side typed validation of the declare form's buffered edits (the gate BEFORE any route call — fail-closed). */
export function alertFormErrorOf(market: string, direction: string, level: string): string | null {
  const trimmedMarket = market.trim();
  if (trimmedMarket.length === 0) return 'market: the market is required (the instrument id the alert watches, e.g. BTC-USD — 1..64 characters)';
  if (trimmedMarket.length > 64) return 'market: the market is at most 64 characters';
  if (direction !== 'above' && direction !== 'below') return 'direction: the direction must be above or below';
  if (level.length === 0 || !isExactDecimal(level) || level.startsWith('-') || level === '0') return 'level: the alert level must be a positive exact-decimal price (e.g. 61000.50) — this deployment stores it verbatim and fetches nothing';
  if (level.length > 32) return 'level: the alert level is at most 32 characters';
  return null;
}
