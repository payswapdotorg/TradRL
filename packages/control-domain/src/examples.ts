// @tradrl/control-domain — canonical reference examples.
//
// The example records below are the package's documentation-grade fixtures
// (the discipline of `@tradrl/agent-body`'s examples.ts): every value is
// guard-valid and deeply frozen, and the test suite asserts they stay that
// way. Consumers may import them for documentation, demos and cross-lane
// smoke tests.

import { deepFreeze } from './primitives';
import { GoalRef, ConstraintSetRef, ProjectId, TenantId, AcceptanceCriteriaId } from './ids';
import { TimestampMs } from './timestamp';
import { GoalStatement } from './goal';
import { ConstraintSetStatement } from './constraints';
import { ProjectRecordDraft, ProjectLineage } from './project';
import { compileAcceptance } from './acceptance';

/** Shared tenant of all examples (L12: every record is tenant-scoped). */
export const EXAMPLE_TENANT = 'tenant_acme' as TenantId;

/** Reference goal statement: risk-adjusted growth under hard risk limits. */
export const exampleGoalStatement: GoalStatement = deepFreeze({
  id: 'goal_alpha' as GoalRef,
  version: 1,
  tenantId: EXAMPLE_TENANT,
  objective: 'Grow risk-adjusted returns on crypto majors while staying within hard risk limits.',
  horizon: {
    // Opaque epoch-millisecond instants (2027 Q1 window).
    startsAt: 1_801_200_000_000 as TimestampMs,
    endsAt: (1_801_200_000_000 + 90 * 24 * 60 * 60 * 1000) as TimestampMs,
    label: 'Q1 2027 window',
  },
  successCriteria: {
    criteria: [
      {
        id: 'sharpe_floor',
        metric: 'returns.sharpe',
        predicate: { kind: 'limit.min', bound: 1.0 },
        description: 'Risk-adjusted return floor over the horizon.',
      },
      {
        id: 'drawdown_ceiling',
        metric: 'risk.maxDrawdown',
        predicate: { kind: 'limit.max', bound: 0.15 },
        description: 'Hard drawdown ceiling.',
      },
      {
        id: 'breach_free',
        metric: 'risk.constraintBreaches',
        predicate: { kind: 'limit.max', bound: 0 },
        description: 'Zero blocking constraint violations.',
      },
    ],
    requiredSatisfaction: 1,
  },
  evaluation: {
    blindRef: 'blind-policy/unseen-2027a',
    walkForwardRef: 'walk-forward/rolling-90d',
    regimeRef: 'regime/trend-range-vol3',
    adversarialRequired: true,
  },
  createdAt: 1_799_900_000_000 as TimestampMs,
  description: 'Primary capital preservation goal.',
});

/** Reference constraint-set statement: alpha guardrails v2. */
export const exampleConstraintSetStatement: ConstraintSetStatement = deepFreeze({
  id: 'cs_alpha' as ConstraintSetRef,
  version: 2,
  tenantId: EXAMPLE_TENANT,
  name: 'alpha guardrails v2',
  constraints: [
    {
      id: 'max_drawdown',
      domain: 'outcome',
      subject: 'risk.maxDrawdown',
      predicate: { kind: 'limit.max', bound: 0.12 },
      severity: 'blocking',
      description: 'Kill-switch drawdown.',
    },
    {
      id: 'gross_exposure',
      domain: 'state',
      subject: 'risk.grossExposure',
      predicate: { kind: 'limit.max', bound: 2.5 },
      severity: 'blocking',
    },
    {
      id: 'sharpe_floor_constraint',
      domain: 'outcome',
      subject: 'returns.sharpe.netOfFees',
      predicate: { kind: 'limit.min', bound: 0.8 },
      severity: 'advisory',
    },
    {
      id: 'trade_size',
      domain: 'action',
      subject: 'order.notionalUsd',
      predicate: { kind: 'limit.max', bound: 50_000 },
      severity: 'advisory',
    },
  ],
  createdAt: 1_799_800_000_000 as TimestampMs,
});

/** The acceptance criteria compiled from the two example statements. */
export const exampleAcceptanceCriteria = compileAcceptance(
  exampleGoalStatement,
  exampleConstraintSetStatement,
);

/** Reference project draft: the crypto-majors-alpha project. */
export const exampleProjectLineage: ProjectLineage = deepFreeze({
  projectId: 'prj_alpha' as ProjectId,
  goal: { goalId: 'goal_alpha' as GoalRef, version: 1 },
  constraintSet: { id: 'cs_alpha' as ConstraintSetRef, version: 2 },
});

/** Reference project draft (acceptance criteria already compiled). */
export const exampleProjectRecordDraft: ProjectRecordDraft = deepFreeze({
  id: 'prj_alpha' as ProjectId,
  tenantId: EXAMPLE_TENANT,
  name: 'Crypto Majors Alpha',
  executionMode: 'simulation',
  lineage: exampleProjectLineage,
  acceptanceCriteriaId: exampleAcceptanceCriteria.id as AcceptanceCriteriaId,
  createdAt: 1_800_100_000_000 as TimestampMs,
});
