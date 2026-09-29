// @tradrl/body-fundamental-researcher — the deterministic fixture set.
//
// Owning Work Order: T023. Every fixture is DETERMINISTIC (no clocks, no
// randomness — literal instants and literal ids), and every fixture is
// re-validated by the real guards in the tests. The golden records are
// built through the real factories so their derived ids are honest.
//
// The violation fixtures exist for the NEGATIVE paths: an evidence-less
// assessment, a future-citation assessment, an undeclared-method
// assessment, a kind-mismatched assessment, a stance inconsistent with
// its own declared decision function, an implication off the declared
// action table, a tampered record, a body spec edited to grant execution
// authority, a body spec citing a model identity as evaluation evidence
// — each must FAIL validation with its typed code (the acceptance
// criteria).
//
// (Type note: fixture literals are authored as plain records and cast to
// the branded contract types once — the brands are compile-time only.)

import { type TimestampMs, deepFreeze } from './primitives';
import { type BodyVersionRef, type EvaluationCriteriaRef, type FundamentalMethodId, type FundamentalMethodVersionRef, type ProjectId, type TenantId, type TopicName, type ToolRef } from './ids';
import { type FundamentalObservation, type MacroReleaseObservation, type FundamentalDatumObservation, type CorporateActionObservation, type ObservationProvenance } from './observations';
import { type ObservationCitation } from './assessment';
import { type FundamentalAssessment, createFundamentalAssessment } from './assessment';
import { type CorporateActionDigest, createCorporateActionDigest } from './action-digest';
import { type FundamentalResearchReport, createFundamentalResearchReport, type CoverageAccounting, type FundamentalDataGap } from './report';
import {
  FUNDAMENTAL_RESEARCHER_BODY,
  type FundamentalResearcherBodySpec,
} from './body';
import {
  type FundamentalMethodRegistry,
  FUNDAMENTAL_METHOD_REGISTRY,
  FUNDAMENTAL_VALUATION_METHOD,
  FUNDAMENTAL_MACRO_SURPRISE_METHOD,
  FUNDAMENTAL_HEALTH_METHOD,
  FUNDAMENTAL_CORPORATE_ACTION_METHOD,
  FUNDAMENTAL_CONFIDENCE_METHOD,
  FUNDAMENTAL_REPORT_COMPOSITION_METHOD,
} from './methods';

// ---------------------------------------------------------------------------
// The fixture world (literal instants — no ambient clock anywhere)
// ---------------------------------------------------------------------------

/**
 * The fixture epoch anchor (2024-06-03T14:00:00Z — a Monday inside the
 * declared US regular session, matching the equities adapter suite).
 */
export const FIXTURE_AT0: TimestampMs = 1_717_423_200_000 as TimestampMs;

/** The fixture as-of instant: one minute after the anchor. */
export const FIXTURE_AS_OF: TimestampMs = (1_717_423_200_000 + 60_000) as TimestampMs;

/** The fixture tenant (L12). */
export const FIXTURE_TENANT: TenantId = 'tenant-research' as TenantId;

/** The fixture project (L12). */
export const FIXTURE_PROJECT: ProjectId = 'project-fundamental' as ProjectId;

/** The fixture run seed (lineage material — L9). */
export const FIXTURE_SEED = 'seed/fundamental/fixture-1';

/** The fixture body-version reference. */
export const FIXTURE_BODY_VERSION: BodyVersionRef = 'fundamental-researcher@1.0.0' as BodyVersionRef;

/** The fixture publishing instance (an agent-os AgentInstanceId shape). */
export const FIXTURE_SENDER = 'agent-instance-fundamental-0001';

/** The fixture publication topic (an organization topic — never kernel.*). */
export const FIXTURE_TOPIC = 'research.fundamental';

/** Casts a literal epoch-millisecond number to `TimestampMs` (fixture discipline). */
const ms = (value: number): TimestampMs => value as TimestampMs;

/** The historical provenance block every fixture observation carries. */
export const FIXTURE_PROVENANCE: ObservationProvenance = deepFreeze({
  origin: 'historical',
  adapter: { id: 'adapter-equities', version: '1.0.0' },
  derived_from: [],
  transform: null,
} as ObservationProvenance);

/** The historical provenance block of the alt-data vendor lane. */
export const FIXTURE_ALTDATA_PROVENANCE: ObservationProvenance = deepFreeze({
  origin: 'historical',
  adapter: { id: 'adapter-altdata', version: '1.0.0' },
  derived_from: [],
  transform: null,
} as ObservationProvenance);

