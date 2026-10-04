// Tests for the primary flow model — the UX.md launch draft.
//
// Laws pinned here (launch.ts header):
//   - the draft: goal, constraints, capital/risk budget, markets/venues,
//     horizon, data, execution mode, optional preferences — typed end to end;
//   - validation is LOCAL and TYPED (InvalidLaunchDraftError with dotted
//     paths) BEFORE any API call;
//   - budgets are EXACT DECIMAL STRINGS (never floats);
//   - the composition: POST /v1/projects body (goal + constraint set,
//     budgets as blocking outcome constraints) + the kickoff job spec;
//   - async progress: submitted -> running -> complete, rendered from
//     INJECTED instants (never a wall clock).

import { describe, expect, it } from 'vitest';
import { InvalidLaunchDraftError } from './errors';
import {
  LAUNCH_STEPS,
  initialLaunchState,
  isIdentifierPath,
  renderJobProgress,
  toCreateProjectInput,
  toLaunchJobSpec,
  validateLaunchDraft,
  type LaunchDraft,
} from './launch';

const T0 = 1_700_000_000_000;

function validDraft(overrides: Partial<LaunchDraft> = {}): LaunchDraft {
  return {
    name: 'Alpha Seeker',
    objective: 'beat the benchmark net of costs over the horizon',
    horizon: { startsAt: T0, endsAt: T0 + 90 * 86_400_000, label: 'Q1' },
    successCriteria: [
      { id: 'c1', metric: 'returns.net_sharpe', predicate: { kind: 'limit.min', bound: 1.5 } },
      { id: 'c2', metric: 'risk.max_drawdown', predicate: { kind: 'limit.max', bound: 0.1 } },
    ],
    evaluation: { blindRef: 'eval:blind-1', walkForwardRef: 'eval:wf-1', regimeRef: 'eval:regime-1', adversarialRequired: true },
    constraints: [{ id: 'k1', domain: 'action', subject: 'position.max_gross', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking' }],
    capitalBudget: '1000000.00',
    riskBudget: '0.02',
    markets: ['SPY', 'GLD'],
    venues: ['venue-x'],
    dataSources: ['data:ohlcv-1d'],
    executionMode: 'simulation',
    preferences: [{ key: 'rebalance.frequency', value: 'weekly' }],
    ...overrides,
  };
}

describe('launch: the wizard + the initial state', () => {
  it('the five steps in the primary flow\'s own order', () => {
    expect([...LAUNCH_STEPS]).toEqual(['goal', 'budget', 'markets', 'world', 'review']);
  });

  it('the initial state is idle with no draft and no progress', () => {
    const state = initialLaunchState();
    expect(state.phase).toBe('idle');
    expect(state.draft).toBeNull();
    expect(state.step).toBe('goal');
    expect(state.progress).toEqual([]);
    expect(state.error).toBeNull();
  });
});

describe('launch: draft validation (typed, local, BEFORE any API call)', () => {
  it('a complete draft passes', () => {
    expect(() => validateLaunchDraft(validDraft())).not.toThrow();
  });

  it('each violation names its dotted path (the render layer surfaces it inline)', () => {
    const cases: readonly [Partial<LaunchDraft>, RegExp][] = [
      [{ name: '   ' }, /^name:/],
      [{ objective: '' }, /^objective:/],
      [{ horizon: { startsAt: T0 + 10, endsAt: T0 } }, /^horizon:/],
      [{ successCriteria: [] }, /^successCriteria:/],
      [{ successCriteria: [{ id: 'c1', metric: 'not a path!', predicate: { kind: 'limit.min', bound: 1 } }] }, /^successCriteria\.c1\.metric:/],
      [{ constraints: [{ id: 'k1', domain: 'action', subject: 'bad subject', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking' }] }, /^constraints\.k1\.subject:/],
      [{ capitalBudget: '1e6' }, /^capitalBudget:/],
      [{ riskBudget: '-5' }, /^riskBudget:/],
      [{ markets: [] }, /^markets:/],
      [{ venues: [] }, /^venues:/],
      [{ dataSources: [] }, /^dataSources:/],
      [{ executionMode: 'paper' as never }, /^executionMode:/],
      [{ preferences: [{ key: '', value: 'x' }] }, /^preferences:/],
    ];
    for (const [overrides, path] of cases) {
      let caught: unknown;
      try {
        validateLaunchDraft(validDraft(overrides));
      } catch (error) {
        caught = error;
      }
      expect(caught, JSON.stringify(overrides)).toBeInstanceOf(InvalidLaunchDraftError);
      const violation = caught as InvalidLaunchDraftError;
      expect(violation.code).toBe('invalid_launch_draft');
      expect(violation.path + ':').toMatch(path);
    }
  });

  it('the budgets are EXACT DECIMALS — floats and sloppy forms refused', () => {
    for (const bad of ['1000000', '0.5', '0', '123.456789']) {
      expect(() => validateLaunchDraft(validDraft({ capitalBudget: bad })), bad).not.toThrow();
    }
    for (const bad of ['1e6', '0x10', '12,5', '', ' 1', '1.']) {
      expect(() => validateLaunchDraft(validDraft({ riskBudget: bad })), JSON.stringify(bad)).toThrow(InvalidLaunchDraftError);
    }
    expect(() => validateLaunchDraft(validDraft({ capitalBudget: '-1' }))).toThrow(InvalidLaunchDraftError);
  });

  it('the metric/subject grammar is the boundary\'s identifier-path grammar', () => {
    expect(isIdentifierPath('returns.net_sharpe')).toBe(true);
    expect(isIdentifierPath('a')).toBe(true);
    expect(isIdentifierPath('a.b.c')).toBe(true);
    expect(isIdentifierPath('.a')).toBe(false);
    expect(isIdentifierPath('a..b')).toBe(false);
    expect(isIdentifierPath('1a.b')).toBe(false);
    expect(isIdentifierPath('a.')).toBe(false);
  });
});

describe('launch: the composition (POST /v1/projects + the kickoff job spec)', () => {
  const ids = { projectId: 'prj-launch-1', goalId: 'goal-launch-1', constraintSetId: 'cs-launch-1' };

  it('builds the create-project body: goal + constraint set, tenant-bound, stamped at the injected instant', () => {
    const input = toCreateProjectInput(validDraft(), ids, 'tenant-a', T0 + 5);
    expect(input.id).toBe('prj-launch-1');
    expect(input.name).toBe('Alpha Seeker');
    expect(input.executionMode).toBe('simulation');
    expect(input.at).toBe(T0 + 5);

    expect(input.goal.id).toBe('goal-launch-1');
    expect(input.goal.tenantId).toBe('tenant-a'); // L12 at the composition layer
    expect(input.goal.version).toBe(1);
    expect(input.goal.createdAt).toBe(T0 + 5); // injected, never a wall clock
    expect(input.goal.objective).toBe('beat the benchmark net of costs over the horizon');
    expect(input.goal.successCriteria.criteria).toHaveLength(2);

    expect(input.constraintSet.id).toBe('cs-launch-1');
    expect(input.constraintSet.tenantId).toBe('tenant-a');
    // the budgets ride as BLOCKING outcome constraints, verbatim decimals
    const capital = input.constraintSet.constraints.find((constraint) => constraint.id === 'k-capital-budget');
    const risk = input.constraintSet.constraints.find((constraint) => constraint.id === 'k-risk-budget');
    expect(capital).toMatchObject({ domain: 'outcome', subject: 'capital.budget', severity: 'blocking', predicate: { kind: 'equals', value: '1000000.00' } });
    expect(risk).toMatchObject({ domain: 'outcome', subject: 'risk.budget', severity: 'blocking', predicate: { kind: 'equals', value: '0.02' } });
    // the user's own constraints ride too
    expect(input.constraintSet.constraints.some((constraint) => constraint.id === 'k1')).toBe(true);
  });

  it('requiredSatisfaction is derived deterministically from the criteria count', () => {
    const one = toCreateProjectInput(validDraft({ successCriteria: [validDraft().successCriteria[0] as never] }), ids, 'tenant-a', T0);
    expect(one.goal.successCriteria.requiredSatisfaction).toBe(1);
    const two = toCreateProjectInput(validDraft(), ids, 'tenant-a', T0);
    expect(two.goal.successCriteria.requiredSatisfaction).toBe(1 / 2);
  });

  it('refuses an invalid draft and an empty tenant BEFORE composing (no partial submissions)', () => {
    expect(() => toCreateProjectInput(validDraft({ name: '' }), ids, 'tenant-a', T0)).toThrow(InvalidLaunchDraftError);
    expect(() => toCreateProjectInput(validDraft(), ids, '', T0)).toThrow(/tenantId/);
    expect(() => toLaunchJobSpec(validDraft({ markets: [] }))).toThrow(InvalidLaunchDraftError);
  });

  it('the kickoff job spec carries the FULL launch context (the job machinery owns the semantics)', () => {
    const spec = toLaunchJobSpec(validDraft());
    expect(spec).toEqual({
      kind: 'console-launch',
      objective: 'beat the benchmark net of costs over the horizon',
      horizon: { startsAt: T0, endsAt: T0 + 90 * 86_400_000, label: 'Q1' },
      capitalBudget: '1000000.00',
      riskBudget: '0.02',
      markets: ['SPY', 'GLD'],
      venues: ['venue-x'],
      dataSources: ['data:ohlcv-1d'],
      executionMode: 'simulation',
      preferences: [{ key: 'rebalance.frequency', value: 'weekly' }],
    });
    expect(JSON.stringify(toLaunchJobSpec(validDraft()))).toBe(JSON.stringify(toLaunchJobSpec(validDraft()))); // deterministic
  });
});

describe('launch: async job progress (submitted -> running -> complete, injected instants)', () => {
  it('no observations render null; the view is pure arithmetic over observed points', () => {
    expect(renderJobProgress([])).toBeNull();
    const view = renderJobProgress([
      { status: 'submitted', at: T0 },
      { status: 'running', at: T0 + 100 },
      { status: 'complete', at: T0 + 900 },
    ]);
    expect(view?.phase).toBe('complete');
    expect(view?.submittedAt).toBe(T0);
    expect(view?.completedAt).toBe(T0 + 900);
    expect(view?.elapsedMs).toBe(900); // exact integer arithmetic, never a clock
    expect(view?.lastObservedAt).toBe(T0 + 900);
    expect(view?.observations.map((point) => point.status)).toEqual(['submitted', 'running', 'complete']);
  });

  it('observations arrive sorted by observed instant, whatever the arrival order', () => {
    const view = renderJobProgress([
      { status: 'complete', at: T0 + 900 },
      { status: 'submitted', at: T0 },
      { status: 'running', at: T0 + 100 },
    ]);
    expect(view?.observations[0]?.status).toBe('submitted');
    expect(view?.phase).toBe('complete');
  });

  it('a failed job renders failed with its elapsed time; a pending one has null completion', () => {
    const failed = renderJobProgress([{ status: 'submitted', at: T0 }, { status: 'failed', at: T0 + 50 }]);
    expect(failed?.phase).toBe('failed');
    expect(failed?.completedAt).toBe(T0 + 50);
    expect(failed?.elapsedMs).toBe(50);

    const pending = renderJobProgress([{ status: 'submitted', at: T0 }, { status: 'running', at: T0 + 10 }]);
    expect(pending?.phase).toBe('running');
    expect(pending?.completedAt).toBeNull();
    expect(pending?.elapsedMs).toBeNull();
  });

  it('identical observations -> identical view bytes (determinism)', () => {
    const points = [{ status: 'submitted', at: T0 }, { status: 'complete', at: T0 + 5 }] as const;
    expect(JSON.stringify(renderJobProgress([...points]))).toBe(JSON.stringify(renderJobProgress([...points])));
  });
});
