// @tradrl/example-e2e-trading — STAGE 10: THE EXECUTION BODY (T025).
//
// The order lifecycle under the external gateway: prepare (from the
// gateway's APPROVE decision — the authority), submit through the
// gateway REQUEST seam, acknowledge, fill-complete with fill evidence,
// and reconciliation — every record on the append-only, chain-verified
// lifecycle log (chain seed 'ol-genesis', the fold law
// `fnv(prevHead + canonical(record))`). L16 clock law: the order-level
// clock runs STRICTLY AFTER the decision instant (equality is
// clock_confusion). Fills are facts from the world — never fabricated.

import { add, compare, subtract } from './decimals';
import { canonicalJson, deepFreeze, fnv1a32Hex, stableDigest16Json, type JsonValue } from './primitives';
import { fail, ok, type ExampleResult } from './errors';
import type {
  GatewayRequestMirror, OrderLifecycleLogMirror, OrderLifecycleRecordMirror,
  FillEvidenceMirror, OrderStateMirror,
} from './mirrors/execution';
import { LIFECYCLE_CHAIN_SEED_MIRROR, ORDER_LIFECYCLE_TRANSITIONS_MIRROR } from './mirrors/execution';
import type { StrategyIntentMirror } from './mirrors/strategy';
import type { ApproveDecisionMirror, GatewaySubmissionRecordMirror } from './mirrors/execution';
import type { ReactiveFillRecordMirror } from './mirrors/market';

const EXECUTION_PREPARATION_METHOD = { methodId: 'method/execution/order-preparation', methodVersion: '1.0.0' };
const FILL_RECONCILIATION_METHOD = { methodId: 'method/execution/fill-reconciliation', methodVersion: '1.0.0' };

export function lifecycleChainHeadOf(previousHead: string, record: Omit<OrderLifecycleRecordMirror, 'lifecycleId' | 'chainHead'>): string {
  return fnv1a32Hex(previousHead + canonicalJson(record as unknown as JsonValue));
}

export function lifecycleIdOf(record: Omit<OrderLifecycleRecordMirror, 'lifecycleId' | 'chainHead'>): string {
  return `ol-${stableDigest16Json(record as unknown as JsonValue)}`;
}

/** LEGAL EDGE check (the state machine, mirrored). */
export function isLegalLifecycleEdge(from: OrderStateMirror | null, event: string, to: OrderStateMirror): boolean {
  return ORDER_LIFECYCLE_TRANSITIONS_MIRROR.some((transition) => transition.from === from && transition.event === event && transition.to === to);
}

/** Record 1 of a log: prepare — derived from the gateway's APPROVE. */
export function prepareOrder(input: {
  readonly decision: ApproveDecisionMirror;
  readonly intent: StrategyIntentMirror;
  readonly directorDecisionRef: string | null;
  readonly orderClock: number;
  readonly method?: { readonly methodId: string; readonly methodVersion: string };
}): ExampleResult<OrderLifecycleLogMirror> {
  const { decision, intent, orderClock } = input;
  if (decision.kind !== 'approve') {
    return fail('decision_not_approved', 'order preparation requires an APPROVE decision — a refusal authorizes nothing (L8)', 'decision.kind');
  }
  if (decision.intentRef !== intent.intentId) {
    return fail('invalid_state', `the decision gates intent ${decision.intentRef} but the order was prepared for ${intent.intentId}`, 'decision.intentRef');
  }
  if (orderClock <= decision.asOf) {
    return fail('clock_not_monotonic', `orderClock ${orderClock} must run STRICTLY AFTER the decision instant ${decision.asOf} (L16 — strategic and order-level clocks are distinct)`, 'orderClock');
  }
  const method = input.method ?? EXECUTION_PREPARATION_METHOD;
  const content = {
    sequence: 1,
    decisionRef: decision.decisionId,
    intentRef: intent.intentId,
    directorDecisionRef: input.directorDecisionRef,
    orderRef: intent.order.clientOrderId,
    venue: intent.order.venueId,
    instrument: intent.order.instrumentId,
    side: intent.order.side,
    orderKind: intent.order.kind,
    quantity: intent.order.quantity,
    from: null,
    to: 'prepared' as OrderStateMirror,
    event: 'prepare',
    orderClock,
    decisionAsOf: decision.asOf,
    fills: [],
    cancelConfirmationRef: null,
    escalationRef: null,
    ...method,
    tenant: intent.tenant,
    project: intent.project,
  };
  const chainHead = lifecycleChainHeadOf(LIFECYCLE_CHAIN_SEED_MIRROR, content);
  const record: OrderLifecycleRecordMirror = deepFreeze({
    ...content,
    lifecycleId: lifecycleIdOf(content),
    chainHead,
  });
  return ok(deepFreeze({ orderRef: intent.order.clientOrderId, records: [record] }));
}

/** Appends the submit event (the gateway REQUEST). */
export function submitOrder(
  log: OrderLifecycleLogMirror,
  submission: GatewaySubmissionRecordMirror,
  orderClock: number,
): ExampleResult<OrderLifecycleLogMirror> {
  const current = log.records[log.records.length - 1]!;
  if (current.to !== 'prepared') {
    return fail('lifecycle_violation', `submit requires state prepared (found ${current.to})`, 'log');
  }
  if (submission.kind !== 'routed') {
    return fail('decision_not_approved', `the gateway refused this order (stage ${(submission.refusal as { stage: string }).stage}) — only routed submissions may proceed (L8)`, 'submission');
  }
  const content = {
    ...currentRecordFields(current),
    sequence: log.records.length + 1,
    from: 'prepared' as OrderStateMirror,
    to: 'submitted' as OrderStateMirror,
    event: 'submit',
    orderClock,
    fills: [],
    ...EXECUTION_PREPARATION_METHOD,
  };
  const chainHead = lifecycleChainHeadOf(current.chainHead, content);
  const record: OrderLifecycleRecordMirror = deepFreeze({ ...content, lifecycleId: lifecycleIdOf(content), chainHead });
  return ok(deepFreeze({ orderRef: log.orderRef, records: [...log.records, record] }));
}