// ---------------------------------------------------------------------------
// Observation fixtures (quartets + provenance; T038 emitter shapes)
// ---------------------------------------------------------------------------

/** Builds a canonical reported-fundamental observation fixture (quartet + provenance). */
export function fixtureFundamentalObservation(input: {
  readonly eventId: string;
  readonly at: TimestampMs;
  readonly instrument: string;
  readonly assetClass?: 'index' | 'commodity' | 'equity';
  readonly venue?: string;
  readonly field: string;
  readonly period: string;
  readonly value: string;
  readonly sequence?: number;
}): FundamentalDatumObservation {
  return deepFreeze({
    event_id: input.eventId,
    venue: input.venue ?? 'LICENSED-INDEX-A',
    instrument: input.instrument,
    asset_class: input.assetClass ?? 'index',
    event_type: 'fundamental',
    event_time: input.at,
    source_time: input.at,
    available_time: input.at,
    ingestion_time: ms((input.at as number) + 1_000),
    sequence: input.sequence ?? 1,
    provider: 'licensed-index-a',
    provenance: FIXTURE_PROVENANCE,
    payload: deepFreeze(
      input.field === 'INDEX_LEVEL'
        ? { field: input.field, period: input.period, value: input.value, unit: 'index-points', source: 'index-dissemination' }
        : { field: input.field, period: input.period, value: input.value },
    ),
  });
}

/** Builds a canonical economic-series macro-release observation fixture. */
export function fixtureMacroObservation(input: {
  readonly eventId: string;
  readonly at: TimestampMs;
  readonly instrument: string;
  readonly indicator?: string;
  readonly region?: string;
  readonly period: string;
  readonly actual: string;
  readonly forecast?: string;
  readonly prior?: string;
  readonly sequence?: number;
}): MacroReleaseObservation {
  return deepFreeze({
    event_id: input.eventId,
    venue: 'ECON-VENDOR',
    instrument: input.instrument,
    asset_class: 'macro',
    event_type: 'macro_release',
    event_time: input.at,
    source_time: null,
    available_time: input.at,
    ingestion_time: ms((input.at as number) + 1_000),
    sequence: input.sequence ?? 1,
    provider: 'alt-data-vendor-a',
    provenance: FIXTURE_ALTDATA_PROVENANCE,
    payload: deepFreeze({
      indicator: input.indicator ?? input.instrument,
      region: input.region ?? 'US',
      period: input.period,
      actual: input.actual,
      ...(input.forecast !== undefined ? { forecast: input.forecast } : {}),
      ...(input.prior !== undefined ? { prior: input.prior } : {}),
      unit: '%',
    }),
  });
}

/** Builds a canonical corporate-action observation fixture (the escape-hatch shape). */
export function fixtureActionObservation(input: {
  readonly eventId: string;
  readonly at: TimestampMs;
  readonly instrument: string;
  readonly action: 'split' | 'cash_dividend' | 'merger';
  readonly effectiveDate: string;
  readonly ratio: string;
  readonly currency?: string;
  readonly sequence?: number;
}): CorporateActionObservation {
  return deepFreeze({
    event_id: input.eventId,
    venue: 'LICENSED-INDEX-A',
    instrument: input.instrument,
    asset_class: 'equity',
    event_type: 'other',
    event_time: input.at,
    source_time: input.at,
    available_time: input.at,
    ingestion_time: ms((input.at as number) + 1_000),
    sequence: input.sequence ?? 1,
    provider: 'licensed-index-a',
    provenance: FIXTURE_PROVENANCE,
    payload: deepFreeze({
      kind: 'corporate_action',
      data: deepFreeze({
        symbol: input.instrument,
        action: input.action,
        effective_date: input.effectiveDate,
        ratio: input.ratio,
        currency: input.currency ?? 'USD',
      }),
    }),
  });
}

/**
 * THE GOLDEN OBSERVATION SET: five reported index levels for TEST-LARGECAP
 * (the latest extended above its trailing mean — a 'positive' valuation
 * reading), two economic releases for TEST-ECON-CPI (both above consensus —
 * a 'positive' macro surprise), four health-series observations for
 * TEST-SAT-OIL (a rising rig count — a 'positive' health trend), two
 * corporate actions (a TEST-AAA split and a TEST-BBB cash dividend), and
 * one out-of-method fundamental series (the unassessed-series data gap).
 */
