import { describe, expect, it } from 'vitest';
import {
  type AcceptanceCriteria,
  type ConstraintSetStatement,
  type GoalStatement,
  type GoalRef,
  type ConstraintSetRef,
  type TenantId,
  type TimestampMs,
  ControlDomainError,
  acceptanceCriteriaId,
  compileAcceptance,
  gatesConstraint,
  isAcceptanceCriteria,
  isAcceptanceLineage,
  isCompiledCriterion,
  isEvaluationPolicy,
  isDeeplyFrozen,
  parseAcceptanceCriteriaId,
  type Mutable,
} from './index';
import {
  exampleAcceptanceCriteria,
  exampleConstraintSetStatement,
  exampleGoalStatement,
} from './examples';

const ts = (n: number) => n as TimestampMs;
const goalId = (s: string) => s as GoalRef;
const setId = (s: string) => s as ConstraintSetRef;
const tenant = (s: string) => s as TenantId;

function validGoal(): GoalStatement {
  return JSON.parse(JSON.stringify(exampleGoalStatement)) as GoalStatement;
}
function validSet(): ConstraintSetStatement {
  return JSON.parse(JSON.stringify(exampleConstraintSetStatement)) as ConstraintSetStatement;
}

function compileError(code: string): (error: unknown) => void {
  return (error: unknown) => {
    expect(error).toBeInstanceOf(ControlDomainError);
    expect((error as ControlDomainError).code).toBe(code);
  };
}

// ---------------------------------------------------------------------------
// Happy path: determinism, structure, lineage
// ---------------------------------------------------------------------------

describe('compileAcceptance — determinism', () => {
  it('compiles the canonical example deterministically (same inputs -> deep-equal outputs)', () => {
    const first = compileAcceptance(validGoal(), validSet());
    const second = compileAcceptance(validGoal(), validSet());
    expect(first).toEqual(second);
    expect(first).toEqual(exampleAcceptanceCriteria);
  });

  it('the compiled artifact is deeply frozen', () => {
    expect(isDeeplyFrozen(compileAcceptance(validGoal(), validSet()))).toBe(true);
    const compiled = compileAcceptance(validGoal(), validSet());
    expect(() => {
      (compiled as Mutable<AcceptanceCriteria>).version = 99;
    }).toThrow(TypeError);
    expect(() => {
      (compiled.criteria[0] as Mutable<{ criterion: { metric: string } }>).criterion = {
        id: 'x',
        metric: 'hacked.path',
        predicate: { kind: 'flag', expected: true },
      };
    }).toThrow(TypeError);
  });

  it('mutating the INPUTS after compilation cannot affect the compiled artifact', () => {
    const goal: Mutable<GoalStatement> = JSON.parse(JSON.stringify(exampleGoalStatement));
    const set: Mutable<ConstraintSetStatement> = JSON.parse(JSON.stringify(exampleConstraintSetStatement));
    const compiled = compileAcceptance(goal as GoalStatement, set as ConstraintSetStatement);
    goal.successCriteria.criteria[0].metric = 'tampered.metric';
    set.constraints[0].subject = 'tampered.subject';
    expect(compiled.criteria[0].criterion.metric).toBe('returns.sharpe');
    expect(compiled.constraints[0].subject).toBe('risk.maxDrawdown');
  });

  it('the id is content-addressed from the lineage: goal/set version bumps change the id', () => {
    const base = compileAcceptance(validGoal(), validSet());
    const bumpedGoal = compileAcceptance({ ...validGoal(), version: 2 }, validSet());
    const bumpedSet = compileAcceptance(validGoal(), { ...validSet(), version: 3 });
    expect(bumpedGoal.id).not.toBe(base.id);
    expect(bumpedSet.id).not.toBe(base.id);
    expect(base.version).toBe(1);
    expect(bumpedGoal.version).toBe(1);
  });
});

