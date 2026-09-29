// @tradrl/body-trading-director — the research intake contracts.
//
// Owning Work Order: T024, "Research intake (the four mirrors)":
// "STRUCTURAL MIRRORS, field-for-field, of the four research bodies'
// report shapes: sentiment's ResearchReport, RegimeResearchReport,
// FundamentalResearchReport, CrossMarketResearchReport — never imported
// (D-004); interop.test.ts asserts guard parity against the REAL
// packages on this branch (the established trip-wire pattern)."
//
// This module declares the four report mirrors field-for-field (every
// top-level field, every embedded section record, every summary shape,
// exactly as T021/T022/T023 define them) and THE L4 GATE: an input whose
// `asOf` is LATER than the director's decision instant is the typed
// `research_from_the_future` error. The boundary is INCLUSIVE — an input
// computed exactly at the decision instant is legal knowledge; one
// millisecond later is research from the future.
//
// The mirrors are FLOORS: they check every field the real guards check
// structurally (names, primitive shapes, closed vocabularies) and accept
// real research publications VERBATIM; extras ride. The research lanes
// own the deeper laws (summary re-derivation, digest tamper trip-wires,
// method registries) — this package's interop test proves the real
// validators still accept this package's mirror fixtures, and that real
// fixture reports pass these mirror guards.
//
// R45 (inherited confidence): the extraction helpers copy each input
// report's embedded confidence assessments VERBATIM ({level,
// evidenceCount} pairs — the program-wide confidence vocabulary). The
// director never mints, aggregates or fabricates a confidence value.
//
// Laws held here: zero runtime deps; no `any`; total hand-rolled guards;
// no ambient clock; deepFreeze everything public; JSON-serializable.

import {
  type TimestampMs,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
  isMemberOf,
  isArrayOf,
  deepFreeze,
} from './primitives';
import {
  type BodyVersionRef,
  type ProjectId,
  type TenantId,
  isBodyVersionRef,
  isProjectId,
  isTenantId,
} from './ids';
import { type ResearchLane, isResearchLane } from './methods';
import { type DirectorError, invalidField, invalidType } from './errors';

// ---------------------------------------------------------------------------
// The shared provenance-block mirror (T008 via every research lane)
// ---------------------------------------------------------------------------

/** The canonical origin trichotomy — mirror of every lane's declaration. */
export const EVENT_ORIGINS_MIRROR = ['historical', 'simulated', 'generated'] as const;

/** An event origin. */
export type EventOriginMirror = (typeof EVENT_ORIGINS_MIRROR)[number];

/** Guard: an event origin. */
export const isEventOriginMirror = (v: unknown): v is EventOriginMirror =>
  isMemberOf(EVENT_ORIGINS_MIRROR, v);

/** An adapter reference — mirror of the canonical `AdapterRef`. */
export interface AdapterRefMirror {
  readonly id: string;
  readonly version: string;
}

/** Guard: `AdapterRefMirror`. */
export function isAdapterRefMirror(v: unknown): v is AdapterRefMirror {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.id) && isNonEmptyString(v.version);
}

/**
 * The observation provenance block — STRUCTURAL MIRROR of the canonical
 * `IngestionProvenance` (market-protocol / data-ingestion / adapters),
 * re-declared by every research body. Carried verbatim inside citation
 * records; the research lanes own its deeper laws.
 */
export interface ProvenanceMirror {
  readonly origin: EventOriginMirror;
  readonly adapter: AdapterRefMirror | null;
  readonly derived_from: readonly string[];
  readonly transform: string | null;
}

/** Guard: `ProvenanceMirror` (structural floor — extras ride). */
export function isProvenanceMirror(v: unknown): v is ProvenanceMirror {
  if (!isRecord(v)) return false;
  return (
    isEventOriginMirror(v.origin) &&
    (v.adapter === null || isAdapterRefMirror(v.adapter)) &&
    isArrayOf(v.derived_from, isNonEmptyString) &&
    (v.transform === null || isNonEmptyString(v.transform))
  );
}

// ---------------------------------------------------------------------------
// The shared confidence vocabulary (R45 — the inherited-confidence floor)
// ---------------------------------------------------------------------------

/** The program-wide confidence levels — mirror of every lane's vocabulary. */
export const CONFIDENCE_LEVELS_MIRROR = ['low', 'moderate', 'high'] as const;

/** A confidence level — a category, never a score. */
export type ConfidenceLevelMirror = (typeof CONFIDENCE_LEVELS_MIRROR)[number];

/** Guard: a confidence level. */
export const isConfidenceLevelMirror = (v: unknown): v is ConfidenceLevelMirror =>
  isMemberOf(CONFIDENCE_LEVELS_MIRROR, v);

/**
 * R45: a confidence record INHERITED from a research report — copied
 * verbatim from an embedded record's confidence assessment by the
 * extraction helpers. The director never fabricates confidence: this
 * shape is only ever minted by copying, never by computing.
 */
export interface InheritedConfidence {
  /** The lane's declared confidence level, copied verbatim. */
  readonly level: ConfidenceLevelMirror;
  /** The evidence count behind that level, copied verbatim. */
  readonly evidenceCount: number;
}

/** Guard: `InheritedConfidence`. */
export function isInheritedConfidence(v: unknown): v is InheritedConfidence {
  if (!isRecord(v)) return false;
  return isConfidenceLevelMirror(v.level) && isNonNegativeInteger(v.evidenceCount);
}

// ---------------------------------------------------------------------------
// The shared intake-coverage mirror (the five L4 buckets — every lane)
// ---------------------------------------------------------------------------

/**
 * The intake accounting every research publication carries — mirror of
 * every lane's shape: how many observations were offered and how each
 * was classified (nothing silently dropped).
 */
export interface IntakeCoverageMirror {
  readonly observationsOffered: number;
  readonly observationsAdmitted: number;
  readonly observationsDeferred: number;
  readonly observationsUnsupported: number;
  readonly observationsInvalid: number;
}

