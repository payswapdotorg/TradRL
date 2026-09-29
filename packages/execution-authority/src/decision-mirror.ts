// @tradrl/execution-authority — the execution-lane structural mirrors
// (T019's output records + the routed order form + the mode marker).
//
// STRUCTURAL MIRRORS of @tradrl/execution-policy (T019) — re-declared
// by STRUCTURE, never imported (D-003/D-004): the APPROVE/REFUSE
// decision records (`ApproveDecision`/`RefusalDecision`), the L9
// execution lineage block, the check results, the pre-trade check
// kinds, the order-intent mirror (the final request form — field
// names, optionality and the field-presence matrix identical), and the
// RFC-3339 timestamp shape. The mirrors are MUTUALLY ASSIGNABLE with
// the real records (zero casts; src/interop.test.ts proves a REAL
// `runExecutionGate` decision satisfies THIS module's guards verbatim).
//
// THE TRANSLATION-CONTRACT LAW (the Work Order: "GatewayOrderRequest:
// the translation contract — a validated APPROVED decision (T019
// ApproveDecision mirror) + the routed order form. An order request
// without a valid approved-decision ref is INEXPRESSIBLE at the guard
// level (mirrors the brokers adapter's law, one lane upstream)"):
// {@link isApproveDecisionRecord} accepts ONLY kind === 'approve' with
// a valid 'xd:' decision id, a passed-checks list and the full L9
// lineage. A REFUSAL decision, a malformed record or garbage fails the
// guard — the approved-decision half of the translation contract is
// enforced at the GUARD level, not at a call-site convention.
//
// THE MODE MARKER (the shadow/live separation): T030's shadow-trading
// lane runs UPSTREAM in the paper lane; THIS lane is the consequential
// lane. The separation key is the additive optional `executionMode`
// field on the submitted intent record ('live' is the default when
// absent — every merged T019 intent is a live-lane intent). A
// 'shadow'- or 'paper'-mode intent reaching the live gateway is a
// typed refusal at the gateway level (see services/execution-gateway);
// this module owns the vocabulary and the extraction helper.

import { canonicalJson, fnv1a32Hex, isMemberOf, isNonEmptyString, isPositiveSafeInteger, isRecord } from './primitives';
import { isDecisionId, isExecutionPolicyId, isPolicyVersionRefMirror } from './ids';

// ---------------------------------------------------------------------------
// The order vocabulary (T019 strategy-mirror's space, mirrored)
// ---------------------------------------------------------------------------

/** The order side vocabulary. Mirror. */
export type OrderSide = 'buy' | 'sell';

export const ORDER_SIDES: readonly OrderSide[] = ['buy', 'sell'] as const;

/** Guard: an order side. */
export function isOrderSide(v: unknown): v is OrderSide {
  return isMemberOf(ORDER_SIDES, v);
}

/** The core order kinds (the registered extension discipline stays open — a non-empty string). Mirror. */
export type CoreOrderKind = 'market' | 'limit' | 'stop' | 'stop-limit';

export const CORE_ORDER_KINDS: readonly CoreOrderKind[] = ['market', 'limit', 'stop', 'stop-limit'] as const;

/** Guard: a core order kind. */
export function isCoreOrderKind(v: unknown): v is CoreOrderKind {
  return isMemberOf(CORE_ORDER_KINDS, v);
}

/** Open vocabulary: a non-empty string (registration discipline). Mirror. */
export function isOrderKind(v: unknown): v is string {
  return isNonEmptyString(v);
}

/** The core time-in-force vocabulary. Mirror. */
export type CoreTimeInForce = 'day' | 'gtc' | 'ioc' | 'fok' | 'gtt';

export const CORE_TIME_IN_FORCE: readonly CoreTimeInForce[] = ['day', 'gtc', 'ioc', 'fok', 'gtt'] as const;

/** Guard: a core time-in-force value. */
export function isCoreTimeInForce(v: unknown): v is CoreTimeInForce {
  return isMemberOf(CORE_TIME_IN_FORCE, v);
}