export const FIXTURE_OBSERVATIONS: readonly FundamentalObservation[] = deepFreeze([
  fixtureFundamentalObservation({ eventId: 'obs-fund-001', at: FIXTURE_AT0, instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '100.0000', sequence: 1 }),
  fixtureFundamentalObservation({ eventId: 'obs-fund-002', at: ms(1_717_423_200_000 + 1_000), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '101.0000', sequence: 2 }),
  fixtureFundamentalObservation({ eventId: 'obs-fund-003', at: ms(1_717_423_200_000 + 2_000), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '100.5000', sequence: 3 }),
  fixtureFundamentalObservation({ eventId: 'obs-fund-004', at: ms(1_717_423_200_000 + 3_000), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '100.7500', sequence: 4 }),
  fixtureFundamentalObservation({ eventId: 'obs-fund-005', at: ms(1_717_423_200_000 + 4_000), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '103.0000', sequence: 5 }),
  fixtureMacroObservation({ eventId: 'obs-macro-001', at: FIXTURE_AT0, instrument: 'TEST-ECON-CPI', period: '2024-04', actual: '3.4', forecast: '3.2', prior: '3.4', sequence: 1 }),
  fixtureMacroObservation({ eventId: 'obs-macro-002', at: ms(1_717_423_200_000 + 1_000), instrument: 'TEST-ECON-CPI', period: '2024-05', actual: '3.3', forecast: '3.25', prior: '3.4', sequence: 2 }),
  fixtureFundamentalObservation({ eventId: 'obs-health-001', at: FIXTURE_AT0, instrument: 'TEST-SAT-OIL', assetClass: 'commodity', venue: 'SAT-VENDOR', field: 'ACTIVE_RIG_COUNT', period: '2024-W22', value: '100.0000', sequence: 1 }),
  fixtureFundamentalObservation({ eventId: 'obs-health-002', at: ms(1_717_423_200_000 + 1_000), instrument: 'TEST-SAT-OIL', assetClass: 'commodity', venue: 'SAT-VENDOR', field: 'ACTIVE_RIG_COUNT', period: '2024-W23', value: '102.0000', sequence: 2 }),
  fixtureFundamentalObservation({ eventId: 'obs-health-003', at: ms(1_717_423_200_000 + 2_000), instrument: 'TEST-SAT-OIL', assetClass: 'commodity', venue: 'SAT-VENDOR', field: 'ACTIVE_RIG_COUNT', period: '2024-W24', value: '105.0000', sequence: 3 }),
  fixtureFundamentalObservation({ eventId: 'obs-health-004', at: ms(1_717_423_200_000 + 3_000), instrument: 'TEST-SAT-OIL', assetClass: 'commodity', venue: 'SAT-VENDOR', field: 'ACTIVE_RIG_COUNT', period: '2024-W25', value: '108.0000', sequence: 4 }),
  fixtureActionObservation({ eventId: 'obs-action-001', at: ms(1_717_423_200_000 + 10_000), instrument: 'TEST-AAA', action: 'split', effectiveDate: '2024-06-10', ratio: '4:1' }),
  fixtureActionObservation({ eventId: 'obs-action-002', at: ms(1_717_423_200_000 + 11_000), instrument: 'TEST-BBB', action: 'cash_dividend', effectiveDate: '2024-06-17', ratio: '1:4' }),
  fixtureFundamentalObservation({ eventId: 'obs-fund-101', at: FIXTURE_AT0, instrument: 'TEST-MIDCAP', field: 'MISC_METRIC', period: '2024-06-03', value: '12.5000', sequence: 1 }),
]);

/** Citations for the five index-level observations (the valuation evidence set). */
export const FIXTURE_VALUATION_CITATIONS: readonly ObservationCitation[] = deepFreeze([
  { observationId: 'obs-fund-001', availableTime: FIXTURE_AT0, provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-fund-002', availableTime: ms(1_717_423_200_000 + 1_000), provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-fund-003', availableTime: ms(1_717_423_200_000 + 2_000), provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-fund-004', availableTime: ms(1_717_423_200_000 + 3_000), provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-fund-005', availableTime: ms(1_717_423_200_000 + 4_000), provenance: FIXTURE_PROVENANCE },
]);

