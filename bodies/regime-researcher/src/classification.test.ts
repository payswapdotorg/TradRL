// @tradrl/body-regime-researcher — the regime classification tests.

import { describe, expect, it } from 'vitest';

import {
  CONFIDENCE_LEVELS,
  classifyRegimeWindow,
  computeRegimeWindowDispersion,
  computeRegimeWindowStats,
  createRegimeClassification,
  deriveRegimeClassificationId,
  extractObservationPrice,
  isRegimeClassification,
  serializeRegimeClassification,
  validateRegimeClassification,
} from './classification';
import {
  FIXTURE_AS_OF,
  FIXTURE_AT0,
  FIXTURE_CLASSIFICATION_W0,
  FIXTURE_CLASSIFICATION_W1,
  FIXTURE_OBSERVATIONS,
  FIXTURE_REGISTRY,
  FIXTURE_W0_CITATIONS,
  duplicateEvidenceClassificationDraft,
  evidenceLessClassificationDraft,
  futureCitationClassificationDraft,
  inconsistentLabelClassificationDraft,
  magicLabelClassificationDraft,
  staleMethodVersionClassificationDraft,
  tenantlessClassificationDraft,
  undeclaredMethodClassificationDraft,
  wrongKindMethodClassificationDraft,
} from './fixtures';
import { REGIME_CLASSIFICATION_METHOD, REGIME_METHOD_REGISTRY, type RegimeClassificationParameters } from './methods';
import { isDeeplyFrozen, type TimestampMs } from './primitives';

const ms = (value: number): TimestampMs => value as TimestampMs;
const codesOf = (errors: readonly { code: string }[]): readonly string[] => errors.map((e) => e.code);
const parameters = REGIME_CLASSIFICATION_METHOD.parameters as RegimeClassificationParameters;

describe('the golden classifications', () => {
  it('validate cleanly and are deeply frozen', () => {
    expect(validateRegimeClassification(FIXTURE_CLASSIFICATION_W0, REGIME_METHOD_REGISTRY)).toEqual([]);
    expect(validateRegimeClassification(FIXTURE_CLASSIFICATION_W1, REGIME_METHOD_REGISTRY)).toEqual([]);
    expect(isDeeplyFrozen(FIXTURE_CLASSIFICATION_W0)).toBe(true);
    expect(isRegimeClassification(FIXTURE_CLASSIFICATION_W0)).toBe(true);
  });

  it('survive a JSON round trip (brands are compile-time only)', () => {
    const round = JSON.parse(JSON.stringify(FIXTURE_CLASSIFICATION_W0));
    expect(validateRegimeClassification(round, REGIME_METHOD_REGISTRY)).toEqual([]);
  });

  it('carry the full lineage chain on every citation', () => {
    for (const citation of FIXTURE_CLASSIFICATION_W0.evidence) {
      expect(citation.provenance.origin).toBe('historical');
      expect(citation.provenance.adapter).toEqual({ id: 'market-adapter', version: '1.0.0' });
      expect(citation.availableTime).toBeLessThanOrEqual(FIXTURE_AS_OF);
    }
    expect(FIXTURE_CLASSIFICATION_W0.observationCount).toBe(FIXTURE_CLASSIFICATION_W0.evidence.length);
    expect(FIXTURE_CLASSIFICATION_W0.asOf).toBe(FIXTURE_AS_OF);
    expect(FIXTURE_CLASSIFICATION_W0.bodyVersion).toBe('regime-researcher@1.0.0');
  });

  it('W0 derives ranging; W1 derives trending-up (the golden story)', () => {
    expect(FIXTURE_CLASSIFICATION_W0.label).toBe('ranging');
    expect(FIXTURE_CLASSIFICATION_W0.netMoveRatio).toBe('0.0060');
    expect(FIXTURE_CLASSIFICATION_W1.label).toBe('trending-up');
    expect(FIXTURE_CLASSIFICATION_W1.netMoveRatio).toBe('0.0417');
  });
});