/** Guard: `IntakeCoverageMirror`. */
export function isIntakeCoverageMirror(v: unknown): v is IntakeCoverageMirror {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.observationsOffered) &&
    isNonNegativeInteger(v.observationsAdmitted) &&
    isNonNegativeInteger(v.observationsDeferred) &&
    isNonNegativeInteger(v.observationsUnsupported) &&
    isNonNegativeInteger(v.observationsInvalid)
  );
}

// ===========================================================================
// LANE 1: SENTIMENT (@tradrl/body-sentiment-researcher, T021)
// ===========================================================================

/** The sentiment polarity directions — mirror of T021's vocabulary. */
export const POLARITY_DIRECTIONS_MIRROR = ['positive', 'negative', 'neutral', 'mixed'] as const;

/** A polarity direction. */
export type PolarityDirectionMirror = (typeof POLARITY_DIRECTIONS_MIRROR)[number];

/** Guard: a polarity direction. */
export const isPolarityDirectionMirror = (v: unknown): v is PolarityDirectionMirror =>
  isMemberOf(POLARITY_DIRECTIONS_MIRROR, v);

/** The intensity levels — mirror of T021's vocabulary. */
export const INTENSITY_LEVELS_MIRROR = ['low', 'moderate', 'high'] as const;

/** An intensity level. */
export type IntensityLevelMirror = (typeof INTENSITY_LEVELS_MIRROR)[number];

/** Guard: an intensity level. */
export const isIntensityLevelMirror = (v: unknown): v is IntensityLevelMirror =>
  isMemberOf(INTENSITY_LEVELS_MIRROR, v);

/** The sentiment event taxonomy — mirror of T021's declaration. */
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

/** A declared event kind. */
export type EventKindMirror = (typeof EVENT_KINDS_MIRROR)[number];

/** Guard: a declared event kind. */
export const isEventKindMirror = (v: unknown): v is EventKindMirror =>
  isMemberOf(EVENT_KINDS_MIRROR, v);

/** A reading scope — mirror of T021's `ReadingScope`. */
export interface SentimentScopeMirror {
  readonly instrument: string;
  readonly venue: string;
}

/** Guard: `SentimentScopeMirror`. */
export function isSentimentScopeMirror(v: unknown): v is SentimentScopeMirror {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.instrument) && isNonEmptyString(v.venue);
}

/** A method-cited assessment — the shared assessment-record mirror. */
export interface MethodCitedAssessmentMirror {
  readonly methodId: string;
  readonly methodVersion: string;
}

/** Guard: `MethodCitedAssessmentMirror`. */
export function isMethodCitedAssessmentMirror(v: unknown): v is MethodCitedAssessmentMirror {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.methodId) && isNonEmptyString(v.methodVersion);
}

/** A polarity assessment — mirror of T021's `PolarityAssessment`. */
export interface PolarityAssessmentMirror extends MethodCitedAssessmentMirror {
  readonly direction: PolarityDirectionMirror;
  readonly score: string;
}

/** Guard: `PolarityAssessmentMirror`. */
export function isPolarityAssessmentMirror(v: unknown): v is PolarityAssessmentMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.methodId) || !isNonEmptyString(v.methodVersion)) return false;
  return isPolarityDirectionMirror(v.direction) && isNonEmptyString(v.score);
}

/** An intensity assessment — mirror of T021's `IntensityAssessment`. */
export interface IntensityAssessmentMirror extends MethodCitedAssessmentMirror {
  readonly level: IntensityLevelMirror;
  readonly score: string;
}

/** Guard: `IntensityAssessmentMirror`. */
export function isIntensityAssessmentMirror(v: unknown): v is IntensityAssessmentMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.methodId) || !isNonEmptyString(v.methodVersion)) return false;
  return isIntensityLevelMirror(v.level) && isNonEmptyString(v.score);
}

/** A confidence assessment — mirror of T021's `ConfidenceAssessment`. */
export interface ConfidenceAssessmentMirror extends MethodCitedAssessmentMirror {
  readonly level: ConfidenceLevelMirror;
  readonly evidenceCount: number;
  readonly dispersion: string | null;
}

/** Guard: `ConfidenceAssessmentMirror`. */
export function isConfidenceAssessmentMirror(v: unknown): v is ConfidenceAssessmentMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.methodId) || !isNonEmptyString(v.methodVersion)) return false;
  return (
    isConfidenceLevelMirror(v.level) &&
    isNonNegativeInteger(v.evidenceCount) &&
    (v.dispersion === null || isNonEmptyString(v.dispersion))
  );
}

/** An observation citation — mirror of T021's `ObservationCitation`. */
export interface CitationMirror {
  readonly observationId: string;
  readonly availableTime: TimestampMs;
  readonly provenance: ProvenanceMirror;
}

/** Guard: `CitationMirror`. */
export function isCitationMirror(v: unknown): v is CitationMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.observationId) &&
    isTimestampMs(v.availableTime) &&
    isProvenanceMirror(v.provenance)
  );
}

/** A sentiment reading — mirror of T021's `SentimentReading`. */
export interface SentimentReadingMirror {
  readonly readingId: string;
  readonly scope: SentimentScopeMirror;
  readonly polarity: PolarityAssessmentMirror;
  readonly intensity: IntensityAssessmentMirror;
  readonly confidence: ConfidenceAssessmentMirror;
  readonly evidence: readonly CitationMirror[];
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

/** Guard: `SentimentReadingMirror`. */
export function isSentimentReadingMirror(v: unknown): v is SentimentReadingMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.readingId) &&
    isSentimentScopeMirror(v.scope) &&
    isPolarityAssessmentMirror(v.polarity) &&
    isIntensityAssessmentMirror(v.intensity) &&
    isConfidenceAssessmentMirror(v.confidence) &&
    isArrayOf(v.evidence, isCitationMirror) &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed)
  );
}

