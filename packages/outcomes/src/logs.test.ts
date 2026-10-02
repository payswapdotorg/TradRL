/**
 * @tradrl/outcomes — the LOGS suite: the two append-only,
 * chain-verified logs — the append laws (ordinal continuity, one
 * decision one outcome, prior-chain-head continuity, supersession
 * monotonicity), the tamper anchors (edit/splice/reorder/truncate all
 * fail verification) and the digest determinism.
 */

import { describe, expect, it } from 'vitest';
import {
  appendOutcomeRecord,
  appendPostMortem,
  outcomeLearningLogDigest,
  postMortemLogDigest,
  startOutcomeLearningLog,
  startPostMortemLog,
  verifyOutcomeLearningChain,
  verifyPostMortemChain,
} from './logs';
import { mintPostMortem, type PostMortemRecord } from './postmortem';
import { mintOutcomeRecord } from './outcome-record';
import { canonicalJson, asTimestampMs } from './primitives';
import { appendFixtureOutcome, fixtureOutcomeInput, T0 } from './fixtures';

/** The mutable draft of a post-mortem mint input (test ergonomics). */
type PostMortemDraft = { -readonly [K in keyof Omit<PostMortemRecord, 'postMortemId'>]: Omit<PostMortemRecord, 'postMortemId'>[K] };

/** Mint + append a fixture post-mortem (unwraps — test support). */
function appendFixturePostMortem(outcomeLog: ReturnType<typeof startOutcomeLearningLog>, log: ReturnType<typeof startPostMortemLog>, ordinal: number, outcomeRecordRef: string, asOf: number, mutate?: (draft: PostMortemDraft) => void) {
  const draft: PostMortemDraft = {
    ordinal,
    subject: { outcomeRecordRef, decisionRef: 'xd:fixture-decision-1', intentRef: 'si:fixture-intent-1', outcomeClass: 'adverse_gap' },
    expected: { expectedQuantity: '0.75', expectedRealized: '5.25', tolerance: '1' },
    happened: { disposition: 'filled', filledQuantity: '0.75', realizedOutcome: '-1.75', feeTotal: '1.25', notionalTotal: '50100' },
    gap: { quantityShortfall: '0', realizedGap: '-7', withinTolerance: false },
    hypotheses: [
      { class: 'model_error', confidence: '0.6', detail: { projected: '5.25', realized: '-1.75', kind: 'unresolved' }, evidence: [], note: null },
      { class: 'decision', confidence: '0.4', detail: { dimension: 'unresolved' }, evidence: [], note: null },
    ],
    evidence: [{ kind: 'shadow_outcome', ref: 'swo:aaaaaaaa' }],
    lineage: { tenant: 'tenant-outcome-alpha', project: 'project-outcome-alpha', shadowSessionRef: 'shs:abcdef01', shadowOutcomeRef: 'swo:aaaaaaaa', trajectoryRef: null, experiment: null },
    asOf: asTimestampMs(asOf),
    priorChainHead: log.head,
  };
  if (mutate !== undefined) mutate(draft);
  const minted = mintPostMortem(draft);
  if (!minted.ok) throw new Error(`fixture post-mortem failed to mint: ${minted.errors.map((error) => error.message).join('; ')}`);
  const appended = appendPostMortem(outcomeLog, log, minted.value);
  if (!appended.ok) throw new Error(`fixture post-mortem failed to append: ${appended.errors.map((error) => error.message).join('; ')}`);
  return { log: appended.value, record: minted.value };
}

