// @tradrl/example-e2e-trading — THE BYTE STREAM (the determinism contract).
//
// `serializeRun` renders the WHOLE run — every stage's records, in the
// declared pipeline order — as one newline-delimited canonical-JSON stream
// ending in a digest line. Identical scenario in, byte-identical stream out:
// the determinism test pins exactly this. `runStreamDigest` folds the whole
// stream into the 16-hex L9 digest the completion evidence cites.

import { canonicalJson, stableDigest, type JsonValue } from './primitives';
import type { EndToEndRunRecord } from './run';
import { PIPELINE_STAGES, type LineageLedger } from './lineage';

/** One stream line: the record kind + its canonical JSON (sorted keys). */
function line(kind: string, record: unknown): string {
  return `${kind} ${canonicalJson(record as JsonValue)}`;
}

/**
 * Serializes the run byte-deterministically: stage by stage (the declared
 * PIPELINE_STAGES order), record by record (append order), then the whole
 * lineage ledger, then the digest footer.
 */
export function serializeRun(run: EndToEndRunRecord): string {
  const lines: string[] = [];
  const stages = run.stages;

  // -- scenario --------------------------------------------------------------
  lines.push(line('scenario', { scenarioId: run.scenarioId, tenant: run.tenant, project: run.project, asOfRange: run.asOfRange }));
  lines.push(line('goal-statement', stages.scenario.goal));
  lines.push(line('constraint-set', stages.scenario.constraintSet));

  // -- organization ----------------------------------------------------------
  lines.push(line('organization-blueprint', stages.organization.blueprint));
  lines.push(line('organization', stages.organization.organization));

  // -- bodies ----------------------------------------------------------------
  for (const body of stages.bodies.bodies) lines.push(line('body-version', body));
  for (const possession of stages.bodies.possessions) lines.push(line('possession', possession));
  for (const instance of stages.bodies.instances) lines.push(line('agent-instance', instance));
  for (const op of stages.bodies.kernelOps) lines.push(line('kernel-op', op));
  for (const envelope of stages.bodies.envelopes) lines.push(line('message-envelope', envelope));

  // -- market world ----------------------------------------------------------
  for (const record of stages.marketWorld.machineRecords) lines.push(line('time-machine-record', record));
  lines.push(line('as-of-view', stages.marketWorld.view));
  for (const hash of stages.marketWorld.engineConfigHashes) lines.push(line('engine-config-hash', hash));
  for (const observation of stages.marketWorld.observations) lines.push(line('world-observation', observation));

  // -- research --------------------------------------------------------------
  if (stages.research.sentiment !== null) lines.push(line('research-report/sentiment', stages.research.sentiment));
  if (stages.research.regime !== null) lines.push(line('research-report/regime', stages.research.regime));
  if (stages.research.fundamental !== null) lines.push(line('research-report/fundamental', stages.research.fundamental));
  if (stages.research.crossMarket !== null) lines.push(line('research-report/cross-market', stages.research.crossMarket));

  // -- director --------------------------------------------------------------
  if (stages.director.outcome.kind === 'decision') lines.push(line('director-decision', stages.director.outcome.decision));
  else lines.push(line('director-escalation', stages.director.outcome.escalation));

  // -- strategy --------------------------------------------------------------
  lines.push(line('strategy-spec', stages.strategy.spec));
  lines.push(line('portfolio-state', stages.strategy.state));
  lines.push(line('strategy-run', stages.strategy.run));

  // -- risk + gateway --------------------------------------------------------
  for (const evaluation of stages.riskGateway.evaluations) lines.push(line('limit-evaluation', evaluation));
  for (const decision of stages.riskGateway.decisions) lines.push(line('gate-decision', decision));
  for (const audit of stages.riskGateway.auditRecords) lines.push(line('gateway-audit-record', audit));
  for (const submission of stages.riskGateway.submissions) lines.push(line('gateway-submission', submission));

  // -- execution -------------------------------------------------------------
  for (const fill of stages.execution.engineFills) lines.push(line('engine-fill', fill));
  for (const fill of stages.execution.reactiveFills) lines.push(line('reactive-fill', fill));
  for (const log of stages.execution.logs) lines.push(line('order-lifecycle-log', log));
  for (const reconciliation of stages.execution.reconciliations) lines.push(line('reconciliation-record', reconciliation));

  // -- outcomes --------------------------------------------------------------
  lines.push(line('shadow-book', stages.outcomes.book));
  for (const fill of stages.outcomes.shadowFills) lines.push(line('shadow-fill', fill));
  for (const record of stages.outcomes.outcomeLog.records) lines.push(line('shadow-outcome-record', record));
  lines.push(line('shadow-outcome-log-head', { head: stages.outcomes.outcomeLog.head }));

  // -- the lineage ledger (every entry, append order) ------------------------
  for (const entry of run.ledger.entries) lines.push(line('lineage-entry', entry));
  lines.push(line('lineage-ledger-head', { stageCount: PIPELINE_STAGES.length, head: run.ledger.head, entries: run.ledger.entries.length }));

  // -- the digest footer ------------------------------------------------------
  const body = lines.join('\n');
  const streamDigest = stableDigest(body);
  lines.push(line('run-digest', { runId: run.runId, streamDigest, lines: lines.length }));
  return `${lines.join('\n')}\n`;
}

/** The 16-hex digest of the whole byte stream (the determinism anchor). */
export function runStreamDigest(run: EndToEndRunRecord): string {
  return stableDigest(serializeRun(run).trimEnd());
}

/** The ledger as a compact stage->count summary (evidence helper). */
export function ledgerStageSummary(ledger: LineageLedger): Readonly<Record<string, number>> {
  const summary: Record<string, number> = {};
  for (const stage of PIPELINE_STAGES) {
    summary[stage] = ledger.entries.filter((entry) => entry.stage === stage).length;
  }
  return summary;
}
