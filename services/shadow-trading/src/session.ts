/**
 * @tradrl/shadow_trading — the SHADOW SESSION: the paper-trading stage
 * of the learning loop (spec/LEARNING-LOOP.md curriculum stage 8) and
 * the producer of the outcome records T033 learns from.
 *
 * THE EXISTENTIAL LAW (the enforcement order): every decision passes,
 * in DECLARED order — (1) T019's gate: `runExecutionGate` over
 * (intent, policy, portfolio state, venue state, standing kill
 * switch); (2) T020's risk evaluation: `evaluateLimits` over the
 * measured exposure, `executionLimitRefusals` feeding the gate —
 * BEFORE any submission to the reactive world. A refused OR blocked
 * intent NEVER reaches the world: ZERO world submissions and ZERO
 * fill records per refusal (execution-sim's "refusals never reach the
 * venue", mirrored). Refusals are RECORDS (ShadowRefusal: the T019
 * decision + the T020 limit states + full lineage), never exceptions,
 * never silent drops. A thrown kill switch blocks ALL subsequent
 * submissions.
 *
 * THE TICK MACHINE (per decision, `now = intent.asOf` — no ambient
 * clock anywhere):
 *   1. DRAIN the time-machine cursor at `now` — the point-in-time
 *      information delta (the machine README's T030 contract,
 *      verbatim); the drain's firewall audit feeds the shadow audit
 *      trail; the inclusive L4 boundary is re-proved (defense in
 *      depth).
 *   2. APPLY latency-pending fills whose windows elapsed — a fill
 *      enters the book's knowledge exactly when
 *      `available_time <= now` (inclusive).
 *   3. SETTLE the world to `now` (advance until settled — the
 *      interleaving law's rest state).
 *   4. DERIVE the point-in-time marks from the DECLARED market events
 *      (every deriving event's `available_time <= now` — L4 inside
 *      the risk package's own deriveMarketState).
 *   5. THE CONTROL STACK: gate first (over the CURRENT book), risk
 *      second (the measured exposure: the pre-tick book + this tick's
 *      applied fills) — both run; the refusal record carries both
 *      stages' evidence.
 *   6. SUBMIT only when the whole stack approves; collect the world's
 *      fills (physics lineage enforced), apply the visible ones, defer
 *      the latency-pending ones; derive the disposition; emit the
 *      outcome record; thread the venue state, the rate counters and
 *      the drawdown high-water mark.
 *
 * DETERMINISM (L9): same (decision stream, world inputs, policies,
 * seed) -> byte-identical session (the golden test, run twice). No
 * ambient randomness; every id is content-addressed or ordinal-minted.
 *
 * L12: a cross-tenant intent is the typed `tenant_mismatch` (the
 * envelope law — the session never reasons over a foreign decision).
 */

import { canonicalJson, deepFreeze, fnv1a32Hex, isDigest, isNonEmptyString, isRecord, isTimestampMs, type TimestampMs } from './primitives';
import { type ShadowResult, fail, ok } from './errors';
import { isShadowSessionId, mintShadowSessionId, mintShadowTickId, type ShadowSessionId, type ShadowTickId } from './ids';
import { validateShadowMode, type ShadowMode } from './mode';
import {
  isReactiveWorldPort,
  isReactiveWorldViewMirror,
  requireReactiveFillMirror,
  type ReactiveFillMirror,
  type ReactiveWorldPort,
} from './world-mirror';
import {
  admitDrainedRecords,
  isMachineCursorMirror,
  isMachineDrainMirror,
  type FirewallAuditMirror,
  type TimeMachinePort,
  isTimeMachinePort,
} from './time-machine-mirror';
import {
  applyWorldFill,
  bookFromPortfolio,
  isShadowBook,
  portfolioMirrorOf,
  unrealizedPnlOf,
  type BookLineage,
  type BookMark,
  type ShadowBook,
} from './book';
import {
  appendShadowOutcome,
  isShadowOutcomeLog,
  isShadowRefusal,
  isShadowFill,
  isShadowLineage,
  mintShadowOutcomeRecord,
  mintShadowRefusal,
  startShadowOutcomeLog,
  type ShadowFill,
  type ShadowLineage,
  type ShadowOutcomeLog,
  type ShadowOutcomeRecord,
  type ShadowRefusal,
  type ShadowRefusalStage,
  type ShadowDisposition,
} from './outcomes';

// The contract packages — the ONLY cross-lane imports this lane makes
// (relative source imports; the frozen lockfile admits no workspace
// edge — the services/strategy + services/execution-sim precedent;
// the Lead may convert to `workspace:*` at the next serialized
// lockfile change). The reactive world and the time machine are NOT
// imported: they arrive through the injected ports above.
import {
  add as decAdd,
  compare as decCompare,
  isExecutionPolicy,
  isExecutionVenueState,
  isKillSwitchLog,
  isStrategyIntentMirror,
  multiply as decMultiply,
  normalize as decNormalize,
  runExecutionGate,
  startAuditLog,
  throwKillSwitch,
  validateExecutionPolicy,
  verifyKillSwitchChain,
  appendDecision,
  isAuditLog,
  type ApproveDecision,
  type AuditLog,
  type ExecutionDecision,
  type ExecutionPolicy,
  type ExecutionVenueState,
  type KillSwitchLog,
  type StrategyIntentMirror,
  subtract as decSubtract,
} from '../../../packages/execution-policy/src/index';
import {
  computeExposure,
  deriveMarketState,
  evaluateLimits,
  executionLimitRefusals,
  isExposureRecord,
  isLimitEvaluationRecord,
  isRiskPolicy,
  type ExposureRecord,
  type LimitEvaluationRecord,
  type RiskPolicy,
} from '../../../packages/risk/src/index';

// ---------------------------------------------------------------------------
// The session state
// ---------------------------------------------------------------------------

/** One recorded world submission (the zero-submission assertion's evidence base). */
export interface ShadowSubmissionRecord {
  /** The action envelope's id (`swa-` + zero-padded ordinal). */
  readonly actionId: string;
  /** The client order id the intent carried. */
  readonly clientOrderId: string;
  /** The engine's order id (from the receipt — the fill-attribution key). */
  readonly engineOrderId: string;
  /** The approving decision. */
  readonly decisionId: string;
  /** The gated intent. */
  readonly intentRef: string;
  readonly submittedAt: TimestampMs;
  readonly clientSequence: number;
}

/** One audit-trail tick: the drain's firewall audit + the tick's outcome summary. */
export interface ShadowTickRecord {
  readonly tickId: ShadowTickId;
  readonly at: TimestampMs;
  /** The drain's firewall audit log — the per-tick delegation evidence (the shadow audit trail). */
  readonly drainAudit: FirewallAuditMirror | null;
  /** The drained records' ids (the point-in-time information delta). */
  readonly drainedRecordIds: readonly string[];
  /** The cursor's position after the drain (the resumable offset). */
  readonly cursorPosition: number;
  readonly intentRef: string | null;
  readonly decisionId: string | null;
  readonly submissionActionId: string | null;
  readonly fillsApplied: number;
  readonly fillsPending: number;
}

/** The warm-up evidence (the `asOf` book-initialization view). */
export interface ShadowWarmUp {
  readonly at: TimestampMs;
  readonly viewHash: string;
  readonly recordIds: readonly string[];
}

