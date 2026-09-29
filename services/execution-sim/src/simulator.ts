/**
 * @tradrl/execution_sim (service) — the reference simulator.
 *
 * THE FLOW (the Work Order's scope): "approved intents drive a
 * scripted venue (exchange-sim engine mirrors: matching with fees/
 * latency/slippage/impact configs), refused intents never reach the
 * venue (test: a refused intent produces ZERO venue records); fills +
 * decisions + audit trail as append-only logs; resumable run state
 * (serialize -> parse -> resume, chain-verified)".
 *
 * Per intent:
 *   1. THE GATE — `runExecutionGate` (the contract's pure CheckMachine)
 *      decides approve/refuse; the decision is appended to the
 *      decision log and audited (the policy's every_decision
 *      discipline).
 *   2. REFUSED -> NOTHING REACHES THE VENUE: the simulator records the
 *      refusal and moves on — the venue engine's state, order log and
 *      fill log are untouched (structurally asserted by the tests:
 *      zero venue records per refused intent).
 *   3. APPROVED -> THE VENUE: the intent's order is submitted to the
 *      scripted venue (the exchange-sim engine mirror); every fill is
 *      wrapped into a SimulatedFill carrying its full venue lineage
 *      (the engine record refs + the config digest + the four physics
 *      refs); the venue's rate counter increments (the rate-limits
 *      check's threading forward); the account's position/cash
 *      bookkeeping updates over exact decimals.
 *
 * DETERMINISM (L9): same (intent batch, policy, venue state, seed) ->
 * byte-identical decision sequence + fill sequence (deep-equal, twice
 * — the golden fixture proves it). The session clock advances
 * deterministically per intent (intent.asOf, monotonic).
 *
 * THE RUN STATE is JSON-serializable and resumable:
 * {@link serializeExecutionRunState} emits canonical bytes;
 * {@link resumeExecutionRunState} parses, re-validates every
 * constituent through the contract's guards, re-verifies the
 * kill-switch chain, the audit chain and the venue records, and
 * refuses a tampered or truncated payload with typed errors — the
 * resume gate's whole point (the chain heads the session consumed are
 * the truncation anchor).
 *
 * Spec anchors: spec/ARCHITECTURE.md (Execution — the hard controls),
 * spec/ARCHITECTURE-LOCK.md L5, L6, L8, L9, L12, L20.
 */

import {
  appendDecision,
  canonicalJson,
  deepFreeze,
  fail,
  isAuditLog,
  isJsonValue,
  isKillSwitchLog,
  isSimulatedFill,
  isStrategyIntentMirror,
  isVenueModelConfigMirror,
  mintSimulatedFillId,
  ok,
  runExecutionGate,
  startAuditLog,
  validateAuditLog,
  validateKillSwitchLog,
  verifyAuditChain,
  type ApproveDecision,
  type AuditLog,
  type ExecutionDecision,
  type ExecutionPolicy,
  type ExecutionPolicyResult,
  type ExecutionSimulationSpec,
  type ExecutionVenueState,
  type KillSwitchLog,
  type PortfolioStateMirror,
  type PositionRecordMirror,
  type SimulatedFill,
  type StrategyIntentMirror,
  type TimestampMs,
} from '../../../packages/execution-policy/src/index';
import { createVenueEngine, submitToVenue, type VenueEngineState, type VenueOrderRecord } from './venue-engine';

// ---------------------------------------------------------------------------
// The session state
// ---------------------------------------------------------------------------

/** The resumable simulator session: everything a later process needs to continue deterministically. */
export interface ExecutionSimSession {
  /** The simulation spec (fidelity + venue models + seed). */
  readonly spec: ExecutionSimulationSpec;
  /** The validated execution policy. */
  readonly policy: ExecutionPolicy;
  /** The standing kill-switch log (append-only). */
  readonly killSwitch: KillSwitchLog;
  /** The account's portfolio snapshot (positions + cash, threaded forward by fills). */
  readonly portfolio: PortfolioStateMirror;
  /** The gate's view of the venue (marks + rate counters, threaded forward by approvals). */
  readonly venueState: ExecutionVenueState;
  /** The scripted venue engines, one per (venue, instrument) model (keyed by `venue|instrument`). */
  readonly venues: readonly { readonly key: string; readonly engine: VenueEngineState }[];
  /** Every gate decision, in intent order (approves and refusals). */
  readonly decisions: readonly ExecutionDecision[];
  /** Every simulated fill, in emission order. */
  readonly fills: readonly SimulatedFill[];
  /** The append-only, chain-verified audit trail (one record per decision). */
  readonly auditLog: AuditLog;
  /** The intents already processed (idempotency: an intent is decided once). */
  readonly processedIntentIds: readonly string[];
  /** The OUTCOME CHAIN head: folds every decision + its fills (the tamper anchor the resume gate re-derives). */
  readonly outcomeChainHead: string;
  /** The session clock (the last decision instant — monotonic with the intents'). */
  readonly now: TimestampMs;
}

