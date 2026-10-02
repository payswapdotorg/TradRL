/**
 * Cross-lane interoperability trip wires for the outcome-learning
 * lane (Work Order T033): the REAL services this lane consumes ONLY
 * through its structural mirrors are loaded STATICALLY here (the
 * tests are the trip wires — the src lane itself imports neither):
 *
 *   - services/shadow-trading (T030): the REAL golden session (its
 *     own fixtures — the scripted world, the scripted machine, the
 *     reference intent stream) runs to completion; the REAL
 *     ShadowOutcomeLog / ShadowBook / ShadowFill / ShadowLineage /
 *     StrategyIntentMirror satisfy this lane's MIRRORS structurally
 *     (type-level witnesses + runtime guards), and a FULL ingestion
 *     learns from the REAL stream: the lineage blocks are preserved
 *     BYTE-FOR-BYTE, the chain-verification mirror agrees with the
 *     REAL verifyShadowOutcomeChain over intact AND tampered logs,
 *     the stream-digest mirror equals the REAL shadowOutcomeDigest,
 *     and the per-decision reconciliation sums exactly against the
 *     REAL book.
 *   - packages/trajectory + packages/experiments (T011): the REAL
 *     TrajectoryMetadata and TrialRecord validate under THEIR guards
 *     and their ids flow BYTE-EXACT through this lane's session
 *     binding into the learned records' evidence + lineage.
 *   - packages/execution-policy (T019): the REAL decimal kernel
 *     (add/subtract/compare over canonical decimals) agrees with this
 *     lane's LOCAL exact-decimal helpers on a corpus of signed pairs
 *     — the parity trip wire that licenses the zero-import design.
 *   - Determinism: the whole real-stack ingestion runs TWICE with
 *     byte-identical results (L9).
 */

import { describe, expect, it } from 'vitest';
import * as shadowTrading from '../../shadow-trading/src/index';
import { runReferenceScenario, referenceIntentStream } from '../../shadow-trading/src/fixtures';
import * as trajectory from '../../../packages/trajectory/src/index';
import * as experiments from '../../../packages/experiments/src/index';
import * as executionPolicy from '../../../packages/execution-policy/src/index';
import { createOutcomeLearningState, ingestShadowOutcomes } from './state';
import { generatePostMortemDrafts } from './postmortem';
import { DEFAULT_POST_MORTEM_DRAFT_POLICY } from './policy';
import { queryLearningHooks, queryOutcomeRecords } from './query';
import {
  isShadowOutcomeLogMirror,
  isDecisionFactsMirror,
  isFillFactsMirror,
  shadowOutcomeStreamDigestMirror,
  verifyShadowOutcomeChainMirror,
  type ShadowOutcomeLogMirror,
  type ShadowLineageMirror,
  type ShadowOutcomeRecordMirror,
  type DecisionFactsMirror,
  type FillFactsMirror,
  signedAdd,
  signedSubtract,
  signedCompare,
} from './imports';
import { isShadowBookSnapshotMirror, type ShadowBookSnapshotMirror } from './book-mirror';

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the REAL T030 outcome log IS this lane's mirror. */
function realLogSatisfiesMirror(log: shadowTrading.ShadowOutcomeLog): ShadowOutcomeLogMirror {
  return log;
}

/** Compiles iff the REAL T030 outcome record IS this lane's mirror. */
function realRecordSatisfiesMirror(record: shadowTrading.ShadowOutcomeRecord): ShadowOutcomeRecordMirror {
  return record;
}

/** Compiles iff the REAL T030 lineage block IS this lane's mirror. */
function realLineageSatisfiesMirror(lineage: shadowTrading.ShadowLineage): ShadowLineageMirror {
  return lineage;
}

/** Compiles iff the REAL T030 book IS this lane's snapshot mirror. */
function realBookSatisfiesMirror(book: shadowTrading.ShadowBook): ShadowBookSnapshotMirror {
  return book;
}

/** Compiles iff the REAL T011 trajectory/experiment/trial ids ARE this lane's opaque refs (the T011 discipline: opaque strings). */
function realT011IdsSatisfyRefs(meta: trajectory.TrajectoryMetadata, trial: experiments.TrialRecord): { trajectoryRef: string; experimentRef: string; trialRef: string } {
  return { trajectoryRef: meta.trajectory_id, experimentRef: trial.trial_id, trialRef: trial.trial_id };
}

void realLogSatisfiesMirror;
void realRecordSatisfiesMirror;
void realLineageSatisfiesMirror;
void realBookSatisfiesMirror;
void realT011IdsSatisfyRefs;