/** An event window — mirror of T021's `EventWindow`. */
export interface EventWindowMirror {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** Guard: `EventWindowMirror`. */
export function isEventWindowMirror(v: unknown): v is EventWindowMirror {
  if (!isRecord(v)) return false;
  return isTimestampMs(v.from) && isTimestampMs(v.to);
}

/** An event digest — mirror of T021's `EventDigest`. */
export interface EventDigestMirror {
  readonly digestId: string;
  readonly kind: EventKindMirror;
  readonly instruments: readonly string[];
  readonly venues: readonly string[];
  readonly window: EventWindowMirror;
  readonly observationCount: number;
  readonly evidence: readonly CitationMirror[];
  readonly asOf: TimestampMs;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

/** Guard: `EventDigestMirror`. */
export function isEventDigestMirror(v: unknown): v is EventDigestMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.digestId) &&
    isEventKindMirror(v.kind) &&
    isArrayOf(v.instruments, isNonEmptyString) &&
    isArrayOf(v.venues, isNonEmptyString) &&
    isEventWindowMirror(v.window) &&
    isNonNegativeInteger(v.observationCount) &&
    isArrayOf(v.evidence, isCitationMirror) &&
    isTimestampMs(v.asOf) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isBodyVersionRef(v.bodyVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed)
  );
}

/** A sentiment data gap — mirror of T021's `DataGap`. */
export interface SentimentDataGapMirror {
  readonly kind: string;
  readonly instrument: string;
}

/** Guard: `SentimentDataGapMirror`. */
export function isSentimentDataGapMirror(v: unknown): v is SentimentDataGapMirror {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.kind) && typeof v.instrument === 'string';
}

/** A sentiment summary — mirror of T021's `ResearchSummary`. */
export interface SentimentSummaryMirror {
  readonly readingCount: number;
  readonly digestCount: number;
  readonly instrumentCount: number;
  readonly dominantPolarity: string;
  readonly meanPolarityScore: string | null;
  readonly coverage: IntakeCoverageMirror;
  readonly dataGaps: readonly SentimentDataGapMirror[];
}

/** Guard: `SentimentSummaryMirror`. */
export function isSentimentSummaryMirror(v: unknown): v is SentimentSummaryMirror {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.readingCount) &&
    isNonNegativeInteger(v.digestCount) &&
    isNonNegativeInteger(v.instrumentCount) &&
    isNonEmptyString(v.dominantPolarity) &&
    (v.meanPolarityScore === null || isNonEmptyString(v.meanPolarityScore)) &&
    isIntakeCoverageMirror(v.coverage) &&
    isArrayOf(v.dataGaps, isSentimentDataGapMirror)
  );
}

/**
 * THE sentiment research report — field-for-field mirror of T021's
 * `ResearchReport`. The director cites this shape verbatim; the id is
 * the T021-derived `rr-<digest>` space.
 */
export interface SentimentReportMirror {
  readonly reportId: string;
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly readings: readonly SentimentReadingMirror[];
  readonly digests: readonly EventDigestMirror[];
  readonly summary: SentimentSummaryMirror;
}

/** Guard: `SentimentReportMirror`. */
export function isSentimentReportMirror(v: unknown): v is SentimentReportMirror {
  if (!isRecord(v)) return false;
  return (
    typeof v.reportId === 'string' &&
    (v.reportId as string).startsWith('rr-') &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    isArrayOf(v.readings, isSentimentReadingMirror) &&
    isArrayOf(v.digests, isEventDigestMirror) &&
    isSentimentSummaryMirror(v.summary)
  );
}

// ===========================================================================
// LANE 2: REGIME (@tradrl/body-regime-researcher, T022)
// ===========================================================================

/** A regime scope — mirror of T022's `RegimeScope`. */
export interface RegimeScopeMirror {
  readonly instrument: string;
  readonly venue: string;
}

/** Guard: `RegimeScopeMirror`. */
export function isRegimeScopeMirror(v: unknown): v is RegimeScopeMirror {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.instrument) && isNonEmptyString(v.venue);
}

/** A regime window — mirror of T022's `RegimeWindow`. */
export interface RegimeWindowMirror {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** Guard: `RegimeWindowMirror`. */
export function isRegimeWindowMirror(v: unknown): v is RegimeWindowMirror {
  if (!isRecord(v)) return false;
  return isTimestampMs(v.from) && isTimestampMs(v.to);
}

/** A regime confidence — mirror of T022's `RegimeConfidence`. */
export interface RegimeConfidenceMirror extends MethodCitedAssessmentMirror {
  readonly level: ConfidenceLevelMirror;
  readonly evidenceCount: number;
  readonly dispersion: string | null;
}

/** Guard: `RegimeConfidenceMirror`. */
export function isRegimeConfidenceMirror(v: unknown): v is RegimeConfidenceMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.methodId) || !isNonEmptyString(v.methodVersion)) return false;
  return (
    isConfidenceLevelMirror(v.level) &&
    isNonNegativeInteger(v.evidenceCount) &&
    (v.dispersion === null || isNonEmptyString(v.dispersion))
  );
}

/** A regime classification — mirror of T022's `RegimeClassification`. */
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
  readonly asOf: TimestampMs;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

/** Guard: `RegimeClassificationMirror`. */
export function isRegimeClassificationMirror(v: unknown): v is RegimeClassificationMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.classificationId) &&
    isRegimeScopeMirror(v.scope) &&
    isNonEmptyString(v.label) &&
    isNonEmptyString(v.netMoveRatio) &&
    isNonEmptyString(v.meanAbsChangeRatio) &&
    isRegimeWindowMirror(v.window) &&
    isNonNegativeInteger(v.observationCount) &&
    isArrayOf(v.evidence, isCitationMirror) &&
    isRegimeConfidenceMirror(v.confidence) &&
    isTimestampMs(v.asOf) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isBodyVersionRef(v.bodyVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed)
  );
}

/** A regime change — mirror of T022's `RegimeChange`. */
export interface RegimeChangeMirror {
  readonly changeId: string;
  readonly scope: RegimeScopeMirror;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly fromWindow: RegimeWindowMirror;
  readonly toWindow: RegimeWindowMirror;
  readonly detectionInstant: TimestampMs;
  readonly evidence: readonly CitationMirror[];
  readonly asOf: TimestampMs;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

/** Guard: `RegimeChangeMirror`. */
export function isRegimeChangeMirror(v: unknown): v is RegimeChangeMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.changeId) &&
    isRegimeScopeMirror(v.scope) &&
    isNonEmptyString(v.fromLabel) &&
    isNonEmptyString(v.toLabel) &&
    isRegimeWindowMirror(v.fromWindow) &&
    isRegimeWindowMirror(v.toWindow) &&
    isTimestampMs(v.detectionInstant) &&
    isArrayOf(v.evidence, isCitationMirror) &&
    isTimestampMs(v.asOf) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isBodyVersionRef(v.bodyVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed)
  );
}

