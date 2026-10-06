// @tradrl/example-e2e-trading — STRUCTURAL MIRRORS of @tradrl/body-execution's
// order state machine, lifecycle records and monitoring procedures (T025).
//
// D-003/D-004 law: this module imports NOTHING outside the example tree.
// The nine-state machine, the 21 transitions and the chain-head fold
// (`fnv(prevHead + canonical(content))`, seed 'ol-genesis') are mirrored
// byte-identically from the real package — the interop trip-wire tests
// assert the tables and the chain formula agree.

import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
  stableDigest,
  type JsonValue,
} from '../primitives';
import { decimalSubtract, decimalSum, compareDecimal, isCanonicalPositiveDecimal } from '../decimals';
import { mintOrderLifecycleId, type TenantId, type ProjectId } from '../ids';
import type { ApproveDecisionMirror, KillSwitchStandingStateMirror } from './authority';

// ---------------------------------------------------------------------------
// The order state machine (mirror of T025's lifecycle.ts)
// ---------------------------------------------------------------------------

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
export type OrderState = (typeof ORDER_STATES)[number];

export const TERMINAL_ORDER_STATES: readonly OrderState[] = ['filled', 'cancelled', 'rejected', 'expired'] as const;

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
export type OrderLifecycleEvent = (typeof ORDER_LIFECYCLE_EVENTS)[number];

export interface OrderTransition {
  readonly from: OrderState | null;
  readonly event: OrderLifecycleEvent;
  readonly to: OrderState;
}

export const ORDER_LIFECYCLE_TRANSITIONS: readonly OrderTransition[] = deepFreeze([
  { from: null, event: 'prepare', to: 'prepared' },
  { from: 'prepared', event: 'submit', to: 'submitted' },
  { from: 'prepared', event: 'cancel-before-submit', to: 'cancelled' },
  { from: 'submitted', event: 'acknowledge', to: 'acknowledged' },
  { from: 'submitted', event: 'reject-at-gate', to: 'rejected' },
  { from: 'submitted', event: 'expire-unacked', to: 'expired' },
  { from: 'submitted', event: 'ack-deadline-exceeded', to: 'stuck' },
  { from: 'acknowledged', event: 'partial-fill', to: 'partially_filled' },
  { from: 'acknowledged', event: 'fill-complete', to: 'filled' },
  { from: 'acknowledged', event: 'cancel-unfilled', to: 'cancelled' },
  { from: 'acknowledged', event: 'expire-unfilled', to: 'expired' },
  { from: 'acknowledged', event: 'fill-deadline-exceeded', to: 'stuck' },
  { from: 'partially_filled', event: 'fill-complete', to: 'filled' },
  { from: 'partially_filled', event: 'cancel-remaining', to: 'cancelled' },
  { from: 'partially_filled', event: 'expire-partial', to: 'expired' },
  { from: 'stuck', event: 'late-acknowledge', to: 'acknowledged' },
  { from: 'stuck', event: 'late-partial-fill', to: 'partially_filled' },
  { from: 'stuck', event: 'late-fill-complete', to: 'filled' },
  { from: 'stuck', event: 'cancel-after-escalation', to: 'cancelled' },
  { from: 'stuck', event: 'late-reject', to: 'rejected' },
  { from: 'stuck', event: 'late-expire', to: 'expired' },
] as const);

export const FILL_EVENTS: readonly OrderLifecycleEvent[] = [
  'partial-fill',
  'fill-complete',
  'late-partial-fill',
  'late-fill-complete',
] as const;

export const CANCEL_EVENTS: readonly OrderLifecycleEvent[] = [
  'cancel-before-submit',
  'cancel-unfilled',
  'cancel-remaining',
  'cancel-after-escalation',
] as const;

export const GENESIS_EVENT: OrderLifecycleEvent = 'prepare';

