// @tradrl/body-execution — the order-lane intake contracts.
//
// Owning Work Order: T025, "Intake (the order-lane mirrors)":
// "STRUCTURAL MIRRORS of the records this body consumes: T019's
// `ApproveDecision`/`RefusalDecision` (the gateway's verdicts),
// `SimulatedFill`, the kill-switch standing state, T020's limit states
// — plus the T024 director directive as OPAQUE refs (the body consumes
// decisions, never strategic reasoning). Never imported (D-004);
// interop.test.ts asserts guard parity against the REAL packages on
// this branch."
//
// This module declares the mirrors field-for-field (every field the
// real guards check structurally, exactly as T019/T020/T039 define
// them — following the brokers/OMS-EMS adapters' decision-mirror
// precedent, the closest structural sibling of this lane) and THE
// INTAKE GATE: only an APPROVE decision is authority (a refusal is a
// record, never authority — the typed `decision_not_approved` error);
// the intake scope must be one tenant/one project (L12); the
// preparation clock cannot precede the decision instant (causality —
// `timestamp_order`).
//
// The mirrors are FLOORS: they check every field the real guards check
// structurally (names, primitive shapes, closed vocabularies) and
// accept real order-lane records VERBATIM; extras ride. The
// execution-policy lane owns the deeper laws (chain verification,
// gate semantics, fill honesty) — this package's interop test proves
// the real validators still accept this package's mirror fixtures,
// and that real gate-produced decisions/fills/states pass these
// mirror guards.
//
// THE DIRECTOR DIRECTIVE (L16/L15): consumed as OPAQUE refs only —
// `dd-`-prefixed ids citing the Trading Director's decision records.
// The body consumes the DECISION REF for lineage continuity; it never
// imports, re-derives or interprets the strategic reasoning (that is
// the director body's lane on the strategic clock).

import {
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
  isTimestampMs,
  isMemberOf,
  isArrayOf,
  isNonNegativeSafeInteger,
} from './primitives';
import type { TimestampMs } from './primitives';
import type { DirectorDecisionRef, TenantId, ProjectId } from './ids';
import { isDirectorDecisionRef } from './ids';
import { type ExecutionBodyError, type ExecutionBodyResult, invalidField, invalidType } from './errors';
import { isCanonicalDecimal, isCanonicalPositiveDecimal } from './decimals';

// ---------------------------------------------------------------------------
// The canonical decimal + instant grammar (the execution-lane mirror —
// shared with the brokers/OMS-EMS adapters and T019)
// ---------------------------------------------------------------------------

/** The honest simulation fidelity modes (T019's SIMULATION_FIDELITY_MODES, mirrored). */
export const SIMULATION_FIDELITY_MODES_MIRROR = ['paper_venue', 'simulated_matching'] as const;

/** A simulation fidelity mode. Mirror of T019's `SimulationFidelity`. */
export type SimulationFidelityMirror = (typeof SIMULATION_FIDELITY_MODES_MIRROR)[number];

/** Guard: a simulation fidelity mode (NEVER live — the honesty law). */
export const isSimulationFidelityMirror = (v: unknown): v is SimulationFidelityMirror =>
  isMemberOf(SIMULATION_FIDELITY_MODES_MIRROR, v);

