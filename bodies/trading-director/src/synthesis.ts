// @tradrl/body-trading-director — the synthesis (the composition law's
// DECLARED interpreter).
//
// Owning Work Order: T024: "Coverage accounting (mirror the researchers'
// report law): every one of the four lanes is accounted as
// consumed | conflicted | absent. A missing lane produces a typed absence
// record — never silence; conflicting positions produce typed conflict
// records with per-body positions — never a silent average. Quorum (how
// many lanes must be present) is declared by the method, not hardcoded."
//
// `composeDirectorDecision` is the declared synthesis method's PURE
// interpreter — the exact discipline @tradrl/trading-strategy's
// `compileStrategyRun` applies to its specs: the method parameters are
// DATA, this function is their DECLARED interpreter, so the same
// (inputs, method, seed) always yields a byte-identical decision (the
// determinism law; golden tests run the composition twice).
//
// The composition pipeline (every step deterministic, every order
// canonical):
//   1. validate the composition input (structure + lineage carriers);
//   2. THE L4 GATE over the four-lane intake (research_from_the_future
//      at the inclusive boundary);
//   3. resolve the declared synthesis method (typed errors on drift);
//   4. extract per-lane citations + positions (stance map lookup, flat
//      fallback for unmapped categories — never a guess);
//   5. THE QUORUM CHECK — present lanes below the declared quorum
//      produce an EscalationRecord (reason 'quorum-unmet'), never a
//      silent default;
//   6. conflict detection per instrument (typed conflict records with
//      per-body positions; the strict majority direction or null on a
//      tie — never a silent average);
//   7. THE CONFLICT POLICY — irreconcilable conflicts produce an
//      EscalationRecord (reason 'irreconcilable-conflict');
//   8. the majority-rules net tilt per instrument (conflicted
//      instruments aggregate the majority side only — the minority is
//      RECORDED in the conflict record, never silently averaged into
//      the directive);
//   9. the threshold split: |delta| >= adjustmentThreshold produces a
//      target-allocation adjustment; otherwise the instrument's tilt
//      rides the no-change evidence;
//  10. the four-lane coverage accounting (consumed | conflicted |
//      absent, with typed absence records);
//  11. the decision or escalation record, minted through its factory
//      (derived id, deepFreeze) — a record, never an exception.
//
// No ambient clock, no ambient randomness, no float arithmetic — the
// declared method's parameters drive every threshold.

import {
  type TimestampMs,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  isArrayOf,
  deepFreeze,
} from './primitives';
import {
  type BodyVersionRef,
  type ConstraintSetVersionRef,
  type GoalVersionRef,
  type MethodId,
  type MethodVersionRef,
  type ProjectId,
  type TenantId,
  isBodyVersionRef,
  isConstraintSetVersionRef,
  isGoalVersionRef,
  isMethodId,
  isProjectId,
  isTenantId,
} from './ids';
import {
  type MethodRegistry,
  type MethodRecord,
  type ResearchLane,
  type SynthesisDirection,
  type SynthesisParameters,
  RESEARCH_LANES,
  findMethod,
} from './methods';
import {
  type CrossMarketReportMirror,
  type FundamentalReportMirror,
  type RegimeReportMirror,
  type ResearchInputRef,
  type SentimentReportMirror,
  crossMarketInputRefOf,
  crossMarketStanceCategoryOf,
  fundamentalInputRefOf,
  fundamentalStanceCategoryOf,
  regimeInputRefOf,
  regimeStanceCategoryOf,
  sentimentInputRefOf,
  sentimentStanceCategoryOf,
  validateResearchIntake,
} from './intake';
import {
  type ConflictPosition,
  type DirectorDecision,
  type EscalationRecord,
  type LaneConflict,
  type LaneCoverage,
  type LanePosition,
  type PortfolioDirective,
  type TargetAllocationAdjustment,
  createDirectorDecision,
  createEscalationRecord,
} from './decision';
import { compareDecimal, decimalAbs, decimalMultiply, decimalSum } from './decimals';
import { type DirectorError, type DirectorResult, invalidField } from './errors';

// ---------------------------------------------------------------------------
// The composition input + outcome
// ---------------------------------------------------------------------------

/** The four-lane intake bundle (absent lanes are `null`). */
export interface DirectorIntake {
  readonly sentiment: SentimentReportMirror | null;
  readonly regime: RegimeReportMirror | null;
  readonly fundamental: FundamentalReportMirror | null;
  readonly crossMarket: CrossMarketReportMirror | null;
}

