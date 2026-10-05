/**
 * T048 — the reference slice's NEGATIVE PATHS: policy rejections, authority
 * denials, fail-closed lanes. Every refusal is a TYPED RECORD (or a typed
 * collect-all failure where the law is inexpressibility), never an exception,
 * never silent — and every outbound-lane refusal costs ZERO calls at the seam.
 */

import { describe, expect, it } from 'vitest';

import {
  BTC,
  T0,
  buildSliceGateway,
  collectMarketData,
  compileRefusingSliceRun,
  compileSliceRun,
  compileSliceStep2,
  composeSliceEscalation,
  futureResearchRefusal,
  liveModeClaimRefusal,
  refusalCauses,
  runCrossTenantRefusal,
  sliceGrant,
  submitThroughGateway,
} from '../../examples/end-to-end-trading/src/index';

/** Drive one gateway lane by hand: the routed/refused records + the port's call count. */
function drive(intent: unknown, options: Parameters<typeof buildSliceGateway>[0] = {}): { readonly kind: string; readonly stage: string | null; readonly portCalls: number } {
  const slice = buildSliceGateway(options);
  const outcome = slice.gateway.submitDecision(intent);
  if (!outcome.ok) {
    throw new Error(`the submission must produce a record: ${outcome.errors.map((error) => error.message).join('; ')}`);
  }
  const record = outcome.value;
  return {
    kind: record.kind,
    stage: record.kind === 'refused' ? record.refusal.stage : null,
    portCalls: slice.port.calls().length,
  };
}