/** RFC 3339 with a MANDATORY explicit offset — the order-lane instant form (T019's isTimestamp, mirrored hand-rolled). */
export function isTimestampMirror(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);
  const second = Number.parseInt(match[6], 10);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const monthLengths: readonly number[] = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > monthLengths[month - 1]) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[8] !== 'Z') {
    const offset = /^([+-])(\d{2}):(\d{2})$/.exec(match[8]);
    if (offset === null) return false;
    const offsetHours = Number.parseInt(offset[2], 10);
    const offsetMinutes = Number.parseInt(offset[3], 10);
    if (offsetHours > 23 || offsetMinutes > 59) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The order vocabulary (mirror of T019's strategy-mirror.ts via the
// brokers adapters — the same field names, optionality and matrices)
// ---------------------------------------------------------------------------

/** The order side vocabulary. Mirror. */
export const ORDER_SIDES_MIRROR = ['buy', 'sell'] as const;

/** An order side. Mirror. */
export type OrderSideMirror = (typeof ORDER_SIDES_MIRROR)[number];

/** Guard: an order side. */
export const isOrderSideMirror = (v: unknown): v is OrderSideMirror => isMemberOf(ORDER_SIDES_MIRROR, v);

/** The core order-kind vocabulary. Mirror. */
export const CORE_ORDER_KINDS_MIRROR = ['market', 'limit', 'stop', 'stop-limit'] as const;

/** A core order kind. Mirror. */
export type CoreOrderKindMirror = (typeof CORE_ORDER_KINDS_MIRROR)[number];

/** An order kind (core or registered extension). Mirror. */
export type OrderKindMirror = CoreOrderKindMirror | (string & Record<never, never>);

/** Guard: a core order kind. */
export const isCoreOrderKindMirror = (v: unknown): v is CoreOrderKindMirror =>
  isMemberOf(CORE_ORDER_KINDS_MIRROR, v);

/** Guard: an order kind (any non-empty string — extensions are registered downstream). */
export const isOrderKindMirror = (v: unknown): v is OrderKindMirror => isNonEmptyString(v);

/** The core time-in-force vocabulary. Mirror. */
export const CORE_TIME_IN_FORCE_MIRROR = ['day', 'gtc', 'ioc', 'fok', 'gtt'] as const;

/** A core time-in-force. Mirror. */
export type CoreTimeInForceMirror = (typeof CORE_TIME_IN_FORCE_MIRROR)[number];

/** A time-in-force (core or registered extension). Mirror. */
export type TimeInForceMirror = CoreTimeInForceMirror | (string & Record<never, never>);

/** Guard: a core time-in-force. */
export const isCoreTimeInForceMirror = (v: unknown): v is CoreTimeInForceMirror =>
  isMemberOf(CORE_TIME_IN_FORCE_MIRROR, v);

/** Guard: a time-in-force (any non-empty string — extensions are registered downstream). */
export const isTimeInForceMirror = (v: unknown): v is TimeInForceMirror => isNonEmptyString(v);

/**
 * The core kind/price matrix (mirror of T019/the adapters):
 *   market     -> no price, no stopPrice
 *   limit      -> price required, no stopPrice
 *   stop       -> stopPrice required, no price
 *   stop-limit -> price and stopPrice required
 */
function validateCoreKindPriceMirror(order: Record<string, unknown>): boolean {
  const hasPrice = order.price !== undefined;
  const hasStop = order.stopPrice !== undefined;
  switch (order.kind) {
    case 'market':
      return !hasPrice && !hasStop;
    case 'limit':
      return hasPrice && !hasStop;
    case 'stop':
      return hasStop && !hasPrice;
    case 'stop-limit':
      return hasPrice && hasStop;
    default:
      return true;
  }
}

function validateCoreTimeInForceExpiryMirror(order: Record<string, unknown>): boolean {
  const hasExpiry = order.expiresAt !== undefined;
  switch (order.timeInForce) {
    case 'gtt':
      return hasExpiry;
    case 'day':
    case 'gtc':
    case 'ioc':
    case 'fok':
      return !hasExpiry;
    default:
      return true; // registered extension kinds may use expiry freely
  }
}

// ---------------------------------------------------------------------------
// The order intent mirror (the final request form the gate decided over —
// the shape the PREPARED order carries verbatim)
// ---------------------------------------------------------------------------

/**
 * The tradable request — structurally identical to T019's
 * `OrderIntentMirror` (same field names, same optionality, same
 * field-presence matrix for core kinds, same expiry discipline for core
 * time-in-force values — the same record the brokers/OMS-EMS adapters'
 * routing paths consume). THIS body consumes it only AFTER the gate
 * approved it: the intent itself carries NO authority (L8) — the
 * APPROVED decision beside it is the authority.
 */
export interface OrderIntentMirror {
  /** Caller-assigned idempotency key. Unique within the issuing project scope. */
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly venueId: string;
  readonly side: OrderSideMirror;
  readonly kind: OrderKindMirror;
  /** Order quantity in instrument units. Strictly positive canonical decimal. */
  readonly quantity: string;
  /** Limit price. Strictly positive. Required for "limit" and "stop-limit". */
  readonly price?: string;
  /** Trigger price. Strictly positive. Required for "stop" and "stop-limit". */
  readonly stopPrice?: string;
  readonly timeInForce: TimeInForceMirror;
  /** Expiry instant. Required for "gtt"; rejected for other core TIF values. */
  readonly expiresAt?: string;
  readonly createdAt: string;
  /** Free-form annotation for humans/audit; never interpreted. */
  readonly notes?: string;
}

/** Runtime guard for a structurally valid order intent (mirror of the adapters' `isOrderIntentMirror`). */
export function isOrderIntentMirror(value: unknown): value is OrderIntentMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.clientOrderId)) return false;
  if (!isNonEmptyString(value.instrumentId)) return false;
  if (!isNonEmptyString(value.venueId)) return false;
  if (!isOrderSideMirror(value.side)) return false;
  if (!isOrderKindMirror(value.kind)) return false;
  if (!isCanonicalPositiveDecimal(value.quantity)) return false;
  if (value.price !== undefined && !isCanonicalPositiveDecimal(value.price)) return false;
  if (value.stopPrice !== undefined && !isCanonicalPositiveDecimal(value.stopPrice)) return false;
  if (!isTimeInForceMirror(value.timeInForce)) return false;
  if (value.expiresAt !== undefined && !isTimestampMirror(value.expiresAt)) return false;
  if (!isTimestampMirror(value.createdAt)) return false;
  if (value.notes !== undefined && !isNonEmptyString(value.notes)) return false;
  if (isCoreOrderKindMirror(value.kind) && !validateCoreKindPriceMirror(value)) return false;
  if (isCoreTimeInForceMirror(value.timeInForce) && !validateCoreTimeInForceExpiryMirror(value)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The gate decisions (mirror of T019's check-machine.ts output records)
// ---------------------------------------------------------------------------

/** The seven pre-trade check kinds (mirror of T019's PRE_TRADE_CHECK_KINDS; kill_switch first). */
export const PRE_TRADE_CHECK_KINDS_MIRROR = [
  'kill_switch',
  'identity',
  'authorization',
  'limits',
  'venue_permissions',
  'rate_limits',
  'credentials',
] as const;

/** A pre-trade check kind. Mirror. */
export type PreTradeCheckKindMirror = (typeof PRE_TRADE_CHECK_KINDS_MIRROR)[number];

/** Guard: a pre-trade check kind. */
export const isPreTradeCheckKindMirror = (v: unknown): v is PreTradeCheckKindMirror =>
  isMemberOf(PRE_TRADE_CHECK_KINDS_MIRROR, v);

/** One executed pre-trade check: the dimension, its 1-based position, the outcome. Mirror. */
export interface CheckResultMirror {
  readonly dimension: PreTradeCheckKindMirror;
  /** 1-based position in the policy's declared check order. */
  readonly ordinal: number;
  readonly outcome: 'pass' | 'fail';
}

/** Guard: `CheckResultMirror`. */
export const isCheckResultMirror = (v: unknown): v is CheckResultMirror =>
  isRecord(v) &&
  isPreTradeCheckKindMirror(v.dimension) &&
  isPositiveSafeInteger(v.ordinal) &&
  (v.outcome === 'pass' || v.outcome === 'fail');

/** Versioned pointer to an execution policy: identity is (policyId, version). Mirror. */
export interface PolicyVersionRefMirror {
  readonly policyId: string;
  /** Integer >= 1; monotonically increasing per policyId. */
  readonly version: number;
}

/** Guard: `PolicyVersionRefMirror`. */
export const isPolicyVersionRefMirror = (v: unknown): v is PolicyVersionRefMirror =>
  isRecord(v) && isNonEmptyString(v.policyId) && isPositiveSafeInteger(v.version);

/**
 * The execution lane's full lineage block (L9: intent ref -> strategy
 * version -> goal ref, policy version, venue refs, seed, tenant,
 * project). Mirror of T019's `ExecutionLineage`.
 */
export interface ExecutionLineageMirror {
  /** The gated strategy intent's identity. */
  readonly intentRef: string;
  /** The strategy version that computed the intent (T018 mirror). */
  readonly strategy: { readonly specId: string; readonly version: number };
  /** The goal the strategy serves (control-plane mirror). */
  readonly goal: { readonly goalId: string; readonly version: number };
  /** The execution policy version that gated the decision. */
  readonly policy: PolicyVersionRefMirror;
  /** The venues the decision involves (the intent's venue). */
  readonly venues: readonly string[];
  /** The deterministic seed (the intent's seed — the determinism contract's anchor). */
  readonly seed: string;
  readonly tenant: string;
  readonly project: string;
}

/** Guard: `ExecutionLineageMirror` (mirror of T019's `isExecutionLineage`). */
export const isExecutionLineageMirror = (v: unknown): v is ExecutionLineageMirror => {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.intentRef)) return false;
  const strategy = v.strategy;
  if (
    !isRecord(strategy) ||
    !isNonEmptyString(strategy.specId) ||
    !isPositiveSafeInteger(strategy.version)
  ) {
    return false;
  }
  const goal = v.goal;
  if (!isRecord(goal) || !isNonEmptyString(goal.goalId) || !isPositiveSafeInteger(goal.version)) {
    return false;
  }
  if (!isPolicyVersionRefMirror(v.policy)) return false;
  if (!Array.isArray(v.venues) || v.venues.length === 0 || !v.venues.every(isNonEmptyString)) {
    return false;
  }
  if (!isNonEmptyString(v.seed)) return false;
  if (!isNonEmptyString(v.tenant)) return false;
  if (!isNonEmptyString(v.project)) return false;
  return true;
};

