// Tests for THE MARKET-FACING SURFACE (render/market.ts + its composition
// into the Market World section — FW-46, the S2 market-facing surface).
//
// Laws pinned here:
//   1. THE CHART NEVER FABRICATES DATA — the market view charts EXACTLY
//      the fill prices the projected blotter carries, one chart per
//      market with observations, each point at the fill's own instant;
//      a market with no observations renders the honest no-prices line,
//      never a fabricated series; a sparse series says its own count.
//   2. THE BOUNDARY TEACHING IS VERBATIM at the point of use — the live
//      data card and the price-alerts card each carry their SIMULATED
//      teaching sentence exactly (the anti-deception law).
//   3. L4 — the series is PROJECTED at the view instant: a view before
//      the second fill renders only the first (never a future
//      observation rendered).
//   4. D-12 — the launchpad carries NO per-project surface: the market
//      view cards and the price-alerts card render nothing there.
//   5. THE ALERTS CARD — the declared alerts list with their honest
//      states (WAITING vs FIRED at the observed instant against the
//      recorded price), the declared envelope verbatim, and the open
//      form's three fields with the inline typed validation error.
//
// Spec anchors: L4, L9/L20, D-12, UX-DESIGN §7.

import { describe, expect, it } from 'vitest';
import { formatInstantUtc } from '../core/format';
import type { ConstraintSetStatement, GatewaySubmissionRecord, GoalStatement, PriceAlertRecord } from '../api/contracts';
import { openWorkspace, reduceAll } from '../core/workspace';
import { renderConsoleModel, serializeConsoleModel } from './model';
import { defaultShellView } from './shell';
import { serializeVNode } from './vtree';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;
/** The live view's anchor instant (every seeded record predates it). */
const LIVE_AT = T0 + 600;

/** The launchpad scope (D-12 — no per-project surface). */
const LAUNCHPAD_SCOPE = { tenantId: 'tenant-a', projectId: '(launchpad)' } as const;

function goalRecord(): GoalStatement {
  return {
    id: 'goal-1', version: 1, tenantId: 'tenant-a', objective: 'alpha over horizon',
    horizon: { startsAt: T0, endsAt: T0 + 86_400_000 },
    successCriteria: { criteria: [], requiredSatisfaction: 1 },
    evaluation: { blindRef: 'ev:blind', walkForwardRef: 'ev:wf', regimeRef: 'ev:regime', adversarialRequired: true },
    createdAt: T0,
  };
}

function constraintSetRecord(): ConstraintSetStatement {
  return { id: 'cs-1', version: 1, tenantId: 'tenant-a', constraints: [], createdAt: T0 };
}

/** One routed blotter row with fill economics (the chart's own data source). */
function filledRow(overrides: { readonly submissionId: string; readonly instrument: string; readonly price: string; readonly routedAt: number; readonly filledAt: number }): GatewaySubmissionRecord {
  return {
    kind: 'routed',
    submissionId: overrides.submissionId,
    decisionId: `xd:${overrides.submissionId}`,
    auditId: `xga:${overrides.submissionId}`,
    requestRef: `gor:${overrides.submissionId}`,
    venue: 'BROKER-FIX',
    adapterRef: 'adapter:demo-broker',
    channelRef: 'chan:demo-main',
    routedAt: overrides.routedAt,
    order: {
      clientOrderId: `ord-${overrides.submissionId}`, instrumentId: overrides.instrument, venueId: 'BROKER-FIX',
      side: 'buy', kind: 'limit', quantity: '0.75', price: overrides.price, timeInForce: 'gtc',
      createdAt: new Date(overrides.routedAt).toISOString(),
    },
    fill: { state: 'filled', quantity: '0.75', price: overrides.price, notional: '1', fee: '0.01', filledAt: overrides.filledAt },
  } as GatewaySubmissionRecord;
}

/** One declared price alert (the host route's minted record). */
function priceAlert(overrides: Partial<PriceAlertRecord> = {}): PriceAlertRecord {
  return {
    alertId: 'alert:aaaa1111', tenant: 'tenant-a', project: 'proj-a', declaredAt: T0 + 40,
    market: 'BTC-USD', direction: 'above', level: '61500',
    ...overrides,
  } as PriceAlertRecord;
}

