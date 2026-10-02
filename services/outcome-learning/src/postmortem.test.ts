/**
 * @tradrl/outcome-learning — the POST-MORTEM DRAFT suites: the
 * evidence-gated hypothesis emission (each class a TYPED record, never
 * prose-only), the policy-declared confidences, the canonical
 * ordering, the subject binding, and the supersession-by-append law.
 */

import { describe, expect, it } from 'vitest';
import { createOutcomeLearningState, ingestShadowOutcomes, type OutcomeLearningState } from './state';
import { generatePostMortemDrafts } from './postmortem';
import { DEFAULT_POST_MORTEM_DRAFT_POLICY, validatePostMortemDraftPolicy } from './policy';
import { canonicalJson, deepFreeze, fnv1a32Hex } from './imports';
import {
  scenarioBatch,
  scenarioDraftAt,
  scenarioMarkFacts,
} from './fixtures';

/** Ingest the scenario once (unwraps). */
function ingestScenario(): OutcomeLearningState {
  const result = ingestShadowOutcomes(createOutcomeLearningState(), scenarioBatch());
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  return result.value;
}

/** Ingest + draft over the scenario (unwraps). */
function draftedScenario() {
  const state = ingestScenario();
  const drafts = generatePostMortemDrafts(state, DEFAULT_POST_MORTEM_DRAFT_POLICY, { markFacts: scenarioMarkFacts(), at: scenarioDraftAt() });
  if (!drafts.ok) throw new Error(drafts.errors.map((error) => error.message).join('; '));
  return drafts.value;
}