describe('compileAcceptance — artifact structure', () => {
  const compiled = exampleAcceptanceCriteria;

  it('pairs every criterion with exactly the constraints that gate it (gating rule)', () => {
    expect(compiled.criteria.map((c) => c.criterion.id)).toEqual([
      'sharpe_floor',
      'drawdown_ceiling',
      'breach_free',
    ]);
    // returns.sharpe is gated by the more specific returns.sharpe.netOfFees constraint.
    expect(compiled.criteria[0]?.gatingConstraintIds).toEqual(['sharpe_floor_constraint']);
    // risk.maxDrawdown is gated by the exact-subject constraint.
    expect(compiled.criteria[1]?.gatingConstraintIds).toEqual(['max_drawdown']);
    // risk.constraintBreaches shares no family with any constraint -> ungated.
    expect(compiled.criteria[2]?.gatingConstraintIds).toEqual([]);
  });

  it('embeds the full validated constraint snapshot (self-contained for T012/T016)', () => {
    expect(compiled.constraints).toEqual(exampleConstraintSetStatement.constraints);
  });

  it('compiles the evaluation policy from the goal declaration and the required satisfaction', () => {
    expect(compiled.policy).toEqual({
      blindRef: 'blind-policy/unseen-2027a',
      walkForwardRef: 'walk-forward/rolling-90d',
      regimeRef: 'regime/trend-range-vol3',
      adversarialRequired: true,
      requiredSatisfaction: 1,
    });
  });

  it('carries the tenant scope and the two-part lineage (goal version + constraint-set version)', () => {
    expect(compiled.tenantId).toBe(exampleGoalStatement.tenantId);
    expect(compiled.lineage).toEqual({
      goal: { goalId: goalId('goal_alpha'), version: 1 },
      constraintSet: { id: setId('cs_alpha'), version: 2 },
    });
  });

  it('the content-addressed id parses back to the exact lineage', () => {
    expect(compiled.id).toBe(
      acceptanceCriteriaId(
        { goalId: goalId('goal_alpha'), version: 1 },
        { id: setId('cs_alpha'), version: 2 },
      ),
    );
    expect(parseAcceptanceCriteriaId(compiled.id)).toEqual({
      goal: { goalId: 'goal_alpha', version: 1 },
      constraintSet: { id: 'cs_alpha', version: 2 },
    });
  });
});