/** The market-world section state: goal loaded + the blotter rows, at the LIVE view. */
function marketWorldState(rows: readonly GatewaySubmissionRecord[], alerts: readonly PriceAlertRecord[] = []): ReturnType<typeof openWorkspace> {
  return reduceAll(openWorkspace(SCOPE, T0), [
    { kind: 'goal-loaded', at: T0 + 5, goal: goalRecord(), constraintSet: constraintSetRecord(), ...(alerts.length === 0 ? {} : { alerts: [...alerts] }) },
    ...rows.map((submission) => ({ kind: 'submission-recorded' as const, at: T0 + 50, submission })),
    { kind: 'section-selected', at: LIVE_AT, section: 'market-world' as const },
    { kind: 'view-live', at: LIVE_AT },
  ]);
}

describe('render market: FW-46 — the market view (the chart of what exists on record)', () => {
  it('charts EXACTLY the fill prices on record — one chart per market with observations, the SVG points derived from the fills\' own instants, the sparse count stated', () => {
    const state = marketWorldState([
      filledRow({ submissionId: 'sub-1', instrument: 'BTC-USD', price: '61000.50', routedAt: T0 + 30, filledAt: T0 + 40 }),
      filledRow({ submissionId: 'sub-2', instrument: 'ETH-USD', price: '3412.10', routedAt: T0 + 60, filledAt: T0 + 70 }),
    ]);
    const bytes = serializeConsoleModel(state, LIVE_AT);
    expect(bytes).toContain('data-market-chart="BTC-USD"'); // one chart per market
    expect(bytes).toContain('data-market-chart="ETH-USD"');
    expect(bytes).toContain('Market view — BTC-USD');
    // THE HAND-BUILT SVG (no external chart library): the series element carries the observations' geometry
    expect(bytes).toContain('data-market-svg="BTC-USD"');
    expect(bytes).toMatch(/<svg[^>]*data-market-svg="BTC-USD"[^>]*viewBox="0 0 640 180"/);
    // the honest sparse-series notes: each chart states its own count
    expect(bytes).toContain('1 price observation on record for BTC-USD');
    expect(bytes).toContain('1 price observation on record for ETH-USD');
    expect(bytes).toContain('the chart plots exactly what exists, never a fabricated series');
  });

  it('a market with MULTIPLE observations charts the whole series (the polyline\'s own points), one circle per observation', () => {
    const state = marketWorldState([
      filledRow({ submissionId: 'sub-1', instrument: 'BTC-USD', price: '61000.50', routedAt: T0 + 30, filledAt: T0 + 40 }),
      filledRow({ submissionId: 'sub-2', instrument: 'BTC-USD', price: '60500.25', routedAt: T0 + 50, filledAt: T0 + 55 }),
    ]);
    const bytes = serializeConsoleModel(state, LIVE_AT);
    expect(bytes).toContain('2 price observations on record for BTC-USD');
    // the polyline's geometry is DETERMINISTIC over the records (the render determinism pin): plot area x in [12, 628], y in [14, 158]
    expect(bytes).toContain('data-market-series="BTC-USD"');
    const series = /data-market-series="BTC-USD"[^>]*points="([^"]*)"/.exec(bytes);
    if (series === null) throw new Error('the BTC-USD series polyline carries no points');
    expect(series[1]).toBe('12,14 628,158'); // x: first->last instant; y: max price -> min price (the SVG y axis grows down)
    const circles = bytes.match(/<circle[^>]*data-market-point="BTC-USD"/g) ?? [];
    expect(circles).toHaveLength(2); // one marker per observation — never a smoothed-away datum
  });

  it('a market with NO observations renders the honest no-prices line — never a fabricated series (the demo scope\'s declared world markets included)', () => {
    // O-1b: the no-prices line is the ANSWERED read's honest copy — the
    // state settles the bundle (connected + reads-settled) so the pin is
    // the terminal shape, not the first-frame seek the O-1b law now
    // teaches over an in-flight/queued read.
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'goal-loaded', at: T0 + 5, goal: goalRecord(), constraintSet: constraintSetRecord(), world: { markets: ['BTC-USD', 'SOL-USD'], venues: ['BROKER-FIX'], dataSources: [], executionMode: 'simulation', capitalBudget: '500000.00', riskBudget: '40000.00', horizon: { startsAt: T0, endsAt: T0 + 86_400_000 } } },
      { kind: 'reads-settled', at: T0 + 60 },
      { kind: 'section-selected', at: LIVE_AT, section: 'market-world' },
      { kind: 'view-live', at: LIVE_AT },
    ]);
    const bytes = serializeConsoleModel(state, LIVE_AT);
    expect(bytes).not.toContain('data-market-chart='); // no chart without observations
    expect(bytes).toContain('data-market-empty="SOL-USD"'); // the declared world's market with no fills names itself
    expect(bytes).toContain('No prices on record for SOL-USD yet');
    expect(bytes).toContain('data-market-view="live"'); // the live card still teaches the boundary
  });

  it('L4: a view instant BEFORE the second fill charts only the first (never a future observation rendered)', () => {
    const state = marketWorldState([
      filledRow({ submissionId: 'sub-1', instrument: 'BTC-USD', price: '61000.50', routedAt: T0 + 30, filledAt: T0 + 40 }),
      filledRow({ submissionId: 'sub-2', instrument: 'BTC-USD', price: '60500.25', routedAt: T0 + 50, filledAt: T0 + 55 }),
    ]);
    const early = reduceAll(state, [{ kind: 'view-timestamp', at: LIVE_AT, timestamp: T0 + 45 }]);
    const bytes = serializeConsoleModel(early, LIVE_AT);
    expect(bytes).toContain('1 price observation on record for BTC-USD'); // only the first fill was knowable then
    expect(bytes).not.toContain('2 price observations on record');
    // ...and the SAME state at a view after the second fill renders both (the projection is instant-derived, never sticky)
    const later = reduceAll(state, [{ kind: 'view-timestamp', at: LIVE_AT, timestamp: T0 + 100 }]);
    expect(serializeConsoleModel(later, LIVE_AT)).toContain('2 price observations on record for BTC-USD');
  });

  it('the live-data card carries the boundary teaching VERBATIM (no live feed exists — external data is a declaration only; "live" is the console\'s own refreshed snapshot)', () => {
    const state = marketWorldState([filledRow({ submissionId: 'sub-1', instrument: 'BTC-USD', price: '61000.50', routedAt: T0 + 30, filledAt: T0 + 40 })]);
    const bytes = serializeConsoleModel(state, LIVE_AT);
    expect(bytes).toContain('SIMULATED market data: no live feed exists in this deployment');
    expect(bytes).toContain('the market view charts exactly what this desk\'s own records hold (its fill prices at their own instants)');
    expect(bytes).toContain('external data sources are accepted as declarations only and are never fetched');
  });

  it('D-12: the launchpad carries NO market-view surface (the teaching empty state only — never a per-project chart on the launchpad)', () => {
    const state = reduceAll(openWorkspace(LAUNCHPAD_SCOPE, T0), [
      { kind: 'section-selected', at: LIVE_AT, section: 'market-world' },
      { kind: 'view-live', at: LIVE_AT },
    ]);
    const bytes = serializeConsoleModel(state, LIVE_AT);
    expect(bytes).not.toContain('data-market-view=');   // no live card
    expect(bytes).not.toContain('data-market-chart=');  // no chart
    expect(bytes).not.toContain('data-price-alerts=');  // no alerts card
    expect(bytes).toContain('No launch context yet — the market world is specified at launch.'); // the teaching empty state stays
  });
});

