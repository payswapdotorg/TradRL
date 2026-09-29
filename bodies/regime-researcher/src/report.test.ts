// @tradrl/body-regime-researcher — the regime research report tests.

import { describe, expect, it } from 'vitest';

import {
  REGIME_DATA_GAP_KINDS,
  composeRegimeSummary,
  createRegimeResearchReport,
  dominantRegimeOf,
  isRegimeResearchReport,
  serializeRegimeResearchReport,
  validateRegimeResearchReport,
} from './report';
import {
  FIXTURE_CHANGE,
  FIXTURE_CLASSIFICATION_W0,
  FIXTURE_CLASSIFICATION_W1,
  FIXTURE_COVERAGE,
  FIXTURE_DATA_GAPS,
  FIXTURE_REPORT,
  FIXTURE_REGISTRY,
  evidenceLessClassificationDraft,
} from './fixtures';
import { REGIME_METHOD_REGISTRY } from './methods';
import type { RegimeResearchReport } from './report';
import { isDeeplyFrozen } from './primitives';

const codesOf = (errors: readonly { code: string }[]): readonly string[] => errors.map((e) => e.code);
const TAXONOMY = ['trending-up', 'trending-down', 'ranging', 'volatile', 'quiet'];

describe('the golden report', () => {
  it('validates cleanly and is deeply frozen', () => {
    expect(validateRegimeResearchReport(FIXTURE_REPORT, REGIME_METHOD_REGISTRY)).toEqual([]);
    expect(isRegimeResearchReport(FIXTURE_REPORT)).toBe(true);
    expect(isDeeplyFrozen(FIXTURE_REPORT)).toBe(true);
  });

  it('carries the enumerated summary with NO free-text field anywhere', () => {
    const summary = FIXTURE_REPORT.summary;
    expect(summary.classificationCount).toBe(2);
    expect(summary.changeCount).toBe(1);
    expect(summary.instrumentCount).toBe(1);
    expect(summary.windowCount).toBe(2);
    expect(summary.dominantRegime).toBe('trending-up');
    expect(summary.meanNetMoveRatio).toBe('0.0238');
    expect(summary.coverage).toEqual(FIXTURE_COVERAGE);
    expect(summary.dataGaps).toEqual(FIXTURE_DATA_GAPS);
    // the enumerated fields are exactly these — no narrative anywhere
    expect(Object.keys(summary).sort()).toEqual([
      'changeCount',
      'classificationCount',
      'coverage',
      'dataGaps',
      'dominantRegime',
      'instrumentCount',
      'meanNetMoveRatio',
      'windowCount',
    ]);
  });

  it('survives a JSON round trip byte-identically', () => {
    const round = JSON.parse(JSON.stringify(FIXTURE_REPORT));
    expect(validateRegimeResearchReport(round, REGIME_METHOD_REGISTRY)).toEqual([]);
    expect(serializeRegimeResearchReport(round)).toBe(serializeRegimeResearchReport(FIXTURE_REPORT));
    expect(FIXTURE_REPORT.reportId).toMatch(/^rr-[0-9a-f]{16}$/);
  });

  it('embeds the full lineage (classifications + changes with their evidence)', () => {
    expect(FIXTURE_REPORT.classifications.map((c) => c.classificationId)).toEqual([
      FIXTURE_CLASSIFICATION_W0.classificationId,
      FIXTURE_CLASSIFICATION_W1.classificationId,
    ]);
    expect(FIXTURE_REPORT.changes.map((c) => c.changeId)).toEqual([FIXTURE_CHANGE.changeId]);
    for (const classification of FIXTURE_REPORT.classifications) {
      expect(classification.evidence.length).toBeGreaterThan(0);
      for (const citation of classification.evidence) {
        expect(citation.provenance.origin).toBe('historical');
      }
    }
    expect(FIXTURE_REPORT.changes[0]!.evidence.length).toBe(8);
  });
});

describe('summary derivation (the declared composition)', () => {
  it('dominantRegimeOf: counts with the taxonomy-order tie-break', () => {
    const cs = [FIXTURE_CLASSIFICATION_W0, FIXTURE_CLASSIFICATION_W1];
    expect(dominantRegimeOf(cs, TAXONOMY)).toBe('trending-up');
    expect(dominantRegimeOf([cs[0]!], TAXONOMY)).toBe('ranging');
    expect(dominantRegimeOf([], TAXONOMY)).toBe('no-classification');
    // tie: one ranging + one trending-up -> the first taxonomy entry wins (trending-up)
    expect(dominantRegimeOf(cs, TAXONOMY)).toBe('trending-up');
  });

  it('composeRegimeSummary recomputes the golden summary exactly', () => {
    const expected = composeRegimeSummary({
      classifications: [FIXTURE_CLASSIFICATION_W0, FIXTURE_CLASSIFICATION_W1],
      changes: [FIXTURE_CHANGE],
      coverage: FIXTURE_COVERAGE,
      dataGaps: FIXTURE_DATA_GAPS,
      taxonomy: TAXONOMY,
      outputScale: 4,
      rounding: 'half-even',
    });
    expect(expected).toEqual(FIXTURE_REPORT.summary);
  });

  it('meanNetMoveRatio is null with no classifications — never a fabricated zero', () => {
    const summary = composeRegimeSummary({
      classifications: [],
      changes: [],
      coverage: FIXTURE_COVERAGE,
      dataGaps: [],
      taxonomy: TAXONOMY,
      outputScale: 4,
      rounding: 'half-even',
    });
    expect(summary.meanNetMoveRatio).toBeNull();
    expect(summary.dominantRegime).toBe('no-classification');
  });

  it('the data-gap kinds are enumerated', () => {
    expect([...REGIME_DATA_GAP_KINDS]).toEqual(['no-market-observations', 'instrument-without-classification']);
  });
});

