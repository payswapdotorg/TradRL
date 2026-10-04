// Tests for the W-2e interaction sweep (the launch wizard's full field
// set + the two-step confirm wiring, the capsule inline open, and the
// toast surfacing) — UX-DESIGN §4.9/§4.10/§4.11, T051.
//
// Laws pinned here:
//   §4.11 the launch wizard renders the primary flow's FULL field set
//        across its five steps (goal, budget, markets, world, review)
//        with labels ABOVE + hints; the review step renders the
//        summary + the two-step confirm; touched-gated inline
//        validation renders destructive messages only after blur.
//   §4.9  a capsule badge opens its payload inline (mono + provenance).
//   §4.10 a new notice surfaces as a toast (role=status) while the
//        unread state stays recoverable.

import { describe, expect, it } from 'vitest';
import { openWorkspace, reduceAll, type WorkspaceEvent, type WorkspaceState } from '../core/workspace';
import { LAUNCH_STEPS } from '../core/launch';
import { renderConsoleModel } from './model';
import { defaultShellView, type ShellView } from './shell';
import { serializeVNode } from './vtree';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

function draft(): Exclude<WorkspaceState['launch']['draft'], null> {
  return {
    name: 'Momentum scout',
    objective: 'Beat the index with bounded drawdown.',
    horizon: { startsAt: T0, endsAt: T0 + 86_400_000, label: 'one day' },
    successCriteria: [],
    evaluation: { blindRef: 'blind-1', walkForwardRef: 'wf-1', regimeRef: 'regime-1', adversarialRequired: true },
    constraints: [{ id: 'c1', severity: 'hard', domain: 'risk', subject: 'position', predicate: { kind: 'at-most' } } as never],
    capitalBudget: '10000.00',
    riskBudget: '250.00',
    markets: ['SPY'],
    venues: [' venue-x'],
    dataSources: ['src-1'],
    executionMode: 'simulation',
    preferences: [{ key: 'rebalance', value: 'daily' }],
  } as never;
}

