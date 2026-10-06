// @tradrl/example-e2e-trading — STRUCTURAL MIRROR of @tradrl/body-trading-
// director's method registry, decision records and DECLARED synthesis
// discipline (T024, the D-020 decision hub).
//
// D-003/D-004 law: this module imports NOTHING outside the example tree.
// The synthesis below implements the SAME declared law the real package
// implements (quorum, stance map, lane weights, tilts, threshold, conflicts,
// escalation) over the mirrored shapes — the interop trip-wire test runs the
// REAL `composeDirectorDecision` over the same intake and asserts the two
// decisions agree.

import {
  canonicalJson,
  deepFreeze,
  isMemberOf,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
  stableDigest,
  type JsonValue,
} from '../primitives';
import { decimalAbs, decimalMultiply, decimalSum, compareDecimal } from '../decimals';
import { type GoalVersionRef, type ConstraintSetVersionRef, type TenantId, type ProjectId } from '../ids';
import {
  RESEARCH_LANES,
  type CrossMarketReportMirror,
  type FundamentalReportMirror,
  type InheritedConfidenceMirror,
  type RegimeReportMirror,
  type ResearchLane,
  type SentimentReportMirror,
  isResearchLane,
} from './research';

// ---------------------------------------------------------------------------
// Synthesis directions + lanes
// ---------------------------------------------------------------------------

export const SYNTHESIS_DIRECTIONS = ['bullish', 'bearish', 'flat'] as const;
export type SynthesisDirection = (typeof SYNTHESIS_DIRECTIONS)[number];

export const METHOD_KINDS = ['synthesis'] as const;
export const METHOD_INPUTS = ['research-reports'] as const;

export const CONFLICT_POLICIES = [
  'record-and-majority',
  'escalate-on-no-majority',
  'escalate-on-any',
] as const;
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];

// ---------------------------------------------------------------------------
// The declared synthesis method (mirror of T024's methods.ts)
// ---------------------------------------------------------------------------

export interface StanceMapEntry {
  readonly lane: ResearchLane;
  readonly category: string;
  readonly direction: SynthesisDirection;
}

export interface LaneWeightEntry {
  readonly lane: ResearchLane;
  readonly weight: string;
}

export interface SynthesisParameters {
  readonly kind: 'synthesis';
  readonly input: 'research-reports';
  readonly quorum: number;
  readonly stanceMap: readonly StanceMapEntry[];
  readonly unmappedCategory: 'flat';
  readonly laneWeights: readonly LaneWeightEntry[];
  readonly tiltUnit: string;
  readonly adjustmentThreshold: string;
  readonly outputScale: number;
  readonly rounding: 'half-even' | 'truncate';
  readonly conflictPolicy: ConflictPolicy;
}

export interface MethodRecord {
  readonly methodId: string;
  readonly kind: 'synthesis';
  readonly version: string;
  readonly parameters: SynthesisParameters;
  readonly declaredBy: string;
  readonly declaredAt: number;
}

export interface MethodRegistry {
  readonly methods: readonly MethodRecord[];
  readonly digest: string;
}

/** Creates the registry: methods canonically ordered, digest = stableDigestJson({methods}). */
export function createMethodRegistry(methods: readonly MethodRecord[]): MethodRegistry {
  const sorted = [...methods].sort((a, b) =>
    canonicalJson(a as unknown as JsonValue) < canonicalJson(b as unknown as JsonValue) ? -1 : 1,
  );
  return deepFreeze({
    methods: sorted,
    digest: stableDigest(canonicalJson({ methods: sorted } as unknown as JsonValue)),
  });
}

/** Finds a method by id (null when unknown). */
export function findMethod(registry: MethodRegistry, methodId: string): MethodRecord | null {
  return registry.methods.find((method) => method.methodId === methodId) ?? null;
}

/** Typed registry-citation errors (mirror of T024's codes). */
export type MethodCitationError =
  | 'undeclared_method'
  | 'method_version_mismatch'
  | 'method_kind_mismatch';

