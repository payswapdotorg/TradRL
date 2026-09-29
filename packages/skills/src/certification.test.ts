/**
 * @tradrl/skills — CertificationRecord tests.
 *
 * Behavioral, law-driven:
 * - The decision compilation is PURE and FAIL-CLOSED: certified only when
 *   evaluation attained AND compatibility satisfied AND a passing
 *   substitution test is recorded; every refusal carries structured
 *   reasons.
 * - L3 (the existential law): certification is append-only and TERMINAL —
 *   re-certifying an already-certified candidate is the typed error
 *   `certified_version_mutation`; re-deciding a rejected candidate is
 *   `certification_conflict`.
 * - L9/L12 lineage and scope on every record; unexplained decisions fail
 *   (`evidence_missing`); appendCertificationRecord returns a NEW log.
 */

import { describe, expect, it } from 'vitest';

import {
  type CertificationDecisionInput,
  type CertificationRecord,
  appendCertificationRecord,
  createCertificationRecord,
  decideCertification,
  isCertificationRecord,
  validateCertificationLog,
  validateCertificationRecord,
} from './certification';
import type { SkillError } from './errors';

function decisionInput(partial: Record<string, unknown>): CertificationDecisionInput {
  return {
    candidateRef: 'regime-researcher@1.1.0',
    evaluationVerdictRef: 'v-1',
    evaluationAttained: true,
    compatibilityVerdictRef: 'compat-1',
    compatibilitySatisfied: true,
    hasPassingSubstitutionTest: true,
    ...partial,
  } as unknown as CertificationDecisionInput;
}

/** A minimal VALID certification record draft (everything but the computed decision/reasons). */
function recordDraft(): Record<string, unknown> {
  return {
    certificationId: 'cert-1',
    candidateRef: 'regime-researcher@1.1.0',
    evaluationVerdictRef: 'v-1',
    compatibilityVerdictRef: 'compat-1',
    certifiedBy: 'verification-pipeline/1',
    certifiedAt: 1_700_000_200_000,
    lineage: {
      parentVersionRef: 'regime-researcher@1.0.0',
      evidenceRefs: ['capsule-1'],
      gapRefs: ['gap-1'],
      forgeVersion: 'reference-forge/1',
      seed: 'seed-1',
      tenantId: 'tenant-a',
      projectId: 'project-b',
    },
  };
}

function expectCode(errors: readonly SkillError[], code: string): SkillError | undefined {
  return errors.find((e) => e.code === code);
}

describe('the decision compilation (pure, fail-closed)', () => {
  it('certifies when evaluation attained, compatibility satisfied and a substitution test passes', () => {
    const { decision, reasons } = decideCertification(decisionInput({}));
    expect(decision).toBe('certified');
    expect(reasons.map((r) => r.code)).toContain('evaluation_attained');
    expect(reasons.map((r) => r.code)).toContain('compatibility_satisfied');
  });

  it('rejects with evaluation_not_attained when the verdict is not attained', () => {
    const { decision, reasons } = decideCertification(decisionInput({ evaluationAttained: false }));
    expect(decision).toBe('rejected');
    expect(reasons.map((r) => r.code)).toContain('evaluation_not_attained');
  });

  it('rejects with compatibility_fail when compatibility is not satisfied', () => {
    const { decision, reasons } = decideCertification(decisionInput({ compatibilitySatisfied: false }));
    expect(decision).toBe('rejected');
    expect(reasons.map((r) => r.code)).toContain('compatibility_fail');
  });

  it('rejects with no_passing_substitution_test when none is recorded', () => {
    const { decision, reasons } = decideCertification(decisionInput({ hasPassingSubstitutionTest: false }));
    expect(decision).toBe('rejected');
    expect(reasons.map((r) => r.code)).toContain('no_passing_substitution_test');
  });

  it('collects EVERY refusal reason, never just the first', () => {
    const { decision, reasons } = decideCertification(
      decisionInput({ evaluationAttained: false, compatibilitySatisfied: false, hasPassingSubstitutionTest: false }),
    );
    expect(decision).toBe('rejected');
    expect(reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(['evaluation_not_attained', 'compatibility_fail', 'no_passing_substitution_test']),
    );
  });
});

describe('CertificationRecord construction', () => {
  it('creates a deeply frozen record from the decision inputs', () => {
    const record = createCertificationRecord(recordDraft(), decisionInput({}));
    expect(isCertificationRecord(record)).toBe(true);
    expect(record.decision).toBe('certified');
    expect(Object.isFrozen(record)).toBe(true);
    expect(() => {
      (record as { decision: string }).decision = 'rejected';
    }).toThrow();
  });

  it('a rejection record carries the structured refusal reasons', () => {
    const record = createCertificationRecord(
      recordDraft(),
      decisionInput({ evaluationAttained: false }),
    );
    expect(record.decision).toBe('rejected');
    expect(record.reasons.length).toBeGreaterThan(0);
    expect(record.reasons[0]?.code).toBe('evaluation_not_attained');
  });
  it('validation collects violations with typed codes', () => {
    const draft = recordDraft() as unknown as Record<string, unknown>;
    delete draft.lineage;
    const result = validateCertificationRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'lineage_gap')).toBeDefined();
    }
  });

  it('an unexplained decision is not an auditable record (evidence_missing)', () => {
    const draft = recordDraft() as unknown as Record<string, unknown>;
    draft.reasons = [];
    const result = validateCertificationRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'evidence_missing')).toBeDefined();
    }
  });

  it('missing tenant/project fails with tenant_missing (L12)', () => {
    const draft = recordDraft();
    (draft.lineage as Record<string, unknown>).tenantId = '';
    const result = validateCertificationRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'tenant_missing')).toBeDefined();
    }
  });

  it('a missing seed in the lineage fails with unseeded_forge', () => {
    const draft = recordDraft();
    (draft.lineage as Record<string, unknown>).seed = '';
    const result = validateCertificationRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'unseeded_forge')).toBeDefined();
    }
  });
});

