/**
 * T048 — the LINEAGE proof (L15: "goal, research, decision, execution and
 * outcome share lineage"). The whole chain is walked END TO END on the
 * REAL records:
 *
 *   the user's goal statement (goal-e2e-slice)
 *     -> the director decision (the organization's synthesis over the
 *        four research lanes — its own goal ref, the fixture scope's
 *        goal/portfolio-direction, plus the decision id the execution
 *        lane cites)
 *     -> the strategy runs (run.goal === the user's goal; the window the
 *        adapter events defined)
 *     -> the intents (intent.goal === the user's goal; windowRefs)
 *     -> the gateway's audit records (lineage.goal === the user's goal;
 *        who.intentRef === the REAL intent id)
 *     -> the order lifecycles (decisionRef === the gateway's 'xd:'
 *        approval; directorDecisionRef === the director's 'dd-' id;
 *        intentRef === the intent)
 *     -> the realized outcome records (intentRef === the intent — the
 *        paper lane's chain-verified log)
 *
 * plus the L12 scoping (every record tenant-e2e-slice) and the L16
 * clock separation (the order-level clock is DISTINCT from the
 * strategic decision instant on every lifecycle record).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  BTC,
  CONSTRAINT_SET_ID,
  ETH,
  GOAL_ID,
  SPEC_ID,
  STRATEGY_DECISION_AT,
  TENANT,
  WINDOW_ID,
  collectMarketData,
  compileSliceRun,
  compileSliceStep2,
  composeSliceDecision,
  runReferenceSlice,
  runShadowLane,
  sliceGoal,
  sliceWindow,
  sliceWindow2,
  submitThroughGateway,
} from '../../examples/end-to-end-trading/src/index';

describe('T048 the lineage proof — outcome records trace back to the goal (L15)', () => {
  const marketData = collectMarketData();
  const run = compileSliceRun(marketData.binanceEvents);
  const step2 = compileSliceStep2(marketData.binanceEvents);
  const allIntents = [...run.intents, ...step2.intents];
  const intentIds = new Set(allIntents.map((intent) => intent.intentId));
  let report: Awaited<ReturnType<typeof runReferenceSlice>>;

  beforeAll(async () => {
    report = await runReferenceSlice();
  });

  it('binds the strategy runs to the user\'s declared goal statement (the run\'s own lineage)', () => {
    expect(sliceGoal().id).toBe(GOAL_ID); // the goal statement the slice declares
    expect(run.goal.goalId).toBe(GOAL_ID);
    expect(step2.goal.goalId).toBe(GOAL_ID);
    expect(run.windowId).toBe(WINDOW_ID);
    expect(run.strategy.specId).toBe(SPEC_ID);
    expect(run.tenant).toBe(TENANT);
  });

  it('binds every emitted intent to the goal and the window (the intent-level L15 carriers)', () => {
    const step1WindowId = sliceWindow(marketData.binanceEvents).window_id;
    const step2WindowId = sliceWindow2(marketData.binanceEvents).window_id;
    expect(step1WindowId).toBe(WINDOW_ID);
    for (const intent of run.intents) {
      expect(intent.goal.goalId).toBe(GOAL_ID);
      expect(intent.tenant).toBe(TENANT);
      expect(intent.windowRefs).toContain(step1WindowId); // the window the ADAPTER events defined
      expect(intent.strategy.specId).toBe(SPEC_ID);
    }
    for (const intent of step2.intents) {
      expect(intent.goal.goalId).toBe(GOAL_ID);
      expect(intent.tenant).toBe(TENANT);
      expect(intent.windowRefs).toContain(step2WindowId); // the step-2 window (the rally print visible)
      expect(intent.strategy.specId).toBe(SPEC_ID);
    }
    expect(allIntents.map((intent) => intent.order.instrumentId).sort()).toEqual([BTC, BTC, ETH].sort());
  });

  it('carries the upstream organization lineage: the director decision\'s own goal + the id the order lane cites', () => {
    const outcome = composeSliceDecision();
    expect(outcome.kind).toBe('decision');
    if (outcome.kind !== 'decision') throw new Error('unreachable');
    const decision = outcome.decision;
    expect(decision.goal.goalId).toBe('goal/portfolio-direction'); // the director lane's fixture goal (the research scope)
    expect(decision.tenantId).toBe('tenant-director'); // the fixture scope — documented in README limitations
    expect(decision.decisionId).toBe(report.director.decisionId);
    expect(decision.decisionId).toMatch(/^dd-/);
    expect(report.lineage.directorGoalId).toBe('goal/portfolio-direction');
    expect(report.lineage.directorDecisionId).toBe(decision.decisionId);
  });

  it('traces every realized outcome record back to the goal through its REAL intent (the paper lane)', async () => {
    expect(report.lineage.goalId).toBe(GOAL_ID);
    expect(report.lineage.paperOutcomeIntents).toHaveLength(report.outcomes.outcomes);
    for (const link of report.lineage.paperOutcomeIntents) {
      expect(intentIds.has(link.intentRef)).toBe(true); // the outcome cites a REAL strategy intent
      expect(link.goalId).toBe(GOAL_ID); // ...and that intent serves the user's goal
      expect(link.outcomeId).toMatch(/^swo:/);
    }
    // The session-level lineage blocks (the L9/L12 anchors the outcome log rides).
    const lane = await runShadowLane(run, step2, marketData.binanceEvents);
    expect(lane.session.bookLineage.goal.goalId).toBe(GOAL_ID);
    expect(lane.session.bookLineage.strategy.specId).toBe(SPEC_ID);
    expect(lane.session.bookLineage.constraintSet.id).toBe(CONSTRAINT_SET_ID);
    expect(lane.session.bookLineage.windowId).toBe(WINDOW_ID);
    expect(lane.session.bookLineage.tenant).toBe(TENANT);
    for (const record of lane.session.outcomeLog.records) {
      expect(record.lineage.tenant).toBe(TENANT); // L12: one tenant on every record
      expect(record.lineage.fidelity.mode).toBe('shadow'); // L5/R23 mode honesty
      expect(record.lineage.seed).toBe(lane.session.seed); // the determinism anchor
    }
  });

  it('traces every gateway audit record back to the goal through its REAL intent (the live lane)', () => {
    expect(report.lineage.liveAuditIntents).toHaveLength(report.gateway.auditRecords);
    for (const link of report.lineage.liveAuditIntents) {
      expect(link.goalId).toBe(GOAL_ID); // every audit record's lineage goal is the user's goal
      expect(link.auditId).toMatch(/^xga:/);
    }
    // The audit records' own who/lineage blocks (the deep carriers). Every
    // ROUTED submission's audit cites a REAL strategy intent; the refused
    // negatives' audits honestly cite what was submitted (the mutated ids).
    const lane = submitThroughGateway(run, step2);
    const routedAudits = lane.audit.filter((audit) => audit.outcome === 'routed');
    expect(routedAudits).toHaveLength(3);
    for (const audit of lane.audit) {
      expect(audit.lineage.goal.goalId).toBe(GOAL_ID);
      expect(audit.lineage.strategy.specId).toBe(SPEC_ID);
      expect(audit.lineage.intentRef).toMatch(/^si:/);
      expect(audit.tenant).toBe(TENANT); // L12
      expect(audit.who.bodyVersion.specId).toBe(SPEC_ID);
      if (audit.who.decisionId !== null) expect(audit.who.decisionId).toMatch(/^xd:/);
    }
    for (const audit of routedAudits) {
      expect(intentIds.has(audit.who.intentRef)).toBe(true); // the ROUTED ones gate the REAL strategy intents
    }
  });

  it('threads the order lane: every lifecycle cites the GATEWAY approval, the DIRECTOR decision and the intent (L15 + L8 + L16)', () => {
    const routed = submitThroughGateway(run, step2)
      .submissions.filter((submission): submission is Extract<typeof submission, { readonly kind: 'routed' }> => submission.kind === 'routed');
    expect(routed).toHaveLength(3);
    expect(report.lineage.orderDecisions).toHaveLength(3);
    for (const [index, decision] of report.lineage.orderDecisions.entries()) {
      expect(decision.decisionRef).toBe(routed[index]?.decisionId); // the GATEWAY's 'xd:' approval
      expect(decision.decisionRef).toMatch(/^xd:/);
      expect(decision.directorDecisionRef).toBe(report.lineage.directorDecisionId); // the DIRECTOR's 'dd-' id (L15 continuity)
      expect(intentIds.has(decision.intentRef)).toBe(true); // the gated intent
      expect(decision.lifecycleId).toMatch(/^ol-/);
      expect(decision.orderClock).toBeGreaterThan(decision.decisionAsOf); // L16: two DISTINCT clocks
      expect(decision.decisionAsOf).toBe(STRATEGY_DECISION_AT); // the strategic instant
    }
  });

  it('closes the loop in ONE sentence: the BTC buy\'s outcome record -> its intent -> the goal; its lifecycle -> the gateway decision -> the same intent; the gateway decision -> the director\'s decision', () => {
    const btcBuyIntent = run.intents.find((intent) => intent.order.instrumentId === BTC && intent.order.side === 'buy');
    if (btcBuyIntent === undefined) throw new Error('the BTC buy intent must exist');
    const outcome = report.lineage.paperOutcomeIntents.find((link) => link.intentRef === btcBuyIntent.intentId);
    expect(outcome?.goalId).toBe(GOAL_ID); // outcome -> intent -> goal
    const orderDecision = report.lineage.orderDecisions.find((decision) => decision.intentRef === btcBuyIntent.intentId);
    expect(orderDecision).toBeDefined(); // lifecycle -> the same intent
    expect(orderDecision?.directorDecisionRef).toBe(report.lineage.directorDecisionId); // lifecycle -> the director decision
    const audit = report.lineage.liveAuditIntents.find((link) => link.intentRef === btcBuyIntent.intentId);
    expect(audit?.goalId).toBe(GOAL_ID); // the live lane's audit -> the same goal
    // The window the decision was computed from is the ADAPTER station's product (L4/L9).
    expect(sliceWindow(marketData.binanceEvents).window_id).toBe(WINDOW_ID);
    expect(btcBuyIntent.windowRefs).toContain(WINDOW_ID);
  });
});