/**
 * The composition input: the decision instant (the L4 gate's reference
 * point), the goal + constraint-set refs (the strategy lane binds the
 * SAME refs), tenant/project (L12), the seed, the declared synthesis
 * method id (resolved against the registry — the method's own version is
 * what the decision cites), and the four-lane research intake.
 */
export interface DirectorCompositionInput {
  readonly asOf: TimestampMs;
  readonly goal: GoalVersionRef;
  readonly constraintSets: readonly ConstraintSetVersionRef[];
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  /** The declared synthesis method id (e.g. 'method/director/synthesis'). */
  readonly methodId: string;
  /** The closed registry the citation resolves against. */
  readonly registry: MethodRegistry;
  /** The director body version the decision cites (canonical ref). */
  readonly bodyVersion: BodyVersionRef;
  readonly intake: DirectorIntake;
}

/**
 * THE composition outcome: a decision, or an escalation record (the
 * kernel ESCALATE verb — a record, never an exception, never a silent
 * default).
 */
export type DirectorOutcome =
  | { readonly kind: 'decision'; readonly decision: DirectorDecision }
  | { readonly kind: 'escalation'; readonly escalation: EscalationRecord };

// ---------------------------------------------------------------------------
// Internal composition state (all canonical orders fixed)
// ---------------------------------------------------------------------------

interface LaneComputation {
  readonly lane: ResearchLane;
  readonly input: ResearchInputRef;
  readonly position: LanePosition;
  readonly reportId: string;
}

// ---------------------------------------------------------------------------
// The composition
// ---------------------------------------------------------------------------

/**
 * Composes the portfolio-level decision (or escalation record) from the
 * four research publications under the declared synthesis method. PURE
 * and DETERMINISTIC: same (intake, method, goal, constraint sets,
 * tenant, project, seed) always yields byte-identical output. Refusal
 * (structural violations) is typed data; quorum and conflict outcomes
 * are RECORDS, never exceptions.
 */
