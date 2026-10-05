/**
 * T048 — THE WHOLE LOOP: `runReferenceSlice()`.
 *
 * Assembles every station in order and folds the slice into ONE
 * deterministic report: the same fixture timelines + the same REAL
 * platform code always produce the byte-identical report digest
 * (proven by the colocated suite — the example runs twice and the
 * digests are compared).
 *
 * THE DATA FLOW (one market day, every instant a literal):
 *
 *   scripted transports ──► T037/T038 adapter sessions ──► canonical events
 *        (raw vendor frames)   (REAL guard + mapping)         (honest quartets)
 *                                                                    │
 *              ┌───────────────────────────────────────────────────┤
 *              ▼                                                   ▼
 *   the reactive world (T027)                            the observation window
 *   REAL engine, adversary feed                                   │
 *              │                                                   ▼
 *              │                                    compileStrategyRun (T018)
 *              │                                    (the constraint gate first)
 *              │                                                   │
 *              │                        ┌──────────────────────────┤
 *              │                        ▼                          ▼
 *              │            the execution gateway (T040)   the shadow session (T030)
 *              │            the 13-stage chokepoint;       the paper lane over the
 *              │            routed or REFUSED (typed)      reactive world; fills
 *              │                        │                          with physics lineage
 *              │                        ▼                          │
 *              │            the execution body (T025)               ▼
 *              │            order lifecycles + requests   the outcome log (T033's
 *              │            + fill reconciliation         input) — REALIZED OUTCOMES
 *              └────────────────────────────────────────────────────┘
 */

import { canonicalJson, fnv1a32Hex } from '../../../services/shadow-trading/src/index';

import { collectMarketData } from './market-data';
import { composeSliceDecision } from './director';
import { compileSliceRun, compileSliceStep2 } from './strategy';
import { submitThroughGateway } from './gateway';
import { runShadowLane, realizedOutcomes } from './shadow';
import { recordOrderLane, stateOf } from './execution-body';
import type { RealizedOutcomeSummary } from './shadow';

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** The whole slice's folded evidence (the artifact the suite pins). */
export interface SliceReport {
  /** Station 1 — the canonical events in + the frames out. */
  readonly marketData: {
    readonly binanceEvents: number;
    readonly newsEvents: number;
    /** The embargoed item's canonical availability (the lift instant — never the receipt). */
    readonly embargoAvailableAt: number;
    readonly binanceEventTypes: readonly string[];
    readonly framesSent: number;
  };
  /** Station 4 — the director's decision. */
  readonly director: {
    readonly decisionId: string;
    readonly directiveKind: string;
    readonly lanesConsumed: number;
  };
  /** Station 3 — the strategy runs (step 1: allocation; step 2: drift correction). */
  readonly strategy: {
    readonly runId: string;
    readonly intents: number;
    readonly refusals: number;
    readonly instruments: readonly string[];
    readonly step2RunId: string;
    readonly step2Intents: number;
    readonly step2Sides: readonly string[];
  };
  /** Station 6 — the chokepoint's outcomes. */
  readonly gateway: {
    readonly routed: number;
    readonly refused: number;
    /** The refusal stages, in submission order (the typed evidence). */
    readonly refusalStages: readonly string[];
    /** The venue seam's total calls (the routed count — refusals cost ZERO). */
    readonly portCalls: number;
    /** The main gateway's audit record count (1:1 with its submissions). */
    readonly auditRecords: number;
    /** The main gateway's whole-session coherence verdict (the chain + the 1:1 law). */
    readonly auditCoherent: boolean;
  };
  /** Station 5 — the order lane. */
  readonly executionBody: {
    readonly btcBuyState: string;
    readonly ethState: string;
    readonly btcSellState: string;
    readonly gatewayRequests: number;
    readonly reconciliationStatus: string;
  };
  /** Station 7 — the paper lane. */
  readonly shadow: {
    readonly sessionId: string;
    readonly dispositions: readonly string[];
    readonly worldFillCount: number;
  };
  /** The realized outcomes (the final product — T033's input surface). */
  readonly outcomes: RealizedOutcomeSummary;
  /** The L15 lineage chain: every stage's records bind back to the goal. */
  readonly lineage: {
    /** The user's goal every strategy/execution/outcome record binds to (the run's own binding). */
    readonly goalId: string;
    /** The upstream organization goal (the director decision's goal — the research lane's fixture scope). */
    readonly directorGoalId: string;
    /** The director decision the execution lane cites (the L15 continuity ref). */
    readonly directorDecisionId: string;
    /** The paper lane: every outcome record -> its intent -> the intent's goal binding. */
    readonly paperOutcomeIntents: readonly { readonly outcomeId: string; readonly intentRef: string; readonly goalId: string }[];
    /** The live lane: every audit record -> its intent -> its goal binding. */
    readonly liveAuditIntents: readonly { readonly auditId: string; readonly intentRef: string; readonly goalId: string }[];
    /** The order lane: every lifecycle's genesis record -> the gateway decision + the director decision + the intent. */
    readonly orderDecisions: readonly { readonly lifecycleId: string; readonly decisionRef: string; readonly directorDecisionRef: string | null; readonly intentRef: string }[];
  };
  /** The byte-stable digest of the whole report (the determinism anchor). */
  readonly reportDigest: string;
}

// ---------------------------------------------------------------------------
// The whole loop
// ---------------------------------------------------------------------------

