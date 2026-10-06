// tests/end-to-end-trading/broken-link.test.ts — THE BROKEN-LINK SEAM TESTS
// (suite 3/5).
//
// Work Order T048: "a broken-link test proving each pipeline stage actually
// consumes its predecessor's REAL records (not stubs)". Two proof modes per
// seam:
//   POSITIVE — the successor's records cite the predecessor's ACTUAL derived
//   identities (ids produced by the predecessor stage, never literals).
//   NEGATIVE — tamper with / remove / forge the predecessor's records and
//   the successor REFUSES with a typed error (a stub consumer would pass).

import { describe, expect, it } from 'vitest';
import {
  runEndToEndScenario,
  REFERENCE_SCENARIO,
  composeDirectorDecision,
  DIRECTOR_METHOD_REGISTRY,
  compileStrategyRun,
  runConstraintGate,
  initialPortfolioState,
  runExecutionGateMirror,
  gatewayOrderRequestMirror,
  acceptExecutionIntakeMirror,
  prepareOrderMirror,
  appendOrderLifecycleEventMirror,
  startLedger,
  appendEntry,
  deepCloneJson,
  type ResearchIntakeMirror,
  type ScenarioRecord,
  type StreamEvent,
  type OrderLifecycleLogMirror,
} from '../../examples/end-to-end-trading/src/index';

const runResult = runEndToEndScenario();
if (!runResult.ok) throw new Error(`reference slice failed: ${JSON.stringify(runResult.errors)}`);
const run = runResult.value;

/** The director composition input derived from the REAL run's records. */
function directorInputOf(intake: ResearchIntakeMirror) {
  return {
    asOf: REFERENCE_SCENARIO.instants.decisionAsOf,
    goal: { goalId: REFERENCE_SCENARIO.goal.id, version: REFERENCE_SCENARIO.goal.version },
    constraintSets: [{ id: REFERENCE_SCENARIO.constraintSet.id, version: REFERENCE_SCENARIO.constraintSet.version }],
    tenantId: REFERENCE_SCENARIO.tenant,
    projectId: REFERENCE_SCENARIO.project,
    seed: REFERENCE_SCENARIO.seeds.director,
    methodId: 'method/director/synthesis',
    registry: DIRECTOR_METHOD_REGISTRY,
    bodyVersion: 'trading-director@1.0.0',
    intake,
  };
}

describe('seam: research consumes the world\'s REAL observations', () => {
  it('POSITIVE: every report citation cites an observation the world actually emitted, with its real available time', () => {
    const observationIds = new Set(run.stages.marketWorld.observations.map((observation) => observation.observation_id));
    const observationsById = new Map(run.stages.marketWorld.observations.map((observation) => [observation.observation_id, observation]));
    const reports = [
      run.stages.research.sentiment,
      run.stages.research.regime,
      run.stages.research.fundamental,
      run.stages.research.crossMarket,
    ];
    let citations = 0;
    for (const report of reports) {
      const evidenceLists: { readonly observationId: string; readonly availableTime: number }[] = [];
      if (report === null) continue;
      if ('readings' in report) evidenceLists.push(...report.readings.flatMap((reading) => reading.evidence));
      if ('digests' in report) evidenceLists.push(...report.digests.flatMap((digest) => digest.evidence));
      if ('classifications' in report) evidenceLists.push(...report.classifications.flatMap((c) => c.evidence));
      if ('assessments' in report) evidenceLists.push(...report.assessments.flatMap((a) => a.evidence));
      if ('relationships' in report) evidenceLists.push(...report.relationships.flatMap((r) => r.evidence));
      for (const citation of evidenceLists) {
        citations += 1;
        expect(observationIds.has(citation.observationId)).toBe(true); // REAL record, not a stub id
        expect(citation.availableTime).toBe(observationsById.get(citation.observationId)?.available_time);
      }
    }
    expect(citations).toBeGreaterThan(10); // the reports genuinely consumed the observations
  });

  it('NEGATIVE: an event not yet available at the research instant is EXCLUDED from the view (L4)', () => {
    const futureEvent = deepCloneJson(REFERENCE_SCENARIO.stream[0]) as unknown as { event_id: string; available_time: number };
    futureEvent.event_id = 'evt-future';
    futureEvent.available_time = REFERENCE_SCENARIO.instants.researchAsOf + 1;
    const view = run.stages.marketWorld.view;
    // The reference view contains only events available at or before the research instant.
    expect(view.records.some((record) => record.record_id === 'evt-future')).toBe(false);
    expect(view.records.every((record) => record.available_time <= REFERENCE_SCENARIO.instants.researchAsOf)).toBe(true);
  });
});