/** Resolves a method citation against the registry. */
export function resolveMethodCitation(
  registry: MethodRegistry,
  methodId: string,
  version: string,
): { ok: true; method: MethodRecord } | { ok: false; error: MethodCitationError } {
  const method = findMethod(registry, methodId);
  if (method === null) return { ok: false, error: 'undeclared_method' };
  if (method.version !== version) return { ok: false, error: 'method_version_mismatch' };
  return { ok: true, method };
}

// ---------------------------------------------------------------------------
// The canonical director registry (mirror of DIRECTOR_METHOD_REGISTRY)
// ---------------------------------------------------------------------------

const DIRECTOR_STANCE_MAP: readonly StanceMapEntry[] = deepFreeze([
  { lane: 'sentiment', category: 'positive', direction: 'bullish' },
  { lane: 'sentiment', category: 'negative', direction: 'bearish' },
  { lane: 'sentiment', category: 'mixed', direction: 'flat' },
  { lane: 'sentiment', category: 'neutral', direction: 'flat' },
  { lane: 'sentiment', category: 'no-reading', direction: 'flat' },
  { lane: 'regime', category: 'trending-up', direction: 'bullish' },
  { lane: 'regime', category: 'trending-down', direction: 'bearish' },
  { lane: 'regime', category: 'ranging', direction: 'flat' },
  { lane: 'regime', category: 'volatile', direction: 'flat' },
  { lane: 'regime', category: 'quiet', direction: 'flat' },
  { lane: 'regime', category: 'no-classification', direction: 'flat' },
  { lane: 'fundamental', category: 'positive', direction: 'bullish' },
  { lane: 'fundamental', category: 'negative', direction: 'bearish' },
  { lane: 'fundamental', category: 'neutral', direction: 'flat' },
  { lane: 'fundamental', category: 'no-assessment', direction: 'flat' },
  { lane: 'cross-market', category: 'co-movement', direction: 'flat' },
  { lane: 'cross-market', category: 'lead-lag', direction: 'flat' },
  { lane: 'cross-market', category: 'spread-divergence', direction: 'flat' },
  { lane: 'cross-market', category: 'no-relationship', direction: 'flat' },
]);

const LANE_WEIGHTS_ALL_ONE: readonly LaneWeightEntry[] = deepFreeze([
  { lane: 'sentiment', weight: '1' },
  { lane: 'regime', weight: '1' },
  { lane: 'fundamental', weight: '1' },
  { lane: 'cross-market', weight: '1' },
]);

/** The canonical synthesis method (quorum 3, escalate-on-no-majority). */
export const DIRECTOR_SYNTHESIS_METHOD: MethodRecord = deepFreeze({
  methodId: 'method/director/synthesis',
  kind: 'synthesis',
  version: '1.0.0',
  parameters: {
    kind: 'synthesis',
    input: 'research-reports',
    quorum: 3,
    stanceMap: DIRECTOR_STANCE_MAP,
    unmappedCategory: 'flat',
    laneWeights: LANE_WEIGHTS_ALL_ONE,
    tiltUnit: '0.01',
    adjustmentThreshold: '0.02',
    outputScale: 4,
    rounding: 'half-even',
    conflictPolicy: 'escalate-on-no-majority',
  },
  declaredBy: 'tradrl-director-declaration/1',
  declaredAt: 1_780_000_000_000,
});

/** The conservative variant (quorum 4, escalate-on-any). */
export const DIRECTOR_CONSERVATIVE_SYNTHESIS_METHOD: MethodRecord = deepFreeze({
  methodId: 'method/director/synthesis-conservative',
  kind: 'synthesis',
  version: '1.0.0',
  parameters: {
    kind: 'synthesis',
    input: 'research-reports',
    quorum: 4,
    stanceMap: DIRECTOR_STANCE_MAP,
    unmappedCategory: 'flat',
    laneWeights: LANE_WEIGHTS_ALL_ONE,
    tiltUnit: '0.01',
    adjustmentThreshold: '0.02',
    outputScale: 4,
    rounding: 'half-even',
    conflictPolicy: 'escalate-on-any',
  },
  declaredBy: 'tradrl-director-declaration/1',
  declaredAt: 1_780_000_000_000,
});

