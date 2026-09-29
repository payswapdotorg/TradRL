// @tradrl/body-execution — the DECLARED TOTAL ORDER-STATE MACHINE.
//
// Owning Work Order: T025, "The order lifecycle (the declared state
// machine)": "a DECLARED, total order-state machine — states (at
// minimum: prepared | submitted | acknowledged | partially_filled |
// filled | cancelled | rejected | expired | stuck), with typed,
// enumerable transitions; an undefined transition is a typed
// `lifecycle_violation`. Every state record carries: decision ref,
// order refs, explicit timestamps, tenant/project (L12), and the L16
// clock marker — order-level time, a DISTINCT field from any strategic
// `asOf`; a lifecycle record stamped with strategic time is a typed
// `clock_confusion` error. Exact-decimal accounting on every quantity
// (BigInt fixed-point; float mediation is the typed
// `decimal_imprecision`)."
//
// THE STATE MACHINE (closed, total, enumerable):
//   prepared        -> submitted | cancelled        (submit; cancel-before-submit)
//   submitted       -> acknowledged | rejected | expired | stuck
//                       (acknowledge; reject-at-gate; expire-unacked;
//                        ack-deadline-exceeded)
//   acknowledged    -> partially_filled | filled | cancelled | expired | stuck
//                       (partial-fill; fill-complete; cancel-unfilled;
//                        expire-unfilled; fill-deadline-exceeded)
//   partially_filled-> filled | cancelled | expired
//                       (fill-complete; cancel-remaining; expire-partial)
//   stuck           -> acknowledged | partially_filled | filled |
//                       cancelled | rejected | expired
//                       (the recovery paths: late-acknowledge,
//                        late-partial-fill, late-fill-complete,
//                        cancel-after-escalation, late-reject,
//                        late-expire — an escalation is a RECORD, and
//                        life may continue after it)
//   filled | cancelled | rejected | expired are TERMINAL: every
//   transition out of a terminal state is a typed `lifecycle_violation`
//   (replay protection).
//   The GENESIS transition: nothing -> prepared (event 'prepare').
//
// THE L16 CLOCK LAW (the existential law of this lane): every record
// carries `orderClock` — the ORDER-LEVEL event instant — as a field
// DISTINCT from `decisionAsOf` (the cited decision's strategic instant,
// carried for lineage). Two typed `clock_confusion` crimes:
//   (a) a lifecycle record carrying a strategic-time `asOf` field —
//       the strategic lane's field name in the lifecycle position
//       means the record was stamped with strategic time;
//   (b) `orderClock === decisionAsOf` — the strategic instant copied
//       into the order-level clock field: the order-level clock is a
//       DIFFERENT clock (strategic and order-level control have
//       distinct clocks and authority — L16).
//   `orderClock < decisionAsOf` is instead `timestamp_order` (the
//   causality law: the order-level event cannot precede the decision
//   that authorized it).
//
// THE EVIDENCE LAWS (never fabricate): a fill event carries its fill
// evidence (`xsf-`-refenced exact-decimal quantities — empty evidence
// is the typed `fill_fabricated`); a cancel event carries a gateway
// confirmation ref (absent = `cancel_fabricated`); a stuck entry
// carries its escalation ref (absent = `escalation_missing` — never a
// silent timeout).
//
// THE CHAIN (the execution-plane discipline): the log is append-only
// and chain-verified exactly as T019's kill-switch/audit trails are —
// `chainHead = fnv(prevHead + canonical(content))` — so a rewritten
// history is the typed `lifecycle_chain` error. The derived identity
// is content-addressed (`ol-` + 16-hex digest); nothing is random.

import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isChainHead,
  isMemberOf,
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
  isTimestampMs,
  isArrayOf,
  stableDigestJson,
  type JsonValue,
  type TimestampMs,
} from './primitives';
import {
  type DecisionRef,
  type DirectorDecisionRef,
  type EscalationRecordId,
  type FillRef,
  type MethodId,
  type MethodVersionRef,
  type OrderLifecycleId,
  type OrderRef,
  type ProjectId,
  isOrderLifecycleId,
  type TenantId,
  type CancelConfirmationRef,
  isDecisionRef,
  isDirectorDecisionRef,
  isEscalationRecordId,
  isFillRef,
  isMethodId,
  isMethodVersionRef,
  isOrderRef,
  isProjectId,
  isTenantId,
  isCancelConfirmationRef,
} from './ids';
import {
  type ExecutionBodyError,
  type ExecutionBodyResult,
  type ExecutionBodyValidation,
  invalidField,
  invalidType,
  validationOf,
} from './errors';
import { isCanonicalPositiveDecimal, quantityProblems } from './decimals';
import {
  type MethodRegistry,
  resolveMethodCitation,
} from './methods';

// ---------------------------------------------------------------------------
// The states (the closed vocabulary — L16's order-level lane)
// ---------------------------------------------------------------------------

/** The declared order states (closed vocabulary — the Work Order's list). */
export const ORDER_STATES = [
  'prepared',
  'submitted',
  'acknowledged',
  'partially_filled',
  'filled',
  'cancelled',
  'rejected',
  'expired',
  'stuck',
] as const;

/** A declared order state. */
export type OrderState = (typeof ORDER_STATES)[number];

/** Guard: a declared order state. */
export const isOrderState = (v: unknown): v is OrderState => isMemberOf(ORDER_STATES, v);

/** The terminal states: no transition leaves them (replay protection). */
export const TERMINAL_ORDER_STATES: readonly OrderState[] = ['filled', 'cancelled', 'rejected', 'expired'] as const;

/** Guard: a terminal state. */
export const isTerminalOrderState = (v: unknown): v is OrderState =>
  isMemberOf(TERMINAL_ORDER_STATES, v);

// ---------------------------------------------------------------------------
// The events + the declared transition table (typed, enumerable, total)
// ---------------------------------------------------------------------------

/** The declared lifecycle events (closed vocabulary — one per legal transition). */
export const ORDER_LIFECYCLE_EVENTS = [
  'prepare',
  'submit',
  'cancel-before-submit',
  'acknowledge',
  'reject-at-gate',
  'expire-unacked',
  'ack-deadline-exceeded',
  'partial-fill',
  'fill-complete',
  'cancel-unfilled',
  'expire-unfilled',
  'fill-deadline-exceeded',
  'cancel-remaining',
  'expire-partial',
  'late-acknowledge',
  'late-partial-fill',
  'late-fill-complete',
  'cancel-after-escalation',
  'late-reject',
  'late-expire',
] as const;

/** A declared lifecycle event. */
export type OrderLifecycleEvent = (typeof ORDER_LIFECYCLE_EVENTS)[number];

/** Guard: a declared lifecycle event. */
export const isOrderLifecycleEvent = (v: unknown): v is OrderLifecycleEvent =>
  isMemberOf(ORDER_LIFECYCLE_EVENTS, v);

/** One declared transition: the source state, the event, the target state. `from: null` is the genesis. */
export interface OrderTransition {
  /** The source state (`null` = the order did not exist — the genesis). */
  readonly from: OrderState | null;
  /** The declared event driving the transition. */
  readonly event: OrderLifecycleEvent;
  /** The target state. */
  readonly to: OrderState;
}

