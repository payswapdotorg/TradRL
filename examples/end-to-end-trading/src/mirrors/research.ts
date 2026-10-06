// @tradrl/example-e2e-trading — STRUCTURAL MIRRORS of the four research
// bodies' report shapes (T021 sentiment, T022 regime, T023 fundamental,
// T026 cross-market) as consumed by the Trading Director's intake (T024).
//
// D-003/D-004 law: this module imports NOTHING outside the example tree.
// Every field below is re-declared field-for-field from the owning lanes;
// the interop trip-wire tests assert the REAL research bodies' guards
// accept these records (mutual guard acceptance).

import {
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
  isArrayOf,
  isMemberOf,
  isNonNegativeInteger,
} from '../primitives';
import { isBodyVersionRefMirror } from './agent-body';
import { type TenantId, type ProjectId, isTenantId, isProjectId } from '../ids';

// ---------------------------------------------------------------------------
// Shared intake blocks (mirror of T024's intake.ts)
// ---------------------------------------------------------------------------

export const EVENT_ORIGINS_MIRROR = ['historical', 'simulated', 'generated'] as const;
export type EventOriginMirror = (typeof EVENT_ORIGINS_MIRROR)[number];

export interface AdapterRefMirror {
  readonly id: string;
  readonly version: string;
}

export interface ProvenanceMirror {
  readonly origin: EventOriginMirror;
  readonly adapter: AdapterRefMirror | null;
  readonly derived_from: readonly string[];
  readonly transform: string | null;
}

export const CONFIDENCE_LEVELS_MIRROR = ['low', 'moderate', 'high'] as const;
export type ConfidenceLevelMirror = (typeof CONFIDENCE_LEVELS_MIRROR)[number];

export interface InheritedConfidenceMirror {
  readonly level: ConfidenceLevelMirror;
  readonly evidenceCount: number;
}

export interface IntakeCoverageMirror {
  readonly observationsOffered: number;
  readonly observationsAdmitted: number;
  readonly observationsDeferred: number;
  readonly observationsUnsupported: number;
  readonly observationsInvalid: number;
}

export interface MethodCitedAssessmentMirror {
  readonly methodId: string;
  readonly methodVersion: string;
}

export interface CitationMirror {
  readonly observationId: string;
  readonly availableTime: number;
  readonly provenance: ProvenanceMirror;
}

// ---------------------------------------------------------------------------
// LANE 1 — Sentiment (T021)
// ---------------------------------------------------------------------------

export const POLARITY_DIRECTIONS_MIRROR = ['positive', 'negative', 'neutral', 'mixed'] as const;
export type PolarityDirectionMirror = (typeof POLARITY_DIRECTIONS_MIRROR)[number];

export const INTENSITY_LEVELS_MIRROR = ['low', 'moderate', 'high'] as const;
export type IntensityLevelMirror = (typeof INTENSITY_LEVELS_MIRROR)[number];

export const EVENT_KINDS_MIRROR = [
  'earnings-announcement',
  'guidance-change',
  'regulatory-action',
  'product-announcement',
  'partnership',
  'security-incident',
  'macro-release',
  'sentiment-spike',
  'supply-disruption',
  'coverage-burst',
] as const;
export type EventKindMirror = (typeof EVENT_KINDS_MIRROR)[number];

export interface SentimentScopeMirror {
  readonly instrument: string;
  readonly venue: string;
}

export interface PolarityAssessmentMirror extends MethodCitedAssessmentMirror {
  readonly direction: PolarityDirectionMirror;
  readonly score: string;
}

export interface IntensityAssessmentMirror extends MethodCitedAssessmentMirror {
  readonly level: IntensityLevelMirror;
  readonly score: string;
}

export interface ConfidenceAssessmentMirror extends MethodCitedAssessmentMirror {
  readonly level: ConfidenceLevelMirror;
  readonly evidenceCount: number;
  readonly dispersion: string | null;
}

