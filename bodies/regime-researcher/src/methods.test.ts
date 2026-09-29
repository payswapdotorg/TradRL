// @tradrl/body-regime-researcher — the declared-method discipline tests.

import { describe, expect, it } from 'vitest';

import {
  DERIVABLE_REGIME_LABELS,
  REGIME_CLASSIFICATION_METHOD,
  REGIME_CHANGE_DETECTION_METHOD,
  REGIME_CONFIDENCE_METHOD,
  REGIME_METHOD_INPUTS,
  REGIME_METHOD_KINDS,
  REGIME_METHOD_REGISTRY,
  REGIME_REPORT_COMPOSITION_METHOD,
  createRegimeMethodRecord,
  createRegimeMethodRegistry,
  findRegimeMethod,
  isRegimeMethodRecord,
  isRegimeMethodRegistry,
  resolveRegimeMethodCitation,
  validateRegimeMethodRecord,
  validateRegimeMethodRegistry,
} from './methods';
import { deepCloneJson, isDeeplyFrozen } from './primitives';

const codesOf = (errors: readonly { code: string }[]): readonly string[] => errors.map((e) => e.code);

/** Clones a fixture into a mutable draft shape (JSON round-trip; brands are compile-time only). */
const cloneJson = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;

interface ClassificationDraft {
  methodId: string;
  kind: string;
  version: string;
  parameters: {
    kind: string;
    input: string;
    windowBasis: string;
    windowMs: number;
    minObservations: number;
    priceBasis: string;
    outputScale: number;
    rounding: string;
    regimes: string[];
    trendThreshold: string;
    volatileThreshold: string;
    quietThreshold: string;
    decisionOrder: string;
  };
  declaredBy: string;
  declaredAt: number;
}

interface ChangeDetectionDraft {
  methodId: string;
  kind: string;
  version: string;
  parameters: {
    kind: string;
    input: string;
    basis: string;
    classificationMethod: string;
  };
  declaredBy: string;
  declaredAt: number;
}

