// @tradrl/example-e2e-trading — STAGE 11: OUTCOMES (L15 closure).
//
// Every decision's realized result: the shadow outcome record (T030's
// pattern — disposition, fill refs, exact costs, realized/unrealized on
// the append-only '00000000'-seeded chain) plus the domain Outcome
// (verdict against the GOAL's success criteria — L7: raw PnL is never
// the sole criterion) and the final GoalProgress binding that walks the
// whole stream back to the goal.

import { add, multiply, signedAdd, subtract } from './decimals';
import { deepFreeze, fnv1a32Hex, stableDigest8Json, type JsonValue } from './primitives';
import { ok, type ExampleResult } from './errors';
import type {
  DomainOutcomeMirror, GoalProgressRecordMirror, ShadowOutcomeLogMirror,
  ShadowOutcomeRecordMirror, ShadowLineageMirror, SimulatedFillMirror,
} from './mirrors/shadow';
import { OUTCOME_CHAIN_SEED_MIRROR } from './mirrors/shadow';
import type { GoalStatementMirror, GoalAttainmentMirror } from './mirrors/control';
import { evaluateGoalAttainmentMirror } from './mirrors/control';
import type { StrategyIntentMirror } from './mirrors/strategy';
import type { GatewaySubmissionRecordMirror } from './mirrors/execution';
import type { ReactiveFillRecordMirror } from './mirrors/market';

export function startShadowOutcomeLog(): ShadowOutcomeLogMirror {
  return { records: [], head: OUTCOME_CHAIN_SEED_MIRROR };
}

function outcomeContent(record: Omit<ShadowOutcomeRecordMirror, 'outcomeId'>): JsonValue {
  return record as unknown as JsonValue;
}

export function mintShadowOutcome(record: Omit<ShadowOutcomeRecordMirror, 'outcomeId'>): ShadowOutcomeRecordMirror {
  return deepFreeze({ ...record, outcomeId: `swo:${stableDigest8Json(outcomeContent(record))}` });
}

/** Appends one outcome (typed rewrite laws; the chain folds every record). */
export function appendShadowOutcome(
  log: ShadowOutcomeLogMirror,
  record: Omit<ShadowOutcomeRecordMirror, 'outcomeId'>,
): ExampleResult<ShadowOutcomeLogMirror> {
  if (record.priorChainHead !== log.head) {
    return { ok: false, errors: [{ code: 'chain_mismatch', path: 'priorChainHead', message: `outcome chain head ${record.priorChainHead} != log head ${log.head} — spliced outcome history` }] };
  }
  if (log.records.length > 0 && log.records[log.records.length - 1]!.ordinal >= record.ordinal) {
    return { ok: false, errors: [{ code: 'invalid_state', path: 'ordinal', message: 'outcome ordinals must strictly increase (append-only)' }] };
  }
  // Re-derive the id from the content (a pre-minted id field is ignored —
  // the content is the only identity authority).
  const { outcomeId: _preMinted, ...content } = record as Record<string, unknown>;
  const jsonContent = content as unknown as JsonValue;
  const minted = deepFreeze({ ...content, outcomeId: `swo:${stableDigest8Json(jsonContent)}` }) as ShadowOutcomeRecordMirror;
  const head = fnv1a32Hex(log.head + stableDigest8Json(jsonContent));
  return ok({ records: [...log.records, minted], head });
}

/** Re-verifies the outcome chain (the T030 fold law). */
export function verifyShadowOutcomeChain(log: unknown): boolean {
  if (!log || typeof log !== 'object' || !Array.isArray((log as ShadowOutcomeLogMirror).records)) return false;
  const typed = log as ShadowOutcomeLogMirror;
  let head = OUTCOME_CHAIN_SEED_MIRROR;
  for (let index = 0; index < typed.records.length; index++) {
    const record = typed.records[index]!;
    if (record.ordinal !== index + 1) return false;
    if (record.priorChainHead !== head) return false;
    const { outcomeId, ...content } = record;
    const jsonContent = content as unknown as JsonValue;
    if (outcomeId !== `swo:${stableDigest8Json(jsonContent)}`) return false;
    head = fnv1a32Hex(head + stableDigest8Json(jsonContent));
  }
  return typed.head === head;
}

