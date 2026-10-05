// Tests for the component system's APPLICATION across the console
// (render/model.ts composing render/components.ts — UX-DESIGN §4.1-§4.6,
// §4.12, T051). The component shapes are pinned in components.test.ts;
// THESE pins prove the sections actually use them.
//
// Laws pinned here:
//   - Home renders the hero + the KPI tile grid + the rich stat card +
//     the activity timeline from the notice fold (projected by
//     availability — a post-view-time notice never renders);
//   - Home teaches: the layout-mirroring skeleton while connecting and
//     fresh; the ErrorState (role=alert, raw text only in Technical
//     details) when offline with nothing known;
//   - Research/Experiments/Organization render interactive list rows
//     (data-row) with domain status pills;
//   - the detail sheet opens for a job (§4.5a) through the shell view,
//     gated by the same availability + scope laws as the rows;
//   - Outcomes render accordion rows (§4.5b) whose definition grids
//     keep the exact decimals verbatim; Evidence renders the §4.9
//     capsule rows (mono content-address badges opening the payload +
//     provenance inline, the evidence refs verbatim);
//   - EVERY section's empty state is the teaching EmptyState (icon +
//     ONE sentence + exactly ONE primary action) — never a blank region.

import { describe, expect, it } from 'vitest';
import type { JobRecord, OrgStatusSnapshot, OutcomeRecord, ProjectRecord, ServedKnowledge } from '../api/contracts';
import { openWorkspace, reduceAll, type WorkspaceEvent, type WorkspaceState } from '../core/workspace';
import { capsuleFromOutcome } from '../core/evidence';
import { renderConsoleModel } from './model';
import { serializeVNode } from './vtree';
import { defaultShellView, type ShellView } from './shell';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

function projectRecord(): ProjectRecord {
  return {
    id: 'proj-a', tenantId: 'tenant-a', name: 'Console Test Project', executionMode: 'simulation',
    lifecycle: { projectId: 'proj-a', status: 'active', acceptanceCriteriaId: null, organizationRef: 'org:alpha' },
    lineage: { projectId: 'proj-a', createdAt: T0, createdBy: 'worker', priorVersion: null, version: 1, goal: { goalId: 'goal-1', version: 1 }, constraintSet: { id: 'cs-1', version: 1 } },
    createdAt: T0, updatedAt: T0,
  } as unknown as ProjectRecord;
}

function orgSnapshot(): OrgStatusSnapshot {
  return { organizationRef: 'org:alpha', tenant: 'tenant-a', project: 'proj-a', status: 'active', at: T0 + 10, instanceRefs: ['inst:1'] };
}

function job(): JobRecord {
  return { jobId: 'job-1', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'running', submittedAt: T0 + 20 };
}

function outcome(): OutcomeRecord {
  return {
    outcomeId: 'out-1', ordinal: 1, tenant: 'tenant-a', project: 'proj-a',
    decision: { decisionRef: 'dec-1', intentRef: 'int-1', disposition: 'filled' },
    outcomeClass: 'realized-profit',
    expectation: { expectedQuantity: '10', expectedRealized: '1.5', tolerance: '0.25', declaredBy: 'b1' },
    realization: { filledQuantity: '10', realizedOutcome: '1.75', feeTotal: '0.02', notionalTotal: '1000.00', unrealizedAtDecision: '0.00' },
    deviation: { quantityShortfall: null, realizedGap: '0.25', withinTolerance: true },
    evidence: [{ kind: 'fill', ref: 'fil-1' }],
    lineage: { shadow: { fidelity: { mode: 'shadow' }, riskPolicy: { policyId: 'pol-1', version: 2 }, experiment: null } },
    asOf: T0 + 30, priorChainHead: '00000000',
  } as unknown as OutcomeRecord;
}

function knowledge(): ServedKnowledge {
  return {
    record: {
      knowledgeId: 'knl-1', ordinal: 1, tenant: 'tenant-a', project: 'proj-a',
      claim: { kind: 'causal', polarity: 'positive', dimension: 'momentum', lagBand: null },
      confidence: '0.80', evidenceCount: 2,
      provenance: { postMortemRefs: [], outcomeRefs: [], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: [] },
      validity: { from: T0, to: T0 + 1000 }, asOf: T0, priorChainHead: '00000000',
    },
    status: 'active', supersededBy: null,
  } as unknown as ServedKnowledge;
}

