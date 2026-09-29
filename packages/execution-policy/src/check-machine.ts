// @tradrl/execution-policy — the CheckMachine: the PURE hard gate.
//
// THE SIGNATURE (the Work Order's scope):
//
//   (StrategyIntent mirror, ExecutionPolicy, portfolio-state mirror,
//    venue-state mirror, standing kill switch)
//        -> runExecutionGate -> ApproveDecision | RefusalDecision
//
// THE LAWS THIS MACHINE OWNS:
//
// FIRST-FAILURE-WINS (the Work Order: "Check ordering is DECLARED:
// pre-trade checks run in a declared order; the FIRST failure produces
// the refusal record (which check failed, which limit, by how much) —
// a refusal is a structured record, never an exception, and refusal
// reasons are enumerated data, not free text"): the machine walks the
// policy's declared `checkOrder` (validated: a full permutation, kill
// switch first); the first failing check produces the
// {@link RefusalDecision} carrying the executed check results (up to
// and including the failure) and the structured {@link RefusalReason}
// — which check, which limit, the cap, the observed value, the excess.
//
// KILL-SWITCH DOMINANCE (L8: "a standing switch record that refuses
// EVERYTHING when thrown"): the kill switch is ordered FIRST in every
// legal check order, so a thrown switch always produces the
// kill-switch refusal kind regardless of what any other check would
// have said.
//
// REFUSALS ARE RECORDS, NEVER EXCEPTIONS (mirroring the strategy
// lane's constraint-primacy law): a well-formed intent ALWAYS produces
// a decision. Operation failures (this machine's typed errors) exist
// only for malformed ENVELOPES: an intent that fails its mirror guard,
// a venue state that does not cover the intent's (venue, instrument)
// pair, a kill-switch log that fails chain verification or does not
// match the policy's declared switch — the gate refuses to REASON over
// facts it cannot trust, but it never converts a check failure into an
// exception.
//
// DETERMINISM (L9): same (intent, policy, portfolio state, venue
// state, kill switch) -> byte-identical decision (the decision id is
// content-addressed from the decision's canonical content). No ambient
// clock — the decision instant is the intent's `asOf`. No ambient
// randomness — there is no randomness here at all.
//
// L12: the policy's tenant/project scope binds the identity check; a
// cross-tenant intent is an identity refusal (never an error — it is
// evidence).
//
// DOWNSTREAM (the Work Order's non-scope): the T020 risk engine
// DEEPENS the limits dimension (this machine exposes the limit record
// shape); T040 binds real venues. This machine is the contract layer
// those lanes consume.

