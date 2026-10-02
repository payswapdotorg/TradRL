/**
 * @tradrl/outcome-learning — the deterministic scenario fixtures
 * (test-support only): a HAND-MINTED, chain-valid T030-shaped shadow
 * outcome stream (this module SIMULATES the producing lane's minting
 * law — the same content-addressed ids and the same fold — exactly as
 * T030's own fixtures simulate the world; the service itself NEVER
 * imports services/shadow-trading, and interop.test.ts drives the
 * REAL session through the same mirrors).
 *
 * THE SCENARIO (six decisions, one session, deterministic):
 *   1. filled BTC buy 0.75 — declared expectation +5.25, realized -1.75,
 *      tolerance 1 => adverse_gap (gap -7);
 *   2. filled BTC sell 0.2 — declared expectation +39.5, realized +40
 *      => as_expected (gap 0.5 <= 1);
 *   3. refused at the risk stage => averted;
 *   4. partial BTC buy 0.9 (0.3 + 0.3 filled; one fill's availability
 *      150ms after the decision — the data-lag evidence) =>
 *      execution_shortfall;
 *   5. expired BTC buy 0.1 (zero fills in the window) => no_execution;
 *   6. filled ETH buy 0.8, no declared expectation => unbenchmarked_fill.
 *
 * The book snapshot reconciles EXACTLY (accrualDelta '0': the genesis
 * realized is '0' and no fill accrues outside its decision's window).
 */

import { canonicalJson, deepFreeze, fnv1a32Hex, asTimestampMs, type TimestampMs } from './imports';
import type { DecisionFactsMirror, FillFactsMirror, ShadowDispositionMirror, ShadowLineageMirror, ShadowOutcomeLogMirror, ShadowOutcomeRecordMirror } from './imports';
import type { ShadowBookSnapshotMirror } from './book-mirror';
import type { DeclaredExpectation, SessionBinding } from './reconcile';

export const T0 = 1_700_000_000_000;
export const TENANT = 'tenant-learning-beta';
export const PROJECT = 'project-learning-beta';
export const SESSION = 'shs:beefbeef';
export const SEED = 't033-service-seed';
export const BTC = 'BTC-USD';
export const ETH = 'ETH-USD';
export const VENUE = 'LEARNINGSIM';

// ---------------------------------------------------------------------------
// The T030-side minting simulation (content-addressed ids + the fold — T030's law, mirrored)
// ---------------------------------------------------------------------------

/** The shadow content tree (T030's private outcomeContentTree, mirrored field-for-field). */
function shadowContentTree(record: Omit<ShadowOutcomeRecordMirror, 'outcomeId'>): unknown {
  return {
    ordinal: record.ordinal,
    intentRef: record.intentRef,
    decisionRef: record.decisionRef,
    refusalRef: record.refusalRef,
    disposition: record.disposition,
    fills: [...record.fills],
    costs: { feeTotal: record.costs.feeTotal, notionalTotal: record.costs.notionalTotal },
    realizedOutcome: record.realizedOutcome,
    unrealizedAtDecision: record.unrealizedAtDecision,
    priorChainHead: record.priorChainHead,
    lineage: record.lineage,
    asOf: record.asOf,
  };
}

/** Mint one shadow record the way T030 does (content-addressed `swo:` id). */
function mintShadow(record: Omit<ShadowOutcomeRecordMirror, 'outcomeId'>): ShadowOutcomeRecordMirror {
  return deepFreeze({ ...record, outcomeId: `swo:${fnv1a32Hex(canonicalJson(shadowContentTree(record)))}` });
}

/** Fold one shadow record onto a head (T030's fold, mirrored). */
function foldShadow(head: string, record: ShadowOutcomeRecordMirror): string {
  return fnv1a32Hex(`${head}${canonicalJson(shadowContentTree(record))}`);
}

/** The scenario's lineage (T030's block shape, hand-minted). */
function scenarioLineage(cursorPosition: number): ShadowLineageMirror {
  return deepFreeze({
    sessionId: SESSION,
    fidelity: { mode: 'shadow', fill_origin: 'simulated' },
    executionPolicy: { policyId: 'ep-learning', version: 3 },
    riskPolicy: { policyId: 'rp-learning', version: 2 },
    configDigests: { worldConfigHash: 'wch-learning', engineConfigHash: 'ech-learning', dataset: 'dataset-learning' },
    run: { runId: 'run-learning', episodeId: 'epi-learning' },
    cursor: { cursorId: 'cur-learning', position: cursorPosition },
    seed: SEED,
    tenant: TENANT,
    project: PROJECT,
  });
}