describe('the draft policy', () => {
  it('validates the default policy', () => {
    expect(validatePostMortemDraftPolicy(DEFAULT_POST_MORTEM_DRAFT_POLICY).ok).toBe(true);
  });

  it('fails the typed unknown_outcome_class on a foreign warranted class', () => {
    const result = validatePostMortemDraftPolicy({ ...DEFAULT_POST_MORTEM_DRAFT_POLICY, warrantedClasses: ['lucky_trade'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('unknown_outcome_class');
  });

  it('fails the typed confidence_incoherent on an out-of-interval confidence', () => {
    const result = validatePostMortemDraftPolicy({
      ...DEFAULT_POST_MORTEM_DRAFT_POLICY,
      confidences: { ...DEFAULT_POST_MORTEM_DRAFT_POLICY.confidences, modelError: '1.2' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('confidence_incoherent');
  });
});

describe('the draft generation (evidence-gated, typed, never prose-only)', () => {
  it('drafts exactly the warranted un-post-mortemed outcomes, in ordinal order', () => {
    const { drafts } = draftedScenario();
    expect(drafts.map((draft) => draft.subject.outcomeClass)).toEqual(['adverse_gap', 'execution_shortfall', 'no_execution']);
  });

  it('emits the model_error + market_move + decision hypotheses for the adverse gap (canonical order)', () => {
    const { drafts } = draftedScenario();
    const adverse = drafts[0];
    expect(adverse?.hypotheses.map((hypothesis) => hypothesis.class)).toEqual(['model_error', 'market_move', 'decision']);
    // The confidences come from the POLICY (fixed decimals).
    expect(adverse?.hypotheses.map((hypothesis) => hypothesis.confidence)).toEqual(['0.6', '0.5', '0.4']);
    // Every hypothesis is TYPED (never prose-only).
    const modelError = adverse?.hypotheses[0];
    expect(modelError?.detail).toEqual({ projected: '5.25', realized: '-1.75', kind: 'unresolved' });
    const marketMove = adverse?.hypotheses[1];
    expect(marketMove?.detail).toEqual({ markAtDecision: '50100', markAtWindow: '49900', direction: 'adverse' }); // the BUY watched a 200 fall — adverse, position-relative
    const decision = adverse?.hypotheses[2];
    expect(decision?.detail).toEqual({ dimension: 'unresolved' }); // the honest draft
  });

  it('emits the data_lag hypothesis with the EXACT lag when a fill arrives after the decision', () => {
    const { drafts } = draftedScenario();
    const shortfall = drafts[1];
    // The BTC marks are shared evidence: the partial's draft also carries the
    // market_move (0.5) ahead of decision (0.4) and data_lag (0.3).
    expect(shortfall?.hypotheses.map((hypothesis) => hypothesis.class)).toEqual(['market_move', 'decision', 'data_lag']);
    const dataLag = shortfall?.hypotheses[2];
    expect(dataLag?.detail).toEqual({ decisionAt: 1700000120000, availableAt: 1700000120150, lagMs: 150 });
    expect(dataLag?.evidence.map((evidence) => evidence.ref)).toEqual(['swf-00000003', 'swf-00000004']);
  });

  it('emits no model_error and no data_lag for the expiry (no declaration, no fills)', () => {
    const { drafts } = draftedScenario();
    const expiry = drafts[2];
    // The shared BTC marks still emit the market_move; the expiry carries NO
    // model_error (nothing was declared) and NO data_lag (nothing filled).
    expect(expiry?.hypotheses.map((hypothesis) => hypothesis.class)).toEqual(['market_move', 'decision']);
    expect(expiry?.hypotheses.some((hypothesis) => hypothesis.class === 'model_error')).toBe(false);
    expect(expiry?.hypotheses.some((hypothesis) => hypothesis.class === 'data_lag')).toBe(false);
    expect(expiry?.happened.disposition).toBe('expired');
    expect(expiry?.gap.quantityShortfall).toBe('0.1');
  });

  it('carries the subject blocks BY VALUE (byte-stable denormalization) and the full lineage', () => {
    const { drafts, state } = draftedScenario();
    const adverse = drafts[0];
    const subject = state.outcomeLog.records[0];
    expect(adverse?.subject.outcomeRecordRef).toBe(subject?.outcomeId);
    expect(adverse?.expected.expectedQuantity).toBe(subject?.expectation.expectedQuantity);
    expect(adverse?.expected.expectedRealized).toBe(subject?.expectation.expectedRealized);
    expect(adverse?.expected.tolerance).toBe(subject?.expectation.tolerance);
    expect(adverse?.happened).toEqual({
      disposition: 'filled',
      filledQuantity: '0.75',
      realizedOutcome: '-1.75',
      feeTotal: '1.25',
      notionalTotal: '37575',
    });
    expect(adverse?.gap).toEqual(subject?.deviation);
    expect(adverse?.lineage).toEqual({
      tenant: 'tenant-learning-beta',
      project: 'project-learning-beta',
      shadowSessionRef: 'shs:beefbeef',
      shadowOutcomeRef: subject?.lineage.shadowOutcomeRef,
      trajectoryRef: 'trajectory-learning-1',
      experiment: { experimentRef: 'experiment-learning-1', trialRef: 'trial-learning-1' },
    });
  });

  it('emits NO market_move hypothesis when the move is within the threshold (evidence-gated)', () => {
    const state = ingestScenario();
    const quietMarks = deepFreeze([{ venue: 'LEARNINGSIM', instrument: 'BTC-USD', markAtDecision: '50100', markAtWindow: '50150' }]); // 50 < 100
    const drafts = generatePostMortemDrafts(state, DEFAULT_POST_MORTEM_DRAFT_POLICY, { markFacts: quietMarks, at: scenarioDraftAt() });
    if (!drafts.ok) throw new Error(drafts.errors.map((error) => error.message).join('; '));
    const adverse = drafts.value.drafts[0];
    expect(adverse?.hypotheses.map((hypothesis) => hypothesis.class)).toEqual(['model_error', 'decision']); // no market_move
  });

  it('never re-drafts an already-post-mortemed outcome (supersession is by APPEND, not by this pass)', () => {
    const once = draftedScenario();
    const twice = generatePostMortemDrafts(once.state, DEFAULT_POST_MORTEM_DRAFT_POLICY, { markFacts: scenarioMarkFacts(), at: scenarioDraftAt() });
    if (!twice.ok) throw new Error(twice.errors.map((error) => error.message).join('; '));
    expect(twice.value.drafts.length).toBe(0); // everything warranted is already drafted
    expect(twice.value.state.postMortemLog.records.length).toBe(once.state.postMortemLog.records.length);
  });

  it('drafts newly-ingested outcomes on the next pass (the pass is idempotent per outcome)', () => {
    const drafted = draftedScenario();
    // A second session's stream (fresh intents/decisions, a new session id) — a second batch.
    const secondBatch = deepFreeze({
      outcomeLog: remintSession(scenarioBatch().outcomeLog),
      bookSnapshot: scenarioBatch().bookSnapshot,
      binding: { trajectoryRef: null, experimentRef: null, trialRef: null },
      at: scenarioBatch().at,
    });
    const ingested = ingestShadowOutcomes(drafted.state, secondBatch);
    if (!ingested.ok) throw new Error(ingested.errors.map((error) => error.message).join('; '));
    const again = generatePostMortemDrafts(ingested.value, DEFAULT_POST_MORTEM_DRAFT_POLICY, { markFacts: scenarioMarkFacts(), at: scenarioDraftAt() });
    if (!again.ok) throw new Error(again.errors.map((error) => error.message).join('; '));
    // Without facts/expectations the second session's first record is
    // unbenchmarked (not warranted); only the partial and the expired warrant drafts.
    expect(again.value.drafts.length).toBe(2);
    expect(again.value.state.postMortemLog.records.length).toBe(5);
  });
});

/** Remint a stream under a second session identity (fresh intents/decisions, a new session id — a second batch, chain-rebuilt under T030's fold). */
function remintSession(log: unknown): unknown {
  const stream = log as { records: unknown[] };
  let head = '00000000';
  const minted: unknown[] = [];
  for (const raw of stream.records) {
    const entry = raw as Record<string, unknown>;
    const lineage = entry.lineage as Record<string, unknown>;
    const draft = {
      ...entry,
      intentRef: `si:second-${String(entry.ordinal)}`,
      decisionRef: `xd:second-${String(entry.ordinal)}`,
      lineage: deepFreeze({ ...lineage, sessionId: 'shs:second99' }),
      priorChainHead: head,
    } as Record<string, unknown>;
    const content = {
      ordinal: draft.ordinal,
      intentRef: draft.intentRef,
      decisionRef: draft.decisionRef,
      refusalRef: draft.refusalRef,
      disposition: draft.disposition,
      fills: draft.fills,
      costs: draft.costs,
      realizedOutcome: draft.realizedOutcome,
      unrealizedAtDecision: draft.unrealizedAtDecision,
      priorChainHead: draft.priorChainHead,
      lineage: draft.lineage,
      asOf: draft.asOf,
    };
    const record = deepFreeze({ ...draft, outcomeId: `swo:${fnv1a32Hex(canonicalJson(content))}` });
    minted.push(record);
    head = fnv1a32Hex(`${head}${canonicalJson(content)}`);
  }
  return deepFreeze({ records: minted, head });
}