/** Citations for the two macro releases (the surprise evidence set). */
export const FIXTURE_MACRO_CITATIONS: readonly ObservationCitation[] = deepFreeze([
  { observationId: 'obs-macro-001', availableTime: FIXTURE_AT0, provenance: FIXTURE_ALTDATA_PROVENANCE },
  { observationId: 'obs-macro-002', availableTime: ms(1_717_423_200_000 + 1_000), provenance: FIXTURE_ALTDATA_PROVENANCE },
]);

/** Citations for the four health observations (the trend evidence set). */
export const FIXTURE_HEALTH_CITATIONS: readonly ObservationCitation[] = deepFreeze([
  { observationId: 'obs-health-001', availableTime: FIXTURE_AT0, provenance: FIXTURE_ALTDATA_PROVENANCE },
  { observationId: 'obs-health-002', availableTime: ms(1_717_423_200_000 + 1_000), provenance: FIXTURE_ALTDATA_PROVENANCE },
  { observationId: 'obs-health-003', availableTime: ms(1_717_423_200_000 + 2_000), provenance: FIXTURE_ALTDATA_PROVENANCE },
  { observationId: 'obs-health-004', availableTime: ms(1_717_423_200_000 + 3_000), provenance: FIXTURE_ALTDATA_PROVENANCE },
]);

// ---------------------------------------------------------------------------
// Golden output fixtures (built through the real factories)
// ---------------------------------------------------------------------------

