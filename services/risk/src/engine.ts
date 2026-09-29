/**
 * @tradrl/risk-engine (service) — the reference risk engine (Work Order
 * T020).
 *
 * THE FLOW (the Work Order's scope): compile a RiskPolicy FROM a
 * control-domain constraint-set mirror, drive ExposureComputation over
 * scripted portfolio + market states + fill sequences (exchange-sim
 * fill mirrors), evaluate EVERY limit kind with structured breach
 * reasons, honor the kill-switch mirror (thrown = all blocked), emit
 * the chain-verified audit trail, retain superseded policy versions
 * (L11), and resume from serialized run state (chain-verified).
 *
 * Per measurement step:
 *   1. THE MARKET — `deriveMarketState` derives the pricing facts from
 *      the declared market-event mirrors (L4 information boundary inside).
 *   2. THE MEASUREMENT — `computeExposure` folds the portfolio mirror +
 *      the fill mirrors at the market's reference marks, threading the
 *      prior peak (the high-water mark) — exact decimals, lineage-carrying.
 *   3. THE STATES — `evaluateLimits` evaluates every DECLARED limit of the
 *      policy trail's CURRENT head over the measured exposure, honoring
 *      the step's kill-switch log (a thrown switch blocks everything).
 *      The engine never decides anything from the states (L7): they are
 *      data T019's gate and T012's evaluation consume.
 *   4. THE MEASURES — the exposure measure + one risk-adjusted figure as
 *      an OPAQUE `rfig:` ref (the L7 door: the value is minted into the
 *      ref and appears NOWHERE in the record).
 *   5. THE AUDIT — the evaluation is appended to the append-only,
 *      chain-verified `RiskAuditTrail` (one evaluation, one record).
 *
 * DETERMINISM (L9): the same (steps, policies, switch logs, seed)
 * always produces the byte-identical run — the golden test proves it
 * (deep-equal, twice). No ambient clock: every instant is an explicit
 * step parameter. The session clock advances monotonically with the
 * steps; the drawdown series' instants are strictly increasing.
 *
 * THE RUN STATE is JSON-serializable and resumable:
 * `serializeRiskRunState` emits canonical JSON bytes; `resumeRiskRunState`
 * parses, enforces the schema marker, re-validates every constituent
 * through the contract's guards, re-verifies the kill-switch chain, the
 * policy trail chain, the audit chain and the session-level outcome
 * chain, and refuses a tampered or truncated payload with typed errors.
 *
 * THE OUTCOME CHAIN (the session-level tamper anchor): every step folds
 * `{stepId, evaluationId, exposureRef, killSwitchState, within,
 * breaching, blocked}` onto an FNV-1a chain seeded by the run's identity
 * skeleton — re-derived from the session's own records at resume (the
 * chain heads the run consumed are the truncation anchor).
 *
 * Spec anchors: spec/ARCHITECTURE.md (Execution — "limits... and
 * audit"), spec/ARCHITECTURE-LOCK.md L4, L7, L9, L11, L12.
 */

import {
  appendEvaluation,
  appendRiskPolicy,
  canonicalEvaluationJson,
  canonicalExposureJson,
  canonicalJson,
  canonicalMeasureJson,
  compileRiskPolicy,
  computeExposure,
  currentRiskPolicy,
  deepFreeze,
  deriveMarketState,
  divideRoundHalfUp,
  drawdownSeriesMeasure,
  evaluateLimits,
  exposureMeasureOf,
  fail,
  fnv1a32Hex,
  isDrawdownSeries,
  isExposureRecord,
  isJsonValue,
  isKillSwitchLogMirror,
  isLimitEvaluationRecord,
  isRecord,
  isRiskAuditTrail,
  isRiskMeasureRecord,
  isRiskPolicyTrail,
  isTimestampMs,
  ok,
  riskAdjustedMeasure,
  riskPolicyVersionRef,
  signedCompare,
  startRiskAuditTrail,
  startRiskPolicyTrail,
  validateRiskAuditTrail,
  verifyKillSwitchChainMirror,
  verifyRiskPolicyTrail,
  type DrawdownPoint,
  type ExposureRecord,
  type KillSwitchLogMirror,
  type LimitEvaluationRecord,
  type ProjectId,
  type RiskAuditTrail,
  type RiskMeasureRecord,
  type RiskPolicy,
  type RiskPolicyTrail,
  type RiskResult,
  type Seed,
  type TenantId,
  type TimestampMs,
} from '../../../packages/risk/src/index';

