// @tradrl/body-fundamental-researcher — the FundamentalAssessment tests.
//
// Behavioral: the golden assessments validate under every law; the
// derived ids are deterministic; the declared stance decision function
// derives directions from scores; creation deep-freezes and refuses bad
// drafts. Negative paths: evidence-less, future-citation, undeclared
// method, stale version, wrong-kind confidence, assessment-kind
// mismatch, stance inconsistent with its own method, tenant-less,
// duplicate evidence, tampered ids.

import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_LEVELS,
  STANCE_DIRECTIONS,
  classifyStanceDirection,
  createFundamentalAssessment,
  deriveAssessmentId,
  isConfidenceLevel,
  isFundamentalAssessment,
  isStanceDirection,
  serializeFundamentalAssessment,
  validateFundamentalAssessment,
  validateFundamentalAssessmentRecord,
} from './assessment';
import {
  FIXTURE_HEALTH_ASSESSMENT,
  FIXTURE_MACRO_ASSESSMENT,
  FIXTURE_REGISTRY,
  FIXTURE_VALUATION_ASSESSMENT,
  duplicateEvidenceAssessmentDraft,
  evidenceLessAssessmentDraft,
  futureCitationAssessmentDraft,
  kindMismatchAssessmentDraft,
  stanceInconsistentAssessmentDraft,
  staleMethodVersionAssessmentDraft,
  tenantlessAssessmentDraft,
  undeclaredMethodAssessmentDraft,
  wrongKindMethodAssessmentDraft,
} from './fixtures';
import { FUNDAMENTAL_VALUATION_METHOD } from './methods';
import { isDeeplyFrozen } from './primitives';

const codesOf = (draft: unknown): readonly string[] =>
  validateFundamentalAssessment(draft, FIXTURE_REGISTRY).map((e) => e.code);

describe('the golden assessments', () => {
  it('validate cleanly under every law', () => {
    for (const assessment of [FIXTURE_VALUATION_ASSESSMENT, FIXTURE_MACRO_ASSESSMENT, FIXTURE_HEALTH_ASSESSMENT]) {
      expect(validateFundamentalAssessment(assessment, FIXTURE_REGISTRY)).toEqual([]);
      expect(isFundamentalAssessment(assessment)).toBe(true);
      expect(validateFundamentalAssessmentRecord(assessment, FIXTURE_REGISTRY).ok).toBe(true);
    }
  });

  it('are deeply frozen with derived fa- ids', () => {
    for (const assessment of [FIXTURE_VALUATION_ASSESSMENT, FIXTURE_MACRO_ASSESSMENT, FIXTURE_HEALTH_ASSESSMENT]) {
      expect(assessment.assessmentId.startsWith('fa-')).toBe(true);
      expect(isDeeplyFrozen(assessment)).toBe(true);
    }
  });

  it('carry the three assessment kinds of the closed taxonomy', () => {
    expect(FIXTURE_VALUATION_ASSESSMENT.assessmentKind).toBe('valuation-level');
    expect(FIXTURE_MACRO_ASSESSMENT.assessmentKind).toBe('macro-surprise');
    expect(FIXTURE_HEALTH_ASSESSMENT.assessmentKind).toBe('health-indicator');
  });

  it('serialize byte-deterministically (same input, same bytes, twice)', () => {
    for (let round = 0; round < 2; round += 1) {
      expect(serializeFundamentalAssessment(FIXTURE_VALUATION_ASSESSMENT)).toBe(
        serializeFundamentalAssessment(FIXTURE_VALUATION_ASSESSMENT),
      );
    }
  });
});

describe('the closed vocabularies + the declared decision function', () => {
  it('the stance directions and confidence levels are closed unions', () => {
    expect([...STANCE_DIRECTIONS]).toEqual(['positive', 'negative', 'neutral']);
    expect([...CONFIDENCE_LEVELS]).toEqual(['low', 'moderate', 'high']);
    expect(isStanceDirection('mixed')).toBe(false);
    expect(isConfidenceLevel('very-sure')).toBe(false);
  });

  it('classifyStanceDirection derives directions from the declared thresholds', () => {
    const thresholds = { positive: '0.02', negative: '-0.02' };
    expect(classifyStanceDirection('0.0242', thresholds)).toBe('positive');
    expect(classifyStanceDirection('0.02', thresholds)).toBe('positive');
    expect(classifyStanceDirection('-0.5', thresholds)).toBe('negative');
    expect(classifyStanceDirection('0.001', thresholds)).toBe('neutral');
    expect(classifyStanceDirection('0', thresholds)).toBe('neutral');
  });
});