/**
 * THE DECLARED TRANSITION TABLE — total, typed, enumerable. Every legal
 * order-lifecycle motion is one of these 21 entries (the genesis
 * `prepare` included); ANY other (state, event) or (from, to) pair is
 * the typed `lifecycle_violation` (an undefined transition).
 */
export const ORDER_LIFECYCLE_TRANSITIONS: readonly OrderTransition[] = deepFreeze([
  // genesis
  { from: null, event: 'prepare', to: 'prepared' },
  // prepared
  { from: 'prepared', event: 'submit', to: 'submitted' },
  { from: 'prepared', event: 'cancel-before-submit', to: 'cancelled' },
  // submitted
  { from: 'submitted', event: 'acknowledge', to: 'acknowledged' },
  { from: 'submitted', event: 'reject-at-gate', to: 'rejected' },
  { from: 'submitted', event: 'expire-unacked', to: 'expired' },
  { from: 'submitted', event: 'ack-deadline-exceeded', to: 'stuck' },
  // acknowledged
  { from: 'acknowledged', event: 'partial-fill', to: 'partially_filled' },
  { from: 'acknowledged', event: 'fill-complete', to: 'filled' },
  { from: 'acknowledged', event: 'cancel-unfilled', to: 'cancelled' },
  { from: 'acknowledged', event: 'expire-unfilled', to: 'expired' },
  { from: 'acknowledged', event: 'fill-deadline-exceeded', to: 'stuck' },
  // partially_filled
  { from: 'partially_filled', event: 'fill-complete', to: 'filled' },
  { from: 'partially_filled', event: 'cancel-remaining', to: 'cancelled' },
  { from: 'partially_filled', event: 'expire-partial', to: 'expired' },
  // stuck (the recovery paths — an escalation is a record, life may continue)
  { from: 'stuck', event: 'late-acknowledge', to: 'acknowledged' },
  { from: 'stuck', event: 'late-partial-fill', to: 'partially_filled' },
  { from: 'stuck', event: 'late-fill-complete', to: 'filled' },
  { from: 'stuck', event: 'cancel-after-escalation', to: 'cancelled' },
  { from: 'stuck', event: 'late-reject', to: 'rejected' },
  { from: 'stuck', event: 'late-expire', to: 'expired' },
] as const);

/** The events that are FILL events (they require fill evidence — never fabricated). */
export const FILL_EVENTS: readonly OrderLifecycleEvent[] = [
  'partial-fill',
  'fill-complete',
  'late-partial-fill',
  'late-fill-complete',
] as const;

/** Guard: a fill event. */
export const isFillEvent = (v: unknown): v is OrderLifecycleEvent => isMemberOf(FILL_EVENTS, v);

/** The events that are CANCEL events (they require a gateway confirmation ref — never fabricated). */
export const CANCEL_EVENTS: readonly OrderLifecycleEvent[] = [
  'cancel-before-submit',
  'cancel-unfilled',
  'cancel-remaining',
  'cancel-after-escalation',
] as const;

/** Guard: a cancel event. */
export const isCancelEvent = (v: unknown): v is OrderLifecycleEvent => isMemberOf(CANCEL_EVENTS, v);

/** The events that enter the STUCK state (they require an escalation ref — never a silent timeout). */
export const STUCK_EVENTS: readonly OrderLifecycleEvent[] = [
  'ack-deadline-exceeded',
  'fill-deadline-exceeded',
] as const;

/** Guard: a stuck-entering event. */
export const isStuckEvent = (v: unknown): v is OrderLifecycleEvent => isMemberOf(STUCK_EVENTS, v);

/** The genesis event. */
export const GENESIS_EVENT: OrderLifecycleEvent = 'prepare';

/**
 * Looks up the declared transition for a (from, event) pair.
 * `null` when the pair is UNDEFINED — the caller reports the typed
 * `lifecycle_violation` (an undefined transition).
 */
export function transitionFor(from: OrderState | null, event: OrderLifecycleEvent): OrderTransition | null {
  for (const transition of ORDER_LIFECYCLE_TRANSITIONS) {
    if (transition.from === from && transition.event === event) return transition;
  }
  return null;
}

/** The declared transitions leaving `state` (the enumerable adjacency). */
export function transitionsFrom(state: OrderState | null): readonly OrderTransition[] {
  return ORDER_LIFECYCLE_TRANSITIONS.filter((transition) => transition.from === state);
}

/** `true` iff (from, to) is a declared edge of the state machine. */
export function isLegalEdge(from: OrderState | null, to: OrderState): boolean {
  return ORDER_LIFECYCLE_TRANSITIONS.some((transition) => transition.from === from && transition.to === to);
}

// ---------------------------------------------------------------------------
// Fill evidence (exact-decimal accounting — never fabricated)
// ---------------------------------------------------------------------------

/**
 * ONE fill's evidence on a lifecycle record: the `xsf-`-referenced fill
 * identity and its EXACT-DECIMAL quantity (a canonical positive decimal
 * string — float mediation is the typed `decimal_imprecision`).
 */
export interface FillEvidence {
  /** The fill's identity ('xsf-'-prefixed — the simulated-fill / venue-fill ref space). */
  readonly fillRef: string;
  /** The fill's quantity (canonical positive decimal string — exact, never a float). */
  readonly quantity: string;
  /** The fill's ORDER-LEVEL instant (the L16 clock marker of the fill event). */
  readonly orderClock: TimestampMs;
}

/** Guard: `FillEvidence`. */
export function isFillEvidence(v: unknown): v is FillEvidence {
  if (!isRecord(v)) return false;
  if (!isFillRef(v.fillRef)) return false;
  if (!isCanonicalPositiveDecimal(v.quantity)) return false;
  if (!isTimestampMs(v.orderClock)) return false;
  return true;
}

/** COLLECT-ALL validation of fill evidence (the exact-decimal law included). */
export function validateFillEvidenceRecord(v: unknown, path = ''): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(v)) return [invalidType(path || 'fill', 'a fill evidence record')];
  if (!isFillRef(v.fillRef)) errors.push(invalidField(`${path}fillRef`, 'must be an \'xsf-\'-prefixed fill identity'));
  errors.push(...quantityProblems(`${path}quantity`, v.quantity));
  if (v.quantity !== undefined && typeof v.quantity === 'string' && isCanonicalPositiveDecimal(v.quantity) === false && /^\d+(?:\.\d+)?$/.test(v.quantity)) {
    // a decimal string that is well-formed but not strictly positive
    errors.push(invalidField(`${path}quantity`, 'a fill quantity is strictly positive'));
  }
  if (!isTimestampMs(v.orderClock)) errors.push(invalidField(`${path}orderClock`, 'must be a valid epoch-millisecond order-level instant'));
  return errors;
}

// ---------------------------------------------------------------------------
// The lifecycle record
// ---------------------------------------------------------------------------

/**
 * ONE ORDER-LIFECYCLE RECORD: the order entered state `to` via event
 * `event` from state `from` at ORDER-LEVEL instant `orderClock`.
 *
 * Every record carries (the Work Order's law): the decision ref (the
 * gateway's APPROVE verdict — the authority), the order refs (the
 * order identity + the venue/instrument/side/kind/quantity static
 * shape), explicit timestamps (the order-level clock marker AND the
 * cited decision's strategic instant — DISTINCT fields), tenant/project
 * (L12), the method citation (the declared order-management procedure),
 * the event evidence (fills / cancel confirmation / escalation ref),
 * and the chain head (the append-only tamper-evidence).
 */
