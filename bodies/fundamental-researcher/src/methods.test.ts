// @tradrl/body-fundamental-researcher — the DECLARED-METHOD tests.
//
// Behavioral: the closed taxonomies (assessment kinds, corporate-action
// kinds, implication stances), the canonical registry's structure and
// digest, method-record construction and validation, citation resolution
// (undeclared ids, stale versions, wrong kinds, assessment-kind drift).
// Negative paths: empty registries, duplicate methods, malformed
// parameters (bad thresholds, non-decimal bands, unknown action kinds,
// duplicate keywords in the implication table).

import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_KINDS,
  CORPORATE_ACTION_KINDS,
  FUNDAMENTAL_METHOD_REGISTRY,
  FUNDAMENTAL_VALUATION_METHOD,
  FUNDAMENTAL_MACRO_SURPRISE_METHOD,
  FUNDAMENTAL_HEALTH_METHOD,
  FUNDAMENTAL_CORPORATE_ACTION_METHOD,
  FUNDAMENTAL_CONFIDENCE_METHOD,
  FUNDAMENTAL_REPORT_COMPOSITION_METHOD,
  IMPLICATION_STANCES,
  METHOD_KINDS,
  createFundamentalMethodRecord,
  createFundamentalMethodRegistry,
  findFundamentalMethod,
  isAssessmentKind,
  isCorporateActionKind,
  isFundamentalMethodRegistry,
  isFundamentalMethodRecord,
  isImplicationStance,
  resolveAssessmentCitation,
  resolveFundamentalMethodCitation,
  validateFundamentalMethodRecord,
  validateFundamentalMethodRegistry,
} from './methods';
import { isDeeplyFrozen } from './primitives';

describe('the closed taxonomies', () => {
  it('declares the assessment trichotomy (valuation, macro, health)', () => {
    expect([...ASSESSMENT_KINDS]).toEqual(['valuation-level', 'macro-surprise', 'health-indicator']);
    expect(isAssessmentKind('valuation-level')).toBe(true);
    expect(isAssessmentKind('sentiment')).toBe(false);
    expect(isAssessmentKind(42)).toBe(false);
  });

  it('declares the corporate-action trichotomy (the neutral translations)', () => {
    expect([...CORPORATE_ACTION_KINDS]).toEqual(['split', 'cash_dividend', 'merger']);
    expect(isCorporateActionKind('SPLIT')).toBe(false);
    expect(isImplicationStance('mixed')).toBe(true);
    expect(isImplicationStance('bullish')).toBe(false);
  });
});

