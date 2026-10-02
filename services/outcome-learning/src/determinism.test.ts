/**
 * @tradrl/outcome-learning — the DETERMINISM suite (L9): the whole
 * pipeline (ingest -> draft -> query -> hooks) runs TWICE over fresh
 * state with identical inputs and must produce byte-identical state,
 * records, heads, digests and query results — pinned against the
 * golden literals. The state is JSON-serializable by construction
 * (the round trip preserves the chains).
 */

import { describe, expect, it } from 'vitest';
import { createOutcomeLearningState, ingestShadowOutcomes, outcomeLearningStateDigest, type OutcomeLearningState } from './state';
import { generatePostMortemDrafts } from './postmortem';
import { DEFAULT_POST_MORTEM_DRAFT_POLICY } from './policy';
import { queryLearningHooks, queryOutcomeRecords } from './query';
import { canonicalJson, verifyOutcomeLearningChain, verifyPostMortemChain } from './imports';
import {
  GOLDEN_ACCRUAL_DELTA,
  GOLDEN_CLASSES,
  GOLDEN_DATA_LAG_HYPOTHESES,
  GOLDEN_DRAFT_COUNT,
  GOLDEN_MARKET_MOVE_HYPOTHESES,
  GOLDEN_MODEL_ERROR_HYPOTHESES,
  GOLDEN_OUTCOME_LOG_HEAD,
  GOLDEN_POSTMORTEM_LOG_HEAD,
  GOLDEN_STATE_DIGEST,
} from './golden';
import { scenarioBatch, scenarioDraftAt, scenarioMarkFacts } from './fixtures';

/** The full pipeline over fresh state (unwraps). */
function runPipeline(): OutcomeLearningState {
  const ingested = ingestShadowOutcomes(createOutcomeLearningState(), scenarioBatch());
  if (!ingested.ok) throw new Error(ingested.errors.map((error) => error.message).join('; '));
  const drafted = generatePostMortemDrafts(ingested.value, DEFAULT_POST_MORTEM_DRAFT_POLICY, { markFacts: scenarioMarkFacts(), at: scenarioDraftAt() });
  if (!drafted.ok) throw new Error(drafted.errors.map((error) => error.message).join('; '));
  return drafted.value.state;
}

describe('the determinism law (identical inputs -> identical bytes)', () => {
  it('produces byte-identical state, heads and digests over two fresh runs', () => {
    const first = runPipeline();
    const second = runPipeline();
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.outcomeLog.head).toBe(second.outcomeLog.head);
    expect(first.postMortemLog.head).toBe(second.postMortemLog.head);
    expect(outcomeLearningStateDigest(first)).toBe(outcomeLearningStateDigest(second));
  });

  it('pins the golden literals (any drift fails loudly)', () => {
    const state = runPipeline();
    expect(outcomeLearningStateDigest(state)).toBe(GOLDEN_STATE_DIGEST);
    expect(state.outcomeLog.head).toBe(GOLDEN_OUTCOME_LOG_HEAD);
    expect(state.postMortemLog.head).toBe(GOLDEN_POSTMORTEM_LOG_HEAD);
    expect(state.outcomeLog.records.map((record) => record.outcomeClass)).toEqual([...GOLDEN_CLASSES]);
    expect(state.ingestions[0]?.book.accrualDelta).toBe(GOLDEN_ACCRUAL_DELTA);
    expect(state.postMortemLog.records.length).toBe(GOLDEN_DRAFT_COUNT);
    const dataLag = state.postMortemLog.records.filter((draft) => draft.hypotheses.some((hypothesis) => hypothesis.class === 'data_lag')).length;
    expect(dataLag).toBe(GOLDEN_DATA_LAG_HYPOTHESES);
    const marketMove = state.postMortemLog.records.filter((draft) => draft.hypotheses.some((hypothesis) => hypothesis.class === 'market_move')).length;
    expect(marketMove).toBe(GOLDEN_MARKET_MOVE_HYPOTHESES);
    const modelError = state.postMortemLog.records.filter((draft) => draft.hypotheses.some((hypothesis) => hypothesis.class === 'model_error')).length;
    expect(modelError).toBe(GOLDEN_MODEL_ERROR_HYPOTHESES);
  });

  it('produces identical query + hook results over two fresh runs (content-addressed derivation)', () => {
    const first = runPipeline();
    const second = runPipeline();
    const options = { at: scenarioDraftAt(), retention: { outcomeWindowMs: Number.MAX_SAFE_INTEGER, postMortemWindowMs: Number.MAX_SAFE_INTEGER } };
    const queryA = queryOutcomeRecords(first, { tenant: 'tenant-learning-beta', project: 'project-learning-beta' }, options);
    const queryB = queryOutcomeRecords(second, { tenant: 'tenant-learning-beta', project: 'project-learning-beta' }, options);
    if (!queryA.ok || !queryB.ok) throw new Error('query failed');
    expect(canonicalJson(queryA.value)).toBe(canonicalJson(queryB.value));
    const hooksA = queryLearningHooks(first, { tenant: 'tenant-learning-beta', project: 'project-learning-beta' }, options);
    const hooksB = queryLearningHooks(second, { tenant: 'tenant-learning-beta', project: 'project-learning-beta' }, options);
    if (!hooksA.ok || !hooksB.ok) throw new Error('hook query failed');
    expect(canonicalJson(hooksA.value)).toBe(canonicalJson(hooksB.value));
  });

  it('survives a JSON round trip with both chains still verifying (serializable evidence)', () => {
    const state = runPipeline();
    const roundTripped = JSON.parse(JSON.stringify(state)) as unknown as OutcomeLearningState;
    expect(verifyOutcomeLearningChain(roundTripped.outcomeLog)).toBe(true);
    expect(verifyPostMortemChain(roundTripped.postMortemLog)).toBe(true);
    expect(outcomeLearningStateDigest(roundTripped)).toBe(outcomeLearningStateDigest(state));
  });
});