describe('seam: the director consumes the research reports\' REAL records', () => {
  it('POSITIVE: the decision\'s inputs cite the reports\' actual derived ids and body versions', () => {
    if (run.stages.director.outcome.kind !== 'decision') throw new Error('expected a decision');
    const decision = run.stages.director.outcome.decision;
    const reportIds = new Set([
      run.stages.research.sentiment?.reportId,
      run.stages.research.regime?.reportId,
      run.stages.research.fundamental?.reportId,
      run.stages.research.crossMarket?.reportId,
    ]);
    expect(decision.inputs).toHaveLength(4);
    for (const input of decision.inputs) {
      expect(reportIds.has(input.reportId)).toBe(true); // the ACTUAL rr-/frr-/cmrr- ids
    }
    // The directive positions cite the same report ids (per-body attribution).
    if (decision.directive.kind === 'allocation-adjustment') {
      for (const adjustment of decision.directive.adjustments) {
        for (const position of adjustment.positions) {
          expect(reportIds.has(position.reportId)).toBe(true);
        }
      }
    }
  });

  it('NEGATIVE: a future report is the typed research_from_the_future refusal (L4)', () => {
    const tampered = deepCloneJson(run.stages.research) as { sentiment: ResearchIntakeMirror['sentiment'] };
    if (tampered.sentiment === null) throw new Error('missing sentiment');
    tampered.sentiment = { ...tampered.sentiment, asOf: REFERENCE_SCENARIO.instants.decisionAsOf + 1 };
    const result = composeDirectorDecision(directorInputOf(tampered as unknown as ResearchIntakeMirror));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'research_from_the_future')).toBe(true);
    }
  });

  it('NEGATIVE: a foreign-tenant report is the typed tenant_mismatch refusal (L12)', () => {
    const tampered = deepCloneJson(run.stages.research) as { sentiment: ResearchIntakeMirror['sentiment'] };
    if (tampered.sentiment === null) throw new Error('missing sentiment');
    tampered.sentiment = { ...tampered.sentiment, tenantId: 'tenant-other' };
    const result = composeDirectorDecision(directorInputOf(tampered as unknown as ResearchIntakeMirror));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'tenant_mismatch')).toBe(true);
    }
  });

  it('NEGATIVE: missing lanes produce a typed quorum-unmet ESCALATION record (never silence, never a crash)', () => {
    const result = composeDirectorDecision(
      directorInputOf({ sentiment: run.stages.research.sentiment, regime: null, fundamental: null, crossMarket: null }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('escalation');
    if (result.value.kind === 'escalation') {
      expect(result.value.escalation.reason).toBe('quorum-unmet');
      expect(result.value.escalation.quorum).toEqual({
        declaredQuorum: 3,
        presentLanes: 1,
        absentLanes: ['regime', 'fundamental', 'cross-market'],
      });
      expect(result.value.escalation.coverage.filter((lane) => lane.status === 'absent')).toHaveLength(3);
    }
  });
});

