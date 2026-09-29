// @tradrl/body-cross-market-researcher — the research report tests.
//
// Behavioral: the golden report validates (every embedded record
// re-validated, the summary re-derived); summary derivation is
// deterministic; creation derives the id and deep-freezes. Negative
// paths: a tampered summary (composition mismatch), as-of drift, body
// version drift, coverage buckets that do not sum, an invalid embedded
// record poisoning the report, tampered report ids.

import { describe, expect, it } from 'vitest';
import {
  composeCrossMarketSummary,
  createCrossMarketResearchReport,
  dominantRelationKindOf,
  isCoverageAccounting,
  isCrossMarketDataGap,
  isCrossMarketResearchReport,
  isCrossMarketSummary,
  isDominantRelationKind,
  serializeCrossMarketResearchReport,
  validateCrossMarketResearchReport,
} from './report';
import {
  FIXTURE_COVERAGE,
  FIXTURE_DATA_GAPS,
  FIXTURE_REGISTRY,
  FIXTURE_RELATIONSHIPS,
  FIXTURE_REPORT,
} from './fixtures';
import { isDeeplyFrozen } from './primitives';
import { type TimestampMs } from './primitives';

const codesOf = (draft: unknown): readonly string[] =>
  validateCrossMarketResearchReport(draft, FIXTURE_REGISTRY).map((e) => e.code);

describe('the golden report', () => {
  it('validates cleanly under every law', () => {
    expect(validateCrossMarketResearchReport(FIXTURE_REPORT, FIXTURE_REGISTRY)).toEqual([]);
    expect(isCrossMarketResearchReport(FIXTURE_REPORT)).toBe(true);
  });

  it('embeds every golden relationship with full lineage (L9)', () => {
    expect(FIXTURE_REPORT.relationships).toEqual(FIXTURE_RELATIONSHIPS);
    for (const relationship of FIXTURE_REPORT.relationships) {
      expect(relationship.evidence.length).toBe(8);
      const left = relationship.evidence.filter((c) => c.leg === 'left').length;
      const right = relationship.evidence.filter((c) => c.leg === 'right').length;
      expect(left + right).toBe(8);
    }
  });

  it('is deeply frozen with a derived cmrr- id', () => {
    expect(FIXTURE_REPORT.reportId.startsWith('cmrr-')).toBe(true);
    expect(isDeeplyFrozen(FIXTURE_REPORT)).toBe(true);
  });

  it('serializes byte-deterministically (same input, same bytes, twice)', () => {
    expect(serializeCrossMarketResearchReport(FIXTURE_REPORT)).toBe(
      serializeCrossMarketResearchReport(FIXTURE_REPORT),
    );
  });
});