/** A regime data gap — mirror of T022's `RegimeDataGap`. */
export interface RegimeDataGapMirror {
  readonly kind: string;
  readonly instrument: string;
}

/** Guard: `RegimeDataGapMirror`. */
export function isRegimeDataGapMirror(v: unknown): v is RegimeDataGapMirror {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.kind) && typeof v.instrument === 'string';
}

/** A regime summary — mirror of T022's `RegimeSummary`. */
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

/** Guard: `RegimeSummaryMirror`. */
export function isRegimeSummaryMirror(v: unknown): v is RegimeSummaryMirror {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.classificationCount) &&
    isNonNegativeInteger(v.changeCount) &&
    isNonNegativeInteger(v.instrumentCount) &&
    isNonNegativeInteger(v.windowCount) &&
    isNonEmptyString(v.dominantRegime) &&
    (v.meanNetMoveRatio === null || isNonEmptyString(v.meanNetMoveRatio)) &&
    isIntakeCoverageMirror(v.coverage) &&
    isArrayOf(v.dataGaps, isRegimeDataGapMirror)
  );
}

/**
 * THE regime research report — field-for-field mirror of T022's
 * `RegimeResearchReport` (id space `rr-<digest>`).
 */
export interface RegimeReportMirror {
  readonly reportId: string;
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly classifications: readonly RegimeClassificationMirror[];
  readonly changes: readonly RegimeChangeMirror[];
  readonly summary: RegimeSummaryMirror;
}

/** Guard: `RegimeReportMirror`. */
export function isRegimeReportMirror(v: unknown): v is RegimeReportMirror {
  if (!isRecord(v)) return false;
  return (
    typeof v.reportId === 'string' &&
    (v.reportId as string).startsWith('rr-') &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    isArrayOf(v.classifications, isRegimeClassificationMirror) &&
    isArrayOf(v.changes, isRegimeChangeMirror) &&
    isRegimeSummaryMirror(v.summary)
  );
}

// ===========================================================================
// LANE 3: FUNDAMENTAL (@tradrl/body-fundamental-researcher, T023)
// ===========================================================================

/** The fundamental assessment kinds — mirror of T023's declaration. */
export const ASSESSMENT_KINDS_MIRROR = ['valuation-level', 'macro-surprise', 'health-indicator'] as const;

/** A declared assessment kind. */
export type AssessmentKindMirror = (typeof ASSESSMENT_KINDS_MIRROR)[number];

/** Guard: a declared assessment kind. */
export const isAssessmentKindMirror = (v: unknown): v is AssessmentKindMirror =>
  isMemberOf(ASSESSMENT_KINDS_MIRROR, v);

/** The fundamental stance directions — mirror of T023's vocabulary. */
export const STANCE_DIRECTIONS_MIRROR = ['positive', 'negative', 'neutral'] as const;

/** A stance direction. */
export type StanceDirectionMirror = (typeof STANCE_DIRECTIONS_MIRROR)[number];

/** Guard: a stance direction. */
export const isStanceDirectionMirror = (v: unknown): v is StanceDirectionMirror =>
  isMemberOf(STANCE_DIRECTIONS_MIRROR, v);

/** The corporate-action kinds — mirror of T023's declaration. */
export const CORPORATE_ACTION_KINDS_MIRROR = ['split', 'cash_dividend', 'merger'] as const;

/** A declared corporate-action kind. */
export type CorporateActionKindMirror = (typeof CORPORATE_ACTION_KINDS_MIRROR)[number];

/** Guard: a declared corporate-action kind. */
export const isCorporateActionKindMirror = (v: unknown): v is CorporateActionKindMirror =>
  isMemberOf(CORPORATE_ACTION_KINDS_MIRROR, v);

/** The implication stances — mirror of T023's declaration. */
export const IMPLICATION_STANCES_MIRROR = ['positive', 'negative', 'neutral', 'mixed'] as const;

/** A declared implication stance. */
export type ImplicationStanceMirror = (typeof IMPLICATION_STANCES_MIRROR)[number];

/** Guard: a declared implication stance. */
export const isImplicationStanceMirror = (v: unknown): v is ImplicationStanceMirror =>
  isMemberOf(IMPLICATION_STANCES_MIRROR, v);

/** An assessment scope — mirror of T023's `AssessmentScope`. */
export interface AssessmentScopeMirror {
  readonly instrument: string;
  readonly series: string;
}

/** Guard: `AssessmentScopeMirror`. */
export function isAssessmentScopeMirror(v: unknown): v is AssessmentScopeMirror {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.instrument) && isNonEmptyString(v.series);
}

/** A stance assessment — mirror of T023's `StanceAssessment`. */
export interface StanceAssessmentMirror extends MethodCitedAssessmentMirror {
  readonly direction: StanceDirectionMirror;
  readonly score: string;
}

/** Guard: `StanceAssessmentMirror`. */
export function isStanceAssessmentMirror(v: unknown): v is StanceAssessmentMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.methodId) || !isNonEmptyString(v.methodVersion)) return false;
  return isStanceDirectionMirror(v.direction) && isNonEmptyString(v.score);
}

/** A fundamental assessment — mirror of T023's `FundamentalAssessment`. */
export interface FundamentalAssessmentMirror {
  readonly assessmentId: string;
  readonly scope: AssessmentScopeMirror;
  readonly assessmentKind: AssessmentKindMirror;
  readonly stance: StanceAssessmentMirror;
  readonly confidence: ConfidenceAssessmentMirror;
  readonly evidence: readonly CitationMirror[];
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

/** Guard: `FundamentalAssessmentMirror`. */
export function isFundamentalAssessmentMirror(v: unknown): v is FundamentalAssessmentMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.assessmentId) &&
    isAssessmentScopeMirror(v.scope) &&
    isAssessmentKindMirror(v.assessmentKind) &&
    isStanceAssessmentMirror(v.stance) &&
    isConfidenceAssessmentMirror(v.confidence) &&
    isArrayOf(v.evidence, isCitationMirror) &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed)
  );
}

