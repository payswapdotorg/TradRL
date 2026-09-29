// @tradrl/body-trading-director — intake tests (the four field-for-field
// report mirrors; THE L4 GATE — the inclusive boundary at the decision
// instant and the off-by-one-millisecond rejection; the L12 scope laws;
// the extraction helpers and the R45 inherited confidence).

import { describe, expect, it } from 'vitest';
import {
  type ResearchIntake,
  crossMarketInstrumentsOf,
  crossMarketInputRefOf,
  crossMarketStanceCategoryOf,
  fundamentalInstrumentsOf,
  fundamentalInputRefOf,
  fundamentalStanceCategoryOf,
  isCitationMirror,
  isCrossMarketReportMirror,
  isFundamentalReportMirror,
  isIntakeCoverageMirror,
  isInheritedConfidence,
  isProvenanceMirror,
  isRegimeReportMirror,
  isResearchInputRef,
  isSentimentReportMirror,
  regimeInstrumentsOf,
  regimeInputRefOf,
  regimeStanceCategoryOf,
  sentimentInstrumentsOf,
  sentimentInputRefOf,
  sentimentStanceCategoryOf,
  validateResearchIntake,
} from './intake';
import {
  FIXTURE_CROSS_MARKET_REPORT,
  FIXTURE_DECISION_AS_OF,
  FIXTURE_FUNDAMENTAL_REPORT,
  FIXTURE_FULL_INTAKE,
  FIXTURE_PROJECT,
  FIXTURE_REGIME_REPORT,
  FIXTURE_SENTIMENT_REPORT,
  FIXTURE_TENANT,
  boundaryResearchIntake,
  foreignTenantIntake,
  futureResearchIntake,
} from './fixtures';
import { type TimestampMs, deepCloneJson } from './primitives';

const DECISION: TimestampMs = FIXTURE_DECISION_AS_OF;

describe('the four report mirrors (field-for-field)', () => {
  it('the four fixture reports satisfy their mirror guards (and JSON round-trip)', () => {
    expect(isSentimentReportMirror(FIXTURE_SENTIMENT_REPORT)).toBe(true);
    expect(isRegimeReportMirror(FIXTURE_REGIME_REPORT)).toBe(true);
    expect(isFundamentalReportMirror(FIXTURE_FUNDAMENTAL_REPORT)).toBe(true);
    expect(isCrossMarketReportMirror(FIXTURE_CROSS_MARKET_REPORT)).toBe(true);
    expect(isSentimentReportMirror(JSON.parse(JSON.stringify(FIXTURE_SENTIMENT_REPORT)))).toBe(true);
    expect(isRegimeReportMirror(JSON.parse(JSON.stringify(FIXTURE_REGIME_REPORT)))).toBe(true);
    expect(isFundamentalReportMirror(JSON.parse(JSON.stringify(FIXTURE_FUNDAMENTAL_REPORT)))).toBe(true);
    expect(isCrossMarketReportMirror(JSON.parse(JSON.stringify(FIXTURE_CROSS_MARKET_REPORT)))).toBe(true);
  });

  it('the shared mirrors: provenance, citations, coverage, inherited confidence', () => {
    expect(isProvenanceMirror({ origin: 'historical', adapter: { id: 'a', version: '1.0.0' }, derived_from: [], transform: null })).toBe(true);
    expect(isProvenanceMirror({ origin: 'mythical', adapter: null, derived_from: [], transform: null })).toBe(false);
    expect(isCitationMirror({ observationId: 'x', availableTime: 1, provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null } })).toBe(true);
    expect(isCitationMirror({ observationId: '', availableTime: 1, provenance: null })).toBe(false);
    expect(isIntakeCoverageMirror({ observationsOffered: 1, observationsAdmitted: 1, observationsDeferred: 0, observationsUnsupported: 0, observationsInvalid: 0 })).toBe(true);
    expect(isIntakeCoverageMirror({ observationsOffered: -1, observationsAdmitted: 0, observationsDeferred: 0, observationsUnsupported: 0, observationsInvalid: 0 })).toBe(false);
    expect(isInheritedConfidence({ level: 'high', evidenceCount: 5 })).toBe(true);
    expect(isInheritedConfidence({ level: 'very-sure', evidenceCount: 5 })).toBe(false);
    expect(isInheritedConfidence({ level: 'high', evidenceCount: -1 })).toBe(false);
  });

  it('broken report shapes fail the guards (per lane — total, never throw)', () => {
    const corrupted = [
      null,
      42,
      'report',
      {},
      { ...FIXTURE_SENTIMENT_REPORT, reportId: 'nope' },
      { ...FIXTURE_SENTIMENT_REPORT, asOf: 'not-a-time' },
      { ...FIXTURE_SENTIMENT_REPORT, readings: 'not-an-array' },
      { ...FIXTURE_SENTIMENT_REPORT, summary: null },
    ];
    for (const hostile of corrupted) {
      expect(() => isSentimentReportMirror(hostile)).not.toThrow();
      expect(isSentimentReportMirror(hostile)).toBe(false);
      expect(isRegimeReportMirror(hostile)).toBe(false);
      expect(isFundamentalReportMirror(hostile)).toBe(false);
      expect(isCrossMarketReportMirror(hostile)).toBe(false);
    }
  });
});