/** Run the ENTIRE slice once. Deterministic: identical inputs -> identical digest. */
export async function runReferenceSlice(): Promise<SliceReport> {
  // --- Station 1: market data in (the REAL adapter sessions). -----------------
  const marketData = collectMarketData();
  const embargoed = marketData.newsEvents.find((event) => event.event_type === 'news');

  // --- Station 4: the director decision (upstream of the binding). -------------
  const directorOutcome = composeSliceDecision();
  if (directorOutcome.kind !== 'decision') {
    throw new Error('the slice\'s director composition must produce a decision (the quorum-met path)');
  }
  const decision = directorOutcome.decision;

  // --- Station 3: the strategy runs (the constraint gate BEFORE emission). ------
  const run = compileSliceRun(marketData.binanceEvents); // step 1: the equal-weight allocation
  const step2Run = compileSliceStep2(marketData.binanceEvents); // step 2: the drift correction

  // --- Station 6: the live lane (the chokepoint — routed or refused). ----------
  const gatewayLane = submitThroughGateway(run, step2Run);
  const routed = gatewayLane.submissions.filter((submission) => submission.kind === 'routed');
  const refused = gatewayLane.submissions.filter((submission) => submission.kind === 'refused');

  // --- Station 7: the paper lane (the reactive world + the outcome log). --------
  const shadowLane = await runShadowLane(run, step2Run, marketData.binanceEvents);
  const worldFills = shadowLane.worldStation.world.fills(shadowLane.session.episodeId);
  if (!worldFills.ok) {
    throw new Error(`the world's fill log must read: ${worldFills.errors.map((error) => error.message).join('; ')}`);
  }

  // --- Station 5: the order lane (lifecycles + requests + reconciliation). ------
  const orderLane = recordOrderLane(run, step2Run, gatewayLane.submissions, decision.decisionId, shadowLane.session);

  // --- The realized outcomes. ----------------------------------------------------
  const outcomes = realizedOutcomes(shadowLane.session);

  // --- The L15 lineage chain (goal -> decision -> strategy -> execution -> outcome).
  const allIntents = [...run.intents, ...step2Run.intents];
  const intentGoalOf = (intentRef: string): string => {
    const intent = allIntents.find((candidate) => candidate.intentId === intentRef);
    if (intent === undefined) {
      throw new Error(`the lineage chain is broken: no strategy intent matches ${intentRef} (L15)`);
    }
    return intent.goal.goalId;
  };
  const lineage = {
    goalId: run.goal.goalId,
    directorGoalId: decision.goal.goalId,
    directorDecisionId: decision.decisionId,
    paperOutcomeIntents: shadowLane.session.outcomeLog.records.map((record) => ({
      outcomeId: record.outcomeId,
      intentRef: record.intentRef,
      goalId: intentGoalOf(record.intentRef),
    })),
    liveAuditIntents: gatewayLane.audit.map((record) => ({
      auditId: record.auditId,
      intentRef: record.lineage.intentRef,
      goalId: record.lineage.goal.goalId,
    })),
    orderDecisions: [orderLane.btcBuyLifecycle, orderLane.ethLifecycle, orderLane.btcSellLifecycle].map((log) => {
      const genesis = log.records[0];
      if (genesis === undefined) throw new Error('every lifecycle must carry its genesis record');
      return {
        lifecycleId: genesis.lifecycleId,
        decisionRef: genesis.decisionRef,
        directorDecisionRef: genesis.directorDecisionRef,
        intentRef: genesis.intentRef,
      };
    }),
  };

  const report: SliceReport = {
    marketData: {
      binanceEvents: marketData.binanceEvents.length,
      newsEvents: marketData.newsEvents.length,
      embargoAvailableAt: (embargoed?.available_time as number | undefined) ?? 0,
      framesSent: marketData.sentFrames.length,
      binanceEventTypes: marketData.binanceEvents.map((event) => event.event_type),
    },
    director: {
      decisionId: decision.decisionId,
      directiveKind: decision.directive.kind,
      lanesConsumed: decision.coverage.filter((lane) => lane.status === 'consumed').length,
    },
    strategy: {
      runId: run.runId,
      intents: run.intents.length,
      refusals: run.refusals.length,
      instruments: run.intents.map((intent) => intent.order.instrumentId),
      step2RunId: step2Run.runId,
      step2Intents: step2Run.intents.length,
      step2Sides: step2Run.intents.map((intent) => intent.order.side),
    },
    gateway: {
      routed: routed.length,
      refused: refused.length + 2, // + the kill-switch and expired-grant gateways' refusals
      refusalStages: [
        ...refused.map((submission) => (submission.kind === 'refused' ? submission.refusal.stage : '')),
        gatewayLane.killSwitchRefusal.kind === 'refused' ? gatewayLane.killSwitchRefusal.refusal.stage : '',
        gatewayLane.expiredGrantRefusal.kind === 'refused' ? gatewayLane.expiredGrantRefusal.refusal.stage : '',
      ],
      portCalls: gatewayLane.port.calls().length,
      auditRecords: gatewayLane.auditRecords,
      auditCoherent: gatewayLane.coherent,
    },
    executionBody: {
      btcBuyState: stateOf(orderLane.btcBuyLifecycle),
      ethState: stateOf(orderLane.ethLifecycle),
      btcSellState: stateOf(orderLane.btcSellLifecycle),
      gatewayRequests: orderLane.gatewayRequests.length,
      reconciliationStatus: orderLane.btcReconciliation.status,
    },
    shadow: {
      sessionId: shadowLane.session.sessionId,
      dispositions: outcomes.dispositions,
      worldFillCount: worldFills.value.length,
    },
    outcomes,
    lineage,
    reportDigest: '',
  };
  return { ...report, reportDigest: fnv1a32Hex(canonicalJson(report as never)) };
}
