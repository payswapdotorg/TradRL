// @tradrl/example-e2e-trading — STAGE 7: THE TRADING DIRECTOR (T024).
//
// Decision production over the four research reports, mirroring the REAL
// director's synthesis law exactly: report-level stance categories ->
// declared-method stance map (flat fallback) -> per-instrument conflict
// detection (strict majority or a recorded tie) -> quorum -> conflict
// policy -> majority-rules net tilt x lane weights -> threshold split ->
// the portfolio directive (allocation-adjustment or no-change), or a
// kernel ESCALATE record (quorum-unmet / irreconcilable-conflict — a
// record, never an exception). The method registry below is the REAL
// canonical method, re-declared verbatim as a mirror; the interop test
// validates this slice's decisions under the REAL validator + registry.

import { add, compare, multiply } from './decimals';
import { deepFreeze, stableDigest16Json, type JsonValue } from './primitives';
import { fail, ok, type ExampleResult } from './errors';
import type {
  ConflictPolicy, DirectorDecisionMirror, DirectorEscalationMirror, DirectorOutcomeMirror,
  LaneCoverageMirror, LaneConflictMirror, MethodRecordMirror, MethodRegistryMirror,
  ResearchLane, SynthesisDirection,
} from './mirrors/director';
import {
  RESEARCH_LANES, crossMarketStanceCategoryOf, fundamentalStanceCategoryOf,
  regimeStanceCategoryOf, sentimentStanceCategoryOf,
} from './mirrors/director';
import type {
  ConfidenceLevelMirror, FundamentalReportMirror, InheritedConfidenceMirror,
  RegimeReportMirror, ResearchIntakeMirror, SentimentReportMirror, CrossMarketReportMirror,
} from './mirrors/research';
import type { GoalVersionRefMirror, ConstraintSetVersionRefMirror } from './mirrors/control';

// ---------------------------------------------------------------------------
// The canonical method registry (verbatim mirror of the REAL registry)
// ---------------------------------------------------------------------------

export const DIRECTOR_METHOD_REGISTRY_MIRROR: MethodRegistryMirror = deepFreeze({
  methods: [
    deepFreeze({
      methodId: 'method/director/synthesis',
      kind: 'synthesis',
      version: '1.0.0',
      parameters: {
        kind: 'synthesis',
        input: 'research-reports',
        quorum: 3,
        unmappedCategory: 'flat',
        stanceMap: [
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
        ],
        laneWeights: [
          { lane: 'sentiment', weight: '1' },
          { lane: 'regime', weight: '1' },
          { lane: 'fundamental', weight: '1' },
          { lane: 'cross-market', weight: '1' },
        ],
        tiltUnit: '0.01',
        adjustmentThreshold: '0.02',
        outputScale: 4,
        rounding: 'half-even',
        conflictPolicy: 'escalate-on-no-majority',
      },
      declaredBy: 'tradrl-director-declaration/1',
      declaredAt: 1_780_000_000_000,
    }) as MethodRecordMirror,
  ],
  digest: stableDigest16Json([{ methodId: 'method/director/synthesis', version: '1.0.0' } as JsonValue]),
});

// ---------------------------------------------------------------------------
// Intake citations
// ---------------------------------------------------------------------------

function instrumentsOfSentiment(report: SentimentReportMirror): string[] {
  const instruments = new Set<string>();
  for (const reading of report.readings) instruments.add(reading.scope.instrument);
  for (const digest of report.digests) for (const instrument of digest.instruments) instruments.add(instrument);
  return [...instruments].sort();
}

function instrumentsOfRegime(report: RegimeReportMirror): string[] {
  const instruments = new Set<string>();
  for (const classification of report.classifications) instruments.add(classification.scope.instrument);
  for (const change of report.changes) instruments.add(change.scope.instrument);
  return [...instruments].sort();
}

function instrumentsOfFundamental(report: FundamentalReportMirror): string[] {
  const instruments = new Set<string>();
  for (const assessment of report.assessments) instruments.add(assessment.scope.instrument);
  for (const digest of report.actionDigests) for (const instrument of digest.instruments) instruments.add(instrument);
  return [...instruments].sort();
}