/** One decision's stream entry (the raw material of the scenario). */
interface StreamEntry {
  readonly ordinal: number;
  readonly intentRef: string;
  readonly decisionRef: string;
  readonly refusalRef: string | null;
  readonly disposition: ShadowDispositionMirror;
  readonly fills: readonly string[];
  readonly feeTotal: string;
  readonly notionalTotal: string;
  readonly realizedOutcome: string;
  readonly unrealizedAtDecision: string;
  readonly asOf: number;
}

/** The scenario's six decisions (deterministic literals). */
const ENTRIES: readonly StreamEntry[] = [
  { ordinal: 1, intentRef: 'si:learn-1', decisionRef: 'xd:learn-1', refusalRef: null, disposition: 'filled', fills: ['swf-00000001'], feeTotal: '1.25', notionalTotal: '37575', realizedOutcome: '-1.75', unrealizedAtDecision: '12.5', asOf: T0 + 25_000 },
  { ordinal: 2, intentRef: 'si:learn-2', decisionRef: 'xd:learn-2', refusalRef: null, disposition: 'filled', fills: ['swf-00000002'], feeTotal: '0.5', notionalTotal: '10020', realizedOutcome: '40', unrealizedAtDecision: '10', asOf: T0 + 26_000 },
  { ordinal: 3, intentRef: 'si:learn-3', decisionRef: 'xd:learn-3', refusalRef: 'swr:aaaa0003', disposition: 'refused', fills: [], feeTotal: '0', notionalTotal: '0', realizedOutcome: '0', unrealizedAtDecision: '9.5', asOf: T0 + 61_000 },
  { ordinal: 4, intentRef: 'si:learn-4', decisionRef: 'xd:learn-4', refusalRef: null, disposition: 'partial', fills: ['swf-00000003', 'swf-00000004'], feeTotal: '0.6', notionalTotal: '16800', realizedOutcome: '5', unrealizedAtDecision: '8', asOf: T0 + 120_000 },
  { ordinal: 5, intentRef: 'si:learn-5', decisionRef: 'xd:learn-5', refusalRef: null, disposition: 'expired', fills: [], feeTotal: '0', notionalTotal: '0', realizedOutcome: '0', unrealizedAtDecision: '7.5', asOf: T0 + 150_000 },
  { ordinal: 6, intentRef: 'si:learn-6', decisionRef: 'xd:learn-6', refusalRef: null, disposition: 'filled', fills: ['swf-00000005'], feeTotal: '1', notionalTotal: '2440', realizedOutcome: '-2.5', unrealizedAtDecision: '6', asOf: T0 + 151_000 },
];

/** Build the scenario's chain-valid shadow outcome log (T030's fold, threaded head-over-head). */
export function scenarioShadowLog(): ShadowOutcomeLogMirror {
  let head = '00000000';
  const records: ShadowOutcomeRecordMirror[] = [];
  for (const entry of ENTRIES) {
    const record = mintShadow({
      ordinal: entry.ordinal,
      intentRef: entry.intentRef,
      decisionRef: entry.decisionRef,
      refusalRef: entry.refusalRef,
      disposition: entry.disposition,
      fills: [...entry.fills],
      costs: { feeTotal: entry.feeTotal, notionalTotal: entry.notionalTotal },
      realizedOutcome: entry.realizedOutcome,
      unrealizedAtDecision: entry.unrealizedAtDecision,
      priorChainHead: head,
      lineage: scenarioLineage(entry.ordinal * 3),
      asOf: asTimestampMs(entry.asOf),
    });
    records.push(record);
    head = foldShadow(head, record);
  }
  return deepFreeze({ records, head });
}

/** The scenario's book snapshot (realized = the stream's exact sum; the delta is exactly zero). */
export function scenarioBookSnapshot(): ShadowBookSnapshotMirror {
  return deepFreeze({
    positions: [
      { venue: VENUE, instrument: BTC, quantity: '1.05', costBasis: '52575', openedAt: asTimestampMs(T0 + 25_000) },
      { venue: VENUE, instrument: ETH, quantity: '0.8', costBasis: '2440', openedAt: asTimestampMs(T0 + 151_000) },
    ],
    cash: '44985.4',
    realizedPnl: '40.75', // -1.75 + 40 + 0 + 5 + 0 + (-2.5), exactly
    asOf: asTimestampMs(T0 + 160_000),
  });
}