describe('summary derivation (the declared composition method)', () => {
  it('re-derives the golden summary from the embedded records', () => {
    const derived = composeCrossMarketSummary({
      relationships: FIXTURE_RELATIONSHIPS,
      coverage: FIXTURE_COVERAGE,
      dataGaps: FIXTURE_DATA_GAPS,
    });
    expect(derived).toEqual(FIXTURE_REPORT.summary);
  });

  it('is deterministic: deriving twice yields identical bytes', () => {
    const once = composeCrossMarketSummary({ relationships: FIXTURE_RELATIONSHIPS, coverage: FIXTURE_COVERAGE, dataGaps: FIXTURE_DATA_GAPS });
    const twice = composeCrossMarketSummary({ relationships: FIXTURE_RELATIONSHIPS, coverage: FIXTURE_COVERAGE, dataGaps: FIXTURE_DATA_GAPS });
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it('an empty report carries no-relationship dominance and a null mean (never a fabricated zero)', () => {
    const summary = composeCrossMarketSummary({ relationships: [], coverage: FIXTURE_COVERAGE, dataGaps: [] });
    expect(summary.dominantRelationKind).toBe('no-relationship');
    expect(summary.meanMeasureScore).toBeNull();
    expect(summary.relationshipCount).toBe(0);
    expect(summary.pairCount).toBe(0);
  });

  it('dominance: highest count wins; co-movement wins ties; empty is no-relationship', () => {
    expect(dominantRelationKindOf(FIXTURE_RELATIONSHIPS)).toBe('spread-divergence');
    expect(dominantRelationKindOf([])).toBe('no-relationship');
    expect(isDominantRelationKind('no-relationship')).toBe(true);
    expect(isDominantRelationKind('positive')).toBe(false);
  });

  it('the guards reject malformed summaries, coverage and gaps', () => {
    expect(isCoverageAccounting({ observationsOffered: -1 })).toBe(false);
    expect(isCoverageAccounting(FIXTURE_COVERAGE)).toBe(true);
    expect(isCrossMarketDataGap({ kind: 'no-tea', leftInstrument: '', rightInstrument: '' })).toBe(false);
    expect(isCrossMarketDataGap(FIXTURE_DATA_GAPS[0])).toBe(true);
    expect(isCrossMarketSummary(null)).toBe(false);
  });
});

describe('creation', () => {
  it('creates a validated report with a derived id', () => {
    const { reportId: _ignored, ...material } = FIXTURE_REPORT;
    void _ignored;
    const created = createCrossMarketResearchReport(material, FIXTURE_REGISTRY);
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
      relationships: [...material.relationships, { ...FIXTURE_RELATIONSHIPS[2]!, evidence: [] }],
    };
    const refused = createCrossMarketResearchReport(poisoned, FIXTURE_REGISTRY);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.errors.some((e: { code: string }) => e.code === 'evidence_missing')).toBe(true);
    }
  });
});

describe('THE NEGATIVE PATHS (every law, every typed error)', () => {
  it('a tampered summary fails (report_composition_mismatch)', () => {
    expect(codesOf({ ...FIXTURE_REPORT, summary: { ...FIXTURE_REPORT.summary, relationshipCount: 99 } })).toContain(
      'report_composition_mismatch',
    );
  });

  it('coverage buckets that do not sum fail (nothing silently dropped)', () => {
    const badCoverage = {
      ...FIXTURE_REPORT,
      summary: {
        ...FIXTURE_REPORT.summary,
        coverage: { ...FIXTURE_COVERAGE, observationsAdmitted: 11 },
      },
    };
    expect(codesOf(badCoverage)).toContain('report_composition_mismatch');
  });

  it('as-of drift inside the publication fails (as_of_mismatch)', () => {
    const drifted = {
      ...FIXTURE_REPORT,
      relationships: [
        FIXTURE_RELATIONSHIPS[0]!,
        ...FIXTURE_RELATIONSHIPS.slice(1).map((r, index) =>
          index === 0 ? { ...r, asOf: ((r.asOf as number) + 1) as TimestampMs } : r,
        ),
      ],
    };
    expect(codesOf(drifted)).toContain('as_of_mismatch');
  });

  it('body-version drift inside the publication fails (lineage_missing)', () => {
    const drifted = {
      ...FIXTURE_REPORT,
      relationships: [
        { ...FIXTURE_RELATIONSHIPS[0]!, bodyVersion: 'cross-market-researcher@0.9.0' as never },
        ...FIXTURE_RELATIONSHIPS.slice(1),
      ],
    };
    expect(codesOf(drifted)).toContain('lineage_missing');
  });

  it('a tampered report id fails (digest_mismatch)', () => {
    const tampered = { ...FIXTURE_REPORT, reportId: `cmrr-${'a'.repeat(16)}` as never };
    expect(codesOf(tampered)).toContain('digest_mismatch');
  });

  it('a report citing an undeclared composition method fails (undeclared_method)', () => {
    expect(codesOf({ ...FIXTURE_REPORT, methodId: 'method/crossmarket/magic' })).toContain('undeclared_method');
  });

  it('missing tenant/project fails (tenant_missing, project_missing)', () => {
    const codes = codesOf({ ...FIXTURE_REPORT, tenantId: '', projectId: '' });
    expect(codes).toContain('tenant_missing');
    expect(codes).toContain('project_missing');
  });
});