export function composeDirectorDecision(
  input: DirectorCompositionInput,
): DirectorResult<DirectorOutcome> {
  const errors: DirectorError[] = [];

  // -- 1. composition-input structure ---------------------------------------
  if (!isTimestampMs(input.asOf)) {
    errors.push(invalidField('asOf', 'must be a valid epoch-millisecond instant'));
  }
  if (!isGoalVersionRef(input.goal)) {
    errors.push({
      code: 'goal_ref_malformed',
      path: 'goal',
      message: 'the goal version ref must be { goalId, version } — the mirror of trading-strategy\'s shape (L9/L15)',
    });
  }
  if (!isArrayOf(input.constraintSets, isConstraintSetVersionRef)) {
    errors.push({
      code: 'constraint_ref_malformed',
      path: 'constraintSets',
      message: 'every constraint-set ref must be { id, version } — the mirror of trading-strategy\'s shape (L9/L15)',
    });
  }
  if (!isTenantId(input.tenantId)) {
    errors.push({ code: 'tenant_missing', path: 'tenantId', message: 'the decision carries a TenantId (L12)' });
  }
  if (!isProjectId(input.projectId)) {
    errors.push({ code: 'project_missing', path: 'projectId', message: 'the decision carries a ProjectId (L12)' });
  }
  if (!isNonEmptyString(input.seed)) {
    errors.push(invalidField('seed', 'must be a non-empty seed string'));
  }
  if (!isBodyVersionRef(input.bodyVersion)) {
    errors.push(invalidField('bodyVersion', 'must be a canonical body-version reference'));
  }
  if (!isMethodId(input.methodId)) {
    errors.push(invalidField('methodId', 'must be a non-empty method reference'));
  }

  // -- 2. THE L4 GATE over the four-lane intake ------------------------------
  const intakeOk = isRecord(input.intake);
  if (!intakeOk) {
    errors.push(invalidField('intake', 'must carry the four lane fields'));
  } else {
    errors.push(...validateResearchIntake(input.intake, input.asOf, input.tenantId, input.projectId));
  }

  // -- 3. resolve the declared synthesis method ------------------------------
  const method: MethodRecord | null = isMethodId(input.methodId) ? findMethod(input.registry, input.methodId) : null;
  if (isMethodId(input.methodId) && method === null) {
    errors.push({
      code: 'undeclared_method',
      path: 'methodId',
      message: `method ${JSON.stringify(input.methodId)} is not declared in the method registry — a decision without a declared synthesis method is an unsupported claim`,
    });
  }
  if (method !== null && method.kind !== 'synthesis') {
    errors.push({
      code: 'method_kind_mismatch',
      path: 'methodId',
      message: `method ${input.methodId} is declared as '${method.kind}', used as 'synthesis'`,
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  if (method === null) {
    return { ok: false, errors: [{ code: 'undeclared_method', path: 'methodId', message: 'no declared synthesis method' }] };
  }
  const parameters = method.parameters as SynthesisParameters;

  // -- 4. per-lane citations + positions -------------------------------------
  const lanes: LaneComputation[] = [];
  const collectLane = (
    lane: ResearchLane,
    present: boolean,
    inputRef: ResearchInputRef | null,
    category: string | null,
  ): void => {
    if (!present || inputRef === null || category === null) return;
    const entry = parameters.stanceMap.find(
      (candidate) => candidate.lane === lane && candidate.category === category,
    );
    const direction: SynthesisDirection = entry === undefined ? 'flat' : entry.direction;
    const mapped = entry !== undefined;
    lanes.push({
      lane,
      input: inputRef,
      position: deepFreeze({ lane, direction, category, mapped }),
      reportId: inputRef.reportId,
    });
  };

  const sentiment = intakeOk ? (input.intake.sentiment ?? null) : null;
  const regime = intakeOk ? (input.intake.regime ?? null) : null;
  const fundamental = intakeOk ? (input.intake.fundamental ?? null) : null;
  const crossMarket = intakeOk ? (input.intake.crossMarket ?? null) : null;
  collectLane('sentiment', sentiment !== null, sentiment === null ? null : sentimentInputRefOf(sentiment), sentiment === null ? null : sentimentStanceCategoryOf(sentiment));
  collectLane('regime', regime !== null, regime === null ? null : regimeInputRefOf(regime), regime === null ? null : regimeStanceCategoryOf(regime));
  collectLane('fundamental', fundamental !== null, fundamental === null ? null : fundamentalInputRefOf(fundamental), fundamental === null ? null : fundamentalStanceCategoryOf(fundamental));
  collectLane('cross-market', crossMarket !== null, crossMarket === null ? null : crossMarketInputRefOf(crossMarket), crossMarket === null ? null : crossMarketStanceCategoryOf(crossMarket));

  const laneWeights = new Map<ResearchLane, string>(
    parameters.laneWeights.map((entry) => [entry.lane, entry.weight]),
  );

  // -- 5/6. conflict detection per instrument ---------------------------------
  // The instrument universe: the union of present lanes' instrument
  // scopes, canonical (sorted) order.
  const instrumentSet = new Set<string>();
  for (const lane of lanes) {
    for (const instrument of lane.input.instruments) instrumentSet.add(instrument);
  }
  const instruments = [...instrumentSet].sort();

  // Per instrument: the non-flat per-body positions (canonical lane order).
  const positionsByInstrument = new Map<string, ConflictPosition[]>();
  for (const instrument of instruments) {
    const positions: ConflictPosition[] = [];
    for (const lane of lanes) {
      if (!lane.input.instruments.includes(instrument)) continue;
      if (lane.position.direction === 'flat') continue;
      positions.push(deepFreeze({ lane: lane.lane, direction: lane.position.direction, reportId: lane.reportId }));
    }
    positionsByInstrument.set(instrument, positions);
  }

  // A conflict exists where non-flat positions disagree.
  const conflicts: LaneConflict[] = [];
  const conflictedInstruments = new Set<string>();
  for (const instrument of instruments) {
    const positions = positionsByInstrument.get(instrument) ?? [];
    const bullish = positions.filter((position) => position.direction === 'bullish').length;
    const bearish = positions.filter((position) => position.direction === 'bearish').length;
    if (bullish > 0 && bearish > 0) {
      conflictedInstruments.add(instrument);
      const majorityDirection: SynthesisDirection | null =
        bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : null;
      conflicts.push(deepFreeze({ instrumentId: instrument, positions, majorityDirection }));
    }
  }

  // The lanes recorded as conflicted: any lane appearing in a conflict position.
  const conflictedLaneSet = new Set<ResearchLane>();
  for (const conflict of conflicts) {
    for (const position of conflict.positions) conflictedLaneSet.add(position.lane);
  }

  // -- 5. THE QUORUM CHECK ----------------------------------------------------
  const presentLanes = lanes.map((lane) => lane.lane);
  const absentLanes = RESEARCH_LANES.filter((lane) => !presentLanes.includes(lane));
  const quorumUnmet = presentLanes.length < parameters.quorum;

  // -- 7. THE CONFLICT POLICY -------------------------------------------------
  const irreconcilable =
    (parameters.conflictPolicy === 'escalate-on-any' && conflicts.length > 0) ||
    (parameters.conflictPolicy === 'escalate-on-no-majority' &&
      conflicts.some((conflict) => conflict.majorityDirection === null));

  // -- 10. the four-lane coverage accounting (shared by decision + escalation)
  const coverage: LaneCoverage[] = RESEARCH_LANES.map((lane) => {
    const computed = lanes.find((candidate) => candidate.lane === lane);
    if (computed === undefined) {
      return deepFreeze({
        lane,
        status: 'absent' as const,
        position: null,
        absence: deepFreeze({ lane, reason: 'no-report-received' as const }),
      });
    }
    return deepFreeze({
      lane,
      status: conflictedLaneSet.has(lane) ? ('conflicted' as const) : ('consumed' as const),
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

  // -- 5/7. THE ESCALATION OUTCOMES (records, never exceptions) ---------------
  if (quorumUnmet || irreconcilable) {
    const reason = quorumUnmet ? 'quorum-unmet' : 'irreconcilable-conflict';
    const construction = createEscalationRecord(
      {
        ...lineage,
        reason,
        quorum: quorumUnmet
          ? deepFreeze({
              declaredQuorum: parameters.quorum,
              presentLanes: presentLanes.length,
              absentLanes: deepFreeze([...absentLanes]),
            })
          : null,
      },
      input.registry,
    );
    if (!construction.ok) return { ok: false, errors: construction.errors };
    return { ok: true, value: { kind: 'escalation', escalation: construction.value } };
  }

  // -- 8/9. the majority-rules net tilt + threshold split ----------------------
  // For a CONFLICTED instrument, the majority side's lanes aggregate; the
  // minority is recorded in the conflict record, never silently averaged
  // into the directive. For an unconflicted instrument, every covering
  // non-flat lane aggregates (flat lanes contribute weight x 0 = 0).
  const adjustments: TargetAllocationAdjustment[] = [];
  const instrumentTilts: { instrumentId: string; netTilt: string }[] = [];
  const nonZeroTilts: string[] = [];

  for (const instrument of instruments) {
    const conflict = conflicts.find((candidate) => candidate.instrumentId === instrument);
    const positions = positionsByInstrument.get(instrument) ?? [];
    const aggregating: ConflictPosition[] =
      conflict === undefined
        ? positions
        : conflict.majorityDirection === null
          ? [] // a recorded tie under 'record-and-majority': no direction stands — tilt 0
          : positions.filter((position) => position.direction === conflict.majorityDirection);
    const weighted = aggregating.map((position) => {
      const weight = laneWeights.get(position.lane) ?? '0';
      const sign = position.direction === 'bullish' ? '1' : position.direction === 'bearish' ? '-1' : '0';
      return sign === '0' ? '0' : sign === '-1' ? `-${weight}` : weight;
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

  // -- 9. the directive verdict ------------------------------------------------
  let directive: PortfolioDirective;
  if (adjustments.length > 0) {
    directive = deepFreeze({ kind: 'allocation-adjustment', adjustments: deepFreeze([...adjustments]) });
  } else {
    const reason =
      instruments.length === 0
        ? ('no-covered-instruments' as const)
        : nonZeroTilts.length === 0
          ? ('flat-consensus' as const)
          : ('insufficient-signal' as const);
    directive = deepFreeze({ kind: 'no-change', reason, instrumentTilts: deepFreeze([...instrumentTilts]) });
  }

  // -- 11. mint the decision (derived id, deepFreeze) ---------------------------
  const construction = createDirectorDecision(
    {
      ...lineage,
      directive,
    },
    input.registry,
  );
  if (!construction.ok) return { ok: false, errors: construction.errors };
  return { ok: true, value: { kind: 'decision', decision: construction.value } };
}
