// @tradrl/example-e2e-trading — TRADING DIRECTOR MIRRORS.
//
// Structural mirrors of the decision hub (bodies/trading-director — T024):
// the declared synthesis-method discipline, the four-lane intake
// citations, coverage/conflict accounting, the portfolio directive and the
// DirectorDecision / EscalationRecord shapes.
// tests/end-to-end-trading/interop.test.ts validates this slice's
// decisions under the REAL director validator + method registry.

import type { TenantId, ProjectId, BodyVersionRef } from '../ids';
import type { GoalVersionRefMirror, ConstraintSetVersionRefMirror } from './control';
import type { ConfidenceLevelMirror, InheritedConfidenceMirror } from './research';

// ---------------------------------------------------------------------------
// The declared synthesis method (bodies/trading-director methods.ts)
// ---------------------------------------------------------------------------

export const RESEARCH_LANES = ['sentiment', 'regime', 'fundamental', 'cross-market'] as const;
export type ResearchLane = (typeof RESEARCH_LANES)[number];

export const SYNTHESIS_DIRECTIONS = ['bullish', 'bearish', 'flat'] as const;
export type SynthesisDirection = (typeof SYNTHESIS_DIRECTIONS)[number];

export const CONFLICT_POLICIES = ['record-and-majority', 'escalate-on-no-majority', 'escalate-on-any'] as const;
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];

export interface StanceMapEntryMirror {
  readonly lane: ResearchLane;
  readonly category: string;
  readonly direction: SynthesisDirection;
}

export interface LaneWeightEntryMirror {
  readonly lane: ResearchLane;
  readonly weight: string;
}

export interface SynthesisParametersMirror {
  readonly kind: 'synthesis';
  readonly input: 'research-reports';
  readonly quorum: number;
  readonly stanceMap: readonly StanceMapEntryMirror[];
  readonly unmappedCategory: 'flat';
  readonly laneWeights: readonly LaneWeightEntryMirror[];
  readonly tiltUnit: string;
  readonly adjustmentThreshold: string;
  readonly outputScale: number;
  readonly rounding: 'half-even' | 'truncate';
  readonly conflictPolicy: ConflictPolicy;
}

export interface MethodRecordMirror {
  readonly methodId: string;
  readonly kind: 'synthesis';
  readonly version: string;
  readonly parameters: SynthesisParametersMirror;
  readonly declaredBy: string;
  readonly declaredAt: number;
}

export interface MethodRegistryMirror {
  readonly methods: readonly MethodRecordMirror[];
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Intake citations (bodies/trading-director intake.ts)
// ---------------------------------------------------------------------------

export interface ResearchInputRefMirror {
  readonly lane: ResearchLane;
  readonly reportId: string;
  readonly bodyVersion: BodyVersionRef;
  readonly asOf: number;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly instruments: readonly string[];
  readonly observationCitationCount: number;
  readonly inheritedConfidence: readonly InheritedConfidenceMirror[];
}

// ---------------------------------------------------------------------------
// Coverage + conflicts + directive (bodies/trading-director decision.ts)
// ---------------------------------------------------------------------------

export type LaneCoverageStatusMirror = 'consumed' | 'conflicted' | 'absent';

export interface LanePositionMirror {
  readonly lane: ResearchLane;
  readonly direction: SynthesisDirection;
  readonly category: string;
  readonly mapped: boolean;
}

export interface LaneCoverageMirror {
  readonly lane: ResearchLane;
  readonly status: LaneCoverageStatusMirror;
  readonly position: LanePositionMirror | null;
  readonly absence: { readonly lane: ResearchLane; readonly reason: 'no-report-received' } | null;
}

export interface ConflictPositionMirror {
  readonly lane: ResearchLane;
  readonly direction: SynthesisDirection;
  readonly reportId: string;
}

export interface LaneConflictMirror {
  readonly instrumentId: string;
  readonly positions: readonly ConflictPositionMirror[];
  readonly majorityDirection: SynthesisDirection | null;
}

export interface DirectivePositionMirror {
  readonly lane: ResearchLane;
  readonly direction: SynthesisDirection;
  readonly reportId: string;
}

export interface TargetAllocationAdjustmentMirror {
  readonly instrumentId: string;
  readonly deltaWeight: string;
  readonly netTilt: string;
  readonly positions: readonly DirectivePositionMirror[];
}

export interface AllocationAdjustmentDirectiveMirror {
  readonly kind: 'allocation-adjustment';
  readonly adjustments: readonly TargetAllocationAdjustmentMirror[];
}

export type NoChangeReasonMirror = 'insufficient-signal' | 'flat-consensus' | 'no-covered-instruments';

export interface NoChangeDirectiveMirror {
  readonly kind: 'no-change';
  readonly reason: NoChangeReasonMirror;
  readonly instrumentTilts: readonly { readonly instrumentId: string; readonly netTilt: string }[];
}

export type PortfolioDirectiveMirror =
  | AllocationAdjustmentDirectiveMirror
  | NoChangeDirectiveMirror;

// ---------------------------------------------------------------------------
// The decision + escalation records
// ---------------------------------------------------------------------------

export interface DirectorDecisionMirror {
  readonly decisionId: string;
  readonly asOf: number;
  readonly bodyVersion: BodyVersionRef;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly goal: GoalVersionRefMirror;
  readonly constraintSets: readonly ConstraintSetVersionRefMirror[];
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly inputs: readonly ResearchInputRefMirror[];
  readonly coverage: readonly LaneCoverageMirror[];
  readonly conflicts: readonly LaneConflictMirror[];
  readonly directive: PortfolioDirectiveMirror;
}

export type EscalationReasonMirror = 'quorum-unmet' | 'irreconcilable-conflict';

export interface DirectorEscalationMirror {
  readonly escalationId: string;
  readonly reason: EscalationReasonMirror;
  readonly asOf: number;
  readonly bodyVersion: BodyVersionRef;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly goal: GoalVersionRefMirror;
  readonly constraintSets: readonly ConstraintSetVersionRefMirror[];
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly inputs: readonly ResearchInputRefMirror[];
  readonly coverage: readonly LaneCoverageMirror[];
  readonly conflicts: readonly LaneConflictMirror[];
  readonly quorum: { readonly declaredQuorum: number; readonly presentLanes: number; readonly absentLanes: readonly ResearchLane[] } | null;
}

export type DirectorOutcomeMirror =
  | { readonly kind: 'decision'; readonly decision: DirectorDecisionMirror }
  | { readonly kind: 'escalation'; readonly escalation: DirectorEscalationMirror };

// ---------------------------------------------------------------------------
// The per-lane stance category each report's summary carries (the
// report-level dominant category the stance map maps).
// ---------------------------------------------------------------------------

export function sentimentStanceCategoryOf(report: {
  readonly summary: { readonly dominantPolarity: string };
}): string {
  return report.summary.dominantPolarity;
}

export function regimeStanceCategoryOf(report: {
  readonly summary: { readonly dominantRegime: string };
}): string {
  return report.summary.dominantRegime;
}

export function fundamentalStanceCategoryOf(report: {
  readonly summary: { readonly dominantStance: string };
}): string {
  return report.summary.dominantStance;
}

export function crossMarketStanceCategoryOf(report: {
  readonly summary: { readonly dominantRelationKind: string };
}): string {
  return report.summary.dominantRelationKind;
}
