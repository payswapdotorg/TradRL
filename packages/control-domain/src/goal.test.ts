import { describe, expect, it } from 'vitest';
import {
  CRITERION_PREDICATE_KINDS,
  type GoalStatement,
  type GoalRef,
  type TenantId,
  type TimestampMs,
  isCriterionPredicate,
  isCriterionValue,
  isGoalEvaluationPolicy,
  isGoalHorizon,
  isGoalStatement,
  isGoalSuccessCriteria,
  isSuccessCriterion,
  deepFreeze,
  isDeeplyFrozen,
  type Mutable,
} from './index';
import { exampleGoalStatement } from './examples';

const ts = (n: number) => n as TimestampMs;
const goalId = (s: string) => s as GoalRef;
const tenant = (s: string) => s as TenantId;

function validGoal(): GoalStatement {
  return JSON.parse(JSON.stringify(exampleGoalStatement)) as GoalStatement;
}

describe('isGoalStatement — acceptance', () => {
  it('accepts the canonical example goal', () => {
    expect(isGoalStatement(exampleGoalStatement)).toBe(true);
  });

  it('accepts a research-only goal with mixed predicate kinds', () => {
    const goal: GoalStatement = {
      ...validGoal(),
      successCriteria: {
        criteria: [
          {
            id: 'coverage',
            metric: 'research.coverage',
            predicate: { kind: 'flag', expected: true },
          },
          {
            id: 'verdict',
            metric: 'research.verdictCode',
            predicate: { kind: 'oneOf', values: ['supported', 'inconclusive'] },
          },
          {
            id: 'netting',
            metric: 'costs.netOfFees',
            predicate: { kind: 'limit.range', min: 0, max: 0.02 },
          },
          {
            id: 'no_forbidden',
            metric: 'research.leakFlag',
            predicate: { kind: 'equals', value: false },
          },
        ],
        requiredSatisfaction: 0.75,
      },
    };
    expect(isGoalStatement(goal)).toBe(true);
  });

  it('accepts partial satisfaction thresholds at the closed-interval bounds', () => {
    expect(isGoalStatement({ ...validGoal(), successCriteria: { ...validGoal().successCriteria, requiredSatisfaction: 0 } })).toBe(true);
    expect(isGoalStatement({ ...validGoal(), successCriteria: { ...validGoal().successCriteria, requiredSatisfaction: 1 } })).toBe(true);
  });
});

describe('isGoalStatement — rejection', () => {
  it('rejects malformed goal statements', () => {
    const goal = validGoal();
    const invalid: unknown[] = [
      { ...goal, id: '' },
      { ...goal, id: 42 },
      { ...goal, version: 0 },
      { ...goal, version: 2.5 },
      { ...goal, version: '1' },
      { ...goal, tenantId: '' },
      { ...goal, objective: '' },
      { ...goal, objective: '   ' },
      { ...goal, objective: null },
      { ...goal, horizon: { startsAt: ts(200), endsAt: ts(100) } }, // inverted
      { ...goal, horizon: { startsAt: ts(100), endsAt: ts(100) } }, // empty horizon
      { ...goal, horizon: { startsAt: ts(100) } }, // missing end
      { ...goal, horizon: { startsAt: '100', endsAt: ts(200) } },
      { ...goal, horizon: { startsAt: ts(100), endsAt: ts(200), label: '' } },
      { ...goal, successCriteria: 'make as much money as possible' }, // prose
      { ...goal, successCriteria: null },
      { ...goal, successCriteria: { criteria: [], requiredSatisfaction: 1 } }, // vacuous
      { ...goal, successCriteria: { criteria: 'c1', requiredSatisfaction: 1 } },
      { ...goal, successCriteria: { requiredSatisfaction: 1 } }, // no criteria array
      { ...goal, successCriteria: { criteria: validGoal().successCriteria.criteria, requiredSatisfaction: 1.1 } },
      { ...goal, successCriteria: { criteria: validGoal().successCriteria.criteria, requiredSatisfaction: -0.1 } },
      { ...goal, successCriteria: { criteria: validGoal().successCriteria.criteria } },
      { ...goal, successCriteria: { criteria: [validGoal().successCriteria.criteria[0], validGoal().successCriteria.criteria[0]], requiredSatisfaction: 1 } }, // duplicate ids
      { ...goal, successCriteria: { criteria: [{ ...validGoal().successCriteria.criteria[0], metric: 'nope bad path' }], requiredSatisfaction: 1 } },
      { ...goal, successCriteria: { criteria: [{ ...validGoal().successCriteria.criteria[0], predicate: { kind: 'limit.max' } }], requiredSatisfaction: 1 } }, // missing bound
      { ...goal, successCriteria: { criteria: [{ ...validGoal().successCriteria.criteria[0], predicate: 'be profitable' }], requiredSatisfaction: 1 } }, // prose predicate
      { ...goal, successCriteria: { criteria: [{ ...validGoal().successCriteria.criteria[0], id: '' }], requiredSatisfaction: 1 } },
      { ...goal, evaluation: { blindRef: '', walkForwardRef: 'wf', regimeRef: 'rg', adversarialRequired: true } },
      { ...goal, evaluation: { walkForwardRef: 'wf', regimeRef: 'rg', adversarialRequired: true } },
      { ...goal, evaluation: { blindRef: 'b', walkForwardRef: 'wf', regimeRef: 'rg' } },
      { ...goal, evaluation: { blindRef: 'b', walkForwardRef: 'wf', regimeRef: 'rg', adversarialRequired: 'yes' } },
      { ...goal, createdAt: ts(1.5) },
      { ...goal, createdAt: -1 },
      { ...goal, createdAt: Number.NaN },
      { ...goal, description: '' },
      null,
      'goal',
      42,
      [validGoal()],
    ];
    for (const g of invalid) expect(isGoalStatement(g)).toBe(false);
  });
});

