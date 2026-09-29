/**
 * @tradrl/skills — SkillRecord tests.
 *
 * Behavioral, law-driven:
 * - THE EVIDENCE LAW: a skill claim with no evidence citation fails
 *   validation (`evidence_missing`) — skills are extracted FROM recorded
 *   experience, never invented.
 * - L16a: labels never establish suitability — a profession label as
 *   evidence field fails with `label_as_evidence`; an empty
 *   measured-evidence list is the label-shaped claim L16a forbids.
 * - L9/L12: missing lineage (`lineage_gap`), missing tenant
 *   (`tenant_missing`), missing seed (`unseeded_forge`).
 * - L3 discipline: records are deeply frozen; mutation throws.
 * - Byte-determinism of serialization (same record, same bytes).
 */

import { describe, expect, it } from 'vitest';

import {
  type SkillRecord,
  createSkillRecord,
  isSkillRecord,
  serializeSkillRecord,
  validateSkillRecord,
} from './record';
import { isDeeplyFrozen } from './primitives';
import type { SkillError } from './errors';

/** A minimal VALID skill record draft (evidence-backed, full lineage). */
function validDraft(): Record<string, unknown> {
  return {
    skillId: 'skill-0123456a',
    artifactRef: 'skill-artifact:0123456a',
    descriptor: {
      capabilityKey: 'regime-detection',
      summary: 'Detects market regime shifts from recorded replay evidence.',
      measuredEvidence: [
        { kind: 'result-ref', resultRef: 'trajectory:traj-1' },
        { kind: 'benchmark', benchmarkId: 'bench/regime-v2', resultRef: 'bench-result/regime-v2/run-9' },
      ],
      capabilityRecordRefs: ['caprec-77'],
    },
    provenance: {
      trajectoryRefs: ['traj-1'],
      experimentRefs: ['exp-9'],
      trialRefs: ['trial-9'],
      attainmentEvidenceRefs: ['verdict:v-1'],
      origin: 'recorded-experience',
    },
    applicability: {
      environmentProfileRefs: ['env/replay-regime'],
      instrumentClassRefs: ['equities/liquid-us'],
    },
    version: 1,
    lineage: {
      parentSkillRef: null,
      evidenceRefs: ['capsule-gap-1'],
      gapRefs: ['gap-1'],
      extractionVersion: 'reference-extraction/1',
      seed: 'seed-1',
      tenantId: 'tenant-a',
      projectId: 'project-b',
      extractedAt: 1_700_000_000_000,
    },
  };
}

function expectCode(errors: readonly SkillError[], code: string): SkillError | undefined {
  return errors.find((e) => e.code === code);
}

describe('the evidence-backed skill record (happy path)', () => {
  it('creates a deeply frozen, guard-passing record', () => {
    const record = createSkillRecord(validDraft());
    expect(isSkillRecord(record)).toBe(true);
    expect(isDeeplyFrozen(record)).toBe(true);
    expect(record.skillId).toBe('skill-0123456a');
    expect(record.descriptor.capabilityKey).toBe('regime-detection');
    expect(record.provenance.origin).toBe('recorded-experience');
  });

  it('validateSkillRecord returns the narrowed value on success', () => {
    const result = validateSkillRecord(validDraft());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isDeeplyFrozen(result.value)).toBe(true);
      expect(result.value.lineage.tenantId).toBe('tenant-a');
    }
  });

  it('serialization is byte-stable (same record, same bytes)', () => {
    const record = createSkillRecord(validDraft());
    const again = createSkillRecord(validDraft());
    expect(serializeSkillRecord(record)).toBe(serializeSkillRecord(again));
    expect(serializeSkillRecord(record)).toBe(serializeSkillRecord(record));
  });

  it('the factory accepts imported expertise as ordinary validated records (L18)', () => {
    const draft = validDraft();
    (draft.provenance as Record<string, unknown>).origin = 'imported-artifact';
    const record = createSkillRecord(draft);
    expect(record.provenance.origin).toBe('imported-artifact');
  });
});

describe('THE EVIDENCE LAW (negative paths)', () => {
  it('a skill claim with NO evidence citation fails with evidence_missing', () => {
    const draft = validDraft();
    (draft.provenance as Record<string, unknown>).trajectoryRefs = [];
    (draft.provenance as Record<string, unknown>).experimentRefs = [];
    (draft.provenance as Record<string, unknown>).trialRefs = [];
    (draft.provenance as Record<string, unknown>).attainmentEvidenceRefs = [];
    const result = validateSkillRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'evidence_missing')).toBeDefined();
    }
    expect(() => createSkillRecord(draft)).toThrow(/evidence_missing/);
  });

  it('the guard rejects an evidence-less record outright', () => {
    const draft = validDraft();
    (draft.provenance as Record<string, unknown>).trajectoryRefs = [];
    (draft.provenance as Record<string, unknown>).experimentRefs = [];
    (draft.provenance as Record<string, unknown>).trialRefs = [];
    (draft.provenance as Record<string, unknown>).attainmentEvidenceRefs = [];
    expect(isSkillRecord(draft)).toBe(false);
  });
});