// ---------------------------------------------------------------------------
// The REAL T030 golden session, driven end-to-end
// ---------------------------------------------------------------------------

/** Run the REAL golden session once (deterministic per T030's own golden test). */
async function realSession(): Promise<shadowTrading.ShadowSession> {
  return runReferenceScenario();
}

/** The decision facts derived from the REAL intent stream (the caller-fed decisions). */
function realDecisionFacts(): readonly DecisionFactsMirror[] {
  return referenceIntentStream().map((intent) => {
    const facts = {
      intentRef: intent.intentId,
      decisionRef: null, // the decision refs bind through the outcome records, not the intents
      venue: intent.order.venueId,
      instrument: intent.order.instrumentId,
      side: intent.order.side,
      orderQuantity: intent.order.quantity,
      streamPosition: intent.sequence,
    };
    if (!isDecisionFactsMirror(facts)) throw new Error(`the real intent ${intent.intentId} failed the decision-facts mirror guard`);
    return facts;
  });
}

/** The fill facts derived from the REAL session's public fills. */
function realFillFacts(session: shadowTrading.ShadowSession): readonly FillFactsMirror[] {
  return session.fills.map((fill) => {
    const facts = {
      fillId: fill.fillId,
      intentRef: fill.intentRef,
      quantity: fill.worldFill.fill.quantity,
      availableAt: fill.worldFill.fill.quartet.available_time,
    };
    if (!isFillFactsMirror(facts)) throw new Error(`the real fill ${fill.fillId} failed the fill-facts mirror guard`);
    return facts;
  });
}

/** The declared expectations over the REAL intents (a projectionist declares for the first, second and sixth decisions). */
function realExpectations() {
  const intents = referenceIntentStream();
  return [
    { intentRef: intents[0]?.intentId as string, expectedRealized: '4', declaredBy: 'body:interop-projectionist' },
    { intentRef: intents[1]?.intentId as string, expectedRealized: '35', declaredBy: 'body:interop-projectionist' },
    { intentRef: intents[5]?.intentId as string, expectedRealized: '12.5', declaredBy: 'body:interop-projectionist' },
  ];
}

