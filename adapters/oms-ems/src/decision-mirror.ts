/**
 * @tradrl/adapter-oms-ems — the execution-lane structural mirrors (T019).
 *
 * THE L8 INPUT RECORDS, RE-DECLARED BY STRUCTURE (law D-003/D-004:
 * structural mirrors, never imports — the frozen workspace lockfile
 * forbids package dependencies): field-for-field identical to
 * @tradrl/execution-policy's exported shapes (same names, same brands,
 * same optionality, same field-presence matrix), so a REAL
 * execution-policy `ApproveDecision` IS a {@link ApprovedDecisionMirror}
 * and a REAL `OrderIntent` IS an {@link OrderIntentMirror} (mutually
 * assignable, zero casts; proven by src/interop.test.ts against the REAL
 * package on this branch, including the real gate producing a real
 * APPROVE decision that this adapter's routing path accepts).
 *
 * WHY THESE MIRRORS EXIST (the lane's position — spec/ADAPTERS.md
 * Execution, VERBATIM: "Broker, exchange-native API, paper venue and
 * OMS/EMS integrations. Every consequential order passes through internal
 * execution authority/risk gates."): the broker adapter is the LAST MILE
 * of L8 (spec/ARCHITECTURE-LOCK.md L8: "models cannot bypass hard
 * risk/authorization gates"). The GATE (T019's runExecutionGate) decides;
 * the ADAPTER translates APPROVED decisions into the broker gateway's
 * documented order-entry message. A call path that could route an order
 * without a valid APPROVED decision record is a typed error — the guards
 * below are that refusal, and there is no code path around them (the
 * routing builder validates the decision BEFORE any message is built).
 *
 * The kill-switch mirror is deliberately THIN: the adapter honors the
 * INJECTED standing switch state ({@link KillSwitchStandingState}); it
 * never re-derives, re-verifies or re-implements the switch log (the log
 * and its chain verification are T019's; the runtime host injects the
 * current state the same way the gate reads it). L16's separation of
 * authority is preserved exactly: translation here, decision there.
 *
 * THE CREDENTIAL-OPACITY LAW (T019's credentials.ts, mirrored): this lane
 * carries credential REFERENCES only ('cred:'-prefixed opaque strings);
 * the referent VALUE lives in the secrets lane (T044) and venue binding
 * is the execution-gateway lane (T040). A routing bundle embedding
 * credential MATERIAL under a credential-shaped key ANYWHERE in its JSON
 * tree fails with the typed `credential_value_present` error — the scan
 * below is T019's trip wire, re-declared (pure function over the tree;
 * key normalization is case- and separator-insensitive).
 */

import { isNonEmptyString, isPositiveSafeInteger, isRecord } from './contract/fields';
import { deepFreeze } from './contract/freeze';

// ---------------------------------------------------------------------------
// The canonical decimal grammar (execution-lane mirror — stricter than the
// transport grammar: no leading zeros, no "-0", at most one fraction).
// ---------------------------------------------------------------------------

/** Canonical decimal grammar: /^(0|[1-9]\d*)(\.\d+)?$/ (mirror of T019's isCanonicalDecimal). */
export function isCanonicalDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(value);
}

/** Canonical grammar AND strictly positive (the quantity/price law). */
export function isCanonicalPositiveDecimal(value: unknown): value is string {
  return (
    isCanonicalDecimal(value) &&
    !(value === '0' || /^0\.0*$/.test(value))
  );
}

/** RFC 3339 with a MANDATORY explicit offset — the execution-lane instant form (mirror of T019's isTimestamp, hand-rolled for determinism: no Date.parse). */
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
// The order vocabulary (mirror of T019's strategy-mirror.ts, which is the
// mirror of exchange-sim's OrderIntent / domain-core's canonical Order).
// ---------------------------------------------------------------------------

export type OrderSide = 'buy' | 'sell';

export const ORDER_SIDES: readonly OrderSide[] = ['buy', 'sell'] as const;

export type CoreOrderKind = 'market' | 'limit' | 'stop' | 'stop-limit';

export const CORE_ORDER_KINDS: readonly CoreOrderKind[] = ['market', 'limit', 'stop', 'stop-limit'] as const;

/** Open vocabulary (registration discipline): a non-empty string. */
export type OrderKind = CoreOrderKind | (string & Record<never, never>);

export type CoreTimeInForce = 'day' | 'gtc' | 'ioc' | 'fok' | 'gtt';

export const CORE_TIME_IN_FORCE: readonly CoreTimeInForce[] = ['day', 'gtc', 'ioc', 'fok', 'gtt'] as const;