/** Looks up the transition for (state, event); null when undefined. */
export function transitionFor(from: OrderState | null, event: OrderLifecycleEvent): OrderTransition | null {
  return ORDER_LIFECYCLE_TRANSITIONS.find((t) => t.from === from && t.event === event) ?? null;
}

// ---------------------------------------------------------------------------
// Fill evidence + lifecycle records (mirror)
// ---------------------------------------------------------------------------

export interface FillEvidenceMirror {
  readonly fillRef: string; // 'xsf-'-prefixed
  readonly quantity: string;
  readonly orderClock: number; // THE L16 CLOCK MARKER of the fill event
}

export interface OrderLifecycleRecordMirror {
  readonly lifecycleId: string; // 'ol-' + 16-hex digest of {chainHead, content}
  readonly sequence: number;
  readonly decisionRef: string; // 'xd:'-prefixed — THE AUTHORITY
  readonly intentRef: string; // 'si:'-prefixed
  readonly directorDecisionRef: string | null; // 'dd'-prefixed, opaque (L15)
  readonly orderRef: string;
  readonly venue: string;
  readonly instrument: string;
  readonly side: 'buy' | 'sell';
  readonly orderKind: string;
  readonly quantity: string;
  readonly from: OrderState | null;
  readonly to: OrderState;
  readonly event: OrderLifecycleEvent;
  readonly orderClock: number; // L16 — DISTINCT from decisionAsOf
  readonly decisionAsOf: number;
  readonly fills: readonly FillEvidenceMirror[];
  readonly cancelConfirmationRef: string | null;
  readonly escalationRef: string | null;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly chainHead: string;
}

export interface OrderLifecycleLogMirror {
  readonly orderRef: string;
  readonly records: readonly OrderLifecycleRecordMirror[];
}

export const LIFECYCLE_CHAIN_SEED = 'ol-genesis';

/** The lifecycle content tree (everything except lifecycleId/chainHead). */
export function lifecycleContentTree(record: Omit<OrderLifecycleRecordMirror, 'lifecycleId' | 'chainHead'>): JsonValue {
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
    fills: record.fills.map((fill) => ({
      fillRef: fill.fillRef,
      quantity: fill.quantity,
      orderClock: fill.orderClock,
    })),
    cancelConfirmationRef: record.cancelConfirmationRef,
    escalationRef: record.escalationRef,
    methodId: record.methodId,
    methodVersion: record.methodVersion,
    tenant: record.tenant,
    project: record.project,
  };
}

/** THE CHAIN-HEAD FOLD: fnv(prevHead + canonical(content)) — mirrored. */
export function expectedChainHead(previousHead: string, record: Omit<OrderLifecycleRecordMirror, 'lifecycleId' | 'chainHead'>): string {
  return fnv1a32Hex(previousHead + canonicalJson(lifecycleContentTree(record)));
}

/** The lifecycle id: 'ol-' + 16-hex stableDigest of {chainHead, content}. */
export function expectedLifecycleId(record: OrderLifecycleRecordMirror): string {
  const { lifecycleId: _id, chainHead, ...content } = record;
  void _id;
  return `ol-${stableDigest(canonicalJson({ chainHead, content: lifecycleContentTree(content) } as unknown as JsonValue))}`;
}

// ---------------------------------------------------------------------------
// Typed lifecycle errors (mirror of T025's taxonomy)
// ---------------------------------------------------------------------------

export type LifecycleErrorCode =
  | 'decision_not_approved'
  | 'lifecycle_violation'
  | 'lifecycle_sequence'
  | 'lifecycle_chain'
  | 'clock_confusion'
  | 'timestamp_order'
  | 'fill_fabricated'
  | 'cancel_fabricated'
  | 'escalation_missing'
  | 'killswitch_thrown'
  | 'quantity_mismatch'
  | 'decimal_invalid'
  | 'decimal_imprecision'
  | 'lineage_missing';

export interface LifecycleError {
  readonly code: LifecycleErrorCode;
  readonly path: string;
  readonly message: string;
}