/** An action window — mirror of T023's `ActionWindow`. */
export interface ActionWindowMirror {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** Guard: `ActionWindowMirror`. */
export function isActionWindowMirror(v: unknown): v is ActionWindowMirror {
  if (!isRecord(v)) return false;
  return isTimestampMs(v.from) && isTimestampMs(v.to);
}

/** A corporate-action digest — mirror of T023's `CorporateActionDigest`. */
export interface CorporateActionDigestMirror {
  readonly digestId: string;
  readonly action: CorporateActionKindMirror;
  readonly instruments: readonly string[];
  readonly venues: readonly string[];
  readonly window: ActionWindowMirror;
  readonly observationCount: number;
  readonly implication: ImplicationStanceMirror;
  readonly evidence: readonly CitationMirror[];
  readonly asOf: TimestampMs;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

/** Guard: `CorporateActionDigestMirror`. */
export function isCorporateActionDigestMirror(v: unknown): v is CorporateActionDigestMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.digestId) &&
    isCorporateActionKindMirror(v.action) &&
    isArrayOf(v.instruments, isNonEmptyString) &&
    isArrayOf(v.venues, isNonEmptyString) &&
    isActionWindowMirror(v.window) &&
    isNonNegativeInteger(v.observationCount) &&
    isImplicationStanceMirror(v.implication) &&
    isArrayOf(v.evidence, isCitationMirror) &&
    isTimestampMs(v.asOf) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isBodyVersionRef(v.bodyVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed)
  );
}

/** A fundamental data gap — mirror of T023's `FundamentalDataGap`. */
export interface FundamentalDataGapMirror {
  readonly kind: string;
  readonly instrument: string;
  readonly series: string;
}

/** Guard: `FundamentalDataGapMirror`. */
export function isFundamentalDataGapMirror(v: unknown): v is FundamentalDataGapMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.kind) &&
    typeof v.instrument === 'string' &&
    typeof v.series === 'string'
  );
}

/** A fundamental summary — mirror of T023's `FundamentalSummary`. */
export interface FundamentalSummaryMirror {
  readonly assessmentCount: number;
  readonly actionDigestCount: number;
  readonly instrumentCount: number;
  readonly dominantStance: string;
  readonly meanStanceScore: string | null;
  readonly coverage: IntakeCoverageMirror;
  readonly dataGaps: readonly FundamentalDataGapMirror[];
}

/** Guard: `FundamentalSummaryMirror`. */
export function isFundamentalSummaryMirror(v: unknown): v is FundamentalSummaryMirror {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.assessmentCount) &&
    isNonNegativeInteger(v.actionDigestCount) &&
    isNonNegativeInteger(v.instrumentCount) &&
    isNonEmptyString(v.dominantStance) &&
    (v.meanStanceScore === null || isNonEmptyString(v.meanStanceScore)) &&
    isIntakeCoverageMirror(v.coverage) &&
    isArrayOf(v.dataGaps, isFundamentalDataGapMirror)
  );
}

/**
 * THE fundamental research report — field-for-field mirror of T023's
 * `FundamentalResearchReport` (id space `frr-<digest>`).
 */
export interface FundamentalReportMirror {
  readonly reportId: string;
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly assessments: readonly FundamentalAssessmentMirror[];
  readonly actionDigests: readonly CorporateActionDigestMirror[];
  readonly summary: FundamentalSummaryMirror;
}

/** Guard: `FundamentalReportMirror`. */
export function isFundamentalReportMirror(v: unknown): v is FundamentalReportMirror {
  if (!isRecord(v)) return false;
  return (
    typeof v.reportId === 'string' &&
    (v.reportId as string).startsWith('frr-') &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    isArrayOf(v.assessments, isFundamentalAssessmentMirror) &&
    isArrayOf(v.actionDigests, isCorporateActionDigestMirror) &&
    isFundamentalSummaryMirror(v.summary)
  );
}

// ===========================================================================
// LANE 4: CROSS-MARKET (@tradrl/body-cross-market-researcher, T023)
// ===========================================================================

/** The relationship kinds — mirror of T023's declaration. */
export const RELATIONSHIP_KINDS_MIRROR = ['co-movement', 'lead-lag', 'spread-divergence'] as const;

/** A declared relationship kind. */
export type RelationshipKindMirror = (typeof RELATIONSHIP_KINDS_MIRROR)[number];

/** Guard: a declared relationship kind. */
export const isRelationshipKindMirror = (v: unknown): v is RelationshipKindMirror =>
  isMemberOf(RELATIONSHIP_KINDS_MIRROR, v);

/** A market leg — mirror of T023's `MarketLeg`. */
export interface MarketLegMirror {
  readonly venue: string;
  readonly instrument: string;
  readonly assetClass: string;
  readonly series: string;
}

/** Guard: `MarketLegMirror`. */
export function isMarketLegMirror(v: unknown): v is MarketLegMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.venue) &&
    isNonEmptyString(v.instrument) &&
    isNonEmptyString(v.assetClass) &&
    isNonEmptyString(v.series)
  );
}

/** A market pair — mirror of T023's `MarketPair`. */
export interface MarketPairMirror {
  readonly left: MarketLegMirror;
  readonly right: MarketLegMirror;
}

/** Guard: `MarketPairMirror`. */
export function isMarketPairMirror(v: unknown): v is MarketPairMirror {
  if (!isRecord(v)) return false;
  return isMarketLegMirror(v.left) && isMarketLegMirror(v.right);
}

/** A legged observation citation — mirror of T023's `ObservationCitation`. */
export interface LeggedCitationMirror {
  readonly leg: 'left' | 'right';
  readonly observationId: string;
  readonly availableTime: TimestampMs;
  readonly provenance: ProvenanceMirror;
}

