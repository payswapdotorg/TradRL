// @tradrl/body-sentiment-researcher — the research report tests.

import { describe, expect, it } from 'vitest';

import {
  composeResearchSummary,
  createResearchReport,
  deriveResearchReportId,
  dominantPolarityOf,
  isResearchReport,
  serializeResearchReport,
  validateResearchReport,
  DATA_GAP_KINDS,
} from './report';
import { canonicalJson, deepFreeze, isDeeplyFrozen } from './primitives';
import { FIXTURE_COVERAGE, FIXTURE_DATA_GAPS, FIXTURE_DIGEST, FIXTURE_READING, FIXTURE_REGISTRY, FIXTURE_REPORT } from './fixtures';

const codesOf = (v: unknown): readonly string[] =>
  validateResearchReport(v, FIXTURE_REGISTRY).map((e) => e.code);

describe('the golden report', () => {
  it('validates cleanly and is deeply frozen', () => {
    expect(validateResearchReport(FIXTURE_REPORT, FIXTURE_REGISTRY)).toEqual([]);
    expect(isResearchReport(FIXTURE_REPORT)).toBe(true);
    expect(isDeeplyFrozen(FIXTURE_REPORT)).toBe(true);
    expect(FIXTURE_REPORT.reportId).toMatch(/^rr-[0-9a-f]{16}$/);
    expect(FIXTURE_REPORT.readings.length).toBe(1);
    expect(FIXTURE_REPORT.digests.length).toBe(1);
  });

  it('carries the enumerated summary with NO free-text field anywhere', () => {
    const summary = FIXTURE_REPORT.summary;
    expect(summary.readingCount).toBe(1);
    expect(summary.digestCount).toBe(1);
    expect(summary.instrumentCount).toBe(1);
    expect(summary.dominantPolarity).toBe('positive');
    expect(summary.meanPolarityScore).toBe('0.3000');
    expect(summary.coverage).toEqual(FIXTURE_COVERAGE);
    expect(summary.dataGaps).toEqual(FIXTURE_DATA_GAPS);
    // enumerate the whole summary's key set — only structured fields exist
    expect(Object.keys(summary).sort()).toEqual([
      'coverage',
      'dataGaps',
      'digestCount',
      'dominantPolarity',
      'instrumentCount',
      'meanPolarityScore',
      'readingCount',
    ]);
  });

  it('survives a JSON round trip byte-identically', () => {
    const round = JSON.parse(JSON.stringify(FIXTURE_REPORT));
    expect(validateResearchReport(round, FIXTURE_REGISTRY)).toEqual([]);
    expect(serializeResearchReport(FIXTURE_REPORT)).toBe(canonicalJson(round));
  });
});

describe('the composition law', () => {
  it('a summary that disagrees with its records fails (report_composition_mismatch)', () => {
    const tampered = JSON.parse(JSON.stringify(FIXTURE_REPORT));
    (tampered.summary as unknown as { readingCount: number }).readingCount = 7;
    expect(codesOf(tampered)).toContain('report_composition_mismatch');
  });

  it('coverage buckets must sum to observationsOffered (nothing silently dropped)', () => {
    const tampered = JSON.parse(JSON.stringify(FIXTURE_REPORT));
    (tampered.summary.coverage as unknown as { observationsDeferred: number }).observationsDeferred = 4;
    expect(codesOf(tampered)).toContain('report_composition_mismatch');
  });

  it('an embedded reading that violates a law fails through the report', () => {
    const tampered = JSON.parse(JSON.stringify(FIXTURE_REPORT));
    (tampered.readings[0] as unknown as { tenantId: string }).tenantId = '';
    const codes = codesOf(tampered);
    expect(codes).toContain('tenant_missing');
  });

  it('an embedded record at a different as-of fails (as_of_mismatch)', () => {
    const tampered = JSON.parse(JSON.stringify(FIXTURE_REPORT));
    (tampered.readings[0] as unknown as { asOf: number }).asOf = (FIXTURE_REPORT.asOf as number) + 1_000;
    expect(codesOf(tampered)).toContain('as_of_mismatch');
  });

  it('an embedded record citing a different body version fails (lineage_missing)', () => {
    const tampered = JSON.parse(JSON.stringify(FIXTURE_REPORT));
    (tampered.digests[0] as unknown as { bodyVersion: string }).bodyVersion = 'sentiment-researcher@2.0.0';
    expect(codesOf(tampered)).toContain('lineage_missing');
  });

  it('an undeclared composition method fails', () => {
    const tampered = JSON.parse(JSON.stringify(FIXTURE_REPORT));
    (tampered as unknown as { methodId: string }).methodId = 'method/sentiment/magic';
    expect(codesOf(tampered)).toContain('undeclared_method');
  });

  it('a tampered report id fails (digest_mismatch)', () => {
    const tampered = JSON.parse(JSON.stringify(FIXTURE_REPORT));
    (tampered as unknown as { seed: string }).seed = 'seed/tampered';
    expect(codesOf(tampered)).toContain('digest_mismatch');
  });
});

describe('summary derivation (the declared composition function)', () => {
  it('dominantPolarityOf: counts with the fixed tie-break precedence', () => {
    expect(dominantPolarityOf([])).toBe('no-reading');
    expect(dominantPolarityOf([FIXTURE_READING])).toBe('positive');
    const neutral = { ...FIXTURE_READING, polarity: { ...FIXTURE_READING.polarity, direction: 'neutral' as const, score: '0.0000' } };
    expect(dominantPolarityOf([neutral, FIXTURE_READING])).toBe('positive'); // tie -> positive by precedence
  });

  it('composeResearchSummary recomputes the golden summary exactly', () => {
    const expected = composeResearchSummary({
      readings: [FIXTURE_READING],
      digests: [FIXTURE_DIGEST],
      coverage: FIXTURE_COVERAGE,
      dataGaps: FIXTURE_DATA_GAPS,
    });
    expect(expected).toEqual(FIXTURE_REPORT.summary);
    expect(DATA_GAP_KINDS.length).toBe(3);
  });

  it('meanPolarityScore is null with no readings — never a fabricated zero', () => {
    const expected = composeResearchSummary({
      readings: [],
      digests: [],
      coverage: FIXTURE_COVERAGE,
      dataGaps: [],
    });
    expect(expected.meanPolarityScore).toBeNull();
    expect(expected.dominantPolarity).toBe('no-reading');
  });
});

describe('determinism', () => {
  it('the same draft constructs a byte-identical report twice', () => {
    const draft = JSON.parse(JSON.stringify(FIXTURE_REPORT));
    delete (draft as Record<string, unknown>).reportId;
    const once = createResearchReport(draft, FIXTURE_REGISTRY);
    const twice = createResearchReport(draft, FIXTURE_REGISTRY);
    expect(once.ok).toBe(true);
    expect(twice.ok).toBe(true);
    if (!once.ok || !twice.ok) throw new Error('unreachable');
    expect(once.value).toEqual(twice.value);
    expect(serializeResearchReport(once.value)).toBe(serializeResearchReport(twice.value));
    expect(deriveResearchReportId(draft)).toBe(FIXTURE_REPORT.reportId);
  });
});