function instrumentsOfCrossMarket(report: CrossMarketReportMirror): string[] {
  const instruments = new Set<string>();
  for (const relationship of report.relationships) {
    instruments.add(relationship.pair.left.instrument);
    instruments.add(relationship.pair.right.instrument);
  }
  return [...instruments].sort();
}

function citationCountOf(groups: readonly { readonly evidence: readonly unknown[] }[]): number {
  return groups.reduce((acc, group) => acc + group.evidence.length, 0);
}

function inputRefOf(
  lane: ResearchLane,
  report: SentimentReportMirror | RegimeReportMirror | FundamentalReportMirror | CrossMarketReportMirror,
  instruments: readonly string[],
  citationCount: number,
  inheritedConfidence: readonly InheritedConfidenceMirror[],
) {
  return deepFreeze({
    lane,
    reportId: report.reportId,
    bodyVersion: report.bodyVersion,
    asOf: report.asOf,
    tenantId: report.tenantId,
    projectId: report.projectId,
    methodId: report.methodId,
    methodVersion: report.methodVersion,
    instruments,
    observationCitationCount: citationCount,
    inheritedConfidence,
  });
}

// ---------------------------------------------------------------------------
// The composition (the REAL synthesis law, mirrored)
// ---------------------------------------------------------------------------

export interface DirectorCompositionInputMirror {
  readonly asOf: number;
  readonly goal: GoalVersionRefMirror;
  readonly constraintSets: readonly ConstraintSetVersionRefMirror[];
  readonly tenantId: string;
  readonly projectId: string;
  readonly seed: string;
  readonly methodId: string;
  readonly registry: MethodRegistryMirror;
  readonly bodyVersion: string;
  readonly intake: ResearchIntakeMirror;
}