/** The shadow session: the whole paper-trading state (immutable record + injected ports). */
export interface ShadowSession {
  readonly sessionId: ShadowSessionId;
  readonly mode: ShadowMode;
  readonly tenant: string;
  readonly project: string;
  readonly seed: string;
  /** The shadow trader's actor id (the action envelopes' actor). */
  readonly participant: string;
  /** The injected reactive world (READ-ONLY consumption through the port). */
  readonly world: ReactiveWorldPort;
  /** The injected rolling time machine (READ-ONLY consumption through the port). */
  readonly timeMachine: TimeMachinePort;
  /** The injected decision source (an async iterator of StrategyIntentMirror-shaped records). */
  readonly decisionSource: AsyncIterator<unknown>;

  // --- The control stack's declarations --------------------------------------
  readonly executionPolicy: ExecutionPolicy;
  readonly riskPolicy: RiskPolicy;
  readonly killSwitch: KillSwitchLog;
  /** The T019 audit trail (one record per decision). */
  readonly auditLog: AuditLog;

  // --- The risk lane's declared inputs ----------------------------------------
  readonly marketEvents: readonly unknown[];
  readonly quotePrecision: number;

  // --- The world + machine bindings -------------------------------------------
  readonly episodeId: string;
  readonly cursorId: string;
  readonly cursorFrom: 'start' | 'tip';
  readonly warmUp: ShadowWarmUp;

  // --- The paper account --------------------------------------------------------
  readonly book: ShadowBook;
  /** The threaded drawdown high-water mark (null at genesis). */
  readonly peakEquity: string | null;
  /** The gate's venue view (marks + rate counters, threaded forward). */
  readonly venueState: ExecutionVenueState;

  // --- The logs (all append-only) -------------------------------------------------
  readonly decisions: readonly ExecutionDecision[];
  readonly evaluations: readonly LimitEvaluationRecord[];
  readonly exposures: readonly ExposureRecord[];
  readonly refusals: readonly ShadowRefusal[];
  readonly fills: readonly ShadowFill[];
  readonly submissions: readonly ShadowSubmissionRecord[];
  readonly ticks: readonly ShadowTickRecord[];
  readonly outcomeLog: ShadowOutcomeLog;
  /** The audit-chain head (folds every tick record — the tamper anchor). */
  readonly auditChainHead: string;
  readonly processedIntentIds: readonly string[];

