/**
 * Behavioral tests for @tradrl/verification's release gate: the L10 typed
 * REFUSAL (no adversarial suite member -> no gate), lineage agreement
 * (suite_mismatch), the id-referenced no-free-text record shape, hold
 * reasons, determinism and deep-freeze discipline.
 */

import { describe, expect, it } from 'vitest';

import {
  composeReleaseGate,
  isEvaluationSuiteMirror,
  isReleaseGateRecord,
  isReleaseReasonCode,
  type AttainmentVerdictMirror,
  type EvaluationSuiteMirror,
  type ReleaseGateInput,
  type ReleaseGateRecord,
  type VerificationReportMirror,
} from './index';
import type { SuiteId, VerdictId, VerificationReportId, AdversarialSuiteRef, EvaluatorVersionRef } from './ids';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const suiteId = (id: string): SuiteId => id as SuiteId;
const adversarialRef = (id: string): AdversarialSuiteRef => id as AdversarialSuiteRef;
const evaluatorRef = (id: string): EvaluatorVersionRef => id as EvaluatorVersionRef;
const verdictId = (id: string): VerdictId => id as VerdictId;
const reportId = (id: string): VerificationReportId => id as VerificationReportId;

function suiteResult(overrides: Partial<EvaluationSuiteMirror> = {}): EvaluationSuiteMirror {
  return {
    suiteId: suiteId('suite.friction-2024q4'),
    grade: 'release',
    evaluatorVersion: evaluatorRef('evaluator.friction-suite@3'),
    adversarialSuiteRefs: [adversarialRef('suite.adversarial-pop-1')],
    ...overrides,
  };
}

function verdictResult(overrides: Partial<AttainmentVerdictMirror> = {}): AttainmentVerdictMirror {
  return {
    verdictId: verdictId('vd:0011223344556677'),
    attained: true,
    suite: suiteId('suite.friction-2024q4'),
    evaluatorVersion: evaluatorRef('evaluator.friction-suite@3'),
    limitations: [],
    ...overrides,
  };
}

function verificationResult(overrides: Partial<VerificationReportMirror> = {}): VerificationReportMirror {
  return {
    reportId: reportId('vr:0011223344556677'),
    passed: true,
    ...overrides,
  };
}

