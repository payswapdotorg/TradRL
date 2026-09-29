// @tradrl/body-trading-director — the decision records.
//
// Owning Work Order: T024, "Synthesis and the decision record":
// "DirectorDecision: structured data, never prose — the four input
// report refs, synthesis method version, goal ref + constraint-set refs
// (mirrors of trading-strategy's GoalVersionRef/ConstraintSetVersionRef),
// tenant/project (L12), seed, asOf, and a structured portfolio-level
// directive the strategy lane can bind (target-allocation adjustments,
// or a typed no-change verdict). Deterministic: same (inputs, method,
// seed) -> byte-identical decisions (canonical JSON + stable digest;
// golden test run twice)."
//
// "ESCALATION: when quorum is unmet or conflicts are irreconcilable
// under the declared method, the output is an EscalationRecord (the
// kernel ESCALATE verb) — a record, never an exception, never a silent
// default."
//
// Coverage accounting (the four-lane law): every one of the four lanes
// is accounted as `consumed | conflicted | absent`. A missing lane
// produces a typed absence record — never silence. Conflicting positions
// produce typed conflict records with per-body positions — never a
// silent average.
//
// THE L16 LAW: the directive is PORTFOLIO-LEVEL. Order-level lifecycle
// records belong to the execution body (T025) on a different clock; a
// directive draft carrying order-level shape is the typed
// `order_level_control` error.
//
// Validation re-derives nothing it cannot recompute cheaply (the
// synthesis function is the composer) — it enforces the RECORD laws:
// structure, the four-lane coverage totality, input/coverage consistency,
// canonical ordering, closed vocabularies, method honesty, tenant/project
// (L12), goal/constraint ref shapes (L9/L15), and the derived-id tamper
// trip-wire (digest_mismatch).

import {
  type TimestampMs,
  type JsonValue,
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  isArrayOf,
  isMemberOf,
  stableDigest,
} from './primitives';
import {
  type BodyVersionRef,
  type ConstraintSetVersionRef,
  type DirectorDecisionId,
  type EscalationRecordId,
  type GoalVersionRef,
  type MethodId,
  type MethodVersionRef,
  type ProjectId,
  type TenantId,
  isBodyVersionRef,
  isConstraintSetVersionRef,
  isDirectorDecisionId,
  isEscalationRecordId,
  isGoalVersionRef,
  isMethodId,
  isMethodVersionRef,
  isProjectId,
  isTenantId,
} from './ids';
import {
  type MethodRegistry,
  type ResearchLane,
  type SynthesisDirection,
  RESEARCH_LANES,
  isResearchLane,
  isSynthesisDirection,
  resolveMethodCitation,
} from './methods';
import {
  type ResearchInputRef,
  isResearchInputRef,
} from './intake';
import { isSignedDecimal } from './decimals';
import {
  type DirectorError,
  type DirectorResult,
  type DirectorValidation,
  invalidField,
  invalidType,
  validationOf,
} from './errors';

// ---------------------------------------------------------------------------
// Coverage accounting (the four-lane law — nothing silently dropped)
// ---------------------------------------------------------------------------

/** The closed coverage-status vocabulary: every lane is one of these. */
export const LANE_COVERAGE_STATUSES = ['consumed', 'conflicted', 'absent'] as const;

/** A lane coverage status. */
export type LaneCoverageStatus = (typeof LANE_COVERAGE_STATUSES)[number];

/** Guard: a lane coverage status. */
export const isLaneCoverageStatus = (v: unknown): v is LaneCoverageStatus =>
  isMemberOf(LANE_COVERAGE_STATUSES, v);

/**
 * A present lane's position: the direction its report-level stance
 * category contributed, the verbatim category, and whether the declared
 * stance map mapped it or the declared `unmappedCategory` fallback
 * applied (an unmapped category is never a guess).
 */
export interface LanePosition {
  readonly lane: ResearchLane;
  readonly direction: SynthesisDirection;
  /** The lane's report-level dominant category, carried verbatim. */
  readonly category: string;
  /** `true` when the declared stance map mapped the category; `false` when the declared flat fallback applied. */
  readonly mapped: boolean;
}

/** Guard: `LanePosition`. */
export function isLanePosition(v: unknown): v is LanePosition {
  if (!isRecord(v)) return false;
  return (
    isResearchLane(v.lane) &&
    isSynthesisDirection(v.direction) &&
    isNonEmptyString(v.category) &&
    typeof v.mapped === 'boolean'
  );
}