describe('component guards', () => {
  it('isGoalHorizon requires a strictly positive, well-ordered window of instants', () => {
    expect(isGoalHorizon(exampleGoalStatement.horizon)).toBe(true);
    expect(isGoalHorizon({ startsAt: ts(0), endsAt: ts(1) })).toBe(true);
    expect(isGoalHorizon({ startsAt: ts(100), endsAt: ts(100) })).toBe(false);
    expect(isGoalHorizon({ startsAt: ts(200), endsAt: ts(100) })).toBe(false);
    expect(isGoalHorizon({ startsAt: ts(100), endsAt: 1.5 })).toBe(false); // non-integer instant
    expect(isGoalHorizon({ startsAt: ts(100), endsAt: Number.NaN })).toBe(false);
    expect(isGoalHorizon({ startsAt: '100', endsAt: '200' })).toBe(false);
    expect(isGoalHorizon({ startsAt: ts(100), endsAt: ts(200), label: '' })).toBe(false);
    expect(isGoalHorizon(null)).toBe(false);
  });

  it('isGoalSuccessCriteria requires structured, unique, non-empty criteria and a [0,1] ratio', () => {
    expect(isGoalSuccessCriteria(exampleGoalStatement.successCriteria)).toBe(true);
    expect(isGoalSuccessCriteria({ criteria: [], requiredSatisfaction: 1 })).toBe(false);
    expect(isGoalSuccessCriteria({ requiredSatisfaction: 1 })).toBe(false);
    expect(isGoalSuccessCriteria({ criteria: [{ id: 'a', metric: 'x.y', predicate: { kind: 'flag', expected: true } }], requiredSatisfaction: 0.5 })).toBe(true);
    expect(
      isGoalSuccessCriteria({
        criteria: [
          { id: 'a', metric: 'x.y', predicate: { kind: 'flag', expected: true } },
          { id: 'a', metric: 'z.w', predicate: { kind: 'flag', expected: false } },
        ],
        requiredSatisfaction: 0.5,
      }),
    ).toBe(false); // duplicate ids
  });

  it('isSuccessCriterion requires id, identifier-path metric and a valid predicate', () => {
    expect(isSuccessCriterion(exampleGoalStatement.successCriteria.criteria[0])).toBe(true);
    expect(isSuccessCriterion({ id: 'a', metric: 'x', predicate: { kind: 'flag', expected: true } })).toBe(true);
    expect(isSuccessCriterion({ metric: 'x', predicate: { kind: 'flag', expected: true } })).toBe(false);
    expect(isSuccessCriterion({ id: 'a', metric: 'X-Invalid', predicate: { kind: 'flag', expected: true } })).toBe(false);
    expect(isSuccessCriterion({ id: 'a', metric: 'x.9bad', predicate: { kind: 'flag', expected: true } })).toBe(false);
    expect(isSuccessCriterion({ id: 'a', metric: 'x', predicate: 'positive returns' })).toBe(false);
    expect(isSuccessCriterion({ id: 'a', metric: 'x', predicate: { kind: 'flag', expected: true }, description: '' })).toBe(false);
  });

  it('isGoalEvaluationPolicy requires non-empty opaque refs and a boolean adversarial flag', () => {
    expect(isGoalEvaluationPolicy(exampleGoalStatement.evaluation)).toBe(true);
    expect(isGoalEvaluationPolicy({ blindRef: 'b', walkForwardRef: 'w', regimeRef: 'r', adversarialRequired: false })).toBe(true);
    expect(isGoalEvaluationPolicy({ blindRef: '', walkForwardRef: 'w', regimeRef: 'r', adversarialRequired: false })).toBe(false);
    expect(isGoalEvaluationPolicy({ blindRef: 'b', walkForwardRef: ' ', regimeRef: 'r', adversarialRequired: false })).toBe(false);
    expect(isGoalEvaluationPolicy({ blindRef: 'b', walkForwardRef: 'w', regimeRef: 'r', adversarialRequired: 1 })).toBe(false);
    expect(isGoalEvaluationPolicy({})).toBe(false);
    expect(isGoalEvaluationPolicy(null)).toBe(false);
  });
});

