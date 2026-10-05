/**
 * T048 — STATION 5: THE EXECUTION BODY (T025).
 *
 * The REAL order-lifecycle state machine over everything the gateway
 * ROUTED: the genesis `prepare` (citing the gateway's APPROVE decision
 * ref — the authority travels WITH the record, L8), the `submit` /
 * `acknowledge` motions, and — for the orders the reactive world
 * paper-executed — the fill transitions (the world's fills as
 * evidence, re-anchored into the body's own 'xsf-' fill-ref space) and
 * the expiry close-out backed by the world's own outcome disposition.
 *
 * THE HONEST MAPPING (the world's realized outcome -> the lifecycle):
 *   - the BTC buy: 'partial' in the world (the adversary had consumed
 *     the book) -> a partial-fill transition; its remainder RESTS at
 *     the venue at the session's close (the lifecycle stays
 *     partially_filled — no invented close-out).
 *   - the ETH buy: routed and acknowledged (the recording port carries
 *     no fill stream in this slice — no fill evidence exists to record).
 *   - the BTC sell: zero fills in the world (the resting limit never
 *     crossed) -> the world's 'expired' disposition backs the
 *     expire-unfilled close-out.
 *
 * The REAL `createGatewayRequest` mints the submission seam's durable
 * record per routed order, and the REAL `reconcileFills` runs the
 * exact-equality fill reconciliation over the BTC buy's lifecycle.
 */

import {
  appendOrderLifecycleEvent,
  createGatewayRequest,
  decimalSum,
  prepareOrder,
  reconcileFills,
  currentOrderState,
  EXECUTION_METHOD_REGISTRY,
  type GatewayRequest,
  type OrderLifecycleLog,
  type ReconciliationRecord,
} from '../../../bodies/execution/src/index';
import type { GatewaySubmissionRecord } from '../../../services/execution-gateway/src/index';
import type { StrategyIntent, StrategyRun } from '../../../packages/trading-strategy/src/index';
import type { ShadowSession } from '../../../services/shadow-trading/src/index';
import { canonicalJson, fnv1a32Hex } from '../../../services/shadow-trading/src/index';

import { BTC, ETH, PROJECT, STRATEGY_DECISION_AT, TENANT, unwrap } from './scope';

/** The declared method citations (the registry's records — the event-family discipline). */
const PREPARATION_METHOD = { methodId: 'method/execution/order-preparation', methodVersion: '1.0.0' } as const;
const FILL_METHOD = { methodId: 'method/execution/fill-reconciliation', methodVersion: '1.0.0' } as const;

// ---------------------------------------------------------------------------
// The station
// ---------------------------------------------------------------------------

/** Station 5's product: the per-order lifecycles + the gateway requests + the reconciliation. */
export interface ExecutionBodyStation {
  /** The BTC buy: prepared -> submitted -> acknowledged -> PARTIALLY FILLED (the world filled 0.9 of 0.998; the remainder rests). */
  readonly btcBuyLifecycle: OrderLifecycleLog;
  /** The ETH buy: prepared -> submitted -> acknowledged (routed; no fill stream observed in the slice). */
  readonly ethLifecycle: OrderLifecycleLog;
  /** The BTC sell: prepared -> submitted -> acknowledged -> EXPIRED (the world's 'expired' disposition backs the close-out). */
  readonly btcSellLifecycle: OrderLifecycleLog;
  /** The submission seam's durable records (one per routed order). */
  readonly gatewayRequests: readonly GatewayRequest[];
  /** The BTC buy's exact-equality fill reconciliation. */
  readonly btcReconciliation: ReconciliationRecord;
}

/**
 * Record the order lane: for every ROUTED gateway submission, the
 * lifecycle + the gateway request; the world-executed orders continue
 * through the fills (the BTC buy) and the expiry (the BTC sell).
 */
