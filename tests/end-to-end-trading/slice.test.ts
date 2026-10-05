/**
 * T048 — the reference end-to-end trading slice: THE FULL LOOP.
 *
 * Drives the example's `runReferenceSlice()` end-to-end and pins every
 * station's evidence: the adapter events' honest quartets, the director
 * decision, both strategy runs' intents, the gateway's routed submissions +
 * chain-verified audit trail, the execution body's lifecycles, the shadow
 * lane's dispositions with physics lineage, and the realized-outcome summary.
 * No network, no wall clock — the whole loop is the fixture timeline; two
 * runs produce byte-identical digests (the determinism law).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  BTC,
  ETH,
  NEWS_VENUE,
  T0,
  TENANT,
  VENUE,
  collectMarketData,
  compileSliceRun,
  compileSliceStep2,
  runReferenceSlice,
  runShadowLane,
  sliceWindow,
  sliceWindow2,
  STRATEGY_DECISION_AT,
} from '../../examples/end-to-end-trading/src/index';
import { isStrategyIntentMirror } from '../../packages/execution-policy/src/index';
import { isObservationWindow, isStrategyRun } from '../../packages/trading-strategy/src/index';
import { isReactiveFillMirror, isReactiveWorldPort } from '../../services/shadow-trading/src/index';

describe('T048 the reference slice — the whole loop', () => {
  let report: Awaited<ReturnType<typeof runReferenceSlice>>;

  beforeAll(async () => {
    report = await runReferenceSlice();
  });

  it('runs the whole loop to a byte-stable report digest', () => {
    expect(report.reportDigest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic: two runs, one digest (the same day, the same evidence)', async () => {
    const second = await runReferenceSlice();
    expect(second.reportDigest).toBe(report.reportDigest);
    expect(second.outcomes.outcomeDigest).toBe(report.outcomes.outcomeDigest);
    expect(second.director.decisionId).toBe(report.director.decisionId);
    expect(second.strategy.runId).toBe(report.strategy.runId);
    expect(second.strategy.step2RunId).toBe(report.strategy.step2RunId);
  });

  // --- STATION 1: market data in (the REAL adapter sessions) -----------------

  it('emits the canonical crypto events from the REAL Binance sessions (the seeded BTC book + both BTC prints + the ETH print)', () => {
    expect(report.marketData.binanceEvents).toBe(4);
    expect(report.marketData.binanceEventTypes).toEqual(['book_snapshot', 'trade', 'trade', 'trade']);
  });

  it('emits the canonical news events from the REAL news session (the embargoed licensed item + the public headline)', () => {
    expect(report.marketData.newsEvents).toBe(2);
  });

  it('honors the news embargo: the canonical available_time is the LIFT instant, never the earlier receipt', () => {
    expect(report.marketData.embargoAvailableAt).toBe(T0 + 25_000);
  });

  it('sends exactly the five documented SUBSCRIBE frames (the pass-through neutrality contract)', () => {
    expect(report.marketData.framesSent).toBe(5);
    const channels = collectMarketData().sentFrames.map((frame) => frame.channel).sort();
    expect(channels).toEqual(['depth', 'licensedWire', 'publicHeadlines', 'trade', 'trade']);
  });

  it('emits every canonical event with an honest availability quartet and a named historical adapter', () => {
    const marketData = collectMarketData();
    for (const event of [...marketData.binanceEvents, ...marketData.newsEvents]) {
      expect(event.available_time).toBeGreaterThanOrEqual(event.event_time);
      expect(event.venue.length).toBeGreaterThan(0);
      expect(event.instrument.length).toBeGreaterThan(0);
      expect(event.provenance.origin).toBe('historical');
      expect(event.provenance.adapter?.id.length ?? '').toBeGreaterThan(0);
    }
    expect(marketData.newsEvents.every((event) => event.venue === NEWS_VENUE)).toBe(true);
  });

  // --- STATION 4: the trading director ----------------------------------------

  it('composes the director decision over the four-lane research intake (quorum met, every lane consumed)', () => {
    expect(report.director.decisionId).toMatch(/^dd-/);
    expect(report.director.directiveKind).toBe('allocation-adjustment');
    expect(report.director.lanesConsumed).toBe(4);
  });

  // --- STATION 3: the strategy runs (T018) -------------------------------------

  it('compiles the step-1 run over the adapter window: the equal-weight allocation of BOTH instruments', () => {
    expect(isStrategyRun(compileSliceRun(collectMarketData().binanceEvents))).toBe(true);
    expect(report.strategy.intents).toBe(2);
    expect(report.strategy.refusals).toBe(0);
    expect(report.strategy.instruments).toEqual([BTC, ETH]);
  });

  it('emits intents that ARE the T019 mirror records (the same record flows to the gateway and the shadow lane)', () => {
    const run = compileSliceRun(collectMarketData().binanceEvents);
    for (const intent of run.intents) {
      expect(isStrategyIntentMirror(intent)).toBe(true);
      expect(intent.tenant).toBe(TENANT);
      expect(intent.order.venueId).toBe(VENUE);
      expect(intent.asOf).toBe(STRATEGY_DECISION_AT);
      expect(intent.order.kind).toBe('limit');
    }
  });

  it('anchors the step-1 limits at the adapter prints (the last-trade price discipline)', () => {
    const run = compileSliceRun(collectMarketData().binanceEvents);
    const btc = run.intents.find((intent) => intent.order.instrumentId === BTC);
    const eth = run.intents.find((intent) => intent.order.instrumentId === ETH);
    expect(btc?.order.price).toBe('50100');
    expect(btc?.order.quantity).toBe('0.998');
    expect(eth?.order.price).toBe('3000');
    expect(eth?.order.quantity).toBe('16.66');
  });

  it('holds the L4 boundary between the two decisions: the rally print is step-2 observation, never step-1', () => {
    const binanceEvents = collectMarketData().binanceEvents;
    const window1 = sliceWindow(binanceEvents);
    const window2 = sliceWindow2(binanceEvents);
    expect(isObservationWindow(window1)).toBe(true); // the compiler's own guard: ordering + L4 + bounds
    expect(isObservationWindow(window2)).toBe(true);
    expect(window1.events).toHaveLength(2); // the BTC + ETH allocation prints only
    expect(window2.events).toHaveLength(3); // + the 62000 rally print (available at the step-2 anchor)
  });

  it('compiles the step-2 drift correction: the rallied BTC weight left the band, so the sell', () => {
    expect(report.strategy.step2Intents).toBe(1);
    expect(report.strategy.step2Sides).toEqual(['sell']);
    const step2 = compileSliceStep2(collectMarketData().binanceEvents);
    const sell = step2.intents[0];
    if (sell === undefined) throw new Error('the step-2 sell must exist');
    expect(sell.order.instrumentId).toBe(BTC);
    expect(sell.order.kind).toBe('limit');
    expect(sell.order.price).toBe('62000');
    expect(sell.rationale.kind).toBe('rebalance_drift');
  });

  // --- STATION 6: the live lane (the chokepoint) --------------------------------

  it('routes all three orders (the two allocation buys + the drift sell) through the 13-stage pipeline to the venue seam', () => {
    expect(report.gateway.routed).toBe(3);
    expect(report.gateway.portCalls).toBe(3); // exactly one call per ROUTED order — nothing else ever reaches the seam
  });

  it('refuses every negative submission as a typed record (five refusals, five stages)', () => {
    expect(report.gateway.refused).toBe(5);
    expect(report.gateway.refusalStages).toEqual([
      'duplicate_decision',
      'policy_gate',
      'shadow_mode',
      'policy_gate',
      'authority_grant',
    ]);
  });

  it('leaves the audit trail chain-verified and 1:1 with the submissions', () => {
    expect(report.gateway.auditCoherent).toBe(true);
    expect(report.gateway.auditRecords).toBe(6); // 3 routed + 3 refused on the main gateway — one record each
  });

  // --- STATION 5: the execution body (T025) -------------------------------------

  it("records every routed order's lifecycle: partial fill, acknowledged, expired", () => {
    expect(report.executionBody.btcBuyState).toBe('partially_filled'); // the adversary consumed the book: 0.9 of 0.998 filled, the remainder rests
    expect(report.executionBody.ethState).toBe('acknowledged'); // routed + acknowledged (no fill stream at the seam)
    expect(report.executionBody.btcSellState).toBe('expired'); // the resting limit never crossed; the world's 'expired' disposition backs the close-out
    expect(report.executionBody.gatewayRequests).toBe(3);
    expect(report.executionBody.reconciliationStatus).toBe('reconciled');
  });

  // --- STATION 7: the paper lane + the realized outcomes --------------------------

  it('paper-executes the decisions against the reactive world (the market fought back: the adversary crossed first)', () => {
    expect(report.shadow.dispositions).toEqual(['partial', 'expired']);
    expect(report.shadow.worldFillCount).toBe(4); // the adversary's three crossing fills + the slice's one
  });

  it('consumes the reactive world through the injected port; every fill carries its full physics lineage', async () => {
    const marketData = collectMarketData();
    const run = compileSliceRun(marketData.binanceEvents);
    const step2 = compileSliceStep2(marketData.binanceEvents);
    const lane = await runShadowLane(run, step2, marketData.binanceEvents);
    expect(isReactiveWorldPort(lane.worldStation.world)).toBe(true);
    expect(lane.session.fills).toHaveLength(1);
    for (const fill of lane.session.fills) {
      expect(isReactiveFillMirror(fill.worldFill)).toBe(true); // engine config hash + fee/latency/slippage/impact policy refs
    }
  });

  it('folds the realized outcomes: the exact-decimal paper book and the chain-verified outcome log', () => {
    expect(report.outcomes.outcomes).toBe(2);
    expect(report.outcomes.refusals).toBe(0);
    expect(report.outcomes.outcomeDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(report.outcomes.book.positions).toEqual([
      { instrument: BTC, quantity: '0.9', costBasis: '45090' }, // 0.9 x 50100 exactly
    ]);
    expect(report.outcomes.book.cash).toBe('54905.491'); // 100000 - 45090 - the 1bp taker fee (4.509) on 45090
    expect(report.outcomes.book.realizedPnl).toBe('0');
  });
});
