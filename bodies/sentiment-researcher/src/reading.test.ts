// @tradrl/body-sentiment-researcher — the sentiment reading tests.
//
// Behavioral: the happy path (a golden evidence-backed reading with a
// DERIVED id); every negative law (evidence-less, future citation,
// duplicate citations, undeclared method, stale version, wrong kind,
// tenant/project missing, polarity/score consistency, tampered id);
// determinism (the same draft -> the same id, twice); immutability.

import { describe, expect, it } from 'vitest';

import {
  createSentimentReading,
  deriveReadingId,
  isSentimentReading,
  serializeSentimentReading,
  validateSentimentReading,
  validateSentimentReadingRecord,
  POLARITY_DIRECTIONS,
  INTENSITY_LEVELS,
  CONFIDENCE_LEVELS,
} from './reading';
import { deepFreeze, isDeeplyFrozen } from './primitives';
import { canonicalJson } from './primitives';
import {
  FIXTURE_READING,
  FIXTURE_REGISTRY,
  evidenceLessReadingDraft,
  futureCitationReadingDraft,
  undeclaredMethodReadingDraft,
  staleMethodVersionReadingDraft,
  wrongKindMethodReadingDraft,
  tenantlessReadingDraft,
  duplicateEvidenceReadingDraft,
} from './fixtures';

const codesOf = (v: unknown): readonly string[] =>
  validateSentimentReading(v, FIXTURE_REGISTRY).map((e) => e.code);

describe('the golden reading', () => {
  it('validates cleanly and is deeply frozen', () => {
    expect(validateSentimentReading(FIXTURE_READING, FIXTURE_REGISTRY)).toEqual([]);
    expect(isSentimentReading(FIXTURE_READING)).toBe(true);
    expect(isDeeplyFrozen(FIXTURE_READING)).toBe(true);
    expect(FIXTURE_READING.readingId).toMatch(/^sr-[0-9a-f]{16}$/);
  });

  it('survives a JSON round trip (brands are compile-time only)', () => {
    const round = JSON.parse(JSON.stringify(FIXTURE_READING));
    expect(validateSentimentReading(round, FIXTURE_REGISTRY)).toEqual([]);
    expect(serializeSentimentReading(FIXTURE_READING)).toBe(canonicalJson(round));
  });

  it('carries the full lineage chain on every citation', () => {
    for (const citation of FIXTURE_READING.evidence) {
      expect(citation.provenance.origin).toBe('historical');
      expect(citation.provenance.adapter).not.toBeNull();
    }
    expect(FIXTURE_READING.evidence.length).toBe(5);
    expect(FIXTURE_READING.tenantId).toBe('tenant-research');
    expect(FIXTURE_READING.projectId).toBe('project-sentiment');
    expect(FIXTURE_READING.bodyVersion).toBe('sentiment-researcher@1.0.0');
  });
});

describe('the evidence law (L9)', () => {
  it('an evidence-less reading fails validation', () => {
    const codes = codesOf({ ...evidenceLessReadingDraft(), readingId: 'sr-pending' });
    expect(codes).toContain('evidence_missing');
    const created = createSentimentReading(evidenceLessReadingDraft(), FIXTURE_REGISTRY);
    expect(created.ok).toBe(false);
    if (created.ok) throw new Error('unreachable');
    expect(created.errors.map((e) => e.code)).toContain('evidence_missing');
  });

  it('duplicate observation citations fail', () => {
    const codes = codesOf({ ...duplicateEvidenceReadingDraft(), readingId: 'sr-pending' });
    expect(codes).toContain('duplicate_observation_ref');
  });
});

describe('the L4 law (point-in-time citations)', () => {
  it('a citation whose available_time exceeds the as-of instant fails', () => {
    const codes = codesOf({ ...futureCitationReadingDraft(), readingId: 'sr-pending' });
    expect(codes).toContain('future_evidence');
    const created = createSentimentReading(futureCitationReadingDraft(), FIXTURE_REGISTRY);
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.errors.map((e) => e.code)).toContain('future_evidence');
    }
  });
});