// ---------------------------------------------------------------------------
// The step and the session
// ---------------------------------------------------------------------------

/**
 * One measurement step: the portfolio mirror, the declared market-event
 * mirrors, the fill mirrors (the exposure inputs' execution evidence),
 * the measurement instant, the quote-mid precision and — optionally —
 * the kill-switch log this step honors (defaulting to the session's;
 * a mid-run switch change is exactly this parameter, chain-verified
 * inside the evaluation).
 */
export interface RiskStep {
  readonly stepId: string;
  /** The untrusted portfolio-state mirror (the T018 shapes — validated inside). */
  readonly portfolio: unknown;
  /** The untrusted declared market-event mirrors (validated inside; L4 inside). */
  readonly marketEvents: readonly unknown[];
  /** The untrusted fill mirrors (the T010 shapes — validated inside). */
  readonly fills: readonly unknown[];
  /** The measurement instant (epoch ms — no ambient clock). */
  readonly asOf: TimestampMs;
  /** The quote-mid precision the market state derives mids at. */
  readonly quotePrecision: number;
  /** The kill-switch log this step honors (defaults to the session's). */
  readonly killSwitch?: unknown;
}

/**
 * The resumable run state: everything a later process needs to continue
 * deterministically — the L11 policy trail (superseded versions
 * retained), the honored switch log, every measured exposure,
 * evaluation and measure, the threaded drawdown series, the append-only
 * audit trail, the processed step ids (idempotency) and the outcome
 * chain head (the tamper anchor).
 */
export interface RiskRunSession {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly seed: Seed;
  readonly policyTrail: RiskPolicyTrail;
  readonly killSwitch: KillSwitchLogMirror;
  readonly exposures: readonly ExposureRecord[];
  readonly evaluations: readonly LimitEvaluationRecord[];
  readonly measures: readonly RiskMeasureRecord[];
  readonly drawdownSeries: readonly DrawdownPoint[];
  readonly auditTrail: RiskAuditTrail;
  readonly processedStepIds: readonly string[];
  readonly outcomeChainHead: string;
  readonly now: TimestampMs;
}