export interface OrderLifecycleRecord {
  /** Derived identity: `ol-` + 16-hex digest of (chainHead + canonical content). */
  readonly lifecycleId: OrderLifecycleId;
  /** 1-based position in the lifecycle log (contiguous — append-only). */
  readonly sequence: number;
  /** The gateway's APPROVE decision ref ('xd:'-prefixed) — THE AUTHORITY. */
  readonly decisionRef: DecisionRef;
  /** The gated strategy intent ref ('si:'-prefixed). */
  readonly intentRef: string;
  /** The T024 director decision ref ('dd'-prefixed, opaque) — L15 lineage continuity; null when unattributed. */
  readonly directorDecisionRef: DirectorDecisionRef | null;
  /** The order identity (the clientOrderId space — idempotent per intent). */
  readonly orderRef: OrderRef;
  /** The venue of the order. */
  readonly venue: string;
  /** The instrument of the order. */
  readonly instrument: string;
  /** The side of the order. */
  readonly side: 'buy' | 'sell';
  /** The order kind (core or registered extension). */
  readonly orderKind: string;
  /** The order's TOTAL quantity (canonical positive decimal — exact, never a float). */
  readonly quantity: string;
  /** The source state (`null` = the genesis record). */
  readonly from: OrderState | null;
  /** The target state. */
  readonly to: OrderState;
  /** The declared event driving the transition. */
  readonly event: OrderLifecycleEvent;
  /** THE L16 CLOCK MARKER: the order-level event instant. DISTINCT from `decisionAsOf`. */
  readonly orderClock: TimestampMs;
  /** The cited decision's strategic instant (lineage — the L4/L16 boundary reference). NEVER reused as order-level time. */
  readonly decisionAsOf: TimestampMs;
  /** The fill evidence of a fill event (empty unless the event is a fill event). */
  readonly fills: readonly FillEvidence[];
  /** The gateway's cancel confirmation ref (required iff the event is a cancel event). */
  readonly cancelConfirmationRef: CancelConfirmationRef | null;
  /** The bound escalation record's id (required iff `to` is 'stuck'). */
  readonly escalationRef: EscalationRecordId | null;
  /** The declared method citation: method id. */
  readonly methodId: MethodId;
  /** The declared method citation: strict X.Y.Z version. */
  readonly methodVersion: MethodVersionRef;
  /** Tenant scope (L12). */
  readonly tenant: TenantId;
  /** Project scope (L12/L15). */
  readonly project: ProjectId;
  /** The chain head binding this record to everything before it: `fnv(prev + canonical(content))`. */
  readonly chainHead: string;
}

// -- record content + derivations (the L9 discipline) ------------------------

/** The canonical JSON tree of a record's CONTENT (everything except `lifecycleId` and `chainHead`). */
export function lifecycleContentTree(record: Omit<OrderLifecycleRecord, 'lifecycleId' | 'chainHead'>): JsonValue {
  return {
    sequence: record.sequence,
    decisionRef: record.decisionRef,
    intentRef: record.intentRef,
    directorDecisionRef: record.directorDecisionRef,
    orderRef: record.orderRef,
    venue: record.venue,
    instrument: record.instrument,
    side: record.side,
    orderKind: record.orderKind,
    quantity: record.quantity,
    from: record.from,
    to: record.to,
    event: record.event,
    orderClock: record.orderClock,
    decisionAsOf: record.decisionAsOf,
    fills: record.fills.map((fill) => ({ fillRef: fill.fillRef, quantity: fill.quantity, orderClock: fill.orderClock })),
    cancelConfirmationRef: record.cancelConfirmationRef,
    escalationRef: record.escalationRef,
    methodId: record.methodId,
    methodVersion: record.methodVersion,
    tenant: record.tenant,
    project: record.project,
  };
}