// ---------------------------------------------------------------------------
// The per-decision outcome derivation
// ---------------------------------------------------------------------------

export interface DecisionOutcomeInput {
  readonly intent: StrategyIntentMirror;
  readonly submission: GatewaySubmissionRecordMirror;
  readonly fills: readonly ReactiveFillRecordMirror[];
  readonly unrealizedAtDecision: string;
  readonly lineage: ShadowLineageMirror;
  readonly asOf: number;
}

export interface DecisionOutcome {
  readonly outcome: ShadowOutcomeRecordMirror;
  /** The fill-level records fed to the portfolio. */
  readonly accountFills: readonly {
    readonly fill_id: string;
    readonly instrument: string;
    readonly venue: string;
    readonly side: 'buy' | 'sell';
    readonly price: string;
    readonly quantity: string;
    readonly fee: string;
    readonly event_time: number;
  }[];
  /** The simulated-fill mirrors (T019 shape) for the lineage stream. */
  readonly simulatedFills: readonly SimulatedFillMirror[];
}

export function deriveDecisionOutcome(input: DecisionOutcomeInput, priorLog: ShadowOutcomeLogMirror): DecisionOutcome {
  const { intent, submission, fills } = input;
  const routed = submission.kind === 'routed';
  const feeTotal = fills.reduce((acc, fill) => add(acc, fill.fill.taker_fee), '0');
  const notionalTotal = fills.reduce((acc, fill) => add(acc, multiply(fill.fill.quantity, fill.fill.aggressor_price)), '0');
  // Realized outcome: buys carry -(notional+fee), sells +(notional-fee) — the cash view.
  const realized = fills.reduce((acc, fill) => {
    const notional = multiply(fill.fill.quantity, fill.fill.aggressor_price);
    return signedAdd(acc, fill.fill.aggressor_side === 'buy' ? `-${add(notional, fill.fill.taker_fee)}` : subtract(notional, fill.fill.taker_fee));
  }, '0');

  const disposition: ShadowOutcomeRecordMirror['disposition'] = !routed
    ? 'refused'
    : fills.length === 0
      ? 'expired'
      : 'filled';

  const outcomeContent = {
    ordinal: priorLog.records.length + 1,
    intentRef: intent.intentId,
    decisionRef: routed ? submission.decisionId : null,
    refusalRef: routed ? null : `gwr-refused:${(submission.refusal as { stage: string }).stage}`,
    disposition,
    fills: fills.map((fill) => fill.fill_id),
    costs: { feeTotal, notionalTotal },
    realizedOutcome: realized,
    unrealizedAtDecision: input.unrealizedAtDecision,
    priorChainHead: priorLog.head,
    lineage: input.lineage,
    asOf: input.asOf,
  };
  const outcome = mintShadowOutcome(outcomeContent);

  const accountFills = fills.map((fill) => ({
    fill_id: fill.fill_id,
    instrument: fill.fill.instrument,
    venue: fill.fill.venue,
    side: fill.fill.aggressor_side,
    price: fill.fill.aggressor_price,
    quantity: fill.fill.quantity,
    fee: fill.fill.taker_fee,
    event_time: fill.fill.quartet.available_time,
  }));

  const simulatedFills: SimulatedFillMirror[] = fills.map((fill, index) => ({
    fillId: fill.fill_id,
    sequence: index + 1,
    venue: fill.fill.venue,
    instrument: fill.fill.instrument,
    side: fill.fill.aggressor_side,
    price: fill.fill.price,
    aggressorPrice: fill.fill.aggressor_price,
    quantity: fill.fill.quantity,
    fee: fill.fill.taker_fee,
    latencyMs: fill.fill.latency_ms,
    decisionId: routed ? submission.decisionId! : 'xd:none',
    intentRef: intent.intentId,
    fidelity: 'simulated_matching',
    venueLineage: {
      configDigest: fill.physics.engine_config_hash,
      engineOrderRef: fill.taker_order_id,
      engineFillRef: fill.fill_id,
      feesRef: 'fee-schedule/tiers@1',
      latencyRef: 'information-latency-only@1',
      slippageRef: 'slippage/book-walk@1',
      impactRef: 'none@1',
    },
    lineage: {
      intentRef: intent.intentId,
      strategy: { specId: intent.strategy.specId, version: intent.strategy.version },
      goal: { goalId: intent.goal.goalId, version: intent.goal.version },
      policy: { policyId: 'xpol:bound-at-outcome', version: 1 },
      venues: [fill.fill.venue],
      seed: intent.seed,
      tenant: intent.tenant,
      project: intent.project,
    },
    tenant: intent.tenant,
    project: intent.project,
    asOf: fill.fill.quartet.available_time,
  }));

  return { outcome, accountFills, simulatedFills };
}

