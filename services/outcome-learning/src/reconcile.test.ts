/**
 * @tradrl/outcome-learning — the RECONCILIATION + INGESTION suites:
 * the per-decision derivation laws (honest NULLs, exact decimals, the
 * class sequence), the account cross-check against the shadow book
 * (the accrual delta quantified), and the ingestion's coherence laws
 * (tampered stream, L4 future, session mixing, dangling facts,
 * re-ingestion).
 */

import { describe, expect, it } from 'vitest';
import { createOutcomeLearningState, ingestShadowOutcomes, type OutcomeLearningState } from './state';
import { reconcileAgainstBook } from './reconcile';
import { asTimestampMs, deepFreeze } from './imports';
import {
  scenarioBinding,
  scenarioBookSnapshot,
  scenarioDecisionFacts,
  scenarioExpectations,
  scenarioFillFacts,
  scenarioIngestAt,
  scenarioShadowLog,
  SCENARIO_CLASSES,
  T0,
} from './fixtures';

/** The canonical scenario batch (deterministic). */
function scenarioBatch() {
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

/** Ingest the scenario once (unwraps). */
function ingestScenario(): OutcomeLearningState {
  const result = ingestShadowOutcomes(createOutcomeLearningState(), scenarioBatch());
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.code}: ${error.message}`).join('; '));
  return result.value;
}

describe('the per-decision reconciliation (the golden scenario)', () => {
  it('ingests the six-decision stream and derives the class sequence', () => {
    const state = ingestScenario();
    expect(state.outcomeLog.records.length).toBe(6);
    expect(state.outcomeLog.records.map((record) => record.outcomeClass)).toEqual([...SCENARIO_CLASSES]);
  });

  it('reconciles the quantity dimension per disposition (honest NULLs, exact decimals)', () => {
    const state = ingestScenario();
    const [adverse, asExpected, averted, shortfall, noExecution, unbenchmarked] = state.outcomeLog.records;
    // 1. filled with facts: full quantity, shortfall 0, gap -7, outside tolerance.
    expect(adverse?.expectation.expectedQuantity).toBe('0.75');
    expect(adverse?.realization.filledQuantity).toBe('0.75');
    expect(adverse?.deviation.quantityShortfall).toBe('0');
    expect(adverse?.deviation.realizedGap).toBe('-7');
    expect(adverse?.deviation.withinTolerance).toBe(false);
    // 2. filled, as expected: gap 0.5 within tolerance 1.
    expect(asExpected?.deviation.realizedGap).toBe('0.5');
    expect(asExpected?.deviation.withinTolerance).toBe(true);
    // 3. refused: zero expected, zero filled, zero realized (T030's law).
    expect(averted?.expectation.expectedQuantity).toBe('0');
    expect(averted?.realization.filledQuantity).toBe('0');
    expect(averted?.realization.realizedOutcome).toBe('0');
    expect(averted?.deviation.quantityShortfall).toBe('0');
    // 4. partial with fill facts: 0.6 of 0.9 — the exact shortfall 0.3.
    expect(shortfall?.realization.filledQuantity).toBe('0.6');
    expect(shortfall?.deviation.quantityShortfall).toBe('0.3');
    // 5. expired: zero filled; the shortfall is the whole order (0.1).
    expect(noExecution?.realization.filledQuantity).toBe('0');
    expect(noExecution?.deviation.quantityShortfall).toBe('0.1');
    // 6. filled without a declared expectation: unbenchmarked, gap NULL — never invented.
    expect(unbenchmarked?.expectation.expectedRealized).toBeNull();
    expect(unbenchmarked?.deviation.realizedGap).toBeNull();
    expect(unbenchmarked?.deviation.withinTolerance).toBeNull();
  });

  it('preserves the shadow lineage BYTE-FOR-BYTE and pins the full L9/L15 linkage', () => {
    const state = ingestScenario();
    const stream = scenarioShadowLog();
    for (let index = 0; index < stream.records.length; index++) {
      const learned = state.outcomeLog.records[index];
      const shadow = stream.records[index];
      expect(JSON.stringify(learned?.lineage.shadow)).toBe(JSON.stringify(shadow?.lineage)); // byte-preserving law
      expect(learned?.lineage.shadowOutcomeRef).toBe(shadow?.outcomeId);
      expect(learned?.lineage.shadowOutcomeOrdinal).toBe(shadow?.ordinal);
      expect(learned?.lineage.shadowAsOf).toBe(shadow?.asOf);
      expect(learned?.lineage.decisionStreamPosition).toBe(index + 1);
      expect(learned?.lineage.trajectoryRef).toBe('trajectory-learning-1');
      expect(learned?.lineage.experiment).toEqual({ experimentRef: 'experiment-learning-1', trialRef: 'trial-learning-1' });
      // The realization's money fields are VERBATIM from the shadow record.
      expect(learned?.realization.realizedOutcome).toBe(shadow?.realizedOutcome);
      expect(learned?.realization.feeTotal).toBe(shadow?.costs.feeTotal);
      expect(learned?.realization.notionalTotal).toBe(shadow?.costs.notionalTotal);
      expect(learned?.realization.unrealizedAtDecision).toBe(shadow?.unrealizedAtDecision);
    }
  });

  it('carries honest NULLs when the caller supplies no facts (never invented numbers)', () => {
    const result = ingestShadowOutcomes(createOutcomeLearningState(), {
      ...scenarioBatch(),
      decisionFacts: undefined,
      fillFacts: undefined,
      expectations: undefined,
    });
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    const [first, , , partial] = result.value.outcomeLog.records;
    expect(first?.expectation.expectedQuantity).toBeNull(); // no order facts
    expect(first?.expectation.expectedRealized).toBeNull(); // no declaration
    expect(first?.expectation.declaredBy).toBeNull();
    expect(first?.deviation.realizedGap).toBeNull();
    expect(first?.outcomeClass).toBe('unbenchmarked_fill'); // filled + no benchmark
    expect(partial?.realization.filledQuantity).toBeNull(); // no fill facts
    expect(partial?.deviation.quantityShortfall).toBeNull();
    expect(partial?.outcomeClass).toBe('execution_shortfall'); // the disposition carries it
  });
});

describe('the account reconciliation (against the shadow book)', () => {
  it('sums the stream exactly onto the snapshot (accrual delta zero)', () => {
    const state = ingestScenario();
    const receipt = state.ingestions[0];
    expect(receipt?.book.outcomeCount).toBe(6);
    expect(receipt?.book.streamRealizedSum).toBe('40.75');
    expect(receipt?.book.bookRealized).toBe('40.75');
    expect(receipt?.book.accrualDelta).toBe('0');
    expect(receipt?.book.coherent).toBe(true);
  });

  it('quantifies a nonzero accrual delta exactly (the late-fill phenomenon, never assumed away)', () => {
    const book = { ...scenarioBookSnapshot(), realizedPnl: '41.75' }; // one late-fill unit of realized
    const reconciliation = reconcileAgainstBook(scenarioShadowLog().records, book);
    expect(reconciliation.streamRealizedSum).toBe('40.75');
    expect(reconciliation.bookRealized).toBe('41.75');
    expect(reconciliation.accrualDelta).toBe('1');
    expect(reconciliation.coherent).toBe(false);
  });
});

describe('the ingestion coherence laws (fail-closed, typed)', () => {
  it('fails the typed chain_mismatch on a TAMPERED stream (never learned from)', () => {
    const stream = scenarioShadowLog();
    const edited = stream.records[0] as { realizedOutcome: string };
    const tampered = deepFreeze({
      ...stream,
      records: [{ ...stream.records[0], realizedOutcome: '999999' }, ...stream.records.slice(1)],
    });
    void edited;
    const result = ingestShadowOutcomes(createOutcomeLearningState(), { ...scenarioBatch(), outcomeLog: tampered });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('chain_mismatch');
  });

  it('fails the typed l4_boundary_violation when the ingestion instant precedes the evidence', () => {
    const result = ingestShadowOutcomes(createOutcomeLearningState(), { ...scenarioBatch(), at: asTimestampMs(T0 + 150_000) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('l4_boundary_violation');
  });

  it('accepts a book snapshot whose asOf is the last-applied instant (T030 book semantics) and records it on the receipt', () => {
    // T030's final book carries the LAST FILL's availability instant, which can
    // precede the last decision ticks — the snapshot instant is recorded, never
    // rejected (the declared interpretation; see state.ts).
    const lastAppliedBook = { ...scenarioBookSnapshot(), asOf: asTimestampMs(T0 + 120_150) };
    const result = ingestShadowOutcomes(createOutcomeLearningState(), { ...scenarioBatch(), bookSnapshot: lastAppliedBook });
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    expect(result.value.ingestions[0]?.book.bookAsOf).toBe(asTimestampMs(T0 + 120_150));
  });

  it('fails the typed invalid_field on facts for a foreign intent (a dangling fact)', () => {
    const foreignFacts = [...scenarioDecisionFacts(), { intentRef: 'si:not-in-stream', decisionRef: null, venue: 'V', instrument: 'I', side: 'buy', orderQuantity: '1', streamPosition: 99 }];
    const result = ingestShadowOutcomes(createOutcomeLearningState(), { ...scenarioBatch(), decisionFacts: foreignFacts });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid_field');
  });

  it('fails the typed outcome_log_rewrite on RE-INGESTION (one decision, one learned outcome)', () => {
    const state = ingestScenario();
    const again = ingestShadowOutcomes(state, scenarioBatch());
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors[0].code).toBe('outcome_log_rewrite');
  });

  it('retains the per-outcome facts the drafts consume (venue/side/fills/latest availability)', () => {
    const state = ingestScenario();
    expect(state.outcomeFacts.length).toBe(6);
    const lagged = state.outcomeFacts.find((entry) => entry.outcomeRecordRef === state.outcomeLog.records[3]?.outcomeId);
    expect(lagged?.venue).toBe('LEARNINGSIM');
    expect(lagged?.side).toBe('buy');
    expect(lagged?.fills).toEqual(['swf-00000003', 'swf-00000004']);
    expect(lagged?.latestAvailableAt).toBe(asTimestampMs(T0 + 120_150)); // the data-lag anchor
    expect(lagged?.decisionAt).toBe(asTimestampMs(T0 + 120_000));
  });
});