  readonly now: TimestampMs;
  readonly finished: boolean;
  readonly lineage: ShadowLineage;
  readonly bookLineage: BookLineage;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** The creation input (everything arrives UNTRUSTED — validated inside, collect-first). */
export interface CreateShadowSessionInput {
  /** The mode declaration — the literal 'shadow' (validated; 'live'/'exact_replay' are typed dishonesty). */
  readonly mode: unknown;
  readonly tenant: string;
  readonly project: string;
  readonly seed: string;
  /** The shadow trader's actor id (the action envelopes' actor). */
  readonly participant: string;
  /** The injected reactive world port (guarded). */
  readonly world: unknown;
  /** The environment spec the session starts its episode with. */
  readonly worldSpec: unknown;
  /** The injected time-machine port (guarded). */
  readonly timeMachine: unknown;
  /** `from: 'tip'` when going live; `from: 'start'` to replay the retained window. */
  readonly cursorFrom: 'start' | 'tip';
  /** The session's starting clock (epoch ms). */
  readonly startAt: TimestampMs;
  /** The validated T019 execution policy (re-validated inside). */
  readonly executionPolicy: unknown;
  /** The kill-switch log bound to the policy (chain-verified inside). */
  readonly killSwitch: unknown;
  /** The risk lane's declared inputs. */
  readonly risk: {
    /** The validated T020 risk policy. */
    readonly policy: unknown;
    /** The declared market-event mirrors (the point-in-time pricing facts). */
    readonly marketEvents: readonly unknown[];
    /** The quote-mid precision (default 8). */
    readonly quotePrecision?: number;
    /** The genesis high-water mark (null at genesis). */
    readonly priorPeakEquity?: string | null;
  };
  /** The genesis portfolio ({ positions, cash, realizedPnl? }). */
  readonly genesisPortfolio: unknown;
  /** The gate's venue state (marks + rate counters; threaded forward). */
  readonly venueState: unknown;
  /** The injected decision source (an async iterator or async iterable of intents). */
  readonly decisionSource: unknown;
  /** The portfolio-mirror lineage block (the strategy lane's L9 anchors). */
  readonly lineage: {
    readonly strategy: { readonly specId: string; readonly version: number };
    readonly goal: { readonly goalId: string; readonly version: number };
    readonly constraintSet: { readonly id: string; readonly version: number };
    readonly windowId: string;
  };
}

/** Normalize a decision source: an async iterable yields its iterator; an iterator passes through. */
function normalizeDecisionSource(source: unknown): ShadowResult<AsyncIterator<unknown>> {
  if (isRecord(source) && typeof (source as Record<string, unknown>)[Symbol.asyncIterator as unknown as string] === 'function') {
    const iterator = (source as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    return ok(iterator);
  }
  if (isRecord(source) && typeof (source as Record<string, unknown>).next === 'function') {
    return ok(source as unknown as AsyncIterator<unknown>);
  }
  return fail('invalid_source', 'the decision source must be an async iterator (or async iterable) of StrategyIntentMirror-shaped records');
}

/** The settle loop bound (defense against a non-converging world). */
const SETTLE_LIMIT = 10_000;

/** Advance the world until settled at `to` (the interleaving law's rest state). */
function settleWorld(world: ReactiveWorldPort, episodeId: string, to: TimestampMs): ShadowResult<void> {
  for (let iteration = 0; iteration < SETTLE_LIMIT; iteration++) {
    const advanced = world.advance(episodeId, to);
    if (!advanced.ok) {
      return fail('world_error', `the world failed to advance toward ${String(to)}: ${advanced.errors.map((error) => `${error.code}: ${error.message}`).join('; ')}`);
    }
    if (!isReactiveWorldViewMirror(advanced.value)) {
      return fail('world_error', 'the world returned a malformed episode view');
    }
    if (advanced.value.settled) return ok(undefined);
  }
  return fail('world_error', `the world did not settle at ${String(to)} within ${SETTLE_LIMIT} boundaries (non-convergence is impossible by construction)`);
}

/** Start the T019 audit trail (the construction helper — fails loudly on invalid scope). */
function startAuditLogSafe(tenant: string, project: string): ShadowResult<AuditLog> {
  const result = startAuditLog(tenant as never, project as never);
  if (!result.ok) return fail('invalid_state', `the audit trail failed to start: ${result.errors.map((error) => error.message).join('; ')}`);
  return ok(result.value);
}

/**
 * Create a shadow session: validate the whole envelope (mode honesty,
 * scope, ports, policies, switch binding, venue state, genesis
 * book), start the world episode, open the time-machine cursor (`tip`
 * or `start`), warm the book up through `asOf`, and freeze the
 * genesis state. Deterministic: identical inputs -> identical session
 * id (content-addressed over the genesis content).
 */
export function createShadowSession(input: unknown): ShadowResult<ShadowSession> {
  if (!isRecord(input)) return fail('invalid_type', 'createShadowSession requires an input object');
  const candidate = input as unknown as CreateShadowSessionInput;

  // --- The mode honesty law (L5/R23) --------------------------------------------
  const mode = validateShadowMode(candidate.mode);
  if (!mode.ok) return mode;

  // --- The scope (L12/L15) -------------------------------------------------------
  if (!isNonEmptyString(candidate.tenant)) return fail('tenant_mismatch', 'createShadowSession requires a tenant scope (L12)');
  if (!isNonEmptyString(candidate.project)) return fail('tenant_mismatch', 'createShadowSession requires a project scope (L12/L15)');
  if (!isNonEmptyString(candidate.seed)) return fail('lineage_gap', 'createShadowSession requires the session seed (L9 determinism contract)');
  if (!isNonEmptyString(candidate.participant)) return fail('invalid_field', 'createShadowSession requires the shadow participant id (the action envelopes\u2019 actor)');
  if (!isTimestampMs(candidate.startAt)) return fail('invalid_field', 'createShadowSession requires an epoch-ms starting clock');

  // --- The injected ports -----------------------------------------------------------
  if (!isReactiveWorldPort(candidate.world)) return fail('invalid_type', 'createShadowSession requires a reactive world port (the T027 service, injected — never imported)');
  const world = candidate.world;
  if (!isTimeMachinePort(candidate.timeMachine)) return fail('invalid_type', 'createShadowSession requires a time-machine port (the T029 service, injected — never imported)');
  const timeMachine = candidate.timeMachine;
  if (timeMachine.tenant !== candidate.tenant) {
    return fail('tenant_mismatch', `the time machine's tenant (${timeMachine.tenant}) is not the session's (${candidate.tenant}) — cross-tenant consumption is inexpressible (L12)`);
  }

  // --- The decision source -----------------------------------------------------------
  const decisionSource = normalizeDecisionSource(candidate.decisionSource);
  if (!decisionSource.ok) return decisionSource;

  // --- The control stack's declarations --------------------------------------------
  const policyValidated = validateExecutionPolicy(candidate.executionPolicy);
  if (!policyValidated.ok) {
    return fail('invalid_field', `the execution policy fails validation: ${policyValidated.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; ')}`);
  }
  const executionPolicy = policyValidated.value;
  if (executionPolicy.tenant !== candidate.tenant || executionPolicy.project !== candidate.project) {
    return fail('tenant_mismatch', `the execution policy's scope (${executionPolicy.tenant}/${executionPolicy.project}) is not the session's (${candidate.tenant}/${candidate.project}) — cross-tenant sessions are inexpressible (L12)`);
  }
  if (!isKillSwitchLog(candidate.killSwitch)) {
    return fail('killswitch_rewrite', 'createShadowSession requires a structurally valid kill-switch log (the T019 records)');
  }
  const switchVerified = verifyKillSwitchChain(candidate.killSwitch);
  if (!switchVerified.ok) {
    return fail('killswitch_rewrite', `the kill-switch log fails chain verification: ${switchVerified.errors.map((error) => error.message).join('; ')}`);
  }
  const killSwitch = candidate.killSwitch;
  if (killSwitch.switchId !== executionPolicy.killSwitch.switchId) {
    return fail('invalid_field', `the switch log (${killSwitch.switchId}) is not the policy's declared switch (${executionPolicy.killSwitch.switchId}) — the policy enforces exactly one standing switch`);
  }
  const genesisRecord = killSwitch.records[0];
  if (genesisRecord === undefined || genesisRecord.tenant !== candidate.tenant || genesisRecord.project !== candidate.project) {
    return fail('tenant_mismatch', 'the kill-switch log\u2019s scope is not the session\u2019s — cross-tenant switches are inexpressible (L12)');
  }
  if (!isRecord(candidate.risk)) return fail('invalid_field', 'createShadowSession requires the risk lane\u2019s inputs { policy, marketEvents, quotePrecision?, priorPeakEquity? }');
  if (!isRiskPolicy(candidate.risk.policy)) {
    return fail('invalid_field', 'createShadowSession requires a validated risk policy (the T020 contract)');
  }
  const riskPolicy = candidate.risk.policy;
  if (riskPolicy.tenant !== candidate.tenant || riskPolicy.project !== candidate.project) {
    return fail('tenant_mismatch', `the risk policy's scope (${riskPolicy.tenant}/${riskPolicy.project}) is not the session's (${candidate.tenant}/${candidate.project}) — cross-tenant measurement is inexpressible (L12)`);
  }
  const marketEvents = Array.isArray(candidate.risk.marketEvents) ? candidate.risk.marketEvents : [];
  const quotePrecision = candidate.risk.quotePrecision === undefined ? 8 : candidate.risk.quotePrecision;
  if (typeof quotePrecision !== 'number' || !Number.isSafeInteger(quotePrecision) || quotePrecision < 0) {
    return fail('invalid_field', 'the risk lane\u2019s quotePrecision must be a non-negative safe integer');
  }
  const peakEquity = candidate.risk.priorPeakEquity === undefined || candidate.risk.priorPeakEquity === null ? null : candidate.risk.priorPeakEquity;
  if (peakEquity !== null && (typeof peakEquity !== 'string' || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(peakEquity))) {
    return fail('invalid_field', 'the risk lane\u2019s priorPeakEquity must be a signed canonical decimal string or null');
  }

  // --- The gate's venue state ------------------------------------------------------------
  if (!isExecutionVenueState(candidate.venueState)) {
    return fail('invalid_field', 'createShadowSession requires a structurally valid venue state (the gate\u2019s marks + rate counters)');
  }
  const venueState = candidate.venueState;
  if ((venueState.asOf as number) > (candidate.startAt as number)) {
    return fail('invalid_field', `the venue state's asOf (${String(venueState.asOf)}) follows the session's starting clock (${String(candidate.startAt)}) — the gate never reasons over future marks`);
  }

  // --- The genesis book ----------------------------------------------------------------------
  const book = bookFromPortfolio(candidate.genesisPortfolio, candidate.startAt);
  if (!book.ok) return book;

  // --- The world episode -----------------------------------------------------------------------
  const started = world.start(candidate.worldSpec);
  if (!started.ok) {
    return fail('world_error', `the world failed to start the episode: ${started.errors.map((error) => `${error.code}: ${error.message}`).join('; ')}`);
  }
  if (!isReactiveWorldViewMirror(started.value)) {
    return fail('world_error', 'the world returned a malformed episode view at start');
  }
  const episodeId = started.value.episode_id;

  // --- The time-machine cursor (the README contract, verbatim) ------------------------------------
  const cursorOpened = timeMachine.openCursor({ from: candidate.cursorFrom });
  if (!cursorOpened.ok) {
    return fail('machine_error', `the time machine failed to open the cursor: ${cursorOpened.error.code}: ${cursorOpened.error.message}`);
  }
  if (!isMachineCursorMirror(cursorOpened.value)) {
    return fail('machine_error', 'the time machine returned a malformed cursor');
  }
  const cursorId = cursorOpened.value.cursor_id;

  // --- The book warm-up (asOf) ------------------------------------------------------------------------
  const warmed = timeMachine.asOf({ dataset: timeMachine.dataset, at: candidate.startAt });
  if (!warmed.ok) {
    return fail('machine_error', `the time machine failed the warm-up asOf view: ${warmed.error.code}: ${warmed.error.message}`);
  }
  const warmUp: ShadowWarmUp = deepFreeze({
    at: candidate.startAt,
    viewHash: warmed.value.hash,
    recordIds: Object.freeze([...warmed.value.records.map((record) => record.record_id)]),
  });

  // --- The audit trail -----------------------------------------------------------------------------------
  const auditLog = startAuditLogSafe(candidate.tenant, candidate.project);
  if (!auditLog.ok) return auditLog;

  // --- The lineage blocks ------------------------------------------------------------------------------------
  if (!isRecord(candidate.lineage) || !isRecord(candidate.lineage.strategy) || !isRecord(candidate.lineage.goal) || !isRecord(candidate.lineage.constraintSet) || !isNonEmptyString(candidate.lineage.windowId)) {
    return fail('invalid_field', 'createShadowSession requires the lineage block { strategy, goal, constraintSet, windowId }');
  }
  const bookLineage: BookLineage = deepFreeze({
    strategy: candidate.lineage.strategy,
    goal: candidate.lineage.goal,
    constraintSet: candidate.lineage.constraintSet,
    windowId: candidate.lineage.windowId,
    seed: candidate.seed,
    tenant: candidate.tenant,
    project: candidate.project,
  });

  const genesisContent = canonicalJson({
    tenant: candidate.tenant,
    project: candidate.project,
    seed: candidate.seed,
    participant: candidate.participant,
    mode: mode.value,
    executionPolicy: { policyId: executionPolicy.policyId, version: executionPolicy.version },
    riskPolicy: { policyId: riskPolicy.policyId, version: riskPolicy.version },
    worldConfigHash: world.config_hash,
    runId: world.run_id,
    engineConfigHash: world.engine_config_hash,
    dataset: timeMachine.dataset,
    cursorId,
    cursorFrom: candidate.cursorFrom,
    warmUpHash: warmUp.viewHash,
    startAt: candidate.startAt,
    venueStateAsOf: venueState.asOf,
    genesisBook: { cash: book.value.cash, realizedPnl: book.value.realizedPnl, positions: book.value.positions.map((position) => [position.venue, position.instrument, position.quantity, position.costBasis]) },
  });
  const sessionId = mintShadowSessionId(fnv1a32Hex(genesisContent));
  const lineage: ShadowLineage = deepFreeze({
    sessionId,
    fidelity: { mode: 'shadow', fill_origin: 'simulated' },
    executionPolicy: { policyId: executionPolicy.policyId, version: executionPolicy.version },
    riskPolicy: { policyId: riskPolicy.policyId, version: riskPolicy.version },
    configDigests: { worldConfigHash: world.config_hash, engineConfigHash: world.engine_config_hash, dataset: timeMachine.dataset },
    run: { runId: world.run_id, episodeId },
    cursor: { cursorId, position: cursorOpened.value.position },
    seed: candidate.seed,
    tenant: candidate.tenant,
    project: candidate.project,
  });

  return ok(
    deepFreeze({
      sessionId,
      mode: mode.value,
      tenant: candidate.tenant,
      project: candidate.project,
      seed: candidate.seed,
      participant: candidate.participant,
      world,
      timeMachine,
      decisionSource: decisionSource.value,
      executionPolicy,
      riskPolicy,
      killSwitch,
      auditLog: auditLog.value,
      marketEvents: Object.freeze([...marketEvents]),
      quotePrecision,
      episodeId,
      cursorId,
      cursorFrom: candidate.cursorFrom,
      warmUp,
      book: book.value,
      peakEquity,
      venueState,
      decisions: [],
      evaluations: [],
      exposures: [],
      refusals: [],
      fills: [],
      submissions: [],
      ticks: [],
      outcomeLog: startShadowOutcomeLog(),
      auditChainHead: auditChainSeed(sessionId),
      processedIntentIds: [],
      now: candidate.startAt,
      finished: false,
      lineage,
      bookLineage,
    }) as ShadowSession,
  );
}

/** The audit chain's seed (the session's identity skeleton). */
function auditChainSeed(sessionId: string): string {
  return fnv1a32Hex(canonicalJson({ sessionId, ticks: 0 }));
}

// ---------------------------------------------------------------------------
// The decision transition (the tick)
// ---------------------------------------------------------------------------

/** The product of one processed decision. */
export interface ShadowDecisionOutcome {
  readonly session: ShadowSession;
  /** The T019 gate decision (approve or refuse). */
  readonly decision: ExecutionDecision;
  /** The T020 limit evaluation over the measured exposure. */
  readonly evaluation: LimitEvaluationRecord;
  /** The refusal record (null iff the stack approved). */
  readonly refusal: ShadowRefusal | null;
  /** The decision's shadow fills (in emission order; latency-pending ones carry appliedAt null). */
  readonly fills: readonly ShadowFill[];
  /** The outcome record (T033's input). */
  readonly outcome: ShadowOutcomeRecord;
  /** The tick's audit record. */
  readonly tick: ShadowTickRecord;
}

/**
 * Process ONE decision — the whole tick machine (drain, apply, settle,
 * derive, gate, risk, submit-or-refuse, record). Deterministic: the
 * same (session, intent) always produces the same outcome (L9). A
 * duplicate intent id is the typed `invalid_state` (one intent, one
 * decision); a decision instant before the session clock is the typed
 * `clock_not_monotonic`; a cross-tenant intent is the typed
 * `tenant_mismatch` (the L12 envelope law).
 */
export function processShadowDecision(session: unknown, intent: unknown): ShadowResult<ShadowDecisionOutcome> {
  if (!isShadowSession(session)) return fail('invalid_type', 'processShadowDecision requires a valid shadow session');
  const state = session;
  if (state.finished) return fail('invalid_state', 'the session is finished — the decision stream is exhausted');
  if (!isStrategyIntentMirror(intent)) {
    return fail('invalid_type', 'processShadowDecision requires a structurally valid strategy intent (the T018 mirror guard)');
  }
  const decisionIntent = intent;
  if (state.processedIntentIds.includes(decisionIntent.intentId)) {
    return fail('invalid_state', `intent ${decisionIntent.intentId} is already decided — one intent, one decision (idempotency)`);
  }
  if ((decisionIntent.asOf as number) < (state.now as number)) {
    return fail('clock_not_monotonic', `intent ${decisionIntent.intentId} claims asOf ${String(decisionIntent.asOf)} before the session clock ${String(state.now)} — session time is monotonic`);
  }
  // L12 (the envelope law): a foreign intent is an operational crime,
  // not evidence — the gate's identity refusal covers same-tenant
  // principal mismatches.
  if (decisionIntent.tenant !== state.tenant || decisionIntent.project !== state.project) {
    return fail(
      'tenant_mismatch',
      `intent ${decisionIntent.intentId} belongs to ${decisionIntent.tenant}/${decisionIntent.project}, not the session's ${state.tenant}/${state.project} — cross-tenant decisions are inexpressible (L12)`,
    );
  }

  const now = decisionIntent.asOf;
  const preTickBook = state.book;

  // --- 1. THE DRAIN (the point-in-time information delta) --------------------------------
  const drained = state.timeMachine.drainCursor(state.cursorId, now);
  if (!drained.ok) {
    return fail('machine_error', `the time machine failed to drain the cursor at ${String(now)}: ${drained.error.code}: ${drained.error.message}`);
  }
  if (!isMachineDrainMirror(drained.value)) {
    return fail('machine_error', 'the time machine returned a malformed drain');
  }
  const drain = drained.value;
  const admitted = admitDrainedRecords(drain);
  if (!admitted.ok) return admitted;

  // --- 2. APPLY the latency-pending fills whose windows elapsed -------------------------------------
  let book = state.book;
  const appliedThisTick: ShadowFill[] = [];
  const stillPending: ShadowFill[] = [];
  for (const pending of state.fills) {
    if (pending.appliedAt !== null) continue;
    if ((pending.availableAt as number) <= (now as number)) {
      const accountRole: 'taker' | 'maker' = accountRoleOf(state, pending);
      const effect = applyWorldFill(book, pending.worldFill, accountRole);
      if (!effect.ok) return effect;
      book = effect.value.book;
      appliedThisTick.push(deepFreeze({ ...pending, appliedAt: now }));
    } else {
      stillPending.push(pending);
    }
  }
  const previouslyApplied = state.fills.filter((fill) => fill.appliedAt !== null);

  // --- 3. SETTLE the world --------------------------------------------------------------------------------
  const settled = settleWorld(state.world, state.episodeId, now);
  if (!settled.ok) return settled;

  // --- 4. DERIVE the point-in-time marks -------------------------------------------------------------------
  const visibleEvents = state.marketEvents.filter((event) => {
    if (!isRecord(event)) return false;
    const available = event.available_time;
    return typeof available === 'number' && Number.isSafeInteger(available) && available <= (now as number);
  });
  const marketState = deriveMarketState(visibleEvents, now, state.quotePrecision);
  if (!marketState.ok) {
    return fail('invalid_field', `the point-in-time market state failed to derive: ${marketState.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; ')}`);
  }
  const marks: BookMark[] = marketState.value.instruments.map((entry) => deepFreeze({ venue: entry.venue, instrument: entry.instrument, price: entry.referencePrice, source: entry.priceSource }));
  const markOf = (venue: string, instrument: string): string | undefined => {
    const found = marketState.value.instruments.find((entry) => entry.venue === venue && entry.instrument === instrument);
    return found === undefined ? undefined : found.referencePrice;
  };

  // --- 5a. THE GATE (T019 — stage one of the declared order) --------------------------------------------------
  // The gate reasons over the CURRENT book (post-application) — the
  // pending fills that became visible are the account's facts now.
  const gatePortfolio = portfolioMirrorOf(book, marks, state.bookLineage, fnv1a32Hex);
  const threadedVenueState = threadVenueMarks(state.venueState, markOf, now);
  const gate = runExecutionGate({
    intent: decisionIntent,
    policy: state.executionPolicy,
    portfolio: gatePortfolio,
    venueState: threadedVenueState,
    killSwitch: state.killSwitch,
  });
  if (!gate.ok) {
    return fail('invalid_field', `the execution gate refused to reason over the envelope: ${gate.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; ')}`);
  }
  const decision = gate.value;

  // --- 5b. THE RISK MEASUREMENT (T020 — stage two) --------------------------------------------------------------
  // The exposure fold: the PRE-tick book + this tick's applied fills
  // (the reference risk engine's step semantics — the measured state
  // equals the current book for taker-role fills).
  const exposurePortfolio = portfolioMirrorOf(preTickBook, marks, state.bookLineage, fnv1a32Hex);
  const exposure = computeExposure({
    portfolio: exposurePortfolio,
    marketState: marketState.value,
    fills: appliedThisTick.map((fill) => fill.worldFill.fill),
    priorPeakEquity: state.peakEquity,
    seed: state.seed,
  });
  if (!exposure.ok) {
    return fail('invalid_field', `the exposure measurement failed: ${exposure.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; ')}`);
  }
  const evaluation = evaluateLimits({ exposure: exposure.value, policy: state.riskPolicy, killSwitch: state.killSwitch });
  if (!evaluation.ok) {
    return fail('invalid_field', `the limit evaluation failed: ${evaluation.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; ')}`);
  }
  const limitRefusals = executionLimitRefusals(evaluation.value);
  const blockedStates = evaluation.value.states.filter((limitState) => limitState.state === 'blocked');
  const gateRefused = decision.kind === 'refuse';
  const riskRefused = limitRefusals.length > 0 || blockedStates.length > 0;

  // --- 6. THE REFUSAL PATH (zero world submissions, zero fills) ----------------------------------------------
  if (gateRefused || riskRefused) {
    const stage: ShadowRefusalStage = gateRefused ? 'gate' : 'risk';
    const refusal = mintShadowRefusal({
      stage,
      gate: decision as unknown as Record<string, unknown>,
      risk: evaluation.value as unknown as Record<string, unknown>,
      limitRefusals: limitRefusals as unknown as readonly Record<string, unknown>[],
      intentRef: decisionIntent.intentId,
      lineage: lineageAt(state, drain.position),
      asOf: now,
    });
    const outcome = mintShadowOutcomeRecord({
      ordinal: state.outcomeLog.records.length + 1,
      intentRef: decisionIntent.intentId,
      decisionRef: decision.decisionId,
      refusalRef: refusal.refusalId,
      disposition: 'refused',
      fills: [],
      costs: { feeTotal: '0', notionalTotal: '0' },
      realizedOutcome: '0',
      unrealizedAtDecision: unrealizedPnlOf(book, marks),
      priorChainHead: state.outcomeLog.head,
      lineage: lineageAt(state, drain.position),
      asOf: now,
    });
    const appended = appendShadowOutcome(state.outcomeLog, outcome);
    if (!appended.ok) return appended;
    const audited = appendDecision(state.auditLog, decision);
    if (!audited.ok) return fail('invalid_state', `the audit trail rejected the decision: ${audited.errors.map((error) => error.message).join('; ')}`);
    const tick: ShadowTickRecord = deepFreeze({
      tickId: mintShadowTickId(state.ticks.length + 1),
      at: now,
      drainAudit: drain.audit,
      drainedRecordIds: Object.freeze([...drain.records.map((record) => record.record_id)]),
      cursorPosition: drain.position,
      intentRef: decisionIntent.intentId,
      decisionId: decision.decisionId,
      submissionActionId: null,
      fillsApplied: appliedThisTick.length,
      fillsPending: stillPending.length,
    });
    const nextSession: ShadowSession = deepFreeze({
      ...state,
      book,
      fills: [...previouslyApplied, ...appliedThisTick, ...stillPending],
      decisions: [...state.decisions, decision],
      evaluations: [...state.evaluations, evaluation.value],
      exposures: [...state.exposures, exposure.value],
      refusals: [...state.refusals, refusal],
      auditLog: audited.value,
      outcomeLog: appended.value,
      ticks: [...state.ticks, tick],
      auditChainHead: foldTick(state.auditChainHead, tick),
      processedIntentIds: [...state.processedIntentIds, decisionIntent.intentId],
      peakEquity: maxPeak(state.peakEquity, exposure.value.equity),
      now,
      venueState: threadedVenueState,
      lineage: lineageAt(state, drain.position),
    });
    return ok(deepFreeze({ session: nextSession, decision, evaluation: evaluation.value, refusal, fills: [], outcome, tick }));
  }

  // --- 6'. THE APPROVAL PATH (submit to the world) -------------------------------------------------------------
  const approve = decision as ApproveDecision;
  const submissionOrdinal = state.submissions.length + 1;
  const actionId = `swa-${String(submissionOrdinal).padStart(8, '0')}`;
  const action = deepFreeze({
    action_id: actionId,
    actor: state.participant,
    submitted_at: now,
    client_sequence: submissionOrdinal,
    payload: deepFreeze({ type: 'submit_order', intent: orderIntentOf(decisionIntent) }),
  });
  const submitted = state.world.submit(state.episodeId, action);
  if (!submitted.ok) {
    return fail('world_error', `the world rejected the approved submission: ${submitted.errors.map((error) => `${error.code}: ${error.message}`).join('; ')}`);
  }
  const receipt = submitted.value.receipt;
  const submission: ShadowSubmissionRecord = deepFreeze({
    actionId,
    clientOrderId: decisionIntent.order.clientOrderId,
    engineOrderId: receipt.engine.order_id,
    decisionId: approve.decisionId,
    intentRef: decisionIntent.intentId,
    submittedAt: now,
    clientSequence: submissionOrdinal,
  });

  // --- Collect the world's NEW fills (physics lineage enforced) ----------------------------------------------
  const worldFills = state.world.fills(state.episodeId);
  if (!worldFills.ok) {
    return fail('world_error', `the world failed to report its fill log: ${worldFills.errors.map((error) => `${error.code}: ${error.message}`).join('; ')}`);
  }
  const knownFillIds = new Set(state.fills.map((fill) => fill.worldFill.fill_id));
  const engineOrders = new Map<string, ShadowSubmissionRecord>();
  for (const prior of state.submissions) engineOrders.set(prior.engineOrderId, prior);
  engineOrders.set(submission.engineOrderId, submission);
  const newFills: Omit<ShadowFill, 'fillId' | 'sequence'>[] = [];
  for (const worldFill of worldFills.value) {
    if (knownFillIds.has(worldFill.fill_id)) continue;
    const required = requireReactiveFillMirror(worldFill);
    if (!required.ok) return required;
    // Attribution: MY submission's engine order is the taker or the maker of this fill.
    const asTaker = engineOrders.get(worldFill.taker_order_id);
    const asMaker = engineOrders.get(worldFill.maker_order_id);
    const owning = asTaker ?? asMaker;
    if (owning === undefined) continue; // another participant's fill — not this book's account
    newFills.push(
      deepFreeze({
        worldFill,
        decisionId: owning.decisionId,
        intentRef: owning.intentRef,
        availableAt: worldFill.fill.quartet.available_time,
        appliedAt: (worldFill.fill.quartet.available_time as number) <= (now as number) ? now : null,
        lineage: lineageAt(state, drain.position),
      }),
    );
  }
  // Ordinal-mint the fill ids (emission order: the world's fill order).
  const mintedFills: ShadowFill[] = newFills.map((fill, index) => {
    const sequence = state.fills.length + index + 1;
    return deepFreeze({ ...fill, fillId: `swf-${String(sequence).padStart(8, '0')}`, sequence });
  });

  // --- Apply the visible ones to the book --------------------------------------------------------------------------
  let postSubmitBook = book;
  let realizedOutcome = '0';
  const decisionFills: ShadowFill[] = [];
  for (const fill of mintedFills) {
    if (fill.decisionId !== approve.decisionId) continue;
    decisionFills.push(fill);
    if (fill.appliedAt !== null) {
      const accountRole: 'taker' | 'maker' = fill.worldFill.taker_order_id === submission.engineOrderId ? 'taker' : 'maker';
      const effect = applyWorldFill(postSubmitBook, fill.worldFill, accountRole);
      if (!effect.ok) return effect;
      postSubmitBook = effect.value.book;
      realizedOutcome = signedAddExact(realizedOutcome, effect.value.realizedDelta);
    }
  }
  // Earlier decisions' newly-collected fills also apply when visible (their latency windows elapsed).
  for (const fill of mintedFills) {
    if (fill.decisionId === approve.decisionId || fill.appliedAt === null) continue;
    const owning = engineOrders.get(fill.worldFill.taker_order_id) ?? engineOrders.get(fill.worldFill.maker_order_id);
    if (owning === undefined) continue;
    const accountRole: 'taker' | 'maker' = fill.worldFill.taker_order_id === owning.engineOrderId ? 'taker' : 'maker';
    const effect = applyWorldFill(postSubmitBook, fill.worldFill, accountRole);
    if (!effect.ok) return effect;
    postSubmitBook = effect.value.book;
  }

  // --- The costs (exact decimals over the decision's fills) ------------------------------------------------------------
  let feeTotal = '0';
  let notionalTotal = '0';
  for (const fill of decisionFills) {
    const engineFill = fill.worldFill.fill;
    const isTaker = engineFill.taker_order_id === submission.engineOrderId;
    const accountFee = isTaker ? engineFill.taker_fee : engineFill.maker_fee;
    const accountPrice = isTaker ? engineFill.aggressor_price : engineFill.price;
    feeTotal = decAdd(feeTotal, decNormalize(accountFee));
    notionalTotal = decAdd(notionalTotal, decMultiply(decNormalize(accountPrice), decNormalize(engineFill.quantity)));
  }

  // --- The disposition (the declared window interpretation) ---------------------------------------------------------------
  const filledQuantity = decisionFills.reduce((total, fill) => decAdd(total, decNormalize(fill.worldFill.fill.quantity)), '0');
  const orderQuantity = decNormalize(decisionIntent.order.quantity);
  const disposition: ShadowDisposition =
    receipt.engine.kind === 'reject'
      ? 'expired'
      : decCompare(filledQuantity, orderQuantity) === 0
        ? 'filled'
        : decCompare(filledQuantity, '0') > 0
          ? 'partial'
          : 'expired';

  // --- The outcome record ------------------------------------------------------------------------------------------------
  const outcome = mintShadowOutcomeRecord({
    ordinal: state.outcomeLog.records.length + 1,
    intentRef: decisionIntent.intentId,
    decisionRef: approve.decisionId,
    refusalRef: null,
    disposition,
    fills: decisionFills.map((fill) => fill.fillId),
    costs: { feeTotal: decNormalize(feeTotal), notionalTotal: decNormalize(notionalTotal) },
    realizedOutcome: decNormalize(realizedOutcome),
    unrealizedAtDecision: unrealizedPnlOf(postSubmitBook, marks),
    priorChainHead: state.outcomeLog.head,
    lineage: lineageAt(state, drain.position),
    asOf: now,
  });
  const appended = appendShadowOutcome(state.outcomeLog, outcome);
  if (!appended.ok) return appended;
  const audited = appendDecision(state.auditLog, decision);
  if (!audited.ok) return fail('invalid_state', `the audit trail rejected the decision: ${audited.errors.map((error) => error.message).join('; ')}`);

  // --- The venue state threading (the rate counter + the last fill's print price) -------------------------------------------
  const lastFillPrice = decisionFills.length > 0 ? decisionFills[decisionFills.length - 1]?.worldFill.fill.price : undefined;
  const postVenueState = threadVenueRate(threadVenueMarks(state.venueState, markOf, now), decisionIntent, lastFillPrice);

  // --- The tick record -------------------------------------------------------------------------------------------------------
  const pendingAfter = [...stillPending, ...mintedFills.filter((fill) => fill.appliedAt === null)];
  const tick: ShadowTickRecord = deepFreeze({
    tickId: mintShadowTickId(state.ticks.length + 1),
    at: now,
    drainAudit: drain.audit,
    drainedRecordIds: Object.freeze([...drain.records.map((record) => record.record_id)]),
    cursorPosition: drain.position,
    intentRef: decisionIntent.intentId,
    decisionId: approve.decisionId,
    submissionActionId: actionId,
    fillsApplied: appliedThisTick.length + mintedFills.filter((fill) => fill.appliedAt !== null).length,
    fillsPending: pendingAfter.length,
  });

  const nextSession: ShadowSession = deepFreeze({
    ...state,
    book: postSubmitBook,
    fills: [...previouslyApplied, ...appliedThisTick, ...mintedFills, ...stillPending],
    decisions: [...state.decisions, decision],
    evaluations: [...state.evaluations, evaluation.value],
    exposures: [...state.exposures, exposure.value],
    refusals: state.refusals,
    submissions: [...state.submissions, submission],
    auditLog: audited.value,
    outcomeLog: appended.value,
    ticks: [...state.ticks, tick],
    auditChainHead: foldTick(state.auditChainHead, tick),
    processedIntentIds: [...state.processedIntentIds, decisionIntent.intentId],
    peakEquity: maxPeak(state.peakEquity, exposure.value.equity),
    now,
    venueState: postVenueState,
    lineage: lineageAt(state, drain.position),
  });
  return ok(deepFreeze({ session: nextSession, decision, evaluation: evaluation.value, refusal: null, fills: decisionFills, outcome, tick }));
}

// ---------------------------------------------------------------------------
// The kill switch (the session-level control)
// ---------------------------------------------------------------------------

/**
 * THROW the session's kill switch: the T019 append-only log gains its
 * `thrown` record. Every SUBSEQUENT decision refuses with the
 * kill-switch reason (the gate's dominance) and the world receives
 * NOTHING. The throw instant must not precede the session clock.
 */
export function throwShadowKillSwitch(session: unknown, reason: string, thrownAt: TimestampMs): ShadowResult<ShadowSession> {
  if (!isShadowSession(session)) return fail('invalid_type', 'throwShadowKillSwitch requires a valid shadow session');
  if (!isTimestampMs(thrownAt)) return fail('invalid_field', 'throwShadowKillSwitch requires an epoch-ms throw instant');
  if ((thrownAt as number) < (session.now as number)) {
    return fail('clock_not_monotonic', `the kill switch cannot be thrown at ${String(thrownAt)}, before the session clock ${String(session.now)} — session time is monotonic`);
  }
  const thrown = throwKillSwitch(session.killSwitch, reason, thrownAt);
  if (!thrown.ok) {
    return fail('invalid_state', `the kill switch rejected the throw: ${thrown.errors.map((error) => error.message).join('; ')}`);
  }
  return ok(deepFreeze({ ...session, killSwitch: thrown.value, now: thrownAt }));
}

// ---------------------------------------------------------------------------
// The fork (a second shadow book without rewinding the first)
// ---------------------------------------------------------------------------

/** The fork options. */
export interface ForkShadowSessionOptions {
  /** A fresh decision source for the forked book (the shared default cannot be re-consumed independently). */
  readonly decisionSource?: unknown;
}

/**
 * Fork the session: `forkCursor` opens a second consumer at the
 * IDENTICAL delta anchors — the second shadow book re-runs the same
 * delta stream WITHOUT rewinding the first's cursor. The forked
 * session carries the fork's lineage (a derived session id) and
 * shares the world episode and the control-stack declarations.
 */
export function forkShadowSession(session: unknown, options: ForkShadowSessionOptions = {}): ShadowResult<ShadowSession> {
  if (!isShadowSession(session)) return fail('invalid_type', 'forkShadowSession requires a valid shadow session');
  const forked = session.timeMachine.forkCursor(session.cursorId);
  if (!forked.ok) {
    return fail('machine_error', `the time machine failed to fork the cursor: ${forked.error.code}: ${forked.error.message}`);
  }
  if (!isMachineCursorMirror(forked.value)) {
    return fail('machine_error', 'the time machine returned a malformed forked cursor');
  }
  let decisionSource: AsyncIterator<unknown> = session.decisionSource;
  if (options.decisionSource !== undefined) {
    const normalized = normalizeDecisionSource(options.decisionSource);
    if (!normalized.ok) return normalized;
    decisionSource = normalized.value;
  }
  const forkSessionId = mintShadowSessionId(fnv1a32Hex(`${session.sessionId}:fork:${forked.value.cursor_id}`));
  return ok(
    deepFreeze({
      ...session,
      sessionId: forkSessionId,
      cursorId: forked.value.cursor_id,
      decisionSource,
      lineage: { ...session.lineage, sessionId: forkSessionId, cursor: { ...session.lineage.cursor, cursorId: forked.value.cursor_id } },
    }) as ShadowSession,
  );
}

// ---------------------------------------------------------------------------
// The run loop (the async driver)
// ---------------------------------------------------------------------------

/**
 * Drive the session to exhaustion: pull every decision from the
 * injected source, process each through the tick machine, then finish
 * the world episode and seal the session. Fails on the first typed
 * failure (the failure carries the offending decision's error).
 */
export async function runShadowSession(session: unknown): Promise<ShadowResult<ShadowSession>> {
  if (!isShadowSession(session)) return fail('invalid_type', 'runShadowSession requires a valid shadow session');
  let state: ShadowSession = session;
  for (;;) {
    const next = await state.decisionSource.next();
    if (next.done === true) break;
    const outcome = processShadowDecision(state, next.value);
    if (!outcome.ok) return outcome;
    state = outcome.value.session;
  }
  const finished = state.world.finish(state.episodeId, { code: 'completed', detail: 'shadow session decision stream exhausted' });
  if (!finished.ok) {
    return fail('world_error', `the world failed to finish the episode: ${finished.errors.map((error) => `${error.code}: ${error.message}`).join('; ')}`);
  }
  return ok(deepFreeze({ ...state, finished: true }));
}

// ---------------------------------------------------------------------------
// Session guard + local helpers
// ---------------------------------------------------------------------------

/**
 * Public structural guard: a shadow session — TOTAL over every
 * constituent the serialized run state carries (the resume gate's
 * final structural layer: "re-validate every constituent through its
 * guard" — run-state.ts's README law). The guard covers the injected
 * seams' bindings (participant, episode, cursor, cursor mode), the
 * paper account (book + the threaded peak), the declared inputs
 * (market events, quote precision), the lineage blocks (session,
 * book) and the warm-up evidence — none of which any chain covers.
 */
export function isShadowSession(v: unknown): v is ShadowSession {
  if (!isRecord(v)) return false;
  if (!isShadowSessionId(v.sessionId)) return false;
  if (v.mode !== 'shadow') return false;
  if (!isNonEmptyString(v.tenant) || !isNonEmptyString(v.project) || !isNonEmptyString(v.seed)) return false;
  if (!isNonEmptyString(v.participant)) return false;
  if (!isNonEmptyString(v.episodeId) || !isNonEmptyString(v.cursorId)) return false;
  if (v.cursorFrom !== 'start' && v.cursorFrom !== 'tip') return false;
  if (!isReactiveWorldPort(v.world)) return false;
  if (!isTimeMachinePort(v.timeMachine)) return false;
  if (!isRecord(v.decisionSource) || typeof (v.decisionSource as Record<string, unknown>).next !== 'function') return false;
  if (!isExecutionPolicy(v.executionPolicy)) return false;
  if (!isRiskPolicy(v.riskPolicy)) return false;
  if (!isKillSwitchLog(v.killSwitch)) return false;
  if (!isAuditLog(v.auditLog)) return false;
  if (!isExecutionVenueState(v.venueState)) return false;
  if (!isShadowBook(v.book)) return false;
  if (v.peakEquity !== null && (typeof v.peakEquity !== 'string' || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(v.peakEquity))) return false;
  if (!Array.isArray(v.marketEvents) || !v.marketEvents.every((event) => isRecord(event))) return false;
  if (typeof v.quotePrecision !== 'number' || !Number.isSafeInteger(v.quotePrecision) || v.quotePrecision < 0) return false;
  if (!isDigest(v.auditChainHead)) return false;
  if (!isShadowOutcomeLog(v.outcomeLog)) return false;
  if (!Array.isArray(v.decisions) || !v.decisions.every((x) => isRecord(x) && (x.kind === 'approve' || x.kind === 'refuse'))) return false;
  if (!Array.isArray(v.evaluations) || !v.evaluations.every((x) => isLimitEvaluationRecord(x))) return false;
  if (!Array.isArray(v.exposures) || !v.exposures.every((x) => isExposureRecord(x))) return false;
  if (!Array.isArray(v.fills) || !v.fills.every((x) => isShadowFill(x))) return false;
  if (!Array.isArray(v.refusals) || !v.refusals.every((x) => isShadowRefusal(x))) return false;
  if (!Array.isArray(v.submissions) || !v.submissions.every((x) => isRecord(x) && isNonEmptyString(x.actionId))) return false;
  if (!Array.isArray(v.ticks) || !v.ticks.every((x) => isRecord(x) && isNonEmptyString(x.tickId))) return false;
  if (!Array.isArray(v.processedIntentIds) || !v.processedIntentIds.every((x) => isNonEmptyString(x))) return false;
  if (!isShadowLineage(v.lineage)) return false;
  if (!isBookLineageShaped(v.bookLineage)) return false;
  if (!isWarmUpShaped(v.warmUp)) return false;
  if (!isTimestampMs(v.now)) return false;
  if (typeof v.finished !== 'boolean') return false;
  return true;
}

/** Structural check: the book lineage block (the strategy lane's L9 anchors). */
function isBookLineageShaped(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (!isRecord(v.strategy) || !isRecord(v.goal) || !isRecord(v.constraintSet)) return false;
  return isNonEmptyString(v.windowId) && isNonEmptyString(v.seed) && isNonEmptyString(v.tenant) && isNonEmptyString(v.project);
}

/** Structural check: the warm-up evidence block (the asOf view's binding). */
function isWarmUpShaped(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.at)) return false;
  if (!isNonEmptyString(v.viewHash)) return false;
  if (!Array.isArray(v.recordIds) || !v.recordIds.every((x) => isNonEmptyString(x))) return false;
  return true;
}