// ---------------------------------------------------------------------------
// The domain outcome + goal progress (L7/L15)
// ---------------------------------------------------------------------------

export function domainOutcomeOf(
  outcome: ShadowOutcomeRecordMirror,
  goal: GoalStatementMirror,
  realizedPnl: string,
  maxDrawdownObserved: string,
  finalEquity: string,
): DomainOutcomeMirror {
  const facts: Record<string, number | string> = {
    'outcome.realized_pnl': Number(realizedPnl),
    'outcome.max_drawdown': Number(maxDrawdownObserved),
    'outcome.final_equity': Number(finalEquity),
    'outcome.fill_count': outcome.fills.length,
  };
  const attainment = evaluateGoalAttainmentMirror(goal, facts);
  const verdict: DomainOutcomeMirror['verdict'] = attainment.attained
    ? 'met'
    : attainment.satisfactionShare > 0
      ? 'partially-met'
      : 'inconclusive';
  return deepFreeze({
    id: `outcome:${outcome.outcomeId}`,
    projectId: outcome.lineage.project,
    decisionId: outcome.decisionRef ?? 'xd:none',
    executionId: outcome.outcomeId,
    realizedAt: outcome.asOf,
    verdict,
    realizedPnl,
    metrics: facts,
    summary: `disposition ${outcome.disposition}; goal attainment ${attainment.satisfiedCount}/${attainment.totalCount}`,
  });
}

export function goalProgressOf(
  goal: GoalStatementMirror,
  project: string,
  outcomeIds: readonly string[],
  finalEquity: string,
  realizedPnl: string,
  maxDrawdownObserved: string,
  asOf: number,
): GoalProgressRecordMirror {
  const facts: Record<string, number | string> = {
    'outcome.realized_pnl': Number(realizedPnl),
    'outcome.max_drawdown': Number(maxDrawdownObserved),
    'outcome.final_equity': Number(finalEquity),
  };
  const attainment: GoalAttainmentMirror = evaluateGoalAttainmentMirror(goal, facts);
  return deepFreeze({
    goalRef: { goalId: goal.id, version: goal.version },
    tenant: goal.tenantId,
    project,
    horizon: goal.horizon,
    finalEquity,
    realizedPnl,
    maxDrawdownObserved,
    verdict: attainment.attained ? 'met' : attainment.satisfactionShare > 0 ? 'partially-met' : 'missed',
    attainment: {
      criteria: attainment.criteria.map((criterion) => ({
        criterionId: criterion.criterionId,
        metric: criterion.metric,
        satisfied: criterion.satisfied,
        observed: criterion.observed,
      })),
      satisfiedCount: attainment.satisfiedCount,
      totalCount: attainment.totalCount,
      satisfactionShare: attainment.satisfactionShare,
      attained: attainment.attained,
    },
    outcomeIds: [...outcomeIds],
    asOf,
  });
}

export const OUTCOME_HELPERS = { ok };