/** Open vocabulary: a non-empty string. */
export type TimeInForce = CoreTimeInForce | (string & Record<never, never>);

export function isOrderSide(value: unknown): value is OrderSide {
  return value === 'buy' || value === 'sell';
}

export function isCoreOrderKind(value: unknown): value is CoreOrderKind {
  return value === 'market' || value === 'limit' || value === 'stop' || value === 'stop-limit';
}

/** Open vocabulary: a non-empty string (registration discipline). */
export function isOrderKind(value: unknown): value is OrderKind {
  return isNonEmptyString(value);
}

export function isCoreTimeInForce(value: unknown): value is CoreTimeInForce {
  return (
    value === 'day' || value === 'gtc' || value === 'ioc' || value === 'fok' || value === 'gtt'
  );
}

/** Open vocabulary: a non-empty string. */
export function isTimeInForce(value: unknown): value is TimeInForce {
  return isNonEmptyString(value);
}

/**
 * Field-presence matrix for core order kinds (mirror of T019 /
 * exchange-sim / domain-core):
 *   market     -> no price, no stopPrice
 *   limit      -> price required, no stopPrice
 *   stop       -> stopPrice required, no price
 *   stop-limit -> price and stopPrice required
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
// The order intent mirror (the final request form the gate decided over).
// ---------------------------------------------------------------------------

/**
 * The tradable request — structurally identical to T019's
 * {@link OrderIntentMirror} (same field names, same optionality, same
 * field-presence matrix for core kinds, same expiry discipline for core
 * time-in-force values). THIS lane consumes it only AFTER the gate
 * approved it: the intent itself carries NO authority (L8) — the APPROVED
 * decision beside it is the authority.
 */
export interface OrderIntentMirror {
  /** Caller-assigned idempotency key. Unique within the issuing project scope. */
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly venueId: string;
  readonly side: OrderSide;
  readonly kind: OrderKind;
  /** Order quantity in instrument units. Strictly positive canonical decimal. */
  readonly quantity: string;
  /** Limit price. Strictly positive. Required for "limit" and "stop-limit". */
  readonly price?: string;
  /** Trigger price. Strictly positive. Required for "stop" and "stop-limit". */
  readonly stopPrice?: string;
  readonly timeInForce: TimeInForce;
  /** Expiry instant. Required for "gtt"; rejected for other core TIF values. */
  readonly expiresAt?: string;
  readonly createdAt: string;
  /** Free-form annotation for humans/audit; never interpreted. */
  readonly notes?: string;
}