/** Guard: `LeggedCitationMirror`. */
export function isLeggedCitationMirror(v: unknown): v is LeggedCitationMirror {
  if (!isRecord(v)) return false;
  return (
    (v.leg === 'left' || v.leg === 'right') &&
    isNonEmptyString(v.observationId) &&
    isTimestampMs(v.availableTime) &&
    isProvenanceMirror(v.provenance)
  );
}

/** A relationship window — mirror of T023's `RelationshipWindow`. */
export interface RelationshipWindowMirror {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** Guard: `RelationshipWindowMirror`. */
export function isRelationshipWindowMirror(v: unknown): v is RelationshipWindowMirror {
  if (!isRecord(v)) return false;
  return isTimestampMs(v.from) && isTimestampMs(v.to);
}

/** A relationship measure — mirror of T023's `RelationshipMeasure`. */
export interface RelationshipMeasureMirror extends MethodCitedAssessmentMirror {
  /** The kind-dependent direction label (e.g. 'positive', 'narrowing', 'no-lead'). */
  readonly direction: string;
  readonly score: string;
}

/** Guard: `RelationshipMeasureMirror`. */
export function isRelationshipMeasureMirror(v: unknown): v is RelationshipMeasureMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.methodId) || !isNonEmptyString(v.methodVersion)) return false;
  return isNonEmptyString(v.direction) && isNonEmptyString(v.score);
}

/** A cross-market confidence — mirror of T023's `CrossMarketConfidence`. */
export interface CrossMarketConfidenceMirror extends MethodCitedAssessmentMirror {
  readonly level: ConfidenceLevelMirror;
  readonly evidenceCount: number;
  readonly legImbalance: number;
}

/** Guard: `CrossMarketConfidenceMirror`. */
export function isCrossMarketConfidenceMirror(v: unknown): v is CrossMarketConfidenceMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.methodId) || !isNonEmptyString(v.methodVersion)) return false;
  return (
    isConfidenceLevelMirror(v.level) &&
    isNonNegativeInteger(v.evidenceCount) &&
    typeof v.legImbalance === 'number' &&
    Number.isInteger(v.legImbalance)
  );
}

/** A cross-market relationship — mirror of T023's `CrossMarketRelationship`. */
export interface CrossMarketRelationshipMirror {
  readonly relationshipId: string;
  readonly pair: MarketPairMirror;
  readonly relationKind: RelationshipKindMirror;
  readonly measure: RelationshipMeasureMirror;
  readonly window: RelationshipWindowMirror;
  readonly confidence: CrossMarketConfidenceMirror;
  readonly evidence: readonly LeggedCitationMirror[];
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

/** Guard: `CrossMarketRelationshipMirror`. */
export function isCrossMarketRelationshipMirror(v: unknown): v is CrossMarketRelationshipMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.relationshipId) &&
    isMarketPairMirror(v.pair) &&
    isRelationshipKindMirror(v.relationKind) &&
    isRelationshipMeasureMirror(v.measure) &&
    isRelationshipWindowMirror(v.window) &&
    isCrossMarketConfidenceMirror(v.confidence) &&
    isArrayOf(v.evidence, isLeggedCitationMirror) &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed)
  );
}

/** A cross-market data gap — mirror of T023's `CrossMarketDataGap`. */
export interface CrossMarketDataGapMirror {
  readonly kind: string;
  readonly leftInstrument: string;
  readonly rightInstrument: string;
}

/** Guard: `CrossMarketDataGapMirror`. */
export function isCrossMarketDataGapMirror(v: unknown): v is CrossMarketDataGapMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.kind) &&
    typeof v.leftInstrument === 'string' &&
    typeof v.rightInstrument === 'string'
  );
}

/** A cross-market summary — mirror of T023's `CrossMarketSummary`. */
export interface CrossMarketSummaryMirror {
  readonly relationshipCount: number;
  readonly pairCount: number;
  readonly instrumentCount: number;
  readonly dominantRelationKind: string;
  readonly meanMeasureScore: string | null;
  readonly coverage: IntakeCoverageMirror;
  readonly dataGaps: readonly CrossMarketDataGapMirror[];
}

/** Guard: `CrossMarketSummaryMirror`. */
export function isCrossMarketSummaryMirror(v: unknown): v is CrossMarketSummaryMirror {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.relationshipCount) &&
    isNonNegativeInteger(v.pairCount) &&
    isNonNegativeInteger(v.instrumentCount) &&
    isNonEmptyString(v.dominantRelationKind) &&
    (v.meanMeasureScore === null || isNonEmptyString(v.meanMeasureScore)) &&
    isIntakeCoverageMirror(v.coverage) &&
    isArrayOf(v.dataGaps, isCrossMarketDataGapMirror)
  );
}

/**
 * THE cross-market research report — field-for-field mirror of T023's
 * `CrossMarketResearchReport` (id space `cmrr-<digest>`).
 */
export interface CrossMarketReportMirror {
  readonly reportId: string;
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly relationships: readonly CrossMarketRelationshipMirror[];
  readonly summary: CrossMarketSummaryMirror;
}

/** Guard: `CrossMarketReportMirror`. */
export function isCrossMarketReportMirror(v: unknown): v is CrossMarketReportMirror {
  if (!isRecord(v)) return false;
  return (
    typeof v.reportId === 'string' &&
    (v.reportId as string).startsWith('cmrr-') &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    isArrayOf(v.relationships, isCrossMarketRelationshipMirror) &&
    isCrossMarketSummaryMirror(v.summary)
  );
}

// ===========================================================================
// The four-lane intake bundle + THE L4 GATE
// ===========================================================================

/** The four-lane research intake bundle (absent lanes are `null`). */
export interface ResearchIntake {
  readonly sentiment: SentimentReportMirror | null;
  readonly regime: RegimeReportMirror | null;
  readonly fundamental: FundamentalReportMirror | null;
  readonly crossMarket: CrossMarketReportMirror | null;
}

