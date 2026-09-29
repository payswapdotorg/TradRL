// @tradrl/body-fundamental-researcher — the research report tests.
//
// Behavioral: the golden report validates (every embedded record
// re-validated, the summary re-derived); summary derivation is
// deterministic; creation derives the id and deep-freezes. Negative
// paths: a tampered summary (composition mismatch), as-of drift, body
// version drift, coverage buckets that do not sum, an invalid embedded
// record poisoning the report, tampered report ids.

import { describe, expect, it } from 'vitest';
import {
  composeFundamentalSummary,
  createFundamentalResearchReport,
  dominantStanceOf,
  isCoverageAccounting,
  isDominantStance,
  isFundamentalDataGap,
  isFundamentalResearchReport,
  isFundamentalSummary,
  serializeFundamentalResearchReport,
  validateFundamentalResearchReport,
} from './report';
import {
  FIXTURE_ACTION_DIGESTS,
  FIXTURE_COVERAGE,
  FIXTURE_DATA_GAPS,
  FIXTURE_HEALTH_ASSESSMENT,
  FIXTURE_MACRO_ASSESSMENT,
  FIXTURE_REGISTRY,
  FIXTURE_REPORT,
  FIXTURE_VALUATION_ASSESSMENT,
} from './fixtures';
import { isDeeplyFrozen } from './primitives';

const codesOf = (draft: unknown): readonly string[] =>
  validateFundamentalResearchReport(draft, FIXTURE_REGISTRY).map((e) => e.code);

const GOLDEN_ASSESSMENTS = [FIXTURE_VALUATION_ASSESSMENT, FIXTURE_MACRO_ASSESSMENT, FIXTURE_HEALTH_ASSESSMENT];

describe('the golden report', () => {
  it('validates cleanly under every law', () => {
    expect(validateFundamentalResearchReport(FIXTURE_REPORT, FIXTURE_REGISTRY)).toEqual([]);
    expect(isFundamentalResearchReport(FIXTURE_REPORT)).toBe(true);
  });

  it('embeds every golden record with full lineage (L9)', () => {
    expect(FIXTURE_REPORT.assessments).toEqual(GOLDEN_ASSESSMENTS);
    expect(FIXTURE_REPORT.actionDigests).toEqual(FIXTURE_ACTION_DIGESTS);
    for (const assessment of FIXTURE_REPORT.assessments) {
      expect(assessment.evidence.length).toBeGreaterThan(0);
    }
    expect(FIXTURE_REPORT.assessments[0]?.evidence.length).toBe(5);
    expect(FIXTURE_REPORT.assessments[1]?.evidence.length).toBe(2);
    expect(FIXTURE_REPORT.assessments[2]?.evidence.length).toBe(4);
  });

  it('is deeply frozen with a derived frr- id', () => {
    expect(FIXTURE_REPORT.reportId.startsWith('frr-')).toBe(true);
    expect(isDeeplyFrozen(FIXTURE_REPORT)).toBe(true);
  });

  it('serializes byte-deterministically (same input, same bytes, twice)', () => {
    expect(serializeFundamentalResearchReport(FIXTURE_REPORT)).toBe(
      serializeFundamentalResearchReport(FIXTURE_REPORT),
    );
  });
});