function buildGoldenValuationAssessment(): FundamentalAssessment {
  const construction = createFundamentalAssessment(
    {
      scope: { instrument: 'TEST-LARGECAP', series: 'INDEX_LEVEL' },
      assessmentKind: 'valuation-level',
      stance: {
        methodId: FUNDAMENTAL_VALUATION_METHOD.methodId,
        methodVersion: FUNDAMENTAL_VALUATION_METHOD.version,
        direction: 'positive',
        score: '0.0242',
      },
      confidence: {
        methodId: FUNDAMENTAL_CONFIDENCE_METHOD.methodId,
        methodVersion: FUNDAMENTAL_CONFIDENCE_METHOD.version,
        level: 'high',
        evidenceCount: 5,
        dispersion: '0.0291',
      },
      evidence: FIXTURE_VALUATION_CITATIONS,
      asOf: FIXTURE_AS_OF,
      bodyVersion: FIXTURE_BODY_VERSION,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
    },
    FUNDAMENTAL_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden valuation assessment must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

function buildGoldenMacroAssessment(): FundamentalAssessment {
  const construction = createFundamentalAssessment(
    {
      scope: { instrument: 'TEST-ECON-CPI', series: 'TEST-ECON-CPI' },
      assessmentKind: 'macro-surprise',
      stance: {
        methodId: FUNDAMENTAL_MACRO_SURPRISE_METHOD.methodId,
        methodVersion: FUNDAMENTAL_MACRO_SURPRISE_METHOD.version,
        direction: 'positive',
        score: '0.0390',
      },
      confidence: {
        methodId: FUNDAMENTAL_CONFIDENCE_METHOD.methodId,
        methodVersion: FUNDAMENTAL_CONFIDENCE_METHOD.version,
        level: 'moderate',
        evidenceCount: 2,
        dispersion: '0.0294',
      },
      evidence: FIXTURE_MACRO_CITATIONS,
      asOf: FIXTURE_AS_OF,
      bodyVersion: FIXTURE_BODY_VERSION,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
    },
    FUNDAMENTAL_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden macro assessment must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

function buildGoldenHealthAssessment(): FundamentalAssessment {
  const construction = createFundamentalAssessment(
    {
      scope: { instrument: 'TEST-SAT-OIL', series: 'ACTIVE_RIG_COUNT' },
      assessmentKind: 'health-indicator',
      stance: {
        methodId: FUNDAMENTAL_HEALTH_METHOD.methodId,
        methodVersion: FUNDAMENTAL_HEALTH_METHOD.version,
        direction: 'positive',
        score: '0.0800',
      },
      confidence: {
        methodId: FUNDAMENTAL_CONFIDENCE_METHOD.methodId,
        methodVersion: FUNDAMENTAL_CONFIDENCE_METHOD.version,
        level: 'moderate',
        evidenceCount: 4,
        dispersion: '0.0741',
      },
      evidence: FIXTURE_HEALTH_CITATIONS,
      asOf: FIXTURE_AS_OF,
      bodyVersion: FIXTURE_BODY_VERSION,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
    },
    FUNDAMENTAL_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden health assessment must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

function buildGoldenSplitDigest(): CorporateActionDigest {
  const construction = createCorporateActionDigest(
    {
      action: 'split',
      instruments: ['TEST-AAA'],
      venues: ['LICENSED-INDEX-A'],
      window: { from: ms(1_717_423_200_000 + 10_000), to: ms(1_717_423_200_000 + 10_000) },
      observationCount: 1,
      implication: 'neutral',
      evidence: deepFreeze([
        { observationId: 'obs-action-001', availableTime: ms(1_717_423_200_000 + 10_000), provenance: FIXTURE_PROVENANCE },
      ]),
      asOf: FIXTURE_AS_OF,
      methodId: FUNDAMENTAL_CORPORATE_ACTION_METHOD.methodId,
      methodVersion: FUNDAMENTAL_CORPORATE_ACTION_METHOD.version,
      bodyVersion: FIXTURE_BODY_VERSION,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
    },
    FUNDAMENTAL_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden split digest must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

function buildGoldenDividendDigest(): CorporateActionDigest {
  const construction = createCorporateActionDigest(
    {
      action: 'cash_dividend',
      instruments: ['TEST-BBB'],
      venues: ['LICENSED-INDEX-A'],
      window: { from: ms(1_717_423_200_000 + 11_000), to: ms(1_717_423_200_000 + 11_000) },
      observationCount: 1,
      implication: 'positive',
      evidence: deepFreeze([
        { observationId: 'obs-action-002', availableTime: ms(1_717_423_200_000 + 11_000), provenance: FIXTURE_PROVENANCE },
      ]),
      asOf: FIXTURE_AS_OF,
      methodId: FUNDAMENTAL_CORPORATE_ACTION_METHOD.methodId,
      methodVersion: FUNDAMENTAL_CORPORATE_ACTION_METHOD.version,
      bodyVersion: FIXTURE_BODY_VERSION,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
    },
    FUNDAMENTAL_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden dividend digest must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

/** The golden valuation assessment (deterministic id, deeply frozen). */
export const FIXTURE_VALUATION_ASSESSMENT: FundamentalAssessment = buildGoldenValuationAssessment();

/** The golden macro-surprise assessment (deterministic id, deeply frozen). */
export const FIXTURE_MACRO_ASSESSMENT: FundamentalAssessment = buildGoldenMacroAssessment();

/** The golden health assessment (deterministic id, deeply frozen). */
export const FIXTURE_HEALTH_ASSESSMENT: FundamentalAssessment = buildGoldenHealthAssessment();

/** The golden corporate-action digests (split + cash dividend). */
export const FIXTURE_ACTION_DIGESTS: readonly CorporateActionDigest[] = deepFreeze([
  buildGoldenSplitDigest(),
  buildGoldenDividendDigest(),
]);

/** The golden coverage accounting: fourteen offered, fourteen admitted, nothing dropped. */
export const FIXTURE_COVERAGE: CoverageAccounting = deepFreeze({
  observationsOffered: 14,
  observationsAdmitted: 14,
  observationsDeferred: 0,
  observationsUnsupported: 0,
  observationsInvalid: 0,
});

/** The golden data gaps (one out-of-method fundamental series). */
export const FIXTURE_DATA_GAPS: readonly FundamentalDataGap[] = deepFreeze([
  { kind: 'unassessed-series', instrument: 'TEST-MIDCAP', series: 'MISC_METRIC' },
] as readonly FundamentalDataGap[]);

function buildGoldenReport(): FundamentalResearchReport {
  const assessments = [FIXTURE_VALUATION_ASSESSMENT, FIXTURE_MACRO_ASSESSMENT, FIXTURE_HEALTH_ASSESSMENT];
  const construction = createFundamentalResearchReport(
    {
      asOf: FIXTURE_AS_OF,
      bodyVersion: FIXTURE_BODY_VERSION,
      methodId: FUNDAMENTAL_REPORT_COMPOSITION_METHOD.methodId,
      methodVersion: FUNDAMENTAL_REPORT_COMPOSITION_METHOD.version,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
      assessments,
      actionDigests: FIXTURE_ACTION_DIGESTS,
      summary: {
        assessmentCount: 3,
        actionDigestCount: 2,
        instrumentCount: 5,
        dominantStance: 'positive',
        meanStanceScore: '0.0477',
        coverage: FIXTURE_COVERAGE,
        dataGaps: FIXTURE_DATA_GAPS,
      },
    },
    FUNDAMENTAL_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden report must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

/** The golden fundamental research report (deterministic id, deeply frozen). */
export const FIXTURE_REPORT: FundamentalResearchReport = buildGoldenReport();

// ---------------------------------------------------------------------------
// Violation fixtures (the negative paths — each MUST fail validation)
// ---------------------------------------------------------------------------

/** An assessment draft with NO evidence (the evidence law). */
export function evidenceLessAssessmentDraft(): Omit<FundamentalAssessment, 'assessmentId'> {
  return {
    ...FIXTURE_VALUATION_ASSESSMENT,
    evidence: [],
  };
}

/** An assessment draft citing an observation available AFTER the as-of instant (the L4 law). */
export function futureCitationAssessmentDraft(): Omit<FundamentalAssessment, 'assessmentId'> {
  return {
    ...FIXTURE_VALUATION_ASSESSMENT,
    evidence: [
      ...FIXTURE_VALUATION_CITATIONS,
      { observationId: 'obs-future-999', availableTime: ms(1_717_423_200_000 + 70_000), provenance: FIXTURE_PROVENANCE },
    ],
  };
}

/** An assessment draft citing an UNDECLARED method (the method-honesty law). */
export function undeclaredMethodAssessmentDraft(): Omit<FundamentalAssessment, 'assessmentId'> {
  return {
    ...FIXTURE_VALUATION_ASSESSMENT,
    stance: {
      methodId: 'method/fundamental/magic-number' as FundamentalMethodId,
      methodVersion: '1.0.0' as FundamentalMethodVersionRef,
      direction: 'positive',
      score: '0.9000',
    },
  };
}

/** An assessment draft citing the declared method at a STALE version. */
export function staleMethodVersionAssessmentDraft(): Omit<FundamentalAssessment, 'assessmentId'> {
  return {
    ...FIXTURE_VALUATION_ASSESSMENT,
    stance: {
      ...FIXTURE_VALUATION_ASSESSMENT.stance,
      methodVersion: '0.9.0' as FundamentalMethodVersionRef,
    },
  };
}

/** An assessment draft whose confidence cites the VALUATION method (kind mismatch). */
export function wrongKindMethodAssessmentDraft(): Omit<FundamentalAssessment, 'assessmentId'> {
  return {
    ...FIXTURE_VALUATION_ASSESSMENT,
    confidence: {
      ...FIXTURE_VALUATION_ASSESSMENT.confidence,
      methodId: FUNDAMENTAL_VALUATION_METHOD.methodId,
      methodVersion: FUNDAMENTAL_VALUATION_METHOD.version,
    },
  };
}

/** An assessment draft whose kind disagrees with the cited method's declared assessment kind. */
export function kindMismatchAssessmentDraft(): Omit<FundamentalAssessment, 'assessmentId'> {
  return {
    ...FIXTURE_VALUATION_ASSESSMENT,
    assessmentKind: 'macro-surprise',
  };
}

/** An assessment draft whose stance direction contradicts the declared decision function. */
export function stanceInconsistentAssessmentDraft(): Omit<FundamentalAssessment, 'assessmentId'> {
  return {
    ...FIXTURE_VALUATION_ASSESSMENT,
    stance: {
      ...FIXTURE_VALUATION_ASSESSMENT.stance,
      direction: 'negative',
    },
  };
}

/** An assessment draft missing tenant/project (the L12 law). */
export function tenantlessAssessmentDraft(): Omit<FundamentalAssessment, 'assessmentId'> {
  return {
    ...FIXTURE_VALUATION_ASSESSMENT,
    tenantId: '' as TenantId,
    projectId: '' as ProjectId,
  };
}

/** An assessment draft with DUPLICATE observation citations. */
export function duplicateEvidenceAssessmentDraft(): Omit<FundamentalAssessment, 'assessmentId'> {
  return {
    ...FIXTURE_VALUATION_ASSESSMENT,
    evidence: [...FIXTURE_VALUATION_CITATIONS, FIXTURE_VALUATION_CITATIONS[0]],
  };
}

/** A digest draft whose implication is OFF the declared action table. */
export function wrongImplicationActionDigestDraft(): Omit<CorporateActionDigest, 'digestId'> {
  return {
    ...FIXTURE_ACTION_DIGESTS[0],
    implication: 'positive',
  };
}

/** A body spec edited to GRANT execution authority (the L8 trip-wire). */
export function executionGrantedBodySpec(): FundamentalResearcherBodySpec {
  return {
    ...FUNDAMENTAL_RESEARCHER_BODY,
    bodyVersion: {
      ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary,
          allowedActions: [...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary.allowedActions, 'EXECUTE'],
        },
      },
    },
  };
}

/** A body spec whose execution authority is NOT 'none' (the L8 trip-wire). */
export function externalGatewayBodySpec(): FundamentalResearcherBodySpec {
  return {
    ...FUNDAMENTAL_RESEARCHER_BODY,
    bodyVersion: {
      ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary,
          executionAuthority: 'external-gateway-only',
        },
      },
    },
  };
}

/** A body spec that does NOT explicitly prohibit EXECUTE (the L8 trip-wire). */
export function executeNotProhibitedBodySpec(): FundamentalResearcherBodySpec {
  return {
    ...FUNDAMENTAL_RESEARCHER_BODY,
    bodyVersion: {
      ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary,
          prohibitedActions: FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary.prohibitedActions.filter(
            (action) => action !== 'EXECUTE',
          ),
        },
      },
    },
  };
}

/** A body spec whose authority-scope record was edited off the law (the L8 trip-wire). */
export function editedAuthorityScopeBodySpec(): FundamentalResearcherBodySpec {
  return {
    ...FUNDAMENTAL_RESEARCHER_BODY,
    research: {
      ...FUNDAMENTAL_RESEARCHER_BODY.research,
      authorityScope: {
        scope: 'observation-research-publication',
        execution: 'external-gateway-only',
        orderPlacement: 'prohibited',
        consequentialActions: 'prohibited',
      },
    },
  } as unknown as FundamentalResearcherBodySpec;
}

/** A body spec citing a MODEL IDENTITY as evaluation evidence (the L16a trip-wire). */
export function modelIdentityEvidenceBodySpec(): FundamentalResearcherBodySpec {
  return {
    ...FUNDAMENTAL_RESEARCHER_BODY,
    research: {
      ...FUNDAMENTAL_RESEARCHER_BODY.research,
      evaluationCriteriaRefs: ['acme-models/reasoner-2@2026.03' as EvaluationCriteriaRef],
    },
  };
}

/** A body spec whose procedure cites a CONSEQUENTIAL tool (the L8 trip-wire). */
export function consequentialToolBodySpec(): FundamentalResearcherBodySpec {
  return {
    ...FUNDAMENTAL_RESEARCHER_BODY,
    bodyVersion: {
      ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition,
        knowledgeToolPolicy: {
          ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition.knowledgeToolPolicy,
          allowedTools: [
            ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition.knowledgeToolPolicy.allowedTools,
            'tools/order-entry' as ToolRef,
          ],
        },
        procedures: FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition.procedures.map((procedure) => ({
          ...procedure,
          steps: procedure.steps.map((step) =>
            step.id === 'publish'
              ? { ...step, toolRefs: [...step.toolRefs, 'tools/order-entry' as ToolRef] }
              : step,
          ),
        })),
      },
    },
  };
}

/** A body spec with a NON-RESEARCH capability category (the L8 declaration). */
export function nonResearchCapabilityBodySpec(): FundamentalResearcherBodySpec {
  return {
    ...FUNDAMENTAL_RESEARCHER_BODY,
    bodyVersion: {
      ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition,
        capabilities: FUNDAMENTAL_RESEARCHER_BODY.bodyVersion.composition.capabilities.map((capability) =>
          capability.id === 'research-publication' ? { ...capability, category: 'execution' } : capability,
        ),
      },
    },
  };
}

/** A body spec publishing to a RESERVED kernel topic. */
export function reservedTopicBodySpec(): FundamentalResearcherBodySpec {
  return {
    ...FUNDAMENTAL_RESEARCHER_BODY,
    research: {
      ...FUNDAMENTAL_RESEARCHER_BODY.research,
      publicationTopic: 'kernel.approve' as TopicName,
    },
  };
}

/** A registry the golden outputs cite (re-exported for tests). */
export const FIXTURE_REGISTRY: FundamentalMethodRegistry = FUNDAMENTAL_METHOD_REGISTRY;