/** Guard: `RiskRunSession` (structural; every constituent through its contract guard; the scope laws included). */
export function isRiskRunSession(value: unknown): value is RiskRunSession {
  if (!isRecord(value)) return false;
  if (typeof value.tenant !== 'string' || value.tenant === '') return false;
  if (typeof value.project !== 'string' || value.project === '') return false;
  if (typeof value.seed !== 'string' || value.seed === '') return false;
  if (!isRiskPolicyTrail(value.policyTrail)) return false;
  if (!isKillSwitchLogMirror(value.killSwitch)) return false;
  if (!Array.isArray(value.exposures) || !value.exposures.every((x) => isExposureRecord(x))) return false;
  if (!Array.isArray(value.evaluations) || !value.evaluations.every((x) => isLimitEvaluationRecord(x))) return false;
  if (!Array.isArray(value.measures) || !value.measures.every((x) => isRiskMeasureRecord(x))) return false;
  if (!isDrawdownSeries(value.drawdownSeries)) return false;
  if (!isRiskAuditTrail(value.auditTrail)) return false;
  if (!Array.isArray(value.processedStepIds) || !value.processedStepIds.every((x) => typeof x === 'string' && x !== '')) return false;
  if (typeof value.outcomeChainHead !== 'string' || !/^[0-9a-f]{8}$/.test(value.outcomeChainHead)) return false;
  if (!isTimestampMs(value.now)) return false;
  // L12: the scope binds every constituent trail.
  if (value.policyTrail.tenant !== value.tenant || value.policyTrail.project !== value.project) return false;
  if (value.auditTrail.tenant !== value.tenant || value.auditTrail.project !== value.project) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The outcome chain (the session-level tamper anchor)
// ---------------------------------------------------------------------------

/** The outcome chain's seed: derived from the run's identity skeleton (recoverable from the session). */
function outcomeChainSeed(session: Pick<RiskRunSession, 'tenant' | 'project' | 'seed' | 'policyTrail'>): string {
  const genesisPolicyId = session.policyTrail.entries[0]?.policy.policyId ?? 'unknown';
  return fnv1a32Hex(canonicalJson({ tenant: session.tenant, project: session.project, seed: session.seed, genesisPolicyId, steps: 0 }));
}

/** The canonical tree of one step's outcome (the chain's fold unit — all fields recoverable from the session). */
function stepOutcomeTree(stepId: string, evaluation: LimitEvaluationRecord): string {
  return canonicalJson({
    stepId,
    evaluationId: evaluation.evaluationId,
    exposureRef: evaluation.exposureRef,
    killSwitchState: evaluation.killSwitchState,
    within: evaluation.states.filter((state) => state.state === 'within').length,
    breaching: evaluation.states.filter((state) => state.state === 'breaching').length,
    blocked: evaluation.states.filter((state) => state.state === 'blocked').length,
  });
}

/** Fold one step's outcome onto the chain head. */
function foldOutcome(previousHead: string, stepId: string, evaluation: LimitEvaluationRecord): string {
  return fnv1a32Hex(`${previousHead}${stepOutcomeTree(stepId, evaluation)}`);
}

/**
 * Re-derive the session's outcome chain from its processed step ids +
 * evaluations. `true` iff the recorded head folds identically — a
 * tampered evaluation, a removed step or a truncated history fails (the
 * resume gate's tamper anchor).
 */
export function verifyRunOutcomeChain(session: RiskRunSession): boolean {
  if (!isRiskRunSession(session)) return false;
  if (session.processedStepIds.length !== session.evaluations.length) return false;
  let head = outcomeChainSeed(session);
  for (let index = 0; index < session.evaluations.length; index++) {
    const evaluation = session.evaluations[index];
    const stepId = session.processedStepIds[index];
    if (evaluation === undefined || stepId === undefined) return false;
    head = foldOutcome(head, stepId, evaluation);
  }
  return head === session.outcomeChainHead;
}

/**
 * The session's COHERENCE laws (re-derived at resume):
 *   1. one audit record per evaluation, in order (a truncated or
 *      padded trail fails);
 *   2. every evaluation reasons over the session's own exposure at the
 *      same position (a spliced evaluation fails);
 *   3. the drawdown series mirrors the exposures point-for-point
 *      (asOf, equity, peak, drawdown);
 *   4. every measure's policy version is one the trail RETAINS (a
 *      measure from an unretained policy is unattributable — L11);
 *   5. the switch log's scope is the run's (L12).
 */
export function verifyRunCoherence(session: RiskRunSession): boolean {
  if (!isRiskRunSession(session)) return false;
  if (session.auditTrail.records.length !== session.evaluations.length) return false;
  if (session.exposures.length !== session.evaluations.length) return false;
  if (session.drawdownSeries.length !== session.exposures.length) return false;
  if (session.processedStepIds.length !== session.evaluations.length) return false;
  for (let index = 0; index < session.evaluations.length; index++) {
    const evaluation = session.evaluations[index];
    const exposure = session.exposures[index];
    const record = session.auditTrail.records[index];
    const point = session.drawdownSeries[index];
    if (evaluation === undefined || exposure === undefined || record === undefined || point === undefined) return false;
    if (record.evaluationRef !== evaluation.evaluationId) return false;
    if (evaluation.exposureRef !== exposure.exposureId) return false;
    if (point.asOf !== exposure.asOf || point.equity !== exposure.equity || point.peakEquity !== exposure.peakEquity || point.drawdown !== exposure.drawdown) return false;
  }
  const retainedVersions = new Set(session.policyTrail.entries.map((entry) => `${entry.policy.policyId}@${entry.policy.version}`));
  for (const measure of session.measures) {
    const ref = measure.lineage.policy;
    if (!retainedVersions.has(`${ref.policyId}@${ref.version}`)) return false;
  }
  const switchScope = session.killSwitch.records[0];
  if (switchScope === undefined || switchScope.tenant !== session.tenant || switchScope.project !== session.project) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** The creation input (the genesis policy arrives UNTRUSTED — validated inside). */
export interface CreateRiskRunInput {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly seed: Seed;
  /** The untrusted genesis policy (version 1 — the trail's first entry). */
  readonly genesisPolicy: unknown;
  /** The untrusted switch log the run honors (chain-verified inside). */
  readonly killSwitch: unknown;
  /** The run's starting clock (epoch ms). */
  readonly startAt: TimestampMs;
}

/**
 * Create a run session: validate the scope, start the L11 policy trail
 * with the genesis policy, chain-verify the honored switch log (scope-
 * checked — L12), start the audit trail, and freeze the initial state.
 */
export function createRiskRun(input: CreateRiskRunInput): RiskResult<RiskRunSession> {
  if (!isRecord(input)) {
    return fail('invalid_type', 'createRiskRun requires an input object { tenant, project, seed, genesisPolicy, killSwitch, startAt }');
  }
  if (typeof input.tenant !== 'string' || input.tenant === '') {
    return fail('tenant_missing', 'createRiskRun requires a tenant scope (L12)');
  }
  if (typeof input.project !== 'string' || input.project === '') {
    return fail('tenant_missing', 'createRiskRun requires a project scope (L12/L15)');
  }
  if (typeof input.seed !== 'string' || input.seed === '') {
    return fail('lineage_gap', 'createRiskRun requires the run seed (L9 determinism contract)');
  }
  if (!isTimestampMs(input.startAt)) {
    return fail('invalid_timestamp', 'createRiskRun requires an epoch-ms starting clock');
  }
  const trail = startRiskPolicyTrail(input.genesisPolicy, input.startAt);
  if (!trail.ok) return trail;
  if (!isKillSwitchLogMirror(input.killSwitch)) {
    return fail('killswitch_rewrite', 'createRiskRun requires a structurally valid kill-switch log mirror (the T019 records)');
  }
  const verified = verifyKillSwitchChainMirror(input.killSwitch);
  if (!verified.ok) return verified;
  const switchLog = verified.value;
  const switchScope = switchLog.records[0];
  if (switchScope === undefined) {
    return fail('killswitch_rewrite', 'the switch log carries no genesis record');
  }
  if (switchScope.tenant !== input.tenant || switchScope.project !== input.project) {
    return fail('tenant_missing', `the switch log's scope (${switchScope.tenant}/${switchScope.project}) does not match the run's (${input.tenant}/${input.project}) — cross-tenant runs are inexpressible (L12)`);
  }
  const auditTrail = startRiskAuditTrail(input.tenant, input.project);
  if (!auditTrail.ok) return auditTrail;
  const skeleton = deepFreeze({
    tenant: input.tenant,
    project: input.project,
    seed: input.seed,
    policyTrail: trail.value,
    killSwitch: switchLog,
    exposures: [],
    evaluations: [],
    measures: [],
    drawdownSeries: [],
    auditTrail: auditTrail.value,
    processedStepIds: [],
    outcomeChainHead: '',
    now: input.startAt,
  });
  return ok(deepFreeze({ ...skeleton, outcomeChainHead: outcomeChainSeed(skeleton) }));
}

// ---------------------------------------------------------------------------
// The step transition
// ---------------------------------------------------------------------------

/** The product of one processed measurement step. */
export interface RiskStepOutcome {
  readonly session: RiskRunSession;
  readonly exposure: ExposureRecord;
  readonly evaluation: LimitEvaluationRecord;
  /** The measures this step emitted (the exposure measure + the risk-adjusted figure). */
  readonly measures: readonly RiskMeasureRecord[];
  /** The audit record this step appended. */
  readonly auditRecord: RiskRunSession['auditTrail']['records'][number];
}

/**
 * Process ONE measurement step: derive the market state, measure the
 * exposure (threading the prior peak), evaluate every declared limit
 * under the trail's CURRENT policy head honoring the step's switch log,
 * emit the measures (the risk-adjusted figure as an OPAQUE ref — L7),
 * and append the evaluation to the audit trail. Deterministic: the same
 * (session, step) always produces the same outcome (L9). A duplicate
 * step id is the typed `invalid_state` (one step, one evaluation); the
 * step's instant must strictly follow the drawdown series' last point
 * (the series' instants are strictly increasing) and not precede the
 * session clock.
 */
export function processRiskStep(session: RiskRunSession, step: unknown): RiskResult<RiskStepOutcome> {
  if (!isRiskRunSession(session)) {
    return fail('invalid_type', 'processRiskStep requires a valid run session');
  }
  if (!isRecord(step)) {
    return fail('invalid_type', 'processRiskStep requires a step object { stepId, portfolio, marketEvents, fills, asOf, quotePrecision, killSwitch? }');
  }
  if (typeof step.stepId !== 'string' || step.stepId === '') {
    return fail('invalid_field', 'the step requires a non-empty stepId', 'stepId');
  }
  if (session.processedStepIds.includes(step.stepId)) {
    return fail('invalid_state', `step ${step.stepId} is already processed — one step, one evaluation (idempotency)`, 'stepId');
  }
  if (!isTimestampMs(step.asOf)) {
    return fail('invalid_timestamp', 'the step requires an epoch-ms measurement instant', 'asOf');
  }
  if (typeof step.quotePrecision !== 'number' || !Number.isSafeInteger(step.quotePrecision) || step.quotePrecision < 0) {
    return fail('invalid_field', 'the step requires a non-negative safe integer quote precision', 'quotePrecision');
  }
  // Monotonic time + the strictly increasing drawdown series.
  const lastPoint = session.drawdownSeries[session.drawdownSeries.length - 1];
  if (step.asOf < session.now) {
    return fail('invalid_state', `step ${step.stepId} claims asOf ${step.asOf} before the session clock ${session.now} — session time is monotonic`, 'asOf');
  }
  if (lastPoint !== undefined && step.asOf <= lastPoint.asOf) {
    return fail('invalid_state', `step ${step.stepId} claims asOf ${step.asOf} but the drawdown series' last point is ${lastPoint.asOf} — the series' instants are strictly increasing`, 'asOf');
  }

  // The honored switch log (the step's, or the session's).
  let honored: KillSwitchLogMirror = session.killSwitch;
  if (step.killSwitch !== undefined) {
    if (!isKillSwitchLogMirror(step.killSwitch)) {
      return fail('killswitch_rewrite', 'the step\'s kill-switch log fails the mirror guard (the T019 records)', 'killSwitch');
    }
    const verified = verifyKillSwitchChainMirror(step.killSwitch);
    if (!verified.ok) return verified;
    honored = verified.value;
    const scope = honored.records[0];
    if (scope === undefined || scope.tenant !== session.tenant || scope.project !== session.project) {
      return fail('tenant_missing', `the step's switch log's scope does not match the run's (${session.tenant}/${session.project}) — cross-tenant runs are inexpressible (L12)`, 'killSwitch');
    }
  }

  // The declared inputs' shapes (arrays or absent — never a silent misread).
  const marketEvents = step.marketEvents === undefined ? [] : step.marketEvents;
  const fills = step.fills === undefined ? [] : step.fills;
  if (!Array.isArray(marketEvents)) {
    return fail('invalid_field', 'the step\'s marketEvents must be an array of market-event mirrors', 'marketEvents');
  }
  if (!Array.isArray(fills)) {
    return fail('invalid_field', 'the step\'s fills must be an array of fill mirrors', 'fills');
  }

  // 1. THE MARKET (the declared inputs -> the pricing facts; L4 inside).
  const market = deriveMarketState(marketEvents, step.asOf, step.quotePrecision);
  if (!market.ok) return market;

  // 2. THE MEASUREMENT (the prior peak threads the high-water mark).
  const priorPeakEquity = lastPoint === undefined ? null : lastPoint.peakEquity;
  const exposure = computeExposure({
    portfolio: step.portfolio,
    marketState: market.value,
    fills,
    priorPeakEquity,
    seed: session.seed,
  });
  if (!exposure.ok) return exposure;

  // 3. THE STATES (the trail's CURRENT head; the engine informs, it
  //    never decides — L7).
  const policy = currentRiskPolicy(session.policyTrail);
  const evaluation = evaluateLimits({ exposure: exposure.value, policy, killSwitch: honored });
  if (!evaluation.ok) return evaluation;

  // 4. THE MEASURES (the exposure measure + the risk-adjusted figure —
  //    the value crosses into the OPAQUE ref HERE, the only door).
  const emitted: RiskMeasureRecord[] = [];
  const exposureMeasure = exposureMeasureOf(evaluation.value, exposure.value);
  if (!exposureMeasure.ok) return exposureMeasure;
  emitted.push(exposureMeasure.value);
  if (signedCompare(exposure.value.equity, '0') > 0) {
    // The declared reference figure: gross-notional-over-equity at 8
    // fractional digits, computed exactly from the measured facts. The
    // value is minted into the ref and stored NOWHERE (L7); the
    // declared limitation is the honesty statement.
    const figure = riskAdjustedMeasure({
      figureKind: 'gross_exposure_ratio',
      method: 'reference/gross-over-equity',
      methodVersion: 1,
      value: divideRoundHalfUp(exposure.value.grossNotional, exposure.value.equity, 8),
      declaredLimitation: 'a reference ratio at reference marks over one measured exposure — not a VaR, not a forecast, and never an acceptance criterion (the engine informs, evaluation decides — L7)',
      lineage: evaluation.value.lineage,
      asOf: exposure.value.asOf,
    });
    if (!figure.ok) return figure;
    emitted.push(figure.value);
  }

  // The drawdown series point (the exact-decimal tracking).
  const point: DrawdownPoint = deepFreeze({
    asOf: exposure.value.asOf,
    equity: exposure.value.equity,
    peakEquity: exposure.value.peakEquity,
    drawdown: exposure.value.drawdown,
  });
  const seriesCheck = drawdownSeriesMeasure({ entries: [...session.drawdownSeries, point], lineage: evaluation.value.lineage, asOf: exposure.value.asOf });
  if (!seriesCheck.ok) return seriesCheck;

  // 5. THE AUDIT (one evaluation, one record — append-only).
  const audited = appendEvaluation(session.auditTrail, evaluation.value);
  if (!audited.ok) return audited;
  const auditRecord = audited.value.records[audited.value.records.length - 1];
  if (auditRecord === undefined) {
    return fail('invalid_state', 'the audit append produced no record (impossible by construction)');
  }

  const nextSession: RiskRunSession = deepFreeze({
    ...session,
    killSwitch: honored,
    exposures: [...session.exposures, exposure.value],
    evaluations: [...session.evaluations, evaluation.value],
    measures: [...session.measures, ...emitted],
    drawdownSeries: [...session.drawdownSeries, point],
    auditTrail: audited.value,
    processedStepIds: [...session.processedStepIds, step.stepId],
    outcomeChainHead: foldOutcome(session.outcomeChainHead, step.stepId, evaluation.value),
    now: step.asOf,
  });
  return ok(deepFreeze({ session: nextSession, exposure: exposure.value, evaluation: evaluation.value, measures: emitted, auditRecord }));
}

/**
 * Process a batch of steps in order (the scenario driver). Fails on the
 * first failing transition (typed); the batch is processed left-to-right
 * deterministically.
 */
export function processRiskSteps(session: RiskRunSession, steps: readonly unknown[]): RiskResult<RiskRunSession> {
  let current = session;
  for (const step of steps) {
    const outcome = processRiskStep(current, step);
    if (!outcome.ok) return outcome;
    current = outcome.value.session;
  }
  return ok(current);
}

// ---------------------------------------------------------------------------
// Policy evolution (L11 — the supersede path)
// ---------------------------------------------------------------------------

/** The supersession input. */
export interface SupersedeRunPolicyInput {
  /** The untrusted constraint-set mirror the next version compiles FROM. */
  readonly constraintSet: unknown;
  /** The structured reason the head is superseded (non-empty — L11). */
  readonly reason: string;
  /** The supersession instant (epoch ms; no ambient clock). */
  readonly asOf: TimestampMs;
  /** The precision observed ratio measures are reported at. */
  readonly ratioPrecision: number;
}

/**
 * SUPERSEDE the run's policy: compile the NEXT version from the
 * constraint-set mirror with a `supersedes` pointer naming the trail's
 * head, then append it to the L11 trail (the superseded version is
 * RETAINED — `retainedPolicyVersions` exposes it; there is no removal
 * path). The compiled policy inherits the head's goal and the run's
 * scope. The next step evaluates under the new head; past evaluations
 * stay attributed to the version that produced them.
 */
export function supersedeRunPolicy(session: RiskRunSession, input: SupersedeRunPolicyInput): RiskResult<RiskRunSession> {
  if (!isRiskRunSession(session)) {
    return fail('invalid_type', 'supersedeRunPolicy requires a valid run session');
  }
  if (!isRecord(input)) {
    return fail('invalid_type', 'supersedeRunPolicy requires an input object { constraintSet, reason, asOf, ratioPrecision }');
  }
  if (typeof input.reason !== 'string' || input.reason === '') {
    return fail('invalid_field', 'a supersession carries a structured reason — an unexplained evolution is unauditable history (L11)', 'reason');
  }
  if (!isTimestampMs(input.asOf)) {
    return fail('invalid_timestamp', 'supersedeRunPolicy requires an epoch-ms supersession instant', 'asOf');
  }
  if (typeof input.ratioPrecision !== 'number' || !Number.isSafeInteger(input.ratioPrecision) || input.ratioPrecision < 0) {
    return fail('invalid_field', 'supersedeRunPolicy requires a non-negative safe integer ratio precision', 'ratioPrecision');
  }
  if (input.asOf < session.now) {
    return fail('invalid_state', `the supersession instant ${input.asOf} precedes the session clock ${session.now} — session time is monotonic`, 'asOf');
  }
  const head = currentRiskPolicy(session.policyTrail);
  const compiled = compileRiskPolicy({
    constraintSet: input.constraintSet,
    goal: head.goal,
    tenant: session.tenant,
    project: session.project,
    asOf: input.asOf,
    ratioPrecision: input.ratioPrecision,
    supersedes: riskPolicyVersionRef(head),
  });
  if (!compiled.ok) return compiled;
  const appended = appendRiskPolicy(session.policyTrail, compiled.value, input.reason, input.asOf);
  if (!appended.ok) return appended;
  return ok(deepFreeze({ ...session, policyTrail: appended.value, now: input.asOf }));
}

// ---------------------------------------------------------------------------
// The resumable run state (serialize -> parse -> resume)
// ---------------------------------------------------------------------------

/** The run-state serialization schema marker. */
export const RISK_RUN_STATE_SCHEMA = 'tradrl/risk-run-state@1';

/**
 * Serialize a run session to canonical JSON bytes (the resume artifact
 * — portable across processes). Deterministic: equal sessions produce
 * identical bytes.
 */
export function serializeRiskRunState(session: RiskRunSession): RiskResult<string> {
  if (!isRiskRunSession(session)) {
    return fail('invalid_type', 'serializeRiskRunState requires a valid run session');
  }
  const roundTrip: unknown = JSON.parse(JSON.stringify(session));
  if (!isJsonValue(roundTrip)) {
    return fail('invalid_state', 'the session did not survive the JSON round-trip (impossible by construction)');
  }
  return ok(canonicalJson({ schema: RISK_RUN_STATE_SCHEMA, session: roundTrip }));
}

/**
 * Resume a run session from serialized bytes: parse, enforce the schema
 * marker, re-validate every constituent through the contract's guards,
 * re-verify the kill-switch chain, the policy trail chain (L11), the
 * audit chain, the session coherence and the outcome chain, and refuse a
 * tampered payload with typed errors (`invalid_json` / `invalid_state` /
 * `killswitch_rewrite` / `policy_history_rewrite` / `risk_audit_rewrite`).
 * A resumed session provably consumed the same history and continues
 * appending onto the verified logs.
 */
export function resumeRiskRunState(bytes: string): RiskResult<RiskRunSession> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse failure';
    return fail('invalid_json', `the run state bytes are not valid JSON: ${message}`);
  }
  if (!isRecord(parsed)) {
    return fail('invalid_state', 'the run state envelope must be an object');
  }
  if (parsed.schema !== RISK_RUN_STATE_SCHEMA) {
    return fail('invalid_state', `expected schema "${RISK_RUN_STATE_SCHEMA}", got ${JSON.stringify(parsed.schema)}`);
  }
  const candidate = parsed.session;
  if (!isRiskRunSession(candidate)) {
    return fail('invalid_state', 'the parsed value fails the session guard (scope, policy trail, switch log, exposures, evaluations, measures, drawdown series, audit trail)');
  }
  const session = candidate;
  const switchVerified = verifyKillSwitchChainMirror(session.killSwitch);
  if (!switchVerified.ok) return switchVerified;
  const trailVerified = verifyRiskPolicyTrail(session.policyTrail);
  if (!trailVerified.ok) return trailVerified;
  const auditVerified = validateRiskAuditTrail(session.auditTrail);
  if (!auditVerified.ok) return auditVerified;
  if (!verifyRunCoherence(session)) {
    return fail('risk_audit_rewrite', 'the session is incoherent: the audit trail, the evaluations, the exposures, the drawdown series and the measures disagree (one evaluation, one record, one point, retained policy versions) — the run state was tampered');
  }
  if (!verifyRunOutcomeChain(session)) {
    return fail('invalid_state', 'the session outcome chain does not fold onto the recorded head — an evaluation or step was edited, removed or reordered (the run state was tampered)');
  }
  return ok(deepFreeze(session));
}

