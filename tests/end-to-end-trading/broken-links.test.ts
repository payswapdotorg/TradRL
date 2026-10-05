/**
 * T048 — the BROKEN-LINK proofs: every pipeline stage consumes its
 * predecessor's REAL records, never a stub. Each seam is broken
 * deliberately (a mutated, fabricated or foreign record is fed where the
 * REAL predecessor's product belongs) and the downstream stage REFUSES
 * with its own typed error — proving the stage reads and validates the
 * record's content, not a stand-in. The flips are the positive paths the
 * slice suite pins (the same inputs, unmutated, flow).
 *
 * The seams (the station numbering of README.md):
 *   2 <- 1   the reactive world consumes the ADAPTER station's canonical
 *            envelopes (a forged quartet is refused at load).
 *   3 <- 1   the strategy compiler consumes the adapter window (a print the
 *            adapter did NOT make available at the decision instant, a
 *            fabricated non-adapter event, a state from another decision
 *            context).
 *   4 <- research   the director's research gate is proven by the
 *            `research_from_the_future` + quorum negatives
 *            (negative-paths.test.ts) — the L4 gate reads the report's
 *            own asOf; cross-referenced here, not duplicated.
 *   6 <- 3   the gateway consumes the strategy's REAL intent records (a
 *            mangled intent never passes stage 2; the decision identity
 *            is derived from the intent's CONTENT).
 *   5 <- 6   the execution body consumes the GATEWAY's approval — the
 *            director's decision (or any non-'xd:' ref) is never
 *            authority (L8).
 *   7 <- 3   the shadow session consumes the strategy's REAL intent
 *            records (a mangled record fails the whole run closed with
 *            ZERO world submissions).
 */

import { describe, expect, it } from 'vitest';

import {
  BTC,
  GATEWAY_INSTANTS,
  PROJECT,
  SEED,
  STRATEGY_DECISION_AT,
  TENANT,
  buildReactiveWorld,
  buildSliceGateway,
  buildSliceShadowSession,
  collectMarketData,
  compileSliceRun,
  decisionSourceOf,
  sliceConstraintSet,
  sliceGenesisPortfolio,
  sliceGoal,
  sliceRefusingConstraintSet,
  sliceSpec,
  sliceWindow,
} from '../../examples/end-to-end-trading/src/index';
import {
  compileStrategyRun,
  isObservationWindow,
  type MarketEventMirror,
  type ObservationWindow,
} from '../../packages/trading-strategy/src/index';
import { prepareOrder, EXECUTION_METHOD_REGISTRY } from '../../bodies/execution/src/index';
import { runShadowSession } from '../../services/shadow-trading/src/index';