describe('render market: FW-46 — the price-alerts card (the record class\'s surface)', () => {
  it('closed: the boundary teaching VERBATIM + the declared alerts with their honest states — a crossing alert renders FIRED at its observed instant against the recorded price; a waiting alert stays waiting', () => {
    const state = marketWorldState(
      [filledRow({ submissionId: 'sub-1', instrument: 'BTC-USD', price: '62000.00', routedAt: T0 + 50, filledAt: T0 + 60 })],
      [
        priceAlert({ alertId: 'alert:aaaa1111', market: 'BTC-USD', direction: 'above', level: '61500', declaredAt: T0 + 40 }),
        priceAlert({ alertId: 'alert:bbbb2222', market: 'BTC-USD', direction: 'below', level: '50000', declaredAt: T0 + 41 }),
      ],
    );
    const bytes = serializeConsoleModel(state, LIVE_AT);
    expect(bytes).toContain('data-price-alerts="closed"');
    expect(bytes).toContain('SIMULATED alerting: an alert is a stored declaration (market, direction, level)');
    expect(bytes).toContain('it fires ONLY on prices this desk\'s own records hold (its fill prices)');
    // the FIRED row: the observed instant + the recorded price, verbatim
    expect(bytes).toContain('data-alert-row="alert:aaaa1111"');
    expect(bytes).toContain('BTC-USD above 61500 — FIRED');
    expect(bytes).toContain('against the recorded price 62000.00');
    // the WAITING row: never a fabricated firing. FW-47-B (the minors): the
    // waiting copy re-pinned to the honest sentence — a copy correction the
    // register itself demands (the pre-fix copy was FALSE whenever an
    // on-record price crossed the level before the declaration); the new
    // pin below additionally asserts the old false copy NEVER renders.
    expect(bytes).toContain('data-alert-row="alert:bbbb2222"');
    expect(bytes).toContain('BTC-USD below 50000 — waiting');
    expect(bytes).toContain('no price recorded at-or-after its declaration has crossed it yet — an alert watches forward from its own declaration, never the prices already on record');
    expect(bytes).not.toContain('no recorded price has crossed it yet');
    // ONE primary action (the D-12 card pattern)
    expect(bytes).toContain('data-action="alert-declare-open"');
    expect(bytes).toContain('Declare a price alert');
  });

  it('L4: an alert declared at an instant renders only at views at-or-after it (a future declaration never renders early)', () => {
    const state = marketWorldState(
      [],
      [priceAlert({ alertId: 'alert:aaaa1111', declaredAt: T0 + 300 })],
    );
    const early = reduceAll(state, [{ kind: 'view-timestamp', at: LIVE_AT, timestamp: T0 + 100 }]);
    expect(serializeConsoleModel(early, LIVE_AT)).not.toContain('data-alert-row="alert:aaaa1111"');
    const later = reduceAll(state, [{ kind: 'view-timestamp', at: LIVE_AT, timestamp: T0 + 400 }]);
    expect(serializeConsoleModel(later, LIVE_AT)).toContain('data-alert-row="alert:aaaa1111"');
  });

  it('open: the three-field form (market, direction, level) rides the beat-safe data-alert-field vocabulary, with the typed validation error INLINE and exactly two actions', () => {
    const state = marketWorldState([filledRow({ submissionId: 'sub-1', instrument: 'BTC-USD', price: '61000.50', routedAt: T0 + 30, filledAt: T0 + 40 })]);
    const open = { ...defaultShellView(state), alertDeclare: { edits: {}, error: null } as never };
    let bytes = serializeVNode(renderConsoleModel(state, LIVE_AT, open));
    expect(bytes).toContain('data-price-alerts="open"');
    expect(bytes).toContain('data-alert-field="market"'); // the market field — the alert form's own beat-safe vocabulary
    expect(bytes).toContain('data-alert-field="direction"'); // the direction select (above | below — the closed vocabulary)
    expect(bytes).toContain('data-alert-field="level"'); // the level field (an exact decimal price)
    expect(bytes).toContain('data-action="alert-declare"');
    expect(bytes).toContain('data-action="alert-declare-cancel"');
    expect(bytes).toContain('above');
    expect(bytes).toContain('below');
    // the typed validation error renders inline, and the user's buffered edits stay (the honest failure surface)
    const errored = { ...defaultShellView(state), alertDeclare: { edits: { market: 'BTC-USD', direction: 'above', level: 'not-a-price' }, error: 'level: the alert level must be a positive exact-decimal price (e.g. 61000.50) — this deployment stores it verbatim and fetches nothing' } as never };
    bytes = serializeVNode(renderConsoleModel(state, LIVE_AT, errored));
    expect(bytes).toContain('data-price-alerts="open"');
    expect(bytes).toContain('the alert level must be a positive exact-decimal price');
    expect(bytes).toContain('value="not-a-price"'); // the buffered edit survives the error render
    expect(bytes).toContain('value="BTC-USD"');
  });
});