export type LifecycleResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly LifecycleError[] };

// ---------------------------------------------------------------------------
// The order-lane intake gate (mirror of T025's acceptExecutionIntake law)
// ---------------------------------------------------------------------------

/** The order-intake bundle (T019 decisions + T024 directive as OPAQUE ref). */
export interface ExecutionIntakeMirror {
  readonly decision: unknown;
  readonly intent: unknown;
  readonly killSwitch: unknown;
  readonly limitStates: readonly unknown[];
  readonly directorDecision: string | null;
}

/**
 * The intake gate: only an APPROVE decision ('xd:') is authority; a refusal
 * or a foreign record is the typed `decision_not_approved` (L8). L12 tenant
 * coherence; L16 clock law (prepareClock strictly after the decision's
 * strategic asOf).
 */
export function acceptExecutionIntakeMirror(
  intake: ExecutionIntakeMirror,
  scope: { readonly tenant: TenantId; readonly project: ProjectId },
  prepareClock: number,
): LifecycleResult<{
  readonly decision: ApproveDecisionMirror;
  readonly intent: {
    readonly intentId: string;
    readonly order: { readonly instrumentId: string; readonly venueId: string; readonly side: 'buy' | 'sell'; readonly kind: string; readonly quantity: string; readonly price?: string };
  };
  readonly killSwitch: KillSwitchStandingStateMirror;
  readonly directorDecision: string | null;
}> {
  const errors: LifecycleError[] = [];
  const decision = intake.decision;
  if (
    !isRecord(decision) ||
    decision.kind !== 'approve' ||
    !isNonEmptyString(decision.decisionId) ||
    !(decision.decisionId as string).startsWith('xd:')
  ) {
    errors.push({
      code: 'decision_not_approved',
      path: 'intake.decision',
      message: 'only a gate APPROVE decision (xd:) is order-preparation authority — L8',
    });
  } else {
    if (decision.tenant !== undefined && (decision as Record<string, never>).tenant !== scope.tenant) {
      // lineage tenant check below (lineage.tenant is authoritative)
    }
    const lineage = (decision as unknown as { lineage: Record<string, unknown> }).lineage;
    if (!isRecord(lineage) || lineage.tenant !== scope.tenant || lineage.project !== scope.project) {
      errors.push({
        code: 'lineage_missing',
        path: 'intake.decision.lineage',
        message: 'the decision lineage must match the execution scope (L12)',
      });
    }
    const asOf = (decision as unknown as { asOf: number }).asOf;
    if (!isTimestampMs(asOf) || prepareClock <= asOf) {
      errors.push({
        code: prepareClock === asOf ? 'clock_confusion' : 'timestamp_order',
        path: 'prepareClock',
        message: 'the order-level clock must run STRICTLY AFTER the strategic decision asOf (L16)',
      });
    }
  }
  const intent = intake.intent;
  if (
    !isRecord(intent) ||
    !isNonEmptyString(intent.intentId) ||
    !(intent.intentId as string).startsWith('si:') ||
    !isRecord(intent.order) ||
    !isNonEmptyString(intent.order.instrumentId)
  ) {
    errors.push({ code: 'lineage_missing', path: 'intake.intent', message: 'the gated strategy intent is malformed' });
  } else if (isRecord(decision) && (decision as unknown as { intentRef: string }).intentRef !== intent.intentId) {
    errors.push({
      code: 'lineage_missing',
      path: 'intake.intent.intentId',
      message: 'the decision must bind this intent (decision.intentRef === intent.intentId)',
    });
  }
  const killSwitch = intake.killSwitch;
  if (!isRecord(killSwitch) || (killSwitch.state !== 'standing' && killSwitch.state !== 'thrown')) {
    errors.push({ code: 'lineage_missing', path: 'intake.killSwitch', message: 'the standing kill-switch state is malformed' });
  }
  if (errors.length > 0) return { ok: false, errors: deepFreeze(errors) };
  const approve = decision as unknown as ApproveDecisionMirror;
  const intentRecord = intent as unknown as {
    readonly intentId: string;
    readonly order: { readonly instrumentId: string; readonly venueId: string; readonly side: 'buy' | 'sell'; readonly kind: string; readonly quantity: string; readonly price?: string };
  };
  return {
    ok: true,
    value: deepFreeze({
      decision: approve,
      intent: intentRecord,
      killSwitch: killSwitch as unknown as KillSwitchStandingStateMirror,
      directorDecision: intake.directorDecision,
    }),
  };
}