/** The scenario's decision facts (the six intents' order facts). */
export function scenarioDecisionFacts(): readonly DecisionFactsMirror[] {
  return deepFreeze([
    { intentRef: 'si:learn-1', decisionRef: 'xd:learn-1', venue: VENUE, instrument: BTC, side: 'buy', orderQuantity: '0.75', streamPosition: 1 },
    { intentRef: 'si:learn-2', decisionRef: 'xd:learn-2', venue: VENUE, instrument: BTC, side: 'sell', orderQuantity: '0.2', streamPosition: 2 },
    { intentRef: 'si:learn-3', decisionRef: 'xd:learn-3', venue: VENUE, instrument: BTC, side: 'buy', orderQuantity: '0.1', streamPosition: 3 },
    { intentRef: 'si:learn-4', decisionRef: 'xd:learn-4', venue: VENUE, instrument: BTC, side: 'buy', orderQuantity: '0.9', streamPosition: 4 },
    { intentRef: 'si:learn-5', decisionRef: 'xd:learn-5', venue: VENUE, instrument: BTC, side: 'buy', orderQuantity: '0.1', streamPosition: 5 },
    { intentRef: 'si:learn-6', decisionRef: 'xd:learn-6', venue: VENUE, instrument: ETH, side: 'buy', orderQuantity: '0.8', streamPosition: 6 },
  ]);
}

/** The scenario's fill facts (the exact quantities + the availability instants — one carries the 150ms lag). */
export function scenarioFillFacts(): readonly FillFactsMirror[] {
  return deepFreeze([
    { fillId: 'swf-00000001', intentRef: 'si:learn-1', quantity: '0.75', availableAt: asTimestampMs(T0 + 25_000) },
    { fillId: 'swf-00000002', intentRef: 'si:learn-2', quantity: '0.2', availableAt: asTimestampMs(T0 + 26_000) },
    { fillId: 'swf-00000003', intentRef: 'si:learn-4', quantity: '0.3', availableAt: asTimestampMs(T0 + 120_000) },
    { fillId: 'swf-00000004', intentRef: 'si:learn-4', quantity: '0.3', availableAt: asTimestampMs(T0 + 120_150) }, // the data-lag evidence
    { fillId: 'swf-00000005', intentRef: 'si:learn-6', quantity: '0.8', availableAt: asTimestampMs(T0 + 151_000) },
  ]);
}

/** The scenario's declared expectations (decisions 1 and 2 carry projections). */
export function scenarioExpectations(): readonly DeclaredExpectation[] {
  return deepFreeze([
    { intentRef: 'si:learn-1', expectedRealized: '5.25', declaredBy: 'body:projectionist-alpha' },
    { intentRef: 'si:learn-2', expectedRealized: '39.5', declaredBy: 'body:projectionist-alpha' },
  ]);
}

/** The scenario's T011 session binding. */
export function scenarioBinding(): SessionBinding {
  return deepFreeze({ trajectoryRef: 'trajectory-learning-1', experimentRef: 'experiment-learning-1', trialRef: 'trial-learning-1' });
}

/** The scenario's mark facts (BTC fell 200 between decision 1's instant and its window's close — adverse for the buy). */
export function scenarioMarkFacts() {
  return deepFreeze([
    { venue: VENUE, instrument: BTC, markAtDecision: '50100', markAtWindow: '49900' },
  ]);
}

/** The scenario's ingestion instant (at/after the stream's last evidence). */
export function scenarioIngestAt(): TimestampMs {
  return asTimestampMs(T0 + 170_000);
}

/** The canonical ingestion batch over the scenario (deterministic; the reconciliation policy defaults to tolerance '1'). */
export function scenarioBatch() {
  return deepFreeze({
    outcomeLog: scenarioShadowLog(),
    bookSnapshot: scenarioBookSnapshot(),
    binding: scenarioBinding(),
    decisionFacts: scenarioDecisionFacts(),
    fillFacts: scenarioFillFacts(),
    expectations: scenarioExpectations(),
    at: scenarioIngestAt(),
  });
}

/** The scenario's draft instant. */
export function scenarioDraftAt(): TimestampMs {
  return asTimestampMs(T0 + 180_000);
}

/** The scenario's expected class sequence (the six decisions, in ordinal order). */
export const SCENARIO_CLASSES: readonly string[] = ['adverse_gap', 'as_expected', 'averted', 'execution_shortfall', 'no_execution', 'unbenchmarked_fill'];
