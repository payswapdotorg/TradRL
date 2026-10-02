/**
 * @tradrl/outcomes — the OUTCOME RECORD suites: the mint's coherence
 * laws (class coherence, L12 scope, L4 evidence boundary, exact
 * decimals, closed vocabularies), the content-addressed identity, the
 * deep-freeze discipline and byte-determinism.
 */

import { describe, expect, it } from 'vitest';
import { classifyOutcome, OUTCOME_CLASSES, requireOutcomeClass } from './classification';
import { requireAttributionClass, validateAttributionHypothesis, ATTRIBUTION_CLASSES } from './attribution';
import { requireEvidenceRef, EVIDENCE_KINDS } from './evidence';
import { mintOutcomeRecord } from './outcome-record';
import { canonicalJson, isDeeplyFrozen, signedAdd, signedSubtract, signedCompare, signedAbs, unsignedAdd } from './primitives';
import { appendOutcomeRecord, startOutcomeLearningLog } from './logs';
import { compileOutcomeLearningHook } from './hooks';
import { appendFixtureOutcome, fixtureOutcomeInput, logWithOneOutcome, T0, TENANT } from './fixtures';
import { asTimestampMs } from './primitives';
import type { OutcomeClassificationInput } from './classification';

describe('the exact-decimal local kernel', () => {
  it('adds signed canonical decimals exactly', () => {
    expect(signedAdd('1.5', '-2.25')).toBe('-0.75');
    expect(signedAdd('-1.5', '-2.25')).toBe('-3.75');
    expect(signedAdd('0.1', '0.2')).toBe('0.3'); // the float crime's canonical answer
    expect(signedAdd('0', '0')).toBe('0');
    expect(signedAdd('-0.0000001', '0.0000001')).toBe('0');
  });

  it('subtracts and compares signed canonical decimals exactly', () => {
    expect(signedSubtract('5', '7.5')).toBe('-2.5');
    expect(signedSubtract('-5', '-7.5')).toBe('2.5');
    expect(signedCompare('-2.5', '2.4')).toBe(-1);
    expect(signedCompare('2.50', '2.5')).toBe(0);
    expect(signedCompare('0.1', '0.099999999')).toBe(1);
    expect(signedAbs('-7.25')).toBe('7.25');
    expect(unsignedAdd('0.75', '0.25')).toBe('1');
  });

  it('normalizes negative zero away (canonical grammar)', () => {
    expect(signedAdd('5', '-5')).toBe('0');
    expect(signedAbs('-0')).toBe('0');
  });
});

describe('the outcome-class vocabulary (closed)', () => {
  it('has exactly the seven declared members', () => {
    expect([...OUTCOME_CLASSES]).toEqual([
      'averted', 'no_execution', 'execution_shortfall',
      'as_expected', 'adverse_gap', 'favorable_gap', 'unbenchmarked_fill',
    ]);
  });

  it('fails the typed unknown_outcome_class on a foreign string (never coerced)', () => {
    for (const foreign of ['great_trade', '', 'filled', 'ADVERSE_GAP', 'as-expected']) {
      const result = requireOutcomeClass(foreign);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].code).toBe('unknown_outcome_class');
    }
    expect(requireOutcomeClass('as_expected').ok).toBe(true);
  });

  it('derives the class deterministically from the record facts', () => {
    expect(classifyOutcome({ disposition: 'refused', expectedQuantity: '0', filledQuantity: '0', expectedRealized: null, realizedOutcome: '0', tolerance: '1' })).toMatchObject({ ok: true, value: 'averted' });
    expect(classifyOutcome({ disposition: 'expired', expectedQuantity: '0.75', filledQuantity: '0', expectedRealized: null, realizedOutcome: '0', tolerance: '1' })).toMatchObject({ ok: true, value: 'no_execution' });
    expect(classifyOutcome({ disposition: 'partial', expectedQuantity: '0.75', filledQuantity: '0.5', expectedRealized: '1', realizedOutcome: '0.5', tolerance: '1' })).toMatchObject({ ok: true, value: 'execution_shortfall' });
    expect(classifyOutcome({ disposition: 'filled', expectedQuantity: '0.75', filledQuantity: '0.75', expectedRealized: '5', realizedOutcome: '4.5', tolerance: '1' })).toMatchObject({ ok: true, value: 'as_expected' });
    expect(classifyOutcome({ disposition: 'filled', expectedQuantity: '0.75', filledQuantity: '0.75', expectedRealized: '5', realizedOutcome: '3.9', tolerance: '1' })).toMatchObject({ ok: true, value: 'adverse_gap' });
    expect(classifyOutcome({ disposition: 'filled', expectedQuantity: '0.75', filledQuantity: '0.75', expectedRealized: '5', realizedOutcome: '6.1', tolerance: '1' })).toMatchObject({ ok: true, value: 'favorable_gap' });
    expect(classifyOutcome({ disposition: 'filled', expectedQuantity: '0.75', filledQuantity: '0.75', expectedRealized: null, realizedOutcome: '-1.75', tolerance: '1' })).toMatchObject({ ok: true, value: 'unbenchmarked_fill' });
  });

  it('fails the typed decimal_imprecision when a money path carries a JS number', () => {
    // The compile-time type forbids a number on a money path; the runtime
    // trip wire is the defense in depth for untrusted boundaries.
    const smuggled = { disposition: 'filled', expectedQuantity: 0.75, filledQuantity: '0.75', expectedRealized: null, realizedOutcome: '0', tolerance: '1' } as unknown as OutcomeClassificationInput;
    const result = classifyOutcome(smuggled);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('decimal_imprecision');
  });

  it('refuses a refusal that claims nonzero realized (T030 law coherence)', () => {
    const result = classifyOutcome({ disposition: 'refused', expectedQuantity: '0', filledQuantity: '0', expectedRealized: null, realizedOutcome: '5', tolerance: '1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid_state');
  });
});