/** Decision identity: an opaque 'xd:'-prefixed content-addressed id (mirror of T019's DecisionId guard). */
export const isDecisionIdMirror = (v: unknown): v is string =>
  isNonEmptyString(v) && (v as string).startsWith('xd:');

/**
 * The APPROVE decision (mirror of T019's `ApproveDecision`): every
 * pre-trade check passed, in the declared order. THIS is the only record
 * that is AUTHORITY for order preparation — L8: the body REQUESTS
 * through the gateway under this verdict; the gateway executes.
 */
export interface ApprovedDecisionMirror {
  readonly kind: 'approve';
  readonly decisionId: string;
  /** The gated intent's identity ('si:'-prefixed). */
  readonly intentRef: string;
  readonly policy: PolicyVersionRefMirror;
  /** The declared order the checks ran in (the decision's own record of it). */
  readonly checkOrder: readonly string[];
  /** Every executed check, in the declared order (all passed). */
  readonly checks: readonly CheckResultMirror[];
  /** The full L9 lineage block. */
  readonly lineage: ExecutionLineageMirror;
  /** The decision instant (the intent's asOf — the STRATEGIC-side instant; never reused as order-level time, L16). */
  readonly asOf: number;
}

/**
 * The REFUSE decision (mirror of T019's `RefusalDecision`): a structured
 * record, never an exception. For THIS lane it is simply NOT AUTHORITY:
 * preparing an order from a refused decision is the typed
 * `decision_not_approved` error.
 */