/** A richly-populated workspace (the same shape the T042 model tests use). */
function populatedWorkspace(): WorkspaceState {
  const events: readonly WorkspaceEvent[] = [
    { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
    { kind: 'project-loaded', at: T0 + 2, project: projectRecord() },
    { kind: 'org-snapshot', at: T0 + 10, snapshot: orgSnapshot() },
    { kind: 'job-updated', at: T0 + 20, job: job() },
    { kind: 'outcomes-loaded', at: T0 + 30, records: [outcome()] },
    { kind: 'knowledge-loaded', at: T0 + 31, records: [knowledge()] },
    { kind: 'notices-read-all', at: T0 + 32 },
  ];
  return reduceAll(openWorkspace(SCOPE, T0), events);
}

/** Serialize with a shell view override (accountView etc.). */
function render(state: WorkspaceState, overrides: Partial<ShellView> = {}, at = T0 + 50): string {
  return serializeVNode(renderConsoleModel(state, at, { ...defaultShellView(state), ...overrides }));
}

describe('applied §4.1/§4.2/§4.6: the Home overview', () => {
  it('renders the hero + the KPI tile grid + the rich stat card + the activity timeline', () => {
    // advance the Time Machine anchor so every datum is knowable at the view instant (the T042 tests' own pattern)
    const anchored = reduceAll(populatedWorkspace(), [{ kind: 'view-live', at: T0 + 50 }]);
    const home = render(anchored, { accountView: 'home' });
    // the hero IS the page (§3)
    expect(home).toContain('class="panel hero"');
    // §4.1 the KPI tiles
    expect(home).toContain('class="stat-grid"');
    expect(home).toContain('<span class="stat-label">ACTIVE JOBS</span>');
    expect(home).toContain('<span class="stat-label">EVIDENCE CAPSULES</span>');
    // §4.2 the rich stat card
    expect(home).toContain('class="rich-stat-card"');
    expect(home).toContain('<div class="rich-eyebrow">ORGANIZATION</div>');
    expect(home).toContain('<span class="rich-value">active</span>');
    // §4.6 the activity timeline (from the notice fold)
    expect(home).toContain('class="timeline"');
  });

  it('teaches while connecting (the layout-mirroring skeleton) and when offline (the ErrorState)', () => {
    const connecting = render(openWorkspace(SCOPE, T0), { accountView: 'home' });
    expect(connecting).toContain('data-loading="stat-grid"');
    expect(connecting).toContain('role="status"');
    const offline = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'degraded-read', at: T0 + 1, route: 'GET /v1/meta', family: 'unavailable', message: 'ECONNREFUSED' },
      { kind: 'connection-changed', at: T0 + 1, status: 'offline' },
    ]);
    const offlineHome = render(offline, { accountView: 'home' });
    expect(offlineHome).toContain('role="alert"');
    expect(offlineHome).toContain('Try again');
    expect(offlineHome).toContain('Technical details');
    // the raw code rides in the ErrorState's mono block (the connection popover's degradation line is its own sanctioned technical surface)
    const errorBlock = offlineHome.slice(offlineHome.indexOf('class="error-state"'));
    expect(errorBlock).toContain('<pre class="error-technical-body">GET /v1/meta — ECONNREFUSED</pre>');
    expect(errorBlock.indexOf('ECONNREFUSED')).toBe(errorBlock.lastIndexOf('ECONNREFUSED'));
  });
});

describe('applied §4.4/§4.5a: the section list rows + the detail sheet', () => {
  it('Research renders job rows (data-row + domain pill); the sheet opens through the shell view', () => {
    const state = reduceAll(populatedWorkspace(), [{ kind: 'view-live', at: T0 + 50 }, { kind: 'section-selected', at: T0 + 50, section: 'research' }]);
    const research = render(state, { accountView: 'section' });
    expect(research).toContain('class="list-row" data-row="job:job-1"');
    expect(research).toContain('class="status-pill pill-live row-pill"');
    expect(research).toContain('<span class="pill-label">running</span>');
    // no sheet until the view opens one
    expect(research).toContain('data-sheet="closed"');
    expect(research).not.toContain('role="dialog"');
    const withSheet = render(state, { accountView: 'section', sheet: { kind: 'job', id: 'job-1' } });
    expect(withSheet).toContain('data-sheet="job:job-1"');
    expect(withSheet).toContain('role="dialog"');
    expect(withSheet).toContain('aria-modal="true"');
    expect(withSheet).toContain('aria-label="Close details"');
    expect(withSheet).toContain('<div class="def-eyebrow">STATUS</div>');
    expect(withSheet).toContain('<dd>running</dd>');
  });

  it('a sheet for a record that no longer exists renders closed (no orphan dialogs)', () => {
    const state = reduceAll(populatedWorkspace(), [{ kind: 'view-live', at: T0 + 50 }, { kind: 'section-selected', at: T0 + 50, section: 'research' }]);
    const orphan = render(state, { accountView: 'section', sheet: { kind: 'job', id: 'job-gone' } });
    expect(orphan).not.toContain('role="dialog"');
  });

  it('Organization renders snapshot rows', () => {
    const state = reduceAll(populatedWorkspace(), [{ kind: 'view-live', at: T0 + 50 }, { kind: 'section-selected', at: T0 + 50, section: 'organization' }]);
    const organization = render(state, { accountView: 'section' });
    expect(organization).toContain('class="list-row" data-row="snapshot:org:alpha"');
  });
});

