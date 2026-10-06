// @tradrl/example-e2e-trading — RESEARCH REPORT MIRRORS.
//
// Structural mirrors of the four research bodies' publication records
// (bodies/sentiment-researcher, regime-researcher, fundamental-researcher,
// cross-market-researcher — T021/T022/T023), field-for-field with the
// intake mirrors the Trading Director consumes (bodies/trading-director
// intake.ts). tests/end-to-end-trading/interop.test.ts feeds this
// slice's reports through the REAL research validators under the REAL
// method registries.

import type { TenantId, ProjectId, BodyVersionRef } from '../ids';
import type { ProvenanceMirror } from './market';

// ---------------------------------------------------------------------------
// Shared research vocabulary
// ---------------------------------------------------------------------------

export const EVENT_ORIGINS_MIRROR = ['historical', 'simulated', 'generated'] as const;
export type EventOriginMirror = (typeof EVENT_ORIGINS_MIRROR)[number];

export const CONFIDENCE_LEVELS_MIRROR = ['low', 'moderate', 'high'] as const;
export type ConfidenceLevelMirror = (typeof CONFIDENCE_LEVELS_MIRROR)[number];

export interface IntakeCoverageMirror {
  readonly observationsOffered: number;
  readonly observationsAdmitted: number;
  readonly observationsDeferred: number;
  readonly observationsUnsupported: number;
  readonly observationsInvalid: number;
}

