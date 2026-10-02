/**
 * @tradrl/outcomes — the deterministic record fixtures (test-support
 * only; every fixture is a hand-minted, guard-valid record built with
 * INJECTED instants — no ambient clock anywhere).
 */

import { appendOutcomeRecord, startOutcomeLearningLog, type OutcomeLearningLog } from './logs';
import { mintOutcomeRecord, type OutcomeRecord } from './outcome-record';
import type { ShadowLineageMirror, ShadowOutcomeRecordMirror } from './shadow-stream-mirror';
import { asTimestampMs, deepFreeze, fnv1a32Hex, canonicalJson } from './primitives';

export const T0 = 1_700_000_000_000;
export const TENANT = 'tenant-outcome-alpha';
export const PROJECT = 'project-outcome-alpha';
export const SESSION = 'shs:abcdef01';
export const SEED = 't033-fixture-seed';

/** A guard-valid shadow lineage (T030's block shape, hand-minted). */
export function fixtureLineage(sessionId = SESSION, tenant = TENANT, project = PROJECT): ShadowLineageMirror {
  return deepFreeze({
    sessionId,
    fidelity: { mode: 'shadow', fill_origin: 'simulated' },
    executionPolicy: { policyId: 'ep-fixture', version: 1 },
    riskPolicy: { policyId: 'rp-fixture', version: 1 },
    configDigests: { worldConfigHash: 'wch-fixture', engineConfigHash: 'ech-fixture', dataset: 'dataset-fixture' },
    run: { runId: 'run-fixture', episodeId: 'epi-fixture' },
    cursor: { cursorId: 'cur-fixture', position: 7 },
    seed: SEED,
    tenant,
    project,
  });
}

/** A guard-valid shadow outcome record (T030's shape, hand-minted; NOT chain-folded — the fold is T030's law). */
export function fixtureShadowRecord(overrides: Partial<Omit<ShadowOutcomeRecordMirror, 'outcomeId'>> = {}): ShadowOutcomeRecordMirror {
  const base: Omit<ShadowOutcomeRecordMirror, 'outcomeId'> = {
    ordinal: 1,
    intentRef: 'si:fixture-intent-1',
    decisionRef: 'xd:fixture-decision-1',
    refusalRef: null,
    disposition: 'filled',
    fills: ['swf-00000001'],
    costs: { feeTotal: '1.25', notionalTotal: '50100' },
    realizedOutcome: '-1.75',
    unrealizedAtDecision: '12.5',
    priorChainHead: '00000000',
    lineage: fixtureLineage(),
    asOf: asTimestampMs(T0 + 25_000),
  };
  const merged = { ...base, ...overrides };
  return deepFreeze({ ...merged, outcomeId: `swo:${fnv1a32Hex(canonicalJson(merged))}` });
}

/** The mutable draft of a mint input (test ergonomics: fixtures may be tweaked field-by-field before minting). */
export type OutcomeInputDraft = { -readonly [K in keyof Omit<OutcomeRecord, 'outcomeId'>]: Omit<OutcomeRecord, 'outcomeId'>[K] };

/** The canonical mint input for a guard-valid learned outcome (filled + declared expectation). */
export function fixtureOutcomeInput(ordinal: number, priorChainHead: string): OutcomeInputDraft {
  const shadow = fixtureShadowRecord();
  return {
    ordinal,
    tenant: TENANT,
    project: PROJECT,
    decision: { decisionRef: 'xd:fixture-decision-1', intentRef: 'si:fixture-intent-1', disposition: 'filled' },
    outcomeClass: 'adverse_gap',
    expectation: {
      expectedQuantity: '0.75',
      expectedRealized: '5.25',
      tolerance: '1',
      declaredBy: 'body:projections-alpha',
    },
    realization: {
      filledQuantity: '0.75',
      realizedOutcome: '-1.75',
      feeTotal: '1.25',
      notionalTotal: '50100',
      unrealizedAtDecision: '12.5',
    },
    deviation: { quantityShortfall: '0', realizedGap: '-7', withinTolerance: false },
    evidence: [
      { kind: 'shadow_outcome', ref: shadow.outcomeId },
      { kind: 'shadow_fill', ref: 'swf-00000001' },
      { kind: 'decision', ref: 'xd:fixture-decision-1' },
    ],
    lineage: {
      shadow: shadow.lineage,
      shadowOutcomeRef: shadow.outcomeId,
      shadowOutcomeOrdinal: shadow.ordinal,
      shadowAsOf: shadow.asOf,
      decisionStreamPosition: 1,
      trajectoryRef: 'trajectory-fixture-1',
      experiment: { experimentRef: 'experiment-fixture-1', trialRef: 'trial-fixture-1' },
    },
    asOf: asTimestampMs(T0 + 30_000),
    priorChainHead,
  };
}

/** Mint + append a fixture outcome onto a log (unwraps — test support). */
export function appendFixtureOutcome(log: OutcomeLearningLog, ordinal: number, mutate?: (input: OutcomeInputDraft) => void): { log: OutcomeLearningLog; record: OutcomeRecord } {
  const input = fixtureOutcomeInput(ordinal, log.head);
  if (mutate !== undefined) mutate(input);
  const minted = mintOutcomeRecord(input);
  if (!minted.ok) throw new Error(`fixture outcome failed to mint: ${minted.errors.map((error) => error.message).join('; ')}`);
  const appended = appendOutcomeRecord(log, minted.value);
  if (!appended.ok) throw new Error(`fixture outcome failed to append: ${appended.errors.map((error) => error.message).join('; ')}`);
  return { log: appended.value, record: minted.value };
}

/** A fresh log with one fixture outcome. */
export function logWithOneOutcome(): { log: OutcomeLearningLog; record: OutcomeRecord } {
  return appendFixtureOutcome(startOutcomeLearningLog(), 1);
}