describe('the attribution contracts (typed, never prose-only)', () => {
  it('has exactly the four declared classes', () => {
    expect([...ATTRIBUTION_CLASSES]).toEqual(['decision', 'market_move', 'model_error', 'data_lag']);
  });

  it('fails the typed unknown_attribution_class on a foreign class', () => {
    const result = requireAttributionClass('luck');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('unknown_attribution_class');
  });

  it('validates each class typed payload and rejects mismatched payloads', () => {
    expect(validateAttributionHypothesis({ class: 'decision', confidence: '0.4', detail: { dimension: 'timing' }, evidence: [], note: null }).ok).toBe(true);
    expect(validateAttributionHypothesis({ class: 'decision', confidence: '0.4', detail: { dimension: 'greed' }, evidence: [], note: null }).ok).toBe(false);
    expect(validateAttributionHypothesis({ class: 'market_move', confidence: '0.5', detail: { markAtDecision: '50000', markAtWindow: '48000', direction: 'adverse' }, evidence: [], note: null }).ok).toBe(true);
    expect(validateAttributionHypothesis({ class: 'market_move', confidence: '0.5', detail: { markAtDecision: 50000, markAtWindow: '48000', direction: 'adverse' }, evidence: [], note: null }).ok).toBe(false);
    expect(validateAttributionHypothesis({ class: 'model_error', confidence: '0.6', detail: { projected: '5', realized: '-1.75', kind: 'unresolved' }, evidence: [], note: null }).ok).toBe(true);
    expect(validateAttributionHypothesis({ class: 'model_error', confidence: '0.6', detail: { projected: '5', realized: '-1.75', kind: 'wishful_thinking' }, evidence: [], note: null }).ok).toBe(false);
    expect(validateAttributionHypothesis({ class: 'data_lag', confidence: '0.3', detail: { decisionAt: T0, availableAt: T0 + 250, lagMs: 250 }, evidence: [], note: null }).ok).toBe(true);
    expect(validateAttributionHypothesis({ class: 'data_lag', confidence: '0.3', detail: { decisionAt: T0, availableAt: T0 + 250, lagMs: 999 }, evidence: [], note: null }).ok).toBe(false);
  });

  it('fails the typed confidence_incoherent outside the unit interval (and decimal_imprecision for numbers)', () => {
    for (const incoherent of ['1.5', '-0.1', '2', '1.0000001']) {
      const result = validateAttributionHypothesis({ class: 'decision', confidence: incoherent, detail: { dimension: 'timing' }, evidence: [], note: null });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].code).toBe('confidence_incoherent');
    }
    for (const coherent of ['0', '1', '0.45', '0.50000000000000000001', '1.0', '0.0000001']) {
      expect(validateAttributionHypothesis({ class: 'decision', confidence: coherent, detail: { dimension: 'timing' }, evidence: [], note: null }).ok).toBe(true);
    }
    const numberConfidence = validateAttributionHypothesis({ class: 'decision', confidence: 0.4, detail: { dimension: 'timing' }, evidence: [], note: null });
    expect(numberConfidence.ok).toBe(false);
    if (!numberConfidence.ok) expect(numberConfidence.errors[0].code).toBe('decimal_imprecision');
  });
});