/**
 * THE L4 GATE + the intake laws (COLLECT-ALL — every violation, every
 * lane; untrusted input never throws):
 *
 * 1. Structure: every PRESENT lane must satisfy its field-for-field
 *    mirror guard.
 * 2. THE L4 LAW (`research_from_the_future`): a present input whose
 *    `asOf` is LATER than the director's decision instant is research
 *    from the future. The boundary is INCLUSIVE: `asOf == decision
 *    instant` is legal knowledge (exact equality passes); one
 *    millisecond later is rejected.
 * 3. THE L12 LAWS (`tenant_mismatch` / `project_mismatch`): every
 *    present input must carry the decision's tenant and project — a
 *    decision may never mix scopes.
 * 4. The method-version citation shape: each present input's
 *    report-composition methodId/methodVersion are carried verbatim into
 *    the decision's input refs (the research lanes own their deeper
 *    method-honesty laws; this gate checks the citation is well-formed).
 */
export function validateResearchIntake(
  intake: unknown,
  decisionAsOf: TimestampMs,
  tenantId: TenantId,
  projectId: ProjectId,
): readonly DirectorError[] {
  const errors: DirectorError[] = [];
  if (!isRecord(intake)) {
    return [invalidType('intake', 'a research intake record with the four lane fields')];
  }
  const lanes: readonly { readonly key: string; readonly lane: ResearchLane; readonly guard: (v: unknown) => boolean; readonly prefix: string }[] = [
    { key: 'sentiment', lane: 'sentiment', guard: isSentimentReportMirror, prefix: 'rr-' },
    { key: 'regime', lane: 'regime', guard: isRegimeReportMirror, prefix: 'rr-' },
    { key: 'fundamental', lane: 'fundamental', guard: isFundamentalReportMirror, prefix: 'frr-' },
    { key: 'crossMarket', lane: 'cross-market', guard: isCrossMarketReportMirror, prefix: 'cmrr-' },
  ];
  const decisionAsOfOk = isTimestampMs(decisionAsOf);
  for (const { key, guard, prefix } of lanes) {
    const report: unknown = intake[key];
    if (report === null || report === undefined) continue; // an absent lane is a typed absence record downstream — never silence, never an error here
    if (!guard(report)) {
      errors.push(invalidField(key, `must be a well-formed ${prefix}<digest> research report mirror`));
      continue;
    }
    const record = report as Record<string, unknown>;
    // THE L4 LAW — inclusive at the decision instant, exclusive after.
    if (decisionAsOfOk && isTimestampMs(record.asOf) && (record.asOf as number) > (decisionAsOf as number)) {
      errors.push({
        code: 'research_from_the_future',
        path: `${key}.asOf`,
        message: `research report ${JSON.stringify(record.reportId)} was computed at ${JSON.stringify(record.asOf)}, later than the decision instant ${JSON.stringify(decisionAsOf)} — the decision hub never consumes research from the future (L4)`,
      });
    }
    // THE L12 LAWS — one tenant, one project per decision.
    if (record.tenantId !== tenantId) {
      errors.push({
        code: 'tenant_mismatch',
        path: `${key}.tenantId`,
        message: `research report ${JSON.stringify(record.reportId)} carries tenant ${JSON.stringify(record.tenantId)}, not the decision tenant ${JSON.stringify(tenantId)} (L12)`,
      });
    }
    if (record.projectId !== projectId) {
      errors.push({
        code: 'project_mismatch',
        path: `${key}.projectId`,
        message: `research report ${JSON.stringify(record.reportId)} carries project ${JSON.stringify(record.projectId)}, not the decision project ${JSON.stringify(projectId)} (L12)`,
      });
    }
    if (!isNonEmptyString(record.methodId) || !isNonEmptyString(record.methodVersion)) {
      errors.push(invalidField(`${key}.methodVersion`, 'the input must cite its report-composition method version'));
    }
  }
  return errors;
}

// ===========================================================================
// Extraction (deterministic, pure — the synthesis input derivation)
// ===========================================================================

/**
 * The per-lane citation the decision record carries: report id, body
 * version ref, the report's decision instant (`asOf`), tenant/project,
 * method-version refs, observation-citation count, instrument scope and
 * the R45 inherited-confidence copies. STRUCTURED data, never prose.
 */
export interface ResearchInputRef {
  readonly lane: ResearchLane;
  readonly reportId: string;
  readonly bodyVersion: BodyVersionRef;
  /** The report's decision instant — the L4 gate input. */
  readonly asOf: TimestampMs;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  /** The report's composition-method citation, carried verbatim. */
  readonly methodId: string;
  readonly methodVersion: string;
  /** The instruments the input report covers (canonical order). */
  readonly instruments: readonly string[];
  /** How many observation citations the input report carries. */
  readonly observationCitationCount: number;
  /** R45: confidence records copied verbatim from the report's embedded records. */
  readonly inheritedConfidence: readonly InheritedConfidence[];
}

/** Guard: `ResearchInputRef`. */
export function isResearchInputRef(v: unknown): v is ResearchInputRef {
  if (!isRecord(v)) return false;
  return (
    isResearchLane(v.lane) &&
    isNonEmptyString(v.reportId) &&
    isBodyVersionRef(v.bodyVersion) &&
    isTimestampMs(v.asOf) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isArrayOf(v.instruments, isNonEmptyString) &&
    isNonNegativeInteger(v.observationCitationCount) &&
    isArrayOf(v.inheritedConfidence, isInheritedConfidence)
  );
}

/** The instruments of a sentiment report (readings + digests, sorted, unique). */
export function sentimentInstrumentsOf(report: SentimentReportMirror): readonly string[] {
  const instruments = new Set<string>();
  for (const reading of report.readings) instruments.add(reading.scope.instrument);
  for (const digest of report.digests) {
    for (const instrument of digest.instruments) instruments.add(instrument);
  }
  return [...instruments].sort();
}

/** The instruments of a regime report (classifications + changes, sorted, unique). */
export function regimeInstrumentsOf(report: RegimeReportMirror): readonly string[] {
  const instruments = new Set<string>();
  for (const classification of report.classifications) instruments.add(classification.scope.instrument);
  for (const change of report.changes) instruments.add(change.scope.instrument);
  return [...instruments].sort();
}