export interface RefusalDecisionMirror {
  readonly kind: 'refuse';
  readonly decisionId: string;
  readonly intentRef: string;
  readonly policy: PolicyVersionRefMirror;
  readonly checkOrder: readonly string[];
  readonly checks: readonly CheckResultMirror[];
  readonly failure: {
    readonly dimension: string;
    readonly ordinal: number;
    readonly reason: unknown;
  };
  readonly lineage: ExecutionLineageMirror;
  readonly asOf: number;
}

/** A gate decision: approve or refuse (the discriminated union). Mirror. */
export type ExecutionDecisionMirror = ApprovedDecisionMirror | RefusalDecisionMirror;

/** Guard: `ApprovedDecisionMirror` (mirror of T019's `isApproveDecision`). */
export function isApprovedDecisionMirror(value: unknown): value is ApprovedDecisionMirror {
  if (!isRecord(value) || value.kind !== 'approve') return false;
  if (!isDecisionIdMirror(value.decisionId)) return false;
  if (!isNonEmptyString(value.intentRef)) return false;
  if (!isPolicyVersionRefMirror(value.policy)) return false;
  if (!Array.isArray(value.checkOrder) || !value.checkOrder.every(isPreTradeCheckKindMirror)) return false;
  if (!Array.isArray(value.checks) || !value.checks.every((check) => isCheckResultMirror(check) && check.outcome === 'pass')) {
    return false;
  }
  if (!isExecutionLineageMirror(value.lineage)) return false;
  if (typeof value.asOf !== 'number' || !Number.isSafeInteger(value.asOf) || value.asOf < 0) return false;
  return true;
}

/** Guard: `RefusalDecisionMirror` (mirror of T019's `isRefusalDecision`). */
export function isRefusalDecisionMirror(value: unknown): value is RefusalDecisionMirror {
  if (!isRecord(value) || value.kind !== 'refuse') return false;
  if (!isDecisionIdMirror(value.decisionId)) return false;
  if (!isNonEmptyString(value.intentRef)) return false;
  if (!isPolicyVersionRefMirror(value.policy)) return false;
  if (!Array.isArray(value.checkOrder) || !value.checkOrder.every(isPreTradeCheckKindMirror)) return false;
  if (!Array.isArray(value.checks) || value.checks.length === 0 || !value.checks.every(isCheckResultMirror)) {
    return false;
  }
  if (!isRecord(value.failure) || !isPreTradeCheckKindMirror(value.failure.dimension) || !isPositiveSafeInteger(value.failure.ordinal)) {
    return false;
  }
  if (!isExecutionLineageMirror(value.lineage)) return false;
  if (typeof value.asOf !== 'number' || !Number.isSafeInteger(value.asOf) || value.asOf < 0) return false;
  return true;
}

/** Guard: `ExecutionDecisionMirror`. */
export const isExecutionDecisionMirror = (v: unknown): v is ExecutionDecisionMirror =>
  isApprovedDecisionMirror(v) || isRefusalDecisionMirror(v);

// ---------------------------------------------------------------------------
// The kill-switch standing state (THIN mirror — the injected fact)
// ---------------------------------------------------------------------------

/** The switch state vocabulary: standing (armed) or thrown (refuse everything). Mirror of T019's KillSwitchState. */
export type KillSwitchStateMirror = 'standing' | 'thrown';

export const KILL_SWITCH_STATES_MIRROR: readonly KillSwitchStateMirror[] = ['standing', 'thrown'] as const;

/** Guard: a switch state. */
export const isKillSwitchStateMirror = (v: unknown): v is KillSwitchStateMirror =>
  v === 'standing' || v === 'thrown';