/**
 * THE typed absence record: a missing lane is ACCOUNTED, never silent.
 */
export interface LaneAbsence {
  readonly lane: ResearchLane;
  readonly reason: 'no-report-received';
}

/** Guard: `LaneAbsence`. */
export function isLaneAbsence(v: unknown): v is LaneAbsence {
  if (!isRecord(v)) return false;
  return isResearchLane(v.lane) && v.reason === 'no-report-received';
}

/**
 * One lane's coverage accounting entry. `status` is a total function:
 * 'conflicted' when the lane's position appears in any conflict record;
 else 'consumed' when its report was accepted; 'absent' (with the typed
 absence record) when no report arrived.
 */
export interface LaneCoverage {
  readonly lane: ResearchLane;
  readonly status: LaneCoverageStatus;
  /** Present iff `status !== 'absent'`. */
  readonly position: LanePosition | null;
  /** Present iff `status === 'absent'` (the typed absence record). */
  readonly absence: LaneAbsence | null;
}

/** Guard: `LaneCoverage`. */
export function isLaneCoverage(v: unknown): v is LaneCoverage {
  if (!isRecord(v)) return false;
  if (!isResearchLane(v.lane)) return false;
  if (!isLaneCoverageStatus(v.status)) return false;
  if (v.status === 'absent') {
    return v.position === null && isLaneAbsence(v.absence);
  }
  return isLanePosition(v.position) && v.absence === null;
}

// ---------------------------------------------------------------------------
// Typed conflict records (per-body positions — never a silent average)
// ---------------------------------------------------------------------------

/** One body's position inside a conflict record. */
export interface ConflictPosition {
  readonly lane: ResearchLane;
  readonly direction: SynthesisDirection;
  /** The report the position came from (per-body attribution). */
  readonly reportId: string;
}

/** Guard: `ConflictPosition`. */
export function isConflictPosition(v: unknown): v is ConflictPosition {
  if (!isRecord(v)) return false;
  return (
    isResearchLane(v.lane) &&
    isSynthesisDirection(v.direction) &&
    isNonEmptyString(v.reportId)
  );
}

/**
 * A typed conflict record: the instrument where per-body positions
 * disagree, every non-flat position (per-body attribution, canonical
 * lane order), and the strict-majority direction among them — `null`
 * when the positions tie (no strict majority exists).
 */
export interface LaneConflict {
  readonly instrumentId: string;
  readonly positions: readonly ConflictPosition[];
  /** The strict-majority direction among `positions`, or `null` on a tie. */
  readonly majorityDirection: SynthesisDirection | null;
}

/** Guard: `LaneConflict`. */
export function isLaneConflict(v: unknown): v is LaneConflict {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.instrumentId) &&
    isArrayOf(v.positions, isConflictPosition) &&
    (v.positions as readonly unknown[]).length >= 2 &&
    (v.majorityDirection === null || isSynthesisDirection(v.majorityDirection))
  );
}

// ---------------------------------------------------------------------------
// The portfolio-level directive (L16 — strategic, never order-level)
// ---------------------------------------------------------------------------

/**
 * One instrument's position record inside a directive — the per-lane
 * attribution of an adjustment or tilt.
 */
export interface DirectivePosition {
  readonly lane: ResearchLane;
  readonly direction: SynthesisDirection;
  readonly reportId: string;
}

/** Guard: `DirectivePosition`. */
export function isDirectivePosition(v: unknown): v is DirectivePosition {
  return isConflictPosition(v);
}

/**
 * A target-allocation adjustment: the instrument, the signed decimal
 * weight delta (at the method's declared scale), the exact net tilt it
 * was derived from, and the per-lane positions that produced it.
 */
export interface TargetAllocationAdjustment {
  readonly instrumentId: string;
  /** Signed decimal weight delta (the strategy lane binds this). */
  readonly deltaWeight: string;
  /** The exact net tilt (declared lane weights x direction signs) at the declared scale. */
  readonly netTilt: string;
  readonly positions: readonly DirectivePosition[];
}

/** Guard: `TargetAllocationAdjustment`. */
export function isTargetAllocationAdjustment(v: unknown): v is TargetAllocationAdjustment {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.instrumentId) &&
    isSignedDecimal(v.deltaWeight) &&
    isNonEmptyString(v.netTilt) &&
    isArrayOf(v.positions, isDirectivePosition)
  );
}