describe('creation', () => {
  it('creates a validated, deeply-frozen record with a derived id', () => {
    const draft = { ...FIXTURE_VALUATION_ASSESSMENT };
    const { assessmentId: _ignored, ...material } = draft;
    void _ignored;
    const created = createFundamentalAssessment(material, FIXTURE_REGISTRY);
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.assessmentId).toBe(FIXTURE_VALUATION_ASSESSMENT.assessmentId);
      expect(isDeeplyFrozen(created.value)).toBe(true);
    }
  });

  it('refuses a bad draft with typed data (never throws)', () => {
    const refused = createFundamentalAssessment(evidenceLessAssessmentDraft(), FIXTURE_REGISTRY);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.errors[0]?.code).toBe('evidence_missing');
    }
  });
});

describe('THE NEGATIVE PATHS (every law, every typed error)', () => {
  it('an evidence-less assessment fails (evidence_missing)', () => {
    expect(codesOf(evidenceLessAssessmentDraft())).toContain('evidence_missing');
  });

  it('a future citation fails (future_evidence)', () => {
    expect(codesOf(futureCitationAssessmentDraft())).toContain('future_evidence');
  });

  it('an undeclared method fails (undeclared_method)', () => {
    expect(codesOf(undeclaredMethodAssessmentDraft())).toContain('undeclared_method');
  });

  it('a stale method version fails (method_version_mismatch)', () => {
    expect(codesOf(staleMethodVersionAssessmentDraft())).toContain('method_version_mismatch');
  });

  it('a wrong-kind confidence method fails (method_kind_mismatch)', () => {
    expect(codesOf(wrongKindMethodAssessmentDraft())).toContain('method_kind_mismatch');
  });

  it('an assessment kind that disagrees with the cited method fails (assessment_kind_mismatch)', () => {
    expect(codesOf(kindMismatchAssessmentDraft())).toContain('assessment_kind_mismatch');
  });

  it('a stance direction inconsistent with the declared decision function fails (stance_direction_mismatch)', () => {
    expect(codesOf(stanceInconsistentAssessmentDraft())).toContain('stance_direction_mismatch');
  });

  it('a stance citing the wrong method kind fails (method_kind_mismatch on the stance)', () => {
    const draft = {
      ...FIXTURE_VALUATION_ASSESSMENT,
      stance: {
        ...FIXTURE_VALUATION_ASSESSMENT.stance,
        methodId: FUNDAMENTAL_VALUATION_METHOD.kind === 'assessment' ? ('method/fundamental/confidence' as never) : ('x' as never),
        methodVersion: '1.0.0' as never,
      },
    };
    expect(codesOf(draft)).toContain('method_kind_mismatch');
  });

  it('missing tenant/project fails (tenant_missing, project_missing)', () => {
    const codes = codesOf(tenantlessAssessmentDraft());
    expect(codes).toContain('tenant_missing');
    expect(codes).toContain('project_missing');
  });

  it('duplicate citations fail (duplicate_observation_ref)', () => {
    expect(codesOf(duplicateEvidenceAssessmentDraft())).toContain('duplicate_observation_ref');
  });

  it('an unknown assessment kind fails (unknown_assessment_kind)', () => {
    expect(codesOf({ ...FIXTURE_VALUATION_ASSESSMENT, assessmentKind: 'vibes' })).toContain('unknown_assessment_kind');
  });

  it('a dispersion of fewer than two observations must be null, not a fabricated zero', () => {
    const draft = {
      ...FIXTURE_VALUATION_ASSESSMENT,
      confidence: { ...FIXTURE_VALUATION_ASSESSMENT.confidence, evidenceCount: 1, dispersion: '0.0000' },
    };
    const errors = validateFundamentalAssessment(draft, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('null, not a fabricated zero')]),
    );
  });

  it('a tampered id fails (digest_mismatch)', () => {
    const tampered = {
      ...FIXTURE_VALUATION_ASSESSMENT,
      assessmentId: `fa-${'0'.repeat(16)}` as never,
    };
    expect(codesOf(tampered)).toContain('digest_mismatch');
  });

  it('a tampered body (mutated after creation) fails re-validation', () => {
    // Deep-freeze prevents mutation in strict mode; emulate tampering via
    // a JSON clone with an edited score (id now stale).
    const cloned = JSON.parse(JSON.stringify(FIXTURE_VALUATION_ASSESSMENT)) as Record<string, unknown>;
    const stance = cloned.stance as Record<string, unknown>;
    stance.score = '0.5';
    expect(codesOf(cloned)).toContain('digest_mismatch');
  });

  it('the derived id is a pure function of the canonical content', () => {
    const { assessmentId: _ignored, ...material } = FIXTURE_MACRO_ASSESSMENT;
    void _ignored;
    expect(deriveAssessmentId(material)).toBe(FIXTURE_MACRO_ASSESSMENT.assessmentId);
  });
});