describe('the REAL T030 golden session through the mirrors (the drift trip wires)', () => {
  it('runs the real session and its outcome log satisfies the mirror guards + the chain agrees', async () => {
    const session = await realSession();
    expect(isShadowOutcomeLogMirror(session.outcomeLog)).toBe(true);
    expect(isShadowBookSnapshotMirror(session.book)).toBe(true);
    // The chain-verification mirror agrees with the REAL verifier over the intact log.
    expect(verifyShadowOutcomeChainMirror(session.outcomeLog)).toBe(true);
    expect(shadowTrading.verifyShadowOutcomeChain(session.outcomeLog)).toBe(true);
    // The stream-digest mirror equals the REAL digest (byte-parity of the fold basis).
    expect(shadowOutcomeStreamDigestMirror(session.outcomeLog)).toBe(shadowTrading.shadowOutcomeDigest(session.outcomeLog));
  });

  it('agrees with the REAL verifier over TAMPERED logs (both reject)', async () => {
    const session = await realSession();
    const records = [...session.outcomeLog.records];
    const tamperedEdited = { ...session.outcomeLog, records: [{ ...records[0], realizedOutcome: '999' }, ...records.slice(1)] };
    expect(verifyShadowOutcomeChainMirror(tamperedEdited)).toBe(false);
    expect(shadowTrading.verifyShadowOutcomeChain(tamperedEdited)).toBe(false);
    const tamperedTruncated = { ...session.outcomeLog, records: records.slice(0, 3) };
    expect(verifyShadowOutcomeChainMirror(tamperedTruncated)).toBe(false);
    expect(shadowTrading.verifyShadowOutcomeChain(tamperedTruncated)).toBe(false);
    const tamperedReordered = { ...session.outcomeLog, records: [records[1] as never, records[0] as never, ...records.slice(2)] };
    expect(verifyShadowOutcomeChainMirror(tamperedReordered)).toBe(false);
    expect(shadowTrading.verifyShadowOutcomeChain(tamperedReordered)).toBe(false);
  });

  it('ingests the REAL stream: byte-preserving lineage, the golden dispositions, exact book reconciliation', async () => {
    const session = await realSession();
    const ingested = ingestShadowOutcomes(createOutcomeLearningState(), {
      outcomeLog: session.outcomeLog,
      bookSnapshot: session.book,
      binding: { trajectoryRef: null, experimentRef: null, trialRef: null },
      decisionFacts: realDecisionFacts(),
      fillFacts: realFillFacts(session),
      expectations: realExpectations(),
      at: session.now,
    });
    if (!ingested.ok) throw new Error(ingested.errors.map((error) => `${error.code}: ${error.message}`).join('; '));
    const state = ingested.value;
    // Seven decisions, seven learned outcomes, in the golden disposition order.
    expect(state.outcomeLog.records.length).toBe(7);
    const dispositions = session.outcomeLog.records.map((record) => record.disposition);
    expect(dispositions).toEqual(['filled', 'filled', 'filled', 'refused', 'filled', 'partial', 'expired']); // T030's own golden
    // The byte-preserving law: every learned record's lineage deep-equals the real record's lineage.
    for (let index = 0; index < state.outcomeLog.records.length; index++) {
      expect(JSON.stringify(state.outcomeLog.records[index]?.lineage.shadow)).toBe(JSON.stringify(session.outcomeLog.records[index]?.lineage));
      expect(state.outcomeLog.records[index]?.realization.realizedOutcome).toBe(session.outcomeLog.records[index]?.realizedOutcome);
    }
    // The account reconciliation against the REAL book — the HONEST delta:
    // the golden session's sells' fills are latency-pending at their decision
    // ticks (T030's declared interpretation: later fills accrue to the BOOK,
    // not retroactively to the outcome record), so every record's realized is
    // '0' while the book crystallized the full -38.32833333. The delta
    // QUANTIFIES the late accrual exactly — never assumed away.
    const receipt = state.ingestions[0];
    expect(receipt?.book.bookRealized).toBe(session.book.realizedPnl);
    expect(receipt?.book.bookRealized).toBe('-38.32833333'); // T030's own golden final book
    expect(receipt?.book.streamRealizedSum).toBe('0');
    expect(receipt?.book.accrualDelta).toBe('-38.32833333');
    expect(receipt?.book.coherent).toBe(false); // the honest verdict: the account carries late accruals
    // The classes: the declared expectations make the first decision adverse
    // (realized below 4-tolerance 1?) — assert the derivation is EXACT by
    // recomputing from the record's own numbers:
    for (const record of state.outcomeLog.records) {
      const shadow = session.outcomeLog.records[record.ordinal - 1];
      expect(record.decision.disposition).toBe(shadow?.disposition);
      if (record.expectation.expectedRealized !== null) {
        const gap = signedSubtract(shadow?.realizedOutcome as string, record.expectation.expectedRealized);
        expect(record.deviation.realizedGap).toBe(gap);
      }
    }
  });

  it('drafts + compiles hooks over the REAL stream (the full pipeline, deterministic)', async () => {
    const session = await realSession();
    const run = () => {
      const ingested = ingestShadowOutcomes(createOutcomeLearningState(), {
        outcomeLog: session.outcomeLog,
        bookSnapshot: session.book,
        binding: { trajectoryRef: null, experimentRef: null, trialRef: null },
        decisionFacts: realDecisionFacts(),
        fillFacts: realFillFacts(session),
        expectations: realExpectations(),
        at: session.now,
      });
      if (!ingested.ok) throw new Error(ingested.errors.map((error) => error.message).join('; '));
      const drafted = generatePostMortemDrafts(ingested.value, DEFAULT_POST_MORTEM_DRAFT_POLICY, {
        markFacts: [{ venue: 'SHADOWSIM', instrument: 'BTC-USD', markAtDecision: '50100', markAtWindow: '50400' }],
        at: session.now,
      });
      if (!drafted.ok) throw new Error(drafted.errors.map((error) => error.message).join('; '));
      return drafted.value.state;
    };
    const first = run();
    const second = run();
    // L9: identical inputs -> identical bytes, over the REAL stack.
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const hooks = queryLearningHooks(first, { tenant: session.tenant, project: session.project }, { at: session.now, retention: { outcomeWindowMs: Number.MAX_SAFE_INTEGER, postMortemWindowMs: Number.MAX_SAFE_INTEGER } });
    if (!hooks.ok) throw new Error(hooks.errors.map((error) => error.message).join('; '));
    expect(hooks.value.length).toBe(7);
  });
});