/** Guard: `ExecutionSimSession` (structural; every constituent through its contract guard). */
export function isExecutionSimSession(value: unknown): value is ExecutionSimSession {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  if (typeof session.spec !== 'object' || session.spec === null) return false;
  if (typeof session.policy !== 'object' || session.policy === null) return false;
  if (!isKillSwitchLog(session.killSwitch)) return false;
  if (typeof session.portfolio !== 'object' || session.portfolio === null) return false;
  if (typeof session.venueState !== 'object' || session.venueState === null) return false;
  if (!Array.isArray(session.venues)) return false;
  for (const entry of session.venues) {
    if (typeof entry !== 'object' || entry === null) return false;
    const venue = entry as Record<string, unknown>;
    if (typeof venue.key !== 'string' || venue.key === '') return false;
    if (typeof venue.engine !== 'object' || venue.engine === null) return false;
  }
  if (!Array.isArray(session.decisions)) return false;
  if (!Array.isArray(session.fills) || !session.fills.every((fill) => isSimulatedFill(fill))) return false;
  if (!isAuditLog(session.auditLog)) return false;
  if (!Array.isArray(session.processedIntentIds)) return false;
  if (typeof session.now !== 'number' || !Number.isSafeInteger(session.now) || (session.now as number) < 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** The engine key of a (venue, instrument) pair. */
function venueKey(venue: string, instrument: string): string {
  return `${venue}|${instrument}`;
}

/**
 * Create a simulator session: validate the spec's venue models into
 * scripted engines over the declared seed books, start the audit
 * trail, and freeze the initial state. The book seeds are keyed by
 * `venue|instrument`; a model without a seed starts with an empty
 * book (a paper-thin but honest venue — nothing fills).
 */
export function createExecutionSimSession(
  spec: ExecutionSimulationSpec,
  policy: ExecutionPolicy,
  killSwitch: KillSwitchLog,
  portfolio: PortfolioStateMirror,
  venueState: ExecutionVenueState,
  bookSeeds: readonly { readonly key: string; readonly bids: readonly { readonly price: string; readonly size: string }[]; readonly asks: readonly { readonly price: string; readonly size: string }[] }[] = [],
): ExecutionPolicyResult<ExecutionSimSession> {
  const venues: { key: string; engine: VenueEngineState }[] = [];
  for (const model of spec.venueModels) {
    if (!isVenueModelConfigMirror(model.config)) {
      return fail('invalid_type', `the venue model ${model.engineRef} fails the config mirror guard`);
    }
    const key = venueKey(model.config.venue, model.config.instrument);
    const seed = bookSeeds.find((candidate) => candidate.key === key);
    const engineResult = createVenueEngine(model, {
      bids: seed === undefined ? [] : seed.bids,
      asks: seed === undefined ? [] : seed.asks,
    });
    if (!engineResult.ok) return engineResult;
    venues.push({ key, engine: engineResult.value });
  }
  const auditResult = startAuditLog(policy.tenant, policy.project);
  if (!auditResult.ok) return auditResult;
  return ok(
    deepFreeze({
      spec,
      policy,
      killSwitch,
      portfolio,
      venueState,
      venues,
      decisions: [],
      fills: [],
      auditLog: auditResult.value,
      processedIntentIds: [],
      outcomeChainHead: outcomeChainSeed(spec, policy),
      now: venueState.asOf,
    }),
  );
}

// ---------------------------------------------------------------------------
// The outcome chain (the session-level tamper anchor)
// ---------------------------------------------------------------------------

/** The outcome chain's seed: derived from the session's identity skeleton (recoverable from the session). */
function outcomeChainSeed(spec: ExecutionSimulationSpec, policy: ExecutionPolicy): string {
  return digestOf(canonicalJson({ specId: spec.specId, policyId: policy.policyId, tenant: policy.tenant, project: policy.project, decisions: 0 }));
}

/** The canonical tree of one decision's outcome (the decision + its fills — the chain's fold unit). */
function outcomeTree(decision: ExecutionDecision, fills: readonly SimulatedFill[]): string {
  return canonicalJson({
    decisionId: decision.decisionId,
    kind: decision.kind,
    intentRef: decision.intentRef,
    fills: fills.map((fill) => ({ fillId: fill.fillId, price: fill.price, quantity: fill.quantity, fee: fill.fee })),
  });
}

/** Fold one decision's outcome onto the chain head. */
function foldOutcome(previousHead: string, decision: ExecutionDecision, fills: readonly SimulatedFill[]): string {
  return digestOf(`${previousHead}${outcomeTree(decision, fills)}`);
}

/**
 * Re-derive the session's outcome chain from its decisions + fills
 * (fills grouped by their decisionId, in decision order). `true` iff
 * the recorded head folds identically — a tampered fill, decision or
 * a truncated history fails (the resume gate's tamper anchor).
 */
export function verifySessionOutcomeChain(session: ExecutionSimSession): boolean {
  let head = outcomeChainSeed(session.spec, session.policy);
  for (const decision of session.decisions) {
    const ownFills = session.fills.filter((fill) => fill.decisionId === decision.decisionId);
    head = foldOutcome(head, decision, ownFills);
  }
  return head === session.outcomeChainHead;
}

/**
 * The session's COHERENCE laws (the one-decision-one-record and
 * one-decision-one-fill-set disciplines, re-derived at resume):
 *   1. the audit trail carries EXACTLY ONE record per decision, in
 *      decision order (a truncated or padded trail fails);
 *   2. every fill belongs to a recorded decision (orphan fills fail);
 *   3. the audit trail's scope is the policy's (L12).
 * `true` iff the session is coherent.
 */
export function verifySessionCoherence(session: ExecutionSimSession): boolean {
  if (session.auditLog.records.length !== session.decisions.length) return false;
  for (let index = 0; index < session.decisions.length; index++) {
    const record = session.auditLog.records[index];
    const decision = session.decisions[index];
    if (record === undefined || decision === undefined) return false;
    if (record.decisionId !== decision.decisionId) return false;
  }
  const decisionIds = new Set<string>(session.decisions.map((decision) => decision.decisionId as string));
  for (const fill of session.fills) {
    if (!decisionIds.has(fill.decisionId)) return false;
  }
  return session.auditLog.tenant === session.policy.tenant && session.auditLog.project === session.policy.project;
}

// ---------------------------------------------------------------------------
// The intent transition
// ---------------------------------------------------------------------------

/** The product of one processed intent. */
export interface IntentOutcome {
  readonly session: ExecutionSimSession;
  /** The gate's decision (approve or refuse). */
  readonly decision: ExecutionDecision;
  /** The simulated fills (empty iff refused — refused intents never reach the venue). */
  readonly fills: readonly SimulatedFill[];
  /** The venue's order record (null iff refused — ZERO venue records). */
  readonly venueOrder: VenueOrderRecord | null;
}

/**
 * Process ONE strategy intent: run the gate, audit the decision, and
 * — only on approval — drive the scripted venue and record the
 * simulated fills. Deterministic: the same (session, intent) always
 * produces the same outcome (L9). A duplicate intent id is the typed
 * `invalid_state` (one intent, one decision). The intent's asOf must
 * not precede the session clock (monotonic time).
 */
export function processIntent(session: ExecutionSimSession, intent: unknown): ExecutionPolicyResult<IntentOutcome> {
  if (!isExecutionSimSession(session)) {
    return fail('invalid_type', 'processIntent requires a valid simulator session');
  }
  if (!isStrategyIntentMirror(intent)) {
    return fail('invalid_type', 'processIntent requires a structurally valid strategy intent (the T018 mirror guard)');
  }
  if (session.processedIntentIds.includes(intent.intentId)) {
    return fail('invalid_state', `intent ${intent.intentId} is already decided — one intent, one decision (idempotency)`);
  }
  if (intent.asOf < session.now) {
    return fail('invalid_state', `intent ${intent.intentId} claims asOf ${intent.asOf} before the session clock ${session.now} — session time is monotonic`);
  }

  // 1. THE GATE (the contract's pure check machine).
  const gateResult = runExecutionGate({
    intent,
    policy: session.policy,
    portfolio: session.portfolio,
    venueState: session.venueState,
    killSwitch: session.killSwitch,
  });
  if (!gateResult.ok) return gateResult;
  const decision = gateResult.value;

  // 2. AUDIT (every decision emits exactly one record).
  const audited = appendDecision(session.auditLog, decision);
  if (!audited.ok) return audited;

  // 3. REFUSED -> NOTHING REACHES THE VENUE.
  if (decision.kind === 'refuse') {
    const nextSession: ExecutionSimSession = deepFreeze({
      ...session,
      decisions: [...session.decisions, decision],
      auditLog: audited.value,
      processedIntentIds: [...session.processedIntentIds, intent.intentId],
      outcomeChainHead: foldOutcome(session.outcomeChainHead, decision, []),
      now: intent.asOf,
    });
    return ok(deepFreeze({ session: nextSession, decision, fills: [], venueOrder: null }));
  }

  // 4. APPROVED -> THE VENUE (the scripted engine mirror).
  const approve = decision as ApproveDecision;
  const key = venueKey(intent.order.venueId, intent.order.instrumentId);
  const venueEntry = session.venues.find((entry) => entry.key === key);
  if (venueEntry === undefined) {
    return fail('venue_state_gap', `the simulation spec drives no venue model for (${intent.order.venueId}, ${intent.order.instrumentId})`);
  }
  const submission = submitToVenue(
    venueEntry.engine,
    {
      clientOrderId: intent.order.clientOrderId,
      side: intent.order.side,
      kind: intent.order.kind,
      quantity: intent.order.quantity,
      ...(intent.order.price !== undefined ? { price: intent.order.price } : {}),
    },
    intent.asOf,
  );
  if (!submission.ok) return submission;

  // 5. WRAP THE FILLS (venue lineage + the session's fill ordinal).
  const fills: SimulatedFill[] = [];
  let portfolio = session.portfolio;
  for (const venueFill of submission.value.fills) {
    const fillSequence = session.fills.length + fills.length + 1;
    const fill: SimulatedFill = deepFreeze({
      fillId: mintSimulatedFillId(fillSequence),
      sequence: fillSequence,
      venue: intent.order.venueId,
      instrument: intent.order.instrumentId,
      side: intent.order.side,
      price: venueFill.price,
      aggressorPrice: venueFill.aggressorPrice,
      quantity: venueFill.quantity,
      fee: venueFill.fee,
      latencyMs: venueFill.latencyMs,
      decisionId: approve.decisionId,
      intentRef: intent.intentId,
      fidelity: session.spec.fidelity,
      venueLineage: deepFreeze({
        configDigest: venueEntry.engine.model.configDigest,
        engineOrderRef: submission.value.order.engineOrderRef,
        engineFillRef: venueFill.engineFillRef,
        feesRef: `fees:${venueEntry.engine.model.engineRef}`,
        latencyRef: `latency:${venueEntry.engine.model.engineRef}`,
        slippageRef: `slippage:${venueEntry.engine.model.engineRef}`,
        impactRef: `impact:${venueEntry.engine.model.engineRef}`,
      }),
      lineage: approve.lineage,
      tenant: approve.lineage.tenant as never,
      project: approve.lineage.project as never,
      asOf: intent.asOf,
    });
    fills.push(fill);
    // The account bookkeeping (exact decimals; the taker's price is
    // the account's execution price — the trading-strategy account
    // fill discipline).
    portfolio = applyFillToPortfolio(portfolio, fill);
  }

  // 6. THREAD THE VENUE STATE FORWARD (the rate counter + the mark).
  const venueState = threadVenueState(session.venueState, intent, submission.value.fills.map((fill) => fill.price));

  const nextSession: ExecutionSimSession = deepFreeze({
    ...session,
    venues: session.venues.map((entry) => (entry.key === key ? { key: entry.key, engine: submission.value.state } : entry)),
    portfolio,
    venueState,
    decisions: [...session.decisions, decision],
    fills: [...session.fills, ...fills],
    auditLog: audited.value,
    processedIntentIds: [...session.processedIntentIds, intent.intentId],
    outcomeChainHead: foldOutcome(session.outcomeChainHead, decision, fills),
    now: intent.asOf,
  });
  return ok(deepFreeze({ session: nextSession, decision, fills, venueOrder: submission.value.order }));
}

/**
 * Process a batch of intents in order (the scenario driver). Fails on
 * the first failing transition (typed); the batch is processed
 * left-to-right deterministically.
 */
export function processIntentBatch(session: ExecutionSimSession, intents: readonly unknown[]): ExecutionPolicyResult<ExecutionSimSession> {
  let current = session;
  for (const intent of intents) {
    const outcome = processIntent(current, intent);
    if (!outcome.ok) return outcome;
    current = outcome.value.session;
  }
  return ok(current);
}

// ---------------------------------------------------------------------------
// The account bookkeeping (exact decimals over the portfolio mirror)
// ---------------------------------------------------------------------------

/**
 * Apply one simulated fill to the portfolio (positions + cash). Exact
 * decimals; the ONE divided site (a sell's proportional cost-basis
 * release) rounds HALF-UP at 8 fractional digits — the declared
 * precision (the trading-strategy portfolio discipline, mirrored).
 * The account's execution price is the AGGRESSOR price (the taker's
 * price — this simulator is taker-side only).
 */
function applyFillToPortfolio(portfolio: PortfolioStateMirror, fill: SimulatedFill): PortfolioStateMirror {
  const notional = multiplyExact(fill.aggressorPrice, fill.quantity);
  const positions: PositionRecordMirror[] = [];
  let touched = false;
  for (const position of portfolio.positions) {
    if (position.instrumentId !== fill.instrument || position.venueId !== fill.venue) {
      positions.push(position);
      continue;
    }
    touched = true;
    if (fill.side === 'buy') {
      positions.push({ ...position, quantity: addExact(position.quantity, fill.quantity), costBasis: addExact(position.costBasis, notional) });
      continue;
    }
    // A sell releases quantity and its proportional share of the basis:
    // newBasis = basis x (held - sold) / held, half-up at 8 decimals.
    const held = position.quantity;
    const remaining = compareExact(held, fill.quantity) >= 0 ? subtractExact(held, fill.quantity) : '0';
    const basisAfter =
      held === '0' ? '0' : divideRoundHalfUpExact(multiplyExact(position.costBasis, remaining), held, 8);
    positions.push({ ...position, quantity: remaining, costBasis: basisAfter });
  }
  if (!touched && fill.side === 'buy') {
    positions.push({ instrumentId: fill.instrument, venueId: fill.venue, quantity: fill.quantity, costBasis: notional, openedAt: fill.asOf });
  }
  // Cash: a buy debits notional + fee; a sell credits notional - fee
  // (a fee exceeding the proceeds debits the difference — total, exact).
  const cash =
    fill.side === 'buy'
      ? subtractCash(portfolio.cash, addExact(notional, fill.fee))
      : compareExact(notional, fill.fee) >= 0
        ? addExact(portfolio.cash, subtractExact(notional, fill.fee))
        : subtractCash(portfolio.cash, subtractExact(fill.fee, notional));
  return deepFreeze({ ...portfolio, positions, cash, asOf: fill.asOf });
}

/** Debit `amount` from cash (exact; the unsigned domain is preserved by construction). */
function subtractCash(cash: string, amount: string): string {
  return compareExact(cash, amount) >= 0 ? subtractExact(cash, amount) : subtractExact(amount, cash);
}

// (The exact-decimal helpers below re-export the contract arithmetic
// under local names so the bookkeeping reads like accounting.)
import { add as addExact, compare as compareExact, divideRoundHalfUp as divideRoundHalfUpExact, multiply as multiplyExact, subtract as subtractExact } from '../../../packages/execution-policy/src/index';

/** Thread the venue state forward: increment the venue's rate counter and update the mark. */
function threadVenueState(state: ExecutionVenueState, intent: StrategyIntentMirror, fillPrices: readonly string[]): ExecutionVenueState {
  const instruments = state.instruments.map((entry) => {
    if (entry.venue !== intent.order.venueId) return entry;
    const rateWindowOrderCount = entry.rateWindowOrderCount + 1;
    if (entry.instrument !== intent.order.instrumentId) return { ...entry, rateWindowOrderCount };
    const lastPrice = fillPrices.length > 0 ? fillPrices[fillPrices.length - 1] : undefined;
    return lastPrice === undefined ? { ...entry, rateWindowOrderCount } : { ...entry, rateWindowOrderCount, referencePrice: lastPrice };
  });
  return deepFreeze({ ...state, asOf: intent.asOf, instruments });
}

// ---------------------------------------------------------------------------
// The resumable run state (serialize -> parse -> resume)
// ---------------------------------------------------------------------------

/** The run-state serialization schema marker (versioned with the contract package). */
export const EXECUTION_RUN_STATE_SCHEMA = 'tradrl/execution-run-state@1';

/**
 * Serialize a session to canonical JSON bytes (the resume artifact —
 * portable across processes). Deterministic: equal sessions produce
 * identical bytes.
 */
export function serializeExecutionRunState(session: ExecutionSimSession): ExecutionPolicyResult<string> {
  if (!isExecutionSimSession(session)) {
    return fail('invalid_type', 'serializeExecutionRunState requires a valid simulator session');
  }
  const roundTrip: unknown = JSON.parse(JSON.stringify(session));
  if (!isJsonValue(roundTrip)) {
    return fail('invalid_state', 'the session did not survive the JSON round-trip (impossible by construction)');
  }
  return ok(canonicalJson({ schema: EXECUTION_RUN_STATE_SCHEMA, session: roundTrip }));
}

/**
 * Resume a session from serialized bytes: parse, enforce the schema
 * marker, re-validate every constituent through the contract's guards,
 * re-verify the kill-switch chain and the audit chain, and refuse a
 * tampered payload with typed errors (`invalid_json` /
 * `invalid_state` / `killswitch_rewrite` / `audit_rewrite`). A resumed
 * session provably consumed the same history and continues appending
 * onto the verified logs.
 */
export function resumeExecutionRunState(bytes: string): ExecutionPolicyResult<ExecutionSimSession> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse failure';
    return fail('invalid_json', `the run state bytes are not valid JSON: ${message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('invalid_state', 'the run state envelope must be an object');
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.schema !== EXECUTION_RUN_STATE_SCHEMA) {
    return fail('invalid_state', `expected schema "${EXECUTION_RUN_STATE_SCHEMA}", got ${JSON.stringify(envelope.schema)}`);
  }
  if (!isExecutionSimSession(envelope.session)) {
    return fail('invalid_state', 'the parsed value fails the session guard (spec, policy, switch, portfolio, venue state, venues, decisions, fills, audit log)');
  }
  const session = envelope.session;
  const switchVerified = validateKillSwitchLog(session.killSwitch);
  if (!switchVerified.ok) return switchVerified;
  const auditVerified = validateAuditLog(session.auditLog);
  if (!auditVerified.ok) return auditVerified;
  if (!verifyAuditChain(session.auditLog).ok) {
    return fail('audit_rewrite', 'the audit trail fails chain verification — the run state was tampered');
  }
  if (!verifySessionCoherence(session)) {
    return fail('audit_rewrite', 'the session is incoherent: the audit trail, the decisions and the fills disagree (one decision, one audit record, no orphan fills) — the run state was tampered');
  }
  if (!verifySessionOutcomeChain(session)) {
    return fail('invalid_state', 'the session outcome chain does not fold onto the recorded head — a decision or fill was edited, removed or reordered (the run state was tampered)');
  }
  return ok(deepFreeze(session));
}

/** The digest of a session's decisions + fills (the golden fixture's basis). */
export function sessionOutcomeDigest(session: ExecutionSimSession): string {
  const tree = {
    decisions: session.decisions.map((decision) => ({ decisionId: decision.decisionId, kind: decision.kind })),
    fills: session.fills.map((fill) => ({ fillId: fill.fillId, price: fill.price, quantity: fill.quantity, fee: fill.fee })),
    auditHead: session.auditLog.records.length === 0 ? null : session.auditLog.records[session.auditLog.records.length - 1]?.chainHead ?? null,
  };
  return digestOf(canonicalJson(tree));
}

/** FNV-1a 32-bit of a string, as zero-padded lowercase hex (the program-wide derivation). */
function digestOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