describe('L16a: labels never establish suitability (negative paths)', () => {
  it('a profession label as evidence field fails with label_as_evidence', () => {
    const draft = validDraft();
    (draft.descriptor as Record<string, unknown>).profession = 'mathematician';
    const result = validateSkillRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const violation = expectCode(result.errors, 'label_as_evidence');
      expect(violation).toBeDefined();
      expect(violation?.path).toContain('profession');
    }
    expect(isSkillRecord(draft)).toBe(false);
    expect(() => createSkillRecord(draft)).toThrow(/label_as_evidence/);
  });

  it('a NESTED label key is detected anywhere in the record tree', () => {
    const draft = validDraft();
    const measured = (
      (draft.descriptor as Record<string, unknown>).measuredEvidence as Record<string, unknown>[]
    )[1] as Record<string, unknown>;
    measured.jobTitle = 'risk analyst';
    const result = validateSkillRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'label_as_evidence')).toBeDefined();
    }
  });

  it('an empty measured-evidence list is the label-shaped claim L16a forbids', () => {
    const draft = validDraft();
    (draft.descriptor as Record<string, unknown>).measuredEvidence = [];
    const result = validateSkillRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'label_as_evidence')).toBeDefined();
    }
  });

  it('a `kind: "label"` evidence entry is named precisely (label_as_evidence)', () => {
    const draft = validDraft();
    (draft.descriptor as Record<string, unknown>).measuredEvidence = [{ kind: 'label', label: 'regime expert' }];
    const result = validateSkillRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const violation = expectCode(result.errors, 'label_as_evidence');
      expect(violation).toBeDefined();
      expect(violation?.path).toContain('measuredEvidence');
    }
  });
});

describe('L9 lineage / L12 scope (negative paths)', () => {
  it('a missing lineage block fails with lineage_gap', () => {
    const draft = validDraft();
    delete (draft as Record<string, unknown>).lineage;
    const result = validateSkillRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'lineage_gap')).toBeDefined();
    }
  });

  it('a missing tenant fails with tenant_missing', () => {
    const draft = validDraft();
    const lineage = draft.lineage as Record<string, unknown>;
    delete lineage.tenantId;
    const result = validateSkillRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const violation = expectCode(result.errors, 'tenant_missing');
      expect(violation).toBeDefined();
      expect(violation?.path).toContain('tenantId');
    }
  });

  it('a missing project fails with tenant_missing', () => {
    const draft = validDraft();
    const lineage = draft.lineage as Record<string, unknown>;
    delete lineage.projectId;
    const result = validateSkillRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'tenant_missing')).toBeDefined();
    }
  });

  it('a missing seed fails with unseeded_forge (no ambient randomness)', () => {
    const draft = validDraft();
    const lineage = draft.lineage as Record<string, unknown>;
    lineage.seed = '';
    const result = validateSkillRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(expectCode(result.errors, 'unseeded_forge')).toBeDefined();
    }
  });

  it('an invalid extraction version fails the lineage guard', () => {
    const draft = validDraft();
    (draft.lineage as Record<string, unknown>).extractionVersion = '';
    const result = validateSkillRecord(draft);
    expect(result.ok).toBe(false);
  });

  it('a non-integer or non-positive version is rejected', () => {
    const draft = validDraft();
    (draft as Record<string, unknown>).version = 0;
    expect(validateSkillRecord(draft).ok).toBe(false);
    (draft as Record<string, unknown>).version = 1.5;
    expect(validateSkillRecord(draft).ok).toBe(false);
  });
});

describe('immutability (L3 runtime half)', () => {
  it('a created record cannot be mutated (deeply frozen)', () => {
    const record: SkillRecord = createSkillRecord(validDraft());
    expect(() => {
      (record.descriptor as { capabilityKey: string }).capabilityKey = 'tampered';
    }).toThrow();
    expect(record.descriptor.capabilityKey).toBe('regime-detection');
  });
});

describe('structural totality (negative paths)', () => {
  it('non-object roots fail with invalid_type', () => {
    const result = validateSkillRecord(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('invalid_type');
    }
  });

  it('invalid ids, artifact refs and descriptor shapes are collected', () => {
    const draft = validDraft();
    (draft as Record<string, unknown>).skillId = '!!!';
    (draft as Record<string, unknown>).artifactRef = '';
    (draft as Record<string, unknown>).descriptor = 'not-an-object';
    const result = validateSkillRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('labelKeyPaths walks arrays with indexed paths', () => {
    const draft = validDraft();
    (draft.applicability as Record<string, unknown>).instrumentClassRefs = [
      { nested: { title: 'x' } },
    ];
    const result = validateSkillRecord(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const violation = expectCode(result.errors, 'label_as_evidence');
      expect(violation?.path).toContain('instrumentClassRefs[0].nested.title');
    }
  });
});