/**
 * THE allocation-adjustment directive: target-allocation adjustments in
 * canonical (sorted instrumentId) order — never empty (an empty
 * adjustment set is a no-change verdict instead).
 */
export interface AllocationAdjustmentDirective {
  readonly kind: 'allocation-adjustment';
  readonly adjustments: readonly TargetAllocationAdjustment[];
}

/** Guard: `AllocationAdjustmentDirective`. */
export function isAllocationAdjustmentDirective(v: unknown): v is AllocationAdjustmentDirective {
  if (!isRecord(v)) return false;
  return (
    v.kind === 'allocation-adjustment' &&
    isArrayOf(v.adjustments, isTargetAllocationAdjustment) &&
    (v.adjustments as readonly unknown[]).length > 0
  );
}

/** The closed no-change verdict vocabulary (typed, never prose). */
export const NO_CHANGE_REASONS = [
  'insufficient-signal',
  'flat-consensus',
  'no-covered-instruments',
] as const;

/** A typed no-change reason. */
export type NoChangeReason = (typeof NO_CHANGE_REASONS)[number];

/** Guard: a typed no-change reason. */
export const isNoChangeReason = (v: unknown): v is NoChangeReason =>
  isMemberOf(NO_CHANGE_REASONS, v);

/** One instrument's recorded net tilt (the structured evidence of a no-change). */
export interface InstrumentTilt {
  readonly instrumentId: string;
  readonly netTilt: string;
}

/** Guard: `InstrumentTilt`. */
export function isInstrumentTilt(v: unknown): v is InstrumentTilt {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.instrumentId) && isNonEmptyString(v.netTilt);
}

/**
 * THE typed no-change verdict: the director explicitly decided not to
 * adjust, with the typed reason and the per-instrument net tilts that
 * fell below the declared threshold (structured evidence — the learning
 * loop consumes this record).
 */
export interface NoChangeDirective {
  readonly kind: 'no-change';
  readonly reason: NoChangeReason;
  readonly instrumentTilts: readonly InstrumentTilt[];
}

/** Guard: `NoChangeDirective`. */
export function isNoChangeDirective(v: unknown): v is NoChangeDirective {
  if (!isRecord(v)) return false;
  return (
    v.kind === 'no-change' &&
    isNoChangeReason(v.reason) &&
    isArrayOf(v.instrumentTilts, isInstrumentTilt)
  );
}

/** THE portfolio-level directive: adjustments, or a typed no-change verdict. */
export type PortfolioDirective = AllocationAdjustmentDirective | NoChangeDirective;

/** Guard: `PortfolioDirective` (structure only — the L16 scan included). */
export function isPortfolioDirective(v: unknown): v is PortfolioDirective {
  if (!isRecord(v)) return false;
  // THE L16 LAW: a directive shaped like order-level control is refused
  // (the guard half — the validator reports the typed error).
  if (typeof v.kind === 'string' && /(order|execution|placement|ticket)/i.test(v.kind)) {
    return false;
  }
  return isAllocationAdjustmentDirective(v) || isNoChangeDirective(v);
}

// ---------------------------------------------------------------------------
// DirectorDecision
// ---------------------------------------------------------------------------

/**
 * THE decision record: structured data, never prose. The four input
 * report refs (present lanes only, canonical lane order), the synthesis
 * method citation, the goal ref + constraint-set refs (trading-strategy
 * mirrors — the strategy lane binds the SAME refs), tenant/project,
 * seed, the decision instant, the four-lane coverage accounting, the
 * typed conflict records, and the portfolio-level directive. The id is
 * DERIVED (`dd-<digest>`), never random.
 */
export interface DirectorDecision {
  readonly decisionId: DirectorDecisionId;
  /** The decision instant (the L4 gate's reference point). */
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly methodId: MethodId;
  readonly methodVersion: MethodVersionRef;
  readonly goal: GoalVersionRef;
  readonly constraintSets: readonly ConstraintSetVersionRef[];
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly inputs: readonly ResearchInputRef[];
  readonly coverage: readonly LaneCoverage[];
  readonly conflicts: readonly LaneConflict[];
  readonly directive: PortfolioDirective;
}