/** The account role of one pending fill (taker iff its taker order is the owning submission's engine order). */
function accountRoleOf(state: ShadowSession, fill: ShadowFill): 'taker' | 'maker' {
  const owning = state.submissions.find((prior) => prior.decisionId === fill.decisionId);
  if (owning === undefined) return 'taker';
  return fill.worldFill.taker_order_id === owning.engineOrderId ? 'taker' : 'maker';
}

/** The lineage block at the current cursor position (threaded per tick). */
function lineageAt(state: ShadowSession, position: number): ShadowLineage {
  return { ...state.lineage, cursor: { ...state.lineage.cursor, position } };
}

/** Fold one tick record onto the audit chain head. */
function foldTick(previousHead: string, tick: ShadowTickRecord): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson({
    tickId: tick.tickId,
    at: tick.at,
    drainedRecordIds: [...tick.drainedRecordIds],
    cursorPosition: tick.cursorPosition,
    intentRef: tick.intentRef,
    decisionId: tick.decisionId,
    submissionActionId: tick.submissionActionId,
    fillsApplied: tick.fillsApplied,
    fillsPending: tick.fillsPending,
  })}`);
}

/** Re-derive the audit chain over every tick (the resume tamper anchor). */
export function verifyShadowAuditChain(session: ShadowSession): boolean {
  let head = auditChainSeed(session.sessionId);
  for (const tick of session.ticks) {
    head = foldTick(head, tick);
  }
  return head === session.auditChainHead;
}

/** Thread the venue state's marks from the derived point-in-time market state. */
function threadVenueMarks(state: ExecutionVenueState, markOf: (venue: string, instrument: string) => string | undefined, asOf: TimestampMs): ExecutionVenueState {
  const instruments = state.instruments.map((entry) => {
    const mark = markOf(entry.venue, entry.instrument);
    return mark === undefined ? entry : { ...entry, referencePrice: mark };
  });
  return deepFreeze({ ...state, asOf, instruments }) as ExecutionVenueState;
}

/** Thread the venue state's rate counter (+1 for the intent's venue) and the last fill's print price. */
function threadVenueRate(state: ExecutionVenueState, intent: StrategyIntentMirror, lastFillPrice: string | undefined): ExecutionVenueState {
  const instruments = state.instruments.map((entry) => {
    if (entry.venue !== intent.order.venueId) return entry;
    const rateWindowOrderCount = entry.rateWindowOrderCount + 1;
    if (entry.instrument !== intent.order.instrumentId || lastFillPrice === undefined) return { ...entry, rateWindowOrderCount };
    return { ...entry, rateWindowOrderCount, referencePrice: lastFillPrice };
  });
  return deepFreeze({ ...state, instruments }) as ExecutionVenueState;
}

/** The order-intent body the world's action payload carries (the domain-core Order mirror vocabulary). */
function orderIntentOf(intent: StrategyIntentMirror): Record<string, unknown> {
  const order: Record<string, unknown> = {
    clientOrderId: intent.order.clientOrderId,
    instrumentId: intent.order.instrumentId,
    venueId: intent.order.venueId,
    side: intent.order.side,
    kind: intent.order.kind,
    quantity: intent.order.quantity,
    timeInForce: intent.order.timeInForce,
    createdAt: intent.order.createdAt,
  };
  if (intent.order.price !== undefined) order.price = intent.order.price;
  if (intent.order.stopPrice !== undefined) order.stopPrice = intent.order.stopPrice;
  if (intent.order.expiresAt !== undefined) order.expiresAt = intent.order.expiresAt;
  return order;
}

/** The exact max of the threaded peak and the new equity (the drawdown high-water mark). */
function maxPeak(prior: string | null, equity: string): string {
  if (prior === null) return equity;
  return decCompare(prior, equity) >= 0 ? prior : equity;
}

/** Exact signed addition (the local signed extension over the contract arithmetic). */
function signedAddExact(a: string, b: string): string {
  const aNeg = a.startsWith('-');
  const bNeg = b.startsWith('-');
  const aAbs = aNeg ? a.slice(1) : a;
  const bAbs = bNeg ? b.slice(1) : b;
  if (aNeg === bNeg) return (aNeg ? '-' : '') + decAdd(aAbs, bAbs);
  const order = decCompare(aAbs, bAbs);
  if (order === 0) return '0';
  if (order > 0) return (aNeg ? '-' : '') + decNormalize(decSubtract(aAbs, bAbs));
  return (bNeg ? '-' : '') + decNormalize(decSubtract(bAbs, aAbs));
}

/** The reactive fill mirror re-export (the facade's convenience). */
export type { ReactiveFillMirror };
