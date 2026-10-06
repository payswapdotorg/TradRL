// tests/end-to-end-trading/run.test.ts — THE INTEGRATION GATE (suite 1/5).
//
// Work Order T048: the slice runs green from a clean clone. This suite runs
// the WHOLE reference pipeline end-to-end and asserts every stage emitted
// its records, every chain verifies, and the composition laws hold (L4/L8/
// L12/L15/L16). THE ONLY tests that import the example package together
// with the REAL workspace packages are the interop trip-wires (suite 2);
// this suite imports the example only.

import { describe, expect, it } from 'vitest';
import {
  runReferenceSlice,
  serializeRun,
  runStreamDigest,
  PIPELINE_STAGES,
  REFERENCE_SCENARIO,
} from '../../examples/end-to-end-trading/src/index';

const slice = runReferenceSlice();
const run = slice.run;

describe('T048 reference slice: the whole pipeline runs green', () => {
  it('runs the ten declared stages in order with every stage emitting records', () => {
    for (const stage of PIPELINE_STAGES) {
      expect(slice.report.ledgerStages[stage], `stage ${stage} emitted records`).toBeGreaterThan(0);
    }
    expect(PIPELINE_STAGES).toEqual([
      'scenario',
      'organization',
      'bodies',
      'market-world',
      'research',
      'director',
      'strategy',
      'risk-gateway',
      'execution',
      'outcomes',
    ]);
  });

  it('the scenario root is the goal (L15): the ledger opens with scenario + goal + constraints', () => {
    const scenarioStage = run.ledger.entries.filter((entry) => entry.stage === 'scenario');
    expect(scenarioStage.map((entry) => entry.recordKind)).toEqual(['scenario', 'goal-statement', 'constraint-set']);
    expect(scenarioStage[1].recordId).toBe(REFERENCE_SCENARIO.goal.id);
  });

  it('the organization is compiled within the declared budget (7 agents, 6 topic wires)', () => {
    const { blueprint, organization } = run.stages.organization;
    expect(blueprint.agentCount).toBe(7);
    expect(blueprint.agentCount).toBeLessThanOrEqual(REFERENCE_SCENARIO.budget.maxAgentCount);
    expect(blueprint.assignments).toHaveLength(7);
    expect(blueprint.topology.wires).toHaveLength(6);
    expect(organization.memberships).toHaveLength(7);
    expect(organization.status).toBe('active');
  });

  it('seven bodies with possessions and instances spawn through the kernel (L8 authority laws hold)', () => {
    const { bodies, possessions, instances, kernelOps } = run.stages.bodies;
    expect(bodies).toHaveLength(7);
    expect(possessions).toHaveLength(7);
    expect(instances).toHaveLength(7);
    // The director holds NO execution authority; the execution body is external-gateway-only (L8/L20).
    const director = bodies.find((body) => body.bodyId === 'trading-director');
    const execution = bodies.find((body) => body.bodyId === 'execution');
    expect(director?.composition.authorityBoundary.executionAuthority).toBe('none');
    expect(director?.composition.authorityBoundary.prohibitedActions).toContain('EXECUTE');
    expect(execution?.composition.authorityBoundary.executionAuthority).toBe('external-gateway-only');
    // The kernel log: 7 SPAWN + 6 SUBSCRIBE + 8 PUBLISH + 2 REQUEST + 3 REPORT ops, deterministic ids.
    const spawns = kernelOps.filter((op) => op.type === 'SPAWN');
    const subscribes = kernelOps.filter((op) => op.type === 'SUBSCRIBE');
    const publishes = kernelOps.filter((op) => op.type === 'PUBLISH');
    const requests = kernelOps.filter((op) => op.type === 'REQUEST');
    const reports = kernelOps.filter((op) => op.type === 'REPORT');
    expect(spawns).toHaveLength(7);
    expect(subscribes).toHaveLength(6);
    expect(publishes).toHaveLength(8); // 4 research reports + 1 decision + 3 intents
    expect(requests).toHaveLength(2); // the two approved intents REQUEST through the gateway
    expect(reports).toHaveLength(3); // one REPORT per outcome record
    expect(kernelOps[0].opId).toBe('op-0001');
    expect(kernelOps.every((op) => op.tenantId === REFERENCE_SCENARIO.tenant)).toBe(true);
  });

  it('the market world admits every recorded event point-in-time (L4, inclusive boundary)', () => {
    const { machineRecords, view } = run.stages.marketWorld;
    expect(machineRecords).toHaveLength(REFERENCE_SCENARIO.stream.length);
    expect(view.at).toBe(REFERENCE_SCENARIO.instants.researchAsOf);
    expect(view.records.every((record) => record.available_time <= view.at)).toBe(true);
    expect(view.audit.scanned).toBe(machineRecords.length);
    expect(view.audit.decisions.every((decision) => decision.decision === 'included')).toBe(true);
    // Reactive observations carry origin 'historical' for stream events (L5).
    expect(run.stages.marketWorld.observations.every((observation) => observation.provenance.origin === 'historical')).toBe(true);
  });

  it('the four research bodies publish REAL, guard-passing reports with typed data gaps', () => {
    const research = run.stages.research;
    if (research.sentiment === null || research.regime === null || research.fundamental === null || research.crossMarket === null) {
      throw new Error('a research lane is absent');
    }
    // Report ids carry the lane prefixes.
    expect(research.sentiment.reportId.startsWith('rr-')).toBe(true);
    expect(research.regime.reportId.startsWith('rr-')).toBe(true);
    expect(research.fundamental.reportId.startsWith('frr-')).toBe(true);
    expect(research.crossMarket.reportId.startsWith('cmrr-')).toBe(true);
    // The scenario lanes: sentiment positive (BTC), regime trending-up, fundamental positive, cross-market co-movement.
    expect(research.sentiment.summary.dominantPolarity).toBe('positive');
    expect(research.regime.summary.dominantRegime).toBe('trending-up');
    expect(research.fundamental.summary.dominantStance).toBe('positive');
    expect(research.crossMarket.summary.dominantRelationKind).toBe('co-movement');
    // Typed data gaps for the uncovered instruments (never silence).
    expect(research.sentiment.summary.dataGaps.map((gap) => gap.instrument).sort()).toEqual(['ETH-USD', 'SOL-USD']);
    expect(research.fundamental.summary.dataGaps.map((gap) => gap.instrument).sort()).toEqual(['ETH-USD', 'SOL-USD']);
    // L4: every report is as-of the research instant, BEFORE the decision instant.
    expect(research.sentiment.asOf).toBeLessThan(REFERENCE_SCENARIO.instants.decisionAsOf);
  });

  it('the director produces a REAL decision via the declared synthesis method (quorum met, no conflicts)', () => {
    expect(run.stages.director.outcome.kind).toBe('decision');
    if (run.stages.director.outcome.kind !== 'decision') return;
    const decision = run.stages.director.outcome.decision;
    expect(decision.decisionId.startsWith('dd-')).toBe(true);
    expect(decision.methodId).toBe('method/director/synthesis');
    expect(decision.methodVersion).toBe('1.0.0');
    expect(decision.coverage.every((lane) => lane.status === 'consumed')).toBe(true); // all four lanes present
    expect(decision.conflicts).toHaveLength(0);
    expect(decision.directive.kind).toBe('allocation-adjustment');
    if (decision.directive.kind === 'allocation-adjustment') {
      expect(decision.directive.adjustments).toHaveLength(1);
      expect(decision.directive.adjustments[0].instrumentId).toBe('BTC-USD');
      expect(decision.directive.adjustments[0].netTilt).toBe('3.0000');
      expect(decision.directive.adjustments[0].deltaWeight).toBe('0.0300');
    }
    // The directive is portfolio-level ONLY — no order-level vocabulary anywhere (L16).
    expect(JSON.stringify(decision.directive)).not.toMatch(/order|execution|placement|ticket/i);
  });

  it('the strategy binds the directive and emits constraint-proved, lot-fenced intents', () => {
    const { spec, run: strategyRun } = run.stages.strategy;
    // The directive moved BTC's target weight above the equal-weight base.
    const weights = new Map(spec.allocation.kind === 'fixed_weights' ? spec.allocation.weights.map((w) => [w.instrumentId, w.weight]) : []);
    expect(weights.get('BTC-USD')).toBe('0.3633'); // 1/3 (0.3333) + 0.0300
    expect(weights.get('ETH-USD')).toBe('0.3333');
    expect(strategyRun.intents).toHaveLength(3);
    expect(strategyRun.refusals).toHaveLength(0);
    for (const intent of strategyRun.intents) {
      expect(intent.intentId.startsWith('si:')).toBe(true);
      expect(intent.constraintProof.satisfied.length).toBeGreaterThan(0); // the gate ran BEFORE emission
      expect(intent.goal.goalId).toBe(REFERENCE_SCENARIO.goal.id); // L15 goal binding
      expect(intent.order.venueId).toBe('REFSIM');
    }
    const btc = strategyRun.intents.find((intent) => intent.order.instrumentId === 'BTC-USD');
    expect(btc?.order.quantity).toBe('0.71500000'); // lot-fenced 0.7157... -> 0.715 on the 0.001 grid
    expect(btc?.rationale.kind).toBe('initial_allocation');
  });

  it('the gateway runs the whole gate stack: 2 approvals + 1 TYPED limits refusal, audit-chained (L8)', () => {
    const { decisions, auditRecords, submissions } = run.stages.riskGateway;
    expect(decisions).toHaveLength(3);
    const approvals = decisions.filter((decision) => decision.kind === 'approve');
    const refusals = decisions.filter((decision) => decision.kind === 'refuse');
    expect(approvals).toHaveLength(2);
    expect(refusals).toHaveLength(1);
    // The refusal is a RECORD with the typed limits dimension — never an exception.
    const refusal = refusals[0];
    expect(refusal.failure.dimension).toBe('limits');
    if (refusal.failure.reason.dimension === 'limits') {
      expect(refusal.failure.reason.limit).toBe('order_size'); // SOL-USD 332.9 > the 20-unit cap
    }
    // Every decision id is content-addressed in the xd: space.
    expect(decisions.every((decision) => decision.decisionId.startsWith('xd:'))).toBe(true);
    // One audit record per submission, sequenced and chain-verified.
    expect(auditRecords).toHaveLength(3);
    expect(auditRecords.map((record) => record.sequence)).toEqual([1, 2, 3]);
    // The refused audit carries NO order block and NO execution (zero adapter calls).
    const refusedAudit = auditRecords.find((record) => record.outcome === 'refused');
    expect(refusedAudit?.order).toBeNull();
    expect(refusedAudit?.execution).toBeNull();
    // Submissions: 2 routed + 1 refused.
    expect(submissions.filter((submission) => submission.kind === 'routed')).toHaveLength(2);
    expect(submissions.filter((submission) => submission.kind === 'refused')).toHaveLength(1);
  });

  it('the execution body runs the order lifecycle on its OWN clock and reconciles exactly (L16)', () => {
    const { logs, reconciliations, reactiveFills } = run.stages.execution;
    expect(logs).toHaveLength(2); // one per APPROVED decision
    for (const log of logs) {
      expect(log.records[0].event).toBe('prepare');
      expect(log.records[0].from).toBeNull();
      expect(log.records[log.records.length - 1].to).toBe('filled');
      // L16: every record's order-level clock is strictly after the strategic decision asOf.
      for (const record of log.records) {
        expect(record.orderClock).toBeGreaterThan(record.decisionAsOf);
        expect(record.orderClock).not.toBe(record.decisionAsOf);
      }
      // The chain of custody: decisionRef (xd:) + intentRef (si:) + directorDecisionRef (dd-) on every record (L15).
      for (const record of log.records) {
        expect(record.decisionRef.startsWith('xd:')).toBe(true);
        expect(record.intentRef.startsWith('si:')).toBe(true);
        expect(record.directorDecisionRef?.startsWith('dd-')).toBe(true);
      }
    }
    expect(reconciliations).toHaveLength(2);
    expect(reconciliations.every((record) => record.status === 'reconciled' && record.gap === null)).toBe(true);
    // Engine fills carry the availability quartet (L4/L6) and the physics lineage.
    expect(reactiveFills).toHaveLength(2);
    for (const fill of reactiveFills) {
      expect(fill.fill.quartet.available_time).toBeGreaterThan(fill.fill.quartet.event_time); // the declared latency
      expect(fill.physics.engine_config_hash).toMatch(/^[0-9a-f]{8}$/);
      expect(fill.taker_participant).toBe('agent/e2e-execution');
    }
  });

  it('the shadow lane settles the outcomes: 2 filled + 1 refused, chain-verified log (L15)', () => {
    const { book, shadowFills, outcomeLog } = run.stages.outcomes;
    expect(shadowFills).toHaveLength(2);
    expect(shadowFills.every((fill) => fill.fillId.startsWith('swf-'))).toBe(true);
    expect(outcomeLog.records).toHaveLength(3);
    expect(outcomeLog.records.filter((record) => record.disposition === 'filled')).toHaveLength(2);
    expect(outcomeLog.records.filter((record) => record.disposition === 'refused')).toHaveLength(1);
    expect(outcomeLog.head).toMatch(/^[0-9a-f]{8}$/);
    // The refused outcome cites its refusal ref (a RECORD, never silence).
    const refusedOutcome = outcomeLog.records.find((record) => record.disposition === 'refused');
    expect(refusedOutcome?.refusalRef).toMatch(/^swr:/);
    expect(refusedOutcome?.fills).toEqual([]);
    // The shadow book holds the two filled positions with exact decimals.
    expect(book.positions.map((position) => position.instrument).sort()).toEqual(['BTC-USD', 'ETH-USD']);
    expect(book.cash).toMatch(/^\d/);
    // The lineage block carries the mode-honesty declaration (L5/R23): fills are simulated.
    expect(outcomeLog.records[0].lineage.fidelity).toEqual({ mode: 'shadow', fill_origin: 'simulated' });
    expect(outcomeLog.records[0].lineage.tenant).toBe(REFERENCE_SCENARIO.tenant);
  });

  it('every record in the byte stream carries the tenant/project scope (L12)', () => {
    const stream = serializeRun(run);
    for (const line of stream.split('\n')) {
      if (line.length === 0) continue;
      const kind = line.slice(0, line.indexOf(' '));
      // Records with explicit scope fields must all cite the scenario scope.
      // (BodyVersion records deliberately carry NO tenant — the scope enters
      // at the possession/instance level, mirroring @tradrl/agent-body's law.
      // Kernel ops carry the tenant only — mirroring @tradrl/agent-os's
      // KernelOperationBase, which has no project field.)
      const tenantOnly = kind === 'kernel-op';
      if (/scenario|organization-blueprint|kernel-op|research-report|director-decision|strategy-run|gate-decision|gateway-audit-record|reactive-fill|shadow-outcome-record|lineage-entry/.test(kind)) {
        // The scope appears as tenant/tenantId and project/projectId depending
        // on the owning lane's field naming — both cite the scenario scope.
        expect(line).toContain('tenant-e2e');
        if (!tenantOnly) expect(line).toContain('project-e2e');
      }
    }
    expect(stream).toContain('"tenant":"tenant-e2e"');
    expect(stream).toContain('"project":"project-e2e"');
  });

  it('the ledger chain verifies and every outcome traces to the goal (L15)', () => {
    expect(slice.report.ledgerVerified).toBe(true);
    expect(slice.report.everyOutcomeTracesToGoal).toBe(true);
    expect(runStreamDigest(run)).toMatch(/^[0-9a-f]{16}$/);
    expect(slice.report.streamBytes).toBeGreaterThan(100_000); // a real, complete record stream
  });
});