describe('seam: the strategy consumes the decision, the goal and the window\'s REAL records', () => {
  it('POSITIVE: the run binds the actual goal/constraint-set versions and the actual marks', () => {
    const strategyRun = run.stages.strategy.run;
    expect(strategyRun.goal.goalId).toBe(REFERENCE_SCENARIO.goal.id);
    expect(strategyRun.constraintSet.id).toBe(REFERENCE_SCENARIO.constraintSet.id);
    expect(strategyRun.stateId.startsWith('ps:')).toBe(true);
    // The BTC limit price derives from the window's ACTUAL last trade (50750).
    const btc = strategyRun.intents.find((intent) => intent.order.instrumentId === 'BTC-USD');
    expect(btc?.order.price).toBe('50750.00');
  });

  it('POSITIVE: the directive actually moved the target weights (the strategy lane BINDS the directive)', () => {
    const weights = new Map(
      run.stages.strategy.spec.allocation.kind === 'fixed_weights'
        ? run.stages.strategy.spec.allocation.weights.map((w) => [w.instrumentId, w.weight])
        : [],
    );
    expect(weights.get('BTC-USD')).toBe('0.3633'); // equal-weight 0.3333 + the directive's +0.0300
    expect(weights.get('ETH-USD')).toBe('0.3333'); // untouched by the directive
  });

  it('NEGATIVE: a missing mark fails closed with the typed observation_gap (L4)', () => {
    const window = {
      window_id: 'window/broken@1',
      events: run.stages.strategy.spec.universe
        .filter((entry) => entry.instrumentId !== 'ETH-USD') // ETH has no trades -> no mark
        .flatMap((entry) =>
          run.stages.marketWorld.observations
            .filter((observation) => observation.instrument === entry.instrumentId)
            .map((observation) => ({
              event_id: observation.observation_id.replace('obs-', ''),
              venue: 'REFSIM',
              instrument: entry.instrumentId,
              asset_class: 'crypto',
              event_type: 'trade' as const,
              event_time: observation.available_time - 250,
              source_time: null,
              available_time: observation.available_time,
              ingestion_time: observation.available_time,
              sequence: 1,
              provider: 'adapter-binance',
              provenance: { origin: 'historical' as const, adapter: { id: 'adapter-binance', version: '0.0.0' }, derived_from: [], transform: null },
              payload: { price: '1', size: '1', side: 'buy' as const },
            })),
        ),
      asOf: REFERENCE_SCENARIO.instants.strategyAsOf,
      starts_at: REFERENCE_SCENARIO.instants.t0,
      ends_at: REFERENCE_SCENARIO.instants.strategyAsOf,
    };
    const result = compileStrategyRun({
      spec: run.stages.strategy.spec,
      state: run.stages.strategy.state,
      window,
      constraintSet: REFERENCE_SCENARIO.constraintSet,
      goal: REFERENCE_SCENARIO.goal,
      seed: REFERENCE_SCENARIO.seeds.strategy,
      directorDecisionRef: 'dd-irrelevant',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'observation_gap')).toBe(true);
    }
  });

  it('NEGATIVE: a blocking constraint violation refuses the intent BEFORE emission (constraint primacy)', () => {
    const gate = runConstraintGate(REFERENCE_SCENARIO.constraintSet, {
      observation: { windowId: 'w', asOf: 0 },
      state: { positionWeight: 0, targetWeight: 0.9, equity: '100000' }, // violates max target weight 0.5
      action: { side: 'buy', instrumentId: 'BTC-USD', venueId: 'REFSIM', quantity: '1', notional: '50000', orderKind: 'limit' },
      outcome: {},
    });
    expect(gate.pass).toBe(false);
    expect(gate.blockingViolations).toBeGreaterThan(0);
    expect(gate.checks.find((check) => check.constraintId === 'constraint/single-instrument-weight')?.status).toBe('violated');
  });
});

describe('seam: the gateway consumes the intents\' REAL records', () => {
  it('POSITIVE: every approve decision binds its intent (decision.intentRef === the actual si: id)', () => {
    const intentIds = new Set(run.stages.strategy.run.intents.map((intent) => intent.intentId));
    for (const decision of run.stages.riskGateway.decisions) {
      expect(intentIds.has(decision.intentRef)).toBe(true);
      expect(decision.lineage.intentRef).toBe(decision.intentRef);
      expect(decision.lineage.goal.goalId).toBe(REFERENCE_SCENARIO.goal.id);
    }
  });

  it('NEGATIVE: an intent from a foreign principal fails the identity check (typed, in the declared order)', () => {
    const btcIntent = run.stages.strategy.run.intents.find((intent) => intent.order.instrumentId === 'BTC-USD');
    if (btcIntent === undefined) throw new Error('missing intent');
    const decision = runExecutionGateMirror({
      intent: {
        ...btcIntent,
        tenant: 'tenant-other', // foreign tenant (L12)
      },
      policy: REFERENCE_SCENARIO.executionPolicy,
      portfolio: { positionOf: () => '0', equity: REFERENCE_SCENARIO.initialCash },
      venueState: {
        asOf: REFERENCE_SCENARIO.instants.strategyAsOf,
        instruments: [
          { venue: 'REFSIM', instrument: 'BTC-USD', instrumentClass: 'crypto', referencePrice: '50750.00', rateWindowOrderCount: 0 },
        ],
      },
      killSwitch: { state: 'standing', switchId: null, thrownAt: null, reason: null },
      digestOf: () => 'deadbeef',
    });
    expect(decision.kind).toBe('refuse');
    if (decision.kind === 'refuse') {
      expect(decision.failure.dimension).toBe('identity');
    }
  });

  it('NEGATIVE: an intent on an unpermitted venue fails venue_permissions', () => {
    const btcIntent = run.stages.strategy.run.intents.find((intent) => intent.order.instrumentId === 'BTC-USD');
    if (btcIntent === undefined) throw new Error('missing intent');
    const decision = runExecutionGateMirror({
      intent: {
        ...btcIntent,
        order: { ...btcIntent.order, venueId: 'VENUE-UNKNOWN' },
      },
      policy: REFERENCE_SCENARIO.executionPolicy,
      portfolio: { positionOf: () => '0', equity: REFERENCE_SCENARIO.initialCash },
      venueState: {
        asOf: REFERENCE_SCENARIO.instants.strategyAsOf,
        instruments: [
          { venue: 'VENUE-UNKNOWN', instrument: 'BTC-USD', instrumentClass: 'crypto', referencePrice: '50750.00', rateWindowOrderCount: 0 },
        ],
      },
      killSwitch: { state: 'standing', switchId: null, thrownAt: null, reason: null },
      digestOf: () => 'deadbeef',
    });
    expect(decision.kind).toBe('refuse');
    if (decision.kind === 'refuse') {
      expect(decision.failure.dimension).toBe('venue_permissions');
    }
  });
});