describe('THE NEGATIVE LAWS (each violation is a typed error)', () => {
  it('a summary that disagrees with its records fails (report_composition_mismatch)', () => {
    const draft = {
      ...FIXTURE_REPORT,
      summary: { ...FIXTURE_REPORT.summary, classificationCount: 5 },
    };
    const errors = validateRegimeResearchReport(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('report_composition_mismatch');
  });

  it('coverage buckets must sum to observationsOffered (nothing silently dropped)', () => {
    const draft = {
      ...FIXTURE_REPORT,
      summary: {
        ...FIXTURE_REPORT.summary,
        coverage: { ...FIXTURE_COVERAGE, observationsDeferred: 0 },
      },
    };
    const errors = validateRegimeResearchReport(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('report_composition_mismatch');
  });

  it('an embedded classification that violates a law fails through the report', () => {
    const draft = {
      ...FIXTURE_REPORT,
      classifications: [{ ...evidenceLessClassificationDraft(), classificationId: 'rc-x' }],
      summary: { ...FIXTURE_REPORT.summary, classificationCount: 1 },
    };
    const errors = validateRegimeResearchReport(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('evidence_missing');
  });

  it('an embedded record at a different as-of fails (as_of_mismatch)', () => {
    const draft = {
      ...FIXTURE_REPORT,
      classifications: [
        { ...FIXTURE_CLASSIFICATION_W0, asOf: (FIXTURE_CLASSIFICATION_W0.asOf as number) + 1 },
      ],
      changes: [],
      summary: { ...FIXTURE_REPORT.summary, classificationCount: 1, changeCount: 0 },
    };
    const errors = validateRegimeResearchReport(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('as_of_mismatch');
  });

  it('an embedded record citing a different body version fails (lineage_missing)', () => {
    const draft = {
      ...FIXTURE_REPORT,
      classifications: [
        { ...FIXTURE_CLASSIFICATION_W0, bodyVersion: 'regime-researcher@9.9.9' },
      ],
      changes: [],
      summary: { ...FIXTURE_REPORT.summary, classificationCount: 1, changeCount: 0 },
    };
    const errors = validateRegimeResearchReport(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('lineage_missing');
  });

  it('an undeclared composition method fails', () => {
    const draft = { ...FIXTURE_REPORT, methodId: 'method/regime/magic-composition' };
    const errors = validateRegimeResearchReport(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('undeclared_method');
  });

  it('a tampered report id fails (digest_mismatch)', () => {
    const draft = { ...FIXTURE_REPORT, seed: 'seed/tampered' };
    const errors = validateRegimeResearchReport(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('digest_mismatch');
  });

  it('missing tenant/project fail through the report (L12)', () => {
    const draft = { ...FIXTURE_REPORT, tenantId: '', projectId: '' };
    const errors = validateRegimeResearchReport(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('tenant_missing');
    expect(codesOf(errors)).toContain('project_missing');
  });
});

describe('construction + determinism', () => {
  it('the same draft constructs a byte-identical report twice', () => {
    const { reportId: _a, ...draftA } = FIXTURE_REPORT;
    const { reportId: _b, ...draftB } = JSON.parse(JSON.stringify(FIXTURE_REPORT));
    void _a; void _b;
    const once = createRegimeResearchReport(draftA, FIXTURE_REGISTRY);
    const twice = createRegimeResearchReport(draftB, FIXTURE_REGISTRY);
    expect(once.ok).toBe(true);
    expect(twice.ok).toBe(true);
    if (once.ok && twice.ok) {
      expect(once.value).toEqual(twice.value);
      expect(serializeRegimeResearchReport(once.value)).toBe(serializeRegimeResearchReport(twice.value));
      expect(once.value.reportId).toBe(FIXTURE_REPORT.reportId);
    }
  });

  it('refuses to construct a law-violating draft (typed data, never a throw)', () => {
    const draft = { ...FIXTURE_REPORT, tenantId: '' } as unknown as Omit<RegimeResearchReport, 'reportId'>;
    const result = createRegimeResearchReport(draft, FIXTURE_REGISTRY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(codesOf(result.errors)).toContain('tenant_missing');
  });

  it('garbage input is typed refusal, never a throw', () => {
    for (const bad of [null, 3, 'report', {}]) {
      expect(validateRegimeResearchReport(bad, FIXTURE_REGISTRY).length).toBeGreaterThan(0);
    }
  });
});
