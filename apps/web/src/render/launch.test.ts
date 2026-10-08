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
import { capsuleFromOutcome } from '../core/evidence';
import type { OutcomeRecord } from '../api/contracts';
import { formatDurationMs, formatInstantUtc } from '../core/format';
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
    // The constraint carries the FORM GRAMMAR's own shape (W-10c: the
    // wizard's constraints field round-trips id:domain:subject:kind:bound).
    constraints: [{ id: 'c1', severity: 'blocking', domain: 'outcome', subject: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, description: 'the drawdown ceiling' } as never],
    capitalBudget: '10000.00',
    riskBudget: '250.00',
    markets: ['SPY'],
    venues: ['venue-x'],
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

  it('renders each step\'s labeled fields (labels ABOVE, hints, required marks; the select for the closed vocabulary)', () => {
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
        const controlIndex = bytes.indexOf(`launch-${name}`, labelIndex);
        expect(controlIndex, `${step}:${label}`).toBeGreaterThan(labelIndex); // the label sits ABOVE
        expect(bytes, `${step}:${label}`).toContain(`data-launch-field="${name}"`); // the change wiring's vocabulary
      }
    }
    // the execution mode is the closed-vocabulary SELECT (three options)
    const world = render(launchAt('world'), { accountView: 'section' });
    expect(world).toContain('<select class="field-input field-select"');
    expect((world.match(/<option value=/g) ?? []).length).toBe(3);
    expect(world).toContain('<option value="simulation" selected="selected">');
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

  it('FW-32-B (b4): the review renders the horizon HUMAN-READABLE — the console\'s own formatInstantUtc + formatDurationMs discipline, never raw epoch ms (L1/M1/L3/M5\'s finding)', () => {
    const bytes = render(launchAt('review'), { accountView: 'section' });
    // the fixture's horizon: T0 -> T0 + one day — the review line names both
    // instants in the mono UTC form and the span in the duration form (the ->
    // is escaped in the serialized text nodes)
    expect(bytes).toContain(`<dt>Horizon</dt><dd>${formatInstantUtc(T0)} -&gt; ${formatInstantUtc(T0 + 86_400_000)} (${formatDurationMs(86_400_000)})</dd>`);
    // ...and the raw epoch ms NEVER renders at review (the pre-fix line was `${T0} -> ${T0 + 86_400_000}`)
    expect(bytes).not.toContain(`<dt>Horizon</dt><dd>${T0}`);
    // an unparseable pair renders verbatim (the review gate owns validation; the line invents nothing)
    const broken: WorkspaceState = { ...launchAt('review'), launch: { ...launchAt('review').launch, draft: { ...draft(), horizon: { ...draft().horizon, startsAt: T0, endsAt: T0 - 1 } } } };
    expect(render(broken, { accountView: 'section' })).toContain(`<dt>Horizon</dt><dd>${T0} -&gt; ${T0 - 1}</dd>`);
  });

  it('the REVIEW GATE: an invalid draft renders its problems (never the arm button); the valid draft arms', () => {
    const invalid: WorkspaceState = { ...launchAt('review'), launch: { ...launchAt('review').launch, draft: { ...draft(), capitalBudget: '10.5.0' } } };
    const blocked = render(invalid, { accountView: 'section' });
    expect(blocked).toContain('data-review-problems="1"');
    expect(blocked).toContain('Enter an exact non-negative decimal.');
    expect(blocked).not.toContain('data-action="confirm-arm-launch"'); // the launch confirm stays unreachable
    // fixed -> the summary + the arm button return
    const fixed: WorkspaceState = { ...launchAt('review'), launch: { ...launchAt('review').launch, draft: { ...draft(), capitalBudget: '10000.00' } } };
    expect(render(fixed, { accountView: 'section' })).toContain('data-action="confirm-arm-launch"');
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
  it('the shell view carries the open capsule; the §4.9 surface opens the payload + provenance inline', () => {
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
    const capsule = capsuleFromOutcome(SCOPE, (state.outcomes[0] as unknown) as OutcomeRecord);
    const closed = render(state, { accountView: 'section' });
    expect(closed).toContain(`data-capsule-row="${capsule.capsuleId}"`);   // the §4.9 capsule row renders
    expect(closed).toContain(`data-capsule-open="${capsule.capsuleId}"`);  // the mono content-address badge
    expect(closed).not.toContain('capsule-payload');                        // closed by default
    const opened = render(state, { accountView: 'section', openCapsule: capsule.capsuleId });
    expect(opened).toContain('capsule-payload');
    expect(opened).toContain('capsule-mono');
    expect(opened).toContain('fil-1');                                      // the record's own evidence ref, verbatim
    expect(opened).toContain('capsule-provenance');
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
