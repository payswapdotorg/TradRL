// @tradrl/domain-core — Outcome: realized result linked to a decision/execution.
//
// An Outcome closes the loop: it links a Decision (and, when the decision
// reached the execution plane, the Execution record) to the realized result
// at a moment in time, with a verdict against the decision's intent, metrics
// recorded as data, and an optional post-mortem reference (T033 lane).
// Raw PnL alone is never sufficient (L7) — verdict and metrics are the
// constraint-aware record; PnL is one field among them.

import {
  DecimalString,
  Timestamp,
  isDecimalString,
  isFiniteNumber,
  isIdentifierPath,
  isNonEmptyString,
  isRecord,
  isTimestamp,
} from './primitives';
import {
  DecisionId,
  ExecutionId,
  OutcomeId,
  PostMortemId,
  ProjectId,
  isDecisionId,
  isExecutionId,
  isOutcomeId,
  isPostMortemId,
  isProjectId,
} from './ids';

/** Verdict of the realized outcome against the decision's intent. */
export type OutcomeVerdict = 'met' | 'partially-met' | 'missed' | 'inconclusive';

export const OUTCOME_VERDICTS: readonly OutcomeVerdict[] = [
  'met',
  'partially-met',
  'missed',
  'inconclusive',
] as const;

/** Recorded metric value: quantitative (number) or qualitative (string). */
export type OutcomeMetricValue = number | string;

export interface Outcome {
  readonly id: OutcomeId;
  readonly projectId: ProjectId;
  /** The decision this outcome realizes. Required (L15 lineage). */
  readonly decisionId: DecisionId;
  /** Execution record when the decision reached the execution plane. Opaque (T019/T040). */
  readonly executionId?: ExecutionId;
  readonly realizedAt: Timestamp;
  readonly verdict: OutcomeVerdict;
  /** Realized PnL attributable to the decision, when measurable. */
  readonly realizedPnl?: DecimalString;
  /** Result metrics as data (keys are subject-style identifiers). May be empty. */
  readonly metrics: Readonly<Record<string, OutcomeMetricValue>>;
  /** Post-mortem analyzing this outcome. Opaque (T033). */
  readonly postMortemId?: PostMortemId;
  readonly summary?: string;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isOutcomeVerdict(v: unknown): v is OutcomeVerdict {
  return isNonEmptyString(v) && (OUTCOME_VERDICTS as readonly string[]).includes(v);
}

function isOutcomeMetricValue(v: unknown): v is OutcomeMetricValue {
  return isFiniteNumber(v) || isNonEmptyString(v);
}

function isOutcomeMetrics(v: unknown): v is Readonly<Record<string, OutcomeMetricValue>> {
  if (!isRecord(v)) return false;
  for (const [key, value] of Object.entries(v)) {
    if (!isIdentifierPath(key)) return false;
    if (!isOutcomeMetricValue(value)) return false;
  }
  return true;
}

export function isOutcome(v: unknown): v is Outcome {
  if (!isRecord(v)) return false;
  if (!isOutcomeId(v.id)) return false;
  if (!isProjectId(v.projectId)) return false;
  if (!isDecisionId(v.decisionId)) return false;
  if (v.executionId !== undefined && !isExecutionId(v.executionId)) return false;
  if (!isTimestamp(v.realizedAt)) return false;
  if (!isOutcomeVerdict(v.verdict)) return false;
  if (v.realizedPnl !== undefined && !isDecimalString(v.realizedPnl)) return false;
  if (!isOutcomeMetrics(v.metrics)) return false;
  if (v.postMortemId !== undefined && !isPostMortemId(v.postMortemId)) return false;
  if (v.summary !== undefined && !isNonEmptyString(v.summary)) return false;
  return true;
}