import { deepFreeze, isRecord, type JsonValue, type JsonObject, type TimestampMs } from './primitives';
import { canonicalJson, fnv1a32Hex } from './primitives';
import { add as decAdd, compare as decCompare, multiply as decMultiply, normalize as decNormalize, subtract as decSubtract } from './decimals';
import type { DecisionId, PolicyVersionRef, VenueId } from './ids';
import { mintDecisionId } from './ids';
import type { PortfolioStateMirror, PositionRecordMirror, StrategyIntentMirror } from './strategy-mirror';
import { isPortfolioStateMirror, isStrategyIntentMirror } from './strategy-mirror';
import type { ExecutionVenueState, VenueInstrumentState } from './venue-mirror';
import { isExecutionVenueState } from './venue-mirror';
import type { ExecutionPolicy, LimitKind, PreTradeCheckKind } from './policy';
import { isPreTradeCheckKind } from './policy';
import type { KillSwitchLog, KillSwitchRecord } from './kill-switch';
import { currentThrowEvidence, killSwitchState, verifyKillSwitchChain } from './kill-switch';
import {
  type ExecutionPolicyResult,
  fail,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The structured refusal reason (enumerated data, never free text)
// ---------------------------------------------------------------------------

/**
 * The refusal reason — a closed discriminated union, one variant per
 * pre-trade check dimension. Every variant names its dimension and the
 * structured details of the failure: which subject, which limit, the
 * cap, the observed value, the excess ("which check failed, which
 * limit, by how much").
 */
export type RefusalReason =
  /** The standing kill switch is thrown — EVERYTHING is refused. */
  | { readonly dimension: 'kill_switch'; readonly switchId: string; readonly thrownAt: TimestampMs; readonly reason: string }
  /** The intent's identity does not match the policy's scope/principal allowlist. */
  | { readonly dimension: 'identity'; readonly subject: 'tenant' | 'project' | 'principal'; readonly expected: string; readonly actual: string }
  /** The order kind is not permitted by any declared authority grant. */
  | { readonly dimension: 'authorization'; readonly orderKind: string; readonly permittedKinds: readonly string[] }
  /** A limit cap was breached — which limit, the cap, the observed value, the excess. */
  | {
      readonly dimension: 'limits';
      readonly limit: LimitKind;
      readonly instrumentClass: string;
      readonly cap: string;
      readonly observed: string;
      readonly excess: string;
    }
  /** The (venue, instrument) pair is not on the policy's allowlist. */
  | { readonly dimension: 'venue_permissions'; readonly venue: string; readonly instrument: string }
  /** The venue's rate budget would be exceeded (or no budget is declared — fail-closed). */
  | { readonly dimension: 'rate_limits'; readonly venue: string; readonly windowMs: number | null; readonly budget: number; readonly observed: number }
  /** The venue has no credential binding in the policy. */
  | { readonly dimension: 'credentials'; readonly venue: string };

/** Guard: `RefusalReason` (total over the closed union). */
export function isRefusalReason(v: unknown): v is RefusalReason {
  if (!isRecord(v)) return false;
  switch (v.dimension) {
    case 'kill_switch':
      return typeof v.switchId === 'string' && v.switchId !== '' && typeof v.thrownAt === 'number' && Number.isSafeInteger(v.thrownAt) && typeof v.reason === 'string' && v.reason !== '';
    case 'identity':
      return (v.subject === 'tenant' || v.subject === 'project' || v.subject === 'principal') && typeof v.expected === 'string' && typeof v.actual === 'string';
    case 'authorization':
      return typeof v.orderKind === 'string' && v.orderKind !== '' && Array.isArray(v.permittedKinds) && v.permittedKinds.every((x) => typeof x === 'string');
    case 'limits':
      return (
        (v.limit === 'order_size' || v.limit === 'order_notional' || v.limit === 'position_size' || v.limit === 'position_notional') &&
        typeof v.instrumentClass === 'string' && v.instrumentClass !== '' &&
        typeof v.cap === 'string' && v.cap !== '' &&
        typeof v.observed === 'string' && v.observed !== '' &&
        typeof v.excess === 'string' && v.excess !== ''
      );
    case 'venue_permissions':
      return typeof v.venue === 'string' && v.venue !== '' && typeof v.instrument === 'string' && v.instrument !== '';
    case 'rate_limits':
      return (
        typeof v.venue === 'string' && v.venue !== '' &&
        (v.windowMs === null || (typeof v.windowMs === 'number' && Number.isSafeInteger(v.windowMs) && v.windowMs >= 1)) &&
        typeof v.budget === 'number' && Number.isSafeInteger(v.budget) && v.budget >= 0 &&
        typeof v.observed === 'number' && Number.isSafeInteger(v.observed) && v.observed >= 0
      );
    case 'credentials':
      return typeof v.venue === 'string' && v.venue !== '';
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// The decisions
// ---------------------------------------------------------------------------

/** One executed pre-trade check: the dimension, its position in the declared order, the outcome. */
export interface CheckResult {
  readonly dimension: PreTradeCheckKind;
  /** 1-based position in the policy's declared check order. */
  readonly ordinal: number;
  readonly outcome: 'pass' | 'fail';
}

/** Guard: `CheckResult`. */
export function isCheckResult(v: unknown): v is CheckResult {
  if (!isRecord(v)) return false;
  if (!isPreTradeCheckKind(v.dimension)) return false;
  if (typeof v.ordinal !== 'number' || !Number.isSafeInteger(v.ordinal) || v.ordinal < 1) return false;
  if (v.outcome !== 'pass' && v.outcome !== 'fail') return false;
  return true;
}

/** The first failure: which check, at which position, with the structured reason. */
export interface CheckFailure {
  readonly dimension: PreTradeCheckKind;
  readonly ordinal: number;
  readonly reason: RefusalReason;
}

/** Guard: `CheckFailure` (the dimension/ordinal laws of a check result plus the reason). */
export function isCheckFailure(v: unknown): v is CheckFailure {
  if (!isRecord(v)) return false;
  if (!isPreTradeCheckKind(v.dimension)) return false;
  if (typeof v.ordinal !== 'number' || !Number.isSafeInteger(v.ordinal) || v.ordinal < 1) return false;
  return isRefusalReason(v.reason);
}

/**
 * The APPROVE decision: every pre-trade check passed, in the declared
 * order. The decision id is content-addressed from the canonical
 * decision content (L9): the same gate inputs always produce the same
 * decision id.
 */
export interface ApproveDecision {
  readonly kind: 'approve';
  readonly decisionId: DecisionId;
  /** The gated intent's identity (`si:`-prefixed). */
  readonly intentRef: string;
  readonly policy: PolicyVersionRef;
  /** The declared order the checks ran in (the decision's own record of it). */
  readonly checkOrder: readonly PreTradeCheckKind[];
  /** Every executed check, in the declared order (all passed). */
  readonly checks: readonly CheckResult[];
  /** The full L9 lineage block (see ExecutionLineage). */
  readonly lineage: ExecutionLineage;
  /** The decision instant (the intent's asOf — no ambient clock). */
  readonly asOf: TimestampMs;
}

/**
 * The REFUSE decision: a structured record, never an exception. The
 * checks executed up to and including the first failure are carried;
 * `failure` names the failing check and its structured reason.
 */
export interface RefusalDecision {
  readonly kind: 'refuse';
  readonly decisionId: DecisionId;
  readonly intentRef: string;
  readonly policy: PolicyVersionRef;
  readonly checkOrder: readonly PreTradeCheckKind[];
  /** The executed checks, in the declared order, ending at the failure. */
  readonly checks: readonly CheckResult[];
  readonly failure: CheckFailure;
  readonly lineage: ExecutionLineage;
  readonly asOf: TimestampMs;
}

/** A gate decision: approve or refuse (the discriminated union). */
export type ExecutionDecision = ApproveDecision | RefusalDecision;

/** Guard: `ApproveDecision`. */
export function isApproveDecision(v: unknown): v is ApproveDecision {
  if (!isRecord(v) || v.kind !== 'approve') return false;
  if (typeof v.decisionId !== 'string' || !v.decisionId.startsWith('xd:')) return false;
  if (typeof v.intentRef !== 'string' || v.intentRef === '') return false;
  if (!isRecord(v.policy) || typeof (v.policy as Record<string, unknown>).policyId !== 'string') return false;
  if (!Array.isArray(v.checkOrder) || !v.checkOrder.every((x) => isPreTradeCheckKind(x))) return false;
  if (!Array.isArray(v.checks) || !v.checks.every((x) => isCheckResult(x) && x.outcome === 'pass')) return false;
  if (!isExecutionLineage(v.lineage)) return false;
  if (typeof v.asOf !== 'number' || !Number.isSafeInteger(v.asOf) || v.asOf < 0) return false;
  return true;
}

/** Guard: `RefusalDecision`. */
export function isRefusalDecision(v: unknown): v is RefusalDecision {
  if (!isRecord(v) || v.kind !== 'refuse') return false;
  if (typeof v.decisionId !== 'string' || !v.decisionId.startsWith('xd:')) return false;
  if (typeof v.intentRef !== 'string' || v.intentRef === '') return false;
  if (!isRecord(v.policy) || typeof (v.policy as Record<string, unknown>).policyId !== 'string') return false;
  if (!Array.isArray(v.checkOrder) || !v.checkOrder.every((x) => isPreTradeCheckKind(x))) return false;
  if (!Array.isArray(v.checks) || v.checks.length === 0 || !v.checks.every((x) => isCheckResult(x))) return false;
  if (!isCheckFailure(v.failure)) return false;
  if (!isExecutionLineage(v.lineage)) return false;
  if (typeof v.asOf !== 'number' || !Number.isSafeInteger(v.asOf) || v.asOf < 0) return false;
  return true;
}

/** Guard: `ExecutionDecision`. */
export function isExecutionDecision(v: unknown): v is ExecutionDecision {
  return isApproveDecision(v) || isRefusalDecision(v);
}

// ---------------------------------------------------------------------------
// The L9 lineage block (every decision, fill and audit record carries it)
// ---------------------------------------------------------------------------

/**
 * The execution lane's full lineage block (L9: the Work Order's exact
 * list — "intent ref -> strategy version -> goal ref, policy version,
 * venue refs, seed, tenant, project"): the gated intent, the strategy
 * version that computed it, the goal that strategy serves, the policy
 * version that gated it, the venue refs involved, the seed, and the
 * tenant/project scope (L12).
 */
export interface ExecutionLineage {
  /** The gated strategy intent's identity. */
  readonly intentRef: string;
  /** The strategy version that computed the intent (T018 mirror). */
  readonly strategy: { readonly specId: string; readonly version: number };
  /** The goal the strategy serves (control-plane mirror). */
  readonly goal: { readonly goalId: string; readonly version: number };
  /** The execution policy version that gated the decision. */
  readonly policy: PolicyVersionRef;
  /** The venues the decision involves (the intent's venue). */
  readonly venues: readonly VenueId[];
  /** The deterministic seed (the intent's seed — the determinism contract's anchor). */
  readonly seed: string;
  readonly tenant: string;
  readonly project: string;
}

/** Guard: `ExecutionLineage`. */
export function isExecutionLineage(v: unknown): v is ExecutionLineage {
  if (!isRecord(v)) return false;
  if (typeof v.intentRef !== 'string' || v.intentRef === '') return false;
  const strategy = v.strategy;
  if (!isRecord(strategy) || typeof strategy.specId !== 'string' || strategy.specId === '' || typeof strategy.version !== 'number' || !Number.isSafeInteger(strategy.version) || strategy.version < 1) return false;
  const goal = v.goal;
  if (!isRecord(goal) || typeof goal.goalId !== 'string' || goal.goalId === '' || typeof goal.version !== 'number' || !Number.isSafeInteger(goal.version) || goal.version < 1) return false;
  const policy = v.policy;
  if (!isRecord(policy) || typeof policy.policyId !== 'string' || policy.policyId === '' || typeof policy.version !== 'number' || !Number.isSafeInteger(policy.version) || policy.version < 1) return false;
  if (!Array.isArray(v.venues) || v.venues.length === 0 || !v.venues.every((x) => typeof x === 'string' && x !== '')) return false;
  if (typeof v.seed !== 'string' || v.seed === '') return false;
  if (typeof v.tenant !== 'string' || v.tenant === '') return false;
  if (typeof v.project !== 'string' || v.project === '') return false;
  return true;
}

// ---------------------------------------------------------------------------
// The gate's input
// ---------------------------------------------------------------------------

/** The pure gate's input bundle (everything the checks reason over). */
export interface ExecutionGateInput {
  /** The untrusted strategy intent (validated through the mirror guard first). */
  readonly intent: unknown;
  /** The VALIDATED execution policy (see policy.ts `validateExecutionPolicy`). */
  readonly policy: ExecutionPolicy;
  /** The portfolio-state mirror (position/cash facts for the limits check). */
  readonly portfolio: PortfolioStateMirror;
  /** The venue state (class/reference-price/rate facts for the checks). */
  readonly venueState: ExecutionVenueState;
  /** The standing kill-switch log (chain-verified; must match the policy's binding). */
  readonly killSwitch: KillSwitchLog;
}

/** Guard: `ExecutionGateInput`. */
export function isExecutionGateInput(v: unknown): v is ExecutionGateInput {
  if (!isRecord(v)) return false;
  return (
    isRecord(v.policy) &&
    isRecord(v.portfolio) &&
    isExecutionVenueState(v.venueState) &&
    isRecord(v.killSwitch)
  );
}

// ---------------------------------------------------------------------------
// Decision minting (content-addressed identity, L9)
// ---------------------------------------------------------------------------

/** The lineage's canonical JSON tree (explicit — JSON shape proven by construction, never cast). */
function lineageTree(lineage: ExecutionLineage): JsonValue {
  return {
    intentRef: lineage.intentRef,
    strategy: { specId: lineage.strategy.specId, version: lineage.strategy.version },
    goal: { goalId: lineage.goal.goalId, version: lineage.goal.version },
    policy: { policyId: lineage.policy.policyId, version: lineage.policy.version },
    venues: [...lineage.venues],
    seed: lineage.seed,
    tenant: lineage.tenant,
    project: lineage.project,
  };
}

/** The refusal reason's canonical JSON tree (explicit — never the typed record). */
function refusalTree(reason: RefusalReason): JsonValue {
  return { ...reason } as JsonObject;
}

/** The canonical content tree of a decision (everything except the derived id). */
function decisionContentTree(
  kind: 'approve' | 'refuse',
  intentRef: string,
  policy: PolicyVersionRef,
  checkOrder: readonly PreTradeCheckKind[],
  checks: readonly CheckResult[],
  failure: CheckFailure | null,
  lineage: ExecutionLineage,
  asOf: TimestampMs,
): string {
  return canonicalJson({
    kind,
    intentRef,
    policy: { policyId: policy.policyId, version: policy.version },
    checkOrder: [...checkOrder],
    checks: checks.map((check) => ({ dimension: check.dimension, ordinal: check.ordinal, outcome: check.outcome })),
    failure: failure === null ? null : { dimension: failure.dimension, ordinal: failure.ordinal, reason: refusalTree(failure.reason) },
    lineage: lineageTree(lineage),
    asOf,
  });
}

// ---------------------------------------------------------------------------
// The individual checks (pure, total over validated inputs)
// ---------------------------------------------------------------------------

/** The kill-switch check: thrown -> refuse EVERYTHING; standing -> pass. */
function checkKillSwitch(policy: ExecutionPolicy, killSwitch: KillSwitchLog): RefusalReason | null {
  if (killSwitchState(killSwitch) !== 'thrown') return null;
  const evidence: KillSwitchRecord | null = currentThrowEvidence(killSwitch);
  // Unreachable when the state is thrown (the guard enforces a thrown
  // record exists); kept total.
  if (evidence === null) return null;
  if (evidence.thrownAt === null || evidence.reason === null) return null;
  return { dimension: 'kill_switch', switchId: policy.killSwitch.switchId, thrownAt: evidence.thrownAt, reason: evidence.reason };
}

/** The identity check: the intent's tenant/project/principal against the policy's scope and allowlist. */
function checkIdentity(intent: StrategyIntentMirror, policy: ExecutionPolicy): RefusalReason | null {
  if (intent.tenant !== policy.tenant) {
    return { dimension: 'identity', subject: 'tenant', expected: policy.tenant, actual: intent.tenant };
  }
  if (intent.project !== policy.project) {
    return { dimension: 'identity', subject: 'project', expected: policy.project, actual: intent.project };
  }
  if (!policy.identity.principals.includes(intent.strategy.specId)) {
    return { dimension: 'identity', subject: 'principal', expected: policy.identity.principals.join('|') || '(nobody declared)', actual: intent.strategy.specId };
  }
  return null;
}

/** The authorization check: the order kind against the declared grants (fail-closed when none permits). */
function checkAuthorization(intent: StrategyIntentMirror, policy: ExecutionPolicy): RefusalReason | null {
  const permitted: string[] = [];
  for (const grant of policy.authorization) {
    permitted.push(...grant.orderKinds);
  }
  if (permitted.includes(intent.order.kind)) return null;
  return { dimension: 'authorization', orderKind: intent.order.kind, permittedKinds: permitted };
}

/** The position the intent's instrument would hold post-trade (signed quantity over the unsigned core). */
function postTradePosition(position: PositionRecordMirror | undefined, side: 'buy' | 'sell', quantity: string): string {
  const held = position === undefined ? '0' : decNormalize(position.quantity);
  if (side === 'buy') return decAdd(held, quantity);
  // A sell reduces the held quantity; the unsigned domain cannot go
  // negative — a sell beyond the holding is an EXCESS-magnitude fact
  // the position-size cap catches (shorts need the T020/T040 lanes).
  return decCompare(held, quantity) >= 0 ? decSubtract(held, quantity) : decSubtract(quantity, held);
}

/** The limits check: order size, order notional, post-trade position size and notional against the class's caps. */
function checkLimits(
  intent: StrategyIntentMirror,
  policy: ExecutionPolicy,
  venueInstrument: VenueInstrumentState,
  heldPosition: PositionRecordMirror | undefined,
): RefusalReason | null {
  const quantity = decNormalize(intent.order.quantity);
  // The class's record: the exact class first, then the '*' catch-all.
  const record = policy.limits.find((limit) => limit.instrumentClass === venueInstrument.instrumentClass) ?? policy.limits.find((limit) => limit.instrumentClass === '*');
  if (record === undefined) {
    // Fail-closed: no cap declared for this class means the gate does
    // not know the cap — refuse rather than guess (the totality law's
    // empty-collection semantics).
    return {
      dimension: 'limits',
      limit: 'order_size',
      instrumentClass: venueInstrument.instrumentClass,
      cap: '0',
      observed: quantity,
      excess: quantity,
    };
  }
  // 1. Order size.
  if (decCompare(quantity, record.maxOrderSize) > 0) {
    return { dimension: 'limits', limit: 'order_size', instrumentClass: record.instrumentClass, cap: record.maxOrderSize, observed: quantity, excess: decSubtract(quantity, record.maxOrderSize) };
  }
  // 2. Order notional (quantity x reference price — exact product).
  const referencePrice = decNormalize(venueInstrument.referencePrice);
  const orderNotional = decMultiply(quantity, referencePrice);
  if (decCompare(orderNotional, record.maxOrderNotional) > 0) {
    return { dimension: 'limits', limit: 'order_notional', instrumentClass: record.instrumentClass, cap: record.maxOrderNotional, observed: orderNotional, excess: decSubtract(orderNotional, record.maxOrderNotional) };
  }
  // 3. Post-trade position size.
  const postQuantity = postTradePosition(heldPosition, intent.order.side, quantity);
  if (decCompare(postQuantity, record.maxPositionSize) > 0) {
    return { dimension: 'limits', limit: 'position_size', instrumentClass: record.instrumentClass, cap: record.maxPositionSize, observed: postQuantity, excess: decSubtract(postQuantity, record.maxPositionSize) };
  }
  // 4. Post-trade position notional.
  const postNotional = decMultiply(postQuantity, referencePrice);
  if (decCompare(postNotional, record.maxPositionNotional) > 0) {
    return { dimension: 'limits', limit: 'position_notional', instrumentClass: record.instrumentClass, cap: record.maxPositionNotional, observed: postNotional, excess: decSubtract(postNotional, record.maxPositionNotional) };
  }
  return null;
}

/** The venue-permissions check: the (venue, instrument) pair against the allowlist. */
function checkVenuePermissions(intent: StrategyIntentMirror, policy: ExecutionPolicy): RefusalReason | null {
  const allowed = policy.venuePermissions.some(
    (permission) => permission.venue === intent.order.venueId && permission.instrument === intent.order.instrumentId,
  );
  if (allowed) return null;
  return { dimension: 'venue_permissions', venue: intent.order.venueId, instrument: intent.order.instrumentId };
}

/** The rate-limits check: the venue's declared budget against the current window counter. */
function checkRateLimits(intent: StrategyIntentMirror, policy: ExecutionPolicy, venueInstrument: VenueInstrumentState): RefusalReason | null {
  const budget = policy.rateLimits.find((entry) => entry.venue === intent.order.venueId);
  if (budget === undefined) {
    // Fail-closed: no budget declared for this venue = no permission to
    // submit at any rate.
    return { dimension: 'rate_limits', venue: intent.order.venueId, windowMs: null, budget: 0, observed: venueInstrument.rateWindowOrderCount };
  }
  const projected = venueInstrument.rateWindowOrderCount + 1; // this submission
  if (projected <= budget.maxOrders) return null;
  return { dimension: 'rate_limits', venue: budget.venue, windowMs: budget.windowMs, budget: budget.maxOrders, observed: venueInstrument.rateWindowOrderCount };
}

/** The credentials check: the venue's opaque credential binding. */
function checkCredentials(intent: StrategyIntentMirror, policy: ExecutionPolicy): RefusalReason | null {
  const bound = policy.credentials.some((binding) => binding.venue === intent.order.venueId);
  if (bound) return null;
  return { dimension: 'credentials', venue: intent.order.venueId };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Run the hard gate over one strategy intent — the pure, deterministic
 * core of this lane. The checks run in the policy's DECLARED order
 * (validated: kill switch first); the FIRST failure produces the
 * refusal record. A well-formed intent ALWAYS produces a decision
 * (approve or refuse); operation failures are reserved for malformed
 * envelopes:
 *   - `invalid_type`/`invalid_field` — the intent fails the strategy
 *     mirror guard (collect-all);
 *   - `venue_state_gap` — the venue state does not cover the intent's
 *     (venue, instrument) pair;
 *   - `killswitch_rewrite` — the switch log fails chain verification;
 *   - `switch_binding_mismatch` — the log's switch id is not the
 *     policy's declared switch;
 *   - `invalid_type` — the portfolio state fails its mirror guard.
 */
export function runExecutionGate(input: ExecutionGateInput): ExecutionPolicyResult<ExecutionDecision> {
  const { policy } = input;

  // --- Envelope: the intent must be a well-formed strategy intent -----------
  if (!isStrategyIntentMirror(input.intent)) {
    return fail('invalid_type', 'runExecutionGate requires a structurally valid strategy intent (the T018 mirror guard) — the gate never reasons over a malformed request');
  }
  const intent = input.intent;

  // --- Envelope: the portfolio state must be a well-formed mirror ------------
  if (!isPortfolioStateMirror(input.portfolio)) {
    return fail('invalid_type', 'runExecutionGate requires a structurally valid portfolio-state mirror');
  }
  const portfolio = input.portfolio;

  // --- Envelope: the venue state must cover the intent's pair ------------------
  if (!isExecutionVenueState(input.venueState)) {
    return fail('invalid_type', 'runExecutionGate requires a structurally valid venue state');
  }
  const venueInstrument = input.venueState.instruments.find(
    (entry) => entry.venue === intent.order.venueId && entry.instrument === intent.order.instrumentId,
  );
  if (venueInstrument === undefined) {
    return fail(
      'venue_state_gap',
      `the venue state does not cover (${intent.order.venueId}, ${intent.order.instrumentId}) — the limits and rate checks refuse to reason over absent facts (never a best-effort reference price)`,
    );
  }

  // --- Envelope: the switch log must verify and match the policy ---------------
  const verifiedSwitch = verifyKillSwitchChain(input.killSwitch);
  if (!verifiedSwitch.ok) return verifiedSwitch;
  if (input.killSwitch.switchId !== policy.killSwitch.switchId) {
    return fail(
      'switch_binding_mismatch',
      `the provided switch log (${input.killSwitch.switchId}) is not the policy's declared switch (${policy.killSwitch.switchId}) — the policy enforces exactly one standing switch`,
    );
  }

  // --- The lineage block (L9) ------------------------------------------------------
  const lineage: ExecutionLineage = deepFreeze({
    intentRef: intent.intentId,
    strategy: { specId: intent.strategy.specId, version: intent.strategy.version },
    goal: { goalId: intent.goal.goalId, version: intent.goal.version },
    policy: { policyId: policy.policyId, version: policy.version },
    venues: [intent.order.venueId],
    seed: intent.seed,
    tenant: intent.tenant,
    project: intent.project,
  });

  // --- The checks, in the DECLARED order (first failure wins) ----------------------
  const heldPosition = portfolio.positions.find(
    (position) => position.instrumentId === intent.order.instrumentId && position.venueId === intent.order.venueId,
  );
  const checks: CheckResult[] = [];
  for (let index = 0; index < policy.checkOrder.length; index++) {
    const dimension = policy.checkOrder[index] as PreTradeCheckKind;
    const ordinal = index + 1;
    let reason: RefusalReason | null = null;
    switch (dimension) {
      case 'kill_switch':
        reason = checkKillSwitch(policy, input.killSwitch);
        break;
      case 'identity':
        reason = checkIdentity(intent, policy);
        break;
      case 'authorization':
        reason = checkAuthorization(intent, policy);
        break;
      case 'limits':
        reason = checkLimits(intent, policy, venueInstrument, heldPosition);
        break;
      case 'venue_permissions':
        reason = checkVenuePermissions(intent, policy);
        break;
      case 'rate_limits':
        reason = checkRateLimits(intent, policy, venueInstrument);
        break;
      case 'credentials':
        reason = checkCredentials(intent, policy);
        break;
    }
    if (reason !== null) {
      checks.push(deepFreeze({ dimension, ordinal, outcome: 'fail' }));
      const failure: CheckFailure = deepFreeze({ dimension, ordinal, reason });
      const refuseContent = decisionContentTree('refuse', intent.intentId, lineage.policy, policy.checkOrder, checks, failure, lineage, intent.asOf);
      const decision: RefusalDecision = deepFreeze({
        kind: 'refuse',
        decisionId: mintDecisionId(fnv1a32Hex(refuseContent)),
        intentRef: intent.intentId,
        policy: lineage.policy,
        checkOrder: [...policy.checkOrder],
        checks: [...checks],
        failure,
        lineage,
        asOf: intent.asOf,
      });
      return ok(decision);
    }
    checks.push(deepFreeze({ dimension, ordinal, outcome: 'pass' }));
  }

  // --- Every check passed: the approve decision --------------------------------------
  const approveContent = decisionContentTree('approve', intent.intentId, lineage.policy, policy.checkOrder, checks, null, lineage, intent.asOf);
  const decision: ApproveDecision = deepFreeze({
    kind: 'approve',
    decisionId: mintDecisionId(fnv1a32Hex(approveContent)),
    intentRef: intent.intentId,
    policy: lineage.policy,
    checkOrder: [...policy.checkOrder],
    checks: [...checks],
    lineage,
    asOf: intent.asOf,
  });
  return ok(decision);
}

/** The structured summary of a decision (deterministic — audit-side convenience, never interpreted). */
export function describeDecision(decision: ExecutionDecision): string {
  const head = `${decision.decisionId} ${decision.kind} intent=${decision.intentRef}`;
  if (decision.kind === 'refuse') {
    return `${head} failed=${decision.failure.dimension}@${decision.failure.ordinal}`;
  }
  return `${head} checks=${decision.checks.length}`;
}
