// tests/end-to-end-trading/lineage.test.ts — THE LINEAGE TESTS (suite 5a).
//
// Work Order T048: "a lineage test proving outcome records trace back to
// the goal (L15)". The ledger is append-only and chain-verified; tampering,
// reordering or re-scoping any entry is a typed error; and EVERY outcome
// record reaches the goal root through REAL parent links (the records its
// stage actually consumed).

import { describe, expect, it } from 'vitest';
import {
  runEndToEndScenario,
  REFERENCE_SCENARIO,
  traceToGoal,
  verifyLedger,
  appendEntry,
  startLedger,
  entriesOfStage,
  entryOfRecord,
  deepCloneJson,
  type LineageLedger,
  type LineageEntry,
} from '../../examples/end-to-end-trading/src/index';

const runResult = runEndToEndScenario();
if (!runResult.ok) throw new Error(`reference slice failed: ${JSON.stringify(runResult.errors)}`);
const run = runResult.value;
const ledger: LineageLedger = run.ledger;

describe('T048 lineage (L15): the outcome records trace back to the goal', () => {
  it('EVERY outcome record traces to the goal entry through real parent links', () => {
    const outcomeEntries = entriesOfStage(ledger, 'outcomes').filter((entry) => entry.recordKind === 'shadow-outcome-record');
    expect(outcomeEntries.length).toBeGreaterThanOrEqual(3);
    for (const entry of outcomeEntries) {
      const trace = traceToGoal(ledger, entry.entryId);
      expect(trace.ok, `outcome ${entry.recordId} must trace to the goal`).toBe(true);
      if (!trace.ok) continue;
      expect(trace.value.goalEntry.recordKind).toBe('goal-statement');
      expect(trace.value.goalEntry.recordId).toBe(REFERENCE_SCENARIO.goal.id);
      expect(trace.value.path.length).toBeGreaterThanOrEqual(4); // outcome -> intent -> run/decision -> goal
    }
  });

  it('the FILLED outcome path crosses the REAL research, director and strategy stages (the full pipeline lineage)', () => {
    const filledOutcome = ledger.entries.find(
      (entry) => entry.recordKind === 'shadow-outcome-record' && run.stages.outcomes.outcomeLog.records.some((record) => record.outcomeId === entry.recordId && record.disposition === 'filled'),
    );
    expect(filledOutcome).toBeDefined();
    if (filledOutcome === undefined) return;
    const trace = traceToGoal(ledger, filledOutcome.entryId);
    expect(trace.ok).toBe(true);
    if (!trace.ok) return;
    const entriesOnPath = trace.value.path.map((entryId) => ledger.entries.find((entry) => entry.entryId === entryId) as LineageEntry);
    const stagesOnPath = new Set(entriesOnPath.map((entry) => entry.stage));
    // The outcome inherits from the strategy lane, which inherits from the
    // director decision, which inherits from the research reports and the goal.
    expect(stagesOnPath.has('strategy')).toBe(true);
    expect(stagesOnPath.has('director')).toBe(true);
    expect(stagesOnPath.has('scenario')).toBe(true);
    // The director decision entry's parents include the research report entries (REAL records).
    const directorEntry = entriesOnPath.find((entry) => entry.recordKind === 'director-decision');
    expect(directorEntry).toBeDefined();
    if (directorEntry !== undefined) {
      const reportEntries = directorEntry.parents
        .map((parent) => ledger.entries.find((entry) => entry.entryId === parent))
        .filter((entry): entry is LineageEntry => entry !== undefined && entry.recordKind === 'research-report');
      expect(reportEntries.length).toBeGreaterThanOrEqual(4); // all four lanes are cited
    }
  });

  it('the goal is reachable from a fill entry too (every leaf carries the lineage)', () => {
    const fillEntry = ledger.entries.find((entry) => entry.recordKind === 'shadow-fill');
    expect(fillEntry).toBeDefined();
    if (fillEntry === undefined) return;
    const trace = traceToGoal(ledger, fillEntry.entryId);
    expect(trace.ok).toBe(true);
    if (!trace.ok) return;
    expect(trace.value.goalEntry.recordId).toBe(REFERENCE_SCENARIO.goal.id);
  });

  it('the ledger chain verifies end-to-end (append-only, fnv-folded)', () => {
    const verification = verifyLedger(ledger);
    expect(verification.ok).toBe(true);
  });

  it('TAMPERING with any entry breaks the chain with the typed lineage_chain error', () => {
    const tampered = deepCloneJson(ledger) as unknown as { entries: { asOf: number }[] & LineageLedger['entries'] };
    const victim = tampered.entries[Math.floor(tampered.entries.length / 2)] as unknown as { asOf: number };
    victim.asOf += 1; // a single edited field anywhere in the history
    const verification = verifyLedger(tampered as unknown as LineageLedger);
    expect(verification.ok).toBe(false);
    if (!verification.ok) {
      expect(verification.errors.some((error) => error.code === 'lineage_chain')).toBe(true);
    }
  });

  it('REORDERING entries breaks the chain (the fold is order-sensitive)', () => {
    const reordered = deepCloneJson(ledger) as unknown as { entries: LineageEntry[] };
    const swap = reordered.entries[10] as LineageEntry;
    reordered.entries[10] = reordered.entries[11] as LineageEntry;
    reordered.entries[11] = swap;
    const verification = verifyLedger(reordered as unknown as LineageLedger);
    expect(verification.ok).toBe(false);
  });

  it('SPACING an entry out (removing a link) breaks the chain', () => {
    const spliced = deepCloneJson(ledger) as unknown as { entries: LineageEntry[] };
    spliced.entries.splice(20, 1);
    const verification = verifyLedger(spliced as unknown as LineageLedger);
    expect(verification.ok).toBe(false);
  });

  it('a tampered chain head is detectable even when the content is intact', () => {
    const tampered = deepCloneJson(ledger) as unknown as { entries: { chainHead: string }[] };
    tampered.entries[tampered.entries.length - 1].chainHead = 'deadbeef';
    const verification = verifyLedger(tampered as unknown as LineageLedger);
    expect(verification.ok).toBe(false);
  });

  it('no entry may cite a parent from a foreign tenant scope (L12 inexpressible)', () => {
    // A fresh ledger under a different scope cannot adopt this ledger's entries as parents.
    const foreign = startLedger('tenant-other', 'project-other');
    const result = appendEntry(foreign, {
      stage: 'outcomes',
      recordKind: 'shadow-outcome-record',
      recordId: 'swo:cross-scope',
      tenant: 'tenant-other',
      project: 'project-other',
      asOf: 1,
      parents: [ledger.entries[0].entryId],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'lineage_unknown_parent')).toBe(true);
    }
  });

  it('the outcome lineage block cites the goal, the policies and the world digests (L9/L15)', () => {
    for (const record of run.stages.outcomes.outcomeLog.records) {
      expect(record.lineage.tenant).toBe(REFERENCE_SCENARIO.tenant);
      expect(record.lineage.project).toBe(REFERENCE_SCENARIO.project);
      expect(record.lineage.executionPolicy.policyId).toBe(REFERENCE_SCENARIO.executionPolicy.policyId);
      expect(record.lineage.riskPolicy.policyId).toBe(REFERENCE_SCENARIO.riskPolicy.policyId);
      expect(record.lineage.configDigests.worldConfigHash).toMatch(/^[0-9a-f]{8}$/);
      expect(record.lineage.configDigests.engineConfigHash).toMatch(/^[0-9a-f]{8}$/);
      expect(record.lineage.fidelity).toEqual({ mode: 'shadow', fill_origin: 'simulated' });
      expect(record.lineage.seed).toBe(REFERENCE_SCENARIO.seeds.world);
    }
  });

  it('the ledger spans the whole declared pipeline (every stage contributed entries)', () => {
    const stages = new Set(ledger.entries.map((entry) => entry.stage));
    expect([...stages].sort()).toEqual(
      [
        'bodies',
        'director',
        'execution',
        'market-world',
        'organization',
        'outcomes',
        'research',
        'risk-gateway',
        'scenario',
        'strategy',
      ].sort(),
    );
  });

  it('record lookups resolve the REAL derived identities (entryOfRecord finds the decision by its dd- id)', () => {
    if (run.stages.director.outcome.kind !== 'decision') throw new Error('expected a decision');
    const decisionId = run.stages.director.outcome.decision.decisionId;
    const entry = entryOfRecord(ledger, decisionId);
    expect(entry).not.toBeNull();
    expect(entry?.recordKind).toBe('director-decision');
    expect(entry?.stage).toBe('director');
  });
});