// ---------------------------------------------------------------------------
// FW-47-B (the minors — the waiting-copy imprecision, carried since Round
// L, re-confirmed by L2-cont/L3): THE LAW untouched (forward-only is the
// fold's own L4 — core/market alertFiringOf watches from the alert's own
// declaration forward), THE COPY made true in every waiting shape. A
// PRE-declaration fill that crosses the declared level never fires, and
// the waiting sentence must say WHY it stays waiting: no price recorded
// AT-OR-AFTER its declaration has crossed it — never the pre-fix false
// "no recorded price has crossed it yet" (a recorded price HAS crossed
// it; it just predates the declaration).
// ---------------------------------------------------------------------------

describe('render market: FW-47-B — the honest waiting copy (true in every waiting shape)', () => {
  it('a PRE-declaration fill @62000 crossing a "BTC-USD above 61000" declared AFTER it stays waiting (forward-only, the fold\'s own L4) — and the waiting copy teaches the law truly: no price recorded AT-OR-AFTER its declaration has crossed it, never the pre-fix false "no recorded price has crossed it yet"', () => {
    // L2-cont's shape: the fill at 62000.00 (filledAt T0+40) is ON RECORD and
    // crosses the level — but the alert was declared at T0+50, AFTER it, so the
    // fold never fires (an alert watches forward from its own declaration).
    const state = marketWorldState(
      [filledRow({ submissionId: 'sub-pre', instrument: 'BTC-USD', price: '62000.00', routedAt: T0 + 30, filledAt: T0 + 40 })],
      [priceAlert({ alertId: 'alert:late-1', market: 'BTC-USD', direction: 'above', level: '61000', declaredAt: T0 + 50 })],
    );
    const bytes = serializeConsoleModel(state, LIVE_AT);
    expect(bytes).toContain('data-alert-row="alert:late-1"');
    const row = bytes.slice(bytes.indexOf('data-alert-row="alert:late-1"'), bytes.indexOf('data-alert-row="alert:late-1"') + 400);
    expect(row).toContain('BTC-USD above 61000 — waiting'); // stays waiting — the forward-only law untouched
    expect(row).not.toContain('FIRED');                     // a pre-declaration crossing NEVER fires
    // THE HONEST COPY (true in this shape: the 62000.00 crossing predates the declaration)
    expect(row).toContain('no price recorded at-or-after its declaration has crossed it yet — an alert watches forward from its own declaration, never the prices already on record; declared');
    // THE OLD FALSE COPY never renders (a recorded price HAS crossed the level — it just predates the declaration)
    expect(row).not.toContain('no recorded price has crossed it yet');
    expect(row).toContain(formatInstantUtc(T0 + 50)); // the declaration's own instant, named
  });
});

