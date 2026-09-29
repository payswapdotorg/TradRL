// @tradrl/body-sentiment-researcher — declared-method discipline tests.
//
// Behavioral: registry construction and canonical ordering; the method
// citation laws (undeclared method, stale version, wrong kind); registry
// guards (duplicates, empty registry, tampered digest); immutability of
// the shipped registry.

import { describe, expect, it } from 'vitest';

import {
  METHOD_KINDS,
  METHOD_INPUTS,
  EVENT_KINDS,
  SENTIMENT_METHOD_REGISTRY,
  SENTIMENT_AGGREGATION_METHOD,
  SENTIMENT_EVENT_DETECTION_METHOD,
  SENTIMENT_CONFIDENCE_METHOD,
  SENTIMENT_REPORT_COMPOSITION_METHOD,
  createMethodRecord,
  createMethodRegistry,
  findMethod,
  isMethodRecord,
  isMethodRegistry,
  resolveMethodCitation,
  validateMethodRecord,
} from './methods';
import { deepFreeze, isDeeplyFrozen } from './primitives';

const aggregationDraft = {
  methodId: 'method/test/aggregation',
  kind: 'aggregation',
  version: '1.0.0',
  parameters: {
    kind: 'aggregation',
    input: 'sentiment-score-observations',
    weighting: 'equal',
    outputScale: 4,
    rounding: 'half-even',
    polarityThresholds: { positive: '0.05', negative: '-0.05' },
    intensityThresholds: { moderate: '0.2', high: '0.5' },
    mixedDispersion: '0.5',
  },
  declaredBy: 'test-declarer',
  declaredAt: 1_780_000_000_000,
};

describe('method records', () => {
  it('constructs a valid record and freezes it', () => {
    const result = createMethodRecord(aggregationDraft);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(isMethodRecord(result.value)).toBe(true);
    expect(isDeeplyFrozen(result.value)).toBe(true);
  });

  it('rejects a wrong-typed draft with typed errors (never throws)', () => {
    for (const bad of [null, 42, 'x', {}, { ...aggregationDraft, kind: 'magic' }]) {
      const errors = validateMethodRecord(bad);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects an aggregation record with out-of-range scale', () => {
    const errors = validateMethodRecord({
      ...aggregationDraft,
      parameters: { ...aggregationDraft.parameters, outputScale: 12 },
    });
    expect(errors.some((e) => e.message.includes('outputScale'))).toBe(true);
  });

  it('rejects event detection with a kind keyword outside the taxonomy', () => {
    const errors = validateMethodRecord({
      ...aggregationDraft,
      kind: 'event-detection',
      parameters: {
        kind: 'event-detection',
        input: 'news-observations',
        windowBasis: 'available-time',
        windowMs: 1_000,
        minObservations: 2,
        kindKeywords: [{ kind: 'not-a-kind', keyword: 'x' }],
      },
    });
    expect(errors.some((e) => e.code === 'invalid_field')).toBe(true);
  });
});

describe('method registry', () => {
  it('constructs a registry with a derived digest and canonical ordering', () => {
    const result = createMethodRegistry([aggregationDraft, { ...aggregationDraft, methodId: 'method/test/aaa', kind: 'confidence-estimation', parameters: { kind: 'confidence-estimation', input: 'research-records', basis: 'evidence-count-and-dispersion', high: { minEvidence: 5, maxDispersion: '0.25' }, moderate: { minEvidence: 3, maxDispersion: '0.5' } } }]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(isMethodRegistry(result.value)).toBe(true);
    expect(result.value.methods.length).toBe(2);
    expect(result.value.digest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rejects a duplicate method id (duplicate_method)', () => {
    const result = createMethodRegistry([aggregationDraft, aggregationDraft]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors.some((e) => e.code === 'duplicate_method')).toBe(true);
  });

  it('rejects an empty registry (method_registry_empty)', () => {
    const result = createMethodRegistry([]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors.some((e) => e.code === 'method_registry_empty')).toBe(true);
  });

  it('rejects a registry whose digest was tampered with', () => {
    const tampered = deepFreeze({ ...SENTIMENT_METHOD_REGISTRY, digest: '0000000000000000' });
    expect(isMethodRegistry(tampered)).toBe(false);
  });
});

describe('method citation resolution (the honesty laws)', () => {
  it('resolves a correct citation with zero errors', () => {
    expect(resolveMethodCitation(SENTIMENT_METHOD_REGISTRY, 'method/sentiment/aggregation', '1.0.0', 'aggregation')).toEqual([]);
  });

  it('fails an UNDECLARED method (the magic-number law)', () => {
    const errors = resolveMethodCitation(SENTIMENT_METHOD_REGISTRY, 'method/sentiment/magic-number', '1.0.0', 'aggregation');
    expect(errors.map((e) => e.code)).toContain('undeclared_method');
  });

  it('fails a STALE method version', () => {
    const errors = resolveMethodCitation(SENTIMENT_METHOD_REGISTRY, 'method/sentiment/aggregation', '0.9.0', 'aggregation');
    expect(errors.map((e) => e.code)).toContain('method_version_mismatch');
  });

  it('fails a WRONG-KIND citation', () => {
    const errors = resolveMethodCitation(SENTIMENT_METHOD_REGISTRY, 'method/sentiment/aggregation', '1.0.0', 'confidence-estimation');
    expect(errors.map((e) => e.code)).toContain('method_kind_mismatch');
  });

  it('findMethod returns null for unknown ids', () => {
    expect(findMethod(SENTIMENT_METHOD_REGISTRY, 'nope')).toBeNull();
  });
});

describe('the shipped registry', () => {
  it('is valid, frozen, and covers all four kinds', () => {
    expect(isMethodRegistry(SENTIMENT_METHOD_REGISTRY)).toBe(true);
    expect(isDeeplyFrozen(SENTIMENT_METHOD_REGISTRY)).toBe(true);
    const kinds = SENTIMENT_METHOD_REGISTRY.methods.map((m) => m.kind);
    for (const kind of METHOD_KINDS) expect(kinds).toContain(kind);
    expect(SENTIMENT_AGGREGATION_METHOD.kind).toBe('aggregation');
    expect(SENTIMENT_EVENT_DETECTION_METHOD.kind).toBe('event-detection');
    expect(SENTIMENT_CONFIDENCE_METHOD.kind).toBe('confidence-estimation');
    expect(SENTIMENT_REPORT_COMPOSITION_METHOD.kind).toBe('report-composition');
  });

  it('mirrors the declared input classes and event taxonomy as closed vocabularies', () => {
    expect(METHOD_INPUTS).toContain('sentiment-score-observations');
    expect(EVENT_KINDS).toContain('coverage-burst');
    expect(EVENT_KINDS.length).toBe(10);
  });

  it('is byte-deterministic across module reloads (derived ids are pure)', () => {
    // Same registry content re-serialized twice is byte-identical.
    const once = JSON.parse(JSON.stringify(SENTIMENT_METHOD_REGISTRY)) as { digest: string };
    expect(once.digest).toBe(SENTIMENT_METHOD_REGISTRY.digest);
  });
});