/** Runtime guard for a structurally valid order intent (mirror of T019's `isOrderIntentMirror`). */
export function isOrderIntentMirror(value: unknown): value is OrderIntentMirror {
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
// The execution-lineage mirror (L9/L12 — every decision carries it).
// ---------------------------------------------------------------------------

/** Versioned pointer to an execution policy: identity is (policyId, version). Mirror. */
export interface PolicyVersionRefMirror {
  readonly policyId: string;
  /** Integer >= 1; monotonically increasing per policyId. */
  readonly version: number;
}

/** Guard: `PolicyVersionRefMirror`. */
export function isPolicyVersionRefMirror(value: unknown): value is PolicyVersionRefMirror {
  return isRecord(value) && isNonEmptyString(value.policyId) && isPositiveSafeInteger(value.version);
}

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
export function isExecutionLineageMirror(value: unknown): value is ExecutionLineageMirror {
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
// The decisions (mirror of T019's check-machine.ts output records).
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
export interface CheckResultMirror {
  readonly dimension: string;
  /** 1-based position in the policy's declared check order. */
  readonly ordinal: number;
  readonly outcome: 'pass' | 'fail';
}

/** Guard: `CheckResultMirror`. */
export function isCheckResultMirror(value: unknown): value is CheckResultMirror {
  return (
    isRecord(value) &&
    isPreTradeCheckKind(value.dimension) &&
    isPositiveSafeInteger(value.ordinal) &&
    (value.outcome === 'pass' || value.outcome === 'fail')
  );
}

/** Decision identity: an opaque 'xd:'-prefixed content-addressed id (mirror of T019's DecisionId guard). */
export function isDecisionId(value: unknown): value is string {
  return isNonEmptyString(value) && value.startsWith('xd:');
}

/**
 * The APPROVE decision (mirror of T019's `ApproveDecision`): every
 * pre-trade check passed, in the declared order. THIS is the only record
 * the broker adapter's routing path accepts as authority to translate an
 * order — L8: "the adapter NEVER executes authority — it TRANSLATES
 * approved decisions."
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
  /** The decision instant (the intent's asOf — no ambient clock). */
  readonly asOf: number;
}

/**
 * The REFUSE decision (mirror of T019's `RefusalDecision`): a structured
 * record, never an exception. For THIS lane it is simply NOT AUTHORITY:
 * routing a refused decision is the typed `decision_not_approved` error.
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
  if (!isDecisionId(value.decisionId)) return false;
  if (!isNonEmptyString(value.intentRef)) return false;
  if (!isPolicyVersionRefMirror(value.policy)) return false;
  if (!Array.isArray(value.checkOrder) || !value.checkOrder.every(isPreTradeCheckKind)) return false;
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
  if (!isDecisionId(value.decisionId)) return false;
  if (!isNonEmptyString(value.intentRef)) return false;
  if (!isPolicyVersionRefMirror(value.policy)) return false;
  if (!Array.isArray(value.checkOrder) || !value.checkOrder.every(isPreTradeCheckKind)) return false;
  if (!Array.isArray(value.checks) || value.checks.length === 0 || !value.checks.every(isCheckResultMirror)) {
    return false;
  }
  if (!isRecord(value.failure) || !isPreTradeCheckKind(value.failure.dimension) || !isPositiveSafeInteger(value.failure.ordinal)) {
    return false;
  }
  if (!isExecutionLineageMirror(value.lineage)) return false;
  if (typeof value.asOf !== 'number' || !Number.isSafeInteger(value.asOf) || value.asOf < 0) return false;
  return true;
}

/** Guard: `ExecutionDecisionMirror`. */
export function isExecutionDecisionMirror(value: unknown): value is ExecutionDecisionMirror {
  return isApprovedDecisionMirror(value) || isRefusalDecisionMirror(value);
}

// ---------------------------------------------------------------------------
// The kill-switch standing state (THIN mirror — the injected fact).
// ---------------------------------------------------------------------------

/** The switch state vocabulary: standing (armed) or thrown (refuse everything). Mirror of T019's KillSwitchState. */
export type KillSwitchStateMirror = 'standing' | 'thrown';

export const KILL_SWITCH_STATES: readonly KillSwitchStateMirror[] = ['standing', 'thrown'] as const;

/** Guard: a switch state. */
export function isKillSwitchStateMirror(value: unknown): value is KillSwitchStateMirror {
  return value === 'standing' || value === 'thrown';
}

/**
 * The INJECTED standing kill-switch fact the routing path honors. The
 * adapter never re-derives it from the log (the log and its chain
 * verification are T019's; the runtime host injects the current state
 * exactly as the gate reads it) — "kill-switch-honoring" without executing
 * authority: the thrown state is data, and routing under it is a typed
 * refusal.
 */
export interface KillSwitchStandingState {
  readonly state: KillSwitchStateMirror;
}

/** Guard: `KillSwitchStandingState`. */
export function isKillSwitchStandingState(value: unknown): value is KillSwitchStandingState {
  return isRecord(value) && isKillSwitchStateMirror(value.state);
}

// ---------------------------------------------------------------------------
// Credential opacity (T019's trip wire, re-declared).
// ---------------------------------------------------------------------------

/** The closed list of credential-material key shapes (normalized lowercase, no separators). Mirror of T019's CREDENTIAL_VALUE_KEYS. */
export const CREDENTIAL_VALUE_KEYS: readonly string[] = [
  'secret',
  'apikey',
  'privatekey',
  'password',
  'passphrase',
  'token',
  'mnemonic',
  'seedphrase',
  'credential',
] as const;

/** `true` when a record key is a credential-material key shape (case/separator-insensitive). */
export function isCredentialValueKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
  return (CREDENTIAL_VALUE_KEYS as readonly string[]).includes(normalized);
}

/**
 * Scan a record's JSON tree for embedded credential material: the dotted
 * paths of every credential-shaped key found, in deterministic
 * (depth-first, key-sorted) order. Pure; never throws; an empty result
 * means the tree is value-free. Mirror of T019's
 * `credentialValueViolations`.
 */
export function credentialValueViolations(value: unknown): readonly string[] {
  const found: string[] = [];
  const scan = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => scan(item, `${path}[${index}]`));
      return;
    }
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      if (isCredentialValueKey(key)) {
        found.push(path === '' ? key : `${path}.${key}`);
      }
      scan(record[key], path === '' ? key : `${path}.${key}`);
    }
  };
  scan(value, '');
  return deepFreeze(found);
}

/** Opaque reference to a credential record ('cred:'-prefixed). Mirror of T019's CredentialRef guard. */
export function isCredentialRef(value: unknown): value is string {
  return isNonEmptyString(value) && value.startsWith('cred:');
}