// ---------------------------------------------------------------------------
// N-1 (Round N register — the read-lag class, the market-facing surfaces):
// M2's evidence — "the alert first rendering 'waiting' after its own FIRED
// record exists ~10s" and "'No execution submissions at this view instant'
// ~3 min while the fills HAD booked". The firing verdict and the chart's
// no-prices line both fold over the FILLS read; while that read is IN
// FLIGHT at the LIVE view they teach "Reading the world…", never a
// durable verdict/no-record claim. THE LAW: the pre-read state is a
// LOADING state (the honest-copy law, the FW-41-C precedent) — the
// waiting verdict and the no-prices line render ONLY when the fills read
// has answered.
// ---------------------------------------------------------------------------

describe('render market: N-1 — the read-lag class on the market-facing surfaces', () => {
  /** The mid-read state: the goal bundle answered (alerts on record), the fills read still in flight, the LIVE view. */
  function fillsReadInFlight(alerts: readonly PriceAlertRecord[]): ReturnType<typeof openWorkspace> {
    return reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'goal-loaded', at: T0 + 5, goal: goalRecord(), constraintSet: constraintSetRecord(), alerts: [...alerts] },
      { kind: 'section-selected', at: LIVE_AT, section: 'market-world' as const },
      { kind: 'view-live', at: LIVE_AT },
    ]);
  }

  it('an alert row over an IN-FLIGHT fills read teaches "Reading the world…" — never a waiting verdict (M2: the waiting copy rendered while the FIRED record stood)', () => {
    const state = fillsReadInFlight([priceAlert({ alertId: 'alert:lag-1', market: 'BTC-USD', direction: 'above', level: '61000', declaredAt: T0 + 40 })]);
    const bytes = serializeConsoleModel(state, LIVE_AT);
    expect(bytes).toContain('data-alert-row="alert:lag-1"');
    const row = bytes.slice(bytes.indexOf('data-alert-row="alert:lag-1"'), bytes.indexOf('data-alert-row="alert:lag-1"') + 420);
    expect(row).toContain('data-hydration-pending="true"'); // the marker
    expect(row).toContain('Reading the world…');       // the loading vocabulary
    expect(row).not.toContain('waiting');              // RED pre-fix: a verdict over an unanswered read
  });

  it('the same alert, fills read ANSWERED (empty blotter), renders the honest waiting copy (the FW-47-B law, unchanged) — and the reads-settled marker alone resolves the row (an empty blotter is the read\'s answer)', () => {
    const answered = reduceAll(fillsReadInFlight([priceAlert({ alertId: 'alert:lag-2', market: 'BTC-USD', direction: 'above', level: '61000', declaredAt: T0 + 40 })]), [
      { kind: 'reads-settled', at: T0 + 100 },
    ]);
    const bytes = serializeConsoleModel(answered, LIVE_AT);
    expect(bytes).toContain('data-alert-row="alert:lag-2"');
    const row = bytes.slice(bytes.indexOf('data-alert-row="alert:lag-2"'), bytes.indexOf('data-alert-row="alert:lag-2"') + 420);
    expect(row).toContain('BTC-USD above 61000 — waiting'); // the true waiting copy — the fold's own L4 verdict over the answered read
    expect(row).not.toContain('data-hydration-pending');
  });

  it('the chart\'s no-prices line over an IN-FLIGHT fills read teaches "Reading the world…" — never "No prices on record yet" as a durable claim', () => {
    const state = fillsReadInFlight([]);
    const bytes = serializeConsoleModel(state, LIVE_AT);
    expect(bytes).toContain('data-hydration-pending="true"');
    expect(bytes).not.toContain('No prices on record yet'); // RED pre-fix: the durable claim over the in-flight fills read
    const settled = reduceAll(fillsReadInFlight([]), [{ kind: 'reads-settled', at: T0 + 100 }]);
    expect(serializeConsoleModel(settled, LIVE_AT)).toContain('No prices on record yet'); // the read answered — the honest empty
  });
});