describe('the evidence references (closed kinds + prefix discipline)', () => {
  it('carries exactly the declared kinds', () => {
    expect([...EVIDENCE_KINDS]).toEqual([
      'shadow_outcome', 'shadow_fill', 'shadow_refusal', 'shadow_session', 'decision',
      'intent', 'trajectory', 'experiment', 'trial', 'book_snapshot', 'mark_fact',
    ]);
  });

  it('enforces the owning lanes prefix grammar per kind', () => {
    expect(requireEvidenceRef({ kind: 'shadow_outcome', ref: 'swo:abcd1234' }).ok).toBe(true);
    expect(requireEvidenceRef({ kind: 'shadow_outcome', ref: 'swf-00000001' }).ok).toBe(false);
    expect(requireEvidenceRef({ kind: 'shadow_fill', ref: 'swf-00000001' }).ok).toBe(true);
    expect(requireEvidenceRef({ kind: 'shadow_refusal', ref: 'swr:abcd1234' }).ok).toBe(true);
    expect(requireEvidenceRef({ kind: 'shadow_session', ref: 'shs:abcd1234' }).ok).toBe(true);
    expect(requireEvidenceRef({ kind: 'decision', ref: 'xd:abcd1234' }).ok).toBe(true);
    expect(requireEvidenceRef({ kind: 'intent', ref: 'si:abcd1234' }).ok).toBe(true);
    expect(requireEvidenceRef({ kind: 'trajectory', ref: 'any-opaque-id' }).ok).toBe(true);
    expect(requireEvidenceRef({ kind: 'book_snapshot', ref: '0123abcd' }).ok).toBe(true);
    expect(requireEvidenceRef({ kind: 'book_snapshot', ref: 'not-a-digest' }).ok).toBe(false);
  });

  it('fails the typed unknown_evidence_kind on a foreign kind', () => {
    const result = requireEvidenceRef({ kind: 'gut_feeling', ref: 'swo:abcd1234' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('unknown_evidence_kind');
  });
});

describe('the outcome record mint (the coherence laws)', () => {
  it('mints a content-addressed, deeply frozen, guard-valid record', () => {
    const { record } = logWithOneOutcome();
    expect(record.outcomeId).toMatch(/^out:[0-9a-f]{8}$/);
    expect(isDeeplyFrozen(record)).toBe(true);
    expect(record.outcomeClass).toBe('adverse_gap');
    expect(record.lineage.shadow.tenant).toBe(TENANT);
  });

  it('fails the typed tenant_mismatch when the record scope disagrees with the shadow lineage (L12)', () => {
    const input = fixtureOutcomeInput(1, '00000000');
    input.tenant = 'tenant-foreign';
    const result = mintOutcomeRecord(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('tenant_mismatch');
  });

  it('fails the typed l4_boundary_violation when the learning instant precedes the shadow evidence', () => {
    const input = fixtureOutcomeInput(1, '00000000');
    input.asOf = asTimestampMs(T0 + 25_000 - 1);
    const result = mintOutcomeRecord(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('l4_boundary_violation');
  });

  it('fails invalid_state when the stored class disagrees with the derivation over the record own numbers', () => {
    const input = fixtureOutcomeInput(1, '00000000');
    input.outcomeClass = 'as_expected'; // the numbers say adverse_gap (gap -7 vs tolerance 1)
    const result = mintOutcomeRecord(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid_state');
  });

  it('fails the typed decimal_imprecision when a money field carries a JS number', () => {
    const input = fixtureOutcomeInput(1, '00000000');
    const smuggled = { ...input, realization: { ...input.realization, realizedOutcome: -1.75 } } as unknown as ReturnType<typeof fixtureOutcomeInput>;
    const result = mintOutcomeRecord(smuggled);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('decimal_imprecision');
  });

  it('fails the typed lineage_gap when the lineage block is incomplete', () => {
    const input = fixtureOutcomeInput(1, '00000000');
    (input.lineage as { shadow?: unknown }).shadow = { sessionId: 'shs:x' }; // a gutted lineage
    const result = mintOutcomeRecord(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('lineage_gap');
  });

  it('is byte-deterministic: identical inputs mint identical ids and bytes (twice)', () => {
    const first = mintOutcomeRecord(fixtureOutcomeInput(1, '00000000'));
    const second = mintOutcomeRecord(fixtureOutcomeInput(1, '00000000'));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.outcomeId).toBe(second.value.outcomeId);
      expect(canonicalJson(first.value)).toBe(canonicalJson(second.value));
    }
  });
});

describe('the evaluation hook (T035 surface — informs, never decides)', () => {
  it('compiles the deterministic focus per outcome class and dominant attribution', () => {
    const { log, record } = logWithOneOutcome();
    void log;
    const hook = compileOutcomeLearningHook(record, null);
    expect(hook.ok).toBe(true);
    if (hook.ok) {
      expect(hook.value.hookId).toMatch(/^olh:[0-9a-f]{8}$/);
      expect(hook.value.outcomeClass).toBe('adverse_gap');
      expect(hook.value.dominantAttribution).toBeNull();
      expect(hook.value.suggestedFocus).toBe('strategy_revision'); // adverse gap without attribution
      expect(hook.value.realizedGap).toBe('-7');
    }
  });

  it('carries NO acceptance verdict and NO body-version proposal (R27/L7 boundary)', () => {
    const { record } = logWithOneOutcome();
    const hook = compileOutcomeLearningHook(record, null);
    expect(hook.ok).toBe(true);
    if (hook.ok) {
      const serialized = canonicalJson(hook.value);
      for (const forbidden of ['verdict', 'accept', 'approve', 'bodyVersion', 'body_version', 'create']) {
        expect(serialized.includes(`"${forbidden}"`)).toBe(false);
      }
    }
  });

  it('fails the typed lineage_gap when the post-mortem subjects another outcome', () => {
    const { record } = logWithOneOutcome();
    const foreign = { ...record, postMortemId: 'pmr:00000000', subject: { ...record.decision, outcomeRecordRef: 'out:ffffffff', outcomeClass: record.outcomeClass }, hypotheses: [], asOf: record.asOf } as never;
    const hook = compileOutcomeLearningHook(record, foreign);
    expect(hook.ok).toBe(false);
    if (!hook.ok) expect(hook.errors[0].code).toBe('lineage_gap');
  });
});

describe('append-only outcome log (one decision, one learned outcome)', () => {
  it('appends in ordinal order and threads the chain head', () => {
    let log = startOutcomeLearningLog();
    const first = appendFixtureOutcome(log, 1);
    log = first.log;
    const second = appendFixtureOutcome(log, 2, (input) => {
      input.decision = { decisionRef: 'xd:fixture-decision-2', intentRef: 'si:fixture-intent-2', disposition: 'filled' };
      input.lineage = { ...input.lineage, shadowOutcomeRef: 'swo:aaaaaaaa', shadowOutcomeOrdinal: 2 };
      input.evidence = [{ kind: 'shadow_outcome', ref: 'swo:aaaaaaaa' }];
    });
    expect(second.log.records.length).toBe(2);
    expect(second.log.head).not.toBe(first.log.head);
  });

  it('fails the typed outcome_log_rewrite on re-deciding the same decision', () => {
    const { log } = logWithOneOutcome();
    const minted = mintOutcomeRecord({ ...fixtureOutcomeInput(2, log.head), decision: { decisionRef: 'xd:fixture-decision-1', intentRef: 'si:other', disposition: 'filled' } });
    if (!minted.ok) throw new Error(minted.errors.map((error) => error.message).join('; '));
    const reDecide = appendOutcomeRecord(log, minted.value);
    expect(reDecide.ok).toBe(false);
    if (!reDecide.ok) expect(reDecide.errors[0].code).toBe('outcome_log_rewrite');
  });
});