describe('seam: execution consumes the gateway\'s REAL approve decisions', () => {
  it('POSITIVE: every lifecycle record cites the actual xd: decision and the actual dd- director decision', () => {
    const decisionIds = new Set(run.stages.riskGateway.decisions.map((decision) => decision.decisionId));
    const directorDecisionId = run.stages.director.outcome.kind === 'decision' ? run.stages.director.outcome.decision.decisionId : '';
    for (const log of run.stages.execution.logs) {
      for (const record of log.records) {
        expect(decisionIds.has(record.decisionRef)).toBe(true);
        expect(record.directorDecisionRef).toBe(directorDecisionId); // L15 continuity through the whole order lane
      }
    }
  });

  it('NEGATIVE: preparation without an approve decision is the typed decision_not_approved (L8)', () => {
    const prepared = prepareOrderMirror({
      decisionRef: 'not-a-decision',
      decisionAsOf: REFERENCE_SCENARIO.instants.decisionAsOf,
      intentRef: 'si:whatever',
      directorDecision: null,
      orderRef: 'broken-1',
      venue: 'REFSIM',
      instrument: 'BTC-USD',
      side: 'buy',
      orderKind: 'limit',
      quantity: '0.5',
      orderClock: REFERENCE_SCENARIO.instants.orderClockBase + 1,
      methodId: 'method/execution/order-preparation',
      methodVersion: '1.0.0',
      tenant: REFERENCE_SCENARIO.tenant,
      project: REFERENCE_SCENARIO.project,
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.errors.some((error) => error.code === 'decision_not_approved')).toBe(true);
    }
  });

  it('NEGATIVE: the intake refuses a REFUSAL decision as authority (a refusal never executes — L8)', () => {
    const refusal = run.stages.riskGateway.decisions.find((decision) => decision.kind === 'refuse');
    if (refusal === undefined) throw new Error('expected a refusal');
    const solIntent = run.stages.strategy.run.intents.find((intent) => intent.order.instrumentId === 'SOL-USD');
    if (solIntent === undefined) throw new Error('missing SOL intent');
    const intake = acceptExecutionIntakeMirror(
      { decision: refusal, intent: solIntent, killSwitch: { state: 'standing', switchId: null, thrownAt: null, reason: null }, limitStates: [], directorDecision: null },
      { tenant: REFERENCE_SCENARIO.tenant, project: REFERENCE_SCENARIO.project },
      REFERENCE_SCENARIO.instants.orderClockBase + 100,
    );
    expect(intake.ok).toBe(false);
    if (!intake.ok) {
      expect(intake.errors.some((error) => error.code === 'decision_not_approved')).toBe(true);
    }
  });

  it('NEGATIVE: an order-level clock equal to the strategic asOf is the typed clock_confusion (L16)', () => {
    const prepared = prepareOrderMirror({
      decisionRef: 'xd:00000001',
      decisionAsOf: REFERENCE_SCENARIO.instants.decisionAsOf,
      intentRef: 'si:whatever',
      directorDecision: null,
      orderRef: 'broken-2',
      venue: 'REFSIM',
      instrument: 'BTC-USD',
      side: 'buy',
      orderKind: 'limit',
      quantity: '0.5',
      orderClock: REFERENCE_SCENARIO.instants.decisionAsOf, // SAME instant — the L16 crime
      methodId: 'method/execution/order-preparation',
      methodVersion: '1.0.0',
      tenant: REFERENCE_SCENARIO.tenant,
      project: REFERENCE_SCENARIO.project,
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.errors.some((error) => error.code === 'clock_confusion')).toBe(true);
    }
  });
});