export interface SentimentReadingMirror {
  readonly readingId: string;
  readonly scope: SentimentScopeMirror;
  readonly polarity: PolarityAssessmentMirror;
  readonly intensity: IntensityAssessmentMirror;
  readonly confidence: ConfidenceAssessmentMirror;
  readonly evidence: readonly CitationMirror[];
  readonly asOf: number;
  readonly bodyVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface EventWindowMirror {
  readonly from: number;
  readonly to: number;
}

export interface EventDigestMirror {
  readonly digestId: string;
  readonly kind: EventKindMirror;
  readonly instruments: readonly string[];
  readonly venues: readonly string[];
  readonly window: EventWindowMirror;
  readonly observationCount: number;
  readonly evidence: readonly CitationMirror[];
  readonly asOf: number;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly bodyVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface SentimentDataGapMirror {
  readonly kind: string;
  readonly instrument: string;
}

export interface SentimentSummaryMirror {
  readonly readingCount: number;
  readonly digestCount: number;
  readonly instrumentCount: number;
  readonly dominantPolarity: string;
  readonly meanPolarityScore: string | null;
  readonly coverage: IntakeCoverageMirror;
  readonly dataGaps: readonly SentimentDataGapMirror[];
}

export interface SentimentReportMirror {
  readonly reportId: string; // 'rr-'-prefixed
  readonly asOf: number;
  readonly bodyVersion: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly readings: readonly SentimentReadingMirror[];
  readonly digests: readonly EventDigestMirror[];
  readonly summary: SentimentSummaryMirror;
}

// ---------------------------------------------------------------------------
// LANE 2 — Regime (T022)
// ---------------------------------------------------------------------------

export interface RegimeScopeMirror {
  readonly instrument: string;
  readonly venue: string;
}

export interface RegimeWindowMirror {
  readonly from: number;
  readonly to: number;
}

export interface RegimeConfidenceMirror extends MethodCitedAssessmentMirror {
  readonly level: ConfidenceLevelMirror;
  readonly evidenceCount: number;
  readonly dispersion: string | null;
}

export interface RegimeClassificationMirror {
  readonly classificationId: string;
  readonly scope: RegimeScopeMirror;
  readonly label: string;
  readonly netMoveRatio: string;
  readonly meanAbsChangeRatio: string;
  readonly window: RegimeWindowMirror;
  readonly observationCount: number;
  readonly evidence: readonly CitationMirror[];
  readonly confidence: RegimeConfidenceMirror;
  readonly asOf: number;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly bodyVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface RegimeChangeMirror {
  readonly changeId: string;
  readonly scope: RegimeScopeMirror;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly fromWindow: RegimeWindowMirror;
  readonly toWindow: RegimeWindowMirror;
  readonly detectionInstant: number;
  readonly evidence: readonly CitationMirror[];
  readonly asOf: number;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly bodyVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface RegimeDataGapMirror {
  readonly kind: string;
  readonly instrument: string;
}

export interface RegimeSummaryMirror {
  readonly classificationCount: number;
  readonly changeCount: number;
  readonly instrumentCount: number;
  readonly windowCount: number;
  readonly dominantRegime: string;
  readonly meanNetMoveRatio: string | null;
  readonly coverage: IntakeCoverageMirror;
  readonly dataGaps: readonly RegimeDataGapMirror[];
}

export interface RegimeReportMirror {
  readonly reportId: string; // 'rr-'-prefixed
  readonly asOf: number;
  readonly bodyVersion: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly classifications: readonly RegimeClassificationMirror[];
  readonly changes: readonly RegimeChangeMirror[];
  readonly summary: RegimeSummaryMirror;
}

// ---------------------------------------------------------------------------
// LANE 3 — Fundamental (T023)
// ---------------------------------------------------------------------------

export const ASSESSMENT_KINDS_MIRROR = ['valuation-level', 'macro-surprise', 'health-indicator'] as const;
export type AssessmentKindMirror = (typeof ASSESSMENT_KINDS_MIRROR)[number];

export const STANCE_DIRECTIONS_MIRROR = ['positive', 'negative', 'neutral'] as const;
export type StanceDirectionMirror = (typeof STANCE_DIRECTIONS_MIRROR)[number];

export const CORPORATE_ACTION_KINDS_MIRROR = ['split', 'cash_dividend', 'merger'] as const;
export type CorporateActionKindMirror = (typeof CORPORATE_ACTION_KINDS_MIRROR)[number];

export const IMPLICATION_STANCES_MIRROR = ['positive', 'negative', 'neutral', 'mixed'] as const;
export type ImplicationStanceMirror = (typeof IMPLICATION_STANCES_MIRROR)[number];

export interface AssessmentScopeMirror {
  readonly instrument: string;
  readonly series: string;
}

export interface StanceAssessmentMirror extends MethodCitedAssessmentMirror {
  readonly direction: StanceDirectionMirror;
  readonly score: string;
}

export interface FundamentalAssessmentMirror {
  readonly assessmentId: string;
  readonly scope: AssessmentScopeMirror;
  readonly assessmentKind: AssessmentKindMirror;
  readonly stance: StanceAssessmentMirror;
  readonly confidence: ConfidenceAssessmentMirror;
  readonly evidence: readonly CitationMirror[];
  readonly asOf: number;
  readonly bodyVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface ActionWindowMirror {
  readonly from: number;
  readonly to: number;
}

export interface CorporateActionDigestMirror {
  readonly digestId: string;
  readonly action: CorporateActionKindMirror;
  readonly instruments: readonly string[];
  readonly venues: readonly string[];
  readonly window: ActionWindowMirror;
  readonly observationCount: number;
  readonly implication: ImplicationStanceMirror;
  readonly evidence: readonly CitationMirror[];
  readonly asOf: number;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly bodyVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface FundamentalDataGapMirror {
  readonly kind: string;
  readonly instrument: string;
  readonly series: string;
}

export interface FundamentalSummaryMirror {
  readonly assessmentCount: number;
  readonly actionDigestCount: number;
  readonly instrumentCount: number;
  readonly dominantStance: string;
  readonly meanStanceScore: string | null;
  readonly coverage: IntakeCoverageMirror;
  readonly dataGaps: readonly FundamentalDataGapMirror[];
}

export interface FundamentalReportMirror {
  readonly reportId: string; // 'frr-'-prefixed
  readonly asOf: number;
  readonly bodyVersion: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly assessments: readonly FundamentalAssessmentMirror[];
  readonly actionDigests: readonly CorporateActionDigestMirror[];
  readonly summary: FundamentalSummaryMirror;
}

// ---------------------------------------------------------------------------
// LANE 4 — Cross-market (T026)
// ---------------------------------------------------------------------------

export const RELATIONSHIP_KINDS_MIRROR = ['co-movement', 'lead-lag', 'spread-divergence'] as const;
export type RelationshipKindMirror = (typeof RELATIONSHIP_KINDS_MIRROR)[number];

export interface MarketLegMirror {
  readonly venue: string;
  readonly instrument: string;
  readonly assetClass: string;
  readonly series: string;
}

export interface MarketPairMirror {
  readonly left: MarketLegMirror;
  readonly right: MarketLegMirror;
}

export interface LeggedCitationMirror {
  readonly leg: 'left' | 'right';
  readonly observationId: string;
  readonly availableTime: number;
  readonly provenance: ProvenanceMirror;
}

export interface RelationshipWindowMirror {
  readonly from: number;
  readonly to: number;
}

export interface RelationshipMeasureMirror extends MethodCitedAssessmentMirror {
  readonly direction: string;
  readonly score: string;
}

export interface CrossMarketConfidenceMirror extends MethodCitedAssessmentMirror {
  readonly level: ConfidenceLevelMirror;
  readonly evidenceCount: number;
  readonly legImbalance: number;
}

export interface CrossMarketRelationshipMirror {
  readonly relationshipId: string;
  readonly pair: MarketPairMirror;
  readonly relationKind: RelationshipKindMirror;
  readonly measure: RelationshipMeasureMirror;
  readonly window: RelationshipWindowMirror;
  readonly confidence: CrossMarketConfidenceMirror;
  readonly evidence: readonly LeggedCitationMirror[];
  readonly asOf: number;
  readonly bodyVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface CrossMarketDataGapMirror {
  readonly kind: string;
  readonly leftInstrument: string;
  readonly rightInstrument: string;
}

export interface CrossMarketSummaryMirror {
  readonly relationshipCount: number;
  readonly pairCount: number;
  readonly instrumentCount: number;
  readonly dominantRelationKind: string;
  readonly meanMeasureScore: string | null;
  readonly coverage: IntakeCoverageMirror;
  readonly dataGaps: readonly CrossMarketDataGapMirror[];
}

export interface CrossMarketReportMirror {
  readonly reportId: string; // 'cmrr-'-prefixed
  readonly asOf: number;
  readonly bodyVersion: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly relationships: readonly CrossMarketRelationshipMirror[];
  readonly summary: CrossMarketSummaryMirror;
}

// ---------------------------------------------------------------------------
// The four-lane research intake bundle
// ---------------------------------------------------------------------------

/** The four-lane research intake bundle (absent lanes are `null` — typed absence). */
export interface ResearchIntakeMirror {
  readonly sentiment: SentimentReportMirror | null;
  readonly regime: RegimeReportMirror | null;
  readonly fundamental: FundamentalReportMirror | null;
  readonly crossMarket: CrossMarketReportMirror | null;
}

// ---------------------------------------------------------------------------
// Guards (structural — mirror of T024's intake guards)
// ---------------------------------------------------------------------------

const isCitationMirror = (v: unknown): v is CitationMirror =>
  isRecord(v) &&
  isNonEmptyString(v.observationId) &&
  isTimestampMs(v.availableTime) &&
  isRecord(v.provenance) &&
  isMemberOf(EVENT_ORIGINS_MIRROR, v.provenance.origin) &&
  (v.provenance.adapter === null || (isRecord(v.provenance.adapter) && isNonEmptyString(v.provenance.adapter.id))) &&
  Array.isArray(v.provenance.derived_from) &&
  (v.provenance.transform === null || isNonEmptyString(v.provenance.transform));

const isConfidenceAssessment = (v: unknown): v is ConfidenceAssessmentMirror =>
  isRecord(v) &&
  isNonEmptyString(v.methodId) &&
  isNonEmptyString(v.methodVersion) &&
  isMemberOf(CONFIDENCE_LEVELS_MIRROR, v.level) &&
  isNonNegativeInteger(v.evidenceCount) &&
  (v.dispersion === null || typeof v.dispersion === 'string');

const isIntakeCoverage = (v: unknown): v is IntakeCoverageMirror =>
  isRecord(v) &&
  isNonNegativeInteger(v.observationsOffered) &&
  isNonNegativeInteger(v.observationsAdmitted) &&
  isNonNegativeInteger(v.observationsDeferred) &&
  isNonNegativeInteger(v.observationsUnsupported) &&
  isNonNegativeInteger(v.observationsInvalid);

/** Guard: a sentiment report. */
export function isSentimentReportMirror(v: unknown): v is SentimentReportMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.reportId) &&
    (v.reportId as string).startsWith('rr-') &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRefMirror(v.bodyVersion) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    isArrayOf(v.readings, isSentimentReading) &&
    isArrayOf(v.digests, isEventDigest) &&
    isRecord(v.summary) &&
    isMemberOf([...POLARITY_DIRECTIONS_MIRROR, 'no-reading'], v.summary.dominantPolarity) &&
    isIntakeCoverage(v.summary.coverage) &&
    Array.isArray(v.summary.dataGaps)
  );
}

const isSentimentReading = (v: unknown): v is SentimentReadingMirror =>
  isRecord(v) &&
  isNonEmptyString(v.readingId) &&
  isRecord(v.scope) &&
  isNonEmptyString(v.scope.instrument) &&
  isNonEmptyString(v.scope.venue) &&
  isRecord(v.polarity) &&
  isMemberOf(POLARITY_DIRECTIONS_MIRROR, v.polarity.direction) &&
  isRecord(v.intensity) &&
  isMemberOf(INTENSITY_LEVELS_MIRROR, v.intensity.level) &&
  isConfidenceAssessment(v.confidence) &&
  isArrayOf(v.evidence, isCitationMirror) &&
  isTimestampMs(v.asOf) &&
  isBodyVersionRefMirror(v.bodyVersion) &&
  isNonEmptyString(v.seed);

const isEventDigest = (v: unknown): v is EventDigestMirror =>
  isRecord(v) &&
  isNonEmptyString(v.digestId) &&
  isMemberOf(EVENT_KINDS_MIRROR, v.kind) &&
  Array.isArray(v.instruments) &&
  Array.isArray(v.venues) &&
  isRecord(v.window) &&
  isNonNegativeInteger(v.observationCount) &&
  isArrayOf(v.evidence, isCitationMirror);

/** Guard: a regime report. */
export function isRegimeReportMirror(v: unknown): v is RegimeReportMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.reportId) &&
    (v.reportId as string).startsWith('rr-') &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRefMirror(v.bodyVersion) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    isArrayOf(v.classifications, isRegimeClassification) &&
    Array.isArray(v.changes) &&
    isRecord(v.summary) &&
    isNonEmptyString(v.summary.dominantRegime) &&
    isIntakeCoverage(v.summary.coverage)
  );
}

const isRegimeClassification = (v: unknown): v is RegimeClassificationMirror =>
  isRecord(v) &&
  isNonEmptyString(v.classificationId) &&
  isRecord(v.scope) &&
  isNonEmptyString(v.scope.instrument) &&
  isNonEmptyString(v.label) &&
  typeof v.netMoveRatio === 'string' &&
  typeof v.meanAbsChangeRatio === 'string' &&
  isRecord(v.window) &&
  isNonNegativeInteger(v.observationCount) &&
  isArrayOf(v.evidence, isCitationMirror) &&
  isConfidenceAssessment(v.confidence);

/** Guard: a fundamental report. */
export function isFundamentalReportMirror(v: unknown): v is FundamentalReportMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.reportId) &&
    (v.reportId as string).startsWith('frr-') &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRefMirror(v.bodyVersion) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    isArrayOf(v.assessments, isFundamentalAssessment) &&
    Array.isArray(v.actionDigests) &&
    isRecord(v.summary) &&
    isNonEmptyString(v.summary.dominantStance) &&
    isIntakeCoverage(v.summary.coverage)
  );
}

