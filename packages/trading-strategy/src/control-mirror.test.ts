/**
 * Behavioral tests for the control-plane mirrors and the constraint
 * gate: the mirror guards, the predicate evaluator, and the domain-core
 * engine semantics (not_applicable, error, blocking/advisory,
 * fail-closed).
 */

import { describe, expect, it } from 'vitest';

import {
  evaluateCriterionPredicateMirror,
  isConstraintSetStatementMirror,
  isGoalStatementMirror,
  runConstraintGate,
  type ConstraintContextMirror,
  type ConstraintSetStatementMirror,
  type ConstraintStatementMirror,
} from './index';

const T0 = 1_700_000_000_000;

function constraint(overrides?: Record<string, unknown>): ConstraintStatementMirror {
  return {
    id: 'c1',
    domain: 'state',
    subject: 'state.positions',
    predicate: { kind: 'limit.max', bound: 5 },
    severity: 'blocking',
    ...overrides,
  } as unknown as ConstraintStatementMirror;
}

function set(constraints: readonly ConstraintStatementMirror[]): ConstraintSetStatementMirror {
  return {
    id: 'cs-1',
    version: 1,
    tenantId: 'tenant-alpha',
    name: 'set',
    constraints,
    createdAt: T0,
  } as unknown as ConstraintSetStatementMirror;
}

function context(overrides?: Partial<ConstraintContextMirror>): ConstraintContextMirror {
  return {
    observation: { 'window.events': 3 },
    state: { 'state.positions': 2, 'state.cash': '1000' },
    action: { 'action.side': 'buy', 'action.notional': '500' },
    outcome: {},
    ...overrides,
  };
}

describe('the mirror guards', () => {
  it('accepts a well-formed goal statement mirror', () => {
    const goal = {
      id: 'goal-1',
      version: 1,
      tenantId: 'tenant-alpha',
      objective: 'Objective text.',
      horizon: { startsAt: T0, endsAt: T0 + 1000 },
      successCriteria: {
        criteria: [{ id: 'c1', metric: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 } }],
        requiredSatisfaction: 1,
      },
      evaluation: { blindRef: 'b', walkForwardRef: 'w', regimeRef: 'r', adversarialRequired: true },
      createdAt: T0,
    };
    expect(isGoalStatementMirror(goal)).toBe(true);
    expect(isGoalStatementMirror({ ...goal, successCriteria: { criteria: [], requiredSatisfaction: 1 } })).toBe(false);
    expect(isGoalStatementMirror({ ...goal, horizon: { startsAt: T0, endsAt: T0 } })).toBe(false);
  });

  it('accepts a well-formed constraint-set mirror; duplicates and bad severities fail', () => {
    expect(isConstraintSetStatementMirror(set([constraint()]))).toBe(true);
    expect(isConstraintSetStatementMirror(set([constraint(), constraint()]))).toBe(false); // duplicate ids
    expect(isConstraintSetStatementMirror(set([constraint({ severity: 'fatal' })]))).toBe(false);
    expect(isConstraintSetStatementMirror(set([constraint({ domain: 'dreams' })]))).toBe(false);
  });
});

describe('the predicate evaluator (total, fail-closed on type pairing)', () => {
  it('numeric limits pair only with numbers', () => {
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.max', bound: 5 }, 4)).toBe(true);
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.max', bound: 5 }, 6)).toBe(false);
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.max', bound: 5 }, '4')).toBe(false); // fail-closed
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.min', bound: 5 }, 5)).toBe(true);
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.range', min: 1, max: 3 }, 2)).toBe(true);
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.range', min: 1, max: 3 }, 4)).toBe(false);
  });

  it('equals/notEquals/oneOf/flag pair by runtime type', () => {
    expect(evaluateCriterionPredicateMirror({ kind: 'equals', value: '500' }, '500')).toBe(true);
    expect(evaluateCriterionPredicateMirror({ kind: 'equals', value: 500 }, '500')).toBe(false);
    expect(evaluateCriterionPredicateMirror({ kind: 'oneOf', values: ['buy', 'sell'] }, 'buy')).toBe(true);
    expect(evaluateCriterionPredicateMirror({ kind: 'oneOf', values: ['buy'] }, 'hold')).toBe(false);
    expect(evaluateCriterionPredicateMirror({ kind: 'flag', expected: true }, true)).toBe(true);
    expect(evaluateCriterionPredicateMirror({ kind: 'flag', expected: true }, 'true')).toBe(false);
  });
});

describe('runConstraintGate (domain-core engine semantics, mirrored)', () => {
  it('satisfied / violated / not_applicable / error all classified correctly', () => {
    const report = runConstraintGate(
      set([
        constraint({ id: 'sat', predicate: { kind: 'limit.max', bound: 10 } }), // 2 <= 10
        constraint({ id: 'vio', predicate: { kind: 'limit.max', bound: 1 } }), // 2 > 1
        constraint({ id: 'na', subject: 'state.absent' }), // missing subject
        constraint({ id: 'err', subject: 'state.cash' }), // numeric limit over a string
      ]),
      context(),
    );
    const byId = new Map(report.checks.map((check) => [check.constraintId, check.status] as const));
    expect(byId.get('sat')).toBe('satisfied');
    expect(byId.get('vio')).toBe('violated');
    expect(byId.get('na')).toBe('not_applicable');
    expect(byId.get('err')).toBe('error');
    expect(report.satisfied).toBe(1);
    expect(report.violated).toBe(1);
    expect(report.notApplicable).toBe(1);
    expect(report.errors).toBe(1);
    // The violated constraint is blocking; the errored check forces fail.
    expect(report.blockingViolations).toBe(1);
    expect(report.pass).toBe(false);
  });

  it('advisory violations do not fail the gate (they are recorded, never dropped)', () => {
    const report = runConstraintGate(
      set([constraint({ id: 'adv', severity: 'advisory', predicate: { kind: 'limit.max', bound: 0 } })]),
      context(),
    );
    expect(report.advisoryViolations).toBe(1);
    expect(report.blockingViolations).toBe(0);
    expect(report.errors).toBe(0);
    expect(report.pass).toBe(true);
  });

  it('an empty set passes (no blocking violations, no errors) — the vacuous-truth discipline of the gate', () => {
    const report = runConstraintGate(set([]), context());
    expect(report.checks).toHaveLength(0);
    expect(report.pass).toBe(true);
  });

  it('the gate is deterministic: the same (set, context) yields the deeply-equal report', () => {
    const constraintSet = set([constraint(), constraint({ id: 'c2', domain: 'action', subject: 'action.side', predicate: { kind: 'oneOf', values: ['sell'] } })]);
    const a = runConstraintGate(constraintSet, context());
    const b = runConstraintGate(constraintSet, context());
    expect(a).toStrictEqual(b);
  });
});