describe('the canonical registry', () => {
  it('ships six methods — three assessments, one digestion, confidence, composition', () => {
    expect(FUNDAMENTAL_METHOD_REGISTRY.methods.length).toBe(6);
    const kinds = FUNDAMENTAL_METHOD_REGISTRY.methods.map((m) => m.kind).sort();
    expect(kinds).toEqual(['assessment', 'assessment', 'assessment', 'confidence-estimation', 'corporate-action-digestion', 'report-composition']);
    for (const method of FUNDAMENTAL_METHOD_REGISTRY.methods) {
      expect(method.version).toBe('1.0.0');
      expect(method.declaredBy).toBe('tradrl-research-declaration/1');
    }
  });

  it('is a valid, deeply-frozen registry whose digest binds its canonical form', () => {
    expect(isFundamentalMethodRegistry(FUNDAMENTAL_METHOD_REGISTRY)).toBe(true);
    expect(isDeeplyFrozen(FUNDAMENTAL_METHOD_REGISTRY)).toBe(true);
    expect(FUNDAMENTAL_METHOD_REGISTRY.digest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('declares every parameter knob (no implicit constants)', () => {
    const valuation = FUNDAMENTAL_VALUATION_METHOD.parameters;
    if (valuation.kind !== 'assessment' || valuation.assessmentKind !== 'valuation-level') throw new Error('unreachable');
    expect(valuation.seriesField).toBe('INDEX_LEVEL');
    expect(valuation.trailingPeriods).toBe(4);
    expect(valuation.outputScale).toBe(4);
    expect(valuation.polarityThresholds).toEqual({ positive: '0.02', negative: '-0.02' });

    const digestion = FUNDAMENTAL_CORPORATE_ACTION_METHOD.parameters;
    if (digestion.kind !== 'corporate-action-digestion') throw new Error('unreachable');
    expect(digestion.windowBasis).toBe('available-time');
    expect(digestion.windowMs).toBe(3_600_000);
    expect(digestion.minObservations).toBe(1);
    expect(digestion.implications).toEqual([
      { action: 'split', implication: 'neutral' },
      { action: 'cash_dividend', implication: 'positive' },
      { action: 'merger', implication: 'mixed' },
    ]);

    const health = FUNDAMENTAL_HEALTH_METHOD.parameters;
    if (health.kind !== 'assessment' || health.assessmentKind !== 'health-indicator') throw new Error('unreachable');
    expect(health.healthFields).toEqual(['ACTIVE_RIG_COUNT', 'RAIL_TRAFFIC_INDEX', 'POWER_DEMAND_INDEX']);

    expect(FUNDAMENTAL_MACRO_SURPRISE_METHOD.parameters.kind).toBe('assessment');
    expect(FUNDAMENTAL_CONFIDENCE_METHOD.kind).toBe('confidence-estimation');
    expect(FUNDAMENTAL_REPORT_COMPOSITION_METHOD.kind).toBe('report-composition');
  });

  it('stores methods in canonical (canonical-JSON) order — shuffles digest identically', () => {
    const methods = FUNDAMENTAL_METHOD_REGISTRY.methods;
    const once = createFundamentalMethodRegistry([...methods].reverse());
    expect(once.ok).toBe(true);
    if (once.ok) {
      expect(once.value.methods.map((m) => m.methodId)).toEqual(methods.map((m) => m.methodId));
      expect(once.value.digest).toBe(FUNDAMENTAL_METHOD_REGISTRY.digest);
    }
  });
});

describe('method-record validation', () => {
  it('accepts the canonical records and round-trips them through the factory', () => {
    for (const method of FUNDAMENTAL_METHOD_REGISTRY.methods) {
      expect(isFundamentalMethodRecord(method)).toBe(true);
      expect(validateFundamentalMethodRecord(method)).toEqual([]);
      const built = createFundamentalMethodRecord(JSON.parse(JSON.stringify(method)));
      expect(built.ok).toBe(true);
      if (built.ok) {
        expect(built.value.methodId).toBe(method.methodId);
      }
    }
  });

  it('rejects a malformed record (collect-all, typed)', () => {
    const errors = validateFundamentalMethodRecord({
      methodId: '',
      kind: 'assessment',
      version: '1.0',
      parameters: { kind: 'assessment' },
      declaredBy: '',
      declaredAt: -1,
    });
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('invalid_field');
    expect(errors.length).toBeGreaterThanOrEqual(5);
  });

  it('rejects an unknown method kind and input class', () => {
    const errors = validateFundamentalMethodRecord({
      methodId: 'method/x',
      kind: 'magic',
      version: '1.0.0',
      parameters: { kind: 'magic' },
      declaredBy: 'x',
      declaredAt: 0,
    });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.every((e) => e.code === 'invalid_field')).toBe(true);
    expect(METHOD_KINDS).toContain('assessment');
  });

  it('rejects an assessment method whose thresholds are not decimals', () => {
    const errors = validateFundamentalMethodRecord({
      ...FUNDAMENTAL_VALUATION_METHOD,
      parameters: {
        ...FUNDAMENTAL_VALUATION_METHOD.parameters,
        polarityThresholds: { positive: 'high', negative: 'low' },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a valuation method whose input class drifts', () => {
    const errors = validateFundamentalMethodRecord({
      ...FUNDAMENTAL_VALUATION_METHOD,
      parameters: {
        ...FUNDAMENTAL_VALUATION_METHOD.parameters,
        input: 'macro-release-observations',
      },
    });
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('valuation-level methods assess fundamental-observations')]),
    );
  });

  it('rejects duplicate actions in the declared implication table', () => {
    const errors = validateFundamentalMethodRecord({
      ...FUNDAMENTAL_CORPORATE_ACTION_METHOD,
      parameters: {
        ...FUNDAMENTAL_CORPORATE_ACTION_METHOD.parameters,
        implications: [
          { action: 'split', implication: 'neutral' },
          { action: 'split', implication: 'positive' },
        ],
      },
    });
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('duplicate action')]),
    );
  });

  it('rejects an implication outside the declared stance taxonomy', () => {
    const errors = validateFundamentalMethodRecord({
      ...FUNDAMENTAL_CORPORATE_ACTION_METHOD,
      parameters: {
        ...FUNDAMENTAL_CORPORATE_ACTION_METHOD.parameters,
        implications: [{ action: 'merger', implication: 'bullish' }],
      },
    });
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('outside the declared stance taxonomy')]),
    );
  });

  it('rejects a health method with an empty or duplicate field set', () => {
    const base = FUNDAMENTAL_HEALTH_METHOD;
    const withEmpty = validateFundamentalMethodRecord({ ...base, parameters: { ...base.parameters, healthFields: [] } });
    expect(withEmpty.length).toBeGreaterThan(0);
    const withDuplicates = validateFundamentalMethodRecord({
      ...base,
      parameters: { ...base.parameters, healthFields: ['ACTIVE_RIG_COUNT', 'ACTIVE_RIG_COUNT'] },
    });
    expect(withDuplicates.length).toBeGreaterThan(0);
  });
});