describe('createRegimeMethodRecord', () => {
  it('constructs a valid record and freezes it', () => {
    const construction = createRegimeMethodRecord(deepCloneJson(REGIME_CLASSIFICATION_METHOD));
    expect(construction.ok).toBe(true);
    if (construction.ok) {
      expect(isRegimeMethodRecord(construction.value)).toBe(true);
      expect(isDeeplyFrozen(construction.value)).toBe(true);
    }
  });

  it('rejects a wrong-typed draft with typed errors (never throws)', () => {
    for (const bad of [null, 42, 'method', {}, { ...REGIME_CLASSIFICATION_METHOD, kind: 'nonsense' }]) {
      const result = createRegimeMethodRecord(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects a classification method with an incomplete taxonomy (the closed-taxonomy law)', () => {
    const draft = cloneJson<ClassificationDraft>(REGIME_CLASSIFICATION_METHOD);
    draft.parameters.regimes = ['bull', 'bear']; // misses every derivable label
    const errors = validateRegimeMethodRecord(draft);
    expect(errors.length).toBeGreaterThanOrEqual(DERIVABLE_REGIME_LABELS.length);
    for (const error of errors) expect(error.code).toBe('invalid_field');
    expect(errors.map((e) => e.message).join(' ')).toContain('trending-up');
  });

  it('rejects a classification method whose quiet threshold exceeds its volatile threshold', () => {
    const draft = cloneJson<ClassificationDraft>(REGIME_CLASSIFICATION_METHOD);
    draft.parameters.quietThreshold = '0.0200';
    draft.parameters.volatileThreshold = '0.0100';
    const errors = validateRegimeMethodRecord(draft);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain('quiet');
  });

  it('rejects a classification method below the two-price minimum', () => {
    const draft = cloneJson<ClassificationDraft>(REGIME_CLASSIFICATION_METHOD);
    draft.parameters.minObservations = 1;
    const errors = validateRegimeMethodRecord(draft);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain('>= 2');
  });

  it('rejects duplicate taxonomy labels and non-positive trend thresholds', () => {
    const duplicate = cloneJson<ClassificationDraft>(REGIME_CLASSIFICATION_METHOD);
    duplicate.parameters.regimes = [...duplicate.parameters.regimes, 'ranging'];
    expect(validateRegimeMethodRecord(duplicate).length).toBeGreaterThan(0);
    const zeroTrend = cloneJson<ClassificationDraft>(REGIME_CLASSIFICATION_METHOD);
    zeroTrend.parameters.trendThreshold = '0';
    expect(validateRegimeMethodRecord(zeroTrend).length).toBeGreaterThan(0);
  });

  it('rejects a change-detection method without the classification link', () => {
    const draft = cloneJson<ChangeDetectionDraft>(REGIME_CHANGE_DETECTION_METHOD);
    draft.parameters.classificationMethod = '';
    const errors = validateRegimeMethodRecord(draft);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('createRegimeMethodRegistry', () => {
  it('constructs a registry with a derived digest and canonical ordering', () => {
    const construction = createRegimeMethodRegistry([
      deepCloneJson(REGIME_CONFIDENCE_METHOD),
      deepCloneJson(REGIME_CLASSIFICATION_METHOD),
    ]);
    expect(construction.ok).toBe(true);
    if (construction.ok) {
      expect(isRegimeMethodRegistry(construction.value)).toBe(true);
      expect(construction.value.digest).toMatch(/^[0-9a-f]{16}$/);
      // canonical order: sorted by canonical JSON of the record (the first
      // differing key is `kind`: 'confidence-estimation' < 'regime-classification')
      expect(construction.value.methods.map((m) => m.methodId)).toEqual([
        'method/regime/confidence',
        'method/regime/classification',
      ]);
    }
  });

  it('rejects a duplicate method id (duplicate_method)', () => {
    const construction = createRegimeMethodRegistry([
      deepCloneJson(REGIME_CLASSIFICATION_METHOD),
      deepCloneJson(REGIME_CLASSIFICATION_METHOD),
    ]);
    expect(construction.ok).toBe(false);
    if (!construction.ok) expect(codesOf(construction.errors)).toContain('duplicate_method');
  });

  it('rejects an empty registry (method_registry_empty)', () => {
    const construction = createRegimeMethodRegistry([]);
    expect(construction.ok).toBe(false);
    if (!construction.ok) expect(codesOf(construction.errors)).toContain('method_registry_empty');
  });

  it('rejects a registry whose digest was tampered with', () => {
    const tampered = { ...deepCloneJson(REGIME_METHOD_REGISTRY), digest: '0000000000000000' };
    expect(isRegimeMethodRegistry(tampered)).toBe(false);
    expect(validateRegimeMethodRegistry(tampered)).toEqual([]); // methods still valid; digest check is separate
  });
});

describe('resolveRegimeMethodCitation (the magic-label law)', () => {
  it('resolves a correct citation with zero errors', () => {
    expect(
      resolveRegimeMethodCitation(
        REGIME_METHOD_REGISTRY,
        'method/regime/classification',
        '1.0.0',
        'regime-classification',
      ),
    ).toEqual([]);
  });

  it('fails an UNDECLARED method (the magic-label law)', () => {
    const errors = resolveRegimeMethodCitation(
      REGIME_METHOD_REGISTRY,
      'method/regime/magic-label',
      '1.0.0',
      'regime-classification',
    );
    expect(codesOf(errors)).toContain('undeclared_method');
    expect(errors[0]!.message).toContain('magic label');
  });

  it('fails a STALE method version', () => {
    const errors = resolveRegimeMethodCitation(
      REGIME_METHOD_REGISTRY,
      'method/regime/classification',
      '0.9.0',
      'regime-classification',
    );
    expect(codesOf(errors)).toContain('method_version_mismatch');
  });

  it('fails a WRONG-KIND citation', () => {
    const errors = resolveRegimeMethodCitation(
      REGIME_METHOD_REGISTRY,
      'method/regime/classification',
      '1.0.0',
      'confidence-estimation',
    );
    expect(codesOf(errors)).toContain('method_kind_mismatch');
  });

  it('findRegimeMethod returns null for unknown ids', () => {
    expect(findRegimeMethod(REGIME_METHOD_REGISTRY, 'method/regime/none')).toBeNull();
    expect(findRegimeMethod(REGIME_METHOD_REGISTRY, 'method/regime/classification')).not.toBeNull();
  });
});

describe('REGIME_METHOD_REGISTRY (the canonical shipped set)', () => {
  it('is valid, frozen, and covers all four kinds', () => {
    expect(isRegimeMethodRegistry(REGIME_METHOD_REGISTRY)).toBe(true);
    expect(isDeeplyFrozen(REGIME_METHOD_REGISTRY)).toBe(true);
    expect(REGIME_METHOD_REGISTRY.methods.map((m) => m.kind).sort()).toEqual(
      [...REGIME_METHOD_KINDS].sort(),
    );
  });

  it('the classification method declares a closed taxonomy covering the decision function', () => {
    const parameters = cloneJson<ClassificationDraft>(REGIME_CLASSIFICATION_METHOD).parameters;
    expect(parameters.kind).toBe('regime-classification');
    for (const label of DERIVABLE_REGIME_LABELS) {
      expect(parameters.regimes).toContain(label);
    }
    expect(parameters.windowMs).toBe(10_000);
    expect(parameters.minObservations).toBe(4);
    expect(parameters.priceBasis).toBe('trade-price-or-quote-mid-or-book-best');
    expect(parameters.decisionOrder).toBe('trend-then-volatility');
  });

  it('the change-detection method links to the classification method', () => {
    const parameters = cloneJson<ChangeDetectionDraft>(REGIME_CHANGE_DETECTION_METHOD).parameters;
    expect(parameters.classificationMethod).toBe('method/regime/classification');
    expect(findRegimeMethod(REGIME_METHOD_REGISTRY, parameters.classificationMethod)).not.toBeNull();
  });

  it('mirrors the declared input classes and the method kinds as closed vocabularies', () => {
    expect([...REGIME_METHOD_KINDS]).toEqual([
      'regime-classification',
      'regime-change-detection',
      'confidence-estimation',
      'report-composition',
    ]);
    expect([...REGIME_METHOD_INPUTS]).toEqual(['market-event-observations', 'research-records']);
    expect(REGIME_CONFIDENCE_METHOD.parameters.kind).toBe('confidence-estimation');
    expect(
      cloneJson<{ parameters: { kind: string; summary: string } }>(REGIME_REPORT_COMPOSITION_METHOD).parameters
        .summary,
    ).toBe('enumerated-fields-only');
  });

  it('is byte-deterministic across module reloads (derived ids are pure)', () => {
    // Re-creating the registry from the same declared records yields the same digest.
    const reconstruction = createRegimeMethodRegistry(deepCloneJson(REGIME_METHOD_REGISTRY.methods));
    expect(reconstruction.ok).toBe(true);
    if (reconstruction.ok) expect(reconstruction.value.digest).toBe(REGIME_METHOD_REGISTRY.digest);
  });
});