// ---------------------------------------------------------------------------
// Genesis + append (mirror of T025's prepareOrder/appendOrderLifecycleEvent)
// ---------------------------------------------------------------------------

export interface OrderPreparationInputMirror {
  readonly decisionRef: string; // 'xd:'
  readonly decisionAsOf: number;
  readonly intentRef: string; // 'si:'
  readonly directorDecision: string | null; // 'dd-'
  readonly orderRef: string;
  readonly venue: string;
  readonly instrument: string;
  readonly side: 'buy' | 'sell';
  readonly orderKind: string;
  readonly quantity: string;
  readonly orderClock: number;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Prepares an order (the genesis lifecycle record, chain-verified). */
export function prepareOrderMirror(input: OrderPreparationInputMirror): LifecycleResult<OrderLifecycleLogMirror> {
  const errors: LifecycleError[] = [];
  if (!input.decisionRef.startsWith('xd:')) {
    errors.push({ code: 'decision_not_approved', path: 'decisionRef', message: 'the genesis record requires an APPROVE decision ref (xd:)' });
  }
  if (input.orderClock === input.decisionAsOf) {
    errors.push({ code: 'clock_confusion', path: 'orderClock', message: 'the order-level clock must differ from the strategic asOf (L16)' });
  } else if (input.orderClock < input.decisionAsOf) {
    errors.push({ code: 'timestamp_order', path: 'orderClock', message: 'the order-level clock must run after the strategic asOf (L16)' });
  }
  if (!isCanonicalPositiveDecimal(input.quantity)) {
    errors.push(
      typeof input.quantity === 'number'
        ? { code: 'decimal_imprecision', path: 'quantity', message: 'a JS number never mediates a quantity' }
        : { code: 'decimal_invalid', path: 'quantity', message: 'the quantity must be a canonical positive decimal string' },
    );
  }
  if (errors.length > 0) return { ok: false, errors: deepFreeze(errors) };
  const content: Omit<OrderLifecycleRecordMirror, 'lifecycleId' | 'chainHead'> = {
    sequence: 1,
    decisionRef: input.decisionRef,
    intentRef: input.intentRef,
    directorDecisionRef: input.directorDecision,
    orderRef: input.orderRef,
    venue: input.venue,
    instrument: input.instrument,
    side: input.side,
    orderKind: input.orderKind,
    quantity: input.quantity,
    from: null,
    to: 'prepared',
    event: GENESIS_EVENT,
    orderClock: input.orderClock,
    decisionAsOf: input.decisionAsOf,
    fills: [],
    cancelConfirmationRef: null,
    escalationRef: null,
    methodId: input.methodId,
    methodVersion: input.methodVersion,
    tenant: input.tenant,
    project: input.project,
  };
  const chainHead = expectedChainHead(LIFECYCLE_CHAIN_SEED, content);
  const record: OrderLifecycleRecordMirror = deepFreeze({
    ...content,
    chainHead,
    lifecycleId: mintOrderLifecycleId(chainHead, lifecycleContentTree(content) as unknown as JsonValue),
  });
  return { ok: true, value: deepFreeze({ orderRef: input.orderRef, records: [record] }) };
}

export interface LifecycleEventDraftMirror {
  readonly event: OrderLifecycleEvent;
  readonly orderClock: number;
  readonly fills?: readonly FillEvidenceMirror[];
  readonly cancelConfirmationRef?: string | null;
  readonly escalationRef?: string | null;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly killSwitch?: { readonly state: 'standing' | 'thrown' } | null;
}

/** Appends a lifecycle event (transition law, evidence law, chain fold). */
export function appendOrderLifecycleEventMirror(
  log: OrderLifecycleLogMirror,
  draft: LifecycleEventDraftMirror,
): LifecycleResult<OrderLifecycleLogMirror> {
  const last = log.records[log.records.length - 1];
  if (last === undefined) {
    return { ok: false, errors: deepFreeze([{ code: 'lifecycle_violation', path: 'log', message: 'the log has no genesis record' }]) };
  }
  const errors: LifecycleError[] = [];
  const transition = transitionFor(last.to, draft.event);
  if (transition === null || TERMINAL_ORDER_STATES.includes(last.to)) {
    errors.push({
      code: 'lifecycle_violation',
      path: 'event',
      message: `event ${draft.event} is undefined from state ${last.to} (the typed lifecycle_violation)`,
    });
  }
  if (draft.event === 'submit' && draft.killSwitch !== undefined && draft.killSwitch !== null && draft.killSwitch.state === 'thrown') {
    errors.push({ code: 'killswitch_thrown', path: 'killSwitch', message: 'submission under a thrown kill switch fails closed' });
  }
  const isFillEvent = (FILL_EVENTS as readonly string[]).includes(draft.event);
  const fills = draft.fills ?? [];
  if (isFillEvent && fills.length === 0) {
    errors.push({ code: 'fill_fabricated', path: 'fills', message: 'a fill event requires fill evidence — a fabricated fill is prohibited' });
  }
  if (!isFillEvent && fills.length > 0) {
    errors.push({ code: 'fill_fabricated', path: 'fills', message: 'fill evidence is only legal on fill events' });
  }
  const isCancelEvent = (CANCEL_EVENTS as readonly string[]).includes(draft.event);
  const cancelRef = draft.cancelConfirmationRef ?? null;
  if (isCancelEvent && (cancelRef === null || !cancelRef.startsWith('confirm:'))) {
    errors.push({ code: 'cancel_fabricated', path: 'cancelConfirmationRef', message: 'a cancel event requires a confirm: evidence ref' });
  }
  if (!isCancelEvent && cancelRef !== null) {
    errors.push({ code: 'cancel_fabricated', path: 'cancelConfirmationRef', message: 'a cancel confirmation is only legal on cancel events' });
  }
  if (draft.orderClock <= last.orderClock) {
    errors.push({
      code: draft.orderClock === last.orderClock ? 'clock_confusion' : 'timestamp_order',
      path: 'orderClock',
      message: 'the order-level clock is monotone within a log (L16)',
    });
  }
  const cumulative = decimalSum(
    log.records.flatMap((record) => record.fills.map((fill) => fill.quantity)).concat(fills.map((fill) => fill.quantity)),
    8,
    'half-even',
  );
  if (compareDecimal(cumulative, last.quantity) > 0) {
    errors.push({ code: 'quantity_mismatch', path: 'fills', message: 'cumulative fills exceed the order quantity' });
  }
  if (errors.length > 0) return { ok: false, errors: deepFreeze(errors) };
  const content: Omit<OrderLifecycleRecordMirror, 'lifecycleId' | 'chainHead'> = {
    sequence: last.sequence + 1,
    decisionRef: last.decisionRef,
    intentRef: last.intentRef,
    directorDecisionRef: last.directorDecisionRef,
    orderRef: last.orderRef,
    venue: last.venue,
    instrument: last.instrument,
    side: last.side,
    orderKind: last.orderKind,
    quantity: last.quantity,
    from: last.to,
    to: (transition as OrderTransition).to,
    event: draft.event,
    orderClock: draft.orderClock,
    decisionAsOf: last.decisionAsOf,
    fills,
    cancelConfirmationRef: cancelRef,
    escalationRef: draft.escalationRef ?? null,
    methodId: draft.methodId,
    methodVersion: draft.methodVersion,
    tenant: last.tenant,
    project: last.project,
  };
  const chainHead = expectedChainHead(last.chainHead, content);
  const record: OrderLifecycleRecordMirror = deepFreeze({
    ...content,
    chainHead,
    lifecycleId: mintOrderLifecycleId(chainHead, lifecycleContentTree(content) as unknown as JsonValue),
  });
  return { ok: true, value: deepFreeze({ orderRef: log.orderRef, records: [...log.records, record] }) };
}

// ---------------------------------------------------------------------------
// Fill reconciliation (mirror of T025's reconcileFills — exact equality)
// ---------------------------------------------------------------------------

export const RECONCILIATION_STATUSES = ['reconciled', 'gap'] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export interface ReconciliationRecordMirror {
  readonly reconciliationId: string; // 'rcn-' + 16-hex
  readonly orderRef: string;
  readonly decisionRef: string;
  readonly acknowledgedQuantity: string;
  readonly cumulativeFillQuantity: string;
  readonly gap: string | null;
  readonly status: ReconciliationStatus;
  readonly fills: readonly FillEvidenceMirror[];
  readonly orderClock: number;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Exact-equality fill reconciliation (one grid-step mismatch is a typed gap). */
export function reconcileFillsMirror(log: OrderLifecycleLogMirror, orderClock: number, methodId: string, methodVersion: string): {
  readonly record: ReconciliationRecordMirror;
  readonly violations: readonly LifecycleError[];
} {
  const last = log.records[log.records.length - 1] as OrderLifecycleRecordMirror;
  const fills = log.records.flatMap((record) => [...record.fills]);
  const cumulative = decimalSum(
    fills.map((fill) => fill.quantity),
    8,
    'half-even',
  );
  const difference = decimalSubtract(last.quantity, cumulative, 8, 'half-even');
  const gap = compareDecimal(difference, '0') === 0 ? null : difference.replace('-', '');
  const content = {
    orderRef: log.orderRef,
    decisionRef: last.decisionRef,
    acknowledgedQuantity: last.quantity,
    cumulativeFillQuantity: cumulative,
    gap,
    status: (gap === null ? 'reconciled' : 'gap') as ReconciliationStatus,
    fills,
    orderClock,
    methodId,
    methodVersion,
    tenant: last.tenant,
    project: last.project,
  };
  const record: ReconciliationRecordMirror = deepFreeze({
    ...content,
    reconciliationId: `rcn-${stableDigest(canonicalJson(content as unknown as JsonValue))}`,
  });
  const violations =
    gap === null
      ? []
      : deepFreeze([
          {
            code: 'quantity_mismatch' as LifecycleErrorCode,
            path: 'gap',
            message: `reconciliation gap ${gap} between acknowledged and filled quantities`,
          },
        ]);
  return { record, violations };
}

/** Guard: an order lifecycle record. */
export function isOrderLifecycleRecordMirror(v: unknown): v is OrderLifecycleRecordMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.lifecycleId) &&
    (v.lifecycleId as string).startsWith('ol-') &&
    isPositiveInteger(v.sequence) &&
    isNonEmptyString(v.decisionRef) &&
    (v.decisionRef as string).startsWith('xd:') &&
    isNonEmptyString(v.intentRef) &&
    (v.intentRef as string).startsWith('si:') &&
    (v.directorDecisionRef === null || (v.directorDecisionRef as string).startsWith('dd-')) &&
    (ORDER_STATES as readonly string[]).includes(v.to as string) &&
    isTimestampMs(v.orderClock) &&
    isTimestampMs(v.decisionAsOf) &&
    v.orderClock !== v.decisionAsOf
  );
}