/** Derives the decision id: `dd-<stableDigest16>` over the canonical form. */
export function deriveDirectorDecisionId(
  decision: Omit<DirectorDecision, 'decisionId'>,
): DirectorDecisionId {
  return `dd-${stableDigest(canonicalJson(decision as unknown as JsonValue))}` as DirectorDecisionId;
}

/** Guard: `DirectorDecision` (structure only — use `validateDirectorDecision` for the laws). */
export function isDirectorDecision(v: unknown): v is DirectorDecision {
  if (!isRecord(v)) return false;
  return (
    typeof v.decisionId === 'string' &&
    (v.decisionId as string).startsWith('dd-') &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isMethodId(v.methodId) &&
    isMethodVersionRef(v.methodVersion) &&
    isGoalVersionRef(v.goal) &&
    isArrayOf(v.constraintSets, isConstraintSetVersionRef) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    isArrayOf(v.inputs, isResearchInputRef) &&
    isArrayOf(v.coverage, isLaneCoverage) &&
    isArrayOf(v.conflicts, isLaneConflict) &&
    isPortfolioDirective(v.directive)
  );
}

// ---------------------------------------------------------------------------
// EscalationRecord (the kernel ESCALATE verb — a record, never an exception)
// ---------------------------------------------------------------------------

/** The closed escalation-reason vocabulary. */
export const ESCALATION_REASONS = ['quorum-unmet', 'irreconcilable-conflict'] as const;

/** A typed escalation reason. */
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

/** Guard: a typed escalation reason. */
export const isEscalationReason = (v: unknown): v is EscalationReason =>
  isMemberOf(ESCALATION_REASONS, v);

/** The quorum detail a 'quorum-unmet' escalation carries (structured, never prose). */
export interface QuorumDetail {
  /** The method's declared quorum. */
  readonly declaredQuorum: number;
  /** How many lanes were present. */
  readonly presentLanes: number;
  /** Which lanes were absent. */
  readonly absentLanes: readonly ResearchLane[];
}

/** Guard: `QuorumDetail`. */
export function isQuorumDetail(v: unknown): v is QuorumDetail {
  if (!isRecord(v)) return false;
  return (
    typeof v.declaredQuorum === 'number' &&
    Number.isInteger(v.declaredQuorum) &&
    v.declaredQuorum >= 1 &&
    typeof v.presentLanes === 'number' &&
    Number.isInteger(v.presentLanes) &&
    v.presentLanes >= 0 &&
    isArrayOf(v.absentLanes, isResearchLane)
  );
}

/**
 * THE escalation record (the kernel ESCALATE verb): produced when the
 * declared quorum is unmet or conflicts are irreconcilable under the
 * declared method. A RECORD, never an exception, never a silent
 * default. Carries the same lineage as a decision: inputs, coverage,
 * conflicts, method citation, goal/constraint refs, tenant/project,
 * seed, asOf. The id is DERIVED (`esc-<digest>`), never random.
 */
export interface EscalationRecord {
  readonly escalationId: EscalationRecordId;
  readonly reason: EscalationReason;
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly methodId: MethodId;
  readonly methodVersion: MethodVersionRef;
  readonly goal: GoalVersionRef;
  readonly constraintSets: readonly ConstraintSetVersionRef[];
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly inputs: readonly ResearchInputRef[];
  readonly coverage: readonly LaneCoverage[];
  readonly conflicts: readonly LaneConflict[];
  /** Present iff `reason === 'quorum-unmet'`. */
  readonly quorum: QuorumDetail | null;
}

/** Derives the escalation id: `esc-<stableDigest16>` over the canonical form. */
export function deriveEscalationRecordId(
  escalation: Omit<EscalationRecord, 'escalationId'>,
): EscalationRecordId {
  return `esc-${stableDigest(canonicalJson(escalation as unknown as JsonValue))}` as EscalationRecordId;
}

/** Guard: `EscalationRecord` (structure only — use `validateEscalationRecord` for the laws). */
export function isEscalationRecord(v: unknown): v is EscalationRecord {
  if (!isRecord(v)) return false;
  return (
    typeof v.escalationId === 'string' &&
    (v.escalationId as string).startsWith('esc-') &&
    isEscalationReason(v.reason) &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isMethodId(v.methodId) &&
    isMethodVersionRef(v.methodVersion) &&
    isGoalVersionRef(v.goal) &&
    isArrayOf(v.constraintSets, isConstraintSetVersionRef) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    isArrayOf(v.inputs, isResearchInputRef) &&
    isArrayOf(v.coverage, isLaneCoverage) &&
    isArrayOf(v.conflicts, isLaneConflict) &&
    (v.quorum === null || isQuorumDetail(v.quorum))
  );
}