describe('gatesConstraint — the gating rule', () => {
  it('gates by measurement family: prefix either way', () => {
    expect(gatesConstraint('risk.maxDrawdown', 'risk.maxDrawdown')).toBe(true); // exact
    expect(gatesConstraint('risk', 'risk.maxDrawdown')).toBe(true); // family
    expect(gatesConstraint('risk.maxDrawdown.daily', 'risk.maxDrawdown')).toBe(true); // extension
    expect(gatesConstraint('risk', 'returns.sharpe')).toBe(false); // different family
    expect(gatesConstraint('returns.sharpe.netOfFees', 'returns.sharpe')).toBe(true);
    expect(gatesConstraint('returns', 'returns')).toBe(true);
    expect(gatesConstraint('ret', 'returns')).toBe(false); // segment boundaries only
    expect(gatesConstraint('returnsx', 'returns')).toBe(false);
  });

  it('is total: rejects non-strings and empty paths', () => {
    expect(gatesConstraint('a.b', '')).toBe(false);
    expect(gatesConstraint('', 'a.b')).toBe(false);
    expect(gatesConstraint(1, 'a.b')).toBe(false);
    expect(gatesConstraint('a.b', null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed compilation (typed errors)
// ---------------------------------------------------------------------------

describe('compileAcceptance — typed errors', () => {
  it('FAILS to compile unstructured success criteria (prose) with `unstructured-criteria`', () => {
    const prose: Mutable<GoalStatement> = validGoal();
    prose.successCriteria = 'make as much money as possible, safely' as unknown as GoalStatement['successCriteria'];
    expect(() =>
      compileAcceptance(prose as unknown as GoalStatement, validSet()),
    ).toThrow(compileError('unstructured-criteria'));
  });

  it('FAILS to compile criteria entries that are not structured records', () => {
    const partial: Mutable<GoalStatement> = validGoal();
    partial.successCriteria = {
      criteria: ['be very profitable'],
      requiredSatisfaction: 1,
    } as unknown as GoalStatement['successCriteria'];
    expect(() =>
      compileAcceptance(partial as unknown as GoalStatement, validSet()),
    ).toThrow(compileError('unstructured-criteria'));

    const missingPredicate: Mutable<GoalStatement> = validGoal();
    missingPredicate.successCriteria = {
      criteria: [{ id: 'a', metric: 'returns.sharpe' }],
      requiredSatisfaction: 1,
    } as unknown as GoalStatement['successCriteria'];
    expect(() =>
      compileAcceptance(missingPredicate as unknown as GoalStatement, validSet()),
    ).toThrow(compileError('unstructured-criteria'));
  });

  it('FAILS to compile a vacuous criteria list with `empty-success-criteria`', () => {
    const empty: Mutable<GoalStatement> = validGoal();
    empty.successCriteria = { criteria: [], requiredSatisfaction: 1 } as unknown as GoalStatement['successCriteria'];
    expect(() =>
      compileAcceptance(empty as unknown as GoalStatement, validSet()),
    ).toThrow(compileError('empty-success-criteria'));
  });

  it('FAILS with `invalid-goal` for structured goals with field-level problems', () => {
    const broken: unknown = { ...validGoal(), objective: '' };
    expect(() => compileAcceptance(broken as GoalStatement, validSet())).toThrow(compileError('invalid-goal'));
    expect(() => compileAcceptance(null as unknown as GoalStatement, validSet())).toThrow(compileError('invalid-goal'));
    const inverted: unknown = { ...validGoal(), horizon: { startsAt: ts(200), endsAt: ts(100) } };
    expect(() => compileAcceptance(inverted as GoalStatement, validSet())).toThrow(compileError('invalid-goal'));
  });

  it('FAILS with `invalid-constraint-set` for malformed constraint sets', () => {
    const broken: unknown = { ...validSet(), version: 0 };
    expect(() => compileAcceptance(validGoal(), broken as ConstraintSetStatement)).toThrow(
      compileError('invalid-constraint-set'),
    );
    const duplicateIds: unknown = {
      ...validSet(),
      constraints: [validSet().constraints[0], { ...validSet().constraints[1], id: 'max_drawdown' }],
    };
    expect(() => compileAcceptance(validGoal(), duplicateIds as ConstraintSetStatement)).toThrow(
      compileError('invalid-constraint-set'),
    );
    expect(() => compileAcceptance(validGoal(), 'safe' as unknown as ConstraintSetStatement)).toThrow(
      compileError('invalid-constraint-set'),
    );
  });

  it('FAILS with `goal-set-tenant-mismatch` for cross-tenant goal/constraint-set pairs (L12)', () => {
    const foreign: ConstraintSetStatement = { ...validSet(), tenantId: tenant('tenant_other') };
    expect(() => compileAcceptance(validGoal(), foreign)).toThrow(compileError('goal-set-tenant-mismatch'));
  });

  it('error details are field-prefixed diagnostics (never executed)', () => {
    try {
      compileAcceptance({ ...validGoal(), objective: '' }, validSet());
      expect.unreachable('expected a typed error');
    } catch (error) {
      expect(error).toBeInstanceOf(ControlDomainError);
      const typed = error as ControlDomainError;
      expect(typed.details.length).toBeGreaterThan(0);
      expect(typed.details[0]).toContain('objective');
      expect(typed.message).toContain('invalid-goal');
    }
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('isAcceptanceCriteria', () => {
  it('accepts the compiled artifact', () => {
    expect(isAcceptanceCriteria(exampleAcceptanceCriteria)).toBe(true);
    expect(isAcceptanceCriteria(compileAcceptance(validGoal(), validSet()))).toBe(true);
  });

  it('rejects structurally invalid artifacts', () => {
    const compiled = compileAcceptance(validGoal(), validSet());
    const invalid: unknown[] = [
      null,
      'criteria',
      { ...compiled, id: 'not-an-ac-id' },
      { ...compiled, version: 0 },
      { ...compiled, version: 2.5 },
      { ...compiled, tenantId: '' },
      { ...compiled, lineage: { goal: { goalId: 'g', version: 0 }, constraintSet: { id: 'c', version: 1 } } },
      { ...compiled, criteria: [] },
      { ...compiled, criteria: 'criteria' },
      // duplicate criterion ids
      { ...compiled, criteria: [compiled.criteria[0], compiled.criteria[0]] },
      // gate id that resolves to nothing in the snapshot
      {
        ...compiled,
        criteria: [
          { ...compiled.criteria[0], gatingConstraintIds: ['ghost_constraint'] },
        ],
      },
      // duplicate gate ids within one criterion
      {
        ...compiled,
        criteria: [
          { ...compiled.criteria[1], gatingConstraintIds: ['max_drawdown', 'max_drawdown'] },
        ],
      },
      { ...compiled, policy: { ...compiled.policy, requiredSatisfaction: 1.5 } },
      { ...compiled, policy: { ...compiled.policy, blindRef: '' } },
      { ...compiled, policy: 'strict' },
    ];
    for (const c of invalid) expect(isAcceptanceCriteria(c)).toBe(false);
  });

  it('isCompiledCriterion / isEvaluationPolicy component batteries', () => {
    expect(isCompiledCriterion(exampleAcceptanceCriteria.criteria[0])).toBe(true);
    expect(isCompiledCriterion(null)).toBe(false);
    expect(isCompiledCriterion({ criterion: exampleGoalStatement.successCriteria.criteria[0] })).toBe(false);
    expect(isCompiledCriterion({ criterion: exampleGoalStatement.successCriteria.criteria[0], gatingConstraintIds: 'max_drawdown' })).toBe(false);
    expect(isEvaluationPolicy(exampleAcceptanceCriteria.policy)).toBe(true);
    expect(isEvaluationPolicy({ blindRef: '', walkForwardRef: 'w', regimeRef: 'r', adversarialRequired: true, requiredSatisfaction: 0.5 })).toBe(false);
    expect(isEvaluationPolicy(null)).toBe(false);
  });

  it('isAcceptanceLineage validates the versioned refs (L15: non-empty ids, versioned)', () => {
    expect(isAcceptanceLineage(exampleAcceptanceCriteria.lineage)).toBe(true);
    expect(isAcceptanceLineage({ goal: { goalId: '', version: 1 }, constraintSet: { id: 'c', version: 1 } })).toBe(false);
    expect(isAcceptanceLineage({ goal: { goalId: 'g', version: 0 }, constraintSet: { id: 'c', version: 1 } })).toBe(false);
    expect(isAcceptanceLineage({ goal: { goalId: 'g', version: 1.5 }, constraintSet: { id: 'c', version: 1 } })).toBe(false);
    expect(isAcceptanceLineage({ goal: { goalId: 'g', version: 1 } })).toBe(false);
    expect(isAcceptanceLineage(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// L7 — PnL solicitude, asserted structurally
// ---------------------------------------------------------------------------

describe('L7 — PnL solicitude (structural)', () => {
  // WHY this test exists: raw PnL must never be able to express attainment
  // (spec/ARCHITECTURE-LOCK.md L7; AGENTS.md "Raw PnL is never the sole
  // acceptance criterion"). The compiled artifact is the ONLY thing that
  // defines attainment, so the claim is structural: enumerate every field
  // name reachable from an AcceptanceCriteria record and prove none of
  // them can carry a PnL figure or an attainment verdict. Attainment is a
  // FUNCTION of the artifact (criteria predicates + gating constraints +
  // policy), computed by T012 — there is nowhere to STORE a number or a
  // verdict, so raw PnL alone has no channel into "attained".
  const FORBIDDEN_KEYS = [
    'pnl',
    'profit',
    'netProfit',
    'grossProfit',
    'totalReturn',
    'return',
    'attained',
    'achieved',
    'passed',
    'pass',
    'failed',
    'verdict',
    'result',
    'score',
    'success',
  ];

  function collectAllKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
    if (Array.isArray(value)) {
      for (const item of value) collectAllKeys(item, into);
      return into;
    }
    if (typeof value === 'object' && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        into.add(key);
        collectAllKeys(child, into);
      }
    }
    return into;
  }

  it('the compiled artifact exposes no field that could carry raw PnL or an attainment verdict', () => {
    const keys = collectAllKeys(exampleAcceptanceCriteria);
    for (const key of keys) {
      expect(FORBIDDEN_KEYS, `field "${key}" must not be expressible on AcceptanceCriteria`).not.toContain(key);
    }
    // Sanity: the enumeration actually walked the artifact's graph.
    expect(keys).toContain('criteria');
    expect(keys).toContain('predicate');
    expect(keys).toContain('requiredSatisfaction');
  });

  it('compiling from a PnL-FLAVORED metric still requires the full predicate+policy protocol', () => {
    // Even a goal author who names a metric "pnl.net" cannot shortcut
    // attainment: the criterion is still a structured predicate, the
    // policy still pins blind/walk-forward/regime discipline, and the
    // artifact still carries no field where a realized value lands.
    const pnlFlavored: GoalStatement = {
      ...validGoal(),
      successCriteria: {
        criteria: [
          { id: 'pnl_sanity', metric: 'pnl.net', predicate: { kind: 'limit.min', bound: 0 } },
        ],
        requiredSatisfaction: 1,
      },
    };
    const compiled = compileAcceptance(pnlFlavored, validSet());
    expect(compiled.criteria[0]?.criterion.predicate).toEqual({ kind: 'limit.min', bound: 0 });
    expect(compiled.policy.requiredSatisfaction).toBe(1);
    const keys = collectAllKeys(compiled);
    for (const key of keys) expect(FORBIDDEN_KEYS).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// Type-level trip wires for L7 (fail `pnpm typecheck` if a PnL/outcome
// field ever appears on the record surface)
// ---------------------------------------------------------------------------

/** `true` iff `pnl` is not a key of AcceptanceCriteria. */
type PnlNotOnCriteria = 'pnl' extends keyof AcceptanceCriteria ? never : true;
const pnlNotOnCriteria: PnlNotOnCriteria = true;
/** `true` iff `attained` is not a key of AcceptanceCriteria. */
type AttainedNotOnCriteria = 'attained' extends keyof AcceptanceCriteria ? never : true;
const attainedNotOnCriteria: AttainedNotOnCriteria = true;
/** `true` iff `verdict` is not a key of AcceptanceCriteria. */
type VerdictNotOnCriteria = 'verdict' extends keyof AcceptanceCriteria ? never : true;
const verdictNotOnCriteria: VerdictNotOnCriteria = true;
/** `true` iff `result` is not a key of AcceptanceCriteria. */
type ResultNotOnCriteria = 'result' extends keyof AcceptanceCriteria ? never : true;
const resultNotOnCriteria: ResultNotOnCriteria = true;

it('type-level: the artifact surface has no outcome/PnL field', () => {
  // Runtime exercise of the compile-time witnesses (the assertion is that
  // these constants typecheck at all — each is `never` the moment the
  // forbidden key appears on the record).
  expect(pnlNotOnCriteria).toBe(true);
  expect(attainedNotOnCriteria).toBe(true);
  expect(verdictNotOnCriteria).toBe(true);
  expect(resultNotOnCriteria).toBe(true);
});