/** The canonical registry (digest mirrors the real DIRECTOR_METHOD_REGISTRY). */
export const DIRECTOR_METHOD_REGISTRY: MethodRegistry = createMethodRegistry([
  DIRECTOR_SYNTHESIS_METHOD,
  DIRECTOR_CONSERVATIVE_SYNTHESIS_METHOD,
]);

// ---------------------------------------------------------------------------
// Research input refs (mirror of T024's ResearchInputRef)
// ---------------------------------------------------------------------------

export interface ResearchInputRef {
  readonly lane: ResearchLane;
  readonly reportId: string;
  readonly bodyVersion: string;
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
// Coverage + conflicts + the directive (mirror of T024's decision.ts)
// ---------------------------------------------------------------------------

export const LANE_COVERAGE_STATUSES = ['consumed', 'conflicted', 'absent'] as const;
export type LaneCoverageStatus = (typeof LANE_COVERAGE_STATUSES)[number];

export interface LanePosition {
  readonly lane: ResearchLane;
  readonly direction: SynthesisDirection;
  readonly category: string;
  readonly mapped: boolean;
}

export interface LaneAbsence {
  readonly lane: ResearchLane;
  readonly reason: 'no-report-received';
}

export interface LaneCoverage {
  readonly lane: ResearchLane;
  readonly status: LaneCoverageStatus;
  readonly position: LanePosition | null;
  readonly absence: LaneAbsence | null;
}

export interface ConflictPosition {
  readonly lane: ResearchLane;
  readonly direction: SynthesisDirection;
  readonly reportId: string;
}

export interface LaneConflict {
  readonly instrumentId: string;
  readonly positions: readonly ConflictPosition[];
  readonly majorityDirection: SynthesisDirection | null;
}

export interface DirectivePosition {
  readonly lane: ResearchLane;
  readonly direction: SynthesisDirection;
  readonly reportId: string;
}

export interface TargetAllocationAdjustment {
  readonly instrumentId: string;
  readonly deltaWeight: string;
  readonly netTilt: string;
  readonly positions: readonly DirectivePosition[];
}

export interface AllocationAdjustmentDirective {
  readonly kind: 'allocation-adjustment';
  readonly adjustments: readonly TargetAllocationAdjustment[];
}

export const NO_CHANGE_REASONS = [
  'insufficient-signal',
  'flat-consensus',
  'no-covered-instruments',
] as const;
export type NoChangeReason = (typeof NO_CHANGE_REASONS)[number];

export interface InstrumentTilt {
  readonly instrumentId: string;
  readonly netTilt: string;
}

export interface NoChangeDirective {
  readonly kind: 'no-change';
  readonly reason: NoChangeReason;
  readonly instrumentTilts: readonly InstrumentTilt[];
}

/** THE portfolio-level directive (L16: never order-level). */
export type PortfolioDirective = AllocationAdjustmentDirective | NoChangeDirective;

export interface DirectorDecision {
  readonly decisionId: string; // 'dd-' + 16-hex digest
  readonly asOf: number;
  readonly bodyVersion: string;
  readonly methodId: string;
  readonly methodVersion: string;
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

export const ESCALATION_REASONS = ['quorum-unmet', 'irreconcilable-conflict'] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export interface QuorumDetail {
  readonly declaredQuorum: number;
  readonly presentLanes: number;
  readonly absentLanes: readonly ResearchLane[];
}

export interface EscalationRecord {
  readonly escalationId: string; // 'esc-' + 16-hex digest
  readonly reason: EscalationReason;
  readonly asOf: number;
  readonly bodyVersion: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly goal: GoalVersionRef;
  readonly constraintSets: readonly ConstraintSetVersionRef[];
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly inputs: readonly ResearchInputRef[];
  readonly coverage: readonly LaneCoverage[];
  readonly conflicts: readonly LaneConflict[];
  readonly quorum: QuorumDetail | null;
}

// ---------------------------------------------------------------------------
// The composition law (mirror of T024's synthesis.ts — the SAME algorithm)
// ---------------------------------------------------------------------------

/** The director composition input. */
export interface DirectorCompositionInput {
  readonly asOf: number;
  readonly goal: GoalVersionRef;
  readonly constraintSets: readonly ConstraintSetVersionRef[];
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly methodId: string;
  readonly registry: MethodRegistry;
  readonly bodyVersion: string;
  readonly intake: {
    readonly sentiment: SentimentReportMirror | null;
    readonly regime: RegimeReportMirror | null;
    readonly fundamental: FundamentalReportMirror | null;
    readonly crossMarket: CrossMarketReportMirror | null;
  };
}

/** The typed composition error codes (mirror of the director lane). */
export type DirectorCompositionErrorCode =
  | 'research_from_the_future'
  | 'tenant_mismatch'
  | 'project_mismatch'
  | 'undeclared_method'
  | 'method_version_mismatch'
  | 'method_kind_mismatch'
  | 'invalid_input';

export interface DirectorCompositionError {
  readonly code: DirectorCompositionErrorCode;
  readonly path: string;
  readonly message: string;
}

export type DirectorOutcome =
  | { readonly kind: 'decision'; readonly decision: DirectorDecision }
  | { readonly kind: 'escalation'; readonly escalation: EscalationRecord };

export type DirectorCompositionResult =
  | { readonly ok: true; readonly value: DirectorOutcome }
  | { readonly ok: false; readonly errors: readonly DirectorCompositionError[] };

/** Derives the decision id: `dd-<stableDigest16>` over the canonical form. */
export function deriveDirectorDecisionId(decision: Omit<DirectorDecision, 'decisionId'>): string {
  return `dd-${stableDigest(canonicalJson(decision as unknown as JsonValue))}`;
}

/** Derives the escalation id: `esc-<stableDigest16>` over the canonical form. */
export function deriveEscalationRecordId(escalation: Omit<EscalationRecord, 'escalationId'>): string {
  return `esc-${stableDigest(canonicalJson(escalation as unknown as JsonValue))}`;
}

/** The stance category of a lane's report (the summary's dominant field). */
function stanceCategoryOfLane(
  lane: ResearchLane,
  report: SentimentReportMirror | RegimeReportMirror | FundamentalReportMirror | CrossMarketReportMirror,
): string {
  if (lane === 'sentiment') return (report as SentimentReportMirror).summary.dominantPolarity;
  if (lane === 'regime') return (report as RegimeReportMirror).summary.dominantRegime;
  if (lane === 'fundamental') return (report as FundamentalReportMirror).summary.dominantStance;
  return (report as CrossMarketReportMirror).summary.dominantRelationKind;
}

/** The instruments a lane's report covers (sorted unique). */
function instrumentsOfLaneReport(
  lane: ResearchLane,
  report: SentimentReportMirror | RegimeReportMirror | FundamentalReportMirror | CrossMarketReportMirror,
): readonly string[] {
  const set = new Set<string>();
  if (lane === 'sentiment') {
    for (const reading of (report as SentimentReportMirror).readings) set.add(reading.scope.instrument);
    for (const digest of (report as SentimentReportMirror).digests)
      for (const instrument of digest.instruments) set.add(instrument);
  } else if (lane === 'regime') {
    for (const classification of (report as RegimeReportMirror).classifications)
      set.add(classification.scope.instrument);
  } else if (lane === 'fundamental') {
    for (const assessment of (report as FundamentalReportMirror).assessments)
      set.add(assessment.scope.instrument);
  } else {
    for (const relationship of (report as CrossMarketReportMirror).relationships) {
      set.add(relationship.pair.left.instrument);
      set.add(relationship.pair.right.instrument);
    }
  }
  return [...set].sort();
}

/** The inherited confidence of a lane's report (R45 — copied verbatim). */
function inheritedConfidenceOfLane(
  lane: ResearchLane,
  report: SentimentReportMirror | RegimeReportMirror | FundamentalReportMirror | CrossMarketReportMirror,
): readonly InheritedConfidenceMirror[] {
  if (lane === 'sentiment')
    return (report as SentimentReportMirror).readings.map((reading) => ({
      level: reading.confidence.level,
      evidenceCount: reading.confidence.evidenceCount,
    }));
  if (lane === 'regime')
    return (report as RegimeReportMirror).classifications.map((classification) => ({
      level: classification.confidence.level,
      evidenceCount: classification.confidence.evidenceCount,
    }));
  if (lane === 'fundamental')
    return (report as FundamentalReportMirror).assessments.map((assessment) => ({
      level: assessment.confidence.level,
      evidenceCount: assessment.confidence.evidenceCount,
    }));
  return (report as CrossMarketReportMirror).relationships.map((relationship) => ({
    level: relationship.confidence.level,
    evidenceCount: relationship.confidence.evidenceCount,
  }));
}

/** The per-body instruments of a lane for conflict detection. */
function perBodyInstrumentsOfLane(
  lane: ResearchLane,
  report: SentimentReportMirror | RegimeReportMirror | FundamentalReportMirror | CrossMarketReportMirror,
): readonly string[] {
  return instrumentsOfLaneReport(lane, report);
}

/**
 * The DECLARED-METHOD composition (mirror of T024's
 * `composeDirectorDecision`): L4 gate, method resolution, stance mapping,
 * quorum, per-instrument conflicts, policy escalation, tilts, threshold
 * split, coverage accounting, directive. Deterministic; escalations are
 * records, never exceptions.
 */
export function composeDirectorDecision(input: DirectorCompositionInput): DirectorCompositionResult {
  const errors: DirectorCompositionError[] = [];
  if (!isTimestampMs(input.asOf)) {
    errors.push({ code: 'invalid_input', path: 'asOf', message: 'asOf must be an epoch-ms timestamp' });
  }
  if (!isRecord(input.goal) || !isNonEmptyString(input.goal.goalId) || !isPositiveInteger(input.goal.version)) {
    errors.push({ code: 'invalid_input', path: 'goal', message: 'goal ref malformed' });
  }
  if (errors.length > 0) return { ok: false, errors: deepFreeze(errors) };

  // L4 gate: every present report must be as-of the decision instant or earlier
  // (boundary INCLUSIVE) and scope-matched (L12).
  const lanes: readonly ResearchLane[] = RESEARCH_LANES;
  const present: {
    lane: ResearchLane;
    report: SentimentReportMirror | RegimeReportMirror | FundamentalReportMirror | CrossMarketReportMirror;
    inputRef: ResearchInputRef;
    position: LanePosition;
    instruments: readonly string[];
  }[] = [];
  const absent: ResearchLane[] = [];
  for (const lane of lanes) {
    const report =
      lane === 'sentiment'
        ? input.intake.sentiment
        : lane === 'regime'
          ? input.intake.regime
          : lane === 'fundamental'
            ? input.intake.fundamental
            : input.intake.crossMarket;
    if (report === null || report === undefined) {
      absent.push(lane);
      continue;
    }
    if (report.asOf > input.asOf) {
      errors.push({
        code: 'research_from_the_future',
        path: `intake.${lane}.asOf`,
        message: `report ${report.reportId} is as-of ${String(report.asOf)} > decision ${String(input.asOf)} (L4)`,
      });
      continue;
    }
    if (report.tenantId !== input.tenantId) {
      errors.push({
        code: 'tenant_mismatch',
        path: `intake.${lane}.tenantId`,
        message: `report ${report.reportId} is tenant ${report.tenantId}, decision is ${input.tenantId} (L12)`,
      });
      continue;
    }
    if (report.projectId !== input.projectId) {
      errors.push({
        code: 'project_mismatch',
        path: `intake.${lane}.projectId`,
        message: `report ${report.reportId} is project ${report.projectId}, decision is ${input.projectId} (L12)`,
      });
      continue;
    }
    const category = stanceCategoryOfLane(lane, report);
    present.push({
      lane,
      report,
      inputRef: {
        lane,
        reportId: report.reportId,
        bodyVersion: report.bodyVersion,
        asOf: report.asOf,
        tenantId: report.tenantId,
        projectId: report.projectId,
        methodId: report.methodId,
        methodVersion: report.methodVersion,
        instruments: instrumentsOfLaneReport(lane, report),
        observationCitationCount: observationCountOfLane(lane, report),
        inheritedConfidence: inheritedConfidenceOfLane(lane, report),
      },
      position: {
        lane,
        direction: 'flat',
        category,
        mapped: false,
      },
      instruments: perBodyInstrumentsOfLane(lane, report),
    });
  }
  if (errors.length > 0) return { ok: false, errors: deepFreeze(errors) };

  // Method resolution (the DECLARED method — no declared method, no decision).
  const method = findMethod(input.registry, input.methodId);
  if (method === null) {
    return {
      ok: false,
      errors: deepFreeze([
        { code: 'undeclared_method', path: 'methodId', message: `method ${input.methodId} is not declared in the registry` },
      ]),
    };
  }
  if (method.kind !== 'synthesis') {
    return {
      ok: false,
      errors: deepFreeze([
        { code: 'method_kind_mismatch', path: 'methodId', message: `method ${input.methodId} is not a synthesis method` },
      ]),
    };
  }
  const parameters = method.parameters;

  // Stance mapping (declared map; unmapped categories fall back to flat — never a guess).
  const positionsByLane = new Map<string, LanePosition>();
  for (const entry of present) {
    const mapEntry = parameters.stanceMap.find(
      (m) => m.lane === entry.lane && m.category === entry.position.category,
    );
    positionsByLane.set(
      entry.lane,
      deepFreeze({
        lane: entry.lane,
        direction: mapEntry ? mapEntry.direction : ('flat' as const),
        category: entry.position.category,
        mapped: mapEntry !== undefined,
      }),
    );
  }

  // Coverage accounting (canonical lane order; typed absence records — never silence).
  const coverage: LaneCoverage[] = lanes.map((lane) => {
    const entry = present.find((p) => p.lane === lane);
    if (entry === undefined) {
      return { lane, status: 'absent', position: null, absence: { lane, reason: 'no-report-received' } };
    }
    return { lane, status: 'consumed', position: positionsByLane.get(lane) ?? entry.position, absence: null };
  });

  // Quorum check (below quorum => an ESCALATION record, reason quorum-unmet).
  if (present.length < parameters.quorum) {
    const draft: Omit<EscalationRecord, 'escalationId'> = {
      reason: 'quorum-unmet',
      asOf: input.asOf,
      bodyVersion: input.bodyVersion,
      methodId: method.methodId,
      methodVersion: method.version,
      goal: input.goal,
      constraintSets: input.constraintSets,
      tenantId: input.tenantId,
      projectId: input.projectId,
      seed: input.seed,
      inputs: present.map((entry) => entry.inputRef),
      coverage,
      conflicts: [],
      quorum: {
        declaredQuorum: parameters.quorum,
        presentLanes: present.length,
        absentLanes: absent,
      },
    };
    return { ok: true, value: { kind: 'escalation', escalation: deepFreeze({ ...draft, escalationId: deriveEscalationRecordId(draft) }) } };
  }

  // Per instrument: the non-flat per-body positions (canonical lane order).
  const instrumentUniverse = [...new Set(present.flatMap((entry) => entry.instruments))].sort();
  const positionsByInstrument = new Map<string, ConflictPosition[]>();
  for (const instrument of instrumentUniverse) {
    const positions: ConflictPosition[] = [];
    for (const entry of present) {
      if (!entry.instruments.includes(instrument)) continue;
      const position = positionsByLane.get(entry.lane) ?? entry.position;
      if (position.direction === 'flat') continue;
      positions.push({
        lane: entry.lane,
        direction: position.direction,
        reportId: entry.report.reportId,
      });
    }
    positionsByInstrument.set(instrument, positions);
  }

  // A conflict exists where non-flat positions disagree (>=1 bullish AND >=1 bearish).
  const conflicts: LaneConflict[] = [];
  const conflictedLaneSet = new Set<string>();
  for (const instrument of instrumentUniverse) {
    const positions = positionsByInstrument.get(instrument) ?? [];
    const bullish = positions.filter((p) => p.direction === 'bullish').length;
    const bearish = positions.filter((p) => p.direction === 'bearish').length;
    if (bullish > 0 && bearish > 0) {
      const majorityDirection: SynthesisDirection | null =
        bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : null;
      conflicts.push(deepFreeze({ instrumentId: instrument, positions, majorityDirection }));
      for (const position of positions) conflictedLaneSet.add(position.lane);
    }
  }

  // The conflicted-aware coverage (consumed | conflicted | absent).
  const coverageFinal: LaneCoverage[] = lanes.map((lane) => {
    const entry = present.find((p) => p.lane === lane);
    if (entry === undefined) {
      return { lane, status: 'absent', position: null, absence: { lane, reason: 'no-report-received' } };
    }
    return {
      lane,
      status: (conflictedLaneSet.has(lane) ? 'conflicted' : 'consumed') as LaneCoverageStatus,
      position: positionsByLane.get(lane) ?? entry.position,
      absence: null,
    };
  });
  void coverage;

  // The conflict policy escalation (a record, never an exception).
  const irreconcilable =
    (parameters.conflictPolicy === 'escalate-on-any' && conflicts.length > 0) ||
    (parameters.conflictPolicy === 'escalate-on-no-majority' &&
      conflicts.some((conflict) => conflict.majorityDirection === null));
  if (irreconcilable) {
    const draft: Omit<EscalationRecord, 'escalationId'> = {
      reason: 'irreconcilable-conflict',
      asOf: input.asOf,
      bodyVersion: input.bodyVersion,
      methodId: method.methodId,
      methodVersion: method.version,
      goal: input.goal,
      constraintSets: input.constraintSets,
      tenantId: input.tenantId,
      projectId: input.projectId,
      seed: input.seed,
      inputs: present.map((entry) => entry.inputRef),
      coverage: coverageFinal,
      conflicts,
      quorum: null,
    };
    return { ok: true, value: { kind: 'escalation', escalation: deepFreeze({ ...draft, escalationId: deriveEscalationRecordId(draft) }) } };
  }

  // The majority-rules net tilt + threshold split: for a CONFLICTED
  // instrument the majority side's lanes aggregate (the minority lives in
  // the conflict record); for an unconflicted instrument every covering
  // non-flat lane aggregates (flat lanes contribute weight x 0 = 0).
  const adjustments: TargetAllocationAdjustment[] = [];
  const instrumentTilts: InstrumentTilt[] = [];
  const nonZeroTilts: string[] = [];
  for (const instrument of instrumentUniverse) {
    const conflict = conflicts.find((candidate) => candidate.instrumentId === instrument);
    const positions = positionsByInstrument.get(instrument) ?? [];
    const aggregating: ConflictPosition[] =
      conflict === undefined
        ? positions
        : conflict.majorityDirection === null
          ? []
          : positions.filter((position) => position.direction === conflict.majorityDirection);
    const weighted = aggregating.map((position) => {
      const weightEntry = parameters.laneWeights.find((w) => w.lane === position.lane);
      const weight = weightEntry === undefined ? '0' : weightEntry.weight;
      const sign = position.direction === 'bullish' ? 1 : position.direction === 'bearish' ? -1 : 0;
      return sign === 0 ? '0' : sign === -1 ? `-${weight}` : weight;
    });
    const netTilt = decimalSum(weighted, parameters.outputScale, parameters.rounding);
    const delta = decimalMultiply(netTilt, parameters.tiltUnit, parameters.outputScale, parameters.rounding);
    const magnitude = decimalAbs(delta, parameters.outputScale, parameters.rounding);
    if (compareDecimal(magnitude, parameters.adjustmentThreshold) >= 0) {
      adjustments.push(
        deepFreeze({
          instrumentId: instrument,
          deltaWeight: delta,
          netTilt,
          positions: deepFreeze([...positions]),
        }),
      );
    } else {
      instrumentTilts.push(deepFreeze({ instrumentId: instrument, netTilt }));
    }
    if (compareDecimal(netTilt, '0') !== 0) nonZeroTilts.push(netTilt);
  }

  // The directive verdict (L16 — portfolio-level only; never order-level).
  const directive: PortfolioDirective =
    adjustments.length > 0
      ? { kind: 'allocation-adjustment', adjustments }
      : instrumentUniverse.length === 0
        ? { kind: 'no-change', reason: 'no-covered-instruments', instrumentTilts: [] }
        : nonZeroTilts.length === 0
          ? { kind: 'no-change', reason: 'flat-consensus', instrumentTilts }
          : { kind: 'no-change', reason: 'insufficient-signal', instrumentTilts };

  const draft: Omit<DirectorDecision, 'decisionId'> = {
    asOf: input.asOf,
    bodyVersion: input.bodyVersion,
    methodId: method.methodId,
    methodVersion: method.version,
    goal: input.goal,
    constraintSets: input.constraintSets,
    tenantId: input.tenantId,
    projectId: input.projectId,
    seed: input.seed,
    inputs: present.map((entry) => entry.inputRef),
    coverage: coverageFinal,
    conflicts,
    directive,
  };
  return { ok: true, value: { kind: 'decision', decision: deepFreeze({ ...draft, decisionId: deriveDirectorDecisionId(draft) }) } };
}

/** The observation citation count of a lane's report. */
function observationCountOfLane(
  lane: ResearchLane,
  report: SentimentReportMirror | RegimeReportMirror | FundamentalReportMirror | CrossMarketReportMirror,
): number {
  if (lane === 'sentiment') {
    const sentiment = report as SentimentReportMirror;
    return (
      sentiment.readings.reduce((acc, reading) => acc + reading.evidence.length, 0) +
      sentiment.digests.reduce((acc, digest) => acc + digest.evidence.length, 0)
    );
  }
  if (lane === 'regime') {
    const regime = report as RegimeReportMirror;
    return (
      regime.classifications.reduce((acc, c) => acc + c.evidence.length, 0) +
      regime.changes.reduce((acc, c) => acc + c.evidence.length, 0)
    );
  }
  if (lane === 'fundamental') {
    const fundamental = report as FundamentalReportMirror;
    return (
      fundamental.assessments.reduce((acc, a) => acc + a.evidence.length, 0) +
      fundamental.actionDigests.reduce((acc, a) => acc + a.evidence.length, 0)
    );
  }
  const crossMarket = report as CrossMarketReportMirror;
  return crossMarket.relationships.reduce((acc, r) => acc + r.evidence.length, 0);
}

/** Guard: a portfolio directive (refuses order-level kinds — the L16 law). */
export function isPortfolioDirective(v: unknown): v is PortfolioDirective {
  if (!isRecord(v)) return false;
  if (v.kind === 'allocation-adjustment') {
    return Array.isArray(v.adjustments) && v.adjustments.every(isTargetAllocationAdjustment);
  }
  if (v.kind === 'no-change') {
    return isMemberOf(NO_CHANGE_REASONS, v.reason) && Array.isArray(v.instrumentTilts);
  }
  return false;
}

const isTargetAllocationAdjustment = (v: unknown): v is TargetAllocationAdjustment =>
  isRecord(v) &&
  isNonEmptyString(v.instrumentId) &&
  typeof v.deltaWeight === 'string' &&
  typeof v.netTilt === 'string' &&
  Array.isArray(v.positions);

/** Guard: a director decision. */
export function isDirectorDecision(v: unknown): v is DirectorDecision {
  return (
    isRecord(v) &&
    isNonEmptyString(v.decisionId) &&
    (v.decisionId as string).startsWith('dd-') &&
    isTimestampMs(v.asOf) &&
    isNonEmptyString(v.bodyVersion) &&
    isNonEmptyString(v.methodId) &&
    isNonEmptyString(v.methodVersion) &&
    isResearchLaneGuardOk(v) &&
    isPortfolioDirective(v.directive)
  );
}

function isResearchLaneGuardOk(v: Record<string, unknown>): boolean {
  return Array.isArray(v.coverage) && v.coverage.every((c) => isRecord(c) && isResearchLane((c as Record<string, unknown>).lane));
}