// ---------------------------------------------------------------------------
// Shared record laws (collect-all — every law, every violation)
// ---------------------------------------------------------------------------

function validateLineageCarriers(
  v: Record<string, unknown>,
  path: string,
  registry: MethodRegistry,
  errors: DirectorError[],
): void {
  if (!isTimestampMs(v.asOf)) errors.push(invalidField(`${path}asOf`, 'must be a valid epoch-millisecond instant'));
  if (!isBodyVersionRef(v.bodyVersion)) {
    errors.push(invalidField(`${path}bodyVersion`, 'must be a canonical body-version reference'));
  }
  errors.push(
    ...resolveMethodCitation(registry, v.methodId, v.methodVersion, 'synthesis').map((e) => ({
      ...e,
      path: `${path}method.${e.path}`,
    })),
  );
  if (!isGoalVersionRef(v.goal)) {
    errors.push({
      code: 'goal_ref_malformed',
      path: `${path}goal`,
      message: 'the goal version ref must be { goalId, version } — the mirror of trading-strategy\'s shape (L9/L15)',
    });
  }
  if (!isArrayOf(v.constraintSets, isConstraintSetVersionRef)) {
    errors.push({
      code: 'constraint_ref_malformed',
      path: `${path}constraintSets`,
      message: 'every constraint-set ref must be { id, version } — the mirror of trading-strategy\'s shape (L9/L15)',
    });
  }
  if (!isTenantId(v.tenantId)) {
    errors.push({ code: 'tenant_missing', path: `${path}tenantId`, message: 'every decision record carries a TenantId (L12)' });
  }
  if (!isProjectId(v.projectId)) {
    errors.push({ code: 'project_missing', path: `${path}projectId`, message: 'every decision record carries a ProjectId (L12)' });
  }
  if (!isNonEmptyString(v.seed)) errors.push(invalidField(`${path}seed`, 'must be a non-empty seed string'));
}

/**
 * THE COVERAGE LAW (collect-all): the record must account EVERY one of
 * the four lanes exactly once, in canonical lane order; a present input
 * must have a non-absent coverage entry; a missing lane MUST carry the
 * typed absence record (never silence); input lanes and coverage
 * entries must agree; report ids must be unique (no double-counting one
 * publication as two lanes).
 */