/**
 * The INJECTED standing kill-switch fact this body's submission path and
 * monitoring procedures honor (the runtime host injects the current
 * state exactly as the gate reads it — T019 owns the log and its chain
 * verification; the brokers/OMS-EMS adapters established this thin-mirror
 * precedent). "Kill-switch-honoring" without executing authority: the
 * thrown state is data — submissions under it fail closed, in-flight
 * orders escalate and record.
 */
export interface KillSwitchStandingStateMirror {
  readonly state: KillSwitchStateMirror;
  /** The switch's identity ('ksw:'-prefixed) — evidence carried into escalations. */
  readonly switchId: string | null;
  /** The throw instant (epoch ms; null iff standing). */
  readonly thrownAt: TimestampMs | null;
  /** The throw reason (opaque; null iff standing). */
  readonly reason: string | null;
}

/** Guard: `KillSwitchStandingStateMirror`. */
export function isKillSwitchStandingStateMirror(v: unknown): v is KillSwitchStandingStateMirror {
  if (!isRecord(v)) return false;
  if (!isKillSwitchStateMirror(v.state)) return false;
  if (v.state === 'thrown') {
    return isNonEmptyString(v.switchId) && isTimestampMs(v.thrownAt) && isNonEmptyString(v.reason);
  }
  return v.switchId === null && v.thrownAt === null && v.reason === null;
}

// ---------------------------------------------------------------------------
// The simulated-fill mirror (the fill EVIDENCE this body reconciles)
// ---------------------------------------------------------------------------

/**
 * One simulated fill's venue lineage (mirror of T019's
 * `SimulatedFillVenueLineage`): the venue model's config digest, the
 * scripted engine's order/fill record refs, and the config anchors —
 * a fill without venue lineage is not evidence of anything (L6/L9).
 */
export interface SimulatedFillVenueLineageMirror {
  /** The venue model's digest (8-hex — byte-parity with exchange-sim's configDigest). */
  readonly configDigest: string;
  /** The scripted engine's order record ref for the driving order. */
  readonly engineOrderRef: string;
  /** The scripted engine's fill record ref for this fill. */
  readonly engineFillRef: string;
  /** The fee-schedule config ref (the venue model's fees, by digest). */
  readonly feesRef: string;
  /** The latency config ref. */
  readonly latencyRef: string;
  /** The slippage config ref. */
  readonly slippageRef: string;
  /** The market-impact policy ref. */
  readonly impactRef: string;
}

/** Guard: `SimulatedFillVenueLineageMirror`. */
export const isSimulatedFillVenueLineageMirror = (v: unknown): v is SimulatedFillVenueLineageMirror => {
  if (!isRecord(v)) return false;
  if (typeof v.configDigest !== 'string' || !/^[0-9a-f]{8}$/.test(v.configDigest)) return false;
  if (!isNonEmptyString(v.engineOrderRef)) return false;
  if (!isNonEmptyString(v.engineFillRef)) return false;
  if (!isNonEmptyString(v.feesRef)) return false;
  if (!isNonEmptyString(v.latencyRef)) return false;
  if (!isNonEmptyString(v.slippageRef)) return false;
  if (!isNonEmptyString(v.impactRef)) return false;
  return true;
};

/**
 * One simulated fill (mirror of T019's `SimulatedFill`): the execution
 * report the simulator emits for an APPROVED intent — the fill EVIDENCE
 * this body's reconciliation consumes. The quantity is an exact decimal
 * string; the fill id is the `xsf-`-prefixed ordinal space; the
 * fidelity mode is one of the two honest simulated modes (NEVER live).
 */
export interface SimulatedFillMirror {
  /** Ordinal-minted identity: `xsf-` + zero-padded 8-digit ordinal (the exchange-sim minting law, mirrored). */
  readonly fillId: string;
  /** The fill ordinal within the simulation (strictly increasing in emission order). */
  readonly sequence: number;
  readonly venue: string;
  readonly instrument: string;
  /** The account's side of the fill. */
  readonly side: 'buy' | 'sell';
  /** The trade print price (decimal string). */
  readonly price: string;
  /** The aggressor's execution price after the slippage model (decimal string). */
  readonly aggressorPrice: string;
  /** The executed quantity (decimal string — exact, never a float). */
  readonly quantity: string;
  /** The account's fee (non-negative decimal string). */
  readonly fee: string;
  /** The injected information latency (whole ms) — explicit, never hidden. */
  readonly latencyMs: number;
  /** The approving decision this fill derives from (`xd:`-prefixed). */
  readonly decisionId: string;
  /** The gated strategy intent's identity. */
  readonly intentRef: string;
  /** The HONEST fidelity mode this fill was produced under (paper_venue | simulated_matching — NEVER live). */
  readonly fidelity: SimulationFidelityMirror;
  /** The full venue lineage (engine record refs + config anchors). */
  readonly venueLineage: SimulatedFillVenueLineageMirror;
  /** The full L9 execution lineage block. */
  readonly lineage: ExecutionLineageMirror;
  readonly tenant: string;
  readonly project: string;
  /** The fill's event instant (epoch ms). */
  readonly asOf: TimestampMs;
};