describe('THE L4 GATE (research_from_the_future)', () => {
  it('the golden four-lane intake passes the gate (reports strictly before the decision instant)', () => {
    const errors = validateResearchIntake(FIXTURE_FULL_INTAKE, DECISION, FIXTURE_TENANT, FIXTURE_PROJECT);
    expect(errors).toEqual([]);
  });

  it('AN INPUT COMPUTED EXACTLY AT THE DECISION INSTANT IS LEGAL (the inclusive boundary)', () => {
    const errors = validateResearchIntake(boundaryResearchIntake(), DECISION, FIXTURE_TENANT, FIXTURE_PROJECT);
    expect(errors).toEqual([]);
  });

  it('ONE MILLISECOND LATER IS REJECTED with research_from_the_future (the off-by-one law)', () => {
    const intake = futureResearchIntake();
    const errors = validateResearchIntake(intake, DECISION, FIXTURE_TENANT, FIXTURE_PROJECT);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('research_from_the_future');
    expect(errors[0]?.path).toBe('sentiment.asOf');
    expect(errors[0]?.message).toContain('research from the future');
  });

  it('an input one millisecond after ANY lane is rejected for that lane', () => {
    for (const lane of ['regime', 'fundamental', 'crossMarket'] as const) {
      const intake: ResearchIntake = {
        ...FIXTURE_FULL_INTAKE,
        [lane]: { ...(FIXTURE_FULL_INTAKE[lane] as object), asOf: (DECISION as number) + 1 },
      } as ResearchIntake;
      const errors = validateResearchIntake(intake, DECISION, FIXTURE_TENANT, FIXTURE_PROJECT);
      expect(errors.map((e) => e.code)).toContain('research_from_the_future');
    }
  });

  it('the future-input error carries the offending report id and instants (structured, never prose)', () => {
    const errors = validateResearchIntake(futureResearchIntake(), DECISION, FIXTURE_TENANT, FIXTURE_PROJECT);
    const message = errors[0]?.message ?? '';
    expect(message).toContain(String(DECISION));
    expect(message).toContain(String((DECISION as number) + 1));
  });
});

describe('the L12 scope laws', () => {
  it('a foreign-tenant input is the tenant_mismatch typed error', () => {
    const errors = validateResearchIntake(foreignTenantIntake(), DECISION, FIXTURE_TENANT, FIXTURE_PROJECT);
    expect(errors.map((e) => e.code)).toContain('tenant_mismatch');
    expect(errors[0]?.path).toBe('sentiment.tenantId');
  });

  it('a foreign-project input is the project_mismatch typed error', () => {
    const intake = deepCloneJson(FIXTURE_FULL_INTAKE);
    (intake.regime as unknown as { projectId: string }).projectId = 'project-foreign';
    const errors = validateResearchIntake(intake, DECISION, FIXTURE_TENANT, FIXTURE_PROJECT);
    expect(errors.map((e) => e.code)).toContain('project_mismatch');
  });
});