function validateCoverageAndInputs(
  v: Record<string, unknown>,
  path: string,
  errors: DirectorError[],
): void {
  const inputs = Array.isArray(v.inputs) ? (v.inputs as readonly unknown[]) : null;
  const coverage = Array.isArray(v.coverage) ? (v.coverage as readonly unknown[]) : null;
  const validInputs = inputs !== null ? inputs.filter(isResearchInputRef) : [];
  const inputLanes = validInputs.map((input) => input.lane);
  if (new Set(inputLanes).size !== inputLanes.length) {
    errors.push({
      code: 'duplicate_input_report',
      path: `${path}inputs`,
      message: 'each lane may cite at most one input report',
    });
  }
  const inputReportIds = validInputs.map((input) => input.reportId);
  if (new Set(inputReportIds).size !== inputReportIds.length) {
    errors.push({
      code: 'duplicate_input_report',
      path: `${path}inputs`,
      message: 'the same research report cannot be cited as two lanes',
    });
  }
  const canonicalLaneOrder = validInputs.map((input) => RESEARCH_LANES.indexOf(input.lane));
  for (let index = 1; index < canonicalLaneOrder.length; index++) {
    if ((canonicalLaneOrder[index] as number) <= (canonicalLaneOrder[index - 1] as number)) {
      errors.push(invalidField(`${path}inputs`, 'input refs must be in canonical lane order (sentiment, regime, fundamental, cross-market)'));
      break;
    }
  }
  if (coverage === null) {
    errors.push(invalidType(`${path}coverage`, 'an array of lane coverage entries'));
    return;
  }
  const validEntries = coverage.filter(isLaneCoverage);
  const accountedLanes = validEntries.map((entry) => entry.lane);
  for (const lane of RESEARCH_LANES) {
    if (!accountedLanes.includes(lane)) {
      errors.push({
        code: 'lane_not_accounted',
        path: `${path}coverage`,
        message: `lane ${JSON.stringify(lane)} is not accounted — every one of the four lanes is consumed, conflicted or absent, never silent`,
      });
    }
  }
  if (new Set(accountedLanes).size !== accountedLanes.length) {
    errors.push({
      code: 'lane_not_accounted',
      path: `${path}coverage`,
      message: 'each lane must be accounted exactly once',
    });
  }
  const expectedOrder = RESEARCH_LANES.map((lane) => accountedLanes.indexOf(lane)).filter((index) => index !== -1);
  for (let index = 1; index < expectedOrder.length; index++) {
    if ((expectedOrder[index] as number) < (expectedOrder[index - 1] as number)) {
      errors.push(invalidField(`${path}coverage`, 'coverage entries must be in canonical lane order'));
      break;
    }
  }
  for (const entry of validEntries) {
    const present = inputLanes.includes(entry.lane);
    if (entry.status === 'absent' && present) {
      errors.push({
        code: 'coverage_status_mismatch',
        path: `${path}coverage.${entry.lane}`,
        message: 'a lane with a cited input report cannot be accounted absent',
      });
    }
    if (entry.status !== 'absent' && !present) {
      errors.push({
        code: 'coverage_status_mismatch',
        path: `${path}coverage.${entry.lane}`,
        message: `lane ${JSON.stringify(entry.lane)} is accounted ${JSON.stringify(entry.status)} but cites no input report`,
      });
    }
    if (entry.status === 'absent' && entry.absence === null) {
      errors.push({
        code: 'lane_absence_record_missing',
        path: `${path}coverage.${entry.lane}`,
        message: 'a missing lane produces a typed absence record — never silence',
      });
    }
  }
  for (const input of validInputs) {
    const entry = validEntries.find((e) => e.lane === input.lane);
    if (entry !== undefined && entry.status !== 'absent' && entry.position !== null && entry.position.direction !== 'flat' && input.instruments.length === 0) {
      errors.push({
        code: 'coverage_status_mismatch',
        path: `${path}coverage.${entry.lane}`,
        message: 'a lane with a non-flat position must cover at least one instrument',
      });
    }
  }
}