export function recordOrderLane(
  run: StrategyRun,
  step2Run: StrategyRun,
  submissions: readonly GatewaySubmissionRecord[],
  directorDecisionId: string,
  shadowSession: ShadowSession,
): ExecutionBodyStation {
  // The live lane's submission order is the slice's own script: the BTC buy,
  // the ETH buy, then the drift-correction sell (the negatives follow) — the
  // routed records carry the opaque decision/request ids, so the slice
  // matches its own submission order.
  const routed = submissions.filter((submission): submission is Extract<GatewaySubmissionRecord, { readonly kind: 'routed' }> => submission.kind === 'routed');
  if (routed.length !== 3) {
    throw new Error(`the live lane must route exactly three orders (routed ${routed.length})`);
  }
  const btcBuyRouted = routed[0] as Extract<GatewaySubmissionRecord, { readonly kind: 'routed' }>;
  const ethRouted = routed[1] as Extract<GatewaySubmissionRecord, { readonly kind: 'routed' }>;
  const btcSellRouted = routed[2] as Extract<GatewaySubmissionRecord, { readonly kind: 'routed' }>;
  const btcBuyIntent = run.intents.find((intent: StrategyIntent) => intent.order.instrumentId === BTC && intent.order.side === 'buy');
  const ethIntent = run.intents.find((intent: StrategyIntent) => intent.order.instrumentId === ETH);
  const btcSellIntent = step2Run.intents.find((intent: StrategyIntent) => intent.order.instrumentId === BTC && intent.order.side === 'sell');
  if (btcBuyIntent === undefined || ethIntent === undefined || btcSellIntent === undefined) {
    throw new Error('the strategy runs must carry the BTC buy, the ETH buy and the BTC sell');
  }

  // --- The BTC buy: the FULL lifecycle through the world's fills --------------
  const btcBuyPrepared = prepareLifecycle(btcBuyRouted, btcBuyIntent, directorDecisionId);
  let btcBuyLifecycle = unwrap(
    appendOrderLifecycleEvent(
      unwrap(
        appendOrderLifecycleEvent(
          btcBuyPrepared,
          { event: 'submit', orderClock: (btcBuyRouted.routedAt + 1) as never, methodId: PREPARATION_METHOD.methodId, methodVersion: PREPARATION_METHOD.methodVersion, killSwitch: { state: 'standing' } },
          EXECUTION_METHOD_REGISTRY,
        ),
        'the BTC buy must submit',
      ),
      { event: 'acknowledge', orderClock: (btcBuyRouted.routedAt + 2) as never, methodId: PREPARATION_METHOD.methodId, methodVersion: PREPARATION_METHOD.methodVersion },
      EXECUTION_METHOD_REGISTRY,
    ),
    'the BTC buy must acknowledge',
  );
  // The world's fills become the body's fill evidence (re-anchored into the
  // 'xsf-' venue-fill ref space — the shadow fill's identity, content-derived).
  // The order-level clock thread stays MONOTONE (L16).
  const btcFills = shadowSession.fills.filter((fill) => fill.intentRef === btcBuyIntent.intentId);
  let btcClock = btcBuyRouted.routedAt + 2;
  for (const fill of btcFills) {
    const fillInstant = (fill.appliedAt ?? fill.availableAt) as number;
    btcClock = Math.max(btcClock + 1, fillInstant);
    btcBuyLifecycle = unwrap(
      appendOrderLifecycleEvent(
        btcBuyLifecycle,
        {
          event: 'partial-fill',
          orderClock: btcClock as never,
          fills: [{ fillRef: `xsf-${fnv1a32Hex(canonicalJson({ worldFill: fill.worldFill.fill.fill_id, shadowFill: fill.fillId }))}`, quantity: fill.worldFill.fill.quantity, orderClock: btcClock as never }],
          methodId: FILL_METHOD.methodId,
          methodVersion: FILL_METHOD.methodVersion,
        },
        EXECUTION_METHOD_REGISTRY,
      ),
      'the BTC buy\'s partial fill must append',
    );
  }
  // The remainder RESTS at the venue at the session's close — the lifecycle
  // stays partially_filled (no invented close-out; the venue lane owns it).

  // --- The ETH buy: prepare -> submit -> acknowledge ----------------------------
  const ethLifecycle = acknowledgeOnly(ethRouted, ethIntent, directorDecisionId);

  // --- The BTC sell: prepare -> submit -> acknowledge -> EXPIRED -----------------
  const btcSellPrepared = prepareLifecycle(btcSellRouted, btcSellIntent, directorDecisionId);
  let btcSellLifecycle = unwrap(
    appendOrderLifecycleEvent(
      unwrap(
        appendOrderLifecycleEvent(
          btcSellPrepared,
          { event: 'submit', orderClock: (btcSellRouted.routedAt + 1) as never, methodId: PREPARATION_METHOD.methodId, methodVersion: PREPARATION_METHOD.methodVersion, killSwitch: { state: 'standing' } },
          EXECUTION_METHOD_REGISTRY,
        ),
        'the BTC sell must submit',
      ),
      { event: 'acknowledge', orderClock: (btcSellRouted.routedAt + 2) as never, methodId: PREPARATION_METHOD.methodId, methodVersion: PREPARATION_METHOD.methodVersion },
      EXECUTION_METHOD_REGISTRY,
    ),
    'the BTC sell must acknowledge',
  );
  // The world's own outcome disposition for this decision was 'expired' (the
  // resting limit never crossed) — the expire-unfilled close-out is BACKED.
  btcSellLifecycle = unwrap(
    appendOrderLifecycleEvent(
      btcSellLifecycle,
      { event: 'expire-unfilled', orderClock: (shadowSession.now + 1) as never, methodId: PREPARATION_METHOD.methodId, methodVersion: PREPARATION_METHOD.methodVersion },
      EXECUTION_METHOD_REGISTRY,
    ),
    'the BTC sell must expire unfilled',
  );

  // --- The submission seam's durable records -----------------------------------
  const gatewayRequests: GatewayRequest[] = [];
  const seamPairs = [
    { submission: btcBuyRouted, prepared: btcBuyPrepared, intent: btcBuyIntent },
    { submission: ethRouted, prepared: ethLifecycle, intent: ethIntent }, // (the append-only log's records[0] IS the prepared record)
    { submission: btcSellRouted, prepared: btcSellPrepared, intent: btcSellIntent },
  ] as const;
  for (const pair of seamPairs) {
    gatewayRequests.push(
      unwrap(
        createGatewayRequest({
          kind: 'order-submission',
          orderRef: pair.intent.order.clientOrderId,
          decisionRef: pair.submission.decisionId,
          record: pair.prepared.records[0] as never,
          orderClock: pair.submission.routedAt as never,
          tenant: TENANT as never,
          project: PROJECT,
        }),
        'the gateway request must mint',
      ),
    );
  }

  // --- The BTC buy's exact-equality fill reconciliation ----------------------
  // The venue-acknowledged quantity: the paper world's accounted fills (the
  // same fills the lifecycle carries as evidence — exact equality expected).
  const acknowledged = decimalSum(
    shadowSession.fills.filter((fill) => fill.intentRef === btcBuyIntent.intentId).map((fill) => fill.worldFill.fill.quantity),
    8,
    'truncate',
  );
  const reconciliation = unwrap(
    reconcileFills(
      {
        log: btcBuyLifecycle,
        acknowledgedQuantity: acknowledged,
        orderClock: (shadowSession.now + 2) as never,
        methodId: 'method/execution/fill-reconciliation',
        methodVersion: '1.0.0',
        registry: EXECUTION_METHOD_REGISTRY,
      },
    ),
    'the fill reconciliation must run',
  );
  if (reconciliation.violations.length > 0) {
    throw new Error(`the BTC buy's fills must reconcile exactly: ${reconciliation.violations.map((violation) => violation.message).join('; ')}`);
  }

  return {
    btcBuyLifecycle,
    ethLifecycle,
    btcSellLifecycle,
    gatewayRequests,
    btcReconciliation: reconciliation.record,
  };
}