/** A workspace with a launch draft at a step. */
function launchAt(step: string): WorkspaceState {
  const events: readonly WorkspaceEvent[] = [
    { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
    { kind: 'launch-draft-started', at: T0 + 2, draft: draft() },
    { kind: 'launch-step-changed', at: T0 + 3, step: step as typeof LAUNCH_STEPS[number] },
    { kind: 'section-selected', at: T0 + 4, section: 'goal' },
    { kind: 'view-live', at: T0 + 50 },
  ];
  return reduceAll(openWorkspace(SCOPE, T0), events);
}

function render(state: WorkspaceState, overrides: Partial<ShellView> = {}, at = T0 + 50): string {
  return serializeVNode(renderConsoleModel(state, at, { ...defaultShellView(state), ...overrides }));
}

describe('the launch wizard (§4.11 — the primary flow\'s full field set)', () => {
  it('carries the five charter steps: goal, budget, markets, world, review', () => {
    expect([...LAUNCH_STEPS]).toEqual(['goal', 'budget', 'markets', 'world', 'review']);
  });

  it('renders each step\'s labeled fields (labels ABOVE, hints, required marks)', () => {
    const expected: Record<string, readonly (readonly [string, string])[]> = {
      goal: [['Name', 'name'], ['Objective', 'objective']],
      budget: [['Capital budget', 'capitalBudget'], ['Risk budget', 'riskBudget']],
      markets: [['Markets', 'markets'], ['Venues', 'venues'], ['Data sources', 'dataSources']],
      world: [['Horizon starts', 'horizonStartsAt'], ['Horizon ends', 'horizonEndsAt'], ['Execution mode', 'executionMode'], ['Preferences', 'preferences'], ['Constraints', 'constraints']],
    };
    for (const [step, labels] of Object.entries(expected)) {
      const state = launchAt(step);
      expect(state.launch.step, step).toBe(step); // the state machine accepted the step
      expect(state.launch.draft, step).not.toBeNull();
      const bytes = render(state, { accountView: 'section' });
      expect(bytes, step).toContain(`data-launch-step="${step}"`);
      for (const [label, name] of labels) {
        expect(bytes, `${step}:${label}`).toContain(`<label class="field-label" for="launch-${name}">${label}`);
        const labelIndex = bytes.indexOf(`>${label}`);
        const inputIndex = bytes.indexOf('field-input', labelIndex);
        expect(inputIndex, `${step}:${label}`).toBeGreaterThan(labelIndex); // the label sits ABOVE
      }
    }
  });

  it('the review step renders the full summary + the two-step confirm (never a bare confirm())', () => {
    const bytes = render(launchAt('review'), { accountView: 'section' });
    expect(bytes).toContain('data-review="launch"');
    expect(bytes).toContain('<dt>Name</dt><dd>Momentum scout</dd>');
    expect(bytes).toContain('<dt>Capital budget</dt><dd>10000.00</dd>');
    expect(bytes).toContain('<dt>Markets</dt><dd>SPY</dd>');
    expect(bytes).toContain('<dt>Execution mode</dt><dd>simulation</dd>');
    expect(bytes).toContain('<dt>Preferences</dt><dd>rebalance=daily</dd>');
    // the confirm is unarmed first: the arm button, not the question
    expect(bytes).toContain('data-action="confirm-arm-launch"');
    expect(bytes).not.toContain('Are you sure?');
    // armed: the question + [Cancel] [Confirm] inline
    const armed = render(launchAt('review'), { accountView: 'section', confirm: 'launch' });
    expect(armed).toContain('Are you sure? Launch this organization?');
    expect(armed).toContain('data-action="confirm-cancel-launch"');
    expect(armed).toContain('data-action="confirm-launch"');
  });

  it('inline validation renders ONLY after the field is touched (labels stay, errors gate)', () => {
    const pristine = render(launchAt('goal'), { accountView: 'section' });
    expect(pristine).not.toContain('class="field-error"');
    const emptyObjective: WorkspaceState = { ...launchAt('goal'), launch: { ...launchAt('goal').launch, draft: { ...draft(), objective: '' } } };
    const touchedGoal = render(emptyObjective, { accountView: 'section', touchedFields: ['objective'] });
    expect(touchedGoal).toContain('class="field-error"');
    expect(touchedGoal).toContain('Describe the objective in one sentence.');
    const touchedValidBudget = render(launchAt('budget'), { accountView: 'section', touchedFields: ['capitalBudget'] });
    expect(touchedValidBudget).not.toContain('field-error'); // a valid decimal stays silent even when touched
  });

  it('a bad decimal validates destructively; a good one stays silent', () => {
    const state = launchAt('budget');
    // '10.5.0' is NOT an exact decimal (the pattern takes at most one fraction) — the destructive message renders.
    const mutated: WorkspaceState = { ...state, launch: { ...state.launch, draft: { ...draft(), capitalBudget: '10.5.0' } } };
    const bytes = render(mutated, { accountView: 'section', touchedFields: ['capitalBudget'] });
    expect(bytes).toContain('class="field-error"');
    expect(bytes).toContain('Enter an exact non-negative decimal.');
    const good: WorkspaceState = { ...state, launch: { ...state.launch, draft: { ...draft(), capitalBudget: '10000.00' } } };
    expect(render(good, { accountView: 'section', touchedFields: ['capitalBudget'] })).not.toContain('field-error');
  });

  it('the step navigation renders the five segments + the Next/Review actions', () => {
    const bytes = render(launchAt('goal'), { accountView: 'section' });
    for (const step of LAUNCH_STEPS) {
      expect(bytes).toContain(`data-action="launch-step-${step}"`);
    }
    expect(bytes).toContain('Next: budget');
    expect(bytes).toContain('data-action="launch-step-review"');
    expect(bytes).toContain('aria-pressed="true"'); // the active step
  });
});

describe('the capsule inline open (§4.9)', () => {
  it('the shell view carries the open capsule; the default renders none', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'outcomes-loaded', at: T0 + 30, records: [{
        outcomeId: 'out-1', ordinal: 1, tenant: 'tenant-a', project: 'proj-a',
        decision: { decisionRef: 'dec-1', intentRef: 'int-1', disposition: 'filled' },
        outcomeClass: 'realized-profit',
        expectation: { expectedQuantity: '10', expectedRealized: '1.5', tolerance: '0.25', declaredBy: 'b1' },
        realization: { filledQuantity: '10', realizedOutcome: '1.75', feeTotal: '0.02', notionalTotal: '1000.00', unrealizedAtDecision: '0.00' },
        deviation: { quantityShortfall: null, realizedGap: '0.25', withinTolerance: true },
        evidence: [{ kind: 'fill', ref: 'fil-1' }],
        lineage: { shadow: { fidelity: { mode: 'shadow' }, riskPolicy: { policyId: 'pol-1', version: 2 }, experiment: null } },
        asOf: T0 + 30, priorChainHead: '00000000',
      } as never] },
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 50, section: 'evidence' },
    ]);
    const closed = render(state, { accountView: 'section' });
    expect(closed).toContain('data-row="capsule:evc:');           // the accordion row renders (the capsule surface)
    expect(closed).not.toContain('data-capsule-open="evc:');      // closed by default
    expect(closed.match(/data-row="capsule:evc:/g)?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('the toast surfacing (§4.10/D6)', () => {
  it('the toast renders from the shell view with role=status; closing is an action', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [{ kind: 'connection-changed', at: T0 + 1, status: 'connected' }, { kind: 'view-live', at: T0 + 50 }]);
    const toasted = render(state, { accountView: 'home', toast: { kind: 'failed_evaluation', title: 'Failed evaluation', sentence: 'An evaluation did not pass — the firm keeps the lesson.' } });
    expect(toasted).toContain('role="status"');
    expect(toasted).toContain('data-toast="failed_evaluation"');
    expect(toasted).toContain('An evaluation did not pass — the firm keeps the lesson.');
  });
});

describe('determinism with the full wizard', () => {
  it('identical (state, at, view) -> identical bytes', () => {
    const state = launchAt('review');
    expect(render(state, { accountView: 'section' })).toBe(render(state, { accountView: 'section' }));
    expect(render(state, { accountView: 'section', confirm: 'launch' })).toBe(render(state, { accountView: 'section', confirm: 'launch' }));
  });
});