function gateInput(overrides: Partial<ReleaseGateInput> = {}): ReleaseGateInput {
  return {
    suite: suiteResult(),
    verdict: verdictResult(),
    verification: verificationResult(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mirror guards
// ---------------------------------------------------------------------------

describe('gate input mirror guards', () => {
  it('EvaluationSuiteMirror enforces the L10-shaped adversarial list', () => {
    expect(isEvaluationSuiteMirror(suiteResult())).toBe(true);
    expect(isEvaluationSuiteMirror(suiteResult({ grade: 'ship' as never }))).toBe(false);
    expect(isEvaluationSuiteMirror(suiteResult({ adversarialSuiteRefs: [] }))).toBe(true); // structurally valid; the GATE refuses it
    expect(isEvaluationSuiteMirror(suiteResult({ adversarialSuiteRefs: ['a', 'a'] as never }))).toBe(false);
    expect(isEvaluationSuiteMirror(null)).toBe(false);
  });

  it('isReleaseReasonCode is closed over the gate vocabulary', () => {
    for (const code of ['attainment-met', 'verification-passed', 'adversarial-coverage-present', 'suite-grade-release', 'attainment-not-met', 'verification-failed', 'suite-grade-screening', 'verdict-limitations-present']) {
      expect(isReleaseReasonCode(code)).toBe(true);
    }
    expect(isReleaseReasonCode('good-vibes')).toBe(false);
    expect(isReleaseReasonCode(7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe('composeReleaseGate', () => {
  it('composes a RELEASE record when every positive fact holds', () => {
    const result = composeReleaseGate(gateInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    const gate = result.value;
    expect(gate.recommendation).toBe('release');
    expect(gate.reasons).toEqual(['attainment-met', 'verification-passed', 'adversarial-coverage-present', 'suite-grade-release']);
    expect(gate.suite).toBe('suite.friction-2024q4');
    expect(gate.verdict).toBe('vd:0011223344556677');
    expect(gate.verificationReport).toBe('vr:0011223344556677');
    expect(isReleaseGateRecord(gate)).toBe(true);
    expect(Object.isFrozen(gate)).toBe(true);
    expect(gate.gateId.startsWith('rg:')).toBe(true);
  });

  it('L10 TYPED REFUSAL: no adversarial suite member -> the gate REFUSES to compose (acceptance #8)', () => {
    const result = composeReleaseGate(gateInput({ suite: suiteResult({ adversarialSuiteRefs: [] }) }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('missing_adversarial_member');
    expect(result.errors[0]?.message).toContain('L10');
    // The refusal happens even when everything else is perfect.
    expect(result.errors).toHaveLength(1);
  });

  it('suite_mismatch: a verdict from another suite (or evaluator) cannot be gated', () => {
    const wrongSuite = composeReleaseGate(gateInput({ verdict: verdictResult({ suite: suiteId('suite.other') }) }));
    expect(wrongSuite.ok).toBe(false);
    if (wrongSuite.ok) throw new Error('must fail');
    expect(wrongSuite.errors[0]?.code).toBe('suite_mismatch');

    const wrongEvaluator = composeReleaseGate(gateInput({ verdict: verdictResult({ evaluatorVersion: evaluatorRef('evaluator.other@1') }) }));
    expect(wrongEvaluator.ok).toBe(false);
    if (wrongEvaluator.ok) throw new Error('must fail');
    expect(wrongEvaluator.errors[0]?.code).toBe('suite_mismatch');
  });

  it('structurally invalid inputs are collected typed errors', () => {
    const result = composeReleaseGate({ suite: null, verdict: null, verification: null } as unknown as ReleaseGateInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    const paths = result.errors.map((e) => e.path);
    expect(paths).toContain('suite');
    expect(paths).toContain('verdict');
    expect(paths).toContain('verification');
    expect(composeReleaseGate(null as unknown as ReleaseGateInput).ok).toBe(false);
  });

  it('HOLD: attainment failure carries attainment-not-met, never a release', () => {
    const result = composeReleaseGate(gateInput({ verdict: verdictResult({ attained: false }) }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.recommendation).toBe('hold');
    expect(result.value.reasons).toContain('attainment-not-met');
    expect(result.value.reasons).not.toContain('attainment-met');
    expect(isReleaseGateRecord(result.value)).toBe(true);
  });

  it('HOLD: verification failure carries verification-failed (acceptance #7 consumer)', () => {
    const result = composeReleaseGate(gateInput({ verification: verificationResult({ passed: false }) }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.recommendation).toBe('hold');
    expect(result.value.reasons).toContain('verification-failed');
  });

  it('HOLD: verdict limitations carry verdict-limitations-present (holes are holes)', () => {
    const result = composeReleaseGate(gateInput({ verdict: verdictResult({ limitations: ['vacuous-split'] }) }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.recommendation).toBe('hold');
    expect(result.value.reasons).toContain('verdict-limitations-present');
  });

  it('HOLD: a screening-grade suite never releases (screening is the cheap in-search gate)', () => {
    const result = composeReleaseGate(gateInput({ suite: suiteResult({ grade: 'screening' }) }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.recommendation).toBe('hold');
    expect(result.value.reasons).toContain('suite-grade-screening');
    expect(result.value.reasons).not.toContain('suite-grade-release');
  });

  it('the record is id-referenced with NO free text: keys are ids, codes and the recommendation only', () => {
    const result = composeReleaseGate(gateInput());
    if (!result.ok) throw new Error('must succeed');
    const gate: ReleaseGateRecord = result.value;
    expect(Object.keys(gate).sort()).toEqual(['gateId', 'reasons', 'recommendation', 'suite', 'verdict', 'verificationReport']);
    for (const code of gate.reasons) expect(typeof code).toBe('string'); // codes from the closed vocabulary
    expect(gate.reasons.every((code) => isReleaseReasonCode(code))).toBe(true);
  });

  it('deterministic: same inputs -> byte-identical gate; mutation changes the id', () => {
    const a = composeReleaseGate(gateInput());
    const b = composeReleaseGate(gateInput());
    expect(a).toEqual(b);
    if (a.ok && b.ok) expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));

    const mutated = composeReleaseGate(gateInput({ verification: verificationResult({ reportId: reportId('vr:FFEEDDCCBBAA9988') }) }));
    if (a.ok && mutated.ok) expect(mutated.value.gateId).not.toBe(a.value.gateId);
  });

  it('isReleaseGateRecord enforces the recommendation/reasons consistency law', () => {
    const result = composeReleaseGate(gateInput());
    if (!result.ok) throw new Error('must succeed');
    const gate = result.value;
    // Forged records fail: release with a negative reason, hold with all positives.
    expect(isReleaseGateRecord({ ...gate, recommendation: 'hold' })).toBe(false);
    expect(isReleaseGateRecord({ ...gate, reasons: [...gate.reasons, 'verification-failed'] })).toBe(false);
    expect(isReleaseGateRecord({ ...gate, recommendation: 'ship' })).toBe(false);
    expect(isReleaseGateRecord(null)).toBe(false);
  });
});