/** Appends acknowledge + fills + fill-complete from the world's fills. */
export function applyWorldFills(
  log: OrderLifecycleLogMirror,
  fills: readonly ReactiveFillRecordMirror[],
  orderClock: number,
): ExampleResult<OrderLifecycleLogMirror> {
  const current = log.records[log.records.length - 1]!;
  if (current.to !== 'submitted' && current.to !== 'acknowledged' && current.to !== 'partially_filled') {
    return fail('lifecycle_violation', `fills require state submitted/acknowledged/partially_filled (found ${current.to})`, 'log');
  }
  let records = [...log.records];
  if (current.to === 'submitted') {
    records = [...records, appendEvent(current, records.length, 'acknowledge', 'acknowledged', orderClock)];
  }
  const working = records[records.length - 1]!;
  const cumulative = '0';
  const totalFill = fills.reduce((acc, fill) => add(acc, fill.fill.quantity), cumulative);
  const remaining = compare(current.quantity, totalFill) < 0 ? '0' : minus(current.quantity, totalFill);
  const fillEvidence: FillEvidenceMirror[] = fills.map((fill) => ({
    fillRef: fill.fill_id,
    quantity: fill.fill.quantity,
    orderClock: fill.fill.quartet.available_time,
  }));
  const complete = remaining === '0';
  records = [
    ...records,
    appendEvent(
      working,
      records.length,
      complete ? 'fill-complete' : 'partial-fill',
      complete ? 'filled' : 'partially_filled',
      orderClock,
      fillEvidence,
    ),
  ];
  return ok(deepFreeze({ orderRef: log.orderRef, records }));
}

function minus(a: string, b: string): string {
  return compare(a, b) <= 0 ? '0' : subtract(a, b);
}

function currentRecordFields(record: OrderLifecycleRecordMirror): Omit<OrderLifecycleRecordMirror, 'lifecycleId' | 'sequence' | 'chainHead' | 'from' | 'to' | 'event' | 'fills' | 'orderClock'> {
  const { lifecycleId: _li, sequence: _s, chainHead: _c, from: _f, to: _t, event: _e, fills: _fi, orderClock: _o, ...rest } = record;
  return rest;
}

function appendEvent(
  reference: OrderLifecycleRecordMirror,
  sequenceBase: number,
  event: string,
  to: OrderStateMirror,
  orderClock: number,
  fills: readonly FillEvidenceMirror[] = [],
): OrderLifecycleRecordMirror {
  const method = event === 'fill-complete' || event === 'partial-fill' ? FILL_RECONCILIATION_METHOD : EXECUTION_PREPARATION_METHOD;
  const content = {
    ...currentRecordFields(reference),
    sequence: sequenceBase + 1,
    from: reference.to,
    to,
    event,
    orderClock,
    fills,
    ...method,
  };
  const chainHead = lifecycleChainHeadOf(reference.chainHead, content);
  return deepFreeze({ ...content, lifecycleId: lifecycleIdOf(content), chainHead });
}

/** Builds the gateway REQUEST record (the T025 seam). */
export function gatewayRequestOf(log: OrderLifecycleLogMirror, orderClock: number): GatewayRequestMirror {
  const prepared = log.records[0]!;
  const content = {
    kind: 'order-submission' as const,
    orderRef: log.orderRef,
    decisionRef: prepared.decisionRef,
    record: prepared,
    orderClock,
    tenant: prepared.tenant,
    project: prepared.project,
  };
  return deepFreeze({
    ...content,
    requestRef: `gwr-${stableDigest16Json(content as unknown as JsonValue)}`,
  });
}

/** Re-verifies the whole lifecycle chain (the tamper trip-wire). */
export function verifyLifecycleLog(log: unknown): ExampleResult<OrderLifecycleLogMirror> {
  if (!log || typeof log !== 'object' || !Array.isArray((log as OrderLifecycleLogMirror).records)) {
    return fail('invalid_type', 'lifecycle log must carry a records array', 'log');
  }
  const typed = log as OrderLifecycleLogMirror;
  let head = LIFECYCLE_CHAIN_SEED_MIRROR;
  for (let index = 0; index < typed.records.length; index++) {
    const record = typed.records[index]!;
    if (record.sequence !== index + 1) {
      return fail('chain_mismatch', `lifecycle record ${index + 1} carries sequence ${record.sequence} — spliced history`, `records[${index}]`);
    }
    const content = { ...record } as Record<string, unknown>;
    delete content.lifecycleId;
    delete content.chainHead;
    const expected = fnv1a32Hex(head + canonicalJson(content as JsonValue));
    if (record.chainHead !== expected) {
      return fail('chain_mismatch', `lifecycle record ${index + 1} chain head ${record.chainHead} != expected ${expected} — edited history`, `records[${index}]`);
    }
    head = expected;
  }
  return ok(typed);
}

export function currentOrderState(log: OrderLifecycleLogMirror): OrderStateMirror {
  return log.records[log.records.length - 1]!.to;
}

export function cumulativeFills(log: OrderLifecycleLogMirror): readonly FillEvidenceMirror[] {
  return log.records.flatMap((record) => record.fills);
}