describe('the declared decision function (classifyRegimeWindow)', () => {
  it('derives each label from the declared thresholds', () => {
    expect(classifyRegimeWindow({ netMoveRatio: '0.0500', meanAbsChangeRatio: '0.0040' }, parameters)).toBe('trending-up');
    expect(classifyRegimeWindow({ netMoveRatio: '-0.0500', meanAbsChangeRatio: '0.0040' }, parameters)).toBe('trending-down');
    expect(classifyRegimeWindow({ netMoveRatio: '0.0010', meanAbsChangeRatio: '0.0200' }, parameters)).toBe('volatile');
    expect(classifyRegimeWindow({ netMoveRatio: '0.0010', meanAbsChangeRatio: '0.0005' }, parameters)).toBe('quiet');
    expect(classifyRegimeWindow({ netMoveRatio: '0.0010', meanAbsChangeRatio: '0.0047' }, parameters)).toBe('ranging');
  });

  it('the trend test takes precedence over the volatility test (the declared order)', () => {
    // net move above trend AND churning: still trending (trend-then-volatility)
    expect(classifyRegimeWindow({ netMoveRatio: '0.0400', meanAbsChangeRatio: '0.0500' }, parameters)).toBe('trending-up');
  });

  it('the window statistics and the golden fixtures agree exactly', () => {
    const w0 = computeRegimeWindowStats(
      ['100.0000', '100.5000', '100.1000', '100.6000'],
      parameters,
    );
    expect(w0.ok).toBe(true);
    if (w0.ok) {
      expect(w0.value.netMoveRatio).toBe(FIXTURE_CLASSIFICATION_W0.netMoveRatio);
      expect(w0.value.meanAbsChangeRatio).toBe(FIXTURE_CLASSIFICATION_W0.meanAbsChangeRatio);
    }
    const w1 = computeRegimeWindowStats(
      ['100.6000', '101.9000', '103.3000', '104.8000'],
      parameters,
    );
    expect(w1.ok).toBe(true);
    if (w1.ok) {
      expect(w1.value.netMoveRatio).toBe(FIXTURE_CLASSIFICATION_W1.netMoveRatio);
      expect(w1.value.meanAbsChangeRatio).toBe(FIXTURE_CLASSIFICATION_W1.meanAbsChangeRatio);
    }
  });

  it('window statistics refuse a single price (never a fabricated zero)', () => {
    const result = computeRegimeWindowStats(['100.0000'], parameters);
    expect(result.ok).toBe(false);
  });

  it('dispersion is the range over the first price; null below two prices', () => {
    expect(computeRegimeWindowDispersion(['100.0000', '100.5000', '100.1000', '100.6000'], parameters)).toBe('0.0060');
    expect(computeRegimeWindowDispersion(['100.0000'], parameters)).toBeNull();
  });
});

describe('the declared price extraction', () => {
  it('trades yield their print price; quotes and books yield their mids', () => {
    expect(extractObservationPrice(FIXTURE_OBSERVATIONS[1], 4, 'half-even')).toBe('100.50');
    expect(extractObservationPrice(FIXTURE_OBSERVATIONS[0], 4, 'half-even')).toBe('100.0000');
    expect(extractObservationPrice(FIXTURE_OBSERVATIONS[5], 4, 'half-even')).toBe('101.9000');
  });

  it('a one-sided book yields no price (declared absence, never a fabrication)', () => {
    const source = FIXTURE_OBSERVATIONS[5];
    if (source.event_type !== 'book_snapshot') throw new Error('fixture 5 must be a book snapshot');
    const oneSided = { ...source, payload: { bids: [], asks: source.payload.asks } };
    expect(extractObservationPrice(oneSided, 4, 'half-even')).toBeNull();
  });

  it('the best levels are selected by price, not by array position', () => {
    const source = FIXTURE_OBSERVATIONS[5];
    if (source.event_type !== 'book_snapshot') throw new Error('fixture 5 must be a book snapshot');
    const book = {
      ...source,
      payload: {
        bids: [{ price: '101.00', size: '1.0' }, { price: '102.00', size: '1.0' }],
        asks: [{ price: '104.00', size: '1.0' }, { price: '103.00', size: '1.0' }],
      },
    };
    expect(extractObservationPrice(book, 4, 'half-even')).toBe('102.5000');
  });
});