const isFundamentalAssessment = (v: unknown): v is FundamentalAssessmentMirror =>
  isRecord(v) &&
  isNonEmptyString(v.assessmentId) &&
  isRecord(v.scope) &&
  isNonEmptyString(v.scope.instrument) &&
  isNonEmptyString(v.scope.series) &&
  isMemberOf(ASSESSMENT_KINDS_MIRROR, v.assessmentKind) &&
  isRecord(v.stance) &&
  isMemberOf(STANCE_DIRECTIONS_MIRROR, v.stance.direction) &&
  isConfidenceAssessment(v.confidence) &&
  isArrayOf(v.evidence, isCitationMirror);

/** Guard: a cross-market report. */
export function isCrossMarketReportMirror(v: unknown): v is CrossMarketReportMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.reportId) &&
    (v.reportId as string).startsWith('cmrr-') &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRefMirror(v.bodyVersion) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    isArrayOf(v.relationships, isCrossMarketRelationship) &&
    isRecord(v.summary) &&
    isNonEmptyString(v.summary.dominantRelationKind) &&
    isIntakeCoverage(v.summary.coverage)
  );
}

const isCrossMarketRelationship = (v: unknown): v is CrossMarketRelationshipMirror =>
  isRecord(v) &&
  isNonEmptyString(v.relationshipId) &&
  isRecord(v.pair) &&
  isMemberOf(RELATIONSHIP_KINDS_MIRROR, v.relationKind) &&
  isRecord(v.measure) &&
  isNonEmptyString(v.measure.direction) &&
  isRecord(v.confidence) &&
  isNonNegativeInteger(v.confidence.legImbalance) &&
  Array.isArray(v.evidence) &&
  v.evidence.every(
    (item) =>
      isRecord(item) &&
      (item.leg === 'left' || item.leg === 'right') &&
      isNonEmptyString(item.observationId),
  );