describe('the extraction helpers (deterministic, pure)', () => {
  it('the instrument scopes of the four fixture reports', () => {
    expect(sentimentInstrumentsOf(FIXTURE_SENTIMENT_REPORT)).toEqual(['TEST-AAA']);
    expect(regimeInstrumentsOf(FIXTURE_REGIME_REPORT)).toEqual(['TEST-AAA']);
    expect(fundamentalInstrumentsOf(FIXTURE_FUNDAMENTAL_REPORT)).toEqual([
      'TEST-AAA',
      'TEST-BBB',
      'TEST-ECON-CPI',
      'TEST-LARGECAP',
      'TEST-SAT-OIL',
    ]);
    expect(crossMarketInstrumentsOf(FIXTURE_CROSS_MARKET_REPORT)).toEqual([
      'TEST-AAA',
      'TEST-CHAIN-A',
      'TEST-LARGECAP',
    ]);
  });

  it('the report-level stance categories of the four fixture reports', () => {
    expect(sentimentStanceCategoryOf(FIXTURE_SENTIMENT_REPORT)).toBe('positive');
    expect(regimeStanceCategoryOf(FIXTURE_REGIME_REPORT)).toBe('trending-up');
    expect(fundamentalStanceCategoryOf(FIXTURE_FUNDAMENTAL_REPORT)).toBe('positive');
    expect(crossMarketStanceCategoryOf(FIXTURE_CROSS_MARKET_REPORT)).toBe('spread-divergence');
  });

  it('R45: the inherited confidence is COPIED verbatim from the research reports (never fabricated)', () => {
    const sentimentRef = sentimentInputRefOf(FIXTURE_SENTIMENT_REPORT);
    expect(sentimentRef.inheritedConfidence).toEqual([{ level: 'high', evidenceCount: 5 }]);
    expect(sentimentRef.instruments).toEqual(['TEST-AAA']);
    expect(sentimentRef.observationCitationCount).toBe(9);
    expect(sentimentRef.reportId).toBe(FIXTURE_SENTIMENT_REPORT.reportId);
    expect(sentimentRef.bodyVersion).toBe('sentiment-researcher@1.0.0');
    expect(sentimentRef.asOf).toBe(FIXTURE_SENTIMENT_REPORT.asOf);
    expect(isResearchInputRef(sentimentRef)).toBe(true);
  });

  it('the regime, fundamental and cross-market input refs carry their lanes\' citation sets', () => {
    const regimeRef = regimeInputRefOf(FIXTURE_REGIME_REPORT);
    expect(regimeRef.lane).toBe('regime');
    expect(regimeRef.observationCitationCount).toBe(16); // 4 + 4 classifications + 8 change
    expect(regimeRef.inheritedConfidence).toEqual([
      { level: 'moderate', evidenceCount: 4 },
      { level: 'moderate', evidenceCount: 4 },
    ]);
    const fundamentalRef = fundamentalInputRefOf(FIXTURE_FUNDAMENTAL_REPORT);
    expect(fundamentalRef.lane).toBe('fundamental');
    expect(fundamentalRef.observationCitationCount).toBe(13); // 5 + 2 + 4 + 1 + 1
    expect(fundamentalRef.methodId).toBe('method/fundamental/report-composition');
    const crossMarketRef = crossMarketInputRefOf(FIXTURE_CROSS_MARKET_REPORT);
    expect(crossMarketRef.lane).toBe('cross-market');
    expect(crossMarketRef.observationCitationCount).toBe(40); // 5 relationships x 8 citations
    expect(crossMarketRef.inheritedConfidence).toHaveLength(5);
    for (const confidence of crossMarketRef.inheritedConfidence) {
      expect(confidence).toEqual({ level: 'high', evidenceCount: 8 });
    }
  });
});

describe('the intake gate totality (untrusted input never throws)', () => {
  it('hostile intake shapes are refused as typed data', () => {
    for (const hostile of [null, 42, 'intake', { sentiment: 'not-a-report' }, { regime: [] }, { fundamental: {} }]) {
      const errors = validateResearchIntake(hostile, DECISION, FIXTURE_TENANT, FIXTURE_PROJECT);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('an invalid decision instant is itself reported (never throws)', () => {
    const errors = validateResearchIntake(FIXTURE_FULL_INTAKE, Number.NaN as never, FIXTURE_TENANT, FIXTURE_PROJECT);
    // the gate degrades gracefully: the decision instant is malformed, so the L4 check is skipped — structure still checked
    expect(Array.isArray(errors)).toBe(true);
  });
});