describe('the outcome-learning log (append-only, chain-verified)', () => {
  it('starts at the seed and verifies the empty fold', () => {
    const log = startOutcomeLearningLog();
    expect(log.head).toBe('00000000');
    expect(verifyOutcomeLearningChain(log)).toBe(true);
  });

  it('verifies an honestly appended log', () => {
    let log = startOutcomeLearningLog();
    log = appendFixtureOutcome(log, 1).log;
    log = appendFixtureOutcome(log, 2, (input) => {
      input.decision = { decisionRef: 'xd:fixture-decision-2', intentRef: 'si:fixture-intent-2', disposition: 'partial' };
      input.outcomeClass = 'execution_shortfall';
      input.lineage = { ...input.lineage, shadowOutcomeRef: 'swo:aaaaaaaa', shadowOutcomeOrdinal: 2 };
      input.evidence = [{ kind: 'shadow_outcome', ref: 'swo:aaaaaaaa' }];
      input.expectation = { expectedQuantity: '0.75', expectedRealized: null, tolerance: '1', declaredBy: null };
      input.realization = { ...input.realization, filledQuantity: '0.5' };
      input.deviation = { quantityShortfall: '0.25', realizedGap: null, withinTolerance: null };
    }).log;
    expect(verifyOutcomeLearningChain(log)).toBe(true);
  });

  it('fails verification on an EDITED record (tamper)', () => {
    const { log } = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    const original = log.records[0] as unknown as { realization: { realizedOutcome: string } };
    const edited = { ...log.records[0], realization: { ...original.realization, realizedOutcome: '999' } };
    const tampered = { ...log, records: [edited] };
    expect(verifyOutcomeLearningChain(tampered)).toBe(false);
  });

  it('fails verification on a REMOVED record (truncation)', () => {
    let log = startOutcomeLearningLog();
    log = appendFixtureOutcome(log, 1).log;
    log = appendFixtureOutcome(log, 2, (input) => {
      input.decision = { decisionRef: 'xd:fixture-decision-2', intentRef: 'si:fixture-intent-2', disposition: 'expired' };
      input.outcomeClass = 'no_execution';
      input.lineage = { ...input.lineage, shadowOutcomeRef: 'swo:aaaaaaaa', shadowOutcomeOrdinal: 2 };
      input.evidence = [{ kind: 'shadow_outcome', ref: 'swo:aaaaaaaa' }];
      input.expectation = { expectedQuantity: '0', expectedRealized: null, tolerance: '1', declaredBy: null };
      input.realization = { ...input.realization, filledQuantity: '0' };
      input.deviation = { quantityShortfall: '0', realizedGap: null, withinTolerance: null };
    }).log;
    const truncated = { head: log.head, records: [log.records[0]] };
    expect(verifyOutcomeLearningChain(truncated)).toBe(false);
  });

  it('fails the typed outcome_log_rewrite on an out-of-order ordinal (a splice)', () => {
    const { log } = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    const minted = mintOutcomeRecord(fixtureOutcomeInput(3, log.head));
    if (!minted.ok) throw new Error(minted.errors.map((error) => error.message).join('; '));
    const spliced = appendOutcomeRecord(log, minted.value);
    expect(spliced.ok).toBe(false);
    if (!spliced.ok) expect(spliced.errors[0].code).toBe('outcome_log_rewrite');
  });

  it('fails the typed outcome_log_rewrite on a foreign prior chain head (a record from another history)', () => {
    const { log } = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    const minted = mintOutcomeRecord(fixtureOutcomeInput(2, 'deadbeef'));
    if (!minted.ok) throw new Error(minted.errors.map((error) => error.message).join('; '));
    const foreign = appendOutcomeRecord(log, minted.value);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors[0].code).toBe('outcome_log_rewrite');
  });

  it('fails the typed outcome_log_rewrite on re-recording the same intent (one intent, one outcome)', () => {
    const { log } = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    const minted = mintOutcomeRecord({ ...fixtureOutcomeInput(2, log.head), decision: { decisionRef: 'xd:fixture-decision-9', intentRef: 'si:fixture-intent-1', disposition: 'filled' } });
    if (!minted.ok) throw new Error(minted.errors.map((error) => error.message).join('; '));
    const reIntent = appendOutcomeRecord(log, minted.value);
    expect(reIntent.ok).toBe(false);
    if (!reIntent.ok) expect(reIntent.errors[0].code).toBe('outcome_log_rewrite');
  });

  it('is byte-deterministic: identical appends produce identical heads and digests (twice)', () => {
    const runA = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    const runB = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    expect(runA.log.head).toBe(runB.log.head);
    expect(outcomeLearningLogDigest(runA.log)).toBe(outcomeLearningLogDigest(runB.log));
    expect(canonicalJson(runA.log)).toBe(canonicalJson(runB.log));
  });
});