describe('applied §4.5b: the accordion rows (decimals + refs verbatim)', () => {
  it('Outcomes renders accordion rows; the exact decimals ride in the definition grid', () => {
    const state = reduceAll(populatedWorkspace(), [{ kind: 'view-live', at: T0 + 50 }, { kind: 'section-selected', at: T0 + 50, section: 'outcomes' }]);
    const outcomes = render(state, { accountView: 'section' });
    expect(outcomes).toContain('accordion-row');
    expect(outcomes).toContain('<span class="when-closed">Show details</span>');
    expect(outcomes).toContain('1.75');       // realized outcome, verbatim
    expect(outcomes).toContain('1000.00');    // notional total, verbatim
    expect(outcomes).toContain('<div class="def-eyebrow">METRICS</div>');
  });

  it('Evidence renders the §4.9 capsule rows (mono content-address badges); the refs render verbatim in the OPEN payload', () => {
    const state = reduceAll(populatedWorkspace(), [{ kind: 'view-live', at: T0 + 50 }, { kind: 'section-selected', at: T0 + 50, section: 'evidence' }]);
    const capsule = capsuleFromOutcome(SCOPE, outcome());
    const closed = render(state, { accountView: 'section' });
    expect(closed).toContain('capsule-row');
    expect(closed).toContain(`data-capsule-open="${capsule.capsuleId}"`); // the badge's open button
    expect(closed).not.toContain('capsule-payload');                          // closed by default
    const opened = render(state, { accountView: 'section', openCapsule: capsule.capsuleId });
    expect(opened).toContain('capsule-mono');
    expect(opened).toContain('fil-1');                                       // the outcome's evidence ref, verbatim
    expect(opened).toContain('capsule-provenance');
    expect(opened).toContain(capsule.sourceRoute);                           // R45: the source route names itself
  });
});

describe('applied §4.12: every section teaches (empty states are first-class)', () => {
  const SECTIONS = ['goal', 'organization', 'market-world', 'research', 'experiments', 'decisions', 'execution', 'evidence', 'outcomes', 'lessons'] as const;

  it('a fresh workspace renders the EmptyState (icon + ONE sentence + exactly ONE action) in every section that can be empty', () => {
    for (const section of SECTIONS) {
      const state = reduceAll(openWorkspace(SCOPE, T0), [{ kind: 'section-selected', at: T0 + 1, section }]);
      const serialized = render(state, { accountView: 'section' }, T0 + 1);
      expect(serialized, section).toContain('class="empty-state"');
      expect(serialized, section).toContain('empty-circle');
      expect(serialized, section).toContain('class="empty-sentence"');
      expect(serialized.match(/class="empty-action"/g)?.length, section).toBe(1);
      // the action resolves to an affordance (a nav target — or the J3
      // launch entry's delegated action on Goal, the one-click law)
      expect(serialized, section).toMatch(/class="empty-action"[^>]* (data-target|data-action)="[a-z-]+"/);
      // never a blank region: the section panel still carries its key
      expect(serialized, section).toContain(`data-section="${section}"`);
    }
  });

  it('the pinned T042 empty sentences still render (the regression floor copy)', () => {
    const goal = render(openWorkspace(SCOPE, T0), { accountView: 'section' }, T0 + 1);
    expect(goal).toContain('No goal loaded yet.');
    const outcomes = render(reduceAll(openWorkspace(SCOPE, T0), [{ kind: 'section-selected', at: T0 + 1, section: 'outcomes' }]), { accountView: 'section' }, T0 + 1);
    expect(outcomes).toContain('No outcomes at this view instant');
    // the charter's own teaching example: experiments -> Research
    const experiments = render(reduceAll(openWorkspace(SCOPE, T0), [{ kind: 'section-selected', at: T0 + 1, section: 'experiments' }]), { accountView: 'section' }, T0 + 1);
    expect(experiments).toContain('Run your first evaluation from Research.');
    expect(experiments).toContain('data-target="research"');
  });
});

describe('applied: determinism with the component system', () => {
  it('identical (state, at, view) -> identical bytes (the component composition is pure)', () => {
    const state = reduceAll(populatedWorkspace(), [{ kind: 'view-live', at: T0 + 50 }]);
    const a = render(state, { accountView: 'home' });
    const b = render(state, { accountView: 'home' });
    expect(a).toBe(b);
    const sheetA = render(state, { accountView: 'section', sheet: { kind: 'job', id: 'job-1' } });
    const sheetB = render(state, { accountView: 'section', sheet: { kind: 'job', id: 'job-1' } });
    expect(sheetA).toBe(sheetB);
  });

  it('the availability law still rules the component surface (L4 from the composed pass)', () => {
    // WITHOUT advancing the anchor, the view instant precedes the job's availability: the sheet's own gate fires.
    expect(() => render(populatedWorkspace(), { accountView: 'section', sheet: { kind: 'job', id: 'job-1' } })).toThrow();
  });
});