/** Extracts the per-lane instruments (sorted unique) — mirror of T024 helpers. */
export function instrumentsOfReports(
  instruments: readonly (readonly string[])[],
): readonly string[] {
  const set = new Set<string>();
  for (const list of instruments) for (const instrument of list) set.add(instrument);
  return [...set].sort();
}

/** The lane names (T024's canonical order). */
export const RESEARCH_LANES = ['sentiment', 'regime', 'fundamental', 'cross-market'] as const;
export type ResearchLane = (typeof RESEARCH_LANES)[number];
export const RESEARCH_LANE_COUNT: number = RESEARCH_LANES.length;

/** Guard: a research lane name. */
export function isResearchLane(v: unknown): v is ResearchLane {
  return isMemberOf(RESEARCH_LANES, v);
}

/** The report id prefix for each lane. */
export function reportPrefixOfLane(lane: ResearchLane): 'rr-' | 'frr-' | 'cmrr-' {
  if (lane === 'fundamental') return 'frr-';
  if (lane === 'cross-market') return 'cmrr-';
  return 'rr-';
}

/** The report of a lane from the intake bundle (null when absent). */
export function reportOfLane(
  intake: ResearchIntakeMirror,
  lane: ResearchLane,
): SentimentReportMirror | RegimeReportMirror | FundamentalReportMirror | CrossMarketReportMirror | null {
  if (lane === 'sentiment') return intake.sentiment;
  if (lane === 'regime') return intake.regime;
  if (lane === 'fundamental') return intake.fundamental;
  return intake.crossMarket;
}

/** Positive-integer re-export for guard parity in tests. */
export { isPositiveInteger };