describe('T048 the negative paths — refusals, denials, fail-closed', () => {
  // --- STATION 3: the strategy lane (constraint primacy) ------------------------

  it('refuses EVERY candidate under the revised constraint set — typed refusal records, never constrained-down intents', () => {
    const run = compileRefusingSliceRun(collectMarketData().binanceEvents);
    expect(run.intents).toHaveLength(0);
    expect(refusalCauses(run)).toEqual(['constraint_refused', 'constraint_refused']); // one per universe instrument
  });

  // --- STATION 4: the director lane ----------------------------------------------

  it('escalates when the research quorum is unmet (an escalation RECORD, not a degraded decision)', () => {
    const outcome = composeSliceEscalation();
    expect(outcome.kind).toBe('escalation');
    if (outcome.kind !== 'escalation') throw new Error('unreachable');
    expect(outcome.escalation.reason).toBe('quorum-unmet');
  });

  it('refuses research from the future (the L4 gate — the director never consumes future research)', () => {
    expect(futureResearchRefusal()).toEqual([{ code: 'research_from_the_future', path: 'sentiment.asOf' }]);
  });

  // --- STATION 6: the execution gateway (the chokepoint's denials) -----------------

  it('refuses the THROWN kill switch at the policy gate — fail-closed, ZERO port calls', () => {
    const intents = [...compileSliceRun(collectMarketData().binanceEvents).intents];
    const btc = intents.find((intent) => intent.order.instrumentId === BTC);
    if (btc === undefined) throw new Error('the BTC intent must exist');
    const outcome = drive(btc, { thrownKillSwitch: true });
    expect(outcome.kind).toBe('refused');
    expect(outcome.stage).toBe('policy_gate');
    expect(outcome.portCalls).toBe(0);
  });

  it('refuses the EXPIRED authority grant — Default-Deny at the authority stage, ZERO port calls', () => {
    const intents = [...compileSliceRun(collectMarketData().binanceEvents).intents];
    const btc = intents.find((intent) => intent.order.instrumentId === BTC);
    if (btc === undefined) throw new Error('the BTC intent must exist');
    const expired = sliceGrant({ issuedAt: T0 - 7_200_000, expiresAt: T0 - 3_600_000 });
    const outcome = drive(btc, { grant: expired });
    expect(outcome.kind).toBe('refused');
    expect(outcome.stage).toBe('authority_grant');
    expect(outcome.portCalls).toBe(0);
  });

  it('the full live lane: every negative submission is a typed refusal and the seam saw ONLY the routed calls', () => {
    const marketData = collectMarketData();
    const run = compileSliceRun(marketData.binanceEvents);
    const step2 = compileSliceStep2(marketData.binanceEvents);
    const lane = submitThroughGateway(run, step2);
    const refused = lane.submissions.filter((submission) => submission.kind === 'refused');
    expect(refused).toHaveLength(3); // duplicate + oversized + shadow-mode on the main gateway
    expect(lane.killSwitchRefusal.kind).toBe('refused');
    if (lane.killSwitchRefusal.kind !== 'refused') throw new Error('unreachable');
    expect(lane.killSwitchRefusal.refusal.stage).toBe('policy_gate');
    expect(lane.expiredGrantRefusal.kind).toBe('refused');
    if (lane.expiredGrantRefusal.kind !== 'refused') throw new Error('unreachable');
    expect(lane.expiredGrantRefusal.refusal.stage).toBe('authority_grant');
    // The no-bypass law: the port saw exactly the three routed orders — every refusal cost ZERO.
    expect(lane.port.calls()).toHaveLength(3);
  });

  it('refuses the OVERSIZED notional at the REAL T019 gate — ZERO port calls', () => {
    const intents = [...compileSliceRun(collectMarketData().binanceEvents).intents];
    const btc = intents.find((intent) => intent.order.instrumentId === BTC);
    if (btc === undefined) throw new Error('the BTC intent must exist');
    const oversized = { ...btc, intentId: 'si:e2e-oversized-negative', order: { ...btc.order, clientOrderId: 'e2e-oversized-negative', quantity: '30' } };
    const outcome = drive(oversized);
    expect(outcome.kind).toBe('refused');
    expect(outcome.stage).toBe('policy_gate');
    expect(outcome.portCalls).toBe(0);
  });

  it('refuses the SHADOW-MODE intent at the live gateway (mode separation) — ZERO port calls', () => {
    const intents = [...compileSliceRun(collectMarketData().binanceEvents).intents];
    const btc = intents.find((intent) => intent.order.instrumentId === BTC);
    if (btc === undefined) throw new Error('the BTC intent must exist');
    const outcome = drive({ ...btc, executionMode: 'shadow' });
    expect(outcome.kind).toBe('refused');
    expect(outcome.stage).toBe('shadow_mode');
    expect(outcome.portCalls).toBe(0);
  });

  it('refuses the DUPLICATE decision (the first stands, the second is a refusal) — no extra port call', () => {
    const intents = [...compileSliceRun(collectMarketData().binanceEvents).intents];
    const btc = intents.find((intent) => intent.order.instrumentId === BTC);
    if (btc === undefined) throw new Error('the BTC intent must exist');
    const slice = buildSliceGateway();
    const first = slice.gateway.submitDecision(btc);
    const second = slice.gateway.submitDecision(btc);
    if (!first.ok || !second.ok) throw new Error('both submissions must produce records');
    expect(first.value.kind).toBe('routed');
    expect(second.value.kind).toBe('refused');
    if (second.value.kind !== 'refused') throw new Error('unreachable');
    expect(second.value.refusal.stage).toBe('duplicate_decision');
    expect(slice.port.calls()).toHaveLength(1); // the routed one — the refusal added nothing
  });

  // --- STATION 7: the shadow lane (fail-closed) ------------------------------------

  it('fails the WHOLE cross-tenant run closed with the typed tenant_mismatch — the world received nothing', async () => {
    const marketData = collectMarketData();
    const run = compileSliceRun(marketData.binanceEvents);
    const refusal = await runCrossTenantRefusal(run, marketData.binanceEvents);
    expect(refusal.codes).toEqual(['tenant_mismatch']);
    expect(refusal.message).toContain('cross-tenant decisions are inexpressible (L12)');
    expect(refusal.worldSubmissions).toBe(0);
  });

  it('refuses a shadow session claiming LIVE fidelity (the mode-honesty law)', async () => {
    expect(await liveModeClaimRefusal(collectMarketData().binanceEvents)).toEqual(['fidelity_claim_dishonest']);
  });
});