/** Guard: `SimulatedFillMirror` (mirror of T019's `isSimulatedFill`). */
export const isSimulatedFillMirror = (v: unknown): v is SimulatedFillMirror => {
  if (!isRecord(v)) return false;
  if (typeof v.fillId !== 'string' || !v.fillId.startsWith('xsf-')) return false;
  if (!isPositiveSafeInteger(v.sequence)) return false;
  if (!isNonEmptyString(v.venue)) return false;
  if (!isNonEmptyString(v.instrument)) return false;
  if (v.side !== 'buy' && v.side !== 'sell') return false;
  if (!isNonEmptyString(v.price)) return false;
  if (!isNonEmptyString(v.aggressorPrice)) return false;
  if (typeof v.quantity !== 'string' || !/^\d+(?:\.\d+)?$/.test(v.quantity) || v.quantity === '0') return false;
  if (typeof v.fee !== 'string' || !/^\d+(?:\.\d+)?$/.test(v.fee)) return false;
  if (!isNonNegativeSafeInteger(v.latencyMs)) return false;
  if (!isDecisionIdMirror(v.decisionId)) return false;
  if (!isNonEmptyString(v.intentRef)) return false;
  if (!isSimulationFidelityMirror(v.fidelity)) return false;
  if (!isSimulatedFillVenueLineageMirror(v.venueLineage)) return false;
  if (!isExecutionLineageMirror(v.lineage)) return false;
  if (!isNonEmptyString(v.tenant)) return false;
  if (!isNonEmptyString(v.project)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  return true;
};

// ---------------------------------------------------------------------------
// The risk limit-state mirror (T020 — the states this body observes)
// ---------------------------------------------------------------------------

/** The limit-state value vocabulary. Mirror of T020's LIMIT_STATE_VALUES. */
export const LIMIT_STATE_VALUES_MIRROR = ['within', 'breaching', 'blocked'] as const;

/** A limit-state value. Mirror. */
export type LimitStateValueMirror = (typeof LIMIT_STATE_VALUES_MIRROR)[number];

/** Guard: a limit-state value. */
export const isLimitStateValueMirror = (v: unknown): v is LimitStateValueMirror =>
  isMemberOf(LIMIT_STATE_VALUES_MIRROR, v);

/** The risk limit kinds (7). Mirror of T020's RISK_LIMIT_KINDS. */
export const RISK_LIMIT_KINDS_MIRROR = [
  'order_size',
  'order_notional',
  'position_size',
  'position_notional',
  'concentration',
  'drawdown',
  'leverage',
] as const;

/** A risk limit kind. Mirror. */
export type RiskLimitKindMirror = (typeof RISK_LIMIT_KINDS_MIRROR)[number];

/** Guard: a risk limit kind. */
export const isRiskLimitKindMirror = (v: unknown): v is RiskLimitKindMirror =>
  isMemberOf(RISK_LIMIT_KINDS_MIRROR, v);

/**
 * One limit's state (mirror of T020's `LimitState`): the kind, the
 * scope (one instrument or the whole portfolio), the value, and the
 * structured reason. This body OBSERVES these states (they flow through
 * the gateway verdicts and the risk lane's publications); it never
 * re-derives them.
 */
export interface LimitStateMirror {
  readonly kind: RiskLimitKindMirror;
  readonly scope: { readonly kind: 'instrument'; readonly venue: string; readonly instrument: string; readonly instrumentClass: string } | { readonly kind: 'portfolio' };
  readonly state: LimitStateValueMirror;
  readonly reason: unknown;
}

/** Guard: `LimitStateMirror` (mirror of T020's `isLimitState` — structure + scope law). */
export function isLimitStateMirror(v: unknown): v is LimitStateMirror {
  if (!isRecord(v)) return false;
  if (!isRiskLimitKindMirror(v.kind)) return false;
  const scope = v.scope;
  if (!isRecord(scope)) return false;
  if (scope.kind === 'portfolio') {
    // the portfolio scope carries no other fields
  } else if (scope.kind === 'instrument') {
    if (!isNonEmptyString(scope.venue)) return false;
    if (!isNonEmptyString(scope.instrument)) return false;
    if (!isNonEmptyString(scope.instrumentClass)) return false;
  } else {
    return false;
  }
  if (!isLimitStateValueMirror(v.state)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// THE INTAKE BUNDLE + THE GATE
// ---------------------------------------------------------------------------

/**
 * The order-lane intake bundle: the gateway's verdict (an APPROVE
 * decision — the authority), the gated order intent (the request form
 * to carry verbatim), the injected kill-switch standing state, the
 * observed risk limit states, and the T024 director decision as an
 * OPAQUE ref (L16: the body consumes decisions, never strategic
 * reasoning; L15: lineage continuity).
 */
export interface ExecutionIntake {
  /** The gateway's verdict record (untrusted — validated through the mirror guard; L8: only APPROVE is authority). */
  readonly decision: unknown;
  /** The gated order intent (untrusted — validated through the mirror guard; carried verbatim into the prepared order). */
  readonly intent: unknown;
  /** The injected standing kill-switch state (untrusted — validated through the thin mirror guard). */
  readonly killSwitch: unknown;
  /** The observed risk limit states (untrusted — validated through the T020 mirror guard; observed, never re-derived). */
  readonly limitStates: readonly unknown[];
  /** The T024 director decision, consumed as an OPAQUE ref (`dd`-prefixed) or null when unattributed. */
  readonly directorDecision: string | null;
}

/**
 * THE INTAKE GATE (COLLECT-ALL — every violation, never a throw):
 *
 * 1. THE L8 LAW (`decision_not_approved`): only an APPROVE decision is
 *    authority. A REFUSE decision is a RECORD, never authority to
 *    prepare an order; a non-decision is not authority either.
 * 2. Structure: the intent must satisfy the order-intent mirror guard;
 *    the kill-switch standing state its thin mirror guard; each limit
 *    state the T020 mirror guard.
 * 3. THE L12 LAWS (`tenant_mismatch` / `project_mismatch`): the
 *    decision's lineage scope must match the intake scope — one
 *    tenant, one project per order lifecycle.
 * 4. THE CAUSALITY LAW (`timestamp_order`): the preparation instant
 *    cannot precede the decision instant — the order-level clock
 *    STARTS at or after the strategic decision that authorized it.
 *    (Equality is refused separately as `clock_confusion` by the
 *    lifecycle lane: the order-level clock is a DISTINCT clock.)
 * 5. THE INTENT-BINDING LAW (`lineage_missing`): the intent's
 *    clientOrderId drives the order identity and the decision's
 *    intentRef must match the intent's lineage ref (the prepared
 *    order binds the exact intent the gate approved).
 */
export function validateExecutionIntake(
  intake: unknown,
  scope: { readonly tenant: TenantId; readonly project: ProjectId },
  prepareClock: TimestampMs,
): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(intake)) {
    return [invalidType('intake', 'an execution intake record { decision, intent, killSwitch, limitStates, directorDecision }')];
  }

  // THE L8 LAW — only APPROVE is authority.
  const decision = intake.decision;
  if (isApprovedDecisionMirror(decision)) {
    // continue into the deep laws below
  } else if (isRefusalDecisionMirror(decision)) {
    errors.push({
      code: 'decision_not_approved',
      path: 'intake.decision',
      message: `the gateway REFUSED this intent (decision ${JSON.stringify(decision.decisionId)}, failing check ${JSON.stringify(decision.failure.dimension)}) — a refusal is a record, never authority to prepare an order (L8)`,
    });
  } else {
    errors.push({
      code: 'decision_not_approved',
      path: 'intake.decision',
      message: 'the intake decision is not a valid APPROVE decision record (kind "approve", decision id, intent ref, policy version, passed checks, L9 lineage, decision instant) — only the gateway\'s approval is authority (L8)',
    });
  }

  const intent = intake.intent;
  if (!isOrderIntentMirror(intent)) {
    errors.push(invalidField('intake.intent', 'must be a structurally valid order intent (the mirrored OrderIntent contract: client order id, instrument, venue, side, kind, canonical quantity, time-in-force, creation instant)'));
  }
  if (!isKillSwitchStandingStateMirror(intake.killSwitch)) {
    errors.push(invalidField('intake.killSwitch', 'must be the injected kill-switch standing state { state: standing | thrown, switchId, thrownAt, reason }'));
  }
  if (!Array.isArray(intake.limitStates)) {
    errors.push(invalidField('intake.limitStates', 'must be an array of observed T020 limit states'));
  } else {
    (intake.limitStates as readonly unknown[]).forEach((state, index) => {
      if (!isLimitStateMirror(state)) {
        errors.push(invalidField(`intake.limitStates[${index}]`, 'must be a well-formed T020 limit-state mirror record'));
      }
    });
  }
  if (intake.directorDecision !== null && !isDirectorDecisionRef(intake.directorDecision)) {
    errors.push(invalidField('intake.directorDecision', 'must be an opaque \'dd\'-prefixed director decision ref (the body consumes decisions, never strategic reasoning — L16)'));
  }

  // The deep laws (only when the structural guards passed).
  if (isApprovedDecisionMirror(decision) && isOrderIntentMirror(intent)) {
    const approved = decision as ApprovedDecisionMirror;
    const orderIntent = intent as OrderIntentMirror;

    // THE L12 LAWS — one tenant, one project per lifecycle.
    if (approved.lineage.tenant !== scope.tenant) {
      errors.push({
        code: 'tenant_mismatch',
        path: 'intake.decision.lineage.tenant',
        message: `the approving decision carries tenant ${JSON.stringify(approved.lineage.tenant)}, not the lifecycle tenant ${JSON.stringify(scope.tenant)} (L12)`,
      });
    }
    if (approved.lineage.project !== scope.project) {
      errors.push({
        code: 'project_mismatch',
        path: 'intake.decision.lineage.project',
        message: `the approving decision carries project ${JSON.stringify(approved.lineage.project)}, not the lifecycle project ${JSON.stringify(scope.project)} (L12/L15)`,
      });
    }
    if (approved.lineage.venues.length > 0 && !approved.lineage.venues.includes(orderIntent.venueId)) {
      errors.push({
        code: 'lineage_missing',
        path: 'intake.decision.lineage.venues',
        message: `the approving decision\'s venues (${approved.lineage.venues.join(', ')}) do not include the intent\'s venue ${JSON.stringify(orderIntent.venueId)} — the prepared order binds the exact intent the gate approved`,
      });
    }

    // THE INTENT-BINDING LAW — the decision's intentRef matches the intent's lineage ref.
    if (!approved.intentRef.includes(orderIntent.clientOrderId)) {
      errors.push({
        code: 'lineage_missing',
        path: 'intake.decision.intentRef',
        message: `the approving decision\'s intent ref ${JSON.stringify(approved.intentRef)} does not bind the intent\'s client order id ${JSON.stringify(orderIntent.clientOrderId)} — the prepared order binds the exact intent the gate approved`,
      });
    }

    // THE CAUSALITY LAW — the order-level clock starts at or after the decision instant.
    if (isTimestampMs(prepareClock) && isTimestampMs(approved.asOf) && prepareClock < approved.asOf) {
      errors.push({
        code: 'timestamp_order',
        path: 'prepareClock',
        message: `the preparation instant ${JSON.stringify(prepareClock)} precedes the decision instant ${JSON.stringify(approved.asOf)} — the order-level clock starts at or after the strategic decision that authorized it (L16)`,
      });
    }
  }
  return errors;
}

/**
 * THE INTAKE ACCEPTANCE: the gate plus the exact-decimal check on the
 * carried quantity (float mediation is the typed `decimal_imprecision`)
 * — the accepted bundle is the typed input of the preparation procedure.
 */
export function acceptExecutionIntake(
  intake: unknown,
  scope: { readonly tenant: TenantId; readonly project: ProjectId },
  prepareClock: TimestampMs,
): ExecutionBodyResult<{ readonly decision: ApprovedDecisionMirror; readonly intent: OrderIntentMirror; readonly killSwitch: KillSwitchStandingStateMirror; readonly directorDecision: DirectorDecisionRef | null }> {
  const errors = validateExecutionIntake(intake, scope, prepareClock);
  if (errors.length > 0) return { ok: false, errors };
  const record = intake as ExecutionIntake;
  return {
    ok: true,
    value: {
      decision: record.decision as ApprovedDecisionMirror,
      intent: record.intent as OrderIntentMirror,
      killSwitch: record.killSwitch as KillSwitchStandingStateMirror,
      directorDecision: (record.directorDecision === null ? null : record.directorDecision) as DirectorDecisionRef | null,
    },
  };
}

/** The intake's fill-evidence guard: fill records consumed by reconciliation (mirrors accepted verbatim). */
export function validateFillEvidence(
  fill: unknown,
  scope: { readonly tenant: TenantId; readonly project: ProjectId; readonly decision: string },
): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isSimulatedFillMirror(fill)) {
    return [invalidField('fill', 'must be a structurally valid simulated fill mirror record (fill id, sequence, venue, instrument, side, price, quantity, fee, latency, decision ref, fidelity, venue lineage, L9 lineage, tenant/project, instant)')];
  }
  const record = fill as SimulatedFillMirror;
  if (record.tenant !== scope.tenant) {
    errors.push({
      code: 'tenant_mismatch',
      path: 'fill.tenant',
      message: `the fill carries tenant ${JSON.stringify(record.tenant)}, not the lifecycle tenant ${JSON.stringify(scope.tenant)} (L12)`,
    });
  }
  if (record.project !== scope.project) {
    errors.push({
      code: 'project_mismatch',
      path: 'fill.project',
      message: `the fill carries project ${JSON.stringify(record.project)}, not the lifecycle project ${JSON.stringify(scope.project)} (L12/L15)`,
    });
  }
  if (record.decisionId !== scope.decision) {
    errors.push({
      code: 'fill_ref_mismatch',
      path: 'fill.decisionId',
      message: `the fill derives from decision ${JSON.stringify(record.decisionId)}, not the lifecycle decision ${JSON.stringify(scope.decision)} — fill evidence binds the exact order it filled (L9)`,
    });
  }
  return errors;
}