describe('registry construction', () => {
  it('refuses an empty registry (method_registry_empty)', () => {
    const result = createFundamentalMethodRegistry([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('method_registry_empty');
    }
  });

  it('refuses duplicate method ids (duplicate_method)', () => {
    const result = createFundamentalMethodRegistry([FUNDAMENTAL_VALUATION_METHOD, FUNDAMENTAL_VALUATION_METHOD]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e: { code: string }) => e.code)).toContain('duplicate_method');
    }
  });

  it('canonicalizes order: two shuffles of the same set digest identically', () => {
    const methods = FUNDAMENTAL_METHOD_REGISTRY.methods;
    const once = createFundamentalMethodRegistry([...methods].reverse());
    expect(once.ok).toBe(true);
    if (once.ok) expect(once.value.digest).toBe(FUNDAMENTAL_METHOD_REGISTRY.digest);
  });
});

describe('citation resolution', () => {
  it('resolves a correct citation with no errors', () => {
    expect(
      resolveFundamentalMethodCitation(
        FUNDAMENTAL_METHOD_REGISTRY,
        'method/fundamental/valuation',
        '1.0.0',
        'assessment',
      ),
    ).toEqual([]);
  });

  it('an undeclared method is a typed error (the magic-number law)', () => {
    const errors = resolveFundamentalMethodCitation(
      FUNDAMENTAL_METHOD_REGISTRY,
      'method/fundamental/magic-number',
      '1.0.0',
      'assessment',
    );
    expect(errors[0]?.code).toBe('undeclared_method');
  });

  it('a stale version is a typed error', () => {
    const errors = resolveFundamentalMethodCitation(
      FUNDAMENTAL_METHOD_REGISTRY,
      'method/fundamental/valuation',
      '0.9.0',
      'assessment',
    );
    expect(errors[0]?.code).toBe('method_version_mismatch');
  });

  it('a wrong-kind use is a typed error', () => {
    const errors = resolveFundamentalMethodCitation(
      FUNDAMENTAL_METHOD_REGISTRY,
      'method/fundamental/confidence',
      '1.0.0',
      'assessment',
    );
    expect(errors[0]?.code).toBe('method_kind_mismatch');
  });

  it('assessment-kind drift is a typed error (assessment_kind_mismatch)', () => {
    const errors = resolveAssessmentCitation(
      FUNDAMENTAL_METHOD_REGISTRY,
      'method/fundamental/valuation',
      '1.0.0',
      'macro-surprise',
    );
    expect(errors[0]?.code).toBe('assessment_kind_mismatch');
  });

  it('a correct assessment-kind citation resolves clean', () => {
    expect(
      resolveAssessmentCitation(FUNDAMENTAL_METHOD_REGISTRY, 'method/fundamental/health', '1.0.0', 'health-indicator'),
    ).toEqual([]);
  });

  it('findFundamentalMethod returns null for unknown ids', () => {
    expect(findFundamentalMethod(FUNDAMENTAL_METHOD_REGISTRY, 'method/none')).toBeNull();
  });

  it('validateFundamentalMethodRegistry accepts the canonical registry', () => {
    expect(validateFundamentalMethodRegistry(FUNDAMENTAL_METHOD_REGISTRY)).toEqual([]);
  });
});