export function composeDirectorDecision(
  input: DirectorCompositionInputMirror,
): ExampleResult<DirectorOutcomeMirror> {
  // The L4 gate: no research from the future (inclusive at equality);
  // L12: tenant/project coherence.
  for (const lane of RESEARCH_LANES) {
    const report =
      lane === 'sentiment' ? input.intake.sentiment :
      lane === 'regime' ? input.intake.regime :
      lane === 'fundamental' ? input.intake.fundamental :
      input.intake.crossMarket;
    if (report === null) continue;
    if (report.asOf > input.asOf) {
      return {
        ok: false,
        errors: [{
          code: 'research_from_the_future',
          path: `intake.${lane}.asOf`,
          message: `lane ${lane} report asOf ${report.asOf} is after the decision instant ${input.asOf} (L4)`,
        }],
      };
    }
    if (report.tenantId !== input.tenantId || report.projectId !== input.projectId) {
      return {
        ok: false,
        errors: [{
          code: 'tenant_mismatch',
          path: `intake.${lane}`,
          message: `lane ${lane} report is scoped to ${report.tenantId}/${report.projectId}, decision to ${input.tenantId}/${input.projectId} (L12)`,
        }],
      };
    }
  }

  const method = input.registry.methods.find((record) => record.methodId === input.methodId);
  if (!method) {
    return {
      ok: false,
      errors: [{ code: 'undeclared_method', path: 'methodId', message: `method ${input.methodId} is not declared — a decision without a declared synthesis method is an unsupported claim` }],
    };
  }
  const parameters = method.parameters;

  // Per-lane citations + report-level positions.
  interface LaneComputation {
    readonly lane: ResearchLane;
    readonly input: ReturnType<typeof inputRefOf>;
    readonly position: { lane: ResearchLane; direction: SynthesisDirection; category: string; mapped: boolean };
    readonly reportId: string;
  }
  const lanes: LaneComputation[] = [];
  const collect = (
    lane: ResearchLane,
    report: SentimentReportMirror | RegimeReportMirror | FundamentalReportMirror | CrossMarketReportMirror | null,
    category: string | null,
    instruments: readonly string[],
    citationCount: number,
    inheritedConfidence: readonly InheritedConfidenceMirror[],
  ): void => {
    if (report === null || category === null) return;
    const entry = parameters.stanceMap.find((candidate) => candidate.lane === lane && candidate.category === category);
    const direction: SynthesisDirection = entry === undefined ? 'flat' : entry.direction;
    lanes.push({
      lane,
      input: inputRefOf(lane, report, instruments, citationCount, inheritedConfidence),
      position: deepFreeze({ lane, direction, category, mapped: entry !== undefined }),
      reportId: report.reportId,
    });
  };

  const sentiment = input.intake.sentiment;
  const regime = input.intake.regime;
  const fundamental = input.intake.fundamental;
  const crossMarket = input.intake.crossMarket;
  collect('sentiment', sentiment, sentiment ? sentimentStanceCategoryOf(sentiment) : null,
    sentiment ? instrumentsOfSentiment(sentiment) : [],
    sentiment ? citationCountOf([...sentiment.readings.map((r) => ({ evidence: r.evidence })), ...sentiment.digests.map((d) => ({ evidence: d.evidence }))]) : 0,
    sentiment ? sentiment.readings.map((r) => ({ level: r.confidence.level, evidenceCount: r.confidence.evidenceCount })) : []);
  collect('regime', regime, regime ? regimeStanceCategoryOf(regime) : null,
    regime ? instrumentsOfRegime(regime) : [],
    regime ? citationCountOf([...regime.classifications.map((c) => ({ evidence: c.evidence })), ...regime.changes.map((c) => ({ evidence: c.evidence }))]) : 0,
    regime ? regime.classifications.map((c) => ({ level: c.confidence.level, evidenceCount: c.confidence.evidenceCount })) : []);
  collect('fundamental', fundamental, fundamental ? fundamentalStanceCategoryOf(fundamental) : null,
    fundamental ? instrumentsOfFundamental(fundamental) : [],
    fundamental ? citationCountOf([...fundamental.assessments.map((a) => ({ evidence: a.evidence })), ...fundamental.actionDigests.map((d) => ({ evidence: d.evidence }))]) : 0,
    fundamental ? fundamental.assessments.map((a) => ({ level: a.confidence.level, evidenceCount: a.confidence.evidenceCount })) : []);
  collect('cross-market', crossMarket, crossMarket ? crossMarketStanceCategoryOf(crossMarket) : null,
    crossMarket ? instrumentsOfCrossMarket(crossMarket) : [],
    crossMarket ? citationCountOf(crossMarket.relationships.map((r) => ({ evidence: r.evidence }))) : 0,
    crossMarket ? crossMarket.relationships.map((r) => ({ level: r.confidence.level, evidenceCount: r.confidence.evidenceCount })) : []);

  const laneWeights = new Map<ResearchLane, string>(parameters.laneWeights.map((entry) => [entry.lane, entry.weight]));

  // Conflict detection per instrument (union of instruments, sorted).
  const instrumentSet = new Set<string>();
  for (const lane of lanes) for (const instrument of lane.input.instruments) instrumentSet.add(instrument);
  const instruments = [...instrumentSet].sort();
  const positionsByInstrument = new Map<string, { lane: ResearchLane; direction: SynthesisDirection; reportId: string }[]>();
  for (const instrument of instruments) {
    const positions: { lane: ResearchLane; direction: SynthesisDirection; reportId: string }[] = [];
    for (const lane of lanes) {
      if (!lane.input.instruments.includes(instrument)) continue;
      if (lane.position.direction === 'flat') continue;
      positions.push(deepFreeze({ lane: lane.lane, direction: lane.position.direction, reportId: lane.reportId }));
    }
    positionsByInstrument.set(instrument, positions);
  }
  const conflicts: LaneConflictMirror[] = [];
  const conflictedLaneSet = new Set<ResearchLane>();
  for (const instrument of instruments) {
    const positions = positionsByInstrument.get(instrument) ?? [];
    const bullish = positions.filter((position) => position.direction === 'bullish').length;
    const bearish = positions.filter((position) => position.direction === 'bearish').length;
    if (bullish > 0 && bearish > 0) {
      const majorityDirection: SynthesisDirection | null = bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : null;
      conflicts.push(deepFreeze({ instrumentId: instrument, positions, majorityDirection }));
      for (const position of positions) conflictedLaneSet.add(position.lane);
    }
  }

  // Quorum + conflict policy.
  const presentLanes = lanes.map((lane) => lane.lane);
  const absentLanes = RESEARCH_LANES.filter((lane) => !presentLanes.includes(lane));
  const quorumUnmet = presentLanes.length < parameters.quorum;
  const policy = parameters.conflictPolicy as ConflictPolicy;
  const irreconcilable =
    (policy === 'escalate-on-any' && conflicts.length > 0) ||
    (policy === 'escalate-on-no-majority' && conflicts.some((conflict) => conflict.majorityDirection === null));

  // Coverage accounting (all four lanes, canonical order).
  const coverage: LaneCoverageMirror[] = RESEARCH_LANES.map((lane) => {
    const computed = lanes.find((candidate) => candidate.lane === lane);
    if (computed === undefined) {
      return deepFreeze({ lane, status: 'absent', position: null, absence: deepFreeze({ lane, reason: 'no-report-received' }) });
    }
    return deepFreeze({
      lane,
      status: conflictedLaneSet.has(lane) ? 'conflicted' : 'consumed',
      position: computed.position,
      absence: null,
    });
  });
  const inputs = lanes.map((lane) => lane.input);

  const lineage = {
    asOf: input.asOf,
    bodyVersion: input.bodyVersion,
    methodId: method.methodId,
    methodVersion: method.version,
    goal: input.goal,
    constraintSets: input.constraintSets,
    tenantId: input.tenantId,
    projectId: input.projectId,
    seed: input.seed,
    inputs,
    coverage,
    conflicts,
  };

  if (quorumUnmet || irreconcilable) {
    const reason: DirectorEscalationMirror['reason'] = quorumUnmet ? 'quorum-unmet' : 'irreconcilable-conflict';
    const content = {
      ...lineage,
      reason,
      quorum: quorumUnmet
        ? deepFreeze({ declaredQuorum: parameters.quorum, presentLanes: presentLanes.length, absentLanes: [...absentLanes] })
        : null,
    };
    const escalation: DirectorEscalationMirror = deepFreeze({
      ...content,
      escalationId: `esc-${stableDigest16Json(omit(content, 'escalationId') as JsonValue)}`,
    });
    return ok({ kind: 'escalation', escalation });
  }

  // Majority-rules net tilt + threshold split.
  const adjustments: {
    instrumentId: string; deltaWeight: string; netTilt: string;
    positions: { lane: ResearchLane; direction: SynthesisDirection; reportId: string }[];
  }[] = [];
  const instrumentTilts: { instrumentId: string; netTilt: string }[] = [];
  const nonZeroTilts: string[] = [];
  for (const instrument of instruments) {
    const conflict = conflicts.find((candidate) => candidate.instrumentId === instrument);
    const positions = positionsByInstrument.get(instrument) ?? [];
    const aggregating =
      conflict === undefined
        ? positions
        : conflict.majorityDirection === null
          ? []
          : positions.filter((position) => position.direction === conflict.majorityDirection);
    const weighted = aggregating.map((position) => {
      const weight = laneWeights.get(position.lane) ?? '0';
      const sign = position.direction === 'bullish' ? 1 : position.direction === 'bearish' ? -1 : 0;
      return sign === 0 ? '0' : sign === -1 ? `-${weight}` : weight;
    });
    const netTilt = weighted.reduce((acc, value) => add(acc, value), '0');
    const delta = multiply(netTilt, parameters.tiltUnit);
    const magnitude = delta.startsWith('-') ? delta.slice(1) : delta;
    if (compare(magnitude, parameters.adjustmentThreshold) >= 0) {
      adjustments.push(deepFreeze({ instrumentId: instrument, deltaWeight: delta, netTilt, positions: [...positions] }));
    } else {
      instrumentTilts.push(deepFreeze({ instrumentId: instrument, netTilt }));
    }
    if (compare(netTilt, '0') !== 0) nonZeroTilts.push(netTilt);
  }

  let directive: DirectorDecisionMirror['directive'];
  if (adjustments.length > 0) {
    directive = deepFreeze({ kind: 'allocation-adjustment', adjustments: [...adjustments] });
  } else {
    const reason =
      instruments.length === 0 ? 'no-covered-instruments' : nonZeroTilts.length === 0 ? 'flat-consensus' : 'insufficient-signal';
    directive = deepFreeze({ kind: 'no-change', reason, instrumentTilts: [...instrumentTilts] });
  }

  const content = { ...lineage, directive };
  const decision: DirectorDecisionMirror = deepFreeze({
    ...content,
    decisionId: `dd-${stableDigest16Json(omit(content, 'decisionId') as JsonValue)}`,
  });
  return ok({ kind: 'decision', decision });
}

function omit(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}