/** The expected chain head of a record: `fnv(prevHead + canonical(content))` (the T019 discipline, mirrored). */
export function expectedChainHead(
  previousHead: string,
  record: Omit<OrderLifecycleRecord, 'lifecycleId' | 'chainHead'>,
): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson(lifecycleContentTree(record))}`);
}

/** The expected lifecycle id of a record: `ol-` + 16-hex digest over (chainHead + canonical content). */
export function expectedLifecycleId(record: OrderLifecycleRecord): OrderLifecycleId {
  return `ol-${stableDigestJson({ chainHead: record.chainHead, content: lifecycleContentTree(record) } as never)}` as OrderLifecycleId;
}

/** The canonical JSON serialization of a whole record (byte-deterministic, L9). */
export function canonicalLifecycleJson(record: OrderLifecycleRecord): string {
  return canonicalJson({ ...(record as unknown as Record<string, unknown>) } as unknown as JsonValue);
}

// -- record validation (COLLECT-ALL — every law, every violation) ------------

/**
 * COLLECT-ALL validation of one lifecycle record against the full law
 * set: structure, the L16 clock laws, the exact-decimal laws, the
 * evidence laws (never fabricate), and the derived-identity laws.
 * (Log-level laws — sequence contiguity, chain linkage, state
 * continuity — live in `validateOrderLifecycleLog`.)
 */
export function validateOrderLifecycleRecord(v: unknown, path = ''): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(v)) {
    return [invalidType(path || 'record', 'an order lifecycle record')];
  }

  // THE CLOCK-CONFUSION LAW (a): a lifecycle record carrying a strategic-time `asOf` field.
  if ('asOf' in v) {
    errors.push({
      code: 'clock_confusion',
      path: `${path}asOf`,
      message: 'the record carries an `asOf` field — the strategic lane\'s time-stamp name in an order-lifecycle position. Lifecycle records are stamped with ORDER-LEVEL time (`orderClock`), never strategic time (L16: strategic and order-level control have distinct clocks)',
    });
  }

  if (!isOrderLifecycleId(v.lifecycleId) || typeof v.lifecycleId !== 'string' || !v.lifecycleId.startsWith('ol-')) {
    errors.push(invalidField(`${path}lifecycleId`, 'must be a derived `ol-<digest>` identity'));
  }
  if (!isPositiveSafeInteger(v.sequence)) {
    errors.push(invalidField(`${path}sequence`, 'must be a safe integer >= 1 (the 1-based contiguous position)'));
  }
  if (!isDecisionRef(v.decisionRef)) {
    errors.push(invalidField(`${path}decisionRef`, 'must be the gateway\'s APPROVE decision ref (\'xd:\'-prefixed) — the authority'));
  }
  if (!isNonEmptyString(v.intentRef)) {
    errors.push(invalidField(`${path}intentRef`, 'must be the gated intent ref (\'si:\'-prefixed)'));
  }
  if (v.directorDecisionRef !== null && !isDirectorDecisionRef(v.directorDecisionRef)) {
    errors.push(invalidField(`${path}directorDecisionRef`, 'must be an opaque \'dd\'-prefixed director decision ref (L16: the body consumes decisions, never strategic reasoning)'));
  }
  if (!isOrderRef(v.orderRef)) {
    errors.push(invalidField(`${path}orderRef`, 'must be a compact order identity (the clientOrderId space)'));
  }
  if (!isNonEmptyString(v.venue)) errors.push(invalidField(`${path}venue`, 'must be a non-empty venue id'));
  if (!isNonEmptyString(v.instrument)) errors.push(invalidField(`${path}instrument`, 'must be a non-empty instrument id'));
  if (v.side !== 'buy' && v.side !== 'sell') errors.push(invalidField(`${path}side`, 'must be \'buy\' or \'sell\''));
  if (!isNonEmptyString(v.orderKind)) errors.push(invalidField(`${path}orderKind`, 'must be a non-empty order kind'));
  // THE EXACT-DECIMAL LAW: float mediation is the typed decimal_imprecision.
  errors.push(...quantityProblems(`${path}quantity`, v.quantity));
  if (typeof v.quantity === 'string' && /^\d+(?:\.\d+)?$/.test(v.quantity) && !isCanonicalPositiveDecimal(v.quantity)) {
    errors.push(invalidField(`${path}quantity`, 'the order quantity is strictly positive'));
  }
  if (v.from !== null && !isOrderState(v.from)) {
    errors.push({ code: 'unknown_order_state', path: `${path}from`, message: `the source state ${JSON.stringify(v.from)} is outside the declared order-state vocabulary` });
  }
  if (!isOrderState(v.to)) {
    errors.push({ code: 'unknown_order_state', path: `${path}to`, message: `the target state ${JSON.stringify(v.to)} is outside the declared order-state vocabulary` });
  }
  if (!isOrderLifecycleEvent(v.event)) {
    errors.push({ code: 'unknown_lifecycle_event', path: `${path}event`, message: `the event ${JSON.stringify(v.event)} is outside the declared lifecycle-event vocabulary` });
  }
  if (!isTimestampMs(v.orderClock)) {
    errors.push(invalidField(`${path}orderClock`, 'must be a valid epoch-millisecond ORDER-LEVEL instant (the L16 clock marker)'));
  }
  if (!isTimestampMs(v.decisionAsOf)) {
    errors.push(invalidField(`${path}decisionAsOf`, 'must be a valid epoch-millisecond decision instant (the lineage reference)'));
  }
  if (!Array.isArray(v.fills)) {
    errors.push(invalidType(`${path}fills`, 'an array of fill evidence records'));
  } else {
    (v.fills as readonly unknown[]).forEach((fill, index) => {
      errors.push(...validateFillEvidenceRecord(fill, `${path}fills[${index}].`));
    });
  }
  if (v.cancelConfirmationRef !== null && !isCancelConfirmationRef(v.cancelConfirmationRef)) {
    errors.push(invalidField(`${path}cancelConfirmationRef`, 'must be a \'confirm:\'-prefixed gateway confirmation ref'));
  }
  if (v.escalationRef !== null && !isEscalationRecordId(v.escalationRef)) {
    errors.push(invalidField(`${path}escalationRef`, 'must be a derived `esc-<digest>` escalation record id'));
  }
  if (!isMethodId(v.methodId)) errors.push(invalidField(`${path}methodId`, 'must be a non-empty method reference'));
  if (!isMethodVersionRef(v.methodVersion)) errors.push(invalidField(`${path}methodVersion`, 'must be a strict X.Y.Z version'));
  if (!isTenantId(v.tenant)) errors.push({ code: 'tenant_missing', path: `${path}tenant`, message: 'the record must carry a tenant scope (L12)' });
  if (!isProjectId(v.project)) errors.push({ code: 'project_missing', path: `${path}project`, message: 'the record must carry a project scope (L12/L15)' });
  if (!isChainHead(v.chainHead)) {
    errors.push(invalidField(`${path}chainHead`, 'must be an 8-hex chain head (the append-only tamper-evidence)'));
  }

  // The deep laws (only when the structural guards passed).
  const fromOk = v.from === null || isOrderState(v.from);
  const toOk = isOrderState(v.to);
  const eventOk = isOrderLifecycleEvent(v.event);
  const clockOk = isTimestampMs(v.orderClock);
  const decisionClockOk = isTimestampMs(v.decisionAsOf);

  if (fromOk && eventOk && toOk) {
    const declared = transitionFor(v.from as OrderState | null, v.event as OrderLifecycleEvent);
    if (declared === null) {
      errors.push({
        code: 'lifecycle_violation',
        path: `${path}event`,
        message: `the transition (from ${JSON.stringify(v.from)}, event ${JSON.stringify(v.event)}) is UNDEFINED in the declared state machine — an undefined transition is a typed lifecycle_violation, never a silent motion`,
      });
    } else if (declared.to !== v.to) {
      errors.push({
        code: 'lifecycle_violation',
        path: `${path}to`,
        message: `the event ${JSON.stringify(v.event)} from ${JSON.stringify(v.from)} declared target is ${JSON.stringify(declared.to)}, not ${JSON.stringify(v.to)}`,
      });
    }
    if (v.from !== null && isTerminalOrderState(v.from)) {
      errors.push({
        code: 'lifecycle_violation',
        path: `${path}from`,
        message: `the source state ${JSON.stringify(v.from)} is TERMINAL — every transition out of a terminal state is a lifecycle_violation (replay protection)`,
      });
    }
    if (v.from === null && v.sequence !== 1) {
      errors.push(invalidField(`${path}sequence`, 'the genesis record (from null) is sequence 1'));
    }
  }

  // THE L16 CLOCK LAWS (the existential separation).
  if (clockOk && decisionClockOk) {
    if ((v.orderClock as number) === (v.decisionAsOf as number)) {
      errors.push({
        code: 'clock_confusion',
        path: `${path}orderClock`,
        message: `the order-level clock marker (${JSON.stringify(v.orderClock)}) EQUALS the cited decision's strategic instant (${JSON.stringify(v.decisionAsOf)}) — the order-level clock is a DIFFERENT clock; a lifecycle record stamped with strategic time is a typed clock_confusion (L16)`,
      });
    }
    if ((v.orderClock as number) < (v.decisionAsOf as number)) {
      errors.push({
        code: 'timestamp_order',
        path: `${path}orderClock`,
        message: `the order-level instant ${JSON.stringify(v.orderClock)} precedes the decision instant ${JSON.stringify(v.decisionAsOf)} — the order-level clock starts at or after the strategic decision that authorized it (L16 causality)`,
      });
    }
  }

  // THE EVIDENCE LAWS (never fabricate).
  if (eventOk) {
    const event = v.event as OrderLifecycleEvent;
    const fills = Array.isArray(v.fills) ? (v.fills as readonly unknown[]) : [];
    if (isFillEvent(event) && fills.length === 0) {
      errors.push({
        code: 'fill_fabricated',
        path: `${path}fills`,
        message: `the fill event ${JSON.stringify(event)} carries NO fill evidence — a fill without its fill records is fabricated (never fabricate a fill)`,
      });
    }
    if (!isFillEvent(event) && fills.length > 0) {
      errors.push(invalidField(`${path}fills`, `the event ${JSON.stringify(event)} is not a fill event — fill evidence rides only on fill events`));
    }
    if (isCancelEvent(event) && !isCancelConfirmationRef(v.cancelConfirmationRef)) {
      errors.push({
        code: 'cancel_fabricated',
        path: `${path}cancelConfirmationRef`,
        message: `the cancel event ${JSON.stringify(event)} carries no gateway confirmation ref — a cancel without its confirmation is fabricated (never fabricate a cancel)`,
      });
    }
    if (!isCancelEvent(event) && v.cancelConfirmationRef !== null) {
      errors.push(invalidField(`${path}cancelConfirmationRef`, `the event ${JSON.stringify(event)} is not a cancel event — confirmation refs ride only on cancel events`));
    }
    if (isStuckEvent(event)) {
      if (!isEscalationRecordId(v.escalationRef)) {
        errors.push({
          code: 'escalation_missing',
          path: `${path}escalationRef`,
          message: `the stuck-entering event ${JSON.stringify(event)} carries no escalation record ref — a stuck order without its escalation is a silent timeout (an EscalationRecord, always)`,
        });
      }
      if (toOk && v.to !== 'stuck') {
        errors.push(invalidField(`${path}to`, 'a stuck-entering event targets the stuck state'));
      }
    }
    if (!isStuckEvent(event) && v.escalationRef !== null) {
      errors.push(invalidField(`${path}escalationRef`, `the event ${JSON.stringify(event)} is not a stuck-entering event — escalation refs ride only on stuck entries`));
    }
  }

  // The derived-identity laws.
  if (isChainHead(v.chainHead) && isPositiveSafeInteger(v.sequence) && isDecisionRef(v.decisionRef) && clockOk && decisionClockOk && toOk && eventOk && fromOk) {
    const candidate = v as unknown as OrderLifecycleRecord;
    if (expectedLifecycleId(candidate) !== v.lifecycleId) {
      errors.push({
        code: 'digest_mismatch',
        path: `${path}lifecycleId`,
        message: 'the derived lifecycle id does not bind the record content (L9 — content-addressed identity)',
      });
    }
  }
  return errors;
}