describe('the post-mortem log (supersession by append)', () => {
  it('appends a draft for a learned outcome and verifies the chain', () => {
    const outcome = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    const draft = appendFixturePostMortem(outcome.log, startPostMortemLog(), 1, outcome.record.outcomeId, T0 + 40_000);
    expect(verifyPostMortemChain(draft.log)).toBe(true);
    expect(draft.log.records.length).toBe(1);
  });

  it('fails the typed lineage_gap when the subject outcome is not in the outcome log (a dangling post-mortem)', () => {
    const outcome = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    const dangling = appendPostMortem(outcome.log, startPostMortemLog(), (() => {
      const draft: Omit<PostMortemRecord, 'postMortemId'> = {
        ordinal: 1,
        subject: { outcomeRecordRef: 'out:deadbeef', decisionRef: 'xd:fixture-decision-1', intentRef: 'si:fixture-intent-1', outcomeClass: 'adverse_gap' },
        expected: { expectedQuantity: '0.75', expectedRealized: '5.25', tolerance: '1' },
        happened: { disposition: 'filled', filledQuantity: '0.75', realizedOutcome: '-1.75', feeTotal: '1.25', notionalTotal: '50100' },
        gap: { quantityShortfall: '0', realizedGap: '-7', withinTolerance: false },
        hypotheses: [],
        evidence: [],
        lineage: { tenant: 'tenant-outcome-alpha', project: 'project-outcome-alpha', shadowSessionRef: 'shs:abcdef01', shadowOutcomeRef: 'swo:aaaaaaaa', trajectoryRef: null, experiment: null },
        asOf: asTimestampMs(T0 + 40_000),
        priorChainHead: '00000000',
      };
      const minted = mintPostMortem(draft);
      if (!minted.ok) throw new Error(minted.errors.map((error) => error.message).join('; '));
      return minted.value;
    })());
    expect(dangling.ok).toBe(false);
    if (!dangling.ok) expect(dangling.errors[0].code).toBe('lineage_gap');
  });

  it('fails the typed l4_boundary_violation when the post-mortem predates its subject outcome', () => {
    const outcome = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    const early = appendPostMortem(outcome.log, startPostMortemLog(), (() => {
      const minted = mintPostMortem({
        ordinal: 1,
        subject: { outcomeRecordRef: outcome.record.outcomeId, decisionRef: 'xd:fixture-decision-1', intentRef: 'si:fixture-intent-1', outcomeClass: 'adverse_gap' },
        expected: { expectedQuantity: '0.75', expectedRealized: '5.25', tolerance: '1' },
        happened: { disposition: 'filled', filledQuantity: '0.75', realizedOutcome: '-1.75', feeTotal: '1.25', notionalTotal: '50100' },
        gap: { quantityShortfall: '0', realizedGap: '-7', withinTolerance: false },
        hypotheses: [],
        evidence: [],
        lineage: { tenant: 'tenant-outcome-alpha', project: 'project-outcome-alpha', shadowSessionRef: 'shs:abcdef01', shadowOutcomeRef: 'swo:aaaaaaaa', trajectoryRef: null, experiment: null },
        asOf: asTimestampMs(T0 + 29_999), // the outcome was learned at T0 + 30_000
        priorChainHead: '00000000',
      });
      if (!minted.ok) throw new Error(minted.errors.map((error) => error.message).join('; '));
      return minted.value;
    })());
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.errors[0].code).toBe('l4_boundary_violation');
  });

  it('allows supersession by STRICTLY later append (the raw history is retained)', () => {
    const outcome = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    let log = startPostMortemLog();
    log = appendFixturePostMortem(outcome.log, log, 1, outcome.record.outcomeId, T0 + 40_000).log;
    // A strictly later refined draft is legal supersession (the raw history is retained).
    const refined = appendFixturePostMortem(outcome.log, log, 2, outcome.record.outcomeId, T0 + 50_000, (draft) => {
      draft.hypotheses = [{ class: 'model_error', confidence: '0.9', detail: { projected: '5.25', realized: '-1.75', kind: 'projection_bias' }, evidence: [], note: 'refined after review' }];
    });
    expect(refined.log.records.length).toBe(2);
    expect(verifyPostMortemChain(refined.log)).toBe(true);
    // Both drafts stay in the raw log (append-only — the first draft was not replaced).
    expect(refined.log.records[0]?.postMortemId).not.toBe(refined.log.records[1]?.postMortemId);
  });

  it('fails the typed postmortem_log_rewrite on a same-instant re-draft (the raw API)', () => {
    const outcome = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    let log = startPostMortemLog();
    log = appendFixturePostMortem(outcome.log, log, 1, outcome.record.outcomeId, T0 + 40_000).log;
    const crime = mintPostMortem({
      ordinal: 2,
      subject: { outcomeRecordRef: outcome.record.outcomeId, decisionRef: 'xd:fixture-decision-1', intentRef: 'si:fixture-intent-1', outcomeClass: 'adverse_gap' },
      expected: { expectedQuantity: '0.75', expectedRealized: '5.25', tolerance: '1' },
      happened: { disposition: 'filled', filledQuantity: '0.75', realizedOutcome: '-1.75', feeTotal: '1.25', notionalTotal: '50100' },
      gap: { quantityShortfall: '0', realizedGap: '-7', withinTolerance: false },
      hypotheses: [],
      evidence: [],
      lineage: { tenant: 'tenant-outcome-alpha', project: 'project-outcome-alpha', shadowSessionRef: 'shs:abcdef01', shadowOutcomeRef: 'swo:aaaaaaaa', trajectoryRef: null, experiment: null },
      asOf: asTimestampMs(T0 + 40_000), // NOT strictly later than the existing draft
      priorChainHead: log.head,
    });
    if (!crime.ok) throw new Error(crime.errors.map((error) => error.message).join('; '));
    const appended = appendPostMortem(outcome.log, log, crime.value);
    expect(appended.ok).toBe(false);
    if (!appended.ok) expect(appended.errors[0].code).toBe('postmortem_log_rewrite');
  });

  it('fails the typed tenant_mismatch when the post-mortem scope disagrees with the subject (L12)', () => {
    const outcome = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    const minted = mintPostMortem({
      ordinal: 1,
      subject: { outcomeRecordRef: outcome.record.outcomeId, decisionRef: 'xd:fixture-decision-1', intentRef: 'si:fixture-intent-1', outcomeClass: 'adverse_gap' },
      expected: { expectedQuantity: '0.75', expectedRealized: '5.25', tolerance: '1' },
      happened: { disposition: 'filled', filledQuantity: '0.75', realizedOutcome: '-1.75', feeTotal: '1.25', notionalTotal: '50100' },
      gap: { quantityShortfall: '0', realizedGap: '-7', withinTolerance: false },
      hypotheses: [],
      evidence: [],
      lineage: { tenant: 'tenant-foreign', project: 'project-outcome-alpha', shadowSessionRef: 'shs:abcdef01', shadowOutcomeRef: 'swo:aaaaaaaa', trajectoryRef: null, experiment: null },
      asOf: asTimestampMs(T0 + 40_000),
      priorChainHead: '00000000',
    });
    if (!minted.ok) throw new Error(minted.errors.map((error) => error.message).join('; '));
    const appended = appendPostMortem(outcome.log, startPostMortemLog(), minted.value);
    expect(appended.ok).toBe(false);
    if (!appended.ok) expect(appended.errors[0].code).toBe('tenant_mismatch');
  });

  it('fails the mint on an unsorted hypothesis list (determinism is a construction law)', () => {
    const result = mintPostMortem({
      ordinal: 1,
      subject: { outcomeRecordRef: 'out:00000000', decisionRef: 'xd:fixture-decision-1', intentRef: 'si:fixture-intent-1', outcomeClass: 'adverse_gap' },
      expected: { expectedQuantity: '0.75', expectedRealized: '5.25', tolerance: '1' },
      happened: { disposition: 'filled', filledQuantity: '0.75', realizedOutcome: '-1.75', feeTotal: '1.25', notionalTotal: '50100' },
      gap: { quantityShortfall: '0', realizedGap: '-7', withinTolerance: false },
      hypotheses: [
        { class: 'decision', confidence: '0.4', detail: { dimension: 'unresolved' }, evidence: [], note: null },
        { class: 'model_error', confidence: '0.6', detail: { projected: '5.25', realized: '-1.75', kind: 'unresolved' }, evidence: [], note: null }, // higher confidence AFTER lower
      ],
      evidence: [],
      lineage: { tenant: 'tenant-outcome-alpha', project: 'project-outcome-alpha', shadowSessionRef: 'shs:abcdef01', shadowOutcomeRef: 'swo:aaaaaaaa', trajectoryRef: null, experiment: null },
      asOf: asTimestampMs(T0 + 40_000),
      priorChainHead: '00000000',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid_state');
  });

  it('is byte-deterministic: identical drafts produce identical ids, heads and digests (twice)', () => {
    const outcomeA = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    const outcomeB = appendFixtureOutcome(startOutcomeLearningLog(), 1);
    const draftA = appendFixturePostMortem(outcomeA.log, startPostMortemLog(), 1, outcomeA.record.outcomeId, T0 + 40_000);
    const draftB = appendFixturePostMortem(outcomeB.log, startPostMortemLog(), 1, outcomeB.record.outcomeId, T0 + 40_000);
    expect(draftA.record.postMortemId).toBe(draftB.record.postMortemId);
    expect(draftA.log.head).toBe(draftB.log.head);
    expect(postMortemLogDigest(draftA.log)).toBe(postMortemLogDigest(draftB.log));
  });
});