/** Validates the directive shape + THE L16 LAW (order-level control refusal). */
function validateDirective(v: Record<string, unknown>, path: string, errors: DirectorError[]): void {
  const directive: unknown = v.directive;
  if (!isRecord(directive)) {
    errors.push(invalidType(`${path}directive`, 'a portfolio-level directive record'));
    return;
  }
  // THE L16 LAW: order-level control is a different body (T025) on a
  // different clock — a directive shaped like order control is refused.
  if (typeof directive.kind === 'string' && /(order|execution|placement|ticket)/i.test(directive.kind)) {
    errors.push({
      code: 'order_level_control',
      path: `${path}directive.kind`,
      message: `directive kind ${JSON.stringify(directive.kind)} is order-level control — order lifecycle belongs to the execution body (T025) on a different clock (L16); this body emits portfolio-level directives only`,
    });
    return;
  }
  if (!isPortfolioDirective(directive)) {
    errors.push({
      code: 'directive_shape_mismatch',
      path: `${path}directive`,
      message: 'must be an allocation-adjustment directive (non-empty, canonical instrument order) or a typed no-change verdict',
    });
    return;
  }
  if (directive.kind === 'allocation-adjustment') {
    const adjustments = directive.adjustments as readonly TargetAllocationAdjustment[];
    const order = adjustments.map((adjustment) => adjustment.instrumentId);
    for (let index = 1; index < order.length; index++) {
      if ((order[index] as string) <= (order[index - 1] as string)) {
        errors.push(invalidField(`${path}directive.adjustments`, 'adjustments must be in canonical (sorted instrumentId) order'));
        break;
      }
    }
    for (const adjustment of adjustments) {
      if (adjustment.positions.length === 0) {
        errors.push({
          code: 'directive_shape_mismatch',
          path: `${path}directive.adjustments.${adjustment.instrumentId}`,
          message: 'an adjustment must carry the per-lane positions that produced it (never an unexplained delta)',
        });
      }
    }
  } else {
    const tilts = directive.instrumentTilts as readonly InstrumentTilt[];
    const order = tilts.map((tilt) => tilt.instrumentId);
    for (let index = 1; index < order.length; index++) {
      if ((order[index] as string) <= (order[index - 1] as string)) {
        errors.push(invalidField(`${path}directive.instrumentTilts`, 'instrument tilts must be in canonical (sorted instrumentId) order'));
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// DirectorDecision validation + creation
// ---------------------------------------------------------------------------

/**
 * COLLECT-ALL validation of a director decision: every record law, the
 * four-lane coverage totality, input/coverage consistency, canonical
 * ordering, the L16 directive scan, method honesty ('synthesis'),
 * goal/constraint ref shapes, tenant/project (L12), and the derived-id
 * tamper trip-wire.
 */
export function validateDirectorDecision(v: unknown, registry: MethodRegistry): readonly DirectorError[] {
  const errors: DirectorError[] = [];
  if (!isRecord(v)) return [invalidType('decision', 'a director decision object')];
  if (typeof v.decisionId !== 'string' || !(v.decisionId as string).startsWith('dd-')) {
    errors.push(invalidField('decisionId', "must be a derived decision id ('dd-<digest>')"));
  }
  validateLineageCarriers(v, '', registry, errors);
  validateCoverageAndInputs(v, '', errors);
  validateDirective(v, '', errors);
  if (!Array.isArray(v.conflicts)) {
    errors.push(invalidType('conflicts', 'an array of typed conflict records'));
  } else {
    const conflicts = v.conflicts as readonly unknown[];
    const validConflicts = conflicts.filter(isLaneConflict);
    const order = validConflicts.map((conflict) => conflict.instrumentId);
    for (let index = 1; index < order.length; index++) {
      if ((order[index] as string) <= (order[index - 1] as string)) {
        errors.push(invalidField('conflicts', 'conflict records must be in canonical (sorted instrumentId) order'));
        break;
      }
    }
    // a lane recorded as conflicted must appear in some conflict position
    const conflictedLanes = new Set<string>();
    for (const conflict of validConflicts) {
      for (const position of conflict.positions) conflictedLanes.add(position.lane);
    }
    const coverage = Array.isArray(v.coverage) ? (v.coverage as readonly unknown[]).filter(isLaneCoverage) : [];
    for (const entry of coverage) {
      if (entry.status === 'conflicted' && !conflictedLanes.has(entry.lane)) {
        errors.push({
          code: 'conflict_record_mismatch',
          path: `coverage.${entry.lane}`,
          message: 'a lane accounted conflicted must appear in a conflict record position',
        });
      }
      if (entry.status === 'consumed' && conflictedLanes.has(entry.lane)) {
        errors.push({
          code: 'conflict_record_mismatch',
          path: `coverage.${entry.lane}`,
          message: 'a lane appearing in a conflict record position must be accounted conflicted',
        });
      }
    }
  }
  // derived-id law (tamper trip-wire)
  if (typeof v.decisionId === 'string' && (v.decisionId as string).startsWith('dd-') && errors.length === 0) {
    const { decisionId: _ignored, ...material } = v as unknown as DirectorDecision;
    void _ignored;
    if (deriveDirectorDecisionId(material as Omit<DirectorDecision, 'decisionId'>) !== v.decisionId) {
      errors.push({
        code: 'digest_mismatch',
        path: 'decisionId',
        message: 'the decision id does not match its canonical content — the record was tampered with',
      });
    }
  }
  return errors;
}

/** Validation wrapper: `DirectorDecision`. */
export function validateDirectorDecisionRecord(v: unknown, registry: MethodRegistry): DirectorValidation<DirectorDecision> {
  const errors = validateDirectorDecision(v, registry);
  return validationOf(errors.length === 0 ? (v as DirectorDecision) : null, errors);
}

/**
 * Creates a validated, deeply-frozen director decision. The
 * `decisionId` is DERIVED from the canonical form of the draft; the
 * draft must satisfy every decision law. Refusal is typed data.
 */
export function createDirectorDecision(
  draft: Omit<DirectorDecision, 'decisionId'>,
  registry: MethodRegistry,
): DirectorResult<DirectorDecision> {
  const errors = validateDirectorDecision({ ...draft, decisionId: 'dd-pending' }, registry).filter(
    (error) => error.path !== 'decisionId',
  );
  if (errors.length > 0) return { ok: false, errors };
  const decisionId = deriveDirectorDecisionId(draft);
  return { ok: true, value: deepFreeze({ ...draft, decisionId }) };
}

// ---------------------------------------------------------------------------
// EscalationRecord validation + creation
// ---------------------------------------------------------------------------

/**
 * COLLECT-ALL validation of an escalation record: the reason vocabulary,
 * the quorum detail law (present iff reason 'quorum-unmet'), the
 * conflict law (an irreconcilable-conflict escalation must carry its
 * blocking conflicts), the shared lineage laws, the coverage law, and
 * the derived-id tamper trip-wire.
 */
export function validateEscalationRecord(v: unknown, registry: MethodRegistry): readonly DirectorError[] {
  const errors: DirectorError[] = [];
  if (!isRecord(v)) return [invalidType('escalation', 'an escalation record object')];
  if (typeof v.escalationId !== 'string' || !(v.escalationId as string).startsWith('esc-')) {
    errors.push(invalidField('escalationId', "must be a derived escalation id ('esc-<digest>')"));
  }
  if (!isEscalationReason(v.reason)) {
    errors.push(invalidField('reason', `must be one of ${ESCALATION_REASONS.join('|')}`));
  }
  if (v.reason === 'quorum-unmet' && !isQuorumDetail(v.quorum)) {
    errors.push(invalidField('quorum', "a 'quorum-unmet' escalation must carry its quorum detail (declared quorum, present lanes, absent lanes)"));
  }
  if (v.reason === 'irreconcilable-conflict') {
    const conflicts = Array.isArray(v.conflicts) ? (v.conflicts as readonly unknown[]).filter(isLaneConflict) : [];
    if (conflicts.length === 0) {
      errors.push({
        code: 'conflict_record_mismatch',
        path: 'conflicts',
        message: "an 'irreconcilable-conflict' escalation must carry the blocking conflict records",
      });
    }
    if (v.quorum !== null) {
      errors.push(invalidField('quorum', "only a 'quorum-unmet' escalation carries quorum detail"));
    }
  }
  validateLineageCarriers(v, '', registry, errors);
  validateCoverageAndInputs(v, '', errors);
  if (!Array.isArray(v.conflicts)) {
    errors.push(invalidType('conflicts', 'an array of typed conflict records'));
  }
  // derived-id law (tamper trip-wire)
  if (typeof v.escalationId === 'string' && (v.escalationId as string).startsWith('esc-') && errors.length === 0) {
    const { escalationId: _ignored, ...material } = v as unknown as EscalationRecord;
    void _ignored;
    if (deriveEscalationRecordId(material as Omit<EscalationRecord, 'escalationId'>) !== v.escalationId) {
      errors.push({
        code: 'digest_mismatch',
        path: 'escalationId',
        message: 'the escalation id does not match its canonical content — the record was tampered with',
      });
    }
  }
  return errors;
}

/** Validation wrapper: `EscalationRecord`. */
export function validateEscalationRecordRecord(v: unknown, registry: MethodRegistry): DirectorValidation<EscalationRecord> {
  const errors = validateEscalationRecord(v, registry);
  return validationOf(errors.length === 0 ? (v as EscalationRecord) : null, errors);
}

/**
 * Creates a validated, deeply-frozen escalation record. The
 * `escalationId` is DERIVED from the canonical form of the draft.
 * Refusal is typed data.
 */
export function createEscalationRecord(
  draft: Omit<EscalationRecord, 'escalationId'>,
  registry: MethodRegistry,
): DirectorResult<EscalationRecord> {
  const errors = validateEscalationRecord({ ...draft, escalationId: 'esc-pending' }, registry).filter(
    (error) => error.path !== 'escalationId',
  );
  if (errors.length > 0) return { ok: false, errors };
  const escalationId = deriveEscalationRecordId(draft);
  return { ok: true, value: deepFreeze({ ...draft, escalationId }) };
}

// ---------------------------------------------------------------------------
// Canonical serialization (byte-deterministic, L9)
// ---------------------------------------------------------------------------

/** Canonical serialization of a decision (byte-deterministic, L9). */
export function serializeDirectorDecision(decision: DirectorDecision): string {
  return canonicalJson(decision as unknown as JsonValue);
}

/** Canonical serialization of an escalation record (byte-deterministic, L9). */
export function serializeEscalationRecord(escalation: EscalationRecord): string {
  return canonicalJson(escalation as unknown as JsonValue);
}