/** Guard: `OrderLifecycleRecord` (structure + the record-level laws). */
export function isOrderLifecycleRecord(v: unknown): v is OrderLifecycleRecord {
  return validateOrderLifecycleRecord(v).length === 0;
}

// ---------------------------------------------------------------------------
// The lifecycle log (append-only, chain-verified)
// ---------------------------------------------------------------------------

/**
 * THE ORDER-LIFECYCLE LOG: the append-only, chain-verified trail of one
 * order's lifecycle. The FIRST record is the genesis prepare; the
 * CURRENT state is the LAST record's `to`. There is no removal, update
 * or reordering entry point anywhere in this module.
 */
export interface OrderLifecycleLog {
  /** The log's identity: the order ref of the lifecycle it records. */
  readonly orderRef: OrderRef;
  readonly records: readonly OrderLifecycleRecord[];
}

/** The genesis chain seed (mirrors T019's 'ksw-genesis' discipline). */
export const LIFECYCLE_CHAIN_SEED = 'ol-genesis';

/** The current state of a lifecycle log (the LAST record's target). */
export function currentOrderState(log: OrderLifecycleLog): OrderState {
  const last = log.records[log.records.length - 1];
  return (last as OrderLifecycleRecord).to;
}

/** The current chain head (the LAST record's head — the next record's fold input). */
export function currentChainHead(log: OrderLifecycleLog): string {
  const last = log.records[log.records.length - 1];
  return (last as OrderLifecycleRecord).chainHead;
}

/** The cumulative fill evidence across a whole log (reconciliation's input). */
export function cumulativeFills(log: OrderLifecycleLog): readonly FillEvidence[] {
  const fills: FillEvidence[] = [];
  for (const record of log.records) {
    for (const fill of record.fills) fills.push(fill);
  }
  return fills;
}

/** The genesis record (sequence 1, from null) — `null` when the log is empty. */
export function genesisRecord(log: OrderLifecycleLog): OrderLifecycleRecord | null {
  const first = log.records[0];
  return first === undefined ? null : (first as OrderLifecycleRecord);
}

/**
 * COLLECT-ALL validation of a whole lifecycle log: every record's own
 * laws PLUS the log-level laws — sequence contiguity
 * (`lifecycle_sequence`), chain linkage (`lifecycle_chain` — the
 * rewrite trip wire), state continuity (`lifecycle_violation` — each
 * record's `from` must be its predecessor's `to`), clock monotonicity
 * within the log (`timestamp_order` — the order-level clock never runs
 * backwards), the genesis law, and the cumulative-quantity cap
 * (`quantity_mismatch` — cumulative fills never exceed the order
 * quantity).
 */
export function validateOrderLifecycleLog(v: unknown, path = ''): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(v) || !Array.isArray(v.records) || (Array.isArray(v.records) && (v.records as readonly unknown[]).length === 0)) {
    return [invalidType(path || 'log', 'an order lifecycle log with a non-empty records array')];
  }
  if (!isOrderRef(v.orderRef)) {
    errors.push(invalidField(`${path}orderRef`, 'must be a compact order identity'));
  }
  const records = v.records as readonly unknown[];
  let previous: OrderLifecycleRecord | null = null;
  let expectedSequence = 1;
  let previousHead = LIFECYCLE_CHAIN_SEED;
  const orderQuantity = isRecord(records[0]) ? (records[0] as Record<string, unknown>).quantity : undefined;
  let cumulativeFillQuantity: bigint | null = null;
  const recordErrors: (readonly ExecutionBodyError[])[] = [];

  records.forEach((record: unknown, index: number) => {
    const recordPath = `${path}records[${index}].`;
    const errorsForRecord = validateOrderLifecycleRecord(record, recordPath);
    recordErrors.push(errorsForRecord);

    // THE SEQUENCE LAW runs on the RAW field (a tampered sequence breaks
    // the record's own derived id/chain laws; the log-level contiguity
    // check must still report the gap itself).
    if (isRecord(record) && typeof record.sequence === 'number' && record.sequence !== expectedSequence) {
      errors.push({
        code: 'lifecycle_sequence',
        path: `${recordPath}sequence`,
        message: `expected sequence ${expectedSequence}, found ${record.sequence} — the log is append-only and contiguous`,
      });
    }

    if (!isOrderLifecycleRecord(record)) return; // structural failures skip the remaining log-level checks

    const current = record as OrderLifecycleRecord;

    // THE GENESIS LAW.
    if (index === 0 && (current.from !== null || current.event !== GENESIS_EVENT || current.to !== 'prepared')) {
      errors.push({
        code: 'lifecycle_violation',
        path: `${recordPath}event`,
        message: 'the log\'s first record is the GENESIS (from null, event "prepare", to "prepared")',
      });
    }
    if (index > 0 && current.from === null) {
      errors.push({
        code: 'lifecycle_violation',
        path: `${recordPath}from`,
        message: 'only the log\'s first record may be the genesis (from null)',
      });
    }

    // THE CHAIN LAW (the rewrite trip wire).
    if (current.chainHead !== expectedChainHead(previousHead, current)) {
      errors.push({
        code: 'lifecycle_chain',
        path: `${recordPath}chainHead`,
        message: `the record's chain head does not match fnv(prev + canonical(content)) — history was rewritten (the log is append-only)`,
      });
    }

    // THE STATE-CONTINUITY LAW.
    if (previous !== null && current.from !== previous.to) {
      errors.push({
        code: 'lifecycle_violation',
        path: `${recordPath}from`,
        message: `the record leaves state ${JSON.stringify(current.from)} but the log's current state is ${JSON.stringify(previous.to)} — transitions are continuous, never skipping`,
      });
    }

    // THE CLOCK-MONOTONICITY LAW (the order-level clock never runs backwards).
    if (previous !== null && current.orderClock < previous.orderClock) {
      errors.push({
        code: 'timestamp_order',
        path: `${recordPath}orderClock`,
        message: `the order-level clock ran backwards (${current.orderClock} after ${previous.orderClock}) — the L16 clock is monotone within a lifecycle`,
      });
    }

    // THE CUMULATIVE-QUANTITY CAP.
    if (typeof current.quantity === 'string' && current.quantity !== orderQuantity) {
      errors.push({
        code: 'quantity_mismatch',
        path: `${recordPath}quantity`,
        message: `the order quantity is fixed at ${JSON.stringify(orderQuantity)} across the whole lifecycle, record ${current.sequence} carries ${JSON.stringify(current.quantity)}`,
      });
    }
    for (const fill of current.fills) {
      if (typeof fill.quantity !== 'string') continue;
      const scaled = scaleOf(fill.quantity);
      if (scaled !== null) {
        if (cumulativeFillQuantity === null) cumulativeFillQuantity = 0n;
        cumulativeFillQuantity += scaled;
      }
    }
    previous = current;
    expectedSequence += 1;
    previousHead = current.chainHead;
  });

  // The structural record errors ride along (collect-all).
  for (const list of recordErrors) errors.push(...list);

  // THE OVERFILL LAW: cumulative fills never exceed the order quantity.
  if (cumulativeFillQuantity !== null && typeof orderQuantity === 'string') {
    const total = scaleOf(orderQuantity);
    if (total !== null && cumulativeFillQuantity > total) {
      errors.push({
        code: 'quantity_mismatch',
        path: `${path}records`,
        message: `the cumulative fill quantity exceeds the order quantity (exact-decimal accounting) — an overfill is a typed quantity_mismatch`,
      });
    }
  }
  return errors;
}

