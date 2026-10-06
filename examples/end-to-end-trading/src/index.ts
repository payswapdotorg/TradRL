// @tradrl/example-e2e-trading — the public surface.
//
// Owning Work Order: T048 — the REFERENCE END-TO-END SLICE: one
// deterministic, fully-wired demonstration of the whole trading pipeline
// (ARCHITECTURE.md lines 5-6 made runnable):
//
//   User goal -> organization -> bodies -> Agent OS -> market world ->
//   research -> strategy -> risk -> execution -> outcome
//
// Composition law (D-003/D-004): this package composes REAL merged
// packages' SHAPES via STRUCTURAL MIRRORS + injected ports — it imports
// NOTHING outside its own tree. The interop trip-wire tests under
// tests/end-to-end-trading/ import the REAL packages (@tradrl/agent-body,
// @tradrl/body-trading-director, @tradrl/body-execution,
// @tradrl/trading-strategy, @tradrl/execution-authority,
// @tradrl/exchange-sim, ...) and make mirror drift loud.
//
// Public surface, in dependency order:
//   primitives — the zero-dep foundation (canonical JSON + stable digests)
//   decimals   — exact decimal-string arithmetic (no float ever mediates)
//   ids        — the cross-lane identity prefix laws + minting formulas
//   scenario   — REFERENCE_SCENARIO: the frozen, fully-explicit scenario
//   mirrors/   — the structural mirrors of every consumed shape
//   lineage    — the L15 lineage ledger (append-only, chain-verified)
//   run        — runEndToEndScenario: the whole pipeline in one function
//   stream     — serializeRun: the byte-deterministic record stream

export * from './primitives';
export * from './decimals';
export * from './ids';
export * from './scenario';
export * from './mirrors/agent-body';
export * from './mirrors/agent-os';
export * from './mirrors/research';
export * from './mirrors/director';
export * from './mirrors/strategy';
export * from './mirrors/authority';
export * from './mirrors/execution';
export * from './mirrors/exchange';
export * from './mirrors/world';
export * from './lineage';
export * from './run';
export * from './stream';

/** The package identity card (the repo's governance convention). */
export const packageInfo = {
  name: '@tradrl/example-e2e-trading',
  owner: 'T048',
  status: 'implemented',
  concepts: [
    'REFERENCE_SCENARIO',
    'runEndToEndScenario',
    'EndToEndRunRecord',
    'serializeRun',
    'runStreamDigest',
    'LineageLedger',
    'traceToGoal',
    'composeDirectorDecision',
    'compileStrategyRun',
    'runExecutionGateMirror',
    'prepareOrderMirror',
    'submitOrderMirror',
    'ShadowOutcomeRecordMirror',
  ],
} as const;

// ---------------------------------------------------------------------------
// The runnable entry point (node/bun: `npx tsx examples/end-to-end-trading/src/index.ts`
// or import { runReferenceSlice } from '@tradrl/example-e2e-trading').
// ---------------------------------------------------------------------------

import { runEndToEndScenario, type EndToEndRunRecord, type RunResult } from './run';
import { serializeRun, runStreamDigest, ledgerStageSummary } from './stream';
import { traceToGoal, verifyLedger } from './lineage';

export interface ReferenceSliceReport {
  readonly runId: string;
  readonly streamDigest: string;
  readonly ledgerEntries: number;
  readonly ledgerStages: Readonly<Record<string, number>>;
  readonly intents: number;
  readonly approvals: number;
  readonly fills: number;
  readonly outcomes: number;
  readonly everyOutcomeTracesToGoal: boolean;
  readonly ledgerVerified: boolean;
  readonly streamBytes: number;
}

/** Runs the reference slice and returns the compact evidence report. */
export function runReferenceSlice(): { readonly run: EndToEndRunRecord; readonly report: ReferenceSliceReport } {
  const result: RunResult<EndToEndRunRecord> = runEndToEndScenario();
  if (!result.ok) {
    throw new Error(`reference slice failed: ${result.errors.map((error) => `${error.code}@${error.stage}: ${error.message}`).join('; ')}`);
  }
  const run = result.value;
  const ledgerCheck = verifyLedger(run.ledger);
  const outcomeEntries = run.ledger.entries.filter((entry) => entry.recordKind === 'shadow-outcome-record');
  const everyOutcomeTracesToGoal = outcomeEntries.every((entry) => traceToGoal(run.ledger, entry.entryId).ok);
  const report: ReferenceSliceReport = {
    runId: run.runId,
    streamDigest: runStreamDigest(run),
    ledgerEntries: run.ledger.entries.length,
    ledgerStages: ledgerStageSummary(run.ledger),
    intents: run.stages.strategy.run.intents.length,
    approvals: run.stages.riskGateway.decisions.filter((decision) => decision.kind === 'approve').length,
    fills: run.stages.outcomes.shadowFills.length,
    outcomes: run.stages.outcomes.outcomeLog.records.length,
    everyOutcomeTracesToGoal,
    ledgerVerified: ledgerCheck.ok,
    streamBytes: serializeRun(run).length,
  };
  return { run, report };
}

// CLI entry: print the report + the first/last stream lines when executed directly.
if (typeof process !== 'undefined' && process.argv[1] !== undefined && process.argv[1].includes('end-to-end-trading')) {
  const { run, report } = runReferenceSlice();
  const stream = serializeRun(run);
  const lines = stream.split('\n').filter((candidate) => candidate.length > 0);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`stream[first] ${lines[0]}\n`);
  process.stdout.write(`stream[last]  ${lines[lines.length - 1]}\n`);
}