/** Open vocabulary: a non-empty string. Mirror. */
export function isTimeInForce(v: unknown): v is string {
  return isNonEmptyString(v);
}

/** Guard: RFC 3339 timestamp with explicit offset and a real calendar date/time (mirror of T019's `isTimestamp`, law for law). */
const TIMESTAMP_MIRROR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isTimestampMirror(v: unknown): v is string {
  if (typeof v !== 'string' || !TIMESTAMP_MIRROR_PATTERN.test(v)) return false;
  return Number.isFinite(Date.parse(v));
}

/** `true` when `v` is a canonical positive decimal string (canonical grammar AND strictly positive — mirror of T019's `isCanonicalPositiveDecimal`/T039's law: `!(value === '0' || /^0\.0*$/)`). */
export function isCanonicalPositiveDecimal(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^(0|[1-9]\d*)(\.\d+)?$/.test(v) &&
    !(v === '0' || /^0\.0*$/.test(v))
  );
}

/**
 * The field-presence matrix for the core order kinds (T019/T039's law,
 * mirrored): market -> no price, no stopPrice; limit -> price, no
 * stopPrice; stop -> stopPrice, no price; stop-limit -> both.
 */
function validateCoreKindPriceMatrix(order: Record<string, unknown>): boolean {
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

/** The core time-in-force expiry discipline (gtt requires expiresAt; the others reject it). Mirror. */
function validateCoreTimeInForceExpiry(order: Record<string, unknown>): boolean {
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
// The routed order form (T019's OrderIntentMirror, mirrored)
// ---------------------------------------------------------------------------

/**
 * The routed order form — the final request shape the gate decided over
 * and the adapters translate. Structurally identical to T019's
 * `OrderIntentMirror` (and T039's): same field names, same optionality,
 * same field-presence matrix, same expiry discipline.
 */
export interface OrderIntentRecord {
  /** Caller-assigned idempotency key. Unique within the issuing project scope. */
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly venueId: string;
  readonly side: OrderSide;
  readonly kind: string;
  /** Order quantity in instrument units. Strictly positive canonical decimal. */
  readonly quantity: string;
  /** Limit price. Strictly positive. Required for "limit" and "stop-limit". */
  readonly price?: string;
  /** Trigger price. Strictly positive. Required for "stop" and "stop-limit". */
  readonly stopPrice?: string;
  readonly timeInForce: string;
  /** Expiry instant. Required for "gtt"; rejected for other core TIF values. */
  readonly expiresAt?: string;
  readonly createdAt: string;
  /** Free-form annotation for humans/audit; never interpreted. */
  readonly notes?: string;
}

/** Guard: `OrderIntentRecord` (mirror of T019's `isOrderIntentMirror`, law for law). */
export function isOrderIntentRecord(value: unknown): value is OrderIntentRecord {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.clientOrderId)) return false;
  if (!isNonEmptyString(value.instrumentId)) return false;
  if (!isNonEmptyString(value.venueId)) return false;
  if (!isOrderSide(value.side)) return false;
  if (!isOrderKind(value.kind)) return false;
  if (!isCanonicalPositiveDecimal(value.quantity)) return false;
  if (value.price !== undefined && !isCanonicalPositiveDecimal(value.price)) return false;
  if (value.stopPrice !== undefined && !isCanonicalPositiveDecimal(value.stopPrice)) return false;
  if (!isTimeInForce(value.timeInForce)) return false;
  if (value.expiresAt !== undefined && !isTimestampMirror(value.expiresAt)) return false;
  if (!isTimestampMirror(value.createdAt)) return false;
  if (value.notes !== undefined && !isNonEmptyString(value.notes)) return false;
  if (isCoreOrderKind(value.kind) && !validateCoreKindPriceMatrix(value)) return false;
  if (isCoreTimeInForce(value.timeInForce) && !validateCoreTimeInForceExpiry(value)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The L9 lineage block (T019's ExecutionLineage, mirrored)
// ---------------------------------------------------------------------------

/**
 * The execution lane's full lineage block (L9: intent ref -> strategy
 * version -> goal ref, policy version, venue refs, seed, tenant,
 * project). Mirror of T019's `ExecutionLineage`.
 */
export interface ExecutionLineageRecord {
  /** The gated strategy intent's identity ('si:'-prefixed). */
  readonly intentRef: string;
  /** The strategy version that computed the intent (T018 mirror — the BodyVersion carrier). */
  readonly strategy: { readonly specId: string; readonly version: number };
  /** The goal the strategy serves (control-plane mirror). */
  readonly goal: { readonly goalId: string; readonly version: number };
  /** The execution policy version that gated the decision. */
  readonly policy: { readonly policyId: string; readonly version: number };
  /** The venues the decision involves (the intent's venue). */
  readonly venues: readonly string[];
  /** The deterministic seed (the intent's seed — the determinism contract's anchor). */
  readonly seed: string;
  readonly tenant: string;
  readonly project: string;
}

/** Guard: `ExecutionLineageRecord` (mirror of T019's `isExecutionLineage`, law for law). */
export function isExecutionLineageRecord(value: unknown): value is ExecutionLineageRecord {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.intentRef)) return false;
  const strategy = value.strategy;
  if (
    !isRecord(strategy) ||
    !isNonEmptyString(strategy.specId) ||
    !isPositiveSafeInteger(strategy.version)
  ) {
    return false;
  }
  const goal = value.goal;
  if (!isRecord(goal) || !isNonEmptyString(goal.goalId) || !isPositiveSafeInteger(goal.version)) {
    return false;
  }
  if (!isPolicyVersionRefMirror(value.policy)) return false;
  if (!Array.isArray(value.venues) || value.venues.length === 0 || !value.venues.every(isNonEmptyString)) {
    return false;
  }
  if (!isNonEmptyString(value.seed)) return false;
  if (!isNonEmptyString(value.tenant)) return false;
  if (!isNonEmptyString(value.project)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The decisions (T019's check-machine output records, mirrored)
// ---------------------------------------------------------------------------

/** The seven pre-trade check kinds (mirror of T019's PRE_TRADE_CHECK_KINDS; kill_switch first). */
export const PRE_TRADE_CHECK_KINDS: readonly string[] = [
  'kill_switch',
  'identity',
  'authorization',
  'limits',
  'venue_permissions',
  'rate_limits',
  'credentials',
] as const;

/** Guard: a pre-trade check kind. */
export function isPreTradeCheckKind(value: unknown): value is string {
  return typeof value === 'string' && (PRE_TRADE_CHECK_KINDS as readonly string[]).includes(value);
}

/** One executed pre-trade check: the dimension, its 1-based position, the outcome. Mirror. */
export interface CheckResultRecord {
  readonly dimension: string;
  /** 1-based position in the policy's declared check order. */
  readonly ordinal: number;
  readonly outcome: 'pass' | 'fail';
}

/** Guard: `CheckResultRecord`. */
export function isCheckResultRecord(value: unknown): value is CheckResultRecord {
  return (
    isRecord(value) &&
    isPreTradeCheckKind(value.dimension) &&
    isPositiveSafeInteger(value.ordinal) &&
    (value.outcome === 'pass' || value.outcome === 'fail')
  );
}

/**
 * The APPROVE decision (mirror of T019's `ApproveDecision`): every
 * pre-trade check passed, in the declared order. THIS is the only
 * record the authority lane's translation contract accepts as
 * authority to build an order request — L8: "the adapter NEVER
 * executes authority — it TRANSLATES approved decisions" (T039), and
 * the gateway ENFORCES the same law one lane upstream.
 */
export interface ApproveDecisionRecord {
  readonly kind: 'approve';
  readonly decisionId: string;
  /** The gated intent's identity ('si:'-prefixed). */
  readonly intentRef: string;
  readonly policy: { readonly policyId: string; readonly version: number };
  /** The declared order the checks ran in (the decision's own record of it). */
  readonly checkOrder: readonly string[];
  /** Every executed check, in the declared order (all passed). */
  readonly checks: readonly CheckResultRecord[];
  /** The full L9 lineage block. */
  readonly lineage: ExecutionLineageRecord;
  /** The decision instant (the intent's asOf — no ambient clock). */
  readonly asOf: number;
}

/**
 * The REFUSE decision (mirror of T019's `RefusalDecision`): a
 * structured record, never an exception. For THIS lane it is simply
 * NOT AUTHORITY: an order request carrying a refusal decision fails
 * its guard (the translation contract's existential law).
 */
export interface RefusalDecisionRecord {
  readonly kind: 'refuse';
  readonly decisionId: string;
  readonly intentRef: string;
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly checkOrder: readonly string[];
  readonly checks: readonly CheckResultRecord[];
  readonly failure: {
    readonly dimension: string;
    readonly ordinal: number;
    readonly reason: unknown;
  };
  readonly lineage: ExecutionLineageRecord;
  readonly asOf: number;
}

/** A gate decision: approve or refuse (the discriminated union). Mirror. */
export type ExecutionDecisionRecord = ApproveDecisionRecord | RefusalDecisionRecord;

/** Guard: `ApproveDecisionRecord` (mirror of T019's `isApproveDecision`, law for law — the L8 authority record). */
export function isApproveDecisionRecord(value: unknown): value is ApproveDecisionRecord {
  if (!isRecord(value) || value.kind !== 'approve') return false;
  if (!isDecisionId(value.decisionId)) return false;
  if (!isNonEmptyString(value.intentRef)) return false;
  if (!isPolicyVersionRefMirror(value.policy)) return false;
  if (!Array.isArray(value.checkOrder) || !value.checkOrder.every(isPreTradeCheckKind)) return false;
  if (!Array.isArray(value.checks) || !value.checks.every((check) => isCheckResultRecord(check) && check.outcome === 'pass')) {
    return false;
  }
  if (!isExecutionLineageRecord(value.lineage)) return false;
  if (typeof value.asOf !== 'number' || !Number.isSafeInteger(value.asOf) || value.asOf < 0) return false;
  return true;
}

/** Guard: `RefusalDecisionRecord` (mirror of T019's `isRefusalDecision`, law for law). */
export function isRefusalDecisionRecord(value: unknown): value is RefusalDecisionRecord {
  if (!isRecord(value) || value.kind !== 'refuse') return false;
  if (!isDecisionId(value.decisionId)) return false;
  if (!isNonEmptyString(value.intentRef)) return false;
  if (!isPolicyVersionRefMirror(value.policy)) return false;
  if (!Array.isArray(value.checkOrder) || !value.checkOrder.every(isPreTradeCheckKind)) return false;
  if (!Array.isArray(value.checks) || value.checks.length === 0 || !value.checks.every(isCheckResultRecord)) {
    return false;
  }
  if (!isRecord(value.failure) || !isPreTradeCheckKind(value.failure.dimension) || !isPositiveSafeInteger(value.failure.ordinal)) {
    return false;
  }
  if (!isExecutionLineageRecord(value.lineage)) return false;
  if (typeof value.asOf !== 'number' || !Number.isSafeInteger(value.asOf) || value.asOf < 0) return false;
  return true;
}

/** Guard: `ExecutionDecisionRecord`. */
export function isExecutionDecisionRecord(value: unknown): value is ExecutionDecisionRecord {
  return isApproveDecisionRecord(value) || isRefusalDecisionRecord(value);
}

// ---------------------------------------------------------------------------
// The decision-id content-addressing verifier (the T019 minting law, mirrored)
// ---------------------------------------------------------------------------

/**
 * Verify an APPROVE decision's content-addressed id: re-derive
 * `xd:` + fnv1a32Hex(canonical(content)) from the record's own fields
 * and compare. A FORGED id (a valid-shaped 'xd:' string that does not
 * match the content) fails — the translation contract's
 * defense-in-depth against forged decision refs (the REAL gate mints
 * ids; anything else is not authority). The derivation mirrors T019's
 * `decisionContentTree` exactly (canonical JSON sorts keys, so only
 * the tree's SHAPE matters); src/interop.test.ts proves REAL gate
 * decisions verify — drift breaks loudly.
 */
/** Derive the content-addressed id of an approve decision's content (the T019 minting law, mirrored — the fixture/tests' minter). */
export function mintApproveDecisionId(content: Omit<ApproveDecisionRecord, 'decisionId'>): string {
  const tree = {
    kind: 'approve' as const,
    intentRef: content.intentRef,
    policy: { policyId: content.policy.policyId, version: content.policy.version },
    checkOrder: [...content.checkOrder],
    checks: content.checks.map((check) => ({ dimension: check.dimension, ordinal: check.ordinal, outcome: check.outcome })),
    failure: null,
    lineage: {
      intentRef: content.lineage.intentRef,
      strategy: { specId: content.lineage.strategy.specId, version: content.lineage.strategy.version },
      goal: { goalId: content.lineage.goal.goalId, version: content.lineage.goal.version },
      policy: { policyId: content.lineage.policy.policyId, version: content.lineage.policy.version },
      venues: [...content.lineage.venues],
      seed: content.lineage.seed,
      tenant: content.lineage.tenant,
      project: content.lineage.project,
    },
    asOf: content.asOf,
  };
  return `xd:${fnv1a32Hex(canonicalJson(tree as never))}`;
}

/** Verify an APPROVE decision's content-addressed id (see the module header). */
export function approveDecisionIdMatchesContent(decision: ApproveDecisionRecord): boolean {
  const { decisionId, ...content } = decision;
  void decisionId;
  return mintApproveDecisionId(content) === decision.decisionId;
}

// ---------------------------------------------------------------------------
// The injected standing kill-switch fact (THIN mirror — T039's shape)
// ---------------------------------------------------------------------------

/** The switch state vocabulary: standing (armed) or thrown (refuse everything). Mirror of T019's KillSwitchState. */
export type KillSwitchStandingState = 'standing' | 'thrown';

export const KILL_SWITCH_STANDING_STATES: readonly KillSwitchStandingState[] = ['standing', 'thrown'] as const;

/**
 * The INJECTED standing kill-switch fact the translation contract
 * honors (T039's thin mirror): the adapter/gateway never re-derives the
 * switch — it honors the injected fact exactly as the gate read it
 * (L16: distinct authority, distinct clocks). A thrown state is data;
 * routing under it is a typed refusal.
 */
export interface KillSwitchStandingFact {
  readonly state: KillSwitchStandingState;
}

/** Guard: `KillSwitchStandingFact`. */
export function isKillSwitchStandingFact(value: unknown): value is KillSwitchStandingFact {
  return isRecord(value) && (value.state === 'standing' || value.state === 'thrown');
}

// ---------------------------------------------------------------------------
// The execution-mode marker (the shadow/live lane separation)
// ---------------------------------------------------------------------------

/** The execution-lane mode vocabulary: the consequential lane is 'live'; the paper lane is 'shadow'/'paper'. */
export const EXECUTION_MODES: readonly string[] = ['live', 'shadow', 'paper'] as const;

/** Guard: an execution mode value. */
export function isExecutionMode(value: unknown): value is string {
  return typeof value === 'string' && (EXECUTION_MODES as readonly string[]).includes(value);
}

/**
 * Extract the execution-mode marker from a submitted intent record: the
 * additive optional `executionMode` field ('live' when absent — every
 * merged T019 intent is a live-lane intent). The marker is NEVER
 * interpreted as authority: a non-live marker is exactly the typed
 * fact the live gateway refuses (mode separation — the shadow lane
 * (T030) runs upstream in the paper lane).
 */
export function intentExecutionMode(intent: unknown): string | null {
  if (!isRecord(intent)) return null;
  const mode: unknown = intent.executionMode;
  if (mode === undefined) return null;
  return isExecutionMode(mode) ? mode : null;
}