/** Guard: `OrderLifecycleLog`. */
export function isOrderLifecycleLog(v: unknown): v is OrderLifecycleLog {
  return validateOrderLifecycleLog(v).length === 0;
}

/** The validation wrapper: `OrderLifecycleLog`. */
export function validateOrderLifecycleLogRecord(v: unknown): ExecutionBodyValidation<OrderLifecycleLog> {
  const errors = validateOrderLifecycleLog(v);
  return validationOf(errors.length === 0 ? (v as OrderLifecycleLog) : null, errors);
}

/** Scales a canonical decimal string to a BigInt at scale 18 (the comparison basis). */
function scaleOf(value: string): bigint | null {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const dot = value.indexOf('.');
  const int = dot === -1 ? value : value.slice(0, dot);
  const frac = dot === -1 ? '' : value.slice(dot + 1);
  const padded = frac.padEnd(18, '0');
  return BigInt(`${int === '' ? '0' : int}${padded}`);
}

// ---------------------------------------------------------------------------
// The genesis: order preparation
// ---------------------------------------------------------------------------

/** The preparation input: the accepted intake bundle + the explicit order-level instant. */
export interface OrderPreparationInput {
  /** The gateway's APPROVE decision ref ('xd:'-prefixed) — THE AUTHORITY. */
  readonly decisionRef: string;
  /** The decision's strategic instant (lineage reference — never reused as order-level time). */
  readonly decisionAsOf: TimestampMs;
  /** The gated intent ref ('si:'-prefixed). */
  readonly intentRef: string;
  /** The T024 director decision ref ('dd'-prefixed, opaque) or null. */
  readonly directorDecision: string | null;
  /** The order identity (the intent's clientOrderId — idempotent). */
  readonly orderRef: string;
  /** The order's static shape (carried verbatim from the gated intent). */
  readonly venue: string;
  readonly instrument: string;
  readonly side: 'buy' | 'sell';
  readonly orderKind: string;
  /** The order's total quantity (canonical positive decimal — carried verbatim). */
  readonly quantity: string;
  /** THE L16 CLOCK MARKER: the preparation instant (order-level, distinct from decisionAsOf). */
  readonly orderClock: TimestampMs;
  /** The declared method citation. */
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/**
 * THE GENESIS: prepare an order lifecycle record from the approved
 * decision. Pure and deterministic — the derived identity and chain
 * head are content-addressed. Typed refusal (never a throw):
 *   - `decision_not_approved`: a refusal-shaped ref or non-`xd:` ref is
 *     never authority (the intake gate's law, re-checked here);
 *   - `clock_confusion`: orderClock === decisionAsOf (the strategic
 *     instant stamped into the order-level clock) — L16;
 *   - `timestamp_order`: orderClock < decisionAsOf (causality);
 *   - `decimal_imprecision` / `decimal_invalid`: float mediation or a
 *     malformed quantity;
 *   - the method citation must resolve against the registry
 *     (`undeclared_method` / `method_version_mismatch` /
 *     `method_kind_mismatch`).
 */
export function prepareOrder(
  input: unknown,
  registry: MethodRegistry,
): ExecutionBodyResult<OrderLifecycleLog> {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('preparation', 'an order preparation input record')] };
  }
  if (!isDecisionRef(input.decisionRef)) {
    errors.push({
      code: 'decision_not_approved',
      path: 'decisionRef',
      message: 'order preparation requires the gateway\'s APPROVE decision ref (\'xd:\'-prefixed) — a refusal or non-decision is never authority (L8)',
    });
  }
  if (!isTimestampMs(input.decisionAsOf)) {
    errors.push(invalidField('decisionAsOf', 'must be the decision instant (the lineage reference)'));
  }
  if (!isNonEmptyString(input.intentRef)) errors.push(invalidField('intentRef', 'must be the gated intent ref'));
  if (input.directorDecision !== null && !isDirectorDecisionRef(input.directorDecision)) {
    errors.push(invalidField('directorDecision', 'must be an opaque \'dd\'-prefixed director decision ref'));
  }
  if (!isOrderRef(input.orderRef)) errors.push(invalidField('orderRef', 'must be a compact order identity'));
  if (!isNonEmptyString(input.venue)) errors.push(invalidField('venue', 'must be a non-empty venue id'));
  if (!isNonEmptyString(input.instrument)) errors.push(invalidField('instrument', 'must be a non-empty instrument id'));
  if (input.side !== 'buy' && input.side !== 'sell') errors.push(invalidField('side', 'must be \'buy\' or \'sell\''));
  if (!isNonEmptyString(input.orderKind)) errors.push(invalidField('orderKind', 'must be a non-empty order kind'));
  errors.push(...quantityProblems('quantity', input.quantity));
  if (typeof input.quantity === 'string' && /^\d+(?:\.\d+)?$/.test(input.quantity) && !isCanonicalPositiveDecimal(input.quantity)) {
    errors.push(invalidField('quantity', 'the order quantity is strictly positive'));
  }
  if (!isTimestampMs(input.orderClock)) {
    errors.push(invalidField('orderClock', 'must be a valid epoch-millisecond ORDER-LEVEL instant (the L16 clock marker)'));
  }
  if (!isTenantId(input.tenant)) errors.push({ code: 'tenant_missing', path: 'tenant', message: 'the lifecycle requires a tenant scope (L12)' });
  if (!isProjectId(input.project)) errors.push({ code: 'project_missing', path: 'project', message: 'the lifecycle requires a project scope (L12/L15)' });

  // THE L16 CLOCK LAWS at preparation.
  if (isTimestampMs(input.orderClock) && isTimestampMs(input.decisionAsOf)) {
    if ((input.orderClock as number) === (input.decisionAsOf as number)) {
      errors.push({
        code: 'clock_confusion',
        path: 'orderClock',
        message: `the preparation instant (${JSON.stringify(input.orderClock)}) EQUALS the decision's strategic instant — the order-level clock is a DIFFERENT clock (L16)`,
      });
    }
    if ((input.orderClock as number) < (input.decisionAsOf as number)) {
      errors.push({
        code: 'timestamp_order',
        path: 'orderClock',
        message: `the preparation instant (${JSON.stringify(input.orderClock)}) precedes the decision instant (${JSON.stringify(input.decisionAsOf)}) — the order-level clock starts at or after the strategic decision`,
      });
    }
  }

  // The method citation.
  errors.push(...resolveMethodCitation(registry, input.methodId, input.methodVersion, 'order-preparation'));

  if (errors.length > 0) return { ok: false, errors };

  const content: Omit<OrderLifecycleRecord, 'lifecycleId' | 'chainHead'> = {
    sequence: 1,
    decisionRef: input.decisionRef as DecisionRef,
    intentRef: input.intentRef as string,
    directorDecisionRef: input.directorDecision as DirectorDecisionRef | null,
    orderRef: input.orderRef as OrderRef,
    venue: input.venue as string,
    instrument: input.instrument as string,
    side: input.side as 'buy' | 'sell',
    orderKind: input.orderKind as string,
    quantity: input.quantity as string,
    from: null,
    to: 'prepared',
    event: 'prepare',
    orderClock: input.orderClock as TimestampMs,
    decisionAsOf: input.decisionAsOf as TimestampMs,
    fills: [],
    cancelConfirmationRef: null,
    escalationRef: null,
    methodId: input.methodId as MethodId,
    methodVersion: input.methodVersion as MethodVersionRef,
    tenant: input.tenant as TenantId,
    project: input.project as ProjectId,
  };
  const chainHead = expectedChainHead(LIFECYCLE_CHAIN_SEED, content);
  const record: OrderLifecycleRecord = deepFreeze({
    ...content,
    chainHead,
    lifecycleId: `ol-${stableDigestJson({ chainHead, content: lifecycleContentTree(content) } as never)}`,
  }) as OrderLifecycleRecord;
  return { ok: true, value: deepFreeze({ orderRef: input.orderRef as OrderRef, records: [record] }) };
}

