// @tradrl/domain-core — Goal: the objective contract (R1, spec/DOMAIN-MODEL.md).
//
// A Goal is a point-in-time authored statement of WHAT the organization must
// achieve and WHAT it may do in pursuit: objective, horizon, success criteria
// (executable constraints), allowed markets/data/actions, and the risk policy
// that governs pursuit. Goals are immutable data; revision is a new record.

import {
  Timestamp,
  compareTimestamps,
  isNonEmptyString,
  isRecord,
  isTimestamp,
  isUnitInterval,
} from './primitives';
import { DataScope, MarketScope, isDataScope, isMarketScope } from './market-scope';
import { GoalId, RiskPolicyId, isGoalId, isRiskPolicyId } from './ids';
import { ConstraintSetRef, isConstraintSetRef } from './constraints';

/**
 * Closed permission vocabulary for goal-level action authorization.
 * Deliberately CLOSED (not OpenString): execution authority (T040) reasons
 * about this set when deciding what a project may do; extensions require a
 * contract version bump and an explicit authority update.
 */
export type PermittedAction =
  | 'order.market'
  | 'order.limit'
  | 'order.stop'
  | 'order.stop-limit'
  | 'order.cancel'
  | 'order.modify'
  | 'data.request'
  | 'report.publish';

export const PERMITTED_ACTIONS: readonly PermittedAction[] = [
  'order.market',
  'order.limit',
  'order.stop',
  'order.stop-limit',
  'order.cancel',
  'order.modify',
  'data.request',
  'report.publish',
] as const;

/** Evaluation horizon. `endsAt` is EXCLUSIVE (the goal covers [startsAt, endsAt)). */
export interface GoalHorizon {
  readonly startsAt: Timestamp;
  readonly endsAt: Timestamp;
  readonly label?: string;
}

/** Success criteria: the constraint set that defines attainment. */
export interface GoalSuccessCriteria {
  readonly constraintSet: ConstraintSetRef;
  /** Required share of applicable constraints satisfied (closed interval [0,1]). */
  readonly requiredSatisfaction: number;
}

export interface Goal {
  readonly id: GoalId;
  readonly createdAt: Timestamp;
  /** Human-readable objective statement. Interpretation, never execution. */
  readonly objective: string;
  readonly horizon: GoalHorizon;
  readonly successCriteria: GoalSuccessCriteria;
  /** Markets the goal is allowed to operate on. Must be non-empty. */
  readonly marketScope: MarketScope;
  /** Data the goal is allowed to consume. */
  readonly dataScope: DataScope;
  /** Actions permitted in pursuit of the objective. Must be non-empty. */
  readonly allowedActions: readonly PermittedAction[];
  /** Risk policy governing pursuit. Referent owned by the risk lane (T020). */
  readonly riskPolicyId: RiskPolicyId;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isPermittedAction(v: unknown): v is PermittedAction {
  return isNonEmptyString(v) && (PERMITTED_ACTIONS as readonly string[]).includes(v);
}

export function isGoalHorizon(v: unknown): v is GoalHorizon {
  if (!isRecord(v)) return false;
  if (!isTimestamp(v.startsAt) || !isTimestamp(v.endsAt)) return false;
  if (compareTimestamps(v.startsAt, v.endsAt) >= 0) return false; // non-empty horizon
  if (v.label !== undefined && !isNonEmptyString(v.label)) return false;
  return true;
}

export function isGoalSuccessCriteria(v: unknown): v is GoalSuccessCriteria {
  if (!isRecord(v)) return false;
  return isConstraintSetRef(v.constraintSet) && isUnitInterval(v.requiredSatisfaction);
}

export function isGoal(v: unknown): v is Goal {
  if (!isRecord(v)) return false;
  if (!isGoalId(v.id)) return false;
  if (!isTimestamp(v.createdAt)) return false;
  if (!isNonEmptyString(v.objective)) return false;
  if (!isGoalHorizon(v.horizon)) return false;
  if (!isGoalSuccessCriteria(v.successCriteria)) return false;
  if (!isMarketScope(v.marketScope)) return false;
  if (!isDataScope(v.dataScope)) return false;
  if (!Array.isArray(v.allowedActions) || v.allowedActions.length === 0) return false;
  if (!v.allowedActions.every((x) => isPermittedAction(x))) return false;
  if (!isRiskPolicyId(v.riskPolicyId)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}