export interface InheritedConfidenceMirror {
  readonly level: ConfidenceLevelMirror;
  readonly evidenceCount: number;
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
// Sentiment (bodies/sentiment-researcher)
// ---------------------------------------------------------------------------

export const POLARITY_DIRECTIONS_MIRROR = ['positive', 'negative', 'neutral', 'mixed'] as const;
export type PolarityDirectionMirror = (typeof POLARITY_DIRECTIONS_MIRROR)[number];

export const INTENSITY_LEVELS_MIRROR = ['low', 'moderate', 'high'] as const;
export type IntensityLevelMirror = (typeof INTENSITY_LEVELS_MIRROR)[number];

export interface SentimentReadingMirror {
  readonly readingId: string;
  readonly scope: { readonly instrument: string; readonly venue: string };
  readonly polarity: MethodCitedAssessmentMirror & { readonly direction: PolarityDirectionMirror; readonly score: string };
  readonly intensity: MethodCitedAssessmentMirror & { readonly level: IntensityLevelMirror; readonly score: string };
  readonly confidence: MethodCitedAssessmentMirror & {
    readonly level: ConfidenceLevelMirror;
    readonly evidenceCount: number;
    readonly dispersion: string | null;
  };
  readonly evidence: readonly CitationMirror[];
  readonly asOf: number;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface EventDigestMirror {
  readonly digestId: string;
  readonly kind: string;
  readonly instruments: readonly string[];
  readonly venues: readonly string[];
  readonly window: { readonly from: number; readonly to: number };
  readonly observationCount: number;
  readonly evidence: readonly CitationMirror[];
  readonly asOf: number;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface SentimentSummaryMirror {
  readonly readingCount: number;
  readonly digestCount: number;
  readonly instrumentCount: number;
  readonly dominantPolarity: string;
  readonly meanPolarityScore: string | null;
  readonly coverage: IntakeCoverageMirror;
  readonly dataGaps: readonly { readonly kind: string; readonly instrument: string }[];
}

export interface SentimentReportMirror {
  readonly reportId: string;
  readonly asOf: number;
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

// ---------------------------------------------------------------------------
// Regime (bodies/regime-researcher)
// ---------------------------------------------------------------------------

export interface RegimeClassificationMirror {
  readonly classificationId: string;
  readonly scope: { readonly instrument: string; readonly venue: string };
  readonly label: string;
  readonly netMoveRatio: string;
  readonly meanAbsChangeRatio: string;
  readonly window: { readonly from: number; readonly to: number };
  readonly observationCount: number;
  readonly evidence: readonly CitationMirror[];
  readonly confidence: MethodCitedAssessmentMirror & {
    readonly level: ConfidenceLevelMirror;
    readonly evidenceCount: number;
    readonly dispersion: string | null;
  };
  readonly asOf: number;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface RegimeChangeMirror {
  readonly changeId: string;
  readonly scope: { readonly instrument: string; readonly venue: string };
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly fromWindow: { readonly from: number; readonly to: number };
  readonly toWindow: { readonly from: number; readonly to: number };
  readonly detectionInstant: number;
  readonly evidence: readonly CitationMirror[];
  readonly asOf: number;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface RegimeSummaryMirror {
  readonly classificationCount: number;
  readonly changeCount: number;
  readonly instrumentCount: number;
  readonly windowCount: number;
  readonly dominantRegime: string;
  readonly meanNetMoveRatio: string | null;
  readonly coverage: IntakeCoverageMirror;
  readonly dataGaps: readonly { readonly kind: string; readonly instrument: string }[];
}

export interface RegimeReportMirror {
  readonly reportId: string;
  readonly asOf: number;
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

// ---------------------------------------------------------------------------
// Fundamental (bodies/fundamental-researcher)
// ---------------------------------------------------------------------------

export const ASSESSMENT_KINDS_MIRROR = ['valuation-level', 'macro-surprise', 'health-indicator'] as const;
export type AssessmentKindMirror = (typeof ASSESSMENT_KINDS_MIRROR)[number];

export const STANCE_DIRECTIONS_MIRROR = ['positive', 'negative', 'neutral'] as const;
export type StanceDirectionMirror = (typeof STANCE_DIRECTIONS_MIRROR)[number];

export interface FundamentalAssessmentMirror {
  readonly assessmentId: string;
  readonly scope: { readonly instrument: string; readonly series: string };
  readonly assessmentKind: AssessmentKindMirror;
  readonly stance: MethodCitedAssessmentMirror & { readonly direction: StanceDirectionMirror; readonly score: string };
  readonly confidence: MethodCitedAssessmentMirror & {
    readonly level: ConfidenceLevelMirror;
    readonly evidenceCount: number;
    readonly dispersion: string | null;
  };
  readonly evidence: readonly CitationMirror[];
  readonly asOf: number;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface CorporateActionDigestMirror {
  readonly digestId: string;
  readonly action: string;
  readonly instruments: readonly string[];
  readonly venues: readonly string[];
  readonly window: { readonly from: number; readonly to: number };
  readonly observationCount: number;
  readonly implication: { readonly direction: string };
  readonly evidence: readonly CitationMirror[];
  readonly asOf: number;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface FundamentalSummaryMirror {
  readonly assessmentCount: number;
  readonly actionDigestCount: number;
  readonly instrumentCount: number;
  readonly dominantStance: string;
  readonly meanStanceScore: string | null;
  readonly coverage: IntakeCoverageMirror;
  readonly dataGaps: readonly { readonly kind: string; readonly instrument: string }[];
}

export interface FundamentalReportMirror {
  readonly reportId: string;
  readonly asOf: number;
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

// ---------------------------------------------------------------------------
// Cross-market (bodies/cross-market-researcher)
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

export interface CrossMarketRelationshipMirror {
  readonly relationshipId: string;
  readonly pair: MarketPairMirror;
  readonly relationKind: RelationshipKindMirror;
  readonly measure: MethodCitedAssessmentMirror & { readonly direction: string; readonly score: string };
  readonly window: { readonly from: number; readonly to: number };
  readonly confidence: MethodCitedAssessmentMirror & {
    readonly level: ConfidenceLevelMirror;
    readonly evidenceCount: number;
    readonly legImbalance: number;
  };
  readonly evidence: readonly {
    readonly leg: 'left' | 'right';
    readonly observationId: string;
    readonly availableTime: number;
    readonly provenance: ProvenanceMirror;
  }[];
  readonly asOf: number;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

export interface CrossMarketSummaryMirror {
  readonly relationshipCount: number;
  readonly pairCount: number;
  readonly instrumentCount: number;
  readonly dominantRelationKind: string;
  readonly meanMeasureScore: string | null;
  readonly coverage: IntakeCoverageMirror;
  readonly dataGaps: readonly { readonly kind: string; readonly instrument: string }[];
}

export interface CrossMarketReportMirror {
  readonly reportId: string;
  readonly asOf: number;
  readonly bodyVersion: BodyVersionRef;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly relationships: readonly CrossMarketRelationshipMirror[];
  readonly summary: CrossMarketSummaryMirror;
}

/** The four-lane bundle the Trading Director consumes. */
export interface ResearchIntakeMirror {
  readonly sentiment: SentimentReportMirror | null;
  readonly regime: RegimeReportMirror | null;
  readonly fundamental: FundamentalReportMirror | null;
  readonly crossMarket: CrossMarketReportMirror | null;
}