describe('the method-honesty laws', () => {
  it('an undeclared method fails (the magic-number law)', () => {
    const codes = codesOf({ ...undeclaredMethodReadingDraft(), readingId: 'sr-pending' });
    expect(codes).toContain('undeclared_method');
  });

  it('a stale method version fails', () => {
    const codes = codesOf({ ...staleMethodVersionReadingDraft(), readingId: 'sr-pending' });
    expect(codes).toContain('method_version_mismatch');
  });

  it('a wrong-kind citation fails', () => {
    const codes = codesOf({ ...wrongKindMethodReadingDraft(), readingId: 'sr-pending' });
    expect(codes).toContain('method_kind_mismatch');
  });
});

describe('the L12 law (tenant/project)', () => {
  it('missing tenant and project fail with their typed codes', () => {
    const codes = codesOf({ ...tenantlessReadingDraft(), readingId: 'sr-pending' });
    expect(codes).toContain('tenant_missing');
    expect(codes).toContain('project_missing');
  });
});

describe('assessment consistency', () => {
  it('a positive direction with a non-positive score fails', () => {
    const draft = {
      ...FIXTURE_READING,
      polarity: { ...FIXTURE_READING.polarity, score: '-0.1000' },
    };
    const codes = codesOf({ ...draft, readingId: 'sr-pending' });
    expect(codes).toContain('polarity_direction_mismatch');
  });

  it('a neutral direction with a non-zero score fails', () => {
    const draft = {
      ...FIXTURE_READING,
      polarity: { ...FIXTURE_READING.polarity, direction: 'neutral' as const, score: '0.1000' },
    };
    expect(codesOf({ ...draft, readingId: 'sr-pending' })).toContain('polarity_direction_mismatch');
  });

  it('a polarity score outside [-1, 1] fails', () => {
    const draft = { ...FIXTURE_READING, polarity: { ...FIXTURE_READING.polarity, score: '1.5' } };
    expect(codesOf({ ...draft, readingId: 'sr-pending' }).length).toBeGreaterThan(0);
  });

  it('a dispersion of a single observation must be null, not a fabricated zero', () => {
    const draft = {
      ...FIXTURE_READING,
      confidence: { ...FIXTURE_READING.confidence, evidenceCount: 1, dispersion: '0.0000' },
    };
    expect(codesOf({ ...draft, readingId: 'sr-pending' }).length).toBeGreaterThan(0);
  });
});

describe('the derived-id law (tamper trip-wire)', () => {
  it('a tampered record fails the digest check', () => {
    const tampered = JSON.parse(JSON.stringify(FIXTURE_READING));
    (tampered as unknown as { seed: string }).seed = 'seed/sentiment/tampered';
    expect(codesOf(tampered)).toContain('digest_mismatch');
  });

  it('validation wrapper returns the record when clean', () => {
    const result = validateSentimentReadingRecord(FIXTURE_READING, FIXTURE_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(FIXTURE_READING);
  });
});

describe('determinism (the determinism law)', () => {
  it('the same draft constructs a byte-identical reading twice', () => {
    const draft = JSON.parse(JSON.stringify(FIXTURE_READING));
    delete (draft as Record<string, unknown>).readingId;
    const once = createSentimentReading(draft, FIXTURE_REGISTRY);
    const twice = createSentimentReading(draft, FIXTURE_REGISTRY);
    expect(once.ok).toBe(true);
    expect(twice.ok).toBe(true);
    if (!once.ok || !twice.ok) throw new Error('unreachable');
    expect(once.value).toEqual(twice.value);
    expect(serializeSentimentReading(once.value)).toBe(serializeSentimentReading(twice.value));
    expect(deriveReadingId(draft)).toBe(FIXTURE_READING.readingId);
  });

  it('the vocabularies are closed', () => {
    expect(POLARITY_DIRECTIONS).toEqual(['positive', 'negative', 'neutral', 'mixed']);
    expect(INTENSITY_LEVELS).toEqual(['low', 'moderate', 'high']);
    expect(CONFIDENCE_LEVELS).toEqual(['low', 'moderate', 'high']);
  });
});

describe('immutability', () => {
  it('mutating a frozen reading throws', () => {
    expect(() => {
      (FIXTURE_READING as unknown as { seed: string }).seed = 'x';
    }).toThrow();
    expect(() => {
      (FIXTURE_READING.evidence as unknown as { push: (x: unknown) => void }).push(1);
    }).toThrow();
  });
});