// ---------------------------------------------------------------------------
// The local construction helpers
// ---------------------------------------------------------------------------

/** One order's genesis preparation (the L8/L16 laws enforced inside). */
function prepareLifecycle(
  submission: Extract<GatewaySubmissionRecord, { readonly kind: 'routed' }>,
  intent: StrategyIntent,
  directorDecisionId: string,
): OrderLifecycleLog {
  return unwrap(
    prepareOrder(
      {
        decisionRef: submission.decisionId,
        decisionAsOf: STRATEGY_DECISION_AT as never,
        intentRef: intent.intentId,
        directorDecision: directorDecisionId,
        orderRef: intent.order.clientOrderId,
        venue: intent.order.venueId,
        instrument: intent.order.instrumentId,
        side: intent.order.side,
        orderKind: intent.order.kind,
        quantity: intent.order.quantity,
        orderClock: submission.routedAt as never,
        tenant: TENANT as never,
        project: PROJECT as never,
        methodId: PREPARATION_METHOD.methodId,
        methodVersion: PREPARATION_METHOD.methodVersion,
      },
      EXECUTION_METHOD_REGISTRY,
    ),
    'the order must prepare',
  );
}

/** prepare -> submit -> acknowledge (the routed-and-acknowledged shape). */
function acknowledgeOnly(
  submission: Extract<GatewaySubmissionRecord, { readonly kind: 'routed' }>,
  intent: StrategyIntent,
  directorDecisionId: string,
): OrderLifecycleLog {
  const prepared = prepareLifecycle(submission, intent, directorDecisionId);
  return unwrap(
    appendOrderLifecycleEvent(
      unwrap(
        appendOrderLifecycleEvent(
          prepared,
          { event: 'submit', orderClock: (submission.routedAt + 1) as never, methodId: PREPARATION_METHOD.methodId, methodVersion: PREPARATION_METHOD.methodVersion, killSwitch: { state: 'standing' } },
          EXECUTION_METHOD_REGISTRY,
        ),
        'the order must submit',
      ),
      { event: 'acknowledge', orderClock: (submission.routedAt + 2) as never, methodId: PREPARATION_METHOD.methodId, methodVersion: PREPARATION_METHOD.methodVersion },
      EXECUTION_METHOD_REGISTRY,
    ),
    'the order must acknowledge',
  );
}

/** The lifecycle's current state (the station's dashboard). */
export function stateOf(log: OrderLifecycleLog): string {
  return currentOrderState(log);
}