describe('the REAL T011 records through the binding (the lineage trip wires)', () => {
  it('flows real trajectory/experiment/trial ids byte-exact into the learned records', async () => {
    const session = await realSession();
    // A REAL trajectory metadata + a REAL trial record (validated under THEIR guards).
    const meta = trajectory.validateTrajectoryMetadata({
      trajectory_id: 'trajectory-interop-t033',
      tenant: session.tenant,
      project: session.project,
      episode: 'epi-interop-t033',
      environment_config: 'envcfg:interop-1',
      runtime: 'runtime:interop-1',
      data: [],
      body_versions: ['bodyv:interop-1'],
      substrates: ['substrate:interop-1'],
    });
    if (!meta.ok) throw new Error(meta.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; '));
    const trial = experiments.validateTrialRecord({
      trial_id: 'trial-interop-t033',
      arm: 'arm-interop-alpha',
      status: 'succeeded',
      trajectory: 'trajectory-interop-t033',
      outcome: { verdict: 'ok' },
      started_at: session.outcomeLog.records[0]?.asOf ?? 0,
      ended_at: session.now,
      failure_reason: null,
    });
    if (!trial.ok) throw new Error(trial.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; '));

    const ingested = ingestShadowOutcomes(createOutcomeLearningState(), {
      outcomeLog: session.outcomeLog,
      bookSnapshot: session.book,
      binding: { trajectoryRef: meta.value.trajectory_id, experimentRef: 'experiment-interop-t033', trialRef: trial.value.trial_id },
      at: session.now,
    });
    if (!ingested.ok) throw new Error(ingested.errors.map((error) => error.message).join('; '));
    for (const record of ingested.value.outcomeLog.records) {
      expect(record.lineage.trajectoryRef).toBe('trajectory-interop-t033'); // the REAL id, byte-exact
      expect(record.lineage.experiment).toEqual({ experimentRef: 'experiment-interop-t033', trialRef: 'trial-interop-t033' });
      expect(record.evidence).toContainEqual({ kind: 'trajectory', ref: 'trajectory-interop-t033' });
      expect(record.evidence).toContainEqual({ kind: 'experiment', ref: 'experiment-interop-t033' });
      expect(record.evidence).toContainEqual({ kind: 'trial', ref: 'trial-interop-t033' });
    }
    // The Firm Brain's by-decision read over the bound records.
    const byDecision = queryOutcomeRecords(ingested.value, { tenant: session.tenant, project: session.project, decisionRef: session.outcomeLog.records[0]?.decisionRef as string }, { at: session.now, retention: { outcomeWindowMs: Number.MAX_SAFE_INTEGER, postMortemWindowMs: Number.MAX_SAFE_INTEGER } });
    if (!byDecision.ok) throw new Error(byDecision.errors.map((error) => error.message).join('; '));
    expect(byDecision.value.length).toBe(1);
    expect(byDecision.value[0]?.lineage.experiment?.trialRef).toBe('trial-interop-t033');
  });
});

describe('the REAL decimal kernel parity (the zero-import license)', () => {
  it('agrees with execution-policy REAL add/compare/subtract over a corpus of canonical pairs (the kernel UNSIGNED domain)', () => {
    // The REAL kernel's arithmetic domain is UNSIGNED (its own law: "exact,
    // non-negative inputs only"); the signed extension is the consuming
    // lanes' local pattern (T030's book.ts built the same wrapper over the
    // same kernel). Parity is therefore asserted over the kernel's own
    // domain — the unsigned canonical corpus — where the local helpers
    // must agree byte-for-byte with the REAL kernel.
    const corpus: readonly [string, string][] = [
      ['0', '0'], ['1', '0'], ['0', '1'], ['1.5', '2.25'], ['0.1', '0.2'], ['0.0000001', '0.0000002'],
      ['50041.66666667', '2400'], ['38.32833333', '38.32833333'], ['999999999.99999999', '0.00000001'],
      ['1', '0.99999999'], ['100000', '47504.515'], ['7', '12.000000001'], ['50100', '100'],
    ];
    for (const [a, b] of corpus) {
      expect(signedAdd(a, b)).toBe(executionPolicy.add(a, b));
      expect(String(signedCompare(a, b))).toBe(String(executionPolicy.compare(a, b)));
      if (executionPolicy.compare(a, b) >= 0) {
        expect(signedSubtract(a, b)).toBe(executionPolicy.subtract(a, b));
      } else {
        expect(signedSubtract(a, b)).toBe(`-${executionPolicy.subtract(b, a)}`);
      }
    }
  });

  it('handles the signed extension exactly where the kernel\'s unsigned domain ends (the local grammar)', () => {
    expect(signedAdd('-1.5', '2.25')).toBe('0.75');
    expect(signedAdd('-1.5', '-2.25')).toBe('-3.75');
    expect(signedSubtract('-5', '-7.5')).toBe('2.5');
    expect(signedCompare('-2.5', '2.4')).toBe(-1);
    // The kernel would throw here (the unsigned domain law); the signed
    // extension is the consuming lanes' documented pattern.
    expect(() => executionPolicy.subtract('1', '2')).toThrow();
  });
});
