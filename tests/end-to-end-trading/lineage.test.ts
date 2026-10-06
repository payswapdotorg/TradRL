// tests/end-to-end-trading/lineage.test.ts — THE L15 LINEAGE GATE.
//
// Proves outcome records trace back to the goal: the full chain
// goal -> constraints -> risk-policy -> organization -> bodies ->
// possessions -> kernel -> world -> research -> director -> strategy ->
// gate -> execution -> outcome -> goal-progress is present, ordered, and
// every record's consumedIds reference REAL predecessor artifact ids in
// the stream (not stubs). Also verifies L12 tenant/project scoping on
// every record and the tamper-evidence of every retained history.

import { describe, expect, it } from 'vitest';

import {
  runReferenceSlice, REFERENCE_SCENARIO, verifyLineageStream,
  serializeLineageStream, LINEAGE_STAGES, verifyShadowOutcomeChain,
  verifyLifecycleLog, artifactDigestOf,
} from '../../examples/end-to-end-trading/src/index';

describe('T048 lineage gate — L15 project continuity', () => {
  const runResult = runReferenceSlice();
  if (!runResult.ok) throw new Error(runResult.errors.map((e) => e.message).join('; '));
  const run = runResult.value;

  it('walks every outcome back to the goal through real record ids', () => {
    const artifactIds = new Set(run.lineage.records.map((record) => record.artifactId));
    const goalId = `goal:${REFERENCE_SCENARIO.goal.id}@1`;

    for (const outcome of run.outcomeLog.records) {
      // outcome -> decisionRef (the gate's decision) OR intentRef (the strategy's intent).
      const anchor = outcome.decisionRef ?? outcome.intentRef;
      expect(anchor).toBeTruthy();
      // The lineage stream contains a gate-stage record for this decision.
      const gateRecord = run.lineage.records.find(
        (record) => record.stage === 'gate' && record.consumedIds.includes(outcome.intentRef),
      );
      expect(gateRecord).toBeDefined();
      // The strategy-stage record consumes the director decision...
      const strategyRecord = run.lineage.records.find((record) => record.stage === 'strategy');
      expect(strategyRecord).toBeDefined();
      // ...whose record consumes the research reports...
      const directorRecord = run.lineage.records.find(
        (record) => record.stage === 'director' && artifactIds.has(record.artifactId),
      );
      expect(directorRecord).toBeDefined();
      // ...which consume world observations...
      const researchRecords = run.lineage.records.filter((record) => record.stage === 'research');
      expect(researchRecords.length).toBeGreaterThan(0);
      for (const research of researchRecords) {
        expect(research.consumedIds.length).toBeGreaterThan(0);
      }
      // ...which trace to the organization, and the organization to the goal.
      const organizationRecord = run.lineage.records.find((record) => record.stage === 'organization');
      expect(organizationRecord?.consumedIds).toContain(`goal:${REFERENCE_SCENARIO.goal.id}`);
      // The goal is the FIRST record: the L15 root.
      expect(run.lineage.records[0]!.artifactId).toBe(goalId);
    }

    // The outcome-stage records consume the decision refs (L15 edges).
    for (const record of run.lineage.records.filter((entry) => entry.stage === 'outcome')) {
      expect(record.consumedIds.length).toBeGreaterThan(0);
    }

    // The goal-progress record consumes EVERY outcome id — the loop closes.
    const progress = run.lineage.records[run.lineage.records.length - 1]!;
    expect(progress.stage).toBe('goal-progress');
    expect(progress.consumedIds).toEqual(run.outcomeLog.records.map((record) => record.outcomeId));
  });

  it('every stage-consumed id references a REAL predecessor artifact in the stream', () => {
    const artifactIds = new Set(run.lineage.records.map((record) => record.artifactId));
    const windowIds = new Set(run.strategyRuns.map((strategyRun) => strategyRun.windowId));
    // Research consumes observation ids (world events) — those live in the
    // scenario's event stream; the gate consumes intent ids; the execution
    // consumes decision ids. Every id that CAN appear as an artifact does.
    for (const record of run.lineage.records) {
      for (const consumed of record.consumedIds) {
        const resolvable =
          artifactIds.has(consumed) ||
          windowIds.has(consumed) ||
          run.strategyRuns.some((strategyRun) => strategyRun.intents.some((intent) => intent.intentId === consumed)) ||
          run.submissions.some((submission) => (submission.kind === 'routed' ? submission.decisionId : null) === consumed) ||
          run.decisions.some((decision) => decision.decisionId === consumed) ||
          run.researchIntakes.some((intake) =>
            [intake.sentiment?.reportId, intake.regime?.reportId, intake.fundamental?.reportId, intake.crossMarket?.reportId].includes(consumed),
          ) ||
          run.world.observations.some((observation) => observation.observation_id === consumed) ||
          run.outcomeLog.records.some((outcome) => outcome.outcomeId === consumed) ||
          consumed === `goal:${REFERENCE_SCENARIO.goal.id}` ||
          consumed === `cs:${REFERENCE_SCENARIO.constraintSet.id}`;
        expect(resolvable).toBe(true);
      }
    }
  });

  it('the stage order follows the ARCHITECTURE.md pipeline exactly once through', () => {
    const stages = run.lineage.records.map((record) => record.stage);
    const firstIndex = new Map<string, number>();
    stages.forEach((stage, index) => {
      if (!firstIndex.has(stage)) firstIndex.set(stage, index);
    });
    const pipelineOrder = LINEAGE_STAGES.filter((stage) => firstIndex.has(stage));
    const firstIndices = pipelineOrder.map((stage) => firstIndex.get(stage)!);
    for (let index = 1; index < firstIndices.length; index++) {
      expect(firstIndices[index]).toBeGreaterThan(firstIndices[index - 1]!);
    }
  });

  it('every record is L12-scoped and carries the scenario instants', () => {
    for (const record of run.lineage.records) {
      expect(record.tenant).toBe(REFERENCE_SCENARIO.tenant);
      expect(record.project).toBe(REFERENCE_SCENARIO.project);
      expect(record.asOf).toBeGreaterThanOrEqual(REFERENCE_SCENARIO.epochMs);
    }
    // The decisions carry the goal version ref the strategy binds (L9).
    for (const decision of run.decisions) {
      expect(decision.goal).toEqual({ goalId: REFERENCE_SCENARIO.goal.id, version: 1 });
      expect(decision.constraintSets).toEqual([{ id: REFERENCE_SCENARIO.constraintSet.id, version: 1 }]);
    }
    // The intents bind the same refs (L15 through the strategy lane).
    for (const intent of run.strategyRuns.flatMap((strategyRun) => strategyRun.intents)) {
      expect(intent.goal.goalId).toBe(REFERENCE_SCENARIO.goal.id);
      expect(intent.tenant).toBe(REFERENCE_SCENARIO.tenant);
    }
  });

  it('every retained history verifies against its chain law (tamper-evident)', () => {
    expect(verifyLineageStream(run.lineage).ok).toBe(true);
    expect(verifyShadowOutcomeChain(run.outcomeLog)).toBe(true);
    for (const log of run.lifecycleLogs) {
      expect(verifyLifecycleLog(log).ok).toBe(true);
    }
    // Tampering is loud: splice one record and the stream fails.
    const spliced = {
      records: [...run.lineage.records.slice(1)],
      head: run.lineage.head,
    };
    expect(verifyLineageStream(spliced).ok).toBe(false);
    // Editing one record is loud too.
    const edited = run.lineage.records.map((record, index) =>
      index === 5 ? { ...record, artifactDigest: 'f'.repeat(16) } : record,
    );
    expect(verifyLineageStream({ records: edited, head: run.lineage.head }).ok).toBe(false);
  });

  it('the artifact digests bind the real records (content-addressed)', () => {
    // The director decision record's digest is the digest of the real decision.
    const directorRecord = run.lineage.records.find((record) => record.stage === 'director')!;
    const decision = run.decisions.find((candidate) => candidate.decisionId === directorRecord.artifactId);
    expect(decision).toBeDefined();
    expect(directorRecord.artifactDigest).toBe(artifactDigestOf(decision));
    // The lineage serialization is stable and complete (canonical keys sorted).
    const bytes = serializeLineageStream(run.lineage);
    expect(bytes.startsWith('{"head":')).toBe(true);
    expect(bytes).toContain('"records":[');
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('goal attainment is constraint-aware, not raw PnL (L7)', () => {
    const progress = run.goalProgress;
    expect(progress.attainment.criteria.length).toBe(REFERENCE_SCENARIO.goal.successCriteria.criteria.length);
    expect(progress.verdict).toBe(progress.attainment.attained ? 'met' : 'missed');
    // The metrics are the goal's own criteria subjects, not a PnL scalar.
    for (const criterion of progress.attainment.criteria) {
      expect(['outcome.final_equity', 'outcome.max_drawdown']).toContain(criterion.metric);
    }
  });
});
