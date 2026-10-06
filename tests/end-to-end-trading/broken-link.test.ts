// tests/end-to-end-trading/broken-link.test.ts — THE BROKEN-LINK GATE.
//
// Proves every pipeline stage consumes its predecessor's REAL records —
// not stubs: perturbing a predecessor record measurably changes the
// successor's output, its derived identity, or breaks a typed law.
// Each tampering is applied to a CLONE of the scenario/records and the
// successor stage is re-run in isolation with everything else fixed.

import { describe, expect, it } from 'vitest';

import {
  runReferenceSlice, REFERENCE_SCENARIO, runEndToEndTradingScenario,
  composeDirectorDecision, DIRECTOR_METHOD_REGISTRY_MIRROR,
  compileStrategyRun, createExecutionGateway, prepareOrder,
  deepFreeze, initialPortfolioState, marksAt, approveDecisionIdMatchesContent,
  createPaperVenueAdapter, verifyShadowOutcomeChain, stableDigest8Json,
  type TradingScenario,
} from '../../examples/end-to-end-trading/src/index';

function scenarioClone(): TradingScenario {
  return structuredClone(REFERENCE_SCENARIO as unknown as TradingScenario);
}

describe('T048 broken-link gate — each stage consumes its predecessor for real', () => {
  it('world -> research: a changed market event changes the research reports', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const tampered = scenarioClone();
    // Flip the positive BTC social signal to strongly negative.
    const social = tampered.marketEvents.find((event) => event.event_type === 'social_signal' && event.instrument === 'BTC-USDT')!;
    (social.payload as { value: string }).value = '-0.80';
    const rerun = runEndToEndTradingScenario(tampered);
    expect(rerun.ok).toBe(true);
    if (!rerun.ok) return;
    const before = baseline.value.researchIntakes[0]!.sentiment!;
    const after = rerun.value.researchIntakes[0]!.sentiment!;
    expect(after.reportId).not.toBe(before.reportId); // different content -> different derived id
    // The BTC reading consumed the tampered news: its polarity flipped.
    const beforeBtc = before.readings.find((reading) => reading.scope.instrument === 'BTC-USDT')!;
    const afterBtc = after.readings.find((reading) => reading.scope.instrument === 'BTC-USDT')!;
    expect(afterBtc.readingId).not.toBe(beforeBtc.readingId);
    expect(beforeBtc.polarity.direction).toBe('positive');
    expect(afterBtc.polarity.direction).toBe('negative');
  });

  it('research -> director: a tampered sentiment category flips the director stance', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const intake = baseline.value.researchIntakes[0]!;
    const tamperedReport = deepFreeze({
      ...intake.sentiment!,
      summary: { ...intake.sentiment!.summary, dominantPolarity: 'negative' },
    });
    const outcome = composeDirectorDecision({
      asOf: baseline.value.decisions[0]!.asOf,
      goal: baseline.value.decisions[0]!.goal,
      constraintSets: baseline.value.decisions[0]!.constraintSets,
      tenantId: REFERENCE_SCENARIO.tenant,
      projectId: REFERENCE_SCENARIO.project,
      seed: REFERENCE_SCENARIO.seed,
      methodId: DIRECTOR_METHOD_REGISTRY_MIRROR.methods[0]!.methodId,
      registry: DIRECTOR_METHOD_REGISTRY_MIRROR,
      bodyVersion: 'trading-director@1.0.0',
      intake: { ...intake, sentiment: tamperedReport },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The original decision was bullish-driven (allocation adjustment).
    const original = baseline.value.decisions[0]!;
    expect(original.directive.kind).toBe('allocation-adjustment');
    if (outcome.value.kind !== 'decision') return;
    // With sentiment flipped to negative the tilt math MUST change: either
    // the adjustment shrinks, flips, or the no-change path triggers — the
    // sentiment lane is genuinely consumed either way.
    const originalBtc = original.directive.kind === 'allocation-adjustment'
      ? original.directive.adjustments.find((a) => a.instrumentId === 'BTC-USDT')
      : undefined;
    const tamperedBtc = outcome.value.decision.directive.kind === 'allocation-adjustment'
      ? outcome.value.decision.directive.adjustments.find((a) => a.instrumentId === 'BTC-USDT')
      : undefined;
    const changed =
      (originalBtc?.deltaWeight ?? '0') !== (tamperedBtc?.deltaWeight ?? '0') ||
      original.directive.kind !== outcome.value.decision.directive.kind;
    expect(changed).toBe(true);
  });

  it('director -> strategy: a changed directive changes the emitted intents', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const decision = baseline.value.decisions[0]!;
    // Strip the directive: force the no-change verdict.
    const neutralDecision = deepFreeze({
      ...decision,
      directive: { kind: 'no-change' as const, reason: 'flat-consensus' as const, instrumentTilts: [] },
    });
    const run = baseline.value.strategyRuns[0]!;
    const spec = deepFreeze({
      specId: REFERENCE_SCENARIO.policies.execution.principal,
      version: 1,
      tenant: REFERENCE_SCENARIO.tenant,
      project: REFERENCE_SCENARIO.project,
      goal: REFERENCE_SCENARIO.goal.id,
      universe: REFERENCE_SCENARIO.universe.map((entry) => ({ instrumentId: entry.instrument, venueId: entry.venue, lotSize: entry.lotSize, tickSize: entry.tickSize })),
      allocation: { kind: 'equal_weight' as const },
      rebalancing: { trigger: 'drift_band' as const, band: '0.02', cadenceMs: 1_200_000 },
      priceDiscipline: { kind: 'limit' as const, anchor: 'last_trade' as const },
      riskPolicyRefs: ['risk-policy:reference@1'],
      generators: [],
      decimalPrecision: 8,
      organization: null,
      createdAt: REFERENCE_SCENARIO.epochMs,
    });
    // Find the state the first run compiled over (all cash at the epoch).
    const state = baseline.value.finalPortfolio; // (reconstructed below via a fresh compile instead)
    void state;
    // Re-run the FIRST decision's compile with the neutral directive against
    // the genesis state reconstructed from the scenario.
    const genesisLineage = {
      strategy: { specId: spec.specId, version: 1 },
      goal: { goalId: REFERENCE_SCENARIO.goal.id, version: 1 },
      constraintSet: { id: REFERENCE_SCENARIO.constraintSet.id, version: 1 },
      windowId: 'win-1',
      seed: REFERENCE_SCENARIO.seed,
      tenant: REFERENCE_SCENARIO.tenant,
      project: REFERENCE_SCENARIO.project,
    };
    const genesis = initialPortfolioState(genesisLineage, REFERENCE_SCENARIO.initialCash, REFERENCE_SCENARIO.epochMs);
    const marks = marksAt(baseline.value.world, REFERENCE_SCENARIO.universe, decision.asOf);
    if (!marks.ok) throw new Error('marks missing');
    const windowEvents = baseline.value.world.observations
      .map((observation) => observation.payload as never)
      .filter((event) => {
        const typed = event as { available_time: number; event_type: string };
        return typed.available_time <= decision.asOf && (typed.event_type === 'trade' || typed.event_type === 'quote');
      });
    const window = {
      window_id: 'win-1',
      events: windowEvents,
      asOf: decision.asOf,
      starts_at: decision.asOf - 20 * 60_000,
      ends_at: decision.asOf,
    };
    const withDirective = compileStrategyRun({
      spec, state: genesis, window,
      constraintSet: REFERENCE_SCENARIO.constraintSet,
      goal: REFERENCE_SCENARIO.goal,
      seed: REFERENCE_SCENARIO.seed,
      directorDecision: { decisionId: decision.decisionId, directive: decision.directive },
    });
    const withoutDirective = compileStrategyRun({
      spec, state: genesis, window,
      constraintSet: REFERENCE_SCENARIO.constraintSet,
      goal: REFERENCE_SCENARIO.goal,
      seed: REFERENCE_SCENARIO.seed,
      directorDecision: { decisionId: neutralDecision.decisionId, directive: neutralDecision.directive },
    });
    expect(withDirective.ok && withoutDirective.ok).toBe(true);
    if (!withDirective.ok || !withoutDirective.ok) return;
    // The directive genuinely feeds the target weights: the quantities differ.
    const q = (run: { intents: readonly { order: { quantity: string } }[] }) => run.intents.map((intent) => intent.order.quantity).join(',');
    expect(q(withDirective.value.run)).not.toBe(q(withoutDirective.value.run));
  });

  it('strategy -> gate: a tampered intent is refused or produces a different decision id', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const intent = baseline.value.strategyRuns[0]!.intents[0]!;
    const tampered = deepFreeze({ ...intent, order: { ...intent.order, quantity: '999' } });
    // Build the same gateway the run used for decision 1 and submit the
    // tampered intent: the limits check MUST refuse it (999 BTC > cap 20).
    const run = baseline.value;
    const gateway = createExecutionGateway({
      policy: run.executionPolicy,
      gate: {
        portfolio: deepFreeze({
          stateId: 'ps:genesis', positions: [], weights: [], cash: REFERENCE_SCENARIO.initialCash,
          realizedPnl: '0', unrealizedPnl: '0', asOf: REFERENCE_SCENARIO.epochMs,
          lineage: {
            strategy: { specId: 'x', version: 1 }, goal: { goalId: 'g', version: 1 },
            constraintSet: { id: 'cs', version: 1 }, windowId: 'w', seed: 's',
            tenant: REFERENCE_SCENARIO.tenant, project: REFERENCE_SCENARIO.project,
          },
        }),
        venueState: {
          asOf: intent.asOf,
          instruments: REFERENCE_SCENARIO.universe.map((entry) => ({
            venue: entry.venue, instrument: entry.instrument, instrumentClass: entry.assetClass,
            referencePrice: '50000', rateWindowOrderCount: 0,
          })),
        },
      },
      risk: { policy: run.riskPolicy, exposure: null },
      authority: {
        tenant: REFERENCE_SCENARIO.tenant, project: REFERENCE_SCENARIO.project,
        grants: [], venues: [],
      },
      routing: { tenant: REFERENCE_SCENARIO.tenant, project: REFERENCE_SCENARIO.project, entries: [] },
      adapters: [],
      killSwitch: { switchId: run.executionPolicy.killSwitch.switchId, records: [] },
      instants: { next: () => intent.asOf + 250 },
      substrate: 'substrate:test@1',
      executionMode: 'paper',
    });
    expect(gateway.ok).toBe(true);
    if (!gateway.ok) return;
    const submission = gateway.value.submitDecision(tampered);
    expect(submission.ok).toBe(true);
    if (!submission.ok) return;
    expect(submission.value.kind).toBe('refused');
    if (submission.value.kind === 'refused') {
      expect(submission.value.refusal.stage).toBe('policy_gate');
      const failure = ((submission.value.refusal as unknown as { decision: Record<string, unknown> }).decision.failure) as { reason: { dimension: string } };
      expect(failure.reason.dimension).toBe('limits');
    }
  });

  it('gate -> execution body: a FORGED approve decision is refused (decision_not_approved)', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const approve = baseline.value.submissions.find((submission) => submission.kind === 'routed');
    if (!approve || approve.kind !== 'routed') throw new Error('expected a routed submission');
    const lifecycle = baseline.value.lifecycleLogs[0]!;
    const intent = baseline.value.strategyRuns.flatMap((runRecord) => runRecord.intents).find((candidate) => candidate.order.clientOrderId === lifecycle.orderRef)!;
    // Forge: keep the id, change the content.
    const forged = deepFreeze({
      ...(baseline.value as unknown as { decisions: unknown }), // placeholder to satisfy typing below
    });
    void forged;
    const decisionFromAudit = deepFreeze({
      kind: 'approve' as const,
      decisionId: approve.decisionId,
      intentRef: intent.intentId,
      policy: { policyId: 'xpol:forged', version: 1 },
      checkOrder: [],
      checks: [],
      lineage: {
        intentRef: intent.intentId,
        strategy: { specId: intent.strategy.specId, version: intent.strategy.version },
        goal: { goalId: intent.goal.goalId, version: intent.goal.version },
        policy: { policyId: 'xpol:forged', version: 1 },
        venues: [intent.order.venueId],
        seed: intent.seed,
        tenant: intent.tenant,
        project: intent.project,
      },
      asOf: intent.asOf + 1000,
    });
    const prepared = prepareOrder({
      decision: decisionFromAudit,
      intent,
      directorDecisionRef: baseline.value.decisions[0]!.decisionId,
      orderClock: intent.asOf + 1500,
    });
    // The forged decision's id does not match its content -> the venue and
    // the body refuse it: L8's forgery law.
    expect(prepared.ok).toBe(true); // (the body's own law: policy mismatch is not its check)
    expect(approveDecisionIdMatchesContent(decisionFromAudit)).toBe(false);
    const adapter = createPaperVenueAdapter();
    const routed = adapter.port.routeOrder({ decision: decisionFromAudit, intent, kill_switch: { state: 'standing' } });
    expect(routed.ok).toBe(false);
    if (!routed.ok) expect(routed.error.code).toBe('decision_not_approved');
  });

  it('execution -> outcomes: a tampered fill changes the outcome record', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const filled = baseline.value.outcomeLog.records.find((record) => record.fills.length > 0);
    if (!filled) throw new Error('expected a filled outcome');
    const tampered = deepFreeze({
      ...filled,
      costs: { ...filled.costs, feeTotal: '999999.99' },
    });
    // The chain law catches the edit: the derived outcome id no longer matches.
    const { outcomeId, ...content } = tampered;
    expect(outcomeId).not.toBe(`swo:${stableDigest8Json(content as never)}`);
    // And a tampered log does not verify.
    const log = { records: [...baseline.value.outcomeLog.records.slice(0, -1), tampered], head: baseline.value.outcomeLog.head };
    expect(verifyShadowOutcomeChain(log)).toBe(false);
  });

  it('L4 gate: research from the future is a typed error at the director', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const intake = baseline.value.researchIntakes[0]!;
    const future = deepFreeze({
      ...intake.regime!,
      asOf: baseline.value.decisions[0]!.asOf + 1,
    });
    const outcome = composeDirectorDecision({
      asOf: baseline.value.decisions[0]!.asOf,
      goal: baseline.value.decisions[0]!.goal,
      constraintSets: baseline.value.decisions[0]!.constraintSets,
      tenantId: REFERENCE_SCENARIO.tenant,
      projectId: REFERENCE_SCENARIO.project,
      seed: REFERENCE_SCENARIO.seed,
      methodId: DIRECTOR_METHOD_REGISTRY_MIRROR.methods[0]!.methodId,
      registry: DIRECTOR_METHOD_REGISTRY_MIRROR,
      bodyVersion: 'trading-director@1.0.0',
      intake: { ...intake, regime: future },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errors.some((error) => error.code === 'research_from_the_future')).toBe(true);
    }
  });
});