describe('summary derivation (the declared composition method)', () => {
  it('re-derives the golden summary from the embedded records', () => {
    const derived = composeFundamentalSummary({
      assessments: GOLDEN_ASSESSMENTS,
      actionDigests: FIXTURE_ACTION_DIGESTS,
      coverage: FIXTURE_COVERAGE,
      dataGaps: FIXTURE_DATA_GAPS,
    });
    expect(derived).toEqual(FIXTURE_REPORT.summary);
  });

  it('is deterministic: deriving twice yields identical bytes', () => {
    const once = composeFundamentalSummary({ assessments: GOLDEN_ASSESSMENTS, actionDigests: FIXTURE_ACTION_DIGESTS, coverage: FIXTURE_COVERAGE, dataGaps: FIXTURE_DATA_GAPS });
    const twice = composeFundamentalSummary({ assessments: GOLDEN_ASSESSMENTS, actionDigests: FIXTURE_ACTION_DIGESTS, coverage: FIXTURE_COVERAGE, dataGaps: FIXTURE_DATA_GAPS });
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it('an empty report carries no-assessment dominance and a null mean (never a fabricated zero)', () => {
    const summary = composeFundamentalSummary({ assessments: [], actionDigests: [], coverage: FIXTURE_COVERAGE, dataGaps: [] });
    expect(summary.dominantStance).toBe('no-assessment');
    expect(summary.meanStanceScore).toBeNull();
    expect(summary.assessmentCount).toBe(0);
  });

  it('dominance: highest count wins; neutral loses ties; empty is no-assessment', () => {
    expect(dominantStanceOf(GOLDEN_ASSESSMENTS)).toBe('positive');
    expect(dominantStanceOf([])).toBe('no-assessment');
    expect(isDominantStance('no-assessment')).toBe(true);
    expect(isDominantStance('mixed')).toBe(false);
  });

  it('the guards reject malformed summaries, coverage and gaps', () => {
    expect(isCoverageAccounting({ observationsOffered: -1 })).toBe(false);
    expect(isCoverageAccounting(FIXTURE_COVERAGE)).toBe(true);
    expect(isFundamentalDataGap({ kind: 'no-tea', instrument: '', series: '' })).toBe(false);
    expect(isFundamentalDataGap(FIXTURE_DATA_GAPS[0])).toBe(true);
    expect(isFundamentalSummary(null)).toBe(false);
  });
});

describe('creation', () => {
  it('creates a validated report with a derived id', () => {
    const { reportId: _ignored, ...material } = FIXTURE_REPORT;
    void _ignored;
    const created = createFundamentalResearchReport(material, FIXTURE_REGISTRY);
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.reportId).toBe(FIXTURE_REPORT.reportId);
      expect(isDeeplyFrozen(created.value)).toBe(true);
    }
  });

  it('refuses a poisoned draft (an invalid embedded record) with typed data', () => {
    const { reportId: _ignored, ...material } = FIXTURE_REPORT;
    void _ignored;
    const poisoned = {
      ...material,
      assessments: [...material.assessments, { ...FIXTURE_VALUATION_ASSESSMENT, evidence: [] }],
    };
    const refused = createFundamentalResearchReport(poisoned, FIXTURE_REGISTRY);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.errors.some((e: { code: string }) => e.code === 'evidence_missing')).toBe(true);
    }
  });
});

describe('THE NEGATIVE PATHS (every law, every typed error)', () => {
  it('a tampered summary fails (report_composition_mismatch)', () => {
    expect(codesOf({ ...FIXTURE_REPORT, summary: { ...FIXTURE_REPORT.summary, assessmentCount: 99 } })).toContain(
      'report_composition_mismatch',
    );
  });

  it('coverage buckets that do not sum fail (nothing silently dropped)', () => {
    const badCoverage = {
      ...FIXTURE_REPORT,
      summary: {
        ...FIXTURE_REPORT.summary,
        coverage: { ...FIXTURE_COVERAGE, observationsAdmitted: 13 },
      },
    };
    expect(codesOf(badCoverage)).toContain('report_composition_mismatch');
  });

  it('as-of drift inside the publication fails (as_of_mismatch)', () => {
    const drifted = {
      ...FIXTURE_REPORT,
      assessments: [
        FIXTURE_VALUATION_ASSESSMENT,
        { ...FIXTURE_MACRO_ASSESSMENT, asOf: (FIXTURE_MACRO_ASSESSMENT.asOf as number) + 1 },
        FIXTURE_HEALTH_ASSESSMENT,
      ],
    };
    expect(codesOf(drifted)).toContain('as_of_mismatch');
  });

  it('body-version drift inside the publication fails (lineage_missing)', () => {
    const drifted = {
      ...FIXTURE_REPORT,
      assessments: [
        FIXTURE_VALUATION_ASSESSMENT,
        { ...FIXTURE_MACRO_ASSESSMENT, bodyVersion: 'fundamental-researcher@0.9.0' as never },
        FIXTURE_HEALTH_ASSESSMENT,
      ],
    };
    expect(codesOf(drifted)).toContain('lineage_missing');
  });

  it('a tampered report id fails (digest_mismatch)', () => {
    const tampered = { ...FIXTURE_REPORT, reportId: `frr-${'a'.repeat(16)}` as never };
    expect(codesOf(tampered)).toContain('digest_mismatch');
  });

  it('a report citing an undeclared composition method fails (undeclared_method)', () => {
    expect(codesOf({ ...FIXTURE_REPORT, methodId: 'method/fundamental/magic' })).toContain('undeclared_method');
  });

  it('missing tenant/project fails (tenant_missing, project_missing)', () => {
    const codes = codesOf({ ...FIXTURE_REPORT, tenantId: '', projectId: '' });
    expect(codes).toContain('tenant_missing');
    expect(codes).toContain('project_missing');
  });
});
