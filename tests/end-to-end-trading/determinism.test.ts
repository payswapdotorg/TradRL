// tests/end-to-end-trading/determinism.test.ts — THE DETERMINISM TESTS
// (suite 5b).
//
// Work Order T048: "a determinism test (two runs, byte-identical streams)"
// and the law: "the whole run is byte-reproducible from its scenario file
// (determinism test required)". Identical inputs -> identical bytes: the
// run id, every derived identity, the ledger head, the outcome head and
// the COMPLETE serialized record stream must be equal across runs. The
// golden digests are pinned so any accidental nondeterminism (an ambient
// clock, a random draw, a map iteration order) is loud.

import { describe, expect, it } from 'vitest';
import {
  type ScenarioRecord,
  runEndToEndScenario,
  runReferenceSlice,
  serializeRun,
  runStreamDigest,
  REFERENCE_SCENARIO,
} from '../../examples/end-to-end-trading/src/index';

const first = runEndToEndScenario();
const second = runEndToEndScenario();
const third = runEndToEndScenario();
if (!first.ok || !second.ok || !third.ok) throw new Error('the reference slice failed to run');

describe('T048 determinism: identical scenario in, byte-identical run out', () => {
  it('two runs produce the SAME run id (derived identities are stable)', () => {
    expect(second.value.runId).toBe(first.value.runId);
    expect(third.value.runId).toBe(first.value.runId);
    expect(first.value.runId).toMatch(/^e2e-[0-9a-f]{16}$/);
  });

  it('two runs produce BYTE-IDENTICAL serialized streams (the whole record stream)', () => {
    const streamA = serializeRun(first.value);
    const streamB = serializeRun(second.value);
    const streamC = serializeRun(third.value);
    expect(streamB).toBe(streamA); // byte-for-byte
    expect(streamC).toBe(streamA);
    expect(streamA.length).toBeGreaterThan(100_000);
    // The line count and the line PREFIXES are identical too (kind order is deterministic).
    const linesA = streamA.split('\n');
    const linesB = streamB.split('\n');
    expect(linesA.length).toBe(linesB.length);
    expect(linesA.map((line) => line.slice(0, line.indexOf(' ')))).toEqual(linesB.map((line) => line.slice(0, line.indexOf(' '))));
  });

  it('the stream digest is stable across runs and pinned (the golden anchor)', () => {
    const digestA = runStreamDigest(first.value);
    const digestB = runStreamDigest(second.value);
    expect(digestA).toBe(digestB);
    expect(digestA).toMatch(/^[0-9a-f]{16}$/);
    // THE GOLDEN PIN: any change to the scenario, the pipeline, the mirrors
    // or the serialization changes this digest — determinism is enforceable.
    expect(digestA).toBe('c4565e45899d0c9a');
    expect(first.value.runId).toBe('e2e-8852181caae797a9');
  });

  it('every derived identity is stable across runs (ids, heads, digests)', () => {
    expect(second.value.ledger.head).toBe(first.value.ledger.head);
    expect(second.value.ledger.entries.map((entry) => entry.entryId)).toEqual(first.value.ledger.entries.map((entry) => entry.entryId));
    expect(second.value.stages.outcomes.outcomeLog.head).toBe(first.value.stages.outcomes.outcomeLog.head);
    expect(second.value.stages.research.sentiment?.reportId).toBe(first.value.stages.research.sentiment?.reportId);
    expect(second.value.stages.research.regime?.reportId).toBe(first.value.stages.research.regime?.reportId);
    expect(second.value.stages.research.fundamental?.reportId).toBe(first.value.stages.research.fundamental?.reportId);
    expect(second.value.stages.research.crossMarket?.reportId).toBe(first.value.stages.research.crossMarket?.reportId);
    if (first.value.stages.director.outcome.kind === 'decision' && second.value.stages.director.outcome.kind === 'decision') {
      expect(second.value.stages.director.outcome.decision.decisionId).toBe(first.value.stages.director.outcome.decision.decisionId);
    }
    expect(second.value.stages.strategy.run.runId).toBe(first.value.stages.strategy.run.runId);
    expect(second.value.stages.strategy.run.intents.map((intent) => intent.intentId)).toEqual(
      first.value.stages.strategy.run.intents.map((intent) => intent.intentId),
    );
    expect(second.value.stages.riskGateway.decisions.map((decision) => decision.decisionId)).toEqual(
      first.value.stages.riskGateway.decisions.map((decision) => decision.decisionId),
    );
    expect(second.value.stages.riskGateway.auditRecords.map((record) => record.auditId)).toEqual(
      first.value.stages.riskGateway.auditRecords.map((record) => record.auditId),
    );
    expect(second.value.stages.execution.logs.map((log) => log.records.map((record) => record.lifecycleId))).toEqual(
      first.value.stages.execution.logs.map((log) => log.records.map((record) => record.lifecycleId)),
    );
  });

  it('the kernel op log is deterministic (same op ids, same envelope ids, same order)', () => {
    expect(second.value.stages.bodies.kernelOps).toEqual(first.value.stages.bodies.kernelOps);
    expect(second.value.stages.bodies.envelopes).toEqual(first.value.stages.bodies.envelopes);
    // Envelope ids follow the kernel formula msg:opId:sender:sequence.
    const envelope = first.value.stages.bodies.envelopes[0];
    expect(envelope.id).toBe(`msg:${envelope.causalityId}:${envelope.sender}:1`);
  });

  it('the compact evidence report is stable (runReferenceSlice wraps the same run)', () => {
    const reportA = runReferenceSlice().report;
    const reportB = runReferenceSlice().report;
    expect(reportB).toEqual(reportA);
    expect(reportA.runId).toBe(first.value.runId);
    expect(reportA.ledgerVerified).toBe(true);
    expect(reportA.everyOutcomeTracesToGoal).toBe(true);
    expect(reportA.intents).toBe(3);
    expect(reportA.approvals).toBe(2);
    expect(reportA.fills).toBe(2);
    expect(reportA.outcomes).toBe(3);
  });

  it('the scenario itself is frozen (deeply immutable)', () => {
    expect(() => {
      (REFERENCE_SCENARIO as unknown as { tenant: string }).tenant = 'mutated';
    }).toThrow();
    expect(REFERENCE_SCENARIO.tenant).toBe('tenant-e2e');
  });

  it('a mutated scenario produces a DIFFERENT stream (the digest is change-sensitive)', () => {
    const mutated = structuredClone(REFERENCE_SCENARIO) as unknown as ScenarioRecord & { initialCash: string };
    mutated.initialCash = '100001'; // one digit different
    const mutatedRun = runEndToEndScenario(mutated);
    expect(mutatedRun.ok).toBe(true);
    if (!mutatedRun.ok) return;
    expect(mutatedRun.value.runId).not.toBe(first.value.runId);
    expect(serializeRun(mutatedRun.value)).not.toBe(serializeRun(first.value));
  });
});