describe('T048 the broken-link proofs — every stage consumes its predecessor\'s REAL records', () => {
  // --- SEAM 2 <- 1: the reactive world consumes the adapter's canonical envelopes ---

  it('the world refuses a FORGED availability quartet at load (available_time cannot precede event_time)', async () => {
    const events = collectMarketData().binanceEvents;
    let forgedCount = 0;
    const forged = events.map((event) => {
      if (event.event_type === 'trade' && event.instrument === BTC && event.available_time === event.event_time) {
        forgedCount += 1;
        return { ...event, available_time: (event.event_time as number) - 1 };
      }
      return event;
    });
    expect(forgedCount).toBeGreaterThan(0); // the proof is never vacuous
    await expect(buildReactiveWorld(forged as never)).rejects.toThrow(/available_time/);
  });

  // --- SEAM 3 <- 1: the strategy compiler consumes the adapter window ----------------

  it('the compiler refuses a window carrying a print the adapter did NOT make available at the decision instant (L4)', () => {
    const events = collectMarketData().binanceEvents;
    const window = sliceWindow(events);
    const broken: ObservationWindow = {
      ...window,
      events: window.events.map((event: MarketEventMirror, index: number) =>
        index === 0 ? { ...event, available_time: (STRATEGY_DECISION_AT + 1) as never } : event,
      ),
    } as never;
    expect(isObservationWindow(broken)).toBe(false); // the compiler's own guard refuses the seam record
    const compiled = compileStrategyRun({
      spec: sliceSpec(),
      state: sliceGenesisPortfolio(),
      window: broken,
      constraintSet: sliceConstraintSet(),
      goal: sliceGoal(),
      seed: SEED as never,
    });
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) expect(compiled.errors.map((error) => error.code)).toContain('invalid_state');
  });

  it('the compiler refuses a FABRICATED event that is not an adapter-shaped record', () => {
    const events = collectMarketData().binanceEvents;
    const window = sliceWindow(events);
    const fabrication = { event_id: 'fabricated-1', venue: 'BINANCE', instrument: BTC, price: '1' } as never;
    const broken: ObservationWindow = { ...window, events: [fabrication, ...window.events] } as never;
    expect(isObservationWindow(broken)).toBe(false);
    const compiled = compileStrategyRun({
      spec: sliceSpec(),
      state: sliceGenesisPortfolio(),
      window: broken,
      constraintSet: sliceConstraintSet(),
      goal: sliceGoal(),
      seed: SEED as never,
    });
    expect(compiled.ok).toBe(false);
  });

  it('the compiler refuses a portfolio state from ANOTHER decision context (lineage_gap, L9/L15)', () => {
    const events = collectMarketData().binanceEvents;
    // The satisfied-path state (constraint-set version 1) against the REVISED
    // constraint set (version 2): the state's lineage block disagrees with the
    // run's inputs — a state from another decision context is never a stub.
    const compiled = compileStrategyRun({
      spec: sliceSpec(),
      state: sliceGenesisPortfolio(),
      window: sliceWindow(events),
      constraintSet: sliceRefusingConstraintSet(),
      goal: sliceGoal(),
      seed: SEED as never,
    });
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.errors.map((error) => error.code)).toContain('lineage_gap');
      expect(compiled.errors.map((error) => error.message)).toEqual(
        expect.arrayContaining([expect.stringContaining('constraint-set lineage')]),
      );
    }
  });

  // --- SEAM 6 <- 3: the gateway consumes the strategy's REAL intent records ---------

  it('a MANGLED intent never passes the gateway (the typed intent_validation refusal, ZERO port calls)', () => {
    const run = compileSliceRun(collectMarketData().binanceEvents);
    const btc = run.intents.find((intent) => intent.order.instrumentId === BTC);
    if (btc === undefined) throw new Error('the BTC intent must exist');
    const mutations: readonly unknown[] = [
      { ...btc, order: null }, // the order block gone
      { ...btc, tenant: 42 }, // the tenant scope corrupted
      { ...btc, asOf: 'not-an-instant' }, // the decision instant corrupted
    ];
    for (const mangled of mutations) {
      const slice = buildSliceGateway();
      const outcome = slice.gateway.submitDecision(mangled);
      expect(outcome.ok).toBe(true); // a refusal is a RECORD, never an exception
      if (!outcome.ok) throw new Error('unreachable');
      expect(outcome.value.kind).toBe('refused');
      if (outcome.value.kind !== 'refused') throw new Error('unreachable');
      expect(outcome.value.refusal.stage).toBe('intent_validation');
      expect(slice.port.calls()).toHaveLength(0); // the no-bypass law
    }
  });

  it('the gateway derives its decision identity from the intent CONTENT: the same record twice is a duplicate, a mutated record is a NEW decision', () => {
    const run = compileSliceRun(collectMarketData().binanceEvents);
    const btc = run.intents.find((intent) => intent.order.instrumentId === BTC);
    if (btc === undefined) throw new Error('the BTC intent must exist');
    const slice = buildSliceGateway();
    const first = slice.gateway.submitDecision(btc);
    const replay = slice.gateway.submitDecision(btc);
    const mutated = slice.gateway.submitDecision({
      ...btc,
      intentId: 'si:e2e-broken-link-variant',
      order: { ...btc.order, clientOrderId: 'e2e-broken-link-variant' },
    });
    if (!first.ok || !replay.ok || !mutated.ok) throw new Error('every submission must produce a record');
    expect(first.value.kind).toBe('routed');
    expect(replay.value.kind).toBe('refused');
    if (replay.value.kind !== 'refused') throw new Error('unreachable');
    expect(replay.value.refusal.stage).toBe('duplicate_decision');
    expect(mutated.value.kind).toBe('routed'); // different content -> a DIFFERENT decision
    expect(slice.port.calls()).toHaveLength(2); // exactly one call per ROUTED order
  });

  // --- SEAM 5 <- 6: the execution body consumes the GATEWAY's approval (L8) ---------

  it('the DIRECTOR\'s decision is never execution authority: preparing against it is the typed decision_not_approved (L8)', () => {
    const run = compileSliceRun(collectMarketData().binanceEvents);
    const btc = run.intents.find((intent) => intent.order.instrumentId === BTC && intent.order.side === 'buy');
    if (btc === undefined) throw new Error('the BTC buy must exist');

    // The REAL preparation input — the same shape the order lane records,
    // with ONLY the authority ref swapped (the director's 'dd-' id, then garbage).
    const preparation = (decisionRef: string): Record<string, unknown> => ({
      decisionRef,
      decisionAsOf: STRATEGY_DECISION_AT,
      intentRef: btc.intentId,
      directorDecision: null,
      orderRef: btc.order.clientOrderId,
      venue: btc.order.venueId,
      instrument: btc.order.instrumentId,
      side: btc.order.side,
      orderKind: btc.order.kind,
      quantity: btc.order.quantity,
      orderClock: GATEWAY_INSTANTS[0],
      tenant: TENANT,
      project: PROJECT,
      methodId: 'method/execution/order-preparation',
      methodVersion: '1.0.0',
    });

    // The positive control first: the gateway's OWN 'xd:' approval prepares.
    const gateway = buildSliceGateway();
    const routed = gateway.gateway.submitDecision(btc);
    if (!routed.ok || routed.value.kind !== 'routed') throw new Error('the BTC buy must route');
    expect(prepareOrder(preparation(routed.value.decisionId), EXECUTION_METHOD_REGISTRY).ok).toBe(true);

    // The director's decision id ('dd'-prefixed) is NOT the gateway's approval.
    const directorAuthority = prepareOrder(preparation('dd-not-the-gateway-0001'), EXECUTION_METHOD_REGISTRY);
    expect(directorAuthority.ok).toBe(false);
    if (!directorAuthority.ok) {
      expect(directorAuthority.errors.map((error) => error.code)).toContain('decision_not_approved');
      expect(directorAuthority.errors.map((error) => error.message)).toEqual(
        expect.arrayContaining([expect.stringContaining('L8')]),
      );
    }

    // Any other non-'xd:' ref is refused the same way.
    const garbageAuthority = prepareOrder(preparation('not-a-decision-ref'), EXECUTION_METHOD_REGISTRY);
    expect(garbageAuthority.ok).toBe(false);
    if (!garbageAuthority.ok) {
      expect(garbageAuthority.errors.map((error) => error.code)).toContain('decision_not_approved');
    }
  });

  // --- SEAM 7 <- 3: the shadow session consumes the strategy's REAL intent records --

  it('a MANGLED decision in the source fails the WHOLE shadow run closed (invalid_type) with ZERO world submissions', async () => {
    const marketData = collectMarketData();
    const run = compileSliceRun(marketData.binanceEvents);
    const btc = run.intents.find((intent) => intent.order.instrumentId === BTC);
    if (btc === undefined) throw new Error('the BTC intent must exist');
    const mangled = { ...btc, intentId: 'si:e2e-mangled-decision', order: null };
    const { created } = await buildSliceShadowSession(decisionSourceOf([mangled]), marketData.binanceEvents);
    if (!created.ok) throw new Error('the session must create (the source is drained lazily)');
    const outcome = await runShadowSession(created.value);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errors.map((error) => error.code)).toEqual(['invalid_type']);
      expect(outcome.errors[0]?.message).toContain('T018 mirror guard');
    }
    expect(created.value.submissions).toHaveLength(0); // the world received NOTHING
  });
});