describe('THE NEGATIVE LAWS (each violation is a typed error)', () => {
  it('an evidence-less classification fails validation', () => {
    const errors = validateRegimeClassification(
      { ...evidenceLessClassificationDraft(), classificationId: 'rc-x' },
      FIXTURE_REGISTRY,
    );
    expect(codesOf(errors)).toContain('evidence_missing');
  });

  it('duplicate observation citations fail', () => {
    const errors = validateRegimeClassification(
      { ...duplicateEvidenceClassificationDraft(), classificationId: 'rc-x' },
      FIXTURE_REGISTRY,
    );
    expect(codesOf(errors)).toContain('duplicate_observation_ref');
  });

  it('a citation whose available_time exceeds the as-of instant fails (L4)', () => {
    const errors = validateRegimeClassification(
      { ...futureCitationClassificationDraft(), classificationId: 'rc-x' },
      FIXTURE_REGISTRY,
    );
    expect(codesOf(errors)).toContain('future_evidence');
  });

  it('an undeclared method fails (the magic-label law)', () => {
    const errors = validateRegimeClassification(
      { ...undeclaredMethodClassificationDraft(), classificationId: 'rc-x' },
      FIXTURE_REGISTRY,
    );
    expect(codesOf(errors)).toContain('undeclared_method');
  });

  it('a stale method version fails', () => {
    const errors = validateRegimeClassification(
      { ...staleMethodVersionClassificationDraft(), classificationId: 'rc-x' },
      FIXTURE_REGISTRY,
    );
    expect(codesOf(errors)).toContain('method_version_mismatch');
  });

  it('a wrong-kind citation fails', () => {
    const errors = validateRegimeClassification(
      { ...wrongKindMethodClassificationDraft(), classificationId: 'rc-x' },
      FIXTURE_REGISTRY,
    );
    expect(codesOf(errors)).toContain('method_kind_mismatch');
  });

  it('missing tenant and project fail with their typed codes', () => {
    const errors = validateRegimeClassification(
      { ...tenantlessClassificationDraft(), classificationId: 'rc-x' },
      FIXTURE_REGISTRY,
    );
    expect(codesOf(errors)).toContain('tenant_missing');
    expect(codesOf(errors)).toContain('project_missing');
  });

  it('A MAGIC LABEL outside every declared taxonomy fails (regime_label_mismatch)', () => {
    const errors = validateRegimeClassification(
      { ...magicLabelClassificationDraft(), classificationId: 'rc-x' },
      FIXTURE_REGISTRY,
    );
    expect(codesOf(errors)).toContain('regime_label_mismatch');
    expect(errors.find((e) => e.code === 'regime_label_mismatch')!.message).toContain('free-text');
  });

  it('a DECLARED label inconsistent with its own statistics fails (the declared-derivation law)', () => {
    const errors = validateRegimeClassification(
      { ...inconsistentLabelClassificationDraft(), classificationId: 'rc-x' },
      FIXTURE_REGISTRY,
    );
    expect(codesOf(errors)).toContain('regime_label_mismatch');
    expect(errors.find((e) => e.code === 'regime_label_mismatch')!.message).toContain('decision function');
  });

  it('an observation count that disagrees with the evidence fails', () => {
    const draft = { ...FIXTURE_CLASSIFICATION_W0, observationCount: 9, classificationId: 'rc-x' };
    const errors = validateRegimeClassification(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('report_composition_mismatch');
  });

  it('a dispersion of a single observation must be null, not a fabricated zero', () => {
    const draft = {
      ...FIXTURE_CLASSIFICATION_W0,
      evidence: [FIXTURE_W0_CITATIONS[0]],
      observationCount: 1,
      confidence: { ...FIXTURE_CLASSIFICATION_W0.confidence, evidenceCount: 1, dispersion: '0.0000' },
      classificationId: 'rc-x',
    };
    const errors = validateRegimeClassification(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('invalid_field');
    expect(errors.find((e) => e.path === 'confidence.dispersion')!.message).toContain('null');
  });

  it('a tampered record fails the digest check', () => {
    const tampered = { ...FIXTURE_CLASSIFICATION_W0, seed: 'seed/tampered' };
    const errors = validateRegimeClassification(tampered, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('digest_mismatch');
  });
});

describe('construction + determinism', () => {
  it('refuses to construct a law-violating draft (typed data, never a throw)', () => {
    const result = createRegimeClassification(evidenceLessClassificationDraft(), FIXTURE_REGISTRY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(codesOf(result.errors)).toContain('evidence_missing');
  });

  it('the same draft constructs a byte-identical classification twice', () => {
    const { classificationId: _a, ...draftA } = FIXTURE_CLASSIFICATION_W0;
    const { classificationId: _b, ...draftB } = JSON.parse(JSON.stringify(FIXTURE_CLASSIFICATION_W0));
    void _a; void _b;
    const once = createRegimeClassification(draftA, FIXTURE_REGISTRY);
    const twice = createRegimeClassification(draftB, FIXTURE_REGISTRY);
    expect(once.ok).toBe(true);
    expect(twice.ok).toBe(true);
    if (once.ok && twice.ok) {
      expect(once.value).toEqual(twice.value);
      expect(serializeRegimeClassification(once.value)).toBe(serializeRegimeClassification(twice.value));
      expect(once.value.classificationId).toBe(FIXTURE_CLASSIFICATION_W0.classificationId);
    }
  });

  it('the derived id is a pure function of the canonical material', () => {
    const { classificationId: _ignored, ...material } = FIXTURE_CLASSIFICATION_W0;
    void _ignored;
    expect(deriveRegimeClassificationId(material)).toBe(FIXTURE_CLASSIFICATION_W0.classificationId);
    expect(FIXTURE_CLASSIFICATION_W0.classificationId).toMatch(/^rc-[0-9a-f]{16}$/);
  });

  it('garbage input is typed refusal, never a throw', () => {
    for (const bad of [null, 42, 'x', {}, { classificationId: 'rc-x' }]) {
      const errors = validateRegimeClassification(bad, FIXTURE_REGISTRY);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('the vocabularies are closed', () => {
    expect([...CONFIDENCE_LEVELS]).toEqual(['low', 'moderate', 'high']);
  });

  it('mutating a frozen classification throws', () => {
    expect(() => {
      (FIXTURE_CLASSIFICATION_W0 as { label: string }).label = 'trending-up';
    }).toThrow();
  });
});