// ---------------------------------------------------------------------------
// The append: lifecycle events
// ---------------------------------------------------------------------------

/** The event-application input: everything except the derived fields. */
export interface LifecycleEventDraft {
  /** The declared event to apply. */
  readonly event: OrderLifecycleEvent;
  /** THE L16 CLOCK MARKER: the event's order-level instant. */
  readonly orderClock: TimestampMs;
  /** The fill evidence (required iff a fill event). */
  readonly fills?: readonly FillEvidence[];
  /** The gateway's cancel confirmation ref (required iff a cancel event). */
  readonly cancelConfirmationRef?: string | null;
  /** The bound escalation record's id (required iff a stuck-entering event). */
  readonly escalationRef?: string | null;
  /** The method citation. */
  readonly methodId: string;
  readonly methodVersion: string;
  /** The injected kill-switch standing state — a THROWN switch fails submit closed. */
  readonly killSwitch?: { readonly state: 'standing' | 'thrown' } | null;
}

/**
 * APPENDS one lifecycle event to the log. Pure and deterministic: the
 * new record's `from` is the log's current state, the transition is
 * looked up in the DECLARED table (an undefined transition is the typed
 * `lifecycle_violation` — never a silent motion, never an exception),
 * the chain and sequence are derived, and the evidence laws are
 * enforced (`fill_fabricated` / `cancel_fabricated` /
 * `escalation_missing`). A THROWN standing kill switch refuses a
 * `submit` event with `killswitch_thrown` (fail-closed — the gate's
 * law honored).
 */