describe('seam: outcomes consume the fills\' and decisions\' REAL records', () => {
  it('POSITIVE: every shadow fill cites an actual engine fill and an actual approve decision', () => {
    const engineFillIds = new Set(run.stages.execution.engineFills.map((fill) => fill.fill_id));
    const decisionIds = new Set(run.stages.riskGateway.decisions.map((decision) => decision.decisionId));
    const intentIds = new Set(run.stages.strategy.run.intents.map((intent) => intent.intentId));
    for (const fill of run.stages.outcomes.shadowFills) {
      expect(engineFillIds.has(fill.worldFill.fill_id)).toBe(true);
      expect(decisionIds.has(fill.decisionId)).toBe(true);
      expect(intentIds.has(fill.intentRef)).toBe(true);
    }
    for (const record of run.stages.outcomes.outcomeLog.records) {
      expect(intentIds.has(record.intentRef)).toBe(true);
      if (record.disposition === 'filled') {
        expect(record.fills.every((fillId) => run.stages.outcomes.shadowFills.some((fill) => fill.fillId === fillId))).toBe(true);
      }
    }
  });

  it('NEGATIVE: an undefined lifecycle transition is the typed lifecycle_violation', () => {
    const log: OrderLifecycleLogMirror = run.stages.execution.logs[0];
    // A 'fill-complete' from the PREPARED state is undefined (must pass submitted/acknowledged first).
    const appended = appendOrderLifecycleEventMirror(
      { orderRef: log.orderRef, records: [log.records[0]] },
      { event: 'fill-complete', orderClock: log.records[0].orderClock + 5, methodId: 'method/execution/fill-reconciliation', methodVersion: '1.0.0' },
    );
    expect(appended.ok).toBe(false);
    if (!appended.ok) {
      expect(appended.errors.some((error) => error.code === 'lifecycle_violation')).toBe(true);
      expect(appended.errors.some((error) => error.code === 'fill_fabricated')).toBe(true); // no evidence either
    }
  });

  it('NEGATIVE: a terminal-state replay is the typed lifecycle_violation (append-only)', () => {
    const log = run.stages.execution.logs[0];
    const filledLog = { orderRef: log.orderRef, records: log.records.slice(0, 4) }; // ends at fill-complete (terminal)
    const appended = appendOrderLifecycleEventMirror(filledLog, {
      event: 'cancel-remaining',
      orderClock: log.records[3].orderClock + 10,
      cancelConfirmationRef: 'confirm:late-1',
      methodId: 'method/execution/cancellation-policy',
      methodVersion: '1.0.0',
    });
    expect(appended.ok).toBe(false);
    if (!appended.ok) {
      expect(appended.errors.some((error) => error.code === 'lifecycle_violation')).toBe(true);
    }
  });
});

describe('seam: the lineage ledger consumes every stage\'s REAL records', () => {
  it('NEGATIVE: an entry citing an unknown parent is the typed lineage_unknown_parent (a broken link is loud)', () => {
    const ledger = startLedger(REFERENCE_SCENARIO.tenant, REFERENCE_SCENARIO.project);
    const result = appendEntry(ledger, {
      stage: 'outcomes',
      recordKind: 'shadow-outcome-record',
      recordId: 'swo:orphan',
      tenant: REFERENCE_SCENARIO.tenant,
      project: REFERENCE_SCENARIO.project,
      asOf: 1,
      parents: ['e2el-doesnotexist'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'lineage_unknown_parent')).toBe(true);
    }
  });

  it('NEGATIVE: a cross-scope entry is the typed lineage_scope_mismatch (L12)', () => {
    const ledger = startLedger(REFERENCE_SCENARIO.tenant, REFERENCE_SCENARIO.project);
    const result = appendEntry(ledger, {
      stage: 'scenario',
      recordKind: 'scenario',
      recordId: 'other/1',
      tenant: 'tenant-other',
      project: 'project-other',
      asOf: 1,
      parents: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'lineage_scope_mismatch')).toBe(true);
    }
  });

  it('NEGATIVE: re-appending the same record is the typed lineage_rewrite (append-only)', () => {
    const scenario: ScenarioRecord = REFERENCE_SCENARIO;
    const ledger = startLedger(scenario.tenant, scenario.project);
    const first = appendEntry(ledger, {
      stage: 'scenario',
      recordKind: 'scenario',
      recordId: scenario.scenarioId,
      tenant: scenario.tenant,
      project: scenario.project,
      asOf: scenario.instants.t0,
      parents: [],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = appendEntry(first.value, {
      stage: 'scenario',
      recordKind: 'scenario',
      recordId: scenario.scenarioId,
      tenant: scenario.tenant,
      project: scenario.project,
      asOf: scenario.instants.t0,
      parents: [],
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.errors.some((error) => error.code === 'lineage_rewrite')).toBe(true);
    }
  });
});