describe('predicate mirror (domain-core `Predicate` discipline)', () => {
  it('isCriterionPredicate mirrors the closed kind vocabulary', () => {
    expect([...CRITERION_PREDICATE_KINDS]).toEqual([
      'limit.max',
      'limit.min',
      'limit.range',
      'equals',
      'notEquals',
      'oneOf',
      'flag',
    ]);
  });

  it('isCriterionPredicate validates bounds, ranges, membership sets and flags', () => {
    expect(isCriterionPredicate({ kind: 'limit.max', bound: 1 })).toBe(true);
    expect(isCriterionPredicate({ kind: 'limit.min', bound: -1.5 })).toBe(true);
    expect(isCriterionPredicate({ kind: 'limit.max', bound: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isCriterionPredicate({ kind: 'limit.max' })).toBe(false);
    expect(isCriterionPredicate({ kind: 'limit.range', min: 0, max: 1 })).toBe(true);
    expect(isCriterionPredicate({ kind: 'limit.range', min: 1, max: 0 })).toBe(false); // min > max
    expect(isCriterionPredicate({ kind: 'limit.range', min: 0, max: Number.NaN })).toBe(false);
    expect(isCriterionPredicate({ kind: 'equals', value: 'x' })).toBe(true);
    expect(isCriterionPredicate({ kind: 'equals', value: 1 })).toBe(true);
    expect(isCriterionPredicate({ kind: 'equals', value: true })).toBe(true);
    expect(isCriterionPredicate({ kind: 'equals', value: '' })).toBe(false);
    expect(isCriterionPredicate({ kind: 'notEquals', value: null })).toBe(false);
    expect(isCriterionPredicate({ kind: 'oneOf', values: ['a', 'b'] })).toBe(true);
    expect(isCriterionPredicate({ kind: 'oneOf', values: [] })).toBe(false); // non-empty required
    expect(isCriterionPredicate({ kind: 'oneOf', values: ['a', ''] })).toBe(false);
    expect(isCriterionPredicate({ kind: 'oneOf', values: 'ab' })).toBe(false);
    expect(isCriterionPredicate({ kind: 'flag', expected: true })).toBe(true);
    expect(isCriterionPredicate({ kind: 'flag', expected: 'true' })).toBe(false);
    expect(isCriterionPredicate({ kind: 'limit.mean', bound: 1 })).toBe(false); // closed vocabulary
    expect(isCriterionPredicate(null)).toBe(false);
    expect(isCriterionPredicate('profitable')).toBe(false);
  });

  it('isCriterionValue accepts finite numbers, non-empty strings and booleans only', () => {
    expect(isCriterionValue(0)).toBe(true);
    expect(isCriterionValue(-1.5)).toBe(true);
    expect(isCriterionValue('x')).toBe(true);
    expect(isCriterionValue(false)).toBe(true);
    expect(isCriterionValue('')).toBe(false);
    expect(isCriterionValue(Number.NaN)).toBe(false);
    expect(isCriterionValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isCriterionValue(null)).toBe(false);
    expect(isCriterionValue({})).toBe(false);
  });
});

describe('immutability discipline', () => {
  it('the canonical example goal is deeply frozen', () => {
    expect(isDeeplyFrozen(exampleGoalStatement)).toBe(true);
  });

  it('deepFreeze blocks field mutation (L3-style immutability)', () => {
    const goal = deepFreeze(validGoal());
    expect(() => {
      (goal as Mutable<GoalStatement>).objective = 'mutated';
    }).toThrow(TypeError);
    expect(goal.objective).toBe(exampleGoalStatement.objective);
  });
});