// ---------------------------------------------------------------------------
// O-1a (Round O register — the read-lag residual class, the round's TOP
// residual; seven seats: S1 ~1.5s, S2 ~3s, L1 >=6.5s 12/12 frames, L2
// >=6.1s 13 consecutive frames, M2 twice ~4.5-5.5s and ~15s, S3 >=5.0s,
// L3 twice): the Market World ALERT-CARD empty-state flash — the one
// surface FW-50's 13 missed. After a reload (or a cold reload + fast
// switch), with alerts — even a FIRED verdict — on record, the card
// renders "No price alerts declared on this project on record yet" for
// the whole in-flight read before settling to the exact verdicts. The
// alerts ride the GOAL-BUNDLE read (the goal-loaded event carries them
// + readAnswers.goalBundle); the empty branch never consulted it. THE
// LAW: the same FW-50 honest-copy law, extended to this surface — the
// loading vocabulary while the goal-bundle read is in flight at the
// LIVE view; the durable empty claim renders ONLY when the read has
// answered.
// ---------------------------------------------------------------------------

describe('render market: O-1a — the alert-card empty-state flash (the goal-bundle read gates the empty branch)', () => {
  /** The reload/switch shape: connected, LIVE view, NO goal bundle yet — the state holds zero alerts while the server's records carry them, a FIRED verdict among them (the in-flight goal-bundle read; the state is blind to the server's records until the read lands). */
  function bundleReadInFlight(): ReturnType<typeof openWorkspace> {
    return reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'section-selected', at: LIVE_AT, section: 'market-world' as const },
      { kind: 'view-live', at: LIVE_AT },
    ]);
  }

  it('with alerts on record and the goal-bundle read IN FLIGHT, the card renders the loading vocabulary — never "No price alerts declared on this project on record yet" (the seven-seat flash)', () => {
    const state = bundleReadInFlight();
    const bytes = serializeConsoleModel(state, LIVE_AT);
    expect(bytes).toContain('data-price-alerts="closed"');
    expect(bytes).toContain('data-hydration-pending="true"'); // the marker
    expect(bytes).toContain('Reading the world… — the declared alerts appear here the moment the read lands'); // RED pre-fix: the empty branch never consulted the bundle's read
    expect(bytes).not.toContain('No price alerts declared on this project on record yet'); // the seven-seat flash, dead
  });

  it('the settle the seats observed: once the bundle lands the alerts (a FIRED verdict among them), the card settles to the exact verdict — the flash was never a datum loss', () => {
    const settled = reduceAll(bundleReadInFlight(), [
      { kind: 'goal-loaded', at: T0 + 60, goal: goalRecord(), constraintSet: constraintSetRecord(), alerts: [priceAlert({ alertId: 'alert:flash-1', market: 'BTC-USD', direction: 'above', level: '61500', declaredAt: T0 + 40 })] },
      { kind: 'submission-recorded', at: T0 + 70, submission: filledRow({ submissionId: 'sub-flash', instrument: 'BTC-USD', price: '62000.00', routedAt: T0 + 50, filledAt: T0 + 60 }) },
    ]);
    const bytes = serializeConsoleModel(settled, LIVE_AT);
    expect(bytes).toContain('data-alert-row="alert:flash-1"');
    expect(bytes).toContain('BTC-USD above 61500 — FIRED');
    expect(bytes).not.toContain('No price alerts declared on this project on record yet');
    expect(bytes).not.toContain('data-hydration-pending="true"');
  });

  it('the read ANSWERED with no alerts on record renders the honest empty claim — the terminal copy returns (the teaching copy is legal only over an answered read)', () => {
    const answered = reduceAll(bundleReadInFlight(), [
      { kind: 'goal-loaded', at: T0 + 60, goal: goalRecord(), constraintSet: constraintSetRecord() }, // no alerts field — none on record
      { kind: 'reads-settled', at: T0 + 100 },
    ]);
    const bytes = serializeConsoleModel(answered, LIVE_AT);
    expect(bytes).toContain('No price alerts declared on this project on record yet'); // the honest terminal
    expect(bytes).not.toContain('data-hydration-pending="true"');
  });

  it('the boundary law (the FW-41-C precedent): a SCRUBBED PAST view over an in-flight bundle keeps the honest durable copy — the pending state is about NOW, never a claim about the past', () => {
    const state = bundleReadInFlight();
    const scrubbed = reduceAll(state, [{ kind: 'view-timestamp', at: LIVE_AT, timestamp: T0 + 40 }]);
    const bytes = serializeConsoleModel(scrubbed, LIVE_AT);
    expect(bytes).not.toContain('data-hydration-pending="true"');
    expect(bytes).toContain('No price alerts declared on this project on record yet'); // the past view's honest empty state — unchanged
  });
});