describe('the append-only log (L3 + L11)', () => {
  it('L3: re-certifying an already-certified candidate is the typed error certified_version_mutation', () => {
    const certified = createCertificationRecord(recordDraft(), decisionInput({}));
    const reDecision = createCertificationRecord(
      { ...recordDraft(), certificationId: 'cert-2' },
      decisionInput({ evaluationVerdictRef: 'v-2' }),
    );
    const log = [certified];
    const result = appendCertificationRecord(log, reDecision);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('certified_version_mutation');
      expect(result.errors[0]?.message).toContain('L3');
    }
  });

  it('the log validator flags the L3 mutation attempt too', () => {
    const certified = createCertificationRecord(recordDraft(), decisionInput({}));
    const reDecision = createCertificationRecord(
      { ...recordDraft(), certificationId: 'cert-2' },
      decisionInput({ evaluationVerdictRef: 'v-2' }),
    );
    const result = validateCertificationLog([certified, reDecision]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'certified_version_mutation')).toBeDefined();
    }
  });

  it('re-deciding a REJECTED candidate is certification_conflict (append-only)', () => {
    const rejected = createCertificationRecord(recordDraft(), decisionInput({ evaluationAttained: false }));
    const reDecision = createCertificationRecord(
      { ...recordDraft(), certificationId: 'cert-2' },
      decisionInput({ evaluationVerdictRef: 'v-2' }),
    );
    const result = appendCertificationRecord([rejected], reDecision);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('certification_conflict');
    }
  });

  it('appendCertificationRecord returns a NEW log and never mutates the input', () => {
    const first = createCertificationRecord(recordDraft(), decisionInput({}));
    const second = createCertificationRecord(
      {
        ...recordDraft(),
        certificationId: 'cert-2',
        candidateRef: 'regime-researcher@1.2.0',
        lineage: { ...(recordDraft().lineage as Record<string, unknown>), parentVersionRef: 'regime-researcher@1.1.0' },
      },
      decisionInput({ candidateRef: 'regime-researcher@1.2.0', evaluationVerdictRef: 'v-3' }),
    );
    const original: readonly CertificationRecord[] = [first];
    const result = appendCertificationRecord(original, second);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(2);
      expect(result.value).not.toBe(original);
    }
    expect(original.length).toBe(1);
  });

  it('duplicate certification ids are duplicate_record errors', () => {
    const first = createCertificationRecord(recordDraft(), decisionInput({}));
    const second = createCertificationRecord(
      { ...recordDraft(), candidateRef: 'regime-researcher@1.2.0' },
      decisionInput({ candidateRef: 'regime-researcher@1.2.0', evaluationVerdictRef: 'v-2' }),
    );
    const result = appendCertificationRecord([first], second);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('duplicate_record');
    }
  });

  it('a tenant-scope disagreement across the log is tenant_mismatch (L12)', () => {
    const first = createCertificationRecord(recordDraft(), decisionInput({}));
    const second = createCertificationRecord(
      {
        ...recordDraft(),
        certificationId: 'cert-2',
        candidateRef: 'regime-researcher@1.2.0',
        lineage: { ...(recordDraft().lineage as Record<string, unknown>), tenantId: 'tenant-OTHER', parentVersionRef: 'regime-researcher@1.1.0' },
      },
      decisionInput({ candidateRef: 'regime-researcher@1.2.0', evaluationVerdictRef: 'v-2' }),
    );
    const result = validateCertificationLog([first, second]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'tenant_mismatch')).toBeDefined();
    }
  });

  it('a valid multi-record log validates (rejections retained, not hidden)', () => {
    const certified = createCertificationRecord(recordDraft(), decisionInput({}));
    const rejected = createCertificationRecord(
      {
        ...recordDraft(),
        certificationId: 'cert-2',
        candidateRef: 'regime-researcher@1.2.0',
        lineage: { ...(recordDraft().lineage as Record<string, unknown>), parentVersionRef: 'regime-researcher@1.1.0' },
      },
      decisionInput({ candidateRef: 'regime-researcher@1.2.0', evaluationAttained: false, evaluationVerdictRef: 'v-4' }),
    );
    const result = validateCertificationLog([certified, rejected]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(2);
      expect(result.value[1]?.decision).toBe('rejected'); // retained, structured
    }
  });
});