/** The instruments of a fundamental report (assessments + action digests, sorted, unique). */
export function fundamentalInstrumentsOf(report: FundamentalReportMirror): readonly string[] {
  const instruments = new Set<string>();
  for (const assessment of report.assessments) instruments.add(assessment.scope.instrument);
  for (const digest of report.actionDigests) {
    for (const instrument of digest.instruments) instruments.add(instrument);
  }
  return [...instruments].sort();
}

/** The instruments of a cross-market report (both legs of every pair, sorted, unique). */
export function crossMarketInstrumentsOf(report: CrossMarketReportMirror): readonly string[] {
  const instruments = new Set<string>();
  for (const relationship of report.relationships) {
    instruments.add(relationship.pair.left.instrument);
    instruments.add(relationship.pair.right.instrument);
  }
  return [...instruments].sort();
}

/** The sentiment lane's report-level stance category (the dominant polarity). */
export function sentimentStanceCategoryOf(report: SentimentReportMirror): string {
  return report.summary.dominantPolarity;
}

/** The regime lane's report-level stance category (the dominant regime label). */
export function regimeStanceCategoryOf(report: RegimeReportMirror): string {
  return report.summary.dominantRegime;
}

/** The fundamental lane's report-level stance category (the dominant stance). */
export function fundamentalStanceCategoryOf(report: FundamentalReportMirror): string {
  return report.summary.dominantStance;
}

/** The cross-market lane's report-level stance category (the dominant relation kind). */
export function crossMarketStanceCategoryOf(report: CrossMarketReportMirror): string {
  return report.summary.dominantRelationKind;
}

/** R45: the sentiment report's embedded confidence records, copied verbatim. */
export function sentimentInheritedConfidenceOf(report: SentimentReportMirror): readonly InheritedConfidence[] {
  return deepFreeze(report.readings.map((reading) => ({
    level: reading.confidence.level,
    evidenceCount: reading.confidence.evidenceCount,
  })));
}

/** R45: the regime report's embedded confidence records, copied verbatim. */
export function regimeInheritedConfidenceOf(report: RegimeReportMirror): readonly InheritedConfidence[] {
  return deepFreeze(report.classifications.map((classification) => ({
    level: classification.confidence.level,
    evidenceCount: classification.confidence.evidenceCount,
  })));
}

/** R45: the fundamental report's embedded confidence records, copied verbatim. */
export function fundamentalInheritedConfidenceOf(report: FundamentalReportMirror): readonly InheritedConfidence[] {
  return deepFreeze(report.assessments.map((assessment) => ({
    level: assessment.confidence.level,
    evidenceCount: assessment.confidence.evidenceCount,
  })));
}

/** R45: the cross-market report's embedded confidence records, copied verbatim. */
export function crossMarketInheritedConfidenceOf(report: CrossMarketReportMirror): readonly InheritedConfidence[] {
  return deepFreeze(report.relationships.map((relationship) => ({
    level: relationship.confidence.level,
    evidenceCount: relationship.confidence.evidenceCount,
  })));
}

function citationCountOf(evidenceLists: readonly (readonly unknown[])[]): number {
  let count = 0;
  for (const list of evidenceLists) count += list.length;
  return count;
}

/** Builds the per-lane citation record for a sentiment input (pure, deterministic). */
export function sentimentInputRefOf(report: SentimentReportMirror): ResearchInputRef {
  return deepFreeze({
    lane: 'sentiment' as const,
    reportId: report.reportId,
    bodyVersion: report.bodyVersion,
    asOf: report.asOf,
    tenantId: report.tenantId,
    projectId: report.projectId,
    methodId: report.methodId,
    methodVersion: report.methodVersion,
    instruments: sentimentInstrumentsOf(report),
    observationCitationCount: citationCountOf([
      ...report.readings.map((reading) => reading.evidence),
      ...report.digests.map((digest) => digest.evidence),
    ]),
    inheritedConfidence: sentimentInheritedConfidenceOf(report),
  });
}

/** Builds the per-lane citation record for a regime input (pure, deterministic). */
export function regimeInputRefOf(report: RegimeReportMirror): ResearchInputRef {
  return deepFreeze({
    lane: 'regime' as const,
    reportId: report.reportId,
    bodyVersion: report.bodyVersion,
    asOf: report.asOf,
    tenantId: report.tenantId,
    projectId: report.projectId,
    methodId: report.methodId,
    methodVersion: report.methodVersion,
    instruments: regimeInstrumentsOf(report),
    observationCitationCount: citationCountOf([
      ...report.classifications.map((classification) => classification.evidence),
      ...report.changes.map((change) => change.evidence),
    ]),
    inheritedConfidence: regimeInheritedConfidenceOf(report),
  });
}

/** Builds the per-lane citation record for a fundamental input (pure, deterministic). */
export function fundamentalInputRefOf(report: FundamentalReportMirror): ResearchInputRef {
  return deepFreeze({
    lane: 'fundamental' as const,
    reportId: report.reportId,
    bodyVersion: report.bodyVersion,
    asOf: report.asOf,
    tenantId: report.tenantId,
    projectId: report.projectId,
    methodId: report.methodId,
    methodVersion: report.methodVersion,
    instruments: fundamentalInstrumentsOf(report),
    observationCitationCount: citationCountOf([
      ...report.assessments.map((assessment) => assessment.evidence),
      ...report.actionDigests.map((digest) => digest.evidence),
    ]),
    inheritedConfidence: fundamentalInheritedConfidenceOf(report),
  });
}

/** Builds the per-lane citation record for a cross-market input (pure, deterministic). */
export function crossMarketInputRefOf(report: CrossMarketReportMirror): ResearchInputRef {
  return deepFreeze({
    lane: 'cross-market' as const,
    reportId: report.reportId,
    bodyVersion: report.bodyVersion,
    asOf: report.asOf,
    tenantId: report.tenantId,
    projectId: report.projectId,
    methodId: report.methodId,
    methodVersion: report.methodVersion,
    instruments: crossMarketInstrumentsOf(report),
    observationCitationCount: citationCountOf([report.relationships.map((relationship) => relationship.evidence)]),
    inheritedConfidence: crossMarketInheritedConfidenceOf(report),
  });
}