// ---------------------------------------------------------------------------
// The golden digest (the determinism fixture's basis)
// ---------------------------------------------------------------------------

/**
 * The digest of a run's whole outcome: the canonical exposures,
 * evaluations and measures, the drawdown series, the audit chain head,
 * the policy trail head and the outcome chain head — folded with
 * FNV-1a over the canonical JSON. Equal runs digest identically (L9);
 * any contract change that alters the byte output changes it visibly.
 */
export function riskRunDigest(session: RiskRunSession): string {
  const auditHead = session.auditTrail.records.length === 0 ? null : session.auditTrail.records[session.auditTrail.records.length - 1]?.chainHead ?? null;
  const policyHead = session.policyTrail.entries[session.policyTrail.entries.length - 1]?.chainHead ?? null;
  return fnv1a32Hex(
    canonicalJson({
      schema: RISK_RUN_STATE_SCHEMA,
      steps: [...session.processedStepIds],
      exposures: session.exposures.map((record) => canonicalExposureJson(record)),
      evaluations: session.evaluations.map((record) => canonicalEvaluationJson(record)),
      measures: session.measures.map((record) => canonicalMeasureJson(record)),
      drawdown: session.drawdownSeries.map((point) => ({ asOf: point.asOf, equity: point.equity, peakEquity: point.peakEquity, drawdown: point.drawdown })),
      auditHead,
      policyHead,
      outcomeHead: session.outcomeChainHead,
    }),
  );
}

/** The run's current policy (the trail's head — what the next step evaluates under). */
export function runPolicy(session: RiskRunSession): RiskPolicy {
  return currentRiskPolicy(session.policyTrail);
}