export function appendOrderLifecycleEvent(
  log: unknown,
  draft: unknown,
  registry: MethodRegistry,
): ExecutionBodyResult<OrderLifecycleLog> {
  const errors: ExecutionBodyError[] = [];

  // The log must be a valid lifecycle.
  const logErrors = validateOrderLifecycleLog(log);
  if (logErrors.length > 0) return { ok: false, errors: logErrors };
  const validLog = log as OrderLifecycleLog;

  if (!isRecord(draft)) {
    return { ok: false, errors: [invalidType('event', 'a lifecycle event draft record')] };
  }
  const event = draft.event;
  if (!isOrderLifecycleEvent(event)) {
    return {
      ok: false,
      errors: [
        {
          code: 'unknown_lifecycle_event',
          path: 'event',
          message: `the event ${JSON.stringify(event)} is outside the declared lifecycle-event vocabulary`,
        },
      ],
    };
  }
  if (!isTimestampMs(draft.orderClock)) {
    errors.push(invalidField('orderClock', 'must be a valid epoch-millisecond ORDER-LEVEL instant (the L16 clock marker)'));
  }
  const fills = Array.isArray(draft.fills) ? draft.fills : [];
  if (!Array.isArray(draft.fills) && draft.fills !== undefined) {
    errors.push(invalidType('fills', 'an array of fill evidence records'));
  }
  fills.forEach((fill: unknown, index: number) => {
    errors.push(...validateFillEvidenceRecord(fill, `fills[${index}].`));
  });
  if (draft.cancelConfirmationRef !== undefined && draft.cancelConfirmationRef !== null && !isCancelConfirmationRef(draft.cancelConfirmationRef)) {
    errors.push(invalidField('cancelConfirmationRef', 'must be a \'confirm:\'-prefixed gateway confirmation ref'));
  }
  if (draft.escalationRef !== undefined && draft.escalationRef !== null && !isEscalationRecordId(draft.escalationRef)) {
    errors.push(invalidField('escalationRef', 'must be a derived `esc-<digest>` escalation record id'));
  }
  if (draft.killSwitch !== undefined && draft.killSwitch !== null) {
    if (!isRecord(draft.killSwitch) || draft.killSwitch.state !== 'standing') {
      if (!isRecord(draft.killSwitch) || draft.killSwitch.state !== 'thrown') {
        errors.push(invalidField('killSwitch', 'must be the injected standing state { state: standing | thrown }'));
      }
    }
  }

  // The method citation (the expected kind tracks the event family).
  const expectedKind = expectedMethodKindOfEvent(event as OrderLifecycleEvent);
  errors.push(...resolveMethodCitation(registry, draft.methodId, draft.methodVersion, expectedKind));

  if (errors.length > 0) return { ok: false, errors };

  const from = currentOrderState(validLog);
  const declared = transitionFor(from, event as OrderLifecycleEvent);

  // THE LIFECYCLE LAW — an undefined transition is a typed violation.
  if (declared === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'lifecycle_violation',
          path: 'event',
          message: `the transition (from ${JSON.stringify(from)}, event ${JSON.stringify(event)}) is UNDEFINED in the declared state machine — an undefined transition is a typed lifecycle_violation, never a silent motion`,
        },
      ],
    };
  }
  // THE REPLAY LAW — no transition leaves a terminal state.
  if (isTerminalOrderState(from)) {
    return {
      ok: false,
      errors: [
        {
          code: 'lifecycle_violation',
          path: 'event',
          message: `the order is TERMINAL (${JSON.stringify(from)}) — every transition out of a terminal state is a lifecycle_violation (replay protection)`,
        },
      ],
    };
  }

  // THE KILL-SWITCH LAW — submissions under a thrown switch fail closed.
  const killSwitch = draft.killSwitch;
  if (event === 'submit' && isRecord(killSwitch) && killSwitch.state === 'thrown') {
    return {
      ok: false,
      errors: [
        {
          code: 'killswitch_thrown',
          path: 'killSwitch',
          message: 'the standing kill switch is thrown — submission fails closed (the gate\'s law honored; the switch is honored as injected fact, never re-derived here)',
        },
      ],
    };
  }

  // THE EVIDENCE LAWS (never fabricate).
  if (isFillEvent(event as OrderLifecycleEvent) && fills.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'fill_fabricated',
          path: 'fills',
          message: `the fill event ${JSON.stringify(event)} carries NO fill evidence — a fill without its fill records is fabricated`,
        },
      ],
    };
  }
  if (isCancelEvent(event as OrderLifecycleEvent) && !isCancelConfirmationRef(draft.cancelConfirmationRef)) {
    return {
      ok: false,
      errors: [
        {
          code: 'cancel_fabricated',
          path: 'cancelConfirmationRef',
          message: `the cancel event ${JSON.stringify(event)} carries no gateway confirmation ref — a cancel without its confirmation is fabricated`,
        },
      ],
    };
  }
  if (isStuckEvent(event as OrderLifecycleEvent) && !isEscalationRecordId(draft.escalationRef)) {
    return {
      ok: false,
      errors: [
        {
          code: 'escalation_missing',
          path: 'escalationRef',
          message: `the stuck-entering event ${JSON.stringify(event)} carries no escalation record ref — a stuck order without its escalation is a silent timeout (an EscalationRecord, always)`,
        },
      ],
    };
  }

  // THE EVIDENCE-PLACEMENT LAWS (evidence rides ONLY on its own event family).
  if (!isFillEvent(event as OrderLifecycleEvent) && fills.length > 0) {
    errors.push(invalidField('fills', `the event ${JSON.stringify(event)} is not a fill event — fill evidence rides only on fill events`));
  }
  if (!isCancelEvent(event as OrderLifecycleEvent) && draft.cancelConfirmationRef !== undefined && draft.cancelConfirmationRef !== null) {
    errors.push(invalidField('cancelConfirmationRef', `the event ${JSON.stringify(event)} is not a cancel event — confirmation refs ride only on cancel events`));
  }
  if (!isStuckEvent(event as OrderLifecycleEvent) && draft.escalationRef !== undefined && draft.escalationRef !== null) {
    errors.push(invalidField('escalationRef', `the event ${JSON.stringify(event)} is not a stuck-entering event — escalation refs ride only on stuck entries`));
  }
  if (errors.length > 0) return { ok: false, errors };

  // THE CLOCK LAWS — monotone within the log, distinct from the strategic instant.
  const last = validLog.records[validLog.records.length - 1] as OrderLifecycleRecord;
  const orderClock = draft.orderClock as TimestampMs;
  if (orderClock < last.orderClock) {
    errors.push({
      code: 'timestamp_order',
      path: 'orderClock',
      message: `the order-level clock ran backwards (${orderClock} after ${last.orderClock}) — the L16 clock is monotone within a lifecycle`,
    });
  }
  if (orderClock === last.decisionAsOf) {
    errors.push({
      code: 'clock_confusion',
      path: 'orderClock',
      message: `the event instant (${JSON.stringify(orderClock)}) EQUALS the cited decision's strategic instant — the order-level clock is a DIFFERENT clock (L16)`,
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  // THE CUMULATIVE-QUANTITY CAP (exact-decimal accounting).
  const quantity = last.quantity;
  const cumulative = [...cumulativeFills(validLog), ...(fills as readonly FillEvidence[])];
  const totalScaled = scaleOf(quantity);
  let cumulativeTotal = 0n;
  for (const fill of cumulative) {
    if (typeof fill.quantity !== 'string') continue;
    const scaled = scaleOf(fill.quantity);
    if (scaled !== null) cumulativeTotal += scaled;
  }
  if (totalScaled !== null && cumulativeTotal > totalScaled) {
    return {
      ok: false,
      errors: [
        {
          code: 'quantity_mismatch',
          path: 'fills',
          message: 'the cumulative fill quantity would exceed the order quantity (exact-decimal accounting) — an overfill is a typed quantity_mismatch',
        },
      ],
    };
  }

  const genesis = genesisRecord(validLog) as OrderLifecycleRecord;
  const content: Omit<OrderLifecycleRecord, 'lifecycleId' | 'chainHead'> = {
    sequence: validLog.records.length + 1,
    decisionRef: genesis.decisionRef,
    intentRef: genesis.intentRef,
    directorDecisionRef: genesis.directorDecisionRef,
    orderRef: genesis.orderRef,
    venue: genesis.venue,
    instrument: genesis.instrument,
    side: genesis.side,
    orderKind: genesis.orderKind,
    quantity: genesis.quantity,
    from,
    to: declared.to,
    event: event as OrderLifecycleEvent,
    orderClock,
    decisionAsOf: genesis.decisionAsOf,
    fills: deepFreeze([...(fills as readonly FillEvidence[])].map((fill) => deepFreeze({ ...fill }))),
    cancelConfirmationRef: (isCancelEvent(event as OrderLifecycleEvent)
      ? (draft.cancelConfirmationRef as CancelConfirmationRef)
      : null),
    escalationRef: (isStuckEvent(event as OrderLifecycleEvent)
      ? (draft.escalationRef as EscalationRecordId)
      : null),
    methodId: draft.methodId as MethodId,
    methodVersion: draft.methodVersion as MethodVersionRef,
    tenant: genesis.tenant,
    project: genesis.project,
  };
  const chainHead = expectedChainHead(currentChainHead(validLog), content);
  const record: OrderLifecycleRecord = deepFreeze({
    ...content,
    chainHead,
    lifecycleId: `ol-${stableDigestJson({ chainHead, content: lifecycleContentTree(content) } as never)}`,
  }) as OrderLifecycleRecord;
  return { ok: true, value: deepFreeze({ orderRef: validLog.orderRef, records: [...validLog.records, record] }) };
}

/** The method kind an event family expects (the citation discipline). */
function expectedMethodKindOfEvent(
  event: OrderLifecycleEvent,
): 'order-preparation' | 'stuck-order-detection' | 'fill-reconciliation' | 'cancellation-policy' | 'kill-switch-response' {
  if (event === 'prepare') return 'order-preparation';
  if (isStuckEvent(event)) return 'stuck-order-detection';
  if (isCancelEvent(event)) return 'cancellation-policy';
  // fill events and the remaining motions are monitored under the
  // reconciliation/stuck disciplines; submit/acknowledge/expiry carry
  // the order-preparation discipline (the request lifecycle's spine).
  if (isFillEvent(event)) return 'fill-reconciliation';
  return 'order-preparation';
}
